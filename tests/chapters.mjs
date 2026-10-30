import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connectTestApp } from './support/native-app.mjs';

const { browser, page, api } = await connectTestApp();
const saved = await page.evaluate(() => localStorage.getItem('lume.preferences'));
const results = [],
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await mkdir('test-results/chapters', { recursive: true });
const fixture = path.resolve('tests/fixtures/Capitulos.pdf');
const hash = (data) => createHash('sha256').update(data).digest('hex');
const sourceHash = hash(await readFile(fixture));
const click = (id) => page.locator(id).click();
const settle = () => page.waitForTimeout(350);
const jump = async (number) => {
  await page.locator('#page-number').fill(String(number));
  await page.locator('#page-number').press('Enter');
  await page.locator('#page-number').blur();
  await settle();
};
const ready = async (number) => {
  await page.waitForFunction((n) => {
    const p = document.querySelector(`[data-page-number="${n}"]`);
    return (
      p?.dataset.margins === 'ready' &&
      p.querySelector('canvas')?.width &&
      p.querySelector('.textLayer span')
    );
  }, number);
  await settle();
};
const state = () =>
  page.evaluate(() => {
    const c = document.querySelector('#viewer-container'),
      bounds = c.getBoundingClientRect();
    const visible = Number(c.dataset.chapterVisibleHeight ?? c.clientHeight);
    const lines = [...document.querySelectorAll('.textLayer span')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return (
          el.textContent.trim() && r.top >= bounds.top - 1 && r.bottom <= bounds.top + visible + 1
        );
      })
      .map((el) => ({
        text: el.textContent,
        page: Number(el.closest('.page').dataset.pageNumber),
      }));
    return {
      top: c.scrollTop,
      height: c.clientHeight,
      visible,
      clip: c.style.clipPath,
      lines,
      pages: [...document.querySelectorAll('.page')].map((p) => ({
        id: Number(p.dataset.pageNumber),
        top: p.getBoundingClientRect().top - bounds.top,
        chapter: p.dataset.chapterStart === 'true',
      })),
    };
  });
const test = async (name, fn) => {
  const detail = await fn();
  results.push({ name, ok: true, detail });
  console.log('PASS', name, detail ?? '');
};
let book;
try {
  await api('import_pdfs', { paths: [fixture] });
  book = (await api('library_list')).books.find((b) => b.hash === sourceHash);
  await page.evaluate(() =>
    localStorage.setItem(
      'lume.preferences',
      JSON.stringify({
        readingMode: 'kindle',
        joinPages: true,
        chapterBreaks: true,
        resume: true,
      }),
    ),
  );
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.reload();
  await click(`[data-open="${book.id}"]`);
  await page.waitForFunction(() => document.querySelector('#reader-loading').hidden);
  await page.locator('#zoom').selectOption('1');
  await ready(1);
  await test('Outline title starts on its own screen after every preceding line was shown', async () => {
    const seen = new Set();
    let before;
    for (let i = 0; i < 12; i++) {
      const s = await state();
      for (const line of s.lines) if (line.text.startsWith('ANTERIOR')) seen.add(line.text);
      assert.ok(!(s.lines.some((l) => l.page === 1) && s.lines.some((l) => l.page === 2)));
      if (s.lines.some((l) => l.text === 'Uma nova viagem')) {
        assert.ok(Math.abs(s.pages[1].top) < 2, JSON.stringify(s.pages));
        assert.ok(s.lines.some((l) => l.text.startsWith('PAGINA 2')));
        break;
      }
      before = s.top;
      await click('#next');
      await settle();
    }
    assert.equal(seen.size, 24);
    assert.ok((await state()).lines.some((l) => l.text === 'Uma nova viagem'));
    await page.screenshot({ path: 'test-results/chapters/new-chapter.png' });
    await click('#previous');
    await settle();
    assert.ok(Math.abs((await state()).top - before) < 2);
    assert.ok((await state()).lines.some((l) => l.text.startsWith('ANTERIOR LINHA 24')));
    await page.screenshot({ path: 'test-results/chapters/previous-ending.png' });
    await click('#next');
    await settle();
    return { precedingLines: seen.size, titleAligned: true };
  });
  await test('Unmarked pages stay joined; explicit headings work without an outline', async () => {
    await jump(3);
    await ready(3);
    assert.equal((await state()).pages[2].chapter, false);
    for (let i = 0; i < 12; i++) {
      const s = await state();
      assert.ok(!(s.lines.some((l) => l.page === 3) && s.lines.some((l) => l.page === 4)));
      if (s.lines.some((l) => l.text === 'CAPITULO DOIS')) {
        assert.ok(Math.abs(s.pages[3].top) < 2);
        break;
      }
      await click('#next');
      await settle();
    }
    assert.ok((await state()).lines.some((l) => l.text === 'CAPITULO DOIS'));
  });
  await test('Chapter boundaries follow zoom and window size; short final chapters align', async () => {
    for (const zoom of ['1.5', '0.75']) {
      await page.locator('#zoom').selectOption(zoom);
      await page.setViewportSize({ width: zoom === '1.5' ? 1000 : 1280, height: 760 });
      await jump(5);
      await ready(5);
      for (let i = 0; i < 14; i++) {
        const s = await state();
        if (s.lines.some((l) => l.text === 'CAPITULO TRES')) {
          assert.ok(Math.abs(s.pages[5].top) < 2);
          break;
        }
        await click('#next');
        await settle();
      }
      assert.ok((await state()).lines.some((l) => l.text === 'CAPITULO TRES'));
      await ready(6);
      assert.ok(Math.abs((await state()).pages[5].top) < 2);
    }
  });
  await test('Preference is reversible, search works, title position resumes and PDF stays intact', async () => {
    await page.locator('#zoom').selectOption('1');
    await jump(2);
    await ready(2);
    await click('#previous');
    await settle();
    assert.notEqual((await state()).clip, '');
    await click('#reader-settings');
    await page.locator('#pref-chapter-breaks').uncheck();
    await click('#close-settings');
    assert.equal((await state()).clip, '');
    await click('#reader-settings');
    await page.locator('#pref-chapter-breaks').check();
    await click('#close-settings');
    await click('#find-toggle');
    await page.locator('#find-input').fill('Uma nova viagem');
    await page.waitForFunction(
      () => document.querySelector('#find-count').textContent === '1 de 1',
    );
    await click('#find-close');
    await jump(2);
    await ready(2);
    await page.waitForTimeout(700);
    const before = (await state()).top;
    await click('#back');
    await page.waitForFunction(() => document.activeElement?.id === 'library-search');
    await page.reload();
    await click(`[data-open="${book.id}"]`);
    await ready(2);
    assert.ok(Math.abs((await state()).top - before) < 3);
    assert.ok(Math.abs((await state()).pages[1].top) < 2);
    assert.equal(hash(await readFile(await api('pdf_path', { id: book.id }))), sourceHash);
    assert.deepEqual(errors, []);
  });
} catch (error) {
  console.error(error);
  console.log(JSON.stringify(await state()));
  await page.screenshot({ path: 'test-results/chapters/failure.png' });
  process.exitCode = 1;
} finally {
  if (await page.locator('#back').isVisible()) await click('#back');
  await page.waitForFunction(() => document.activeElement?.id === 'library-search');
  await page.evaluate(
    (p) =>
      p === null
        ? localStorage.removeItem('lume.preferences')
        : localStorage.setItem('lume.preferences', p),
    saved,
  );
  await writeFile(
    'test-results/chapters/results.json',
    JSON.stringify({ passed: !process.exitCode, results, errors }, null, 2),
  );
  await browser.close();
}
