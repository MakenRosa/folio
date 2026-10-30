import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BOOKS,
  MAX_PAGE_SECONDS,
  MIN_SAMPLES,
  PaceTracker,
  formatDuration,
  normalizePace,
  recordPace,
  remainingTime,
  secondsPerPage,
} from '../../src/reading/pace.ts';

// Feeds one sample per second, as the reader does, and collects the measurements.
// Each step is [page, seconds, active = true].
function read(tracker, book, steps) {
  const out = [];
  let now = 0;
  for (const [page, seconds, active = true] of steps) {
    for (let i = 0; i < seconds; i++) {
      now += 1000;
      const measured = tracker.sample({ book, page, active }, now);
      if (measured !== null) out.push(Math.round(measured));
    }
  }
  return out;
}
const paces = (count, updated = 0) =>
  Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      `book-${i}`,
      { seconds: 50, samples: 5, updated: updated + i },
    ]),
  );

test('a page is measured after arriving on it and leaving it by small forward steps', () => {
  // Page 1 was under way when tracking began, so only pages 2 and 3 are measured.
  assert.deepEqual(
    read(new PaceTracker(), 'a', [
      [1, 20],
      [2, 40],
      [3, 60],
      [4, 1],
    ]),
    [40, 60],
  );
});

test('skimming, jumps, going back and the first page of a session are not measured', () => {
  assert.deepEqual(
    read(new PaceTracker(), 'a', [
      [1, 10],
      [2, 2],
      [3, 2],
      [4, 2],
      [5, 1],
    ]),
    [],
    'Flipping through pages is skimming, not reading',
  );
  assert.deepEqual(
    read(new PaceTracker(), 'a', [
      [1, 10],
      [2, 30], // left by a jump
      [30, 30], // reached by a jump
      [31, 30], // reached by a jump's neighbor, but arrived on by a step
      [32, 30],
      [33, 1],
    ]),
    [30, 30],
    'Pages 2 and 30 are not measured; 31 and 32 are',
  );
  assert.deepEqual(
    read(new PaceTracker(), 'a', [
      [1, 10],
      [2, 30],
      [3, 30],
      [2, 30], // going back is not reading forward
      [3, 30], // arrived on 3 from 2 by a step, but left 2 untrusted
      [4, 1],
    ]),
    [30, 30],
    'The second visit to page 2 and the return to 3 follow the same rules',
  );
});

test('a Kindle turn that skips a page is measured per page crossed', () => {
  assert.deepEqual(
    read(new PaceTracker(), 'a', [
      [1, 5],
      [2, 60],
      [4, 30],
      [5, 1],
    ]),
    [30, 30],
    '60 s on the screen that crossed pages 2 and 3 is 30 s per page',
  );
});

test('two pages side by side are measured per page, stepping two at a time', () => {
  // The reader tracks the first page of each pair: 1, 3, 5, 7. Each step crosses two pages.
  assert.deepEqual(
    read(new PaceTracker(), 'a', [
      [1, 5],
      [3, 60],
      [5, 40],
      [7, 1],
    ]),
    [30, 20],
    '60 s on the pair (3, 4) is 30 s per page, and 40 s on (5, 6) is 20 s',
  );
  // A cover alone, then pairs (2, 3), (4, 5): the cover's step is one page, the rest two.
  assert.deepEqual(
    read(new PaceTracker(), 'a', [
      [1, 5],
      [2, 20],
      [4, 30],
      [6, 1],
    ]),
    [10, 15],
    '20 s on the pair (2, 3) is 10 s per page; the cover was where tracking began',
  );
  // A pair that is skimmed is not measured, even though two pages passed.
  assert.deepEqual(
    read(new PaceTracker(), 'a', [
      [1, 5],
      [3, 5],
      [5, 5],
      [7, 1],
    ]),
    [],
    '2.5 s per page is skimming',
  );
});

