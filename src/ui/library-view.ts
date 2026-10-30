import type { Book, Snapshot, Preferences } from '../types';
import { asset } from '../bridge';
import { icon } from '../icons';
import { readingProgress } from '../reading/progress';
import { formatDuration, remainingTime, secondsPerPage } from '../reading/pace';
import { searchBook, type SearchHit } from '../library/search';
import { cardAfterKey } from '../library/card-navigation';
import { pruneSelection } from '../library/selection';
import { filterTag, hasTag, tagCounts, tagFilter, tagsOf, type TagCount } from '../library/tags';
import { $, documents, esc, size } from './dom';
import type { PopoverOptions } from './overlays';
type LibraryViewState = {
  snapshot: Snapshot;
  filter: string;
  query: string;
  prefs: Preferences;
  // The ids ticked. A drawing takes out of it what it does not show.
  selected: Set<string>;
};
type LibraryViewActions = {
  openBook: (book: Book) => void;
  importFiles: () => void;
  importFolder: () => void;
  toggleFavorite: (id: string) => void;
  // Ctrl + click (or the box of the card) ticks or unticks one; Shift + click ticks the range up to it.
  select: (id: string, mode: 'toggle' | 'range') => void;
  bookMenu: (
    anchor: HTMLElement,
    book: Book,
    options?: Pick<PopoverOptions, 'at' | 'owner'>,
  ) => void;
  restoreBook: (id: string) => void;
  applyPrefs: () => void;
  // The way out of a search that found nothing: clears the field and draws the list again.
  clearSearch: () => void;
};
function cover(b: Book, folder: string) {
  return `<div class="book-cover" data-hue="${parseInt(b.hash.slice(0, 2) || '12', 16) % 5}">${b.cover ? `<img src="${asset(`${folder}/covers/${b.id}.png`)}" alt="" loading="lazy" decoding="async">` : `<div class="paper-preview"><span>PDF</span><div class="paper-lines"></div>${icon('file')}</div>`}</div>`;
}
function progressBar(b: Book) {
  return `<div class="progress-track"><i style="width:${readingProgress(b)}%"></i></div>`;
}
// The first tags of a book, on one line that is cut where the card ends.
function tagLine(tags: string[]) {
  const shown = tags.slice(0, 3),
    more = tags.length - shown.length;
  return `<p class="book-tags" title="${esc(`Etiquetas: ${tags.join(', ')}`)}">${shown.map(esc).join(' · ')}${more ? ` · +${more}` : ''}</p>`;
}
// The ids of the author and of the state of a card (where the reading is). The button of the card
// is named "Ler {título}"; these two are what a screen reader says after the name (aria-describedby),
// so that the progress, "Concluído" or "Ainda não lido" are heard and not only seen.
const authorId = (b: Book) => `book-author-${b.id}`;
const stateId = (b: Book) => `book-state-${b.id}`;
const describedBy = (b: Book) => (b.author ? `${authorId(b)} ${stateId(b)}` : stateId(b));
// Title, author (when the PDF has one), tags, size and where the reading is. It is the part of a
// card that changes when the library queue learns something new about the book. `hit` says where
// a search found it: a search that only the notes answered says so.
function bookInfo(b: Book, hit: SearchHit | null = null) {
  const tags = tagsOf(b);
  return `<div class="book-info"><h3 title="${esc(b.title)}">${esc(b.title)}</h3>${b.author ? `<p class="book-author" id="${esc(authorId(b))}" title="${esc(b.author)}">${esc(b.author)}</p>` : ''}${tags.length ? tagLine(tags) : ''}${hit === 'notes' ? `<p class="book-found">${icon('note')} Encontrado nas notas</p>` : ''}<p>${b.pages ? `${b.pages} página${b.pages === 1 ? '' : 's'} <span>·</span> ` : ''}${size(b.size)}</p><div class="book-state" id="${esc(stateId(b))}">${b.finished ? `<span class="finished-badge">${icon('check')} Concluído</span>${progressBar(b)}` : b.lastOpened ? `<span>Página ${b.page}${b.pages ? ` de ${b.pages} · ${readingProgress(b)}%` : ''}</span>${progressBar(b)}` : '<span class="new-badge">Ainda não lido</span>'}</div></div>`;
}
// The cover of a card with its text. It opens the book; in Removidos it is only a block of text
// (a button that cannot be pressed would be announced as unavailable and dimmed), and the click goes
// through to the card, which can still be ticked.
const cardCover = (b: Book, removed: boolean, content: string) =>
  removed
    ? `<div class="book-open">${content}</div>`
    : `<button class="book-open" data-open="${b.id}" tabindex="-1" aria-label="Ler ${esc(b.title)}" aria-describedby="${esc(describedBy(b))}">${content}</button>`;
