import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { headlessApp } from './support/headless-app.mjs';
const app = await headlessApp(),
  results = [];
let page;
await mkdir('test-results/history', { recursive: true });
const click = (s) => page.locator(s).click();
const test = async (name, fn) => {
  await fn();
  results.push({ name, ok: true });
  console.log('PASS', name);
};
const open = async () => {
  await click('#reading-history');
  await page.waitForSelector('.history-calendar');
};
const day = async (value) => {
  await click(`[data-history-day="${value}"]`);
};
try {
  page = await app.open();
  await page.clock.setFixedTime(new Date(2026, 9, 29, 12));
  await page.evaluate(() => {
    const prefs = JSON.parse(localStorage.getItem('lume.preferences'));
    prefs.dailyGoal = { unit: 'chapters', target: 2 };
    prefs.goalHistory = {
      '2026-09-01': { unit: 'pages', target: 10 },
      '2026-10-15': prefs.dailyGoal,
    };
    localStorage.setItem('lume.preferences', JSON.stringify(prefs));
    const data = JSON.parse(localStorage.getItem('folio.test.library')),
      a = data.books[0];
    const inherit = { mode: 'inherit', unit: 'pages', target: 10 },
      none = { ...inherit, mode: 'none' },
      custom = { mode: 'custom', unit: 'chapters', target: 2 };
    const record = (p, c) => ({ pages: [], chapters: [], pageAdjustment: p, chapterAdjustment: c });
    a.readingGoal = none;
    a.goalHistory = { '2026-09-01': inherit, '2026-10-20': none };
    a.readingDays = {
      '2026-08-04': record(8, 1),
      '2026-09-03': record(12, 1),
      '2026-10-10': record(6, 1),
      '2026-10-17': record(2, 1),
      '2026-10-18': record(1, 0),
      '2026-10-22': record(9, 0),
    };
    data.books.push({
      ...a,
      id: 'second',
      title: 'Outro livro',
      readingGoal: inherit,
      goalHistory: { '2026-09-01': inherit },
      readingDays: {
        '2026-10-10': record(5, 1),
        '2026-10-17': record(8, 1),
        '2026-10-18': record(1, 0),
        '2026-10-22': record(4, 1),
        '2026-10-29': record(3, 1),
      },
    });
    data.trash = [
      {
        ...a,
        id: 'archived',
        title: 'Livro removido',
        readingGoal: custom,
        goalHistory: { '2026-09-01': custom },
        readingDays: { '2026-10-10': record(20, 2) },
      },
    ];
    localStorage.setItem('folio.test.library', JSON.stringify(data));
  });
  await page.reload();
  await test('Monthly calendar shows page/chapter totals, historical target, achieved, missed and ongoing days', async () => {
    await open();
    await day('2026-10-10');
    assert.match(await page.locator('.history-day-totals').textContent(), /31 páginas4 capítulos/);
    assert.match(await page.locator('.history-detail').textContent(), /11 \/ 10 páginas/);
    assert.equal(await page.locator('.history-status').textContent(), 'Meta atingida');
    assert.equal(await page.locator('.history-books li').count(), 3);
    await day('2026-10-18');
    assert.equal(await page.locator('.history-status').textContent(), 'Abaixo da meta');
    await day('2026-10-29');
    assert.equal(await page.locator('.history-status').textContent(), 'Em andamento');
    assert.equal(await page.locator('[data-history-day="2026-10-30"]').isDisabled(), true);
    await page.screenshot({ path: 'test-results/history/calendar.png' });
  });
  await test('Book filter distinguishes shared and own goals, no goal and retained removed books', async () => {
    await page.locator('#history-scope').selectOption('artificial-chapters');
    await day('2026-10-10');
    assert.match(await page.locator('.history-day-totals').textContent(), /6 páginas1 capítulo/);
    assert.match(
      await page.locator('.history-detail').textContent(),
      /geral compartilhada.*11 \/ 10 páginas/,
    );
    await day('2026-10-22');
    assert.equal(await page.locator('.history-status').textContent(), 'Sem meta');
    await page.locator('#history-scope').selectOption('archived');
    await day('2026-10-10');
    assert.match(
      await page.locator('.history-detail').textContent(),
      /Meta do documento.*2 \/ 2 capítulos/,
    );
    assert.equal(await page.locator('.history-status').textContent(), 'Meta atingida');
  });
  await test('Previous months keep totals and label legacy targets as unknown without inventing missing days', async () => {
    await page.locator('#history-scope').selectOption('global');
    await click('#history-prev');
    await day('2026-09-03');
    assert.match(await page.locator('.history-day-totals').textContent(), /12 páginas1 capítulo/);
    assert.equal(await page.locator('.history-status').textContent(), 'Meta atingida');
    await click('#history-prev');
    await day('2026-08-04');
    assert.equal(await page.locator('.history-status').textContent(), 'Meta não registrada');
    assert.match(await page.locator('.history-day-totals').textContent(), /8 páginas1 capítulo/);
    await day('2026-08-05');
    assert.equal(await page.locator('.history-status').textContent(), 'Sem registro');
    assert.equal(await page.locator('#history-prev').isDisabled(), true);
    await click('#history-close');
  });
  await test('Goal edits do not rewrite earlier success and all history survives a browser restart', async () => {
    await click('#goals');
    await page.locator('#goal-mode').selectOption('custom');
    await page.locator('#goal-unit').selectOption('pages');
    await page.locator('#goal-target').fill('100');
    await click('#goal-save');
    await page.waitForFunction(() => !document.querySelector('#dialog').open);
    await click('#goals');
    await click('#goal-history');
    await day('2026-10-10');
    assert.equal(await page.locator('.history-status').textContent(), 'Meta atingida');
    await click('#history-close');
    const before = await page.evaluate(() => ({
      prefs: localStorage.getItem('lume.preferences'),
      library: localStorage.getItem('folio.test.library'),
    }));
    await app.closeBrowser();
    page = await app.open();
    await page.clock.setFixedTime(new Date(2026, 9, 29, 12));
    const after = await page.evaluate(() => ({
      prefs: localStorage.getItem('lume.preferences'),
      library: localStorage.getItem('folio.test.library'),
    }));
    assert.deepEqual(after, before);
    await open();
    await day('2026-10-10');
    assert.equal(await page.locator('.history-status').textContent(), 'Meta atingida');
  });
  await test('History is usable in dark mode at 800px and by keyboard, without horizontal overflow', async () => {
    await click('#history-close');
    await click('#theme-toggle');
    await page.setViewportSize({ width: 800, height: 600 });
    await open();
    assert.equal(
      await page.locator('#dialog').evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
    );
    await page.locator('[data-history-day="2026-10-10"]').focus();
    await page.keyboard.press('Enter');
    assert.equal(
      await page.locator('[data-history-day="2026-10-10"]').getAttribute('aria-pressed'),
      'true',
    );
    await page.screenshot({ path: 'test-results/history/dark-800.png' });
    await click('#history-close');
  });
  await test('Reading without a goal is still saved in history', async () => {
    await click('[data-open="artificial-chapters"]');
    await page.waitForFunction(
      () =>
        document.querySelector('#reader-loading').hidden &&
        document.querySelector('.page canvas')?.width > 0,
    );
    await page.locator('#viewer-container').focus();
    await page.waitForTimeout(10000);
    await click('#back');
    await open();
    await page.locator('#history-scope').selectOption('artificial-chapters');
    assert.match(await page.locator('.history-day-totals').textContent(), /1 página0 capítulos/);
    assert.equal(await page.locator('.history-status').textContent(), 'Sem meta');
    assert.deepEqual(app.errors, []);
    assert.deepEqual(app.external, []);
  });
} catch (error) {
  console.error(error);
  console.log('Browser errors:', app.errors);
  await page?.screenshot({ path: 'test-results/history/failure.png' });
  process.exitCode = 1;
} finally {
  await writeFile(
    'test-results/history/results.json',
    JSON.stringify(
      { passed: !process.exitCode, results, errors: app.errors, nativeBoundarySimulated: true },
      null,
      2,
    ),
  );
  await app.close();
}
