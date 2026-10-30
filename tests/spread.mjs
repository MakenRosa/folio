import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { headlessApp } from './support/headless-app.mjs';

const ID = 'artificial-chapters';
const PAGES = 6;
const app = await headlessApp();
const results = [];
let page;
await mkdir('test-results/spread', { recursive: true });
const click = (selector) => page.locator(selector).click();
const settle = (ms = 500) => page.waitForTimeout(ms);
const prefs = () => page.evaluate(() => JSON.parse(localStorage.getItem('lume.preferences')));
const stored = () =>
  page.evaluate((id) => {
    const day = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    const book = JSON.parse(localStorage.getItem('folio.test.library')).books.find(
      (b) => b.id === id,
    );
    const preferences = JSON.parse(localStorage.getItem('lume.preferences') || '{}');
    return {
      book,
      pages: book.readingDays?.[day]?.pages || [],
      pace: preferences.pace?.[id],
    };
  }, ID);
// Credit arrives eight seconds after a screen is reached, plus the sampling and saving delays.
const waitForCredit = async (expected) => {
  await page
    .waitForFunction(
      (expected) => {
        const d = new Date();
        const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const book = JSON.parse(localStorage.getItem('folio.test.library')).books[0];
        return JSON.stringify(book.readingDays?.[day]?.pages) === JSON.stringify(expected);
      },
      expected,
      { timeout: 20000, polling: 250 },
    )
    .catch(() => {});
  assert.deepEqual((await stored()).pages, expected);
};
const openBook = async () => {
  await click(`[data-open="${ID}"]`);
  await page.waitForFunction(
    () =>
      document.querySelector('#reader-loading').hidden &&
      document.querySelector('.page canvas')?.width > 0,
  );
  await settle();
};
const back = async () => {
  await click('#back');
  await page.waitForSelector('#library-search:focus');
};
// The pages grouped the way PDF.js lays them out: one entry per .spread, or per page.
const rows = () =>
  page.evaluate(() => {
    const spreads = [...document.querySelectorAll('#pdf-viewer .spread')];
    if (!spreads.length)
      return [...document.querySelectorAll('#pdf-viewer .page')].map((p) => p.dataset.pageNumber);
    return spreads.map((s) =>
      [...s.querySelectorAll('.page')].map((p) => p.dataset.pageNumber).join('+'),
    );
  });
const waitForRows = (expected) =>
  page.waitForFunction((expected) => {
    const spreads = [...document.querySelectorAll('#pdf-viewer .spread')];
    const now = spreads.length
      ? spreads.map((s) =>
          [...s.querySelectorAll('.page')].map((p) => p.dataset.pageNumber).join('+'),
        )
      : [...document.querySelectorAll('#pdf-viewer .page')].map((p) => p.dataset.pageNumber);
    return JSON.stringify(now) === JSON.stringify(expected);
  }, expected);
const SINGLE = ['1', '2', '3', '4', '5', '6'];
const ODD = ['1+2', '3+4', '5+6'];
const EVEN = ['1', '2+3', '4+5', '6'];
const metrics = () =>
  page.evaluate(() => {
    const c = document.querySelector('#viewer-container');
    const box = c.getBoundingClientRect();
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top - box.top, bottom: r.bottom - box.top };
    };
    const pages = Object.fromEntries(
      [...document.querySelectorAll('#pdf-viewer .page')].map((p) => [
        p.dataset.pageNumber,
        rect(p),
      ]),
    );
    return {
      overflowX: c.scrollWidth - c.clientWidth,
      width: c.clientWidth,
      height: c.clientHeight,
      scrollTop: c.scrollTop,
      pages,
      spreads: [...document.querySelectorAll('#pdf-viewer .spread')].map((s) => rect(s)),
      zoom: document.querySelector('#zoom').value,
      current: Number(document.querySelector('#page-number').value),
      previous: document.querySelector('#previous').disabled,
      next: document.querySelector('#next').disabled,
    };
  });
