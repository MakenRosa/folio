import type { Window } from '@tauri-apps/api/window';
import { icon } from '../icons';
import { $ } from './dom';
import { closePopover } from './overlays';

// Bars overlay the reading surface in fullscreen. Revealing them never changes
// the PDF viewport, zoom, chapter boundaries or saved reading coordinates.
export class ReaderChrome {
  private fullscreen = false;
  private changing = false;
  private revision = 0;
  private keyboard = false;
  private hover = { top: false, bottom: false };
  private visible = { top: false, bottom: false };
  private timers: Partial<Record<'top' | 'bottom', ReturnType<typeof setTimeout>>> = {};

  constructor(
    private window: Window,
    private reading: () => boolean,
    private resize: () => void,
    private fail: (error: unknown) => void,
  ) {
    $('#fullscreen').setAttribute('aria-pressed', 'false');
    document.addEventListener('pointermove', (event) => this.pointer(event));
    document.addEventListener('pointerdown', (event) => {
      this.keyboard = false;
      this.pointer(event);
    });
    document.documentElement.addEventListener('pointerleave', () => {
      this.hover = { top: false, bottom: false };
      this.schedule();
    });
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Tab') this.keyboard = true;
      },
      true,
    );
    document.addEventListener('focusin', () => {
      if (!this.fullscreen) return;
      if (this.keyboard && $('.reader-top').contains(document.activeElement)) this.show('top');
      if (this.keyboard && $('.reader-footer').contains(document.activeElement))
        this.show('bottom');
    });
    document.addEventListener('focusout', () => this.schedule());
    new MutationObserver(() => this.schedule()).observe($('#popover'), {
      attributes: true,
      attributeFilter: ['hidden'],
    });
    globalThis.addEventListener('resize', () => void this.sync().catch(fail));
    globalThis.addEventListener('focus', () => void this.sync().catch(fail));
  }

  private pointer(event: PointerEvent) {
    if (!this.fullscreen) return;
    this.hover.top = event.clientY <= (this.visible.top ? $('.reader-top').offsetHeight + 10 : 12);
    this.hover.bottom =
      event.clientY >=
      innerHeight - (this.visible.bottom ? $('.reader-footer').offsetHeight + 10 : 12);
    for (const edge of ['top', 'bottom'] as const) {
      if (this.hover[edge]) this.show(edge);
      else this.schedule(edge);
    }
  }

  private pinned(edge: 'top' | 'bottom') {
    const element = $(edge === 'top' ? '.reader-top' : '.reader-footer');
    return (
      this.hover[edge] ||
      (this.keyboard && element.contains(document.activeElement)) ||
      (edge === 'top' && (!$('#popover').hidden || !$('#find-bar').hidden))
    );
  }

  private show(edge: 'top' | 'bottom') {
    clearTimeout(this.timers[edge]);
    this.timers[edge] = undefined;
    this.visible[edge] = true;
    document.body.classList.add(`reader-${edge}-visible`);
  }

  private schedule(only?: 'top' | 'bottom') {
    if (!this.fullscreen) return;
    for (const edge of only ? [only] : (['top', 'bottom'] as const)) {
      if (this.pinned(edge)) {
        if (edge === 'top') this.show(edge);
        continue;
      }
      if (this.timers[edge]) continue;
      this.timers[edge] = setTimeout(() => {
        this.timers[edge] = undefined;
        if (this.pinned(edge)) return;
        this.visible[edge] = false;
        document.body.classList.remove(`reader-${edge}-visible`);
      }, 650);
    }
  }

  private apply(active: boolean) {
    if (this.fullscreen === active) return;
    this.fullscreen = active;
    for (const edge of ['top', 'bottom'] as const) clearTimeout(this.timers[edge]);
    this.timers = {};
    this.visible = { top: false, bottom: false };
    this.hover = { top: false, bottom: false };
    closePopover();
    document.body.classList.toggle('reader-fullscreen', active);
    document.body.classList.remove('reader-top-visible', 'reader-bottom-visible');
    const button = $('#fullscreen');
    button.innerHTML = icon(active ? 'collapse' : 'expand');
    button.title = active ? 'Sair da tela cheia (F11 ou Esc)' : 'Tela cheia (F11)';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(active));
    if (active) {
      $('#viewer-container').focus({ preventScroll: true });
      if (!$('#find-bar').hidden) this.show('top');
    }
    this.resize();
  }

  async sync() {
    if (this.changing) return;
    const revision = ++this.revision;
    const active = await this.window.isFullscreen();
    if (!this.changing && revision === this.revision) this.apply(active && this.reading());
  }

  async toggle() {
    if (this.changing || !this.reading()) return;
    this.changing = true;
    ++this.revision;
    try {
      const active = !(await this.window.isFullscreen());
      await this.window.setFullscreen(active);
      this.apply(active);
    } catch (error) {
      this.fail(error);
    } finally {
      this.changing = false;
    }
  }

  async exit() {
    if (!this.fullscreen) return;
    ++this.revision;
    await this.window.setFullscreen(false);
    this.apply(false);
  }

  showTop() {
    if (this.fullscreen) this.show('top');
  }
  releaseTop() {
    this.schedule('top');
  }
}
