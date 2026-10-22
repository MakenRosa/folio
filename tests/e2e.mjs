import { connectTestApp } from './support/native-app.mjs';
import { readFile, writeFile, mkdir, copyFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = process.cwd();
await mkdir('test-results', { recursive: true });
await mkdir('tests/runtime', { recursive: true });
const { browser, page, api } = await connectTestApp();
const errors = [],
  external = [],
  results = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('request', (r) => {
  if (/^https?:/.test(r.url()) && !/^https?:\/\/(tauri|asset|ipc)\.localhost/.test(r.url()))
    external.push(r.url());
});
const test = async (name, fn) => {
  const start = performance.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Math.round(performance.now() - start), detail });
    console.log('PASS', name, detail || '');
  } catch (e) {
    results.push({ name, ok: false, error: String(e) });
    throw e;
  }
};
const click = async (s) => {
  await page.locator(s).click();
};
let book, longBook;
try {
  await page.waitForSelector('#library-title');
  await page.evaluate(() => localStorage.removeItem('lume.preferences'));
  await page.reload();
  await page.waitForSelector('#library-title');
  await page.screenshot({ path: 'test-results/01-library-empty.png' });
  await test('Biblioteca inicialmente vazia e layout sem overflow', async () => {
    const s = await api('library_list');
    assert.equal(s.books.length, 0, 'Use a biblioteca de desenvolvimento vazia');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  });
  await test('Importar varios PDFs com copia independente, erro parcial e deduplicacao', async () => {
    const original = path.join(root, 'tests/runtime/Origem temporaria.pdf');
    await copyFile('tests/fixtures/Caderno de leitura.pdf', original);
    const expected = createHash('sha256')
      .update(await readFile(original))
      .digest('hex');
    const r = await api('import_pdfs', {
      paths: [
        original,
        path.join(root, 'tests/fixtures/Livro extenso - 300 paginas.pdf'),
        path.join(root, 'tests/fixtures/Invalido.pdf'),
      ],
    });
    assert.equal(r.added.length, 2);
    assert.equal(r.errors.length, 1);
    book = r.added.find((b) => b.originalName === 'Origem temporaria.pdf');
    longBook = r.added.find((b) => b.id !== book.id);
    const stored = await api('pdf_path', { id: book.id });
    assert.notEqual(stored, original);
    assert.equal(
      createHash('sha256')
        .update(await readFile(stored))
        .digest('hex'),
      expected,
    );
    assert.equal((await api('import_pdfs', { paths: [original] })).duplicates, 1);
    await unlink(original);
    await api('update_book', { id: book.id, patch: { title: 'Caderno de leitura' } });
    await page.reload();
    await page.waitForSelector(`[data-open="${book.id}"]`);
    return { copiedHashVerified: true, originalRemovedBeforeReading: true };
  });
  await test('Abrir PDF, renderizar texto e capa', async () => {
    await click(`[data-open="${book.id}"]`);
    await page.waitForFunction(
      () =>
        document.querySelector('#reader-loading')?.hidden &&
        document.querySelector('.page canvas')?.width > 0,
    );
    await page.waitForFunction(() =>
      document.querySelector('.textLayer')?.textContent.includes('tempo'),
    );
    assert.equal(await page.locator('#page-total').textContent(), '/ 12');
    await page.screenshot({ path: 'test-results/02-reader-light.png' });
    return { pages: 12 };
  });
  await test('Busca encontra texto e navega resultados', async () => {
    await click('#find-toggle');
    await page.locator('#find-input').fill('biblioteca');
    await page.waitForFunction(() =>
      /de [1-9]/.test(document.querySelector('#find-count')?.textContent || ''),
    );
    const count = await page.locator('#find-count').textContent();
    await click('#find-next');
    await click('#find-close');
    return count;
  });
  await test('Pagina, zoom, rotacao, marcador e nota persistentes', async () => {
    await page.locator('#page-number').fill('7');
    await page.locator('#page-number').press('Enter');
    await page.locator('#page-number').blur();
    await page.waitForFunction(() => document.querySelector('#page-number').value === '7');
    await page.locator('#zoom').selectOption('1.25');
    await click('#rotate');
    await click('#bookmark');
    await click('#add-note');
    await page.locator('#note-text').fill('Uma ideia importante na pagina sete.');
    await click('#save-note');
    await page.waitForFunction(() => !document.querySelector('#dialog').open);
    await click('#reader-favorite');
    await click('#back');
    const b = (await api('library_list')).books.find((b) => b.id === book.id);
    assert.equal(b.page, 7);
    assert.equal(b.zoom, '1.25');
    assert.equal(b.rotation, 90);
    assert.ok(b.bookmarks.includes(7));
    assert.equal(b.notes[0].text, 'Uma ideia importante na pagina sete.');
    assert.equal(b.favorite, true);
    return { page: b.page, zoom: b.zoom, rotation: b.rotation, notes: b.notes.length };
  });
  await test('Retomada apos recarregar a aplicacao', async () => {
    await page.reload();
    await page.waitForSelector(`[data-open="${book.id}"]`);
    await click(`[data-open="${book.id}"]`);
    await page.waitForFunction(() => document.querySelector('#reader-loading').hidden);
    assert.equal(await page.locator('#page-number').inputValue(), '7');
    assert.equal(await page.locator('#zoom').inputValue(), '1.25');
    await click('#sidebar-toggle');
    await click('[data-tab="notes"]');
    assert.match(await page.locator('#sidebar-content').textContent(), /Uma ideia importante/);
    await click('#sidebar-toggle');
  });
  await test('Papel escuro, sepia, tela quente e preferencias persistentes', async () => {
    await click('#reader-settings');
    await click('[data-paper="dark"]');
    await page.locator('#warm-range').fill('35');
    await page.locator('#warm-range').dispatchEvent('input');
    await page.locator('#pref-theme').selectOption('dark');
    await click('#close-settings');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.paper), 'dark');
    assert.equal(
      await page.evaluate(() => document.querySelector('#warm-overlay').style.opacity),
      '0.35',
    );
    await page.screenshot({ path: 'test-results/03-reader-night.png' });
    await click('#reader-settings');
    await click('[data-paper="sepia"]');
    await click('#close-settings');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.paper), 'sepia');
    await click('#back');
    await page.reload();
    await page.waitForSelector('#library-title');
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem('lume.preferences')).warm),
      35,
    );
  });
  await test('Filtros de favoritos e busca de titulo', async () => {
    await click('[data-filter="favorites"]');
    assert.equal(await page.locator('.book-card').count(), 1);
    await page.locator('#library-search').fill('nao existe aqui');
    assert.equal(await page.locator('.book-card').count(), 0);
    await page.locator('#library-search').fill('');
    await click('[data-filter="all"]');
    await click('#view-list');
    assert.equal(await page.locator('#books').getAttribute('class'), 'book-list');
    await click('#view-grid');
  });
  await test('Remover e restaurar preserva o arquivo e as notas', async () => {
    const stored = await api('pdf_path', { id: book.id });
    await api('remove_book', { id: book.id });
    assert.ok((await readFile(stored)).length);
    await page.reload();
    await page.waitForSelector('#library-title');
    await click('[data-filter="trash"]');
    await click(`[data-restore="${book.id}"]`);
    await click('[data-filter="all"]');
    const b = (await api('library_list')).books.find((b) => b.id === book.id);
    assert.equal(b.notes.length, 1);
    assert.equal(b.page, 7);
  });
  await test('Documento de 300 paginas com limite de canvases ativos', async () => {
    await click(`[data-open="${longBook.id}"]`);
    await page.waitForFunction(() => document.querySelector('#reader-loading').hidden);
    await page.locator('#page-number').fill('285');
    await page.locator('#viewer-container').evaluate((e) => (e.scrollTop += 2));
    await page.waitForTimeout(200);
    assert.equal(
      await page.locator('#page-number').inputValue(),
      '285',
      'Viewport updates must preserve the page-number draft',
    );
    await page.locator('#page-number').press('Enter');
    await page.locator('#page-number').blur();
    await page.waitForFunction(
      () =>
        document.querySelector('#page-number').value === '285' &&
        document.querySelector('[data-page-number="285"] canvas')?.width > 0,
    );
    await page.waitForTimeout(1000);
    const metrics = await page.evaluate(() => ({
      pages: document.querySelectorAll('.pdfViewer .page').length,
      activeCanvases: [...document.querySelectorAll('.pdfViewer canvas')].filter((c) => c.width > 0)
        .length,
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    }));
    assert.ok(metrics.activeCanvases <= 12, JSON.stringify(metrics));
    await click('#focus');
    assert.equal(
      await page.locator('body').evaluate((e) => e.classList.contains('focus-mode')),
      true,
    );
    await click('#exit-focus');
    await click('#back');
    return metrics;
  });
  await test('Senha incorreta, correta e cancelamento', async () => {
    const r = await api('import_pdfs', {
      paths: [path.join(root, 'tests/fixtures/Documento protegido.pdf')],
    });
    const protectedBook = r.added[0];
    await page.reload();
    await page.waitForSelector(`[data-open="${protectedBook.id}"]`);
    await click(`[data-open="${protectedBook.id}"]`);
    await page.waitForSelector('#password-input');
    await page.locator('#password-input').fill('wrong');
    await click('#password-submit');
    await page.waitForSelector('#password-input');
    await page.locator('#password-input').fill('lume-teste');
    await click('#password-submit');
    await page.waitForFunction(() => document.querySelector('#reader-loading').hidden);
    assert.equal(await page.locator('#page-total').textContent(), '/ 12');
    await click('#back');
    await click(`[data-open="${protectedBook.id}"]`);
    await page.waitForSelector('#password-input');
    await click('#close-password');
    await page.waitForFunction(() => !document.querySelector('#library').hidden);
  });
  await test('PDF corrompido exibe erro e permite continuar usando', async () => {
    const r = await api('import_pdfs', {
      paths: [path.join(root, 'tests/fixtures/Corrompido.pdf')],
    });
    await page.reload();
    await page.waitForSelector(`[data-open="${r.added[0].id}"]`);
    await click(`[data-open="${r.added[0].id}"]`);
    await page.waitForFunction(() => !document.querySelector('#library').hidden);
    await page.waitForFunction(() =>
      /possível abrir/.test(document.querySelector('#toast').textContent),
    );
  });
  await test('Layout em janela minima de 800 px', async () => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.screenshot({ path: 'test-results/04-library-800.png' });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await click(`[data-open="${book.id}"]`);
    await page.waitForFunction(() => document.querySelector('#reader-loading').hidden);
    assert.equal(
      await page.evaluate(() => document.querySelector('.reader-toolbar').scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: 'test-results/05-reader-800.png' });
    await click('#back');
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.screenshot({ path: 'test-results/06-library-populated.png' });
  });
  await test('Sem erros JavaScript ou requisicoes externas', async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    return { javascriptErrors: 0, externalRequests: 0 };
  });
} catch (e) {
  console.error(e);
  await page.screenshot({ path: 'test-results/failure.png' });
  process.exitCode = 1;
} finally {
  await writeFile(
    'test-results/results.json',
    JSON.stringify({ date: new Date().toISOString(), results, errors, external }, null, 2),
  );
  await browser.close();
}
