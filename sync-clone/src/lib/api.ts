import { invoke } from "@tauri-apps/api/core";
import type {
  DiffEntryDto,
  SyncPlanDto,
  SyncResultDto,
  SyncMode,
  LogEntry,
} from "./types";

export async function scanFolders(
  leftPath: string,
  rightPath: string
): Promise<DiffEntryDto[]> {
  return invoke("scan_folders", {
    leftPath,
    rightPath,
  });
}

export async function createSyncPlan(
  leftPath: string,
  rightPath: string,
  mode: SyncMode,
  diffs: DiffEntryDto[]
): Promise<SyncPlanDto> {
  return invoke("create_sync_plan", {
    leftPath,
    rightPath,
    mode,
    diffs,
  });
}

export async function executeSyncPlan(
  plan: SyncPlanDto
): Promise<SyncResultDto> {
  return invoke("execute_sync_plan", {
    plan,
  });
}

export async function saveLogFile(
  logEntries: LogEntry[]
): Promise<string> {
  return invoke("save_log_file", {
    logEntries,
  });
}
