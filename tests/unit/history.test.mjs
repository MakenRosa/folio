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
test('a past day counts all the reading of the day against the general goal of that day', () => {
  const prefs = {
    dailyGoal: chapters,
    goalHistory: { '2026-10-01': pages, '2026-10-15': chapters },
  };
  const books = [
    {
      id: 'a',
      readingGoal: { mode: 'none' },
      goalHistory: { '2026-10-01': inherited, '2026-10-20': { mode: 'none' } },
      readingDays: { '2026-10-10': record(6, 1), '2026-10-16': record(0, 1) },
    },
    {
      id: 'b',
      goalHistory: { '2026-10-01': inherited },
      readingDays: { '2026-10-10': record(5, 1) },
    },
    {
      id: 'custom',
      goalHistory: { '2026-10-01': { mode: 'custom', ...chapters } },
      readingDays: { '2026-10-10': record(20, 2), '2026-10-16': record(0, 1) },
    },
  ];
  const d = historyDay(books, prefs, '2026-10-10', 'global', '2026-10-29');
  assert.equal(d.pages, 31);
  assert.equal(d.chapters, 4);
  // 6 + 5 + 20 pages: the book with a goal of its own and the one without any count as the others.
  assert.equal(d.count, 31);
  assert.equal(d.status, 'met');
  assert.deepEqual(d.goal, pages);
  assert.equal(d.own, false);
  // 2 chapters on the 16th (one of them in the book with a goal of its own) meet the general goal.
  const sixteenth = historyDay(books, prefs, '2026-10-16', 'global', '2026-10-29');
  assert.deepEqual(sixteenth.goal, chapters);
  assert.equal(sixteenth.count, 2);
  assert.equal(sixteenth.status, 'met');
  assert.equal(historyDay(books, prefs, '2026-10-19', 'global', '2026-10-29').status, 'missed');
  assert.equal(historyDay(books, prefs, '2026-10-29', 'global', '2026-10-29').status, 'ongoing');
  // One document: its own goal when it had one that day, only its totals when it had none.
  const custom = historyDay(books, prefs, '2026-10-10', 'custom');
  assert.equal(custom.count, 2);
  assert.equal(custom.status, 'met');
  assert.equal(custom.own, true);
  assert.deepEqual(custom.goal, chapters);
  const a = historyDay(books, prefs, '2026-10-10', 'a');
  assert.equal(a.status, 'no-own');
  assert.equal(a.goal, null);
  assert.equal(a.pages, 6);
  assert.equal(a.chapters, 1);
  assert.equal(a.own, false);
  assert.equal(historyDay(books, prefs, '2026-10-10', 'b').status, 'no-own');
  assert.equal(historyDay(books, prefs, '2026-10-21', 'a').status, 'no-own');
  // The 16th: the book with a goal of its own read 1 of its 2 chapters.
  assert.equal(historyDay(books, prefs, '2026-10-16', 'custom', '2026-10-29').status, 'missed');
});
test('the goal of the day is the one in force that day, and a goal change does not change earlier days', () => {
  const prefs = { dailyGoal: pages, goalHistory: { '2026-10-01': chapters, '2026-10-20': pages } };
  const book = {
    id: 'a',
    goalHistory: { '2026-10-01': inherited, '2026-10-20': { mode: 'custom', ...pages } },
    readingDays: { '2026-10-10': record(11, 2), '2026-10-25': record(11, 2) },
  };
  const old = historyDay([book], prefs, '2026-10-10', 'global', '2026-10-29');
  assert.deepEqual(old.goal, chapters);
  assert.equal(old.count, 2);
  assert.equal(old.status, 'met');
  const recent = historyDay([book], prefs, '2026-10-25', 'global', '2026-10-29');
  assert.deepEqual(recent.goal, pages);
  assert.equal(recent.count, 11);
  assert.equal(historyDay([book], prefs, '2026-10-10', 'a').status, 'no-own');
  assert.equal(historyDay([book], prefs, '2026-10-25', 'a').status, 'met');
  assert.equal(historyDay([book], prefs, '2026-09-30', 'a').status, 'unknown');
});
test('a day of a document with no goal of its own on record is unknown, but the general goal still counts it', () => {
  const prefs = { dailyGoal: pages, goalHistory: { '2026-10-01': pages } };
  const unrecorded = { id: 'u', readingDays: { '2026-10-10': record(10, 0) } };
  const other = { id: 'o', goalHistory: { '2026-10-01': inherited }, readingDays: {} };
  assert.equal(historyDay([unrecorded, other], prefs, '2026-10-10', 'u').status, 'unknown');
  // The general goal no longer depends on which setting each document had.
  const general = historyDay([unrecorded, other], prefs, '2026-10-10', 'global', '2026-10-29');
  assert.equal(general.count, 10);
  assert.equal(general.status, 'met');
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
