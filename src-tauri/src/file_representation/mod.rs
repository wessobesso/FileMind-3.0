//! Lightweight file representation pipeline (runs during model download or on demand).

mod cache;
mod process;
mod scan;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

pub use cache::CacheLayout;
pub use cache::FileIndexLiveStatus;

static PIPELINE_CANCEL: AtomicBool = AtomicBool::new(false);
static PIPELINE_RUNNING: AtomicBool = AtomicBool::new(false);
static LAST_PROGRESS: Mutex<Option<FileIndexProgress>> = Mutex::new(None);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIndexProgress {
    pub running: bool,
    pub paused: bool,
    pub indexed: usize,
    pub total: usize,
    pub errors: usize,
    pub last_indexed_file: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIndexCacheStatus {
    pub cache_root: String,
    pub indexed_count: usize,
    pub has_cache: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIndexComplete {
    pub processed: usize,
    pub skipped: usize,
    pub errors: usize,
    pub cache_root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedIndexState {
    total: usize,
    paused: bool,
    complete: bool,
    errors: usize,
}

fn index_state_path() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    Ok(home.join("TraceSearch").join("index-state.json"))
}

fn save_persisted_state(state: &PersistedIndexState) -> Result<(), String> {
    let path = index_state_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create TraceSearch dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Failed to serialize index state: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to write index state: {e}"))?;
    Ok(())
}

fn load_persisted_state() -> Result<Option<PersistedIndexState>, String> {
    let path = index_state_path()?;
    if !path.is_file() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read index state: {e}"))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse index state: {e}"))
}

fn clear_persisted_state() -> Result<(), String> {
    let path = index_state_path()?;
    if path.is_file() {
        std::fs::remove_file(&path).map_err(|e| format!("Failed to remove index state: {e}"))?;
    }
    Ok(())
}

fn persist_incomplete(total: usize, errors: usize, paused: bool) {
    if total == 0 {
        return;
    }
    let _ = save_persisted_state(&PersistedIndexState {
        total,
        paused,
        complete: false,
        errors,
    });
}

fn persist_complete(total: usize, errors: usize) {
    let _ = save_persisted_state(&PersistedIndexState {
        total,
        paused: false,
        complete: true,
        errors,
    });
}

fn apply_live_indexed_count(mut progress: FileIndexProgress) -> FileIndexProgress {
    if let Ok(live) = CacheLayout::live_status() {
        progress.indexed = live.indexed_count;
    }
    progress
}

fn restored_progress_from_disk() -> Option<FileIndexProgress> {
    if let Some(state) = load_persisted_state().ok()? {
        if state.complete || state.total == 0 {
            return None;
        }

        let live = CacheLayout::live_status().ok()?;
        if live.indexed_count >= state.total {
            let _ = persist_complete(state.total, state.errors);
            return None;
        }

        return Some(FileIndexProgress {
            running: false,
            paused: state.paused || live.indexed_count < state.total,
            indexed: live.indexed_count,
            total: state.total,
            errors: state.errors,
            last_indexed_file: None,
        });
    }

    fallback_progress_for_orphan_cache()
}

/// Cache exists but no saved state (e.g. app closed mid-index before persistence).
fn fallback_progress_for_orphan_cache() -> Option<FileIndexProgress> {
    let live = CacheLayout::live_status().ok()?;
    if live.indexed_count == 0 {
        return None;
    }

    let roots = scan::scan_roots().ok()?;
    let total = scan::collect_files(&roots).len();
    if total == 0 || live.indexed_count >= total {
        if total > 0 {
            let _ = persist_complete(total, 0);
        }
        return None;
    }

    persist_incomplete(total, 0, true);
    Some(FileIndexProgress {
        running: false,
        paused: true,
        indexed: live.indexed_count,
        total,
        errors: 0,
        last_indexed_file: None,
    })
}

fn can_continue_indexing() -> Result<bool, String> {
    if is_index_running() {
        return Ok(false);
    }
    if let Some(state) = load_persisted_state()? {
        if state.complete || state.total == 0 {
            return Ok(false);
        }
        let indexed = CacheLayout::live_status()?.indexed_count;
        return Ok(indexed < state.total);
    }
    Ok(fallback_progress_for_orphan_cache().is_some())
}

/// Request pipeline stop (e.g. on app quit or download cancel).
pub fn request_cancel() {
    PIPELINE_CANCEL.store(true, Ordering::SeqCst);
}

pub fn cancel_index_files() -> Result<(), String> {
    if !is_index_running() {
        return Ok(());
    }
    request_cancel();
    Ok(())
}

