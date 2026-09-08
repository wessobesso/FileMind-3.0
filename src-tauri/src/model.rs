//! Local GGUF model path and HuggingFace download with progress events.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const MODEL_FILENAME: &str = "Qwen3-4B-Q4_K_M.gguf";
pub const DOWNLOAD_CANCELLED_MSG: &str = "Download cancelled";
const MODEL_DOWNLOAD_URL: &str =
    "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf";

static CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);
static DOWNLOAD_ACTIVE: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
    pub percent: Option<f64>,
}

pub fn model_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    Ok(home.join(".filemind").join("models").join(MODEL_FILENAME))
}

pub fn model_exists() -> bool {
    model_path()
        .map(|p| p.is_file())
        .unwrap_or(false)
}

/// Remove the installed model and any partial download file.
pub fn uninstall_model() -> Result<(), String> {
    let dest = model_path()?;
    let part_path = dest.with_extension("gguf.part");
    cleanup_partial_file(&part_path);

    if dest.is_file() {
        std::fs::remove_file(&dest).map_err(|e| format!("Failed to remove model: {e}"))?;
    }

    Ok(())
}

fn models_dir() -> Result<PathBuf, String> {
    let path = model_path()?;
    path.parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Invalid model path".to_string())
}

fn emit_progress(app: &AppHandle, downloaded: u64, total: Option<u64>) -> Result<(), String> {
    let percent = total.and_then(|t| {
        if t > 0 {
            Some((downloaded as f64 / t as f64) * 100.0)
        } else {
            None
        }
    });

    app.emit(
        "model-download-progress",
        DownloadProgress {
            downloaded,
            total,
            percent,
        },
    )
    .map_err(|e| format!("Failed to emit progress: {e}"))
}

fn cleanup_partial_file(part_path: &Path) {
    if part_path.exists() {
        let _ = std::fs::remove_file(part_path);
    }
}

fn check_cancelled(part_path: &Path) -> Result<(), String> {
    if CANCEL_REQUESTED.load(Ordering::SeqCst) {
        cleanup_partial_file(part_path);
        return Err(DOWNLOAD_CANCELLED_MSG.to_string());
    }
    Ok(())
}

/// Signal the active download to stop and remove any partial file.
pub fn cancel_download() -> Result<(), String> {
    CANCEL_REQUESTED.store(true, Ordering::SeqCst);
    crate::file_representation::request_cancel();
    let part_path = model_path()?.with_extension("gguf.part");
    cleanup_partial_file(&part_path);
    Ok(())
}

/// Download the model to `~/.filemind/models/Qwen3-4B-Q4_K_M.gguf`, emitting progress events.
pub async fn download_model(app: AppHandle) -> Result<(), String> {
    if DOWNLOAD_ACTIVE.swap(true, Ordering::SeqCst) {
        return Err("A model download is already in progress".to_string());
    }

    CANCEL_REQUESTED.store(false, Ordering::SeqCst);

    let result = download_model_inner(&app).await;

    DOWNLOAD_ACTIVE.store(false, Ordering::SeqCst);
    CANCEL_REQUESTED.store(false, Ordering::SeqCst);

    result
}

async fn download_model_inner(app: &AppHandle) -> Result<(), String> {
    crate::file_representation::spawn_during_model_download(app.clone());

    let dest = model_path()?;
    let models_dir = models_dir()?;

    std::fs::create_dir_all(&models_dir)
        .map_err(|e| format!("Failed to create models directory: {e}"))?;

    let part_path = dest.with_extension("gguf.part");
    cleanup_partial_file(&part_path);
    check_cancelled(&part_path)?;

    let client = reqwest::Client::builder()
        .user_agent("FileMind/1.0 (Tauri)")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let response = client
        .get(MODEL_DOWNLOAD_URL)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {e}"))?;

    check_cancelled(&part_path)?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status {}",
            response.status()
        ));
    }

    let total = response.content_length();
    emit_progress(app, 0, total)?;

    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(&part_path)
        .await
        .map_err(|e| format!("Failed to create temp file: {e}"))?;

    let mut downloaded: u64 = 0;
    let mut last_emitted_percent: u64 = 0;

    use tokio::io::AsyncWriteExt;

    while let Some(chunk) = stream.next().await {
        check_cancelled(&part_path)?;

        let chunk = chunk.map_err(|e| format!("Download stream error: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write model file: {e}"))?;
        downloaded += chunk.len() as u64;

        let should_emit = match total {
            Some(t) if t > 0 => {
                let pct = (downloaded * 100) / t;
                if pct > last_emitted_percent || downloaded >= t {
                    last_emitted_percent = pct;
                    true
                } else {
                    false
                }
            }
            _ => downloaded % (512 * 1024) < chunk.len() as u64,
        };

        if should_emit {
            emit_progress(app, downloaded, total)?;
        }
    }

    check_cancelled(&part_path)?;

    file.flush()
        .await
        .map_err(|e| format!("Failed to flush model file: {e}"))?;
    drop(file);

    if dest.exists() {
        std::fs::remove_file(&dest).map_err(|e| format!("Failed to replace model: {e}"))?;
    }

    std::fs::rename(&part_path, &dest).map_err(|e| format!("Failed to finalize model: {e}"))?;

    emit_progress(app, downloaded, total)?;
    Ok(())
}
