import test from 'node:test';
import assert from 'node:assert/strict';
import { contentRows, validBox, containedBox } from '../../src/reading/page-margins.ts';

function paper(color = [255, 255, 255]) {
  const data = new Uint8ClampedArray(100 * 200 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...color, 255], i);
  const ink = (x, y, rgb = [0, 0, 0]) => data.set([...rgb, 255], (y * 100 + x) * 4);
  return { data, ink };
}
test('finds only outside blank margins on white or colored paper, including small marks', () => {
  for (const color of [
    [255, 255, 255],
    [249, 247, 240],
  ]) {
    const { data, ink } = paper(color);
    for (let y = 40; y < 150; y++) ink(50, y);
    ink(3, 180); // An image edge/footnote must remain part of the page.
    assert.deepEqual(contentRows(data, 100, 200), { first: 40, last: 181 });
  }
});
test('blank pages and uncertain borders retain the complete page', () => {
  const { data, ink } = paper();
  assert.equal(contentRows(data, 100, 200), null);
  ink(0, 0, [20, 80, 120]);
  assert.equal(contentRows(data, 100, 200), null);
  assert.equal(contentRows(data, 1, 1), null);
});
test('cached crop rectangles must be finite, ordered, and contained in the original page', () => {
  assert.equal(validBox([0, 10, 595, 810]), true);
  assert.equal(validBox([0, 10, Infinity, 810]), false);
  assert.equal(validBox([0, 10, 0, 810]), false);
  assert.equal(containedBox([0, 10, 595, 810], [0, 0, 595, 842]), true);
  assert.equal(containedBox([0, -1, 595, 810], [0, 0, 595, 842]), false);
});
