import type { Book, DailyGoal, GoalUnit, Preferences } from '../types';
import { dayCount, dayRecord, goalProgress, localDay, ownGoal, withDay } from '../reading/goals';
import { $, esc, ib } from './dom';
import { modal, fail, toast } from './overlays';
import { rememberGoal } from '../reading/history';

const unitName = (unit: GoalUnit) => (unit === 'pages' ? 'páginas' : 'capítulos');
export function goalLabel(goal: DailyGoal, count: number) {
  return `${count} / ${goal.target} ${unitName(goal.unit)}${count >= goal.target ? ' · Meta atingida' : ''}`;
}
// What a goal says of today, in the words of the dialog: "1 de 2 capítulos".
const progressText = (goal: DailyGoal, count: number) =>
  `${count} de ${goal.target} ${unitName(goal.unit)}${count >= goal.target ? ' · Meta atingida' : ''}`;
// The text of today under a goal and, under it, how far the day is. Nothing when there is no goal.
const status = (goal: DailyGoal | null, count: number, id: string, label: string) =>
  goal
    ? `<div class="goal-today"><span>Hoje</span><strong id="${id}">${esc(progressText(goal, count))}</strong></div><progress aria-label="${label}" aria-describedby="${id}" max="${goal.target}" value="${Math.min(count, goal.target)}"></progress>`
    : '';
// Two options of one choice: radio buttons that look like a pair of buttons. The one that is on
// starts the dialog when `focus` is set.
type Option = { value: string; label: string; id: string; on: boolean };
const choice = (name: string, options: Option[], focus = false) =>
  `<div class="goal-choices">${options
    .map(
      (o) =>
        `<label class="goal-choice"><input type="radio" name="${name}" id="${o.id}" value="${o.value}"${o.on ? ' checked' : ''}${o.on && focus ? ' autofocus' : ''}>${o.label}</label>`,
    )
    .join('')}</div>`;
// The quantity and the unit of a goal: the same two fields for the general goal and for the one of a
// document, with the ids of `prefix`, starting from `goal`. They are only there while the goal is on.
const fields = (prefix: string, goal: DailyGoal | null, on: boolean) =>
  `<div id="${prefix}-fields" class="goal-fields"${on ? '' : ' hidden'}><div><label class="field-label" for="${prefix}-target">Quantidade por dia</label><input id="${prefix}-target" class="text-field" type="number" min="1" max="10000" step="1" value="${goal?.target ?? 10}" required></div><div><label class="field-label" for="${prefix}-unit">Medir em</label><select id="${prefix}-unit" class="text-field"><option value="pages"${goal?.unit === 'chapters' ? '' : ' selected'}>Páginas</option><option value="chapters"${goal?.unit === 'chapters' ? ' selected' : ''}>Capítulos</option></select></div></div>`;
