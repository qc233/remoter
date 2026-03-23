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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub sessions: Vec<SessionInfo>,
    pub scripts: Vec<Script>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScriptParam {
    pub name: String,
    pub label: String,
    pub default_value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Script {
    pub id: String,
    pub name: String,
    pub command_template: String,
    pub params: Vec<ScriptParam>,
}

pub struct SshSession {
    pub channel: Arc<Mutex<ssh2::Channel>>,
    pub tx: mpsc::Sender<Vec<u8>>,
}

pub struct AppState {
    pub sessions: DashMap<String, SessionInfo>,
    pub config_path: PathBuf,
    pub ssh_sessions: DashMap<String, Arc<SshSession>>,
}

impl AppState {
    fn save_to_disk(&self) {
        let config = AppConfig {
            sessions: self.sessions.iter().map(|kv| kv.value().clone()).collect(),
            scripts: get_default_scripts(),
        };
        let json = serde_json::to_string_pretty(&config).expect("Failed to serialize config");
        let _ = fs::write(&self.config_path, json);
    }
}

#[tauri::command]
async fn update_session_group(
    state: State<'_, AppState>,
    id: String,
    group: String,
) -> Result<(), String> {
    if let Some(mut session) = state.sessions.get_mut(&id) {
        session.group = group;
        state.save_to_disk();
        Ok(())
    } else {
        Err("Session not found".to_string())
    }
}

#[tauri::command]
async fn start_ssh_session(
    app_handle: AppHandle,
    session_id: String,
    rows: u32,
    cols: u32,
) -> Result<(), String> {
    let state = app_handle.state::<AppState>();
    
    if state.ssh_sessions.contains_key(&session_id) {
        return Ok(());
    }

    let session_info = state.sessions.get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?
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

    let channel = Arc::new(Mutex::new(channel));
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    
    let ssh_session = Arc::new(SshSession {
        channel: channel.clone(),
        tx,
    });

    state.ssh_sessions.insert(session_id.clone(), ssh_session);

    // Read/Write loop
    let app_clone = app_handle.clone();
    let session_id_clone = session_id.clone();
    
    thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        let mut write_buffer = Vec::new();
        
        loop {
            let mut data_received = None;
            let mut closed = false;
            let mut would_block = true;

            {
                let mut chan = channel.lock();
                
                // Try reading
                match chan.read(&mut buffer) {
                    Ok(0) => closed = true,
                    Ok(n) => {
                        data_received = Some(String::from_utf8_lossy(&buffer[..n]).to_string());
                        would_block = false;
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(_) => closed = true,
                }

                if closed { break; }

                // Collect any new outgoing data
                while let Ok(data) = rx.try_recv() {
                    write_buffer.extend_from_slice(&data);
                }

                // Try writing if there's anything in the buffer
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
                let _ = app_clone.emit(&format!("ssh_data_{}", session_id_clone), d);
            }
            
            if would_block {
                thread::sleep(Duration::from_millis(10));
            }
        }
        let state = app_clone.state::<AppState>();
        state.ssh_sessions.remove(&session_id_clone);
        let _ = app_clone.emit(&format!("ssh_closed_{}", session_id_clone), ());
    });

    Ok(())
}

#[tauri::command]
async fn send_ssh_data(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    if let Some(ssh_session) = state.ssh_sessions.get(&session_id) {
        ssh_session.tx.send(data.into_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn resize_ssh_session(
    state: State<'_, AppState>,
    session_id: String,
    rows: u32,
    cols: u32,
) -> Result<(), String> {
    if let Some(ssh_session) = state.ssh_sessions.get(&session_id) {
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
            params: vec![],
        },
        Script {
            id: "2".to_string(),
            name: "Install Package".to_string(),
            command_template: "sudo apt install -y {{package_name}}".to_string(),
            params: vec![
                ScriptParam {
                    name: "package_name".to_string(),
                    label: "Package Name".to_string(),
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
    state.save_to_disk();
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
    state.save_to_disk();
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

#[tauri::command]
async fn run_command_all(
    app_handle: AppHandle,
    command: String,
    window: tauri::Window,
    ids: Option<Vec<String>>,
) -> Result<(), String> {
    let state = app_handle.state::<AppState>();
    let session_ids: Vec<String> = if let Some(ids) = ids {
        ids
    } else {
        state.sessions.iter().map(|kv| kv.key().clone()).collect()
    };
    
    for id in session_ids {
        let app_clone = app_handle.clone();
        let id_clone = id.clone();
        let cmd_clone = command.clone();
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
            let cmd_for_exec = cmd_clone.clone();
            let result = thread::spawn(move || -> Result<String, String> {
                let tcp = TcpStream::connect(format!("{}:{}", session_info.host, session_info.port))
                    .map_err(|e| e.to_string())?;
                let mut sess = Session::new().map_err(|e| e.to_string())?;
                sess.set_tcp_stream(tcp);
                sess.handshake().map_err(|e| e.to_string())?;

                authenticate_session(&mut sess, &session_info)?;

                let mut channel = sess.channel_session().map_err(|e| e.to_string())?;
                channel.exec(&cmd_for_exec).map_err(|e| e.to_string())?;
                
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
    let session_ids: Vec<String> = if let Some(ids) = ids {
        ids
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
    let session_ids: Vec<String> = if let Some(ids) = ids {
        ids
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
fn get_scripts() -> Vec<Script> {
    get_default_scripts()
}

#[tauri::command]
fn delete_session(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.sessions.remove(&id);
    state.save_to_disk();
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_dir = app.path().app_data_dir().unwrap();
            if !app_dir.exists() {
                let _ = fs::create_dir_all(&app_dir);
            }
            let config_path = app_dir.join("config.json");
            let sessions = DashMap::new();
            
            if config_path.exists() {
                if let Ok(content) = fs::read_to_string(&config_path) {
                    if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
                        for mut s in config.sessions {
                            if s.group.is_empty() {
                                s.group = "默认".to_string();
                            }
                            sessions.insert(s.id.clone(), s);
                        }
                    }
                }
            }

            app.manage(AppState {
                sessions,
                config_path,
                ssh_sessions: DashMap::new(),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            add_session,
            batch_add_sessions,
            run_command_all, 
            distribute_file,
            distribute_file_data,
            get_sessions,
            get_scripts,
            delete_session,
            start_ssh_session,
            send_ssh_data,
            resize_ssh_session,
            update_session_group
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

