pub mod models;
pub mod state;
pub mod ssh;
pub mod sftp;
pub mod commands;

use dashmap::DashMap;
use parking_lot::Mutex;
use std::fs;

use models::*;
use state::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            use tauri::Manager;

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
                port_proxies: DashMap::new(),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::manual_save_to_disk,
            commands::add_session,
            commands::batch_add_sessions,
            commands::get_sessions,
            commands::get_scripts,
            commands::add_script,
            commands::delete_script,
            commands::delete_session,
            commands::update_session_group,
            ssh::start_ssh_session,
            ssh::stop_ssh_session,
            ssh::send_ssh_data,
            ssh::resize_ssh_session,
            ssh::run_command_all,
            ssh::distribute_file,
            ssh::distribute_file_data,
            ssh::start_port_proxy,
            ssh::stop_port_proxy,
            sftp::sftp_list,
            sftp::sftp_mkdir,
            sftp::sftp_rename,
            sftp::sftp_remove_file,
            sftp::sftp_remove_dir,
            sftp::sftp_upload,
            sftp::sftp_upload_file,
            sftp::sftp_download,
            sftp::sftp_edit_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