// The goals of the library and, when the dialog comes from a document (`initial`: its menu, the
// reader's menu or the footer of the reader), the one of that document. The document that is set up
// is told by where the dialog was opened, and is not chosen in it.
export function showGoals(
  prefs: Preferences,
  actions: {
    // The documents of the library.
    books: () => Book[];
    // All the documents that have days, also those in Removidos and those deleted for good: the
    // general goal counts the reading of all of them.
    counted: () => Book[];
    save: (id: string, patch: Partial<Book>) => Promise<unknown>;
    apply: () => void;
    history: (id?: string) => void;
  },
  initial?: string,
) {
  let drawn = false;
  const find = () => actions.books().find((b) => b.id === initial);
  // The general goal is measured by all the reading of the day. A document that has a goal of its own
  // is measured by its own reading, and only then does it show a progress.
  const generalStatus = () => {
    const { goal, count } = goalProgress(undefined, prefs.dailyGoal, actions.counted());
    return status(goal, count, 'goal-current', 'Progresso da meta geral de hoje');
  };
  const ownStatus = (book: Book) => {
    const { goal, own, count } = goalProgress(book, prefs.dailyGoal, actions.counted());
    return own
      ? status(goal, count, 'goal-own-current', 'Progresso da meta deste documento hoje')
      : '';
  };
  const render = () => {
    const books = actions.books();
    const book = find();
    // A document has two settings: no goal of its own ('inherit', which is also how the older 'none'
    // is read) or one of its own. The general goal is there or it is not.
    const general = prefs.dailyGoal;
    const own = book ? ownGoal(book.readingGoal) : null;
    modal(
      `<div class="dialog-heading"><h2>Metas de leitura</h2><div class="heading-tools"><button id="goal-history" class="text-button">Ver histórico</button>${ib('goals-close', 'Fechar metas', 'close', 'data-close')}</div></div>
      <p class="goal-rule">${book ? 'A meta geral conta tudo o que você ler no dia. A meta própria é um alvo extra deste documento.' : 'A meta geral conta tudo o que você ler no dia. Para dar uma meta própria a um documento, use o menu dele.'}</p>
      <fieldset class="goal-part" id="goal-general"><legend>Meta geral</legend>
        ${choice(
          'goal-mode',
          [
            { value: 'none', label: 'Sem meta geral', id: 'goal-mode-none', on: !general },
            { value: 'custom', label: 'Com meta geral', id: 'goal-mode-custom', on: !!general },
          ],
          true,
        )}
        ${fields('goal', general, !!general)}
        <div class="goal-foot"><div id="goal-status" class="goal-status">${generalStatus()}</div><button id="goal-save" class="primary" aria-label="Salvar meta geral">Salvar</button></div>
      </fieldset>
      ${
        book
          ? `<fieldset class="goal-part" id="goal-own"><legend>Este documento</legend><p class="goal-doc-name" title="${esc(book.title)}">${esc(book.title)}</p>
        ${choice('goal-own-mode', [
          { value: 'inherit', label: 'Sem meta própria', id: 'goal-own-inherit', on: !own },
          { value: 'custom', label: 'Meta própria', id: 'goal-own-custom', on: !!own },
        ])}
        ${fields('goal-own', own ?? general, !!own)}
        <div class="goal-foot"><div id="goal-own-status" class="goal-status">${ownStatus(book)}</div><button id="goal-own-save" class="primary" aria-label="Salvar meta deste documento">Salvar</button></div>
      </fieldset>`
          : ''
      }
      ${
        books.length
          ? `<details class="goal-adjust"><summary>Ajustar leitura de hoje</summary><p class="mode-description">Use para registrar leitura feita fora do Fólio ou em capítulos não reconhecidos. Informe o total de hoje${book ? ' neste documento' : ''}, não um acréscimo.</p>${book ? '' : `<label class="field-label" for="goal-log-book">Documento</label><select id="goal-log-book" class="text-field">${books.map((b) => `<option value="${esc(b.id)}">${esc(b.title)}</option>`).join('')}</select>`}<div class="goal-fields"><div><label class="field-label" for="goal-pages">Páginas lidas hoje</label><input id="goal-pages" class="text-field" type="number" min="0" max="100000" step="1" required></div><div><label class="field-label" for="goal-chapters">Capítulos concluídos hoje</label><input id="goal-chapters" class="text-field" type="number" min="0" max="100000" step="1" required></div></div><button id="goal-log-save" class="secondary">Salvar leitura de hoje</button></details>`
          : ''
      }
      <details class="goal-rules"><summary>Como a contagem funciona</summary><p class="mode-description">A leitura é acompanhada mesmo sem meta. Uma página do PDF conta depois de 8 segundos com o leitor ativo, e só uma vez por dia; as telas do Kindle não são páginas. Um capítulo conta ao passar da última página lida para o capítulo seguinte, ou ao chegar ao fim do documento. Saltos não contam as páginas do meio.</p><p class="mode-description">O dia muda à meia-noite do seu computador, e os totais ficam salvos no histórico. Concluir um documento não soma as páginas dele à meta. Para corrigir um total, use Ajustar leitura de hoje.</p></details>
      `,
      drawn,
    );
    drawn = true;
    $('#goal-history').onclick = () => actions.history(book?.id);
    // The quantity and the unit are only asked for while there is a goal to set.
    const toggleFields = (prefix: string, on: string) => {
      const custom = $<HTMLInputElement>(`#${on}`);
      const show = () => ($(`#${prefix}-fields`).hidden = !custom.checked);
      document
        .querySelectorAll<HTMLInputElement>(`input[name="${custom.name}"]`)
        .forEach((radio) => (radio.onchange = show));
    };
    toggleFields('goal', 'goal-mode-custom');
    // Each part saves on its own and the dialog stays open, with the day drawn again: the result is
    // seen, and what was typed in the other part is not lost.
    const paint = () => {
      $('#goal-status').innerHTML = generalStatus();
      const fresh = book && find();
      if (fresh) $('#goal-own-status').innerHTML = ownStatus(fresh);
    };
    $('#goal-save').onclick = async () => {
      const custom = $<HTMLInputElement>('#goal-mode-custom').checked;
      const input = $<HTMLInputElement>('#goal-target');
      if (custom && !input.reportValidity()) return;
      try {
        prefs.dailyGoal = custom
          ? {
              unit: $<HTMLSelectElement>('#goal-unit').value as GoalUnit,
              target: Number(input.value),
            }
          : null;
        rememberGoal(prefs);
        actions.apply();
        paint();
        toast('Meta geral salva.');
      } catch (e) {
        fail(e, 'Não foi possível salvar a meta geral.');
      }
    };
    if (book) {
      toggleFields('goal-own', 'goal-own-custom');
      $('#goal-own-save').onclick = async () => {
        const custom = $<HTMLInputElement>('#goal-own-custom').checked;
        const input = $<HTMLInputElement>('#goal-own-target');
        if (custom && !input.reportValidity()) return;
        try {
          await actions.save(book.id, {
            readingGoal: {
              unit: $<HTMLSelectElement>('#goal-own-unit').value as GoalUnit,
              target: custom ? Number(input.value) : 10,
              mode: custom ? 'custom' : 'inherit',
            },
          });
          actions.apply();
          paint();
          toast('Meta deste documento salva.');
        } catch (e) {
          fail(e, 'Não foi possível salvar a meta deste documento.');
        }
      };
    }
    if (!books.length) return;
    // The adjustment is of the document that the dialog came from. From the library there is none,
    // and the document is chosen here, in the adjustment only.
    const logBook = () => {
      const id = book ? book.id : $<HTMLSelectElement>('#goal-log-book').value;
      return actions.books().find((b) => b.id === id);
    };
    const fill = () => {
      const b = logBook();
      $<HTMLInputElement>('#goal-pages').value = String(b ? dayCount(b, 'pages') : 0);
      $<HTMLInputElement>('#goal-chapters').value = String(b ? dayCount(b, 'chapters') : 0);
      $('#goal-log-save').toggleAttribute('disabled', !b);
    };
    fill();
    if (!book) $('#goal-log-book').onchange = fill;
    // Do not apply yesterday's open form to the next day's ledger.
    const openedDay = localDay();
    $('#goal-log-save').onclick = async () => {
      if (openedDay !== localDay()) {
        render();
        toast('O dia mudou. Confira os totais de hoje.');
        return;
      }
      const b = logBook();
      if (!b) return;
      const pages = $<HTMLInputElement>('#goal-pages'),
        chapters = $<HTMLInputElement>('#goal-chapters');
      if (!pages.reportValidity() || !chapters.reportValidity()) return;
      const day = dayRecord(b, openedDay);
      try {
        await actions.save(b.id, {
          readingDays: withDay(b, openedDay, {
            ...day,
            pageAdjustment: Number(pages.value) - day.pages.length,
            chapterAdjustment: Number(chapters.value) - day.chapters.length,
          }),
        });
        actions.apply();
        // Only the totals of today change: the rest of the dialog, the focus and what was typed stay.
        paint();
        fill();
        toast('Leitura de hoje atualizada.');
      } catch (e) {
        fail(e, 'Não foi possível salvar o registro de leitura.');
      }
    };
  };
  render();
}
