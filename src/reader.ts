import * as pdfjs from 'pdfjs-dist';
import {
  EventBus,
  FindState,
  PDFViewer,
  PDFLinkService,
  PDFFindController,
} from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';
import type { Book, Note, ReadingMode, Spread } from './types';
import { openPdfSource, renderCover } from './pdf-source';
import { turnScreen, type EdgeReturn } from './reading/screens';
import { JoinedPages } from './reading/joined-pages';
import { ChapterBreaks } from './reading/chapter-breaks';
import { PDFJS_SPREAD, screenPages, sharesScreen } from './reading/spread';
import { resolveOutline, type OutlineEntry } from './reading/outline';
import { JumpHistory, type JumpOffer, type Position } from './reading/jumps';
import { NoteLayers, viewportRect, type NoteOpen } from './reading/note-layer';
import { noteRects } from './reading/note-rects';
import {
  captureSelection as readSelection,
  type SelectionCapture,
} from './reading/selection-capture';
import {
  extendSelection,
  isSelectionKey,
  selectionEnd,
  visibleArea,
  type Extension,
} from './reading/selection-keys';
type Options = {
  container: HTMLElement;
  viewer: HTMLElement;
  mode: ReadingMode;
  spread: Spread;
  joinPages: boolean;
  chapterBreaks: boolean;
  onViewport: () => void;
  onOutline: () => void;
  onPage: (page: number) => void;
  onLocation: (patch: Partial<Book>) => void;
  onZoom: (value: string) => void;
  onFind: (text: string) => void;
  // A jump was kept, or undone: the way back, or forward, that the reader can offer now.
  onJump: (offer: JumpOffer) => void;
  onPassword: (incorrect: boolean) => Promise<string | null>;
  // A highlight, or the mark of a note, was clicked (see reading/note-layer.ts).
  onNote: NoteOpen;
  // The keyboard grew the selection of the pages (see `extendSelection`).
  onSelect: () => void;
};
export class Reader {
  get chapterStarts() {
    return this.chapters?.starts || [];
  }
  setGoalTracking(active: boolean) {
    this.chapters?.track(active);
  }
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
  // The outline, once the document has given it. A book without one is also "ready".
  outline: OutlineEntry[] = [];
  outlineReady = false;
  // Page shapes at scale 1 (width, height, with the page's own rotation only), from the
  // pages that have been loaded; the placeholders of the thumbnails use them.
  private sizes = new Map<number, [number, number]>();
  private thumbnailTasks = new Set<pdfjs.RenderTask>();
  private location: { pageNumber: number; top: number; left: number } | null = null;
  private edgeReturn: EdgeReturn = null;
  private wheelTime = 0;
  private wheelAmount = 0;
  private wheelTurned = false;
  private touchStart: { x: number; y: number } | null = null;
  private joined: JoinedPages | null = null;
  private chapters: ChapterBreaks | null = null;
  private changingLayout = false;
  // The way back after a jump, for as long as this document is open.
  private jumps = new JumpHistory();
  // Where the reader was when the search began, until its first result is kept as a jump; and
  // whether it was, so that the next results of the same search are not jumps.
  private findFrom: Position | null = null;
  private finding = false;
  // The highlights, one layer for each page (see reading/note-layer.ts).
  private noteLayers: NoteLayers;
  constructor(options: Options) {
    this.options = options;
    this.link = new PDFLinkService({
      eventBus: this.bus,
      externalLinkTarget: 2,
      externalLinkRel: 'noopener noreferrer',
      ignoreDestinationZoom: true,
    });
    this.keepWayBack();
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
    this.noteLayers = new NoteLayers(
      this.viewer as any,
      options.container,
      options.onNote,
      this.abort.signal,
    );
    this.bus.on('pagechanging', (e: any) => {
      if (this.ready && !this.changingLayout) options.onPage(e.pageNumber);
    });
    this.bus.on('scalechanging', () => {
      if (this.ready) {
        options.onZoom(this.viewer.currentScaleValue);
        options.onLocation({ zoom: this.viewer.currentScaleValue });
      }
    });
    this.bus.on('updateviewarea', (e: any) => {
      if (this.ready && !this.dead && !this.changingLayout) {
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
        this.chapters?.update();
      }
    });
    this.bus.on('pagerendered', (e: any) => {
      if (!e.error && !this.dead) this.joined?.rendered(e.pageNumber);
      if (!e.error && !this.dead) this.chapters?.rendered(e.pageNumber);
      // PDF.js clears the page's other layers whenever it draws it again; the highlights come back.
      if (!e.error && !this.dead) this.noteLayers.draw(e.pageNumber);
    });
    // A new zoom or rotation resets every page, before it tells; the layers come back with the
    // new size, and the pages that were not drawn yet get theirs as they are.
    for (const event of ['scalechanging', 'rotationchanging', 'spreadmodechanged'])
      this.bus.on(event, () => {
        if (!this.dead) this.noteLayers.drawAll();
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
      this.found(e.state);
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
    // The same transport as the library queue, over the copy kept in the library.
    const source = await openPdfSource(url, book.size, {
      signal: this.abort.signal,
      onTask: (task) => (this.task = task),
      onPassword: this.options.onPassword,
    });
    if (!source) return;
    this.noteLayers.set(book.notes ?? []);
    this.pdf = await source.document;
    if (this.dead) return;
    this.joined = new JoinedPages(
      this.pdf,
      book.hash,
      this.viewer,
      () => this.kindle && this.options.joinPages,
      () => this.relayout(),
    );
    // The first page decides the shape of every page that has not been loaded yet.
    const first = await this.pdf.getPage(1).catch(() => null);
    if (this.dead) return;
    if (first) {
      const view = this.joined.fullViewport(first, 1);
      this.sizes.set(1, [view.width, view.height]);
    }
    this.chapters = new ChapterBreaks(
      this.pdf,
      this.viewer,
      this.options.container,
      () => this.kindle && this.options.chapterBreaks,
      () => {
        this.chapters?.update();
        this.options.onViewport();
      },
    );
    const initialized = new Promise<void>((resolve) => {
      this.bus.on('pagesinit', () => {
        this.joined?.apply();
        // Before the zoom, so that "page width" already counts both pages of a pair.
        this.applySpread();
        this.viewer.currentScaleValue = book.zoom || 'page-width';
        this.viewer.pagesRotation = book.rotation || 0;
        this.viewer.currentPageNumber = Math.min(this.pages, Math.max(1, book.page || 1));
        if (book.top !== null && book.top !== undefined)
          this.restoreAnchor({
            pageNumber: this.viewer.currentPageNumber,
            left: book.left || 0,
            top: book.top,
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
    const pdf = this.pdf;
    void pdf
      .getOutline()
      .catch(() => null)
      .then((items) => resolveOutline(pdf, items))
      .then((entries) => {
        if (this.dead) return;
        this.outline = entries;
        this.outlineReady = true;
        this.chapters?.outline(entries);
        this.options.onOutline();
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
  // The layout in effect. Kindle needs one column, so it hides the chosen spread
  // without forgetting it: the preference stays in `options` and comes back.
  get spread(): Spread {
    return this.kindle ? 'none' : this.options.spread;
  }
  // The pages on screen together (one, or the pair of a two-page layout). `first`
  // is stable for a given pair, whichever page PDF.js reports as current.
  get screenPages() {
    return this.screenOf(this.page);
  }
  // The same for another page: the side bar marks the page that the footer shows, which
  // comes from the position, and PDF.js can call another page current.
  screenOf(page: number) {
    const box = this.options.container.getBoundingClientRect();
    return screenPages(page, this.pages, this.spread, (n) => {
      const view = this.viewer.getPageView(n - 1)?.div;
      return !!view && sharesScreen(view.getBoundingClientRect(), box);
    });
  }
  get screen() {
    const c = this.options.container,
      max = Math.max(0, c.scrollHeight - c.clientHeight);
    return {
      atStart: c.scrollTop <= 1,
      atEnd: c.scrollTop >= max - 1,
      // A document that fits in the area has no end to reach: it is all there from the start.
      scrolls: max > 1,
    };
  }
  setMode(
    mode: ReadingMode,
    joinPages = this.options.joinPages,
    chapterBreaks = this.options.chapterBreaks,
    spread = this.options.spread,
  ) {
    if (
      mode === this.options.mode &&
      joinPages === this.options.joinPages &&
      chapterBreaks === this.options.chapterBreaks &&
      spread === this.options.spread
    )
      return;
    // Keep a PDF-coordinate anchor while the gaps between pages change.
    if (this.ready) this.viewer.update();
    const anchor = this.location;
    this.options.mode = mode;
    this.options.joinPages = joinPages;
    this.options.chapterBreaks = chapterBreaks;
    this.options.spread = spread;
    this.options.container.dataset.readingMode = mode;
    this.edgeReturn = null;
    this.wheelTime = 0;
    if (this.ready) {
      this.changingLayout = true;
      try {
        // The page boxes first: PDF.js sizes "page width" for the pair from them.
        this.joined?.apply();
        this.applySpread();
        this.restoreAnchor(anchor);
      } finally {
        this.changingLayout = false;
      }
      this.viewer.update();
      this.chapters?.refresh();
      this.noteLayers.drawAll();
    }
  }
  // PDF.js regroups the pages and recalculates the "page width" and "whole page"
  // zooms for the new layout; the caller restores the reading position.
  private applySpread() {
    const container = this.options.container;
    if (this.spread === 'none') delete container.dataset.spread;
    else container.dataset.spread = this.spread;
    const mode = PDFJS_SPREAD[this.spread];
    if (this.viewer.spreadMode !== mode) this.viewer.spreadMode = mode;
  }
  private restoreAnchor(anchor: typeof this.location) {
    if (!anchor) return;
    const viewport = this.viewer.getPageView(anchor.pageNumber - 1).viewport;
    const point = viewport.convertToViewportPoint(anchor.left, anchor.top);
    // A previously saved point in a removed margin lands on the nearest kept
    // part of the same page, rather than silently jumping to an adjacent page.
    const [left, top] = viewport.convertToPdfPoint(
      point[0],
      Math.max(0, Math.min(viewport.height - 1, point[1])),
    );
    this.viewer.scrollPageIntoView({
      pageNumber: anchor.pageNumber,
      destArray: [null, { name: 'XYZ' }, left, top, null],
      allowNegativeOffset: true,
    });
  }
  private relayout() {
    if (!this.ready || this.dead) return;
    this.viewer.update();
    const anchor = this.location;
    const edgeReturn = this.edgeReturn;
    const previousTop = this.options.container.scrollTop;
    this.changingLayout = true;
    try {
      this.joined?.apply();
      this.restoreAnchor(anchor);
    } finally {
      this.changingLayout = false;
    }
    if (edgeReturn) {
      const delta = this.options.container.scrollTop - previousTop;
      this.edgeReturn = { from: edgeReturn.from + delta, to: edgeReturn.to + delta };
    }
    this.viewer.update();
    this.chapters?.refresh();
    this.noteLayers.drawAll();
  }
  turn(direction: number) {
    if (!this.ready || this.dead) return;
    if (!this.kindle) {
      if (this.spread === 'none') this.goTo(this.page + direction);
      else this.turnPair(direction);
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
      breaks: this.chapters?.positions(),
    });
    this.edgeReturn = next.edgeReturn;
    c.scrollTop = next.top;
    this.viewer.update();
  }
  // PDF.js knows where each pair starts, and moves one page when only one of the
  // two is in view (for example, at a high zoom).
  private turnPair(direction: number) {
    this.edgeReturn = null;
    if (direction > 0) this.viewer.nextPage();
    else this.viewer.previousPage();
    this.viewer.update();
  }
  // Home and End of the Kindle: the start or the end of the document, which is a jump.
  boundary(end: boolean) {
    if (this.ready) {
      const from = this.leave();
      this.options.container.scrollTop = end ? this.options.container.scrollHeight : 0;
      this.arrive(from);
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
  // A page chosen on purpose (a thumbnail, a bookmark or note, a typed number, "Ler do início"),
  // as opposed to the next or the previous one. It keeps the way back.
  jumpTo(page: number) {
    if (!this.ready || this.dead || !Number.isFinite(page)) return;
    const from = this.leave();
    this.goTo(page);
    this.arrive(from);
  }
  // The highlights of the document, after a note was made, changed or deleted.
  setNotes(notes: readonly Note[]) {
    if (!this.dead) this.noteLayers.set(notes);
  }
  // What is selected in the pages, one piece for each page, with where it is in PDF units; null
  // when nothing is (see reading/selection-capture.ts).
  captureSelection(): SelectionCapture | null {
    return readSelection(this.options.viewer, getSelection(), (page) => {
      const view = this.viewer.getPageView(page - 1);
      return view?.pdfPage ? view.viewport : null;
    });
  }
  // Shift + arrows: the selection of the pages grows by a word (← →) or by a line (↑ ↓), and starts at
  // the first text in view when there is none (see reading/selection-keys.ts). Its end is kept in
  // view: the page scrolls to it, and the Kindle turns the screen. Says what came of it.
  extendSelection(key: string): Extension {
    if (!this.ready || this.dead || !isSelectionKey(key)) return 'edge';
    const result = extendSelection(this.options.container, key);
    if (result === 'moved') {
      this.showSelectionEnd();
      this.options.onSelect();
    }
    return result;
  }
  private showSelectionEnd() {
    const selection = getSelection(),
      end = selection && selectionEnd(selection);
    if (!end) return;
    const c = this.options.container,
      area = visibleArea(c);
    // The end of the selection is brought to a little inside the edge, so that the line it is on is
    // seen with its neighbours. The Kindle does not scroll up and down: it turns the screen, when
    // the end is out of this one.
    const marginY = Math.min(48, (area.bottom - area.top) / 4),
      marginX = Math.min(48, (area.right - area.left) / 4);
    let down = 0;
    if (this.kindle) {
      if (end.bottom > area.bottom + 1) this.turn(1);
      else if (end.top < area.top - 1) this.turn(-1);
    } else if (end.bottom > area.bottom - marginY) down = end.bottom - (area.bottom - marginY);
    else if (end.top < area.top + marginY) down = end.top - (area.top + marginY);
    let right = 0;
    if (end.right > area.right - marginX) right = end.right - (area.right - marginX);
    else if (end.left < area.left + marginX) right = end.left - (area.left + marginX);
    if (down || right) c.scrollBy({ left: right, top: down });
  }
  // A note chosen on purpose: its highlight, with a few lines above it in view, or its page when
  // it has no highlight. Like any other chosen place, it keeps the way back.
  jumpToNote(note: Note) {
    if (!this.ready || this.dead) return;
    const rects = noteRects(note);
    const view = rects.length ? this.viewer.getPageView(note.page - 1) : null;
    if (!view) return this.jumpTo(note.page);
    const from = this.leave();
    const viewport = view.viewport;
    let left = Infinity,
      top = Infinity;
    for (const rect of rects) {
      const [ax, ay, bx, by] = viewportRect(viewport, rect);
      left = Math.min(left, ax, bx);
      top = Math.min(top, ay, by);
    }
    const room = Math.min(this.options.container.clientHeight * 0.25, 180);
    const [x, y] = viewport.convertToPdfPoint(Math.max(0, left - 24), Math.max(0, top - room));
    this.viewer.scrollPageIntoView({
      pageNumber: note.page,
      destArray: [null, { name: 'XYZ' }, x, y, null],
      allowNegativeOffset: true,
    });
    this.viewer.update();
    this.noteLayers.flash(note.id);
    // On the page being read, within a screen of the place, there is nothing worth coming back to.
    this.arrive(from, this.screenHeight());
  }
  // Goes back to where the last jump left, or forward again after going back. Says whether
  // there was somewhere to go.
  back() {
    return this.walk('back');
  }
  forward() {
    return this.walk('forward');
  }
  private walk(direction: 'back' | 'forward') {
    const here = this.here();
    if (!here) return false;
    const target = direction === 'back' ? this.jumps.back(here) : this.jumps.forward(here);
    if (!target) return false;
    this.endSearch();
    this.edgeReturn = null;
    this.restoreAnchor(target);
    this.viewer.update();
    // What was just undone is what can be done again.
    this.options.onJump(this.jumps.offer(direction === 'back' ? 'forward' : 'back'));
    return true;
  }
  // The reading anchor as it is now: PDF.js reports it a frame after a scroll, so it is asked
  // to look again.
  private here(): Position | null {
    if (!this.ready || this.dead) return null;
    this.viewer.update();
    const l = this.location;
    return l ? { pageNumber: l.pageNumber, top: l.top, left: l.left } : null;
  }
  // The two ends of a jump: the place that is left, taken before the move, and the arrival,
  // which keeps that place as the way back if the move did get somewhere else.
  private leave() {
    this.edgeReturn = null;
    return this.here();
  }
  private arrive(from: Position | null, near = Infinity) {
    const to = this.here();
    if (!from || !to || !this.jumps.record(from, to, near)) return;
    this.endSearch();
    this.options.onJump(this.jumps.offer('back'));
  }
  // How far down a page, in PDF units, a screen of the reader reaches.
  private screenHeight() {
    return this.options.container.clientHeight / ((this.viewer.currentScale || 1) * (96 / 72));
  }
  // The links of the document, its outline and its named actions go through the link service,
  // which does not know that they leave the reader's place behind. A destination on the page
  // being read, within a screen of the place, is not worth a way back.
  private keepWayBack() {
    const link = this.link;
    const goToDestination = link.goToDestination.bind(link);
    const goToPage = link.goToPage.bind(link);
    const namedAction = link.executeNamedAction.bind(link);
    link.goToDestination = async (dest) => {
      const from = this.leave();
      await goToDestination(dest);
      this.arrive(from, this.screenHeight());
    };
    link.goToPage = (page) => {
      const from = this.leave();
      goToPage(page);
      this.arrive(from);
    };
    link.executeNamedAction = (action) => {
      // "GoBack" and "GoForward" are the PDF's own words for this history.
      if (action === 'GoBack') this.back();
      else if (action === 'GoForward') this.forward();
      else if (action === 'FirstPage' || action === 'LastPage') {
        const from = this.leave();
        namedAction(action);
        this.arrive(from);
      } else namedAction(action);
    };
  }
  // The first result of a search is a jump, from where the reader was when it began. The next
  // ones are not: going back leads to where the search began.
  private found(state: number) {
    const from = this.findFrom;
    if (!from || this.dead || (state !== FindState.FOUND && state !== FindState.WRAPPED)) return;
    const page = (this.findController.selected?.pageIdx ?? -1) + 1;
    if (page < 1 || !this.jumps.record(from, { pageNumber: page })) return;
    this.findFrom = null;
    this.finding = true;
    this.options.onJump(this.jumps.offer('back'));
  }
  // Another jump, or a step back, closes the search as far as the history goes: its next
  // result is a new jump.
  private endSearch() {
    this.findFrom = null;
    this.finding = false;
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
  // A quarter turn clockwise; 270 is the one back.
  rotate(degrees = 90) {
    if (this.ready) {
      const page = this.page;
      this.viewer.pagesRotation = (this.viewer.pagesRotation + degrees) % 360;
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
    // A new search starts from where the reader is; "next" goes on from the place it began.
    if (!this.finding && (!again || !this.findFrom)) this.findFrom = this.here();
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
    this.endSearch();
    this.bus.dispatch('findbarclose', { source: this });
  }
  destination(dest: any) {
    if (dest) {
      this.edgeReturn = null;
      this.link.goToDestination(dest);
    }
  }
  // The shape of a page (height over width) as it is shown, with the rotation in effect.
  // Until a page is loaded it is the first page's shape, which PDF.js also assumes.
  pageRatio(page: number) {
    const size = this.sizes.get(page) || this.sizes.get(1);
    if (!size) return Math.SQRT2;
    return this.viewer.pagesRotation % 180 === 0 ? size[1] / size[0] : size[0] / size[1];
  }
  // Draws a page, whole and with the rotation in effect, into `canvas` at `width` pixels.
  // Resolves with the page's shape (height over width), or null if it was cancelled:
  // by `signal`, or because the book was closed. It does not touch the page views.
  async thumbnail(page: number, canvas: HTMLCanvasElement, width: number, signal: AbortSignal) {
    if (!this.pdf || this.dead || signal.aborted || !this.joined) return null;
    const proxy = await this.pdf.getPage(page);
    if (this.dead || signal.aborted) return null;
    const rotation = (this.viewer.pagesRotation + proxy.rotate) % 360;
    const unit = this.joined.fullViewport(proxy, 1, rotation);
    this.sizes.set(
      page,
      this.viewer.pagesRotation % 180 === 0 ? [unit.width, unit.height] : [unit.height, unit.width],
    );
    const viewport = this.joined.fullViewport(proxy, width / unit.width, rotation);
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const task = proxy.render({ canvas, viewport });
    const cancel = () => task.cancel();
    this.thumbnailTasks.add(task);
    signal.addEventListener('abort', cancel, { once: true });
    try {
      await task.promise;
      return unit.height / unit.width;
    } catch (error: any) {
      if (error?.name === 'RenderingCancelledException') return null;
      throw error;
    } finally {
      signal.removeEventListener('abort', cancel);
      this.thumbnailTasks.delete(task);
      // Release what the page decoded for this small drawing, such as large images.
      // PDF.js keeps it while the page is being drawn elsewhere.
      try {
        proxy.cleanup();
      } catch {
        /* Nothing to free. */
      }
    }
  }
  async cover() {
    if (!this.pdf || this.dead) return null;
    const page = await this.pdf.getPage(1);
    if (this.dead) return null;
    return renderCover(page, (scale) => this.joined!.fullViewport(page, scale));
  }
  async destroy() {
    this.dead = true;
    this.ready = false;
    this.jumps.clear();
    this.endSearch();
    for (const task of this.thumbnailTasks) task.cancel();
    this.thumbnailTasks.clear();
    this.joined?.destroy();
    this.chapters?.destroy();
    delete this.options.container.dataset.spread;
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
