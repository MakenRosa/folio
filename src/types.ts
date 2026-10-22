export interface Note {
  id: string;
  page: number;
  text: string;
  quote: string;
  created: number;
}
export interface Book {
  id: string;
  title: string;
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
}
export interface Snapshot {
  books: Book[];
  trash: Book[];
  folder: string;
  warning: string | null;
}
export type ReadingMode = 'scroll' | 'kindle';
export interface Preferences {
  theme: 'light' | 'dark' | 'system';
  paper: 'light' | 'dark' | 'sepia';
  warm: number;
  brightness: number;
  readingMode: ReadingMode;
  resume: boolean;
  view: 'grid' | 'list';
  sort: string;
}
