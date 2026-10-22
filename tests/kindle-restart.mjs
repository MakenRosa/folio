import { connectTestApp } from './support/native-app.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const { browser, page, api } = await connectTestApp();
const snapshot = await api('library_list');
assert.ok(snapshot.folder.endsWith('development'));
await page.setViewportSize({ width: 1280, height: 820 });
const open = async (id) => {
  await page.reload();
  await page.locator(`[data-open="${id}"]`).click();
  await page.waitForFunction(() => document.querySelector('#reader-loading').hidden);
  await page.waitForTimeout(300);
};
const position = () =>
  page
    .locator('#viewer-container')
    .evaluate((c) => ({ top: c.scrollTop, left: c.scrollLeft, mode: c.dataset.readingMode }));
if (process.argv[2] === 'prepare') {
  const prefs = await page.evaluate(() => localStorage.getItem('lume.preferences'));
  const book = snapshot.books.find((b) => b.title === 'Caderno de leitura');
  assert.ok(book);
  await open(book.id);
  if ((await page.locator('#kindle-toggle').getAttribute('aria-pressed')) !== 'true')
    await page.locator('#kindle-toggle').click();
  await page.locator('#zoom').selectOption('1.25');
  await page.locator('#page-number').fill('5');
  await page.locator('#page-number').press('Enter');
  await page.locator('#page-number').blur();
  await page.waitForTimeout(200);
  await page.locator('#next').click();
  await writeFile(
    'test-results/kindle/restart-expected.json',
    JSON.stringify({ book: book.id, prefs, position: await position() }),
  );
  console.log('Prepared Kindle position; closing before the save debounce.');
} else {
  const expected = JSON.parse(await readFile('test-results/kindle/restart-expected.json', 'utf8'));
  await open(expected.book);
  const actual = await position();
  assert.equal(actual.mode, 'kindle');
  assert.ok(
    Math.abs(actual.top - expected.position.top) < 3,
    JSON.stringify({ expected: expected.position, actual }),
  );
  await page.locator('#back').click();
  await page.waitForFunction(() => document.activeElement?.id === 'library-search');
  await page.evaluate(
    (p) =>
      p === null
        ? localStorage.removeItem('lume.preferences')
        : localStorage.setItem('lume.preferences', p),
    expected.prefs,
  );
  await writeFile(
    'test-results/kindle/restart.json',
    JSON.stringify({ passed: true, expected: expected.position, actual }, null, 2),
  );
  console.log('PASS Kindle mode and exact position survived a real process restart.', actual);
}
try {
  await api('plugin:window|close', { label: 'main' });
} catch {}
await browser.close();
