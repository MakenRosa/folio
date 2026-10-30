import type { NoteRect } from '../types';
import { MAX_NOTE_RECTS, clipBox, mergeLineRects, rectBetween, type Box } from './note-rects';

// What PDF.js's page view says about a page that is shown: its size in pixels, and how a point
// of it is in PDF units. `viewport` of a page view has both, with the rotation in effect.
export interface PageGeometry {
  width: number;
  height: number;
  convertToPdfPoint(x: number, y: number): number[];
}

// The part of a selection that is on one page: what it says, where it is in PDF units (one
// rectangle for each line) and in the window (the same lines, in pixels, to place things near it).
export interface SelectedPiece {
  page: number;
  quote: string;
  rects: NoteRect[];
  lines: Box[];
}
export interface SelectionCapture {
  // From the first page to the last. A selection across pages has one piece for each page.
  pieces: SelectedPiece[];
}

// A quote is saved with the note, and the catalog accepts 20 000 bytes of it; a passage that long
// is cut before the note is refused.
const MAX_QUOTE_BYTES = 19_000;
function fitQuote(text: string) {
  const bytes = new TextEncoder();
  let fitted = text;
  while (bytes.encode(fitted).length > MAX_QUOTE_BYTES) fitted = fitted.slice(0, -200);
  return fitted;
}

// The part of `range` that is inside the text of one page, or null when none of it is.
function within(range: Range, layer: HTMLElement) {
  const part = document.createRange();
  part.selectNodeContents(layer);
  if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0)
    part.setStart(range.startContainer, range.startOffset);
  if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0)
    part.setEnd(range.endContainer, range.endOffset);
  return part.collapsed ? null : part;
}

// Where the selected text is, as one rectangle for each piece of it (and no more). The rectangles
// of the range itself also count the boxes of the elements it holds, such as the end marker of
// PDF.js's text layer, which can be as large as the page while the mouse is down.
function textRects(part: Range, layer: HTMLElement) {
  const rects: DOMRect[] = [];
  const texts = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  for (let node = texts.nextNode(); node; node = texts.nextNode()) {
    if (!part.intersectsNode(node)) continue;
    const piece = document.createRange();
    piece.selectNodeContents(node);
    if (node === part.startContainer) piece.setStart(node, part.startOffset);
    if (node === part.endContainer) piece.setEnd(node, part.endOffset);
    rects.push(...piece.getClientRects());
  }
  return rects;
}

// The words of a range in one line: the breaks of the text layer are spaces, and so is every other
// run of white space. (The browser's own text of a selection adds a break at each of them.)
function quoteOf(range: Range) {
  const holder = document.createElement('div');
  holder.append(range.cloneContents());
  holder.querySelectorAll('br').forEach((br) => br.replaceWith(' '));
  return fitQuote((holder.textContent ?? '').replace(/\s+/g, ' ').trim());
}

// What the reader has selected in the pages, or null when it is nothing there: a selection that
// is collapsed, that has an end outside the pages (the side bar, the toolbar) or that has no text.
// Each page's piece is read from the text layer of that page only, so that what floats between
// the pages (the marks of the highlights) is never taken for the text. `geometry` says how a
// page is shown; a page it does not know is left out.
export function captureSelection(
  content: HTMLElement,
  selection: Selection | null,
  geometry: (page: number) => PageGeometry | null,
): SelectionCapture | null {
  if (!selection || !selection.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!content.contains(range.startContainer) || !content.contains(range.endContainer)) return null;
  const pieces: SelectedPiece[] = [];
  for (const page of content.querySelectorAll<HTMLElement>('.page')) {
    const number = Number(page.dataset.pageNumber);
    if (!Number.isInteger(number) || number < 1 || !range.intersectsNode(page)) continue;
    const layer = page.querySelector<HTMLElement>(':scope > .textLayer');
    const view = geometry(number);
    const part = layer && view && within(range, layer);
    if (!layer || !view || !part) continue;
    const box = layer.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const lines: Box[] = [];
    for (const rect of textRects(part, layer)) {
      const inside = clipBox(rect, box);
      if (inside) lines.push(inside);
    }
    const merged = mergeLineRects(lines).slice(0, MAX_NOTE_RECTS);
    const quote = quoteOf(part);
    if (!quote || !merged.length) continue;
    // The text layer is as large as the page, so its pixels are the page's: the scale only
    // takes out what a zoom that is still being drawn leaves between them.
    const sx = view.width / box.width,
      sy = view.height / box.height;
    const rects = merged.map((line) => {
      const a = view.convertToPdfPoint((line.left - box.left) * sx, (line.top - box.top) * sy);
      const b = view.convertToPdfPoint((line.right - box.left) * sx, (line.bottom - box.top) * sy);
      return rectBetween(a[0], a[1], b[0], b[1]);
    });
    pieces.push({ page: number, quote, rects, lines: merged });
  }
  return pieces.length ? { pieces } : null;
}
