import './style.css';
import { icon } from './icons';
import { $, esc, size, ib } from './ui/dom';
import { appShell } from './ui/shell';
import { toast, fail, modal, popover, closePopover } from './ui/overlays';
import { renderLibraryView } from './ui/library-view';
import { showPreferences } from './ui/preferences-dialog';
import { showHelp } from './ui/help-dialog';
import { bindShortcuts } from './ui/shortcuts';
import { invoke, asset } from './bridge';
import { open, save } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import type { Book, Snapshot, Preferences, Note } from './types';
import { loadPreferences, normalizePreferences, savePreferences } from './preferences';

const prefs = loadPreferences(localStorage);
let snapshot: Snapshot = { books: [], trash: [], folder: '', warning: null };
let filter = 'all',
  query = '',
  busy = false,
  current: Book | null = null,
  reader: import('./reader').Reader | null = null,
  sideTab = 'outline';
let loading = false,
  saveTimer: ReturnType<typeof setTimeout> | undefined,
  readingPatch: Partial<Book> = {},
  saveChain = Promise.resolve(),
  resumePosition = false;

$('#app').innerHTML = appShell;
function renderLibrary() {
  renderLibraryView(
    { snapshot, filter, query, prefs },
    { openBook, importFiles, toggleFavorite, bookMenu, restoreBook, applyPrefs },
  );
}
function preferences() {
  showPreferences(prefs, { folder: snapshot.folder, applyPrefs, setReadingMode });
}
function applyPrefs() {
  Object.assign(prefs, normalizePreferences(prefs));
  reader?.setMode(prefs.readingMode);
  $('#kindle-toggle').setAttribute('aria-pressed', String(prefs.readingMode === 'kindle'));
  $('#kindle-toggle').classList.toggle('selected', prefs.readingMode === 'kindle');
  prefs.brightness =
    typeof prefs.brightness === 'number' && Number.isFinite(prefs.brightness)
      ? Math.min(100, Math.max(10, prefs.brightness))
      : 100;
  document.documentElement.dataset.theme =
    prefs.theme === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : prefs.theme;
  document.documentElement.dataset.paper = prefs.paper;
  $('#warm-overlay').style.opacity = String(Math.min(70, Math.max(0, prefs.warm)) / 100);
  $('#brightness-overlay').style.opacity = String((100 - prefs.brightness) / 100);
  savePreferences(localStorage, prefs);
  updateReaderMeta();
  $('#paper-toggle').classList.toggle('selected', prefs.paper === 'dark');
  $('#view-grid').classList.toggle('selected', prefs.view === 'grid');
  $('#view-list').classList.toggle('selected', prefs.view === 'list');
  $('#sort').setAttribute('value', prefs.sort);
}
applyPrefs();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyPrefs);

async function refresh() {
  snapshot = await invoke<Snapshot>('library_list');
  renderLibrary();
  if (snapshot.warning) toast(snapshot.warning);
}

