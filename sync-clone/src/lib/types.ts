export interface FileEntryDto {
  path: string;
  relative_path: string;
  size: number;
  modified: string | null;
  is_dir: boolean;
}

export type DiffKindDto = "OnlyLeft" | "OnlyRight" | "Modified" | "Equal";

export interface DiffEntryDto {
  relative_path: string;
  left: FileEntryDto | null;
  right: FileEntryDto | null;
  kind: DiffKindDto;
}

export type SyncActionDto = "CopyLeftToRight" | "DeleteRight" | "Skip";

export interface SyncActionItemDto {
  action: SyncActionDto;
  relative_path: string;
  source: string | null;
  target: string | null;
}

export interface SyncPlanDto {
  actions: SyncActionItemDto[];
}

export interface SyncErrorItemDto {
  error_type: string;
  message: string;
  path: string | null;
}

export interface SyncResultDto {
  success_count: number;
  error_count: number;
  errors: SyncErrorItemDto[];
}

export type SyncMode = "update" | "mirror";

export interface LogEntry {
  timestamp: string;
  message: string;
  level: "info" | "warn" | "error";
}
