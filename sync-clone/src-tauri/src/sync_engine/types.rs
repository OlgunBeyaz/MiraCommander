use std::path::PathBuf;
use std::time::SystemTime;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: PathBuf,
    pub relative_path: PathBuf,
    pub size: u64,
    pub modified: Option<SystemTime>,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DiffKind {
    OnlyLeft,
    OnlyRight,
    Modified,
    Equal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffEntry {
    pub relative_path: PathBuf,
    pub left: Option<FileEntry>,
    pub right: Option<FileEntry>,
    pub kind: DiffKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SyncAction {
    CopyLeftToRight,
    DeleteRight,
    Skip,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncActionItem {
    pub action: SyncAction,
    pub relative_path: PathBuf,
    pub source: Option<PathBuf>,
    pub target: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncPlan {
    pub actions: Vec<SyncActionItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SyncMode {
    Update,
    Mirror,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncProgress {
    pub current: usize,
    pub total: usize,
    pub relative_path: String,
    pub action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncResult {
    pub success_count: usize,
    pub error_count: usize,
    pub errors: Vec<SyncErrorItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncErrorItem {
    pub error_type: String,
    pub message: String,
    pub path: Option<String>,
}