const bounds = () =>
  page.evaluate(() => {
    const overflow = (s) => {
      const e = document.querySelector(s);
      return e.scrollWidth - e.clientWidth;
    };
    return {
      header: overflow('.reader-header'),
      toolbar: overflow('.reader-toolbar'),
      footer: overflow('.reader-footer'),
    };
  });
const pressed = () => page.locator('#spread-toggle').getAttribute('aria-pressed');
const pageValue = async () => Number(await page.locator('#page-number').inputValue());
const waitForPage = (n) =>
  page.waitForFunction((n) => Number(document.querySelector('#page-number').value) === n, n);
const goTo = async (number) => {
  await page.locator('#page-number').fill(String(number));
  await page.locator('#page-number').press('Enter');
  await page.locator('#viewer-container').focus();
  await settle();
};
const choose = async (spread) => {
  await click('#reader-settings');
  await page.locator('#pref-spread').selectOption(spread);
  await click('#close-settings');
  await waitForRows({ none: SINGLE, odd: ODD, even: EVEN }[spread]);
  await settle(300);
};
const test = async (name, fn) => {
  const detail = await fn();
  results.push({ name, ok: true, detail });
  console.log('PASS', name, detail || '');
};
try {
  page = await app.open();
  await openBook();
  await test('The toolbar button groups the pages in pairs and back; the width zoom fits a pair', async () => {
    assert.deepEqual(await rows(), SINGLE);
    assert.equal(await pressed(), 'false');
    assert.equal(await page.locator('#spread-toggle').isEnabled(), true);
    assert.equal((await prefs()).spread, 'none');
    await page.locator('#zoom').selectOption('page-width');
    await settle();
    const single = await metrics();
    assert.equal(single.overflowX, 0);
    await click('#spread-toggle');
    await waitForRows(ODD);
    await settle();
    assert.equal(await pressed(), 'true');
    assert.equal((await prefs()).spread, 'odd');
    const pair = await metrics();
    assert.equal(pair.zoom, 'page-width', 'The zoom choice stays');
    assert.equal(pair.overflowX, 0, 'Two pages fit the width without a horizontal scrollbar');
    for (const [first, second] of [
      ['1', '2'],
      ['3', '4'],
      ['5', '6'],
    ]) {
      const a = pair.pages[first],
        b = pair.pages[second];
      assert.ok(Math.abs(a.top - b.top) < 1, 'The two pages share one row');
      assert.ok(b.left >= a.right, 'The second page is to the right');
      assert.ok(b.right <= pair.width && a.left >= 0, 'Both are inside the window');
    }
    const w = pair.pages['1'].right - pair.pages['1'].left;
    assert.ok(Math.abs(w * 2 - (single.width - 40)) < 12, `A pair uses the window: ${w}`);
    assert.ok(pair.pages['1'].bottom - pair.pages['1'].top < single.pages['1'].bottom);
    await page.screenshot({ path: 'test-results/spread/pairs-width.png' });
    await page.locator('#zoom').selectOption('page-fit');
    await settle(800);
    const fit = await metrics();
    assert.equal(fit.overflowX, 0);
    for (const p of Object.values(fit.pages))
      assert.ok(p.bottom - p.top <= fit.height, 'Whole page: each page fits the height');
    for (const s of fit.spreads) assert.ok(s.right - s.left <= fit.width, 'and the pair the width');
    await page.screenshot({ path: 'test-results/spread/pairs-fit.png' });
    await click('#spread-toggle');
    await waitForRows(SINGLE);
    assert.equal(await pressed(), 'false');
    assert.equal((await prefs()).spread, 'none');
    assert.equal((await metrics()).overflowX, 0);
    await page.locator('#zoom').selectOption('page-width');
    await settle();
  });
  await test('The preference selector, "separate cover" and the button remember the layout', async () => {
    await click('#reader-settings');
    assert.equal(await page.locator('#pref-spread').inputValue(), 'none');
    assert.deepEqual(await page.locator('#pref-spread option').allTextContents(), [
      'Página única',
      'Duas páginas',
      'Duas páginas, capa separada',
    ]);
    assert.equal(await page.locator('#pref-spread').isEnabled(), true);
    assert.match(await page.locator('#pref-spread-help').textContent(), /capa separada/);
    await page.locator('#pref-spread').selectOption('even');
    await waitForRows(EVEN);
    await click('#close-settings');
    await settle();
    assert.deepEqual(await rows(), EVEN, 'The cover (page 1) is alone');
    const m = await metrics();
    assert.ok(m.pages['1'].right - m.pages['1'].left > 0);
    assert.ok(Math.abs(m.pages['2'].top - m.pages['3'].top) < 1);
    assert.ok(m.pages['1'].bottom <= m.pages['2'].top + 1, 'Nothing is beside the cover');
    assert.equal(m.overflowX, 0);
    assert.equal(await pressed(), 'true');
    assert.equal((await prefs()).spread, 'even');
    await page.screenshot({ path: 'test-results/spread/pairs-cover.png' });
    await click('#spread-toggle');
    await waitForRows(SINGLE);
    await click('#spread-toggle');
    await waitForRows(EVEN);
    assert.equal((await prefs()).spread, 'even', 'The button brings back the chosen layout');
    await choose('odd');
    assert.deepEqual(await rows(), ODD);
    assert.equal(
      await page.locator('#spread-toggle').getAttribute('title'),
      'Duas páginas lado a lado (L)',
    );
  });
  await test('Next and previous move by a pair, with the right ends disabled, in both layouts', async () => {
    await goTo(1);
    await page.locator('#viewer-container').focus();
    assert.equal(await page.locator('#previous').isDisabled(), true);
    assert.equal(await page.locator('#next').isDisabled(), false);
    assert.equal(await page.locator('#next').getAttribute('aria-label'), 'Próximas páginas');
    assert.equal(await page.locator('#previous').getAttribute('title'), 'Páginas anteriores');
    await click('#next');
    await waitForPage(3);
    await settle();
    let m = await metrics();
    assert.ok(
      m.pages['3'].top < 24 + 40 && m.pages['3'].top > -2,
      `Pair 3-4 at the top: ${m.pages['3'].top}`,
    );
    assert.deepEqual([m.previous, m.next], [false, false]);
    await click('#next');
    await waitForPage(5);
    await settle();
    m = await metrics();
    assert.ok(m.pages['5'].top < 24 + 40 && m.pages['5'].top > -2);
    assert.deepEqual([m.previous, m.next], [false, true], 'The last pair has no next');
    await click('#previous');
    await waitForPage(3);
    await page.keyboard.press('ArrowRight');
    await waitForPage(5);
    await page.keyboard.press('ArrowLeft');
    await waitForPage(3);
    await page.keyboard.press('ArrowLeft');
    await waitForPage(1);
    await settle();
    m = await metrics();
    assert.deepEqual([m.previous, m.next], [true, false], 'The first pair has no previous');
    // The cover alone, then pairs of two, and a last page alone (an even page count).
    await choose('even');
    await goTo(1);
    const seen = [];
    for (let i = 0; i < 3; i++) {
      await click('#next');
      await settle(400);
      seen.push(await pageValue());
    }
    assert.deepEqual(seen, [2, 4, 6], 'Cover, then pairs 2-3 and 4-5, then the page 6 alone');
    m = await metrics();
    assert.deepEqual([m.previous, m.next], [false, true]);
    await click('#previous');
    await waitForPage(4);
    await choose('none');
    await goTo(2);
    await click('#next');
    await waitForPage(3);
    assert.equal(await page.locator('#next').getAttribute('aria-label'), 'Próxima página');
    await choose('odd');
  });
  await test('Kindle forces one column without erasing the choice, and the scroll brings it back', async () => {
    await goTo(3);
    const row = async () => {
      const m = await metrics();
      const p = m.pages['3'];
      return { m, covers: p.top <= 2 && p.bottom > 2 };
    };
    // The reading position is kept in PDF coordinates while the layout changes.
    await page.locator('#viewer-container').evaluate((el) => (el.scrollTop += 150));
    await settle();
    const fraction = async () => {
      const p = (await metrics()).pages['3'];
      return -p.top / (p.bottom - p.top);
    };
    const inPair = await fraction();
    await click('#kindle-toggle');
    await waitForRows(SINGLE);
    await settle(800);
    assert.equal(await page.locator('#spread-toggle').isDisabled(), true);
    assert.equal(await pressed(), 'false');
    assert.match(
      await page.locator('#spread-toggle').getAttribute('title'),
      /só na rolagem.*modo Kindle/i,
    );
    assert.equal((await prefs()).spread, 'odd', 'The preference is not erased');
    assert.equal((await metrics()).overflowX, 0);
    await page.keyboard.press('l');
    assert.equal((await prefs()).spread, 'odd', 'The L key does nothing in Kindle');
    assert.match(await page.locator('#toast').textContent(), /só na rolagem/);
    assert.deepEqual(await rows(), SINGLE);
    assert.equal(await page.locator('#next').getAttribute('aria-label'), 'Próxima tela');
    assert.ok((await row()).covers, 'Page 3 stays under the top edge');
    await click('#reader-settings');
    assert.equal(await page.locator('#pref-spread').isDisabled(), true);
    assert.equal(await page.locator('#pref-spread').inputValue(), 'odd');
    assert.match(await page.locator('#pref-spread-help').textContent(), /Só na rolagem/);
    await page.screenshot({ path: 'test-results/spread/preferences-kindle.png' });
    await page.locator('#pref-reading-mode').selectOption('scroll');
    assert.equal(await page.locator('#pref-spread').isEnabled(), true);
    await waitForRows(ODD);
    await click('#close-settings');
    await settle(800);
    assert.equal(await page.locator('#spread-toggle').isEnabled(), true);
    assert.equal(await pressed(), 'true');
    assert.ok((await row()).covers, 'Back in the scroll, in pairs, the same page is at the top');
    assert.ok(Math.abs((await fraction()) - inPair) < 0.5, 'and near the same place');
    assert.equal(await pageValue(), 3);
    // Choosing Kindle from the preferences, and then from the button, behaves the same.
    await click('#kindle-toggle');
    await waitForRows(SINGLE);
    await click('#kindle-toggle');
    await waitForRows(ODD);
    assert.equal(await pressed(), 'true');
  });
  await test('Changing the layout keeps the point being read, in the page coordinates', async () => {
    await choose('none');
    await goTo(3);
    await page.locator('#viewer-container').evaluate((el) => (el.scrollTop += 400));
    await settle(700);
    const fraction = async (n) => {
      const p = (await metrics()).pages[n];
      return -p.top / (p.bottom - p.top);
    };
    const single = await fraction('3');
    assert.ok(single > 0.1 && single < 0.6, `A point inside page 3: ${single}`);
    // A pair has one top edge, so the point is kept in its left page: leaving the pair
    // (2, 3) lands on page 2 at the same height, as the pair began there.
    for (const [spread, anchor] of [
      ['odd', '3'],
      ['none', '3'],
      ['even', '3'],
      ['none', '2'],
      ['odd', '2'],
    ]) {
      await choose(spread);
      const now = await fraction(anchor);
      assert.ok(
        Math.abs(now - single) < 0.03,
        `${spread}: page ${anchor} keeps ${single}, now ${now}`,
      );
    }
    await choose('odd');
  });
  await test('The L key toggles the layout, but not while typing', async () => {
    await page.locator('#viewer-container').focus();
    await page.keyboard.press('l');
    await waitForRows(SINGLE);
    assert.equal((await prefs()).spread, 'none');
    await page.keyboard.press('L');
    await waitForRows(ODD);
    assert.equal((await prefs()).spread, 'odd');
    await page.keyboard.press('Control+f');
    await page.locator('#find-input').focus();
    await page.keyboard.type('l');
    assert.equal(await page.locator('#find-input').inputValue(), 'l');
    await page.locator('#page-number').focus();
    await page.keyboard.press('l');
    await page.locator('#zoom').focus();
    await page.keyboard.press('l');
    await settle(300);
    assert.deepEqual(await rows(), ODD, 'Typing in a field does not change the layout');
    await click('#find-close');
    // The button is a toggle for the keyboard too.
    await page.locator('#spread-toggle').focus();
    await page.keyboard.press('Space');
    await waitForRows(SINGLE);
    assert.equal(await pressed(), 'false');
    await page.keyboard.press('Space');
    await waitForRows(ODD);
    assert.equal(await pressed(), 'true');
    assert.equal(await page.locator('#spread-toggle').evaluate((el) => el.tagName), 'BUTTON');
  });
  await test('Goals count both pages of a pair, and the pace is measured two pages at a time', async () => {
    await back();
    await page.evaluate((id) => {
      const data = JSON.parse(localStorage.getItem('folio.test.library'));
      Object.assign(
        data.books.find((b) => b.id === id),
        {
          page: 1,
          top: null,
          left: null,
          readingDays: {},
          finished: false,
        },
      );
      localStorage.setItem('folio.test.library', JSON.stringify(data));
      const saved = JSON.parse(localStorage.getItem('lume.preferences'));
      saved.pace = { [id]: { seconds: 120, samples: 4, updated: 1 } };
      saved.dailyGoal = { unit: 'pages', target: 20 };
      localStorage.setItem('lume.preferences', JSON.stringify(saved));
    }, ID);
    await page.reload();
    await page.waitForSelector(`[data-open="${ID}"]`);
    await openBook();
    assert.deepEqual(await rows(), ODD);
    await page.locator('#viewer-container').focus();
    await waitForCredit([1, 2]);
    assert.equal(await page.locator('#reader-goal').textContent(), 'Hoje · 2 / 20 páginas');
    // A pair held for ten seconds: eight qualify it, and the rest is its reading time.
    await click('#next');
    await waitForPage(3);
    await settle(10000);
    await click('#next');
    await waitForPage(5);
    await settle(1500);
    const measured = await stored();
    assert.equal(measured.pace.samples, 5, 'Two pages measured as one step');
    // 120 s moved by one fifth of the way to the measured seconds per page.
    // About 10 s on a pair is 5 s per page: 120 + (5 - 120) / 5 = 97 (10 s a page would be 98).
    assert.ok(
      Math.abs(measured.pace.seconds - 97) < 0.45,
      `Seconds per page ${measured.pace.seconds}`,
    );
    assert.deepEqual(measured.pages, [1, 2, 3, 4], 'The pair just reached is not counted yet');
    // The same book on one page per screen still counts only the page on screen.
    await click('#spread-toggle');
    await waitForRows(SINGLE);
    await goTo(6);
    await waitForCredit([1, 2, 3, 4, 6]);
    await click('#spread-toggle');
    await waitForRows(ODD);
    await back();
    return { goalPairs: true, paceStepsOfTwo: true };
  });
  await test('The layout and the reading position survive closing the book and a browser restart', async () => {
    await page.evaluate((id) => {
      const data = JSON.parse(localStorage.getItem('folio.test.library'));
      Object.assign(
        data.books.find((b) => b.id === id),
        { page: 1, top: null, left: null },
      );
      localStorage.setItem('folio.test.library', JSON.stringify(data));
      const saved = JSON.parse(localStorage.getItem('lume.preferences'));
      localStorage.setItem(
        'lume.preferences',
        JSON.stringify({ ...saved, spread: 'even', dailyGoal: null }),
      );
    }, ID);
    await page.reload();
    await page.waitForSelector(`[data-open="${ID}"]`);
    await openBook();
    await waitForRows(EVEN);
    await page.locator('#zoom').selectOption('page-width');
    await settle();
    await goTo(4);
    await page.locator('#viewer-container').evaluate((el) => (el.scrollTop += 120));
    await settle(900);
    const before = await metrics();
    const page4 = before.pages['4'];
    const saved = (await stored()).book;
    assert.equal(saved.zoom, 'page-width');
    assert.ok(saved.page === 4 || saved.page === 5, `Saved page ${saved.page}`);
    await back();
    await openBook();
    await waitForRows(EVEN);
    const reopened = await metrics();
    assert.equal(await pageValue(), before.current, 'The same page');
    assert.ok(
      Math.abs(reopened.pages['4'].top - page4.top) < 3,
      `The same position: ${reopened.pages['4'].top} against ${page4.top}`,
    );
    assert.equal(reopened.zoom, 'page-width');
    assert.equal(reopened.overflowX, 0);
    await back();
    const beforeRestart = await prefs();
    assert.equal(beforeRestart.spread, 'even');
    await app.closeBrowser();
    page = await app.open();
    assert.deepEqual(await prefs(), beforeRestart);
    await openBook();
    await waitForRows(EVEN);
    assert.equal(await pressed(), 'true');
    assert.equal(await pageValue(), before.current);
    const restarted = await metrics();
    assert.ok(Math.abs(restarted.pages['4'].top - page4.top) < 3, 'The position after a restart');
    await click('#reader-settings');
    assert.equal(await page.locator('#pref-spread').inputValue(), 'even');
    await click('#close-settings');
    return { browserRestart: true, personalDataUsed: false };
  });
  await test('At 800 px the bars do not overflow, in the dark theme and with sepia paper', async () => {
    await page.setViewportSize({ width: 800, height: 600 });
    await click('#reader-settings');
    await page.locator('#pref-theme').selectOption('dark');
    await page.locator('[data-paper="sepia"]').click();
    await page.screenshot({ path: 'test-results/spread/preferences-800-dark-sepia.png' });
    const dialog = await page.evaluate(() => {
      const d = document.querySelector('#dialog');
      const row = document.querySelector('#pref-spread-row').getBoundingClientRect();
      return { overflow: d.scrollWidth - d.clientWidth, right: row.right, width: innerWidth };
    });
    assert.equal(dialog.overflow, 0);
    assert.ok(dialog.right <= dialog.width);
    await click('#close-settings');
    await page.locator('#zoom').selectOption('page-width');
    await settle(900);
    for (const spread of ['odd', 'even', 'none']) {
      await choose(spread);
      const edge = await bounds();
      assert.deepEqual(
        edge,
        { header: 0, toolbar: 0, footer: 0 },
        `${spread}: scrollWidth equals clientWidth`,
      );
      assert.equal((await metrics()).overflowX, 0, `${spread}: the page fits at 800 px`);
      assert.ok(await page.locator('#spread-toggle').isVisible());
      assert.ok(await page.locator('#fullscreen').isVisible());
      await page.screenshot({ path: `test-results/spread/toolbar-800-${spread}.png` });
    }
    await choose('odd');
    await click('#kindle-toggle');
    await settle(800);
    assert.deepEqual(await bounds(), { header: 0, toolbar: 0, footer: 0 });
    await page.screenshot({ path: 'test-results/spread/toolbar-800-kindle.png' });
    await click('#kindle-toggle');
    await waitForRows(ODD);
    // The width zoom follows a window resize while the pairs are shown.
    await page.setViewportSize({ width: 1280, height: 820 });
    await settle(900);
    assert.equal((await metrics()).overflowX, 0);
    await page.setViewportSize({ width: 900, height: 600 });
    await settle(900);
    assert.equal((await metrics()).overflowX, 0);
    assert.deepEqual(await bounds(), { header: 0, toolbar: 0, footer: 0 });
    await page.setViewportSize({ width: 1280, height: 820 });
    assert.deepEqual(app.errors, []);
    assert.deepEqual(app.external, []);
  });
} catch (error) {
  console.error(error);
  console.log('Browser errors:', app.errors);
  await page?.screenshot({ path: 'test-results/spread/failure.png' });
  process.exitCode = 1;
} finally {
  await writeFile(
    'test-results/spread/results.json',
    JSON.stringify(
      { passed: !process.exitCode, results, errors: app.errors, nativeBoundarySimulated: true },
      null,
      2,
    ),
  );
  await app.close();
}
