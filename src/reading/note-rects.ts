import type { Note, NoteRect } from '../types';

// Geometry of the highlights, as numbers only, so that it can be checked without a window.
// Two spaces are used: the window (a `Box`, in pixels) while a selection is read, and the PDF
// (a `NoteRect`, in page units) for what is saved, which does not depend on the zoom or rotation.
export type Box = { left: number; top: number; right: number; bottom: number };

// The most rectangles of one highlight; the catalog refuses more (src-tauri/src/notes.rs).
export const MAX_NOTE_RECTS = 500;

const finiteBox = (b: Box) => [b.left, b.top, b.right, b.bottom].every(Number.isFinite);

// The rectangles of a note that can be drawn: four finite numbers each. A damaged value is
// left out instead of stopping the page.
export function noteRects(note: Pick<Note, 'rects'>): NoteRect[] {
  if (!Array.isArray(note.rects)) return [];
  return note.rects
    .filter((r) => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite))
    .slice(0, MAX_NOTE_RECTS);
}

export const isHighlight = (note: Pick<Note, 'rects'>) => noteRects(note).length > 0;

// A rectangle between two corners, whichever way they were given (a rotated page turns them),
// with two decimals: a hundredth of a point is far below what the eye can tell.
export function rectBetween(x1: number, y1: number, x2: number, y2: number): NoteRect {
  const round = (n: number) => Math.round(n * 100) / 100;
  return [
    round(Math.min(x1, x2)),
    round(Math.min(y1, y2)),
    round(Math.max(x1, x2)),
    round(Math.max(y1, y2)),
  ];
}

// The part of `box` that is inside `within`, or null when nothing is.
export function clipBox(box: Box, within: Box): Box | null {
  const clipped = {
    left: Math.max(box.left, within.left),
    top: Math.max(box.top, within.top),
    right: Math.min(box.right, within.right),
    bottom: Math.min(box.bottom, within.bottom),
  };
  return clipped.right > clipped.left && clipped.bottom > clipped.top ? clipped : null;
}

// What a range of text reports is one rectangle for each piece of text and each element in it,
// several on a line and some repeated. A highlight wants one for each line: the rectangles
// that share a line (more than half of the shorter one's height in common) and touch, or are
// no further apart than `gap` times the height of the line (a space between two words), are one.
// The result goes from the top down and, in a line, from left to right.
export function mergeLineRects(boxes: readonly Box[], gap = 0.75): Box[] {
  const usable = boxes
    .filter((b) => finiteBox(b) && b.right - b.left >= 1 && b.bottom - b.top >= 1)
    .sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: { top: number; bottom: number; items: Box[] }[] = [];
  for (const box of usable) {
    const row = rows.find((r) => {
      const shared = Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top);
      return shared > 0.5 * Math.min(box.bottom - box.top, r.bottom - r.top);
    });
    if (row) {
      row.items.push(box);
      row.top = Math.min(row.top, box.top);
      row.bottom = Math.max(row.bottom, box.bottom);
    } else rows.push({ top: box.top, bottom: box.bottom, items: [box] });
  }
  const lines: Box[] = [];
  for (const row of rows) {
    const reach = gap * (row.bottom - row.top);
    let open: Box | null = null;
    for (const item of row.items.sort((a, b) => a.left - b.left)) {
      if (open && item.left - open.right <= reach) {
        open = {
          left: Math.min(open.left, item.left),
          top: Math.min(open.top, item.top),
          right: Math.max(open.right, item.right),
          bottom: Math.max(open.bottom, item.bottom),
        };
      } else {
        if (open) lines.push(open);
        open = { ...item };
      }
    }
    if (open) lines.push(open);
  }
  return lines.sort((a, b) => a.top - b.top || a.left - b.left);
}

// How high on the page a highlight is: its highest edge (a larger y is higher in PDF space).
// Null for a note that is not a highlight.
export function noteTop(note: Pick<Note, 'rects'>): number | null {
  const rects = noteRects(note);
  return rects.length ? Math.max(...rects.map((r) => Math.max(r[1], r[3]))) : null;
}

// Reading order, the same one the export uses (src-tauri/src/notes.rs): by page; on a page, the
// highlights from the top down and then the notes that point at no place; and by the time they
// were made when nothing else tells them apart.
export function noteOrder(a: Note, b: Note): number {
  if (a.page !== b.page) return a.page - b.page;
  const x = noteTop(a),
    y = noteTop(b);
  if (x !== null && y !== null) {
    if (x !== y) return y - x;
  } else if (x !== null) return -1;
  else if (y !== null) return 1;
  if (a.created !== b.created) return a.created - b.created;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
