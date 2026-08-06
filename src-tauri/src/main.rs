// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use clap::Parser;

fn main() {
    let cli = remoter_lib::cli::Cli::parse();
    match remoter_lib::cli::handle_cli(cli) {
        Ok(true) => {
            // CLI command was handled, exit
            return;
        }
        Ok(false) => {
            // No CLI command, continue to GUI
        }
        Err(e) => {
            eprintln!("Error: {}", e);
            std::process::exit(1);
        }
    }
    remoter_lib::run()
}
