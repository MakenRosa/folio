import { $ } from './dom';
import { isTypedCharacter, menuIndexAfterKey, typeaheadIndex } from './menu-navigation';
import { placePopover, pointBox } from './popover-position';
import { toast, placeToasts, dismissNotices } from './toast-stack';
import { GENERIC_ERROR, describeError } from './error-text';
export {
  toast,
  announce,
  dismissNotices,
  type ToastAction,
  type ToastOptions,
} from './toast-stack';
// An error that the reader was already told about: whoever catches it further up has nothing
// to add, so `fail` ignores it and the same failure is not shown twice.
export class ReportedError extends Error {}
// A failure, in a sentence the reader understands. It stays until it is closed, and the
// original text of the error is one click away, under "Detalhes". `context` says what was
// being done: "Não foi possível abrir este PDF." comes before the reason. When there is no
// rule for the reason, the context says it all; when the reason already says it, it stands alone.
export function fail(error: unknown, context?: string) {
  if (error instanceof ReportedError) return;
  console.error(error);
  const { message, detail } = describeError(error);
  const text =
    !context || message.startsWith(context)
      ? message
      : `${context} ${message === GENERIC_ERROR ? 'Tente novamente.' : message}`;
  toast(text, undefined, { kind: 'error', detail });
}
// `fail` with its context, for a `.catch(...)`.
export const failing = (context: string) => (error: unknown) => fail(error, context);
// The fields a dialog can start on: the ones that take text or a choice, not a switch or a radio.
const START_FIELDS =
  'input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled)';
// Where the focus goes when a dialog opens: what the dialog marks with `autofocus`, else its first
// field, else its main action (never one that destroys). Without this the first stop is the X of the
// header, and keys typed right away (an Enter, even) land on it instead of on the task.
function focusStart(d: HTMLElement) {
  const visible = (el: HTMLElement) => !el.closest('[hidden]');
  const target =
    [...d.querySelectorAll<HTMLElement>('[autofocus]')].find(visible) ??
    [...d.querySelectorAll<HTMLElement>(START_FIELDS)].find(visible) ??
    d.querySelector<HTMLElement>('button.primary:not(.danger-button):not(:disabled)');
  target?.focus({ preventScroll: true });
}
// Shows a dialog, from its start: at the top, with the focus where `focusStart` puts it. With `again`
// it is the dialog that is on screen, drawn again because a choice in it changed what it shows: the
// scroll stays, the focus stays on the control that had it (found by its `id`), and so do the panels
// (`<details>`) that were open. The dialog is named by its first title (an `h2`), so that a screen
// reader says which dialog it is; one without a title has no name. The messages of the page (`toast`)
// that are information leave when a dialog opens, so that they do not cover its buttons; the errors
// stay. While it is open, the messages that arrive are shown inside it, at its top, where they can
// be seen and pressed.
let watchingDialog = false;
export function modal(content: string, again = false) {
  closePopover();
  if (!again) dismissNotices();
  const d = $<HTMLDialogElement>('#dialog'),
    body = $('#dialog-content');
  const active = again && body.contains(document.activeElement) ? document.activeElement : null;
  const keep = active instanceof HTMLElement ? active.id : '';
  const panels = again ? [...body.querySelectorAll('details')].map((panel) => panel.open) : [];
  body.innerHTML = content;
  const title = body.querySelector('h2');
  if (title) {
    title.id ||= 'dialog-title';
    d.setAttribute('aria-labelledby', title.id);
  } else d.removeAttribute('aria-labelledby');
  if (!d.open) d.showModal();
  placeToasts();
  // Back to the page when it closes, by any way (a button, Esc, the code).
  if (!watchingDialog) {
    watchingDialog = true;
    d.addEventListener('close', placeToasts);
  }
  // The dialog is one element for all of them, and the browser keeps where it was scrolled to.
  if (!again) d.scrollTop = 0;
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
  const found = keep ? document.getElementById(keep) : null;
  if (found && body.contains(found) && !found.matches(':disabled')) {
    body.querySelectorAll('details').forEach((panel, i) => (panel.open = panels[i] ?? panel.open));
    found.focus({ preventScroll: true });
  } else focusStart(d);
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
