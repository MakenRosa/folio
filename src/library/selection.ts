// The documents ticked in the library, by id. The ids that a drawing of the list took off the
// screen (a search, a filter, a removal) are not selected any more: what the bar says is what the
// actions do.

// The ids between the one that was ticked last (the anchor) and the target, both included, in the
// order of the list on screen. Without an anchor, or with one that is not on screen, only the
// target.
export function rangeIds(order: readonly string[], anchor: string | null, target: string) {
  const to = order.indexOf(target);
  if (to < 0) return [];
  const from = anchor === null ? -1 : order.indexOf(anchor);
  if (from < 0) return [target];
  return order.slice(Math.min(from, to), Math.max(from, to) + 1);
}
// Takes out of `selected` what is not in `visible`. Says whether something was taken out.
export function pruneSelection(selected: Set<string>, visible: Iterable<string>) {
  const shown = new Set(visible);
  let changed = false;
  for (const id of [...selected])
    if (!shown.has(id)) {
      selected.delete(id);
      changed = true;
    }
  return changed;
}