// The star of a card, as the one of the reader: the name stays ("Favoritar {título}") and `aria-pressed`
// says the state. The tooltip says what a click does now.
const favoriteLabel = (b: Book) => `Favoritar ${b.title}`;
const favoriteTitle = (b: Book) => (b.favorite ? 'Remover dos favoritos' : 'Favoritar');
const cardOf = (id: string) =>
  $('#books').querySelector<HTMLElement>(`[data-book="${CSS.escape(id)}"]`);
// One tag of the side bar. The list is drawn again only when a tag, a spelling or a count
// changed, so that a click on a tag does not take the focus away from its button.
function renderTagNav(known: TagCount[]) {
  $('#tag-section').hidden = !known.length;
  const nav = $('#tag-nav');
  const signature = known.map((t) => `${t.key}\u0000${t.label}\u0000${t.count}`).join('\u0001');
  if (nav.dataset.signature === signature) return;
  nav.dataset.signature = signature;
  const focused = nav.contains(document.activeElement)
    ? (document.activeElement as HTMLElement).dataset.filter
    : null;
  nav.innerHTML = known
    .map(
      (t) =>
        `<button class="nav-item tag-item" data-filter="${esc(tagFilter(t.key))}" title="${esc(t.label)}">${icon('tag')}<span>${esc(t.label)}</span><small>${t.count}</small></button>`,
    )
    .join('');
  if (focused)
    nav
      .querySelector<HTMLElement>(`[data-filter="${CSS.escape(focused)}"]`)
      ?.focus({ preventScroll: true });
}
// The cards of the library are one stop of Tab (the roving tabindex of the WAI-ARIA Authoring
// Practices): the buttons of the active card (open, star, options; in Removidos, restore and
// options) are in the order of Tab, and those of the others are not. The arrows, Home and End move
// the focus from card to card, and the card that has the focus is the active one. The box that ticks
// a card is out of the order, and Space on the main button ticks it.
const CARD_BUTTONS = '[data-open], [data-restore], [data-favorite], [data-menu]';
const mainButton = (card: HTMLElement) =>
  card.querySelector<HTMLElement>('[data-open], [data-restore]');