pub fn is_index_running() -> bool {
    PIPELINE_RUNNING.load(Ordering::SeqCst)
}

/// Remove all cached file representations under `~/TraceSearch/cache/`.
pub fn clear_index_cache() -> Result<(), String> {
    if is_index_running() {
        return Err("File indexing is in progress".to_string());
    }

    let root = CacheLayout::root_path()?;
    if root.exists() {
        std::fs::remove_dir_all(&root)
            .map_err(|e| format!("Failed to clear index cache: {e}"))?;
    }

    clear_persisted_state()?;

    set_last_progress(FileIndexProgress {
        running: false,
        paused: false,
        indexed: 0,
        total: 0,
        errors: 0,
        last_indexed_file: None,
    });

    Ok(())
}

pub fn index_cache_status() -> Result<FileIndexCacheStatus, String> {
    let live = index_live_status()?;
    Ok(FileIndexCacheStatus {
        cache_root: live.cache_root,
        indexed_count: live.indexed_count,
        has_cache: live.indexed_count > 0,
    })
}

pub fn index_live_status() -> Result<FileIndexLiveStatus, String> {
    CacheLayout::live_status()
}

pub fn index_cache_path() -> Result<String, String> {
    let layout = CacheLayout::new()?;
    Ok(layout.root.to_string_lossy().into_owned())
}

pub fn current_index_progress() -> Option<FileIndexProgress> {
    if let Ok(guard) = LAST_PROGRESS.lock() {
        if let Some(progress) = guard.as_ref() {
            if progress.running || progress.total > 0 {
                return Some(apply_live_indexed_count(progress.clone()));
            }
        }
    }
    restored_progress_from_disk()
}

fn cancelled() -> bool {
    PIPELINE_CANCEL.load(Ordering::SeqCst)
}

fn set_last_progress(progress: FileIndexProgress) {
    if let Ok(mut guard) = LAST_PROGRESS.lock() {
        *guard = Some(progress);
    }
}

fn emit_progress(
    app: &AppHandle,
    indexed: usize,
    total: usize,
    errors: usize,
    last_indexed_file: Option<String>,
) {
    let progress = FileIndexProgress {
        running: true,
        paused: false,
        indexed,
        total,
        errors,
        last_indexed_file,
    };
    set_last_progress(progress.clone());
    if total > 0 {
        persist_incomplete(total, errors, false);
    }
    let _ = app.emit("file-index-progress", progress);
}

/// Spawn the pipeline without blocking the model download.
pub fn spawn_during_model_download(app: AppHandle) {
    let _ = try_start_index(app, false, false);
}

/// Start indexing from Settings (returns error if already running).
pub fn start_index_files(app: AppHandle) -> Result<(), String> {
    try_start_index(app, true, false)
}

/// Resume a paused indexing run, skipping files already in the cache.
pub fn continue_index_files(app: AppHandle) -> Result<(), String> {
    if is_index_running() {
        return Err("File indexing is already in progress".to_string());
    }

    let can_continue = can_continue_indexing()?;
    if !can_continue {
        return Err("No indexing run to continue".to_string());
    }

    try_start_index(app, true, true)
}

fn try_start_index(app: AppHandle, from_settings: bool, resume: bool) -> Result<(), String> {
    if PIPELINE_RUNNING.swap(true, Ordering::SeqCst) {
        if from_settings {
            return Err("File indexing is already in progress".to_string());
        }
        return Ok(());
    }

    PIPELINE_CANCEL.store(false, Ordering::SeqCst);
    if resume {
        let progress = restored_progress_from_disk()
            .or_else(current_index_progress)
            .map(|mut p| {
                p.running = true;
                p.paused = false;
                p
            });
        if let Some(p) = progress {
            set_last_progress(p);
        }
    } else {
        clear_persisted_state()?;
        set_last_progress(FileIndexProgress {
            running: true,
            paused: false,
            indexed: 0,
            total: 0,
            errors: 0,
            last_indexed_file: None,
        });
    }

    tauri::async_runtime::spawn(async move {
        let result = run_pipeline(&app).await;
        PIPELINE_RUNNING.store(false, Ordering::SeqCst);

        match &result {
            Ok(stats) => {
                let _ = app.emit(
                    "file-index-complete",
                    FileIndexComplete {
                        processed: stats.processed,
                        skipped: stats.skipped,
                        errors: stats.errors,
                        cache_root: stats.cache_root.to_string_lossy().into_owned(),
                    },
                );
                let final_progress = FileIndexProgress {
                    running: false,
                    paused: false,
                    indexed: stats.processed,
                    total: stats.work_total,
                    errors: stats.errors,
                    last_indexed_file: stats.last_indexed_file.clone(),
                };
                set_last_progress(final_progress.clone());
                persist_complete(stats.work_total, stats.errors);
                let _ = app.emit("file-index-progress", final_progress);
                println!(
                    "File representation pipeline finished: {} processed, {} skipped, {} errors",
                    stats.processed, stats.skipped, stats.errors
                );
            }
            Err(e) => {
                if e == "cancelled" {
                    let live_indexed = CacheLayout::live_status()
                        .map(|s| s.indexed_count)
                        .unwrap_or(0);
                    if let Some(mut progress) = current_index_progress() {
                        progress.running = false;
                        progress.paused = progress.total > live_indexed;
                        progress.indexed = live_indexed;
                        set_last_progress(progress.clone());
                        persist_incomplete(progress.total, progress.errors, true);
                        let _ = app.emit("file-index-progress", progress);
                    }
                } else {
                    eprintln!("File representation pipeline failed: {e}");
                    let progress = FileIndexProgress {
                        running: false,
                        paused: false,
                        indexed: 0,
                        total: 0,
                        errors: 0,
                        last_indexed_file: None,
                    };
                    set_last_progress(progress.clone());
                    let _ = app.emit("file-index-progress", progress);
                }
            }
        }
    });

    Ok(())
}

