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

// What an item that points nowhere says, as its tooltip and when it is pressed.
export const NO_DESTINATION = 'Este item não tem destino neste documento.';

// The outline as a tree of buttons. The section being read is marked and brought into
// view without moving the focus; branches fold with a button or the arrow keys. The tree is one stop
// of Tab (a roving tabindex, as the list of thumbnails): the item that has the focus, or else the
// section being read, or else the first one. The arrows walk the rest.
export class OutlineView {
  private rows: OutlineRow[];
  private items = new Map<string, HTMLButtonElement>();
  private toggles = new Map<string, HTMLButtonElement>();
  private groups = new Map<string, HTMLElement>();
  private current: string | null = null;
  private stop: string | null = null;
  private root: HTMLElement;
  private hint: HTMLElement;

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
      // An item with no page (an external or broken destination) does nothing: it looks unavailable.
      // It stays a button that the keyboard reaches, and pressing it says why.
      const none = entry.page === null;
      return `<li data-id="${id}"><div class="outline-line" style="padding-left:${6 + row.depth * 14}px">${
        row.children.length
          ? `<button class="outline-toggle" data-toggle="${id}" tabindex="-1" aria-expanded="false" aria-controls="outline-group-${id}" aria-label="Subseções de ${esc(title)}" title="Mostrar ou esconder as subseções">${icon('right')}</button>`
          : '<span class="outline-spacer" aria-hidden="true"></span>'
      }<button class="outline-item" data-item="${id}" tabindex="-1"${none ? ` aria-disabled="true" title="${NO_DESTINATION}"` : ''}>${esc(title)}</button></div>${
        row.children.length
          ? `<ul id="outline-group-${id}" data-group="${id}" hidden>${row.children.map(render).join('')}</ul>`
          : ''
      }</li>`;
    };
    const top = this.rows.filter((row) => row.depth === 0).map((row) => row.id);
    host.innerHTML = `<span id="outline-keys" class="sr-only">Tab entra no sumário e sai dele. Use as setas para andar entre os itens, Direita e Esquerda para abrir e fechar as seções, e Enter para ir à seção.</span><ul class="outline-tree" aria-label="Sumário" aria-describedby="outline-keys">${top.map(render).join('')}</ul>`;
    this.hint = host.querySelector<HTMLElement>('#outline-keys')!;
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
    this.setStop(top[0]);
    this.root.addEventListener('click', (event) => this.click(event));
    this.root.addEventListener('keydown', (event) => this.key(event));
    // Whatever puts the focus on a row (an arrow, a click, the drawing that gives it back) makes the
    // item of that row the stop of Tab.
    this.root.addEventListener('focusin', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>(
        '.outline-item, .outline-toggle',
      );
      const id = target && (target.dataset.item ?? target.dataset.toggle);
      if (id) this.setStop(id);
    });
  }

  // Marks the section that holds the page. A new section opens the branches above it and
  // scrolls into view; the same section leaves the list where the user put it.
  show(page: number) {
    const id = currentSection(this.rows, page);
    const changed = id !== this.current;
    if (changed) this.state.folds = revealSection(this.rows, this.state.folds, id);
    this.current = id;
    this.paint();
    // The reader who is not in the list finds Tab on the section being read; one who is keeps theirs.
    if (id && !this.root.contains(document.activeElement) && this.seen(id)) this.setStop(id);
    if (changed && id) this.items.get(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // Only one item is a stop of Tab; the arrow keys move between them.
  private setStop(id: string) {
    const next = this.items.get(id);
    if (!next) return;
    if (this.stop && this.stop !== id) this.items.get(this.stop)?.setAttribute('tabindex', '-1');
    this.stop = id;
    next.setAttribute('tabindex', '0');
  }

  // The stop must be on a row that can be seen: a branch that folds takes its children out of sight,
  // and the stop goes to the branch itself.
  private keepStop() {
    if (this.stop && this.seen(this.stop)) return;
    const row = this.rows.find((r) => r.id === this.stop);
    const parent = row && [...row.ancestors].reverse().find((id) => this.seen(id));
    this.setStop(parent ?? this.rows[0].id);
  }

  // Whether the item of a row is on screen: no branch above it is folded.
  private seen(id: string) {
    return !this.items.get(id)?.closest('[hidden]');
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
    this.keepStop();
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
    this.hint.remove();
    this.root.remove();
    this.items.clear();
    this.toggles.clear();
    this.groups.clear();
  }
}
