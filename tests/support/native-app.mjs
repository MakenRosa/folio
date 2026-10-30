import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

export async function connectTestApp() {
  const { FOLIO_TEST_LIBRARY: expected, FOLIO_CDP_URL: endpoint } = process.env;
  assert.ok(expected && endpoint, 'Start native tests with npm run test:native.');
  assert.match(endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
  const root = path.resolve('test-results/native');
  const library = path.resolve(expected);
  assert.ok(library.startsWith(root + path.sep) && path.basename(library) === 'development');
  const marker = JSON.parse(await readFile(path.join(library, '../../owner.json'), 'utf8'));
  assert.equal(marker.purpose, 'folio-artificial-pdf-tests');
  const browser = await chromium.connectOverCDP(endpoint);
  try {
    const page = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes('tauri.localhost'));
    assert.ok(page, 'The isolated native reader must be ready.');
    const api = (command, args = {}) =>
      page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
        command,
        args,
      });
    const snapshot = await api('library_list');
    assert.equal(path.resolve(snapshot.folder).toLowerCase(), library.toLowerCase());
    // The window fits itself to the screen, which is smaller on a CI runner than on a desktop.
    // Every suite starts from the same layout; the ones that test other sizes set their own.
    await page.setViewportSize({ width: 1280, height: 820 });
    return { browser, page, api };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
