import type { Book, Preferences } from '../types';
import { dayCount, localDay } from '../reading/goals';
import {
  calendarStep,
  firstHistoryDay,
  historyDay,
  monthDays,
  statusLabels,
} from '../reading/history';
import { icon } from '../icons';
import { $, esc, ib } from './dom';
import { modal } from './overlays';

// `archived` has the ids of the books that were deleted for good: they stay in the list for the days
// they have, and say so when another book has the same title. `back` is there when the history was
// opened from the goals: it takes the reader back to them.
export function showHistory(
  prefs: Preferences,
  books: Book[],
  initial?: string,
  archived: ReadonlySet<string> = new Set(),
  back?: () => void,
) {
  let scope = initial || 'global',
    selected = localDay(),
    month = selected.slice(0, 7),
    drawn = false;
  const date = (day: string) => new Date(`${day}T12:00:00`);
  const optionLabel = (b: Book) =>
    archived.has(b.id) && books.some((o) => o.id !== b.id && o.title === b.title)
      ? `${b.title} (excluído)`
      : b.title;
  const quantity = (count: number, unit: 'página' | 'capítulo') =>
    `${count} ${unit}${count === 1 ? '' : 's'}`;
  const label = (day: string) =>
    date(day).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  const monthName = (value: string) =>
    date(`${value}-01`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const render = () => {
    const today = localDay(),
      first = firstHistoryDay(books, prefs, today);
    const days = monthDays(month),
      elapsed = days.filter((day) => day <= today);
    const data = elapsed.map((day) => historyDay(books, prefs, day, scope, today));
    const summary = data.reduce(
      (a, d) => ({
        pages: a.pages + d.pages,
        chapters: a.chapters + d.chapters,
        met: a.met + Number(d.status === 'met'),
      }),
      { pages: 0, chapters: 0, met: 0 },
    );
    const detail = historyDay(books, prefs, selected, scope, today);
    const target = detail.goal
      ? `${detail.own ? 'Meta própria do documento' : 'Meta geral'} · ${detail.count} / ${detail.goal.target} ${detail.goal.unit === 'pages' ? 'páginas' : 'capítulos'}`
      : detail.status === 'none'
        ? 'Não havia meta geral neste dia.'
        : detail.status === 'no-own'
          ? 'Este documento não tinha meta própria neste dia. A leitura dele entra na meta geral.'
          : 'A meta deste dia não foi registrada. Os totais disponíveis foram preservados.';
    const contributions = detail.books.filter(
      (b) => dayCount(b, 'pages', selected) > 0 || dayCount(b, 'chapters', selected) > 0,
    );
    const previous = localDay(
      new Date(date(month + '-01').getFullYear(), date(month + '-01').getMonth() - 1, 1, 12),
    ).slice(0, 7);
    const next = localDay(
      new Date(date(month + '-01').getFullYear(), date(month + '-01').getMonth() + 1, 1, 12),
    ).slice(0, 7);
    modal(
      `<div class="history-view"><div class="dialog-heading"><h2>Histórico de leitura</h2><div class="heading-tools">${back ? `<button id="history-back" class="text-button" type="button">${icon('back')} Voltar às metas</button>` : ''}${ib('history-close', 'Fechar histórico', 'close', 'data-close')}</div></div>
      <div class="history-controls"><div><label class="field-label" for="history-scope">Acompanhar</label><select id="history-scope" class="text-field"><option value="global">Biblioteca inteira</option>${books.map((b) => `<option value="${esc(b.id)}">${esc(optionLabel(b))}</option>`).join('')}</select></div>
      <div class="history-month">${ib('history-prev', 'Mês anterior', 'left', previous < first.slice(0, 7) ? 'disabled' : '')}<label class="sr-only" for="history-month">Mês do histórico</label><input id="history-month" class="text-field" type="month" value="${month}" min="${first.slice(0, 7)}" max="${today.slice(0, 7)}" aria-describedby="history-hint">${ib('history-next', 'Próximo mês', 'right', next > today.slice(0, 7) ? 'disabled' : '')}</div></div>
      <p id="history-hint" class="field-hint" role="status"></p>
      <p class="mode-description">${scope === 'global' ? 'Os totais incluem todos os documentos. A meta geral conta toda a leitura do dia, em qualquer documento.' : 'Os totais são deste documento. Com meta própria no dia, o resultado usa a meta dele. Sem meta própria, só os totais aparecem, e a leitura continua contando na meta geral.'}</p>
      <div class="history-stats"><div><strong>${summary.pages}</strong><span>páginas no mês</span></div><div><strong>${summary.chapters}</strong><span>capítulos no mês</span></div><div><strong>${summary.met}</strong><span>dias com meta atingida</span></div></div>
      <div class="history-week" aria-hidden="true">${['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((d) => `<span>${d}</span>`).join('')}</div>
      <p id="history-keys" class="sr-only">Use as setas para andar pelos dias, Home e End para ir ao começo e ao fim da semana, Page Up e Page Down para trocar de mês, e Enter ou Espaço para escolher o dia.</p>
      <div class="history-calendar" role="group" aria-label="Dias do mês" aria-describedby="history-keys">${'<span aria-hidden="true"></span>'.repeat((date(days[0]).getDay() + 6) % 7)}${days
        .map((day) => {
          const d = historyDay(books, prefs, day, scope, today),
            future = day > today;
          const state = !d.recorded ? 'Sem registro' : statusLabels[d.status];
          return `<button class="history-day ${future ? 'future' : d.status}" data-history-day="${day}" tabindex="${day === selected ? 0 : -1}" ${future ? 'disabled' : ''} aria-pressed="${day === selected}" aria-label="${esc(`${label(day)}: ${future ? 'dia futuro' : `${d.pages} páginas, ${d.chapters} capítulos. ${state}`}`)}"><strong>${Number(day.slice(-2))}${day === today ? '<span class="history-today">hoje</span>' : ''}</strong><span>${future ? '' : d.recorded ? `${d.pages} pág. · ${d.chapters} cap.` : 'Sem registro'}</span><small>${future || !d.recorded ? '' : d.status === 'met' ? '✓ Atingida' : d.status === 'missed' ? 'Abaixo' : d.status === 'ongoing' ? 'Em andamento' : d.status === 'none' ? 'Sem meta' : d.status === 'no-own' ? 'Sem meta própria' : 'Não registrada'}</small></button>`;
        })
        .join('')}</div>
      <section class="history-detail" aria-live="polite"><div class="history-detail-title"><h3>${esc(label(selected))}</h3><span class="history-status ${detail.status}">${detail.recorded ? statusLabels[detail.status] : 'Sem registro'}</span></div><p>${esc(target)}</p><div class="history-day-totals"><strong>${quantity(detail.pages, 'página')}</strong><strong>${quantity(detail.chapters, 'capítulo')}</strong></div>
      ${contributions.length ? `<ul class="history-books">${contributions.map((b) => `<li><span>${esc(b.title)}</span><span>${dayCount(b, 'pages', selected)} pág. · ${dayCount(b, 'chapters', selected)} cap.</span></li>`).join('')}</ul>` : `<p>${detail.recorded ? 'Nenhuma leitura registrada neste dia.' : 'Ainda não há dados para este dia.'}</p>`}</section>
      <p class="mode-description">A meta que valia em cada dia é a última salva naquele dia. Alterações posteriores não mudam a meta de dias anteriores. Os totais incluem ajustes manuais. Dias antigos sem registro não são reconstruídos.</p></div>`,
      drawn,
    );
    drawn = true;
    if (back) $('#history-back').onclick = back;
    $<HTMLSelectElement>('#history-scope').value = scope;
    $('#history-scope').onchange = () => {
      scope = $<HTMLSelectElement>('#history-scope').value;
      render();
    };
    // Not back to the old month in silence: the field says which months there are.
    const refuseMonth = () => {
      $<HTMLInputElement>('#history-month').value = month;
      $('#history-hint').textContent =
        first.slice(0, 7) === today.slice(0, 7)
          ? `Só há registro de ${monthName(today.slice(0, 7))}.`
          : `Escolha um mês entre ${monthName(first.slice(0, 7))} e ${monthName(today.slice(0, 7))}.`;
    };
    const changeMonth = (value: string) => {
      if (
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(value) ||
        value < first.slice(0, 7) ||
        value > today.slice(0, 7)
      )
        return refuseMonth();
      month = value;
      selected = month === today.slice(0, 7) ? today : monthDays(month).at(-1)!;
      render();
    };
    $('#history-month').onchange = () => changeMonth($<HTMLInputElement>('#history-month').value);
    $('#history-prev').onclick = () => changeMonth(previous);
    $('#history-next').onclick = () => changeMonth(next);
    document.querySelectorAll<HTMLElement>('[data-history-day]').forEach((button) => {
      button.onclick = () => {
        selected = button.dataset.historyDay!;
        render();
        document
          .querySelector<HTMLElement>(`[data-history-day="${selected}"]`)
          ?.focus({ preventScroll: true });
        $('.history-detail').scrollIntoView({ block: 'nearest' });
      };
    });
    // The days are one stop of Tab (the selected one, or the last that the arrows reached) and the
    // keys move the focus among them. Enter and Space are the buttons' own: they select the day.
    // A key that leaves the month brings the new one, with the day chosen in it; one that would
    // go to a day that cannot be shown says why, in the hint, and stays.
    const calendar = $('.history-calendar');
    calendar.onkeydown = (e) => {
      const from = (e.target as HTMLElement).closest<HTMLElement>('[data-history-day]');
      if (!from || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      const step = calendarStep(from.dataset.historyDay!, e.key, today, first);
      if (!step) return;
      e.preventDefault();
      if ('refused' in step) {
        if (step.refused === 'future' && !e.key.startsWith('Page'))
          $('#history-hint').textContent = 'Esse dia ainda não chegou.';
        else refuseMonth();
        return;
      }
      if (step.day.slice(0, 7) !== month) {
        month = step.day.slice(0, 7);
        selected = step.day;
        render();
        document
          .querySelector<HTMLElement>(`[data-history-day="${step.day}"]`)
          ?.focus({ preventScroll: true });
        return;
      }
      $('#history-hint').textContent = '';
      calendar.querySelector('[data-history-day][tabindex="0"]')?.setAttribute('tabindex', '-1');
      const next = calendar.querySelector<HTMLElement>(`[data-history-day="${step.day}"]`);
      if (!next) return;
      next.tabIndex = 0;
      next.focus();
    };
  };
  render();
}
