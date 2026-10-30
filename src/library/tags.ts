import type { Book } from '../types';

// The same limits as the catalog (`normalize_tags`, in library.rs), so that a tag the window
// accepts is never refused when it is saved.
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;

// Two spellings are the same tag when they differ only in case or accents ("Ficção" = "ficcao").
// This is also what a tag filter is named by.
export const tagKey = (tag: string) => tag.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
// What the reader typed, as it is kept: spaces trimmed, and a run of them made one.
export const cleanTag = (tag: string) => tag.replace(/\s+/g, ' ').trim();
// A book from before tags, or one a test made by hand, has none.
export const tagsOf = (book: Pick<Book, 'tags'>): string[] =>
  Array.isArray(book.tags) ? book.tags : [];
export const hasTag = (book: Pick<Book, 'tags'>, key: string) =>
  tagsOf(book).some((tag) => tagKey(tag) === key);

// The tags as the catalog keeps them: trimmed, no empty ones, no repeats (the first spelling
// stays).
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = cleanTag(String(raw));
    if (tag && !seen.has(tagKey(tag))) {
      seen.add(tagKey(tag));
      out.push(tag);
    }
  }
  return out;
}

export type TagProblem = 'empty' | 'long' | 'duplicate' | 'full';
// One tag added to a list. When it cannot be, `problem` says why and the list is the same.
export function addTag(
  tags: readonly string[],
  input: string,
): { tags: string[]; problem?: TagProblem } {
  const tag = cleanTag(input);
  if (!tag) return { tags: [...tags], problem: 'empty' };
  if ([...tag].length > MAX_TAG_LENGTH) return { tags: [...tags], problem: 'long' };
  if (tags.some((t) => tagKey(t) === tagKey(tag))) return { tags: [...tags], problem: 'duplicate' };
  if (tags.length >= MAX_TAGS) return { tags: [...tags], problem: 'full' };
  return { tags: [...tags, tag] };
}
export const removeTag = (tags: readonly string[], key: string) =>
  tags.filter((tag) => tagKey(tag) !== key);
// What `addTag` could not do, in a sentence for the dialog.
export const tagProblemText: Record<TagProblem, string> = {
  empty: 'Digite uma etiqueta.',
  long: `Use até ${MAX_TAG_LENGTH} caracteres em cada etiqueta.`,
  duplicate: 'Essa etiqueta já está na lista.',
  full: `Cada documento aceita até ${MAX_TAGS} etiquetas.`,
};

export interface TagCount {
  key: string;
  // How the tag is written: the spelling most books use, the first alphabetically on a tie.
  label: string;
  count: number;
}
// Every tag of a set of books, once each, with the number of books that have it, in alphabetical
// order.
export function tagCounts(books: readonly Pick<Book, 'tags'>[]): TagCount[] {
  const byKey = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const book of books)
    for (const tag of normalizeTags(tagsOf(book))) {
      const entry = byKey.get(tagKey(tag)) ?? { count: 0, spellings: new Map() };
      entry.count++;
      entry.spellings.set(tag, (entry.spellings.get(tag) ?? 0) + 1);
      byKey.set(tagKey(tag), entry);
    }
  return [...byKey]
    .map(([key, { count, spellings }]) => ({
      key,
      count,
      label: [...spellings].sort(([a, x], [b, y]) => y - x || a.localeCompare(b, 'pt-BR'))[0][0],
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}
// The tags already in use that are worth offering while one is typed: those not yet in the list
// and, when something is typed, those that contain it. The most used come first.
export function suggestTags(
  known: readonly TagCount[],
  draft: readonly string[],
  typed = '',
  limit = 12,
): TagCount[] {
  const taken = new Set(draft.map(tagKey));
  const part = tagKey(cleanTag(typed));
  return known
    .filter((tag) => !taken.has(tag.key) && tag.key.includes(part))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'))
    .slice(0, limit);
}

// The tag filter of the library is a filter named "tag:" and the key of the tag.
export const TAG_FILTER = 'tag:';
export const tagFilter = (key: string) => `${TAG_FILTER}${key}`;
export const filterTag = (filter: string) =>
  filter.startsWith(TAG_FILTER) ? filter.slice(TAG_FILTER.length) : null;
