//! Discover processable files under user-visible folders.

use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use crate::hidden_path::is_hidden;

const SCAN_FOLDERS: &[&str] = &["Documents", "Downloads", "Desktop"];

const MAX_FILE_BYTES: u64 = 100 * 1024 * 1024;

pub fn scan_roots() -> Result<Vec<PathBuf>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    Ok(SCAN_FOLDERS
        .iter()
        .map(|f| home.join(f))
        .filter(|p| p.is_dir())
        .collect())
}

pub fn collect_files(roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut files = Vec::new();

    for root in roots {
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| !should_skip_walk(e.path()))
        {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };

            if !entry.file_type().is_file() {
                continue;
            }

            let path = entry.path().to_path_buf();
            if is_hidden(&path) || !is_processable(&path) {
                continue;
            }

            if entry.metadata().map(|m| m.len()).unwrap_or(0) > MAX_FILE_BYTES {
                continue;
            }

            files.push(path);
        }
    }

    files
}

fn should_skip_walk(path: &Path) -> bool {
    if is_hidden(path) {
        return true;
    }

    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    matches!(
        name,
        "node_modules" | "Library" | "Caches" | ".Trash" | ".Trashes" | "DerivedData"
    )
}

pub fn media_kind(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    if matches!(
        ext.as_str(),
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "tiff" | "tif"
    ) {
        Some("image")
    } else if matches!(
        ext.as_str(),
        "pdf" | "doc" | "docx" | "txt" | "md" | "rtf" | "pages"
    ) {
        Some("text")
    } else {
        None
    }
}

fn is_processable(path: &Path) -> bool {
    media_kind(path).is_some()
}
