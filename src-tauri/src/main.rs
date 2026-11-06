#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod commands;
mod launch;
mod library;
mod notes;
mod reading;
use commands::*;
use launch::{pdf_args, PendingFiles};
use library::Library;
use std::sync::{Arc, Mutex};
use tauri::{Manager, PhysicalSize, WebviewWindow};
use tauri_plugin_window_state::StateFlags;
// How far a window may stick out of a screen: Windows keeps an invisible border around it.
const SLACK: i32 = 16;
// The window comes back with the size and the position it was left with, but the screens may have
// changed since: another monitor, a lower resolution, a laptop out of its dock. One that no longer
// fits any screen shrinks to the one it is closest to, if it must, and goes to its middle, as on
// the first launch. A maximized window always fits.
fn fit_to_screen(window: &WebviewWindow) {
    if window.is_maximized().unwrap_or(true) {
        return;
    }
    let (Ok(position), Ok(outer), Ok(inner), Ok(monitors)) = (
        window.outer_position(),
        window.outer_size(),
        window.inner_size(),
        window.available_monitors(),
    ) else {
        return;
    };
    let fits = monitors.iter().any(|m| {
        let area = m.work_area();
        position.x >= area.position.x - SLACK
            && position.y >= area.position.y - SLACK
            && position.x + outer.width as i32 <= area.position.x + area.size.width as i32 + SLACK
            && position.y + outer.height as i32 <= area.position.y + area.size.height as i32 + SLACK
    });
    if fits {
        return;
    }
    if let Ok(Some(monitor)) = window.current_monitor() {
        let area = monitor.work_area().size;
        // The size of the window is the inside of it: the title bar and the borders come on top.
        let frame_width = outer.width.saturating_sub(inner.width);
        let frame_height = outer.height.saturating_sub(inner.height);
        let _ = window.set_size(PhysicalSize::new(
            inner.width.min(area.width.saturating_sub(frame_width)),
            inner.height.min(area.height.saturating_sub(frame_height)),
        ));
    }
    let _ = window.center();
}
fn main() {
    // Size, position and maximized state, kept between launches. Fullscreen is not: it is a state
    // of the moment, and the window never opens in it.
    let window_state = tauri_plugin_window_state::Builder::new()
        .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED);
    // A development build keeps its own file, as it keeps its own library.
    #[cfg(debug_assertions)]
    let window_state = window_state.with_filename("window-state.development.json");
    tauri::Builder::default()
        // Managed before the plugins: a second launch may reach the callback below at any time.
        .manage(PendingFiles::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            launch::receive(app, &args, &cwd);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(window_state.build())
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
            // The PDFs this launch came with (the first instance; a second one hands its own over).
            // The window asks for them when it is ready.
            let cwd = std::env::current_dir().unwrap_or_default();
            app.state::<PendingFiles>()
                .push(pdf_args(std::env::args_os().skip(1), &cwd));
            if let Some(window) = app.get_webview_window("main") {
                fit_to_screen(&window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            library_list,
            import_pdfs,
            take_pending_files,
            update_book,
            update_books,
            remove_book,
            remove_books,
            restore_book,
            restore_books,
            purge_books,
            pdf_path,
            save_cover,
            open_folder,
            reveal_file,
            export_pdf,
            export_notes
        ])
        .run(tauri::generate_context!())
        .expect("Falha ao iniciar o Fólio");
}
