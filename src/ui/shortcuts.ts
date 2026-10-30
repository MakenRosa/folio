import type { Reader } from '../reader';
import { $ } from './dom';
import { closePopover, failing, toast } from './overlays';
import { FAILED } from './failures';
import { isSelectionKey } from '../reading/selection-keys';
export const SPREAD_KINDLE_NOTE = 'Duas páginas só na rolagem. Saia do modo Kindle para usar.';
// H or N with nothing selected, and Shift + an arrow where there is no text in view.
export const SELECT_PASSAGE_NOTE = 'Selecione um trecho: Shift + setas ou o mouse.';
export const NO_TEXT_NOTE = 'Não há texto para selecionar nesta tela.';
type ShortcutActions = {
  isReading: () => boolean;
  getReader: () => Reader | null;
  importFiles: () => Promise<void>;
  closeReader: () => Promise<void>;
  toggleBookmark: () => Promise<void>;
  exitFullscreen: () => Promise<void>;
  showFind: () => void;
  // One step back or forward along the positions that the jumps of the document left.
  jumpBack: () => void;
  jumpForward: () => void;
  // In the library: tick every document on screen, and clear the ticks (true when there were any).
  selectAll: () => void;
  clearSelection: () => boolean;
  // In the reader, with a passage selected in the pages: highlight it in the colour last used, or
  // annotate it. Both say whether there was a passage selected.
  highlightSelection: () => boolean;
  annotateSelection: () => boolean;
  // Esc: puts away the bar of the selection and the selection itself. Says whether there was any.
  dismissSelection: () => boolean;
  // Whether the keys of one letter (K, L, S, D, R, H, N, and "?" for the guide) act. The reader can
  // turn them off in the preferences (WCAG 2.1.4); the ones with Ctrl or Alt, the arrows, F1 and the
  // like do not depend on it.
  singleKeys: () => boolean;
  // F1, or "?": the guide, from the library as from the reader.
  showHelp: () => void;
  // D goes on to the next paper; R turns the pages a quarter, with a way back. Neither has a button
  // of its own in the bars: the paper is in Aparência, and the turn is in the menu of the document.
  cyclePaper: () => void;
  rotate: () => void;
  // Esc in the search of the library: clears the field and what it filtered. Says whether there
  // was any text to clear.
  clearSearch: () => boolean;
};
export function bindShortcuts(actions: ShortcutActions) {
  const { importFiles, closeReader, toggleBookmark, exitFullscreen, showFind } = actions;
  // The side buttons of the mouse (back and forward) mean the same as Alt + ← and Alt + →. The
  // WebView would take them as navigation of its own history, so they are claimed here, whatever
  // is under the pointer. Only the reader acts on them, and only when no dialog is open.
  const side = (e: MouseEvent) => e.button === 3 || e.button === 4;
  for (const type of ['mousedown', 'auxclick'])
    document.addEventListener(
      type,
      (e) => {
        if (side(e as MouseEvent)) e.preventDefault();
      },
      true,
    );
  document.addEventListener(
    'mouseup',
    (e) => {
      if (!side(e)) return;
      e.preventDefault();
      if (!actions.isReading() || $<HTMLDialogElement>('#dialog').open) return;
      if (!(e.target instanceof Element && e.target.closest('#reader'))) return;
      if (e.button === 3) actions.jumpBack();
      else actions.jumpForward();
    },
    true,
  );
  document.addEventListener('keydown', (e) => {
    const current = actions.isReading(),
      reader = actions.getReader();
    if ($<HTMLDialogElement>('#dialog').open) return;
    const input = (e.target as HTMLElement).matches('input,textarea,select,[contenteditable]');
    // The keys of a menu of actions (arrows, Home, End, letters) belong to the menu.
    const inMenu = !!(e.target as HTMLElement).closest('#popover[role="menu"]');
    if (e.ctrlKey && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      void importFiles();
    } else if (e.ctrlKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (current) void closeReader().catch(failing(FAILED.back));
      else $('#library-search').focus();
    } else if (current && e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      showFind();
    } else if (current && e.ctrlKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      void toggleBookmark().catch(failing(FAILED.bookmark));
    } else if (current && e.ctrlKey && ['+', '=', '-'].includes(e.key)) {
      e.preventDefault();
      reader?.stepZoom(e.key === '-' ? -1 : 1);
    } else if (current && e.ctrlKey && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      void closeReader().catch(failing(FAILED.back));
    } else if (
      current &&
      e.altKey &&
      !e.ctrlKey &&
      !e.shiftKey &&
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
    ) {
      // As in a browser or an e-book reader: back to where the last jump left, and forward again.
      e.preventDefault();
      if (e.repeat) return;
      if (e.key === 'ArrowLeft') actions.jumpBack();
      else actions.jumpForward();
    } else if (
      !current &&
      e.ctrlKey &&
      !e.shiftKey &&
      !e.altKey &&
      e.key.toLowerCase() === 'a' &&
      !input &&
      !inMenu
    ) {
      // The whole page is not what Ctrl + A means in the library: it ticks what is on screen.
      e.preventDefault();
      actions.selectAll();
    } else if (e.key === 'F1' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
      // The help of Windows. It types nothing, so it works in a field too.
      e.preventDefault();
      if (e.repeat) return;
      if (!$('#popover').hidden) closePopover(true);
      actions.showHelp();
    } else if (
      e.key === '?' &&
      actions.singleKeys() &&
      !input &&
      !inMenu &&
      !e.metaKey &&
      // On some keyboards "?" is typed with AltGr, which the page sees as Ctrl and Alt together.
      (!(e.ctrlKey || e.altKey) || e.getModifierState('AltGraph'))
    ) {
      e.preventDefault();
      if (!e.repeat) actions.showHelp();
    } else if (e.key === 'F11') {
      e.preventDefault();
      $('#fullscreen').click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // A search field with text: Esc empties it first, as the search of the notes does, and the
      // library shows everything again. Only the next Esc goes on to close something else.
      if (e.target === $('#library-search') && actions.clearSearch()) return;
      // One Escape closes one thing: the menu first, then the bar of the selection (and the
      // selection), then the search, then the ticks of the library, and only then the full screen.
      if (!$('#popover').hidden) closePopover(true);
      else if (current && actions.dismissSelection()) return;
      else if (!$('#find-bar').hidden) $('#find-close').click();
      else if (!current && actions.clearSelection()) return;
      else void exitFullscreen().catch(failing('Não foi possível sair da tela cheia.'));
    } else if (current && !input && !inMenu && !e.ctrlKey && !e.altKey) {
      if (e.metaKey) return;
      const nativeControl = (e.target as HTMLElement).closest('button,a,[role="button"]');
      // Shift + arrows, with the focus on the pages, select text by the word (← →) or by the line
      // (↑ ↓), in the scroll and in the Kindle. The turns of the Kindle and the page turns stay with
      // the arrows alone; with the focus elsewhere (a button, the page itself) nothing changes.
      if (
        e.shiftKey &&
        reader &&
        isSelectionKey(e.key) &&
        $('#viewer-container').contains(e.target as Node)
      ) {
        e.preventDefault();
        if (reader.extendSelection(e.key) === 'none') toast(NO_TEXT_NOTE);
        return;
      }
      if (
        reader?.kindle &&
        [
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
          'PageUp',
          'PageDown',
          ' ',
          'Home',
          'End',
        ].includes(e.key) &&
        !(e.key === ' ' && nativeControl)
      ) {
        e.preventDefault();
        if (e.repeat) return;
        if (e.key === 'Home' || e.key === 'End') reader.boundary(e.key === 'End');
        else
          reader.turn(
            ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key) || (e.key === ' ' && e.shiftKey)
              ? -1
              : 1,
          );
      } else {
        // The keys of one letter. With the option off they do nothing, and are not taken from the page.
        if (actions.singleKeys()) {
          // A key held down repeats, and each of these switches or turns something: they act once,
          // at the press.
          const key = e.key.toLowerCase();
          if (key === 'k' && !e.repeat) $('#kindle-toggle').click();
          if (key === 'l' && !e.repeat) {
            if (reader?.kindle) toast(SPREAD_KINDLE_NOTE);
            else $('#spread-toggle').click();
          }
          if (key === 's' && !e.repeat) $('#sidebar-toggle').click();
          if (key === 'd' && !e.repeat) actions.cyclePaper();
          if (key === 'r' && !e.repeat) actions.rotate();
          // H and N act on the passage that is selected: highlight it, or write a note on it. With
          // none selected they say how to select one.
          if (key === 'h' && !e.repeat && !actions.highlightSelection()) toast(SELECT_PASSAGE_NOTE);
          if (key === 'n' && !e.repeat && !actions.annotateSelection()) toast(SELECT_PASSAGE_NOTE);
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const direction = e.key === 'ArrowLeft' ? -1 : 1;
          // With the document wider than the window (a high zoom) the arrows are the way to see
          // the sides; they turn the page only when there is nothing to scroll to.
          const view = $('#viewer-container');
          if (view.scrollWidth - view.clientWidth > 1)
            view.scrollBy({ left: direction * Math.max(40, view.clientWidth * 0.1) });
          else reader?.turn(direction);
        }
      }
    }
  });
}
