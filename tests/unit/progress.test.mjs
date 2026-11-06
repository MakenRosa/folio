import test from 'node:test';
import assert from 'node:assert/strict';
import { readingProgress } from '../../src/reading/progress.ts';

test('the first page is 0%, the last is 100% and the pages between never reach either', () => {
  assert.equal(readingProgress({ page: 1, pages: 6 }), 0);
  assert.equal(readingProgress({ page: 6, pages: 6 }), 100);
  assert.equal(readingProgress({ page: 4, pages: 6 }), 60);
  assert.equal(readingProgress({ page: 2, pages: 600 }), 1, 'Not yet read is not 0%');
  assert.equal(readingProgress({ page: 599, pages: 600 }), 99, 'Not finished is not 100%');
  let previous = -1;
  for (let page = 1; page <= 40; page++) {
    const value = readingProgress({ page, pages: 40 });
    assert.ok(value >= previous, 'Progress never goes backwards while reading forward');
    previous = value;
  }
});

test('a finished book is 100% wherever the reader was left', () => {
  assert.equal(readingProgress({ page: 1, pages: 6, finished: true }), 100);
  assert.equal(readingProgress({ page: 3, pages: 0, finished: true }), 100);
});

test('reaching the end of the document in the reader is 100%, but page 1 stays the start', () => {
  assert.equal(readingProgress({ page: 5, pages: 6, atEnd: true }), 100);
  assert.equal(readingProgress({ page: 5, pages: 6, atEnd: false }), 80);
  assert.equal(readingProgress({ page: 1, pages: 6, atEnd: true }), 0);
});

test('only page numbers matter, never the window, the zoom or the Kindle screens', () => {
  // The same saved position gives the same value however it is asked for.
  const saved = { page: 4, pages: 6, top: 120.5, left: 3, zoom: '1.5', rotation: 90 };
  assert.equal(readingProgress(saved), readingProgress({ page: 4, pages: 6 }));
  assert.equal(readingProgress({ ...saved, page: 4.4 }), 60, 'Fractional pages round to the page');
});

test('invalid or incomplete positions are 0% instead of NaN', () => {
  assert.equal(readingProgress({ page: 3, pages: 0 }), 0);
  assert.equal(readingProgress({ page: NaN, pages: 6 }), 0);
  assert.equal(readingProgress({ page: 3, pages: Infinity }), 0);
  assert.equal(readingProgress({ page: 99, pages: 6 }), 100, 'A page past the end is clamped');
  assert.equal(readingProgress({ page: -4, pages: 6 }), 0);
  assert.equal(readingProgress({ page: 1, pages: 1 }), 100, 'A one-page document is its own end');
});
