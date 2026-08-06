use dashmap::DashMap;
use parking_lot::Mutex;
use std::sync::Arc;
use std::path::PathBuf;
use std::fs;

use crate::models::*;

pub struct AppState {
    pub sessions: DashMap<String, SessionInfo>,
    pub scripts: DashMap<String, Script>,
    pub settings: Mutex<AppSettings>,
    pub config_path: PathBuf,
    pub ssh_sessions: DashMap<String, Arc<SshSession>>,
    pub raw_sessions: DashMap<String, Arc<Mutex<ssh2::Session>>>,
    pub port_proxies: DashMap<String, std::sync::mpsc::Sender<()>>,
    pub running_batches: DashMap<String, bool>,
}

impl AppState {
    pub fn save_config_to_disk(&self) {
        let config = AppConfig {
            sessions: self
                .sessions
                .iter()
                .map(|kv| {
                    let mut session = kv.value().clone();
                    session.recover_interrupted_run();
                    session
                })
                .collect(),
            scripts: self.scripts.iter().map(|kv| kv.value().clone()).collect(),
            settings: self.settings.lock().clone(),
        };
        let json = serde_json::to_string_pretty(&config).expect("Failed to serialize config");
        let _ = fs::write(&self.config_path, json);
    }

    pub fn is_batch_running(&self, batch_id: &str) -> bool {
        self.running_batches.contains_key(batch_id)
    }

    pub fn cancel_batch(&self, batch_id: &str) {
        self.running_batches.remove(batch_id);
    }
}

pub fn get_default_scripts() -> Vec<Script> {
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
