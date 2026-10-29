use std::path::Path;

use super::errors::SyncError;
use super::types::{DiffEntry, DiffKind, SyncAction, SyncActionItem, SyncMode, SyncPlan};

pub struct Planner;

impl Planner {
    pub fn create_plan(
        left_root: &Path,
        right_root: &Path,
        diffs: Vec<DiffEntry>,
        mode: &SyncMode,
    ) -> Result<SyncPlan, SyncError> {
        let mut actions = Vec::new();

        for diff in diffs {
            let action = match (&diff.kind, mode) {
                (DiffKind::OnlyLeft, _) => SyncAction::CopyLeftToRight,
                (DiffKind::OnlyRight, SyncMode::Mirror) => SyncAction::DeleteRight,
                (DiffKind::OnlyRight, SyncMode::Update) => SyncAction::Skip,
                (DiffKind::Modified, _) => SyncAction::CopyLeftToRight,
                (DiffKind::Equal, _) => SyncAction::Skip,
            };

            let source = match action {
                SyncAction::CopyLeftToRight => Some(left_root.join(&diff.relative_path)),
                _ => None,
            };

            let target = match action {
                SyncAction::CopyLeftToRight | SyncAction::DeleteRight => {
                    Some(right_root.join(&diff.relative_path))
                }
                _ => None,
            };

            // Sicherheitscheck: Ziel muss innerhalb des rechten Root sein
            if let Some(ref t) = target {
                if !t.starts_with(right_root) {
                    return Err(SyncError::PathTraversal {
                        path: t.clone(),
                    });
                }
            }

            actions.push(SyncActionItem {
                action,
                relative_path: diff.relative_path,
                source,
                target,
            });
        }

        Ok(SyncPlan { actions })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::UNIX_EPOCH;

    fn make_diff(path: &str, kind: DiffKind) -> DiffEntry {
        let fe = || -> super::super::types::FileEntry {
            super::super::types::FileEntry {
                path: PathBuf::from(path),
                relative_path: PathBuf::from(path),
                size: 100,
                modified: Some(UNIX_EPOCH),
                is_dir: false,
            }
        };

        let (left, right) = match &kind {
            DiffKind::OnlyLeft => (Some(fe()), None),
            DiffKind::OnlyRight => (None, Some(fe())),
            DiffKind::Modified => (Some(fe()), Some(fe())),
            DiffKind::Equal => (Some(fe()), Some(fe())),
        };

        DiffEntry {
            relative_path: PathBuf::from(path),
            left,
            right,
            kind,
        }
    }

    #[test]
    fn test_plan_mirror_deletes_right() {
        let diffs = vec![make_diff("only_right.txt", DiffKind::OnlyRight)];
        let plan = Planner::create_plan(
            Path::new("/left"),
            Path::new("/right"),
            diffs,
            &SyncMode::Mirror,
        )
        .unwrap();
        assert_eq!(plan.actions.len(), 1);
        assert_eq!(plan.actions[0].action, SyncAction::DeleteRight);
    }

    #[test]
    fn test_plan_update_skips_right() {
        let diffs = vec![make_diff("only_right.txt", DiffKind::OnlyRight)];
        let plan = Planner::create_plan(
            Path::new("/left"),
            Path::new("/right"),
            diffs,
            &SyncMode::Update,
        )
        .unwrap();
        assert_eq!(plan.actions.len(), 1);
        assert_eq!(plan.actions[0].action, SyncAction::Skip);
    }

    #[test]
    fn test_plan_mirror_copies_left() {
        let diffs = vec![make_diff("only_left.txt", DiffKind::OnlyLeft)];
        let plan = Planner::create_plan(
            Path::new("/left"),
            Path::new("/right"),
            diffs,
            &SyncMode::Mirror,
        )
        .unwrap();
        assert_eq!(plan.actions[0].action, SyncAction::CopyLeftToRight);
    }

    #[test]
    fn test_plan_modified_copies_left() {
        let diffs = vec![make_diff("modified.txt", DiffKind::Modified)];
        let plan = Planner::create_plan(
            Path::new("/left"),
            Path::new("/right"),
            diffs,
            &SyncMode::Update,
        )
        .unwrap();
        assert_eq!(plan.actions[0].action, SyncAction::CopyLeftToRight);
    }

    #[test]
    fn test_plan_equal_skips() {
        let diffs = vec![make_diff("equal.txt", DiffKind::Equal)];
        let plan = Planner::create_plan(
            Path::new("/left"),
            Path::new("/right"),
            diffs,
            &SyncMode::Mirror,
        )
        .unwrap();
        assert_eq!(plan.actions[0].action, SyncAction::Skip);
    }
}
