import { icon } from '../icons';
import { esc } from './dom';
import {
  currentSection,
  expandedBranches,
  flattenOutline,
  revealSection,
  toggleBranch,
  type Folds,
  type OutlineEntry,
  type OutlineRow,
} from '../reading/outline';

// How the tree is folded, kept by the caller so that it survives a change of tab.
export type OutlineState = { folds: Folds };

// The outline as a tree of buttons. The section being read is marked and brought into
// view without moving the focus; branches fold with a button or the arrow keys.
export class OutlineView {
  private rows: OutlineRow[];
  private items = new Map<string, HTMLButtonElement>();
  private toggles = new Map<string, HTMLButtonElement>();
  private groups = new Map<string, HTMLElement>();
  private current: string | null = null;
  private root: HTMLElement;

  constructor(
    host: HTMLElement,
    entries: readonly OutlineEntry[],
    private state: OutlineState,
    private go: (entry: OutlineEntry) => void,
  ) {
    this.rows = flattenOutline(entries);
    const byId = new Map(this.rows.map((row) => [row.id, row]));
    const render = (id: string): string => {
      const row = byId.get(id)!,
        entry = row.entry,
        title = entry.title.trim() || 'Seção';
      return `<li data-id="${id}"><div class="outline-line" style="padding-left:${6 + row.depth * 14}px">${
        row.children.length
          ? `<button class="outline-toggle" data-toggle="${id}" aria-expanded="false" aria-controls="outline-group-${id}" aria-label="Subseções de ${esc(title)}" title="Mostrar ou esconder as subseções">${icon('right')}</button>`
          : '<span class="outline-spacer" aria-hidden="true"></span>'
      }<button class="outline-item" data-item="${id}">${esc(title)}</button></div>${
        row.children.length
          ? `<ul id="outline-group-${id}" data-group="${id}" hidden>${row.children.map(render).join('')}</ul>`
          : ''
      }</li>`;
    };
    const top = this.rows.filter((row) => row.depth === 0).map((row) => row.id);
    host.innerHTML = `<ul class="outline-tree" aria-label="Sumário">${top.map(render).join('')}</ul>`;
    this.root = host.querySelector<HTMLElement>('.outline-tree')!;
    this.root
      .querySelectorAll<HTMLButtonElement>('[data-item]')
      .forEach((button) => this.items.set(button.dataset.item!, button));
    this.root
      .querySelectorAll<HTMLButtonElement>('[data-toggle]')
      .forEach((button) => this.toggles.set(button.dataset.toggle!, button));
    this.root
      .querySelectorAll<HTMLElement>('[data-group]')
      .forEach((group) => this.groups.set(group.dataset.group!, group));
    this.root.addEventListener('click', (event) => this.click(event));
    this.root.addEventListener('keydown', (event) => this.key(event));
  }

  // Marks the section that holds the page. A new section opens the branches above it and
  // scrolls into view; the same section leaves the list where the user put it.
  show(page: number) {
    const id = currentSection(this.rows, page);
    const changed = id !== this.current;
    if (changed) this.state.folds = revealSection(this.rows, this.state.folds, id);
    this.current = id;
    this.paint();
    if (changed && id) this.items.get(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private paint() {
    const open = expandedBranches(this.rows, this.state.folds, this.current);
    for (const [id, group] of this.groups) {
      group.hidden = !open.has(id);
      this.toggles.get(id)?.setAttribute('aria-expanded', String(open.has(id)));
    }
    for (const [id, button] of this.items) {
      if (id === this.current) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
  }

  private click(event: Event) {
    const target = event.target as HTMLElement;
    const toggle = target.closest<HTMLElement>('[data-toggle]');
    if (toggle) {
      this.fold(toggle.dataset.toggle!);
      return;
    }
    const item = target.closest<HTMLElement>('[data-item]');
    const row = item && this.rows.find((r) => r.id === item.dataset.item);
    if (row) this.go(row.entry);
  }

  private fold(id: string) {
    this.state.folds = toggleBranch(this.rows, this.state.folds, id, this.current);
    this.paint();
  }

  // Up and down walk the visible items; right opens a branch or goes into it, and left
  // closes it or goes to its parent. The reader's own arrow keys do not run here.
  private key(event: KeyboardEvent) {
    // The toggle of a row answers to the same keys as the row's item.
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      '.outline-item, .outline-toggle',
    );
    if (!target || event.altKey || event.ctrlKey || event.metaKey) return;
    const id = (target.dataset.item ?? target.dataset.toggle)!,
      row = this.rows.find((r) => r.id === id)!,
      item = this.items.get(id)!;
    const visible = [...this.items.values()].filter((button) => !button.closest('[hidden]'));
    const at = visible.indexOf(item);
    const open = expandedBranches(this.rows, this.state.folds, this.current);
    let focus: HTMLButtonElement | undefined;
    switch (event.key) {
      case 'ArrowDown':
        focus = visible[Math.min(visible.length - 1, at + 1)];
        break;
      case 'ArrowUp':
        focus = visible[Math.max(0, at - 1)];
        break;
      case 'Home':
        focus = visible[0];
        break;
      case 'End':
        focus = visible[visible.length - 1];
        break;
      case 'ArrowRight':
        if (row.children.length && !open.has(id)) this.fold(id);
        else if (row.children.length) focus = this.items.get(row.children[0]);
        break;
      case 'ArrowLeft':
        if (row.children.length && open.has(id)) this.fold(id);
        else if (row.ancestors.length) focus = this.items.get(row.ancestors.at(-1)!);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    focus?.focus();
  }

  dispose() {
    this.root.remove();
    this.items.clear();
    this.toggles.clear();
    this.groups.clear();
  }
}
