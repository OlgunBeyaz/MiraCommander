use std::collections::HashMap;
use std::path::PathBuf;

use super::types::{DiffEntry, DiffKind, FileEntry};

pub struct Differ;

impl Differ {
    pub fn diff(left: Vec<FileEntry>, right: Vec<FileEntry>) -> Vec<DiffEntry> {
        let left_map: HashMap<PathBuf, FileEntry> = left
            .into_iter()
            .map(|e| (e.relative_path.clone(), e))
            .collect();

        let right_map: HashMap<PathBuf, FileEntry> = right
            .into_iter()
            .map(|e| (e.relative_path.clone(), e))
            .collect();

        let mut all_keys: Vec<PathBuf> = left_map
            .keys()
            .chain(right_map.keys())
            .cloned()
            .collect();
        all_keys.sort();
        all_keys.dedup();

        let mut results = Vec::with_capacity(all_keys.len());

        for key in all_keys {
            let left_entry = left_map.get(&key);
            let right_entry = right_map.get(&key);

            let kind = match (left_entry, right_entry) {
                (Some(_), None) => DiffKind::OnlyLeft,
                (None, Some(_)) => DiffKind::OnlyRight,
                (Some(l), Some(r)) => {
                    if l.size == r.size && l.modified == r.modified {
                        DiffKind::Equal
                    } else {
                        DiffKind::Modified
                    }
                }
                (None, None) => unreachable!(),
            };

            results.push(DiffEntry {
                relative_path: key,
                left: left_entry.cloned(),
                right: right_entry.cloned(),
                kind,
            });
        }

        results
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::UNIX_EPOCH;

    fn make_entry(path: &str, size: u64, modified_secs: u64) -> FileEntry {
        FileEntry {
            path: PathBuf::from(path),
            relative_path: PathBuf::from(path),
            size,
            modified: Some(UNIX_EPOCH + std::time::Duration::from_secs(modified_secs)),
            is_dir: false,
        }
    }

    #[test]
    fn test_diff_only_left() {
        let left = vec![make_entry("a.txt", 100, 1000)];
        let right = vec![];
        let result = Differ::diff(left, right);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].kind, DiffKind::OnlyLeft);
    }

    #[test]
    fn test_diff_only_right() {
        let left = vec![];
        let right = vec![make_entry("a.txt", 100, 1000)];
        let result = Differ::diff(left, right);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].kind, DiffKind::OnlyRight);
    }

    #[test]
    fn test_diff_identical() {
        let left = vec![make_entry("a.txt", 100, 1000)];
        let right = vec![make_entry("a.txt", 100, 1000)];
        let result = Differ::diff(left, right);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].kind, DiffKind::Equal);
    }

    #[test]
    fn test_diff_modified() {
        let left = vec![make_entry("a.txt", 100, 1000)];
        let right = vec![make_entry("a.txt", 200, 1000)];
        let result = Differ::diff(left, right);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].kind, DiffKind::Modified);
    }

    #[test]
    fn test_diff_modified_timestamp() {
        let left = vec![make_entry("a.txt", 100, 1000)];
        let right = vec![make_entry("a.txt", 100, 2000)];
        let result = Differ::diff(left, right);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].kind, DiffKind::Modified);
    }

    #[test]
    fn test_diff_mixed() {
        let left = vec![
            make_entry("only_left.txt", 100, 1000),
            make_entry("both_same.txt", 200, 2000),
            make_entry("both_diff.txt", 300, 3000),
        ];
        let right = vec![
            make_entry("only_right.txt", 400, 4000),
            make_entry("both_same.txt", 200, 2000),
            make_entry("both_diff.txt", 301, 3000),
        ];
        let result = Differ::diff(left, right);

        let kinds: Vec<_> = result.iter().map(|r| &r.kind).collect();
        assert_eq!(result.len(), 4);

        assert!(kinds.contains(&&DiffKind::OnlyLeft));
        assert!(kinds.contains(&&DiffKind::OnlyRight));
        assert!(kinds.contains(&&DiffKind::Equal));
        assert!(kinds.contains(&&DiffKind::Modified));
    }
}
