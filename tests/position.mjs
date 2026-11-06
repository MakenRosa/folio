import { connectTestApp } from './support/native-app.mjs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { browser, page, api } = await connectTestApp();
const snapshot = await api('library_list');
const book = snapshot.books.find((b) => b.title === 'Caderno de leitura');
await api('update_book', {
  id: book.id,
  patch: { page: 5, rotation: 0, zoom: '1', top: 700, left: 0 },
});
await page.reload();
await page.waitForSelector(`[data-open="${book.id}"]`);
await page.locator(`[data-open="${book.id}"]`).click();
await page.waitForFunction(
  () =>
    document.querySelector('#reader-loading').hidden &&
    document.querySelector('#page-total').textContent === '/ 12',
);
await page.waitForTimeout(300);
await page.locator('#viewer-container').evaluate((el) => (el.scrollTop += 157));
await page.waitForTimeout(700);
const before = await page.locator('#viewer-container').evaluate((el) => el.scrollTop);
const stored = (await api('library_list')).books.find((b) => b.id === book.id);
await page.locator('#back').click();
await page.locator(`[data-open="${book.id}"]`).click();
await page.waitForFunction(() => document.querySelector('#reader-loading').hidden);
await page.waitForTimeout(300);
const after = await page.locator('#viewer-container').evaluate((el) => el.scrollTop);
assert.ok(Math.abs(before - after) < 4, JSON.stringify({ before, after, stored }));
await page.locator('#reader-more').click();
await page.locator('#popover [data-action="preferences"]').click();
await page.locator('#prefs-tab-leitura').click();
await page.locator('#pref-resume').uncheck();
await page.locator('#close-settings').click();
await page.locator('#back').click();
await page.locator(`[data-open="${book.id}"]`).click();
await page.waitForFunction(() => document.querySelector('#reader-loading').hidden);
assert.equal(await page.locator('#page-number').inputValue(), '1');
await page.locator('#reader-more').click();
await page.locator('#popover [data-action="preferences"]').click();
await page.locator('#prefs-tab-leitura').click();
await page.locator('#pref-resume').check();
await page.locator('#close-settings').click();
await page.locator('#back').click();
const report = {
  position: { before, after, delta: Math.abs(before - after), page: stored.page, top: stored.top },
  resumeOptOut: true,
};
await writeFile('test-results/position.json', JSON.stringify(report, null, 2));
console.log(report);
await browser.close();
