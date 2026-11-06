// Moving between the cards of the library with the keys (the pattern of a roving tabindex, from the
// WAI-ARIA Authoring Practices). A card's place is where it is on the screen, since the number of
// columns changes with the width of the window.
export type CardBox = { top: number; left: number; width: number; height: number };

// Cards of one row share the same top; a few pixels of difference are the rounding of the layout.
const SAME_ROW = 4;

// The index of the card that `key` leads to from the card `from`, in the same order as `boxes`.
// It is `from` itself when there is nowhere to go (the first or the last card, the edge of the grid).
// `undefined` when the key does nothing here: another key, or ← and → in the list.
// In the list only ↑ and ↓ move. In the grid ← and → go to the previous and the next card, in reading
// order, and ↑ and ↓ to the card of the row above or below that is closest to it. Home and End go
// to the first and to the last.
export function cardAfterKey(
  boxes: readonly CardBox[],
  from: number,
  key: string,
  list: boolean,
): number | undefined {
  const last = boxes.length - 1;
  if (last < 0 || from < 0 || from > last) return undefined;
  const step = (by: number) => Math.min(last, Math.max(0, from + by));
  if (key === 'Home') return 0;
  if (key === 'End') return last;
  if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowRight')
    return undefined;
  const vertical = key === 'ArrowUp' || key === 'ArrowDown';
  if (list) return vertical ? step(key === 'ArrowDown' ? 1 : -1) : undefined;
  if (!vertical) return step(key === 'ArrowRight' ? 1 : -1);
  const down = key === 'ArrowDown',
    here = boxes[from],
    centre = here.left + here.width / 2;
  const away = (box: CardBox) => (down ? box.top - here.top : here.top - box.top);
  // The nearest row in that direction, and in it the card whose middle is closest to this one's.
  let row = Infinity;
  for (const box of boxes) {
    const distance = away(box);
    if (distance > SAME_ROW && distance < row) row = distance;
  }
  if (row === Infinity) return from;
  let best = from,
    gap = Infinity;
  boxes.forEach((box, i) => {
    if (Math.abs(away(box) - row) > SAME_ROW) return;
    const apart = Math.abs(box.left + box.width / 2 - centre);
    if (apart < gap) {
      gap = apart;
      best = i;
    }
  });
  return best;
}
