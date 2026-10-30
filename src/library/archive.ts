import type { ArchivedBook, Book } from '../types';

// The reading history takes documents, not records. What a deleted document keeps (its days and
// the goals it had) is put in the shape of a book with nothing else in it, so that its days go on
// being counted where the days of the others are.
export function archivedAsBook(record: ArchivedBook): Book {
  return {
    id: record.id,
    title: record.title,
    author: record.author ?? '',
    originalName: '',
    hash: '',
    size: 0,
    added: 0,
    lastOpened: 0,
    page: 1,
    pages: 0,
    top: null,
    left: null,
    zoom: 'page-width',
    rotation: 0,
    favorite: false,
    finished: false,
    bookmarks: [],
    notes: [],
    cover: false,
    tags: [],
    readingDays: record.readingDays ?? {},
    goalHistory: record.goalHistory ?? {},
  };
}
