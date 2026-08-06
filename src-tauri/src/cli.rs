use clap::{Parser, Subcommand};
use crate::models::AppConfig;
use crate::ssh::authenticate_session;
use std::path::PathBuf;
use std::fs;
use anyhow::{Context, Result};
use ssh2::Session;
use std::net::TcpStream;
use std::io::{Read, Write};

#[derive(Parser)]
#[command(name = "remoter")]
#[command(about = "Remoter CLI for ProxyCommand and ssh_config injection", long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Commands>,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Use as a ProxyCommand jump host
    Proxy {
        /// Session ID or Name to use as jump host
        #[arg(long)]
        id: String,
        /// Target host
        host: String,
        /// Target port
        port: u16,
    },
    /// Inject hosts into ssh_config
    InjectConfig {
        /// Output file path (defaults to ~/.ssh/config.remoter)
        #[arg(short, long)]
        output: Option<PathBuf>,
        /// Prefix for host names in ssh_config
        #[arg(short, long, default_value = "remoter-")]
        prefix: String,
    },
}

pub fn get_config_path() -> PathBuf {
    let config_dir = dirs::config_dir().expect("Failed to get config directory");
    config_dir.join("remoter").join("config.json")
}

pub fn load_config() -> Result<AppConfig> {
    let path = get_config_path();
    if !path.exists() {
        return Ok(AppConfig {
            sessions: Vec::new(),
            scripts: Vec::new(),
            settings: Default::default(),
        });
    }
    let content = fs::read_to_string(&path)
        .with_context(|| format!("Failed to read config file at {:?}", path))?;
    let config: AppConfig = serde_json::from_str(&content)?;
    Ok(config)
}

pub fn handle_cli(cli: Cli) -> Result<bool> {
    match cli.command {
        Some(Commands::Proxy { id, host, port }) => {
            run_proxy(&id, &host, port)?;
            Ok(true)
        }
        Some(Commands::InjectConfig { output, prefix }) => {
            run_inject_config(output, &prefix)?;
            Ok(true)
        }
        None => Ok(false), // Fallback to GUI
    }
}

fn run_proxy(id: &str, target_host: &str, target_port: u16) -> Result<()> {
    let config = load_config()?;
    let session_info = config.sessions.iter()
        .find(|s| s.id == id || s.name == id)
        .context(format!("Session with ID or Name '{}' not found", id))?;

    let tcp = TcpStream::connect(format!("{}:{}", session_info.host, session_info.port))
        .with_context(|| format!("Failed to connect to jump host {}:{}", session_info.host, session_info.port))?;
    let mut sess = Session::new()?;
    sess.set_tcp_stream(tcp);
    sess.handshake()?;

    let home_dir = dirs::home_dir();
    authenticate_session(home_dir, &mut sess, session_info)
        .map_err(|e| anyhow::anyhow!(e))?;

    let mut channel = sess.channel_direct_tcpip(target_host, target_port, None)
        .with_context(|| format!("Failed to open direct-tcpip channel to {}:{}", target_host, target_port))?;

    // Use non-blocking I/O for bidirectional piping in a single thread
    sess.set_blocking(false);
    
    let mut stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    
    // Set stdin to non-blocking on Unix
    #[cfg(unix)]
    {
        use std::os::unix::io::AsRawFd;
        let fd = stdin.as_raw_fd();
        unsafe {
            let flags = libc::fcntl(fd, libc::F_GETFL);
            libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK);
        }
    }
    
    let mut buf_in = [0u8; 16384];
    let mut buf_out = [0u8; 16384];
    
    loop {
        let mut transferred = false;
        
        match stdin.read(&mut buf_in) {
            Ok(0) => break, // EOF
            Ok(n) => {
                let mut written = 0;
                while written < n {
                    match channel.write(&buf_in[written..n]) {
                        Ok(w) => {
                            written += w;
                            transferred = true;
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            std::thread::sleep(std::time::Duration::from_millis(1));
                        }
                        Err(e) => return Err(e.into()),
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_e) => break,
        }

        match channel.read(&mut buf_out) {
            Ok(0) => break, // EOF
            Ok(n) => {
                stdout.write_all(&buf_out[..n])?;
                stdout.flush()?;
                transferred = true;
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_e) => break,
        }
        
        if !transferred {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }

    Ok(())
}

pub fn run_inject_config(output: Option<PathBuf>, prefix: &str) -> Result<()> {
    let config = load_config()?;
    let exe_path = std::env::current_exe()?;
    let exe_str = exe_path.to_string_lossy();

    let mut config_content = String::new();
    config_content.push_str("# This file is generated by Remoter. Do not edit manually.\n\n");

    for session in &config.sessions {
        let slugified_name = session.name.replace(' ', "_");
        config_content.push_str(&format!("Host {}{}\n", prefix, slugified_name));
        config_content.push_str(&format!("    HostName {}\n", session.host));
        config_content.push_str(&format!("    Port {}\n", session.port));
        config_content.push_str(&format!("    User {}\n", session.user));
        config_content.push_str(&format!("    ProxyCommand \"{}\" proxy --id \"{}\" %h %p\n", exe_str, session.id));
        config_content.push_str("\n");
    }

    let target_path = match output {
        Some(p) => p,
        None => {
            let ssh_dir = dirs::home_dir().expect("Failed to get home directory").join(".ssh");
            if !ssh_dir.exists() {
                fs::create_dir_all(&ssh_dir)?;
            }
            ssh_dir.join("config.remoter")
        }
    };

    fs::write(&target_path, config_content)?;
    println!("Successfully injected {} hosts into {:?}", config.sessions.len(), target_path);
    println!("To use this config, add 'Include {:?}' to your ~/.ssh/config", target_path);

    Ok(())
}
