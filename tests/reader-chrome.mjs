import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { headlessApp } from './support/headless-app.mjs';

const app = await headlessApp();
const results = [];
let page;
await mkdir('test-results/reader-chrome', { recursive: true });
const settle = (ms = 250) => page.waitForTimeout(ms);
const click = (selector) => page.locator(selector).click();
const range = (selector, value) =>
  page.locator(selector).evaluate((el, value) => {
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
const openBook = async () => {
  await click('[data-open="artificial-chapters"]');
  await page.waitForFunction(
    () =>
      document.querySelector('#reader-loading').hidden &&
      document.querySelector('.page canvas')?.width > 0,
  );
  await settle(500);
};
const geometry = () =>
  page.evaluate(() => {
    const rect = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height, width: r.width };
    };
    return {
      top: rect('.reader-top'),
      bottom: rect('.reader-footer'),
      pdf: rect('#viewer-container'),
      scroll: document.querySelector('#viewer-container').scrollTop,
      full: document.body.classList.contains('reader-fullscreen'),
      width: innerWidth,
      height: innerHeight,
    };
  });
const test = async (name, fn) => {
  const detail = await fn();
  results.push({ name, ok: true, detail });
  console.log('PASS', name, detail || '');
};
try {
  page = await app.open();
  await openBook();
  await test('Quick controls adjust real PDF appearance and synchronize with preferences', async () => {
    assert.equal(await page.locator('#focus, #exit-focus').count(), 0);
    await click('#reading-brightness');
    await range('#quick-range', 55);
    await page.locator('#quick-range').press('ArrowLeft');
    assert.equal(await page.locator('#reading-brightness-value').textContent(), '50%');
    assert.equal(
      await page.locator('#brightness-overlay').evaluate((el) => el.style.opacity),
      '0.5',
    );
    await page.keyboard.press('Escape');
    await click('#reading-warm');
    await range('#quick-range', 70);
    await page.keyboard.press('Escape');
    await click('#reader-settings');
    assert.equal(await page.locator('#warm-range').inputValue(), '70');
    await click('#close-settings');
    await click('#reading-warm');
    await click('#quick-reset');
    assert.equal(await page.locator('#reading-warm-value').textContent(), '0%');
    await range('#quick-range', 35);
    assert.equal(await page.locator('#warm-overlay').evaluate((el) => el.style.opacity), '0.35');
    await page.keyboard.press('Escape');
    await click('#reader-settings');
    assert.equal(await page.locator('#brightness-range').inputValue(), '50');
    assert.equal(await page.locator('#warm-range').inputValue(), '35');
    await page.locator('#pref-theme').selectOption('dark');
    await page.locator('#pref-reading-mode').selectOption('kindle');
    await click('#close-settings');
    await page.screenshot({ path: 'test-results/reader-chrome/toolbar.png' });
  });
  await test('Fullscreen hides both bars; edge hover reveals each without moving the PDF', async () => {
    await click('#fullscreen');
    await page.mouse.move(640, 410);
    await settle(850);
    const hidden = await geometry();
    assert.equal(hidden.full, true);
    assert.ok(hidden.top.bottom <= 1);
    assert.ok(hidden.bottom.top >= hidden.height - 1);
    assert.equal(hidden.pdf.top, 0);
    assert.equal(hidden.pdf.height, hidden.height);
    assert.equal(await page.locator('#fullscreen').getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: 'test-results/reader-chrome/fullscreen-hidden.png' });
    await page.mouse.move(640, 1);
    await settle();
    const shown = await geometry();
    assert.equal(shown.top.top, 0);
    assert.deepEqual(shown.pdf, hidden.pdf);
    assert.equal(shown.scroll, hidden.scroll);
    assert.ok(shown.bottom.top >= shown.height - 1);
    await click('#reading-brightness');
    await range('#quick-range', 45);
    await page.mouse.move(640, 410);
    await settle(850);
    assert.equal((await geometry()).top.top, 0, 'Keep the bar while a quick control is open');
    await page.screenshot({ path: 'test-results/reader-chrome/fullscreen-controls.png' });
    await page.keyboard.press('Escape');
    assert.equal((await geometry()).full, true, 'First Escape closes the control');
    await page.mouse.click(700, 410);
    await settle(850);
    assert.ok((await geometry()).top.bottom <= 1);
    await page.mouse.move(640, 819);
    await settle();
    assert.ok((await geometry()).bottom.top < 819);
    assert.ok((await geometry()).top.bottom <= 1);
    await page.mouse.move(640, 410);
    await settle(850);
    assert.ok((await geometry()).bottom.top >= 819);
  });
  await test('Keyboard and search keep controls accessible; Escape and F11 restore the bars', async () => {
    await page.locator('#viewer-container').focus();
    await page.keyboard.press('Shift+Tab');
    await settle();
    assert.equal((await geometry()).top.top, 0);
    await settle(850);
    assert.equal((await geometry()).top.top, 0);
    await page.keyboard.press('Control+f');
    await settle();
    await page.locator('#find-input').fill('preservado');
    await page.waitForFunction(() =>
      /de [1-9]/.test(document.querySelector('#find-count').textContent),
    );
    await page.mouse.move(600, 410);
    await settle(850);
    assert.equal((await geometry()).top.top, 0);
    await page.keyboard.press('Escape');
    assert.equal((await geometry()).full, true);
    await page.keyboard.press('Escape');
    await settle();
    assert.equal((await geometry()).full, false);
    assert.equal((await geometry()).top.top, 0);
    assert.ok((await geometry()).pdf.top > 0);
    assert.ok((await geometry()).bottom.top < 820);
    await page.keyboard.press('F11');
    await settle();
    assert.equal((await geometry()).full, true);
    await page.keyboard.press('F11');
    await settle();
    assert.equal((await geometry()).full, false);
    await page.keyboard.press('F8');
    assert.equal((await geometry()).full, false);
    for (const value of [true, false]) {
      await page.evaluate(
        (value) =>
          window.__TAURI_INTERNALS__.invoke('plugin:window|set_fullscreen', {
            label: 'main',
            value,
          }),
        value,
      );
      await settle();
      assert.equal((await geometry()).full, value, 'Follow native resize notifications');
    }
  });
  await test('All toolbar actions remain reachable at 800px; reduced motion is respected', async () => {
    await page.setViewportSize({ width: 800, height: 600 });
    await settle();
    assert.equal(
      await page.evaluate(() =>
        ['.reader-header', '.reader-toolbar'].some(
          (s) => document.querySelector(s).scrollWidth > innerWidth,
        ),
      ),
      false,
    );
    assert.ok(await page.locator('#fullscreen').isVisible());
    for (const selector of ['#reading-brightness', '#reading-warm']) {
      await click(selector);
      assert.ok(await page.locator('#quick-range').isVisible());
      const r = await page.locator('#popover').boundingBox();
      assert.ok(r.x >= 0 && r.x + r.width <= 800);
      await page.keyboard.press('Escape');
    }
    await page.screenshot({ path: 'test-results/reader-chrome/toolbar-800.png' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.keyboard.press('F11');
    await settle();
    assert.equal(
      await page.locator('.reader-top').evaluate((el) => getComputedStyle(el).transitionDuration),
      '0s',
    );
    await page.keyboard.press('Escape');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1280, height: 820 });
  });
  await test('Dark theme, Kindle, comfort and library preferences survive a browser process restart', async () => {
    await page.locator('#page-number').fill('2');
    await page.locator('#page-number').press('Enter');
    await page.locator('#page-number').blur();
    await settle(900);
    await page.keyboard.press('F11');
    await settle();
    assert.equal((await geometry()).full, true);
    await page.keyboard.press('Control+w');
    await page.waitForSelector('#library-search:focus');
    assert.equal((await geometry()).full, false, 'Returning to the library exits fullscreen');
    await click('#view-list');
    await page.locator('#sort').selectOption('title');
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('lume.preferences')));
    assert.equal(before.theme, 'dark');
    assert.equal(before.readingMode, 'kindle');
    assert.equal(before.brightness, 45);
    assert.equal(before.warm, 35);
    await app.closeBrowser();
    page = await app.open();
    assert.deepEqual(
      await page.evaluate(() => JSON.parse(localStorage.getItem('lume.preferences'))),
      before,
    );
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.ok(await page.locator('.book-list').isVisible());
    await openBook();
    assert.equal(await page.locator('#kindle-toggle').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#reading-brightness-value').textContent(), '45%');
    assert.equal(await page.locator('#reading-warm-value').textContent(), '35%');
    assert.equal(await page.locator('#page-number').inputValue(), '2');
    assert.deepEqual(app.errors, []);
    assert.deepEqual(app.external, []);
    return { nativeWindowSimulated: true, browserRestart: true, personalDataUsed: false };
  });
} catch (error) {
  console.error(error);
  console.log('Browser errors:', app.errors);
  await page?.screenshot({ path: 'test-results/reader-chrome/failure.png' });
  process.exitCode = 1;
} finally {
  await writeFile(
    'test-results/reader-chrome/results.json',
    JSON.stringify(
      { passed: !process.exitCode, results, errors: app.errors, nativeWindowSimulated: true },
      null,
      2,
    ),
  );
  await app.close();
}
