# MiraFileSync – Technische Dokumentation

> **Projekt:** FreeFileSync Clone – Cross-Platform Desktop App  
> **Status:** MVP  
> **Platforms:** macOS, Windows, Linux  
> **Stack:** Rust + Tauri + Svelte + TypeScript

---

## 1. Architektur-Übersicht

```
┌─────────────────────────────────────────────────┐
│  UI Layer (Svelte + TypeScript)                 │
│  ───────────────────────────────────────────    │
│  App.svelte  →  Components  →  api.ts           │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │  Tauri IPC Bridge (invoke)               │   │
│  │  JSON (de)serialization an der Grenze    │   │
│  └──────────────────────────────────────────┘   │
├─────────────────────────────────────────────────┤
│  Rust Core Layer                                │
│  ───────────────────────────────────────────    │
│  commands.rs  (Tauri Commands)                   │
│       │                                          │
│       ├── sync_engine/  (Scanner, Differ, ...)   │
│       ├── storage/      (später SQLite)          │
│       └── adapters/     (local_fs, später mehr)  │
└─────────────────────────────────────────────────┘
```

**Trennung der Concerns:**

- **UI** enthält **keine** Dateisystemlogik
- **UI** ruft ausschließlich **Tauri Commands** auf (`invoke`)
- **Sync-Logik** lebt vollständig im **Rust-Core**
- **Rust-Enums** werden nur an der Tauri-Grenze in **Strings** umgewandelt

---

## 2. Technologie-Stack

| Komponente        | Technologie                     | Begründung                                    |
|-------------------|---------------------------------|-----------------------------------------------|
| **Core**          | Rust                            | Performant, sicher, plattformunabhängig       |
| **Desktop-Framework** | Tauri v2                    | Leichtgewichtig, native Fenster, Rust-IPC     |
| **Frontend**      | Svelte 5 + TypeScript           | Reaktiv, kleine Bundle-Größe, typsicher        |
| **Build-System**  | Tauri Bundler (`tauri build`)   | Cross-Platform Builds inkl. Installer          |
| **Logging**       | `tracing` crate                 | Strukturiertes Logging, UI-Anbindung           |
| **Fehler**        | `thiserror` crate               | Typsichere Fehler, einfache Conversion         |
| **Datenbank**     | SQLite (später, via `rusqlite`) | Persistenz für Profile/History                |
| **Hashing**       | `blake3` (später)               | Performantes Hashing für Content-Vergleich    |
| **Dateiüberwachung** | `notify` crate (später)      | Echtzeit-Änderungsüberwachung                 |

---

## 3. Projektstruktur

```
sync-clone/
│
├── src/                              # Svelte Frontend
│   ├── App.svelte                    # Root-Komponente, Layout
│   ├── main.ts                       # Svelte Entry Point
│   ├── lib/
│   │   ├── api.ts                    # Tauri invoke-Wrapper
│   │   └── types.ts                  # TypeScript DTOs
│   └── components/
│       ├── FolderPicker.svelte       # Ordnerauswahl (links/rechts)
│       ├── CompareButton.svelte      # Compare-Trigger
│       ├── DiffTable.svelte          # Differenz-Tabelle
│       ├── SyncPreview.svelte        # Sync-Plan-Vorschau
│       └── LogPanel.svelte           # Log-Ausgabe
│
├── src-tauri/
│   ├── Cargo.toml                    # Rust-Abhängigkeiten
│   ├── tauri.conf.json               # Tauri-Konfiguration
│   ├── capabilities/                 # Tauri-Permissions
│   ├── src/
│   │   ├── main.rs                   # Tauri-App-Einstieg
│   │   ├── commands.rs              # Tauri-Commands (IPC-Grenze)
│   │   │
│   │   ├── sync_engine/              # Sync-Kern (vollständig in Rust)
│   │   │   ├── mod.rs               # Modul-Wurzeln, sync_engine()-Funktion
│   │   │   ├── types.rs             # FileEntry, DiffEntry, SyncAction, ...
│   │   │   ├── scanner.rs           # Rekursiver Ordner-Scanner
│   │   │   ├── differ.rs            # Diff-Logik: links vs rechts
│   │   │   ├── planner.rs           # Sync-Plan aus Diff erstellen
│   │   │   ├── executor.rs          # Sync-Plan ausführen
│   │   │   └── errors.rs            # Fehlertypen (thiserror)
│   │   │
│   │   ├── storage/                  # Persistenz (später)
│   │   │   ├── mod.rs
│   │   │   └── sqlite.rs            # SQLite-Zugriff (Reserve)
│   │   │
│   │   └── adapters/                 # Dateisystem-Zugriff (austauschbar)
│   │       ├── mod.rs
│   │       └── local_fs.rs           # Lokales Dateisystem
│   │
│   └── icons/                        # App-Icons
│
├── package.json                      # Node-Abhängigkeiten (Svelte)
├── svelte.config.js                  # Svelte-Konfiguration
├── vite.config.ts                    # Vite-Konfiguration
├── tsconfig.json                     # TypeScript-Konfiguration
└── technik.md                        # Diese Datei
```

