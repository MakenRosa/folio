import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PREFERENCES,
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
  assert.equal(prefs.spread, 'none');
  assert.equal(prefs.joinPages, true);
  assert.equal(prefs.chapterBreaks, true);
  assert.equal(prefs.dailyGoal, null);
  assert.deepEqual(normalizePreferences({ dailyGoal: { unit: 'chapters', target: 2 } }).dailyGoal, {
    unit: 'chapters',
    target: 2,
  });
  assert.equal(normalizePreferences({ dailyGoal: { unit: 'pages', target: 0 } }).dailyGoal, null);
  assert.equal(normalizePreferences({ joinPages: false }).joinPages, false);
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
test('reading pace is optional, validated and survives a save and load', () => {
  assert.deepEqual(normalizePreferences({}).pace, {}, 'Older preferences have no pace yet');
  for (const value of [null, 7, 'invalid', [], { a: 1 }, { a: { seconds: 'x', samples: 5 } }])
    assert.deepEqual(normalizePreferences({ pace: value }).pace, {});
  const pace = { 'book-1': { seconds: 52.5, samples: 12, updated: 1_700_000_000_000 } };
  assert.deepEqual(normalizePreferences({ pace }).pace, pace);
  assert.equal(
    normalizePreferences({ pace: { a: { seconds: 5000, samples: 5, updated: 1 } } }).pace.a.seconds,
    240,
  );
  assert.equal(
    Object.keys(
      normalizePreferences({
        pace: Object.fromEntries(
          Array.from({ length: 80 }, (_, i) => [`b${i}`, { seconds: 50, samples: 5, updated: i }]),
        ),
      }).pace,
    ).length,
    50,
    'Only the most recent books are kept',
  );
  let stored;
  savePreferences({ setItem: (_, value) => (stored = value) }, normalizePreferences({ pace }));
  assert.deepEqual(loadPreferences({ getItem: () => stored }).pace, pace);
});
test('the page layout is single by default, validated, and survives a save and load', () => {
  assert.equal(DEFAULT_PREFERENCES.spread, 'none');
  assert.equal(normalizePreferences({}).spread, 'none', 'Older preferences have no layout yet');
  for (const spread of ['none', 'odd', 'even'])
    assert.equal(normalizePreferences({ spread }).spread, spread);
  for (const value of [null, 0, 1, 2, true, 'two', 'ODD', ['odd'], {}])
    assert.equal(normalizePreferences({ spread: value }).spread, 'none');
  assert.equal(loadPreferences({ getItem: () => '{"spread":"even"}' }).spread, 'even');
  assert.equal(loadPreferences({ getItem: () => '{"spread":"x"' }).spread, 'none', 'Broken JSON');
  let stored;
  savePreferences(
    { setItem: (_, value) => (stored = value) },
    normalizePreferences({ spread: 'odd' }),
  );
  assert.equal(loadPreferences({ getItem: () => stored }).spread, 'odd');
  // The layout is separate from the reading mode: choosing Kindle keeps the choice.
  const kindle = normalizePreferences({ spread: 'even', readingMode: 'kindle' });
  assert.deepEqual([kindle.readingMode, kindle.spread], ['kindle', 'even']);
});
test('the keys of one letter are on by default, validated, and survive a save and load', () => {
  assert.equal(DEFAULT_PREFERENCES.singleKeys, true);
  assert.equal(normalizePreferences({}).singleKeys, true, 'Older preferences have no option yet');
  assert.equal(normalizePreferences({ singleKeys: false }).singleKeys, false);
  assert.equal(normalizePreferences({ singleKeys: true }).singleKeys, true);
  for (const value of [null, 0, 1, 'false', 'off', [], {}])
    assert.equal(normalizePreferences({ singleKeys: value }).singleKeys, true);
  assert.equal(loadPreferences({ getItem: () => '{"singleKeys":false}' }).singleKeys, false);
  assert.equal(
    loadPreferences({ getItem: () => '{"singleKeys":fals' }).singleKeys,
    true,
    'Broken JSON',
  );
  let stored;
  savePreferences(
    { setItem: (_, value) => (stored = value) },
    normalizePreferences({ singleKeys: false, theme: 'dark' }),
  );
  const prefs = loadPreferences({ getItem: () => stored });
  assert.deepEqual([prefs.singleKeys, prefs.theme], [false, 'dark']);
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
test('the side bar is closed, on the outline and 260 px wide by default, for every book', () => {
  assert.deepEqual(
    [
      DEFAULT_PREFERENCES.sidebarOpen,
      DEFAULT_PREFERENCES.sidebarTab,
      DEFAULT_PREFERENCES.sidebarWidth,
    ],
    [false, 'outline', 260],
  );
  const old = normalizePreferences({ theme: 'dark' });
  assert.deepEqual([old.sidebarOpen, old.sidebarTab, old.sidebarWidth], [false, 'outline', 260]);
  assert.deepEqual(normalizePreferences({}), normalizePreferences(DEFAULT_PREFERENCES));
});
test('the side bar state is validated: boolean, a known tab, and a width within the limits', () => {
  for (const tab of ['outline', 'pages', 'bookmarks', 'notes'])
    assert.equal(normalizePreferences({ sidebarTab: tab }).sidebarTab, tab);
  for (const value of [null, 0, 1, true, 'Pages', 'thumbnails', ['pages'], {}])
    assert.equal(normalizePreferences({ sidebarTab: value }).sidebarTab, 'outline');
  assert.equal(normalizePreferences({ sidebarOpen: true }).sidebarOpen, true);
  assert.equal(normalizePreferences({ sidebarOpen: false }).sidebarOpen, false);
  for (const value of [null, 1, 'true', 'yes', [], {}])
    assert.equal(normalizePreferences({ sidebarOpen: value }).sidebarOpen, false);
  assert.equal(normalizePreferences({ sidebarWidth: 340 }).sidebarWidth, 340);
  assert.equal(normalizePreferences({ sidebarWidth: 340.6 }).sidebarWidth, 341, 'A whole number');
  assert.equal(normalizePreferences({ sidebarWidth: 10 }).sidebarWidth, 220);
  assert.equal(normalizePreferences({ sidebarWidth: -300 }).sidebarWidth, 220);
  assert.equal(normalizePreferences({ sidebarWidth: 5000 }).sidebarWidth, 480);
  assert.equal(normalizePreferences({ sidebarWidth: Infinity }).sidebarWidth, 260);
  for (const value of [null, 'wide', '300', Number.NaN, [], {}, true])
    assert.equal(normalizePreferences({ sidebarWidth: value }).sidebarWidth, 260);
});
test('the side bar state survives a save and a load, and is independent of the other options', () => {
  let stored;
  savePreferences(
    { setItem: (_, value) => (stored = value) },
    normalizePreferences({ sidebarOpen: true, sidebarTab: 'pages', sidebarWidth: 372 }),
  );
  const prefs = loadPreferences({ getItem: () => stored });
  assert.deepEqual([prefs.sidebarOpen, prefs.sidebarTab, prefs.sidebarWidth], [true, 'pages', 372]);
  assert.equal(
    loadPreferences({ getItem: () => '{"sidebarTab":"pages","sidebarWidth":"y"' }).sidebarTab,
    'outline',
    'Broken JSON',
  );
  const kindle = normalizePreferences({ readingMode: 'kindle', spread: 'odd', sidebarOpen: true });
  assert.deepEqual(
    [kindle.readingMode, kindle.spread, kindle.sidebarOpen],
    ['kindle', 'odd', true],
  );
});
