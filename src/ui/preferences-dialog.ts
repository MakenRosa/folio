import type { Preferences } from '../types';
import { invoke } from '../bridge';
import { icon } from '../icons';
import { $, esc, ib } from './dom';
import { modal, failing } from './overlays';
import { FAILED } from './failures';
export function showPreferences(
  prefs: Preferences,
  actions: {
    folder: string;
    applyPrefs: () => void;
    setReadingMode: (mode: Preferences['readingMode']) => void;
  },
) {
  const { folder, applyPrefs, setReadingMode } = actions;
  const d =
    modal(`<div class="scroll-dialog"><div class="dialog-heading"><div><span class="eyebrow">CONFORTO PARA LER</span><h2>Preferências</h2></div>${ib('close-settings', 'Fechar preferências', 'close', 'data-close')}</div>
 <div class="setting-row"><div><label class="setting-label" for="pref-theme">Tema do aplicativo</label><p>A aparência da biblioteca e dos controles.</p></div><select id="pref-theme"><option value="light">Claro</option><option value="dark">Escuro</option><option value="system">Seguir o sistema</option></select></div>
 <div class="setting-section"><div class="setting-row"><div><label class="setting-label" for="pref-reading-mode">Forma de leitura</label><p>Rolagem contínua ou uma tela de cada vez.</p></div><select id="pref-reading-mode"><option value="scroll">Rolagem</option><option value="kindle">Kindle</option></select></div><p class="mode-description">No Kindle, as telas acompanham o zoom e podem atravessar páginas do PDF. Use as setas, Espaço ou a roda do mouse. Um pequeno trecho se repete para não cortar linhas. A diagramação do texto é preservada.</p><label id="pref-join-row" class="setting-row switch-row" ${prefs.readingMode !== 'kindle' ? 'hidden' : ''}><div><strong>Unir conteúdo das páginas</strong><p>Reduz as margens vazias no Kindle, sem alterar o PDF.</p></div><input id="pref-join-pages" type="checkbox" role="switch" ${prefs.joinPages ? 'checked' : ''}></label><label id="pref-chapters-row" class="setting-row switch-row" ${prefs.readingMode !== 'kindle' ? 'hidden' : ''}><div><strong>Capítulos em nova tela</strong><p>Separa as páginas de abertura reconhecidas pelo sumário ou pelo cabeçalho.</p></div><input id="pref-chapter-breaks" type="checkbox" role="switch" ${prefs.chapterBreaks ? 'checked' : ''}></label><div id="pref-spread-row" class="setting-row"><div><label class="setting-label" for="pref-spread">Páginas na tela</label><p id="pref-spread-help"></p></div><select id="pref-spread" aria-describedby="pref-spread-help"><option value="none">Página única</option><option value="odd">Duas páginas</option><option value="even">Duas páginas, capa separada</option></select></div></div>
 <div class="setting-section"><strong id="paper-label">Cor das páginas</strong><p>Aplicada à leitura, sem alterar seu PDF.</p><div class="paper-options" role="group" aria-labelledby="paper-label">${[
   ['light', 'sun', 'Clara'],
   ['sepia', 'leaf', 'Sépia'],
   ['dark', 'moon', 'Escura'],
 ]
   .map(
     ([v, i, l]) =>
       `<button class="paper-option ${v === prefs.paper ? 'active' : ''}" data-paper="${v}" aria-pressed="${v === prefs.paper}">${icon(i)}${l}</button>`,
   )
   .join('')}</div><small>No modo escuro, as cores das imagens também são invertidas.</small></div>
 <div class="setting-section"><div class="setting-row"><div><label class="setting-label" for="brightness-range">${icon('sun')} Brilho da leitura</label><p id="brightness-description">Escurece a área do PDF, mesmo com a página clara.</p></div><output id="brightness-value" for="brightness-range">${prefs.brightness}%</output></div><input id="brightness-range" type="range" min="10" max="100" step="5" value="${prefs.brightness}" aria-describedby="brightness-description" aria-valuetext="${prefs.brightness}%"><div class="range-labels"><span>Mais suave · 10%</span><span>Original · 100%</span></div><button id="brightness-reset" class="text-button brightness-reset">Restaurar brilho original</button></div>
 <div class="setting-section"><div class="setting-row"><div><strong>${icon('warm')} Tela quente</strong><p>Um tom âmbar suave para a leitura noturna.</p></div><output id="warm-value" for="warm-range">${prefs.warm}%</output></div><input id="warm-range" type="range" min="0" max="70" step="5" value="${prefs.warm}" aria-label="Intensidade da tela quente"><div class="range-labels"><span>Desativada</span><span>Mais quente</span></div><div id="paper-sample"><strong>Um pouco de calma.</strong><span>A próxima página pode esperar um segundo.</span></div></div>
 <label class="setting-row switch-row"><div><strong>Continuar de onde parei</strong><p>Retoma a posição e o zoom de cada PDF.</p></div><input id="pref-resume" type="checkbox" role="switch" ${prefs.resume ? 'checked' : ''}></label><div class="settings-folder"><span>${icon('folder')} Biblioteca local</span><code>${esc(folder)}</code><button id="settings-folder" class="text-button">Abrir pasta da biblioteca ${icon('arrow')}</button></div><div class="dialog-actions"><button class="primary" data-close>Pronto</button></div></div>`);
  // The Kindle needs one column. The choice is kept, only unavailable meanwhile.
  const syncSpread = () => {
    const kindle = prefs.readingMode === 'kindle';
    $<HTMLSelectElement>('#pref-spread').disabled = kindle;
    $('#pref-spread-help').textContent = kindle
      ? 'Só na rolagem. O Kindle usa uma coluna; sua escolha volta ao sair dele.'
      : 'Páginas lado a lado na rolagem. Com capa separada, a página 1 fica sozinha.';
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
    $('#pref-join-row').hidden = prefs.readingMode !== 'kindle';
    $('#pref-chapters-row').hidden = prefs.readingMode !== 'kindle';
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
