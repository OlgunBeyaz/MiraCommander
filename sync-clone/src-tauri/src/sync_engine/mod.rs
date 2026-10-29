pub mod types;
pub mod errors;
pub mod scanner;
pub mod differ;
pub mod planner;
pub mod executor;

use std::path::Path;
use std::sync::mpsc;

pub use types::*;

pub fn scan_and_diff(
    left_root: &Path,
    right_root: &Path,
) -> Result<Vec<DiffEntry>, errors::SyncError> {
    let left = scanner::Scanner::scan_folder(left_root)?;
    let right = scanner::Scanner::scan_folder(right_root)?;
    Ok(differ::Differ::diff(left, right))
}

pub fn create_sync_plan(
    left_root: &Path,
    right_root: &Path,
    diffs: Vec<DiffEntry>,
    mode: &SyncMode,
) -> Result<SyncPlan, errors::SyncError> {
    planner::Planner::create_plan(left_root, right_root, diffs, mode)
}

pub fn execute_sync_plan(
    plan: SyncPlan,
    progress_tx: Option<mpsc::Sender<SyncProgress>>,
) -> SyncResult {
    executor::Executor::execute(plan, progress_tx)
}
