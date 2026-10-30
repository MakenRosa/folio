import { $ } from './dom';
import { isTypedCharacter, menuIndexAfterKey, typeaheadIndex } from './menu-navigation';
import { placePopover, pointBox } from './popover-position';
import { toast } from './toast-stack';
import { describeError } from './error-text';
export { toast, type ToastAction, type ToastOptions } from './toast-stack';
// A failure, in a sentence the reader understands. It stays until it is closed, and the
// original text of the error is one click away, under "Detalhes". `context` says what was
// being done: "Não foi possível abrir este PDF." comes before the reason.
export function fail(error: unknown, context?: string) {
  console.error(error);
  const { message, detail } = describeError(error);
  toast(context ? `${context} ${message}` : message, undefined, { kind: 'error', detail });
}
export function modal(content: string) {
  closePopover();
  $('#dialog-content').innerHTML = content;
  const d = $<HTMLDialogElement>('#dialog');
  if (!d.open) d.showModal();
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
  return d;
}
// The one floating panel: a menu of actions (role "menu") or a small dialog, like the quick
// brightness control. It is placed by `placePopover`, so that it always fits in the window.
export type PopoverOptions = {
  // A list of actions: the panel is a menu, takes the focus, and the arrows move through it.
  menu?: boolean;
  // The accessible name of a menu.
  label?: string;
  // Where the pointer was (window coordinates): the panel opens there and not under the anchor.
  at?: { x: number; y: number };
  // Who gets the focus back when the panel closes. The anchor, unless said otherwise.
  owner?: HTMLElement;
};
let anchorElement: HTMLElement | null = null;
// Where the anchor was when the panel was placed.
let anchorPlace = { top: 0, left: 0 };
let expanded: HTMLElement | null = null;
let ownerCount = 0;
export function closePopover(restoreFocus = false) {
  const panel = $('#popover');
  const owner = panel.dataset.owner && document.getElementById(panel.dataset.owner);
  panel.hidden = true;
  if (expanded) expanded.setAttribute('aria-expanded', 'false');
  expanded = null;
  anchorElement = null;
  // Only a button that opens the panel says it is expanded. A card that got the menu does not.
  if (owner && owner.hasAttribute('aria-expanded')) owner.setAttribute('aria-expanded', 'false');
  if (restoreFocus && owner) owner.focus({ preventScroll: true });
  delete panel.dataset.owner;
  delete panel.dataset.side;
  panel.removeAttribute('role');
  panel.removeAttribute('aria-label');
  panel.removeAttribute('aria-labelledby');
}
const menuItems = (panel: HTMLElement) => [
  ...panel.querySelectorAll<HTMLElement>('[role="menuitem"]'),
];
export function popover(anchor: HTMLElement, content: string, options: PopoverOptions = {}) {
  closePopover();
  const p = $('#popover');
  p.innerHTML = content;
  const owner = options.owner ?? anchor;
  owner.id ||= `popover-owner-${++ownerCount}`;
  p.dataset.owner = owner.id;
  anchorElement = anchor;
  const { top, left } = anchor.getBoundingClientRect();
  anchorPlace = { top, left };
  if (options.menu) {
    p.setAttribute('role', 'menu');
    if (options.label) p.setAttribute('aria-label', options.label);
    p.querySelectorAll('button').forEach((item) => {
      item.setAttribute('role', 'menuitem');
      item.tabIndex = -1;
    });
    // A menu at the pointer has no button to mark as open.
    if (!options.at) {
      anchor.setAttribute('aria-haspopup', 'menu');
      anchor.setAttribute('aria-expanded', 'true');
      expanded = anchor;
    }
  }
  // Measured at its natural height, then placed in one step, so that it never shows in the wrong place.
  p.style.maxHeight = 'none';
  p.hidden = false;
  const box = p.getBoundingClientRect();
  const root = document.documentElement;
  const place = placePopover({
    anchor: options.at ? pointBox(options.at.x, options.at.y) : anchor.getBoundingClientRect(),
    width: box.width,
    height: box.height,
    viewport: { width: root.clientWidth || innerWidth, height: root.clientHeight || innerHeight },
    align: options.at ? 'start' : 'end',
    gap: options.at ? 0 : undefined,
  });
  p.style.left = `${place.left}px`;
  p.style.top = `${place.top}px`;
  p.style.maxHeight = `${place.maxHeight}px`;
  p.dataset.side = place.side;
  if (options.menu) menuItems(p)[0]?.focus({ preventScroll: true });
}
document.addEventListener('pointerdown', (e) => {
  if (!(e.target as HTMLElement).closest('#popover, [data-menu], #reader-more')) closePopover();
});
// The panel is placed once. If what it hangs from moves or the window changes, it closes.
addEventListener('resize', () => {
  if (!$('#popover').hidden) closePopover();
});
document.addEventListener(
  'scroll',
  (e) => {
    const panel = $('#popover');
    const target = e.target;
    if (panel.hidden || (target instanceof Node && panel.contains(target))) return;
    if (
      !anchorElement ||
      !(target === document || (target instanceof Node && target.contains(anchorElement)))
    )
      return;
    // A scroll event can arrive just after the panel opened, for a scroll that happened before.
    // Only a move of the anchor itself detaches the panel from it.
    const now = anchorElement.getBoundingClientRect();
    if (Math.abs(now.top - anchorPlace.top) > 1 || Math.abs(now.left - anchorPlace.left) > 1)
      closePopover();
  },
  true,
);
// The browser menu has nothing for the panel. Cards ask for their own (see the library).
document.addEventListener('contextmenu', (e) => {
  if ((e.target as HTMLElement).closest?.('#popover')) e.preventDefault();
});
// Keys of a menu. Escape is handled with the other global keys, in shortcuts.ts.
let typed = '',
  typedAt = 0;
document.addEventListener('keydown', (e) => {
  const panel = $('#popover');
  if (panel.hidden || panel.getAttribute('role') !== 'menu') return;
  if (!(e.target instanceof Node) || !panel.contains(e.target)) return;
  // Tab leaves the menu: the focus goes back to the button, and Tab moves on from there.
  if (e.key === 'Tab') {
    closePopover(true);
    return;
  }
  const items = menuItems(panel);
  const enabled = items.map((item) => !(item as HTMLButtonElement).disabled);
  const current = items.indexOf(document.activeElement as HTMLElement);
  const moved =
    e.ctrlKey || e.altKey || e.metaKey ? null : menuIndexAfterKey(e.key, current, enabled);
  if (moved !== null) {
    e.preventDefault();
    items[moved].focus();
  } else if (isTypedCharacter(e)) {
    typed = e.timeStamp - typedAt > 700 ? e.key : typed + e.key;
    typedAt = e.timeStamp;
    const found = typeaheadIndex(
      items.map((item) => item.textContent ?? ''),
      enabled,
      current,
      typed,
    );
    // Typing in a menu never reaches the page, even when no item starts with the letter.
    e.preventDefault();
    if (found !== null) items[found].focus();
  }
});
document.addEventListener(
  'click',
  (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (a && a.href && !a.href.startsWith(location.origin) && !a.href.startsWith('blob:')) {
      e.preventDefault();
      e.stopPropagation();
      toast('Links externos não são abertos automaticamente.');
    }
  },
  true,
);
