// Moving through the items of a menu, as numbers and text only. `enabled[i]` says whether
// item i can take the focus; `current` is the focused item, or -1 when none is.

// The item that Arrow Up, Arrow Down, Home or End goes to. The arrows wrap around.
// Null when the key does nothing here, or when there is no item to go to.
export function menuIndexAfterKey(key: string, current: number, enabled: boolean[]): number | null {
  const usable = enabled.flatMap((on, i) => (on ? [i] : []));
  if (!usable.length) return null;
  if (key === 'Home') return usable[0];
  if (key === 'End') return usable[usable.length - 1];
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return null;
  const at = usable.indexOf(current);
  if (key === 'ArrowDown') return usable[at < 0 ? 0 : (at + 1) % usable.length];
  return usable[at < 0 ? usable.length - 1 : (at - 1 + usable.length) % usable.length];
}

// Letters compare without case or accents: "o" finds "Ótimo".
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .trim();

// A key that types a letter, as opposed to a shortcut or a key that acts on the button.
export function isTypedCharacter(event: {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}): boolean {
  return (
    [...event.key].length === 1 &&
    event.key.trim() !== '' &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey
  );
}

// The item for the letters typed so far. One letter (or the same one again) goes to the next
// item that starts with it, so that repeating the key cycles through them. Several different
// letters narrow down from the current item. Null when no item starts with them.
export function typeaheadIndex(
  labels: string[],
  enabled: boolean[],
  current: number,
  typed: string,
): number | null {
  const text = fold(typed);
  if (!text || !labels.length) return null;
  const repeated = [...text].every((c) => c === text[0]);
  const needle = repeated ? text[0] : text;
  const first = repeated ? current + 1 : Math.max(0, current);
  for (let step = 0; step < labels.length; step++) {
    const i = (((first + step) % labels.length) + labels.length) % labels.length;
    if (enabled[i] && fold(labels[i]).startsWith(needle)) return i;
  }
  return null;
}
