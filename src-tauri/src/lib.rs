use globset::{Glob, GlobMatcher};
use serde::Serialize;
use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::UNIX_EPOCH,
};
use tauri::Emitter;

static CANCEL_FLAG: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CopyProgress {
    item_name: String,
    current: usize,
    total: usize,
    status: String, // "copying", "done", "skipped", "error"
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    name: String,
    path: String,
    is_dir: bool,
    is_symlink: bool,
    size: u64,
    modified: u64,
    hidden: bool,
    readonly: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Directory {
    path: String,
    parent: Option<String>,
    entries: Vec<Entry>,
}

#[derive(Serialize)]
struct Location {
    name: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiskSpaceInfo {
    total_bytes: u64,
    available_bytes: u64,
    used_bytes: u64,
}

#[tauri::command]
fn get_disk_space(path: String) -> Result<DiskSpaceInfo, String> {
    let p = Path::new(&path);
    // Use fs4 for cross-platform disk space calculation (Windows, Linux, macOS)
    if let Ok(total) = fs4::total_space(p) {
        if let Ok(available) = fs4::available_space(p) {
            let used = total.saturating_sub(available);
            return Ok(DiskSpaceInfo {
                total_bytes: total,
                available_bytes: available,
                used_bytes: used,
            });
        }
    }

    // Fallback to Unix libc statvfs if available
    #[cfg(unix)]
    {
        use std::ffi::CString;
        use std::mem::MaybeUninit;
        if let Ok(c_path) = CString::new(path.as_str()) {
            let mut stat: MaybeUninit<libc::statvfs> = MaybeUninit::uninit();
            let ret = unsafe { libc::statvfs(c_path.as_ptr(), stat.as_mut_ptr()) };
            if ret == 0 {
                let stat = unsafe { stat.assume_init() };
                let fragment_size = stat.f_frsize as u64;
                let total_bytes = stat.f_blocks as u64 * fragment_size;
                let available_bytes = stat.f_bavail as u64 * fragment_size;
                let used_bytes = total_bytes.saturating_sub(stat.f_bfree as u64 * fragment_size);
                return Ok(DiskSpaceInfo {
                    total_bytes,
                    available_bytes,
                    used_bytes,
                });
            }
        }
    }

    Ok(DiskSpaceInfo {
        total_bytes: 0,
        available_bytes: 0,
        used_bytes: 0,
    })
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn is_hidden(name: &str, path: &Path) -> bool {
    if name.starts_with('.') {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if let Ok(m) = fs::metadata(path) {
            return m.file_attributes() & 0x2 != 0;
        }
    }
    let _ = path;
    false
}

#[derive(serde::Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum ConflictMode {
    Overwrite,
    Skip,
    Error,
}

fn check_target(src: &Path, target: &Path, conflict: ConflictMode) -> Result<(), String> {
    if conflict == ConflictMode::Error && (target.exists() || target.symlink_metadata().is_ok()) {
        return Err(format!("Ziel existiert bereits: {}", target.display()));
    }
    let parent = target.parent().ok_or("Ungültiges Ziel")?;
    if !parent.is_dir() {
        return Err("Zielverzeichnis ist nicht vorhanden".into());
    }
    let src_abs = fs::canonicalize(src).unwrap_or_else(|_| src.to_path_buf());
    if parent.exists() {
        if let Ok(parent_abs) = fs::canonicalize(parent) {
            if src_abs.is_dir() && parent_abs.starts_with(&src_abs) {
                return Err("Ordner kann nicht in sich selbst kopiert oder verschoben werden".into());
            }
        }
    }
    Ok(())
}

fn count_items_to_copy(sources: &[String]) -> usize {
    use walkdir::WalkDir;
    let mut count = 0;
    for src in sources {
        let p = Path::new(src);
        if p.is_file() || p.is_symlink() {
            count += 1;
        } else if p.is_dir() {
            for _ in WalkDir::new(p).into_iter().filter_map(|e| e.ok()) {
                count += 1;
            }
        }
    }
    count.max(sources.len()).max(1)
}

fn copy_recursive(
    source: &Path,
    target: &Path,
    conflict: ConflictMode,
    cancel: &AtomicBool,
    app_handle: &tauri::AppHandle,
    progress_counter: &mut usize,
    total: usize,
) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        return Err("Operation abgebrochen".into());
    }

    let meta = match fs::symlink_metadata(source) {
        Ok(m) => m,
        Err(e) => {
            // Log skip instead of terminating whole transfer
            *progress_counter += 1;
            let _ = app_handle.emit(
                "file-copy-progress",
                CopyProgress {
                    item_name: source.file_name().unwrap_or_default().to_string_lossy().into_owned(),
                    current: *progress_counter,
                    total,
                    status: "skipped".into(),
                },
            );
            eprintln!("Konnte Metadaten nicht lesen für {}: {}", source.display(), e);
            return Ok(());
        }
    };

    let name = source.file_name().unwrap_or_default().to_string_lossy().into_owned();

    // Handle symlinks safely: re-create symlink or skip if error
    if meta.file_type().is_symlink() {
        if target.exists() || target.symlink_metadata().is_ok() {
            if conflict == ConflictMode::Skip {
                *progress_counter += 1;
                let _ = app_handle.emit(
                    "file-copy-progress",
                    CopyProgress {
                        item_name: name,
                        current: *progress_counter,
                        total,
                        status: "skipped".into(),
                    },
                );
                return Ok(());
            } else if conflict == ConflictMode::Overwrite {
                let _ = remove_path(target);
            }
        }

        #[cfg(unix)]
        {
            if let Ok(dest) = fs::read_link(source) {
                let _ = std::os::unix::fs::symlink(&dest, target);
            }
        }
        #[cfg(windows)]
        {
            if let Ok(dest) = fs::read_link(source) {
                if source.is_dir() {
                    let _ = std::os::windows::fs::symlink_dir(&dest, target);
                } else {
                    let _ = std::os::windows::fs::symlink_file(&dest, target);
                }
            }
        }

        *progress_counter += 1;
        let _ = app_handle.emit(
            "file-copy-progress",
            CopyProgress {
                item_name: name,
                current: *progress_counter,
                total,
                status: "done".into(),
            },
        );
        return Ok(());
    }

    if meta.is_dir() {
        if target.exists() {
            if !target.is_dir() {
                return Err(format!("Ziel existiert bereits und ist kein Ordner: {}", target.display()));
            }
        } else {
            fs::create_dir_all(target).map_err(err)?;
        }

        *progress_counter += 1;
        let _ = app_handle.emit(
            "file-copy-progress",
            CopyProgress {
                item_name: format!("{}/", name),
                current: *progress_counter,
                total,
                status: "done".into(),
            },
        );

        if let Ok(read_dir) = fs::read_dir(source) {
            for item in read_dir {
                if cancel.load(Ordering::Relaxed) {
                    return Err("Operation abgebrochen".into());
                }
                if let Ok(item) = item {
                    copy_recursive(
                        &item.path(),
                        &target.join(item.file_name()),
                        conflict,
                        cancel,
                        app_handle,
                        progress_counter,
                        total,
                    )?;
                }
            }
        }
    } else {
        if target.exists() || target.symlink_metadata().is_ok() {
            match conflict {
                ConflictMode::Skip => {
                    *progress_counter += 1;
                    let _ = app_handle.emit(
                        "file-copy-progress",
                        CopyProgress {
                            item_name: name,
                            current: *progress_counter,
                            total,
                            status: "skipped".into(),
                        },
                    );
                    return Ok(());
                }
                ConflictMode::Error => return Err(format!("Ziel existiert bereits: {}", target.display())),
                ConflictMode::Overwrite => {
                    if target.is_dir() {
                        let _ = fs::remove_dir_all(target);
                    }
                }
            }
        }

        fs::copy(source, target).map_err(err)?;
        *progress_counter += 1;
        let _ = app_handle.emit(
            "file-copy-progress",
            CopyProgress {
                item_name: name,
                current: *progress_counter,
                total,
                status: "done".into(),
            },
        );
    }
    Ok(())
}