test('interruptions, sleeping and other books never credit time', () => {
  assert.deepEqual(
    read(new PaceTracker(), 'a', [
      [1, 5],
      [2, 20],
      [2, 3, false], // a dialog opens: the page starts over
      [2, 20],
      [3, 20],
    ]),
    [],
  );
  const sleeping = new PaceTracker();
  sleeping.sample({ book: 'a', page: 1, active: true }, 0);
  sleeping.sample({ book: 'a', page: 2, active: true }, 1000);
  // The machine slept for an hour between two samples.
  sleeping.sample({ book: 'a', page: 2, active: true }, 3_601_000);
  assert.equal(sleeping.sample({ book: 'a', page: 3, active: true }, 3_602_000), null);
  const other = new PaceTracker();
  assert.deepEqual(
    read(other, 'a', [
      [1, 5],
      [2, 20],
    ]),
    [],
  );
  // The last sample was at 25 s. Another book at the next page measures nothing.
  assert.equal(other.sample({ book: 'b', page: 3, active: true }, 26_000), null);
  assert.equal(other.sample({ book: 'b', page: 4, active: true }, 27_000), null);
  const invalid = new PaceTracker();
  assert.equal(invalid.sample({ book: 'a', page: Number.NaN, active: true }, 0), null);
});

test('long pauses are capped and extreme ones discarded', () => {
  assert.deepEqual(
    read(new PaceTracker(), 'a', [
      [1, 5],
      [2, 1], // skimmed
      [3, 400], // a long pause: credited at the cap, not at 400 s
      [4, 700], // far longer: the reader left the book open
      [5, 1],
    ]),
    [MAX_PAGE_SECONDS],
  );
});

test('pace averages evenly at first, then follows the last pages and resists outliers', () => {
  let store = recordPace({}, 'a', 60, 1);
  assert.deepEqual(store.a, { seconds: 60, samples: 1, updated: 1 });
  store = recordPace(store, 'a', 30, 2);
  assert.equal(store.a.seconds, 45, 'A plain average while there are few samples');
  assert.equal(store.a.samples, 2);
  for (let i = 0; i < 20; i++) store = recordPace(store, 'a', 60, 3 + i);
  assert.ok(Math.abs(store.a.seconds - 60) < 4, 'Settles on a steady pace');
  const before = store.a.seconds;
  store = recordPace(store, 'a', 240, 99);
  assert.ok(store.a.seconds > before);
  assert.ok(
    store.a.seconds <= before * 1.2 + 1e-9,
    'A 4x outlier moves the average by 20% at most',
  );
  assert.equal(store.a.samples, 23);
  assert.equal(store.a.updated, 99);
  assert.equal(recordPace({}, 'x', 5000, 1).x.seconds, MAX_PAGE_SECONDS);
  assert.equal(recordPace({}, 'x', 0.1, 1).x.seconds, 3);
});

test('an estimate needs enough measured pages of the same book', () => {
  let store = {};
  for (let i = 0; i < MIN_SAMPLES - 1; i++) store = recordPace(store, 'a', 60, i);
  assert.equal(secondsPerPage(store, 'a'), null);
  assert.equal(secondsPerPage(store, 'unknown'), null);
  assert.equal(secondsPerPage(store, '__proto__'), null);
  store = recordPace(store, 'a', 60, 9);
  assert.equal(secondsPerPage(store, 'a'), 60);
  assert.equal(secondsPerPage(store, 'b'), null, 'Another book starts without an estimate');
});

