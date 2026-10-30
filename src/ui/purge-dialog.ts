import type { Book } from '../types';
import { $, documents, esc, ib, size } from './dom';
import { modal } from './overlays';

// Asks before documents of Removidos are deleted for good. Says how many, how much room it frees,
// that the copies are erased and the original is not touched, and that the reading history stays.
// The answer is true only for the destructive button; the focus starts on Cancelar.
export function confirmPurge(
  books: Pick<Book, 'title' | 'size'>[],
  emptying: boolean,
): Promise<boolean> {
  const total = books.reduce((sum, b) => sum + b.size, 0);
  const one = books.length === 1;
  const title = emptying
    ? 'Esvaziar Removidos?'
    : one
      ? 'Excluir definitivamente este documento?'
      : `Excluir definitivamente ${documents(books.length)}?`;
  const what = one
    ? `<strong>${esc(books[0].title)}</strong> (${size(total)}) será excluído da biblioteca.`
    : `<strong>${documents(books.length)}</strong> (${size(total)}) serão excluídos da biblioteca.`;
  return new Promise((resolve) => {
    const d = modal(
      `<div class="dialog-heading"><h2>${title}</h2>${ib('close-purge', 'Fechar', 'close', 'data-close')}</div><p>${what}</p><ul class="purge-notes"><li>As cópias guardadas pelo Fólio (o PDF e a capa) serão apagadas. Isso libera ${size(total)} e não pode ser desfeito.</li><li>O arquivo original, fora da biblioteca, não é afetado.</li><li>O histórico de leitura é mantido.</li></ul><div class="dialog-actions"><button id="purge-cancel" class="secondary" data-close>Cancelar</button><button id="purge-confirm" class="primary danger-button">Excluir definitivamente</button></div>`,
    );
    let confirmed = false;
    d.addEventListener('close', () => resolve(confirmed), { once: true });
    $('#purge-confirm').onclick = () => {
      confirmed = true;
      d.close();
    };
    $('#purge-cancel').focus();
  });
}
