import type { Book, Snapshot, Preferences } from '../types';
import { asset } from '../bridge';
import { icon } from '../icons';
import { $, esc, size } from './dom';
type LibraryViewState = { snapshot: Snapshot; filter: string; query: string; prefs: Preferences };
type LibraryViewActions = {
  openBook: (book: Book) => void;
  importFiles: () => void;
  toggleFavorite: (id: string) => void;
  bookMenu: (anchor: HTMLElement, book: Book) => void;
  restoreBook: (id: string) => void;
  applyPrefs: () => void;
};
function cover(b: Book, folder: string, small = false) {
  return `<div class="book-cover ${small ? 'small' : ''}" data-hue="${parseInt(b.hash.slice(0, 2) || '12', 16) % 5}">${b.cover ? `<img src="${asset(`${folder}/covers/${b.id}.png`)}" alt="" loading="lazy" decoding="async">` : `<div class="paper-preview"><span>PDF</span><div class="paper-lines"></div>${icon('file')}</div>`}</div>`;
}
export function renderLibraryView(state: LibraryViewState, actions: LibraryViewActions) {
  const { snapshot, filter, query, prefs } = state;
  const { openBook, importFiles, toggleFavorite, bookMenu, restoreBook, applyPrefs } = actions;
  const all = snapshot.books;
  const counts = {
    all: all.length,
    reading: all.filter((b) => b.lastOpened && !b.finished).length,
    favorites: all.filter((b) => b.favorite).length,
    finished: all.filter((b) => b.finished).length,
  };
  Object.entries(counts).forEach(([key, v]) => ($(`#count-${key}`).textContent = String(v)));
  document
    .querySelectorAll('[data-filter]')
    .forEach((b) => b.classList.toggle('active', b.getAttribute('data-filter') === filter));
  const labels: Record<string, [string, string]> = {
    all: ['Sua biblioteca', 'Boas leituras começam por aqui.'],
    reading: ['Em leitura', 'Seu próximo capítulo está aqui.'],
    favorites: ['Seus favoritos', 'As leituras que merecem ficar por perto.'],
    finished: ['Leituras concluídas', 'Cada página, uma nova perspectiva.'],
    trash: ['Removidos', 'Restaure um documento quando quiser. As cópias são preservadas.'],
  };
  $('#library-title').textContent = labels[filter][0];
  $('#library-subtitle').textContent = labels[filter][1];
  $('#library-total').textContent =
    `${all.length} ${all.length === 1 ? 'documento' : 'documentos'} · ${size(all.reduce((v, b) => v + b.size, 0))}`;
  let books = (filter === 'trash' ? snapshot.trash : all).filter(
    (b) =>
      (filter !== 'reading' || (b.lastOpened && !b.finished)) &&
      (filter !== 'favorites' || b.favorite) &&
      (filter !== 'finished' || b.finished) &&
      `${b.title} ${b.originalName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  books.sort((a, b) =>
    prefs.sort === 'title'
      ? a.title.localeCompare(b.title, 'pt-BR')
      : prefs.sort === 'size'
        ? b.size - a.size
        : prefs.sort === 'added'
          ? b.added - a.added
          : (b.lastOpened || b.added) - (a.lastOpened || a.added),
  );
  const recent = [...all]
    .filter((b) => b.lastOpened && !b.finished)
    .sort((a, b) => b.lastOpened - a.lastOpened)[0];
  const continuation = $('#continue');
  continuation.hidden = filter !== 'all' || !!query || !recent;
  if (recent && !continuation.hidden) {
    const percent = recent.pages ? Math.round((recent.page / recent.pages) * 100) : 0;
    continuation.innerHTML = `<div class="continue-art">${icon('book')}<span class="orbit orbit-one"></span><span class="orbit orbit-two"></span></div><div class="continue-info"><span class="eyebrow">UM BOM PONTO PARA RECOMEÇAR</span><h2>${esc(recent.title)}</h2><span>Página ${recent.page} de ${recent.pages} <span class="dot-separator">·</span> ${percent}% da leitura</span></div><button id="continue-read" class="primary">Continuar leitura ${icon('arrow')}</button>`;
    $('#continue-read').onclick = () => openBook(recent);
  }
  $('#collection-label').textContent = query
    ? `${books.length} RESULTADO${books.length === 1 ? '' : 'S'}`
    : filter === 'all'
      ? 'TODOS OS DOCUMENTOS'
      : labels[filter][0].toLocaleUpperCase();
  const grid = $('#books');
  grid.className = prefs.view === 'list' ? 'book-list' : 'book-grid';
  grid.innerHTML = books
    .map(
      (b) =>
        `<article class="book-card" data-book="${b.id}"><button class="book-open" data-open="${b.id}" ${filter === 'trash' ? 'disabled' : ''} aria-label="Ler ${esc(b.title)}">${cover(b, snapshot.folder)}<div class="book-info"><h3 title="${esc(b.title)}">${esc(b.title)}</h3><p>${b.pages ? `${b.pages} páginas <span>·</span> ` : ''}${size(b.size)}</p><div class="book-state">${b.finished ? `<span class="finished-badge">${icon('check')} Concluído</span>` : b.lastOpened ? `<span>Página ${b.page}${b.pages ? ` de ${b.pages}` : ''}</span><div class="progress-track"><i style="width:${b.pages ? Math.min(100, (b.page / b.pages) * 100) : 0}%"></i></div>` : '<span class="new-badge">Ainda não lido</span>'}</div></div></button><div class="card-actions">${filter === 'trash' ? `<button class="text-button" data-restore="${b.id}">${icon('undo')} Restaurar</button>` : `<button class="icon-button ${b.favorite ? 'selected' : ''}" data-favorite="${b.id}" title="${b.favorite ? 'Remover dos favoritos' : 'Favoritar'}" aria-label="${b.favorite ? 'Remover dos favoritos' : 'Favoritar'} ${esc(b.title)}">${icon('star')}</button><button class="icon-button" data-menu="${b.id}" title="Opções do documento" aria-label="Opções de ${esc(b.title)}">${icon('more')}</button>`}</div></article>`,
    )
    .join('');
  $('#empty').innerHTML = books.length
    ? ''
    : `<div class="empty-state"><div class="empty-illustration">${icon(query ? 'search' : 'book')}</div><span class="eyebrow">${query ? 'TENTE OUTRO TERMO' : 'SUA PRÓXIMA LEITURA COMEÇA AQUI'}</span><h2>${query ? 'Nenhum PDF encontrado' : filter === 'all' ? 'Um lugar para suas leituras' : filter === 'trash' ? 'Nenhum documento removido' : 'Nenhum documento por aqui'}</h2><p>${query ? 'Busque pelo título ou pelo nome original do arquivo.' : filter === 'all' ? 'Adicione um PDF ou uma coleção inteira.<br>O Fólio cuida da biblioteca. Você aproveita a leitura.' : filter === 'favorites' ? 'Marque a estrela de um PDF para encontrá-lo aqui.' : filter === 'reading' ? 'Abra um PDF para acompanhar sua leitura aqui.' : filter === 'finished' ? 'Use “Marcar como concluído” nas opções de um PDF.' : 'Documentos removidos da biblioteca aparecem aqui.'}</p>${filter === 'all' && !query ? `<button id="import-empty" class="primary">${icon('plus')} Escolher PDFs</button><small>Ou arraste os arquivos para esta janela</small>` : ''}</div>`;
  $('#import-empty')?.addEventListener('click', () => importFiles());
  grid
    .querySelectorAll<HTMLElement>('[data-open]')
    .forEach((b) => (b.onclick = () => openBook(all.find((x) => x.id === b.dataset.open)!)));
  grid
    .querySelectorAll<HTMLElement>('[data-favorite]')
    .forEach((b) => (b.onclick = () => toggleFavorite(b.dataset.favorite!)));
  grid.querySelectorAll<HTMLElement>('[data-menu]').forEach(
    (b) =>
      (b.onclick = () =>
        bookMenu(
          b,
          all.find((x) => x.id === b.dataset.menu)!,
        )),
  );
  grid
    .querySelectorAll<HTMLElement>('[data-restore]')
    .forEach((b) => (b.onclick = () => restoreBook(b.dataset.restore!)));
  applyPrefs();
}
