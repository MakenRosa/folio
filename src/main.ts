import './style.css';
import { icon } from './icons';
import { $, documents, esc, size, ib } from './ui/dom';
import { appShell, SAVE_STATUS } from './ui/shell';
import {
  toast,
  announce,
  dismissNotices,
  fail,
  failing,
  ReportedError,
  modal,
  popover,
  closePopover,
  type PopoverOptions,
  type ToastAction,
} from './ui/overlays';
import { GENERIC_ERROR, describeError } from './ui/error-text';
import { FAILED } from './ui/failures';
import { showImportProgress, hideImportProgress } from './ui/import-progress';
import { hasSeenHint, withHint, type HintId } from './hints';
import {
  renderLibraryView,
  updateBookCard,
  updateSelection,
  revealBook,
  keepLibraryView,
} from './ui/library-view';
import { showTags } from './ui/tags-dialog';
import { confirmPurge } from './ui/purge-dialog';
import { showPreferences } from './ui/preferences-dialog';
import { showHelp } from './ui/help-dialog';
import { bindShortcuts, SPREAD_KINDLE_NOTE } from './ui/shortcuts';
import { WorkQueue } from './library/queue';
import { enrichBook } from './library/enrich';
import { needsMetadata } from './library/metadata';
import { ReaderChrome } from './ui/reader-chrome';
import { JumpPill } from './ui/jump-pill';
import { SelectionBar } from './ui/selection-bar';
import { deleteLabel, noteMenu } from './ui/note-menu';
import {
  renderNotes,
  notesFocusOf,
  restoreNotesFocus,
  type NotesFocus,
  type NotesState,
} from './ui/notes-panel';
import { copyText } from './ui/clipboard';
import { bindReadingComfort, syncReadingComfort } from './ui/reading-comfort';
import { showGoals, goalLabel } from './ui/goals-dialog';
import { showHistory } from './ui/history-dialog';
import { OutlineView, NO_DESTINATION, type OutlineState } from './ui/outline-view';
import { ThumbnailList } from './ui/thumbnail-list';
import { bindSidebarResizer } from './ui/sidebar-resizer';
import { archivedAsBook } from './library/archive';
import { rangeIds } from './library/selection';
import { MAX_TAGS, addTag, filterTag, hasTag, tagCounts, tagsOf } from './library/tags';
import { rememberGoal } from './reading/history';
import {
  COLOR_LABELS,
  NOTE_COLORS,
  colorOf,
  rememberColor,
  rememberedColor,
} from './reading/note-colors';
import { isHighlight, noteRects } from './reading/note-rects';
import type { SelectionCapture } from './reading/selection-capture';
import {
  ReadingActivity,
  dayCount,
  dayRecord,
  effectiveGoal,
  globalCount,
  localDay,
  withCredit,
  withDay,
} from './reading/goals';
import { spreadPages } from './reading/spread';
import { SIDEBAR_WIDTH, clampSidebarWidth, sidebarMax, tabAfterKey } from './reading/sidebar';
import { readingProgress } from './reading/progress';
import {
  PaceTracker,
  formatDuration,
  recordPace,
  remainingTime,
  secondsPerPage,
} from './reading/pace';
import { invoke, asset } from './bridge';
import { open, save } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import type {
  Book,
  ImportResult,
  PurgeResult,
  Snapshot,
  Preferences,
  Note,
  NoteColor,
  SidebarTab,
  Spread,
} from './types';
import { loadPreferences, normalizePreferences, savePreferences } from './preferences';

const prefs = loadPreferences(localStorage);
const activity = new ReadingActivity();
const pace = new PaceTracker();
let goalDay = localDay();
let finishPrompted = false;
let snapshot: Snapshot = { books: [], trash: [], archived: [], folder: '', warning: null };
let filter = 'all',
  query = '',
  busy = false,
  current: Book | null = null,
  reader: import('./reader').Reader | null = null;
// The documents ticked in the library, and the one a Shift + click counts the range from. The
// view takes out of the set what it no longer shows.
const selected = new Set<string>();
let anchor: string | null = null,
  // A batch is one at a time: a second press while it runs does nothing.
  batching = false;
let loading = false,
  saveTimer: ReturnType<typeof setTimeout> | undefined,
  readingPatch: Partial<Book> = {},
  saveChain = Promise.resolve(),
  resumePosition = false,
  // Closing the password dialog is a choice of the reader, not a failure to open the PDF.
  passwordDeclined = false,
  warned = '';
// What the toolbar button and the L key turn on: the two-page layout last chosen.
let pairLayout: Exclude<Spread, 'none'> = 'odd';
// The papers, in the order that the button and the D key go through them.
const PAPERS: Preferences['paper'][] = ['light', 'sepia', 'dark'];
const PAPER_NAMES: Record<Preferences['paper'], string> = {
  light: 'claro',
  sepia: 'sépia',
  dark: 'escuro',
};
const nextPaper = (paper: Preferences['paper']) =>
  PAPERS[(PAPERS.indexOf(paper) + 1) % PAPERS.length];
// The side bar: what its current tab shows, and how the outline was folded by hand.
let outlineView: OutlineView | null = null,
  thumbnails: ThumbnailList | null = null,
  renderedTab: SidebarTab | null = null,
  shownInSidebar = '';
const outlineState: OutlineState = { folds: new Map() };
// The search of the Notas tab, kept while the book is open.
const notesState: NotesState = { query: '' };
// What the import leaves out (cover, page count, author, a title from the PDF) is read in the
// background, one PDF at a time. It waits while a book is open, and goes on in the library.
const enrichment = new WorkQueue((id, signal) =>
  enrichBook(id, signal, {
    find: (bookId) => snapshot.books.find((b) => b.id === bookId),
    changed: bookEnriched,
  }),
);
const waitingForMetadata = (books: Book[]) =>
  books
    .filter(needsMetadata)
    .sort((a, b) => (b.lastOpened || b.added) - (a.lastOpened || a.added))
    .map((b) => b.id);

