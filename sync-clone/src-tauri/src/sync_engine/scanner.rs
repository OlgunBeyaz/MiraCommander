use std::fs;
use std::path::Path;
use tracing;

use super::errors::SyncError;
use super::types::FileEntry;

pub struct Scanner;

impl Scanner {
    pub fn scan_folder(root: &Path) -> Result<Vec<FileEntry>, SyncError> {
        if !root.exists() {
            return Err(SyncError::FolderNotFound(root.to_path_buf()));
        }
        if !root.is_dir() {
            return Err(SyncError::ScanFailed(format!(
                "Pfad ist kein Ordner: {}",
                root.display()
            )));
        }

        let mut entries = Vec::new();
        scan_dir_recursive(root, root, &mut entries)?;
        entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
        Ok(entries)
    }
}

fn scan_dir_recursive(
    root: &Path,
    dir: &Path,
    entries: &mut Vec<FileEntry>,
) -> Result<(), SyncError> {
    let read_dir = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) => {
            tracing::warn!("Ordner nicht lesbar: {} - {}", dir.display(), e);
            return Ok(());
        }
    };

    for entry in read_dir {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                tracing::warn!("Eintrag nicht lesbar in {}: {}", dir.display(), e);
                continue;
            }
        };

        let path = entry.path();

        // Symlinks im MVP nicht folgen
        if path.is_symlink() {
            tracing::debug!("Symlink übersprungen: {}", path.display());
            continue;
        }

        let metadata = match fs::metadata(&path) {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!("Metadaten nicht lesbar: {} - {}", path.display(), e);
                continue;
            }
        };

        let relative_path = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_path_buf();

        if metadata.is_dir() {
            entries.push(FileEntry {
                path: path.clone(),
                relative_path: relative_path.clone(),
                size: 0,
                modified: metadata.modified().ok(),
                is_dir: true,
            });
            scan_dir_recursive(root, &path, entries)?;
        } else {
            entries.push(FileEntry {
                path: path.clone(),
                relative_path: relative_path.clone(),
                size: metadata.len(),
                modified: metadata.modified().ok(),
                is_dir: false,
            });
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::fs;

    fn setup_test_dir(name: &str, files: &[&str]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sync_clone_test_{}", name));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        for f in files {
            let path = dir.join(f);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(&path, b"test").unwrap();
        }
        dir
    }

    #[test]
    fn test_scanner_finds_all_files() {
        let dir = setup_test_dir("scanner_all", &["a.txt", "sub/b.txt", "sub/c.txt"]);
        let entries = Scanner::scan_folder(&dir).unwrap();
        // Verify our files are found (macOS may create .DS_Store etc.)
        let names: Vec<_> = entries.iter().map(|e| e.relative_path.to_string_lossy().to_string()).collect();
        assert!(names.contains(&"a.txt".to_string()), "missing a.txt in {:?}", names);
        assert!(names.contains(&"sub/b.txt".to_string()), "missing sub/b.txt in {:?}", names);
        assert!(names.contains(&"sub/c.txt".to_string()), "missing sub/c.txt in {:?}", names);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_scanner_empty_folder() {
        let dir = setup_test_dir("scanner_empty", &[]);
        let entries = Scanner::scan_folder(&dir).unwrap();
        assert_eq!(entries.len(), 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_scanner_nonexistent_folder() {
        let result = Scanner::scan_folder(Path::new("/nonexistent_path_xyz"));
        assert!(result.is_err());
    }
}
