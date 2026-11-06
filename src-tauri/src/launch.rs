use crate::library::{is_pdf_name, Result};
use std::{path::Path, sync::Mutex};
use tauri::{AppHandle, Emitter, Manager};
// The PDFs the app was launched with: a double click or "Abrir com" in the Explorer, or a second
// launch that handed its arguments to this one. They wait here, and not only in an event, because
// the window may still be starting when they arrive: it takes them when it is ready.
#[derive(Default)]
pub struct PendingFiles(Mutex<Vec<String>>);
impl PendingFiles {
    pub fn push(&self, paths: Vec<String>) {
        if let Ok(mut waiting) = self.0.lock() {
            for path in paths {
                if !waiting.contains(&path) {
                    waiting.push(path);
                }
            }
        }
    }
    // What is waiting, once: whoever takes it leaves the list empty.
    pub fn take(&self) -> Result<Vec<String>> {
        let mut waiting = self.0.lock().map_err(|e| e.to_string())?;
        Ok(std::mem::take(&mut *waiting))
    }
}
// The PDFs among the arguments of a launch (without the executable). A relative path is the one of
// the process that was launched, so `cwd` is its folder, not necessarily this process's. What is
// not an existing file with the .pdf extension is left out, and so is a path that came twice.
pub fn pdf_args<I, S>(args: I, cwd: &Path) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<Path>,
{
    let mut found: Vec<String> = vec![];
    for arg in args {
        // An absolute path stays as it is; `join` only completes the relative ones.
        let path = cwd.join(arg.as_ref());
        if !is_pdf_name(&path) || !path.is_file() {
            continue;
        }
        let path = path.to_string_lossy().into_owned();
        if !found.contains(&path) {
            found.push(path);
        }
    }
    found
}
// A second launch of the app ends at once and sends its arguments here. The PDFs among them wait
// in `PendingFiles`, and the window is told that there is something to take.
pub fn receive(app: &AppHandle, args: &[String], cwd: &str) {
    let paths = pdf_args(args.iter().skip(1), Path::new(cwd));
    if paths.is_empty() {
        return;
    }
    app.state::<PendingFiles>().push(paths);
    let _ = app.emit("open-files", ());
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn launch_arguments_keep_existing_pdfs_once() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("livro.PDF"), b"%PDF-1.4\n").unwrap();
        std::fs::write(d.path().join("texto.txt"), b"x").unwrap();
        let absolute = d.path().join("livro.PDF");
        let found = pdf_args(
            [
                "livro.PDF",
                absolute.to_str().unwrap(),
                "texto.txt",
                "ausente.pdf",
                "--flag",
            ],
            d.path(),
        );
        assert_eq!(found, [absolute.to_string_lossy().into_owned()]);
        let pending = PendingFiles::default();
        pending.push(found.clone());
        pending.push(found.clone());
        assert_eq!(pending.take().unwrap(), found);
        assert!(pending.take().unwrap().is_empty());
    }
}
