import type { Preferences } from '../types';
import { $, ib } from './dom';
import { closePopover, popover } from './overlays';
import { icon } from '../icons';

// The papers of the reader, with the icon and the name of each. The panel and the preferences show
// the same three, in the order that the D key goes through them.
export const PAPER_CHOICES: readonly (readonly [Preferences['paper'], string, string])[] = [
  ['light', 'sun', 'Clara'],
  ['sepia', 'leaf', 'Sépia'],
  ['dark', 'moon', 'Escura'],
];
// The two sliders: how far each goes, where "Restaurar" and "Desativar" take it, and its name.
const CONTROLS = {
  brightness: { name: 'Brilho', min: 10, max: 100, reset: 100, action: 'Restaurar' },
  warm: { name: 'Tela quente', min: 0, max: 70, reset: 0, action: 'Desativar' },
} as const;
type Control = keyof typeof CONTROLS;
const KINDS = Object.keys(CONTROLS) as Control[];
const BUTTON = 'reader-appearance';
const DEFAULT_LABEL = 'Aparência: papel, brilho e tela quente';

const panelOpen = () => {
  const panel = $('#popover');
  return !panel.hidden && panel.dataset.owner === BUTTON;
};

// What the panel shows of the preferences: the paper that is on, and each value on its slider.
function syncPanel(prefs: Preferences) {
  if (!panelOpen()) return;
  for (const button of $('#popover').querySelectorAll<HTMLElement>('[data-quick-paper]')) {
    const on = button.dataset.quickPaper === prefs.paper;
    button.classList.toggle('active', on);
    button.setAttribute('aria-pressed', String(on));
  }
  for (const kind of KINDS) {
    const range = $<HTMLInputElement>(`#quick-${kind}`);
    range.value = String(prefs[kind]);
    range.setAttribute('aria-valuetext', `${prefs[kind]}%`);
    $(`#quick-${kind}-value`).textContent = `${prefs[kind]}%`;
  }
}

// The button of the toolbar: a dot on its icon says that the brightness or the warm screen is
// changed, and the name says by how much, so that the state is not only a dot.
export function syncReadingComfort(prefs: Preferences) {
  const changes = [
    ...(prefs.brightness < 100 ? [`brilho ${prefs.brightness}%`] : []),
    ...(prefs.warm > 0 ? [`tela quente ${prefs.warm}%`] : []),
  ];
  const button = $(`#${BUTTON}`);
  const label = changes.length ? `Aparência: ${changes.join(', ')}` : DEFAULT_LABEL;
  button.toggleAttribute('data-adjusted', changes.length > 0);
  button.setAttribute('aria-label', label);
  button.title = prefs.singleKeys ? `${label} (D muda o papel)` : label;
  syncPanel(prefs);
}

// The panel of the toolbar button: the paper, the brightness and the warm screen, where the reader
// is, and a way on to the preferences for the rest. `more` opens them on the Aparência section.
export function bindReadingComfort(prefs: Preferences, apply: () => void, more: () => void) {
  const button = $(`#${BUTTON}`);
  const slider = (kind: Control) => {
    const { name, min, max, action } = CONTROLS[kind];
    return `<div class="appearance-group"><div class="appearance-row"><label for="quick-${kind}">${name}</label><output id="quick-${kind}-value" for="quick-${kind}">${prefs[kind]}%</output><button id="quick-${kind}-reset" class="text-button" type="button" aria-label="${action} ${name.toLowerCase()}">${action}</button></div><input id="quick-${kind}" type="range" min="${min}" max="${max}" step="5" value="${prefs[kind]}" aria-valuetext="${prefs[kind]}%"></div>`;
  };
  const papers = () =>
    PAPER_CHOICES.map(
      ([paper, ico, name]) =>
        `<button class="quick-paper ${paper === prefs.paper ? 'active' : ''}" type="button" data-quick-paper="${paper}" aria-pressed="${paper === prefs.paper}">${icon(ico)}${name}</button>`,
    ).join('');
  // Keys inside the panel. The fields (the sliders) keep their arrows. On a button the arrows of the
  // reader would turn the page, so they stay here, and move between the three papers. Tab leaves the
  // panel at either end, the focus going back to the button as it does from a menu.
  const keys = (root: HTMLElement) =>
    root.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement;
      if (e.key === 'Tab') {
        const stops = [...root.querySelectorAll<HTMLElement>('button, input')];
        if (e.shiftKey && target === stops[0]) {
          e.preventDefault();
          closePopover(true);
        } else if (!e.shiftKey && target === stops.at(-1)) closePopover(true);
        return;
      }
      if (target.matches('input')) return;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key))
        return;
      e.stopPropagation();
      const choices = [...root.querySelectorAll<HTMLElement>('[data-quick-paper]')];
      const at = choices.indexOf(target);
      if (at < 0) return;
      e.preventDefault();
      const next =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? choices.length - 1
            : (at + (['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 1) + choices.length) %
              choices.length;
      choices[next].focus();
    });
  const open = () => {
    if (button.getAttribute('aria-expanded') === 'true') {
      closePopover(true);
      return;
    }
    popover(
      button,
      `<div class="appearance"><div class="appearance-heading"><strong id="quick-label">Aparência</strong>${ib('quick-close', 'Fechar aparência', 'close')}</div><div class="appearance-group"><span id="quick-paper-label" class="appearance-label">Cor das páginas</span><div class="quick-papers" role="group" aria-labelledby="quick-paper-label">${papers()}</div></div>${KINDS.map(slider).join('')}<button id="quick-more" class="text-button" type="button">Mais preferências… ${icon('arrow')}</button></div>`,
    );
    const panel = $('#popover');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'quick-label');
    button.setAttribute('aria-expanded', 'true');
    for (const kind of KINDS) {
      const range = $<HTMLInputElement>(`#quick-${kind}`);
      const set = (value: number) => {
        prefs[kind] = value;
        apply();
        syncPanel(prefs);
      };
      range.oninput = () => set(Number(range.value));
      $(`#quick-${kind}-reset`).onclick = () => set(CONTROLS[kind].reset);
    }
    panel.querySelectorAll<HTMLElement>('[data-quick-paper]').forEach(
      (choice) =>
        (choice.onclick = () => {
          prefs.paper = choice.dataset.quickPaper as Preferences['paper'];
          apply();
          syncPanel(prefs);
        }),
    );
    $('#quick-close').onclick = () => closePopover(true);
    // The focus goes back to the button first, so that the dialog returns it there when it closes.
    $('#quick-more').onclick = () => {
      closePopover(true);
      more();
    };
    keys($('.appearance'));
    panel.querySelector<HTMLElement>('.quick-paper.active')?.focus({ preventScroll: true });
  };
  button.onclick = open;
}
