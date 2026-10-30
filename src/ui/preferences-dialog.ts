import type { Preferences } from '../types';
import { invoke } from '../bridge';
import { icon } from '../icons';
import { $, esc, ib } from './dom';
import { modal, failing } from './overlays';
import { FAILED } from './failures';
import { showHelp } from './help-dialog';
import { PAPER_CHOICES } from './reading-comfort';

// The sections of the dialog, in the order of its tabs.
const SECTIONS = [
  ['aparencia', 'Aparência'],
  ['leitura', 'Leitura'],
  ['teclado', 'Teclado'],
  ['biblioteca', 'Biblioteca'],
] as const;
export type PreferencesSection = (typeof SECTIONS)[number][0];
// The section the dialog opened on last, for as long as the app stays open.
let lastSection: PreferencesSection = SECTIONS[0][0];
// The keys of one letter, with what each does (the whole list is in the guide).
const SINGLE_KEYS = [
  ['K', 'Alternar o modo Kindle'],
  ['L', 'Alternar duas páginas lado a lado'],
  ['S', 'Mostrar ou esconder a barra lateral'],
  ['D', 'Mudar o papel: claro, sépia e escuro'],
  ['R', 'Girar a página'],
  ['H', 'Realçar o trecho selecionado'],
  ['N', 'Adicionar nota ao trecho selecionado'],
  ['?', 'Abrir o guia'],
];
// Up to this width the tabs lie across the top of the dialog instead of down its side.
const NARROW = '(max-width: 800px)';
// The tab that an arrow key, Home or End goes to; the tabs wrap around. Null for other keys. Both the
// vertical and the horizontal arrows work, whichever way the tabs lie at the moment.
function tabAfterKey(at: number, key: string): number | null {
  const last = SECTIONS.length - 1;
  if (key === 'ArrowDown' || key === 'ArrowRight') return at === last ? 0 : at + 1;
  if (key === 'ArrowUp' || key === 'ArrowLeft') return at === 0 ? last : at - 1;
  if (key === 'Home') return 0;
  if (key === 'End') return last;
  return null;
}
const panel = (id: PreferencesSection, open: PreferencesSection, content: string) =>
  `<div id="prefs-panel-${id}" class="prefs-panel" role="tabpanel" aria-labelledby="prefs-tab-${id}" ${id === open ? '' : 'hidden'}>${content}</div>`;
