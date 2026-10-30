import { setLayerDimensions, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import { contentRows, containedBox, validBox, type Box } from './page-margins';

type Margins = { original: Box; crop: Box; rotation: number; unit: number };
const CACHE_PREFIX = 'folio.page-margins.v1.';

// Small PDF.js adapter: its page views use the display CropBox for rendering,
// selection, search and PDF-coordinate navigation. The source PDF stays intact.
export class JoinedPages {
  private records = new Map<number, Margins>();
  private pages = new Map<number, PDFPageProxy>();
  private original = new Map<number, Box>();
  private pending = new Set<number>();
  private chain = Promise.resolve();
  private initialized = false;
  private disposed = false;
  private cacheKey: string;

  constructor(
    pdf: PDFDocumentProxy,
    hash: string,
    private viewer: any,
    private enabled: () => boolean,
    private relayout: () => void,
  ) {
    this.cacheKey = CACHE_PREFIX + hash;
    try {
      const saved = JSON.parse(localStorage.getItem(this.cacheKey) || '{}');
      for (const [id, entry] of (Array.isArray(saved.pages) ? saved.pages : []).slice(-1000)) {
        if (
          Number.isInteger(id) &&
          id >= 1 &&
          id <= pdf.numPages &&
          validBox(entry?.original) &&
          validBox(entry?.crop) &&
          containedBox(entry.crop, entry.original) &&
          [0, 90, 180, 270].includes(entry.rotation) &&
          Number.isFinite(entry.unit) &&
          entry.unit > 0
        )
          this.records.set(id, entry);
      }
    } catch {
      /* A disposable cache must never prevent reading. */
    }
    const getPage = pdf.getPage.bind(pdf);
    pdf.getPage = async (id: number) => {
      const page = await getPage(id);
      if (!this.disposed) {
        this.pages.set(id, page);
        if (!this.original.has(id)) this.original.set(id, [...page.view] as Box);
        this.setBox(id, page);
      }
      return page;
    };
  }

  private setBox(id: number, page: PDFPageProxy) {
    const box = this.initialized && this.enabled() ? this.records.get(id)?.crop : null;
    // Give new viewports a fresh display box. Mutating the old array in place
    // would also alter existing viewports without recalculating their dimensions.
    // The proxy's source page info, PDF bytes and library metadata stay intact.
    Object.defineProperty(page, 'view', {
      value: [...(box || this.original.get(id)!)],
      configurable: true,
    });
  }

  // The whole page, as in the document, even where the display box is cropped. `rotation`
  // is the total (the page's own plus the reader's); without it, the page's own.
  fullViewport(page: PDFPageProxy, scale: number, rotation?: number) {
    const viewport = page.getViewport(rotation === undefined ? { scale } : { scale, rotation });
    viewport.viewBox = this.original.get(page.pageNumber) || [...page.view];
    return viewport.clone();
  }

  apply() {
    this.initialized = true;
    for (const [id, record] of this.records) {
      const view = this.viewer.getPageView(id - 1);
      if (!view) continue;
      const box = this.enabled() ? record.crop : record.original;
      const page = this.pages.get(id);
      if (page) this.setBox(id, page);
      if (view.viewport.viewBox.some((value: number, i: number) => value !== box[i])) {
        if (view.pdfPage) view.setPdfPage(view.pdfPage);
        else {
          // Restore cached placeholder sizes without fetching/rasterizing the
          // preceding pages of a long book just to resume in its middle.
          view.viewport.viewBox = [...box];
          view.viewport.userUnit = record.unit;
          view.pdfPageRotate = record.rotation;
          view.update({ scale: view.scale });
        }
        // PDFPageView skips dimension updates when rotation is unchanged.
        // A changed display box still needs new CSS dimensions at the same zoom.
        setLayerDimensions(view.div, view.viewport, true, false);
      }
      view.div.dataset.margins = 'ready';
    }
    if (this.enabled()) {
      for (
        let id = Math.max(1, this.viewer.currentPageNumber - 1);
        id <= Math.min(this.viewer.pagesCount, this.viewer.currentPageNumber + 2);
        id++
      ) {
        this.rendered(id);
      }
    }
  }

  rendered(id: number) {
    const view = this.viewer.getPageView(id - 1);
    if (
      !this.enabled() ||
      this.disposed ||
      this.records.has(id) ||
      this.pending.has(id) ||
      !view?.canvas?.width ||
      !view.pdfPage ||
      this.viewer.pagesRotation !== 0
    )
      return;
    this.pending.add(id);
    this.chain = this.chain.then(async () => {
      try {
        if (
          this.disposed ||
          !this.enabled() ||
          !view.canvas?.width ||
          this.viewer.pagesRotation !== 0
        )
          return;
        const entry = await this.measure(view);
        if (this.disposed || !entry) return;
        this.records.set(id, entry);
        this.save();
        if (this.enabled()) this.relayout();
      } catch (error) {
        console.warn('Page margin analysis kept the original page:', error);
      } finally {
        this.pending.delete(id);
      }
    });
  }

  private async measure(view: any): Promise<Margins | null> {
    const page: PDFPageProxy = view.pdfPage;
    const original = this.original.get(page.pageNumber)!;
    const record = {
      original,
      crop: [...original] as Box,
      rotation: page.rotate,
      unit: page.userUnit,
    };
    const viewport = view.viewport.clone() as ReturnType<PDFPageProxy['getViewport']>;
    const canvas: HTMLCanvasElement = view.canvas;
    const scale = Math.min(1, 640 / Math.max(canvas.width, canvas.height));
    const sample = document.createElement('canvas');
    sample.width = Math.max(1, Math.round(canvas.width * scale));
    sample.height = Math.max(1, Math.round(canvas.height * scale));
    const ctx = sample.getContext('2d', { willReadFrequently: true })!;
    try {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, sample.width, sample.height);
      ctx.drawImage(canvas, 0, 0, sample.width, sample.height);
      const rows = contentRows(
        ctx.getImageData(0, 0, sample.width, sample.height).data,
        sample.width,
        sample.height,
      );
      if (!rows) return record;
      let top = (rows.first / sample.height) * viewport.height;
      let bottom = (rows.last / sample.height) * viewport.height;
      const include = (rect: number[]) => {
        const a = viewport.convertToViewportPoint(rect[0], rect[1]);
        const b = viewport.convertToViewportPoint(rect[2], rect[3]);
        top = Math.min(top, a[1], b[1]);
        bottom = Math.max(bottom, a[1], b[1]);
      };
      // Keep even very faint text that could disappear in a small bitmap, as
      // well as annotation/widget hit areas. Rotated/skewed text stays uncropped.
      const text = await page.getTextContent();
      for (const item of text.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const [a, b, c, d, x, y] = item.transform;
        if (Math.abs(b) > 0.001 || Math.abs(c) > 0.001 || a <= 0 || d <= 0) return record;
        const h = Math.max(item.height, Math.abs(d));
        const style = text.styles[item.fontName];
        include([
          x,
          y + Math.min(-0.25, style?.descent ?? -0.25) * h,
          x + item.width,
          y + Math.max(1, style?.ascent ?? 1) * h,
        ]);
      }
      for (const annotation of await page.getAnnotations()) {
        if (Array.isArray(annotation.rect)) include(annotation.rect);
      }
      const padding = Math.max(
        6 * viewport.scale * page.userUnit,
        (viewport.height / sample.height) * 2,
      );
      top = Math.max(0, Math.min(viewport.height * 0.45, top - padding));
      bottom = Math.min(viewport.height, Math.max(viewport.height * 0.55, bottom + padding));
      if (top < padding) top = 0;
      if (viewport.height - bottom < padding) bottom = viewport.height;
      const p = viewport.convertToPdfPoint(0, top);
      const q = viewport.convertToPdfPoint(viewport.width, bottom);
      const crop: Box = [
        Math.min(p[0], q[0]),
        Math.min(p[1], q[1]),
        Math.max(p[0], q[0]),
        Math.max(p[1], q[1]),
      ];
      record.crop = crop.map((value, i) =>
        i < 2 ? Math.max(original[i], value) : Math.min(original[i], value),
      ) as Box;
      return record;
    } finally {
      sample.width = sample.height = 0;
    }
  }

  private save() {
    try {
      localStorage.setItem(
        this.cacheKey,
        JSON.stringify({
          used: Date.now(),
          pages: [...this.records].slice(-1000),
        }),
      );
      const keys = Object.keys(localStorage).filter((key) => key.startsWith(CACHE_PREFIX));
      if (keys.length > 8) {
        keys.sort(
          (a, b) =>
            (JSON.parse(localStorage.getItem(a) || '{}').used || 0) -
            (JSON.parse(localStorage.getItem(b) || '{}').used || 0),
        );
        for (const key of keys.slice(0, keys.length - 8)) localStorage.removeItem(key);
      }
    } catch {
      /* Storage can be full/unavailable; the current reading still works. */
    }
  }

  destroy() {
    this.disposed = true;
  }
}
