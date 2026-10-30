import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { headlessApp } from './support/headless-app.mjs';
import { outlinePdf } from './support/outline-pdf.mjs';
import { THUMBNAIL } from '../src/reading/thumbnails.ts';

// 60 pages (the 8th in landscape) and an outline with nested sections, so that the side
// bar has a long list to draw on demand and branches to fold. Real PDF.js, no window.
const ID = 'artificial-chapters';
const PAGES = 60;
const app = await headlessApp({ pdf: outlinePdf({ pages: PAGES }), pages: PAGES, title: 'Livro' });
const results = [];
let page;
await mkdir('test-results/sidebar', { recursive: true });
const click = (selector) => page.locator(selector).click();
const settle = (ms = 500) => page.waitForTimeout(ms);
const prefs = () => page.evaluate(() => JSON.parse(localStorage.getItem('lume.preferences')));
const saved = async () => {
  const { sidebarOpen, sidebarTab, sidebarWidth } = await prefs();
  return { sidebarOpen, sidebarTab, sidebarWidth };
};
// Prepares the library and the preferences, and starts over from the library.
const seed = async ({ prefs: patch = {}, book = {} } = {}) => {
  await page.evaluate(
    ({ id, patch, book }) => {
      const data = JSON.parse(localStorage.getItem('folio.test.library'));
      Object.assign(
        data.books.find((b) => b.id === id),
        {
          page: 1,
          top: null,
          left: null,
          zoom: 'page-width',
          rotation: 0,
          bookmarks: [],
          ...book,
        },
      );
      localStorage.setItem('folio.test.library', JSON.stringify(data));
      const old = JSON.parse(localStorage.getItem('lume.preferences') || '{}');
      localStorage.setItem('lume.preferences', JSON.stringify({ ...old, ...patch }));
    },
    { id: ID, patch, book },
  );
  await page.reload();
  await page.waitForSelector(`[data-open="${ID}"]`);
};
const openBook = async (id = ID) => {
  await click(`[data-open="${id}"]`);
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
const side = () =>
  page.evaluate(() => {
    const s = document.querySelector('#reader-sidebar'),
      h = document.querySelector('#sidebar-resizer');
    return {
      hidden: s.hidden,
      width: Math.round(s.getBoundingClientRect().width),
      tab: document.querySelector('[data-tab][aria-selected="true"]')?.dataset.tab,
      now: Number(h.getAttribute('aria-valuenow')),
      max: Number(h.getAttribute('aria-valuemax')),
      expanded: document.querySelector('#sidebar-toggle').getAttribute('aria-expanded'),
    };
  });
const pageValue = async () => Number(await page.locator('#page-number').inputValue());
// The footer says the page that the reader has reached, after PDF.js got there.
const waitForPage = (n) =>
  page.waitForFunction(
    (n) => document.querySelector('#reading-progress').textContent.endsWith(`Página ${n} de 60`),
    n,
  );
// `reported` is the page PDF.js calls current, which is the left one of a pair on screen.
const goTo = async (number, keepFocus = false, reported = number) => {
  await page.locator('#page-number').fill(String(number));
  await page.locator('#page-number').press('Enter');
  await waitForPage(reported);
  if (!keepFocus) await page.locator('#viewer-container').focus();
  await settle(350);
};
const bars = () =>
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
const NO_OVERFLOW = { header: 0, toolbar: 0, footer: 0 };
const tabsFit = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.side-tabs button')].every(
      (b) => b.scrollWidth <= b.clientWidth,
    ),
  );
// Where the reading is, in units of page 3 (how far its top is above the top of the view),
// which any width of the bar must keep. `current` is the page PDF.js reports.
const place = () =>
  page.evaluate(() => {
    const c = document.querySelector('#viewer-container');
    const box = c.getBoundingClientRect();
    const rect = (n) =>
      document.querySelector(`#pdf-viewer .page[data-page-number="${n}"]`).getBoundingClientRect();
    const r = rect(3);
    // Pages 3 and 4 are one row side by side. Page 8 is in landscape, so a whole book in
    // two pages is wider than the window by itself: only the row being read must fit.
    const row = [rect(3), rect(4)];
    return {
      current: Number(document.querySelector('#page-number').value),
      width: c.clientWidth,
      fits: row.every((p) => p.left >= box.left - 1 && p.right <= box.left + c.clientWidth + 1),
      at: (box.top - r.top) / r.height,
    };
  });

// The outline, row by row, as it is in the DOM.
const outline = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.outline-item')].map((b) => ({
      id: b.dataset.item,
      title: b.textContent,
      visible: !b.closest('[hidden]'),
      current: b.getAttribute('aria-current') === 'true',
      expanded:
        document
          .querySelector(`[data-toggle="${b.dataset.item}"]`)
          ?.getAttribute('aria-expanded') ?? null,
    })),
  );
const shown = async () => (await outline()).filter((r) => r.visible).map((r) => r.title);
const marked = async () => (await outline()).filter((r) => r.current).map((r) => r.title);
const row = async (title) => (await outline()).find((r) => r.title === title);
const item = (title) => page.getByRole('button', { name: title, exact: true });
const toggleOf = (title) =>
  page.getByRole('button', { name: `Subseções de ${title}`, exact: true });
