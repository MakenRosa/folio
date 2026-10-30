import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PDFJS_SPREAD,
  SPREADS,
  screenPages,
  sharesScreen,
  spreadPages,
} from '../../src/reading/spread.ts';

// The grouping loop of PDF.js (_updateSpreadMode): the parity is the mode minus one.
// Page 1 starts the first group; then a new group starts at every index i where
// i % 2 === parity, so ODD (1) pairs 1-2, 3-4 and EVEN (2) leaves page 1 alone.
function groups(count, mode) {
  if (mode === 0) return Array.from({ length: count }, (_, i) => [i + 1]);
  const parity = mode - 1,
    out = [];
  for (let i = 0; i < count; i++) {
    if (!out.length || i % 2 === parity) out.push([]);
    out.at(-1).push(i + 1);
  }
  return out;
}

test('the layout names map to the PDF.js modes, and the cover stays alone only in EVEN', () => {
  assert.deepEqual(SPREADS, ['none', 'odd', 'even']);
  assert.deepEqual(PDFJS_SPREAD, { none: 0, odd: 1, even: 2 });
  assert.deepEqual(groups(6, PDFJS_SPREAD.odd), [
    [1, 2],
    [3, 4],
    [5, 6],
  ]);
  assert.deepEqual(groups(6, PDFJS_SPREAD.even), [[1], [2, 3], [4, 5], [6]]);
});

test('spreadPages agrees with how PDF.js groups the pages, with odd and even counts', () => {
  for (const pages of [1, 2, 5, 6, 9]) {
    for (const spread of SPREADS) {
      const expected = groups(pages, PDFJS_SPREAD[spread]);
      for (let page = 1; page <= pages; page++)
        assert.deepEqual(
          spreadPages(page, pages, spread),
          expected.find((g) => g.includes(page)),
          `${spread}: page ${page} of ${pages}`,
        );
    }
  }
});

test('spreadPages is safe with invalid or out-of-range input', () => {
  assert.deepEqual(spreadPages(3, 0, 'odd'), []);
  assert.deepEqual(spreadPages(Number.NaN, 6, 'odd'), []);
  assert.deepEqual(spreadPages(3, Infinity, 'odd'), []);
  assert.deepEqual(spreadPages(0, 6, 'odd'), [1, 2]);
  assert.deepEqual(spreadPages(99, 6, 'even'), [6]);
  assert.deepEqual(spreadPages(2.4, 6, 'odd'), [1, 2]);
});

test('a neighbor shares the screen only when most of it is in view', () => {
  const view = { left: 0, right: 1000, top: 0, bottom: 700 };
  const page = (left, top = 0, width = 400, height = 600) => ({
    left,
    right: left + width,
    top,
    bottom: top + height,
  });
  assert.equal(sharesScreen(page(500), view), true);
  assert.equal(sharesScreen(page(800), view), true, 'Exactly half of the width');
  assert.equal(sharesScreen(page(801), view), false, 'Less than half of the width');
  assert.equal(sharesScreen(page(500, 550), view), true, 'Exactly a quarter of the height');
  assert.equal(sharesScreen(page(500, 551), view), false, 'Only a sliver of the height');
  assert.equal(sharesScreen(page(500, 0, 400, 2400), view), true, 'A tall page at a high zoom');
  assert.equal(sharesScreen(page(500, 650, 400, 2400), view), false);
  assert.equal(sharesScreen(page(500, 0, 0, 0), view), false, 'A page not laid out yet');
});

test('the screen is the pair on view, with the same identity whichever page is current', () => {
  const both = () => true,
    none = () => false;
  for (const current of [3, 4])
    assert.deepEqual(screenPages(current, 6, 'odd', both), { first: 3, last: 4 });
  assert.deepEqual(screenPages(1, 6, 'even', both), { first: 1, last: 1 }, 'The cover is alone');
  assert.deepEqual(screenPages(2, 6, 'even', both), { first: 2, last: 3 });
  assert.deepEqual(screenPages(6, 6, 'even', both), { first: 6, last: 6 }, 'An odd last page');
  assert.deepEqual(screenPages(3, 6, 'odd', none), { first: 3, last: 3 }, 'The neighbor is off');
  assert.deepEqual(screenPages(4, 6, 'odd', none), { first: 4, last: 4 });
  assert.deepEqual(screenPages(4, 6, 'none', both), { first: 4, last: 4 }, 'One page per screen');
  assert.deepEqual(screenPages(4, 0, 'odd', both), { first: 4, last: 4 }, 'No document yet');
});
