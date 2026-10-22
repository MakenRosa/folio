import type { Preferences } from './types';

// This key is part of the existing installation's data contract. Branding can
// change without resetting the reader's appearance or resume preference.
export const PREFERENCES_KEY = 'lume.preferences';

export const DEFAULT_PREFERENCES: Readonly<Preferences> = {
  theme: 'light',
  paper: 'light',
  warm: 0,
  brightness: 100,
  readingMode: 'scroll',
  resume: true,
  view: 'grid',
  sort: 'recent',
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
    theme: choice(saved.theme, ['light', 'dark', 'system'], 'light'),
    paper: choice(saved.paper, ['light', 'dark', 'sepia'], 'light'),
    warm: number(saved.warm, 0, 0, 70),
    brightness: number(saved.brightness, 100, 10, 100),
    readingMode: choice(saved.readingMode, ['scroll', 'kindle'], 'scroll'),
    resume: typeof saved.resume === 'boolean' ? saved.resume : true,
    view: choice(saved.view, ['grid', 'list'], 'grid'),
    sort: choice(saved.sort, ['recent', 'title', 'size', 'added'], 'recent'),
  };
}

export function loadPreferences(storage: Pick<Storage, 'getItem'>): Preferences {
  try {
    return normalizePreferences(JSON.parse(storage.getItem(PREFERENCES_KEY) || '{}'));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(storage: Pick<Storage, 'setItem'>, prefs: Preferences): void {
  storage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
}
