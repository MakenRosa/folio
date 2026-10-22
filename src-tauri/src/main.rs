#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod commands;
mod library;
use commands::*;
use library::Library;
use std::sync::{Arc, Mutex};
use tauri::Manager;
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = app.path().app_local_data_dir()?;
            #[cfg(debug_assertions)]
            let root = root.join("development");
            let lib = Library::open(root.clone()).map_err(std::io::Error::other)?;
            #[cfg(debug_assertions)]
            {
                app.asset_protocol_scope()
                    .allow_directory(root.join("pdfs"), true)?;
                app.asset_protocol_scope()
                    .allow_directory(root.join("covers"), true)?;
            }
            app.manage(Arc::new(Mutex::new(lib)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            library_list,
            import_pdfs,
            update_book,
            remove_book,
            restore_book,
            pdf_path,
            save_cover,
            open_folder,
            export_pdf
        ])
        .run(tauri::generate_context!())
        .expect("Falha ao iniciar o Fólio");
}
