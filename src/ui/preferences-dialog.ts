import type { Preferences } from '../types';
import { invoke } from '../bridge';
import { icon } from '../icons';
import { $, esc, ib } from './dom';
import { modal, fail } from './overlays';
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
    modal(`<div class="dialog-heading"><div><span class="eyebrow">DO SEU JEITO</span><h2>Conforto para ler</h2></div>${ib('close-settings', 'Fechar preferências', 'close', 'data-close')}</div>
 <div class="setting-row"><div><strong>Interface</strong><p>A aparência da biblioteca e dos controles.</p></div><select id="pref-theme"><option value="light">Clara</option><option value="dark">Escura</option><option value="system">Sistema</option></select></div>
 <div class="setting-section"><div class="setting-row"><div><label class="setting-label" for="pref-reading-mode">Forma de leitura</label><p>Rolagem contínua ou uma tela de cada vez.</p></div><select id="pref-reading-mode"><option value="scroll">Rolagem</option><option value="kindle">Kindle</option></select></div><p class="mode-description">No Kindle, as telas acompanham o zoom e podem atravessar páginas do PDF. Use as setas, Espaço ou a roda do mouse. Um pequeno trecho se repete para não cortar linhas. O layout original é preservado.</p></div>
 <div class="setting-section"><strong>Cor das páginas</strong><p>Aplicada à leitura, sem alterar seu PDF.</p><div class="paper-options">${[
   ['light', 'sun', 'Clara'],
   ['sepia', 'leaf', 'Sépia'],
   ['dark', 'moon', 'Escura'],
 ]
   .map(
     ([v, i, l]) =>
       `<button class="paper-option ${v === prefs.paper ? 'active' : ''}" data-paper="${v}">${icon(i)}${l}</button>`,
   )
   .join('')}</div><small>No modo escuro, as cores das imagens também são invertidas.</small></div>
 <div class="setting-section"><div class="setting-row"><div><label class="setting-label" for="brightness-range">${icon('sun')} Brilho da leitura</label><p id="brightness-description">Escurece a área do PDF, mesmo com a página clara.</p></div><output id="brightness-value" for="brightness-range">${prefs.brightness}%</output></div><input id="brightness-range" type="range" min="10" max="100" step="5" value="${prefs.brightness}" aria-describedby="brightness-description" aria-valuetext="${prefs.brightness}%"><div class="range-labels"><span>Mais suave · 10%</span><span>Original · 100%</span></div><button id="brightness-reset" class="text-button brightness-reset">Restaurar brilho original</button></div>
 <div class="setting-section"><div class="setting-row"><div><strong>${icon('warm')} Tela quente</strong><p>Um tom âmbar suave para a leitura noturna.</p></div><output id="warm-value" for="warm-range">${prefs.warm}%</output></div><input id="warm-range" type="range" min="0" max="60" step="5" value="${prefs.warm}" aria-label="Intensidade da tela quente"><div class="range-labels"><span>Desativada</span><span>Mais quente</span></div><div id="paper-sample"><strong>Um pouco de calma.</strong><span>A próxima página pode esperar um segundo.</span></div></div>
 <label class="setting-row switch-row"><div><strong>Continuar de onde parei</strong><p>Retoma a posição e o zoom de cada PDF.</p></div><input id="pref-resume" type="checkbox" role="switch" ${prefs.resume ? 'checked' : ''}></label><div class="settings-folder"><span>${icon('folder')} Biblioteca local</span><code>${esc(folder)}</code><button id="settings-folder" class="text-button">Abrir pasta da biblioteca ${icon('arrow')}</button></div><div class="dialog-actions"><button class="primary" data-close>Pronto</button></div>`);
  $<HTMLSelectElement>('#pref-reading-mode').value = prefs.readingMode;
  $('#pref-reading-mode').onchange = () =>
    setReadingMode($<HTMLSelectElement>('#pref-reading-mode').value as Preferences['readingMode']);
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
        d.querySelectorAll('[data-paper]').forEach((x) =>
          x.classList.toggle('active', (x as HTMLElement).dataset.paper === prefs.paper),
        );
      }),
  );
  $('#settings-folder').onclick = () => void invoke('open_folder').catch(fail);
}
