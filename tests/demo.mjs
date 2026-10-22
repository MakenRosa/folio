import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { connectTestApp } from './support/native-app.mjs';

// This helper rejects any profile outside the owned artificial-PDF test folder.
const { browser, page, api } = await connectTestApp();
try {
  await mkdir('docs/media', { recursive: true });
  const snapshot = await api('library_list');
  const book = snapshot.books.find((b) => b.title === 'Caderno de leitura');
  assert.ok(book);
  for (const item of snapshot.books) {
    if (
      item.id !== book.id &&
      !item.title.includes('300') &&
      !item.title.includes('digitalizado')
    ) {
      await api('remove_book', { id: item.id });
    }
  }
  await api('update_book', {
    id: book.id,
    patch: { page: 3, rotation: 0, zoom: 'page-width', favorite: true },
  });
  await page.evaluate(() =>
    localStorage.setItem(
      'lume.preferences',
      JSON.stringify({
        theme: 'light',
        paper: 'light',
        warm: 0,
        brightness: 100,
        resume: true,
        view: 'grid',
        sort: 'recent',
        readingMode: 'kindle',
      }),
    ),
  );
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.reload();
  await page.locator(`[data-open="${book.id}"]`).waitFor();
  await page.screenshot({ path: 'docs/media/biblioteca.png' });
  await page.locator(`[data-open="${book.id}"]`).click();
  await page.waitForFunction(() => document.querySelector('#reader-loading').hidden);
  await page.locator('#restart').click();
  await page.locator('#zoom').selectOption('1.25');
  await page.waitForTimeout(400);
  await page.locator('#next').click();
  await page.waitForTimeout(400);
  await page.locator('#next').click();
  await page.locator('#toast').waitFor({ state: 'hidden' });
  await page.screenshot({ path: 'docs/media/leitura.png' });
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.locator('#reader-settings').click();
  for (const [selector, value] of [
    ['#brightness-range', '70'],
    ['#warm-range', '20'],
  ]) {
    await page.locator(selector).fill(value);
    await page.locator(selector).dispatchEvent('input');
  }
  await page.locator('#dialog').evaluate((dialog) => {
    dialog.scrollTop = 0;
  });
  await page.screenshot({
    path: 'docs/media/conforto.png',
    style: '.settings-folder code { visibility: hidden !important; }',
  });
  console.log('Demo captured using only artificial documents.');
  try {
    await api('plugin:window|close', { label: 'main' });
  } catch {
    /* Window closed. */
  }
} finally {
  await browser.close();
}
