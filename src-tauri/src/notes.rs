// Notes and highlights: what the catalog accepts of them, and the Markdown they are exported to.
// A highlight is a note with `rects` (one rectangle in PDF units for each line of text, as
// [x1, y1, x2, y2]) and a colour; its text may be empty. Nothing here touches the PDF.
use crate::library::{Book, Note, Result};
use std::{cmp::Ordering, io::Write, path::Path};

// The colours a highlight can have, by the name that is saved.
pub const COLORS: [&str; 4] = ["yellow", "green", "blue", "pink"];
// The most notes a document may have, and the longest text or quote of one, in bytes.
const MAX_NOTES: usize = 10_000;
const MAX_NOTE_BYTES: usize = 20_000;
// The most rectangles of one highlight (about a page of lines is a hundred), and of a document.
pub const MAX_NOTE_RECTS: usize = 500;
const MAX_BOOK_RECTS: usize = 100_000;
// PDF pages are a few thousand units wide at most; this only keeps absurd values out.
const MAX_COORDINATE: f64 = 1_000_000.0;

fn colour_name(color: &str) -> &'static str {
    match color {
        "green" => "verde",
        "blue" => "azul",
        "pink" => "rosa",
        _ => "amarelo",
    }
}

// The notes as they are kept, or the reason they are refused (nothing is changed then). A note
// without rectangles is a plain note: it has no colour. Empty rectangles are no rectangles.
pub fn normalize(mut notes: Vec<Note>) -> Result<Vec<Note>> {
    if notes.len() > MAX_NOTES
        || notes
            .iter()
            .any(|n| n.text.len() > MAX_NOTE_BYTES || n.quote.len() > MAX_NOTE_BYTES)
    {
        return Err("Limite de notas excedido.".into());
    }
    let mut total = 0;
    for note in &mut notes {
        if note.rects.as_ref().is_some_and(|r| r.is_empty()) {
            note.rects = None;
        }
        if let Some(color) = &note.color {
            if !COLORS.contains(&color.as_str()) {
                return Err("Cor de realce inválida.".into());
            }
        }
        match &note.rects {
            Some(rects) => {
                if rects.len() > MAX_NOTE_RECTS {
                    return Err(format!(
                        "Um realce pode ter no máximo {MAX_NOTE_RECTS} linhas."
                    ));
                }
                if rects
                    .iter()
                    .flatten()
                    .any(|v| !v.is_finite() || v.abs() > MAX_COORDINATE)
                {
                    return Err("Posição de realce inválida.".into());
                }
                total += rects.len();
            }
            None => note.color = None,
        }
    }
    if total > MAX_BOOK_RECTS {
        return Err("Limite de realces excedido.".into());
    }
    Ok(notes)
}

// How high on the page the first line of a highlight is (the larger y is higher in PDF space).
fn top_of(note: &Note) -> Option<f64> {
    note.rects
        .as_ref()?
        .iter()
        .map(|r| r[1].max(r[3]))
        .max_by(f64::total_cmp)
}

// Reading order: by page, the highlights from the top of the page down, then the notes that
// quote nothing in a place, and by the time they were made when nothing else tells them apart.
fn reading_order(a: &Note, b: &Note) -> Ordering {
    a.page
        .cmp(&b.page)
        .then_with(|| match (top_of(a), top_of(b)) {
            (Some(x), Some(y)) => y.total_cmp(&x),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => Ordering::Equal,
        })
        .then_with(|| a.created.cmp(&b.created))
        .then_with(|| a.id.cmp(&b.id))
}

// A day in the proleptic Gregorian calendar, from the days since 1970-01-01.
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

// "29/10/2026", for the moment a note was made, in the reader's time zone. The web side saves
// milliseconds; seconds are accepted too. Nothing when the note has no date.
fn date_of(created: u64, offset_minutes: i32) -> Option<String> {
    if created == 0 {
        return None;
    }
    let seconds = i64::try_from(if created > 100_000_000_000 {
        created / 1000
    } else {
        created
    })
    .ok()?;
    let local = seconds + i64::from(offset_minutes.clamp(-14 * 60, 14 * 60)) * 60;
    let (year, month, day) = civil(local.div_euclid(86_400));
    Some(format!("{day:02}/{month:02}/{year:04}"))
}

// A title or an author on one line.
fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

