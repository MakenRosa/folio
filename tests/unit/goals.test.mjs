import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localDay,
  normalizeGoal,
  effectiveGoal,
  dayCount,
  globalCount,
  withCredit,
  withDay,
  ReadingActivity,
} from '../../src/reading/goals.ts';
const day = '2026-10-29';
const record = { pages: [3, 4], chapters: [1], pageAdjustment: 0, chapterAdjustment: 0 };
test('global totals aggregate inherited books and exclude custom/disabled goals', () => {
  const goal = { unit: 'pages', target: 20 };
  const a = { readingDays: { [day]: record } };
  const b = { ...a, readingGoal: { mode: 'custom', unit: 'chapters', target: 2 } };
  const c = { ...a, readingGoal: { mode: 'none' } };
  assert.equal(globalCount([a, a, b, c], goal, day), 4);
  assert.deepEqual(effectiveGoal(b, goal), { unit: 'chapters', target: 2 });
  assert.equal(effectiveGoal(c, goal), null);
  assert.equal(globalCount([a], goal, '2026-10-30'), 0);
  assert.equal(normalizeGoal({ unit: 'pages', target: 0 }), null);
  assert.equal(normalizeGoal({ unit: 'pages', target: 1.5 }), null);
  assert.equal(normalizeGoal({ unit: 'pages', target: Infinity }), null);
  assert.equal(localDay(new Date(2026, 9, 29, 23, 59)), day);
});
test('daily adjustments preserve deduplication and old totals are compacted without loss', () => {
  const book = { readingDays: { [day]: { ...record, pageAdjustment: -2 } } };
  assert.equal(dayCount(book, 'pages', day), 0);
  const days = Object.fromEntries(
    Array.from({ length: 31 }, (_, i) => [`2026-10-${String(i + 1).padStart(2, '0')}`, record]),
  );
  const next = withDay({ readingDays: days }, '2026-11-01', record);
  assert.equal(Object.keys(next).length, 32);
  assert.deepEqual(next['2026-10-01'], {
    pages: [],
    chapters: [],
    pageAdjustment: 2,
    chapterAdjustment: 1,
  });
  assert.equal(dayCount({ readingDays: next }, 'pages', '2026-10-01'), 2);
});
test('active dwell counts pages but rapid jumps, hidden windows and midnight do not inflate progress', () => {
  const tracker = new ReadingActivity();
  const s = { book: 'a', day, page: 1, active: true, atEnd: false, chapters: [1, 3, 5] };
  assert.deepEqual(tracker.sample(s, 0), {});
  assert.deepEqual(tracker.sample(s, 8000), { pages: [1] });
  assert.deepEqual(tracker.sample({ ...s, page: 3 }, 9000), {});
  assert.deepEqual(tracker.sample({ ...s, page: 3, active: false }, 17000), {});
  assert.deepEqual(tracker.sample({ ...s, page: 3 }, 18000), {});
  assert.deepEqual(tracker.sample({ ...s, page: 3, day: '2026-10-30' }, 26000), {});
  assert.deepEqual(tracker.sample({ ...s, page: 3, day: '2026-10-30' }, 34000), { pages: [3] });
});
test('chapter completion requires a qualified adjacent transition or the final screen', () => {
  const t = new ReadingActivity(),
    s = { book: 'a', day, page: 2, active: true, atEnd: false, chapters: [1, 3, 5] };
  t.sample(s, 0);
  t.sample(s, 8000);
  assert.deepEqual(t.sample({ ...s, page: 3 }, 9000), { chapters: [1] });
  t.sample({ ...s, page: 6 }, 10000);
  assert.deepEqual(t.sample({ ...s, page: 6, atEnd: true }, 18000), { pages: [6], chapters: [5] });
  t.reset();
  t.sample({ ...s, chapters: [] }, 0);
  assert.deepEqual(t.sample({ ...s, chapters: [], atEnd: true }, 8000), { pages: [2] });
});
test('a credit is added to the day once, and an empty one changes nothing', () => {
  const day = { pages: [1, 2], chapters: [1], pageAdjustment: 3, chapterAdjustment: 0 };
  assert.equal(withCredit(day, {}), day);
  assert.equal(withCredit(day, { pages: [2], chapters: [1] }), day, 'Already counted today');
  assert.deepEqual(withCredit(day, { pages: [2, 3, 4], chapters: [2] }), {
    pages: [1, 2, 3, 4],
    chapters: [1, 2],
    pageAdjustment: 3,
    chapterAdjustment: 0,
  });
  assert.deepEqual(day.pages, [1, 2], 'The record is not changed in place');
});
test('both pages of a pair on screen count together, from the first to the last on view', () => {
  const t = new ReadingActivity();
  const pair = { book: 'a', day, page: 3, last: 4, active: true, atEnd: false, chapters: [] };
  assert.deepEqual(t.sample(pair, 0), {});
  assert.deepEqual(t.sample(pair, 7000), {}, 'The pair needs the same eight seconds');
  assert.deepEqual(t.sample(pair, 8000), { pages: [3, 4] });
  // The same screen, sampled again: nothing restarts the count.
  assert.deepEqual(t.sample(pair, 9000), { pages: [3, 4] });
  // A lone cover counts as itself, and a neighbor out of view does not count.
  const single = new ReadingActivity();
  single.sample({ ...pair, page: 1, last: 1 }, 0);
  assert.deepEqual(single.sample({ ...pair, page: 1, last: 1 }, 8000), { pages: [1] });
  single.sample({ ...pair, page: 5, last: undefined }, 9000);
  assert.deepEqual(single.sample({ ...pair, page: 5, last: undefined }, 17000), { pages: [5] });
  // Jumping from one pair to another fills nothing in between.
  const jump = new ReadingActivity();
  jump.sample({ ...pair, page: 1, last: 2 }, 0);
  jump.sample({ ...pair, page: 1, last: 2 }, 8000);
  assert.deepEqual(jump.sample({ ...pair, page: 7, last: 8 }, 9000), {});
  assert.deepEqual(jump.sample({ ...pair, page: 7, last: 8 }, 17000), { pages: [7, 8] });
});
test('chapters count in a two-page layout when the start is on either page of the pair', () => {
  const at = (page, last, chapters, atEnd = false) => ({
    book: 'a',
    day,
    page,
    last,
    active: true,
    atEnd,
    chapters,
  });
  // A start on the first page of the next pair ends the chapter of the pair left behind.
  const arrival = new ReadingActivity();
  arrival.sample(at(1, 2, [1, 3]), 0);
  arrival.sample(at(1, 2, [1, 3]), 8000);
  assert.deepEqual(arrival.sample(at(3, 4, [1, 3]), 9000), { chapters: [1] });
  assert.deepEqual(
    arrival.sample(at(3, 4, [1, 3]), 17000),
    { pages: [3, 4] },
    'Nothing new inside',
  );
  // A start on the second page of the pair (a chapter opening on a right-hand page)
  // ends the chapter that ran through the first page, once the pair has been read.
  const inside = new ReadingActivity();
  inside.sample(at(1, 2, [1, 4]), 0);
  inside.sample(at(1, 2, [1, 4]), 8000);
  assert.deepEqual(inside.sample(at(3, 4, [1, 4]), 9000), {}, 'Page 3 is not a start');
  assert.deepEqual(inside.sample(at(3, 4, [1, 4]), 16000), {}, 'Not yet eight seconds');
  assert.deepEqual(inside.sample(at(3, 4, [1, 4]), 17000), { pages: [3, 4], chapters: [1] });
  // Without that start in view, nothing is credited, even if it is the next page.
  const apart = new ReadingActivity();
  apart.sample(at(3, 3, [1, 4]), 0);
  assert.deepEqual(apart.sample(at(3, 3, [1, 4]), 8000), { pages: [3] });
  // The final pair credits the chapter that ended inside it and the last chapter.
  const end = new ReadingActivity();
  end.sample(at(5, 6, [1, 3, 6], true), 0);
  assert.deepEqual(end.sample(at(5, 6, [1, 3, 6], true), 8000), {
    pages: [5, 6],
    chapters: [3, 6],
  });
  // A jump to a pair never credits the chapter of the one it came from.
  const jump = new ReadingActivity();
  jump.sample(at(1, 2, [1, 5]), 0);
  jump.sample(at(1, 2, [1, 5]), 8000);
  assert.deepEqual(jump.sample(at(5, 6, [1, 5]), 9000), {});
});