$('#app').innerHTML = appShell;
const chrome = new ReaderChrome(
  getCurrentWindow(),
  () => !!current,
  () => reader?.resize(),
  failing('Não foi possível alterar a tela cheia.'),
);
// The way back after a jump, over the reading surface.
const jumpPill = new JumpPill({
  back: () => stepJump('back'),
  forward: () => stepJump('forward'),
});
// The bar near a passage that is selected in the pages: highlight, annotate, copy.
const selectionBar = new SelectionBar({
  bar: $('#highlight-bar'),
  container: $('#viewer-container'),
  enabled: () => !!current && !!reader && !loading && !$<HTMLDialogElement>('#dialog').open,
  capture: () => reader?.captureSelection() ?? null,
  highlight: (color) => void highlightSelection(color),
  annotate: () => void annotateSelection(),
  copy: () => void copySelection(),
  status: $('#selection-status'),
  hint: () =>
    prefs.singleKeys
      ? 'Trecho selecionado. H realça, N adiciona nota e Esc cancela.'
      : 'Trecho selecionado. Esc cancela.',
});
bindReadingComfort(prefs, applyPrefs);
function renderLibrary() {
  // A tag that no document has any more is no filter: back to the whole library.
  const tag = filterTag(filter);
  if (tag !== null && !snapshot.books.some((b) => hasTag(b, tag))) filter = 'all';
  renderLibraryView(
    { snapshot, filter, query, prefs, selected },
    {
      openBook,
      importFiles,
      importFolder,
      toggleFavorite,
      select: selectCard,
      bookMenu,
      restoreBook,
      applyPrefs,
      clearSearch,
    },
  );
}
// The way out of a search that found nothing, from the empty state: the field is cleared and the
// focus goes back to it, since the button that was pressed goes away with the message.
function clearSearch() {
  query = '';
  $<HTMLInputElement>('#library-search').value = '';
  renderLibrary();
  $('#library-search').focus();
}
// A book that the queue just completed: its card is drawn again where it is, and the whole list
// only when the new title or author changes which cards are shown, or their order.
function bookEnriched(updated: Book) {
  const before = snapshot.books.find((b) => b.id === updated.id);
  if (!before) return;
  snapshot.books = snapshot.books.map((b) => (b.id === updated.id ? updated : b));
  if (current?.id === updated.id) {
    current = { ...current, title: updated.title, author: updated.author, cover: updated.cover };
    updateReaderMeta();
  }
  if (!updateBookCard({ snapshot, filter, query, prefs, selected }, updated, before))
    keepLibraryView(renderLibrary);
}
function preferences() {
  showPreferences(prefs, { folder: snapshot.folder, applyPrefs, setReadingMode });
}
function applyPrefs() {
  Object.assign(prefs, normalizePreferences(prefs));
  reader?.setMode(prefs.readingMode, prefs.joinPages, prefs.chapterBreaks, prefs.spread);
  $('#kindle-toggle').setAttribute('aria-pressed', String(prefs.readingMode === 'kindle'));
  $('#kindle-toggle').classList.toggle('selected', prefs.readingMode === 'kindle');
  syncSpreadToggle();
  applySidebar();
  prefs.brightness =
    typeof prefs.brightness === 'number' && Number.isFinite(prefs.brightness)
      ? Math.min(100, Math.max(10, prefs.brightness))
      : 100;
  document.documentElement.dataset.theme =
    prefs.theme === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : prefs.theme;
  document.documentElement.dataset.paper = prefs.paper;
  // The button shows where it takes you: the sun on the dark theme, the moon on the light one.
  $('#theme-toggle').innerHTML = icon(
    document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon',
  );
  $('#warm-overlay').style.opacity = String(Math.min(70, Math.max(0, prefs.warm)) / 100);
  $('#brightness-overlay').style.opacity = String((100 - prefs.brightness) / 100);
  savePreferences(localStorage, prefs);
  updateGoals();
  syncReadingComfort(prefs);
  updateReaderMeta();
  // The button goes round the three papers (and so does the D key): its name says which is on and
  // which comes next, and the sample on it (ui.css) is the one that is on.
  const paperLabel = `Papel ${PAPER_NAMES[prefs.paper]}. Mudar para ${PAPER_NAMES[nextPaper(prefs.paper)]} (D)`;
  $('#paper-toggle').setAttribute('aria-label', paperLabel);
  $('#paper-toggle').title = paperLabel;
  // Grid and list are one choice (a radio group): only the chosen one is a tab stop.
  for (const view of ['grid', 'list']) {
    const on = prefs.view === view,
      button = $(`#view-${view}`);
    button.classList.toggle('selected', on);
    button.setAttribute('aria-checked', String(on));
    button.tabIndex = on ? 0 : -1;
  }
  $('#sort').setAttribute('value', prefs.sort);
}
// The Kindle needs one column: the button is off there, and the choice returns after it.
function syncSpreadToggle() {
  if (prefs.spread !== 'none') pairLayout = prefs.spread;
  const kindle = prefs.readingMode === 'kindle',
    on = !kindle && prefs.spread !== 'none',
    label = kindle ? SPREAD_KINDLE_NOTE : 'Duas páginas lado a lado (L)';
  const button = $('#spread-toggle');
  button.toggleAttribute('disabled', kindle);
  button.setAttribute('aria-pressed', String(on));
  button.setAttribute('aria-label', label);
  button.title = label;
  button.classList.toggle('selected', on);
}
// The side bar's state is a preference of the reader, not of a book: it opens the way it
// was left, in any document. The width in the preference is the user's; the window can
// show less (at most 40% of it), without changing what is saved.
function applySidebar() {
  const open = prefs.sidebarOpen;
  $('#reader-sidebar').hidden = !open;
  $('#reader-sidebar').style.setProperty('--sidebar-width', `${prefs.sidebarWidth}px`);
  $('#sidebar-toggle').setAttribute('aria-expanded', String(open));
  $('#sidebar-toggle').classList.toggle('selected', open);
  document.querySelectorAll<HTMLElement>('[data-tab]').forEach((tab) => {
    const active = tab.dataset.tab === prefs.sidebarTab;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  $('#sidebar-content').setAttribute('aria-labelledby', `tab-${prefs.sidebarTab}`);
  syncResizer();
}
function syncResizer() {
  const side = $('#reader-sidebar'),
    handle = $('#sidebar-resizer');
  const width = side.hidden
    ? clampSidebarWidth(prefs.sidebarWidth, innerWidth)
    : Math.round(side.getBoundingClientRect().width);
  handle.setAttribute('aria-valuemin', String(SIDEBAR_WIDTH.min));
  handle.setAttribute('aria-valuemax', String(sidebarMax(innerWidth)));
  handle.setAttribute('aria-valuenow', String(width));
  handle.setAttribute('aria-valuetext', `${width} px`);
}
applyPrefs();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyPrefs);

async function refresh() {
  const listed = await invoke<Snapshot>('library_list', { historyDay: localDay() });
  snapshot = { ...listed, archived: listed.archived ?? [] };
  rememberGoal(prefs);
  renderLibrary();
  // The catalog keeps its warning for the whole session: say it once, and for long enough to read.
  if (snapshot.warning && snapshot.warning !== warned) {
    warned = snapshot.warning;
    toast(snapshot.warning, undefined, { duration: 12000 });
  }
}
// A tip that is shown only once: the first time, and never again, also after a restart.
function showHint(id: HintId, message: string, action?: ToastAction) {
  if (hasSeenHint(prefs.hints, id)) return;
  prefs.hints = withHint(prefs.hints, id);
  try {
    savePreferences(localStorage, prefs);
  } catch {
    /* A tip that comes back is better than one that breaks what the reader was doing. */
  }
  toast(message, action);
}

async function patchBook(id: string, patch: Partial<Book>) {
  const b = await invoke<Book>('update_book', {
    id,
    patch: { ...patch, ...(patch.readingGoal ? { goalDay: localDay() } : {}) },
  });
  snapshot.books = snapshot.books.map((x) => (x.id === id ? b : x));
  if (current?.id === id) current = { ...b, ...readingPatch };
  return b;
}
// Several documents in one write of the catalog: all change, or none does.
async function patchBooks(updates: { id: string; patch: Partial<Book> }[]) {
  const changed = await invoke<Book[]>('update_books', { updates });
  const byId = new Map(changed.map((b) => [b.id, b]));
  snapshot.books = snapshot.books.map((b) => byId.get(b.id) ?? b);
  if (current && byId.has(current.id)) current = { ...byId.get(current.id)!, ...readingPatch };
  return changed;
}
async function toggleFavorite(id: string) {
  try {
    const b = snapshot.books.find((x) => x.id === id)!;
    await patchBook(id, { favorite: !b.favorite });
    keepLibraryView(renderLibrary);
    // Under "Favoritos" the card goes away with the star: the focus goes on to the next one.
    settleFocus();
    updateReaderMeta();
  } catch (e) {
    fail(e, 'Não foi possível mudar o favorito.');
  }
}
async function restoreBook(id: string) {
  try {
    await invoke('restore_book', { id });
    await refresh();
    settleFocus();
    toast('Documento restaurado.');
  } catch (e) {
    fail(e, 'Não foi possível restaurar o documento.');
  }
}
// After a change that took the control with the focus off the screen, the focus goes to the first
// card, or to the search when there is none.
function settleFocus() {
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected) return;
  const first = $('#books').querySelector<HTMLElement>('[data-open], [data-restore]');
  (first ?? $('#library-search')).focus({ preventScroll: true });
}
// The options of a document, from the button of its card, the reader, or a right click.
// A document in Removidos has one: restore it.
function bookMenu(
  anchor: HTMLElement,
  b: Book,
  options: Pick<PopoverOptions, 'at' | 'owner'> = {},
) {
  if (!options.at && anchor.getAttribute('aria-expanded') === 'true') {
    closePopover(true);
    return;
  }
  const removed = snapshot.trash.some((x) => x.id === b.id);
  // In the reader the document is already open: "Abrir documento" would only load it again.
  const reading = current?.id === b.id;
  popover(
    anchor,
    removed
      ? `<button data-action="restore">${icon('undo')} Restaurar</button><hr><button data-action="purge" class="danger">${icon('trash')} Excluir definitivamente</button>`
      : `${reading ? '' : `<button data-action="open">${icon('book')} Abrir documento</button>`}<button data-action="goal">${icon('target')} Meta de leitura…</button><button data-action="restart">${icon('restart')} Ler do início</button><button data-action="rename">${icon('edit')} Renomear na biblioteca…</button><button data-action="tags">${icon('tag')} Etiquetas…</button><button data-action="finish">${icon('check')} ${b.finished ? 'Marcar como não concluído' : 'Marcar como concluído'}</button><button data-action="export">${icon('download')} Exportar uma cópia…</button><button data-action="export-notes">${icon('note')} Exportar notas…</button>${reading ? `<hr><button data-action="help">${icon('help')} Guia e atalhos…</button>` : ''}<hr><button data-action="remove" class="danger">${icon('archive')} Remover da biblioteca</button>`,
    { ...options, menu: true, label: `Opções de ${b.title}` },
  );
  $('#popover')
    .querySelectorAll<HTMLElement>('[data-action]')
    .forEach(
      (el) =>
        (el.onclick = async () => {
          // The focus goes back to the card or the button, so that a dialog returns it there.
          closePopover(true);
          try {
            switch (el.dataset.action) {
              case 'restore':
                await restoreBook(b.id);
                break;
              case 'purge':
                await purgeBooks([b.id]);
                break;
              case 'tags':
                editTags([b]);
                break;
              case 'open':
                await openBook(b);
                break;
              case 'rename':
                renameBook(b);
                break;
              case 'goal':
                await goals(b.id);
                break;
              case 'restart':
                if (current?.id === b.id) restartReading();
                else await openBook({ ...b, page: 1, top: null, left: null });
                break;
              case 'finish':
                await finishBook(b.id);
                break;
              case 'export':
                await exportBook(b);
                break;
              case 'export-notes':
                await exportNotes(b);
                break;
              case 'help':
                showHelp();
                break;
              case 'remove':
                if (current?.id === b.id) await closeReader();
                await invoke('remove_book', { id: b.id });
                await refresh();
                settleFocus();
                // Each removal keeps its own "Desfazer", so the message says which document it is.
                toast(`${shortTitle(b.title)} movido para Removidos.`, {
                  label: 'Desfazer',
                  run: () => restoreBook(b.id),
                });
            }
          } catch (e) {
            fail(e, menuFailures[el.dataset.action ?? '']);
          }
        }),
    );
}
// What each action of the menu of a document says when it fails.
const menuFailures: Record<string, string> = {
  open: 'Não foi possível abrir o documento.',
  goal: 'Não foi possível abrir a meta de leitura.',
  restart: 'Não foi possível ler do início.',
  finish: FAILED.finish,
  export: 'Não foi possível exportar a cópia.',
  'export-notes': FAILED.exportNotes,
  remove: 'Não foi possível remover o documento.',
};
const shortTitle = (title: string) => `“${title.length > 40 ? `${title.slice(0, 39)}…` : title}”`;
function renameBook(b: Book) {
  const d = modal(
    `<div class="dialog-heading"><h2>Renomear documento</h2>${ib('close-rename', 'Fechar', 'close', 'data-close')}</div><p>O nome na biblioteca muda. O arquivo original permanece intacto.</p><label class="field-label" for="rename-input">Título</label><input id="rename-input" class="text-field" value="${esc(b.title)}" maxlength="500" aria-describedby="rename-hint" autofocus><p id="rename-hint" class="field-hint" role="status"></p><div class="dialog-actions"><button class="secondary" data-close>Cancelar</button><button id="rename-save" class="primary">Salvar título</button></div>`,
  );
  const input = $<HTMLInputElement>('#rename-input'),
    save = $<HTMLButtonElement>('#rename-save');
  // A title with nothing in it is not sent: the button waits, and the field says why.
  const filled = () => {
    const ok = !!input.value.trim();
    save.disabled = !ok;
    $('#rename-hint').textContent = ok ? '' : 'Escreva um título.';
    return ok;
  };
  // What is typed first replaces the title, as when a file is renamed in the Explorer.
  input.select();
  input.oninput = filled;
  input.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    save.click();
  };
  save.onclick = async () => {
    if (!filled()) return;
    save.disabled = true;
    try {
      await patchBook(b.id, { title: input.value });
      // The dialog closes first: it gives the focus back to the button of the card, and the list is
      // drawn again with the focus there.
      d.close();
      keepLibraryView(renderLibrary);
      updateReaderMeta();
    } catch (e) {
      filled();
      fail(e, 'Não foi possível renomear o documento.');
    }
  };
}
// The selection of documents. Ctrl + click and the box of a card tick or untick one; Shift + click
// ticks the range up to it, in the order on screen. Nothing here draws the list again.
const visibleOrder = () =>
  [...document.querySelectorAll<HTMLElement>('#books .book-card')].map(
    (card) => card.dataset.book!,
  );
