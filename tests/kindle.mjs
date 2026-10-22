import { connectTestApp } from './support/native-app.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const { browser, page, api } = await connectTestApp();
assert.ok(page);
const initial = await api('library_list');
assert.ok(initial.folder.endsWith('development'), 'Use only the isolated test library');
const savedPrefs = await page.evaluate(() => localStorage.getItem('lume.preferences'));
const results = [],
  errors = [],
  external = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('request', (r) => {
  if (/^https?:/.test(r.url()) && !/^https?:\/\/(tauri|asset|ipc)\.localhost/.test(r.url()))
    external.push(r.url());
});
await mkdir('test-results/kindle', { recursive: true });
const click = (s) => page.locator(s).click();
const settle = () => page.waitForTimeout(180);
const metrics = () =>
  page.locator('#viewer-container').evaluate((c) => ({
    top: c.scrollTop,
    left: c.scrollLeft,
    height: c.clientHeight,
    width: c.clientWidth,
    max: c.scrollHeight - c.clientHeight,
    scrollWidth: c.scrollWidth,
    mode: c.dataset.readingMode,
  }));
const test = async (name, run) => {
  try {
    const detail = await run();
    results.push({ name, ok: true, detail });
    console.log('PASS', name, detail ?? '');
  } catch (e) {
    results.push({ name, ok: false, error: String(e) });
    throw e;
  }
};
const fixture = async (name) => {
  const file = path.resolve('tests/fixtures', name),
    hash = createHash('sha256')
      .update(await readFile(file))
      .digest('hex');
  await api('import_pdfs', { paths: [file] });
  return (await api('library_list')).books.find((b) => b.hash === hash);
};
const open = async (book) => {
  await page.reload();
  await page.waitForSelector(`[data-open="${book.id}"]`);
  await click(`[data-open="${book.id}"]`);
  await page.waitForFunction(
    () =>
      document.querySelector('#reader-loading').hidden &&
      document.querySelector('.page canvas')?.width > 0,
  );
  await settle();
};
const jump = async (n) => {
  await page.locator('#page-number').fill(String(n));
  await page.locator('#page-number').press('Enter');
  await page.locator('#page-number').blur();
  await settle();
};
const key = async (k) => {
  await page.locator('#viewer-container').focus();
  await page.keyboard.press(k);
  await settle();
};
const close = async () => {
  await click('#back');
  await page.waitForFunction(
    () =>
      document.querySelector('#reader').hidden && document.activeElement?.id === 'library-search',
  );
};
const getStored = async (id) => (await api('library_list')).books.find((b) => b.id === id);
let book;
try {
  book = await fixture('Caderno de leitura.pdf');
  await api('update_book', {
    id: book.id,
    patch: { page: 1, top: null, left: null, zoom: '1.5', rotation: 0 },
  });
  await test('Old preferences default to scrolling; Kindle is available in preferences', async () => {
    await page.evaluate(() =>
      localStorage.setItem(
        'lume.preferences',
        JSON.stringify({
          theme: 'light',
          paper: 'light',
          warm: 0,
          brightness: 100,
          resume: true,
          view: 'grid',
          sort: 'recent',
        }),
      ),
    );
    await page.reload();
    await page.waitForSelector('#settings');
    await click('#settings');
    assert.equal(await page.locator('#pref-reading-mode').inputValue(), 'scroll');
    await click('#close-settings');
  });
  await open(book);
  await test('Switching modes preserves PDF coordinates and removes only the inter-page gaps', async () => {
    await jump(5);
    await page.locator('#viewer-container').evaluate((c) => (c.scrollTop += 237));
    await page.waitForTimeout(650);
    const before = await getStored(book.id);
    await click('#kindle-toggle');
    await page.waitForTimeout(650);
    const after = await getStored(book.id);
    assert.equal(after.page, before.page);
    assert.ok(Math.abs(after.top - before.top) < 2, JSON.stringify({ before, after }));
    assert.equal(await page.locator('#kindle-toggle').getAttribute('aria-pressed'), 'true');
    const gap = await page.evaluate(() => {
      const a = document.querySelector('[data-page-number="5"]').getBoundingClientRect(),
        b = document.querySelector('[data-page-number="6"]').getBoundingClientRect();
      return b.top - a.bottom;
    });
    assert.ok(Math.abs(gap) < 1, String(gap));
    return { page: after.page, anchorDelta: Math.abs(after.top - before.top), gap };
  });
  await test('Forward/back moves a viewport with overlap, spans PDF pages, and never skips vertical content', async () => {
    await click('#restart');
    await settle();
    assert.equal((await metrics()).top, 0);
    const steps = [];
    let crossed = false;
    for (let i = 0; i < 7; i++) {
      const before = await metrics();
      await click('#next');
      await settle();
      const after = await metrics();
      const delta = after.top - before.top;
      assert.ok(
        delta > before.height * 0.75 && delta < before.height,
        JSON.stringify({ before, after }),
      );
      steps.push(delta);
      crossed ||= await page.locator('#viewer-container').evaluate((c) => {
        const r = c.getBoundingClientRect();
        return (
          [...c.querySelectorAll('.page')].filter((p) => {
            const b = p.getBoundingClientRect();
            return b.bottom > r.top && b.top < r.top + c.clientHeight;
          }).length > 1
        );
      });
    }
    assert.ok(crossed, 'At least one screen must contain the end of a page and start of the next');
    const before = await metrics();
    await click('#previous');
    await click('#next');
    assert.ok(Math.abs((await metrics()).top - before.top) < 1);
    await page.screenshot({ path: 'test-results/kindle/reader.png' });
    return { steps, crossed };
  });
  await test('Keyboard turns are discrete and do not hijack text fields or button Space', async () => {
    const start = (await metrics()).top;
    for (const k of ['ArrowRight', 'PageDown', 'Space']) await key(k);
    for (const k of ['Shift+Space', 'PageUp', 'ArrowLeft']) await key(k);
    assert.ok(Math.abs((await metrics()).top - start) < 2);
    await page.locator('#page-number').focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal((await metrics()).top, start);
    await page.locator('#next').focus();
    await page.keyboard.press('Space');
    await settle();
    const after = (await metrics()).top;
    assert.ok(after > start);
    await key('ArrowLeft');
    assert.ok(Math.abs((await metrics()).top - start) < 2);
  });
  await test('Wheel inertia turns once per gesture; reversing direction turns back', async () => {
    await page.waitForTimeout(220);
    const before = await metrics();
    await page.locator('#viewer-container').evaluate((c) => {
      for (let i = 0; i < 12; i++)
        c.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    });
    await settle();
    const after = await metrics();
    assert.ok(after.top - before.top > 0 && after.top - before.top < before.height);
    await page
      .locator('#viewer-container')
      .evaluate((c) =>
        c.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })),
      );
    await settle();
    assert.ok(Math.abs((await metrics()).top - before.top) < 2);
  });
  await test('Zoom, horizontal panning, focus, fullscreen and resize keep screen turns bounded', async () => {
    await page.locator('#zoom').selectOption('3');
    await settle();
    let a = await metrics();
    assert.ok(a.scrollWidth > a.width, 'High zoom should retain horizontal access');
    await page
      .locator('#viewer-container')
      .evaluate((c) =>
        c.dispatchEvent(
          new WheelEvent('wheel', { deltaY: 200, shiftKey: true, bubbles: true, cancelable: true }),
        ),
      );
    assert.ok((await metrics()).left > a.left);
    await key('ArrowRight');
    let b = await metrics();
    assert.ok(b.top - a.top > 0 && b.top - a.top < a.height);
    await page.locator('#zoom').selectOption('1');
    await click('#focus');
    await settle();
    a = await metrics();
    await key('PageDown');
    b = await metrics();
    assert.ok(b.top - a.top > 0 && b.top - a.top < a.height);
    await click('#exit-focus');
    await api('plugin:window|set_fullscreen', { label: 'main', value: true });
    await settle();
    a = await metrics();
    await key('PageDown');
    b = await metrics();
    assert.ok(b.top - a.top > 0 && b.top - a.top < a.height);
    await api('plugin:window|set_fullscreen', { label: 'main', value: false });
    await page.setViewportSize({ width: 800, height: 600 });
    await settle();
    assert.equal(
      await page.evaluate(
        () =>
          document.querySelector('.reader-toolbar').scrollWidth > innerWidth ||
          document.querySelector('.reader-header').scrollWidth > innerWidth,
      ),
      false,
    );
    a = await metrics();
    await key('PageDown');
    b = await metrics();
    assert.ok(b.top - a.top > 0 && b.top - a.top < a.height);
    await page.screenshot({ path: 'test-results/kindle/reader-800.png' });
    await click('#reader-settings');
    await page.locator('#pref-reading-mode').scrollIntoViewIfNeeded();
    assert.equal(
      await page.locator('#dialog').evaluate((e) => e.scrollWidth > e.clientWidth),
      false,
    );
    await page.screenshot({ path: 'test-results/kindle/settings-800.png' });
    await click('#close-settings');
    await page.setViewportSize({ width: 1280, height: 820 });
    await settle();
  });
  await test('First/last screens, final partial step and page-fit do not lose content', async () => {
    await page.locator('#zoom').selectOption('page-fit');
    await settle();
    await key('End');
    let a = await metrics();
    assert.ok(Math.abs(a.top - a.max) < 1);
    assert.equal(await page.locator('#next').isDisabled(), true);
    await key('Home');
    assert.equal((await metrics()).top, 0);
    assert.equal(await page.locator('#previous').isDisabled(), true);
    await page
      .locator('#viewer-container')
      .evaluate((c) => (c.scrollTop = c.scrollHeight - c.clientHeight - 143));
    await settle();
    a = await metrics();
    await key('PageDown');
    assert.ok(Math.abs((await metrics()).top - a.max) < 1);
    await key('PageDown');
    await key('PageUp');
    assert.ok(Math.abs((await metrics()).top - a.top) < 1);
  });
  await test('Search and PDF page jumps remain usable; brightness/warmth stay fixed over the viewport', async () => {
    await click('#find-toggle');
    await page.locator('#find-input').fill('biblioteca');
    await page.waitForFunction(() =>
      /de [1-9]/.test(document.querySelector('#find-count').textContent),
    );
    await click('#find-next');
    await click('#find-close');
    await jump(7);
    assert.equal(await page.locator('#page-number').inputValue(), '7');
    const a = await metrics();
    await key('PageDown');
    assert.ok((await metrics()).top > a.top);
    await click('#reader-settings');
    await page.locator('#brightness-range').fill('45');
    await page.locator('#brightness-range').dispatchEvent('input');
    await page.locator('#warm-range').fill('25');
    await page.locator('#warm-range').dispatchEvent('input');
    await click('#close-settings');
    assert.equal(
      await page.locator('#brightness-overlay').evaluate((e) => getComputedStyle(e).opacity),
      '0.55',
    );
    const before = await page.locator('#brightness-overlay').boundingBox();
    await key('PageDown');
    assert.deepEqual(await page.locator('#brightness-overlay').boundingBox(), before);
  });
  await test('Kindle preference and exact mid-page position survive reopening and reload', async () => {
    await page.locator('#zoom').selectOption('1.25');
    await jump(4);
    await key('PageDown');
    await settle();
    const before = await metrics();
    await close();
    await open(book);
    const after = await metrics();
    assert.equal(after.mode, 'kindle');
    assert.ok(Math.abs(after.top - before.top) < 3, JSON.stringify({ before, after }));
    await page.screenshot({ path: 'test-results/kindle/resumed-dimmed.png' });
    return { delta: Math.abs(after.top - before.top) };
  });
  await test('Returning to scrolling preserves the anchor and restores continuous wheel scrolling', async () => {
    await page.waitForTimeout(600);
    const before = await getStored(book.id);
    await click('#kindle-toggle');
    await page.waitForTimeout(600);
    const after = await getStored(book.id);
    assert.equal(after.page, before.page);
    assert.ok(Math.abs(after.top - before.top) < 2);
    const a = await metrics();
    await page.locator('#viewer-container').hover();
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(300);
    const b = await metrics();
    assert.ok(b.top - a.top > 0 && b.top - a.top < a.height * 0.5);
    await click('#kindle-toggle');
    await close();
  });
  await test('300-page PDF remains lazy-rendered; scanned PDF also turns by screens', async () => {
    const long = await fixture('Livro extenso - 300 paginas.pdf');
    await open(long);
    await page.locator('#zoom').selectOption('1');
    await jump(285);
    await key('PageDown');
    await page.waitForTimeout(700);
    const canvases = await page
      .locator('.pdfViewer canvas')
      .evaluateAll((cs) => cs.filter((c) => c.width > 0).length);
    assert.ok(canvases <= 12, String(canvases));
    await close();
    const scan = await fixture('Digitalizado grande.pdf');
    await open(scan);
    await page.locator('#zoom').selectOption('1.5');
    await click('#restart');
    await settle();
    const a = await metrics();
    await key('PageDown');
    const b = await metrics();
    assert.ok(b.top > a.top && b.top - a.top < a.height);
    await close();
    return { activeCanvases: canvases };
  });
  await test('No JavaScript errors or external requests', async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
  });
} catch (e) {
  console.error(e);
  await page.screenshot({ path: 'test-results/kindle/failure.png' });
  process.exitCode = 1;
} finally {
  await api('plugin:window|set_fullscreen', { label: 'main', value: false });
  await writeFile(
    'test-results/kindle/results.json',
    JSON.stringify({ date: new Date().toISOString(), results, errors, external }, null, 2),
  );
  await page.evaluate(
    (p) =>
      p === null
        ? localStorage.removeItem('lume.preferences')
        : localStorage.setItem('lume.preferences', p),
    savedPrefs,
  );
  await browser.close();
}
