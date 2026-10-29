mod commands;
mod sync_engine;
mod adapters;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::scan_folders,
            commands::create_sync_plan,
            commands::execute_sync_plan,
            commands::save_log_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