fn remove_path(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(err)?;
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path).map_err(err)
    } else {
        fs::remove_file(path).map_err(err)
    }
}

fn safe_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name == "." || name == ".." || Path::new(name).components().count() != 1 || name.contains('/') || name.contains('\\') {
        return Err("Ungültiger Dateiname".into());
    }
    Ok(())
}

#[tauri::command]
fn home() -> String {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| ".".into())
}

#[tauri::command]
fn locations() -> Vec<Location> {
    let mut out = vec![Location {
        name: "Home".into(),
        path: home(),
    }];
    #[cfg(windows)]
    {
        for c in 'A'..='Z' {
            let path = format!("{}:\\", c);
            if Path::new(&path).exists() {
                out.push(Location {
                    name: format!("{}:", c),
                    path,
                });
            }
        }
    }
    #[cfg(not(windows))]
    {
        out.push(Location {
            name: "/ (Root)".into(),
            path: "/".into(),
        });
        for base in ["/mnt", "/media", "/run/media", "/Volumes", "/home"] {
            if Path::new(base).is_dir() {
                out.push(Location {
                    name: base.into(),
                    path: base.into(),
                });
            }
        }
    }
    out
}

#[tauri::command]
fn list_dir(path: String) -> Result<Directory, String> {
    let p = Path::new(&path);
    let path = fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    if !path.is_dir() {
        return Err("Kein Verzeichnis".into());
    }

    let mut entries = Vec::new();
    if let Ok(read_dir) = fs::read_dir(&path) {
        for item in read_dir {
            let item = match item {
                Ok(it) => it,
                Err(_) => continue, // Do not fail the whole listing on single unreadable entry!
            };
            let item_path = item.path();
            let name = item.file_name().to_string_lossy().into_owned();

            let (is_dir, is_symlink, size, modified, readonly) = match fs::symlink_metadata(&item_path) {
                Ok(meta) => {
                    let linked = meta.file_type().is_symlink();
                    let follow = if linked { fs::metadata(&item_path).ok() } else { None };
                    let effective = follow.as_ref().unwrap_or(&meta);
                    let mod_time = effective
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    let ro = effective.permissions().readonly();
                    (effective.is_dir(), linked, if effective.is_file() { effective.len() } else { 0 }, mod_time, ro)
                }
                Err(_) => {
                    (false, false, 0, 0, false)
                }
            };

            entries.push(Entry {
                hidden: is_hidden(&name, &item_path),
                name,
                path: path_text(&item_path),
                is_dir,
                is_symlink,
                size,
                modified,
                readonly,
            });
        }
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    let parent = path.parent().map(path_text);
    Ok(Directory {
        path: path_text(&path),
        parent,
        entries,
    })
}

#[tauri::command]
fn create_dir(parent: String, name: String) -> Result<(), String> {
    safe_name(&name)?;
    fs::create_dir(Path::new(&parent).join(name)).map_err(err)
}

#[tauri::command]
fn create_file(parent: String, name: String) -> Result<(), String> {
    safe_name(&name)?;
    let p = Path::new(&parent).join(name);
    if p.exists() {
        return Err("Datei existiert bereits".into());
    }
    fs::File::create(p).map_err(err)?;
    Ok(())
}

#[tauri::command]
async fn check_conflicts(sources: Vec<String>, destination: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conflicts = Vec::new();
        let dest_dir = Path::new(&destination);
        for source in sources {
            let src = PathBuf::from(&source);
            if let Some(name) = src.file_name() {
                let target = dest_dir.join(name);
                if target.exists() || target.symlink_metadata().is_ok() {
                    conflicts.push(name.to_string_lossy().into_owned());
                }
            }
        }
        Ok(conflicts)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
async fn rename_path(source: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        safe_name(&name)?;
        let p = PathBuf::from(&source);
        let dest = p.parent().ok_or("Fehlendes Elternverzeichnis")?.join(name);
        check_target(&p, &dest, ConflictMode::Error)?;
        fs::rename(p, dest).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
fn cancel_operation() {
    if let Ok(guard) = CANCEL_FLAG.lock() {
        if let Some(flag) = guard.as_ref() {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

#[tauri::command]
async fn copy_paths(
    app: tauri::AppHandle,
    sources: Vec<String>,
    destination: String,
    conflict: Option<ConflictMode>,
) -> Result<(), String> {
    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut guard) = CANCEL_FLAG.lock() {
        *guard = Some(cancel.clone());
    }

    let res = tauri::async_runtime::spawn_blocking(move || {
        let mode = conflict.unwrap_or(ConflictMode::Error);
        let total = count_items_to_copy(&sources);
        let mut progress_counter = 0;

        for source in &sources {
            if cancel.load(Ordering::Relaxed) {
                return Err("Operation abgebrochen".into());
            }
            let src = PathBuf::from(source);
            let name = src.file_name().ok_or("Ungültige Quelle")?;
            let target = Path::new(&destination).join(name);
            check_target(&src, &target, mode)?;
            copy_recursive(
                &src,
                &target,
                mode,
                &cancel,
                &app,
                &mut progress_counter,
                total,
            )?;
        }
        Ok(())
    })
    .await
    .map_err(err)?;

    if let Ok(mut guard) = CANCEL_FLAG.lock() {
        *guard = None;
    }
    res
}

#[tauri::command]
async fn move_paths(
    app: tauri::AppHandle,
    sources: Vec<String>,
    destination: String,
    conflict: Option<ConflictMode>,
) -> Result<(), String> {
    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut guard) = CANCEL_FLAG.lock() {
        *guard = Some(cancel.clone());
    }

    let res = tauri::async_runtime::spawn_blocking(move || {
        let mode = conflict.unwrap_or(ConflictMode::Error);
        let total = sources.len();
        let mut progress_counter = 0;

        for source in &sources {
            if cancel.load(Ordering::Relaxed) {
                return Err("Operation abgebrochen".into());
            }
            let src = PathBuf::from(source);
            let name = src.file_name().ok_or("Ungültige Quelle")?;
            let target = Path::new(&destination).join(name);
            check_target(&src, &target, mode)?;

            if target.exists() || target.symlink_metadata().is_ok() {
                match mode {
                    ConflictMode::Skip => {
                        progress_counter += 1;
                        let _ = app.emit(
                            "file-copy-progress",
                            CopyProgress {
                                item_name: name.to_string_lossy().into_owned(),
                                current: progress_counter,
                                total,
                                status: "skipped".into(),
                            },
                        );
                        continue;
                    }
                    ConflictMode::Error => return Err(format!("Ziel existiert bereits: {}", target.display())),
                    ConflictMode::Overwrite => {
                        // Do safe overwrite via temporary backup or atomic rename
                    }
                }
            }

            // Attempt atomic rename first
            let rename_res = fs::rename(&src, &target);
            match rename_res {
                Ok(()) => {
                    progress_counter += 1;
                    let _ = app.emit(
                        "file-copy-progress",
                        CopyProgress {
                            item_name: name.to_string_lossy().into_owned(),
                            current: progress_counter,
                            total,
                            status: "done".into(),
                        },
                    );
                }
                Err(e) if e.kind() == io::ErrorKind::CrossesDevices => {
                    // Cross device: Copy first, ONLY remove source after successful copy!
                    copy_recursive(
                        &src,
                        &target,
                        mode,
                        &cancel,
                        &app,
                        &mut progress_counter,
                        total,
                    )?;
                    remove_path(&src)?;
                }
                Err(_) => {
                    // If target already exists and overwrite was selected, handle carefully
                    if (target.exists() || target.symlink_metadata().is_ok()) && mode == ConflictMode::Overwrite {
                        let backup_path = dest_unique_temp(&target);
                        let _ = fs::rename(&target, &backup_path);
                        match fs::rename(&src, &target) {
                            Ok(()) => {
                                let _ = remove_path(&backup_path);
                                progress_counter += 1;
                                let _ = app.emit(
                                    "file-copy-progress",
                                    CopyProgress {
                                        item_name: name.to_string_lossy().into_owned(),
                                        current: progress_counter,
                                        total,
                                        status: "done".into(),
                                    },
                                );
                            }
                            Err(e) => {
                                // Restore original target on failure
                                let _ = fs::rename(&backup_path, &target);
                                return Err(format!("Verschieben fehlgeschlagen: {}", e));
                            }
                        }
                    } else {
                        return Err(format!("Verschieben fehlgeschlagen für {}: {}", src.display(), rename_res.unwrap_err()));
                    }
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(err)?;

    if let Ok(mut guard) = CANCEL_FLAG.lock() {
        *guard = None;
    }
    res
}

fn dest_unique_temp(path: &Path) -> PathBuf {
    let mut i = 0;
    loop {
        let temp = path.with_extension(format!("tmp_mira_{}", i));
        if !temp.exists() && temp.symlink_metadata().is_err() {
            return temp;
        }
        i += 1;
    }
}

#[tauri::command]
async fn delete_paths(paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        for p in paths {
            remove_path(Path::new(&p))?;
        }
        Ok(())
    })
    .await
    .map_err(err)?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageData {
    mime_type: String,
    data_url: String,
    width: u32,
    height: u32,
    format_name: String,
    size_bytes: u64,
}

#[tauri::command]
fn read_image(path: String) -> Result<ImageData, String> {
    use base64::Engine;
    let p = Path::new(&path);
    let meta = fs::metadata(p).map_err(err)?;
    let size_bytes = meta.len();
    if size_bytes > 100 * 1024 * 1024 {
        return Err("Bild ist größer als 100 MB".into());
    }

    let ext = p
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    if ext == "svg" {
        let content = fs::read(p).map_err(err)?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&content);
        return Ok(ImageData {
            mime_type: "image/svg+xml".into(),
            data_url: format!("data:image/svg+xml;base64,{}", b64),
            width: 0,
            height: 0,
            format_name: "SVG".into(),
            size_bytes,
        });
    }

    let reader = image::ImageReader::open(p).map_err(err)?;
    let reader = reader.with_guessed_format().map_err(err)?;
    let detected_format = reader.format();

    if let Some(fmt) = detected_format {
        use image::ImageFormat;
        let is_browser_native = matches!(
            fmt,
            ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::Gif | ImageFormat::WebP
        );
        if is_browser_native {
            let content = fs::read(p).map_err(err)?;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&content);
            let mime = match fmt {
                ImageFormat::Png => "image/png",
                ImageFormat::Jpeg => "image/jpeg",
                ImageFormat::Gif => "image/gif",
                ImageFormat::WebP => "image/webp",
                _ => "application/octet-stream",
            };
            let (w, h) = image::image_dimensions(p).unwrap_or((0, 0));
            return Ok(ImageData {
                mime_type: mime.into(),
                data_url: format!("data:{};base64,{}", mime, b64),
                width: w,
                height: h,
                format_name: format!("{:?}", fmt).to_uppercase(),
                size_bytes,
            });
        }
    }

    let img = reader
        .decode()
        .map_err(|e| format!("Bild konnte nicht decodiert werden: {}", e))?;
    let (w, h) = (img.width(), img.height());
    let format_str = detected_format
        .map(|f| format!("{:?}", f).to_uppercase())
        .unwrap_or_else(|| ext.to_uppercase());

    let mut buf = std::io::Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("Konvertierung nach PNG fehlgeschlagen: {}", e))?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(buf.into_inner());
    Ok(ImageData {
        mime_type: "image/png".into(),
        data_url: format!("data:image/png;base64,{}", b64),
        width: w,
        height: h,
        format_name: format_str,
        size_bytes,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchResultItem {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    match_line: Option<String>,
}

fn build_glob_matcher(pattern: &str) -> Option<GlobMatcher> {
    let clean = pattern.trim();
    if clean.is_empty() || clean == "*" || clean == "*.*" {
        return None;
    }
    // If user writes without wildcard (e.g. "report"), treat as *report*
    let glob_pat = if !clean.contains('*') && !clean.contains('?') {
        format!("*{}*", clean)
    } else {
        clean.to_string()
    };
    Glob::new(&glob_pat.to_lowercase()).ok().map(|g| g.compile_matcher())
}

#[tauri::command]
async fn search_files(
    root: String,
    pattern: String,
    content_query: Option<String>,
) -> Result<Vec<SearchResultItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use walkdir::WalkDir;
        let mut results = Vec::new();
        let matcher = build_glob_matcher(&pattern);
        let content_lower = content_query
            .as_ref()
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty());

        for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
            if results.len() >= 500 {
                break;
            }
            let name = entry.file_name().to_string_lossy();
            let name_lower = name.to_lowercase();

            let matches_pattern = match &matcher {
                Some(m) => m.is_match(&name_lower),
                None => true,
            };

            if !matches_pattern {
                continue;
            }

            let path = entry.path();
            let is_dir = path.is_dir();
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            let mut match_line = None;

            if let Some(ref cq) = content_lower {
                if is_dir {
                    continue;
                }
                if size > 10 * 1024 * 1024 {
                    continue;
                }
                if let Ok(bytes) = fs::read(path) {
                    let text = decode_text_bytes(&bytes);
                    let mut found = false;
                    for line in text.lines() {
                        if line.to_lowercase().contains(cq) {
                            match_line = Some(line.trim().chars().take(120).collect());
                            found = true;
                            break;
                        }
                    }
                    if !found {
                        continue;
                    }
                } else {
                    continue;
                }
            }

            results.push(SearchResultItem {
                name: name.into_owned(),
                path: path.to_string_lossy().into_owned(),
                is_dir,
                size,
                match_line,
            });
        }
        Ok(results)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
async fn pack_zip(sources: Vec<String>, destination_zip: String, overwrite: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        use walkdir::WalkDir;
        use zip::write::SimpleFileOptions;

        let dest = Path::new(&destination_zip);
        if dest.exists() && !overwrite {
            return Err("Ziel-Archiv existiert bereits".into());
        }

        let file = fs::File::create(dest).map_err(err)?;
        let mut zip = zip::ZipWriter::new(file);

        for src_str in sources {
            let src = Path::new(&src_str);
            let base_name = src
                .file_name()
                .ok_or("Ungültiger Dateiname")?
                .to_string_lossy();

            if src.is_file() {
                let meta = fs::metadata(src).map_err(err)?;
                #[cfg(unix)]
                let perms = {
                    use std::os::unix::fs::PermissionsExt;
                    meta.permissions().mode()
                };
                #[cfg(not(unix))]
                let perms = 0o644;

                let options = SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Deflated)
                    .large_file(true)
                    .unix_permissions(perms);

                zip.start_file(&base_name, options).map_err(err)?;
                let mut f = fs::File::open(src).map_err(err)?;
                io::copy(&mut f, &mut zip).map_err(err)?;
            } else if src.is_dir() {
                let dir_options = SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Deflated)
                    .large_file(true)
                    .unix_permissions(0o755);

                for entry in WalkDir::new(src).into_iter().filter_map(|e| e.ok()) {
                    let p = entry.path();
                    let rel = p.strip_prefix(src).map_err(err)?;
                    let zip_path = if rel.as_os_str().is_empty() {
                        format!("{}/", base_name)
                    } else {
                        format!("{}/{}", base_name, rel.to_string_lossy().replace('\\', "/"))
                    };

                    if p.is_dir() {
                        zip.add_directory(&zip_path, dir_options).map_err(err)?;
                    } else {
                        let meta = entry.metadata().map_err(err)?;
                        #[cfg(unix)]
                        let perms = {
                            use std::os::unix::fs::PermissionsExt;
                            meta.permissions().mode()
                        };
                        #[cfg(not(unix))]
                        let perms = 0o644;

                        let file_options = SimpleFileOptions::default()
                            .compression_method(zip::CompressionMethod::Deflated)
                            .large_file(true)
                            .unix_permissions(perms);

                        zip.start_file(&zip_path, file_options).map_err(err)?;
                        let mut f = fs::File::open(p).map_err(err)?;
                        io::copy(&mut f, &mut zip).map_err(err)?;
                    }
                }
            }
        }
        zip.finish().map_err(err)?;
        Ok(())
    })
    .await
    .map_err(err)?
}

#[tauri::command]
async fn unpack_zip(zip_path: String, destination_folder: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = fs::File::open(&zip_path).map_err(err)?;
        let mut archive = zip::ZipArchive::new(file).map_err(err)?;
        let dest = Path::new(&destination_folder);

        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(err)?;
            let outpath = match file.enclosed_name() {
                Some(path) => dest.join(path),
                None => continue, // Protect against Zip Slip
            };

            let is_dir = file.is_dir();
            if is_dir {
                fs::create_dir_all(&outpath).map_err(err)?;
            } else {
                if let Some(p) = outpath.parent() {
                    if !p.exists() {
                        fs::create_dir_all(p).map_err(err)?;
                    }
                }
                let mut outfile = fs::File::create(&outpath).map_err(err)?;
                io::copy(&mut file, &mut outfile).map_err(err)?;
            }
        }
        Ok(())
    })
    .await
    .map_err(err)?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirInfoSummary {
    total_files: usize,
    total_dirs: usize,
    total_bytes: u64,
}

