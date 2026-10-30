import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { headlessApp } from './support/headless-app.mjs';

const app = await headlessApp();
const results = [];
let page;
await mkdir('test-results/reader-chrome', { recursive: true });
const settle = (ms = 250) => page.waitForTimeout(ms);
const click = (selector) => page.locator(selector).click();
// The preferences open on the section that was used last: each test picks the one it needs.
const section = (name) => click(`#prefs-tab-${name}`);
// What the reader has no button for is in the menu of the document (⋯): the preferences, "Ler do
// início" and "Girar página".
const menu = async (action) => {
  await click('#reader-more');
  await click(`#popover [data-action="${action}"]`);
};
const range = (selector, value) =>
  page.locator(selector).evaluate((el, value) => {
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
const openBook = async () => {
  await click('[data-open="artificial-chapters"]');
  await page.waitForFunction(
    () =>
      document.querySelector('#reader-loading').hidden &&
      document.querySelector('.page canvas')?.width > 0,
  );
  await settle(500);
};
const geometry = () =>
  page.evaluate(() => {
    const rect = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height, width: r.width };
    };
    return {
      top: rect('.reader-top'),
      bottom: rect('.reader-footer'),
      pdf: rect('#viewer-container'),
      scroll: document.querySelector('#viewer-container').scrollTop,
      full: document.body.classList.contains('reader-fullscreen'),
      width: innerWidth,
      height: innerHeight,
    };
  });
