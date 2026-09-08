//! Local cache layout under `~/TraceSearch/cache/` (testing mode).

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use chrono::Utc;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIndexLiveStatus {
    pub cache_root: String,
    pub indexed_count: usize,
    pub last_indexed_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMeta {
    pub original_path: String,
    #[serde(rename = "type")]
    pub file_type: String,
    pub processed_at: String,
}

pub struct CacheLayout {
    pub root: PathBuf,
    pub images: PathBuf,
    pub text: PathBuf,
}

impl CacheLayout {
    pub fn new() -> Result<Self, String> {
        let root = Self::root_path()?;
        let images = root.join("images");
        let text = root.join("text");

        for dir in [&root, &images, &text] {
            std::fs::create_dir_all(dir)
                .map_err(|e| format!("Failed to create cache dir {}: {e}", dir.display()))?;
        }

        Ok(Self { root, images, text })
    }

    pub fn root_path() -> Result<PathBuf, String> {
        let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
        Ok(home.join("TraceSearch").join("cache"))
    }

    /// Paths of source files already represented in the cache.
    pub fn indexed_source_paths(root: &Path) -> Result<HashSet<String>, String> {
        if !root.is_dir() {
            return Ok(HashSet::new());
        }

        let mut sources = HashSet::new();
        for entry in walkdir::WalkDir::new(root)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy();
            if !name.ends_with(".meta.json") {
                continue;
            }

            let content = match std::fs::read_to_string(entry.path()) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let meta: FileMeta = match serde_json::from_str(&content) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.file_type != "video_frame" {
                sources.insert(meta.original_path);
            }
        }
        Ok(sources)
    }

    /// Count unique source files represented in the cache.
    pub fn count_indexed_files(root: &Path) -> Result<usize, String> {
        Ok(Self::indexed_source_paths(root)?.len())
    }

    /// Live snapshot of the cache directory (non-blocking reads).
    pub fn live_status() -> Result<FileIndexLiveStatus, String> {
        let root = Self::root_path()?;
        let indexed_count = Self::count_indexed_files(&root)?;
        let last_indexed_file = Self::newest_cache_artifact(&root)
            .map(|p| p.to_string_lossy().into_owned());
        Ok(FileIndexLiveStatus {
            cache_root: root.to_string_lossy().into_owned(),
            indexed_count,
            last_indexed_file,
        })
    }

    /// Newest cache artifact, equivalent to:
    /// `find ~/TraceSearch/cache -type f -not -name "*.meta.json" | xargs ls -t | head -1`
    pub fn newest_cache_artifact(root: &Path) -> Option<PathBuf> {
        if !root.is_dir() {
            return None;
        }

        let mut newest: Option<(PathBuf, SystemTime)> = None;
        for entry in walkdir::WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy();
            if name.ends_with(".meta.json") {
                continue;
            }
            let mtime = entry.metadata().ok()?.modified().ok()?;
            let replace = match &newest {
                None => true,
                Some((_, best)) => mtime > *best,
            };
            if replace {
                newest = Some((entry.path().to_path_buf(), mtime));
            }
        }

        newest.map(|(path, _)| path)
    }

    pub fn write_meta(&self, artifact_path: &Path, meta: &FileMeta) -> Result<(), String> {
        let meta_path = PathBuf::from(format!("{}.meta.json", artifact_path.display()));
        let json = serde_json::to_string_pretty(meta)
            .map_err(|e| format!("Failed to serialize metadata: {e}"))?;
        std::fs::write(&meta_path, json)
            .map_err(|e| format!("Failed to write {}: {e}", meta_path.display()))?;
        Ok(())
    }

    pub fn meta_now(original_path: &Path, file_type: &str) -> FileMeta {
        FileMeta {
            original_path: original_path.to_string_lossy().into_owned(),
            file_type: file_type.to_string(),
            processed_at: Utc::now().to_rfc3339(),
        }
    }
}

/// Safe cache basename from original path (avoids collisions across folders).
pub fn cache_stem(original: &Path) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let name = original
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    let safe_name: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();

    let mut hasher = DefaultHasher::new();
    original.to_string_lossy().hash(&mut hasher);
    let hash = hasher.finish();

    format!("{hash:016x}_{safe_name}")
}
