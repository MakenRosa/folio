// Selecting a passage with the keyboard. Shift + ← and → grow the selection by a word, Shift + ↑ and
// ↓ by a line, as a browser does in text that can be edited. H and N (and the bar of the selection)
// act on what these keys select, so that a passage can be highlighted or noted without the mouse.

export type SelectionKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
// `none`: there is no text in view to start from. `edge`: the selection could not grow (it is at the
// end of the text, or the key had nothing to do). `moved`: it grew.
export type Extension = 'moved' | 'edge' | 'none';
export type Area = { left: number; top: number; right: number; bottom: number };

const STEPS: Record<SelectionKey, ['forward' | 'backward', 'word' | 'line']> = {
  ArrowRight: ['forward', 'word'],
  ArrowLeft: ['backward', 'word'],
  ArrowDown: ['forward', 'line'],
  ArrowUp: ['backward', 'line'],
};
export const isSelectionKey = (key: string): key is SelectionKey => Object.hasOwn(STEPS, key);

// `Selection.modify` is in Chromium and in WebView2, but not in the types of the DOM.
type Modifiable = Selection & {
  modify(alter: 'extend', direction: 'forward' | 'backward', granularity: 'word' | 'line'): void;
};

// What of `container` is on screen: the box of the scrolling area, without its scroll bars.
export function visibleArea(container: HTMLElement): Area {
  const box = container.getBoundingClientRect();
  return {
    left: box.left,
    top: box.top,
    right: box.left + container.clientWidth,
    bottom: box.top + container.clientHeight,
  };
}
const meets = (box: Area, area: Area) =>
  box.bottom > area.top && box.top < area.bottom && box.right > area.left && box.left < area.right;

// Whether `node` is in the text of a page: PDF.js draws it in one layer over each page, and the
// keyboard selection never leaves those layers (not for the bars, the buttons or the other pages'
// marks that are around them).
function inText(container: HTMLElement, node: Node | null) {
  const layer = (node instanceof Element ? node : node?.parentElement)?.closest('.textLayer');
  return !!layer && container.contains(layer);
}

// The first or the last line of a node's text, as a box in the window.
function edgeBox(node: Node, last: boolean): Area | null {
  let found: Text | null = null;
  if (node instanceof Text) found = node;
  else {
    const texts = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let text = texts.nextNode(); text; text = texts.nextNode()) {
      if (!(text as Text).data.trim()) continue;
      found = text as Text;
      if (!last) break;
    }
  }
  if (!found) return null;
  const range = document.createRange();
  range.selectNodeContents(found);
  const boxes = [...range.getClientRects()].filter((box) => box.width || box.height);
  return (last ? boxes.at(-1) : boxes[0]) ?? null;
}

// Whether the end of the selection (its focus) comes before where it began.
function backward(selection: Selection) {
  if (selection.isCollapsed || !selection.anchorNode || !selection.focusNode) return false;
  const range = document.createRange();
  range.setStart(selection.anchorNode, selection.anchorOffset);
  range.setEnd(selection.focusNode, selection.focusOffset);
  // A range cannot end before it starts: it is collapsed instead.
  return range.collapsed;
}

// The box, in the window, of the text next to the end of the selection (where it grows), or null
// when that cannot be known. A step by word ends inside a text, and a step by line often ends between
// the lines (the element that holds them, and the number of the line).
export function selectionEnd(selection: Selection): Area | null {
  const node = selection.focusNode;
  if (!node) return null;
  const at = selection.focusOffset;
  if (node instanceof Text) {
    const range = document.createRange();
    // The character next to the end: a collapsed range has no box of its own in every case.
    if (at > 0) {
      range.setStart(node, at - 1);
      range.setEnd(node, at);
    } else {
      range.setStart(node, 0);
      range.setEnd(node, Math.min(1, node.length));
    }
    const box = range.getBoundingClientRect();
    return box.width || box.height ? box : null;
  }
  const back = backward(selection);
  const near = [node.childNodes[at - 1], node.childNodes[at]];
  for (const child of back ? near.reverse() : near) {
    const box = child && edgeBox(child, !back);
    if (box) return box;
  }
  return null;
}

// The first text of the pages that is in view, in the order of the document.
function firstVisibleText(container: HTMLElement) {
  const area = visibleArea(container);
  const range = document.createRange();
  for (const layer of container.querySelectorAll<HTMLElement>('.page > .textLayer')) {
    if (!meets(layer.getBoundingClientRect(), area)) continue;
    const texts = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    for (let node = texts.nextNode(); node; node = texts.nextNode()) {
      if (!(node as Text).data.trim()) continue;
      range.selectNodeContents(node);
      for (const box of range.getClientRects())
        if ((box.width || box.height) && meets(box, area)) return node as Text;
    }
  }
  return null;
}

// Whether the selection can be grown from where it is: it is in the text of the pages, and it is a
// passage, or a caret (a click leaves one) that is in view.
function growable(container: HTMLElement, selection: Selection) {
  if (
    !selection.rangeCount ||
    !inText(container, selection.anchorNode) ||
    !inText(container, selection.focusNode)
  )
    return false;
  if (!selection.isCollapsed) return true;
  const end = selectionEnd(selection);
  return !!end && meets(end, visibleArea(container));
}

// Grows the selection of the pages one step. With nothing selected it starts at the beginning of
// the first text in view. It stays in the text layers: a step that would leave them is undone.
export function extendSelection(container: HTMLElement, key: SelectionKey): Extension {
  const selection = getSelection() as Modifiable | null;
  if (!selection || typeof selection.modify !== 'function') return 'edge';
  if (!growable(container, selection)) {
    const start = firstVisibleText(container);
    if (!start) return 'none';
    selection.collapse(start, Math.max(0, start.data.search(/\S/)));
  }
  const before = [
    selection.anchorNode,
    selection.anchorOffset,
    selection.focusNode,
    selection.focusOffset,
  ] as const;
  // A step can end between two pages, on a layer that has no text (the one of the links): one more
  // goes on to the text that follows.
  for (let tries = 0; tries < 4; tries++) {
    const [node, offset] = [selection.focusNode, selection.focusOffset];
    selection.modify('extend', ...STEPS[key]);
    if (
      inText(container, selection.focusNode) ||
      (selection.focusNode === node && selection.focusOffset === offset)
    )
      break;
  }
  if (!inText(container, selection.anchorNode) || !inText(container, selection.focusNode)) {
    if (before[0] && before[2])
      selection.setBaseAndExtent(before[0], before[1], before[2], before[3]);
    return 'edge';
  }
  return selection.anchorNode === before[0] &&
    selection.anchorOffset === before[1] &&
    selection.focusNode === before[2] &&
    selection.focusOffset === before[3]
    ? 'edge'
    : 'moved';
}
