import { icon } from '../icons';
export const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
export const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export const size = (n: number) =>
  n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
export const ib = (id: string, label: string, ico: string, extra = '') =>
  `<button id="${id}" class="icon-button" title="${label}" aria-label="${label}" ${extra}>${icon(ico)}</button>`;
// "1 documento", "12 documentos".
export const documents = (n: number) => `${n} ${n === 1 ? 'documento' : 'documentos'}`;