const test = async (name, fn) => {
  const detail = await fn();
  results.push({ name, ok: true, detail });
  console.log('PASS', name, detail || '');
};
try {
  page = await app.open();
  await openBook();
  await test('Aparência adjusts the real PDF appearance and synchronizes with preferences', async () => {
    assert.equal(await page.locator('#focus, #exit-focus').count(), 0);
    const adjusted = () => page.locator('#reader-appearance').getAttribute('data-adjusted');
    const name = () => page.locator('#reader-appearance').getAttribute('aria-label');
    assert.equal(
      await adjusted(),
      null,
      'No dot while the brightness and the warm screen are as they were',
    );
    assert.equal(await name(), 'Aparência: papel, brilho e tela quente');
    await click('#reader-appearance');
    assert.equal(await page.locator('#popover').getAttribute('role'), 'dialog');
    assert.equal(await page.locator('#reader-appearance').getAttribute('aria-expanded'), 'true');
    await range('#quick-brightness', 55);
    assert.equal(await adjusted(), '', 'A dot on the icon when the brightness is below 100%');
    assert.equal(await name(), 'Aparência: brilho 55%');
    await click('#quick-brightness-reset');
    assert.equal(await page.locator('#quick-brightness-value').textContent(), '100%');
    assert.equal(await adjusted(), null);
    await range('#quick-brightness', 55);
    await page.locator('#quick-brightness').press('ArrowLeft');
    assert.equal(await page.locator('#quick-brightness-value').textContent(), '50%');
    assert.equal(
      await page.locator('#brightness-overlay').evaluate((el) => el.style.opacity),
      '0.5',
    );
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#reader-appearance').getAttribute('aria-expanded'), 'false');
    await click('#reader-appearance');
    await range('#quick-warm', 70);
    assert.equal(await name(), 'Aparência: brilho 50%, tela quente 70%');
    await page.keyboard.press('Escape');
    await menu('preferences');
    await section('aparencia');
    assert.equal(await page.locator('#warm-range').inputValue(), '70');
    await click('#close-settings');
    await click('#reader-appearance');
    await click('#quick-warm-reset');
    assert.equal(await page.locator('#quick-warm-value').textContent(), '0%');
    await range('#quick-warm', 35);
    assert.equal(await page.locator('#warm-overlay').evaluate((el) => el.style.opacity), '0.35');
    await page.keyboard.press('Escape');
    // "Mais preferências…" opens the Preferências on Aparência, whichever section was used last.
    await menu('preferences');
    await section('leitura');
    await click('#close-settings');
    await click('#reader-appearance');
    await click('#quick-more');
    assert.equal(await page.locator('#popover').isHidden(), true);
    assert.equal(await page.locator('#prefs-tab-aparencia').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#brightness-range').inputValue(), '50');
    assert.equal(await page.locator('#warm-range').inputValue(), '35');
    await page.locator('#pref-theme').selectOption('dark');
    await section('leitura');
    await page.locator('#pref-reading-mode').selectOption('kindle');
    await click('#close-settings');
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      'reader-appearance',
      'The focus returns to the button that opened the preferences',
    );
    await page.screenshot({ path: 'test-results/reader-chrome/toolbar.png' });
  });
  await test('Aparência panel: papers, D key, keyboard and Tab', async () => {
    const paper = () => page.evaluate(() => document.documentElement.dataset.paper);
    const pressed = (name) =>
      page.locator(`[data-quick-paper="${name}"]`).getAttribute('aria-pressed');
    const top = () => page.locator('#viewer-container').evaluate((el) => el.scrollTop);
    await page.locator('#reader-appearance').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#popover').getAttribute('aria-labelledby'), 'quick-label');
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.quickPaper),
      'light',
      'The focus starts on the paper that is on',
    );
    assert.equal(await pressed('light'), 'true');
    const before = await top();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.quickPaper), 'sepia');
    assert.equal(await top(), before, 'The arrows of a button in the panel do not turn the screen');
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.quickPaper), 'dark');
    await page.keyboard.press('Enter');
    assert.equal(await paper(), 'dark');
    assert.equal(await pressed('dark'), 'true');
    assert.equal(await pressed('light'), 'false');
    // D goes on round the papers while the panel is open, and the panel follows.
    await page.keyboard.press('d');
    assert.equal(await paper(), 'light');
    assert.equal(await pressed('light'), 'true');
    await click('[data-quick-paper="sepia"]');
    assert.equal(await paper(), 'sepia');
    await click('[data-quick-paper="light"]');
    assert.equal(await paper(), 'light');
    // Tab leaves the panel from its last control: it closes and the focus goes on from the button.
    await page.locator('#quick-more').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#popover').isHidden(), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'fullscreen');
    await page.locator('#reader-appearance').focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'reader-appearance');
    // D without the panel: the three papers in turn, and back where it was.
    await page.locator('#viewer-container').focus();
    for (const next of ['sepia', 'dark', 'light']) {
      await page.keyboard.press('d');
      assert.equal(await paper(), next);
    }
  });
  await test('Header, toolbar and menu ⋯ hold what the reader needs, in order', async () => {
    const buttons = (selector) =>
      page
        .locator(selector)
        .evaluate((root) => [...root.querySelectorAll('button')].map((b) => b.id));
    assert.deepEqual(await buttons('.reader-header'), [
      'back',
      'finish-reading',
      'reader-favorite',
      'reader-more',
    ]);
    assert.deepEqual(await buttons('.reader-toolbar .toolbar-group:first-child'), [
      'sidebar-toggle',
      'find-toggle',
      'previous',
      'next',
    ]);
    assert.deepEqual(await buttons('.reader-toolbar .toolbar-group:last-child'), [
      'zoom-out',
      'zoom-in',
      'kindle-toggle',
      'spread-toggle',
      'bookmark',
      'reader-appearance',
      'fullscreen',
    ]);
    assert.deepEqual(await buttons('.reader-footer'), ['reader-goal', 'add-note']);
    assert.equal(
      await page
        .locator(
          '#reader-settings, #paper-toggle, #reading-brightness, #reading-warm, #rotate, #restart',
        )
        .count(),
      0,
      'What moved to the menu or to Aparência has no button left in the bars',
    );
    await click('#reader-more');
    const structure = await page
      .locator('#popover')
      .evaluate((menu) =>
        [...menu.children].map((el) => (el.tagName === 'HR' ? '|' : el.dataset.action)).join(' '),
      );
    assert.equal(
      structure,
      'restart rotate | goal rename tags export export-notes | preferences help | remove',
    );
    assert.equal(await page.locator('#popover [data-action="finish"]').count(), 0);
    const names = await page
      .locator('#popover [role="menuitem"]')
      .evaluateAll((items) => items.map((item) => item.firstChild.nextSibling.textContent.trim()));
    assert.deepEqual(names, [
      'Ler do início',
      'Girar página',
      'Meta de leitura…',
      'Renomear na biblioteca…',
      'Etiquetas…',
      'Exportar uma cópia…',
      'Exportar notas…',
      'Preferências…',
      'Guia e atalhos…',
      'Remover da biblioteca',
    ]);
    assert.equal(await page.locator('#popover [data-action="rotate"] kbd').textContent(), 'R');
    assert.equal(await page.locator('#popover [data-action="help"] kbd').textContent(), 'F1');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'reader-more');
  });
  await test('Girar página: the R key and the menu turn it, with Desfazer', async () => {
    const stored = (value) =>
      page.waitForFunction(
        (value) =>
          JSON.parse(localStorage.getItem('folio.test.library')).books[0].rotation === value,
        value,
      );
    await page.locator('#viewer-container').focus();
    await page.keyboard.press('r');
    await stored(90);
    await page.locator('.toast-action', { hasText: 'Desfazer' }).last().click();
    await stored(0);
    await menu('rotate');
    await stored(90);
    assert.match(await page.locator('#toast').textContent(), /Páginas giradas/);
    await page.locator('.toast-action', { hasText: 'Desfazer' }).last().click();
    await stored(0);
  });
  await test('Fullscreen hides both bars; edge hover reveals each without moving the PDF', async () => {
    await click('#fullscreen');
    await page.mouse.move(640, 410);
    await settle(850);
    const hidden = await geometry();
    assert.equal(hidden.full, true);
    assert.ok(hidden.top.bottom <= 1);
    assert.ok(hidden.bottom.top >= hidden.height - 1);
    assert.equal(hidden.pdf.top, 0);
    assert.equal(hidden.pdf.height, hidden.height);
    assert.equal(await page.locator('#fullscreen').getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: 'test-results/reader-chrome/fullscreen-hidden.png' });
    await page.mouse.move(640, 1);
    await settle();
    const shown = await geometry();
    assert.equal(shown.top.top, 0);
    assert.deepEqual(shown.pdf, hidden.pdf);
    assert.equal(shown.scroll, hidden.scroll);
    assert.ok(shown.bottom.top >= shown.height - 1);
    await click('#reader-appearance');
    await range('#quick-brightness', 45);
    await page.mouse.move(640, 410);
    await settle(850);
    assert.equal((await geometry()).top.top, 0, 'Keep the bar while the Aparência panel is open');
    await page.screenshot({ path: 'test-results/reader-chrome/fullscreen-controls.png' });
    await page.keyboard.press('Escape');
    assert.equal((await geometry()).full, true, 'First Escape closes the panel');
    await page.mouse.click(700, 410);
    await settle(850);
    assert.ok((await geometry()).top.bottom <= 1);
    await page.mouse.move(640, 819);
    await settle();
    assert.ok((await geometry()).bottom.top < 819);
    assert.ok((await geometry()).top.bottom <= 1);
    await page.mouse.move(640, 410);
    await settle(850);
    assert.ok((await geometry()).bottom.top >= 819);
  });
  await test('Keyboard and search keep controls accessible; Escape and F11 restore the bars', async () => {
    await page.locator('#viewer-container').focus();
    await page.keyboard.press('Shift+Tab');
    await settle();
    assert.equal((await geometry()).top.top, 0);
    await settle(850);
    assert.equal((await geometry()).top.top, 0);
    await page.keyboard.press('Control+f');
    await settle();
    await page.locator('#find-input').fill('preservado');
    await page.waitForFunction(() =>
      /de [1-9]/.test(document.querySelector('#find-count').textContent),
    );
    await page.mouse.move(600, 410);
    await settle(850);
    assert.equal((await geometry()).top.top, 0);
    await page.keyboard.press('Escape');
    assert.equal((await geometry()).full, true);
    await page.keyboard.press('Escape');
    await settle();
    assert.equal((await geometry()).full, false);
    assert.equal((await geometry()).top.top, 0);
    assert.ok((await geometry()).pdf.top > 0);
    assert.ok((await geometry()).bottom.top < 820);
    await page.keyboard.press('F11');
    await settle();
    assert.equal((await geometry()).full, true);
    await page.keyboard.press('F11');
    await settle();
    assert.equal((await geometry()).full, false);
    await page.keyboard.press('F8');
    assert.equal((await geometry()).full, false);
    for (const value of [true, false]) {
      await page.evaluate(
        (value) =>
          window.__TAURI_INTERNALS__.invoke('plugin:window|set_fullscreen', {
            label: 'main',
            value,
          }),
        value,
      );
      await settle();
      assert.equal((await geometry()).full, value, 'Follow native resize notifications');
    }
  });
  await test('All toolbar actions remain reachable at 800px; reduced motion is respected', async () => {
    await page.setViewportSize({ width: 800, height: 600 });
    await settle();
    // Nothing spills: the content of each bar is as wide as the bar.
    assert.deepEqual(
      await page.evaluate(() =>
        ['.reader-header', '.reader-toolbar', '.reader-footer'].filter((s) => {
          const bar = document.querySelector(s);
          return bar.scrollWidth !== bar.clientWidth;
        }),
      ),
      [],
    );
    assert.ok(await page.locator('#fullscreen').isVisible());
    // Every control of the bars is in the window.
    for (const selector of [
      '#sidebar-toggle',
      '#find-toggle',
      '#previous',
      '#page-number',
      '#next',
      '#zoom-out',
      '#zoom',
      '#zoom-in',
      '#kindle-toggle',
      '#spread-toggle',
      '#bookmark',
      '#reader-appearance',
      '#fullscreen',
      '#finish-reading',
      '#reader-favorite',
      '#reader-more',
    ]) {
      const r = await page.locator(selector).boundingBox();
      assert.ok(r && r.x >= 0 && r.x + r.width <= 800, `${selector} is inside the window`);
    }
    await click('#reader-appearance');
    assert.ok(await page.locator('#quick-brightness').isVisible());
    assert.ok(await page.locator('#quick-warm').isVisible());
    const panel = await page.locator('#popover').boundingBox();
    assert.ok(panel.x >= 0 && panel.x + panel.width <= 800 && panel.y + panel.height <= 600);
    await page.keyboard.press('Escape');
    await click('#reader-more');
    const list = await page.locator('#popover').boundingBox();
    assert.ok(list.x >= 0 && list.x + list.width <= 800 && list.y + list.height <= 600);
    await page.keyboard.press('Escape');
    await page.screenshot({ path: 'test-results/reader-chrome/toolbar-800.png' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.keyboard.press('F11');
    await settle();
    assert.equal(
      await page.locator('.reader-top').evaluate((el) => getComputedStyle(el).transitionDuration),
      '0s',
    );
    await page.keyboard.press('Escape');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1280, height: 820 });
  });
  await test('Dark theme, Kindle, comfort and library preferences survive a browser process restart', async () => {
    await page.locator('#page-number').fill('2');
    await page.locator('#page-number').press('Enter');
    await page.locator('#page-number').blur();
    await settle(900);
    await page.keyboard.press('F11');
    await settle();
    assert.equal((await geometry()).full, true);
    await page.keyboard.press('Control+w');
    await page.waitForSelector('#library-search:focus');
    assert.equal((await geometry()).full, false, 'Returning to the library exits fullscreen');
    await click('#view-list');
    await page.locator('#sort').selectOption('title');
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('lume.preferences')));
    assert.equal(before.theme, 'dark');
    assert.equal(before.readingMode, 'kindle');
    assert.equal(before.brightness, 45);
    assert.equal(before.warm, 35);
    await app.closeBrowser();
    page = await app.open();
    assert.deepEqual(
      await page.evaluate(() => JSON.parse(localStorage.getItem('lume.preferences'))),
      before,
    );
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.ok(await page.locator('.book-list').isVisible());
    await openBook();
    assert.equal(await page.locator('#kindle-toggle').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#reader-appearance').getAttribute('data-adjusted'), '');
    assert.equal(
      await page.locator('#reader-appearance').getAttribute('aria-label'),
      'Aparência: brilho 45%, tela quente 35%',
    );
    await click('#reader-appearance');
    assert.equal(await page.locator('#quick-brightness-value').textContent(), '45%');
    assert.equal(await page.locator('#quick-warm-value').textContent(), '35%');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#page-number').inputValue(), '2');
    assert.deepEqual(app.errors, []);
    assert.deepEqual(app.external, []);
    return { nativeWindowSimulated: true, browserRestart: true, personalDataUsed: false };
  });
} catch (error) {
  console.error(error);
  console.log('Browser errors:', app.errors);
  await page?.screenshot({ path: 'test-results/reader-chrome/failure.png' });
  process.exitCode = 1;
} finally {
  await writeFile(
    'test-results/reader-chrome/results.json',
    JSON.stringify(
      { passed: !process.exitCode, results, errors: app.errors, nativeWindowSimulated: true },
      null,
      2,
    ),
  );
  await app.close();
}
