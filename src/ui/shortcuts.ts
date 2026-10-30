import type { Reader } from '../reader';
import { $ } from './dom';
import { closePopover, fail, toast } from './overlays';
export const SPREAD_KINDLE_NOTE = 'Duas páginas só na rolagem. Saia do modo Kindle para usar.';
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
      if (current) void closeReader();
      else $('#library-search').focus();
    } else if (current && e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      showFind();
    } else if (current && e.ctrlKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      void toggleBookmark().catch(fail);
    } else if (current && e.ctrlKey && ['+', '=', '-'].includes(e.key)) {
      e.preventDefault();
      reader?.stepZoom(e.key === '-' ? -1 : 1);
    } else if (current && e.ctrlKey && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      void closeReader().catch(fail);
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
    } else if (e.key === 'F11') {
      e.preventDefault();
      $('#fullscreen').click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // One Escape closes one thing: the menu first, then the bar of the selection (and the
      // selection), then the search, then the ticks of the library, and only then the full screen.
      if (!$('#popover').hidden) closePopover(true);
      else if (current && actions.dismissSelection()) return;
      else if (!$('#find-bar').hidden) $('#find-close').click();
      else if (!current && actions.clearSelection()) return;
      else void exitFullscreen().catch(fail);
    } else if (current && !input && !inMenu && !e.ctrlKey && !e.altKey) {
      if (e.metaKey) return;
      const nativeControl = (e.target as HTMLElement).closest('button,a,[role="button"]');
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
        if (e.key.toLowerCase() === 'k') $('#kindle-toggle').click();
        if (e.key.toLowerCase() === 'l') {
          if (reader?.kindle) toast(SPREAD_KINDLE_NOTE);
          else $('#spread-toggle').click();
        }
        if (e.key.toLowerCase() === 's' && !e.repeat) $('#sidebar-toggle').click();
        if (e.key.toLowerCase() === 'd') $('#paper-toggle').click();
        if (e.key.toLowerCase() === 'r') $('#rotate').click();
        // H and N act on the passage that is selected: highlight it, or write a note on it.
        if (e.key.toLowerCase() === 'h' && !e.repeat) actions.highlightSelection();
        if (e.key.toLowerCase() === 'n' && !e.repeat) actions.annotateSelection();
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          reader?.turn(e.key === 'ArrowLeft' ? -1 : 1);
        }
      }
    }
  });
}
