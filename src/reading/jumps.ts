// The way back after a jump. A jump is a command that takes the reader somewhere else in the
// document without reading what is between: the outline, a link, the first result of a search,
// a bookmark or note, a thumbnail, a typed page number, Home/End and "Ler do início". Scrolling
// and turning pages are not jumps.
//
// A position is the reading anchor in PDF coordinates, as PDF.js reports it. It does not depend
// on the zoom, the rotation or the layout, so it is still right after any of them changes.
export type Position = { pageNumber: number; top: number; left: number };

// Which way the pill that follows a jump is pointing, and the pages at the two ends.
export type JumpOffer = { back: number | null; forward: number | null; show: 'back' | 'forward' };

// The most positions kept in each direction. The oldest ones are forgotten first.
export const MAX_JUMPS = 50;
// Two positions on the same page this close (in PDF units, about a third of an inch) are the
// same place: going there would not change what is on the screen.
export const SAME_PLACE = 24;

const valid = (p: Partial<Position>): p is Position =>
  Number.isInteger(p.pageNumber) &&
  (p.pageNumber as number) >= 1 &&
  Number.isFinite(p.top) &&
  Number.isFinite(p.left);
const copy = (p: Position): Position => ({ pageNumber: p.pageNumber, top: p.top, left: p.left });

export function samePlace(a: Position, b: Position) {
  return a.pageNumber === b.pageNumber && Math.abs(a.top - b.top) <= SAME_PLACE;
}

// Two stacks, like the history of a browser: where to go back to and where to come forward to.
// They only live as long as the document is open.
export class JumpHistory {
  private past: Position[] = [];
  private future: Position[] = [];
  // Where the next step back goes, and where the next step forward goes.
  get previous() {
    return this.past.at(-1) ?? null;
  }
  get next() {
    return this.future.at(-1) ?? null;
  }
  clear() {
    this.past = [];
    this.future = [];
  }
  // A jump from `from` that landed on `to`. It is not worth keeping when it stays on the same
  // page, within `near` PDF units of where it was (by default, anywhere on the page): nothing
  // was left behind. A kept jump forgets what was ahead, as a new path does in a browser, and
  // does not repeat the position that is already the last one. Says whether it was kept.
  record(from: Position, to: { pageNumber: number; top?: number }, near = Infinity) {
    if (!valid(from) || !Number.isInteger(to.pageNumber)) return false;
    const close =
      near === Infinity || (to.top !== undefined && Math.abs(to.top - from.top) <= near);
    if (to.pageNumber === from.pageNumber && close) return false;
    this.future = [];
    this.push(this.past, from);
    return true;
  }
  // The position to go back to, from where the reader is now, or null when there is none.
  // `here` goes to the other stack, so that the step can be undone.
  back(here: Position) {
    return this.step(this.past, this.future, here);
  }
  forward(here: Position) {
    return this.step(this.future, this.past, here);
  }
  // What the pill offers: the pages at both ends, and the side it shows.
  offer(show: JumpOffer['show']): JumpOffer {
    return {
      back: this.previous?.pageNumber ?? null,
      forward: this.next?.pageNumber ?? null,
      show,
    };
  }
  private step(from: Position[], to: Position[], here: Position) {
    if (!valid(here)) return null;
    // A place where the reader already is would change nothing: it is dropped, not visited.
    while (from.length && samePlace(from[from.length - 1], here)) from.pop();
    const target = from.pop();
    if (!target) return null;
    this.push(to, here);
    return copy(target);
  }
  private push(stack: Position[], position: Position) {
    const last = stack.at(-1);
    if (last && samePlace(last, position)) return;
    stack.push(copy(position));
    if (stack.length > MAX_JUMPS) stack.shift();
  }
}
