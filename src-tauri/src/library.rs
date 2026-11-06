use crate::notes::normalize as normalize_notes;
use crate::reading::{valid_day, validate_days, BookGoal, GoalHistory, ReadingDays};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub type Result<T> = std::result::Result<T, String>;
// The longest title or author, in characters, and the most pages a document may report.
const MAX_TEXT: usize = 500;
const MAX_PAGES: u32 = 1_000_000;
// The most tags a document may have, and the longest one, in characters.
pub const MAX_TAGS: usize = 20;
pub const MAX_TAG_CHARS: usize = 40;
// How deep an import goes into a folder. Links are never followed, so this only bounds a very
// deep tree.
const MAX_FOLDER_DEPTH: usize = 32;
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Note {
    pub id: String,
    pub page: u32,
    pub text: String,
    pub quote: String,
    pub created: u64,
    // A highlight: one rectangle for each line of the passage, in PDF units and independent of
    // zoom and rotation ([x1, y1, x2, y2]), and its colour (see `notes::COLORS`). The text of
    // a highlight can be empty. Notes from before have neither, and are saved without them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rects: Option<Vec<[f64; 4]>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Book {
    pub goal_history: GoalHistory,
    pub reading_goal: BookGoal,
    pub reading_days: ReadingDays,
    pub id: String,
    pub title: String,
    // Read from the PDF's own metadata by the library queue; empty when it has none.
    pub author: String,
    pub original_name: String,
    pub hash: String,
    pub size: u64,
    pub added: u64,
    pub last_opened: u64,
    pub page: u32,
    pub pages: u32,
    pub top: Option<f64>,
    pub left: Option<f64>,
    pub zoom: String,
    pub rotation: i32,
    pub favorite: bool,
    pub finished: bool,
    pub bookmarks: Vec<u32>,
    pub notes: Vec<Note>,
    pub cover: bool,
    // Free labels of the reader, in the order they were added. See `normalize_tags`.
    pub tags: Vec<String>,
}
impl Default for Book {
    fn default() -> Self {
        Self {
            goal_history: GoalHistory::new(),
            reading_goal: BookGoal::default(),
            reading_days: ReadingDays::new(),
            id: String::new(),
            title: String::new(),
            author: String::new(),
            original_name: String::new(),
            hash: String::new(),
            size: 0,
            added: 0,
            last_opened: 0,
            page: 1,
            pages: 0,
            top: None,
            left: None,
            zoom: "page-width".into(),
            rotation: 0,
            favorite: false,
            finished: false,
            bookmarks: vec![],
            notes: vec![],
            cover: false,
            tags: vec![],
        }
    }
}
// What is left of a document that was deleted for good: no file, no hash, only what the reading
// history needs to go on counting its days. It is not in the library and not in Removidos.
#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Archived {
    pub id: String,
    pub title: String,
    pub author: String,
    pub reading_days: ReadingDays,
    pub goal_history: GoalHistory,
}
impl From<&Book> for Archived {
    fn from(book: &Book) -> Self {
        Self {
            id: book.id.clone(),
            title: book.title.clone(),
            author: book.author.clone(),
            reading_days: book.reading_days.clone(),
            goal_history: book.goal_history.clone(),
        }
    }
}
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Catalog {
    pub version: u32,
    pub books: Vec<Book>,
    pub trash: Vec<Book>,
    pub archived: Vec<Archived>,
}
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Patch {
    pub goal_day: Option<String>,
    pub reading_goal: Option<BookGoal>,
    pub reading_days: Option<ReadingDays>,
    pub title: Option<String>,
    pub author: Option<String>,
    pub last_opened: Option<u64>,
    pub page: Option<u32>,
    pub pages: Option<u32>,
    pub top: Option<f64>,
    pub left: Option<f64>,
    pub zoom: Option<String>,
    pub rotation: Option<i32>,
    pub favorite: Option<bool>,
    pub finished: Option<bool>,
    pub bookmarks: Option<Vec<u32>>,
    pub notes: Option<Vec<Note>>,
    pub tags: Option<Vec<String>>,
}
// One entry of a batch: the same patch `update` takes, for one document.
#[derive(Deserialize)]
pub struct BookUpdate {
    pub id: String,
    pub patch: Patch,
}
// What `purge` did. The catalog no longer has the documents; `failed` has one line for each file
// that could not be deleted (the copy stays in the folder, and the user can delete it by hand).
#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PurgeResult {
    pub purged: u32,
    // The bytes of the PDF copies that were deleted.
    pub freed: u64,
    pub failed: Vec<String>,
}
// Two spellings of a tag are the same tag when they differ only in case or accents.
fn fold_accent(c: char) -> char {
    match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => 'a',
        'ç' | 'ć' | 'ĉ' | 'ċ' | 'č' => 'c',
        'ď' => 'd',
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ĕ' | 'ė' | 'ę' | 'ě' => 'e',
        'ĝ' | 'ğ' | 'ġ' | 'ģ' => 'g',
        'ĥ' => 'h',
        'ì' | 'í' | 'î' | 'ï' | 'ĩ' | 'ī' | 'ĭ' | 'į' => 'i',
        'ĵ' => 'j',
        'ķ' => 'k',
        'ĺ' | 'ļ' | 'ľ' => 'l',
        'ñ' | 'ń' | 'ņ' | 'ň' => 'n',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ō' | 'ŏ' | 'ő' => 'o',
        'ŕ' | 'ŗ' | 'ř' => 'r',
        'ś' | 'ŝ' | 'ş' | 'š' => 's',
        'ţ' | 'ť' => 't',
        'ù' | 'ú' | 'û' | 'ü' | 'ũ' | 'ū' | 'ŭ' | 'ů' | 'ű' | 'ų' => 'u',
        'ŵ' => 'w',
        'ý' | 'ÿ' | 'ŷ' => 'y',
        'ź' | 'ż' | 'ž' => 'z',
        other => other,
    }
}
pub fn tag_key(tag: &str) -> String {
    tag.chars()
        .flat_map(char::to_lowercase)
        // Combining accents, for a tag typed in the decomposed form.
        .filter(|c| !('\u{300}'..='\u{36f}').contains(c))
        .map(fold_accent)
        .collect()
}
// The tags of a document as they are kept: spaces trimmed (and runs of them made one), the empty
// ones and the repeats (the first spelling stays) dropped. A tag that is too long, or too many of
// them, is refused, and nothing is changed.
pub fn normalize_tags(tags: Vec<String>) -> Result<Vec<String>> {
    let mut seen = HashSet::new();
    let mut out: Vec<String> = Vec::new();
    for tag in tags {
        if tag.chars().any(|c| c.is_control() && !c.is_whitespace()) {
            return Err("Use etiquetas sem caracteres de controle.".into());
        }
        let tag = tag.split_whitespace().collect::<Vec<_>>().join(" ");
        if tag.is_empty() {
            continue;
        }
        if tag.chars().count() > MAX_TAG_CHARS {
            return Err(format!("Use etiquetas com até {MAX_TAG_CHARS} caracteres."));
        }
        if seen.insert(tag_key(&tag)) {
            out.push(tag);
            if out.len() > MAX_TAGS {
                return Err(format!("Use no máximo {MAX_TAGS} etiquetas por documento."));
            }
        }
    }
    Ok(out)
}
// A document id becomes a file name. Only a plain name is deleted: never a path.
fn plain_file_name(id: &str) -> bool {
    let mut parts = Path::new(id).components();
    matches!(
        (parts.next(), parts.next()),
        (Some(Component::Normal(name)), None) if name == id
    )
}
fn unique(ids: &[String]) -> Vec<&String> {
    let mut seen = HashSet::new();
    ids.iter().filter(|id| seen.insert(id.as_str())).collect()
}
pub fn is_pdf_name(path: &Path) -> bool {
    path.extension()
        .map(|v| v.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
}
// What an import will try, from what the user chose. A file chosen by name stays on the list,
// even when it is not a PDF: importing it says so. A folder becomes the PDFs inside it, found at
// any depth in name order; whatever else is in it is left alone, without a word. Links and
// junctions are neither followed nor listed, so the walk stays inside the folder that was chosen.
// The second list holds the folders that could not be read.
pub fn expand_import_paths(paths: &[PathBuf]) -> (Vec<PathBuf>, Vec<String>) {
    let mut files = vec![];
    let mut problems = vec![];
    for path in paths {
        match fs::symlink_metadata(path) {
            Ok(meta) if meta.is_dir() => {
                if let Err(e) = collect_pdfs(path, 0, &mut files) {
                    problems.push(format!(
                        "{}: {e}",
                        path.file_name().unwrap_or_default().to_string_lossy()
                    ));
                }
            }
            _ => files.push(path.clone()),
        }
    }
    (files, problems)
}
fn collect_pdfs(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .collect();
    entries.sort_by_cached_key(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase()));
    for path in entries {
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            // A subfolder that cannot be read does not stop the rest.
            if depth < MAX_FOLDER_DEPTH {
                let _ = collect_pdfs(&path, depth + 1, out);
            }
        } else if meta.is_file() && is_pdf_name(&path) {
            out.push(path);
        }
    }
    Ok(())
}
// What a patch does to one document. Used by `update` and `update_many`, which write the catalog
// only when it is all valid.
fn apply_patch(book: &mut Book, patch: Patch) -> Result<()> {
    if let Some(v) = patch.title {
        if v.trim().is_empty() || v.chars().count() > MAX_TEXT {
            return Err("Use um título entre 1 e 500 caracteres.".into());
        }
        book.title = v.trim().into()
    }
    if let Some(v) = patch.author {
        let v = v.trim();
        if v.chars().count() > MAX_TEXT || v.chars().any(char::is_control) {
            return Err("Use um autor com até 500 caracteres, sem quebras de linha.".into());
        }
        book.author = v.into()
    }
    if let Some(v) = patch.last_opened {
        book.last_opened = v
    }
    if let Some(v) = patch.pages {
        if v > MAX_PAGES {
            return Err("Número de páginas inválido.".into());
        }
        book.pages = v
    }
    if let Some(v) = patch.page {
        book.page = v.max(1).min(book.pages.max(1))
    }
    if let Some(v) = patch.top {
        if v.is_finite() {
            book.top = Some(v)
        }
    }
    if let Some(v) = patch.left {
        if v.is_finite() {
            book.left = Some(v)
        }
    }
    if let Some(v) = patch.zoom {
        book.zoom = v
    }
    if let Some(v) = patch.rotation {
        book.rotation = v.rem_euclid(360)
    }
    if let Some(v) = patch.favorite {
        book.favorite = v
    }
    if let Some(v) = patch.finished {
        book.finished = v
    }
    if let Some(v) = patch.reading_goal {
        v.validate()?;
        if let Some(day) = patch.goal_day {
            if !valid_day(&day) || book.goal_history.len() >= 36500 {
                return Err("Data do histórico inválida.".into());
            }
            book.goal_history.insert(day, v.clone());
        } else if !book.goal_history.is_empty() {
            return Err("Informe a data da alteração da meta.".into());
        }
        book.reading_goal = v;
    }
    if let Some(v) = patch.reading_days {
        book.reading_days = validate_days(v, book.pages)?;
    }
    if let Some(v) = patch.bookmarks {
        book.bookmarks = v
            .into_iter()
            .filter(|p| *p >= 1 && *p <= book.pages)
            .collect()
    }
    if let Some(v) = patch.notes {
        book.notes = normalize_notes(v)?
    }
    if let Some(v) = patch.tags {
        book.tags = normalize_tags(v)?;
    }
    Ok(())
}
pub struct Library {
    pub root: PathBuf,
    pub catalog: Catalog,
    pub warning: Option<String>,
}
impl Library {
    pub fn init_history(&mut self, day: &str) -> Result<()> {
        if !valid_day(day) {
            return Err("Data do histórico inválida.".into());
        }
        let mut next = self.catalog.clone();
        let mut changed = false;
        for book in next.books.iter_mut().chain(&mut next.trash) {
            if book.goal_history.is_empty() {
                book.goal_history
                    .insert(day.into(), book.reading_goal.clone());
                changed = true;
            }
        }
        if changed {
            self.save(&next)?;
            self.catalog = next;
        }
        Ok(())
    }
    pub fn open(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(root.join("pdfs")).map_err(|e| e.to_string())?;
        fs::create_dir_all(root.join("covers")).map_err(|e| e.to_string())?;
        let path = root.join("library.json");
        let mut warning = None;
        let catalog = if path.exists() {
            match fs::read(&path)
                .map_err(|e| e.to_string())
                .and_then(|b| serde_json::from_slice::<Catalog>(&b).map_err(|e| e.to_string()))
            {
                Ok(c) => c,
                Err(e) => {
                    let backup=fs::read(root.join("library.backup.json")).map_err(|_|format!("Não foi possível ler o catálogo: {e}. Os PDFs estão preservados em {}.",root.display()))?;
                    let c = serde_json::from_slice(&backup).map_err(|e| {
                        format!("Catálogo e backup ilegíveis: {e}. Seus PDFs foram preservados.")
                    })?;
                    fs::copy(&path, root.join(format!("library.recovery-{}.json", now())))
                        .map_err(|e| e.to_string())?;
                    // Remove the corrupt primary only after a recovery copy is durable. The valid backup remains intact.
                    fs::remove_file(&path).map_err(|e| e.to_string())?;
                    warning = Some(
                        "O catálogo foi recuperado do backup. Seus PDFs estão preservados.".into(),
                    );
                    c
                }
            }
        } else {
            Catalog {
                version: 1,
                ..Default::default()
            }
        };
        Ok(Self {
            root,
            catalog,
            warning,
        })
    }
    fn save(&self, catalog: &Catalog) -> Result<()> {
        let bytes = serde_json::to_vec(catalog).map_err(|e| e.to_string())?;
        let mut tmp = tempfile::NamedTempFile::new_in(&self.root).map_err(|e| e.to_string())?;
        tmp.write_all(&bytes)
            .and_then(|_| tmp.as_file().sync_all())
            .map_err(|e| e.to_string())?;
        let path = self.root.join("library.json");
        if path.exists() {
            fs::copy(&path, self.root.join("library.backup.json")).map_err(|e| e.to_string())?;
        }
        tmp.persist(&path).map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn import(&mut self, path: &Path) -> Result<(Book, bool)> {
        if !is_pdf_name(path) {
            return Err("Selecione um arquivo .pdf.".into());
        }
        let mut source = fs::File::open(path).map_err(|e| e.to_string())?;
        if !source.metadata().map_err(|e| e.to_string())?.is_file() {
            return Err("O caminho não é um arquivo.".into());
        }
        let mut temp =
            tempfile::NamedTempFile::new_in(self.root.join("pdfs")).map_err(|e| e.to_string())?;
        let mut hash = Sha256::new();
        let mut buffer = vec![0; 256 * 1024];
        let mut size = 0;
        loop {
            let n = source.read(&mut buffer).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            if size == 0 && !buffer[..n.min(1024)].windows(5).any(|w| w == b"%PDF-") {
                return Err("O arquivo não contém um PDF válido.".into());
            }
            hash.update(&buffer[..n]);
            temp.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
            size += n as u64;
        }
        if size == 0 {
            return Err("O arquivo está vazio.".into());
        }
        let hash = format!("{:x}", hash.finalize());
        if let Some(book) = self.catalog.books.iter().find(|b| b.hash == hash) {
            return Ok((book.clone(), true));
        }
        if let Some(book) = self.catalog.trash.iter().find(|b| b.hash == hash).cloned() {
            self.restore(&book.id)?;
            return Ok((book, false));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let filename = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let book = Book {
            id: id.clone(),
            title: path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
            original_name: filename,
            hash,
            size,
            added: now(),
            ..Default::default()
        };
        temp.as_file().sync_all().map_err(|e| e.to_string())?;
        let destination = self.root.join("pdfs").join(format!("{id}.pdf"));
        temp.persist_noclobber(&destination)
            .map_err(|e| e.to_string())?;
        let mut next = self.catalog.clone();
        next.books.push(book.clone());
        if let Err(e) = self.save(&next) {
            let _ = fs::remove_file(destination);
            return Err(e);
        }
        self.catalog = next;
        Ok((book, false))
    }
    pub fn update(&mut self, id: &str, patch: Patch) -> Result<Book> {
        let mut next = self.catalog.clone();
        let book = next
            .books
            .iter_mut()
            .find(|b| b.id == id)
            .ok_or("PDF não encontrado")?;
        apply_patch(book, patch)?;
        let result = book.clone();
        self.save(&next)?;
        self.catalog = next;
        Ok(result)
    }
    // Several documents, one save. Every patch is checked before anything is written: if one of
    // them is refused, or a document is not found, the catalog stays exactly as it was. Gives the
    // documents as they are now, in the order of the library.
    pub fn update_many(&mut self, updates: Vec<BookUpdate>) -> Result<Vec<Book>> {
        if updates.is_empty() {
            return Ok(vec![]);
        }
        let mut next = self.catalog.clone();
        let mut ids = HashSet::new();
        for BookUpdate { id, patch } in updates {
            let book = next
                .books
                .iter_mut()
                .find(|b| b.id == id)
                .ok_or("PDF não encontrado")?;
            apply_patch(book, patch)?;
            ids.insert(id);
        }
        let result = next
            .books
            .iter()
            .filter(|b| ids.contains(&b.id))
            .cloned()
            .collect();
        self.save(&next)?;
        self.catalog = next;
        Ok(result)
    }
    pub fn remove(&mut self, id: &str) -> Result<()> {
        self.remove_many(&[id.to_string()])
    }
    // To Removidos, all or none, with one save.
    pub fn remove_many(&mut self, ids: &[String]) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let mut next = self.catalog.clone();
        for id in unique(ids) {
            let i = next
                .books
                .iter()
                .position(|b| &b.id == id)
                .ok_or("PDF não encontrado")?;
            next.trash.push(next.books.remove(i));
        }
        self.save(&next)?;
        self.catalog = next;
        Ok(())
    }
    pub fn restore(&mut self, id: &str) -> Result<()> {
        self.restore_many(&[id.to_string()])
    }
    // Back to the library, all or none, with one save.
    pub fn restore_many(&mut self, ids: &[String]) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let mut next = self.catalog.clone();
        for id in unique(ids) {
            let i = next
                .trash
                .iter()
                .position(|b| &b.id == id)
                .ok_or("PDF não encontrado")?;
            next.books.push(next.trash.remove(i));
        }
        self.save(&next)?;
        self.catalog = next;
        Ok(())
    }
    // Deletes documents of Removidos for good. The catalog is written first, without them (and with
    // the minimal record of each in `archived`, which keeps their days in the reading history);
    // only then are `pdfs/<id>.pdf` and `covers/<id>.png` deleted. A file that cannot be deleted
    // does not undo the catalog: it is told in `failed`, and the file stays where it is. A document
    // that is not in Removidos is never touched, and then nothing is deleted at all.
    pub fn purge(&mut self, ids: &[String]) -> Result<PurgeResult> {
        if ids.is_empty() {
            return Ok(PurgeResult::default());
        }
        let mut next = self.catalog.clone();
        let mut gone: Vec<Book> = vec![];
        for id in unique(ids) {
            let i = next
                .trash
                .iter()
                .position(|b| &b.id == id)
                .ok_or("PDF não encontrado")?;
            gone.push(next.trash.remove(i));
        }
        for book in &gone {
            next.archived.retain(|a| a.id != book.id);
            next.archived.push(Archived::from(book));
        }
        self.save(&next)?;
        self.catalog = next;
        let mut result = PurgeResult {
            purged: gone.len() as u32,
            ..Default::default()
        };
        for book in &gone {
            if !plain_file_name(&book.id) {
                result
                    .failed
                    .push(format!("{}: nome de arquivo inválido", book.title));
                continue;
            }
            let copy = self.root.join("pdfs").join(format!("{}.pdf", book.id));
            match fs::remove_file(&copy) {
                Ok(()) => result.freed += book.size,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => result.failed.push(format!(
                    "{}: a cópia do PDF não foi excluída ({e})",
                    book.title
                )),
            }
            let cover = self.root.join("covers").join(format!("{}.png", book.id));
            match fs::remove_file(&cover) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => result
                    .failed
                    .push(format!("{}: a capa não foi excluída ({e})", book.title)),
            }
        }
        Ok(result)
    }
    pub fn path(&self, id: &str) -> Result<PathBuf> {
        if !self.catalog.books.iter().any(|b| b.id == id) {
            return Err("PDF não encontrado".into());
        }
        Ok(self.root.join("pdfs").join(format!("{id}.pdf")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn historical_goals_are_initialized_once_and_survive_changes_and_restore() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("library");
        let source = d.path().join("book.pdf");
        fs::write(&source, b"%PDF-1.7\nfixture").unwrap();
        let mut l = Library::open(root.clone()).unwrap();
        let (b, _) = l.import(&source).unwrap();
        l.init_history("2026-10-01").unwrap();
        let before = fs::read(root.join("library.json")).unwrap();
        l.init_history("2026-10-02").unwrap();
        assert_eq!(before, fs::read(root.join("library.json")).unwrap());
        let patch:Patch=serde_json::from_value(serde_json::json!({"goalDay":"2026-10-10","readingGoal":{"mode":"custom","unit":"chapters","target":3}})).unwrap();
        l.update(&b.id, patch).unwrap();
        let invalid: Patch = serde_json::from_value(
            serde_json::json!({"goalDay":"2026-02-30","readingGoal":{"mode":"none"}}),
        )
        .unwrap();
        assert!(l.update(&b.id, invalid).is_err());
        let days = (1..=31)
            .map(|n| {
                (
                    format!("2026-10-{n:02}"),
                    crate::reading::ReadingDay {
                        page_adjustment: 8,
                        ..Default::default()
                    },
                )
            })
            .chain(std::iter::once((
                "2026-11-01".into(),
                crate::reading::ReadingDay::default(),
            )))
            .collect();
        l.update(
            &b.id,
            Patch {
                reading_days: Some(days),
                ..Default::default()
            },
        )
        .unwrap();
        l.remove(&b.id).unwrap();
        drop(l);
        let mut l = Library::open(root).unwrap();
        l.restore(&b.id).unwrap();
        let restored = &l.catalog.books[0];
        assert_eq!(restored.goal_history.len(), 2);
        assert!(matches!(
            restored.goal_history["2026-10-01"].mode,
            crate::reading::GoalMode::Inherit
        ));
        assert_eq!(restored.goal_history["2026-10-10"].target, 3);
        assert_eq!(restored.reading_days.len(), 32);
        assert_eq!(restored.reading_days["2026-10-01"].page_adjustment, 8);
    }
    #[test]
    fn the_three_goal_modes_stay_valid_in_goals_and_in_their_history() {
        // `inherit` and `none` both mean "no goal of its own" now, and `custom` is a goal of its
        // own. A catalog saved with any of them opens and is saved again as it was.
        let old = serde_json::json!({"id":"old","title":"Livro",
            "readingGoal":{"mode":"none","unit":"pages","target":10},
            "goalHistory":{
                "2026-10-01":{"mode":"inherit","unit":"pages","target":10},
                "2026-10-10":{"mode":"custom","unit":"chapters","target":2},
                "2026-10-20":{"mode":"none","unit":"pages","target":10}}});
        let book: Book = serde_json::from_value(old.clone()).unwrap();
        let saved = serde_json::to_value(book).unwrap();
        assert_eq!(saved["readingGoal"], old["readingGoal"]);
        assert_eq!(saved["goalHistory"], old["goalHistory"]);
        for mode in ["inherit", "custom", "none"] {
            let patch: Patch = serde_json::from_value(serde_json::json!({
                "goalDay":"2026-10-21","readingGoal":{"mode":mode,"unit":"pages","target":10}}))
            .unwrap();
            assert!(patch.reading_goal.unwrap().validate().is_ok());
        }
    }
    #[test]
    fn legacy_catalog_adds_goals_without_changing_reading_data() {
        let old = serde_json::json!({"id":"old", "page":42, "pages":300,
            "top":123.5, "left":24.0, "zoom":"page-width", "finished":true,
            "bookmarks":[12,42], "title":"Livro existente"});
        let book: Book = serde_json::from_value(old.clone()).unwrap();
        let saved = serde_json::to_value(book).unwrap();
        for (key, value) in old.as_object().unwrap() {
            assert_eq!(&saved[key], value);
        }
        assert_eq!(saved["readingGoal"]["mode"], "inherit");
        assert_eq!(saved["readingDays"], serde_json::json!({}));
    }
    #[test]
    fn goals_completion_and_daily_log_persist_and_reject_invalid_updates_atomically() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("library");
        let source = d.path().join("book.pdf");
        fs::write(&source, b"%PDF-1.7\nfixture").unwrap();
        let mut library = Library::open(root.clone()).unwrap();
        let (book, _) = library.import(&source).unwrap();
        let patch: Patch = serde_json::from_value(serde_json::json!({
            "pages":50,"page":39,"top":123.5,"left":8.0,"finished":true,
            "readingGoal":{"mode":"custom","unit":"chapters","target":2},
            "readingDays":{"2026-10-29":{"pages":[3,2,3],"chapters":[2],"pageAdjustment":5}}
        }))
        .unwrap();
        library.update(&book.id, patch).unwrap();
        let before = fs::read(root.join("library.json")).unwrap();
        for invalid in [
            serde_json::json!({"finished":false,"readingGoal":{"mode":"custom","target":0}}),
            serde_json::json!({"title":"changed","readingDays":{"2026-02-30":{"pages":[1]}}}),
            serde_json::json!({"readingDays":{"2026-10-29":{"pages":[51]}}}),
        ] {
            assert!(library
                .update(&book.id, serde_json::from_value(invalid).unwrap())
                .is_err());
            assert_eq!(fs::read(root.join("library.json")).unwrap(), before);
            assert!(library.catalog.books[0].finished);
        }
        library.remove(&book.id).unwrap();
        drop(library);
        let mut library = Library::open(root).unwrap();
        library.restore(&book.id).unwrap();
        let restored = &library.catalog.books[0];
        assert_eq!(restored.page, 39);
        assert_eq!(restored.top, Some(123.5));
        assert_eq!(restored.left, Some(8.0));
        assert!(restored.finished);
        assert_eq!(restored.reading_goal.target, 2);
        assert_eq!(restored.reading_days["2026-10-29"].pages, vec![2, 3]);
        assert_eq!(restored.reading_days["2026-10-29"].page_adjustment, 5);
        library
            .update(
                &book.id,
                Patch {
                    finished: Some(false),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(library.catalog.books[0].page, 39);
        assert!(!library.catalog.books[0].finished);
    }
    #[test]
    fn independent_copy_dedup_resume_and_restore() {
        let d = tempfile::tempdir().unwrap();
        let source = d.path().join("origem.pdf");
        fs::write(&source, b"%PDF-1.7\ntest fixture").unwrap();
        let root = d.path().join("library");
        let mut l = Library::open(root.clone()).unwrap();
        let (b, dup) = l.import(&source).unwrap();
        assert!(!dup);
        assert!(l.import(&source).unwrap().1);
        fs::remove_file(source).unwrap();
        assert!(l.path(&b.id).unwrap().exists());
        l.update(
            &b.id,
            Patch {
                pages: Some(12),
                page: Some(7),
                top: Some(333.0),
                favorite: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        drop(l);
        let mut l = Library::open(root).unwrap();
        assert_eq!(l.catalog.books[0].page, 7);
        assert_eq!(l.catalog.books[0].top, Some(333.0));
        l.remove(&b.id).unwrap();
        assert!(l.catalog.books.is_empty());
        l.restore(&b.id).unwrap();
        assert_eq!(l.catalog.books[0].page, 7);
        assert!(l.catalog.books[0].favorite);
    }
    #[test]
    fn invalid_and_same_name_different_bytes() {
        let d = tempfile::tempdir().unwrap();
        let mut l = Library::open(d.path().join("lib")).unwrap();
        let p = d.path().join("same.pdf");
        fs::write(&p, b"invalid").unwrap();
        assert!(l.import(&p).is_err());
        fs::write(&p, b"%PDF-1.4\nA").unwrap();
        l.import(&p).unwrap();
        fs::write(&p, b"%PDF-1.4\nB").unwrap();
        l.import(&p).unwrap();
        assert_eq!(l.catalog.books.len(), 2);
        assert_ne!(l.catalog.books[0].id, l.catalog.books[1].id);
        assert!(l.path("../../secret").is_err());
    }
    #[test]
    fn corrupt_catalog_recovers_backup() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("lib");
        let mut l = Library::open(root.clone()).unwrap();
        let p = d.path().join("sample.pdf");
        fs::write(&p, b"%PDF-1.4\nA").unwrap();
        let (b, _) = l.import(&p).unwrap();
        l.update(
            &b.id,
            Patch {
                favorite: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        fs::write(root.join("library.json"), b"broken").unwrap();
        let recovered = Library::open(root).unwrap();
        assert_eq!(recovered.catalog.books.len(), 1);
        assert!(recovered.warning.is_some());
        assert!(recovered.path(&b.id).unwrap().exists());
    }
    #[test]
    fn purge_deletes_copies_keeps_history_and_refuses_documents_outside_removidos() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("lib");
        let mut l = Library::open(root.clone()).unwrap();
        let first = d.path().join("first.pdf");
        let second = d.path().join("second.pdf");
        fs::write(&first, b"%PDF-1.4\nfirst").unwrap();
        fs::write(&second, b"%PDF-1.4\nsecond").unwrap();
        let (a, _) = l.import(&first).unwrap();
        let (b, _) = l.import(&second).unwrap();
        let copy = root.join("pdfs").join(format!("{}.pdf", a.id));
        let cover = root.join("covers").join(format!("{}.png", a.id));
        fs::write(&cover, b"png").unwrap();
        let day = crate::reading::ReadingDay {
            page_adjustment: 5,
            ..Default::default()
        };
        l.update(
            &a.id,
            Patch {
                reading_days: Some([("2026-10-28".to_string(), day)].into()),
                ..Default::default()
            },
        )
        .unwrap();
        l.remove(&a.id).unwrap();
        // A document still in the library is refused, and nothing is deleted.
        assert!(l.purge(&[a.id.clone(), b.id.clone()]).is_err());
        assert_eq!(l.catalog.trash.len(), 1);
        assert!(copy.exists() && cover.exists());
        let result = l.purge(&[a.id.clone(), a.id.clone()]).unwrap();
        assert_eq!(result.purged, 1);
        assert_eq!(result.freed, a.size);
        assert!(result.failed.is_empty());
        assert!(!copy.exists() && !cover.exists());
        assert!(l.path(&b.id).unwrap().exists());
        drop(l);
        let mut l = Library::open(root).unwrap();
        assert!(l.catalog.trash.is_empty());
        assert_eq!(l.catalog.archived.len(), 1);
        let archived = &l.catalog.archived[0];
        assert_eq!(
            (archived.id.as_str(), archived.title.as_str()),
            (a.id.as_str(), "first")
        );
        assert_eq!(archived.reading_days["2026-10-28"].page_adjustment, 5);
        // The same bytes imported again make a new document, not the archived one.
        let (again, dup) = l.import(&first).unwrap();
        assert!(!dup);
        assert_ne!(again.id, a.id);
        // A copy already gone is not a failure.
        l.remove(&again.id).unwrap();
        fs::remove_file(l.root.join("pdfs").join(format!("{}.pdf", again.id))).unwrap();
        let result = l.purge(std::slice::from_ref(&again.id)).unwrap();
        assert_eq!((result.purged, result.freed), (1, 0));
        assert!(result.failed.is_empty());
    }
    #[test]
    fn tags_are_trimmed_deduplicated_and_limited() {
        let tags = normalize_tags(vec![
            "  Ficção   científica ".into(),
            "ficcao cientifica".into(),
            "".into(),
            "Estudo".into(),
        ])
        .unwrap();
        assert_eq!(tags, ["Ficção científica", "Estudo"]);
        assert!(normalize_tags(vec!["x".repeat(MAX_TAG_CHARS + 1)]).is_err());
        assert!(normalize_tags(vec!["a\u{7}b".into()]).is_err());
        assert_eq!(
            normalize_tags((0..MAX_TAGS).map(|n| format!("t{n}")).collect())
                .unwrap()
                .len(),
            MAX_TAGS
        );
        assert!(normalize_tags((0..=MAX_TAGS).map(|n| format!("t{n}")).collect()).is_err());
        let d = tempfile::tempdir().unwrap();
        let mut l = Library::open(d.path().join("lib")).unwrap();
        let p = d.path().join("tagged.pdf");
        fs::write(&p, b"%PDF-1.4\ntags").unwrap();
        let (b, _) = l.import(&p).unwrap();
        let refused = l.update(
            &b.id,
            Patch {
                favorite: Some(true),
                tags: Some(vec!["y".repeat(MAX_TAG_CHARS + 1)]),
                ..Default::default()
            },
        );
        assert!(refused.is_err());
        assert!(!l.catalog.books[0].favorite);
    }
    #[test]
    fn folders_expand_to_their_pdfs_without_following_other_files() {
        let d = tempfile::tempdir().unwrap();
        let folder = d.path().join("Livros");
        fs::create_dir_all(folder.join("b").join("c")).unwrap();
        fs::write(folder.join("b").join("c").join("Fundo.PDF"), b"%PDF-1.4\n1").unwrap();
        fs::write(folder.join("a.pdf"), b"%PDF-1.4\n2").unwrap();
        fs::write(folder.join("notas.txt"), b"texto").unwrap();
        let chosen = d.path().join("escolhido.txt");
        fs::write(&chosen, b"texto").unwrap();
        let (files, problems) = expand_import_paths(&[folder.clone(), chosen.clone()]);
        assert!(problems.is_empty());
        assert_eq!(
            files,
            [
                folder.join("a.pdf"),
                folder.join("b").join("c").join("Fundo.PDF"),
                chosen
            ]
        );
    }
}
