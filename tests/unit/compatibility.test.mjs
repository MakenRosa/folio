import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PREFERENCES_KEY } from '../../src/preferences.ts';

test('public branding changes without moving installed storage or renaming the binary', async () => {
  const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
  const cargo = await readFile('src-tauri/Cargo.toml', 'utf8');
  assert.equal(config.productName, 'Fólio');
  assert.equal(config.app.windows[0].title, 'Fólio');
  assert.equal(config.identifier, 'com.lume.pdf');
  assert.equal(config.app.appDirectoriesOverride, undefined);
  assert.equal(PREFERENCES_KEY, 'lume.preferences');
  assert.match(cargo, /name = "lume-pdf"/);
});
