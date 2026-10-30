import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { headlessApp } from './support/headless-app.mjs';

const ID = 'artificial-chapters';
const PAGES = 6;
const app = await headlessApp();
const results = [];
let page;
await mkdir('test-results/progress', { recursive: true });
const click = (selector) => page.locator(selector).click();
const settle = (ms = 500) => page.waitForTimeout(ms);
// Pages are counted from the first (0%) to the last (100%).
const expected = (n) => (n <= 1 ? 0 : n >= PAGES ? 100 : Math.round(((n - 1) / (PAGES - 1)) * 100));
const seed = async ({ book = {}, prefs = null }) => {
  await page.evaluate(
    ({ id, book, prefs }) => {
      const data = JSON.parse(localStorage.getItem('folio.test.library'));
      Object.assign(
        data.books.find((b) => b.id === id),
        book,
      );
      localStorage.setItem('folio.test.library', JSON.stringify(data));
      if (prefs)
        localStorage.setItem(
          'lume.preferences',
          JSON.stringify({
            ...JSON.parse(localStorage.getItem('lume.preferences') || '{}'),
            ...prefs,
          }),
        );
    },
    { id: ID, book, prefs },
  );
  await page.reload();
  await page.waitForSelector(`[data-open="${ID}"]`);
};
const stored = () =>
  page.evaluate((id) => {
    const prefs = JSON.parse(localStorage.getItem('lume.preferences') || '{}');
    const book = JSON.parse(localStorage.getItem('folio.test.library')).books.find(
      (b) => b.id === id,
    );
    return { pace: prefs.pace?.[id], book };
  }, ID);
