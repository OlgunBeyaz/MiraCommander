use std::fs;
use std::path::Path;
use std::time::SystemTime;
use tracing;

use super::errors::SyncError;
use super::types::{SyncAction, SyncActionItem, SyncPlan, SyncProgress, SyncResult, SyncErrorItem};

pub struct Executor;

impl Executor {
    pub fn execute(
        plan: SyncPlan,
        progress_sender: Option<std::sync::mpsc::Sender<SyncProgress>>,
    ) -> SyncResult {
        let total = plan.actions.len();
        let mut success_count = 0usize;
        let mut errors: Vec<SyncError> = Vec::new();

        for (i, item) in plan.actions.into_iter().enumerate() {
            let action_label = match item.action {
                SyncAction::CopyLeftToRight => "Kopieren",
                SyncAction::DeleteRight => "Löschen",
                SyncAction::Skip => "Überspringen",
            };

            if let Some(ref sender) = progress_sender {
                let _ = sender.send(SyncProgress {
                    current: i + 1,
                    total,
                    relative_path: item.relative_path.to_string_lossy().to_string(),
                    action: action_label.to_string(),
                });
            }

            match item.action {
                SyncAction::CopyLeftToRight => {
                    if let Err(e) = execute_copy(&item) {
                        tracing::error!("{}", e);
                        errors.push(SyncError::CopyFailed {
                            from: item.source.clone().unwrap_or_default(),
                            to: item.target.clone().unwrap_or_default(),
                            reason: e.to_string(),
                        }
                        .into());
                        continue;
                    }
                    tracing::info!(
                        "Kopiert: {} -> {}",
                        item.source.as_ref().map(|p| p.display().to_string()).unwrap_or_default(),
                        item.target.as_ref().map(|p| p.display().to_string()).unwrap_or_default()
                    );
                    success_count += 1;
                }
                SyncAction::DeleteRight => {
                    if let Some(ref target) = item.target {
                        if target.exists() {
                            if let Err(e) = execute_delete(target) {
                                errors.push(SyncError::DeleteFailed {
                                    path: target.clone(),
                                    reason: e.to_string(),
                                }
                                .into());
                                continue;
                            }
                            tracing::info!("Gelöscht: {}", target.display());
                        }
                    }
                    success_count += 1;
                }
                SyncAction::Skip => {
                    success_count += 1;
                }
            }
        }

        let error_items: Vec<SyncErrorItem> = errors.into_iter().map(|e| SyncErrorItem::from(e)).collect();
        SyncResult {
            success_count,
            error_count: error_items.len(),
            errors: error_items,
        }
    }
}

fn execute_copy(item: &SyncActionItem) -> Result<(), std::io::Error> {
    let source = item.source.as_ref().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "Keine Quelle angegeben")
    })?;
    let target = item.target.as_ref().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "Kein Ziel angegeben")
    })?;

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }

    // Metadaten vor dem Kopieren sichern
    let modified = fs::metadata(source)?.modified().ok();

    fs::copy(source, target)?;

    // Timestamp auf Ziel setzen
    if let Some(mtime) = modified {
        let _ = set_file_times(target, mtime);
    }

    Ok(())
}

fn execute_delete(path: &Path) -> Result<(), std::io::Error> {
    if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

fn set_file_times(path: &Path, time: SystemTime) -> Result<(), std::io::Error> {
    let ft = filetime::FileTime::from_system_time(time);
    filetime::set_file_mtime(path, ft).ok();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    use std::sync::atomic::{AtomicU32, Ordering};
    static TEST_COUNTER: AtomicU32 = AtomicU32::new(0);

    fn setup_test_env() -> (PathBuf, PathBuf) {
        let counter = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let base = std::env::temp_dir().join(format!("sync_clone_test_exec_{}_{}", std::process::id(), counter));
        let left = base.join("left");
        let right = base.join("right");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&left).unwrap();
        fs::create_dir_all(&right).unwrap();
        (left, right)
    }

    #[test]
    fn test_executor_copy_file() {
        let (left, right) = setup_test_env();
        let source_file = left.join("test.txt");
        fs::write(&source_file, b"hello").unwrap();

        let plan = SyncPlan {
            actions: vec![SyncActionItem {
                action: SyncAction::CopyLeftToRight,
                relative_path: PathBuf::from("test.txt"),
                source: Some(source_file.clone()),
                target: Some(right.join("test.txt")),
            }],
        };

        let result = Executor::execute(plan, None);
        assert_eq!(result.success_count, 1);
        assert_eq!(result.error_count, 0);
        assert!(right.join("test.txt").exists());
        let _ = fs::remove_dir_all(left.parent().unwrap());
    }

    #[test]
    fn test_executor_delete_file() {
        let (left, right) = setup_test_env();
        let target_file = right.join("to_delete.txt");
        fs::write(&target_file, b"delete me").unwrap();

        let plan = SyncPlan {
            actions: vec![SyncActionItem {
                action: SyncAction::DeleteRight,
                relative_path: PathBuf::from("to_delete.txt"),
                source: None,
                target: Some(target_file.clone()),
            }],
        };

        let result = Executor::execute(plan, None);
        assert_eq!(result.success_count, 1);
        assert!(!target_file.exists());
        let _ = fs::remove_dir_all(left.parent().unwrap());
    }
}