struct PipelineStats {
    processed: usize,
    skipped: usize,
    errors: usize,
    work_total: usize,
    last_indexed_file: Option<String>,
    cache_root: std::path::PathBuf,
}

async fn run_pipeline(app: &AppHandle) -> Result<PipelineStats, String> {
    emit_progress(app, 0, 0, 0, None);

    let roots = scan::scan_roots()?;
    let files = scan::collect_files(&roots);
    let total = files.len();

    emit_progress(app, 0, total, 0, None);

    if files.is_empty() {
        let cache = CacheLayout::new()?;
        persist_complete(0, 0);
        return Ok(PipelineStats {
            processed: 0,
            skipped: 0,
            errors: 0,
            work_total: 0,
            last_indexed_file: None,
            cache_root: cache.root,
        });
    }

    let cache = Arc::new(CacheLayout::new()?);
    let already_indexed = CacheLayout::indexed_source_paths(&cache.root)?;
    let semaphore = Arc::new(Semaphore::new(4));
    let mut join_set = JoinSet::new();

    let mut processed = 0usize;
    let mut skipped = 0usize;
    let mut errors = 0usize;
    let mut queued = 0usize;

    for path in &files {
        if cancelled() {
            return Err("cancelled".to_string());
        }

        let path_key = path.to_string_lossy().into_owned();
        if already_indexed.contains(&path_key) {
            skipped += 1;
            continue;
        }

        let kind = match scan::media_kind(path) {
            Some(k) => k,
            None => {
                skipped += 1;
                continue;
            }
        };

        queued += 1;
        let cache = Arc::clone(&cache);
        let path = path.clone();
        let permit = semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| format!("Semaphore error: {e}"))?;

        join_set.spawn(async move {
            let _permit = permit;
            let path_label = path.to_string_lossy().into_owned();
            if cancelled() {
                return (path_label, Err("cancelled".to_string()));
            }

            let result = tokio::task::spawn_blocking(move || match kind {
                "image" => process::process_image(&cache, &path),
                "text" => process::process_text(&cache, &path),
                _ => Err(format!("unsupported media kind: {kind}")),
            })
            .await
            .map_err(|e| format!("Task join error: {e}"))
            .and_then(|inner| inner);

            (path_label, result)
        });
    }

    let work_total = queued.max(total);
    let mut last_indexed_file: Option<String> = None;

    while let Some(res) = join_set.join_next().await {
        if cancelled() {
            join_set.abort_all();
            return Err("cancelled".to_string());
        }

        match res {
            Ok((path_label, Ok(_))) => {
                processed += 1;
                last_indexed_file = Some(path_label);
            }
            Ok((_path_label, Err(e))) => {
                if e == "cancelled" {
                    return Err("cancelled".to_string());
                }
                errors += 1;
                eprintln!("Pipeline file error: {e}");
            }
            Err(e) => {
                errors += 1;
                eprintln!("Pipeline join error: {e}");
            }
        }

        emit_progress(
            app,
            processed,
            work_total,
            errors,
            last_indexed_file.clone(),
        );
    }

    Ok(PipelineStats {
        processed,
        skipped,
        errors,
        work_total,
        last_indexed_file,
        cache_root: cache.root.clone(),
    })
}
