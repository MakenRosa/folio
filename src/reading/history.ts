import type { Book, DailyGoal, Preferences } from '../types';
import { dayCount, globalCount, localDay, normalizeGoal, ownGoal } from './goals.ts';

export function validDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [y, m, d] = day.split('-').map(Number);
  return y >= 1900 && localDay(new Date(y, m - 1, d, 12)) === day;
}
export function normalizeGoalHistory(value: unknown): Preferences['goalHistory'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([day, goal]) => validDay(day) && (goal === null || normalizeGoal(goal)))
      .map(([day, goal]) => [day, normalizeGoal(goal)]),
  );
}
export function atDay<T>(timeline: Record<string, T> | undefined, day: string): T | undefined {
  const key = Object.keys(timeline || {})
    .filter((key) => key <= day)
    .sort()
    .at(-1);
  return key ? timeline![key] : undefined;
}
export function rememberGoal(prefs: Preferences, day = localDay()) {
  const previous = atDay(prefs.goalHistory, day);
  if (JSON.stringify(previous) !== JSON.stringify(prefs.dailyGoal))
    prefs.goalHistory = {
      ...prefs.goalHistory,
      [day]: prefs.dailyGoal ? { ...prefs.dailyGoal } : null,
    };
}
// 'no-own' is a day of one document that had no goal of its own: its totals are shown, and its
// reading still counted in the general goal.
export type DayStatus = 'met' | 'missed' | 'ongoing' | 'none' | 'unknown' | 'no-own';
export const statusLabels: Record<DayStatus, string> = {
  met: 'Meta atingida',
  missed: 'Abaixo da meta',
  ongoing: 'Em andamento',
  none: 'Sem meta',
  unknown: 'Meta não registrada',
  'no-own': 'Sem meta própria',
};
// What the goal of the day says of a scope, by the settings that were in force on that day.
// The whole library (the general goal) counts all the reading of the day, in any document, with a
// goal of its own or without. A document is measured by its own goal when it had one, and when it
// had none only its totals are shown. A setting that was never recorded is 'unknown'.
export function historyDay(
  books: Book[],
  prefs: Preferences,
  day: string,
  scope = 'global',
  today = localDay(),
) {
  const selected = books.find((b) => b.id === scope);
  const scopeBooks = selected ? [selected] : books;
  const pages = scopeBooks.reduce((sum, b) => sum + dayCount(b, 'pages', day), 0);
  const chapters = scopeBooks.reduce((sum, b) => sum + dayCount(b, 'chapters', day), 0);
  const setting = selected && atDay(selected.goalHistory, day);
  const goal: DailyGoal | null | undefined = selected
    ? setting === undefined
      ? undefined
      : ownGoal(setting)
    : atDay(prefs.goalHistory, day);
  const count = goal
    ? selected
      ? dayCount(selected, goal.unit, day)
      : globalCount(books, goal, day)
    : 0;
  const status: DayStatus =
    goal === undefined
      ? 'unknown'
      : goal === null
        ? selected
          ? 'no-own'
          : 'none'
        : count >= goal.target
          ? 'met'
          : day === today
            ? 'ongoing'
            : 'missed';
  const recorded =
    !!scopeBooks.some((b) => b.readingDays?.[day]) ||
    (selected ? setting !== undefined : atDay(prefs.goalHistory, day) !== undefined);
  // `own`: the goal is the one of the document, not the general goal.
  const own = !!selected && !!goal;
  return { day, pages, chapters, goal, count, status, own, recorded, books: scopeBooks };
}
export function monthDays(month: string) {
  const [y, m] = month.split('-').map(Number);
  return Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) =>
    localDay(new Date(y, m - 1, i + 1, 12)),
  );
}
const parts = (day: string) => day.split('-').map(Number) as [number, number, number];
const addDays = (day: string, count: number) => {
  const [y, m, d] = parts(day);
  return localDay(new Date(y, m - 1, d + count, 12));
};
// The same day of another month, or the last day of it when it has fewer days.
const addMonths = (day: string, count: number) => {
  const [y, m, d] = parts(day);
  return localDay(new Date(y, m - 1 + count, Math.min(d, new Date(y, m + count, 0).getDate()), 12));
};
export type CalendarStep = { day: string } | { refused: 'past' | 'future' } | null;
// Where a key takes the focus in the calendar of a month (the pattern of a grid, from the WAI-ARIA
// Authoring Practices): ← and → one day, ↑ and ↓ one week, Home and End the start and the end of the
// week as the calendar shows it (Monday to Sunday, inside the month), Page Up and Page Down the same
// day of the month before and after. A day after `today`, or in a month before the first one with a
// record, is refused and the answer says which; null when the key is not one of these.
export function calendarStep(day: string, key: string, today: string, first: string): CalendarStep {
  const month = day.slice(0, 7);
  const [y, m, d] = parts(day);
  // 0 is the Monday, as in the header of the calendar.
  const weekday = (new Date(y, m - 1, d, 12).getDay() + 6) % 7;
  let target: string;
  if (key === 'ArrowLeft') target = addDays(day, -1);
  else if (key === 'ArrowRight') target = addDays(day, 1);
  else if (key === 'ArrowUp') target = addDays(day, -7);
  else if (key === 'ArrowDown') target = addDays(day, 7);
  else if (key === 'Home') {
    target = addDays(day, -weekday);
    if (target.slice(0, 7) < month) target = `${month}-01`;
  } else if (key === 'End') {
    target = addDays(day, 6 - weekday);
    if (target.slice(0, 7) > month) target = monthDays(month).at(-1)!;
    if (target > today) target = today;
  } else if (key === 'PageUp') target = addMonths(day, -1);
  else if (key === 'PageDown') {
    target = addMonths(day, 1);
    // The current month stops at today.
    if (target.slice(0, 7) === today.slice(0, 7) && target > today) target = today;
  } else return null;
  if (target > today) return { refused: 'future' };
  if (target.slice(0, 7) < first.slice(0, 7)) return { refused: 'past' };
  return { day: target };
}
export function firstHistoryDay(books: Book[], prefs: Preferences, today = localDay()) {
  return [
    ...Object.keys(prefs.goalHistory),
    ...books.flatMap((b) => [
      ...Object.keys(b.goalHistory || {}),
      ...Object.keys(b.readingDays || {}),
    ]),
    today,
  ].sort()[0];
}
