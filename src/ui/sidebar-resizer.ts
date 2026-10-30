import { clampSidebarWidth, widthAfterKey } from '../reading/sidebar';

type Resizer = {
  // The width the bar has now, after the window's own limit.
  width: () => number;
  // Shows a width while it is being chosen. Nothing is saved yet.
  preview: (width: number) => void;
  // The width was chosen: the handle was released or the key was let go.
  commit: (width: number) => void;
};

// The drag handle on the bar's edge. A drag or a key press only previews the width;
// the preference is written once, when the handle is released, not at every movement.
export function bindSidebarResizer(handle: HTMLElement, actions: Resizer) {
  let drag: { x: number; width: number; pointer: number } | null = null;
  let chosen: number | null = null;
  const choose = (width: number) => {
    chosen = clampSidebarWidth(width, innerWidth);
    actions.preview(chosen);
  };
  const commit = () => {
    const width = chosen;
    chosen = null;
    if (width !== null) actions.commit(width);
  };
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag = { x: event.clientX, width: actions.width(), pointer: event.pointerId };
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (event) => {
    if (drag && event.pointerId === drag.pointer) choose(drag.width + event.clientX - drag.x);
  });
  const release = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag = null;
    handle.classList.remove('dragging');
    commit();
  };
  handle.addEventListener('pointerup', release);
  handle.addEventListener('pointercancel', release);
  handle.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const width = widthAfterKey(actions.width(), event.key, innerWidth, event.shiftKey);
    // The reader's arrow keys must not turn the page while the bar is being resized.
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (width !== null) choose(width);
  });
  handle.addEventListener('keyup', commit);
  handle.addEventListener('blur', commit);
}
