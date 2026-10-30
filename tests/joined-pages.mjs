import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connectTestApp } from './support/native-app.mjs';

const { browser, page, api } = await connectTestApp();
const saved = await page.evaluate(() => localStorage.getItem('lume.preferences'));
const results = [];
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.text().includes('Page margin analysis')) console.log(message.text());
});
const fixture = path.resolve('tests/fixtures/Paginas com margens.pdf');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const originalHash = hash(await readFile(fixture));
const click = (selector) => page.locator(selector).click();
const jump = async (number) => {
  await page.locator('#page-number').fill(String(number));
  await page.locator('#page-number').press('Enter');
  await page.locator('#page-number').blur();
};
const ready = async (number, trimmed = true) => {
  await page.waitForFunction(
    ({ number, trimmed }) => {
      const el = document.querySelector(`[data-page-number="${number}"]`);
      return el?.querySelector('canvas')?.width > 0 && (!trimmed || el.dataset.margins === 'ready');
    },
    { number, trimmed },
  );
  await page.waitForTimeout(250);
};
const height = (number) =>
  page
    .locator(`[data-page-number="${number}"]`)
    .evaluate((el) => el.getBoundingClientRect().height);
const test = async (name, run) => {
  const detail = await run();
  results.push({ name, ok: true, detail });
  console.log('PASS', name, detail ?? '');
};
let book;
await mkdir('test-results/joined-pages', { recursive: true });
try {
  await api('import_pdfs', { paths: [fixture] });
  book = (await api('library_list')).books.find((b) => b.hash === originalHash);
  assert.ok(book);
  await page.evaluate(() =>
    localStorage.setItem(
      'lume.preferences',
      JSON.stringify({
        theme: 'light',
        paper: 'light',
        readingMode: 'kindle',
        joinPages: false,
        brightness: 100,
        warm: 0,
        resume: true,
      }),
    ),
  );
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.reload();
  await click(`[data-open="${book.id}"]`);
  await page.waitForFunction(() => document.querySelector('#reader-loading').hidden);
  await page.locator('#zoom').selectOption('1');
  await jump(2);
  await ready(2, false);
  await jump(1);
  await ready(1, false);
  const fullHeight = await height(1);
  await page.screenshot({ path: 'test-results/joined-pages/before.png' });
  await test('Joining removes internal blank margins and keeps every text line', async () => {
    await click('#reader-settings');
    await page.locator('#pref-join-pages').check();
    await click('#close-settings');
    await ready(1);
    await ready(2);
    assert.ok((await height(1)) < fullHeight * 0.8);
    const geometry = await page.evaluate(() => {
      const one = [...document.querySelectorAll('[data-page-number="1"] .textLayer span')].filter(
        (s) => s.textContent.trim(),
      );
      const two = [...document.querySelectorAll('[data-page-number="2"] .textLayer span')].filter(
        (s) => s.textContent.trim(),
      );
      return {
        lines: [one.length, two.length],
        gap: two[0].getBoundingClientRect().top - one.at(-1).getBoundingClientRect().bottom,
      };
    });
    assert.deepEqual(geometry.lines, [15, 15]);
    assert.ok(geometry.gap >= 0 && geometry.gap < 60, JSON.stringify(geometry));
    await click('#next');
    await page.screenshot({ path: 'test-results/joined-pages/after.png' });
    return { fullHeight, joinedHeight: await height(1), ...geometry };
  });
  await test('Search, footer, artwork, blank pages and faint text survive the crop', async () => {
    await click('#find-toggle');
    await page.locator('#find-input').fill('RODAPE');
    await page.waitForFunction(
      () => document.querySelector('#find-count').textContent === '1 de 1',
    );
    await click('#find-close');
    await ready(3);
    for (const number of [3, 4, 5, 6]) {
      await jump(number);
      await ready(number);
      const outside = await page.locator(`[data-page-number="${number}"]`).evaluate((el) => {
        const box = el.getBoundingClientRect();
        return [...el.querySelectorAll('.textLayer span')]
          .filter((s) => s.textContent.trim())
          .some((s) => {
            const r = s.getBoundingClientRect();
            return r.top < box.top - 1 || r.bottom > box.bottom + 1;
          });
      });
      assert.equal(outside, false, `Text clipped on page ${number}`);
      if (number === 4)
        assert.ok(
          (await page.locator('[data-page-number="4"] canvas').evaluate((c) => {
            const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            let blue = 0;
            for (let i = 0; i < pixels.length; i += 16)
              if (pixels[i + 2] > pixels[i] + 50 && pixels[i + 1] > pixels[i] + 20) blue++;
            return blue;
          })) > 100,
        );
      if (number === 5) assert.ok(Math.abs((await height(5)) - fullHeight) < 1);
    }
  });
  await test('Zoom, rotation, original margins and continuous scrolling remain reversible', async () => {
    await jump(2);
    await ready(2);
    const joinedHeight = await height(2);
    await page.locator('#zoom').selectOption('1.5');
    await ready(2);
    assert.ok(Math.abs((await height(2)) / joinedHeight - 1.5) < 0.01);
    await page.locator('#viewer-container').focus();
    await page.keyboard.press('r');
    await page.waitForTimeout(250);
    await page.keyboard.press('r');
    await page.keyboard.press('r');
    await page.keyboard.press('r');
    await page.locator('#zoom').selectOption('1');
    await ready(2);
    await click('#reader-settings');
    await page.locator('#pref-join-pages').uncheck();
    await click('#close-settings');
    await ready(2, false);
    assert.ok(Math.abs((await height(2)) - fullHeight) < 1);
    await click('#reader-settings');
    await page.locator('#pref-join-pages').check();
    await click('#close-settings');
    await ready(2);
    await click('#kindle-toggle');
    await ready(2, false);
    assert.ok(Math.abs((await height(2)) - fullHeight) < 1);
    await click('#kindle-toggle');
    await ready(2);
    assert.ok(Math.abs((await height(2)) - joinedHeight) < 1);
  });
  await test('Joined layout and exact position survive reopening without modifying the PDF', async () => {
    await jump(2);
    await ready(2);
    await page.locator('#viewer-container').evaluate((el) => {
      el.scrollTop += 90;
    });
    await page.waitForTimeout(700);
    const before = await page.locator('#viewer-container').evaluate((el) => el.scrollTop);
    await click('#back');
    await page.waitForFunction(() => document.activeElement?.id === 'library-search');
    await page.reload();
    await click(`[data-open="${book.id}"]`);
    await ready(2);
    const after = await page.locator('#viewer-container').evaluate((el) => el.scrollTop);
    assert.ok(Math.abs(before - after) < 3, JSON.stringify({ before, after }));
    const file = await api('pdf_path', { id: book.id });
    assert.equal(hash(await readFile(file)), originalHash);
    assert.deepEqual(errors, []);
    return { positionDelta: Math.abs(before - after), unchangedPdf: true };
  });
} catch (error) {
  console.error(error);
  console.log(
    'Margin diagnostic',
    await page.evaluate(() => ({
      cache: Object.keys(localStorage)
        .filter((key) => key.startsWith('folio.page-margins.'))
        .map((key) => JSON.parse(localStorage.getItem(key))),
      pages: [...document.querySelectorAll('.pdfViewer .page')].map((el) => ({
        page: el.dataset.pageNumber,
        height: el.getBoundingClientRect().height,
        margins: el.dataset.margins,
      })),
    })),
  );
  await page.screenshot({ path: 'test-results/joined-pages/failure.png' });
  process.exitCode = 1;
} finally {
  if (await page.locator('#back').isVisible()) await click('#back');
  await page.waitForFunction(() => document.activeElement?.id === 'library-search');
  await page.evaluate(
    (value) =>
      value === null
        ? localStorage.removeItem('lume.preferences')
        : localStorage.setItem('lume.preferences', value),
    saved,
  );
  await writeFile(
    'test-results/joined-pages/results.json',
    JSON.stringify({ passed: !process.exitCode, results, errors }, null, 2),
  );
  await browser.close();
}
