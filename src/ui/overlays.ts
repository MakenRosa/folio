import { $, esc } from './dom';
let toastTimer: ReturnType<typeof setTimeout>;
export function toast(message: string, action?: { label: string; run: () => void }) {
  clearTimeout(toastTimer);
  const t = $('#toast');
  t.innerHTML = `<span>${esc(message)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  t.hidden = false;
  if (action) t.querySelector('button')!.onclick = action.run;
  toastTimer = setTimeout(() => (t.hidden = true), action ? 9000 : 4500);
}
export function fail(error: unknown) {
  console.error(error);
  toast(String(error));
}
export function modal(content: string) {
  closePopover();
  $('#dialog-content').innerHTML = content;
  const d = $<HTMLDialogElement>('#dialog');
  if (!d.open) d.showModal();
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
  return d;
}
export function closePopover() {
  $('#popover').hidden = true;
}
export function popover(anchor: HTMLElement, content: string) {
  const p = $('#popover');
  p.innerHTML = content;
  p.hidden = false;
  const r = anchor.getBoundingClientRect();
  p.style.top = `${r.bottom + 8}px`;
  p.style.left = `${Math.max(8, Math.min(innerWidth - 260, r.right - 248))}px`;
}
document.addEventListener('pointerdown', (e) => {
  if (!(e.target as HTMLElement).closest('#popover, [data-menu], #reader-more')) closePopover();
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
