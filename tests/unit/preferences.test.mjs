import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadPreferences,
  normalizePreferences,
  savePreferences,
  PREFERENCES_KEY,
} from '../../src/preferences.ts';

test('existing installation settings survive the rename and receive additive defaults', () => {
  const old = {
    theme: 'dark',
    paper: 'sepia',
    warm: 35,
    resume: false,
    view: 'list',
    sort: 'title',
  };
  const prefs = loadPreferences({
    getItem: (key) => {
      assert.equal(key, 'lume.preferences');
      return JSON.stringify(old);
    },
  });
  for (const [key, value] of Object.entries(old)) assert.equal(prefs[key], value);
  assert.equal(prefs.brightness, 100);
  assert.equal(prefs.readingMode, 'scroll');
  let saved;
  savePreferences(
    {
      setItem: (key, value) => {
        assert.equal(key, PREFERENCES_KEY);
        saved = JSON.parse(value);
      },
    },
    prefs,
  );
  assert.deepEqual(saved, prefs);
});
test('damaged or outdated preference values cannot leave the reader in an invalid mode', () => {
  for (const value of [null, 7, 'invalid', []])
    assert.equal(normalizePreferences(value).brightness, 100);
  assert.equal(loadPreferences({ getItem: () => '{broken' }).readingMode, 'scroll');
  const prefs = normalizePreferences({
    brightness: -50,
    warm: Infinity,
    theme: 'invalid',
    readingMode: 'invalid',
  });
  assert.equal(prefs.brightness, 10);
  assert.equal(prefs.warm, 0);
  assert.equal(prefs.theme, 'light');
  assert.equal(prefs.readingMode, 'scroll');
});
