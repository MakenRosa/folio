import { $ } from './dom';

// The progress of an import lives in the button that started it, and not in a message for every
// file: "Copiando 3 de 10…", a thin bar, and a polite region for screen readers.
export const IMPORT_LABEL = 'Adicionar PDFs';

export function importLabel(done: number, total: number): string {
  return `Copiando ${done} de ${total}…`;
}
// The part of the bar that is full, from 0 to 1.
export function importFraction(done: number, total: number): number {
  return total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
}
// What the screen reader is told. Not every file: the first, and then a few times along the way.
export function importAnnouncement(done: number, total: number): string | null {
  const step = Math.max(1, Math.ceil(total / 5));
  return done === 0 || (done < total && done % step === 0) ? importLabel(done, total) : null;
}

export function showImportProgress(done: number, total: number) {
  const button = $('#import-main');
  const label = importLabel(done, total);
  button.setAttribute('disabled', '');
  button.setAttribute('aria-busy', 'true');
  $('#import-folder').setAttribute('disabled', '');
  $('#import-main .add-label').textContent = label;
  $('#import-main .add-bar').hidden = false;
  button.style.setProperty('--import-progress', String(importFraction(done, total)));
  const said = importAnnouncement(done, total);
  if (said) $('#import-status').textContent = said;
}

export function hideImportProgress() {
  const button = $('#import-main');
  button.removeAttribute('disabled');
  button.removeAttribute('aria-busy');
  $('#import-folder').removeAttribute('disabled');
  $('#import-main .add-label').textContent = IMPORT_LABEL;
  $('#import-main .add-bar').hidden = true;
  button.style.removeProperty('--import-progress');
  $('#import-status').textContent = '';
}
