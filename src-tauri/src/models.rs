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
    Aborted,
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

impl SessionInfo {
    /// A running batch cannot survive an application restart. Convert the
    /// transient state before it is restored from, or written to, disk.
    pub fn recover_interrupted_run(&mut self) -> bool {
        if self.status != SessionStatus::Running {
            return false;
        }

        self.status = SessionStatus::Aborted;
        self.history
            .push("Aborted: Application exited while the task was running".to_string());
        true
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub theme: Option<String>,
    #[serde(default = "default_max_concurrency")]
    pub max_concurrency: usize,
}

fn default_max_concurrency() -> usize { 10 }

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: None,
            max_concurrency: 10,
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn session(status: SessionStatus) -> SessionInfo {
        SessionInfo {
            id: "1".into(),
            name: "test".into(),
            host: "localhost".into(),
            port: 22,
            user: "user".into(),
            password: None,
            key_path: None,
            jump_host: None,
            group: "default".into(),
            status,
            history: vec![],
        }
    }

    #[test]
    fn running_session_is_recovered_as_aborted() {
        let mut session = session(SessionStatus::Running);

        assert!(session.recover_interrupted_run());
        assert_eq!(session.status, SessionStatus::Aborted);
        assert_eq!(session.history.len(), 1);
    }

    #[test]
    fn completed_session_is_not_changed() {
        let mut session = session(SessionStatus::Success);

        assert!(!session.recover_interrupted_run());
        assert_eq!(session.status, SessionStatus::Success);
        assert!(session.history.is_empty());
    }
}
