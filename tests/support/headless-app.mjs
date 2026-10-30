import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

// This harness never launches Tauri, contacts an installed WebView, or reads a
// personal catalog. The native boundary is simulated; PDF.js and UI code are real.
// By default the library has the six-page fixture. A test can pass its own PDF (bytes) and
// its page count to read a different document, such as a long one with a nested outline.
// `books` is how many documents the library starts with (one, by default): the first is the one
// above, and the others (artificial-extra-2, 3, ...) share its PDF, so that the grid can be filled.
export async function headlessApp({
  pdf: custom,
  pages = 6,
  title = 'Capítulos de teste',
  books = 1,
} = {}) {
  const dist = path.resolve('dist');
  const pdf = custom ?? (await readFile('tests/fixtures/Capitulos.pdf'));
  const hash = createHash('sha256').update(pdf).digest('hex');
  const profile = path.resolve('test-results/reader-chrome', `profile-${Date.now()}`);
  await mkdir(profile, { recursive: true });
  const mime = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
  };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/test.pdf') {
        const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
        const start = range ? Number(range[1]) : 0;
        const end = range ? Math.min(pdf.length - 1, Number(range[2])) : pdf.length - 1;
        res.writeHead(range ? 206 : 200, {
          'Content-Type': 'application/pdf',
          'Content-Length': end - start + 1,
          'Accept-Ranges': 'bytes',
          ...(range ? { 'Content-Range': `bytes ${start}-${end}/${pdf.length}` } : {}),
        });
        res.end(pdf.subarray(start, end + 1));
        return;
      }
      const file = path.resolve(
        dist,
        '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname),
      );
      if (!file.startsWith(dist + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      });
      res.end(data);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  let context;
  const errors = [],
    external = [];
  const open = async () => {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      ...(process.env.FOLIO_BROWSER_CHANNEL ? { channel: process.env.FOLIO_BROWSER_CHANNEL } : {}),
      viewport: { width: 1280, height: 820 },
      deviceScaleFactor: 1,
    });
    await context.route('**/*', (route) => {
      if (
        route
          .request()
          .url()
          .startsWith(url + '/')
      )
        return route.continue();
      external.push(route.request().url());
      return route.abort();
    });
    await context.addInitScript(
      ({ size, hash, pages, title, books }) => {
        let id = 0,
          fullscreen = false;
        const callbacks = new Map(),
          listeners = new Map();
        const key = 'folio.test.library';
        const book = (extra) => ({
          id: extra ? `artificial-extra-${extra}` : 'artificial-chapters',
          title: extra ? `Livro extra ${extra}` : title,
          originalName: 'Capitulos.pdf',
          hash: extra ? extra.toString(16).padStart(2, '0') + hash.slice(2) : hash,
          size,
          added: 1,
          lastOpened: extra ? 0 : 1,
          page: 1,
          pages,
          top: null,
          left: null,
          zoom: '1',
          rotation: 0,
          favorite: false,
          finished: false,
          bookmarks: [],
          notes: [],
          tags: [],
          cover: !extra,
        });
        const initial = {
          books: Array.from({ length: books }, (_, i) => book(i === 0 ? 0 : i + 1)),
          trash: [],
          archived: [],
          folder: 'isolated-test-data',
          warning: null,
        };
        const snapshot = () => {
          const data = JSON.parse(localStorage.getItem(key) || JSON.stringify(initial));
          data.archived ||= [];
          return data;
        };
        const emit = (name) => {
          for (const [eventId, listener] of listeners)
            if (listener.event === name)
              callbacks.get(listener.handler)?.({
                event: name,
                id: eventId,
                payload: { width: innerWidth, height: innerHeight },
              });
        };
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
          unregisterListener: (_name, eventId) => listeners.delete(eventId),
        };
        window.__TAURI_INTERNALS__ = {
          metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
          transformCallback(fn) {
            callbacks.set(++id, fn);
            return id;
          },
          unregisterCallback(callback) {
            callbacks.delete(callback);
          },
          convertFileSrc() {
            return location.origin + '/test.pdf';
          },
          async invoke(command, args = {}) {
            if (command === 'library_list') {
              const data = snapshot();
              if (args.historyDay) {
                for (const book of [...data.books, ...data.trash])
                  if (!Object.keys(book.goalHistory || {}).length)
                    book.goalHistory = {
                      [args.historyDay]: book.readingGoal || {
                        mode: 'inherit',
                        unit: 'pages',
                        target: 10,
                      },
                    };
                localStorage.setItem(key, JSON.stringify(data));
              }
              return data;
            }
            if (command === 'pdf_path') return 'artificial.pdf';
            // The PDFs the app was launched with: none, in the simulated one.
            if (command === 'take_pending_files') return [];
            if (command === 'remove_book' || command === 'restore_book') {
              const data = snapshot(),
                [from, to] =
                  command === 'remove_book' ? [data.books, data.trash] : [data.trash, data.books];
              const at = from.findIndex((b) => b.id === args.id);
              if (at >= 0) to.unshift(...from.splice(at, 1));
              localStorage.setItem(key, JSON.stringify(data));
              return;
            }
            // The batch commands change the stored library once, or not at all, like the native ones.
            if (command === 'remove_books' || command === 'restore_books') {
              const data = snapshot(),
                [from, to] =
                  command === 'remove_books' ? [data.books, data.trash] : [data.trash, data.books];
              const ids = [...new Set(args.ids)];
              if (ids.some((id) => !from.some((b) => b.id === id))) throw 'PDF não encontrado';
              for (const id of ids)
                to.unshift(
                  ...from.splice(
                    from.findIndex((b) => b.id === id),
                    1,
                  ),
                );
              localStorage.setItem(key, JSON.stringify(data));
              return;
            }
            if (command === 'update_books') {
              const data = snapshot();
              const changed = new Map();
              for (const { id, patch } of args.updates) {
                const book = data.books.find((b) => b.id === id);
                if (!book) throw 'PDF não encontrado';
                const { goalDay, tags, ...rest } = patch;
                Object.assign(book, rest);
                if (tags) {
                  const seen = new Set(),
                    clean = [];
                  for (const tag of tags) {
                    const text = String(tag).replace(/\s+/g, ' ').trim();
                    const key = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
                    if (text && !seen.has(key)) {
                      seen.add(key);
                      clean.push(text);
                    }
                  }
                  if (clean.length > 20 || clean.some((tag) => [...tag].length > 40))
                    throw 'Use no máximo 20 etiquetas por documento.';
                  book.tags = clean;
                }
                if (patch.readingGoal && goalDay)
                  book.goalHistory = { ...book.goalHistory, [goalDay]: patch.readingGoal };
                changed.set(id, book);
              }
              localStorage.setItem(key, JSON.stringify(data));
              return data.books.filter((b) => changed.has(b.id));
            }
            // Deleting for good: the books leave Removidos, and only their reading history stays.
            if (command === 'purge_books') {
              const data = snapshot();
              const ids = [...new Set(args.ids)];
              if (ids.some((id) => !data.trash.some((b) => b.id === id)))
                throw 'PDF não encontrado';
              let freed = 0;
              for (const id of ids) {
                const [book] = data.trash.splice(
                  data.trash.findIndex((b) => b.id === id),
                  1,
                );
                freed += book.size;
                data.archived = data.archived.filter((a) => a.id !== id);
                data.archived.push({
                  id,
                  title: book.title,
                  author: book.author || '',
                  readingDays: book.readingDays || {},
                  goalHistory: book.goalHistory || {},
                });
              }
              localStorage.setItem(key, JSON.stringify(data));
              return { purged: ids.length, freed, failed: [] };
            }
            if (command === 'update_book') {
              const data = snapshot(),
                book = data.books.find((b) => b.id === args.id);
              const { goalDay, ...patch } = args.patch;
              Object.assign(book, patch);
              if (patch.readingGoal && goalDay)
                book.goalHistory = { ...book.goalHistory, [goalDay]: patch.readingGoal };
              localStorage.setItem(key, JSON.stringify(data));
              return book;
            }
            // The notes are exported by the backend, from the catalog. Here only what it was asked is
            // kept (`folio.test.exports`), with the refusals it makes: no such document, nothing to
            // export, and a destination that is not a Markdown file.
            if (command === 'export_notes') {
              const book = snapshot().books.find((b) => b.id === args.id);
              if (!book) throw 'PDF não encontrado';
              if (!book.notes?.length) throw 'Este documento ainda não tem notas para exportar.';
              if (!/\.md$/i.test(String(args.destination)))
                throw 'Escolha um arquivo com a extensão .md.';
              const exported = JSON.parse(localStorage.getItem('folio.test.exports') || '[]');
              exported.push({
                id: args.id,
                destination: args.destination,
                offsetMinutes: args.offsetMinutes ?? null,
                notes: book.notes.length,
              });
              localStorage.setItem('folio.test.exports', JSON.stringify(exported));
              return;
            }
            // The save dialog: the path that a test put in `folio.test.save-path`, or none, which
            // is a dialog that was cancelled.
            if (command === 'plugin:dialog|save')
              return localStorage.getItem('folio.test.save-path');
            if (command === 'plugin:event|listen') {
              listeners.set(++id, args);
              return id;
            }
            if (command === 'plugin:event|unlisten' || command === 'plugin:window|set_title')
              return;
            if (command === 'plugin:window|is_fullscreen') return fullscreen;
            if (command === 'plugin:window|set_fullscreen') {
              fullscreen = args.value;
              emit('tauri://resize');
              return;
            }
            throw new Error(`Unexpected simulated native call: ${command}`);
          },
        };
      },
      { size: pdf.length, hash, pages, title, books },
    );
    const page = context.pages()[0];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.waitForSelector('[data-open="artificial-chapters"]');
    return page;
  };
  return {
    open,
    errors,
    external,
    closeBrowser: () => context?.close(),
    async close() {
      await context?.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