---

## 4. Rust-Datenmodelle

### `FileEntry`

```rust
pub struct FileEntry {
    pub path: PathBuf,           // Absoluter Pfad
    pub relative_path: PathBuf,  // Relativ zum Basis-Ordner
    pub size: u64,               // Dateigröße in Bytes
    pub modified: Option<SystemTime>,  // Änderungszeitpunkt
    pub is_dir: bool,            // Ist es ein Verzeichnis?
}
```

### `DiffKind`

```rust
pub enum DiffKind {
    OnlyLeft,    // Datei existiert nur links
    OnlyRight,   // Datei existiert nur rechts
    Modified,    // Auf beiden Seiten, aber unterschiedlich
    Equal,       // Auf beiden Seiten, identisch
}
```

### `DiffEntry`

```rust
pub struct DiffEntry {
    pub relative_path: PathBuf,
    pub left: Option<FileEntry>,
    pub right: Option<FileEntry>,
    pub kind: DiffKind,
}
```

### `SyncAction`

```rust
pub enum SyncAction {
    CopyLeftToRight,  // Datei von links nach rechts kopieren
    DeleteRight,      // Datei auf rechter Seite löschen
    Skip,             // Keine Aktion nötig
}
```

### `SyncActionItem`

```rust
pub struct SyncActionItem {
    pub action: SyncAction,
    pub relative_path: PathBuf,
    pub source: Option<PathBuf>,   // Quellpfad (absolut, wenn vorhanden)
    pub target: Option<PathBuf>,   // Zielpfad (absolut, wenn vorhanden)
}
```

### `SyncPlan`

```rust
pub struct SyncPlan {
    pub actions: Vec<SyncActionItem>,
}
```

---

## 5. Tauri Commands

| Command             | Parameter                        | Rückgabe             | Beschreibung                        |
|---------------------|----------------------------------|----------------------|-------------------------------------|
| `scan_folders`      | `left_path: String`              | `Vec<DiffEntryDto>`  | Scannt beide Ordner und liefert Diff|
|                     | `right_path: String`             |                      |                                     |
| `create_sync_plan`  | `left_path: String`              | `SyncPlanDto`        | Erstellt Sync-Plan aus Diff         |
|                     | `right_path: String`             |                      |                                     |
|                     | `mode: String` ("update"/"mirror")|                      |                                     |
| `execute_sync_plan` | `plan: SyncPlanDto`              | `SyncResultDto`      | Führt Sync-Plan aus                 |

> **Hinweis:** `select_folder` entfällt im MVP – die UI nutzt `rfd` (Rust File Dialog) oder das Native `<input type="file">` von HTML. Im MVP wird der Pfad per Texteingabe + bestätigtem Tauri Command gesetzt.

---

## 6. Sync-Logik (Rust Core)

### 6.1 Scanner (`scanner.rs`)

