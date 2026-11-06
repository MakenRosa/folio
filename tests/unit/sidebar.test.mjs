import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SIDEBAR_TABS,
  SIDEBAR_WIDTH,
  clampSidebarWidth,
  sidebarMax,
  tabAfterKey,
  widthAfterKey,
} from '../../src/reading/sidebar.ts';

test('the width limits keep the PDF the main thing, even in the smallest window', () => {
  assert.deepEqual([SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max, SIDEBAR_WIDTH.fallback], [220, 480, 260]);
  assert.equal(sidebarMax(800), 320, '40% of the smallest window');
  assert.equal(sidebarMax(1000), 400);
  assert.equal(sidebarMax(1280), 480, 'The fixed limit applies in wide windows');
  assert.equal(sidebarMax(3840), 480);
  assert.equal(sidebarMax(500), 220, 'Never below the minimum');
  for (const width of [0, -5, Number.NaN, Infinity, undefined])
    assert.equal(sidebarMax(width), 480, `No usable window: ${width}`);
});

test('a width is rounded and kept between the minimum and what the window allows', () => {
  assert.equal(clampSidebarWidth(300), 300);
  assert.equal(clampSidebarWidth(300.6), 301);
  assert.equal(clampSidebarWidth(100), 220);
  assert.equal(clampSidebarWidth(9999), 480);
  assert.equal(clampSidebarWidth(480, 800), 320);
  assert.equal(clampSidebarWidth(260, 800), 260);
  assert.equal(clampSidebarWidth(Number.NaN), 260);
  assert.equal(clampSidebarWidth(Infinity), 260);
});

test('the arrows move the handle by 16 px, Shift by 48, and Home and End go to the ends', () => {
  assert.equal(widthAfterKey(260, 'ArrowRight', 1280), 276);
  assert.equal(widthAfterKey(260, 'ArrowLeft', 1280), 244);
  assert.equal(widthAfterKey(260, 'ArrowRight', 1280, true), 308);
  assert.equal(widthAfterKey(260, 'ArrowLeft', 1280, true), 220);
  assert.equal(widthAfterKey(470, 'ArrowRight', 1280), 480, 'Stops at the maximum');
  assert.equal(widthAfterKey(230, 'ArrowLeft', 1280), 220, 'Stops at the minimum');
  assert.equal(widthAfterKey(300, 'ArrowRight', 800), 316);
  assert.equal(widthAfterKey(316, 'ArrowRight', 800), 320, 'Stops at 40% of a small window');
  assert.equal(widthAfterKey(300, 'Home', 1280), 220);
  assert.equal(widthAfterKey(300, 'End', 1280), 480);
  assert.equal(widthAfterKey(300, 'End', 800), 320);
  for (const key of ['ArrowUp', 'ArrowDown', 'Enter', ' ', 'a', 'PageUp'])
    assert.equal(widthAfterKey(300, key, 1280), null, key);
});

test('the tabs follow their order and the arrows wrap around', () => {
  assert.deepEqual(SIDEBAR_TABS, ['outline', 'pages', 'bookmarks', 'notes']);
  assert.equal(tabAfterKey('outline', 'ArrowRight'), 'pages');
  assert.equal(tabAfterKey('notes', 'ArrowRight'), 'outline');
  assert.equal(tabAfterKey('outline', 'ArrowLeft'), 'notes');
  assert.equal(tabAfterKey('bookmarks', 'ArrowLeft'), 'pages');
  assert.equal(tabAfterKey('pages', 'Home'), 'outline');
  assert.equal(tabAfterKey('pages', 'End'), 'notes');
  assert.equal(tabAfterKey('pages', 'ArrowDown'), null);
  assert.equal(tabAfterKey('pages', 'Enter'), null);
});
