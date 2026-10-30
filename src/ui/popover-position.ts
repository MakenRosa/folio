// Where a floating panel goes, as numbers only, so that the rule can be tested without a window.
// The panel opens under its anchor when it fits and above it when it does not (the other way round,
// for a panel that asks for `prefer: 'above'`). It never leaves the window (`margin` on every side)
// and, as a last resort, it scrolls inside.
export const POPOVER = Object.freeze({
  margin: 8,
  gap: 8,
  // Below this much room next to the anchor, the panel uses the whole window instead.
  minHeight: 120,
});

export type Box = { left: number; top: number; right: number; bottom: number };
export type PopoverInput = {
  // The button, or a point (right = left, bottom = top) for a menu opened at the pointer.
  anchor: Box;
  // The natural size of the panel, measured without a height limit.
  width: number;
  height: number;
  viewport: { width: number; height: number };
  // Which edge of the anchor the panel lines up with. If it does not fit there, the other one.
  align?: 'start' | 'end';
  // The distance between anchor and panel. A menu at the pointer has none.
  gap?: number;
  // The side that is tried first. Below, unless the panel asks for above.
  prefer?: 'below' | 'above';
};
export type PopoverPlacement = {
  left: number;
  top: number;
  // What the panel may grow to: more than that scrolls inside it.
  maxHeight: number;
  side: 'below' | 'above' | 'window';
};

const size = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
const coordinate = (n: number) => (Number.isFinite(n) ? n : 0);

// A point as an anchor.
export function pointBox(x: number, y: number): Box {
  return { left: x, top: y, right: x, bottom: y };
}

export function placePopover(input: PopoverInput): PopoverPlacement {
  const { margin, minHeight } = POPOVER;
  const gap = input.gap ?? POPOVER.gap;
  const vw = size(input.viewport.width),
    vh = size(input.viewport.height);
  const room = { width: Math.max(0, vw - 2 * margin), height: Math.max(0, vh - 2 * margin) };
  const width = Math.min(size(input.width), room.width);
  const height = size(input.height);
  const anchor = {
    left: coordinate(input.anchor.left),
    top: coordinate(input.anchor.top),
    right: coordinate(input.anchor.right),
    bottom: coordinate(input.anchor.bottom),
  };

  const below = vh - margin - (anchor.bottom + gap);
  const above = anchor.top - gap - margin;
  let side: PopoverPlacement['side'];
  let space: number;
  const higher = input.prefer === 'above';
  if (!higher && height <= below) [side, space] = ['below', below];
  else if (height <= above) [side, space] = ['above', above];
  else if (height <= below) [side, space] = ['below', below];
  else [side, space] = below >= above ? ['below', below] : ['above', above];
  // No usable room on either side: the panel covers the anchor rather than shrink to nothing.
  if (space < Math.min(height, minHeight)) [side, space] = ['window', room.height];

  const shown = Math.min(height, space);
  const top =
    side === 'below'
      ? anchor.bottom + gap
      : side === 'above'
        ? anchor.top - gap - shown
        : Math.max(margin, Math.min(anchor.top, vh - margin - shown));

  const start = anchor.left,
    end = anchor.right - width;
  const fits = (left: number) => left >= margin && left + width <= vw - margin;
  const wanted = input.align === 'start' ? [start, end] : [end, start];
  const left = wanted.find(fits) ?? Math.max(margin, Math.min(vw - margin - width, wanted[0]));

  return { left, top, maxHeight: Math.floor(space), side };
}