- Läuft auf einem `tokio::task::spawn_blocking`-Thread
- Läuft **beide** Ordner parallel (zwei unabhängige Aufrufe)
- Rekursives Einlesen über `walkdir`-ähnliche Logik
- Sammelt **alle** Dateien inkl. versteckter (keine `.ignore`)
- Filtert nur absolute Pfad-Traversale (Sicherheit)
- Bei Fehlern pro Datei: Eintrag mit Fehler, kein Abbruch
- Abbruch nur bei: Ordner existiert nicht, kein Zugriff auf Basis

**Ausgabe:** `Vec<FileEntry>` nach Pfad sortiert

### 6.2 Differ (`differ.rs`)

- Baut `HashMap<relative_path, FileEntry>` für jede Seite
- Iteriert über die Schlüssel beider Maps
- Logik pro relativem Pfad:

| Links vorhanden | Rechts vorhanden | Action                     |
|-----------------|------------------|----------------------------|
| Ja              | Nein             | `DiffKind::OnlyLeft`       |
| Nein            | Ja               | `DiffKind::OnlyRight`      |
| Ja              | Ja               | Vergleich: Größe + modified |
|                 |                  | → gleich: `Equal`          |
|                 |                  | → ungleich: `Modified`     |

### 6.3 Planner (`planner.rs`)

Aus Diff-Entries → SyncPlan:

| DiffKind   | Update-Modus         | Mirror-Modus         |
|------------|----------------------|----------------------|
| OnlyLeft   | `CopyLeftToRight`    | `CopyLeftToRight`    |
| OnlyRight  | `Skip`               | `DeleteRight`        |
| Modified   | `CopyLeftToRight`    | `CopyLeftToRight`    |
| Equal      | `Skip`               | `Skip`               |

### 6.4 Executor (`executor.rs`)

- Iteriert über `SyncPlan.actions`
- Für jede `CopyLeftToRight`:
  - Prüft, ob Ziel-Verzeichnis existiert; falls nicht → erstellen
  - Kopiert Datei (z. B. `std::fs::copy`)
  - Setzt modified-Timestamp auf Ziel-Datei
- Für jede `DeleteRight`:
  - Prüft, ob Datei existiert
  - Löscht Datei (`std::fs::remove_file`)
- Sammelt Fehler pro Aktion in `Vec<SyncError>` → Setzt Sync nicht ab
- Bei `Skip`: keine Aktion
- Gibt Fortschritts-Events per `tracing::info!` zurück
- **Sicherheit:** Jeder Zielpfad wird validiert: muss innerhalb des rechten Basis-Ordners liegen

---

## 7. Fehlerbehandlung

**Fehlertypen (thiserror):**

```rust
#[derive(Debug, thiserror::Error)]
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
}
```

**Prinzipien:**

- `thiserror` für typsichere, dokumentierte Fehler
- Zugängliche Fehlermeldungen für die UI
- Ein Dateifehler stoppt **nie** den gesamten Sync
- Nur der Plan selbst kann invalid sein → dann Abbruch
- Path-Traversal-Prüfung auf **jeder** Aktion

---

## 8. TypeScript DTOs (Frontend)

```typescript
// types.ts
export interface FileEntryDto {
  path: string;
  relative_path: string;
  size: number;
  modified: string | null;  // ISO-String
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

export interface SyncErrorDto {
  error_type: string;
  message: string;
  path: string | null;
}

export interface SyncResultDto {
  success_count: number;
  error_count: number;
  errors: SyncErrorDto[];
}
```

---

## 9. Sicherheit

1. **Pfad-Normalisierung:**
   - Alle Zielpfade werden mit `path.canonicalize()` normalisiert
   - Vergleich mit Basis-Ordner via `target_path.starts_with(base_dir)`
   - Verhindert `../../` Escape-Angriffe

2. **Relative Pfade:**
   - Sync-Plan verwendet **relative** Pfade aus dem Scan
   - Erst bei Ausführung werden absolute Pfade gebildet
   - UI kann keine beliebigen Pfade in den Sync einbringen

