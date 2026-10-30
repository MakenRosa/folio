import type { Preferences } from './types';
import { normalizeGoal } from './reading/goals.ts';
import { normalizeGoalHistory } from './reading/history.ts';
import { normalizeHints } from './hints.ts';
import { normalizePace } from './reading/pace.ts';
import { SIDEBAR_TABS, SIDEBAR_WIDTH } from './reading/sidebar.ts';
import { SPREADS } from './reading/spread.ts';

// This key is part of the existing installation's data contract. Branding can
// change without resetting the reader's appearance or resume preference.
export const PREFERENCES_KEY = 'lume.preferences';

export const DEFAULT_PREFERENCES: Readonly<Preferences> = {
  pace: {},
  goalHistory: {},
  dailyGoal: null,
  theme: 'light',
  paper: 'light',
  warm: 0,
  brightness: 100,
  readingMode: 'scroll',
  spread: 'none',
  sidebarOpen: false,
  sidebarTab: 'outline',
  sidebarWidth: SIDEBAR_WIDTH.fallback,
  joinPages: true,
  chapterBreaks: true,
  resume: true,
  singleKeys: true,
  view: 'grid',
  sort: 'recent',
  hints: [],
};

export function normalizePreferences(value: unknown): Preferences {
  const saved = value && typeof value === 'object' ? (value as Partial<Preferences>) : {};
  const number = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback;
  const choice = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
    options.includes(value as T) ? (value as T) : fallback;
  return {
    pace: normalizePace(saved.pace),
    goalHistory: normalizeGoalHistory(saved.goalHistory),
    dailyGoal: normalizeGoal(saved.dailyGoal),
    theme: choice(saved.theme, ['light', 'dark', 'system'], 'light'),
    paper: choice(saved.paper, ['light', 'dark', 'sepia'], 'light'),
    warm: number(saved.warm, 0, 0, 70),
    brightness: number(saved.brightness, 100, 10, 100),
    readingMode: choice(saved.readingMode, ['scroll', 'kindle'], 'scroll'),
    spread: choice(saved.spread, SPREADS, 'none'),
    // The side bar of the reader: shown or not, its tab and its width, for every book.
    sidebarOpen: typeof saved.sidebarOpen === 'boolean' ? saved.sidebarOpen : false,
    sidebarTab: choice(saved.sidebarTab, SIDEBAR_TABS, 'outline'),
    sidebarWidth: Math.round(
      number(saved.sidebarWidth, SIDEBAR_WIDTH.fallback, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max),
    ),
    joinPages: typeof saved.joinPages === 'boolean' ? saved.joinPages : true,
    chapterBreaks: typeof saved.chapterBreaks === 'boolean' ? saved.chapterBreaks : true,
    resume: typeof saved.resume === 'boolean' ? saved.resume : true,
    // On unless it was turned off, so that nothing changes for those who never open the option.
    singleKeys: typeof saved.singleKeys === 'boolean' ? saved.singleKeys : true,
    view: choice(saved.view, ['grid', 'list'], 'grid'),
    sort: choice(saved.sort, ['recent', 'title', 'size', 'added'], 'recent'),
    // The tips that were shown and must not come back: known names only, each once.
    hints: normalizeHints(saved.hints),
  };
}

export function loadPreferences(storage: Pick<Storage, 'getItem'>): Preferences {
  try {
    return normalizePreferences(JSON.parse(storage.getItem(PREFERENCES_KEY) || '{}'));
  } catch {
    return { ...DEFAULT_PREFERENCES, hints: [] };
  }
}

export function savePreferences(storage: Pick<Storage, 'setItem'>, prefs: Preferences): void {
  storage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
}
