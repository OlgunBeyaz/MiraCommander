use std::path::Path;

use crate::sync_engine::{scanner::Scanner, errors::SyncError, types::FileEntry};

pub struct LocalFs;

impl LocalFs {
    pub fn scan(path: &Path) -> Result<Vec<FileEntry>, SyncError> {
        Scanner::scan_folder(path)
    }
}