const openBook = async () => {
  await click(`[data-open="${ID}"]`);
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
const back = async () => {
  await click('#back');
  await page.waitForSelector('#library-search:focus');
};
const footer = async () => {
  const text = await page.locator('#reading-progress').textContent();
  const match = /^(\d+)% · Página (\d+) de 6$/.exec(text);
  assert.ok(match, `Unexpected footer: ${text}`);
  return { percent: Number(match[1]), page: Number(match[2]) };
};
const library = async () => ({
  continue: /(\d+)% da leitura/.exec(
    await page.locator('#continue .continue-info > span:last-child').textContent(),
  )?.[1],
  card: /· (\d+)%/.exec(await page.locator('.book-state > span').first().textContent())?.[1],
  bar: await page
    .locator('.progress-track i')
    .first()
    .evaluate((el) => el.style.width),
});
// The footer and every library surface must agree for the position saved on exit.
const agree = async (percent) => {
  const reader = await footer();
  assert.equal(reader.percent, percent ?? expected(reader.page), 'footer percentage');
  await back();
  const shown = await library();
  assert.deepEqual(shown, {
    continue: String(reader.percent),
    card: String(reader.percent),
    bar: `${reader.percent}%`,
  });
  await openBook();
  return reader;
};
const time = () => page.locator('#reading-time');
const test = async (name, fn) => {
  const detail = await fn();
  results.push({ name, ok: true, detail });
  console.log('PASS', name, detail || '');
};
try {
  page = await app.open();
  await seed({ prefs: { readingMode: 'scroll', theme: 'light', paper: 'light' } });
  await test('Scroll mode: the start is 0% and the footer matches every library surface', async () => {
    await openBook();
    assert.equal(await page.locator('#reading-progress').textContent(), '0% · Página 1 de 6');
    assert.equal((await agree(0)).page, 1);
    await goTo(4);
    assert.equal(await page.locator('#reading-progress').textContent(), '60% · Página 4 de 6');
    await agree(60);
    await page.screenshot({ path: 'test-results/progress/footer-scroll.png' });
  });
  await test('Kindle mode shows the same percentage for the same page, at any window size or zoom', async () => {
    await click('#kindle-toggle');
    await settle();
    await goTo(4);
    assert.equal(await page.locator('#reading-progress').textContent(), '60% · Página 4 de 6');
    await agree(60);
    await page.setViewportSize({ width: 800, height: 600 });
    await page.locator('#zoom').selectOption('0.5');
    await settle();
    await goTo(4);
    assert.equal((await footer()).percent, 60, 'The window and the zoom do not change it');
    await page.locator('#zoom').selectOption('2');
    await settle();
    await goTo(4);
    assert.equal((await footer()).percent, 60);
    await page.locator('#zoom').selectOption('1');
    await page.setViewportSize({ width: 1280, height: 820 });
    await settle();
    await goTo(2);
    assert.equal((await footer()).percent, 20);
    await goTo(1);
    assert.equal(await page.locator('#reading-progress').textContent(), '0% · Página 1 de 6');
    await agree(0);
  });
  await test('Reaching the end of the document is 100% in both modes and in the library', async () => {
    await page.locator('#viewer-container').focus();
    await page.keyboard.press('End');
    await settle(900);
    // Recognizing the last chapter's heading adds end padding; End then reaches page 6.
    await page.keyboard.press('End');
    await settle(900);
    assert.deepEqual(await footer(), { percent: 100, page: 6 });
    assert.equal(await page.locator('#next').isDisabled(), true);
    await agree(100);
    await click('#kindle-toggle');
    await settle();
    await goTo(5);
    assert.equal(await page.locator('#reading-progress').textContent(), '80% · Página 5 de 6');
    await page.locator('#viewer-container').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await settle();
    assert.equal((await footer()).percent, 100);
    await agree(100);
  });
  await test('A finished book is 100% wherever it was left, and undoing restores the position', async () => {
    await goTo(3);
    assert.equal((await footer()).percent, 40);
    await click('#finish-reading');
    await page.waitForFunction(
      () => document.querySelector('#finish-reading').getAttribute('aria-pressed') === 'true',
    );
    assert.equal(await page.locator('#reading-progress').textContent(), '100% · Página 3 de 6');
    await back();
    assert.equal(await page.locator('#continue').isVisible(), false);
    assert.equal(await page.locator('.finished-badge').count(), 1);
    assert.equal(
      await page
        .locator('.progress-track i')
        .first()
        .evaluate((el) => el.style.width),
      '100%',
    );
    await openBook();
    await click('#finish-reading');
    await page.waitForFunction(
      () => document.querySelector('#finish-reading').getAttribute('aria-pressed') === 'false',
    );
    assert.equal(await page.locator('#reading-progress').textContent(), '40% · Página 3 de 6');
  });
  await test('Without measured pages there is no estimate, and no number is invented', async () => {
    await back();
    await seed({ book: { page: 3 }, prefs: { pace: {} } });
    await openBook();
    assert.equal(await time().isHidden(), true);
    assert.equal(await time().textContent(), '');
    await back();
    assert.doesNotMatch(await page.locator('#continue').textContent(), /para terminar/);
    await seed({
      prefs: { pace: { [ID]: { seconds: 120, samples: 4, updated: 1 } } },
    });
    await openBook();
    assert.equal(await time().isHidden(), true, 'Four measured pages are not enough');
    await back();
    assert.doesNotMatch(await page.locator('#continue').textContent(), /para terminar/);
  });
  await test('With enough pages measured, the footer and the library show the time left', async () => {
    await seed({ prefs: { pace: { [ID]: { seconds: 120, samples: 5, updated: 1 } } } });
    await openBook();
    // The chapter ends at the next recognized start: page 4 for a reader on page 3.
    await page.waitForFunction(() =>
      /capítulo/.test(document.querySelector('#reading-time').textContent),
    );
    assert.equal(await time().textContent(), '≈ 2 min no capítulo · 8 min no livro');
    assert.equal(await page.locator('#reading-progress').textContent(), '40% · Página 3 de 6');
    await goTo(5);
    assert.equal(await time().textContent(), '≈ 2 min no capítulo · 4 min no livro');
    await goTo(6);
    assert.equal(await time().isHidden(), true, 'Nothing is left after the last page');
    await goTo(3);
    await back();
    assert.match(
      await page.locator('#continue .continue-info > span:last-child').textContent(),
      /Página 3 de 6 · 40% da leitura · ≈ 8 min para terminar/,
    );
    await page.screenshot({ path: 'test-results/progress/library-light.png' });
    await openBook();
    await click('#kindle-toggle');
    await settle();
    await goTo(3);
    assert.match(await time().textContent(), /^≈ 2 min no capítulo · 8 min no livro$/);
    await click('#kindle-toggle');
    await settle();
  });
  await test('The estimate never pushes the footer at 800 px, in dark theme and sepia paper', async () => {
    await seed({
      prefs: {
        theme: 'dark',
        paper: 'sepia',
        dailyGoal: { unit: 'chapters', target: 10000 },
        pace: { [ID]: { seconds: 120, samples: 5, updated: 1 } },
      },
    });
    await page.setViewportSize({ width: 800, height: 600 });
    await openBook();
    await page.waitForFunction(() =>
      /capítulo/.test(document.querySelector('#reading-time').textContent),
    );
    const layout = await page.evaluate(() => {
      const box = (s) => document.querySelector(s).getBoundingClientRect();
      const bar = document.querySelector('.reader-footer');
      return {
        overflow: bar.scrollWidth > bar.clientWidth,
        status: box('.reading-status'),
        goal: box('#reader-goal'),
        note: box('#add-note'),
        time: box('#reading-time'),
      };
    });
    assert.equal(layout.overflow, false);
    assert.ok(layout.status.right <= layout.goal.left, 'The estimate stays left of the goal');
    assert.ok(layout.goal.right <= layout.note.left, 'The goal stays left of the note button');
    assert.ok(layout.note.right <= 800 && layout.time.width > 0);
    await page.screenshot({ path: 'test-results/progress/footer-800-dark-sepia.png' });
    await back();
    await page.screenshot({ path: 'test-results/progress/library-800-dark.png' });
    await seed({ prefs: { theme: 'light', paper: 'light', dailyGoal: null } });
    await page.setViewportSize({ width: 1280, height: 820 });
  });
  await test('Active reading measures pages, ignoring skimming and dialogs, and the pace is saved', async () => {
    await seed({
      book: { page: 1, top: null, left: null },
      prefs: { pace: { [ID]: { seconds: 60, samples: 4, updated: 1 } } },
    });
    await openBook();
    await settle(2200);
    await click('#next');
    await settle(4200);
    await click('#next');
    await settle(1500);
    const measured = await stored();
    assert.equal(measured.pace.samples, 5, 'Page 2 was read for about four seconds');
    assert.ok(measured.pace.seconds > 45 && measured.pace.seconds < 55, measured.pace.seconds);
    assert.equal(await time().isHidden(), false, 'The estimate appears once there is enough data');
    assert.match(await time().textContent(), /no livro$/);
    await click('#next');
    await settle(2000);
    assert.equal((await stored()).pace.samples, 5, 'A page flipped through at once is skimming');
    await click('#reader-goal');
    await settle(4000);
    await click('#goals-close');
    await settle(2000);
    await click('#next');
    await settle(1500);
    assert.equal((await stored()).pace.samples, 5, 'Time in a dialog is not reading time');
    await back();
    assert.deepEqual(app.errors, []);
    assert.deepEqual(app.external, []);
    return { measuredPages: 1, personalDataUsed: false };
  });
} catch (error) {
  console.error(error);
  console.log('Browser errors:', app.errors);
  await page?.screenshot({ path: 'test-results/progress/failure.png' });
  process.exitCode = 1;
} finally {
  await writeFile(
    'test-results/progress/results.json',
    JSON.stringify(
      { passed: !process.exitCode, results, errors: app.errors, nativeBoundarySimulated: true },
      null,
      2,
    ),
  );
  await app.close();
}
