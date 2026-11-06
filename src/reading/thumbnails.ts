// Thumbnails are small and drawn only near the visible part of the list. The limits
// keep the memory of a long book bounded: at most `maxLive` canvases exist at once.
export const THUMBNAIL = Object.freeze({
  // CSS width of a thumbnail. The canvas has up to `density` times as many pixels.
  width: 130,
  density: 2,
  // Pixels above and below the list in which thumbnails are already prepared.
  margin: 200,
  // The ceiling of live canvases. Those in or near the view are never released.
  maxLive: 16,
});

// The width, in canvas pixels, for a screen with this pixel density.
export function thumbnailPixels(cssWidth: number, density: number): number {
  const scale = Number.isFinite(density) ? Math.min(THUMBNAIL.density, Math.max(1, density)) : 1;
  return Math.max(1, Math.round(cssWidth * scale));
}

// Which drawn thumbnails to release. `live` goes from the least to the most recently
// used; `keep` are the pages in or near the view. The oldest others go first, until
// no more than `max` are left. If everything left is in view, nothing more is released.
export function chooseEvictions(
  live: readonly number[],
  keep: ReadonlySet<number>,
  max: number,
): number[] {
  const out: number[] = [];
  let count = live.length;
  for (const page of live) {
    if (count <= max) break;
    if (keep.has(page)) continue;
    out.push(page);
    count--;
  }
  return out;
}

// The pending page closest to `anchor`; the lower one when two are equally close.
export function nearestPage(pending: Iterable<number>, anchor: number): number | null {
  let best: number | null = null;
  for (const page of pending) {
    if (
      best === null ||
      Math.abs(page - anchor) < Math.abs(best - anchor) ||
      (Math.abs(page - anchor) === Math.abs(best - anchor) && page < best)
    )
      best = page;
  }
  return best;
}

// The middle of the pages in view, where the next thumbnail is most useful.
export function anchorPage(near: Iterable<number>): number {
  const pages = [...near].sort((a, b) => a - b);
  return pages.length ? pages[Math.floor(pages.length / 2)] : 1;
}