test('stored pace is normalized, bounded and never mutated', () => {
  assert.deepEqual(normalizePace(undefined), {});
  assert.deepEqual(normalizePace([1, 2]), {});
  assert.deepEqual(normalizePace('x'), {});
  assert.deepEqual(
    normalizePace({
      good: { seconds: 50, samples: 7.9, updated: 5 },
      other: { seconds: 40, samples: 3, updated: 1 },
      noSeconds: { samples: 3, updated: 1 },
      nan: { seconds: Number.NaN, samples: 3, updated: 1 },
      text: { seconds: '40', samples: 3, updated: 1 },
      noSamples: { seconds: 40, samples: 0, updated: 1 },
      infinite: { seconds: 40, samples: Infinity, updated: 1 },
      nullEntry: null,
      number: 9,
      '': { seconds: 40, samples: 3, updated: 1 },
    }),
    {
      good: { seconds: 50, samples: 7, updated: 5 },
      other: { seconds: 40, samples: 3, updated: 1 },
    },
  );
  const clamped = normalizePace({
    slow: { seconds: 9999, samples: 5, updated: 1 },
    fast: { seconds: -4, samples: 5000, updated: -Infinity },
  });
  assert.equal(clamped.slow.seconds, MAX_PAGE_SECONDS);
  assert.equal(clamped.fast.seconds, 3);
  assert.equal(clamped.fast.samples, 1000);
  assert.equal(clamped.fast.updated, 0);
  assert.deepEqual(
    normalizePace({ ['x'.repeat(101)]: { seconds: 50, samples: 5, updated: 1 } }),
    {},
  );
  const kept = Object.keys(normalizePace(paces(MAX_BOOKS + 25)));
  assert.equal(kept.length, MAX_BOOKS);
  assert.ok(kept.includes(`book-${MAX_BOOKS + 24}`), 'The most recent books are kept');
  assert.ok(!kept.includes('book-0'), 'The least recent are forgotten');
  const input = Object.freeze({ a: { seconds: 60, samples: 5, updated: 1 } });
  assert.doesNotThrow(() => recordPace(input, 'a', 70, 2));
  assert.deepEqual(input.a, { seconds: 60, samples: 5, updated: 1 });
  const crowded = recordPace(paces(MAX_BOOKS), 'new', 50, 1000);
  assert.equal(Object.keys(crowded).length, MAX_BOOKS);
  assert.ok(crowded.new, 'The book being read is kept');
});

test('time left counts the page being read and ends the chapter at the next recognized start', () => {
  const base = { page: 3, pages: 10, secondsPerPage: 60, chapters: [1, 5, 8] };
  assert.deepEqual(remainingTime(base), { book: 8 * 60, chapter: 2 * 60 });
  assert.deepEqual(remainingTime({ ...base, page: 5 }), { book: 6 * 60, chapter: 3 * 60 });
  assert.deepEqual(
    remainingTime({ ...base, page: 9 }),
    { book: 2 * 60, chapter: null },
    'The last chapter ends with the book, which is not repeated',
  );
  assert.deepEqual(remainingTime({ ...base, chapters: [] }), { book: 8 * 60, chapter: null });
  assert.deepEqual(remainingTime({ ...base, chapters: undefined }), {
    book: 8 * 60,
    chapter: null,
  });
  assert.deepEqual(
    remainingTime({ ...base, chapters: [9, 5, 99, 2.5, Number.NaN, 0] }),
    { book: 8 * 60, chapter: 2 * 60 },
    'Unsorted and invalid starts are ignored',
  );
});

test('no estimate without a pace, at the end, when finished or when the position is unknown', () => {
  const base = { page: 3, pages: 10, secondsPerPage: 60 };
  assert.ok(remainingTime(base));
  assert.equal(remainingTime({ ...base, secondsPerPage: null }), null);
  assert.equal(remainingTime({ ...base, secondsPerPage: 0 }), null);
  assert.equal(remainingTime({ ...base, secondsPerPage: Number.NaN }), null);
  assert.equal(remainingTime({ ...base, finished: true }), null);
  assert.equal(remainingTime({ ...base, atEnd: true }), null);
  assert.equal(remainingTime({ ...base, page: 10 }), null, 'Nothing left after the last page');
  assert.equal(remainingTime({ ...base, pages: 0 }), null);
  assert.equal(remainingTime({ ...base, page: 0 }), null);
  assert.equal(remainingTime({ ...base, page: 2.5 }), null);
});

test('durations are friendly: minutes, then hours rounded to five minutes', () => {
  assert.equal(formatDuration(0), '1 min');
  assert.equal(formatDuration(20), '1 min');
  assert.equal(formatDuration(12 * 60 + 10), '12 min');
  assert.equal(formatDuration(59 * 60), '59 min');
  assert.equal(formatDuration(59.6 * 60), '1 h');
  assert.equal(formatDuration(62 * 60), '1 h');
  assert.equal(formatDuration(3 * 3600 + 8 * 60), '3 h 10 min');
  assert.equal(formatDuration(2 * 3600 + 58 * 60), '3 h');
  assert.equal(formatDuration(12 * 3600 + 20 * 60), '12 h');
  assert.equal(formatDuration(-5), '');
  assert.equal(formatDuration(Number.NaN), '');
});
