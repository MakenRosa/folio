import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THUMBNAIL,
  anchorPage,
  chooseEvictions,
  nearestPage,
  thumbnailPixels,
} from '../../src/reading/thumbnails.ts';

test('thumbnails are small, with a fixed ceiling of live canvases', () => {
  assert.ok(THUMBNAIL.width >= 120 && THUMBNAIL.width <= 140);
  assert.ok(THUMBNAIL.maxLive >= 8 && THUMBNAIL.maxLive <= 32);
});

test('the canvas has more pixels on dense screens, but never more than twice', () => {
  assert.equal(thumbnailPixels(130, 1), 130);
  assert.equal(thumbnailPixels(130, 1.5), 195);
  assert.equal(thumbnailPixels(130, 2), 260);
  assert.equal(thumbnailPixels(130, 3), 260);
  assert.equal(thumbnailPixels(130, 0.5), 130);
  assert.equal(thumbnailPixels(130, Number.NaN), 130);
  assert.equal(thumbnailPixels(0, 2), 1);
});

test('the oldest canvases go first and the ones in or near the view are never released', () => {
  const live = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(chooseEvictions(live, new Set(), 6), [], 'At the ceiling nothing goes');
  assert.deepEqual(chooseEvictions(live, new Set(), 4), [1, 2]);
  assert.deepEqual(chooseEvictions(live, new Set([1, 2]), 4), [3, 4], 'Those in view stay');
  assert.deepEqual(chooseEvictions(live, new Set(live), 2), [], 'All in view: none is released');
  assert.deepEqual(chooseEvictions(live, new Set([6]), 0), [1, 2, 3, 4, 5]);
  assert.deepEqual(chooseEvictions([], new Set(), 3), []);
  // Whatever the ceiling, what is left is within it, or is only what is in view.
  for (let max = 0; max < 8; max++) {
    const out = new Set(chooseEvictions(live, new Set([2, 5]), max));
    const left = live.filter((p) => !out.has(p));
    assert.ok(left.length <= Math.max(max, 2), `${max}: ${left}`);
    assert.ok(left.includes(2) && left.includes(5));
  }
});

test('the next thumbnail is the one closest to the middle of the view', () => {
  assert.equal(nearestPage(new Set([3, 9, 5]), 6), 5);
  assert.equal(nearestPage(new Set([3, 9]), 6), 3, 'A tie goes to the lower page');
  assert.equal(nearestPage([], 6), null);
  assert.equal(nearestPage(new Set([7]), 1), 7);
  assert.equal(anchorPage(new Set([8, 6, 7])), 7);
  assert.equal(anchorPage(new Set([4, 5, 6, 7])), 6);
  assert.equal(anchorPage(new Set()), 1);
});
