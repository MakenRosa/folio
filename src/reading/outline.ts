// The PDF outline (sumário) with every destination resolved to a page number. The
// chapter starts and the side bar share this one resolution.
export interface OutlineEntry {
  title: string;
  // Null when the destination is external, broken or points outside the document.
  page: number | null;
  // What PDF.js needs to navigate; kept as it came from the document.
  dest: unknown;
  items: OutlineEntry[];
}

// The part of PDFDocumentProxy that the resolution needs.
export interface OutlineSource {
  numPages: number;
  getDestination(id: string): Promise<unknown>;
  getPageIndex(ref: any): Promise<number>;
}

// The 1-based page of a destination: an explicit array, or a name to look up. A broken
// or external destination is not an error; it just has no page.
export async function destinationPage(source: OutlineSource, dest: unknown) {
  try {
    const target = typeof dest === 'string' ? await source.getDestination(dest) : dest;
    if (!Array.isArray(target)) return null;
    const first = target[0];
    const index =
      typeof first === 'object' && first !== null ? await source.getPageIndex(first) : first;
    return Number.isInteger(index) && index >= 0 && index < source.numPages
      ? (index as number) + 1
      : null;
  } catch {
    return null;
  }
}

// Resolves the whole tree at once. Each destination is looked up one time.
export async function resolveOutline(source: OutlineSource, raw: unknown): Promise<OutlineEntry[]> {
  const visit = (items: unknown): Promise<OutlineEntry[]> =>
    Promise.all(
      (Array.isArray(items) ? items : []).map(async (item: any) => ({
        title: typeof item?.title === 'string' ? item.title : '',
        dest: item?.dest ?? null,
        page: await destinationPage(source, item?.dest),
        items: await visit(item?.items),
      })),
    );
  return visit(raw);
}

// A row of the tree in reading order. `id` is the path of indexes, such as "2.0.1".
export interface OutlineRow {
  id: string;
  entry: OutlineEntry;
  depth: number;
  // From the top level down to the parent.
  ancestors: string[];
  children: string[];
}

export function flattenOutline(entries: readonly OutlineEntry[]): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const visit = (items: readonly OutlineEntry[], prefix: string, ancestors: string[]) => {
    items.forEach((entry, index) => {
      const id = prefix ? `${prefix}.${index}` : String(index);
      const row: OutlineRow = { id, entry, depth: ancestors.length, ancestors, children: [] };
      rows.push(row);
      visit(entry.items, id, [...ancestors, id]);
      row.children = entry.items.map((_, i) => `${id}.${i}`);
    });
  };
  visit(entries, '', []);
  return rows;
}

// The section being read: the last item that starts on or before the page. In reading
// order a deeper item comes after its parent, so a subsection beats its chapter, and the
// next chapter beats the subsections of the previous one. Items without a page never
// match, and an outline out of order still gives the nearest start.
export function currentSection(rows: readonly OutlineRow[], page: number): string | null {
  let best: OutlineRow | null = null;
  for (const row of rows) {
    const start = row.entry.page;
    if (start === null || start > page) continue;
    if (!best || start >= best.entry.page!) best = row;
  }
  return best ? best.id : null;
}

// How the user folded the tree by hand: true opens a branch and false closes it. What
// is not here follows the default, which opens only the branches that hold the section.
export type Folds = ReadonlyMap<string, boolean>;

function pathTo(rows: readonly OutlineRow[], id: string | null): string[] {
  const row = id === null ? undefined : rows.find((r) => r.id === id);
  return row ? row.ancestors : [];
}

// The branches that show their children now.
export function expandedBranches(
  rows: readonly OutlineRow[],
  folds: Folds,
  current: string | null,
): Set<string> {
  const automatic = new Set(pathTo(rows, current));
  const open = new Set<string>();
  for (const row of rows)
    if (row.children.length && (folds.get(row.id) ?? automatic.has(row.id))) open.add(row.id);
  return open;
}

// Opens a closed branch or closes an open one.
export function toggleBranch(
  rows: readonly OutlineRow[],
  folds: Folds,
  id: string,
  current: string | null,
): Folds {
  const next = new Map(folds);
  next.set(id, !expandedBranches(rows, folds, current).has(id));
  return next;
}

// Moving into a section shows it: the branches that hold it forget a manual close.
export function revealSection(
  rows: readonly OutlineRow[],
  folds: Folds,
  current: string | null,
): Folds {
  const next = new Map(folds);
  for (const id of pathTo(rows, current)) next.delete(id);
  return next;
}

// The rows that can be seen: every branch above them is open.
export function visibleRows(rows: readonly OutlineRow[], open: ReadonlySet<string>): OutlineRow[] {
  return rows.filter((row) => row.ancestors.every((id) => open.has(id)));
}