async function patchBook(id: string, patch: Partial<Book>) {
  const b = await invoke<Book>('update_book', { id, patch });
  snapshot.books = snapshot.books.map((x) => (x.id === id ? b : x));
  if (current?.id === id) current = { ...b, ...readingPatch };
  return b;
}
async function toggleFavorite(id: string) {
  try {
    const b = snapshot.books.find((x) => x.id === id)!;
    await patchBook(id, { favorite: !b.favorite });
    renderLibrary();
    updateReaderMeta();
  } catch (e) {
    fail(e);
  }
}
async function restoreBook(id: string) {
  try {
    await invoke('restore_book', { id });
    await refresh();
    toast('Documento restaurado.');
  } catch (e) {
    fail(e);
  }
}
function bookMenu(anchor: HTMLElement, b: Book) {
  popover(
    anchor,
    `<button data-action="open">${icon('book')} Abrir documento</button><button data-action="rename">${icon('edit')} Renomear na biblioteca</button><button data-action="finish">${icon('check')} ${b.finished ? 'Marcar como não concluído' : 'Marcar como concluído'}</button><button data-action="export">${icon('download')} Exportar uma cópia</button><hr><button data-action="remove">${icon('trash')} Remover da biblioteca</button>`,
  );
  $('#popover')
    .querySelectorAll<HTMLElement>('[data-action]')
    .forEach(
      (el) =>
        (el.onclick = async () => {
          closePopover();
          try {
            switch (el.dataset.action) {
              case 'open':
                await openBook(b);
                break;
              case 'rename':
                renameBook(b);
                break;
              case 'finish':
                await patchBook(b.id, { finished: !b.finished });
                renderLibrary();
                updateReaderMeta();
                break;
              case 'export':
                await exportBook(b);
                break;
              case 'remove':
                if (current?.id === b.id) await closeReader();
                await invoke('remove_book', { id: b.id });
                await refresh();
                toast('PDF movido para Removidos.', {
                  label: 'Desfazer',
                  run: () => restoreBook(b.id),
                });
            }
          } catch (e) {
            fail(e);
          }
        }),
    );
}
function renameBook(b: Book) {
  const d = modal(
    `<div class="dialog-heading"><h2>Renomear documento</h2>${ib('close-rename', 'Fechar', 'close', 'data-close')}</div><p>O nome na biblioteca muda. O arquivo original permanece intacto.</p><label class="field-label" for="rename-input">Título</label><input id="rename-input" class="text-field" value="${esc(b.title)}" maxlength="500"><div class="dialog-actions"><button class="secondary" data-close>Cancelar</button><button id="rename-save" class="primary">Salvar título</button></div>`,
  );
  $('#rename-save').onclick = async () => {
    try {
      await patchBook(b.id, { title: $<HTMLInputElement>('#rename-input').value });
      renderLibrary();
      updateReaderMeta();
      d.close();
    } catch (e) {
      fail(e);
    }
  };
}
async function exportBook(b: Book) {
  const destination = await save({
    title: 'Exportar cópia do PDF',
    defaultPath: `${b.title.replace(/[<>:"/\\|?*]/g, '_')}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (destination) {
    await invoke('export_pdf', { id: b.id, destination });
    toast('Cópia exportada.');
  }
}
async function importFiles(paths?: string[]) {
  if (busy) return;
  try {
    if (!paths) {
      const selected = await open({
        title: 'Adicionar PDFs à sua biblioteca',
        multiple: true,
        filters: [{ name: 'Documentos PDF', extensions: ['pdf'] }],
      });
      if (!selected) return;
      paths = Array.isArray(selected) ? selected : [selected];
    }
    if (!paths.length) return;
    busy = true;
    $('#import-main').setAttribute('disabled', '');
    toast(`Copiando ${paths.length} PDF${paths.length === 1 ? '' : 's'}…`);
    const result = await invoke<{ added: Book[]; duplicates: number; errors: string[] }>(
      'import_pdfs',
      { paths },
    );
    await refresh();
    toast(
      `${result.added.length} PDF${result.added.length === 1 ? ' adicionado' : 's adicionados'}${result.duplicates ? ` · ${result.duplicates} já existente${result.duplicates === 1 ? '' : 's'}` : ''}`,
    );
    if (result.errors.length)
      modal(
        `<div class="dialog-heading"><h2>Alguns arquivos não foram adicionados</h2>${ib('close-errors', 'Fechar', 'close', 'data-close')}</div><p>Os demais arquivos foram importados normalmente.</p><ul class="error-list">${result.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul><button class="primary" data-close>Entendi</button>`,
      );
  } catch (e) {
    fail(e);
  } finally {
    busy = false;
    $('#import-main').removeAttribute('disabled');
  }
}

function queueReading(patch: Partial<Book>) {
  if (!current) return;
  readingPatch = { ...readingPatch, ...patch };
  current = { ...current, ...patch };
  clearTimeout(saveTimer);
  $('#save-status').textContent = 'Salvando posição…';
  saveTimer = setTimeout(() => void flushReading(), 450);
}
async function flushReading() {
  clearTimeout(saveTimer);
  if (!current || !Object.keys(readingPatch).length) return saveChain;
  const id = current.id,
    patch = { ...readingPatch };
  readingPatch = {};
  saveChain = saveChain
    .catch(() => {})
    .then(async () => {
      await patchBook(id, patch);
      $('#save-status').textContent = 'Posição salva automaticamente';
    })
    .catch((e) => {
      $('#save-status').textContent = 'Não foi possível salvar';
      if (current?.id === id) readingPatch = { ...patch, ...readingPatch };
      fail(e);
      throw e;
    });
  return saveChain;
}
async function openBook(book: Book) {
  if (!book || loading) return;
  closePopover();
  if (current) await closeReader();
  loading = true;
  current = { ...book };
  resumePosition = prefs.resume && book.lastOpened > 0;
  $('#library').hidden = true;
  $('#reader').hidden = false;
  $('#reader-loading').hidden = false;
  updateReaderMeta();
  applyPrefs();
  try {
    await getCurrentWindow().setTitle(`${book.title} · Fólio`);
    const { Reader } = await import('./reader');
    reader = new Reader({
      mode: prefs.readingMode,
      onViewport: updateReaderMeta,
      container: $('#viewer-container'),
      viewer: $('#pdf-viewer'),
      onPage: (page) => {
        if (current) {
          current.page = page;
          updateReaderMeta();
          renderSidebar();
        }
      },
      onLocation: (location) => {
        if (!loading) queueReading(location);
      },
      onZoom: (value) => {
        const s = $<HTMLSelectElement>('#zoom');
        if ([...s.options].some((o) => o.value === value)) s.value = value;
        else {
          const o = $<HTMLOptionElement>('#custom-zoom');
          o.value = value;
          o.textContent = `${Math.round(Number(value) * 100)}%`;
          o.hidden = false;
          s.value = value;
        }
      },
      onFind: (text) => ($('#find-count').textContent = text),
      onPassword: async (incorrect) =>
        new Promise<string | null>((resolve) => {
          const d = modal(
            `<div class="dialog-heading"><h2>PDF protegido por senha</h2>${ib('close-password', 'Cancelar', 'close', 'data-close')}</div><p>${incorrect ? 'Senha incorreta. Tente novamente.' : 'Digite a senha para abrir o documento. Ela não será armazenada.'}</p><input id="password-input" class="text-field" type="password" aria-label="Senha do PDF" autocomplete="off"><div class="dialog-actions"><button class="secondary" data-close>Cancelar</button><button id="password-submit" class="primary">Abrir PDF</button></div>`,
          );
          let sent = false;
          d.addEventListener(
            'close',
            () => {
              if (!sent) resolve(null);
            },
            { once: true },
          );
          const submit = () => {
            sent = true;
            const p = $<HTMLInputElement>('#password-input').value;
            d.close();
            resolve(p);
          };
          $('#password-submit').onclick = submit;
          $('#password-input').onkeydown = (e) => {
            if (e.key === 'Enter') submit();
          };
        }),
    });
    const path = await invoke<string>('pdf_path', { id: book.id });
    await reader.load(
      asset(path),
      resumePosition ? book : { ...book, page: 1, top: null, left: null },
    );
    if (!current) return;
    current.pages = reader.pages;
    updateReaderMeta();
    loading = false;
    $('#reader-loading').hidden = true;
    await patchBook(book.id, {
      pages: reader.pages,
      lastOpened: Math.floor(Date.now() / 1000),
      page: reader.page,
    });
    updateReaderMeta();
    renderSidebar();
    if (resumePosition && book.page > 1)
      toast(`Leitura retomada na página ${book.page}.`, {
        label: 'Ler do início',
        run: restartReading,
      });
    $('#viewer-container').focus();
    if (!book.cover) {
      const r = reader;
      void r
        .cover()
        .then(async (bytes) => {
          if (bytes) {
            await invoke('save_cover', { id: book.id, bytes: Array.from(bytes) });
            const b = snapshot.books.find((b) => b.id === book.id);
            if (b) b.cover = true;
          }
        })
        .catch(() => {});
    }
  } catch (e) {
    if (current) {
      await closeReader();
      toast(`Não foi possível abrir este PDF: ${String(e)}`);
    }
  } finally {
    loading = false;
    $('#reader-loading').hidden = true;
  }
}
function updateReaderMeta() {
  if (!current) return;
  $('#reader-title').textContent = current.title;
  const pageInput = $<HTMLInputElement>('#page-number');
  // Rendering and viewport updates can arrive while a page number is being typed.
  // Keep the draft until it is submitted or the field loses focus.
  if (document.activeElement !== pageInput) pageInput.value = String(current.page);
  $('#page-total').textContent = `/ ${current.pages || '…'}`;
  $<HTMLInputElement>('#page-number').max = String(current.pages || 1);
  $('#reader-favorite').classList.toggle('selected', current.favorite);
  $('#reader-favorite').setAttribute('aria-pressed', String(current.favorite));
  $('#bookmark').classList.toggle('selected', current.bookmarks.includes(current.page));
  $('#bookmark').setAttribute('aria-pressed', String(current.bookmarks.includes(current.page)));
  const kindle = prefs.readingMode === 'kindle',
    screen = reader?.screen;
  const progress =
    kindle && screen ? screen.progress : Math.round((current.page / current.pages) * 100);
  $('#reading-progress').textContent = current.pages
    ? `${progress}% · Página ${current.page} de ${current.pages}`
    : '';
  $('#reading-label').textContent = kindle
    ? 'Kindle · ← → ou Espaço'
    : current.finished
      ? 'Leitura concluída'
      : `${size(current.size)} · Cópia local`;
  $('#previous').toggleAttribute(
    'disabled',
    kindle ? !screen || screen.atStart : current.page <= 1,
  );
  $('#next').toggleAttribute(
    'disabled',
    kindle ? !screen || screen.atEnd : current.page >= current.pages,
  );
  for (const [id, label] of [
    ['previous', kindle ? 'Tela anterior' : 'Página anterior'],
    ['next', kindle ? 'Próxima tela' : 'Próxima página'],
  ]) {
    $(`#${id}`).setAttribute('aria-label', label);
    $(`#${id}`).title = label;
  }
}
function setReadingMode(mode: Preferences['readingMode']) {
  prefs.readingMode = mode;
  applyPrefs();
}

async function closeReader() {
  if (!current) return;
  await flushReading();
  const old = reader;
  reader = null;
  current = null;
  loading = false;
  await old?.destroy();
  $('#reader').hidden = true;
  $('#library').hidden = false;
  document.body.classList.remove('focus-mode');
  $('#exit-focus').hidden = true;
  $('#find-bar').hidden = true;
  $('#reader-sidebar').hidden = true;
  await getCurrentWindow().setTitle('Fólio');
  renderLibrary();
  $('#library-search').focus();
}
function restartReading() {
  if (!reader || !current) return;
  reader.goTo(1);
  queueReading({ page: 1 });
  updateReaderMeta();
}
function toggleFocus() {
  const active = document.body.classList.toggle('focus-mode');
  $('#exit-focus').hidden = !active;
  reader?.resize();
}
function showFind() {
  if (!current) return;
  $('#find-bar').hidden = false;
  $('#find-input').focus();
  reader?.resize();
}
function searchPdf(again = false, back = false) {
  reader?.find($<HTMLInputElement>('#find-input').value, again, back);
}
function toggleSidebar(tab?: string) {
  if (tab) sideTab = tab;
  const s = $('#reader-sidebar');
  s.hidden = tab ? false : !s.hidden;
  renderSidebar();
  reader?.resize();
}
async function toggleBookmark() {
  if (!current) return;
  const p = current.page;
  await flushReading();
  await patchBook(current.id, {
    bookmarks: current.bookmarks.includes(p)
      ? current.bookmarks.filter((n) => n !== p)
      : [...current.bookmarks, p].sort((a, b) => a - b),
  });
  updateReaderMeta();
  renderSidebar();
}
function renderSidebar() {
  if ($('#reader-sidebar').hidden || !current) return;
  const content = $('#sidebar-content');
  document
    .querySelectorAll<HTMLElement>('[data-tab]')
    .forEach((b) => b.classList.toggle('active', b.dataset.tab === sideTab));
  if (sideTab === 'outline') {
    const items = reader?.outline || [];
    const render = (items: any[], depth = 0): string =>
      items
        .map(
          (item) =>
            `<button class="outline-item" style="padding-left:${16 + depth * 12}px" data-dest="${esc(JSON.stringify(item.dest))}">${esc(item.title || 'Seção')}</button>${render(item.items || [], depth + 1)}`,
        )
        .join('');
    content.innerHTML = items.length
      ? render(items)
      : `<div class="side-empty">${icon('list')}<h3>Sem sumário neste PDF</h3><p>Use o número da página ou a busca para navegar.</p></div>`;
    content
      .querySelectorAll<HTMLElement>('[data-dest]')
      .forEach((b) => (b.onclick = () => reader?.destination(JSON.parse(b.dataset.dest!))));
  } else if (sideTab === 'bookmarks') {
    content.innerHTML = current.bookmarks.length
      ? current.bookmarks
          .map(
            (p) =>
              `<button class="bookmark-row ${current?.page === p ? 'active' : ''}" data-page="${p}">${icon('bookmark')} Página ${p}${icon('arrow')}</button>`,
          )
          .join('')
      : `<div class="side-empty">${icon('bookmark')}<h3>Guarde uma página</h3><p>Clique no marcador da barra ou use Ctrl + B.</p></div>`;
  } else {
    content.innerHTML = `<button id="side-add-note" class="secondary">${icon('plus')} Nova nota</button>${current.notes.length ? current.notes.map((n) => `<article class="note-card"><button class="note-page" data-page="${n.page}">Página ${n.page} ${icon('arrow')}</button>${n.quote ? `<blockquote>${esc(n.quote)}</blockquote>` : ''}<p>${esc(n.text)}</p><button class="text-button" data-edit-note="${n.id}">Editar</button></article>`).join('') : `<div class="side-empty">${icon('note')}<h3>Suas ideias, por perto</h3><p>Selecione um trecho e adicione uma nota. Tudo fica salvo neste computador.</p></div>`}`;
    $('#side-add-note').onclick = () => editNote();
    content
      .querySelectorAll<HTMLElement>('[data-edit-note]')
      .forEach(
        (b) =>
          (b.onclick = () => editNote(current?.notes.find((n) => n.id === b.dataset.editNote))),
      );
  }
  content
    .querySelectorAll<HTMLElement>('[data-page]')
    .forEach((b) => (b.onclick = () => reader?.goTo(Number(b.dataset.page))));
}
function editNote(existing?: Note) {
  if (!current) return;
  const selection = window.getSelection();
  const quote =
    existing?.quote ||
    (selection?.anchorNode && $('#pdf-viewer').contains(selection.anchorNode)
      ? selection.toString().trim().slice(0, 20000)
      : '');
  const page = existing?.page || current.page;
  const id = current.id;
  const d = modal(
    `<div class="dialog-heading"><h2>${existing ? 'Editar nota' : 'Nova nota'} <span class="quiet-label">Página ${page}</span></h2>${ib('close-note', 'Fechar', 'close', 'data-close')}</div>${quote ? `<blockquote class="quote-preview">${esc(quote)}</blockquote>` : '<p>Registre uma ideia ou selecione um trecho no PDF para citá-lo.</p>'}<label class="field-label" for="note-text">Sua nota</label><textarea id="note-text" rows="6" maxlength="20000" placeholder="O que você quer lembrar?">${esc(existing?.text || '')}</textarea><div class="dialog-actions">${existing ? '<button id="delete-note" class="text-button danger">Excluir nota</button>' : ''}<button class="secondary" data-close>Cancelar</button><button id="save-note" class="primary">Salvar nota</button></div>`,
  );
  $('#save-note').onclick = async () => {
    const text = $<HTMLTextAreaElement>('#note-text').value.trim();
    if (!text && !quote) {
      toast('Escreva uma nota antes de salvar.');
      return;
    }
    try {
      await flushReading();
      const notes = [...(current?.notes || [])];
      const note = {
        id: existing?.id || crypto.randomUUID(),
        page,
        text,
        quote,
        created: existing?.created || Date.now(),
      };
      const idx = notes.findIndex((n) => n.id === note.id);
      if (idx >= 0) notes[idx] = note;
      else notes.push(note);
      await patchBook(id, { notes });
      d.close();
      toggleSidebar('notes');
      toast('Nota salva.');
    } catch (e) {
      fail(e);
    }
  };
  $('#delete-note')?.addEventListener('click', async () => {
    try {
      await patchBook(id, { notes: current!.notes.filter((n) => n.id !== existing!.id) });
      d.close();
      renderSidebar();
    } catch (e) {
      fail(e);
    }
  });
}

$('#import-main').onclick = () => void importFiles();
$('#library-search').oninput = () => {
  query = $<HTMLInputElement>('#library-search').value;
  renderLibrary();
};
document.querySelectorAll<HTMLElement>('[data-filter]').forEach(
  (b) =>
    (b.onclick = () => {
      filter = b.dataset.filter!;
      renderLibrary();
    }),
);
$('#sort').onchange = () => {
  prefs.sort = $<HTMLSelectElement>('#sort').value;
  renderLibrary();
};
$<HTMLSelectElement>('#sort').value = prefs.sort;
$('#view-grid').onclick = () => {
  prefs.view = 'grid';
  renderLibrary();
};
$('#view-list').onclick = () => {
  prefs.view = 'list';
  renderLibrary();
};
$('#settings').onclick = preferences;
$('#reader-settings').onclick = preferences;
$('#help').onclick = showHelp;
$('#theme-toggle').onclick = () => {
  prefs.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyPrefs();
};
$('#folder-link').onclick = () => void invoke('open_folder').catch(fail);
$('#back').onclick = () => void closeReader().catch(fail);
$('#cancel-loading').onclick = () => void closeReader().catch(fail);
$('#restart').onclick = restartReading;
$('#reader-favorite').onclick = () => current && void toggleFavorite(current.id);
$('#reader-more').onclick = () => current && bookMenu($('#reader-more'), current);
$('#kindle-toggle').onclick = () => {
  setReadingMode(prefs.readingMode === 'kindle' ? 'scroll' : 'kindle');
  $('#viewer-container').focus();
  if (prefs.readingMode === 'kindle')
    toast('Modo Kindle: use ← →, Espaço ou a roda do mouse para passar as telas.');
};
$('#previous').onclick = () => reader?.turn(-1);
$('#next').onclick = () => reader?.turn(1);
$('#page-number').onchange = () => {
  reader?.goTo(Number($<HTMLInputElement>('#page-number').value));
  updateReaderMeta();
};
$('#page-number').onblur = updateReaderMeta;
$('#zoom').onchange = () => reader?.zoom($<HTMLSelectElement>('#zoom').value);
$('#zoom-in').onclick = () => reader?.stepZoom(1);
$('#zoom-out').onclick = () => reader?.stepZoom(-1);
$('#rotate').onclick = () => {
  reader?.rotate();
  if (current && reader) queueReading({ rotation: reader.rotation });
};
$('#bookmark').onclick = () => void toggleBookmark().catch(fail);
$('#paper-toggle').onclick = () => {
  prefs.paper = prefs.paper === 'dark' ? 'light' : 'dark';
  applyPrefs();
};
$('#focus').onclick = toggleFocus;
$('#exit-focus').onclick = toggleFocus;
$('#fullscreen').onclick = async () => {
  const w = getCurrentWindow();
  await w.setFullscreen(!(await w.isFullscreen()));
};
$('#sidebar-toggle').onclick = () => toggleSidebar();
document
  .querySelectorAll<HTMLElement>('[data-tab]')
  .forEach((b) => (b.onclick = () => toggleSidebar(b.dataset.tab)));
$('#add-note').onmousedown = (e) => e.preventDefault();
$('#add-note').onclick = () => editNote();
$('#find-toggle').onclick = showFind;
let findTimer: ReturnType<typeof setTimeout>;
$('#find-input').oninput = () => {
  clearTimeout(findTimer);
  findTimer = setTimeout(() => searchPdf(), 180);
};
$('#find-input').onkeydown = (e) => {
  if (e.key === 'Enter') searchPdf(true, e.shiftKey);
};
$('#find-next').onclick = () => searchPdf(true);
$('#find-prev').onclick = () => searchPdf(true, true);
$('#find-close').onclick = () => {
  $('#find-bar').hidden = true;
  reader?.closeFind();
  $('#viewer-container').focus();
  reader?.resize();
};

bindShortcuts({
  isReading: () => !!current,
  getReader: () => reader,
  importFiles,
  closeReader,
  toggleBookmark,
  toggleFocus,
  showFind,
});
async function init() {
  await refresh();
  await listen<{ done: number; total: number }>('import-progress', (e) =>
    toast(`Copiando PDFs… ${e.payload.done} de ${e.payload.total}`),
  );
  await getCurrentWindow().onDragDropEvent((e) => {
    const data = e.payload;
    $('#drop-overlay').hidden = data.type !== 'over' && data.type !== 'enter';
    if (data.type === 'drop') void importFiles(data.paths);
  });
  await getCurrentWindow().onCloseRequested(async (e) => {
    if (busy) {
      e.preventDefault();
      toast('Aguarde a cópia dos PDFs terminar antes de fechar.');
      return;
    }
    if (current) {
      e.preventDefault();
      try {
        await flushReading();
        await getCurrentWindow().destroy();
      } catch {
        toast('Não foi possível salvar a posição. Tente novamente.');
      }
    }
  });
}
void init().catch((e) => {
  modal(
    `<h2>Não foi possível abrir a biblioteca</h2><p>${esc(e)}</p><p>Seus PDFs não foram alterados.</p><button class="primary" onclick="location.reload()">Tentar novamente</button>`,
  );
});
