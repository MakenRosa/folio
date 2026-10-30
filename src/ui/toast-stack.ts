import { icon } from '../icons';
import { $, esc } from './dom';

export type ToastAction = { label: string; run: () => void };
export type ToastOptions = {
  // An error is announced at once and stays until it is closed. The rest are polite and leave alone.
  kind?: 'info' | 'error';
  // Milliseconds before it leaves; 0 keeps it until it is closed. By default 4.5 s, or 9 s when
  // it has an action. An error has no time limit unless one is given.
  duration?: number;
  // The technical text of an error, behind the "Detalhes" button.
  detail?: string;
};

// The most messages on screen. When one more arrives, the oldest leaves.
export const MAX_TOASTS = 3;
const SHORT = 4500,
  LONG = 9000,
  // A message that was held by the pointer or the focus stays at least this long after it is let go.
  GRACE = 1000,
  LEAVE = 140;

type Entry = {
  el: HTMLElement;
  message: string;
  detail: string;
  kind: 'info' | 'error';
  hasAction: boolean;
  duration: number;
  left: number;
  since: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  hover: boolean;
  focus: boolean;
};
// Oldest first, which is also the order on screen: the newest is the one nearest the edge.
const stack: Entry[] = [];
let bound = false,
  counter = 0,
  // Where the focus was before it went into a message, to give it back when the message goes.
  returnTo: HTMLElement | null = null;

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Each message has its own clock. It stops while the pointer or the focus is on the message.
function settle(t: Entry) {
  if (t.hover || t.focus) {
    if (t.timer === undefined) return;
    clearTimeout(t.timer);
    t.timer = undefined;
    t.left = Math.max(GRACE, t.left - (Date.now() - t.since));
  } else if (t.timer === undefined && t.duration > 0) {
    t.since = Date.now();
    t.timer = setTimeout(() => dismiss(t), t.left);
  }
}

function dismiss(t: Entry, now = false) {
  const i = stack.indexOf(t);
  if (i < 0) return;
  stack.splice(i, 1);
  clearTimeout(t.timer);
  t.timer = undefined;
  // A button that is removed must not take the focus with it.
  if (t.el.contains(document.activeElement) && returnTo?.isConnected) {
    returnTo.focus({ preventScroll: true });
  }
  if (now || reducedMotion()) return t.el.remove();
  t.el.classList.add('leaving');
  t.el.setAttribute('inert', '');
  setTimeout(() => t.el.remove(), LEAVE);
}

// What a screen said does not follow the reader to the next one: the messages that are not errors
// leave at once. An error stays until it is closed, on whichever screen.
export function dismissNotices() {
  for (const t of [...stack]) if (t.kind !== 'error') dismiss(t, true);
}

function bind(host: HTMLElement) {
  bound = true;
  host.addEventListener('focusin', (e) => {
    // Where the focus came from; nowhere (a click on a button) means there is nothing to give back.
    const from = e.relatedTarget;
    if (!(from instanceof Node && host.contains(from)))
      returnTo = from instanceof HTMLElement ? from : null;
  });
  // Escape closes the message that has the focus, and only that.
  host.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const el = (e.target as HTMLElement).closest('.toast');
    const t = stack.find((x) => x.el === el);
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    dismiss(t);
  });
}

// Shows a message. Several can be on screen, each with its own action and its own clock.
// The result closes it. The container is always there, empty and without size when nothing is
// shown, so that screen readers are already listening when a message is added.
export function toast(message: string, action?: ToastAction, options: ToastOptions = {}) {
  const host = $('#toast');
  if (!bound) bind(host);
  const kind = options.kind ?? 'info',
    detail = options.detail?.trim() ?? '',
    duration = options.duration ?? (kind === 'error' ? 0 : action ? LONG : SHORT);
  // The same plain message again renews the one that is there, instead of piling up.
  const same =
    !action &&
    stack.find(
      (t) => !t.hasAction && t.kind === kind && t.message === message && t.detail === detail,
    );
  if (same) {
    clearTimeout(same.timer);
    same.timer = undefined;
    same.duration = duration;
    same.left = duration;
    settle(same);
    return () => dismiss(same);
  }
  // The messages that are leaving go at once, so that there are never more than the limit.
  host.querySelectorAll('.leaving').forEach((el) => el.remove());
  while (stack.length >= MAX_TOASTS) dismiss(stack[0], true);

  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.kind = kind;
  // An alert is announced as soon as it is added, and does not wait for the polite region.
  if (kind === 'error') el.setAttribute('role', 'alert');
  const detailId = `toast-detail-${++counter}`;
  // The action comes before the button that closes, which is always the last button.
  el.innerHTML = `<span class="toast-text">${esc(message)}</span>${action ? `<button class="toast-action">${esc(action.label)}</button>` : ''}${detail ? `<button class="toast-details" aria-expanded="false" aria-controls="${detailId}">Detalhes</button>` : ''}<button class="toast-close" title="Fechar aviso" aria-label="Fechar aviso">${icon('close')}</button>${detail ? `<pre class="toast-detail" id="${detailId}" hidden>${esc(detail)}</pre>` : ''}`;
  const t: Entry = {
    el,
    message,
    detail,
    kind,
    hasAction: !!action,
    duration,
    left: duration,
    since: Date.now(),
    timer: undefined,
    hover: false,
    focus: false,
  };
  el.querySelector('.toast-close')!.addEventListener('click', () => dismiss(t));
  // The message goes first, so that an action that is clicked twice does not run twice.
  if (action)
    el.querySelector('.toast-action')!.addEventListener('click', () => {
      dismiss(t);
      action.run();
    });
  const details = el.querySelector<HTMLElement>('.toast-details');
  if (details)
    details.addEventListener('click', () => {
      const text = el.querySelector<HTMLElement>('.toast-detail')!;
      text.hidden = !text.hidden;
      details.setAttribute('aria-expanded', String(!text.hidden));
    });
  el.addEventListener('pointerenter', () => {
    t.hover = true;
    settle(t);
  });
  el.addEventListener('pointerleave', () => {
    t.hover = false;
    settle(t);
  });
  el.addEventListener('focusin', () => {
    t.focus = true;
    settle(t);
  });
  el.addEventListener('focusout', (e) => {
    if (el.contains(e.relatedTarget as Node | null)) return;
    t.focus = false;
    settle(t);
  });
  stack.push(t);
  host.append(el);
  settle(t);
  return () => dismiss(t);
}
