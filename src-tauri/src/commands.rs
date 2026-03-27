use tauri::State;
use uuid::Uuid;

use crate::models::*;
use crate::state::AppState;

#[tauri::command]
pub async fn manual_save_to_disk(state: State<'_, AppState>) -> Result<(), String> {
    state.save_config_to_disk();
    Ok(())
}

#[tauri::command]
pub async fn update_session_group(
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
pub async fn add_session(
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
pub async fn batch_add_sessions(
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
pub fn get_sessions(state: State<'_, AppState>) -> Vec<SessionInfo> {
    state.sessions.iter().map(|kv| kv.value().clone()).collect()
}

#[tauri::command]
pub fn get_scripts(state: State<'_, AppState>) -> Vec<Script> {
    let mut scripts: Vec<Script> = state.scripts.iter().map(|kv| kv.value().clone()).collect();
    scripts.sort_by(|a, b| a.name.cmp(&b.name));
    scripts
}

#[tauri::command]
pub fn add_script(state: State<'_, AppState>, script: Script) -> Result<String, String> {
    let mut script = script;
    if script.id.is_empty() {
        script.id = Uuid::new_v4().to_string();
    }
    state.scripts.insert(script.id.clone(), script.clone());
    state.save_config_to_disk();
    Ok(script.id)
}

#[tauri::command]
pub fn delete_script(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.scripts.remove(&id);
    state.save_config_to_disk();
    Ok(())
}

#[tauri::command]
pub fn delete_session(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.sessions.remove(&id);
    state.save_config_to_disk();
    Ok(())
}
