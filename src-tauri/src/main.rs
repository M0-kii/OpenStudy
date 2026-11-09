#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{ipc::Response, AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

const MAX_DOCUMENT_BYTES: u64 = 256 * 1024 * 1024;
static ACCESS_LOCK: Mutex<()> = Mutex::new(());

#[derive(serde::Serialize)]
struct Selection {
    name: String,
    path: PathBuf,
}

fn read_grants(file: &Path) -> Result<BTreeSet<PathBuf>, String> {
    match fs::read(file) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(BTreeSet::new()),
        Err(error) => Err(error.to_string()),
    }
}

fn grant_file(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("selected-documents.json"))
        .map_err(|error| error.to_string())
}

fn register_selection(file: &Path, path: PathBuf) -> Result<(), String> {
    let _guard = ACCESS_LOCK.lock().map_err(|error| error.to_string())?;
    let mut grants = read_grants(file)?;
    if !grants.insert(path) {
        return Ok(());
    }

    let directory = file.parent().ok_or("The app data folder is unavailable.")?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let temporary =
        tempfile::NamedTempFile::new_in(directory).map_err(|error| error.to_string())?;
    serde_json::to_writer(temporary.as_file(), &grants).map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary.persist(file).map_err(|error| error.to_string())?;
    Ok(())
}

fn canonical_document(path: &Path) -> Result<PathBuf, String> {
    let path = path
        .canonicalize()
        .map_err(|_| "This file is unavailable. Choose it again to reconnect it.")?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if !extension.eq_ignore_ascii_case("pdf") && !extension.eq_ignore_ascii_case("epub") {
        return Err("Choose a PDF or EPUB file.".into());
    }
    Ok(path)
}

#[tauri::command]
async fn pick_document(window: WebviewWindow, app: AppHandle) -> Result<Option<Selection>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = app
            .dialog()
            .file()
            .add_filter("PDF and EPUB", &["pdf", "epub"]);
        let Some(selection) = dialog.set_parent(&window).blocking_pick_file() else {
            return Ok(None);
        };
        let original = selection.into_path().map_err(|error| error.to_string())?;
        let path = canonical_document(&original)?;
        let name = original
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .ok_or("The selected file has no name.")?;
        register_selection(&grant_file(&app)?, path.clone())?;
        Ok(Some(Selection { name, path }))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn read_document(app: AppHandle, path: PathBuf) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = canonical_document(&path)?;
        if !read_grants(&grant_file(&app)?)?.contains(&path) {
            return Err("Choose this file to give OpenStudy access.".into());
        }

        let file = File::open(path).map_err(|_| "This document could not be opened.")?;
        let metadata = file.metadata().map_err(|error| error.to_string())?;
        if !metadata.is_file() {
            return Err("Choose a regular PDF or EPUB file.".into());
        }
        if metadata.len() > MAX_DOCUMENT_BYTES {
            return Err("Choose a document smaller than 256 MB.".into());
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.take(MAX_DOCUMENT_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "This document could not be read.")?;
        if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
            return Err("Choose a document smaller than 256 MB.".into());
        }
        Ok(Response::new(bytes))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn open_notification_settings() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return tauri_plugin_opener::open_url("ms-settings:notifications", None::<&str>)
        .map_err(|error| error.to_string());

    #[cfg(not(target_os = "windows"))]
    Err("Open your desktop's notification settings.".into())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            pick_document,
            read_document,
            open_notification_settings
        ])
        .run(tauri::generate_context!())
        .expect("failed to start OpenStudy");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grants_survive_later_selections_and_reject_other_paths() {
        let directory = tempfile::tempdir().unwrap();
        let registry = directory.path().join("grants.json");
        let first = directory.path().join("First PDF.pdf");
        let second = directory.path().join("Second Book.EPUB");
        let other = directory.path().join("Other.pdf");
        register_selection(&registry, first.clone()).unwrap();
        register_selection(&registry, second.clone()).unwrap();
        register_selection(&registry, first.clone()).unwrap();
        let grants = read_grants(&registry).unwrap();
        assert_eq!(grants, BTreeSet::from([first, second]));
        assert!(!grants.contains(&other));
    }
}
