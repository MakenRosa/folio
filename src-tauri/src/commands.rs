use crate::launch::PendingFiles;
use crate::library::{
    expand_import_paths, Archived, Book, BookUpdate, Library, Patch, PurgeResult, Result,
};
use crate::notes;
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
    // What stays of the documents deleted for good: only the reading history, never listed.
    archived: Vec<Archived>,
    folder: String,
    warning: Option<String>,
}
#[tauri::command]
pub fn library_list(state: tauri::State<Store>, history_day: Option<String>) -> Result<Snapshot> {
    let mut l = state.lock().map_err(|e| e.to_string())?;
    if let Some(day) = history_day {
        l.init_history(&day)?;
    }
    Ok(Snapshot {
        books: l.catalog.books.clone(),
        trash: l.catalog.trash.clone(),
        archived: l.catalog.archived.clone(),
        folder: l.root.to_string_lossy().into(),
        warning: l.warning.clone(),
    })
}
// A document the import found already in the library: enough to say which one it was and to
// find its card.
#[derive(serde::Serialize)]
pub struct ExistingBook {
    id: String,
    title: String,
}
#[derive(serde::Serialize)]
pub struct ImportResult {
    added: Vec<Book>,
    duplicates: u32,
    existing: Vec<ExistingBook>,
    errors: Vec<String>,
}
// Folders among `paths` are expanded to the PDFs inside them first, so the progress counts
// files, not what was chosen.
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
            existing: vec![],
            errors: vec![],
        };
        let chosen: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
        let (files, problems) = expand_import_paths(&chosen);
        out.errors = problems;
        let total = files.len();
        if total > 0 {
            let _ = app.emit(
                "import-progress",
                serde_json::json!({"done":0,"total":total}),
            );
        }
        for (i, path) in files.iter().enumerate() {
            let result = store.lock().map_err(|e| e.to_string())?.import(path);
            match result {
                Ok((b, true)) => {
                    out.duplicates += 1;
                    out.existing.push(ExistingBook {
                        id: b.id,
                        title: b.title,
                    });
                }
                Ok((b, false)) => out.added.push(b),
                Err(e) => out.errors.push(format!(
                    "{}: {e}",
                    path.file_name().unwrap_or_default().to_string_lossy()
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
// The PDFs the app was opened with (see `launch`), handed over once: a second call gets nothing
// until another launch brings more.
#[tauri::command]
pub fn take_pending_files(state: tauri::State<PendingFiles>) -> Result<Vec<String>> {
    state.take()
}
#[tauri::command]
pub fn update_book(id: String, patch: Patch, state: tauri::State<Store>) -> Result<Book> {
    state.lock().map_err(|e| e.to_string())?.update(&id, patch)
}
// Several documents in one write of the catalog: all of them change, or none does.
#[tauri::command]
pub fn update_books(updates: Vec<BookUpdate>, state: tauri::State<Store>) -> Result<Vec<Book>> {
    state
        .lock()
        .map_err(|e| e.to_string())?
        .update_many(updates)
}
#[tauri::command]
pub fn remove_books(ids: Vec<String>, state: tauri::State<Store>) -> Result<()> {
    state.lock().map_err(|e| e.to_string())?.remove_many(&ids)
}
#[tauri::command]
pub fn restore_books(ids: Vec<String>, state: tauri::State<Store>) -> Result<()> {
    state.lock().map_err(|e| e.to_string())?.restore_many(&ids)
}
// Deletes documents of Removidos for good (see `Library::purge`). The files are deleted away from
// the window's thread.
#[tauri::command]
pub async fn purge_books(ids: Vec<String>, state: tauri::State<'_, Store>) -> Result<PurgeResult> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.lock().map_err(|e| e.to_string())?.purge(&ids)
    })
    .await
    .map_err(|e| e.to_string())?
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
pub fn save_cover(id: String, bytes: Vec<u8>, state: tauri::State<Store>) -> Result<Book> {
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
    // The book as it is now, so that a card can be drawn again without listing the library.
    l.update(&id, Patch::default())
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
// The Explorer on the folder of a file, with the file chosen: where an export was saved.
#[tauri::command]
pub fn reveal_file(path: String) -> Result<()> {
    let path = PathBuf::from(path);
    // A file that is gone says so, in the words of the system, instead of opening some other folder.
    std::fs::metadata(&path).map_err(|e| e.to_string())?;
    std::process::Command::new("explorer.exe")
        .arg("/select,")
        .arg(&path)
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
// The notes of a document as a Markdown file (see `notes::markdown`), written all at once.
// `offset_minutes` is the reader's distance from UTC, for the dates.
#[tauri::command]
pub async fn export_notes(
    id: String,
    destination: String,
    offset_minutes: Option<i32>,
    state: tauri::State<'_, Store>,
) -> Result<()> {
    let text = {
        let l = state.lock().map_err(|e| e.to_string())?;
        let book = l
            .catalog
            .books
            .iter()
            .find(|b| b.id == id)
            .ok_or("PDF não encontrado")?;
        if book.notes.is_empty() {
            return Err("Este documento ainda não tem notas para exportar.".into());
        }
        notes::markdown(book, offset_minutes.unwrap_or(0))
    };
    tauri::async_runtime::spawn_blocking(move || {
        notes::write_markdown(&PathBuf::from(destination), &text)
    })
    .await
    .map_err(|e| e.to_string())?
}
