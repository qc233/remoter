use tauri::State;
use std::thread;
use std::io::prelude::*;
use std::time::Duration;
use std::fs;

use crate::models::*;
use crate::state::AppState;

/// Helper macro to get an SFTP handle with WouldBlock retry logic.
macro_rules! with_sftp {
    ($state:expr, $instance_id:expr) => {{
        let session_arc = $state.raw_sessions.get($instance_id)
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
        sftp
    }};
}

/// Helper macro to retry an SFTP operation that may return WouldBlock.
macro_rules! retry_would_block {
    ($expr:expr) => {
        loop {
            match $expr {
                Ok(val) => break val,
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
    };
}

#[tauri::command]
pub async fn sftp_list(
    state: State<'_, AppState>,
    instance_id: String,
    path: String,
) -> Result<Vec<SftpFile>, String> {
    let sftp = with_sftp!(&state, &instance_id);
    let entries = retry_would_block!(sftp.readdir(std::path::Path::new(&path)));
    
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
pub async fn sftp_mkdir(
    state: State<'_, AppState>,
    instance_id: String,
    path: String,
) -> Result<(), String> {
    let sftp = with_sftp!(&state, &instance_id);
    retry_would_block!(sftp.mkdir(std::path::Path::new(&path), 0o755));
    Ok(())
}

#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    instance_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let sftp = with_sftp!(&state, &instance_id);
    retry_would_block!(sftp.rename(std::path::Path::new(&old_path), std::path::Path::new(&new_path), None));
    Ok(())
}

#[tauri::command]
pub async fn sftp_remove_file(
    state: State<'_, AppState>,
    instance_id: String,
    path: String,
) -> Result<(), String> {
    let sftp = with_sftp!(&state, &instance_id);
    retry_would_block!(sftp.unlink(std::path::Path::new(&path)));
    Ok(())
}

#[tauri::command]
pub async fn sftp_remove_dir(
    state: State<'_, AppState>,
    instance_id: String,
    path: String,
) -> Result<(), String> {
    let sftp = with_sftp!(&state, &instance_id);
    retry_would_block!(sftp.rmdir(std::path::Path::new(&path)));
    Ok(())
}

#[tauri::command]
pub async fn sftp_upload(
    state: State<'_, AppState>,
    instance_id: String,
    remote_path: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let sftp = with_sftp!(&state, &instance_id);
    let mut file = retry_would_block!(sftp.create(std::path::Path::new(&remote_path)));
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
pub async fn sftp_download(
    state: State<'_, AppState>,
    instance_id: String,
    remote_path: String,
) -> Result<Vec<u8>, String> {
    let sftp = with_sftp!(&state, &instance_id);
    let mut file = retry_would_block!(sftp.open(std::path::Path::new(&remote_path)));
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
pub async fn sftp_upload_file(
    state: State<'_, AppState>,
    instance_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let data = fs::read(&local_path).map_err(|e| format!("Failed to read local file: {}", e))?;
    sftp_upload(state, instance_id, remote_path, data).await
}

#[tauri::command]
pub async fn sftp_edit_file(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    instance_id: String,
    remote_path: String,
) -> Result<(), String> {
    let sftp = with_sftp!(&state, &instance_id);
    let mut file = retry_would_block!(sftp.open(std::path::Path::new(&remote_path)));
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
    
    let uuid = uuid::Uuid::new_v4();
    let file_name = std::path::Path::new(&remote_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("temp_file");
        
    let temp_dir = std::env::temp_dir().join(format!("remoter_sftp_{}", uuid));
    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    
    let local_path = temp_dir.join(file_name);
    fs::write(&local_path, &data).map_err(|e| e.to_string())?;
    
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(local_path.to_string_lossy().to_string(), None::<&str>).map_err(|e| e.to_string())?;
    
    let local_path_clone = local_path.clone();
    let session_arc = state.raw_sessions.get(&instance_id).ok_or_else(|| "Session not found".to_string())?.clone();
    
    tokio::spawn(async move {
        let mut last_modified = fs::metadata(&local_path_clone).and_then(|m| m.modified()).ok();
        
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            
            let meta = match fs::metadata(&local_path_clone) {
                Ok(m) => m,
                Err(_) => break, 
            };
            
            let current_modified = meta.modified().ok();
            if current_modified != last_modified {
                if let Ok(new_data) = fs::read(&local_path_clone) {
                    
                    let remote_path_clone = remote_path.clone();
                    let session_arc_clone = session_arc.clone();
                    
                    let upload_result = tokio::task::spawn_blocking(move || {
                        let sess = session_arc_clone.lock();
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
                            match sftp.create(std::path::Path::new(&remote_path_clone)) {
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
                            match file.write_all(&new_data) {
                                Ok(_) => break Ok(()),
                                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                    thread::sleep(Duration::from_millis(10));
                                }
                                Err(e) => return Err(e.to_string()),
                            }
                        }
                    }).await;
                    
                    if let Ok(Ok(())) = upload_result {
                        last_modified = fs::metadata(&local_path_clone).and_then(|m| m.modified()).ok();
                    }
                }
            }
        }
    });

    Ok(())
}