// `section` is the tab the dialog opens on; without it, the one that was used last.
export function showPreferences(
  prefs: Preferences,
  actions: {
    folder: string;
    applyPrefs: () => void;
    setReadingMode: (mode: Preferences['readingMode']) => void;
  },
  section?: PreferencesSection,
) {
  const { folder, applyPrefs, setReadingMode } = actions;
  const open = (lastSection = SECTIONS.find(([id]) => id === section)?.[0] ?? lastSection);
  const inKindle = prefs.readingMode === 'kindle';
  const tabs = SECTIONS.map(
    ([id, label]) =>
      `<button id="prefs-tab-${id}" class="prefs-tab ${id === open ? 'active' : ''}" role="tab" data-section="${id}" aria-selected="${id === open}" aria-controls="prefs-panel-${id}" tabindex="${id === open ? 0 : -1}" ${id === open ? 'autofocus' : ''}>${label}</button>`,
  ).join('');
  const appearance = `<div class="setting-section"><div class="setting-row"><div><label class="setting-label" for="pref-theme">Tema do aplicativo</label><p>A aparência da biblioteca e dos controles.</p></div><select id="pref-theme"><option value="light">Claro</option><option value="dark">Escuro</option><option value="system">Seguir o sistema</option></select></div></div>
 <div class="setting-section"><strong id="paper-label">Cor das páginas</strong><p>Aplicada à leitura, sem alterar seu PDF.</p><div class="paper-options" role="group" aria-labelledby="paper-label">${PAPER_CHOICES.map(
   ([v, i, l]) =>
     `<button class="paper-option ${v === prefs.paper ? 'active' : ''}" data-paper="${v}" aria-pressed="${v === prefs.paper}">${icon(i)}${l}</button>`,
 ).join('')}</div><small>No modo escuro, as cores das imagens também são invertidas.</small></div>
 <div class="setting-section"><div class="setting-row"><div><label class="setting-label" for="brightness-range">${icon('sun')} Brilho da leitura</label><p id="brightness-description">Escurece a área do PDF, mesmo com a página clara.</p></div><output id="brightness-value" for="brightness-range">${prefs.brightness}%</output></div><input id="brightness-range" type="range" min="10" max="100" step="5" value="${prefs.brightness}" aria-describedby="brightness-description" aria-valuetext="${prefs.brightness}%"><div class="range-labels"><span>Mais suave · 10%</span><span>Original · 100%</span></div><button id="brightness-reset" class="text-button brightness-reset">Restaurar brilho original</button></div>
 <div class="setting-section"><div class="setting-row"><div><strong>${icon('warm')} Tela quente</strong><p>Um tom âmbar suave para a leitura noturna.</p></div><output id="warm-value" for="warm-range">${prefs.warm}%</output></div><input id="warm-range" type="range" min="0" max="70" step="5" value="${prefs.warm}" aria-label="Intensidade da tela quente"><div class="range-labels"><span>Desativada</span><span>Mais quente</span></div><div id="paper-sample"><span>Amostra de texto com o papel, o brilho e a tela quente escolhidos.</span></div></div>`;
  const reading = `<div class="setting-section"><div class="setting-row"><div><label class="setting-label" for="pref-reading-mode">Forma de leitura</label><p>Rolagem contínua ou uma tela de cada vez.</p></div><select id="pref-reading-mode"><option value="scroll">Rolagem</option><option value="kindle">Kindle</option></select></div><p class="mode-description">No Kindle, as telas acompanham o zoom e podem atravessar páginas do PDF. Use as setas, Espaço ou a roda do mouse. Um pequeno trecho se repete para não cortar linhas. A diagramação do texto é preservada.</p></div>
 <div class="setting-section"><div id="pref-spread-row" class="setting-row"><div><label class="setting-label" for="pref-spread">Páginas na tela</label><p id="pref-spread-help"></p></div><select id="pref-spread" aria-describedby="pref-spread-help"><option value="none">Página única</option><option value="odd">Duas páginas</option><option value="even">Duas páginas, capa separada</option></select></div></div>
 <label class="setting-row switch-row"><div><strong>Continuar de onde parei</strong><p>Retoma a posição e o zoom de cada PDF.</p></div><input id="pref-resume" type="checkbox" role="switch" ${prefs.resume ? 'checked' : ''}></label>
 <div class="setting-section"><fieldset id="pref-kindle-group" class="prefs-group" ${inKindle ? '' : 'disabled aria-describedby="pref-kindle-note"'}><legend>No modo Kindle</legend><p id="pref-kindle-note" class="mode-description" ${inKindle ? 'hidden' : ''}>Disponível no modo Kindle.</p><label class="setting-row switch-row"><div><strong>Unir conteúdo das páginas</strong><p>Reduz as margens vazias no Kindle, sem alterar o PDF.</p></div><input id="pref-join-pages" type="checkbox" role="switch" ${prefs.joinPages ? 'checked' : ''}></label><label class="setting-row switch-row"><div><strong>Capítulos em nova tela</strong><p>Separa as páginas de abertura reconhecidas pelo sumário ou pelo cabeçalho.</p></div><input id="pref-chapter-breaks" type="checkbox" role="switch" ${prefs.chapterBreaks ? 'checked' : ''}></label></fieldset></div>`;
  const keyboard = `<label class="setting-row switch-row"><div><strong>Atalhos de uma tecla</strong><p>Teclas soltas que controlam o leitor. Desligue para evitar acionamentos sem querer.</p></div><input id="pref-single-keys" type="checkbox" role="switch" ${prefs.singleKeys ? 'checked' : ''}></label>
 <div class="setting-section"><dl class="shortcuts prefs-keys" aria-label="Atalhos de uma tecla">${SINGLE_KEYS.map(([k, v]) => `<div><dt>${v}</dt><dd><kbd>${k}</kbd></dd></div>`).join('')}</dl><button id="prefs-shortcuts" class="text-button">Ver todos os atalhos ${icon('arrow')}</button></div>`;
  const library = `<div class="settings-folder"><span>${icon('folder')} Pasta da biblioteca</span><code>${esc(folder)}</code><button id="settings-folder" class="text-button">Abrir pasta ${icon('arrow')}</button></div>
 <p class="mode-description">Os PDFs adicionados são copiados para esta pasta. Os originais não são alterados.</p>`;
  const d =
    modal(`<div class="prefs-view"><div class="dialog-heading"><h2>Preferências</h2>${ib('close-settings', 'Fechar preferências', 'close', 'data-close')}</div>
 <div class="prefs-body"><div class="prefs-tabs" role="tablist" aria-label="Seções das preferências" aria-orientation="${matchMedia(NARROW).matches ? 'horizontal' : 'vertical'}">${tabs}</div><div class="prefs-panels">${panel('aparencia', open, appearance)}${panel('leitura', open, reading)}${panel('teclado', open, keyboard)}${panel('biblioteca', open, library)}</div></div>
 <div class="dialog-actions"><button class="primary" data-close>Pronto</button></div></div>`);
  // One tab is open at a time. The others keep their controls, only out of sight, so that what is set
  // in one tab never depends on having visited another.
  const buttons = [...d.querySelectorAll<HTMLButtonElement>('.prefs-tab')];
  const select = (id: PreferencesSection, focus = false) => {
    lastSection = id;
    for (const tab of buttons) {
      const on = tab.dataset.section === id;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      $(`#prefs-panel-${tab.dataset.section}`).hidden = !on;
      if (on && focus) tab.focus();
    }
    $('.prefs-panels').scrollTop = 0;
  };
  buttons.forEach((tab) => (tab.onclick = () => select(tab.dataset.section as PreferencesSection)));
  $('.prefs-tabs').addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const next = tabAfterKey(buttons.indexOf(e.target as HTMLButtonElement), e.key);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    select(SECTIONS[next][0], true);
  });
  // The tabs say which way they lie, so that a screen reader names the arrows that move through them.
  const narrow = matchMedia(NARROW);
  const orient = () =>
    d
      .querySelector('.prefs-tabs')
      ?.setAttribute('aria-orientation', narrow.matches ? 'horizontal' : 'vertical');
  narrow.addEventListener('change', orient);
  d.addEventListener('close', () => narrow.removeEventListener('change', orient), { once: true });
  // The Kindle needs one column. The choice is kept, only unavailable meanwhile.
  const syncSpread = () => {
    const kindle = prefs.readingMode === 'kindle';
    $<HTMLSelectElement>('#pref-spread').disabled = kindle;
    $('#pref-spread-help').textContent = kindle
      ? 'Só na rolagem. O Kindle usa uma coluna; sua escolha volta ao sair dele.'
      : 'Páginas lado a lado na rolagem. Com capa separada, a página 1 fica sozinha.';
  };
  // What only the Kindle uses stays in view in the scroll mode, switched off and saying why.
  const syncKindleGroup = () => {
    const on = prefs.readingMode === 'kindle';
    const group = $<HTMLFieldSetElement>('#pref-kindle-group');
    group.disabled = !on;
    if (on) group.removeAttribute('aria-describedby');
    else group.setAttribute('aria-describedby', 'pref-kindle-note');
    $('#pref-kindle-note').hidden = on;
  };
  $<HTMLSelectElement>('#pref-spread').value = prefs.spread;
  $('#pref-spread').onchange = () => {
    prefs.spread = $<HTMLSelectElement>('#pref-spread').value as Preferences['spread'];
    applyPrefs();
  };
  syncSpread();
  $<HTMLSelectElement>('#pref-reading-mode').value = prefs.readingMode;
  $('#pref-reading-mode').onchange = () => {
    setReadingMode($<HTMLSelectElement>('#pref-reading-mode').value as Preferences['readingMode']);
    syncKindleGroup();
    syncSpread();
  };
  $('#pref-join-pages').onchange = () => {
    prefs.joinPages = $<HTMLInputElement>('#pref-join-pages').checked;
    applyPrefs();
  };
  $('#pref-chapter-breaks').onchange = () => {
    prefs.chapterBreaks = $<HTMLInputElement>('#pref-chapter-breaks').checked;
    applyPrefs();
  };
  $<HTMLSelectElement>('#pref-theme').value = prefs.theme;
  $('#pref-theme').onchange = () => {
    prefs.theme = $<HTMLSelectElement>('#pref-theme').value as Preferences['theme'];
    applyPrefs();
  };
  $('#pref-resume').onchange = () => {
    prefs.resume = $<HTMLInputElement>('#pref-resume').checked;
    applyPrefs();
  };
  $('#pref-single-keys').onchange = () => {
    prefs.singleKeys = $<HTMLInputElement>('#pref-single-keys').checked;
    applyPrefs();
  };
  $('#prefs-shortcuts').onclick = showHelp;
  const sample = () => {
    const s = $('#paper-sample');
    s.dataset.paper = prefs.paper;
    s.style.setProperty('--sample-warm', String(prefs.warm / 100));
    s.style.setProperty('--sample-dim', String((100 - prefs.brightness) / 100));
  };
  const updateBrightness = () => {
    applyPrefs();
    const range = $<HTMLInputElement>('#brightness-range');
    range.value = String(prefs.brightness);
    range.setAttribute('aria-valuetext', `${prefs.brightness}%`);
    $('#brightness-value').textContent = `${prefs.brightness}%`;
    sample();
  };
  sample();
  $('#brightness-range').oninput = () => {
    prefs.brightness = Number($<HTMLInputElement>('#brightness-range').value);
    updateBrightness();
  };
  $('#brightness-reset').onclick = () => {
    prefs.brightness = 100;
    updateBrightness();
  };
  $('#warm-range').oninput = () => {
    prefs.warm = Number($<HTMLInputElement>('#warm-range').value);
    $('#warm-value').textContent = `${prefs.warm}%`;
    applyPrefs();
    sample();
  };
  d.querySelectorAll<HTMLElement>('[data-paper]').forEach(
    (b) =>
      (b.onclick = () => {
        prefs.paper = b.dataset.paper as Preferences['paper'];
        applyPrefs();
        sample();
        d.querySelectorAll<HTMLElement>('.paper-option').forEach((x) => {
          const on = x.dataset.paper === prefs.paper;
          x.classList.toggle('active', on);
          x.setAttribute('aria-pressed', String(on));
        });
      }),
  );
  $('#settings-folder').onclick = () => void invoke('open_folder').catch(failing(FAILED.folder));
}
