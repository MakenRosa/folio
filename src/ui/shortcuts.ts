import type { Reader } from '../reader';
import { $ } from './dom';
import { closePopover, fail } from './overlays';
type ShortcutActions = {
  isReading: () => boolean;
  getReader: () => Reader | null;
  importFiles: () => Promise<void>;
  closeReader: () => Promise<void>;
  toggleBookmark: () => Promise<void>;
  toggleFocus: () => void;
  showFind: () => void;
};
export function bindShortcuts(actions: ShortcutActions) {
  const { importFiles, closeReader, toggleBookmark, toggleFocus, showFind } = actions;
  document.addEventListener('keydown', (e) => {
    const current = actions.isReading(),
      reader = actions.getReader();
    if ($<HTMLDialogElement>('#dialog').open) return;
    const input = (e.target as HTMLElement).matches('input,textarea,select,[contenteditable]');
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
    } else if (current && e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      void closeReader().catch(fail);
    } else if (current && e.key === 'F8') {
      e.preventDefault();
      toggleFocus();
    } else if (e.key === 'F11') {
      e.preventDefault();
      $('#fullscreen').click();
    } else if (e.key === 'Escape') {
      closePopover();
      if (document.body.classList.contains('focus-mode')) toggleFocus();
      else if (!$('#find-bar').hidden) $('#find-close').click();
    } else if (current && !input && !e.ctrlKey && !e.altKey) {
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
        if (e.key.toLowerCase() === 'd') $('#paper-toggle').click();
        if (e.key.toLowerCase() === 'r') $('#rotate').click();
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          reader?.turn(e.key === 'ArrowLeft' ? -1 : 1);
        }
      }
    }
  });
}
