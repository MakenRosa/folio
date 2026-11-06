import type { Book } from '../types';
import { icon } from '../icons';
import {
  MAX_TAG_LENGTH,
  addTag,
  normalizeTags,
  removeTag,
  suggestTags,
  tagKey,
  tagProblemText,
  tagsOf,
  type TagCount,
} from '../library/tags';
import { $, documents, esc, ib } from './dom';
import { fail, modal } from './overlays';

export type TagsDialog = {
  // The documents the tags are for. With one, its list is edited (what is saved is the whole list);
  // with several, the tags are added to each, and the ones they already have stay.
  books: Book[];
  // Every tag of the library with its count, for the suggestions.
  known: TagCount[];
  // Keeps the tags. A sentence says why it could not, and the dialog stays open with it.
  save: (tags: string[]) => Promise<string | null>;
};

export function showTags({ books, known, save }: TagsDialog) {
  const many = books.length > 1;
  let draft = many ? [] : normalizeTags(tagsOf(books[0]));
  const d = modal(
    `<div class="dialog-heading"><h2>${many ? `Adicionar etiqueta a ${documents(books.length)}` : 'Etiquetas'}</h2>${ib('close-tags', 'Fechar', 'close', 'data-close')}</div>${many ? '' : `<p class="tag-owner" title="${esc(books[0].title)}">${esc(books[0].title)}</p>`}<p>${many ? 'As etiquetas que cada documento já tem continuam nele.' : 'Agrupe seus documentos e encontre-os pela barra lateral.'} Escreva uma etiqueta e pressione Enter.</p><label class="field-label" for="tag-input">Nova etiqueta</label><div class="tag-entry"><input id="tag-input" class="text-field" maxlength="${MAX_TAG_LENGTH}" autocomplete="off" aria-describedby="tag-hint"><button id="tag-add" class="secondary" type="button">Adicionar</button></div><p id="tag-hint" class="tag-hint" role="status"></p><div id="tag-suggest"></div><span id="tag-chips-label" class="field-label">${many ? 'Etiquetas a adicionar' : 'Etiquetas do documento'}</span><ul id="tag-chips" class="tag-chips" aria-labelledby="tag-chips-label"></ul><div class="dialog-actions"><button class="secondary" data-close>Cancelar</button><button id="tags-save" class="primary">${many ? 'Adicionar' : 'Salvar etiquetas'}</button></div>`,
  );
  const input = $<HTMLInputElement>('#tag-input'),
    hint = $('#tag-hint'),
    saveButton = $<HTMLButtonElement>('#tags-save');
  const draw = () => {
    $('#tag-chips').innerHTML = draft.length
      ? draft
          .map(
            (tag) =>
              `<li class="tag-chip"><span>${esc(tag)}</span><button type="button" data-remove-tag="${esc(tagKey(tag))}" aria-label="Remover etiqueta ${esc(tag)}" title="Remover etiqueta">${icon('close')}</button></li>`,
          )
          .join('')
      : '<li class="tag-chips-empty">Nenhuma etiqueta ainda.</li>';
    const offered = suggestTags(known, draft, input.value);
    $('#tag-suggest').innerHTML = offered.length
      ? `<span id="tag-suggest-label" class="field-label">Etiquetas já usadas</span><div class="tag-suggestions" role="group" aria-labelledby="tag-suggest-label">${offered.map((tag) => `<button type="button" class="tag-suggestion" data-suggest="${esc(tag.label)}">${esc(tag.label)} <small>${tag.count}</small></button>`).join('')}</div>`
      : '';
    saveButton.disabled = many && !draft.length;
  };
  // Adds what is typed (a comma separates several). What could not be added stays in the field,
  // with the reason. Says whether the field is clear.
  const commit = () => {
    const rest: string[] = [];
    let said = '';
    for (const part of input.value.split(',')) {
      if (!part.trim()) continue;
      const result = addTag(draft, part);
      if (result.problem) {
        rest.push(part.trim());
        said ||= tagProblemText[result.problem];
      } else draft = result.tags;
    }
    input.value = rest.join(', ');
    hint.textContent = said;
    draw();
    return !rest.length;
  };
  input.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    commit();
  };
  input.oninput = () => {
    hint.textContent = '';
    draw();
  };
  $('#tag-add').onclick = () => {
    commit();
    input.focus();
  };
  $('#tag-chips').onclick = (e) => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('[data-remove-tag]');
    if (!button) return;
    const at = draft.findIndex((tag) => tagKey(tag) === button.dataset.removeTag);
    draft = removeTag(draft, button.dataset.removeTag!);
    hint.textContent = '';
    draw();
    // The focus goes to the next tag to remove, or to the field when there is none.
    const rest = $('#tag-chips').querySelectorAll<HTMLElement>('[data-remove-tag]');
    (rest[Math.min(at, rest.length - 1)] ?? input).focus();
  };
  $('#tag-suggest').onclick = (e) => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('[data-suggest]');
    if (!button) return;
    const result = addTag(draft, button.dataset.suggest!);
    if (result.problem) hint.textContent = tagProblemText[result.problem];
    else {
      draft = result.tags;
      hint.textContent = '';
    }
    draw();
    input.focus();
  };
  saveButton.onclick = async () => {
    // What is typed and not yet added counts: the button is the end of the field.
    if (!commit()) return;
    saveButton.disabled = true;
    try {
      const problem = await save(draft);
      if (problem) hint.textContent = problem;
      else d.close();
    } catch (e) {
      fail(e, 'Não foi possível salvar as etiquetas.');
    } finally {
      draw();
    }
  };
  draw();
  input.focus();
}
