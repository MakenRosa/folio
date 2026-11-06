import type { Book } from '../types';

// What the library queue takes from a PDF, and what it does with it. Pure: no DOM and no PDF.js,
// so that the rules can be tested alone.

// A book the queue has something to give: no cover yet, or no page count.
export function needsMetadata(book: Pick<Book, 'cover' | 'pages'>): boolean {
  return !book.cover || !book.pages;
}

// The most characters of a title or an author that the library keeps from a PDF.
export const MAX_TITLE = 200;
export const MAX_AUTHOR = 200;
// A title shorter than this says too little to replace the name of the file.
const MIN_TITLE = 3;

// Text from a PDF's information, as one tidy line: no control characters, spaces collapsed.
// Anything that is not text is nothing.
export function cleanText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// The name of a file as the library first calls the document: without the `.pdf`.
export function fileStem(originalName: string): string {
  return originalName.replace(/\.pdf$/i, '');
}

// What programs put in the Title of a PDF when nobody wrote one.
const PLACEHOLDERS = [
  // "Untitled", "Untitled-1", "Sem título 2", "Documento1", "Novo documento", "Slide 1".
  /^(untitled|no title|sem t[ií]tulo|sem nome|t[ií]tulo|title|unbenannt|sin t[ií]tulo)(?:[\s._-]*(?:document|documento|presentation|apresenta[cç][aã]o))?[\s._-]*\d*$/i,
  /^(new |novo )?(document|documento|doc|presentation|apresenta[cç][aã]o|slide|planilha|spreadsheet|sheet|page|p[aá]gina)[\s._-]*\d*$/i,
  // What a scanner, a camera or a print driver names a file.
  /^(scan|scanned|img|image|imagem|dsc|cci|print|copy|c[oó]pia|file|arquivo)[\s._-]*\d+$/i,
  // "Microsoft Word - Relatório", "Microsoft PowerPoint - aula.pptx".
  /^microsoft[\s®]+(office[\s®]+)?(word|excel|powerpoint|publisher|visio|access|project|outlook|onenote)\b/i,
  /^(powerpoint presentation|apresenta[cç][aã]o do powerpoint)\b/i,
  // A path.
  /^[a-z]:[\\/]/i,
];
// A title that is a file name: "relatorio_final.doc", "Livro.pdf".
const FILE_NAME = /\.(docx?|dotx?|pptx?|xlsx?|odt|ods|odp|rtf|txt|pdf|indd|tex|pub|psd|html?)$/i;

// The title of a PDF if it is worth showing instead of the name of the file, or `null`. It is not
// worth showing when it is empty, too short or too long, "untitled", the name of a program
// ("Microsoft Word - …"), a file name, or has no letter in it (only numbers or punctuation).
export function plausibleTitle(raw: unknown): string | null {
  const title = cleanText(raw);
  if (title.length < MIN_TITLE || title.length > MAX_TITLE) return null;
  if (!/\p{L}/u.test(title)) return null;
  if (FILE_NAME.test(title)) return null;
  if (PLACEHOLDERS.some((rule) => rule.test(title))) return null;
  return title;
}

// Names that stand for nobody: what a program fills in when it does not know the author.
const NOBODY =
  /^(unknown|desconhecido|an[oô]nimo|anonymous|admin|administrator|administrador|user|usu[aá]rio|owner|author|autor|n\/?a|none|null|undefined|windows user|usu[aá]rio do windows)$/i;

// The author of a PDF, as one short line, or an empty text when there is nothing to show.
export function cleanAuthor(raw: unknown): string {
  const author = cleanText(raw);
  if (!/\p{L}/u.test(author) || NOBODY.test(author)) return '';
  return author.length > MAX_AUTHOR ? `${author.slice(0, MAX_AUTHOR - 1).trimEnd()}…` : author;
}

export type PdfFacts = {
  pages: number;
  // `info.Title` and `info.Author` of the PDF, as PDF.js gives them.
  title?: unknown;
  author?: unknown;
};
export type MetadataPatch = Partial<Pick<Book, 'pages' | 'author' | 'title'>>;

// What to write to the book, given what the PDF says: only what is new. The page count when it
// differs; the author when there is one; the title only while the book still has the name that
// the import gave it (the file name without extension, so the reader never renamed it) and the
// PDF's own title is plausible.
export function metadataPatch(
  book: Pick<Book, 'title' | 'author' | 'pages' | 'originalName'>,
  facts: PdfFacts,
): MetadataPatch {
  const patch: MetadataPatch = {};
  if (Number.isInteger(facts.pages) && facts.pages > 0 && facts.pages !== book.pages)
    patch.pages = facts.pages;
  const author = cleanAuthor(facts.author);
  if (author && author !== book.author) patch.author = author;
  const title = plausibleTitle(facts.title);
  if (title && title !== book.title && book.title === fileStem(book.originalName))
    patch.title = title;
  return patch;
}
