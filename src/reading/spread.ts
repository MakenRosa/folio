import type { Spread } from '../types';

export const SPREADS: readonly Spread[] = ['none', 'odd', 'even'];

// PDF.js SpreadMode: NONE = 0, ODD = 1, EVEN = 2. ODD starts a pair on every odd
// page (1-2, 3-4, 5-6). EVEN leaves page 1 alone, as a cover, and starts the
// pairs on even pages (2-3, 4-5). The names follow PDF.js, not the page counts.
export const PDFJS_SPREAD: Readonly<Record<Spread, number>> = { none: 0, odd: 1, even: 2 };

// The pages laid out in the same row as `page`: the page alone, or its pair.
// This mirrors how PDF.js groups pages, so navigation and goals agree with it.
export function spreadPages(page: number, pages: number, spread: Spread): number[] {
  if (!Number.isFinite(page) || !Number.isFinite(pages) || pages < 1) return [];
  const n = Math.min(pages, Math.max(1, Math.round(page)));
  if (spread === 'none' || (spread === 'even' && n === 1)) return [n];
  const first = n % 2 === (spread === 'odd' ? 1 : 0) ? n : n - 1;
  return first + 1 <= pages ? [first, first + 1] : [first];
}

export type Rect = { left: number; right: number; top: number; bottom: number };

// A neighbor shares the screen with the current page when at least half of its
// width and a quarter of its height (or of the window, if shorter) are in view.
export function sharesScreen(page: Rect, view: Rect) {
  const width = page.right - page.left,
    height = page.bottom - page.top;
  if (!(width > 0) || !(height > 0)) return false;
  const across = Math.min(page.right, view.right) - Math.max(page.left, view.left),
    down = Math.min(page.bottom, view.bottom) - Math.max(page.top, view.top);
  return across >= width / 2 && down >= Math.min(height, view.bottom - view.top) / 4;
}

// The pages on screen together. The current page always counts; the other page of
// its pair counts when `visible` says it is on screen too. `first` is a stable
// identity for the screen: the same value whichever page PDF.js calls current.
export function screenPages(
  page: number,
  pages: number,
  spread: Spread,
  visible: (page: number) => boolean,
) {
  const pair = spreadPages(page, pages, spread);
  const seen = pair.filter((n) => n === page || visible(n));
  return seen.length
    ? { first: seen[0], last: seen[seen.length - 1] }
    : { first: page, last: page };
}
