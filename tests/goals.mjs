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
// A credit lands after the once-a-second sample and the save that waits for a pause, so a test
// waits until the stored day has it rather than for a fixed time. The assertion that follows
// still decides: this only stops waiting early.
const credited = (kind, value) =>
  page
    .waitForFunction(
      ({ kind, value }) =>
        Object.values(
          JSON.parse(localStorage.getItem('folio.test.library')).books.find(
            (b) => b.id === 'artificial-chapters',
          ).readingDays ?? {},
        ).some((d) => d[kind].includes(value)),
      { kind, value },
      { timeout: 5000 },
    )
    .catch(() => {});
const openBook = async (id = 'artificial-chapters') => {
  await click(`[data-open="${id}"]`);
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
// The dialog of a document opens from the menu of its card (the library must be on screen); the one
// of the library, from the side bar. There is no list of documents in the dialog to choose from.
const goals = async (id) => {
  if (!id) return click('#goals');
  await click(`[data-menu="${id}"]`);
  await click('#popover [data-action="goal"]');
  await page.locator('#goal-own').waitFor();
};
const saved = (message) =>
  page.waitForFunction(
    (message) => document.querySelector('#toast')?.textContent.includes(message),
    message,
  );
// Each part has its own choice, numbers and "Salvar", and saving leaves the dialog open: the general
// goal (no `id`) is on or off ('custom' or 'none'), the one of a document is its own or none
// ('custom' or 'inherit').
const configure = async (id, mode, unit = 'pages', target = 10) => {
  await goals(id);
  const part = id ? 'goal-own' : 'goal';
  await page.locator(id ? `#goal-own-${mode}` : `#goal-mode-${mode}`).check();
  if (mode === 'custom') {
    await page.locator(`#${part}-unit`).selectOption(unit);
    await page.locator(`#${part}-target`).fill(String(target));
  }
  await click(id ? '#goal-own-save' : '#goal-save');
  await saved(id ? 'Meta deste documento salva.' : 'Meta geral salva.');
  await click('#goals-close');
};
// Saving a log draws the totals of today again, and nothing else of the dialog: the panel stays open
// and the focus stays on the button. A mark on the old text tells that it was drawn again.
const markStatus = () =>
  page.evaluate(() => (document.querySelector('#goal-current').dataset.old = '1'));
const statusRedrawn = () =>
  page.waitForFunction(() => !document.querySelector('#goal-current').dataset.old);
const log = async (id, pages, chapters) => {
  await goals(id);
  await click('.goal-adjust summary');
  await page.locator('#goal-pages').fill(String(pages));
  await page.locator('#goal-chapters').fill(String(chapters));
  await markStatus();
  await click('#goal-log-save');
  await statusRedrawn();
  assert.equal(await page.locator('.goal-adjust').evaluate((el) => el.open), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'goal-log-save');
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
    assert.equal(await page.locator('#finish-reading').getAttribute('aria-pressed'), 'true');
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
  await test('The general goal counts all the reading of the day, with or without a goal of its own; manual totals replace rather than add', async () => {
    // `solo` keeps the setting that older versions saved for "Sem meta" (`none`): it is read as no goal of its own.
    await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('folio.test.library'));
      for (const [id, title] of [
        ['second', 'Segundo livro'],
        ['custom', 'Com meta própria'],
        ['solo', 'Sem meta própria'],
      ])
        data.books.push({
          ...data.books[0],
          id,
          title,
          ...(id === 'solo' ? { readingGoal: { mode: 'none', unit: 'pages', target: 10 } } : {}),
        });
      localStorage.setItem('folio.test.library', JSON.stringify(data));
    });
    await page.reload();
    await configure(undefined, 'custom', 'pages', 100);
    await configure('custom', 'custom', 'chapters', 2);
    await configure('second', 'inherit');
    assert.equal((await book('second')).readingGoal.mode, 'inherit');
    await log('artificial-chapters', 4, 1);
    await log('second', 5, 1);
    await log('custom', 30, 2);
    await log('solo', 40, 3);
    // 4 + 5 + 30 + 40: the document with a goal of its own and the one without any count as the rest.
    assert.match(await page.locator('#library-goal').textContent(), /79 \/ 100 páginas/);
    await log('artificial-chapters', 6, 1);
    assert.match(await page.locator('#library-goal').textContent(), /81 \/ 100 páginas/);
    // A document with a goal of its own has two progresses: the day of the library, in the general
    // part, and the day of the document, measured by its own goal, in the part of the document.
    await goals('custom');
    assert.match(await page.locator('#goal-current').textContent(), /81 de 100 páginas/);
    assert.match(
      await page.locator('#goal-own-current').textContent(),
      /2 de 2 capítulos · Meta atingida/,
    );
    assert.equal(
      await page.locator('#goal-own progress').getAttribute('aria-label'),
      'Progresso da meta deste documento hoje',
    );
    assert.equal(await page.locator('#goal-own progress').getAttribute('value'), '2');
    await click('#goals-close');
    // A document without a goal of its own has no progress of its own: it is part of the general one.
    await goals('second');
    assert.match(await page.locator('#goal-current').textContent(), /81 de 100 páginas/);
    assert.equal(await page.locator('#goal-own-current').count(), 0);
    assert.equal(await page.locator('#goal-own-fields').isHidden(), true);
    await click('#goals-close');
    await configure(undefined, 'custom', 'chapters', 3);
    // 1 + 1 + 2 + 3 chapters, with the goal of 2 chapters of the document that has one counted too.
    assert.match(await page.locator('#library-goal').textContent(), /7 \/ 3 capítulos/);
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
    // The quantity of a document is checked too, and nothing is saved while it is not valid.
    await click('#goals-close');
    await goals('second');
    await page.locator('#goal-own-custom').check();
    await page.locator('#goal-own-target').fill('0');
    await click('#goal-own-save');
    assert.equal(await page.locator('#dialog').evaluate((el) => el.open), true);
    assert.equal(
      await page.locator('#goal-own-target').evaluate((el) => el.validity.rangeUnderflow),
      true,
    );
    assert.equal((await book('second')).readingGoal.mode, 'inherit');
    await click('#goals-close');
  });
  await test('The dialog has the general goal and, from a document, the goal of that document, with no list of documents to choose from', async () => {
    // The library: only the general goal. Choosing the document of the adjustment is all it has.
    await goals();
    assert.deepEqual(await page.locator('#dialog legend').allTextContents(), ['Meta geral']);
    assert.deepEqual(await page.locator('#goal-general .goal-choice').allTextContents(), [
      'Sem meta geral',
      'Com meta geral',
    ]);
    assert.equal(await page.locator('#goal-scope').count(), 0);
    assert.doesNotMatch(await page.locator('#dialog').textContent(), /Configurar para/);
    assert.equal(await page.locator('#goal-own').count(), 0);
    assert.equal(await page.locator('#goal-log-book').count(), 1);
    assert.equal(await page.locator('#goal-log-book option').count(), 4);
    // The rule, in one sentence, and the initial focus on the first control.
    assert.match(
      await page.locator('.goal-rule').textContent(),
      /^A meta geral conta tudo o que você ler no dia\./,
    );
    assert.equal(await page.evaluate(() => document.activeElement.id), 'goal-mode-custom');
    // "Ver histórico" is a link beside the title, and "Salvar" stays a button of the part.
    assert.equal(
      await page.locator('.dialog-heading #goal-history').textContent(),
      'Ver histórico',
    );
    await click('#goals-close');
    // A document: two parts, with the two settings, and the adjustment is of that document.
    await goals('second');
    assert.deepEqual(await page.locator('#dialog legend').allTextContents(), [
      'Meta geral',
      'Este documento',
    ]);
    assert.equal(await page.locator('.goal-doc-name').textContent(), 'Segundo livro');
    assert.deepEqual(await page.locator('#goal-own .goal-choice').allTextContents(), [
      'Sem meta própria',
      'Meta própria',
    ]);
    assert.equal(await page.locator('#goal-own-inherit').isChecked(), true);
    assert.equal(await page.locator('#goal-scope').count(), 0);
    assert.equal(await page.locator('#goal-log-book').count(), 0);
    assert.match(
      await page.locator('.goal-rule').textContent(),
      /A meta própria é um alvo extra deste documento\.$/,
    );
    assert.doesNotMatch(
      await page.locator('#dialog').textContent(),
      /fora dessa soma|Usar meta geral|Biblioteca inteira/,
    );
    // Choosing "Meta própria" shows the quantity and the unit; the other choice hides them.
    await page.locator('#goal-own-custom').check();
    assert.equal(await page.locator('#goal-own-fields').isVisible(), true);
    await page.locator('#goal-own-inherit').check();
    assert.equal(await page.locator('#goal-own-fields').isHidden(), true);
    // The two parts do not depend on each other: changing one and saving the other keeps both.
    await page.locator('#goal-own-custom').check();
    await page.locator('#goal-own-target').fill('7');
    await page.locator('#goal-mode-none').check();
    await click('#goal-save');
    await saved('Meta geral salva.');
    assert.equal(await page.locator('#goal-own-target').inputValue(), '7');
    assert.equal(await page.locator('#goal-status progress').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'goal-save');
    await page.locator('#goal-mode-custom').check();
    await page.locator('#goal-target').fill('3');
    await page.locator('#goal-unit').selectOption('chapters');
    await click('#goal-save');
    await page.waitForFunction(() =>
      document.querySelector('#goal-current')?.textContent.includes('de 3 capítulos'),
    );
    await click('#goal-own-save');
    await saved('Meta deste documento salva.');
    assert.equal((await book('second')).readingGoal.mode, 'custom');
    assert.equal((await book('second')).readingGoal.target, 7);
    await click('#goals-close');
    await configure('second', 'inherit');
    assert.equal((await book('second')).readingGoal.mode, 'inherit');
    // The same dialog opens from the footer of the reader and from the menu of the document (⋯).
    await openBook();
    await click('#reader-goal');
    assert.equal(await page.locator('.goal-doc-name').textContent(), 'Capítulos de teste');
    await click('#goals-close');
    await click('#reader-more');
    await click('#popover [data-action="goal"]');
    assert.equal(await page.locator('#goal-own').count(), 1);
    assert.equal(await page.locator('#goal-log-book').count(), 0);
    await click('#goals-close');
    await click('#back');
  });
  await test('The reader shows its own goal or else the general one', async () => {
    await openBook();
    assert.match(
      await page.locator('#reader-goal').textContent(),
      /Hoje · 7 \/ 3 capítulos · Meta atingida/,
    );
    await click('#back');
    await openBook('custom');
    assert.match(
      await page.locator('#reader-goal').textContent(),
      /Hoje · 2 \/ 2 capítulos · Meta atingida/,
    );
    await click('#back');
  });
  await test('Active reading credits unique PDF pages and a recognized chapter; an open dialog pauses tracking', async () => {
    await openBook();
    await goTo(3);
    await page.waitForTimeout(8500);
    await credited('pages', 3);
    let b = await book();
    let day = Object.keys(b.readingDays)[0];
    assert.ok(b.readingDays[day].pages.includes(3));
    const count = b.readingDays[day].pages.length;
    await goTo(4);
    await credited('chapters', 2);
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
    // From a document, with a goal of its own: the two parts, in the dark theme, in a window of 800 x 600.
    await goals('custom');
    await page.screenshot({ path: 'test-results/goals/dark-800.png' });
    const fits = () =>
      page.locator('#dialog').evaluate((el) => {
        const box = el.getBoundingClientRect();
        return {
          wide: el.scrollWidth > el.clientWidth,
          inside: box.top >= 0 && box.bottom <= innerHeight && box.right <= innerWidth,
        };
      });
    assert.deepEqual(await fits(), { wide: false, inside: true });
    await click('.goal-adjust summary');
    await click('.goal-rules summary');
    assert.ok(await page.locator('#goal-log-save').isVisible());
    assert.deepEqual(await fits(), { wide: false, inside: true });
    await page.locator('#goal-own-save').scrollIntoViewIfNeeded();
    assert.ok(await page.locator('#goal-own-save').isVisible());
    await page.screenshot({ path: 'test-results/goals/dark-800-open.png' });
    await click('#goals-close');
    // From the library, in the same window: the general goal alone.
    await goals();
    assert.deepEqual(await fits(), { wide: false, inside: true });
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
    assert.equal(await page.locator('#goal-mode-custom').isChecked(), true);
    assert.equal(await page.locator('#goal-unit').inputValue(), 'chapters');
    assert.equal(await page.locator('#goal-target').inputValue(), '3');
    assert.equal(await page.locator('#goal-own-custom').isChecked(), true);
    assert.equal(await page.locator('#goal-own-unit').inputValue(), 'chapters');
    assert.equal(await page.locator('#goal-own-target').inputValue(), '2');
    await click('#goals-close');
    // The setting of older versions is kept as it was and read as "no goal of its own".
    await goals('solo');
    assert.equal(await page.locator('#goal-own-inherit').isChecked(), true);
    assert.equal(await page.locator('#goal-own-fields').isHidden(), true);
    assert.equal((await book('solo')).readingGoal.mode, 'none');
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
    await markStatus();
    await click('#goal-log-save');
    await statusRedrawn();
    assert.deepEqual((await book()).readingDays, before);
    assert.match(await page.locator('#goal-current').textContent(), /0 de 3 capítulos/);
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
