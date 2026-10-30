import { connectTestApp } from './support/native-app.mjs';
import assert from 'node:assert/strict';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const { browser, page, api } = await connectTestApp();
assert.ok(page, 'Native app must be running with CDP enabled');
await mkdir('test-results/brightness', { recursive: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const savedPrefs = await page.evaluate(() => localStorage.getItem('lume.preferences'));
const results = [];
const test = async (name, run) => {
  await run();
  results.push(name);
  console.log('PASS', name);
};
const click = (selector) => page.locator(selector).click();
const setRange = async (selector, value) => {
  await page.locator(selector).fill(String(value));
  await page.locator(selector).dispatchEvent('input');
};
const opacity = () =>
  page.locator('#brightness-overlay').evaluate((e) => getComputedStyle(e).opacity);
let book;
const openBook = async () => {
  await click(`[data-open="${book.id}"]`);
  await page.waitForFunction(
    () =>
      document.querySelector('#reader-loading').hidden &&
      document.querySelector('.page canvas')?.width > 0,
  );
};
try {
  if (await api('plugin:window|is_fullscreen', { label: 'main' }))
    await api('plugin:window|set_fullscreen', { label: 'main', value: false });
  const initial = await api('library_list');
  assert.ok(initial.folder.endsWith('development'), 'Never test against the user library');
  const imported = await api('import_pdfs', {
    paths: [path.resolve('tests/fixtures/Caderno de leitura.pdf')],
  });
  const fixtureHash = createHash('sha256')
    .update(await readFile('tests/fixtures/Caderno de leitura.pdf'))
    .digest('hex');
  book = imported.added[0] || (await api('library_list')).books.find((b) => b.hash === fixtureHash);
  assert.ok(book);
  await test('Existing preferences migrate to 100% without changing paper or warmth', async () => {
    await page.evaluate(() =>
      localStorage.setItem(
        'lume.preferences',
        JSON.stringify({
          theme: 'light',
          paper: 'light',
          warm: 0,
          resume: true,
          view: 'grid',
          sort: 'recent',
        }),
      ),
    );
    await page.reload();
    await page.waitForSelector('#library-title');
    assert.equal(await opacity(), '0');
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem('lume.preferences')).brightness),
      100,
    );
  });
  await openBook();
  await click('#restart');
  await page.waitForFunction(() => document.querySelector('#page-number').value === '1');
  await page.locator('#zoom').selectOption('page-fit');
  await page.waitForTimeout(400);
  await page.locator('#viewer-wrap').screenshot({ path: 'test-results/brightness/paper-100.png' });
  await page.evaluate(() => (window.testBrightnessCanvas = document.querySelector('.page canvas')));
  await test('50% dims immediately without replacing canvas or disabling text interaction', async () => {
    await click('#reader-settings');
    await setRange('#brightness-range', 50);
    assert.equal(await page.locator('#brightness-value').textContent(), '50%');
    assert.equal(await opacity(), '0.5');
    await click('#close-settings');
    assert.equal(
      await page.evaluate(
        () => window.testBrightnessCanvas === document.querySelector('.page canvas'),
      ),
      true,
    );
    assert.equal(
      await page.locator('#brightness-overlay').evaluate((e) => getComputedStyle(e).pointerEvents),
      'none',
    );
    const hit = await page
      .locator('.textLayer span')
      .first()
      .evaluate((e) => {
        const r = e.getBoundingClientRect();
        return (
          document
            .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
            ?.closest('.textLayer') !== null
        );
      });
    assert.equal(hit, true);
    await page.locator('#viewer-wrap').screenshot({ path: 'test-results/brightness/paper-50.png' });
  });
  await test('Keyboard adjustment, minimum, reset, and combined warm/sepia/dark modes', async () => {
    await click('#reader-settings');
    await page.locator('#brightness-range').focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#brightness-range').inputValue(), '45');
    await setRange('#brightness-range', 10);
    assert.equal(await opacity(), '0.9');
    await click('#brightness-reset');
    assert.equal(await opacity(), '0');
    await setRange('#brightness-range', 40);
    await setRange('#warm-range', 30);
    for (const paper of ['sepia', 'dark', 'light']) {
      await click(`[data-paper="${paper}"]`);
      assert.equal(await opacity(), '0.6');
      assert.equal(await page.locator('#warm-overlay').evaluate((e) => e.style.opacity), '0.3');
    }
    await page.screenshot({ path: 'test-results/brightness/settings.png' });
    await click('#close-settings');
  });
  await test('Search and fullscreen still work when the PDF is dimmed', async () => {
    await click('#find-toggle');
    await page.locator('#find-input').fill('biblioteca');
    await page.waitForFunction(() =>
      /de [1-9]/.test(document.querySelector('#find-count').textContent),
    );
    await click('#find-close');
    assert.equal(await opacity(), '0.6');
    assert.equal(await page.locator('#brightness-overlay').isVisible(), true);
    await click('#fullscreen');
    await page.waitForFunction(() =>
      window.__TAURI_INTERNALS__.invoke('plugin:window|is_fullscreen', { label: 'main' }),
    );
    assert.equal(await opacity(), '0.6');
    await page.keyboard.press('F11');
    await page.waitForFunction(
      async () =>
        !(await window.__TAURI_INTERNALS__.invoke('plugin:window|is_fullscreen', {
          label: 'main',
        })),
    );
  });
  await test('Brightness persists after reload and remains confined to reading', async () => {
    await click('#back');
    await page.waitForFunction(() => document.querySelector('#reader').hidden);
    assert.equal(await page.locator('#brightness-overlay').isVisible(), false);
    await page.reload();
    await page.waitForSelector('#library-title');
    await click('#settings');
    assert.equal(await page.locator('#brightness-range').inputValue(), '40');
    await click('#close-settings');
    await openBook();
    assert.equal(await opacity(), '0.6');
    await click('#back');
    await page.waitForFunction(() => document.querySelector('#reader').hidden);
  });
  await test('Stored values are bounded and 800px preferences remain usable', async () => {
    await page.waitForFunction(() => document.activeElement?.id === 'library-search');
    for (const [value, expected] of [
      [-100, 10],
      [999, 100],
      ['invalid', 100],
      [null, 100],
    ]) {
      await page.evaluate((value) => {
        const p = JSON.parse(localStorage.getItem('lume.preferences'));
        p.brightness = value;
        localStorage.setItem('lume.preferences', JSON.stringify(p));
      }, value);
      await page.reload();
      await page.waitForSelector('#library-title');
      assert.equal(
        await page.evaluate(() => JSON.parse(localStorage.getItem('lume.preferences')).brightness),
        expected,
      );
    }
    await page.setViewportSize({ width: 800, height: 600 });
    await click('#settings');
    await page.locator('#brightness-range').scrollIntoViewIfNeeded();
    await setRange('#brightness-range', 50);
    assert.equal(
      await page.locator('#dialog').evaluate((e) => e.scrollWidth > e.clientWidth),
      false,
    );
    await page.screenshot({ path: 'test-results/brightness/settings-800.png' });
    await click('#close-settings');
    await page.setViewportSize({ width: 1280, height: 820 });
    assert.deepEqual(errors, []);
  });
} catch (e) {
  console.error(e);
  await page.screenshot({ path: 'test-results/brightness/failure.png' });
  process.exitCode = 1;
} finally {
  if (await api('plugin:window|is_fullscreen', { label: 'main' }))
    await api('plugin:window|set_fullscreen', { label: 'main', value: false });
  await writeFile(
    'test-results/brightness/results.json',
    JSON.stringify({ passed: !process.exitCode, results, errors }, null, 2),
  );
  await page.evaluate(
    (saved) =>
      saved === null
        ? localStorage.removeItem('lume.preferences')
        : localStorage.setItem('lume.preferences', saved),
    savedPrefs,
  );
  await browser.close();
}
