import { asset, invoke } from '../bridge';
import type { Book } from '../types';
import { metadataPatch } from './metadata';

// What the job needs from the rest of the app.
export type EnrichHost = {
  // The book as the library has it now; `undefined` once it was removed.
  find: (id: string) => Book | undefined;
  // A book was saved with something new (cover, page count, author or title).
  changed: (book: Book) => void;
};

// What PDF.js is working on, or a rejection as soon as `signal` is aborted. A paused queue aborts
// the reading of the file, and PDF.js would wait forever for a part that it was never given.
function until<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(signal.reason);
    if (signal.aborted) return stop();
    signal.addEventListener('abort', stop, { once: true });
    void work.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

// Gives a book what the import left out: the cover, the page count, the author and the title of
// the PDF. It opens the copy kept in the library, one document at a time, and frees it before
// returning, whatever happens. Rejects when the PDF cannot be opened (a password, a broken file)
// or when `signal` is aborted before anything is saved; the queue treats both in silence.
export async function enrichBook(id: string, signal: AbortSignal, host: EnrichHost) {
  const book = host.find(id);
  if (!book) return;
  // PDF.js is loaded only when there is something to read: a library that is complete never pays.
  const { openPdfSource, renderCover } = await import('../pdf-source');
  signal.throwIfAborted();
  const path = await invoke<string>('pdf_path', { id });
  const source = await openPdfSource(asset(path), book.size, { signal });
  if (!source) throw signal.reason;
  // Whatever happens, the document goes: on a pause it goes at once, which also stops the work.
  const release = () => void source.task.destroy().catch(() => {});
  signal.addEventListener('abort', release, { once: true });
  try {
    const pdf = await until(signal, source.document);
    const meta = await until(
      signal,
      pdf.getMetadata().catch(() => null),
    );
    const info = (meta?.info ?? {}) as { Title?: unknown; Author?: unknown };
    let cover: Uint8Array | null = null;
    if (!book.cover) {
      const page = await until(signal, pdf.getPage(1));
      try {
        cover = await until(signal, renderCover(page));
      } finally {
        try {
          page.cleanup();
        } catch {
          /* The document may already be gone: there is nothing to free. */
        }
      }
    }
    // From here on the job is only two quick writes, and it is let finish.
    signal.throwIfAborted();
    let saved = host.find(id);
    if (!saved) return;
    if (cover) saved = await invoke<Book>('save_cover', { id, bytes: Array.from(cover) });
    const patch = metadataPatch(saved, {
      pages: pdf.numPages,
      title: info.Title,
      author: info.Author,
    });
    if (Object.keys(patch).length) saved = await invoke<Book>('update_book', { id, patch });
    // Without a cover and without a patch there is nothing that changed.
    if (cover || Object.keys(patch).length) host.changed(saved);
  } finally {
    signal.removeEventListener('abort', release);
    // Frees the document, its worker and what it decoded.
    await source.task.destroy().catch(() => {});
  }
}