const focusedText = () => page.evaluate(() => document.activeElement.textContent);
const FIRST_LEVEL = ['Parte I', 'Parte II', 'Apêndice'];

// The thumbnails: which pages have a drawing now, which are current, and the tab stops.
const thumbs = () =>
  page.evaluate(() => {
    const all = [...document.querySelectorAll('.thumb')];
    const number = (b) => Number(b.dataset.page);
    return {
      total: all.length,
      canvases: document.querySelectorAll('#sidebar-content canvas').length,
      drawn: all.filter((b) => b.querySelector('canvas')).map(number),
      current: all.filter((b) => b.getAttribute('aria-current') === 'page').map(number),
      stops: all.filter((b) => b.tabIndex === 0).map(number),
      focused: Number(document.activeElement?.dataset?.page ?? 0),
    };
  });
const thumbBox = (n) =>
  page.evaluate((n) => {
    const area = document.querySelector('#sidebar-content').getBoundingClientRect();
    const button = document.querySelector(`.thumb[data-page="${n}"]`);
    const b = button.getBoundingClientRect();
    const f = button.querySelector('.thumb-frame').getBoundingClientRect();
    const canvas = button.querySelector('canvas');
    return {
      inView: b.top >= area.top - 1 && b.bottom <= area.bottom + 1,
      shape: f.width / f.height,
      canvas: canvas ? [canvas.width, canvas.height] : null,
      blank:
        canvas &&
        !canvas
          .getContext('2d')
          .getImageData(0, 0, canvas.width, canvas.height)
          .data.some((v, i) => i % 4 !== 3 && v < 250),
    };
  }, n);
const waitForDrawn = (n) =>
  page.waitForFunction((n) => !!document.querySelector(`.thumb[data-page="${n}"] canvas`), n, {
    timeout: 15000,
  });
const scrollList = (top) =>
  page.locator('#sidebar-content').evaluate((el, top) => (el.scrollTop = top), top);