let activeBook: string | null = null;
function activateCard(card: HTMLElement | null) {
  const previous = activeBook ? cardOf(activeBook) : null;
  if (previous && previous !== card)
    previous.querySelectorAll<HTMLElement>(CARD_BUTTONS).forEach((b) => (b.tabIndex = -1));
  activeBook = card?.dataset.book ?? null;
  card?.querySelectorAll<HTMLElement>(CARD_BUTTONS).forEach((b) => (b.tabIndex = 0));
}
// The main button of the card that is the stop of Tab.
const activeButton = () => {
  const card = activeBook ? cardOf(activeBook) : null;
  return (card && mainButton(card)) ?? mainButton($('#books'));
};
let boundGrid: HTMLElement | null = null;
// A toggle of the selection bar keeps its name and its text; the state is `aria-pressed` (and the look
// that goes with it), and the tooltip says what the click does now.
const setToggle = (button: HTMLElement, pressed: boolean, action: string) => {
  button.setAttribute('aria-pressed', String(pressed));
  button.title = action;
};
// The bar of the selection, and the ticks of the cards, from `selected`. It does not draw the list
// again: a click on a card only changes these.
export function updateSelection(state: Pick<LibraryViewState, 'snapshot' | 'filter' | 'selected'>) {
  const { snapshot, filter, selected } = state;
  const trash = filter === 'trash';
  const grid = $('#books');
  grid.classList.toggle('selecting', selected.size > 0);
  grid.querySelectorAll<HTMLElement>('.book-card').forEach((card) => {
    const on = selected.has(card.dataset.book!);
    card.classList.toggle('selected', on);
    const box = card.querySelector<HTMLInputElement>('[data-select]');
    if (box) box.checked = on;
  });
  const chosen = (trash ? snapshot.trash : snapshot.books).filter((b) => selected.has(b.id));
  const bar = $('#selection-bar');
  const leaving = !bar.hidden && !chosen.length && bar.contains(document.activeElement);
  bar.hidden = !chosen.length;
  document.documentElement.toggleAttribute('data-selecting', !!chosen.length);
  $('#selection-count').textContent = chosen.length
    ? `${chosen.length} selecionado${chosen.length === 1 ? '' : 's'}`
    : '';
  for (const id of ['favorite', 'finish', 'tag', 'remove']) $(`#select-${id}`).hidden = trash;
  for (const id of ['restore', 'purge']) $(`#select-${id}`).hidden = !trash;
  if (chosen.length && !trash) {
    const favorite = chosen.every((b) => b.favorite),
      finished = chosen.every((b) => b.finished);
    setToggle($('#select-favorite'), favorite, favorite ? 'Remover dos favoritos' : 'Favoritar');
    setToggle(
      $('#select-finish'),
      finished,
      finished ? 'Marcar como não concluído' : 'Marcar como concluído',
    );
  }
  // A bar that goes away must not take the focus with it.
  if (leaving) (activeButton() ?? $('#library-search')).focus({ preventScroll: true });
}
// Draws the library: the side bar's tags and counts, the title of the filter and the cards. Says
// which cards are on screen, in order.
export function renderLibraryView(state: LibraryViewState, actions: LibraryViewActions) {
  const { snapshot, filter, query, prefs, selected } = state;
  const {
    openBook,
    importFiles,
    importFolder,
    toggleFavorite,
    bookMenu,
    restoreBook,
    applyPrefs,
    clearSearch,
  } = actions;
  const all = snapshot.books;
  const known = tagCounts(all);
  const counts = {
    all: all.length,
    reading: all.filter((b) => b.lastOpened && !b.finished).length,
    favorites: all.filter((b) => b.favorite).length,
    finished: all.filter((b) => b.finished).length,
    trash: snapshot.trash.length,
  };
  Object.entries(counts).forEach(([key, v]) => ($(`#count-${key}`).textContent = String(v)));
  renderTagNav(known);
  document.querySelectorAll('[data-filter]').forEach((b) => {
    const active = b.getAttribute('data-filter') === filter;
    b.classList.toggle('active', active);
    if (active) b.setAttribute('aria-current', 'true');
    else b.removeAttribute('aria-current');
  });
  const tag = filterTag(filter);
  const labels: Record<string, [string, string]> = {
    all: ['Sua biblioteca', 'Boas leituras começam por aqui.'],
    reading: ['Em leitura', 'Seu próximo capítulo está aqui.'],
    favorites: ['Seus favoritos', 'As leituras que merecem ficar por perto.'],
    finished: ['Leituras concluídas', 'Cada página, uma nova perspectiva.'],
    trash: [
      'Removidos',
      'Restaure um documento quando quiser. As cópias ficam guardadas até você excluí-las de vez.',
    ],
  };
  const tagged = known.find((t) => t.key === tag);
  if (tagged)
    labels[filter] = [
      `Etiqueta: ${tagged.label}`,
      `Documentos que você marcou com “${tagged.label}”.`,
    ];
  const [title, subtitle] = labels[filter] ?? labels.all;
  $('#library-title').textContent = title;
  $('#library-subtitle').textContent = subtitle;
  $('#library-total').textContent =
    `${documents(all.length)} · ${size(all.reduce((v, b) => v + b.size, 0))}`;
  // It counts the library, not the list: in Removidos the list is the trash, and the bar under
  // the title already says what is there.
  $('#library-total').hidden = filter === 'trash';
  // The goal is for reading: it stays out of Removidos, of a search and of the filters that are not
  // the reading itself.
  $('#library-goal').hidden = (filter !== 'all' && filter !== 'reading') || !!query;
  $('#trash-bar').hidden = filter !== 'trash' || !snapshot.trash.length;
  $('#trash-summary').textContent =
    `${documents(snapshot.trash.length)} · ${size(snapshot.trash.reduce((v, b) => v + b.size, 0))} que podem ser liberados`;
  const hits = new Map<string, SearchHit>();
  const books = (filter === 'trash' ? snapshot.trash : all).filter((b) => {
    if (filter === 'reading' && !(b.lastOpened && !b.finished)) return false;
    if (filter === 'favorites' && !b.favorite) return false;
    if (filter === 'finished' && !b.finished) return false;
    if (tag !== null && !hasTag(b, tag)) return false;
    const hit = searchBook(b, query);
    if (hit) hits.set(b.id, hit);
    return !!hit;
  });
  books.sort((a, b) =>
    prefs.sort === 'title'
      ? a.title.localeCompare(b.title, 'pt-BR')
      : prefs.sort === 'size'
        ? b.size - a.size
        : prefs.sort === 'added'
          ? b.added - a.added
          : (b.lastOpened || b.added) - (a.lastOpened || a.added),
  );
  // What is not on screen is not selected: the bar counts what its buttons act on.
  pruneSelection(
    selected,
    books.map((b) => b.id),
  );
  const recent = [...all]
    .filter((b) => b.lastOpened && !b.finished)
    .sort((a, b) => b.lastOpened - a.lastOpened)[0];
  const continuation = $('#continue');
  continuation.hidden = filter !== 'all' || !!query || !recent;
  if (recent && !continuation.hidden) {
    continuation.dataset.book = recent.id;
    const percent = readingProgress(recent);
    const left = remainingTime({
      page: recent.page,
      pages: recent.pages,
      secondsPerPage: secondsPerPage(prefs.pace, recent.id),
    });
    continuation.innerHTML = `<div class="continue-art">${icon('book')}<span class="orbit orbit-one"></span><span class="orbit orbit-two"></span></div><div class="continue-info"><span class="eyebrow">UM BOM PONTO PARA RECOMEÇAR</span><h2>${esc(recent.title)}</h2><span>Página ${recent.page} de ${recent.pages} <span class="dot-separator">·</span> ${percent}% da leitura${left ? ` <span class="dot-separator">·</span> ≈ ${formatDuration(left.book)} para terminar` : ''}</span></div><button id="continue-read" class="primary">Continuar leitura ${icon('arrow')}</button>`;
    // The book as it is when the button is pressed: the queue may have learned more since.
    $('#continue-read').onclick = () =>
      openBook(snapshot.books.find((x) => x.id === recent.id) ?? recent);
  }
  $('#collection-label').textContent = query
    ? `${books.length} RESULTADO${books.length === 1 ? '' : 'S'}`
    : filter === 'all'
      ? 'TODOS OS DOCUMENTOS'
      : title.toLocaleUpperCase();
  const grid = $('#books');
  grid.className = prefs.view === 'list' ? 'book-list' : 'book-grid';
  grid.innerHTML = books
    .map(
      (b) =>
        `<article class="book-card" data-book="${b.id}"><input type="checkbox" class="select-check" data-select="${b.id}" tabindex="-1" aria-label="Selecionar ${esc(b.title)}">${cardCover(b, filter === 'trash', `${cover(b, snapshot.folder)}${bookInfo(b, hits.get(b.id))}`)}<div class="card-actions">${filter === 'trash' ? `<button class="text-button" data-restore="${b.id}" tabindex="-1">${icon('undo')} Restaurar</button><button class="icon-button" data-menu="${b.id}" tabindex="-1" title="Opções do documento" aria-label="Opções de ${esc(b.title)}" aria-haspopup="menu" aria-expanded="false">${icon('more')}</button>` : `<button class="icon-button ${b.favorite ? 'selected' : ''}" data-favorite="${b.id}" tabindex="-1" title="${favoriteTitle(b)}" aria-label="${esc(favoriteLabel(b))}" aria-pressed="${!!b.favorite}">${icon('star')}</button><button class="icon-button" data-menu="${b.id}" tabindex="-1" title="Opções do documento" aria-label="Opções de ${esc(b.title)}" aria-haspopup="menu" aria-expanded="false">${icon('more')}</button>`}</div></article>`,
    )
    .join('');
  $('#empty').innerHTML = books.length
    ? ''
    : `<div class="empty-state"><div class="empty-illustration">${icon(query ? 'search' : 'book')}</div><span class="eyebrow">${query ? 'TENTE OUTRO TERMO' : 'SUA PRÓXIMA LEITURA COMEÇA AQUI'}</span><h2>${query ? 'Nenhum documento encontrado' : filter === 'all' ? 'Um lugar para suas leituras' : filter === 'trash' ? 'Nenhum documento removido' : 'Nenhum documento por aqui'}</h2><p>${query ? 'Busque pelo título, autor, nome do arquivo, etiquetas ou notas.' : filter === 'all' ? 'Adicione um PDF ou uma coleção inteira.<br>O Fólio cuida da biblioteca. Você aproveita a leitura.' : filter === 'favorites' ? 'Marque a estrela de um documento para encontrá-lo aqui.' : filter === 'reading' ? 'Abra um documento para acompanhar sua leitura aqui.' : filter === 'finished' ? 'Use “Marcar como concluído” nas opções de um documento.' : tag !== null ? 'Adicione esta etiqueta a um documento pelo menu dele.' : 'Documentos removidos da biblioteca aparecem aqui.'}</p>${query ? `<button id="clear-search" class="secondary">${icon('close')} Limpar busca</button>` : filter === 'all' ? `<button id="import-empty" class="primary">${icon('plus')} Escolher PDFs</button><button id="import-folder-empty" class="text-button">${icon('folder')} Adicionar uma pasta</button><small>Ou arraste PDFs e pastas para esta janela</small>` : ''}</div>`;
  $('#import-empty')?.addEventListener('click', () => importFiles());
  $('#import-folder-empty')?.addEventListener('click', () => importFolder());
  $('#clear-search')?.addEventListener('click', () => clearSearch());
  // Ctrl + click ticks a card, Shift + click ticks up to it; with neither, the click is the
  // card's own. The keyboard does the same: Ctrl + Enter or Shift + Enter on the card.
  const how = (e: MouseEvent) => (e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : null);
  grid.querySelectorAll<HTMLElement>('[data-open]').forEach(
    (b) =>
      (b.onclick = (e) => {
        const mode = how(e);
        if (mode) actions.select(b.dataset.open!, mode);
        else openBook(snapshot.books.find((x) => x.id === b.dataset.open)!);
      }),
  );
  grid
    .querySelectorAll<HTMLInputElement>('[data-select]')
    .forEach(
      (box) =>
        (box.onclick = (e) => actions.select(box.dataset.select!, e.shiftKey ? 'range' : 'toggle')),
    );
  grid
    .querySelectorAll<HTMLElement>('[data-favorite]')
    .forEach((b) => (b.onclick = () => toggleFavorite(b.dataset.favorite!)));
  const find = (id: string) => [...snapshot.books, ...snapshot.trash].find((x) => x.id === id)!;
  grid
    .querySelectorAll<HTMLElement>('[data-menu]')
    .forEach((b) => (b.onclick = () => bookMenu(b, find(b.dataset.menu!))));
  // The same menu as the button of the card, for the right button and for the keyboard. A card
  // has no focus of its own: the control that has it (or the one that opens the book) gets it back.
  const cardAt = (target: EventTarget | null) =>
    (target as HTMLElement | null)?.closest<HTMLElement>('.book-card') ?? null;
  const control = (card: HTMLElement) =>
    card.querySelector<HTMLElement>('[data-open], [data-restore]')!;
  const anchorOf = (card: HTMLElement) =>
    card.querySelector<HTMLElement>('[data-menu]') ?? control(card);
  const bookOf = (card: HTMLElement) => find(card.dataset.book!);
  // In Removidos the cover opens nothing: the click is the card's, which can still be ticked.
  grid.onclick = (e) => {
    const card = cardAt(e.target);
    const mode = how(e);
    if (card && mode && !(e.target as HTMLElement).closest('button, input'))
      actions.select(card.dataset.book!, mode);
  };
  grid.oncontextmenu = (e) => {
    const card = cardAt(e.target);
    if (!card) return;
    e.preventDefault();
    if (e.button === 2)
      bookMenu(anchorOf(card), bookOf(card), {
        at: { x: e.clientX, y: e.clientY },
        owner: control(card),
      });
    // A menu key arrives here too, on some systems, after the key down that already opened it.
    else if ($('#popover').hidden) bookMenu(anchorOf(card), bookOf(card), { owner: control(card) });
  };
  grid.onkeydown = (e) => {
    const card = cardAt(e.target);
    if (!card) return;
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      bookMenu(anchorOf(card), bookOf(card), { owner: e.target as HTMLElement });
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    // Space on the main button ticks the card, as its box does (Shift + Space ticks the range);
    // Enter, which opens, is the button's own. The star and the options keep Space for themselves.
    if (e.key === ' ') {
      if (!(e.target as HTMLElement).matches('[data-open], [data-restore]')) return;
      e.preventDefault();
      if (!e.repeat) actions.select(card.dataset.book!, e.shiftKey ? 'range' : 'toggle');
      return;
    }
    if (
      e.shiftKey ||
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)
    )
      return;
    // The arrows, Home and End, from any button of the card, to the main button of another.
    const cards = [...grid.querySelectorAll<HTMLElement>('.book-card')];
    const boxes = cards.map((c) => c.getBoundingClientRect());
    const at = cardAfterKey(
      boxes,
      cards.indexOf(card),
      e.key,
      grid.classList.contains('book-list'),
    );
    if (at === undefined) return;
    e.preventDefault();
    // The card is brought into view first: a card far from the screen is drawn only when it gets
    // near it, and the focus can then go to it. The first row also shows what is above it.
    cards[at].scrollIntoView({ block: 'nearest' });
    if (boxes[at].top - boxes[0].top < 4) grid.closest('.library-main')?.scrollTo({ top: 0 });
    mainButton(cards[at])?.focus({ preventScroll: true });
  };
  // Whatever gives focus to a button of a card (a key, a click, the drawing that puts it back) makes
  // that card the one of Tab.
  if (boundGrid !== grid) {
    boundGrid = grid;
    grid.addEventListener('focusin', (e) => {
      const card = cardAt(e.target);
      if (card) activateCard(card);
    });
  }
  grid
    .querySelectorAll<HTMLElement>('[data-restore]')
    .forEach((b) => (b.onclick = () => restoreBook(b.dataset.restore!)));
  // The card that was the stop of Tab stays it, if it is still on screen; else the first.
  activateCard(
    (activeBook ? cardOf(activeBook) : null) ?? grid.querySelector<HTMLElement>('.book-card'),
  );
  updateSelection(state);
  applyPrefs();
  return books.map((b) => b.id);
}

