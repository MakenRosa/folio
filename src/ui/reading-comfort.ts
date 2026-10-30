import type { Preferences } from '../types';
import { $, ib } from './dom';
import { closePopover, popover } from './overlays';

type Control = 'brightness' | 'warm';
const labels = { brightness: 'Brilho da leitura', warm: 'Tela quente' };

export function syncReadingComfort(prefs: Preferences) {
  for (const kind of ['brightness', 'warm'] as const) {
    const button = $(`#reading-${kind}`);
    $(`#reading-${kind}-value`).textContent = `${prefs[kind]}%`;
    button.title = `${labels[kind]}: ${prefs[kind]}%`;
    button.setAttribute('aria-label', button.title);
    button.classList.toggle('selected', kind === 'warm' ? prefs.warm > 0 : prefs.brightness < 100);
  }
}

export function bindReadingComfort(prefs: Preferences, apply: () => void) {
  const open = (kind: Control) => {
    const button = $(`#reading-${kind}`);
    if (button.getAttribute('aria-expanded') === 'true') {
      closePopover(true);
      return;
    }
    const min = kind === 'brightness' ? 10 : 0;
    const max = kind === 'brightness' ? 100 : 70;
    const reset = kind === 'brightness' ? 100 : 0;
    popover(
      button,
      `<div class="reading-control"><div class="reading-control-heading"><label id="quick-label" for="quick-range">${labels[kind]}</label>${ib('quick-close', 'Fechar ajuste', 'close')}</div><div class="reading-control-value"><span>${kind === 'brightness' ? 'Mais suave' : 'Desativada'}</span><output id="quick-value" for="quick-range">${prefs[kind]}%</output></div><input id="quick-range" type="range" min="${min}" max="${max}" step="5" value="${prefs[kind]}" aria-valuetext="${prefs[kind]}%"><button id="quick-reset" class="text-button">${kind === 'brightness' ? 'Restaurar brilho original' : 'Desativar tela quente'}</button></div>`,
    );
    const panel = $('#popover');
    panel.dataset.owner = button.id;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'quick-label');
    button.setAttribute('aria-expanded', 'true');
    const range = $<HTMLInputElement>('#quick-range');
    const update = (value: number) => {
      prefs[kind] = value;
      apply();
      range.value = String(prefs[kind]);
      range.setAttribute('aria-valuetext', `${prefs[kind]}%`);
      $('#quick-value').textContent = `${prefs[kind]}%`;
    };
    range.oninput = () => update(Number(range.value));
    $('#quick-reset').onclick = () => update(reset);
    $('#quick-close').onclick = () => closePopover(true);
    range.focus({ preventScroll: true });
  };
  $('#reading-brightness').onclick = () => open('brightness');
  $('#reading-warm').onclick = () => open('warm');
}
