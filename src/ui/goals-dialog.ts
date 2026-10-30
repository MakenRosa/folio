import type { Book, BookGoal, DailyGoal, Preferences } from '../types';
import {
  dayCount,
  dayRecord,
  effectiveGoal,
  globalCount,
  localDay,
  withDay,
} from '../reading/goals';
import { $, esc, ib } from './dom';
import { modal, fail, toast } from './overlays';
import { rememberGoal } from '../reading/history';

export function goalLabel(goal: DailyGoal, count: number) {
  return `${count} / ${goal.target} ${goal.unit === 'pages' ? 'páginas' : 'capítulos'}${count >= goal.target ? ' · Meta atingida' : ''}`;
}
export function showGoals(
  prefs: Preferences,
  actions: {
    books: () => Book[];
    save: (id: string, patch: Partial<Book>) => Promise<unknown>;
    apply: () => void;
    history: (id?: string) => void;
  },
  initial?: string,
) {
  let scope = initial || 'global';
  const render = () => {
    const books = actions.books();
    const book = books.find((b) => b.id === scope);
    if (!book) scope = 'global';
    const goal = book ? effectiveGoal(book, prefs.dailyGoal) : prefs.dailyGoal;
    const own = book?.readingGoal;
    const mode = book ? own?.mode || 'inherit' : prefs.dailyGoal ? 'custom' : 'none';
    const unit = own?.unit || goal?.unit || 'pages';
    const target = own?.target || goal?.target || 10;
    const count = goal
      ? book && own?.mode === 'custom'
        ? dayCount(book, goal.unit)
        : globalCount(books, goal)
      : 0;
    const d =
      modal(`<div class="dialog-heading"><div><span class="eyebrow">UM POUCO A CADA DIA</span><h2>Metas de leitura</h2></div>${ib('goals-close', 'Fechar metas', 'close', 'data-close')}</div>
      <label class="field-label" for="goal-scope">Configurar para</label><select id="goal-scope" class="text-field"><option value="global">Aplicação inteira</option>${books.map((b) => `<option value="${esc(b.id)}">${esc(b.title)}</option>`).join('')}</select>
      <p class="mode-description">A meta geral soma os livros que usam essa configuração. Livros com meta própria ou sem meta ficam fora dessa soma.</p>
      <div class="goal-status"><strong>Hoje</strong><span id="goal-current">${goal ? esc(goalLabel(goal, count)) : 'Nenhuma meta ativa'}</span>${goal ? `<progress aria-label="Progresso da meta de hoje" max="${goal.target}" value="${Math.min(count, goal.target)}"></progress>` : ''}</div>
      <label class="field-label" for="goal-mode">Meta diária</label><select id="goal-mode" class="text-field">${book ? '<option value="inherit">Usar meta geral</option>' : ''}<option value="custom">${book ? 'Meta própria' : 'Definir meta geral'}</option><option value="none">Sem meta</option></select>
      <div id="goal-fields" class="goal-fields"><div><label class="field-label" for="goal-target">Quantidade por dia</label><input id="goal-target" class="text-field" type="number" min="1" max="10000" step="1" value="${target}" required></div><div><label class="field-label" for="goal-unit">Medir em</label><select id="goal-unit" class="text-field"><option value="pages">Páginas</option><option value="chapters">Capítulos</option></select></div></div>
      <details class="goal-rules"><summary>Como a contagem funciona</summary><p class="mode-description">A leitura é acompanhada mesmo sem meta. Páginas do PDF, não telas do Kindle, contam após 8 segundos com o leitor ativo. Voltar à mesma página não soma novamente no dia. Capítulos contam ao avançar da última página acompanhada para o próximo capítulo reconhecido, ou ao chegar ao fim do documento. Saltos não contam páginas intermediárias. Você pode corrigir os totais abaixo.</p><p class="mode-description">O dia muda à meia-noite do seu computador. Os totais diários ficam salvos localmente no histórico. Concluir um livro não acrescenta automaticamente suas páginas à meta.</p></details>
      <div class="dialog-actions"><button id="goal-history" class="secondary">Ver histórico</button><button id="goal-save" class="primary">Salvar meta</button></div>
      <details class="goal-adjust"><summary>Ajustar leitura de hoje</summary><p class="mode-description">Use para registrar leitura feita antes da atualização, fora do Fólio ou em capítulos não reconhecidos. Informe o total de hoje, não um acréscimo.</p><label class="field-label" for="goal-log-book">Livro</label><select id="goal-log-book" class="text-field">${books.map((b) => `<option value="${esc(b.id)}">${esc(b.title)}</option>`).join('')}</select><div class="goal-fields"><div><label class="field-label" for="goal-pages">Páginas lidas hoje</label><input id="goal-pages" class="text-field" type="number" min="0" max="100000" step="1" required></div><div><label class="field-label" for="goal-chapters">Capítulos concluídos hoje</label><input id="goal-chapters" class="text-field" type="number" min="0" max="100000" step="1" required></div></div><button id="goal-log-save" class="secondary">Salvar leitura de hoje</button></details>
      `);
    $<HTMLSelectElement>('#goal-scope').value = scope;
    $('#goal-scope').onchange = () => {
      scope = $<HTMLSelectElement>('#goal-scope').value;
      render();
    };
    $<HTMLSelectElement>('#goal-mode').value = mode;
    $<HTMLSelectElement>('#goal-unit').value = unit;
    const fields = () => {
      $('#goal-fields').hidden = $<HTMLSelectElement>('#goal-mode').value !== 'custom';
    };
    fields();
    $('#goal-mode').onchange = fields;
    $('#goal-history').onclick = () => actions.history(book?.id);
    $('#goal-save').onclick = async () => {
      const mode = $<HTMLSelectElement>('#goal-mode').value as BookGoal['mode'];
      const input = $<HTMLInputElement>('#goal-target');
      if (mode === 'custom' && !input.reportValidity()) return;
      const selected = {
        unit: $<HTMLSelectElement>('#goal-unit').value as DailyGoal['unit'],
        target: mode === 'custom' ? Number(input.value) : 10,
      };
      try {
        if (book) await actions.save(book.id, { readingGoal: { ...selected, mode } });
        else {
          prefs.dailyGoal = mode === 'custom' ? selected : null;
          rememberGoal(prefs);
        }
        actions.apply();
        d.close();
        toast('Meta salva.');
      } catch (e) {
        fail(e);
      }
    };
    if (book) $<HTMLSelectElement>('#goal-log-book').value = book.id;
    const logBook = () =>
      actions.books().find((b) => b.id === $<HTMLSelectElement>('#goal-log-book').value);
    const fill = () => {
      const b = logBook();
      $<HTMLInputElement>('#goal-pages').value = String(b ? dayCount(b, 'pages') : 0);
      $<HTMLInputElement>('#goal-chapters').value = String(b ? dayCount(b, 'chapters') : 0);
      $('#goal-log-save').toggleAttribute('disabled', !b);
    };
    fill();
    $('#goal-log-book').onchange = fill;
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
        render();
        toast('Leitura de hoje atualizada.');
      } catch (e) {
        fail(e);
      }
    };
  };
  render();
}
