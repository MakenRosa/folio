import type { Book, DailyGoal, Preferences } from '../types';
import { dayCount, localDay, normalizeGoal } from './goals.ts';

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
export type DayStatus = 'met' | 'missed' | 'ongoing' | 'none' | 'unknown';
export const statusLabels: Record<DayStatus, string> = {
  met: 'Meta atingida',
  missed: 'Abaixo da meta',
  ongoing: 'Em andamento',
  none: 'Sem meta',
  unknown: 'Meta não registrada',
};
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
  const own = selected && atDay(selected.goalHistory, day);
  const shared = !selected || own?.mode === 'inherit';
  const goal: DailyGoal | null | undefined = selected
    ? own === undefined
      ? undefined
      : own.mode === 'none'
        ? null
        : own.mode === 'custom'
          ? normalizeGoal(own)
          : atDay(prefs.goalHistory, day)
    : atDay(prefs.goalHistory, day);
  const countedBooks = shared
    ? books.filter((b) => atDay(b.goalHistory, day)?.mode === 'inherit')
    : scopeBooks;
  const count = goal ? countedBooks.reduce((sum, b) => sum + dayCount(b, goal.unit, day), 0) : 0;
  // Old totals are useful, but unknown book membership cannot prove a shared goal.
  const incomplete =
    shared &&
    books.some(
      (b) =>
        !atDay(b.goalHistory, day) &&
        (dayCount(b, 'pages', day) > 0 || dayCount(b, 'chapters', day) > 0),
    );
  const status: DayStatus =
    goal === undefined || (goal && incomplete)
      ? 'unknown'
      : goal === null
        ? 'none'
        : count >= goal.target
          ? 'met'
          : day === today
            ? 'ongoing'
            : 'missed';
  const recorded =
    !!scopeBooks.some((b) => b.readingDays?.[day]) ||
    (selected ? own !== undefined : atDay(prefs.goalHistory, day) !== undefined);
  return { day, pages, chapters, goal, count, status, shared, recorded, books: scopeBooks };
}
export function monthDays(month: string) {
  const [y, m] = month.split('-').map(Number);
  return Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) =>
    localDay(new Date(y, m - 1, i + 1, 12)),
  );
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
