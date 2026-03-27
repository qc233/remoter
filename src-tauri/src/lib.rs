use serde::{Deserialize, Serialize};
use tauri::{State, Emitter, Manager, AppHandle};
use std::sync::Arc;
use dashmap::DashMap;
use uuid::Uuid;
use parking_lot::Mutex;
use std::fs;
use std::path::PathBuf;
use std::net::TcpStream;
use ssh2::Session;
use std::io::prelude::*;
use std::thread;
use std::collections::HashMap;

use std::sync::mpsc;
use std::time::Duration;

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq)]
pub enum SessionStatus {
    Idle,
    Running,
    Success,
    Failure,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionInfo {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: Option<String>,
    pub key_path: Option<String>,
    pub jump_host: Option<String>,
    pub group: String,
    pub status: SessionStatus,
    pub history: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AppSettings {
    pub theme: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScriptVar {
    pub name: String,
    pub required: bool,
    pub default_value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Script {
    pub id: String,
    pub name: String,
    pub command_template: String,
    pub vars: Vec<ScriptVar>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub sessions: Vec<SessionInfo>,
    pub scripts: Vec<Script>,
    pub settings: AppSettings,
}

pub struct SshSession {
    pub channel: Arc<Mutex<ssh2::Channel>>,
    pub tx: mpsc::Sender<Vec<u8>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SftpFile {
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
    pub is_file: bool,
    pub permissions: Option<u32>,
    pub modified: Option<u64>,
}

pub struct AppState {
    pub sessions: DashMap<String, SessionInfo>,
    pub scripts: DashMap<String, Script>,
    pub settings: Mutex<AppSettings>,
    pub config_path: PathBuf,
    pub ssh_sessions: DashMap<String, Arc<SshSession>>,
    pub raw_sessions: DashMap<String, Arc<Mutex<Session>>>,
}

impl AppState {
    fn save_config_to_disk(&self) {
        let config = AppConfig {
            sessions: self.sessions.iter().map(|kv| kv.value().clone()).collect(),
            scripts: self.scripts.iter().map(|kv| kv.value().clone()).collect(),
            settings: self.settings.lock().clone(),
        };
        let json = serde_json::to_string_pretty(&config).expect("Failed to serialize config");
        let _ = fs::write(&self.config_path, json);
    }
}

#[tauri::command]
async fn manual_save_to_disk(state: State<'_, AppState>) -> Result<(), String> {
    state.save_config_to_disk();
    Ok(())
}

#[tauri::command]
async fn update_session_group(
    state: State<'_, AppState>,
    id: String,
    group: String,
) -> Result<(), String> {
    if let Some(mut session) = state.sessions.get_mut(&id) {
        session.group = group;
        state.save_config_to_disk();
        Ok(())
    } else {
        Err("Session not found".to_string())
    }
}

#[tauri::command]
async fn stop_ssh_session(
    state: State<'_, AppState>,
    instance_id: String,
) -> Result<(), String> {
    state.ssh_sessions.remove(&instance_id);
    state.raw_sessions.remove(&instance_id);
    Ok(())
}

#[tauri::command]
async fn start_ssh_session(
    app_handle: AppHandle,
    instance_id: String,
    session_id: String,
    rows: u32,
    cols: u32,
) -> Result<(), String> {
    let state = app_handle.state::<AppState>();
    
    if state.ssh_sessions.contains_key(&instance_id) {
        return Ok(());
    }

    let session_info = state.sessions.get(&session_id)
        .ok_or_else(|| "Session config not found".to_string())?
        .clone();

    let tcp = TcpStream::connect(format!("{}:{}", session_info.host, session_info.port))
        .map_err(|e| e.to_string())?;
    
    let mut sess = Session::new().map_err(|e| e.to_string())?;
    sess.set_tcp_stream(tcp);
    sess.handshake().map_err(|e| e.to_string())?;

    if let Some(ref key_path) = session_info.key_path {
        if !key_path.is_empty() {
            let path = std::path::Path::new(key_path);
            sess.userauth_pubkey_file(&session_info.user, None, path, None)
                .map_err(|e| format!("Key authentication failed: {}", e))?;
        } else if let Some(ref pass) = session_info.password {
            sess.userauth_password(&session_info.user, pass)
                .map_err(|e| format!("Password authentication failed: {}", e))?;
        } else {
            return Err("Neither key path nor password provided".to_string());
        }
    } else if let Some(ref pass) = session_info.password {
        sess.userauth_password(&session_info.user, pass)
            .map_err(|e| format!("Password authentication failed: {}", e))?;
    } else {
        return Err("Neither key path nor password provided".to_string());
    }

    let mut channel = sess.channel_session().map_err(|e| e.to_string())?;
    channel.request_pty("xterm-256color", None, Some((cols, rows, 0, 0))).map_err(|e| e.to_string())?;
    channel.shell().map_err(|e| e.to_string())?;

    // Set non-blocking after successful setup
    sess.set_blocking(false);

    let session_arc = Arc::new(Mutex::new(sess));
    state.raw_sessions.insert(instance_id.clone(), session_arc.clone());

    let channel = Arc::new(Mutex::new(channel));
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    
    let ssh_session = Arc::new(SshSession {
        channel: channel.clone(),
        tx: tx.clone(),
    });

    state.ssh_sessions.insert(instance_id.clone(), ssh_session);

    // Read/Write loop
    let app_clone = app_handle.clone();
    let instance_id_clone = instance_id.clone();
    let channel_for_read = channel.clone();
    
    thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        let mut write_buffer = Vec::new();
        
        // Interception State Machine
        let mut boot_buffer = Vec::new();
        let mut boot_phase = 0; // 0: Waiting for first data, 1: Buffering until sentinel, 2: Normal
        let mut injection_sent = false;
        let mut motd_limit = 0;
        let boot_start = std::time::Instant::now();
        let sentinel = "__REMOTER_SYNC_DONE__"; 

        loop {
            // Check if session still exists in state
            {
                let state = app_clone.state::<AppState>();
                if !state.ssh_sessions.contains_key(&instance_id_clone) {
                    break;
                }
            }

            let mut data_received = None;
            let mut closed = false;
            let mut would_block = true;

            {
                let mut chan = channel_for_read.lock();

                // --- Safety Timeout ---
                if boot_phase < 2 && boot_start.elapsed() > Duration::from_secs(3) {
                    if !boot_buffer.is_empty() {
                        let _ = app_clone.emit(&format!("ssh_data_{}", instance_id_clone), String::from_utf8_lossy(&boot_buffer).to_string());
                        boot_buffer.clear();
                    }
                    boot_phase = 2;
                }

                // Normal reading
                match chan.read(&mut buffer) {
                    Ok(0) => closed = true,
                    Ok(n) => {
                        let chunk = &buffer[..n];
                        would_block = false;

                        if boot_phase < 2 {
                            boot_buffer.extend_from_slice(chunk);

                            if boot_phase == 0 {
                                // Phase 0: First chunk arrived, record MOTD limit and trigger injection
                                motd_limit = boot_buffer.len();
                                let injection = " stty -echo; _remoter_osc7(){ printf \"\\033]7;file://%s%s\\033\\\\\" \"${HOSTNAME:-$HOST}\" \"$PWD\"; }; [ -n \"$BASH_VERSION\" ] && PROMPT_COMMAND=_remoter_osc7; [ -n \"$ZSH_VERSION\" ] && precmd_functions+=(_remoter_osc7); stty echo; echo __\"\"REMOTER_SYNC_DONE__\n";
                                let _ = chan.write_all(injection.as_bytes());
                                injection_sent = true;
                                boot_phase = 1;
                            }

                            // Check for sentinel in the accumulated boot_buffer
                            let scan_str = String::from_utf8_lossy(&boot_buffer);
                            if let Some(pos) = scan_str.find(sentinel) {
                                let byte_pos_sentinel = scan_str[..pos].as_bytes().len();

                                // 1. Use the recorded motd_limit to find the real end of MOTD (before the first prompt)
                                let motd_end = boot_buffer[..motd_limit].iter().rposition(|&b| b == b'\n').map(|p| p + 1).unwrap_or(0);
                                let pure_motd = &boot_buffer[..motd_end];

                                if !pure_motd.is_empty() {
                                    let _ = app_clone.emit(&format!("ssh_data_{}", instance_id_clone), String::from_utf8_lossy(pure_motd).to_string());
                                }

                                // 2. Emit everything AFTER the sentinel (this is the fresh, final prompt)
                                let byte_pos_after = byte_pos_sentinel + sentinel.len();
                                let rest = &boot_buffer[byte_pos_after..];

                                // Skip leading newlines in the rest to keep it tight
                                let mut start = 0;
                                while start < rest.len() && (rest[start] == b'\r' || rest[start] == b'\n') {
                                    start += 1;
                                }
                                if start < rest.len() {
                                    let _ = app_clone.emit(&format!("ssh_data_{}", instance_id_clone), String::from_utf8_lossy(&rest[start..]).to_string());
                                }

                                boot_phase = 2;
                                boot_buffer.clear();
                            }
                        } else {
                            // Phase 2: Normal operation
                            data_received = Some(String::from_utf8_lossy(chunk).to_string());
                        }
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(_) => closed = true,
                }


                if closed { break; }

                // Collect any new outgoing data
                while let Ok(data) = rx.try_recv() {
                    write_buffer.extend_from_slice(&data);
                }

                // Try writing
                if !write_buffer.is_empty() {
                    match chan.write(&write_buffer) {
                        Ok(0) => closed = true,
                        Ok(n) => {
                            write_buffer.drain(..n);
                            would_block = false;
                        }
                        Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                        Err(_) => closed = true,
                    }
                }
            }

            if closed { break; }
            
            if let Some(d) = data_received {
                let _ = app_clone.emit(&format!("ssh_data_{}", instance_id_clone), d);
            }
            
            if would_block {
                thread::sleep(Duration::from_millis(10));
            }
        }
        let state = app_clone.state::<AppState>();
        state.ssh_sessions.remove(&instance_id_clone);
        state.raw_sessions.remove(&instance_id_clone);
        let _ = app_clone.emit(&format!("ssh_closed_{}", instance_id_clone), ());
    });

    Ok(())
}

#[tauri::command]
async fn send_ssh_data(
    state: State<'_, AppState>,
    instance_id: String,
    data: String,
) -> Result<(), String> {
    if let Some(ssh_session) = state.ssh_sessions.get(&instance_id) {
        ssh_session.tx.send(data.into_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn resize_ssh_session(
    state: State<'_, AppState>,
    instance_id: String,
    rows: u32,
    cols: u32,
) -> Result<(), String> {
    if let Some(ssh_session) = state.ssh_sessions.get(&instance_id) {
        let mut chan = ssh_session.channel.lock();
        chan.request_pty_size(cols, rows, None, None).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn get_default_scripts() -> Vec<Script> {
    vec![
        Script {
            id: "1".to_string(),
            name: "Update System".to_string(),
            command_template: "sudo apt update && sudo apt upgrade -y".to_string(),
            vars: vec![],
        },
        Script {
            id: "2".to_string(),
            name: "Install Package".to_string(),
            command_template: "sudo apt install -y $package_name".to_string(),
            vars: vec![
                ScriptVar {
                    name: "package_name".to_string(),
                    required: true,
                    default_value: "vim".to_string(),
                }
            ],
        },
    ]
}

#[tauri::command]
async fn add_session(
    state: State<'_, AppState>,
    session: SessionInfo,
) -> Result<String, String> {
    let mut session = session;
    if session.id.is_empty() {
        session.id = Uuid::new_v4().to_string();
    }
    if session.group.is_empty() {
        session.group = "默认".to_string();
    }
    state.sessions.insert(session.id.clone(), session.clone());
    state.save_config_to_disk();
    Ok(session.id)
}

#[tauri::command]
async fn batch_add_sessions(
    state: State<'_, AppState>,
    hosts: Vec<String>,
    users: Vec<String>,
    passwords: Vec<String>,
    common_user: Option<String>,
    common_pass: Option<String>,
    key_path: Option<String>,
    jump_host: Option<String>,
    group: Option<String>,
) -> Result<(), String> {
    let group = group.unwrap_or_else(|| "默认".to_string());
    for (i, host) in hosts.iter().enumerate() {
        let user = common_user.clone().unwrap_or_else(|| users.get(i).cloned().unwrap_or_default());
        let pass = common_pass.clone().or_else(|| passwords.get(i).cloned());
        
        let id = Uuid::new_v4().to_string();
        state.sessions.insert(id.clone(), SessionInfo {
            id,
            name: host.clone(),
            host: host.clone(),
            port: 22,
            user,
            password: pass,
            key_path: key_path.clone(),
            jump_host: jump_host.clone(),
            group: group.clone(),
            status: SessionStatus::Idle,
            history: Vec::new(),
        });
    }
    state.save_config_to_disk();
    Ok(())
}

#[tauri::command]
fn authenticate_session(sess: &mut Session, session_info: &SessionInfo) -> Result<(), String> {
    if let Some(ref key_path) = session_info.key_path {
        if !key_path.is_empty() {
            let path = std::path::Path::new(key_path);
            sess.userauth_pubkey_file(&session_info.user, None, path, None)
                .map_err(|e| format!("Key auth failed: {}", e))?;
            return Ok(());
        }
    }
    
    if let Some(ref pass) = session_info.password {
        sess.userauth_password(&session_info.user, pass)
            .map_err(|e| format!("Password auth failed: {}", e))?;
        return Ok(());
    }

    Err("Neither key path nor password provided".to_string())
}

fn set_unselected_to_idle(state: &AppState, window: &tauri::Window, selected_ids: &[String]) {
    for mut entry in state.sessions.iter_mut() {
        if !selected_ids.contains(entry.key()) {
            if entry.status != SessionStatus::Idle {
                entry.status = SessionStatus::Idle;
                let _ = window.emit("session_updated", entry.value().clone());
            }
        }
    }
}

#[tauri::command]
async fn run_command_all(
    app_handle: AppHandle,
    command: String,
    vars: Option<HashMap<String, String>>,
    window: tauri::Window,
    ids: Option<Vec<String>>,
) -> Result<(), String> {
    let state = app_handle.state::<AppState>();
    let session_ids: Vec<String> = if let Some(selected_ids) = ids {
        set_unselected_to_idle(&state, &window, &selected_ids);
        selected_ids
    } else {
        state.sessions.iter().map(|kv| kv.key().clone()).collect()
    };
    
    for id in session_ids {
        let app_clone = app_handle.clone();
        let id_clone = id.clone();
        let cmd_clone = command.clone();
        let vars_clone = vars.clone();
        let window_clone = window.clone();
        
        tokio::spawn(async move {
            let state = app_clone.state::<AppState>();
            let session_info = {
                let session_ref = state.sessions.get(&id_clone);
                match session_ref {
                    Some(s) => s.value().clone(),
                    None => return,
                }
            };

            {
                let mut session_ref = state.sessions.get_mut(&id_clone);
                if let Some(session) = session_ref.as_deref_mut() {
                    session.status = SessionStatus::Running;
                    let _ = window_clone.emit("session_updated", session.clone());
                }
            }
            
            // Actual SSH execution
            let cmd_for_thread = cmd_clone.clone();
            let vars_for_thread = vars_clone.clone();
            
            let result = thread::spawn(move || -> Result<String, String> {
                let tcp = TcpStream::connect(format!("{}:{}", session_info.host, session_info.port))
                    .map_err(|e| e.to_string())?;
                let mut sess = Session::new().map_err(|e| e.to_string())?;
                sess.set_tcp_stream(tcp);
                sess.handshake().map_err(|e| e.to_string())?;

                authenticate_session(&mut sess, &session_info)?;

                let mut channel = sess.channel_session().map_err(|e| e.to_string())?;
                
                // Inject environment variables at the beginning
                let final_command = if let Some(env_vars) = vars_for_thread {
                    if env_vars.is_empty() {
                        cmd_for_thread
                    } else {
                        let mut env_prefix = String::new();
                        for (k, v) in env_vars {
                            let escaped_v = v.replace("'", "'\\''");
                            env_prefix.push_str(&format!("export {}='{}'\n", k, escaped_v));
                        }
                        // Add a blank line after exports
                        format!("{}\n{}", env_prefix, cmd_for_thread)
                    }
                } else {
                    cmd_for_thread
                };

                channel.exec(&final_command).map_err(|e| e.to_string())?;
                
                let mut output = String::new();
                channel.read_to_string(&mut output).map_err(|e| e.to_string())?;
                let _ = channel.wait_close();
                
                let exit_status = channel.exit_status().map_err(|e| e.to_string())?;
                if exit_status == 0 {
                    Ok(output)
                } else {
                    Err(format!("Exit code {}: {}", exit_status, output))
                }
            }).join().unwrap_or(Err("Thread panicked".to_string()));

            {
                let mut session_ref = state.sessions.get_mut(&id_clone);
                if let Some(session) = session_ref.as_deref_mut() {
                    match result {
                        Ok(output) => {
                            session.status = SessionStatus::Success;
                            session.history.push(format!("$ {}\n{}", cmd_clone, output));
                        }
                        Err(err) => {
                            session.status = SessionStatus::Failure;
                            session.history.push(format!("$ {}\nError: {}", cmd_clone, err));
                        }
                    }
                    let _ = window_clone.emit("session_updated", session.clone());
                }
            }
        });
    }
    Ok(())
}

#[tauri::command]
async fn distribute_file(
    app_handle: AppHandle,
    local_path: String,
    remote_dir: String,
    window: tauri::Window,
    ids: Option<Vec<String>>,
) -> Result<(), String> {
    let state = app_handle.state::<AppState>();
    let session_ids: Vec<String> = if let Some(selected_ids) = ids {
        set_unselected_to_idle(&state, &window, &selected_ids);
        selected_ids
    } else {
        state.sessions.iter().map(|kv| kv.key().clone()).collect()
    };
    
    let local_path_buf = std::path::PathBuf::from(&local_path);
    let file_name = local_path_buf.file_name()
        .ok_or_else(|| "Invalid local path".to_string())?
        .to_str()
        .ok_or_else(|| "Invalid file name".to_string())?
        .to_string();
    
    let file_content = std::fs::read(&local_path).map_err(|e| format!("Failed to read local file: {}", e))?;
    let file_size = file_content.len() as u64;

    for id in session_ids {
        let app_clone = app_handle.clone();
        let id_clone = id.clone();
        let remote_dir_thread = remote_dir.clone();
        let remote_dir_history = remote_dir.clone();
        let file_name_clone = file_name.clone();
        let file_content_clone = file_content.clone();
        let window_clone = window.clone();
        
        tokio::spawn(async move {
            let state = app_clone.state::<AppState>();
            let session_info = {
                let session_ref = state.sessions.get(&id_clone);
                match session_ref {
                    Some(s) => s.value().clone(),
                    None => return,
                }
            };

            {
                let mut session_ref = state.sessions.get_mut(&id_clone);
                if let Some(session) = session_ref.as_deref_mut() {
                    session.status = SessionStatus::Running;
                    let _ = window_clone.emit("session_updated", session.clone());
                }
            }
            
            let result = thread::spawn(move || -> Result<String, String> {
                let tcp = TcpStream::connect(format!("{}:{}", session_info.host, session_info.port))
                    .map_err(|e| e.to_string())?;
                let mut sess = Session::new().map_err(|e| e.to_string())?;
                sess.set_tcp_stream(tcp);
                sess.handshake().map_err(|e| e.to_string())?;

                authenticate_session(&mut sess, &session_info)?;

                let mut remote_path = remote_dir_thread;
                if !remote_path.ends_with('/') && !remote_path.is_empty() {
                    remote_path.push('/');
                }
                remote_path.push_str(&file_name_clone);

                let mut remote_file = sess.scp_send(std::path::Path::new(&remote_path), 0o644, file_size, None)
                    .map_err(|e| e.to_string())?;
                remote_file.write_all(&file_content_clone).map_err(|e| e.to_string())?;
                
                Ok(format!("Successfully uploaded to {}", remote_path))
            }).join().unwrap_or(Err("Thread panicked".to_string()));

            {
                let mut session_ref = state.sessions.get_mut(&id_clone);
                if let Some(session) = session_ref.as_deref_mut() {
                    match result {
                        Ok(msg) => {
                            session.status = SessionStatus::Success;
                            session.history.push(format!("[File] {}", msg));
                        }
                        Err(err) => {
                            session.status = SessionStatus::Failure;
                            session.history.push(format!("[File] Error distributing to {}: {}", remote_dir_history, err));
                        }
                    }
                    let _ = window_clone.emit("session_updated", session.clone());
                }
            }
        });
    }
    Ok(())
}

#[tauri::command]
async fn distribute_file_data(
    app_handle: AppHandle,
    file_name: String,
    file_content: Vec<u8>,
    remote_dir: String,
    window: tauri::Window,
    ids: Option<Vec<String>>,
) -> Result<(), String> {
    let state = app_handle.state::<AppState>();
    let session_ids: Vec<String> = if let Some(selected_ids) = ids {
        set_unselected_to_idle(&state, &window, &selected_ids);
        selected_ids
    } else {
        state.sessions.iter().map(|kv| kv.key().clone()).collect()
    };
    
    let file_size = file_content.len() as u64;

    for id in session_ids {
        let app_clone = app_handle.clone();
        let id_clone = id.clone();
        let remote_dir_thread = remote_dir.clone();
        let remote_dir_history = remote_dir.clone();
        let file_name_clone = file_name.clone();
        let file_content_clone = file_content.clone();
        let window_clone = window.clone();
        
        tokio::spawn(async move {
            let state = app_clone.state::<AppState>();
            let session_info = {
                let session_ref = state.sessions.get(&id_clone);
                match session_ref {
                    Some(s) => s.value().clone(),
                    None => return,
                }
            };

            {
                let mut session_ref = state.sessions.get_mut(&id_clone);
                if let Some(session) = session_ref.as_deref_mut() {
                    session.status = SessionStatus::Running;
                    let _ = window_clone.emit("session_updated", session.clone());
                }
            }
            
            let result = thread::spawn(move || -> Result<String, String> {
                let tcp = TcpStream::connect(format!("{}:{}", session_info.host, session_info.port))
                    .map_err(|e| e.to_string())?;
                let mut sess = Session::new().map_err(|e| e.to_string())?;
                sess.set_tcp_stream(tcp);
                sess.handshake().map_err(|e| e.to_string())?;

                authenticate_session(&mut sess, &session_info)?;

                let mut remote_path = remote_dir_thread;
                if !remote_path.ends_with('/') && !remote_path.is_empty() {
                    remote_path.push('/');
                }
                remote_path.push_str(&file_name_clone);

                let mut remote_file = sess.scp_send(std::path::Path::new(&remote_path), 0o644, file_size, None)
                    .map_err(|e| e.to_string())?;
                remote_file.write_all(&file_content_clone).map_err(|e| e.to_string())?;
                
                Ok(format!("Successfully uploaded to {}", remote_path))
            }).join().unwrap_or(Err("Thread panicked".to_string()));

            {
                let mut session_ref = state.sessions.get_mut(&id_clone);
                if let Some(session) = session_ref.as_deref_mut() {
                    match result {
                        Ok(msg) => {
                            session.status = SessionStatus::Success;
                            session.history.push(format!("[File] {}", msg));
                        }
                        Err(err) => {
                            session.status = SessionStatus::Failure;
                            session.history.push(format!("[File] Error distributing to {}: {}", remote_dir_history, err));
                        }
                    }
                    let _ = window_clone.emit("session_updated", session.clone());
                }
            }
        });
    }
    Ok(())
}

#[tauri::command]
fn get_sessions(state: State<'_, AppState>) -> Vec<SessionInfo> {
    state.sessions.iter().map(|kv| kv.value().clone()).collect()
}

#[tauri::command]
fn get_scripts(state: State<'_, AppState>) -> Vec<Script> {
    let mut scripts: Vec<Script> = state.scripts.iter().map(|kv| kv.value().clone()).collect();
    scripts.sort_by(|a, b| a.name.cmp(&b.name));
    scripts
}

#[tauri::command]
fn add_script(state: State<'_, AppState>, script: Script) -> Result<String, String> {
    let mut script = script;
    if script.id.is_empty() {
        script.id = Uuid::new_v4().to_string();
    }
    state.scripts.insert(script.id.clone(), script.clone());
    state.save_config_to_disk();
    Ok(script.id)
}

#[tauri::command]
fn delete_script(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.scripts.remove(&id);
    state.save_config_to_disk();
    Ok(())
}

#[tauri::command]
fn delete_session(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.sessions.remove(&id);
    state.save_config_to_disk();
    Ok(())
}

#[tauri::command]
async fn sftp_list(
    state: State<'_, AppState>,
    instance_id: String,
    path: String,
) -> Result<Vec<SftpFile>, String> {
    let session_arc = state.raw_sessions.get(&instance_id)
        .ok_or_else(|| "Session not found".to_string())?
        .clone();
    
    let sess = session_arc.lock();
    // Use non-blocking SFTP
    let sftp = loop {
        match sess.sftp() {
            Ok(s) => break s,
            Err(e) => {
                let io_err: std::io::Error = e.into();
                if io_err.kind() == std::io::ErrorKind::WouldBlock {
                    thread::sleep(Duration::from_millis(10));
                } else {
                    return Err(io_err.to_string());
                }
            }
        }
    };

    let entries = loop {
        match sftp.readdir(std::path::Path::new(&path)) {
            Ok(e) => break e,
            Err(e) => {
                let io_err: std::io::Error = e.into();
                if io_err.kind() == std::io::ErrorKind::WouldBlock {
                    thread::sleep(Duration::from_millis(10));
                } else {
                    return Err(io_err.to_string());
                }
            }
        }
    };
    
    let mut files = Vec::new();
    for (path_buf, stat) in entries {
        let name = path_buf.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        if name == "." || name == ".." {
            continue;
        }
        files.push(SftpFile {
            name,
            size: stat.size.unwrap_or(0),
            is_dir: stat.is_dir(),
            is_file: stat.is_file(),
            permissions: stat.perm,
            modified: stat.mtime,
        });
    }
    Ok(files)
}

#[tauri::command]
async fn sftp_mkdir(
    state: State<'_, AppState>,
    instance_id: String,
    path: String,
) -> Result<(), String> {
    let session_arc = state.raw_sessions.get(&instance_id)
        .ok_or_else(|| "Session not found".to_string())?
        .clone();
    let sess = session_arc.lock();
    let sftp = loop {
        match sess.sftp() {
            Ok(s) => break s,
            Err(e) => {
                let io_err: std::io::Error = e.into();
                if io_err.kind() == std::io::ErrorKind::WouldBlock {
                    thread::sleep(Duration::from_millis(10));
                } else {
                    return Err(io_err.to_string());
                }
            }
        }
    };
    loop {
        match sftp.mkdir(std::path::Path::new(&path), 0o755) {
            Ok(_) => break,
            Err(e) => {
                let io_err: std::io::Error = e.into();
                if io_err.kind() == std::io::ErrorKind::WouldBlock {
                    thread::sleep(Duration::from_millis(10));
                } else {
                    return Err(io_err.to_string());
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn sftp_rename(
    state: State<'_, AppState>,
    instance_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let session_arc = state.raw_sessions.get(&instance_id)
        .ok_or_else(|| "Session not found".to_string())?
        .clone();
    let sess = session_arc.lock();
    let sftp = loop {
        match sess.sftp() {
            Ok(s) => break s,
            Err(e) => {
                let io_err: std::io::Error = e.into();
                if io_err.kind() == std::io::ErrorKind::WouldBlock {
                    thread::sleep(Duration::from_millis(10));
                } else {
                    return Err(io_err.to_string());
                }
            }
        }
    };
    loop {
        match sftp.rename(std::path::Path::new(&old_path), std::path::Path::new(&new_path), None) {
            Ok(_) => break,
            Err(e) => {
                let io_err: std::io::Error = e.into();
                if io_err.kind() == std::io::ErrorKind::WouldBlock {
                    thread::sleep(Duration::from_millis(10));
                } else {
                    return Err(io_err.to_string());
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn sftp_remove_file(
    state: State<'_, AppState>,
    instance_id: String,
    path: String,
) -> Result<(), String> {
    let session_arc = state.raw_sessions.get(&instance_id)
        .ok_or_else(|| "Session not found".to_string())?
        .clone();
    let sess = session_arc.lock();
    let sftp = loop {
        match sess.sftp() {
            Ok(s) => break s,
            Err(e) => {
                let io_err: std::io::Error = e.into();
                if io_err.kind() == std::io::ErrorKind::WouldBlock {
                    thread::sleep(Duration::from_millis(10));
                } else {
                    return Err(io_err.to_string());
                }
            }
        }
    };
    loop {
        match sftp.unlink(std::path::Path::new(&path)) {
            Ok(_) => break,
            Err(e) => {
                let io_err: std::io::Error = e.into();
                if io_err.kind() == std::io::ErrorKind::WouldBlock {
                    thread::sleep(Duration::from_millis(10));
                } else {
                    return Err(io_err.to_string());
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn sftp_remove_dir(
    state: State<'_, AppState>,
    instance_id: String,
    path: String,
) -> Result<(), String> {
    let session_arc = state.raw_sessions.get(&instance_id)
        .ok_or_else(|| "Session not found".to_string())?
        .clone();
    let sess = session_arc.lock();
    let sftp = loop {
        match sess.sftp() {
            Ok(s) => break s,
            Err(e) => {
                let io_err: std::io::Error = e.into();
                if io_err.kind() == std::io::ErrorKind::WouldBlock {
                    thread::sleep(Duration::from_millis(10));
                } else {
                    return Err(io_err.to_string());
                }
            }
        }
    };
    loop {
        match sftp.rmdir(std::path::Path::new(&path)) {
            Ok(_) => break,
            Err(e) => {
                let io_err: std::io::Error = e.into();
                if io_err.kind() == std::io::ErrorKind::WouldBlock {
                    thread::sleep(Duration::from_millis(10));
                } else {
                    return Err(io_err.to_string());
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn sftp_upload(
    state: State<'_, AppState>,
    instance_id: String,
    remote_path: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let session_arc = state.raw_sessions.get(&instance_id)
        .ok_or_else(|| "Session not found".to_string())?
        .clone();
    let sess = session_arc.lock();
    let sftp = loop {
        match sess.sftp() {
            Ok(s) => break s,
            Err(e) => {
                let io_err: std::io::Error = e.into();
                if io_err.kind() == std::io::ErrorKind::WouldBlock {
                    thread::sleep(Duration::from_millis(10));
                } else {
                    return Err(io_err.to_string());
                }
            }
        }
    };
    let mut file = loop {
        match sftp.create(std::path::Path::new(&remote_path)) {
            Ok(f) => break f,
            Err(e) => {
                let io_err: std::io::Error = e.into();
                if io_err.kind() == std::io::ErrorKind::WouldBlock {
                    thread::sleep(Duration::from_millis(10));
                } else {
                    return Err(io_err.to_string());
                }
            }
        }
    };
    loop {
        match file.write_all(&data) {
            Ok(_) => break,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(10));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

#[tauri::command]
async fn sftp_download(
    state: State<'_, AppState>,
    instance_id: String,
    remote_path: String,
) -> Result<Vec<u8>, String> {
    let session_arc = state.raw_sessions.get(&instance_id)
        .ok_or_else(|| "Session not found".to_string())?
        .clone();
    let sess = session_arc.lock();
    let sftp = loop {
        match sess.sftp() {
            Ok(s) => break s,
            Err(e) => {
                let io_err: std::io::Error = e.into();
                if io_err.kind() == std::io::ErrorKind::WouldBlock {
                    thread::sleep(Duration::from_millis(10));
                } else {
                    return Err(io_err.to_string());
                }
            }
        }
    };
    let mut file = loop {
        match sftp.open(std::path::Path::new(&remote_path)) {
            Ok(f) => break f,
            Err(e) => {
                let io_err: std::io::Error = e.into();
                if io_err.kind() == std::io::ErrorKind::WouldBlock {
                    thread::sleep(Duration::from_millis(10));
                } else {
                    return Err(io_err.to_string());
                }
            }
        }
    };
    let mut data = Vec::new();
    loop {
        match file.read_to_end(&mut data) {
            Ok(_) => break,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(10));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(data)
}

#[tauri::command]
async fn sftp_upload_file(
    state: State<'_, AppState>,
    instance_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let data = fs::read(&local_path).map_err(|e| format!("Failed to read local file: {}", e))?;
    sftp_upload(state, instance_id, remote_path, data).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // ... (keep existing setup)
            let config_dir = app.path().config_dir().expect("Failed to get config directory");
            let new_app_dir = config_dir.join("remoter");
            let new_config_path = new_app_dir.join("config.json");

            let home_dir = app.path().home_dir().expect("Failed to get home directory");
            let old_home_dir = home_dir.join(".remoter");
            let old_home_config = old_home_dir.join("config.json");

            let old_app_data_dir = app.path().app_data_dir().expect("Failed to get app data directory");
            let old_app_data_config = old_app_data_dir.join("config.json");

            if !new_config_path.exists() {
                let _ = fs::create_dir_all(&new_app_dir);
                if old_app_data_config.exists() {
                    let _ = fs::copy(&old_app_data_config, &new_config_path);
                } else if old_home_config.exists() {
                    let _ = fs::copy(&old_home_config, &new_config_path);
                }
            }

            let sessions = DashMap::new();
            let scripts = DashMap::new();
            let mut settings = AppSettings::default();

            if new_config_path.exists() {
                if let Ok(content) = fs::read_to_string(&new_config_path) {
                    if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
                        for mut s in config.sessions {
                            if s.group.is_empty() {
                                s.group = "默认".to_string();
                            }
                            sessions.insert(s.id.clone(), s);
                        }
                        for s in config.scripts {
                            scripts.insert(s.id.clone(), s);
                        }
                        settings = config.settings;
                    }
                }
            }
            
            if scripts.is_empty() {
                for s in get_default_scripts() {
                    scripts.insert(s.id.clone(), s);
                }
            }

            app.manage(AppState {
                sessions,
                scripts,
                settings: Mutex::new(settings),
                config_path: new_config_path,
                ssh_sessions: DashMap::new(),
                raw_sessions: DashMap::new(),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            manual_save_to_disk,
            add_session,
            batch_add_sessions,
            run_command_all, 
            distribute_file,
            distribute_file_data,
            get_sessions,
            get_scripts,
            add_script,
            delete_script,
            delete_session,
            start_ssh_session,
            stop_ssh_session,
            send_ssh_data,
            resize_ssh_session,
            update_session_group,
            sftp_list,
            sftp_mkdir,
            sftp_rename,
            sftp_remove_file,
            sftp_remove_dir,
            sftp_upload,
            sftp_upload_file,
            sftp_download
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
