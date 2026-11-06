export type ProgressPosition = {
  page: number;
  pages: number;
  finished?: boolean;
  // The reader has scrolled to the end of the document. The library cannot know this.
  atEnd?: boolean;
};

// The only definition of reading progress. The reader footer and the library use
// it, so a saved position shows the same percentage in both. It counts pages from
// the first (0%) to the last (100%) and ignores window size, zoom and the way
// Kindle mode joins pages, none of which change which PDF page is being read.
export function readingProgress({
  page,
  pages,
  finished = false,
  atEnd = false,
}: ProgressPosition) {
  if (finished) return 100;
  if (!Number.isFinite(page) || !Number.isFinite(pages) || pages < 1) return 0;
  const current = Math.min(pages, Math.max(1, Math.round(page)));
  if (current >= pages) return 100;
  // Page 1 is the start even when a small document fits entirely on the screen.
  if (current === 1) return 0;
  if (atEnd) return 100;
  // Only the first page is 0% and only the last is 100%.
  return Math.min(99, Math.max(1, Math.round(((current - 1) / (pages - 1)) * 100)));
}
