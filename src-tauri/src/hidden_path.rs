//! Skip hidden path components and macOS UF_HIDDEN entries during file walks.

use std::path::Path;

/// True if any path segment is a hidden name (e.g. `.git`, `.cache`).
pub fn has_hidden_path_component(path: &Path) -> bool {
    for component in path.components() {
        if let std::path::Component::Normal(name) = component {
            let s = name.to_string_lossy();
            if s.starts_with('.') && s != "." && s != ".." {
                return true;
            }
        }
    }
    false
}

#[cfg(target_os = "macos")]
pub fn is_macos_hidden(path: &Path) -> bool {
    use std::os::darwin::fs::MetadataExt;
    const UF_HIDDEN: u32 = 0x0000_8000;
    std::fs::symlink_metadata(path)
        .map(|meta| meta.st_flags() & UF_HIDDEN != 0)
        .unwrap_or(false)
}

#[cfg(not(target_os = "macos"))]
pub fn is_macos_hidden(_path: &Path) -> bool {
    false
}

pub fn is_hidden(path: &Path) -> bool {
    has_hidden_path_component(path) || is_macos_hidden(path)
}
