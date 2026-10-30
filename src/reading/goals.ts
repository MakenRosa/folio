import type { Book, BookGoal, DailyGoal, GoalUnit, ReadingDay } from '../types';

export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function normalizeGoal(value: unknown): DailyGoal | null {
  const goal = value as Partial<DailyGoal> | null;
  return goal &&
    ['pages', 'chapters'].includes(goal.unit || '') &&
    Number.isInteger(goal.target) &&
    goal.target! >= 1 &&
    goal.target! <= 10000
    ? { unit: goal.unit!, target: goal.target! }
    : null;
}
// The goal of a document itself, or null when it has none. A document has one of two settings: a
// goal of its own (`custom`) or none of its own. `inherit` is what is saved now for "no goal of its
// own"; `none` comes from catalogs written before, when it took the document out of the general
// goal, and is read the same way. Nothing that was saved is lost.
export function ownGoal(setting?: BookGoal | null): DailyGoal | null {
  return setting?.mode === 'custom' ? normalizeGoal(setting) : null;
}
// The goal that a document is measured by in the reader: its own, or else the general goal.
export function effectiveGoal(book: Book, global: DailyGoal | null) {
  return ownGoal(book.readingGoal) ?? global;
}
export function dayRecord(book: Book, day = localDay()): ReadingDay {
  return (
    book.readingDays?.[day] || { pages: [], chapters: [], pageAdjustment: 0, chapterAdjustment: 0 }
  );
}
export function dayCount(book: Book, unit: GoalUnit, day = localDay()) {
  const record = dayRecord(book, day);
  return Math.max(
    0,
    record[unit].length + (unit === 'pages' ? record.pageAdjustment : record.chapterAdjustment),
  );
}
// The general goal counts all the reading of the day, in any document: with a goal of its own or
// without, in Removidos, or deleted for good. `books` is the whole list that has days.
export function globalCount(books: Book[], goal: DailyGoal, day = localDay()) {
  return books.reduce((sum, b) => sum + dayCount(b, goal.unit, day), 0);
}
// What the goal of a scope says of a day. A document with a goal of its own is measured by it. A
// document without one, and the whole library (no `book`), are measured by the general goal over
// `counted`.
export function goalProgress(
  book: Book | undefined,
  global: DailyGoal | null,
  counted: Book[],
  day = localDay(),
) {
  const own = !!book && !!ownGoal(book.readingGoal);
  const goal = book ? effectiveGoal(book, global) : global;
  const count = !goal ? 0 : own ? dayCount(book!, goal.unit, day) : globalCount(counted, goal, day);
  return { goal, own, count };
}
export function withDay(book: Book, day: string, record: ReadingDay) {
  // Keep historical totals. Only recent days need page IDs for deduplication.
  return Object.fromEntries(
    Object.entries({ ...book.readingDays, [day]: record })
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([key, value], index) => [
        key,
        index < 31
          ? value
          : {
              pages: [],
              chapters: [],
              pageAdjustment: Math.max(0, value.pages.length + value.pageAdjustment),
              chapterAdjustment: Math.max(0, value.chapters.length + value.chapterAdjustment),
            },
      ]),
  );
}
export type ReadingSample = {
  book: string;
  day: string;
  // First page on screen. In a two-page layout, the first page of the pair.
  page: number;
  // Last page on screen with `page`. Defaults to `page`, one page per screen.
  last?: number;
  active: boolean;
  atEnd: boolean;
  chapters: number[];
};
export type ReadingCredit = { pages?: number[]; chapters?: number[] };
// Adds a credit to a day's record. Returns the same object when nothing is new.
export function withCredit(record: ReadingDay, credit: ReadingCredit): ReadingDay {
  const pages = (credit.pages || []).filter((n) => !record.pages.includes(n)),
    chapters = (credit.chapters || []).filter((n) => !record.chapters.includes(n));
  return pages.length || chapters.length
    ? { ...record, pages: [...record.pages, ...pages], chapters: [...record.chapters, ...chapters] }
    : record;
}
// A screen qualifies after eight seconds in an active reader. A screen is one
// page, or the pair of a two-page layout: both pages are in view, so both count.
// Jumps never fill in intermediate pages. Chapters qualify only on an adjacent
// forward transition after a qualifying screen, when a recognized start falls
// inside the screen that qualified, or at the document's final screen.
export class ReadingActivity {
  private previous: (ReadingSample & { last: number }) | null = null;
  private since = 0;
  private qualified = false;
  reset() {
    this.previous = null;
    this.qualified = false;
  }
  sample(s: ReadingSample, now: number): ReadingCredit {
    if (!s.active) {
      this.reset();
      return {};
    }
    const last = Math.max(s.page, s.last ?? s.page);
    const p = this.previous;
    const same = p?.book === s.book && p.day === s.day;
    const pages: number[] = [];
    const chapters: number[] = [];
    // The chapter that contains `page` is the one a recognized start after it ends.
    const ending = (page: number) => s.chapters.filter((n) => n <= page).at(-1);
    const add = (chapter: number | undefined) => {
      if (chapter && !chapters.includes(chapter)) chapters.push(chapter);
    };
    if (same && this.qualified && s.page === p.last + 1 && s.chapters.includes(s.page))
      add(ending(p.last));
    if (!same || p.page !== s.page) {
      this.since = now;
      this.qualified = false;
    }
    this.previous = { ...s, last };
    if (now - this.since >= 8000) {
      this.qualified = true;
      for (let n = s.page; n <= last; n++) pages.push(n);
      // A recognized start on the second page of the screen ends the chapter
      // that began before it, which was in view for the whole time.
      for (const start of s.chapters) if (start > s.page && start <= last) add(ending(start - 1));
      if (s.atEnd) add(ending(last));
    }
    return {
      ...(pages.length ? { pages } : {}),
      ...(chapters.length ? { chapters } : {}),
    };
  }
}