#[tauri::command]
async fn get_dir_info(path: String) -> Result<DirInfoSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use walkdir::WalkDir;
        let mut total_files = 0;
        let mut total_dirs = 0;
        let mut total_bytes = 0;

        for entry in WalkDir::new(&path).into_iter().filter_map(|e| e.ok()) {
            if entry.path() == Path::new(&path) {
                continue;
            }
            if entry.file_type().is_dir() {
                total_dirs += 1;
            } else {
                total_files += 1;
                total_bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }
        Ok(DirInfoSummary {
            total_files,
            total_dirs,
            total_bytes,
        })
    })
    .await
    .map_err(err)?
}

fn decode_text_bytes(bytes: &[u8]) -> String {
    // Try UTF-8 first
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    // Try Windows-1252 / ISO-8859-1 / ANSI
    let (cow, _, _) = encoding_rs::WINDOWS_1252.decode(bytes);
    cow.into_owned()
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    let m = fs::metadata(&path).map_err(err)?;
    if m.len() > 5 * 1024 * 1024 {
        return Err("Textdatei ist größer als 5 MiB".into());
    }
    let bytes = fs::read(path).map_err(err)?;
    Ok(decode_text_bytes(&bytes))
}

#[tauri::command]
fn write_text(path: String, content: String) -> Result<(), String> {
    if content.len() > 10 * 1024 * 1024 {
        return Err("Textdatei ist größer als 10 MiB".into());
    }
    fs::write(path, content).map_err(err)
}

