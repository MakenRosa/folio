import type { SidebarTab } from '../types';

// The tabs of the reader's side bar, in order.
export const SIDEBAR_TABS: readonly SidebarTab[] = ['outline', 'pages', 'bookmarks', 'notes'];

// The width is in CSS pixels. The window caps it, so that the PDF always keeps most
// of the screen: at the smallest window (800 px) the bar is at most 320 px wide.
export const SIDEBAR_WIDTH = Object.freeze({
  min: 220,
  max: 480,
  fallback: 260,
  step: 16,
  share: 0.4,
});

// The widest the bar can be in a window of this width.
export function sidebarMax(windowWidth: number): number {
  if (!Number.isFinite(windowWidth) || windowWidth <= 0) return SIDEBAR_WIDTH.max;
  return Math.max(
    SIDEBAR_WIDTH.min,
    Math.min(SIDEBAR_WIDTH.max, Math.floor(windowWidth * SIDEBAR_WIDTH.share)),
  );
}

// Without a window width, only the fixed limits apply (what is saved in the preferences).
export function clampSidebarWidth(width: number, windowWidth?: number): number {
  const max = windowWidth === undefined ? SIDEBAR_WIDTH.max : sidebarMax(windowWidth);
  const value = Number.isFinite(width) ? Math.round(width) : SIDEBAR_WIDTH.fallback;
  return Math.min(max, Math.max(SIDEBAR_WIDTH.min, value));
}

// The width after a key on the drag handle, or null when the key does nothing.
// The bar is on the left, so the right arrow widens it.
export function widthAfterKey(
  width: number,
  key: string,
  windowWidth: number,
  large = false,
): number | null {
  const step = SIDEBAR_WIDTH.step * (large ? 3 : 1);
  switch (key) {
    case 'ArrowRight':
      return clampSidebarWidth(width + step, windowWidth);
    case 'ArrowLeft':
      return clampSidebarWidth(width - step, windowWidth);
    case 'Home':
      return SIDEBAR_WIDTH.min;
    case 'End':
      return sidebarMax(windowWidth);
    default:
      return null;
  }
}

// The tab that an arrow key moves to; the tabs wrap around. Null for other keys.
export function tabAfterKey(tab: SidebarTab, key: string): SidebarTab | null {
  const at = Math.max(0, SIDEBAR_TABS.indexOf(tab)),
    last = SIDEBAR_TABS.length - 1;
  if (key === 'ArrowRight') return SIDEBAR_TABS[at === last ? 0 : at + 1];
  if (key === 'ArrowLeft') return SIDEBAR_TABS[at === 0 ? last : at - 1];
  if (key === 'Home') return SIDEBAR_TABS[0];
  if (key === 'End') return SIDEBAR_TABS[last];
  return null;
}