3. **Vorschau-Pflicht:**
   - Vor Löschung muss die Aktion in der UI-Vorschau sichtbar sein
   - `DeleteRight` wird nie ohne vorherigen `create_sync_plan` ausgeführt

4. **Symlinks:**
   - Im MVP: Symlinks werden **nicht** gefolgt
   - `fs::metadata` statt `fs::symlink_metadata` → problematisch
   - `walkdir` mit `follow_links=false` (Default)

---

## 10. Erweiterbarkeit

Die Architektur ist auf spätere Module ausgelegt:

- **`storage/`** – SQLite-Persistenz für Profile, History, Einstellungen
- **`adapters/`** – Neue Adapter:
  - `ftp.rs` – FTP/SFTP-Zugriff (via `ssh2` oder `suppaftp`)
  - `cloud.rs` – Google Drive, OneDrive, ...
  - `smb.rs` – Netzwerkfreigaben
- **`sync_engine/`** – Neue Algorithmen:
  - Bi-direktionaler Sync
  - Content-basierter Vergleich via `blake3`
  - Konfliktlösung (letzter Schreibzugriff gewinnt, manuell, ...)
  - Erkennung von umbenannten/verschobenen Dateien

---

## 11. MVP-Funktionen

1. Lokale Ordnerauswahl (Texteingabe)
2. Rekursives Scannen beider Ordner
3. Datei-Vergleich anhand relativer Pfade
4. Diff-Erkennung: OnlyLeft, OnlyRight, Modified, Equal
5. Vorschau der Sync-Aktionen
6. One-Way Sync links → rechts (Update-Modus)
7. Mirror-Modus: Kopieren + Löschen rechts
8. Fortschrittsanzeige
9. Fehleranzeige pro Datei
10. Log-Panel in der UI

---

## 12. Test-Strategie

**Rust Unit Tests (`sync_engine`):**

1. `test_diff_only_left()` – Datei nur links
2. `test_diff_only_right()` – Datei nur rechts
3. `test_diff_identical()` – Identische Datei → Equal
4. `test_diff_modified()` – Gleicher Pfad, andere Größe → Modified
5. `test_plan_mirror_deletes_right()` – Mirror-Plan: Fehlen links → DeleteRight
6. `test_plan_update_skips_right()` – Update-Plan: Fehlen links → Skip

Weitere Tests:
- `test_executor_copy_file()` – Kopieren funktioniert
- `test_executor_delete_file()` – Löschen funktioniert
- `test_path_traversal_detected()` – Sicherheitscheck
- `test_scanner_empty_folder()` – Leerer Ordner
- `test_scanner_nested_files()` – Verschachtelte Ordnerstruktur

**Frontend:** (später) Playwright für E2E-Tests der UI.

---

## 13. Build & Run

```bash
# Entwicklung
pnpm install              # Node-Abhängigkeiten
pnpm tauri dev            # Entwicklung mit Hot Reload

# Production Build
pnpm tauri build          # Bundled App + Installer
```

**Voraussetzungen:**

- Rust Toolchain (rustup, stable)
- Node.js 20+ + pnpm
- Tauri System Dependencies (je nach OS: `webkit2gtk`, `libappindicator`, ...)

---

## 14. Nächste Schritte (Post-MVP)

1. **Content-Hashing** – `blake3` für echten Content-Vergleich (nicht nur Größe + Timestamp)
2. **Bi-direktionaler Sync** – Konflikterkennung und -auflösung
3. **SQLite-Datenbank** – Profile, Sync-History, Einstellungen
4. **RFD Dialoge** – Native Folder Picker statt Texteingabe
5. **Echtzeit-Überwachung** – `notify`-Crate für auto-sync
6. **Erweiterte Filter** – Dateimuster, Größenlimits, .gitignore-Respekt
7. **Cloud-Adapter** – Google Drive, Dropbox, Nextcloud
8. **Umbenennungs-Erkennung** – Heuristik für moved/renamed files
9. **Undo-Funktion** – Sync rückgängig machen
10. **Internationalisierung** – i18n für UI
