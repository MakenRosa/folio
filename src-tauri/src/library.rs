use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub type Result<T> = std::result::Result<T, String>;
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
}
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Book {
    pub id: String,
    pub title: String,
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
}
impl Default for Book {
    fn default() -> Self {
        Self {
            id: String::new(),
            title: String::new(),
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
        }
    }
}
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Catalog {
    pub version: u32,
    pub books: Vec<Book>,
    pub trash: Vec<Book>,
}
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Patch {
    pub title: Option<String>,
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
}
pub struct Library {
    pub root: PathBuf,
    pub catalog: Catalog,
    pub warning: Option<String>,
}
impl Library {
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
        if !path
            .extension()
            .map(|v| v.eq_ignore_ascii_case("pdf"))
            .unwrap_or(false)
        {
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
        if let Some(v) = patch.title {
            if v.trim().is_empty() || v.len() > 500 {
                return Err("Use um título entre 1 e 500 caracteres.".into());
            }
            book.title = v.trim().into()
        }
        if let Some(v) = patch.last_opened {
            book.last_opened = v
        }
        if let Some(v) = patch.pages {
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
        if let Some(v) = patch.bookmarks {
            book.bookmarks = v
                .into_iter()
                .filter(|p| *p >= 1 && *p <= book.pages)
                .collect()
        }
        if let Some(v) = patch.notes {
            if v.len() > 10000
                || v.iter()
                    .any(|n| n.text.len() > 20000 || n.quote.len() > 20000)
            {
                return Err("Limite de notas excedido.".into());
            }
            book.notes = v
        }
        let result = book.clone();
        self.save(&next)?;
        self.catalog = next;
        Ok(result)
    }
    pub fn remove(&mut self, id: &str) -> Result<()> {
        let mut next = self.catalog.clone();
        let i = next
            .books
            .iter()
            .position(|b| b.id == id)
            .ok_or("PDF não encontrado")?;
        next.trash.push(next.books.remove(i));
        self.save(&next)?;
        self.catalog = next;
        Ok(())
    }
    pub fn restore(&mut self, id: &str) -> Result<()> {
        let mut next = self.catalog.clone();
        let i = next
            .trash
            .iter()
            .position(|b| b.id == id)
            .ok_or("PDF não encontrado")?;
        next.books.push(next.trash.remove(i));
        self.save(&next)?;
        self.catalog = next;
        Ok(())
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
}
