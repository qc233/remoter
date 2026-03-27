use serde::{Deserialize, Serialize};
use std::sync::Arc;
use parking_lot::Mutex;
use std::sync::mpsc;

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
