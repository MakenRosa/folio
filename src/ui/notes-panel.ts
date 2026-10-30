import { icon } from '../icons';
import { closePopover } from './overlays';
import { esc } from './dom';
import { COLOR_LABELS, colorOf } from '../reading/note-colors';
import { isHighlight, noteOrder } from '../reading/note-rects';
import type { Note } from '../types';

// What the side bar remembers of the Notas tab while a book is open: the text in the search field.
export type NotesState = { query: string };
export type NotesActions = {
  add: () => void;
  edit: (note: Note) => void;
  // The options of a note, from the button of its card.
  menu: (anchor: HTMLElement, note: Note) => void;
  // Go to the note: its highlight, or its page when it has none.
  go: (note: Note) => void;
  exportNotes: () => void;
};

// Letters compare without case or accents: "acao" finds "Ação".
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR');

// The notes that answer a search, in reading order: those whose text or quote has what was typed.
// A highlight with no text is shown as "Realce", so the word finds it too.
export function matchNotes(notes: readonly Note[], query: string): Note[] {
  const ordered = [...notes].sort(noteOrder);
  const wanted = fold(query).trim();
  if (!wanted) return ordered;
  return ordered.filter((note) =>
    [
      note.text ?? '',
      note.quote ?? '',
      isHighlight(note) && !note.text?.trim() ? 'Realce' : '',
    ].some((field) => fold(field).includes(wanted)),
  );
}

function card(note: Note) {
  const highlight = isHighlight(note),
    color = colorOf(note),
    text = (note.text ?? '').trim();
  return `<article class="note-card" data-note-id="${esc(note.id)}"${highlight ? ` data-color="${color}"` : ''}><div class="note-head"><button class="note-page" data-go="${esc(note.id)}" data-page="${note.page}" title="${highlight ? 'Ir ao trecho realçado' : 'Ir à página'}">${highlight ? `<span class="note-swatch" data-color="${color}" role="img" aria-label="Realce ${COLOR_LABELS[color].toLowerCase()}"></span>` : ''}Página ${note.page} ${icon('arrow')}</button><button class="icon-button note-more" data-menu data-more="${esc(note.id)}" type="button" aria-label="Opções da nota" title="Opções" aria-haspopup="menu" aria-expanded="false">${icon('more')}</button></div>${note.quote ? `<blockquote>${esc(note.quote)}</blockquote>` : ''}${text ? `<p>${esc(text)}</p>` : highlight ? '<p class="note-kind">Realce</p>' : ''}<button class="text-button" data-edit-note="${esc(note.id)}" type="button">${highlight && !text ? 'Adicionar nota' : 'Editar'}</button></article>`;
}

// The Notas tab: a button for a new note, a search over the text and the quote (which only
// changes the list, so that the field keeps the focus while it is typed in), the way to export,
// and the notes in reading order, each with the colour of its highlight.
export function renderNotes(
  root: HTMLElement,
  notes: readonly Note[],
  state: NotesState,
  actions: NotesActions,
) {
  const any = notes.length > 0;
  root.innerHTML = `<button id="side-add-note" class="secondary" type="button">${icon('plus')} Nova nota</button>${
    any
      ? `<div class="search-input notes-search">${icon('search')}<input id="notes-search" type="search" placeholder="Buscar nas notas" aria-label="Buscar nas notas" autocomplete="off" value="${esc(state.query)}"></div><div class="notes-summary"><span id="notes-count" role="status" aria-live="polite"></span><button id="side-export-notes" class="text-button" type="button">${icon('download')} Exportar notas</button></div><div id="notes-list"></div>`
      : `<div class="side-empty">${icon('note')}<h3>Suas ideias, por perto</h3><p>Selecione um trecho para realçar ou anotar. Tudo fica salvo neste computador.</p></div>`
  }`;
  root.querySelector<HTMLElement>('#side-add-note')!.onclick = actions.add;
  if (!any) return;
  const list = root.querySelector<HTMLElement>('#notes-list')!,
    count = root.querySelector<HTMLElement>('#notes-count')!,
    search = root.querySelector<HTMLInputElement>('#notes-search')!;
  const byId = (id: string | undefined) => notes.find((n) => n.id === id);
  const draw = () => {
    const shown = matchNotes(notes, state.query);
    count.textContent = state.query.trim()
      ? `${shown.length} de ${notes.length}`
      : `${notes.length} ${notes.length === 1 ? 'nota' : 'notas'}`;
    list.innerHTML = shown.length
      ? shown.map(card).join('')
      : `<div class="side-empty">${icon('search')}<h3>Nenhuma nota encontrada</h3><p>Tente outras palavras do texto ou da citação.</p></div>`;
  };
  draw();
  search.oninput = () => {
    state.query = search.value;
    draw();
  };
  // Esc clears what was typed before it does anything else.
  search.onkeydown = (e) => {
    if (e.key !== 'Escape' || !search.value) return;
    e.stopPropagation();
    e.preventDefault();
    search.value = '';
    state.query = '';
    draw();
  };
  root.querySelector<HTMLElement>('#side-export-notes')!.onclick = actions.exportNotes;
  list.onclick = (e) => {
    const target = e.target as Element;
    const go = target.closest<HTMLElement>('[data-go]'),
      edit = target.closest<HTMLElement>('[data-edit-note]'),
      more = target.closest<HTMLElement>('[data-more]');
    if (go) {
      const note = byId(go.dataset.go);
      if (note) actions.go(note);
    } else if (edit) {
      const note = byId(edit.dataset.editNote);
      if (note) actions.edit(note);
    } else if (more) {
      // A second click on the button that is open closes its menu, like the other menus do.
      if (more.getAttribute('aria-expanded') === 'true') closePopover(true);
      else {
        const note = byId(more.dataset.more);
        if (note) actions.menu(more, note);
      }
    }
  };
}
