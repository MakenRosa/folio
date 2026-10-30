// The colours of a highlight, by the name that is saved (the same four as src-tauri/src/notes.rs).
export type NoteColor = 'yellow' | 'green' | 'blue' | 'pink';
// A rectangle of a highlight in PDF units, [x1, y1, x2, y2] with x1 <= x2 and y1 <= y2.
// It does not depend on the zoom or the rotation, and it is one line of text.
export type NoteRect = [number, number, number, number];
export interface Note {
  id: string;
  page: number;
  text: string;
  quote: string;
  created: number;
  // A highlight is a note with `rects`; its text can be empty. Notes from before have neither.
  rects?: NoteRect[];
  color?: NoteColor;
}
export interface Book {
  goalHistory?: Record<string, BookGoal>;
  readingGoal?: BookGoal;
  readingDays?: Record<string, ReadingDay>;
  id: string;
  title: string;
  // From the PDF's own metadata, read in the background after the import. Empty when it has none.
  author: string;
  originalName: string;
  hash: string;
  size: number;
  added: number;
  lastOpened: number;
  page: number;
  pages: number;
  top: number | null;
  left: number | null;
  zoom: string;
  rotation: number;
  favorite: boolean;
  finished: boolean;
  bookmarks: number[];
  notes: Note[];
  cover: boolean;
  // Free labels of the reader, at most 20 (see library/tags.ts).
  tags: string[];
}
// What stays of a document that was deleted for good: no file, only what the reading history
// needs. It is never listed in the library or in Removidos.
export interface ArchivedBook {
  id: string;
  title: string;
  author: string;
  readingDays: Record<string, ReadingDay>;
  goalHistory: Record<string, BookGoal>;
}
// What `purge_books` did: the documents that left the catalog, the bytes of PDF copies deleted,
// and one line for each file that could not be deleted.
export interface PurgeResult {
  purged: number;
  freed: number;
  failed: string[];
}
// A document an import found already in the library.
export interface ExistingBook {
  id: string;
  title: string;
}
// What `import_pdfs` says: the books that came in (or came back from Removidos), those that
// were already there (`duplicates` counts them), and one line for each file that failed.
export interface ImportResult {
  added: Book[];
  duplicates: number;
  existing: ExistingBook[];
  errors: string[];
}
export interface Snapshot {
  books: Book[];
  trash: Book[];
  archived: ArchivedBook[];
  folder: string;
  warning: string | null;
}
export type ReadingMode = 'scroll' | 'kindle';
// The sections of the reader's side bar, in the order of its tabs.
export type SidebarTab = 'outline' | 'pages' | 'bookmarks' | 'notes';
// Pages side by side while scrolling: none, pairs starting on odd pages (1-2, 3-4),
// or the cover alone and then pairs starting on even pages (2-3, 4-5).
export type Spread = 'none' | 'odd' | 'even';
// Moving average of the active reading time per PDF page, kept for one book.
export interface PaceEntry {
  seconds: number;
  samples: number;
  updated: number;
}
export interface Preferences {
  pace: Record<string, PaceEntry>;
  goalHistory: Record<string, DailyGoal | null>;
  dailyGoal: DailyGoal | null;
  theme: 'light' | 'dark' | 'system';
  paper: 'light' | 'dark' | 'sepia';
  warm: number;
  brightness: number;
  readingMode: ReadingMode;
  spread: Spread;
  sidebarOpen: boolean;
  sidebarTab: SidebarTab;
  sidebarWidth: number;
  joinPages: boolean;
  chapterBreaks: boolean;
  resume: boolean;
  // The keys of one letter (K, L, S, D, R, H, N) act in the reader. Off, only the shortcuts with
  // Ctrl or Alt, the arrows and the like do (WCAG 2.1.4).
  singleKeys: boolean;
  view: 'grid' | 'list';
  sort: string;
  // The tips already shown, by name (see hints.ts). Each is shown only once.
  hints: string[];
}
export type GoalUnit = 'pages' | 'chapters';
export interface DailyGoal {
  unit: GoalUnit;
  target: number;
}
// A document has a goal of its own (`custom`) or none of its own. `inherit` and `none` both mean
// "no goal of its own": the document only counts in the general goal. New saves write `inherit`;
// `none` is what older catalogs may hold, and all three stay valid in the catalog (the native side
// accepts them).
export interface BookGoal extends DailyGoal {
  mode: 'inherit' | 'custom' | 'none';
}
export interface ReadingDay {
  pages: number[];
  chapters: number[];
  pageAdjustment: number;
  chapterAdjustment: number;
}
