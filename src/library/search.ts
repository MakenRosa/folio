import type { Book } from '../types';
import { tagsOf } from './tags.ts';

// Where a book was found. `notes` means that its title, author, file name and tags do not have
// the text, and only its notes do (the text of a note, or the passage it quotes).
export type SearchHit = 'book' | 'notes';

export function searchBook(book: Book, query: string): SearchHit | null {
  const wanted = query.toLocaleLowerCase();
  if (!wanted) return 'book';
  const own = `${book.title} ${book.author ?? ''} ${book.originalName} ${tagsOf(book).join(' ')}`;
  if (own.toLocaleLowerCase().includes(wanted)) return 'book';
  const inNotes = (book.notes ?? []).some(
    (note) =>
      (note.text ?? '').toLocaleLowerCase().includes(wanted) ||
      (note.quote ?? '').toLocaleLowerCase().includes(wanted),
  );
  return inNotes ? 'notes' : null;
}
