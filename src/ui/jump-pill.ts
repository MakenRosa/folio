import { $ } from './dom';
import type { JumpOffer } from '../reading/jumps';

// How long the pill stays after a jump, and how long after the pointer or the focus lets go of it.
const HIDE_AFTER = 15000,
  GRACE = 6000;

// The pill over the reading surface that offers the way back after a jump ("Voltar à pág. 12"),
// or the way forward again after going back. It floats: showing or hiding it never moves the PDF.
// It leaves after a while, when it is used or dismissed, and when the book is closed; the pointer
// or the focus on it stops the clock. It shows one side at a time, the forward one in a quieter
// colour. The keys are the reader's own (Alt + ← and Alt + →), and a polite message says so.
export class JumpPill {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private hover = false;
  private focus = false;

  constructor(actions: { back: () => void; forward: () => void }) {
    const pill = $('#jump-pill');
    $('#jump-back').onclick = actions.back;
    $('#jump-forward').onclick = actions.forward;
    $('#jump-dismiss').onclick = () => this.hide();
    pill.addEventListener('pointerenter', () => {
      this.hover = true;
      clearTimeout(this.timer);
    });
    pill.addEventListener('pointerleave', () => {
      this.hover = false;
      this.arm(GRACE);
    });
    pill.addEventListener('focusin', () => {
      this.focus = true;
      clearTimeout(this.timer);
    });
    pill.addEventListener('focusout', (e) => {
      if (pill.contains(e.relatedTarget as Node | null)) return;
      this.focus = false;
      this.arm(GRACE);
    });
    // Escape closes the pill that has the focus, and only that.
    pill.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      this.hide();
    });
  }

  show(offer: JumpOffer) {
    const page = offer[offer.show];
    if (page === null) return this.hide();
    const pill = $('#jump-pill'),
      back = offer.show === 'back';
    const text = back ? `Voltar à pág. ${page}` : `Avançar à pág. ${page}`,
      label = `${text} (${back ? 'Alt + ←' : 'Alt + →'})`,
      shown = $(back ? '#jump-back' : '#jump-forward'),
      other = $(back ? '#jump-forward' : '#jump-back');
    // The side that goes away must not take the focus with it: the reader gets it back.
    const focused = other.contains(document.activeElement);
    shown.hidden = false;
    other.hidden = true;
    $(back ? '#jump-back-text' : '#jump-forward-text').textContent = text;
    shown.title = label;
    shown.setAttribute('aria-label', label);
    pill.dataset.side = offer.show;
    pill.hidden = false;
    $('#jump-status').textContent = back
      ? `Para voltar à página ${page}, use Alt + seta para a esquerda.`
      : `Para avançar à página ${page}, use Alt + seta para a direita.`;
    if (focused) $('#viewer-container').focus({ preventScroll: true });
    this.arm(HIDE_AFTER);
  }

  hide() {
    clearTimeout(this.timer);
    this.hover = this.focus = false;
    const pill = $('#jump-pill');
    if (pill.hidden) return;
    const focused = pill.contains(document.activeElement);
    pill.hidden = true;
    $('#jump-status').textContent = '';
    // A button that goes away must not take the focus with it.
    if (focused) $('#viewer-container').focus({ preventScroll: true });
  }

  private arm(ms: number) {
    clearTimeout(this.timer);
    if (this.hover || this.focus || $('#jump-pill').hidden) return;
    this.timer = setTimeout(() => this.hide(), ms);
  }
}
