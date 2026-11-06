import type { PaceEntry } from '../types';

// Seconds a page must hold the reader to count as read. Faster flips are skimming.
export const MIN_PAGE_SECONDS = 3;
// The time credited to one page is capped, so a slow page cannot skew the pace.
export const MAX_PAGE_SECONDS = 240;
// A page held longer than this is a pause (a coffee, a phone call), not reading.
export const IDLE_PAGE_SECONDS = 600;
// A forward step larger than this is a jump. Kindle screens can skip a page or two.
export const MAX_FORWARD_STEP = 3;
// Pages that must be measured in a book before an estimate is shown.
export const MIN_SAMPLES = 5;
// Books whose pace is kept. The least recently read are forgotten first.
export const MAX_BOOKS = 50;
const MAX_SAMPLES = 1000;
const MAX_ID_LENGTH = 100;
// Samples taken further apart than this mean the timer paused (sleep, throttling).
const MAX_GAP_MS = 2500;
// Smoothing of the moving average once a book has enough pages measured.
const SMOOTHING = 0.1;
// After a few pages, one measurement cannot move the average by more than this factor.
const OUTLIER_FACTOR = 3;

export type PaceSample = { book: string; page: number; active: boolean };

// Measures active seconds per PDF page. It is fed once per second with the same
// "active" signal as the reading goals (focus, no dialog, search or menu open).
// A page is measured only when the reader arrived on it by a small forward step
// and leaves it by another one. The first page of a session, jumps, returning
// to an earlier page and interruptions never produce a measurement.
export class PaceTracker {
  private book = '';
  private page = 0;
  private at = 0;
  private dwell = 0;
  private tracking = false;
  private trusted = false;
  reset() {
    this.tracking = false;
    this.trusted = false;
    this.dwell = 0;
  }
  // Returns the seconds per page measured at this sample, if any.
  sample(s: PaceSample, now: number): number | null {
    if (!s.active || !Number.isFinite(s.page)) {
      this.reset();
      return null;
    }
    const continuous =
      this.tracking && this.book === s.book && now >= this.at && now - this.at <= MAX_GAP_MS;
    let measured: number | null = null;
    if (!continuous) {
      this.dwell = 0;
      this.trusted = false;
    } else {
      this.dwell += (now - this.at) / 1000;
      if (s.page !== this.page) {
        const step = s.page - this.page;
        const forward = step >= 1 && step <= MAX_FORWARD_STEP;
        if (this.trusted && forward) measured = pagePace(this.dwell, step);
        this.trusted = forward;
        this.dwell = 0;
      }
    }
    this.book = s.book;
    this.page = s.page;
    this.at = now;
    this.tracking = true;
    return measured;
  }
}
function pagePace(dwell: number, pages: number) {
  const seconds = dwell / pages;
  if (seconds < MIN_PAGE_SECONDS || seconds > IDLE_PAGE_SECONDS) return null;
  return Math.min(MAX_PAGE_SECONDS, seconds);
}

// Stored in preferences: tolerant of damaged or older data and bounded in size.
export function normalizePace(value: unknown): Record<string, PaceEntry> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries: [string, PaceEntry][] = [];
  for (const [id, raw] of Object.entries(value)) {
    const e = raw as Partial<PaceEntry> | null;
    if (!id || id.length > MAX_ID_LENGTH || !e || typeof e !== 'object') continue;
    if (typeof e.seconds !== 'number' || !Number.isFinite(e.seconds)) continue;
    if (typeof e.samples !== 'number' || !Number.isFinite(e.samples) || e.samples < 1) continue;
    entries.push([
      id,
      {
        seconds: Math.min(MAX_PAGE_SECONDS, Math.max(MIN_PAGE_SECONDS, e.seconds)),
        samples: Math.min(MAX_SAMPLES, Math.floor(e.samples)),
        updated: typeof e.updated === 'number' && Number.isFinite(e.updated) ? e.updated : 0,
      },
    ]);
  }
  return Object.fromEntries(
    entries.sort((a, b) => b[1].updated - a[1].updated).slice(0, MAX_BOOKS),
  );
}

export function recordPace(
  store: Record<string, PaceEntry>,
  id: string,
  seconds: number,
  now: number,
): Record<string, PaceEntry> {
  const measured = Math.min(MAX_PAGE_SECONDS, Math.max(MIN_PAGE_SECONDS, seconds));
  const old = Object.hasOwn(store, id) ? store[id] : undefined;
  let entry: PaceEntry;
  if (!old) entry = { seconds: measured, samples: 1, updated: now };
  else {
    const bounded =
      old.samples >= MIN_SAMPLES
        ? Math.min(old.seconds * OUTLIER_FACTOR, Math.max(old.seconds / OUTLIER_FACTOR, measured))
        : measured;
    // A plain average at first, then a moving average of roughly the last ten pages.
    const weight = Math.max(1 / (old.samples + 1), SMOOTHING);
    entry = {
      seconds: old.seconds + (bounded - old.seconds) * weight,
      samples: Math.min(MAX_SAMPLES, old.samples + 1),
      updated: now,
    };
  }
  return normalizePace({ ...store, [id]: entry });
}

// Null until enough pages of this book were measured.
export function secondsPerPage(store: Record<string, PaceEntry>, id: string) {
  const e = Object.hasOwn(store, id) ? store[id] : undefined;
  return e && e.samples >= MIN_SAMPLES && e.seconds > 0 ? e.seconds : null;
}

export type Remaining = { chapter: number | null; book: number };
// Seconds left, counting the page being read. The chapter ends at the next
// recognized start; the last chapter has none, so only the book is returned.
export function remainingTime(input: {
  page: number;
  pages: number;
  secondsPerPage: number | null;
  chapters?: readonly number[];
  finished?: boolean;
  atEnd?: boolean;
}): Remaining | null {
  const { page, pages, secondsPerPage: pace } = input;
  if (input.finished || input.atEnd || !pace || !Number.isFinite(pace) || pace <= 0) return null;
  if (!Number.isInteger(page) || !Number.isInteger(pages) || page < 1 || page >= pages) return null;
  const next = Math.min(
    ...(input.chapters ?? []).filter((n) => Number.isInteger(n) && n > page && n <= pages),
  );
  return {
    book: (pages - page + 1) * pace,
    chapter: Number.isFinite(next) ? (next - page) * pace : null,
  };
}

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  if (minutes >= 600) return `${Math.round(minutes / 60)} h`;
  const rounded = Math.round(minutes / 5) * 5;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
