import {
  THUMBNAIL,
  anchorPage,
  chooseEvictions,
  nearestPage,
  thumbnailPixels,
} from '../reading/thumbnails';

// What the list needs from the reader.
export interface ThumbnailSource {
  readonly pages: number;
  pageRatio(page: number): number;
  thumbnail(
    page: number,
    canvas: HTMLCanvasElement,
    width: number,
    signal: AbortSignal,
  ): Promise<number | null>;
}

// One button per page, with the page's shape drawn as a placeholder. A thumbnail is drawn
// only when its button comes near the visible part of the list, one at a time, and the
// canvases that are far from the view are released, so a long book never fills memory.
export class ThumbnailList {
  private list: HTMLOListElement;
  private buttons: HTMLButtonElement[] = [];
  private observer: IntersectionObserver;
  private near = new Set<number>();
  private pending = new Set<number>();
  // Drawn pages, from the least to the most recently in view.
  private live = new Map<number, HTMLCanvasElement>();
  private job: { page: number; controller: AbortController } | null = null;
  private marked: HTMLButtonElement[] = [];
  private stop = 1;
  private disposed = false;

  constructor(
    private host: HTMLElement,
    private source: ThumbnailSource,
    private go: (page: number) => void,
  ) {
    const pages = source.pages;
    host.innerHTML = `<ol id="thumbnail-list" class="thumb-list" aria-label="Miniaturas das páginas">${Array.from(
      { length: pages },
      (_, i) =>
        `<li><button class="thumb" data-page="${i + 1}" aria-label="Página ${i + 1}" tabindex="-1"><span class="thumb-frame" style="aspect-ratio:${this.shape(i + 1)}"></span><span class="thumb-number" aria-hidden="true">${i + 1}</span></button></li>`,
    ).join('')}</ol>`;
    this.list = host.querySelector<HTMLOListElement>('#thumbnail-list')!;
    this.buttons = [...this.list.querySelectorAll<HTMLButtonElement>('.thumb')];
    this.buttons[0]?.setAttribute('tabindex', '0');
    this.list.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('.thumb');
      if (button) this.go(Number(button.dataset.page));
    });
    this.list.addEventListener('keydown', (event) => this.key(event));
    this.list.addEventListener('focusin', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('.thumb');
      if (button) this.setStop(Number(button.dataset.page));
    });
    this.observer = new IntersectionObserver((entries) => this.seen(entries), {
      root: host,
      rootMargin: `${THUMBNAIL.margin}px 0px`,
    });
    this.buttons.forEach((button) => this.observer.observe(button));
  }

  // width / height, for the `aspect-ratio` property.
  private shape(page: number) {
    return (1 / this.source.pageRatio(page)).toFixed(4);
  }

  private frame(page: number) {
    return this.buttons[page - 1].firstElementChild as HTMLElement;
  }

  private seen(entries: IntersectionObserverEntry[]) {
    if (this.disposed) return;
    for (const entry of entries) {
      const page = Number((entry.target as HTMLElement).dataset.page);
      if (entry.isIntersecting) {
        this.near.add(page);
        const canvas = this.live.get(page);
        if (canvas) {
          // Seen again: it becomes the most recent.
          this.live.delete(page);
          this.live.set(page, canvas);
        } else this.pending.add(page);
      } else {
        this.near.delete(page);
        this.pending.delete(page);
        if (this.job?.page === page) this.job.controller.abort();
      }
    }
    this.pump();
  }

  // One drawing at a time, starting with the page closest to the middle of the view.
  private pump() {
    if (this.disposed || this.job) return;
    const page = nearestPage(this.pending, anchorPage(this.near));
    if (page === null) return;
    this.pending.delete(page);
    const canvas = document.createElement('canvas'),
      controller = new AbortController();
    this.job = { page, controller };
    const pixels = thumbnailPixels(THUMBNAIL.width, devicePixelRatio);
    const finish = (ratio: number | null) => {
      this.job = null;
      if (ratio === null || this.disposed) this.discard(canvas);
      else this.keep(page, canvas);
      this.pump();
    };
    this.source.thumbnail(page, canvas, pixels, controller.signal).then(finish, () => finish(null));
  }

  private keep(page: number, canvas: HTMLCanvasElement) {
    canvas.setAttribute('aria-hidden', 'true');
    // The real shape of the page, which can differ from the first page's.
    this.frame(page).style.aspectRatio = `${canvas.width} / ${canvas.height}`;
    this.frame(page).replaceChildren(canvas);
    this.live.set(page, canvas);
    for (const old of chooseEvictions([...this.live.keys()], this.near, THUMBNAIL.maxLive))
      this.release(old);
  }

  private release(page: number) {
    const canvas = this.live.get(page);
    this.live.delete(page);
    if (canvas) this.discard(canvas);
  }

  // The pixels of a canvas that is dropped are freed at once, not when it is collected.
  private discard(canvas: HTMLCanvasElement) {
    canvas.remove();
    canvas.width = 0;
    canvas.height = 0;
  }

  // The rotation changed: new shapes, and every thumbnail drawn again.
  refresh() {
    if (this.disposed) return;
    this.job?.controller.abort();
    this.pending.clear();
    for (const page of [...this.live.keys()]) this.release(page);
    this.buttons.forEach((_, i) => (this.frame(i + 1).style.aspectRatio = this.shape(i + 1)));
    for (const page of this.near) this.pending.add(page);
    this.pump();
  }

  // Marks the pages on screen. The first one is brought into view without taking the focus.
  show(first: number, last: number) {
    for (const button of this.marked) {
      button.removeAttribute('aria-current');
      button.classList.remove('current');
    }
    this.marked = [];
    for (let page = first; page <= Math.min(last, first + 3); page++) {
      const button = this.buttons[page - 1];
      if (!button) continue;
      button.setAttribute('aria-current', 'page');
      button.classList.add('current');
      this.marked.push(button);
    }
    if (!this.list.contains(document.activeElement)) this.setStop(first);
    this.marked.at(-1)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.marked[0]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // Only one thumbnail is a tab stop; the arrow keys move between them.
  private setStop(page: number) {
    if (page === this.stop && this.buttons[page - 1]?.tabIndex === 0) return;
    this.buttons[this.stop - 1]?.setAttribute('tabindex', '-1');
    this.stop = Math.min(this.buttons.length, Math.max(1, page));
    this.buttons[this.stop - 1]?.setAttribute('tabindex', '0');
  }

  private key(event: KeyboardEvent) {
    const button = (event.target as HTMLElement).closest<HTMLElement>('.thumb');
    if (!button || event.altKey || event.ctrlKey || event.metaKey) return;
    const page = Number(button.dataset.page),
      last = this.buttons.length;
    const moves: Record<string, number> = {
      ArrowDown: page + 1,
      ArrowUp: page - 1,
      PageDown: page + 5,
      PageUp: page - 5,
      Home: 1,
      End: last,
    };
    const target = moves[event.key];
    // Enter and Space are the button's own: they go to the page.
    if (target === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    this.buttons[Math.min(last, Math.max(1, target)) - 1]?.focus();
  }

  dispose() {
    this.disposed = true;
    this.observer.disconnect();
    this.job?.controller.abort();
    this.pending.clear();
    this.near.clear();
    for (const page of [...this.live.keys()]) this.release(page);
    this.list.remove();
  }
}