// Draws one card again after the library queue gave its book a cover, a page count, an author or
// a title. Only the parts that changed are replaced, so the scroll and the focus stay where they
// are, and an image that was loading does not blink. Says whether it could: when the new text
// moves the card (the "Título A–Z" order) or decides whether it is shown (a search), the whole list
// must be drawn again, and the caller does that.
export function updateBookCard(state: LibraryViewState, book: Book, before: Book): boolean {
  const { snapshot, query, prefs } = state;
  const retitled = book.title !== before.title;
  if (
    (retitled && prefs.sort === 'title') ||
    (query && (retitled || book.author !== before.author))
  )
    return false;
  const card = cardOf(book.id);
  if (card) {
    card.querySelector('.book-cover')?.replaceWith(htmlOf(cover(book, snapshot.folder)));
    card
      .querySelector('.book-info')
      ?.replaceWith(htmlOf(bookInfo(book, query ? searchBook(book, query) : null)));
    // A button keeps its place; only what a screen reader says about it changes. The author may be
    // new, and with it the second thing that the button is described by.
    card.querySelector('[data-open]')?.setAttribute('aria-label', `Ler ${book.title}`);
    card.querySelector('[data-open]')?.setAttribute('aria-describedby', describedBy(book));
    card.querySelector('[data-select]')?.setAttribute('aria-label', `Selecionar ${book.title}`);
    card.querySelector('[data-favorite]')?.setAttribute('aria-label', favoriteLabel(book));
    card.querySelector('[data-menu]')?.setAttribute('aria-label', `Opções de ${book.title}`);
  }
  const continuation = $('#continue');
  if (!continuation.hidden && continuation.dataset.book === book.id)
    continuation.querySelector('h2')!.textContent = book.title;
  return true;
}
function htmlOf(html: string): Element {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild!;
}

