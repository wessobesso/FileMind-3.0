mod file_representation;
mod file_search;
mod hidden_path;
mod llama_server;
mod model;
mod server_transmit;

use file_search::{search_files as run_search, FileSearchResult};
use model::model_path;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn search_files(
    query: String,
    deep_search: Option<bool>,
    trace_search: Option<bool>,
    excluded_paths: Option<Vec<String>>,
    include_folders: Option<Vec<String>>,
    exclude_folders: Option<Vec<String>>,
) -> Result<Vec<FileSearchResult>, String> {
    let deep = deep_search.unwrap_or(false);
    let trace = trace_search.unwrap_or(false);

    if deep && trace {
        return Err("DeepSearch and TraceSearch cannot be active at the same time".to_string());
    }

    let response = run_search(
        &query,
        deep,
        &excluded_paths.unwrap_or_default(),
        &include_folders.unwrap_or_default(),
        &exclude_folders.unwrap_or_default(),
    )?;
    Ok(response.results)
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Path is empty".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", path])
            .spawn()
            .map_err(|e| format!("Failed to reveal in Finder: {e}"))?;
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("reveal_in_finder is only supported on macOS".to_string())
    }
}

#[tauri::command]
fn is_model_ready() -> bool {
    model::model_exists()
}

#[tauri::command]
fn get_model_path() -> Result<String, String> {
    model_path().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
async fn download_model(app: tauri::AppHandle) -> Result<(), String> {
    model::download_model(app).await
}

#[tauri::command]
fn cancel_model_download() -> Result<(), String> {
    model::cancel_download()
}

#[tauri::command]
fn start_llama_server(app: tauri::AppHandle) -> Result<(), String> {
    let path = model_path()?;
    if !path.is_file() {
        return Err("Model file is not installed".to_string());
    }
    llama_server::start_with_model(&app, &path)
}

#[tauri::command]
fn uninstall_model(app: tauri::AppHandle) -> Result<(), String> {
    llama_server::stop(&app);
    model::uninstall_model()
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    file_representation::request_cancel();
    llama_server::stop(&app);
    app.exit(0);
}

#[tauri::command]
fn capture_trace_search_json(json: String) -> Result<(), String> {
    println!("TraceSearch captured: {}", json);
    Ok(())
}

#[tauri::command]
fn start_file_index(app: tauri::AppHandle) -> Result<(), String> {
    file_representation::start_index_files(app)
}

#[tauri::command]
fn is_file_index_running() -> bool {
    file_representation::is_index_running()
}

#[tauri::command]
fn clear_file_index() -> Result<(), String> {
    file_representation::clear_index_cache()
}

#[tauri::command]
fn get_file_index_cache_status() -> Result<file_representation::FileIndexCacheStatus, String> {
    file_representation::index_cache_status()
}

#[tauri::command]
fn get_file_index_cache_path() -> Result<String, String> {
    file_representation::index_cache_path()
}

#[tauri::command]
fn get_file_index_progress() -> Option<file_representation::FileIndexProgress> {
    file_representation::current_index_progress()
}

#[tauri::command]
fn get_file_index_live_status() -> Result<file_representation::FileIndexLiveStatus, String> {
    file_representation::index_live_status()
}

#[tauri::command]
fn cancel_file_index() -> Result<(), String> {
    file_representation::cancel_index_files()
}

#[tauri::command]
fn continue_file_index(app: tauri::AppHandle) -> Result<(), String> {
    file_representation::continue_index_files(app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            search_files,
            reveal_in_finder,
            is_model_ready,
            get_model_path,
            download_model,
            cancel_model_download,
            start_llama_server,
            uninstall_model,
            quit_app,
            capture_trace_search_json,
            start_file_index,
            is_file_index_running,
            clear_file_index,
            get_file_index_cache_status,
            get_file_index_cache_path,
            get_file_index_progress,
            get_file_index_live_status,
            cancel_file_index,
            continue_file_index,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                file_representation::request_cancel();
                llama_server::stop(app_handle);
            }
        });
}
