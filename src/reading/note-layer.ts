import type { Note } from '../types';
import { icon } from '../icons';
import { esc } from '../ui/dom';
import { colorOf } from './note-colors';
import { noteRects } from './note-rects';

// The part of a page view that the highlights need: the element of the page, the page that PDF.js
// loaded for it (until it has one, the size of the page is a guess) and the viewport it is shown
// with, which already has the zoom, the rotation and the display box (see joined-pages.ts).
type PageView = {
  div: HTMLElement;
  pdfPage?: unknown;
  viewport: {
    width: number;
    height: number;
    rotation: number;
    viewBox: number[];
    convertToViewportPoint(x: number, y: number): number[];
  };
};
// A rectangle in PDF units as it is shown now. PDF.js 6 has no `convertToViewportRectangle`, so
// both corners are converted, as joined-pages.ts does.
export function viewportRect(
  viewport: Pick<PageView['viewport'], 'convertToViewportPoint'>,
  [x1, y1, x2, y2]: number[],
) {
  return [...viewport.convertToViewportPoint(x1, y1), ...viewport.convertToViewportPoint(x2, y2)];
}
type Pages = { getPageView(index: number): PageView | undefined };

// A highlight was clicked. `anchor` is what the menu hangs from; `at` is where the pointer was
// when the click was on the text itself, and null when it was on a mark (which has a button).
export type NoteOpen = (
  id: string,
  anchor: HTMLElement,
  at: { x: number; y: number } | null,
) => void;

const percent = (fraction: number) => `${Math.round(fraction * 10_000) / 100}%`;
const excerpt = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
};
// A click that moved this far (pixels) was a drag, not a click.
const DRAG = 5;
// How long the highlight that a jump arrived at stays marked, in milliseconds.
const FLASH = 1800;

// The highlights, drawn in one layer for each page, inside the page of PDF.js. The layer ignores
// the pointer (so the text can be selected and the links followed): a click on a highlighted
// passage is found by where it fell, and only the small marks of the notes with text are buttons.
// The rectangles are saved in PDF units, which `viewportRect` turns into the
// page as it is shown now, and are placed in percent of the page, so that a zoom that PDF.js is
// still drawing leaves them where they belong. PDF.js clears what it does not know whenever it
// redraws a page, so the layers are drawn again at each of these moments (see reader.ts).
export class NoteLayers {
  private byPage = new Map<number, Note[]>();
  private drawn = new WeakMap<HTMLElement, string>();
  private down: { x: number; y: number } | null = null;
  private flashing: string | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | undefined;
  private frame = 0;

