import { icon } from '../icons';
import { COLOR_LABELS, NOTE_COLORS, rememberedColor } from '../reading/note-colors';
import type { SelectionCapture } from '../reading/selection-capture';
import type { NoteColor } from '../types';
import { placePopover } from './popover-position';

export type SelectionBarOptions = {
  // The empty bar that is in the page (`#highlight-bar`), and the reading surface it belongs to.
  bar: HTMLElement;
  container: HTMLElement;
  // Whether a book is open, drawn, and with nothing over it: no dialog, no message to answer.
  enabled: () => boolean;
  // What is selected in the pages now (see reader.ts), or null.
  capture: () => SelectionCapture | null;
  highlight: (color: NoteColor) => void;
  annotate: () => void;
  copy: () => void;
};

// After a selection that ends this long (milliseconds), the bar shows, for a selection made by the
// keyboard or any other way that does not end with the mouse button.
const SETTLE = 250;

// The small bar that floats near the end of a passage that is selected in the pages: to highlight
// it in one of four colours, to annotate it, or to copy it. It does not take the selection or the
// focus from the page (the bar's buttons act on the mousedown that would have taken them), so the
// text stays selected while it is used. It goes away when the selection does, when the page
// scrolls, or the window changes, when the reader clicks elsewhere, and with Esc (see shortcuts.ts).
export class SelectionBar {
  private dragging = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private options: SelectionBarOptions) {
    const { bar, container } = options;
    const swatch = (color: NoteColor) =>
      `<button type="button" class="hl-swatch" data-color="${color}" aria-label="Realçar em ${COLOR_LABELS[color].toLowerCase()}" title="Realçar em ${COLOR_LABELS[color].toLowerCase()}"><span aria-hidden="true"></span></button>`;
    bar.innerHTML = `<span class="hl-group" role="group" aria-label="Realçar">${NOTE_COLORS.map(swatch).join('')}</span><span class="hl-divider" aria-hidden="true"></span><button type="button" class="hl-action" data-action="note" title="Adicionar nota ao trecho (N)">${icon('note')}<span>Adicionar nota</span></button><button type="button" class="hl-action" data-action="copy" title="Copiar o texto selecionado">${icon('copy')}<span>Copiar</span></button>`;
    // The mouse button would take the focus, and with it the selection: it does neither.
    bar.addEventListener('mousedown', (e) => e.preventDefault());
    bar.addEventListener('click', (e) => {
      const button = (e.target as Element).closest<HTMLElement>('button');
      if (!button) return;
      this.hide();
      if (button.dataset.color) options.highlight(button.dataset.color as NoteColor);
      else if (button.dataset.action === 'note') options.annotate();
      else options.copy();
    });
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (e.target instanceof Node && bar.contains(e.target)) return;
        // A click anywhere else starts something new: the bar waits for the mouse button to end it.
        this.hide();
        this.dragging = e.button === 0 && e.target instanceof Node && container.contains(e.target);
      },
      true,
    );
    for (const type of ['pointerup', 'pointercancel'])
      document.addEventListener(
        type,
        () => {
          if (!this.dragging) return;
          this.dragging = false;
          this.schedule(30);
        },
        true,
      );
    document.addEventListener('selectionchange', () => {
      if (this.dragging) return;
      // A selection that went away takes the bar with it at once; one that came needs a moment
      // to be the one the reader meant.
      if (!this.selecting()) this.hide();
      else this.schedule(SETTLE);
    });
    document.addEventListener(
      'scroll',
      (e) => {
        const target = e.target;
        if (bar.hidden) return;
        if (target === document || (target instanceof Node && target.contains(container)))
          this.hide();
      },
      true,
    );
    addEventListener('resize', () => this.hide());
  }

  get visible() {
    return !this.options.bar.hidden;
  }

  // Whether the reader has a passage selected in the pages, shown or not.
  selecting() {
    const selection = getSelection();
    return (
      !!selection &&
      !selection.isCollapsed &&
      !!selection.anchorNode &&
      !!selection.focusNode &&
      this.options.container.contains(selection.anchorNode) &&
      this.options.container.contains(selection.focusNode)
    );
  }

  hide() {
    clearTimeout(this.timer);
    this.options.bar.hidden = true;
    delete this.options.bar.dataset.side;
  }

  // Esc: the bar and the selection both go. Says whether there was either.
  dismiss() {
    const had = this.visible || this.selecting();
    this.hide();
    if (this.selecting()) getSelection()?.removeAllRanges();
    return had;
  }

  private schedule(delay: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.update(), delay);
  }

  private update() {
    if (this.dragging || !this.options.enabled() || !this.selecting()) return this.hide();
    const capture = this.options.capture();
    if (capture) this.show(capture);
    else this.hide();
  }

  // Under the last line of the passage, at its end; above the first line when there is no room
  // below; and, when the passage fills the screen, at the foot of the reading surface. Never out of
  // the window (see popover-position.ts).
  private show(capture: SelectionCapture) {
    const { bar, container } = this.options;
    const area = container.getBoundingClientRect();
    const lines = capture.pieces
      .flatMap((piece) => piece.lines)
      .filter(
        (l) =>
          l.bottom > area.top && l.top < area.bottom && l.right > area.left && l.left < area.right,
      );
    if (!lines.length) return this.hide();
    const first = lines[0],
      last = lines[lines.length - 1];
    // The colour that the shortcut would use is marked.
    const remembered = rememberedColor();
    for (const swatch of bar.querySelectorAll<HTMLElement>('.hl-swatch'))
      swatch.toggleAttribute('data-last', swatch.dataset.color === remembered);
    bar.hidden = false;
    const box = bar.getBoundingClientRect();
    const root = document.documentElement;
    const viewport = {
      width: root.clientWidth || innerWidth,
      height: root.clientHeight || innerHeight,
    };
    // The bar is centred on the end of the passage; the placement keeps it inside the window.
    const centre = Math.min(Math.max(last.right, area.left), area.right) - box.width / 2;
    const place = placePopover({
      anchor: {
        left: centre,
        right: centre + box.width,
        top: Math.max(first.top, area.top),
        bottom: Math.min(last.bottom, area.bottom),
      },
      width: box.width,
      height: box.height,
      viewport,
      align: 'start',
      gap: 6,
    });
    if (place.side === 'window') {
      bar.style.left = `${Math.max(8, Math.min(viewport.width - 8 - box.width, area.left + (area.width - box.width) / 2))}px`;
      bar.style.top = `${Math.max(8, Math.min(area.bottom, viewport.height) - box.height - 16)}px`;
    } else {
      bar.style.left = `${place.left}px`;
      bar.style.top = `${place.top}px`;
    }
    bar.dataset.side = place.side;
  }
}
