use std::path::PathBuf;
use std::fs;
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::sync_engine;

#[derive(Debug, Serialize, Deserialize)]
pub struct DiffEntryDto {
    pub relative_path: String,
    pub left: Option<FileEntryDto>,
    pub right: Option<FileEntryDto>,
    pub kind: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileEntryDto {
    pub path: String,
    pub relative_path: String,
    pub size: u64,
    pub modified: Option<String>,
    pub is_dir: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncActionItemDto {
    pub action: String,
    pub relative_path: String,
    pub source: Option<String>,
    pub target: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncPlanDto {
    pub actions: Vec<SyncActionItemDto>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncResultDto {
    pub success_count: usize,
    pub error_count: usize,
    pub errors: Vec<SyncErrorItemDto>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncErrorItemDto {
    pub error_type: String,
    pub message: String,
    pub path: Option<String>,
}

// App State
pub struct AppState {
    pub left_path: Option<PathBuf>,
    pub right_path: Option<PathBuf>,
}

fn path_to_string(p: &std::path::Path) -> String {
    p.to_string_lossy().to_string()
}

fn option_systemtime_to_iso(t: Option<std::time::SystemTime>) -> Option<String> {
    t.and_then(|t| {
        let duration = t.duration_since(std::time::UNIX_EPOCH).ok()?;
        let total_secs = duration.as_secs();
        let secs = total_secs % 60;
        let mins = (total_secs / 60) % 60;
        let hours = (total_secs / 3600) % 24;
        let days = total_secs / 86400;
        Some(format!("{}d {:02}:{:02}:{:02}", days, hours, mins, secs))
    })
}

/// DTO-Hilfsfunktionen
fn file_entry_to_dto(e: &sync_engine::types::FileEntry) -> FileEntryDto {
    FileEntryDto {
        path: path_to_string(&e.path),
        relative_path: path_to_string(&e.relative_path),
        size: e.size,
        modified: option_systemtime_to_iso(e.modified),
        is_dir: e.is_dir,
    }
}

#[tauri::command]
pub async fn scan_folders(
    left_path: String,
    right_path: String,
) -> Result<Vec<DiffEntryDto>, String> {
    let left_root = PathBuf::from(&left_path);
    let right_root = PathBuf::from(&right_path);

    let diffs = sync_engine::scan_and_diff(&left_root, &right_root)
        .map_err(|e| e.to_string())?;

    let dtos = diffs
        .into_iter()
        .map(|d| DiffEntryDto {
            relative_path: path_to_string(&d.relative_path),
            left: d.left.as_ref().map(file_entry_to_dto),
            right: d.right.as_ref().map(file_entry_to_dto),
            kind: format!("{:?}", d.kind),
        })
        .collect();

    Ok(dtos)
}

#[tauri::command]
pub async fn create_sync_plan(
    left_path: String,
    right_path: String,
    mode: String,
    diffs: Vec<DiffEntryDto>,
) -> Result<SyncPlanDto, String> {
    let sync_mode = match mode.as_str() {
        "mirror" => sync_engine::types::SyncMode::Mirror,
        _ => sync_engine::types::SyncMode::Update,
    };

    // DTOs zurück in Domain-Types konvertieren
    let domain_diffs = diffs
        .into_iter()
        .map(|d| {
            let kind = match d.kind.as_str() {
                "OnlyLeft" => sync_engine::types::DiffKind::OnlyLeft,
                "OnlyRight" => sync_engine::types::DiffKind::OnlyRight,
                "Modified" => sync_engine::types::DiffKind::Modified,
                _ => sync_engine::types::DiffKind::Equal,
            };

            let left_entry = d.left.map(|f| sync_engine::types::FileEntry {
                path: PathBuf::from(&f.path),
                relative_path: PathBuf::from(&f.relative_path),
                size: f.size,
                modified: None, // Wir brauchen modified nicht für den Plan
                is_dir: f.is_dir,
            });

            let right_entry = d.right.map(|f| sync_engine::types::FileEntry {
                path: PathBuf::from(&f.path),
                relative_path: PathBuf::from(&f.relative_path),
                size: f.size,
                modified: None,
                is_dir: f.is_dir,
            });

            sync_engine::types::DiffEntry {
                relative_path: PathBuf::from(&d.relative_path),
                left: left_entry,
                right: right_entry,
                kind,
            }
        })
        .collect();

    let left_root = PathBuf::from(&left_path);
    let right_root = PathBuf::from(&right_path);

    let plan = sync_engine::create_sync_plan(&left_root, &right_root, domain_diffs, &sync_mode)
        .map_err(|e| e.to_string())?;

    let dtos = plan
        .actions
        .into_iter()
        .map(|a| SyncActionItemDto {
            action: format!("{:?}", a.action),
            relative_path: path_to_string(&a.relative_path),
            source: a.source.map(|p| path_to_string(&p)),
            target: a.target.map(|p| path_to_string(&p)),
        })
        .collect();

    Ok(SyncPlanDto { actions: dtos })
}

#[tauri::command]
pub async fn execute_sync_plan(plan: SyncPlanDto) -> Result<SyncResultDto, String> {
    let domain_actions = plan
        .actions
        .into_iter()
        .map(|a| {
            let action = match a.action.as_str() {
                "CopyLeftToRight" => sync_engine::types::SyncAction::CopyLeftToRight,
                "DeleteRight" => sync_engine::types::SyncAction::DeleteRight,
                _ => sync_engine::types::SyncAction::Skip,
            };

            sync_engine::types::SyncActionItem {
                action,
                relative_path: PathBuf::from(&a.relative_path),
                source: a.source.map(PathBuf::from),
                target: a.target.map(PathBuf::from),
            }
        })
        .collect();

    let plan_domain = sync_engine::types::SyncPlan {
        actions: domain_actions,
    };

    let result = sync_engine::execute_sync_plan(plan_domain, None);

    Ok(SyncResultDto {
        success_count: result.success_count,
        error_count: result.error_count,
        errors: result
            .errors
            .into_iter()
            .map(|e| SyncErrorItemDto {
                error_type: e.error_type,
                message: e.message,
                path: e.path,
            })
            .collect(),
    })
}

#[tauri::command]
pub async fn save_log_file(
    app_handle: tauri::AppHandle,
    log_entries: Vec<LogEntryDto>,
) -> Result<String, String> {
    let now = std::time::SystemTime::now();
    let duration = now.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    let secs = duration.as_secs();
    let date_str = format!(
        "{:04}-{:02}-{:02}_{:02}-{:02}-{:02}",
        1970 + (secs / 31536000),
        ((secs % 31536000) / 2592000) + 1,
        ((secs % 2592000) / 86400) + 1,
        (secs / 3600) % 24,
        (secs / 60) % 60,
        secs % 60,
    );

    let log_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("App-Data-Dir nicht gefunden: {}", e))?
        .join("logs");

    fs::create_dir_all(&log_dir)
        .map_err(|e| format!("Log-Ordner konnte nicht erstellt werden: {}", e))?;

    let log_path = log_dir.join(format!("sync_{}.log", date_str));

    let mut content = String::from("=== MiraFileSync Log ===\n\n");
    for entry in &log_entries {
        content.push_str(&format!(
            "[{}] [{}] {}\n",
            entry.timestamp,
            entry.level.to_uppercase(),
            entry.message
        ));
    }

    fs::write(&log_path, &content)
        .map_err(|e| format!("Log-Datei konnte nicht geschrieben werden: {}", e))?;

    Ok(log_path.to_string_lossy().to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LogEntryDto {
    pub timestamp: String,
    pub message: String,
    pub level: String,
}
