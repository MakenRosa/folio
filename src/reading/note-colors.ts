import type { Note, NoteColor } from '../types';

// The four colours of a highlight. The names are saved in the catalog (and checked by
// src-tauri/src/notes.rs), so they do not change; the words are only for the reader.
export const NOTE_COLORS: readonly NoteColor[] = ['yellow', 'green', 'blue', 'pink'];
export const DEFAULT_NOTE_COLOR: NoteColor = 'yellow';
export const COLOR_LABELS: Record<NoteColor, string> = {
  yellow: 'Amarelo',
  green: 'Verde',
  blue: 'Azul',
  pink: 'Rosa',
};

export const isNoteColor = (value: unknown): value is NoteColor =>
  NOTE_COLORS.includes(value as NoteColor);

// The colour a note is drawn with; a highlight from before colours (or a damaged value) is yellow.
export const colorOf = (note: Pick<Note, 'color'>): NoteColor =>
  isNoteColor(note.color) ? note.color : DEFAULT_NOTE_COLOR;

// The last colour the reader used, which the shortcut and the next highlight start from. It is
// a convenience: a storage that fails gives the default, and never stops a highlight.
const COLOR_KEY = 'folio.highlight-color';
export function rememberedColor(storage: Pick<Storage, 'getItem'> = localStorage): NoteColor {
  try {
    const saved = storage.getItem(COLOR_KEY);
    return isNoteColor(saved) ? saved : DEFAULT_NOTE_COLOR;
  } catch {
    return DEFAULT_NOTE_COLOR;
  }
}
export function rememberColor(color: NoteColor, storage: Pick<Storage, 'setItem'> = localStorage) {
  try {
    storage.setItem(COLOR_KEY, color);
  } catch {
    /* The colour only comes back as the default. */
  }
}
