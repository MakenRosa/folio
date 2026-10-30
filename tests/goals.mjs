import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { headlessApp } from './support/headless-app.mjs';

const app = await headlessApp();
const results = [];
let page;
await mkdir('test-results/goals', { recursive: true });
const click = (selector) => page.locator(selector).click();
const settle = () => page.waitForTimeout(700);
const book = async (id = 'artificial-chapters') =>
  page.evaluate(
    (id) => JSON.parse(localStorage.getItem('folio.test.library')).books.find((b) => b.id === id),
    id,
  );
const openBook = async () => {
  await click('[data-open="artificial-chapters"]');
  await page.waitForFunction(
    () =>
      document.querySelector('#reader-loading').hidden &&
      document.querySelector('.page canvas')?.width > 0,
  );
  await settle();
};
const goTo = async (number) => {
  await page.locator('#page-number').fill(String(number));
  await page.locator('#page-number').press('Enter');
  await page.locator('#viewer-container').focus();
  await settle();
};
const goals = async (scope = 'global') => {
  await click('#goals');
  await page.locator('#goal-scope').selectOption(scope);
};
const configure = async (scope, mode, unit = 'pages', target = 10) => {
  await goals(scope);
  await page.locator('#goal-mode').selectOption(mode);
  if (mode === 'custom') {
    await page.locator('#goal-unit').selectOption(unit);
    await page.locator('#goal-target').fill(String(target));
  }
  await click('#goal-save');
  await page.waitForFunction(() => !document.querySelector('#dialog').open);
};
const log = async (id, pages, chapters) => {
  await goals(id);
  await click('.goal-adjust summary');
  await page.locator('#goal-pages').fill(String(pages));
  await page.locator('#goal-chapters').fill(String(chapters));
  await click('#goal-log-save');
  await page.waitForFunction(() => !document.querySelector('.goal-adjust').open);
  await click('#goals-close');
};
const test = async (name, fn) => {
  await fn();
  results.push({ name, ok: true });
  console.log('PASS', name);
};
try {
  page = await app.open();
  await openBook();
  await test('Completion is reversible, preserves position, survives reopening and appears in Finished', async () => {
    await goTo(3);
    const before = await book();
    await click('#finish-reading');
    await page.waitForFunction(
      () => document.querySelector('#finish-reading').getAttribute('aria-pressed') === 'true',
    );
    const completed = await book();
    for (const key of ['page', 'top', 'left', 'zoom', 'bookmarks', 'notes'])
      assert.deepEqual(completed[key], before[key]);
    await page.locator('#toast .toast-action').last().click();
    await page.waitForFunction(
      () => document.querySelector('#finish-reading').getAttribute('aria-pressed') === 'false',
    );
    await click('#finish-reading');
    await click('#back');
    await click('[data-filter="finished"]');
    assert.equal(await page.locator('.finished-badge').count(), 1);
    await openBook();
    assert.equal(await page.locator('#finish-reading').textContent(), 'Concluído');
    assert.equal(await page.locator('#page-number').inputValue(), '3');
    await click('#back');
    await click('[data-filter="reading"]');
    assert.equal(await page.locator('[data-open="artificial-chapters"]').count(), 0);
    await click('[data-filter="all"]');
    assert.equal(await page.locator('#continue').isVisible(), false);
    await openBook();
    await click('#finish-reading');
    await click('#back');
  });
  await test('Global aggregation respects inherited, custom and disabled book goals; manual totals replace rather than add', async () => {
    await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('folio.test.library'));
      for (const [id, title] of [
        ['second', 'Segundo livro'],
        ['custom', 'Meta própria'],
        ['none', 'Sem meta'],
      ])
        data.books.push({ ...data.books[0], id, title });
      localStorage.setItem('folio.test.library', JSON.stringify(data));
    });
    await page.reload();
    await configure('global', 'custom', 'pages', 20);
    await configure('custom', 'custom', 'chapters', 2);
    await configure('none', 'none');
    await log('artificial-chapters', 4, 1);
    await log('second', 5, 1);
    await log('custom', 30, 2);
    await log('none', 40, 3);
    assert.match(await page.locator('#library-goal').textContent(), /9 \/ 20 páginas/);
    await log('artificial-chapters', 6, 1);
    assert.match(await page.locator('#library-goal').textContent(), /11 \/ 20 páginas/);
    await goals('custom');
    assert.match(
      await page.locator('#goal-current').textContent(),
      /2 \/ 2 capítulos · Meta atingida/,
    );
    await click('#goals-close');
    await configure('global', 'custom', 'chapters', 3);
    assert.match(await page.locator('#library-goal').textContent(), /2 \/ 3 capítulos/);
    await page.screenshot({ path: 'test-results/goals/library.png' });
    await goals();
    await page.screenshot({ path: 'test-results/goals/global.png' });
    await page.locator('#goal-target').fill('0');
    await click('#goal-save');
    assert.equal(await page.locator('#dialog').evaluate((el) => el.open), true);
    assert.equal(
      await page.locator('#goal-target').evaluate((el) => el.validity.rangeUnderflow),
      true,
    );
    await click('#goals-close');
  });
  await test('Active reading credits unique PDF pages and a recognized chapter; an open dialog pauses tracking', async () => {
    await openBook();
    await goTo(3);
    await page.waitForTimeout(9500);
    let b = await book();
    let day = Object.keys(b.readingDays)[0];
    assert.ok(b.readingDays[day].pages.includes(3));
    const count = b.readingDays[day].pages.length;
    await goTo(4);
    await settle();
    b = await book();
    assert.ok(
      b.readingDays[day].chapters.includes(2),
      'Outline chapter on page 2 completes on recognized chapter at page 4',
    );
    await click('#reader-goal');
    await page.waitForTimeout(9500);
    assert.equal(
      (await book()).readingDays[day].pages.length,
      count,
      'Dialog time does not count as reading',
    );
    await click('#goals-close');
    await goTo(3);
    await page.waitForTimeout(9500);
    assert.equal(
      (await book()).readingDays[day].pages.length,
      count,
      'Same page counts once per day',
    );
    await click('#back');
  });
  await test('Dark theme, narrow layout and browser restart retain goals and daily totals', async () => {
    await click('#theme-toggle');
    await page.setViewportSize({ width: 800, height: 600 });
    await goals('custom');
    await click('.goal-adjust summary');
    assert.ok(await page.locator('#goal-log-save').isVisible());
    assert.equal(
      await page.locator('#dialog').evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
    );
    await page.locator('#dialog').evaluate((el) => el.scrollTo(0, 0));
    await page.screenshot({ path: 'test-results/goals/dark-800.png' });
    await click('#goals-close');
    const before = await page.evaluate(() => ({
      prefs: JSON.parse(localStorage.getItem('lume.preferences')),
      library: JSON.parse(localStorage.getItem('folio.test.library')),
    }));
    await app.closeBrowser();
    page = await app.open();
    const after = await page.evaluate(() => ({
      prefs: JSON.parse(localStorage.getItem('lume.preferences')),
      library: JSON.parse(localStorage.getItem('folio.test.library')),
    }));
    assert.deepEqual(after, before);
    await goals('custom');
    assert.equal(await page.locator('#goal-mode').inputValue(), 'custom');
    assert.equal(await page.locator('#goal-unit').inputValue(), 'chapters');
    assert.equal(await page.locator('#goal-target').inputValue(), '2');
    await click('#goals-close');
    await goals('none');
    assert.equal(await page.locator('#goal-mode').inputValue(), 'none');
    assert.deepEqual(app.errors, []);
    assert.deepEqual(app.external, []);
  });
  await test('Midnight resets the display and cannot apply a stale form to the new day', async () => {
    await click('#goals-close');
    await page.clock.setFixedTime(new Date(2030, 0, 1, 23, 59, 30));
    await goals('artificial-chapters');
    await click('.goal-adjust summary');
    await page.locator('#goal-pages').fill('100');
    const before = (await book()).readingDays;
    await page.clock.setFixedTime(new Date(2030, 0, 2, 0, 0, 30));
    await click('#goal-log-save');
    await page.waitForFunction(() => !document.querySelector('.goal-adjust').open);
    assert.deepEqual((await book()).readingDays, before);
    assert.match(await page.locator('#goal-current').textContent(), /0 \/ 3 capítulos/);
    await click('#goals-close');
    await page.waitForTimeout(1200);
    assert.match(await page.locator('#library-goal').textContent(), /0 \/ 3 capítulos/);
  });
} catch (error) {
  console.error(error);
  console.log('Browser errors:', app.errors);
  await page?.screenshot({ path: 'test-results/goals/failure.png' });
  process.exitCode = 1;
} finally {
  await writeFile(
    'test-results/goals/results.json',
    JSON.stringify(
      { passed: !process.exitCode, results, errors: app.errors, nativeBoundarySimulated: true },
      null,
      2,
    ),
  );
  await app.close();
}
