//! Spawns and manages the `llama-server` sidecar (llama.cpp HTTP server).

use std::path::Path;
use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const SIDECAR_NAME: &str = "llama-server";
const HOST: &str = "127.0.0.1";
const PORT: &str = "11434";

pub struct LlamaServerState(pub Mutex<Option<CommandChild>>);

/// Start `llama-server` with the given GGUF model. No-op if already running.
pub fn start_with_model(app: &AppHandle, model_path: &Path) -> Result<(), String> {
    if let Some(state) = app.try_state::<LlamaServerState>() {
        if let Ok(guard) = state.0.lock() {
            if guard.is_some() {
                return Ok(());
            }
        }
    }

    let model_str = model_path
        .to_str()
        .ok_or_else(|| "Model path is not valid UTF-8".to_string())?;

    if !model_path.is_file() {
        return Err(format!("Model file not found: {}", model_path.display()));
    }

    let sidecar = app.shell().sidecar(SIDECAR_NAME).map_err(|e| {
        format!(
            "could not resolve sidecar binary ({e}). \
             Add `llama-server-<target-triple>` to src-tauri/binaries/ — see binaries/README.md"
        )
    })?;

    let (mut rx, child) = sidecar
        .args([
            "--host",
            HOST,
            "--port",
            PORT,
            "-m",
            model_str,
            "--temp",
            "0.6",
            "--top-k",
            "20",
            "--top-p",
            "0.95",
            "--min-p",
            "0",
            "--presence-penalty",
            "1.5",
            "-c",
            "32768",
        ])
        .spawn()
        .map_err(|e| format!("spawn failed ({e}"))?;

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    eprintln!("[llama-server] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[llama-server] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Error(err) => {
                    eprintln!("[llama-server] process error: {err}");
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[llama-server] exited: {payload:?}");
                    if let Some(state) = app_handle.try_state::<LlamaServerState>() {
                        if let Ok(mut guard) = state.0.lock() {
                            *guard = None;
                        }
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    app.manage(LlamaServerState(Mutex::new(Some(child))));
    println!(
        "llama-server listening on http://{HOST}:{PORT} (model: {})",
        model_path.display()
    );
    Ok(())
}

/// Stop the sidecar when the application exits.
pub fn stop(app: &AppHandle) {
    let Some(state) = app.try_state::<LlamaServerState>() else {
        return;
    };

    let Ok(mut guard) = state.0.lock() else {
        return;
    };

    if let Some(mut child) = guard.take() {
        if let Err(err) = child.kill() {
            eprintln!("llama-server: failed to kill process ({err})");
        }
    }
}
