import type { PDFDocumentProxy } from 'pdfjs-dist';
import { isChapterHeading, startsChapter } from './chapters';
import type { OutlineEntry } from './outline';

// Chapter boundaries refer to complete PDF pages, so the preceding page's last
// paragraph is never cropped or removed. No synthetic gaps enter saved positions.
export class ChapterBreaks {
  private pages = new Set<number>();
  private inspected = new Set<number>();
  private disposed = false;
  private chain = Promise.resolve();
  private tracking = false;
  get starts() {
    return [...this.pages].sort((a, b) => a - b);
  }
  track(active: boolean) {
    if (active === this.tracking) return;
    this.tracking = active;
    if (active) this.refresh();
  }

  constructor(
    private pdf: PDFDocumentProxy,
    private viewer: any,
    private container: HTMLElement,
    private enabled: () => boolean,
    private changed: () => void,
  ) {}

  // The chapter starts the outline gives: every top-level entry, and any deeper entry
  // whose title is an explicit chapter heading. The pages are already resolved.
  outline(entries: readonly OutlineEntry[]) {
    const visit = (items: readonly OutlineEntry[], depth: number) => {
      for (const item of items) {
        if (item.page !== null && (depth === 0 || isChapterHeading(item.title)))
          this.pages.add(item.page);
        visit(item.items, depth + 1);
      }
    };
    if (this.disposed) return;
    visit(entries, 0);
    this.changed();
  }

  rendered(id: number) {
    if ((!this.enabled() && !this.tracking) || this.disposed || this.inspected.has(id)) return;
    const page = this.viewer.getPageView(id - 1)?.pdfPage;
    if (!page) return;
    this.inspected.add(id);
    this.chain = this.chain.then(async () => {
      try {
        if (this.disposed) return;
        const text = await page.getTextContent();
        if (!this.disposed && startsChapter(text.items) && !this.pages.has(id)) {
          this.pages.add(id);
          this.changed();
        }
      } catch {
        /* Image-only pages continue normally; no OCR or network is required. */
      }
    });
  }

  positions() {
    if (!this.enabled() || this.disposed) return [];
    const origin = this.container.getBoundingClientRect().top + this.container.clientTop;
    return [...this.pages]
      .map((id) => {
        const div = this.viewer.getPageView(id - 1)?.div;
        if (!div) return 0;
        div.dataset.chapterStart = 'true';
        return div.getBoundingClientRect().top - origin + this.container.scrollTop;
      })
      .filter((top) => top > 1)
      .sort((a, b) => a - b);
  }

  update() {
    const positions = this.positions();
    const last = positions.at(-1);
    const finalPage = this.viewer.getPageView(this.pdf.numPages - 1)?.div;
    const origin = this.container.getBoundingClientRect().top + this.container.clientTop;
    const end = finalPage
      ? finalPage.getBoundingClientRect().bottom - origin + this.container.scrollTop
      : 0;
    // A short final chapter can still align to the top of its own screen.
    const padding = last ? Math.max(0, this.container.clientHeight - (end - last)) : 0;
    this.viewer.viewer.style.setProperty('--chapter-end-padding', `${padding}px`);
    const next = positions.find((top) => top > this.container.scrollTop + 1);
    const visible =
      next === undefined ? this.container.clientHeight : next - this.container.scrollTop;
    const clipped = Math.max(0, this.container.clientHeight - visible);
    // Clip only what belongs to the next chapter, while keeping all preceding
    // content in the DOM. Advancing exposes the title at the top of the viewport.
    this.container.style.clipPath = clipped > 0 ? `inset(0 0 ${clipped}px 0)` : '';
    this.container.dataset.chapterVisibleHeight = String(this.container.clientHeight - clipped);
  }

  refresh() {
    this.update();
    if (this.enabled() || this.tracking) {
      for (
        let id = Math.max(1, this.viewer.currentPageNumber - 1);
        id <= Math.min(this.pdf.numPages, this.viewer.currentPageNumber + 2);
        id++
      )
        this.rendered(id);
    }
  }

  destroy() {
    this.disposed = true;
    this.container.style.clipPath = '';
    delete this.container.dataset.chapterVisibleHeight;
    this.viewer.viewer.style.removeProperty('--chapter-end-padding');
  }
}
