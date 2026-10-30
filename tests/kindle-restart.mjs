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
  // From the footer of the reader the dialog has the part of this document: a goal of its own, saved
  // with its own "Salvar" (the dialog stays open), and then the day's reading is adjusted.
  await page.locator('#reader-goal').click();
  await page.locator('#goal-own-custom').check();
  await page.locator('#goal-own-unit').selectOption('pages');
  await page.locator('#goal-own-target').fill('15');
  await page.locator('#goal-own-save').click();
  await page.waitForFunction(() => document.querySelector('#goal-own-current'));
  await page.locator('.goal-adjust summary').click();
  await page.locator('#goal-pages').fill('4');
  await page.locator('#goal-chapters').fill('1');
  await page.evaluate(() => (document.querySelector('#goal-own-current').dataset.old = '1'));
  await page.locator('#goal-log-save').click();
  await page.waitForFunction(() => !document.querySelector('#goal-own-current').dataset.old);
  await page.locator('#goals-close').click();
  await page.locator('#finish-reading').click();
  await page.waitForFunction(
    () => document.querySelector('#finish-reading').getAttribute('aria-pressed') === 'true',
  );
  const updated = (await api('library_list')).books.find((b) => b.id === book.id);
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
    JSON.stringify({
      book: book.id,
      prefs,
      position: await position(),
      readingGoal: updated.readingGoal,
      readingDays: updated.readingDays,
      goalHistory: updated.goalHistory,
    }),
  );
  console.log('Prepared Kindle position; closing before the save debounce.');
} else {
  const expected = JSON.parse(await readFile('test-results/kindle/restart-expected.json', 'utf8'));
  await open(expected.book);
  const actual = await position();
  const persisted = (await api('library_list')).books.find((b) => b.id === expected.book);
  assert.deepEqual(persisted.readingGoal, expected.readingGoal);
  assert.deepEqual(persisted.readingDays, expected.readingDays);
  assert.deepEqual(persisted.goalHistory, expected.goalHistory);
  assert.equal(persisted.finished, true);
  assert.equal(await page.locator('#finish-reading').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('#reader-goal').textContent(), /4 \/ 15 páginas/);
  assert.equal(actual.mode, 'kindle');
  assert.ok(
    Math.abs(actual.top - expected.position.top) < 3,
    JSON.stringify({ expected: expected.position, actual }),
  );
  await page.locator('#back').click();
  await page.waitForFunction(() => document.activeElement?.id === 'library-search');
  await page.locator('#reading-history').click();
  await page.locator('#history-scope').selectOption(expected.book);
  assert.match(await page.locator('.history-day-totals').textContent(), /4 páginas1 capítulo/);
  // The document has a goal of its own: the history measures it by that goal.
  assert.match(
    await page.locator('.history-detail').textContent(),
    /Meta própria do documento.*4 \/ 15 páginas/,
  );
  await page.locator('#history-close').click();
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
  console.log(
    'PASS Kindle, position, completion, daily goal and totals survived a real process restart.',
    actual,
  );
}
try {
  await api('plugin:window|close', { label: 'main' });
} catch {}
await browser.close();