// Takes the reader to a card: scrolls to it, gives it the focus and marks it for a moment.
// Says whether the card is on screen (it is not under a search or a filter that hides it).
export function revealBook(id: string): boolean {
  const card = cardOf(id);
  if (!card) return false;
  const bring = () => card.scrollIntoView({ block: 'center' });
  bring();
  card.querySelector<HTMLElement>('[data-open]')?.focus({ preventScroll: true });
  // Cards far from the screen are drawn only when they get near it, and their real height is
  // known then: once more, after that.
  requestAnimationFrame(bring);
  card.classList.add('revealed');
  setTimeout(() => card.classList.remove('revealed'), 2200);
  return true;
}

// Runs a drawing of the library and leaves things as they were: the scroll, and the focus when
// it was on a button of a card or of the library's own messages.
export function keepLibraryView(render: () => void) {
  const scroller = document.querySelector<HTMLElement>('.library-main');
  const top = scroller?.scrollTop ?? 0;
  const active = document.activeElement;
  let again = '';
  if (active instanceof HTMLElement) {
    const card = active.closest<HTMLElement>('.book-card');
    const control = ['data-open', 'data-favorite', 'data-menu', 'data-restore', 'data-select'].find(
      (a) => active.hasAttribute(a),
    );
    if (card && control) again = `[data-book="${CSS.escape(card.dataset.book!)}"] [${control}]`;
    else if (active.id && ($('#continue').contains(active) || $('#empty').contains(active)))
      again = `#${active.id}`;
  }
  render();
  if (scroller) scroller.scrollTop = top;
  if (again) document.querySelector<HTMLElement>(again)?.focus({ preventScroll: true });
}
