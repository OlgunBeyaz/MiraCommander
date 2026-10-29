use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SyncError {
    #[error("Scannen fehlgeschlagen: {0}")]
    ScanFailed(String),

    #[error("Datei nicht lesbar: {path} – {reason}")]
    FileNotReadable { path: PathBuf, reason: String },

    #[error("Kopieren fehlgeschlagen: von {from} nach {to} – {reason}")]
    CopyFailed { from: PathBuf, to: PathBuf, reason: String },

    #[error("Löschen fehlgeschlagen: {path} – {reason}")]
    DeleteFailed { path: PathBuf, reason: String },

    #[error("Path Traversal erkannt: {path}")]
    PathTraversal { path: PathBuf },

    #[error("Sync-Plan ungültig: {0}")]
    InvalidPlan(String),

    #[error("Ordner nicht gefunden: {0}")]
    FolderNotFound(PathBuf),

    #[error("Symbolischer Link übersprungen: {path}")]
    SymlinkSkipped { path: PathBuf },
}

fn error_type_name(e: &SyncError) -> &'static str {
    match e {
        SyncError::ScanFailed(_) => "ScanFailed",
        SyncError::FileNotReadable { .. } => "FileNotReadable",
        SyncError::CopyFailed { .. } => "CopyFailed",
        SyncError::DeleteFailed { .. } => "DeleteFailed",
        SyncError::PathTraversal { .. } => "PathTraversal",
        SyncError::InvalidPlan(_) => "InvalidPlan",
        SyncError::FolderNotFound(_) => "FolderNotFound",
        SyncError::SymlinkSkipped { .. } => "SymlinkSkipped",
    }
}

impl From<SyncError> for crate::sync_engine::types::SyncErrorItem {
    fn from(e: SyncError) -> Self {
        let path = match &e {
            SyncError::FileNotReadable { path, .. } => Some(path.to_string_lossy().to_string()),
            SyncError::CopyFailed { from, .. } => Some(from.to_string_lossy().to_string()),
            SyncError::DeleteFailed { path, .. } => Some(path.to_string_lossy().to_string()),
            SyncError::PathTraversal { path } => Some(path.to_string_lossy().to_string()),
            SyncError::SymlinkSkipped { path } => Some(path.to_string_lossy().to_string()),
            _ => None,
        };
        crate::sync_engine::types::SyncErrorItem {
            error_type: error_type_name(&e).to_string(),
            message: e.to_string(),
            path,
        }
    }
}
