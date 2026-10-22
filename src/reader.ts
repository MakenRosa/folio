import * as pdfjs from 'pdfjs-dist';
import {
  EventBus,
  PDFViewer,
  PDFLinkService,
  PDFFindController,
} from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Book, ReadingMode } from './types';
import { turnScreen, type EdgeReturn } from './reading/screens';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
type Options = {
  container: HTMLElement;
  viewer: HTMLElement;
  mode: ReadingMode;
  onViewport: () => void;
  onPage: (page: number) => void;
  onLocation: (patch: Partial<Book>) => void;
  onZoom: (value: string) => void;
  onFind: (text: string) => void;
  onPassword: (incorrect: boolean) => Promise<string | null>;
};
export class Reader {
  private bus = new EventBus();
  private link: PDFLinkService;
  private findController: PDFFindController;
  private viewer: PDFViewer;
  private task: pdfjs.PDFDocumentLoadingTask | null = null;
  private pdf: pdfjs.PDFDocumentProxy | null = null;
  private abort = new AbortController();
  private observer: ResizeObserver;
  private ready = false;
  private dead = false;
  private options: Options;
  private zoomTimer: ReturnType<typeof setTimeout> | undefined;
  outline: any[] = [];
  private location: { pageNumber: number; top: number; left: number } | null = null;
  private edgeReturn: EdgeReturn = null;
  private wheelTime = 0;
  private wheelAmount = 0;
  private wheelTurned = false;
  private touchStart: { x: number; y: number } | null = null;
  constructor(options: Options) {
    this.options = options;
    this.link = new PDFLinkService({
      eventBus: this.bus,
      externalLinkTarget: 2,
      externalLinkRel: 'noopener noreferrer',
      ignoreDestinationZoom: true,
    });
    this.findController = new PDFFindController({ eventBus: this.bus, linkService: this.link });
    this.viewer = new PDFViewer({
      container: options.container as HTMLDivElement,
      viewer: options.viewer as HTMLDivElement,
      eventBus: this.bus,
      linkService: this.link,
      findController: this.findController,
      textLayerMode: 1,
      annotationMode: 1,
      annotationEditorMode: -1,
      maxCanvasPixels: 8_388_608,
      enableDetailCanvas: false,
      removePageBorders: false,
    });
    this.link.setViewer(this.viewer);
    this.bus.on('pagechanging', (e: any) => {
      if (this.ready) options.onPage(e.pageNumber);
    });
    this.bus.on('scalechanging', () => {
      if (this.ready) {
        options.onZoom(this.viewer.currentScaleValue);
        options.onLocation({ zoom: this.viewer.currentScaleValue });
      }
    });
    this.bus.on('updateviewarea', (e: any) => {
      if (this.ready && !this.dead) {
        const l = e.location;
        this.location = l;
        options.onLocation({
          page: l.pageNumber,
          top: l.top,
          left: l.left,
          zoom: this.viewer.currentScaleValue,
          rotation: this.viewer.pagesRotation,
        });
        options.onViewport();
      }
    });
    this.bus.on('updatefindmatchescount', (e: any) =>
      options.onFind(
        e.matchesCount.total
          ? `${e.matchesCount.current} de ${e.matchesCount.total}`
          : 'Nenhum resultado',
      ),
    );
    this.bus.on('updatefindcontrolstate', (e: any) => {
      if (e.state === 1) options.onFind('Nenhum resultado');
      else if (e.state === 3) options.onFind('Buscando…');
      else if (e.matchesCount)
        options.onFind(
          e.matchesCount.total ? `${e.matchesCount.current} de ${e.matchesCount.total}` : '',
        );
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(options.container);
    options.container.dataset.readingMode = options.mode;
    options.container.addEventListener('wheel', (e) => this.wheel(e), {
      passive: false,
      signal: this.abort.signal,
    });
    options.container.addEventListener(
      'mousedown',
      (e) => {
        if (this.kindle && e.button === 1) e.preventDefault();
      },
      { signal: this.abort.signal },
    );
    options.container.addEventListener(
      'pointerdown',
      (e) => {
        this.touchStart =
          e.pointerType === 'touch' && e.isPrimary ? { x: e.clientX, y: e.clientY } : null;
      },
      { signal: this.abort.signal },
    );
    options.container.addEventListener('pointercancel', () => (this.touchStart = null), {
      signal: this.abort.signal,
    });
    options.container.addEventListener(
      'pointerup',
      (e) => {
        const start = this.touchStart;
        this.touchStart = null;
        if (!this.kindle || !start) return;
        const dy = start.y - e.clientY;
        if (Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(start.x - e.clientX) * 1.2)
          this.turn(dy > 0 ? 1 : -1);
      },
      { signal: this.abort.signal },
    );
  }
  async load(url: string, book: Book) {
    // Tauri's asset protocol handles Range requests but doesn't advertise them on
    // the initial response. Supply an explicit transport to avoid reading entire
    // large documents into native memory before PDF.js can discover range support.
    const readRange = async (begin: number, end: number) => {
      const bytes = new Uint8Array(end - begin);
      for (let start = begin; start < end; start += 524288) {
        const stop = Math.min(end, start + 524288);
        const response = await fetch(url, {
          headers: { Range: `bytes=${start}-${stop - 1}` },
          signal: this.abort.signal,
        });
        if (response.status !== 206)
          throw new Error(`Não foi possível ler parte do PDF (${response.status}).`);
        const part = new Uint8Array(await response.arrayBuffer());
        if (part.length !== stop - start)
          throw new Error('A cópia do PDF foi alterada ou está incompleta.');
        bytes.set(part, start - begin);
      }
      return bytes;
    };
    const initial = await readRange(0, Math.min(book.size, 262144));
    if (this.dead) return;
    let rejectRange!: (error: unknown) => void;
    const rangeFailure = new Promise<never>((_, reject) => (rejectRange = reject));
    const transport = new pdfjs.PDFDataRangeTransport(book.size, initial, false);
    transport.requestDataRange = (begin: number, end: number) => {
      void readRange(begin, end)
        .then((bytes) => {
          if (!this.dead) transport.onDataRange(begin, bytes);
        })
        .catch((error) => {
          if (!this.dead) {
            rejectRange(error);
            void this.task?.destroy();
          }
        });
    };
    transport.abort = () => {};
    this.task = pdfjs.getDocument({
      range: transport,
      cMapUrl: new URL('/pdfjs/cmaps/', location.href).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('/pdfjs/standard_fonts/', location.href).href,
      wasmUrl: new URL('/pdfjs/wasm/', location.href).href,
      enableXfa: false,
      disableAutoFetch: true,
      disableStream: true,
      rangeChunkSize: 262144,
    });
    this.task.onPassword = async (updatePassword: (value: string) => void, reason: number) => {
      const p = await this.options.onPassword(
        reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD,
      );
      if (p === null) {
        await this.task?.destroy();
        return;
      }
      updatePassword(p);
    };
    this.pdf = await Promise.race([this.task.promise, rangeFailure]);
    if (this.dead) return;
    const initialized = new Promise<void>((resolve) => {
      this.bus.on('pagesinit', () => {
        this.viewer.currentScaleValue = book.zoom || 'page-width';
        this.viewer.pagesRotation = book.rotation || 0;
        this.viewer.currentPageNumber = Math.min(this.pages, Math.max(1, book.page || 1));
        if (book.top !== null && book.top !== undefined)
          this.viewer.scrollPageIntoView({
            pageNumber: this.viewer.currentPageNumber,
            destArray: [null, { name: 'XYZ' }, book.left || 0, book.top, null],
            allowNegativeOffset: true,
          });
        this.ready = true;
        this.options.onPage(this.viewer.currentPageNumber);
        this.options.onZoom(this.viewer.currentScaleValue);
        resolve();
      });
    });
    this.link.setDocument(this.pdf);
    this.viewer.setDocument(this.pdf);
    await initialized;
    // Do not delay the first page while loading document navigation.
    void this.pdf
      .getOutline()
      .then((items) => {
        if (!this.dead) this.outline = items || [];
      })
      .catch(() => {});
  }
  get page() {
    return this.viewer.currentPageNumber || 1;
  }
  get pages() {
    return this.pdf?.numPages || 0;
  }
  get rotation() {
    return this.viewer.pagesRotation;
  }
  get kindle() {
    return this.options.mode === 'kindle';
  }
  get screen() {
    const c = this.options.container,
      max = Math.max(0, c.scrollHeight - c.clientHeight);
    return {
      atStart: c.scrollTop <= 1,
      atEnd: c.scrollTop >= max - 1,
      progress: max ? Math.round((c.scrollTop / max) * 100) : 100,
    };
  }
  setMode(mode: ReadingMode) {
    if (mode === this.options.mode) return;
    // Keep a PDF-coordinate anchor while the gaps between pages change.
    if (this.ready) this.viewer.update();
    const anchor = this.location;
    this.options.mode = mode;
    this.options.container.dataset.readingMode = mode;
    this.edgeReturn = null;
    this.wheelTime = 0;
    if (this.ready) {
      if (anchor)
        this.viewer.scrollPageIntoView({
          pageNumber: anchor.pageNumber,
          destArray: [null, { name: 'XYZ' }, anchor.left, anchor.top, null],
          allowNegativeOffset: true,
        });
      this.viewer.update();
    }
  }
  turn(direction: number) {
    if (!this.ready || this.dead) return;
    if (!this.kindle) {
      this.goTo(this.page + direction);
      return;
    }
    const c = this.options.container,
      from = c.scrollTop,
      max = Math.max(0, c.scrollHeight - c.clientHeight);
    const next = turnScreen({
      top: from,
      max,
      height: c.clientHeight,
      scale: this.viewer.currentScale,
      pixelRatio: devicePixelRatio,
      direction,
      edgeReturn: this.edgeReturn,
    });
    this.edgeReturn = next.edgeReturn;
    c.scrollTop = next.top;
    this.viewer.update();
  }
  boundary(end: boolean) {
    if (this.ready) {
      this.edgeReturn = null;
      this.options.container.scrollTop = end ? this.options.container.scrollHeight : 0;
      this.viewer.update();
    }
  }
  private wheel(e: WheelEvent) {
    if (e.ctrlKey) {
      e.preventDefault();
      if (e.deltaY) this.stepZoom(e.deltaY < 0 ? 1 : -1);
      return;
    }
    if (!this.kindle || Math.abs(e.deltaX) > Math.abs(e.deltaY) || !e.deltaY) return;
    e.preventDefault();
    const c = this.options.container;
    if (e.shiftKey) {
      c.scrollLeft += e.deltaY;
      return;
    }
    const now = performance.now(),
      delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? c.clientHeight : 1);
    // One screen per wheel/trackpad gesture, including its trailing inertia.
    if (now - this.wheelTime > 180 || Math.sign(delta) !== Math.sign(this.wheelAmount)) {
      this.wheelAmount = 0;
      this.wheelTurned = false;
    }
    this.wheelTime = now;
    this.wheelAmount += delta;
    if (!this.wheelTurned && Math.abs(this.wheelAmount) >= 24) {
      this.wheelTurned = true;
      this.turn(delta > 0 ? 1 : -1);
    }
  }
  goTo(page: number) {
    if (!this.ready || !Number.isFinite(page)) return;
    this.edgeReturn = null;
    this.viewer.currentPageNumber = Math.max(1, Math.min(this.pages, Math.round(page)));
    this.viewer.scrollPageIntoView({ pageNumber: this.viewer.currentPageNumber });
    this.viewer.update();
  }
  zoom(value: string) {
    if (this.ready) {
      this.edgeReturn = null;
      this.viewer.currentScaleValue = value;
    }
  }
  stepZoom(direction: number) {
    if (!this.ready) return;
    const scale = Math.min(5, Math.max(0.25, this.viewer.currentScale * Math.pow(1.15, direction)));
    this.zoom(String(Math.round(scale * 100) / 100));
  }
  rotate() {
    if (this.ready) {
      const page = this.page;
      this.viewer.pagesRotation = (this.viewer.pagesRotation + 90) % 360;
      this.goTo(page);
    }
  }
  resize() {
    this.edgeReturn = null;
    clearTimeout(this.zoomTimer);
    this.zoomTimer = setTimeout(() => {
      if (this.ready && !this.dead) {
        if (['page-width', 'page-fit', 'auto'].includes(this.viewer.currentScaleValue))
          this.viewer.currentScaleValue = this.viewer.currentScaleValue;
        this.viewer.update();
      }
    }, 80);
  }
  find(query: string, again = false, back = false) {
    this.edgeReturn = null;
    this.bus.dispatch('find', {
      source: this,
      type: again ? 'again' : '',
      query,
      phraseSearch: true,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: back,
      matchDiacritics: false,
    });
  }
  closeFind() {
    this.bus.dispatch('findbarclose', { source: this });
  }
  destination(dest: any) {
    if (dest) {
      this.edgeReturn = null;
      this.link.goToDestination(dest);
    }
  }
  async cover() {
    if (!this.pdf || this.dead) return null;
    const page = await this.pdf.getPage(1);
    if (this.dead) return null;
    const viewport = page.getViewport({ scale: 1 });
    const scaled = page.getViewport({ scale: 240 / viewport.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(scaled.width);
    canvas.height = Math.ceil(scaled.height);
    await page.render({ canvas, viewport: scaled }).promise;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    canvas.width = 0;
    canvas.height = 0;
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }
  async destroy() {
    this.dead = true;
    this.ready = false;
    clearTimeout(this.zoomTimer);
    this.abort.abort();
    this.observer.disconnect();
    this.viewer.setDocument(null as any);
    this.link.setDocument(null as any);
    this.findController.setDocument(null as any);
    await this.task?.destroy();
    this.pdf = null;
    this.task = null;
    this.options.viewer.innerHTML = '';
  }
}
