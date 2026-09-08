use serde::Serialize;
use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use crate::hidden_path::is_hidden;

const USER_VISIBLE_FOLDERS: &[&str] = &[
    "Documents",
    "Downloads",
    "Desktop",
    "Pictures",
    "Movies",
    "Music",
];

const MAX_RESULTS: usize = 2_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum MatchKind {
    Contains = 0,
    StartsWith = 1,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileSearchResult {
    pub path: String,
    pub name: String,
    #[serde(rename = "isDirectory")]
    pub is_directory: bool,
}

struct ScoredResult {
    result: FileSearchResult,
    priority: i32,
    match_kind: MatchKind,
}

#[derive(Serialize)]
pub struct SearchFilesResponse {
    pub results: Vec<FileSearchResult>,
}

pub fn search_files(
    query: &str,
    deep_search: bool,
    excluded_paths: &[String],
    include_folders: &[String],
    exclude_folders: &[String],
) -> Result<SearchFilesResponse, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(SearchFilesResponse {
            results: Vec::new(),
        });
    }

    let query_lower = trimmed.to_lowercase();
    let excluded = merge_excluded_paths(excluded_paths, exclude_folders);
    let roots = search_roots(deep_search, &excluded, include_folders)?;
    let priority_paths = priority_folder_paths();

    let mut scored: Vec<ScoredResult> = Vec::new();

    for root in roots {
        if !root.exists() {
            continue;
        }

        for entry in WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                let path = e.path();
                !should_skip_entry(path) && !is_under_excluded(path, &excluded)
            })
        {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };

            let file_type = entry.file_type();

            let path = entry.path();
            if is_hidden(path) {
                continue;
            }

            let name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n,
                None => continue,
            };

            let match_kind = match_name(name, &query_lower);
            if match_kind.is_none() {
                continue;
            }

            let is_directory = file_type.is_dir();
            let path_string = path.to_string_lossy().into_owned();

            scored.push(ScoredResult {
                result: FileSearchResult {
                    path: path_string,
                    name: name.to_string(),
                    is_directory,
                },
                priority: priority_score(path, &priority_paths),
                match_kind: match_kind.unwrap(),
            });

            if scored.len() >= MAX_RESULTS {
                break;
            }
        }

        if scored.len() >= MAX_RESULTS {
            break;
        }
    }

    scored.sort_by(compare_results);

    Ok(SearchFilesResponse {
        results: scored.into_iter().map(|s| s.result).collect(),
    })
}

fn match_name(name: &str, query_lower: &str) -> Option<MatchKind> {
    let name_lower = name.to_lowercase();
    if name_lower.starts_with(query_lower) {
        Some(MatchKind::StartsWith)
    } else if name_lower.contains(query_lower) {
        Some(MatchKind::Contains)
    } else {
        None
    }
}

fn compare_results(a: &ScoredResult, b: &ScoredResult) -> Ordering {
    b.priority
        .cmp(&a.priority)
        .then(b.match_kind.cmp(&a.match_kind))
        .then(
            a.result
                .name
                .to_lowercase()
                .cmp(&b.result.name.to_lowercase()),
        )
}

fn priority_folder_paths() -> Vec<PathBuf> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return Vec::new(),
    };

    USER_VISIBLE_FOLDERS
        .iter()
        .map(|folder| home.join(folder))
        .collect()
}

fn priority_score(path: &Path, priority_paths: &[PathBuf]) -> i32 {
    let path_str = path.to_string_lossy();
    for (index, folder_path) in priority_paths.iter().enumerate() {
        let folder_str = folder_path.to_string_lossy();
        if path_str.starts_with(folder_str.as_ref()) {
            return (USER_VISIBLE_FOLDERS.len() - index) as i32;
        }
    }
    0
}

fn merge_excluded_paths(excluded_paths: &[String], exclude_folders: &[String]) -> Vec<PathBuf> {
    let mut excluded: Vec<PathBuf> = excluded_paths
        .iter()
        .chain(exclude_folders.iter())
        .filter_map(|p| resolve_folder_path(p).ok())
        .collect();
    excluded.sort();
    excluded.dedup();
    excluded
}

fn resolve_folder_path(folder: &str) -> Result<PathBuf, String> {
    let trimmed = folder.trim();
    if trimmed.is_empty() {
        return Err("Empty folder path".to_string());
    }

    if trimmed == "~" {
        return dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string());
    }

    if let Some(stripped) = trimmed.strip_prefix("~/") {
        let home =
            dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
        return Ok(home.join(stripped));
    }

    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        return Ok(path);
    }

    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    Ok(home.join(trimmed))
}

fn resolve_folder_paths(folders: &[String]) -> Result<Vec<PathBuf>, String> {
    let mut paths = Vec::new();
    for folder in folders {
        let path = resolve_folder_path(folder)?;
        if path.is_dir() {
            paths.push(path);
        }
    }
    Ok(paths)
}

fn default_home_roots() -> Result<Vec<PathBuf>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    Ok(USER_VISIBLE_FOLDERS
        .iter()
        .map(|folder| home.join(folder))
        .collect())
}

fn filter_roots_to_included(roots: Vec<PathBuf>, included: &[PathBuf]) -> Vec<PathBuf> {
    if included.is_empty() {
        return roots;
    }

    roots
        .into_iter()
        .filter(|root| {
            included
                .iter()
                .any(|inc| root == inc || root.starts_with(inc) || inc.starts_with(root))
        })
        .collect()
}

fn is_under_excluded(path: &Path, excluded: &[PathBuf]) -> bool {
    excluded.iter().any(|ex| path.starts_with(ex))
}

fn search_roots(
    deep_search: bool,
    excluded: &[PathBuf],
    include_folders: &[String],
) -> Result<Vec<PathBuf>, String> {
    let has_include = include_folders.iter().any(|f| !f.trim().is_empty());

    let mut roots = if deep_search {
        deep_search_roots(excluded)?
    } else if has_include {
        resolve_folder_paths(include_folders)?
    } else {
        default_home_roots()?
    };

    if deep_search && has_include {
        let included = resolve_folder_paths(include_folders)?;
        roots = filter_roots_to_included(roots, &included);
    }

    roots.retain(|root| !is_under_excluded(root, excluded));
    Ok(roots)
}

fn deep_search_roots(excluded: &[PathBuf]) -> Result<Vec<PathBuf>, String> {
    let root = PathBuf::from("/");

    let entries = std::fs::read_dir(&root).map_err(|e| format!("Failed to read /: {e}"))?;

    let mut roots = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if is_excluded(&path, excluded) {
            continue;
        }
        if should_skip_root(&path) {
            continue;
        }
        roots.push(path);
    }

    Ok(roots)
}

fn is_excluded(path: &Path, excluded: &[PathBuf]) -> bool {
    excluded.iter().any(|ex| ex == path)
}

fn should_skip_root(path: &Path) -> bool {
    if is_hidden(path) {
        return true;
    }

    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    matches!(
        name,
        "System"
            | "private"
            | "dev"
            | "proc"
            | "tmp"
            | "var"
            | "usr"
            | "sbin"
            | "bin"
            | "etc"
            | "cores"
            | "opt"
            | "Volumes"
    )
}

fn should_skip_entry(path: &Path) -> bool {
    if is_hidden(path) {
        return true;
    }

    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    matches!(
        name,
        "node_modules" | "Library" | "Caches" | ".Trash" | ".Trashes" | "DerivedData"
    )
}
