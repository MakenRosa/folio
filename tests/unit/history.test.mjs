import test from 'node:test';
import assert from 'node:assert/strict';
import {
  historyDay,
  rememberGoal,
  normalizeGoalHistory,
  monthDays,
} from '../../src/reading/history.ts';
const pages = { unit: 'pages', target: 10 },
  chapters = { unit: 'chapters', target: 2 };
const record = (p, c) => ({ pages: [], chapters: [], pageAdjustment: p, chapterAdjustment: c });
const inherited = { mode: 'inherit', unit: 'pages', target: 10 };
test('historical targets and book membership survive later changes of unit, goal and participation', () => {
  const prefs = {
    dailyGoal: chapters,
    goalHistory: { '2026-10-01': pages, '2026-10-15': chapters },
  };
  const books = [
    {
      id: 'a',
      readingGoal: { mode: 'none' },
      goalHistory: { '2026-10-01': inherited, '2026-10-20': { mode: 'none' } },
      readingDays: { '2026-10-10': record(6, 1) },
    },
    {
      id: 'b',
      goalHistory: { '2026-10-01': inherited },
      readingDays: { '2026-10-10': record(5, 1) },
    },
    {
      id: 'custom',
      goalHistory: { '2026-10-01': { mode: 'custom', ...chapters } },
      readingDays: { '2026-10-10': record(20, 2) },
    },
  ];
  const d = historyDay(books, prefs, '2026-10-10', 'global', '2026-10-29');
  assert.equal(d.pages, 31);
  assert.equal(d.chapters, 4);
  assert.equal(d.count, 11);
  assert.equal(d.status, 'met');
  assert.deepEqual(d.goal, pages);
  assert.equal(historyDay(books, prefs, '2026-10-10', 'a').status, 'met');
  assert.equal(historyDay(books, prefs, '2026-10-10', 'custom').count, 2);
  assert.equal(historyDay(books, prefs, '2026-10-21', 'a').status, 'none');
  assert.equal(historyDay(books, prefs, '2026-10-19', 'global', '2026-10-29').status, 'missed');
  assert.equal(historyDay(books, prefs, '2026-10-29', 'global', '2026-10-29').status, 'ongoing');
});
test('old totals remain visible without inventing historical goals', () => {
  const prefs = { dailyGoal: pages, goalHistory: { '2026-10-29': pages } };
  const b = {
    id: 'legacy',
    readingGoal: inherited,
    goalHistory: { '2026-10-29': inherited },
    readingDays: { '2026-09-03': record(18, 2) },
  };
  const d = historyDay([b], prefs, '2026-09-03');
  assert.equal(d.pages, 18);
  assert.equal(d.chapters, 2);
  assert.equal(d.status, 'unknown');
  assert.equal(d.recorded, true);
  assert.equal(historyDay([b], prefs, '2026-09-01').recorded, false);
});
test('the final setting of each day is preserved, with disabled days and no redundant daily writes', () => {
  const prefs = { dailyGoal: pages, goalHistory: {} };
  rememberGoal(prefs, '2026-10-01');
  rememberGoal(prefs, '2026-10-02');
  assert.equal(Object.keys(prefs.goalHistory).length, 1);
  prefs.dailyGoal = chapters;
  rememberGoal(prefs, '2026-10-02');
  prefs.dailyGoal = null;
  rememberGoal(prefs, '2026-10-02');
  assert.deepEqual(prefs.goalHistory, { '2026-10-01': pages, '2026-10-02': null });
  assert.equal(historyDay([], prefs, '2026-10-03').status, 'none');
});
test('calendar and normalization handle leap days, invalid dates and malformed stored history', () => {
  assert.equal(monthDays('2024-02').length, 29);
  assert.equal(monthDays('2026-02').length, 28);
  assert.deepEqual(
    normalizeGoalHistory({
      '2026-02-30': pages,
      '2026-03-01': null,
      '2026-03-02': { unit: 'pages', target: 0 },
    }),
    { '2026-03-01': null },
  );
  assert.deepEqual(normalizeGoalHistory([]), {});
});
