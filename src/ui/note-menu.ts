import { icon } from '../icons';
import { $ } from './dom';
import { closePopover, popover, type PopoverOptions } from './overlays';
import { COLOR_LABELS, NOTE_COLORS, colorOf } from '../reading/note-colors';
import { isHighlight } from '../reading/note-rects';
import type { Note, NoteColor } from '../types';

export type NoteMenuActions = {
  edit: (note: Note) => void;
  color: (note: Note, color: NoteColor) => void;
  copy: (note: Note) => void;
  remove: (note: Note) => void;
};

// What the menu of a note says it deletes: the highlight, and the note when it has text.
export function deleteLabel(note: Note) {
  if (!isHighlight(note)) return 'Excluir nota';
  return note.text.trim() ? 'Excluir realce e nota' : 'Excluir realce';
}

// The options of a note or a highlight, from its mark in the page, from the text itself (at the
// pointer) or from its card in the side bar. The colours are only for a highlight.
export function noteMenu(
  anchor: HTMLElement,
  note: Note,
  actions: NoteMenuActions,
  options: Pick<PopoverOptions, 'at' | 'owner'> = {},
) {
  const highlight = isHighlight(note),
    current = colorOf(note);
  const color = (value: NoteColor) => {
    const name = `${COLOR_LABELS[value]}${value === current ? ' (atual)' : ''}`;
    return `<button data-action="color" data-color="${value}" class="hl-swatch" ${value === current ? 'data-current' : ''} aria-label="${name}" title="${name}"><span aria-hidden="true"></span></button>`;
  };
  popover(
    anchor,
    `<button data-action="edit">${icon('edit')} ${note.text.trim() ? 'Editar nota' : 'Adicionar nota'}</button>${highlight ? `<div class="menu-colors" role="group" aria-label="Mudar cor">${NOTE_COLORS.map(color).join('')}</div>` : ''}<button data-action="copy">${icon('copy')} Copiar texto</button><hr><button data-action="remove" class="danger">${icon('trash')} ${deleteLabel(note)}</button>`,
    { ...options, menu: true, label: highlight ? 'Opções do realce' : 'Opções da nota' },
  );
  $('#popover')
    .querySelectorAll<HTMLElement>('[data-action]')
    .forEach(
      (el) =>
        (el.onclick = () => {
          // The focus goes back to where the menu came from, so that a dialog returns it there.
          closePopover(true);
          switch (el.dataset.action) {
            case 'edit':
              return actions.edit(note);
            case 'color':
              return actions.color(note, el.dataset.color as NoteColor);
            case 'copy':
              return actions.copy(note);
            case 'remove':
              return actions.remove(note);
          }
        }),
    );
}
