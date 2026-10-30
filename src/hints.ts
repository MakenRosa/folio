// The tips that are shown only once. A tip is remembered by name in the preferences, so that it
// stays quiet after the first time, also after a restart. The names are part of the saved data.
export const HINTS = ['kindle', 'finish'] as const;
export type HintId = (typeof HINTS)[number];

const known = new Set<string>(HINTS);

// What was saved, without what is not a known tip and without repeats. Older preferences have none.
export function normalizeHints(value: unknown): HintId[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is HintId => typeof id === 'string' && known.has(id)))];
}

export function hasSeenHint(seen: readonly string[], id: HintId): boolean {
  return seen.includes(id);
}

// The list with one more tip seen. The same list again if it was already there.
export function withHint(seen: readonly string[], id: HintId): HintId[] {
  return normalizeHints(hasSeenHint(seen, id) ? seen : [...seen, id]);
}