// The notes of a document as Markdown: the title, the author when there is one, and then the
// notes by page, each with its quote, its text and its date. `offset_minutes` is the reader's
// distance from UTC (east is positive), so that a note made at night keeps its day.
pub fn markdown(book: &Book, offset_minutes: i32) -> String {
    let title = one_line(&book.title);
    let mut out = format!(
        "# {}\n",
        if title.is_empty() {
            "Documento sem título"
        } else {
            &title
        }
    );
    let author = one_line(&book.author);
    if !author.is_empty() {
        out.push_str(&format!("\nAutor: {author}\n"));
    }
    let mut notes: Vec<&Note> = book.notes.iter().collect();
    notes.sort_by(|a, b| reading_order(a, b));
    let mut page = None;
    for note in notes {
        if page != Some(note.page) {
            page = Some(note.page);
            out.push_str(&format!("\n## Página {}\n", note.page));
        }
        let mut blocks: Vec<String> = vec![];
        let quote = note.quote.trim();
        if !quote.is_empty() {
            blocks.push(
                quote
                    .lines()
                    .map(|line| match line.trim_end() {
                        "" => ">".to_string(),
                        line => format!("> {line}"),
                    })
                    .collect::<Vec<_>>()
                    .join("\n"),
            );
        }
        let text = note.text.trim();
        if !text.is_empty() {
            blocks.push(text.to_string());
        }
        let kind = match (&note.rects, text.is_empty()) {
            (Some(_), true) => format!(
                "Realce {}",
                colour_name(note.color.as_deref().unwrap_or("yellow"))
            ),
            (Some(_), false) => format!(
                "Nota com realce {}",
                colour_name(note.color.as_deref().unwrap_or("yellow"))
            ),
            (None, _) => "Nota".to_string(),
        };
        blocks.push(match date_of(note.created, offset_minutes) {
            Some(date) => format!("*{kind} · {date}*"),
            None => format!("*{kind}*"),
        });
        out.push_str(&format!("\n{}\n", blocks.join("\n\n")));
    }
    out
}

// Writes the file all at once: a temporary file in the same folder, flushed, then moved over the
// destination, so that a failure never leaves half a file, nor loses the one that was there.
// The destination must be a Markdown file.
pub fn write_markdown(destination: &Path, text: &str) -> Result<()> {
    let markdown = destination
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"));
    if !markdown {
        return Err("Escolha um arquivo com a extensão .md.".into());
    }
    if destination.is_dir() {
        return Err("Escolha um nome de arquivo, não uma pasta.".into());
    }
    let folder = match destination.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    };
    let mut temp = tempfile::NamedTempFile::new_in(folder).map_err(|e| e.to_string())?;
    temp.write_all(text.as_bytes())
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    temp.persist(destination).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn note(id: &str, page: u32, rects: Option<Vec<[f64; 4]>>, color: Option<&str>) -> Note {
        Note {
            id: id.into(),
            page,
            rects,
            color: color.map(Into::into),
            ..Default::default()
        }
    }
    #[test]
    fn highlights_are_validated_and_plain_notes_lose_their_colour() {
        let kept = normalize(vec![
            note("a", 1, Some(vec![[1.0, 2.0, 3.0, 4.0]]), Some("green")),
            note("b", 1, Some(vec![]), Some("pink")),
            note("c", 2, None, Some("blue")),
        ])
        .unwrap();
        assert_eq!(kept[0].color.as_deref(), Some("green"));
        assert!(kept[1].rects.is_none() && kept[1].color.is_none());
        assert!(kept[2].color.is_none());
        let rects = |r: [f64; 4]| vec![note("x", 1, Some(vec![r]), None)];
        assert!(normalize(rects([f64::NAN, 0.0, 1.0, 1.0])).is_err());
        assert!(normalize(rects([0.0, 0.0, 2e6, 1.0])).is_err());
        assert!(normalize(vec![note("x", 1, Some(vec![[0.0; 4]]), Some("red"))]).is_err());
        let many = vec![[0.0, 0.0, 1.0, 1.0]; MAX_NOTE_RECTS + 1];
        assert!(normalize(vec![note("x", 1, Some(many), None)]).is_err());
    }
    #[test]
    fn markdown_lists_notes_in_reading_order_with_local_dates() {
        // 2026-10-29 00:30 UTC is still the 28th three hours west of UTC.
        let created = 1_793_233_800_000;
        let book = Book {
            title: "Livro\nde teste".into(),
            author: "Ana Autora".into(),
            notes: vec![
                Note {
                    text: "Depois".into(),
                    created,
                    ..note("late", 3, None, None)
                },
                Note {
                    quote: "Linha baixa".into(),
                    created,
                    ..note(
                        "low",
                        2,
                        Some(vec![[0.0, 100.0, 50.0, 110.0]]),
                        Some("blue"),
                    )
                },
                Note {
                    quote: "Linha alta".into(),
                    text: "Minha ideia".into(),
                    created,
                    ..note("high", 2, Some(vec![[0.0, 600.0, 50.0, 610.0]]), None)
                },
            ],
            ..Default::default()
        };
        let text = markdown(&book, -180);
        assert!(text.starts_with("# Livro de teste\n\nAutor: Ana Autora\n"));
        let high = text.find("> Linha alta").unwrap();
        let low = text.find("> Linha baixa").unwrap();
        let page3 = text.find("## Página 3").unwrap();
        assert!(text.find("## Página 2").unwrap() < high && high < low && low < page3);
        assert!(text.contains("Minha ideia\n\n*Nota com realce amarelo · 28/10/2026*"));
        assert!(text.contains("*Realce azul · 28/10/2026*"));
        assert!(markdown(&book, 0).contains("*Nota · 29/10/2026*"));
    }
    #[test]
    fn export_requires_a_markdown_file() {
        let d = tempfile::tempdir().unwrap();
        assert!(write_markdown(&d.path().join("notas.txt"), "x").is_err());
        let destination = d.path().join("notas.MD");
        write_markdown(&destination, "# Notas\n").unwrap();
        assert_eq!(std::fs::read_to_string(destination).unwrap(), "# Notas\n");
    }
}