function syncSelection() {
  updateSelection({ snapshot, filter, selected });
}
function selectCard(id: string, mode: 'toggle' | 'range') {
  const order = visibleOrder();
  if (mode === 'range') {
    if (anchor === null || !order.includes(anchor)) anchor = id;
    for (const x of rangeIds(order, anchor, id)) selected.add(x);
  } else {
    if (!selected.delete(id)) selected.add(id);
    anchor = id;
  }
  syncSelection();
}
function selectAll() {
  for (const id of visibleOrder()) selected.add(id);
  syncSelection();
}
// Says whether there was a selection to clear.
function clearSelection() {
  if (!selected.size) return false;
  selected.clear();
  anchor = null;
  syncSelection();
  return true;
}
const chosenBooks = () =>
  (filter === 'trash' ? snapshot.trash : snapshot.books).filter((b) => selected.has(b.id));
async function runBatch(work: () => Promise<void>, context: string) {
  if (batching) return;
  batching = true;
  try {
    await work();
  } catch (e) {
    fail(e, context);
  } finally {
    batching = false;
  }
}
// The same kind of change for several documents, in one write, with a way back that puts each
// document as it was.
async function changeMany(books: Book[], change: (b: Book) => Partial<Book>, message: string) {
  const updates = books.map((b) => ({ id: b.id, patch: change(b) }));
  const undo = books.map((b) => ({
    id: b.id,
    patch: Object.fromEntries(Object.keys(change(b)).map((key) => [key, b[key as keyof Book]])),
  }));
  await patchBooks(updates);
  keepLibraryView(renderLibrary);
  toast(message, {
    label: 'Desfazer',
    run: () =>
      void runBatch(async () => {
        await patchBooks(undo);
        keepLibraryView(renderLibrary);
      }, FAILED.undo),
  });
}
function favoriteSelected() {
  return runBatch(async () => {
    const books = chosenBooks(),
      n = books.length;
    if (!n) return;
    const favorite = !books.every((b) => b.favorite);
    await changeMany(
      books,
      () => ({ favorite }),
      favorite
        ? `${documents(n)} ${n === 1 ? 'favoritado' : 'favoritados'}.`
        : `${documents(n)} ${n === 1 ? 'removido' : 'removidos'} dos favoritos.`,
    );
  }, 'Não foi possível atualizar os favoritos.');
}
function finishSelected() {
  return runBatch(async () => {
    const books = chosenBooks(),
      n = books.length;
    if (!n) return;
    const finished = !books.every((b) => b.finished);
    await changeMany(
      books,
      () => ({ finished }),
      `${documents(n)} ${n === 1 ? 'marcado' : 'marcados'} como ${finished ? '' : 'não '}concluído${n === 1 ? '' : 's'}.`,
    );
  }, 'Não foi possível atualizar a conclusão dos documentos.');
}
function removeSelected() {
  return runBatch(async () => {
    const ids = chosenBooks().map((b) => b.id);
    if (!ids.length) return;
    await invoke('remove_books', { ids });
    selected.clear();
    anchor = null;
    await refresh();
    settleFocus();
    toast(`${documents(ids.length)} ${ids.length === 1 ? 'movido' : 'movidos'} para Removidos.`, {
      label: 'Desfazer',
      run: () => void restoreBooks(ids),
    });
  }, 'Não foi possível remover os documentos.');
}
function restoreBooks(ids: string[]) {
  return runBatch(async () => {
    if (!ids.length) return;
    await invoke('restore_books', { ids });
    for (const id of ids) selected.delete(id);
    anchor = null;
    await refresh();
    settleFocus();
    toast(`${documents(ids.length)} ${ids.length === 1 ? 'restaurado' : 'restaurados'}.`);
  }, 'Não foi possível restaurar os documentos.');
}
// Deletes documents of Removidos for good, after asking. The result says how much room it freed,
// and tells the files that could not be deleted: those stay in the folder, and the documents are
// out of the catalog anyway.
async function purgeBooks(ids: string[], emptying = false) {
  const books = ids
    .map((id) => snapshot.trash.find((b) => b.id === id))
    .filter((b): b is Book => !!b);
  if (!books.length || batching) return;
  if (!(await confirmPurge(books, emptying))) return;
  await runBatch(async () => {
    const result = await invoke<PurgeResult>('purge_books', { ids: books.map((b) => b.id) });
    for (const book of books) selected.delete(book.id);
    anchor = null;
    await refresh();
    settleFocus();
    toast(
      `${documents(result.purged)} ${result.purged === 1 ? 'excluído' : 'excluídos'} definitivamente.${result.freed ? ` ${size(result.freed)} liberados.` : ''}`,
    );
    if (result.failed.length)
      toast(
        result.failed.length === 1
          ? 'Um arquivo não pôde ser excluído e continua na pasta da biblioteca.'
          : `${result.failed.length} arquivos não puderam ser excluídos e continuam na pasta da biblioteca.`,
        undefined,
        { kind: 'error', detail: result.failed.join('\n') },
      );
  }, 'Não foi possível excluir os documentos.');
}
// The tags of one document (the whole list is what is saved), or one or more tags added to several.
function editTags(books: Book[]) {
  if (!books.length) return;
  showTags({
    books,
    known: tagCounts(snapshot.books),
    save: async (tags) => {
      if (books.length === 1) {
        await patchBook(books[0].id, { tags });
        keepLibraryView(renderLibrary);
        toast('Etiquetas salvas.');
        return null;
      }
      const updates: { id: string; patch: Partial<Book> }[] = [];
      for (const book of books) {
        let next = tagsOf(book);
        for (const tag of tags) {
          const added = addTag(next, tag);
          if (added.problem === 'full')
            return `${shortTitle(book.title)} já tem ${MAX_TAGS} etiquetas.`;
          if (!added.problem) next = added.tags;
        }
        if (next.length !== tagsOf(book).length)
          updates.push({ id: book.id, patch: { tags: next } });
      }
      if (!updates.length) return 'Os documentos já têm essas etiquetas.';
      const undo = updates.map(({ id }) => ({
        id,
        patch: { tags: tagsOf(books.find((b) => b.id === id)!) },
      }));
      await patchBooks(updates);
      keepLibraryView(renderLibrary);
      toast(
        `${tags.length === 1 ? 'Etiqueta adicionada' : 'Etiquetas adicionadas'} a ${documents(updates.length)}.`,
        {
          label: 'Desfazer',
          run: () =>
            void runBatch(async () => {
              await patchBooks(undo);
              keepLibraryView(renderLibrary);
            }, FAILED.undo),
        },
      );
      return null;
    },
  });
}
function chooseFilter(next: string) {
  // What is ticked belongs to what is on screen: another filter starts with nothing ticked.
  const cleared = next !== filter && selected.size > 0;
  if (next !== filter) {
    selected.clear();
    anchor = null;
  }
  filter = next;
  renderLibrary();
  // The bar goes away with the ticks: say why, so that the loss is not silent.
  if (cleared) toast('Seleção limpa ao trocar de filtro.');
}
// The way to a file that an export just made: the Explorer opens on its folder, with it chosen.
const showFile = (path: string): ToastAction => ({
  label: 'Abrir pasta',
  run: () => void invoke('reveal_file', { path }).catch(failing('Não foi possível abrir a pasta.')),
});
async function exportBook(b: Book) {
  const destination = await save({
    title: 'Exportar cópia do PDF',
    defaultPath: `${b.title.replace(/[<>:"/\\|?*]/g, '_')}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (destination) {
    await invoke('export_pdf', { id: b.id, destination });
    toast('Cópia exportada.', showFile(destination));
  }
}
// The notes and highlights of a document as a Markdown file, made by the backend from the catalog.
// The dates are the reader's own: the backend gets the distance from UTC, in minutes.
async function exportNotes(b: Book) {
  if (!b.notes?.length) {
    toast('Este documento ainda não tem notas para exportar.');
    return;
  }
  const stem =
    b.title
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .trim()
      .slice(0, 100) || 'Notas';
  const destination = await save({
    title: 'Exportar notas',
    defaultPath: `${stem} - notas.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (!destination) return;
  await invoke('export_notes', {
    id: b.id,
    destination,
    offsetMinutes: -new Date().getTimezoneOffset(),
  });
  toast('Notas exportadas.', showFile(destination));
}
// Files by the dialog (or the ones dropped on the window), or one folder with `folder`. The
// backend turns folders, dropped or chosen, into the PDFs inside them. With `launched`, the files
// came from outside (see `openLaunched`): their first book opens, and a single file has no summary.
// While a copy runs there is one import at a time: what is dropped waits for its turn (see
// `queueDropped`), and Ctrl + O, which has nothing to wait with, says why it did nothing.
async function importFiles(paths?: string[], folder = false, launched = false) {
  if (busy) {
    if (!paths) toast('Aguarde a cópia dos PDFs terminar.');
    else if (!launched && paths.length) queueDropped(paths);
    return;
  }
  let result: ImportResult | undefined,
    count = 0;
  try {
    if (!paths) {
      const selected = await open(
        folder
          ? { title: 'Adicionar uma pasta de PDFs à sua biblioteca', directory: true }
          : {
              title: 'Adicionar PDFs à sua biblioteca',
              multiple: true,
              filters: [{ name: 'Documentos PDF', extensions: ['pdf'] }],
            },
      );
      if (!selected) return;
      paths = Array.isArray(selected) ? selected : [selected];
    }
    if (!paths.length) return;
    count = paths.length;
    busy = true;
    // The progress is in the button, not in a message for each file.
    showImportProgress(0, paths.length);
    result = await invoke<ImportResult>('import_pdfs', { paths });
    await refresh();
    // The covers, the page counts and the authors of what came in are read one by one from here.
    enrichment.add(waitingForMetadata(result.added));
    if (!launched || count > 1) importSummary(result);
    if (result.errors.length)
      modal(
        `<div class="dialog-heading"><h2>Alguns arquivos não foram adicionados</h2>${ib('close-errors', 'Fechar', 'close', 'data-close')}</div><p>Os demais arquivos foram importados normalmente.</p><ul class="error-list">${result.errors.map(importProblem).join('')}</ul><button class="primary" data-close>Entendi</button>`,
      );
  } catch (e) {
    fail(e, 'Não foi possível adicionar os PDFs.');
  } finally {
    busy = false;
    hideImportProgress();
  }
  // Opening a book is not part of the import: the window can be closed, and another import can
  // start, while it loads.
  if (launched && result) await openImported(result);
  // What came from outside, or was dropped on the window, while this import ran was waiting for it.
  void openLaunched();
}
// The PDFs that came from outside the window: a double click or "Abrir com" in the Explorer, or a
// second launch of the app. The backend keeps their paths until they are asked for, so none is
// lost while the window starts. They go through the normal import, and then the first one opens,
// even over a book that is already open. They wait for an import that is running, and for each
// other: `launchQueue` is what has been asked for and not yet imported.
const launchQueue: string[] = [];
// The files and folders dropped on the window while a copy ran. They wait in the same way, and are
// imported as a normal import (with its summary, and no book opened) once the copy ends, after what
// the Explorer asked for. The notice that says how many are waiting is renewed with each drop.
const dropQueue: string[] = [];
let launching = false,
  queuedNotice: (() => void) | null = null;
function queueDropped(paths: string[]) {
  dropQueue.push(...paths);
  queuedNotice?.();
  queuedNotice = toast(
    `Na fila: ${dropQueue.length} ${dropQueue.length === 1 ? 'item' : 'itens'}.`,
  );
}
async function takeLaunched() {
  launchQueue.push(...(await invoke<string[]>('take_pending_files')));
  await openLaunched();
}
async function openLaunched() {
  if (launching) return;
  launching = true;
  try {
    while ((launchQueue.length || dropQueue.length) && !busy) {
      if (launchQueue.length) await importFiles(launchQueue.splice(0), false, true);
      else {
        queuedNotice?.();
        queuedNotice = null;
        await importFiles(dropQueue.splice(0));
      }
    }
  } finally {
    launching = false;
  }
}
// The book of the first file of an import: one that came in or, when none did, one that was
// already there. A book that is still loading is waited for, and one that is open stays as it is.
async function openImported({ added, existing }: ImportResult) {
  const id = (added[0] ?? existing[0])?.id;
  while (loading) await new Promise((resolve) => setTimeout(resolve, 100));
  const book = snapshot.books.find((b) => b.id === id);
  if (!book || current?.id === book.id) return;
  await openBook(book, true).catch(failing(FAILED.openPdf));
}
function importFolder() {
  return importFiles(undefined, true);
}
// One message for the whole import. A single book that came in can be opened from it, and a
// single one that was already there can be shown.
function importSummary({ added, duplicates, existing, errors }: ImportResult) {
  if (!added.length && !duplicates) {
    // Nothing came in. A file that failed is told about in the list of errors; a folder with no
    // PDF in it has no other way to say so.
    if (!errors.length) toast('Nenhum PDF encontrado.');
  } else if (!added.length) {
    if (existing.length === 1) {
      const id = existing[0].id;
      toast(`${shortTitle(existing[0].title)} já estava na biblioteca.`, {
        label: 'Mostrar',
        run: () => void showBook(id).catch(failing(FAILED.back)),
      });
    } else toast(`${duplicates} PDFs já estavam na biblioteca.`);
  } else {
    const text = `${added.length} PDF${added.length === 1 ? ' adicionado' : 's adicionados'}${duplicates ? ` · ${duplicates} já existente${duplicates === 1 ? '' : 's'}` : ''}.`;
    if (added.length === 1) {
      const book = added[0];
      toast(text, {
        label: 'Abrir',
        run: () =>
          void openBook(snapshot.books.find((b) => b.id === book.id) ?? book).catch(
            failing(FAILED.openPdf),
          ),
      });
    } else toast(text);
  }
}
// Back to the library as it is with nothing typed and nothing filtered, at a card.
async function showBook(id: string) {
  if (current) await closeReader();
  query = '';
  $<HTMLInputElement>('#library-search').value = '';
  filter = 'all';
  selected.clear();
  anchor = null;
  renderLibrary();
  revealBook(id);
}
// A line of the import's errors is "file.pdf: reason". The reason is said in plain words; its
// original text stays only when nothing is known of it.
function importProblem(line: string) {
  const at = line.indexOf(': ');
  const { message, detail } = describeError(at > 0 ? line.slice(at + 2) : line);
  return `<li>${at > 0 ? `<strong>${esc(line.slice(0, at))}:</strong> ` : ''}${esc(message)}${message === GENERIC_ERROR && detail ? ` <span class="quiet-label">(${esc(detail)})</span>` : ''}</li>`;
}

function queueReading(patch: Partial<Book>) {
  if (!current) return;
  readingPatch = { ...readingPatch, ...patch };
  current = { ...current, ...patch };
  clearTimeout(saveTimer);
  $('#save-status').textContent = SAVE_STATUS.saving;
  saveTimer = setTimeout(() => void flushReading(true).catch(() => {}), 450);
}
// Saves what the reading changed. A failure is told to the reader once (the reason, and that the
// position was not saved) and the saving keeps trying, less often each time, until it works. Those
// tries (`quiet`) say nothing more; whoever asks to save (closing, a dialog) is told again. The
// error that comes out was already reported: see `ReportedError`.
let saveFailures = 0;
async function flushReading(quiet = false) {
  clearTimeout(saveTimer);
  if (!current || !Object.keys(readingPatch).length) return saveChain;
  const id = current.id,
    patch = { ...readingPatch };
  readingPatch = {};
  saveChain = saveChain
    .catch(() => {})
    .then(async () => {
      await patchBook(id, patch);
      saveFailures = 0;
      $('#save-status').textContent = SAVE_STATUS.saved;
    })
    .catch((e) => {
      const first = saveFailures++ === 0;
      $('#save-status').textContent = SAVE_STATUS.retrying;
      if (current?.id === id) {
        readingPatch = { ...patch, ...readingPatch };
        saveTimer = setTimeout(
          () => void flushReading(true).catch(() => {}),
          Math.min(30000, 2000 * 2 ** (saveFailures - 1)),
        );
      }
      if (!quiet || first) fail(e, 'Não foi possível salvar a posição de leitura.');
      throw new ReportedError();
    });
  return saveChain;
}
async function openBook(book: Book, keepNotices = false) {
  if (!book || loading) return;
  closePopover();
  // The messages of the library do not stay over the page. The ones of a book that came from outside
  // (the summary of an import) are the exception: nobody has seen them yet.
  if (!keepNotices) dismissNotices();
  clearSelection();
  jumpPill.hide();
  selectionBar.hide();
  notesState.query = '';
  // A book that is open has the memory and the processor to itself.
  enrichment.pause();
  if (current) await closeReader();
  loading = true;
  passwordDeclined = false;
  resetTracking();
  finishPrompted = false;
  current = { ...book };
  resumePosition = prefs.resume && book.lastOpened > 0;
  $('#library').hidden = true;
  $('#reader').hidden = false;
  $('#reader-loading').hidden = false;
  $('#save-status').textContent = SAVE_STATUS.idle;
  // The card that had the focus is gone from the screen: the way out of the loading is where it goes.
  $('#cancel-loading').focus({ preventScroll: true });
  updateReaderMeta();
  applyPrefs();
  outlineState.folds = new Map();
  renderSidebar();
  try {
    await getCurrentWindow().setTitle(`${book.title} · Fólio`);
    const { Reader } = await import('./reader');
    reader = new Reader({
      mode: prefs.readingMode,
      spread: prefs.spread,
      joinPages: prefs.joinPages,
      chapterBreaks: prefs.chapterBreaks,
      onViewport: updateReaderMeta,
      onOutline: () => renderSidebar('outline'),
      // A jump is not a step of the reading: the pace starts over on the page it lands on.
      // The goals already ignore the pages in between, which are never on screen.
      onJump: (offer) => {
        pace.reset();
        jumpPill.show(offer);
      },
      // A highlight (at the pointer) or the mark of a note (a button) was clicked: its options.
      onNote: (id, anchor, at) => {
        const note = current?.notes.find((n) => n.id === id);
        if (!note) return;
        if (!at && anchor.getAttribute('aria-expanded') === 'true') return closePopover(true);
        selectionBar.hide();
        openNoteMenu(anchor, note, at ? { at } : {});
      },
      onSelect: () => selectionBar.follow(),
      container: $('#viewer-container'),
      viewer: $('#pdf-viewer'),
      onPage: (page) => {
        if (current) {
          current.page = page;
          updateReaderMeta();
        }
      },
      onLocation: (location) => {
        if (!loading) queueReading(location);
      },
      onZoom: (value) => {
        const s = $<HTMLSelectElement>('#zoom');
        if ([...s.options].some((o) => o.value === value)) s.value = value;
        else {
          const o = $<HTMLOptionElement>('#custom-zoom');
          o.value = value;
          o.textContent = `${Math.round(Number(value) * 100)}%`;
          o.hidden = false;
          s.value = value;
        }
      },
      onFind: (text) => ($('#find-count').textContent = text),
      onPassword: async (incorrect) =>
        new Promise<string | null>((resolve) => {
          const d = modal(
            `<div class="dialog-heading"><h2>PDF protegido por senha</h2>${ib('close-password', 'Cancelar', 'close', 'data-close')}</div><p id="password-note">${incorrect ? 'Senha incorreta. Tente novamente.' : 'Digite a senha para abrir o documento. Ela não será armazenada.'}</p><input id="password-input" class="text-field" type="password" aria-label="Senha do PDF" aria-describedby="password-note"${incorrect ? ' aria-invalid="true"' : ''} autocomplete="off"><div class="dialog-actions"><button class="secondary" data-close>Cancelar</button><button id="password-submit" class="primary">Abrir PDF</button></div>`,
          );
          let sent = false;
          d.addEventListener(
            'close',
            () => {
              if (sent) return;
              passwordDeclined = true;
              resolve(null);
            },
            { once: true },
          );
          const submit = () => {
            sent = true;
            const p = $<HTMLInputElement>('#password-input').value;
            d.close();
            resolve(p);
          };
          $('#password-submit').onclick = submit;
          $('#password-input').onkeydown = (e) => {
            if (e.key === 'Enter') submit();
          };
        }),
    });
    const path = await invoke<string>('pdf_path', { id: book.id });
    await reader.load(
      asset(path),
      resumePosition ? book : { ...book, page: 1, top: null, left: null },
    );
    if (!current) return;
    current.pages = reader.pages;
    updateReaderMeta();
    loading = false;
    $('#reader-loading').hidden = true;
    await patchBook(book.id, {
      pages: reader.pages,
      lastOpened: Math.floor(Date.now() / 1000),
      page: reader.page,
    });
    updateReaderMeta();
    renderSidebar();
    if (resumePosition && book.page > 1)
      toast(`Leitura retomada na página ${book.page}.`, {
        label: 'Ler do início',
        run: restartReading,
      });
    $('#viewer-container').focus();
    if (!book.cover) {
      const r = reader;
      void r
        .cover()
        .then(async (bytes) => {
          if (bytes) {
            await invoke('save_cover', { id: book.id, bytes: Array.from(bytes) });
            const b = snapshot.books.find((b) => b.id === book.id);
            if (b) b.cover = true;
          }
        })
        .catch(() => {});
    }
  } catch (e) {
    if (current) {
      await closeReader();
      // Giving up on the password leaves the PDF closed, and that is all there is to say.
      if (!passwordDeclined) fail(e, FAILED.openPdf);
    }
  } finally {
    loading = false;
    $('#reader-loading').hidden = true;
  }
}
function updateReaderMeta() {
  if (!current) return;
  $('#reader-title').textContent = current.title;
  const pageInput = $<HTMLInputElement>('#page-number');
  // Rendering and viewport updates can arrive while a page number is being typed.
  // Keep the draft until it is submitted or the field loses focus.
  if (document.activeElement !== pageInput) pageInput.value = String(current.page);
  $('#page-total').textContent = `/ ${current.pages || '…'}`;
  $<HTMLInputElement>('#page-number').max = String(current.pages || 1);
  // The name stays and `aria-pressed` tells the state, as on the card of the library; the tooltip
  // says what the click does now.
  $('#reader-favorite').classList.toggle('selected', current.favorite);
  $('#reader-favorite').setAttribute('aria-pressed', String(current.favorite));
  $('#reader-favorite').title = current.favorite ? 'Remover dos favoritos' : 'Favoritar documento';
  $('#bookmark').classList.toggle('selected', current.bookmarks.includes(current.page));
  $('#bookmark').setAttribute('aria-pressed', String(current.bookmarks.includes(current.page)));
  const kindle = prefs.readingMode === 'kindle',
    screen = reader?.screen;
  // The same calculation as the library. Only reaching the document's end uses the scroll.
  const atEnd = !loading && !!screen?.atEnd;
  const position = {
    page: current.page,
    pages: current.pages,
    finished: current.finished,
    atEnd,
  };
  // With two pages side by side, a step moves by a pair: the ends are those of the pair, and the
  // footer names both of the pages that are on the screen.
  const shown = spreadPages(current.page, current.pages, kindle ? 'none' : prefs.spread);
  const percent = readingProgress(position);
  $('#reading-progress').textContent = current.pages
    ? `${percent}% · ${shown.length > 1 ? `Páginas ${shown[0]}–${shown.at(-1)}` : `Página ${current.page}`} de ${current.pages}`
    : '';
  // The line of the full screen, where the footer is away: the same percentage.
  $('#reading-line').style.setProperty('--read', `${current.pages ? percent : 0}%`);
  const left = remainingTime({
    ...position,
    chapters: reader?.chapterStarts,
    secondsPerPage: secondsPerPage(prefs.pace, current.id),
  });
  const estimate = left
    ? `≈ ${left.chapter === null ? '' : `<span class="time-chapter">${formatDuration(left.chapter)} no capítulo · </span>`}${formatDuration(left.book)} no documento`
    : '';
  // Scrolling calls this constantly; touch the DOM only when the text changes.
  if ($('#reading-time').dataset.estimate !== estimate) {
    $('#reading-time').dataset.estimate = estimate;
    $('#reading-time').innerHTML = estimate;
    $('#reading-time').hidden = !left;
  }
  $('#reading-label').textContent = current.finished
    ? 'Leitura concluída'
    : kindle
      ? 'Kindle · ← → ou Espaço'
      : `${size(current.size)} · Cópia local`;
  // The name stays; the state is in `aria-pressed` and in the colour, like the Kindle button.
  const finish = $('#finish-reading');
  finish.setAttribute('aria-pressed', String(current.finished));
  finish.classList.toggle('selected', current.finished);
  // The tip is for whoever got to the end by reading, not for a document that fits on the screen.
  if (atEnd && screen?.scrolls && !current.finished && !finishPrompted) {
    finishPrompted = true;
    const id = current.id;
    showHint('finish', 'Chegou ao fim? Você pode concluir a leitura.', {
      label: 'Concluir',
      run: () => void finishBook(id).catch(failing(FAILED.finish)),
    });
  }
  updateGoals();
  const paired = !kindle && prefs.spread !== 'none';
  $('#previous').toggleAttribute(
    'disabled',
    kindle ? !screen || screen.atStart : (shown[0] ?? 1) <= 1,
  );
  $('#next').toggleAttribute(
    'disabled',
    kindle ? !screen || screen.atEnd : (shown.at(-1) ?? current.page) >= current.pages,
  );
  for (const [id, label] of [
    ['previous', kindle ? 'Tela anterior' : paired ? 'Páginas anteriores' : 'Página anterior'],
    ['next', kindle ? 'Próxima tela' : paired ? 'Próximas páginas' : 'Próxima página'],
  ]) {
    $(`#${id}`).setAttribute('aria-label', label);
    $(`#${id}`).title = label;
  }
  syncSidebar();
}
function setReadingMode(mode: Preferences['readingMode']) {
  prefs.readingMode = mode;
  applyPrefs();
}

function resetTracking() {
  activity.reset();
  pace.reset();
}
function goalBooks() {
  return snapshot.books.map((b) => (current?.id === b.id ? current : b));
}
function updateGoals() {
  const books = goalBooks();
  const global = prefs.dailyGoal;
  const done = global ? globalCount(books, global) : 0;
  $('#library-goal-text').textContent = global
    ? `Hoje · ${goalLabel(global, done)}`
    : 'Definir meta diária';
  // A thin bar under the text says how far the day is, so that the button reads as a gauge.
  const track = $('#library-goal').querySelector<HTMLElement>('.goal-track')!;
  track.hidden = !global;
  if (global)
    track.style.setProperty(
      '--goal',
      `${Math.min(100, Math.round((done / global.target) * 100))}%`,
    );
  const goal = current && effectiveGoal(current, global);
  $('#reader-goal').textContent = goal
    ? `Hoje · ${goalLabel(
        goal,
        current!.readingGoal?.mode === 'custom'
          ? dayCount(current!, goal.unit)
          : globalCount(books, goal),
      )}`
    : 'Meta diária';
  reader?.setGoalTracking(!!current && !current.finished);
}
// `back`, when the history comes from the goals, takes the reader back to them.
async function history(id?: string, back?: () => void) {
  await flushReading();
  resetTracking();
  // The days of a document deleted for good are still counted: its record has no file, only them.
  showHistory(
    prefs,
    [...goalBooks(), ...snapshot.trash, ...snapshot.archived.map(archivedAsBook)],
    id,
    new Set(snapshot.archived.map((a) => a.id)),
    back,
  );
}
async function goals(id?: string) {
  await flushReading();
  resetTracking();
  showGoals(
    prefs,
    {
      books: goalBooks,
      save: patchBook,
      history: (scope) =>
        void history(scope, () => void goals(scope).catch(failing(FAILED.goals))).catch(
          failing(FAILED.history),
        ),
      apply: () => {
        applyPrefs();
        renderLibrary();
      },
    },
    id,
  );
}
async function finishBook(id: string) {
  await flushReading();
  const book = snapshot.books.find((b) => b.id === id);
  if (!book) return;
  const finished = !book.finished;
  await patchBook(id, { finished });
  resetTracking();
  keepLibraryView(renderLibrary);
  settleFocus();
  updateReaderMeta();
  toast(
    finished
      ? 'Leitura concluída. Ela está em Concluídos.'
      : 'Documento marcado como não concluído.',
    {
      label: 'Desfazer',
      run: () => {
        void patchBook(id, { finished: !finished })
          .then(() => {
            keepLibraryView(renderLibrary);
            updateReaderMeta();
          })
          .catch(failing(FAILED.undo));
      },
    },
  );
}
setInterval(() => {
  const day = localDay();
  if (day !== goalDay) {
    goalDay = day;
    resetTracking();
    updateGoals();
  }
  if (!current || !reader || loading || current.finished) {
    resetTracking();
    return;
  }
  // One definition of "reading", shared by the goals and the pace estimate.
  const active =
    document.hasFocus() &&
    !document.hidden &&
    !$<HTMLDialogElement>('#dialog').open &&
    $('#find-bar').hidden &&
    $('#popover').hidden;
  const now = performance.now();
  // One page, or the pair on screen in a two-page layout. A pair is one step of two pages.
  const shown = reader.screenPages;
  const measured = pace.sample({ book: current.id, page: shown.first, active }, now);
  if (measured !== null) {
    prefs.pace = recordPace(prefs.pace, current.id, measured, Date.now());
    try {
      savePreferences(localStorage, prefs);
    } catch {
      /* The pace is a convenience. Counting reading goals must not depend on it. */
    }
    updateReaderMeta();
  }
  const credit = activity.sample(
    {
      book: current.id,
      day,
      page: shown.first,
      last: shown.last,
      active,
      atEnd: reader.screen.atEnd,
      chapters: reader.chapterStarts,
    },
    now,
  );
  const record = dayRecord(current, day);
  const next = withCredit(record, credit);
  if (next !== record) {
    queueReading({ readingDays: withDay(current, day, next) });
    updateGoals();
  }
}, 1000);

async function closeReader() {
  if (!current) return;
  resetTracking();
  await chrome.exit();
  closePopover();
  jumpPill.hide();
  selectionBar.hide();
  await flushReading();
  const old = reader;
  reader = null;
  current = null;
  loading = false;
  // The side bar keeps its state for the next book. Its drawings stop with this one.
  disposeSidebar();
  $('#sidebar-content').innerHTML = '';
  renderedTab = null;
  await old?.destroy();
  $('#reader').hidden = true;
  $('#library').hidden = false;
  $('#find-bar').hidden = true;
  await getCurrentWindow().setTitle('Fólio');
  renderLibrary();
  $('#library-search').focus();
  enrichment.resume();
}
// Alt + ← and Alt + →, the side buttons of the mouse and the pill: one step along the positions
// that the jumps of this document left. With nowhere to go the pill goes, and a message says why.
// The message only says that there is no position: leaving the document is another key's business.
function stepJump(direction: 'back' | 'forward') {
  if (!reader || loading) return;
  if (direction === 'back' ? reader.back() : reader.forward()) return;
  jumpPill.hide();
  toast(direction === 'back' ? 'Nenhuma posição anterior.' : 'Nenhuma posição à frente.');
}
function restartReading() {
  if (!reader || !current) return;
  reader.jumpTo(1);
  queueReading({ page: 1 });
  updateReaderMeta();
}
function showFind() {
  if (!current) return;
  closePopover();
  $('#find-bar').hidden = false;
  chrome.showTop();
  $('#find-input').focus();
  reader?.resize();
}
function searchPdf(again = false, back = false) {
  reader?.find($<HTMLInputElement>('#find-input').value, again, back);
}
function toggleSidebar(tab?: SidebarTab) {
  if (!current) return;
  const focused = $('#reader-sidebar').contains(document.activeElement);
  if (tab) {
    prefs.sidebarTab = tab;
    prefs.sidebarOpen = true;
  } else prefs.sidebarOpen = !prefs.sidebarOpen;
  applyPrefs();
  if (prefs.sidebarOpen) renderSidebar();
  else {
    disposeSidebar();
    // A hidden bar cannot keep the focus; the reading surface takes it.
    if (focused) $('#viewer-container').focus({ preventScroll: true });
  }
  reader?.resize();
}
async function toggleBookmark() {
  if (!current) return;
  const p = current.page;
  await flushReading();
  await patchBook(current.id, {
    bookmarks: current.bookmarks.includes(p)
      ? current.bookmarks.filter((n) => n !== p)
      : [...current.bookmarks, p].sort((a, b) => a - b),
  });
  updateReaderMeta();
  renderSidebar('bookmarks');
}
// Takes one mark off the list of the Marcas tab, with a way back that puts it where it was. The
// button that was pressed goes away with the old drawing, so the focus goes to the same place of the
// list (the next mark; the one before, if it was the last) and to the tab when no mark is left.
async function removeBookmark(page: number) {
  const open = current;
  if (!open) return;
  const id = open.id,
    fromList = $('#sidebar-content').contains(document.activeElement),
    at = open.bookmarks.indexOf(page);
  await flushReading();
  if (current?.id !== id) return;
  await patchBook(id, { bookmarks: current.bookmarks.filter((n) => n !== page) });
  updateReaderMeta();
  renderSidebar('bookmarks');
  if (fromList) {
    const buttons = [...$('#sidebar-content').querySelectorAll<HTMLElement>('.bookmark-remove')];
    (buttons[Math.min(at, buttons.length - 1)] ?? $('#tab-bookmarks')).focus();
  }
  toast(`Marca da página ${page} removida.`, {
    label: 'Desfazer',
    run: () => void restoreBookmark(id, page).catch(failing(FAILED.undo)),
  });
}
// Puts a mark back, in its place in the order of the pages. The document may have been closed since.
async function restoreBookmark(id: string, page: number) {
  if (current?.id === id) await flushReading();
  const book = current?.id === id ? current : snapshot.books.find((b) => b.id === id);
  if (!book || book.bookmarks.includes(page)) return;
  await patchBook(id, { bookmarks: [...book.bookmarks, page].sort((a, b) => a - b) });
  if (current?.id !== id) return;
  updateReaderMeta();
  renderSidebar('bookmarks');
  // The message gave the focus back to a button that the drawing replaced: it goes to the mark.
  const lost = !document.activeElement || document.activeElement === document.body;
  if (lost && !$('#reader-sidebar').hidden && prefs.sidebarTab === 'bookmarks')
    $('#sidebar-content').querySelector<HTMLElement>(`.bookmark-row[data-page="${page}"]`)?.focus();
}
function disposeSidebar() {
  outlineView?.dispose();
  outlineView = null;
  thumbnails?.dispose();
  thumbnails = null;
}
// Draws the active tab again. `only` limits it to one tab: changing the bookmarks does not
// rebuild the outline the reader is looking at.
function renderSidebar(only?: SidebarTab) {
  if (!current || $('#reader-sidebar').hidden) return;
  const tab = prefs.sidebarTab;
  if (only && only !== tab) return;
  const content = $('#sidebar-content');
  const scrolled = renderedTab === tab ? content.scrollTop : 0;
  disposeSidebar();
  renderedTab = tab;
  shownInSidebar = '';
  const ready = !!reader && !loading;
  const waiting = (text: string) =>
    `<div class="side-empty" role="status"><span class="spinner"></span><p>${text}</p></div>`;
  if (tab === 'outline') {
    if (!reader || !ready || !reader.outlineReady)
      content.innerHTML = waiting('Abrindo o sumário…');
    else if (!reader.outline.length)
      content.innerHTML = `<div class="side-empty">${icon('list')}<h3>Sem sumário neste PDF</h3><p>Use o número da página, as miniaturas ou a busca para navegar.</p></div>`;
    else
      outlineView = new OutlineView(content, reader.outline, outlineState, (entry) => {
        // An item that points nowhere in this document (a broken or external destination) is drawn as
        // unavailable; the click says why it does nothing.
        if (entry.page === null) toast(NO_DESTINATION);
        else reader?.destination(entry.dest);
      });
  } else if (tab === 'pages') {
    if (!reader || !ready) content.innerHTML = waiting('Abrindo as páginas…');
    else thumbnails = new ThumbnailList(content, reader, (page) => reader?.jumpTo(page));
  } else if (tab === 'bookmarks') {
    content.innerHTML = current.bookmarks.length
      ? current.bookmarks
          .map(
            (p) =>
              `<div class="bookmark-item"><button class="bookmark-row ${current?.page === p ? 'active' : ''}" data-page="${p}">${icon('bookmark')} Página ${p}${icon('arrow')}</button><button class="icon-button bookmark-remove" data-remove-page="${p}" type="button" aria-label="Remover marca da página ${p}" title="Remover marca">${icon('trash')}</button></div>`,
          )
          .join('')
      : `<div class="side-empty">${icon('bookmark')}<h3>Guarde uma página</h3><p>Clique em “Marcar esta página” na barra de ferramentas ou use Ctrl + B.</p></div>`;
  } else {
    renderNotes(content, current.notes, notesState, {
      add: () => editNote(),
      edit: (note) => editNote(note),
      menu: (anchor, note) => openNoteMenu(anchor, note),
      go: (note) => reader?.jumpToNote(note),
      exportNotes: () => current && void exportNotes(current).catch(failing(FAILED.exportNotes)),
    });
  }
  if (tab === 'bookmarks') {
    content
      .querySelectorAll<HTMLElement>('.bookmark-row')
      .forEach((b) => (b.onclick = () => reader?.jumpTo(Number(b.dataset.page))));
    content
      .querySelectorAll<HTMLElement>('[data-remove-page]')
      .forEach(
        (b) =>
          (b.onclick = () =>
            void removeBookmark(Number(b.dataset.removePage)).catch(failing(FAILED.bookmark))),
      );
  }
  content.scrollTop = scrolled;
  syncSidebar();
}
// Follows the reading without drawing the tab again: the section and the pages on screen.
function syncSidebar() {
  if (!current || loading || $('#reader-sidebar').hidden) return;
  const tab = prefs.sidebarTab;
  let key = '';
  if (tab === 'outline' && outlineView) key = `outline:${current.page}`;
  else if (tab === 'pages' && thumbnails && reader) {
    const shown = reader.screenOf(current.page);
    key = `pages:${shown.first}:${shown.last}`;
  } else if (tab === 'bookmarks') key = `bookmarks:${current.page}`;
  if (!key || key === shownInSidebar) return;
  shownInSidebar = key;
  if (tab === 'outline') outlineView?.show(current.page);
  else if (tab === 'pages' && reader) {
    const shown = reader.screenOf(current.page);
    thumbnails?.show(shown.first, shown.last);
  } else
    $('#sidebar-content')
      .querySelectorAll<HTMLElement>('.bookmark-row')
      .forEach((row) => {
        const on = Number(row.dataset.page) === current?.page;
        row.classList.toggle('active', on);
        if (on) row.setAttribute('aria-current', 'page');
        else row.removeAttribute('aria-current');
      });
}
// A change of a note draws the Notas tab again, and the button that had the focus goes away with the
// old drawing. `notesTabFocus` says where the focus is in the tab (null when it is elsewhere, or the
// tab is not on screen), and `backToNotesTab` gives it back once the tab is drawn: to the same
// control of the same note, to the next note when it was deleted, or to the search.
const notesTabFocus = () =>
  !$('#reader-sidebar').hidden && prefs.sidebarTab === 'notes'
    ? notesFocusOf($('#sidebar-content'), document.activeElement)
    : null;
function backToNotesTab(saved: NotesFocus | null) {
  if (saved && !$('#reader-sidebar').hidden) restoreNotesFocus($('#sidebar-content'), saved);
}
// The notes of the open book change one at a time, each on the notes as they are by then, so that
// two highlights made in quick succession both stay. The pages and the side bar follow.
let notesChain: Promise<unknown> = Promise.resolve();
function changeNotes(change: (notes: Note[]) => Note[]) {
  const id = current?.id;
  if (!id) return Promise.resolve();
  const run = async () => {
    await flushReading();
    if (current?.id !== id) return;
    await patchBook(id, { notes: change([...current.notes]) });
    if (current?.id !== id) return;
    reader?.setNotes(current.notes);
    const focus = notesTabFocus();
    renderSidebar('notes');
    backToNotesTab(focus);
  };
  const done = notesChain.catch(() => {}).then(run);
  notesChain = done;
  return done;
}
// The passage that is selected in the pages, highlighted in `color`. A selection across pages
// becomes one highlight for each page. Says whether there was a selection.
function highlightSelection(color: NoteColor = rememberedColor()) {
  const capture = reader?.captureSelection();
  if (!capture || !current || loading) return false;
  rememberColor(color);
  const now = Date.now();
  const made = capture.pieces.map((piece, i): Note => ({
    id: crypto.randomUUID(),
    page: piece.page,
    text: '',
    quote: piece.quote,
    created: now + i,
    rects: piece.rects,
    color,
  }));
  selectionBar.hide();
  getSelection()?.removeAllRanges();
  // The highlight shows itself in the page and its card in the Notas tab: no box says it again, and a
  // screen reader is told in the quiet region.
  void changeNotes((notes) => [...notes, ...made])
    .then(() =>
      announce(
        made.length === 1 ? 'Trecho realçado.' : `Trecho realçado em ${made.length} páginas.`,
      ),
    )
    .catch(failing('Não foi possível realçar o trecho.'));
  return true;
}
// A note on the passage that is selected. Says whether there was a selection.
function annotateSelection() {
  const capture = reader?.captureSelection();
  if (!capture || !current || loading) return false;
  selectionBar.hide();
  getSelection()?.removeAllRanges();
  editNote(undefined, capture);
  return true;
}
async function copySelection() {
  const text = getSelection()?.toString().trim() ?? '';
  selectionBar.hide();
  if (!text) return;
  const copied = await copyText(text);
  getSelection()?.removeAllRanges();
  if (copied) toast('Texto copiado.');
  else toast('Não foi possível copiar o texto.', undefined, { kind: 'error' });
}
async function copyNote(note: Note) {
  const copied = await copyText(note.quote.trim() || note.text.trim());
  if (copied) toast('Texto copiado.');
  else toast('Não foi possível copiar o texto.', undefined, { kind: 'error' });
}
// Deletes a note or a highlight, with a way back that puts it where it was.
async function removeNote(note: Note) {
  const id = note.id;
  await changeNotes((notes) => notes.filter((n) => n.id !== id));
  toast(
    !isHighlight(note)
      ? 'Nota excluída.'
      : note.text.trim()
        ? 'Realce e nota excluídos.'
        : 'Realce excluído.',
    {
      label: 'Desfazer',
      run: () =>
        void changeNotes((notes) =>
          notes.some((n) => n.id === id) ? notes : [...notes, note],
        ).catch(failing(FAILED.undo)),
    },
  );
}
// The options of a note or a highlight: from its mark in the page, from the text itself or from
// its card in the side bar.
function openNoteMenu(
  anchor: HTMLElement,
  note: Note,
  options: Pick<PopoverOptions, 'at' | 'owner'> = {},
) {
  noteMenu(
    anchor,
    note,
    {
      edit: (n) => editNote(n),
      color: (n, color) =>
        void changeNotes((notes) => notes.map((x) => (x.id === n.id ? { ...x, color } : x))).catch(
          failing('Não foi possível mudar a cor do realce.'),
        ),
      copy: (n) => void copyNote(n),
      remove: (n) => void removeNote(n).catch(failing(FAILED.removeNote)),
    },
    options,
  );
}
// The dialog of a note. A new note quotes the passage that is selected in the pages, if there is
// one (`picked` is what was selected when the dialog was asked for), and the lines of that passage
// make it a highlight. A selection across pages gives the part on the first page. An old note
// without lines stays a note: no colour, no mark in the page. A highlight with no text is valid.
function editNote(existing?: Note, picked?: SelectionCapture | null) {
  if (!current) return;
  const capture = existing ? null : (picked ?? reader?.captureSelection() ?? null);
  const piece = capture?.pieces[0];
  const quote = existing ? existing.quote : (piece?.quote ?? '');
  const page = existing?.page ?? piece?.page ?? current.page;
  const rects = existing ? noteRects(existing) : (piece?.rects ?? []);
  const color: NoteColor = existing ? colorOf(existing) : rememberedColor();
  const colors = `<fieldset class="color-field"><legend class="field-label">Cor do realce</legend><div class="color-choices">${NOTE_COLORS.map(
    (c) =>
      `<label class="color-choice"><input type="radio" name="note-color" value="${c}"${c === color ? ' checked' : ''}><span class="swatch" data-color="${c}" aria-hidden="true"></span>${COLOR_LABELS[c]}</label>`,
  ).join('')}</div></fieldset>`;
  // Where the dialog was asked for, when that was in the Notas tab (the button of a card, or the one
  // that adds a note): saving or deleting draws the tab again, and the dialog cannot give the focus
  // back to a button that is no longer there.
  const origin = notesTabFocus();
  const d = modal(
    `<div class="dialog-heading"><h2>${existing ? 'Editar nota' : 'Adicionar nota'} <span class="quiet-label">Página ${page}</span></h2>${ib('close-note', 'Fechar', 'close', 'data-close')}</div>${quote ? `<blockquote class="quote-preview">${esc(quote)}</blockquote>` : '<p>Registre uma ideia ou selecione um trecho no PDF para citá-lo.</p>'}${(capture?.pieces.length ?? 0) > 1 ? `<p class="quiet-label">A seleção passa por mais de uma página. A nota guarda só o trecho da página ${page}.</p>` : ''}${rects.length ? colors : ''}<label class="field-label" for="note-text">Sua nota</label><textarea id="note-text" rows="6" maxlength="20000" placeholder="O que você quer lembrar?" autofocus>${esc(existing?.text || '')}</textarea><div id="note-actions" class="dialog-actions">${existing ? `<button id="delete-note" class="text-button danger">${deleteLabel(existing)}</button>` : ''}<button class="secondary" data-close>Cancelar</button><button id="save-note" class="primary">Salvar nota</button></div><div id="note-discard" class="dialog-actions" role="group" aria-labelledby="note-discard-text" hidden><span id="note-discard-text" class="confirm-text">Descartar o que você escreveu?</span><button id="note-keep" class="secondary" type="button">Continuar editando</button><button id="note-discard-yes" class="primary danger-button" type="button">Descartar</button></div>`,
  );
  // Esc must not throw away a note that was typed and not saved, without asking. The question is
  // in the dialog itself; a second Esc, or "Descartar", closes it. The X and "Cancelar" are chosen
  // on purpose, so they close at once.
  const field = $<HTMLTextAreaElement>('#note-text'),
    initial = field.value;
  const ask = (asking: boolean) => {
    $('#note-actions').hidden = asking;
    $('#note-discard').hidden = !asking;
    (asking ? $('#note-keep') : field).focus();
  };
  const onCancel = (e: Event) => {
    if (field.value === initial || !$('#note-discard').hidden || !e.cancelable) return;
    e.preventDefault();
    ask(true);
  };
  d.addEventListener('cancel', onCancel);
  d.addEventListener(
    'close',
    () => {
      d.removeEventListener('cancel', onCancel);
      // The dialog gave the focus back, unless its button was gone: then nothing has it. The
      // note that was saved or edited has its card; one that was deleted, the one next to it.
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost) backToNotesTab(origin);
    },
    { once: true },
  );
  $('#note-keep').onclick = () => ask(false);
  $('#note-discard-yes').onclick = () => d.close();
  $('#save-note').onclick = async () => {
    const text = $<HTMLTextAreaElement>('#note-text').value.trim();
    if (!text && !quote && !rects.length) {
      toast('Escreva uma nota antes de salvar.');
      return;
    }
    const chosen = d.querySelector<HTMLInputElement>('input[name="note-color"]:checked')?.value;
    const note: Note = {
      id: existing?.id || crypto.randomUUID(),
      page,
      text,
      quote,
      created: existing?.created || Date.now(),
      ...(rects.length ? { rects, color: NOTE_COLORS.find((c) => c === chosen) ?? color } : {}),
    };
    try {
      await changeNotes((notes) => {
        const idx = notes.findIndex((n) => n.id === note.id);
        if (idx >= 0) notes[idx] = note;
        else notes.push(note);
        return notes;
      });
      d.close();
      if (note.color) rememberColor(note.color);
      // A highlight shows itself in the page; a note without a place is shown in the side bar.
      if (!rects.length) toggleSidebar('notes');
      // What the screen already shows is not said again in a box: the highlight that a new note makes,
      // or the card of the note in the Notas tab. A screen reader hears it in the quiet region. Only
      // the text of a highlight that was edited with that tab out of view has nothing to show for it.
      const shown = !existing || (!$('#reader-sidebar').hidden && prefs.sidebarTab === 'notes');
      if (shown) announce('Nota salva.');
      else toast('Nota salva.');
    } catch (e) {
      fail(e, 'Não foi possível salvar a nota.');
    }
  };
  $('#delete-note')?.addEventListener('click', async () => {
    try {
      await removeNote(existing!);
      d.close();
    } catch (e) {
      fail(e, FAILED.removeNote);
    }
  });
}

$('#import-main').onclick = () => void importFiles();
$('#import-folder').onclick = () => void importFolder();
$('#library-search').oninput = () => {
  query = $<HTMLInputElement>('#library-search').value;
  const ticked = selected.size;
  renderLibrary();
  // The drawing takes out of the selection what the search hides: say so once, in the same words
  // for every key that takes one more out, so that the message is renewed and does not pile up.
  if (selected.size < ticked) toast('Os documentos que a busca esconde saem da seleção.');
};
document
  .querySelectorAll<HTMLElement>('[data-filter]')
  .forEach((b) => (b.onclick = () => chooseFilter(b.dataset.filter!)));
// The tags are drawn by the library, so one listener on their list serves all of them.
$('#tag-nav').onclick = (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>('[data-filter]');
  if (button) chooseFilter(button.dataset.filter!);
};
$('#select-favorite').onclick = () => void favoriteSelected();
$('#select-finish').onclick = () => void finishSelected();
$('#select-tag').onclick = () => editTags(chosenBooks());
$('#select-remove').onclick = () => void removeSelected();
$('#select-restore').onclick = () => void restoreBooks(chosenBooks().map((b) => b.id));
$('#select-purge').onclick = () => void purgeBooks(chosenBooks().map((b) => b.id));
$('#select-clear').onclick = () => void clearSelection();
$('#empty-trash').onclick = () =>
  void purgeBooks(
    snapshot.trash.map((b) => b.id),
    true,
  );
$('#sort').onchange = () => {
  prefs.sort = $<HTMLSelectElement>('#sort').value;
  renderLibrary();
};
$<HTMLSelectElement>('#sort').value = prefs.sort;
$('#view-grid').onclick = () => {
  prefs.view = 'grid';
  renderLibrary();
};
$('#view-list').onclick = () => {
  prefs.view = 'list';
  renderLibrary();
};
// The arrows choose between the two, as in any radio group, and take the focus along.
const viewKeys: Record<string, Preferences['view']> = {
  ArrowLeft: 'grid',
  ArrowUp: 'grid',
  ArrowRight: 'list',
  ArrowDown: 'list',
};
$('.segmented').onkeydown = (e) => {
  const view = viewKeys[e.key];
  if (!view || e.altKey || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  prefs.view = view;
  renderLibrary();
  $(`#view-${view}`).focus();
};
$('#settings').onclick = preferences;
$('#reader-settings').onclick = preferences;
$('#help').onclick = showHelp;
$('#theme-toggle').onclick = () => {
  prefs.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyPrefs();
};
$('#folder-link').onclick = () => void invoke('open_folder').catch(failing(FAILED.folder));
$('#back').onclick = () => void closeReader().catch(failing(FAILED.back));
$('#cancel-loading').onclick = () => void closeReader().catch(failing(FAILED.back));
$('#restart').onclick = restartReading;
$('#reader-favorite').onclick = () => current && void toggleFavorite(current.id);
$('#reader-more').onclick = () => current && bookMenu($('#reader-more'), current);
$('#finish-reading').onclick = () =>
  current && void finishBook(current.id).catch(failing(FAILED.finish));
$('#goals').onclick = () => void goals().catch(failing(FAILED.goals));
$('#reading-history').onclick = () => void history().catch(failing(FAILED.history));
$('#library-goal').onclick = () => void goals().catch(failing(FAILED.goals));
$('#reader-goal').onclick = () => current && void goals(current.id).catch(failing(FAILED.goals));
$('#kindle-toggle').onclick = () => {
  setReadingMode(prefs.readingMode === 'kindle' ? 'scroll' : 'kindle');
  $('#viewer-container').focus();
  // Only the first time: after that, the reader knows the keys.
  if (prefs.readingMode === 'kindle')
    showHint('kindle', 'Modo Kindle: use ← →, Espaço ou a roda do mouse para passar as telas.');
};
$('#spread-toggle').onclick = () => {
  prefs.spread = prefs.spread === 'none' ? pairLayout : 'none';
  applyPrefs();
};
$('#previous').onclick = () => reader?.turn(-1);
$('#next').onclick = () => reader?.turn(1);
$('#page-number').onchange = () => {
  reader?.jumpTo(Number($<HTMLInputElement>('#page-number').value));
  updateReaderMeta();
};
$('#page-number').onblur = updateReaderMeta;
$('#zoom').onchange = () => reader?.zoom($<HTMLSelectElement>('#zoom').value);
$('#zoom-in').onclick = () => reader?.stepZoom(1);
$('#zoom-out').onclick = () => reader?.stepZoom(-1);
// The rotation is saved with the book, so a turn that was not meant has a way back: the message
// says it, and "Desfazer" turns the pages back by the same quarter. One message at a time, for the
// last turn, so that a few presses in a row do not pile them up.
let closeRotationNotice: (() => void) | null = null;
function rotatePages(degrees = 90) {
  if (!reader) return false;
  const before = reader.rotation;
  reader.rotate(degrees);
  if (reader.rotation === before) return false;
  thumbnails?.refresh();
  if (current) queueReading({ rotation: reader.rotation });
  return true;
}
$('#rotate').onclick = () => {
  if (!rotatePages()) return;
  closeRotationNotice?.();
  closeRotationNotice = toast('Páginas giradas.', {
    label: 'Desfazer',
    run: () => void rotatePages(270),
  });
};
$('#bookmark').onclick = () => void toggleBookmark().catch(failing(FAILED.bookmark));
$('#paper-toggle').onclick = () => {
  prefs.paper = nextPaper(prefs.paper);
  applyPrefs();
};
$('#fullscreen').onclick = () =>
  void chrome.toggle().then(() => {
    // Only the first time: the bars are away, and nothing on the screen says how to bring them back.
    if (document.body.classList.contains('reader-fullscreen'))
      showHint(
        'fullscreen',
        'Tela cheia: leve o mouse ao topo ou à parte inferior para mostrar os controles. Esc sai.',
      );
  });
$('#sidebar-toggle').onclick = () => toggleSidebar();
document
  .querySelectorAll<HTMLElement>('[data-tab]')
  .forEach((b) => (b.onclick = () => toggleSidebar(b.dataset.tab as SidebarTab)));
$('.side-tabs').addEventListener('keydown', (e) => {
  const next = tabAfterKey(prefs.sidebarTab, e.key);
  if (!next || e.altKey || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  e.stopPropagation();
  toggleSidebar(next);
  $(`#tab-${next}`).focus();
});
bindSidebarResizer($('#sidebar-resizer'), {
  width: () => Math.round($('#reader-sidebar').getBoundingClientRect().width),
  preview: (width) => {
    $('#reader-sidebar').style.setProperty('--sidebar-width', `${width}px`);
    syncResizer();
  },
  commit: (width) => {
    prefs.sidebarWidth = width;
    applyPrefs();
    reader?.resize();
  },
});
addEventListener('resize', syncResizer);
$('#add-note').onmousedown = (e) => e.preventDefault();
$('#add-note').onclick = () => editNote();
$('#find-toggle').onclick = showFind;
let findTimer: ReturnType<typeof setTimeout>;
$('#find-input').oninput = () => {
  clearTimeout(findTimer);
  findTimer = setTimeout(() => searchPdf(), 180);
};
$('#find-input').onkeydown = (e) => {
  if (e.key === 'Enter') searchPdf(true, e.shiftKey);
};
$('#find-next').onclick = () => searchPdf(true);
$('#find-prev').onclick = () => searchPdf(true, true);
$('#find-close').onclick = () => {
  $('#find-bar').hidden = true;
  reader?.closeFind();
  $('#viewer-container').focus();
  chrome.releaseTop();
  reader?.resize();
};

bindShortcuts({
  isReading: () => !!current,
  getReader: () => reader,
  importFiles,
  closeReader,
  toggleBookmark,
  exitFullscreen: () => chrome.exit(),
  showFind,
  jumpBack: () => stepJump('back'),
  jumpForward: () => stepJump('forward'),
  selectAll,
  clearSelection,
  highlightSelection: () => highlightSelection(),
  annotateSelection,
  dismissSelection: () => selectionBar.dismiss(),
  singleKeys: () => prefs.singleKeys,
  showHelp,
  clearSearch: () => {
    if (!$<HTMLInputElement>('#library-search').value) return false;
    clearSearch();
    return true;
  },
});
async function init() {
  await getCurrentWindow().onResized(
    () => void chrome.sync().catch(failing('Não foi possível atualizar a tela cheia.')),
  );
  await chrome.sync();
  await refresh();
  // Books that came without a cover or a page count (an import from before, or one that was cut
  // short) are completed in the background.
  enrichment.add(waitingForMetadata(snapshot.books));
  // The progress of the copy goes to the import button, and not to a message for each file.
  await listen<{ done: number; total: number }>('import-progress', (e) => {
    if (busy) showImportProgress(e.payload.done, e.payload.total);
  });
  await getCurrentWindow().onDragDropEvent((e) => {
    const data = e.payload;
    $('#drop-overlay').hidden = data.type !== 'over' && data.type !== 'enter';
    if (data.type === 'drop') void importFiles(data.paths);
  });
  await getCurrentWindow().onCloseRequested(async (e) => {
    if (busy) {
      e.preventDefault();
      toast('Aguarde a cópia dos PDFs terminar antes de fechar.');
      return;
    }
    if (current) {
      e.preventDefault();
      try {
        // The window is remembered by its size and position: not those of the fullscreen.
        await chrome.exit().catch(() => {});
        await flushReading();
        await getCurrentWindow().destroy();
      } catch (error) {
        // The window stays open and the position is not lost. A failed save has told why (see
        // `flushReading`); anything else is said here.
        fail(error, 'Não foi possível fechar o Fólio.');
      }
    }
  });
  // The PDFs the app was opened with wait in the backend; a second launch says there are more.
  await listen('open-files', () => void takeLaunched().catch(failing(FAILED.openFiles)));
  void takeLaunched().catch(failing(FAILED.openFiles));
}
// The way out of a library that did not open: the page loads again. It is a listener, because the
// policy of the page (CSP) does not run a handler written in the HTML. Esc, or any other way of
// closing the dialog, tries again as well, so that the window is never left empty with no way out.
function showStartError(error: unknown) {
  const { message, detail } = describeError(error);
  const d = modal(
    `<h2>Não foi possível abrir a biblioteca</h2><p>${esc(message)}</p>${detail ? `<details class="error-detail"><summary>Detalhes</summary><p>${esc(detail)}</p></details>` : ''}<p>Seus PDFs não foram alterados.</p><button id="retry-start" class="primary" type="button">Tentar novamente</button>`,
  );
  const retry = () => location.reload();
  $('#retry-start').addEventListener('click', retry);
  d.addEventListener(
    'close',
    () => {
      // Another dialog may have taken its place by now: that one is not this one's to close.
      if (document.getElementById('retry-start')) retry();
    },
    { once: true },
  );
}
void init().catch(showStartError);