#[tauri::command]
fn open_in_system(path: String) -> Result<(), String> {
    opener::open(&path).map_err(err)
}

#[tauri::command]
fn execute_terminal_cmd(cwd: String, command_line: String) -> Result<String, String> {
    #[cfg(windows)]
    let (prog, arg) = ("cmd", "/C");
    #[cfg(not(windows))]
    let (prog, arg) = ("sh", "-c");

    let output = std::process::Command::new(prog)
        .arg(arg)
        .arg(&command_line)
        .current_dir(cwd)
        .output()
        .map_err(err)?;

    let mut res = String::new();
    if !output.stdout.is_empty() {
        res.push_str(&String::from_utf8_lossy(&output.stdout));
    }
    if !output.stderr.is_empty() {
        if !res.is_empty() {
            res.push('\n');
        }
        res.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    if res.is_empty() {
        res = format!("Befehl beendet mit Code {}", output.status.code().unwrap_or(0));
    }
    Ok(res)
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            home,
            locations,
            list_dir,
            create_dir,
            create_file,
            rename_path,
            copy_paths,
            move_paths,
            delete_paths,
            read_text,
            write_text,
            read_image,
            check_conflicts,
            cancel_operation,
            search_files,
            pack_zip,
            unpack_zip,
            get_dir_info,
            get_disk_space,
            open_in_system,
            execute_terminal_cmd
        ])
        .run(tauri::generate_context!())
        .expect("MiraCommander konnte nicht gestartet werden");
}