  constructor(
    private pages: Pages,
    private container: HTMLElement,
    private open: NoteOpen,
    signal: AbortSignal,
  ) {
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      listener: (event: HTMLElementEventMap[K]) => void,
    ) => container.addEventListener(type, listener, { signal });
    on('pointerdown', (e) => (this.down = { x: e.clientX, y: e.clientY }));
    on('click', (e) => this.click(e));
    on('pointermove', (e) => this.hover(e));
    on('pointerleave', () => container.removeAttribute('data-note-hover'));
    signal.addEventListener('abort', () => {
      clearTimeout(this.flashTimer);
      cancelAnimationFrame(this.frame);
    });
  }

  // The notes of the document now. Only those with rectangles are drawn.
  set(notes: readonly Note[]) {
    const before = new Set(this.byPage.keys());
    this.byPage = new Map();
    for (const note of notes) {
      if (!Number.isInteger(note.page) || note.page < 1 || !noteRects(note).length) continue;
      this.byPage.set(note.page, [...(this.byPage.get(note.page) ?? []), note]);
    }
    for (const page of new Set([...before, ...this.byPage.keys()])) this.draw(page);
  }

  drawAll() {
    for (const page of this.byPage.keys()) this.draw(page);
  }

  // Draws the layer of one page, if it has highlights and PDF.js has its page; takes the layer
  // away when it has none. Nothing happens when what would be drawn is already there.
  draw(page: number) {
    const view = this.pages.getPageView(page - 1);
    const div = view?.div;
    if (!view || !div) return;
    const notes = this.byPage.get(page);
    const old = div.querySelector<HTMLElement>(':scope > .note-layer');
    if (!notes?.length) {
      old?.remove();
      return;
    }
    // Until the page is loaded its size is the first page's, and the rectangles would be wrong.
    if (!view.pdfPage) return;
    const { viewport } = view,
      { width, height } = viewport;
    if (!(width > 0 && height > 0)) return;
    let marks = '',
      pins = '';
    for (const note of notes) {
      const color = colorOf(note);
      let first: { top: number; bottom: number } | null = null;
      for (const rect of noteRects(note)) {
        const [ax, ay, bx, by] = viewportRect(viewport, rect);
        const left = Math.min(ax, bx),
          top = Math.min(ay, by),
          right = Math.max(ax, bx),
          bottom = Math.max(ay, by);
        marks += `<div class="note-mark" data-note="${esc(note.id)}" data-color="${color}" style="left:${percent(left / width)};top:${percent(top / height)};width:${percent((right - left) / width)};height:${percent((bottom - top) / height)}"></div>`;
        if (!first || top < first.top) first = { top, bottom };
      }
      const text = excerpt(note.text ?? '');
      // A note with text has a small mark in the margin, at the height of its first line.
      if (text && first)
        pins += `<button type="button" class="note-pin" data-menu data-note="${esc(note.id)}" data-color="${color}" style="top:${percent((first.top + first.bottom) / 2 / height)}" aria-haspopup="menu" aria-expanded="false" aria-label="Nota: ${esc(text)}" title="${esc(text)}">${icon('note')}</button>`;
    }
    const html = `<div class="note-marks" aria-hidden="true">${marks}</div><div class="note-pins">${pins}</div>`;
    const layer = old ?? document.createElement('div');
    if (this.drawn.get(layer) !== html || !old) {
      layer.className = 'note-layer';
      layer.innerHTML = html;
      this.drawn.set(layer, html);
      this.markFlash(layer);
    }
    // The last child of the page: above its text, so that nothing of PDF.js hides it.
    if (div.lastElementChild !== layer) div.append(layer);
  }

  // Marks the highlight that a jump arrived at for a moment.
  flash(id: string) {
    this.flashing = id;
    this.markFlash(this.container);
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.flashing = null;
      this.markFlash(this.container);
    }, FLASH);
  }

  private markFlash(within: HTMLElement) {
    for (const mark of within.querySelectorAll<HTMLElement>('.note-mark'))
      mark.toggleAttribute('data-flash', !!this.flashing && mark.dataset.note === this.flashing);
  }

  // The note whose highlight is under a point of the window, on the page of `target`. When several
  // overlap, the one drawn last (the newest) wins.
  private at(target: Element, x: number, y: number) {
    const marks = target.closest('.page')?.querySelectorAll<HTMLElement>('.note-mark');
    if (!marks) return null;
    for (let i = marks.length - 1; i >= 0; i--) {
      const box = marks[i].getBoundingClientRect();
      if (x >= box.left - 1 && x <= box.right + 1 && y >= box.top - 1 && y <= box.bottom + 1)
        return marks[i].dataset.note ?? null;
    }
    return null;
  }

  private click(e: MouseEvent) {
    const target = e.target;
    if (!(target instanceof Element) || e.button !== 0) return;
    const pin = target.closest<HTMLElement>('.note-pin');
    if (pin) {
      if (pin.dataset.note) this.open(pin.dataset.note, pin, null);
      return;
    }
    // A link of the PDF is the link's, and a selection that has just been made is not a click.
    if (target.closest('.annotationLayer') || e.detail > 1) return;
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    const down = this.down;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG) return;
    const selection = getSelection();
    if (selection && !selection.isCollapsed) return;
    const id = this.at(target, e.clientX, e.clientY);
    if (id) this.open(id, this.container, { x: e.clientX, y: e.clientY });
  }

  // The pointer over a highlighted passage says that it can be clicked.
  private hover(e: PointerEvent) {
    if (e.buttons || this.frame) return;
    const { target, clientX, clientY } = e;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const over =
        target instanceof Element &&
        !target.closest('.annotationLayer, .note-pin') &&
        this.at(target, clientX, clientY) !== null;
      this.container.toggleAttribute('data-note-hover', over);
    });
  }
}