const A4 = 595 / 842;
const near = (a, b, tolerance, message) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} against ${b}`);

// WCAG contrast of the marked outline item and the current thumbnail, in the open theme.
const contrasts = () =>
  page.evaluate(() => {
    const parse = (value) =>
      value
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number);
    const luminance = (color) => {
      const [r, g, b] = parse(color).map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => {
      const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const panel = getComputedStyle(document.querySelector('#reader-sidebar')).backgroundColor;
    const out = {};
    const current = document.querySelector('.outline-item[aria-current="true"]');
    if (current) {
      const style = getComputedStyle(current);
      out.outline = {
        text: ratio(style.color, style.backgroundColor),
        weight: Number(style.fontWeight),
        bar: style.boxShadow !== 'none',
      };
    }
    const thumb = document.querySelector('.thumb.current');
    if (thumb) {
      const style = getComputedStyle(thumb);
      const frame = getComputedStyle(thumb.querySelector('.thumb-frame'));
      out.thumb = {
        text: ratio(style.color, style.backgroundColor),
        weight: Number(style.fontWeight),
        frame: ratio(frame.outlineColor, panel),
        width: parseFloat(frame.outlineWidth),
      };
    }
    return out;
  });

const test = async (name, fn) => {
  const detail = await fn();
  results.push({ name, ok: true, detail });
  console.log('PASS', name, detail || '');
};

try {
  page = await app.open();
  await openBook();

  await test('The bar starts closed, with an accessible toggle, and opens on the outline', async () => {
    const closed = await page.evaluate(() => [
      document.querySelector('#reader-sidebar').hidden,
      document.querySelector('#sidebar-toggle').getAttribute('aria-expanded'),
    ]);
    assert.deepEqual(closed, [true, 'false']);
    const toggle = page.locator('#sidebar-toggle');
    assert.match(await toggle.getAttribute('title'), /\(S\)$/);
    assert.equal(await toggle.getAttribute('aria-label'), await toggle.getAttribute('title'));
    assert.equal(await toggle.getAttribute('aria-controls'), 'reader-sidebar');
    assert.deepEqual(await saved(), {
      sidebarOpen: false,
      sidebarTab: 'outline',
      sidebarWidth: 260,
    });
    await click('#sidebar-toggle');
    assert.deepEqual(await side(), {
      hidden: false,
      width: 260,
      tab: 'outline',
      now: 260,
      max: 480,
      expanded: 'true',
    });
    assert.deepEqual(await page.locator('[role="tab"]').allTextContents(), [
      'Sumário',
      'Páginas',
      'Marcas',
      'Notas',
    ]);
    assert.equal(await page.locator('#sidebar-content').getAttribute('role'), 'tabpanel');
    assert.equal(
      await page.locator('#sidebar-content').getAttribute('aria-labelledby'),
      'tab-outline',
    );
    const handle = await page.locator('#sidebar-resizer').evaluate((el) => ({
      role: el.getAttribute('role'),
      orientation: el.getAttribute('aria-orientation'),
      min: el.getAttribute('aria-valuemin'),
      max: el.getAttribute('aria-valuemax'),
      now: el.getAttribute('aria-valuenow'),
      label: el.getAttribute('aria-label'),
      tabIndex: el.tabIndex,
    }));
    assert.deepEqual(handle, {
      role: 'separator',
      orientation: 'vertical',
      min: '220',
      max: '480',
      now: '260',
      label: 'Largura da barra lateral',
      tabIndex: 0,
    });
    assert.deepEqual(await saved(), {
      sidebarOpen: true,
      sidebarTab: 'outline',
      sidebarWidth: 260,
    });
    assert.deepEqual(await bars(), NO_OVERFLOW);
    await page.screenshot({ path: 'test-results/sidebar/outline-light.png' });
  });

  await test('The section being read is marked, with its branches open, and follows the reading', async () => {
    assert.deepEqual(await shown(), FIRST_LEVEL, 'The first level, with the branches closed');
    assert.deepEqual(await marked(), ['Parte I'], 'Page 1 is in Parte I');
    assert.equal((await row('Parte I')).expanded, 'false');
    assert.equal(await page.locator('.outline-item[aria-current="true"]').count(), 1);
    await goTo(6);
    assert.deepEqual(await marked(), ['Seção 1.2']);
    assert.deepEqual(await shown(), [
      'Parte I',
      'Capítulo 1',
      'Seção 1.1',
      'Seção 1.2',
      'Capítulo 2',
      'Parte II',
      'Apêndice',
    ]);
    assert.equal((await row('Parte I')).expanded, 'true');
    assert.equal((await row('Capítulo 1')).expanded, 'true');
    assert.equal((await row('Capítulo 2')).expanded, 'false');
    await page.screenshot({ path: 'test-results/sidebar/outline-section.png' });
    await goTo(8);
    assert.deepEqual(await marked(), ['Capítulo 2'], 'The landscape page starts a chapter');
    assert.deepEqual(
      await shown(),
      ['Parte I', 'Capítulo 1', 'Capítulo 2', 'Parte II', 'Apêndice'],
      'Chapter 1 closes again',
    );
    await goTo(21);
    assert.deepEqual(await marked(), ['Capítulo 3'], 'A named destination gives its page');
    await goTo(25);
    assert.deepEqual(await marked(), ['Seção 3.1']);
    assert.deepEqual((await shown()).slice(-4), [
      'Capítulo 3',
      'Seção 3.1',
      'Capítulo 4',
      'Apêndice',
    ]);
    await goTo(58);
    assert.deepEqual(await marked(), ['Apêndice'], 'The other named destination');
    assert.deepEqual(await shown(), FIRST_LEVEL);
    await goTo(1);
    assert.deepEqual(await marked(), ['Parte I']);
  });

  await test('The outline scrolls to the section without taking the focus, and only when it changes', async () => {
    await page.setViewportSize({ width: 1280, height: 480 });
    await settle(400);
    for (const title of ['Parte I', 'Parte II']) await toggleOf(title).click();
    for (const title of ['Capítulo 1', 'Capítulo 2', 'Capítulo 3']) await toggleOf(title).click();
    assert.equal((await shown()).length, 11, 'Everything is open');
    const overflow = await page
      .locator('#sidebar-content')
      .evaluate((el) => el.scrollHeight - el.clientHeight);
    assert.ok(overflow > 40, `The outline is longer than its area: ${overflow}`);
    const visible = (title) =>
      item(title).evaluate((el) => {
        const r = el.getBoundingClientRect(),
          area = document.querySelector('#sidebar-content').getBoundingClientRect();
        return r.top >= area.top - 1 && r.bottom <= area.bottom + 1;
      });
    // The focus stays in the page number: the bar must not take it.
    await goTo(58, true);
    assert.equal(await visible('Apêndice'), true, 'The last section is brought into view');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'page-number');
    assert.ok((await page.locator('#sidebar-content').evaluate((el) => el.scrollTop)) > 0);
    await goTo(1, true);
    assert.equal(await visible('Parte I'), true, 'and back to the first one');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'page-number');
    // Within the same section the list stays where the user left it.
    await goTo(55, true);
    await scrollList(0);
    await goTo(59, true);
    assert.deepEqual(await marked(), ['Apêndice']);
    assert.equal(await page.locator('#sidebar-content').evaluate((el) => el.scrollTop), 0);
    await page.setViewportSize({ width: 1280, height: 820 });
    await settle(400);
  });

  await test('Branches fold with the mouse and with the keyboard, and the arrows do not turn the page', async () => {
    await seed();
    await openBook();
    assert.equal((await side()).hidden, false, 'The bar is open again after a reload');
    assert.deepEqual(await shown(), FIRST_LEVEL);
    await toggleOf('Parte I').click();
    assert.deepEqual(await shown(), [
      'Parte I',
      'Capítulo 1',
      'Capítulo 2',
      'Parte II',
      'Apêndice',
    ]);
    assert.equal(await toggleOf('Parte I').getAttribute('aria-expanded'), 'true');
    assert.equal(
      await toggleOf('Parte I').getAttribute('aria-controls'),
      await page.locator('[data-group="0"]').getAttribute('id'),
    );
    await toggleOf('Parte I').click();
    assert.deepEqual(await shown(), FIRST_LEVEL);
    assert.equal(await toggleOf('Parte I').getAttribute('aria-expanded'), 'false');
    // The toggle is a button: Enter and Space work, and its arrows do not turn the page.
    await toggleOf('Parte II').focus();
    await page.keyboard.press('Enter');
    assert.equal(await toggleOf('Parte II').getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Space');
    assert.equal(await toggleOf('Parte II').getAttribute('aria-expanded'), 'false');
    await page.keyboard.press('ArrowRight');
    assert.equal(await toggleOf('Parte II').getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await toggleOf('Parte II').getAttribute('aria-expanded'), 'false');
    // Right opens, then goes in; down and up walk the visible items; left goes out, then closes.
    await item('Parte II').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal((await row('Parte II')).expanded, 'true');
    assert.equal(await focusedText(), 'Parte II', 'The first press only opens');
    await page.keyboard.press('ArrowRight');
    assert.equal(await focusedText(), 'Capítulo 3', 'The second goes to the first child');
    await page.keyboard.press('ArrowDown');
    assert.equal(await focusedText(), 'Capítulo 4');
    await page.keyboard.press('ArrowDown');
    assert.equal(await focusedText(), 'Apêndice');
    await page.keyboard.press('ArrowDown');
    assert.equal(await focusedText(), 'Apêndice', 'The end of the list');
    await page.keyboard.press('Home');
    assert.equal(await focusedText(), 'Parte I');
    await page.keyboard.press('End');
    assert.equal(await focusedText(), 'Apêndice');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await focusedText(), 'Parte II', 'Left on a child goes to its parent');
    await page.keyboard.press('ArrowLeft');
    assert.equal((await row('Parte II')).expanded, 'false', 'and on the parent it closes');
    assert.equal(await pageValue(), 1, 'No arrow key turned the page');
    // Enter and a click go to the section.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    assert.equal(await focusedText(), 'Capítulo 4');
    await page.keyboard.press('Enter');
    await waitForPage(40);
    assert.deepEqual(await marked(), ['Capítulo 4']);
    await toggleOf('Parte I').click();
    await toggleOf('Capítulo 1').click();
    await item('Seção 1.2').click();
    await waitForPage(5);
    assert.deepEqual(await marked(), ['Seção 1.2']);
    // PDF.js focuses the text of the page it was sent to, once that page is drawn.
    await settle(900);
    await goTo(1);
  });

  await test('The Pages tab draws only what is near the view, in the shape of each page', async () => {
    await click('#tab-pages');
    assert.deepEqual(await side(), {
      hidden: false,
      width: 260,
      tab: 'pages',
      now: 260,
      max: 480,
      expanded: 'true',
    });
    assert.equal((await saved()).sidebarTab, 'pages');
    assert.equal(
      await page.locator('#sidebar-content').getAttribute('aria-labelledby'),
      'tab-pages',
    );
    await waitForDrawn(1);
    await waitForDrawn(2);
    let t = await thumbs();
    assert.equal(t.total, PAGES, 'A button per page');
    assert.ok(t.canvases > 0 && t.canvases <= 10, `Only the pages near the view: ${t.canvases}`);
    assert.ok(t.drawn.every((n) => n <= 10));
    assert.deepEqual(t.current, [1]);
    assert.equal(
      await page.locator('.thumb[data-page="1"]').getAttribute('aria-label'),
      'Página 1',
    );
    assert.equal(await page.locator('.thumb[data-page="1"]').getAttribute('aria-current'), 'page');
    // A placeholder with the shape of the page, before anything is drawn.
    let far = await thumbBox(40);
    assert.equal(far.canvas, null);
    near(far.shape, A4, 0.01, 'The placeholder of page 40');
    assert.equal((await thumbBox(8)).canvas, null);
    near((await thumbBox(8)).shape, A4, 0.01, 'The landscape page is assumed to be like the first');
    const first = await thumbBox(1);
    assert.equal(first.blank, false, 'Page 1 is drawn, not blank');
    near(first.canvas[0], THUMBNAIL.width, 0, 'Drawn at the thumbnail width');
    near(first.canvas[1] / first.canvas[0], 842 / 595, 0.02, 'in the shape of the page');
    await page.screenshot({ path: 'test-results/sidebar/pages-light.png' });
    // The landscape page takes its real shape when it is drawn.
    await page.locator('.thumb[data-page="8"]').scrollIntoViewIfNeeded();
    await waitForDrawn(8);
    const landscape = await thumbBox(8);
    assert.ok(
      landscape.canvas[0] > landscape.canvas[1],
      `Page 8 is landscape: ${landscape.canvas}`,
    );
    near(landscape.shape, 842 / 595, 0.02, 'and its frame follows');
    // Scrolling through the whole list never goes over the ceiling of live canvases.
    const height = await page.locator('#sidebar-content').evaluate((el) => el.scrollHeight);
    let most = 0;
    for (let top = 0; top <= height; top += 500) {
      await scrollList(top);
      await settle(220);
      t = await thumbs();
      most = Math.max(most, t.canvases);
      assert.ok(t.canvases <= THUMBNAIL.maxLive, `${t.canvases} canvases at ${top}px`);
    }
    await waitForDrawn(PAGES);
    t = await thumbs();
    assert.ok(most > 3, `Several were drawn along the way: ${most}`);
    assert.ok(t.drawn.includes(PAGES) && !t.drawn.includes(1), 'The first ones were released');
    assert.ok(t.drawn.length < PAGES / 2, `Far from the whole book: ${t.drawn.length}`);
    await scrollList(0);
    await waitForDrawn(1);
    return { total: PAGES, mostAlive: most, ceiling: THUMBNAIL.maxLive };
  });

  await test('The thumbnails turn with the pages and are dropped with the book', async () => {
    await page.locator('#viewer-container').focus();
    await page.keyboard.press('r');
    await page.waitForFunction(() => {
      const c = document.querySelector('.thumb[data-page="1"] canvas');
      return c && c.width > c.height;
    });
    near((await thumbBox(1)).shape, 842 / 595, 0.02, 'A turned page is wider than tall');
    near((await thumbBox(30)).shape, 842 / 595, 0.02, 'The placeholders turn too');
    await page.screenshot({ path: 'test-results/sidebar/pages-rotated.png' });
    for (let i = 0; i < 3; i++) await page.keyboard.press('r');
    await page.waitForFunction(() => {
      const c = document.querySelector('.thumb[data-page="1"] canvas');
      return c && c.width < c.height;
    });
    near((await thumbBox(30)).shape, A4, 0.01, 'Back upright');
    // Closing the book while the list is drawing stops everything.
    await scrollList(6000);
    await settle(100);
    await back();
    assert.deepEqual(
      await page.evaluate(() => [
        document.querySelectorAll('#sidebar-content canvas').length,
        document.querySelector('#sidebar-content').children.length,
      ]),
      [0, 0],
      'No drawing is left in the list',
    );
    await settle(500);
    assert.deepEqual(app.errors, [], 'Nothing failed after the cancellation');
    await openBook();
    assert.equal((await side()).tab, 'pages');
    await waitForDrawn(1);
  });

  await test('Click, Enter and the keys go to the page; the current page and the pair are marked', async () => {
    const thumb = (n) => page.locator(`.thumb[data-page="${n}"]`);
    await scrollList(2400);
    await thumb(12).scrollIntoViewIfNeeded();
    await thumb(12).click();
    await waitForPage(12);
    let t = await thumbs();
    assert.deepEqual(t.current, [12]);
    assert.deepEqual([t.stops, t.focused], [[12], 12], 'One tab stop, on the focused thumbnail');
    await page.keyboard.press('ArrowDown');
    t = await thumbs();
    assert.equal(t.focused, 13, 'The arrow moves the focus');
    assert.equal(await pageValue(), 12, 'but does not go to the page');
    assert.deepEqual(t.stops, [13]);
    await page.keyboard.press('Enter');
    await waitForPage(13);
    assert.deepEqual((await thumbs()).current, [13]);
    await page.keyboard.press('PageDown');
    assert.equal((await thumbs()).focused, 18);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Space');
    await waitForPage(17);
    await page.keyboard.press('Home');
    assert.equal((await thumbs()).focused, 1);
    await page.keyboard.press('End');
    assert.equal((await thumbs()).focused, PAGES);
    await page.keyboard.press('Enter');
    await waitForPage(PAGES);
    await settle(300);
    assert.equal((await thumbBox(PAGES)).inView, true, 'The list shows the current page');
    assert.equal(await pageValue(), PAGES);
    await goTo(1);
    await waitForDrawn(1);
    // Side by side, the pair on screen is marked.
    await page.keyboard.press('l');
    await settle(700);
    await goTo(5);
    assert.deepEqual((await thumbs()).current, [5, 6]);
    await goTo(60, false, 59);
    assert.deepEqual((await thumbs()).current, [59, 60]);
    await goTo(1);
    assert.deepEqual((await thumbs()).current, [1, 2]);
    await page.screenshot({ path: 'test-results/sidebar/pages-pair.png' });
    // At a high zoom only one page of the pair is on screen, and only that one is marked.
    await page.locator('#zoom').selectOption('3');
    await settle(900);
    await goTo(5);
    await settle(500);
    assert.deepEqual((await thumbs()).current, [5]);
    await page.locator('#zoom').selectOption('page-width');
    await page.locator('#viewer-container').focus();
    await page.keyboard.press('l');
    await settle(700);
    await goTo(3);
    assert.deepEqual((await thumbs()).current, [3]);
    // In Kindle, too.
    await click('#kindle-toggle');
    await settle(700);
    await goTo(10);
    assert.deepEqual((await thumbs()).current, [10]);
    await thumb(20).scrollIntoViewIfNeeded();
    await thumb(20).click();
    await waitForPage(20);
    assert.deepEqual((await thumbs()).current, [20]);
    await click('#kindle-toggle');
    await settle(700);
    await goTo(1);
  });

  await test('The Marks and Notes tabs still work, and the tabs move with the arrow keys', async () => {
    await click('#tab-bookmarks');
    assert.equal((await saved()).sidebarTab, 'bookmarks');
    assert.match(await page.locator('#sidebar-content').textContent(), /Guarde uma página/);
    await goTo(7);
    await page.keyboard.press('Control+b');
    await page.waitForSelector('.bookmark-row');
    assert.equal(await page.locator('.bookmark-row').count(), 1);
    assert.equal(await page.locator('.bookmark-row').getAttribute('aria-current'), 'page');
    await goTo(9);
    assert.equal(await page.locator('.bookmark-row').getAttribute('aria-current'), null);
    await page.locator('.bookmark-row').click();
    await waitForPage(7);
    assert.equal(await page.locator('.bookmark-row').getAttribute('aria-current'), 'page');
    await page.keyboard.press('Control+b');
    await page.waitForSelector('.bookmark-row', { state: 'detached' });
    await click('#tab-notes');
    assert.equal(await page.locator('#side-add-note').isVisible(), true);
    // A tab list with one tab stop: left and right change the tab and move the focus.
    await page.locator('#tab-notes').focus();
    assert.deepEqual(
      await page.locator('[role="tab"]').evaluateAll((tabs) => tabs.map((t) => t.tabIndex)),
      [-1, -1, -1, 0],
    );
    await page.keyboard.press('ArrowRight');
    assert.equal((await side()).tab, 'outline', 'The tabs wrap around');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-outline');
    await page.keyboard.press('ArrowRight');
    assert.equal((await side()).tab, 'pages');
    await page.keyboard.press('End');
    assert.equal((await side()).tab, 'notes');
    await page.keyboard.press('Home');
    assert.equal((await side()).tab, 'outline');
    assert.equal(await pageValue(), 7, 'The arrows of the tabs do not turn the page');
    await click('#tab-pages');
    await goTo(1);
  });

  await test('The tab, the opening and the width are remembered for every book and after a restart', async () => {
    const handle = page.locator('#sidebar-resizer');
    await handle.focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    assert.deepEqual(await saved(), { sidebarOpen: true, sidebarTab: 'pages', sidebarWidth: 340 });
    await back();
    await openBook();
    assert.deepEqual(await side(), {
      hidden: false,
      width: 340,
      tab: 'pages',
      now: 340,
      max: 480,
      expanded: 'true',
    });
    await waitForDrawn(1);
    // Closing is remembered too.
    await page.locator('#viewer-container').focus();
    await page.keyboard.press('s');
    assert.equal((await side()).hidden, true);
    assert.deepEqual(await saved(), { sidebarOpen: false, sidebarTab: 'pages', sidebarWidth: 340 });
    await back();
    await openBook();
    assert.equal((await side()).hidden, true, 'It opens closed, as it was left');
    assert.equal((await side()).expanded, 'false');
    await page.locator('#viewer-container').focus();
    await page.keyboard.press('s');
    assert.deepEqual(await side(), {
      hidden: false,
      width: 340,
      tab: 'pages',
      now: 340,
      max: 480,
      expanded: 'true',
    });
    // Another book of the library opens the same way.
    await back();
    await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('folio.test.library'));
      data.books.push({ ...data.books[0], id: 'second-book', title: 'Outro livro' });
      localStorage.setItem('folio.test.library', JSON.stringify(data));
    });
    await page.reload();
    await page.waitForSelector('[data-open="second-book"]');
    await openBook('second-book');
    assert.deepEqual(await side(), {
      hidden: false,
      width: 340,
      tab: 'pages',
      now: 340,
      max: 480,
      expanded: 'true',
    });
    await waitForDrawn(1);
    await back();
    // And so does a new browser: the state is in the preferences, not in the page.
    const before = await prefs();
    await app.closeBrowser();
    page = await app.open();
    assert.deepEqual(await prefs(), before);
    await openBook();
    assert.deepEqual(await side(), {
      hidden: false,
      width: 340,
      tab: 'pages',
      now: 340,
      max: 480,
      expanded: 'true',
    });
    await waitForDrawn(1);
    return { browserRestart: true, personalDataUsed: false };
  });

  await test('The handle resizes with the mouse and the keyboard, saving only when it is released', async () => {
    await click('#tab-outline');
    const handle = page.locator('#sidebar-resizer');
    const start = (await side()).width;
    assert.equal(start, 340);
    const box = await handle.boundingBox();
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 60, y, { steps: 6 });
    let now = await side();
    assert.equal(now.width, 280, 'The bar follows the pointer');
    assert.equal(now.now, 280, 'and so does the value of the handle');
    assert.equal(await handle.evaluate((el) => el.classList.contains('dragging')), true);
    await page.mouse.move(x - 160, y, { steps: 6 });
    assert.equal((await side()).width, 220, 'down to its minimum');
    assert.equal((await saved()).sidebarWidth, 340, 'Nothing is saved while it moves');
    await page.mouse.move(x + 60, y, { steps: 6 });
    now = await side();
    assert.equal(now.width, 400, 'and then wider than it was');
    assert.equal((await saved()).sidebarWidth, 340, 'still nothing saved');
    await page.mouse.up();
    now = await side();
    assert.equal(now.width, 400);
    assert.equal((await saved()).sidebarWidth, 400, 'Saved when released');
    assert.equal(await handle.evaluate((el) => el.classList.contains('dragging')), false);
    // The limits.
    await page.mouse.move(now.width, y);
    await page.mouse.down();
    await page.mouse.move(1270, y, { steps: 8 });
    await page.mouse.up();
    assert.equal((await side()).width, 480);
    assert.equal((await saved()).sidebarWidth, 480);
    await page.mouse.move(480, y);
    await page.mouse.down();
    await page.mouse.move(2, y, { steps: 8 });
    await page.mouse.up();
    assert.equal((await side()).width, 220);
    assert.equal((await saved()).sidebarWidth, 220);
    // The keyboard, from the end of the tab order: with a visible focus.
    await page.locator('#tab-outline').focus();
    for (
      let i = 0;
      i < 40 && (await page.evaluate(() => document.activeElement.id)) !== 'sidebar-resizer';
      i++
    )
      await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'sidebar-resizer');
    const ring = await handle.evaluate((el) => {
      const style = getComputedStyle(el);
      return [style.outlineStyle, parseFloat(style.outlineWidth)];
    });
    assert.deepEqual(ring, ['solid', 2], 'A visible focus ring');
    const before = await pageValue();
    const widths = [];
    for (const key of [
      'ArrowRight',
      'ArrowRight',
      'Shift+ArrowRight',
      'ArrowLeft',
      'End',
      'Home',
    ]) {
      await page.keyboard.press(key);
      const [width, { sidebarWidth }, { now }] = await Promise.all([
        side().then((s) => s.width),
        saved(),
        side(),
      ]);
      assert.equal(sidebarWidth, width, `${key} is saved when the key is released`);
      assert.equal(now, width);
      widths.push(width);
    }
    assert.deepEqual(widths, [236, 252, 300, 284, 480, 220]);
    assert.equal(await pageValue(), before, 'The arrow keys of the handle do not turn the page');
    assert.equal(
      await handle.evaluate((el) => el.getAttribute('aria-valuetext')),
      '220 px',
      'A readable value',
    );
    await handle.evaluate((el) => el.blur());
  });

  await test('The reading position is kept when the width changes: scroll, two pages and Kindle', async () => {
    await page.locator('#zoom').selectOption('page-width');
    await settle(500);
    const wider = async () => {
      await page.locator('#sidebar-resizer').focus();
      await page.keyboard.press('End');
      await settle(900);
    };
    const narrower = async () => {
      await page.locator('#sidebar-resizer').focus();
      await page.keyboard.press('Home');
      await settle(900);
    };
    const keeps = async (label) => {
      const m0 = await place();
      await wider();
      const m1 = await place();
      assert.ok(m1.width < m0.width, `${label}: a wider bar leaves less to the PDF`);
      near(m1.at, m0.at, 0.06, `${label}: wider`);
      assert.equal(m1.fits, true, `${label}: the pages fit the width`);
      await narrower();
      const m2 = await place();
      assert.ok(m2.width > m1.width);
      near(m2.at, m0.at, 0.06, `${label}: narrower`);
      assert.equal(m2.fits, true);
      assert.deepEqual([m1.current, m2.current], [m0.current, m0.current], `${label}: the page`);
      return { page: m0.current, at: Number(m0.at.toFixed(2)) };
    };
    const found = {};
    await goTo(3);
    await page.locator('#viewer-container').evaluate((el) => (el.scrollTop += 300));
    await settle(700);
    found.scroll = await keeps('Scroll');
    await page.locator('#viewer-container').focus();
    await page.keyboard.press('l');
    await settle(900);
    await goTo(3);
    await page.locator('#viewer-container').evaluate((el) => (el.scrollTop += 200));
    await settle(700);
    found.pair = await keeps('Two pages');
    await page.keyboard.press('l');
    await settle(700);
    await click('#kindle-toggle');
    await settle(800);
    await goTo(3);
    await page.keyboard.press('ArrowRight');
    await settle(500);
    found.kindle = await keeps('Kindle');
    await click('#kindle-toggle');
    await settle(700);
    await goTo(1);
    await settle(300);
    assert.deepEqual(await bars(), NO_OVERFLOW);
    return found;
  });

  await test('At 800 px the bar is limited by the window, in both themes and every paper, without overflow', async () => {
    await page.locator('#sidebar-resizer').focus();
    await page.keyboard.press('End');
    assert.equal((await saved()).sidebarWidth, 480);
    await page.setViewportSize({ width: 800, height: 600 });
    await settle(900);
    const small = await side();
    assert.equal(small.width, 320, 'At most 40% of the window');
    assert.deepEqual([small.max, small.now], [320, 320]);
    assert.equal((await saved()).sidebarWidth, 480, 'The window does not change what was chosen');
    const m = await place();
    assert.ok(m.width >= 440, `The PDF keeps room to be read: ${m.width}`);
    assert.equal(m.fits, true, 'and the page fits in it');
    // The window only limits what is shown: a wide window shows the chosen width again.
    await page.setViewportSize({ width: 1280, height: 820 });
    await settle(800);
    assert.deepEqual([(await side()).width, (await side()).max], [480, 480]);
    await page.setViewportSize({ width: 800, height: 600 });
    await settle(800);
    assert.equal((await side()).width, 320);
    const choose = async (theme, paper) => {
      await click('#reader-settings');
      await page.locator('#pref-theme').selectOption(theme);
      await page.locator(`button[data-paper="${paper}"]`).click();
      await click('#close-settings');
      await settle(300);
    };
    for (const theme of ['light', 'dark']) {
      for (const paper of ['light', 'sepia', 'dark']) {
        await choose(theme, paper);
        await click('#tab-pages');
        await waitForDrawn(1);
        assert.deepEqual(await bars(), NO_OVERFLOW, `${theme}/${paper}`);
        assert.equal(await tabsFit(), true, `${theme}/${paper}: the tabs fit`);
        if (theme === 'dark' && paper !== 'light')
          await page.screenshot({ path: `test-results/sidebar/pages-800-${theme}-${paper}.png` });
      }
      await choose(theme, 'light');
      for (const tab of ['bookmarks', 'notes', 'pages', 'outline']) {
        await click(`#tab-${tab}`);
        assert.deepEqual(await bars(), NO_OVERFLOW, `${theme}/${tab}`);
        assert.equal(await tabsFit(), true, `${theme}/${tab}: the tabs fit`);
      }
      // The marks are visible in both themes: contrast of the text, the weight and a bar.
      await goTo(25);
      await settle(300);
      const section = (await contrasts()).outline;
      assert.ok(section.text >= 4.5, `${theme}: the section ${section.text}`);
      assert.ok(section.weight >= 600 && section.bar, `${theme}: more than color`);
      if (theme === 'dark')
        await page.screenshot({ path: 'test-results/sidebar/outline-800-dark.png' });
      await click('#tab-pages');
      await waitForDrawn(25);
      await settle(400); // the colors of a button change over a short transition
      const current = (await contrasts()).thumb;
      assert.ok(current.text >= 4.5, `${theme}: the page number ${current.text}`);
      assert.ok(current.frame >= 3, `${theme}: the frame ${current.frame}`);
      assert.ok(current.weight >= 600 && current.width >= 2, `${theme}: more than color`);
      await click('#tab-outline');
      await goTo(1);
    }
    // The narrowest bar: the four tabs still fit and the PDF has more room.
    await page.locator('#sidebar-resizer').focus();
    await page.keyboard.press('Home');
    await settle(500);
    assert.equal((await side()).width, 220);
    assert.equal(await tabsFit(), true);
    assert.deepEqual(await bars(), NO_OVERFLOW);
    // Hidden and shown again, and then in a wide window: the width chosen at 800 px stays.
    await page.locator('#viewer-container').focus();
    await page.keyboard.press('s');
    assert.deepEqual(await bars(), NO_OVERFLOW);
    await page.keyboard.press('s');
    assert.equal((await side()).width, 220);
    await page.setViewportSize({ width: 1280, height: 820 });
    await settle(800);
    const wide = await side();
    assert.deepEqual([wide.width, wide.max], [220, 480]);
    assert.deepEqual(await bars(), NO_OVERFLOW);
    // Back to the defaults for the next scenarios.
    await click('#reader-settings');
    await page.locator('#pref-theme').selectOption('light');
    await page.locator('button[data-paper="light"]').click();
    await click('#close-settings');
  });

  await test('The S key shows and hides the bar, but not while typing, and the focus is never lost', async () => {
    await page.locator('#viewer-container').focus();
    const state = async () => (await side()).hidden;
    assert.equal(await state(), false);
    await page.keyboard.press('s');
    assert.equal(await state(), true);
    await page.keyboard.press('S');
    assert.equal(await state(), false);
    // Typing in a field or choosing in a list is not a shortcut.
    await page.keyboard.press('Control+f');
    await page.locator('#find-input').focus();
    await page.keyboard.type('sss');
    assert.equal(await page.locator('#find-input').inputValue(), 'sss');
    await click('#find-close');
    await page.locator('#page-number').focus();
    await page.keyboard.press('s');
    await page.locator('#zoom').focus();
    await page.keyboard.press('s');
    await page.locator('#viewer-container').focus();
    assert.equal(await state(), false, 'Typing does not hide the bar');
    // Holding the key counts once.
    await page.keyboard.down('s');
    await page.keyboard.down('s');
    await page.keyboard.down('s');
    await page.keyboard.up('s');
    assert.equal(await state(), true);
    await page.keyboard.press('s');
    // Hidden with the focus inside: the reading surface takes it.
    await click('#tab-pages');
    await waitForDrawn(1);
    await page.locator('.thumb[data-page="1"]').focus();
    await page.keyboard.press('s');
    assert.equal(await state(), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'viewer-container');
    assert.equal((await thumbs()).canvases, 0, 'A hidden bar holds no drawing');
    await page.keyboard.press('s');
    await waitForDrawn(1);
    // The guide lists the key.
    await back();
    await click('#help');
    const guide = await page.locator('#dialog-content').textContent();
    assert.match(guide, /Mostrar ou esconder a barra lateral/);
    assert.equal(
      await page.locator('#dialog-content kbd', { hasText: /^S$/ }).count(),
      1,
      'The key is in the list of shortcuts',
    );
    await click('#close-help');
    assert.deepEqual(app.errors, []);
    assert.deepEqual(app.external, []);
  });
} catch (error) {
  console.error(error);
  console.log('Browser errors:', app.errors);
  await page?.screenshot({ path: 'test-results/sidebar/failure.png' });
  process.exitCode = 1;
} finally {
  await writeFile(
    'test-results/sidebar/results.json',
    JSON.stringify(
      { passed: !process.exitCode, results, errors: app.errors, nativeBoundarySimulated: true },
      null,
      2,
    ),
  );
  await app.close();
}
