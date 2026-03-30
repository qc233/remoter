use tauri::{State, Emitter, Manager, AppHandle};
use std::sync::Arc;
use parking_lot::Mutex;
use std::path::PathBuf;
use std::net::TcpStream;
use ssh2::Session;
use std::io::prelude::*;
use std::thread;
use std::collections::HashMap;
use std::sync::mpsc;
use std::time::Duration;

use crate::models::*;
use crate::state::AppState;

pub fn resolve_path(key_path: &str, app_handle: &AppHandle) -> PathBuf {
    if key_path.starts_with('~') {
        if let Ok(home) = app_handle.path().home_dir() {
            let mut path = home;
            if key_path.starts_with("~/") || key_path.starts_with("~\\") {
                path.push(&key_path[2..]);
                return path;
            } else if key_path == "~" {
                return path;
            } else {
                path.push(&key_path[1..]);
                return path;
            }
        }
    }
    PathBuf::from(key_path)
}

pub fn authenticate_session(app_handle: &AppHandle, sess: &mut Session, session_info: &SessionInfo) -> Result<(), String> {
    if let Some(ref key_path) = session_info.key_path {
        if !key_path.is_empty() {
            let resolved_path = resolve_path(key_path, app_handle);
            
            if !resolved_path.exists() {
                return Err(format!("Private key file not found: {:?}", resolved_path));
            }

            if let Some(ext) = resolved_path.extension() {
                if ext == "ppk" {
                    return Err("PuTTY .ppk keys are not supported. Please convert it to OpenSSH format (PEM or new OpenSSH) using PuTTYGen (Export -> Export OpenSSH key).".to_string());
                }
            }

            let passphrase = session_info.password.as_deref();
            
            if let Err(e) = sess.userauth_pubkey_file(&session_info.user, None, &resolved_path, passphrase) {
                let pub_key_path = PathBuf::from(format!("{}.pub", resolved_path.to_string_lossy()));
                
                if pub_key_path.exists() {
                    sess.userauth_pubkey_file(&session_info.user, Some(&pub_key_path), &resolved_path, passphrase)
                        .map_err(|e2| format!("Key authentication failed: {} (Tried with .pub file: {})", e, e2))?;
                } else {
                    return Err(format!("Key authentication failed: {}. (Note: No .pub file found at {:?})", e, pub_key_path));
                }
            }
            return Ok(());
        }
    }
    
    if let Some(ref pass) = session_info.password {
        sess.userauth_password(&session_info.user, pass)
            .map_err(|e| format!("Password authentication failed: {}", e))?;
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
pub async fn stop_ssh_session(
    state: State<'_, AppState>,
    instance_id: String,
) -> Result<(), String> {
    state.ssh_sessions.remove(&instance_id);
    state.raw_sessions.remove(&instance_id);
    Ok(())
}

#[tauri::command]
pub async fn start_ssh_session(
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

    authenticate_session(&app_handle, &mut sess, &session_info)?;

    let mut channel = sess.channel_session().map_err(|e| e.to_string())?;
    channel.request_pty("xterm-256color", None, Some((cols, rows, 0, 0))).map_err(|e| e.to_string())?;
    channel.shell().map_err(|e| e.to_string())?;

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

    let app_clone = app_handle.clone();
    let instance_id_clone = instance_id.clone();
    let channel_for_read = channel.clone();
    
    thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        let mut write_buffer = Vec::new();
        
        let mut boot_buffer = Vec::new();
        let mut boot_phase = 0;
        let mut injection_sent = false;
        let mut motd_limit = 0;
        let boot_start = std::time::Instant::now();
        let sentinel = "__REMOTER_SYNC_DONE__"; 

        loop {
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

                if boot_phase < 2 && boot_start.elapsed() > Duration::from_secs(3) {
                    if !boot_buffer.is_empty() {
                        let _ = app_clone.emit(&format!("ssh_data_{}", instance_id_clone), String::from_utf8_lossy(&boot_buffer).to_string());
                        boot_buffer.clear();
                    }
                    boot_phase = 2;
                }

                match chan.read(&mut buffer) {
                    Ok(0) => closed = true,
                    Ok(n) => {
                        let chunk = &buffer[..n];
                        would_block = false;

                        if boot_phase < 2 {
                            boot_buffer.extend_from_slice(chunk);

                            if boot_phase == 0 {
                                motd_limit = boot_buffer.len();
                                let injection = " stty -echo; _remoter_osc7(){ printf \"\\033]7;file://%s%s\\033\\\\\" \"${HOSTNAME:-$HOST}\" \"$PWD\"; }; [ -n \"$BASH_VERSION\" ] && PROMPT_COMMAND=_remoter_osc7; [ -n \"$ZSH_VERSION\" ] && precmd_functions+=(_remoter_osc7); stty echo; echo __\"\"REMOTER_SYNC_DONE__\n";
                                let _ = chan.write_all(injection.as_bytes());
                                injection_sent = true;
                                boot_phase = 1;
                            }

                            let scan_str = String::from_utf8_lossy(&boot_buffer);
                            if let Some(pos) = scan_str.find(sentinel) {
                                let byte_pos_sentinel = scan_str[..pos].as_bytes().len();

                                let motd_end = boot_buffer[..motd_limit].iter().rposition(|&b| b == b'\n').map(|p| p + 1).unwrap_or(0);
                                let pure_motd = &boot_buffer[..motd_end];

                                if !pure_motd.is_empty() {
                                    let _ = app_clone.emit(&format!("ssh_data_{}", instance_id_clone), String::from_utf8_lossy(pure_motd).to_string());
                                }

                                let byte_pos_after = byte_pos_sentinel + sentinel.len();
                                let rest = &boot_buffer[byte_pos_after..];

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
                            data_received = Some(String::from_utf8_lossy(chunk).to_string());
                        }
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(_) => closed = true,
                }


                if closed { break; }

                while let Ok(data) = rx.try_recv() {
                    write_buffer.extend_from_slice(&data);
                }

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
pub async fn send_ssh_data(
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
pub async fn resize_ssh_session(
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

#[tauri::command]
pub async fn run_command_all(
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
            
            let cmd_for_thread = cmd_clone.clone();
            let vars_for_thread = vars_clone.clone();
            
            let app_clone_thread = app_clone.clone();
            let result = thread::spawn(move || -> Result<String, String> {
                let tcp = TcpStream::connect(format!("{}:{}", session_info.host, session_info.port))
                    .map_err(|e| e.to_string())?;
                let mut sess = Session::new().map_err(|e| e.to_string())?;
                sess.set_tcp_stream(tcp);
                sess.handshake().map_err(|e| e.to_string())?;

                authenticate_session(&app_clone_thread, &mut sess, &session_info)?;

                let mut channel = sess.channel_session().map_err(|e| e.to_string())?;
                
                let final_command = if let Some(env_vars) = vars_for_thread {
                    if env_vars.is_empty() {
                        cmd_for_thread
                    } else {
                        let mut env_prefix = String::new();
                        for (k, v) in env_vars {
                            let escaped_v = v.replace("'", "'\\''");
                            env_prefix.push_str(&format!("export {}='{}'\n", k, escaped_v));
                        }
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
pub async fn distribute_file(
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
            
            let app_clone_thread = app_clone.clone();
            let result = thread::spawn(move || -> Result<String, String> {
                let tcp = TcpStream::connect(format!("{}:{}", session_info.host, session_info.port))
                    .map_err(|e| e.to_string())?;
                let mut sess = Session::new().map_err(|e| e.to_string())?;
                sess.set_tcp_stream(tcp);
                sess.handshake().map_err(|e| e.to_string())?;

                authenticate_session(&app_clone_thread, &mut sess, &session_info)?;

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
pub async fn distribute_file_data(
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
            
            let app_clone_thread = app_clone.clone();
            let result = thread::spawn(move || -> Result<String, String> {
                let tcp = TcpStream::connect(format!("{}:{}", session_info.host, session_info.port))
                    .map_err(|e| e.to_string())?;
                let mut sess = Session::new().map_err(|e| e.to_string())?;
                sess.set_tcp_stream(tcp);
                sess.handshake().map_err(|e| e.to_string())?;

                authenticate_session(&app_clone_thread, &mut sess, &session_info)?;

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
pub async fn start_port_proxy(
    app_handle: AppHandle,
    session_id: String,
    local_port: u16,
    remote_port: u16,
) -> Result<String, String> {
    let state = app_handle.state::<AppState>();
    
    let session_info = state.sessions.get(&session_id)
        .ok_or_else(|| "Session config not found".to_string())?
        .clone();

    let proxy_id = format!("{}-{}-{}", session_id, local_port, remote_port);
    if state.port_proxies.contains_key(&proxy_id) {
        return Err("Proxy already running".to_string());
    }

    let (tx, rx) = std::sync::mpsc::channel();
    state.port_proxies.insert(proxy_id.clone(), tx);

    let proxy_id_clone = proxy_id.clone();
    let app_handle_thread = app_handle.clone();
    
    thread::spawn(move || {
        let listener = match std::net::TcpListener::bind(format!("127.0.0.1:{}", local_port)) {
            Ok(l) => l,
            Err(_) => {
                let state = app_handle_thread.state::<AppState>();
                state.port_proxies.remove(&proxy_id_clone);
                return;
            }
        };

        listener.set_nonblocking(true).unwrap();

        loop {
            if let Ok(_) = rx.try_recv() {
                break;
            }

            match listener.accept() {
                Ok((mut local_stream, _)) => {
                    let sess_info = session_info.clone();
                    let app_handle_clone = app_handle_thread.clone();
                    thread::spawn(move || {
                        let tcp = match TcpStream::connect(format!("{}:{}", sess_info.host, sess_info.port)) {
                            Ok(t) => t,
                            Err(_) => return,
                        };
                        let mut sess = match Session::new() {
                            Ok(s) => s,
                            Err(_) => return,
                        };
                        sess.set_tcp_stream(tcp);
                        if sess.handshake().is_err() { return; }

                        if authenticate_session(&app_handle_clone, &mut sess, &sess_info).is_err() {
                            return;
                        }

                        let mut channel = match sess.channel_direct_tcpip("127.0.0.1", remote_port, None) {
                            Ok(c) => c,
                            Err(_) => return,
                        };

                        sess.set_blocking(false);
                        local_stream.set_nonblocking(true).unwrap();

                        let mut buf1 = [0u8; 8192];
                        let mut buf2 = [0u8; 8192];

                        loop {
                            let mut read_something = false;

                            match local_stream.read(&mut buf1) {
                                Ok(0) => break,
                                Ok(n) => {
                                    let mut written = 0;
                                    while written < n {
                                        match channel.write(&buf1[written..n]) {
                                            Ok(w) => written += w,
                                            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                                thread::sleep(Duration::from_millis(10));
                                            }
                                            Err(_) => { read_something=false; break; }
                                        }
                                    }
                                    read_something = true;
                                }
                                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {},
                                Err(_) => break,
                            }

                            match channel.read(&mut buf2) {
                                Ok(0) => break,
                                Ok(n) => {
                                    let mut written = 0;
                                    while written < n {
                                        match local_stream.write(&buf2[written..n]) {
                                            Ok(w) => written += w,
                                            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                                thread::sleep(Duration::from_millis(10));
                                            }
                                            Err(_) => { read_something=false; break; }
                                        }
                                    }
                                    read_something = true;
                                }
                                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {},
                                Err(_) => break,
                            }

                            if !read_something {
                                thread::sleep(Duration::from_millis(10));
                            }
                        }
                    });
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(100));
                }
                Err(_) => break,
            }
        }
        
        let state = app_handle_thread.state::<AppState>();
        state.port_proxies.remove(&proxy_id_clone);
    });

    Ok(proxy_id)
}

#[tauri::command]
pub async fn stop_port_proxy(
    app_handle: AppHandle,
    proxy_id: String,
) -> Result<(), String> {
    let state = app_handle.state::<AppState>();
    if let Some(proxy) = state.port_proxies.get(&proxy_id) {
        let _ = proxy.value().send(());
    }
    state.port_proxies.remove(&proxy_id);
    Ok(())
}
