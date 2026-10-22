use crate::library::{Book, Library, Patch, Result};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::Emitter;
pub type Store = Arc<Mutex<Library>>;
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    books: Vec<Book>,
    trash: Vec<Book>,
    folder: String,
    warning: Option<String>,
}
#[tauri::command]
pub fn library_list(state: tauri::State<Store>) -> Result<Snapshot> {
    let l = state.lock().map_err(|e| e.to_string())?;
    Ok(Snapshot {
        books: l.catalog.books.clone(),
        trash: l.catalog.trash.clone(),
        folder: l.root.to_string_lossy().into(),
        warning: l.warning.clone(),
    })
}
#[derive(serde::Serialize)]
pub struct ImportResult {
    added: Vec<Book>,
    duplicates: u32,
    errors: Vec<String>,
}
#[tauri::command]
pub async fn import_pdfs(
    paths: Vec<String>,
    state: tauri::State<'_, Store>,
    app: tauri::AppHandle,
) -> Result<ImportResult> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = ImportResult {
            added: vec![],
            duplicates: 0,
            errors: vec![],
        };
        let total = paths.len();
        for (i, path) in paths.iter().enumerate() {
            let result = store
                .lock()
                .map_err(|e| e.to_string())?
                .import(&PathBuf::from(path));
            match result {
                Ok((b, true)) => {
                    let _ = b;
                    out.duplicates += 1
                }
                Ok((b, false)) => out.added.push(b),
                Err(e) => out.errors.push(format!(
                    "{}: {e}",
                    PathBuf::from(path)
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                )),
            };
            let _ = app.emit(
                "import-progress",
                serde_json::json!({"done":i+1,"total":total}),
            );
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn update_book(id: String, patch: Patch, state: tauri::State<Store>) -> Result<Book> {
    state.lock().map_err(|e| e.to_string())?.update(&id, patch)
}
#[tauri::command]
pub fn remove_book(id: String, state: tauri::State<Store>) -> Result<()> {
    state.lock().map_err(|e| e.to_string())?.remove(&id)
}
#[tauri::command]
pub fn restore_book(id: String, state: tauri::State<Store>) -> Result<()> {
    state.lock().map_err(|e| e.to_string())?.restore(&id)
}
#[tauri::command]
pub fn pdf_path(id: String, state: tauri::State<Store>) -> Result<String> {
    Ok(state
        .lock()
        .map_err(|e| e.to_string())?
        .path(&id)?
        .to_string_lossy()
        .into())
}
#[tauri::command]
pub fn save_cover(id: String, bytes: Vec<u8>, state: tauri::State<Store>) -> Result<()> {
    let mut l = state.lock().map_err(|e| e.to_string())?;
    l.path(&id)?;
    if bytes.len() > 500_000 || !bytes.starts_with(&[137, 80, 78, 71]) {
        return Err("Capa inválida".into());
    }
    std::fs::write(l.root.join("covers").join(format!("{id}.png")), bytes)
        .map_err(|e| e.to_string())?;
    if let Some(b) = l.catalog.books.iter_mut().find(|b| b.id == id) {
        b.cover = true;
    }
    l.update(&id, Patch::default())?;
    Ok(())
}
#[tauri::command]
pub fn open_folder(state: tauri::State<Store>) -> Result<()> {
    let l = state.lock().map_err(|e| e.to_string())?;
    std::process::Command::new("explorer.exe")
        .arg(&l.root)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub async fn export_pdf(
    id: String,
    destination: String,
    state: tauri::State<'_, Store>,
) -> Result<()> {
    let source = state.lock().map_err(|e| e.to_string())?.path(&id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let destination = PathBuf::from(destination);
        if destination == source {
            return Err("Escolha uma pasta fora da biblioteca.".into());
        }
        std::fs::copy(source, destination).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
