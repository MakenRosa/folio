import { icon } from '../icons';
import { ib } from './dom';
export const appShell = `
<div id="library" class="library-shell">
 <aside class="library-sidebar">
  <div class="brand"><span class="brand-mark">${icon('book')}</span><div>Fólio<span>PDF READER</span></div></div>
  <button id="import-main" class="primary add-button">${icon('plus')} Adicionar PDFs <kbd>Ctrl O</kbd></button>
  <div class="nav-label">SUA BIBLIOTECA</div>
  <nav aria-label="Biblioteca">
   ${[
     ['all', 'book', 'Todos os PDFs'],
     ['reading', 'clock', 'Em leitura'],
     ['favorites', 'star', 'Favoritos'],
     ['finished', 'check', 'Concluídos'],
   ]
     .map(
       ([id, ico, label]) =>
         `<button class="nav-item ${id === 'all' ? 'active' : ''}" data-filter="${id}">${icon(ico)}<span>${label}</span><small id="count-${id}">0</small></button>`,
     )
     .join('')}
  </nav>
  <div class="sidebar-bottom"><div class="local-note"><span class="status-dot"></span> Só no seu computador<span>Seus arquivos. Seu espaço.</span></div>
   <button class="nav-item" data-filter="trash">${icon('trash')}<span>Removidos</span></button>
   <button id="settings" class="nav-item">${icon('settings')}<span>Preferências</span></button>
   <button id="help" class="nav-item">${icon('help')}<span>Guia e atalhos</span></button>
  </div>
 </aside>
 <main class="library-main">
  <header class="library-top"><span class="eyebrow">UM ESPAÇO PARA LER</span><div class="search-input">${icon('search')}<input id="library-search" type="search" placeholder="Buscar na biblioteca" aria-label="Buscar na biblioteca"><kbd>Ctrl K</kbd></div>${ib('theme-toggle', 'Alternar tema da interface', 'moon')}</header>
  <div class="library-content"><div class="heading-row"><div><h1 id="library-title">Sua biblioteca</h1><p id="library-subtitle">Boas leituras começam por aqui.</p></div><span id="library-total" class="quiet-label"></span></div>
   <section id="continue" aria-label="Continuar leitura" hidden></section>
   <div class="collection-toolbar"><span id="collection-label">TODOS OS DOCUMENTOS</span><div><label class="sr-only" for="sort">Ordenação</label><select id="sort"><option value="recent">Última atividade</option><option value="added">Adicionados recentemente</option><option value="title">Título A–Z</option><option value="size">Maior tamanho</option></select><div class="segmented">${ib('view-grid', 'Visualização em grade', 'grid')}${ib('view-list', 'Visualização em lista', 'list')}</div></div></div>
   <div id="books" class="book-grid"></div>
   <div id="empty"></div>
   <footer class="library-footer"><span>${icon('folder')} Os PDFs adicionados são copiados para sua biblioteca.</span><button id="folder-link" class="text-button">Abrir pasta ${icon('arrow')}</button></footer>
  </div>
 </main>
</div>
<section id="reader" hidden aria-label="Leitor de PDF">
 <header class="reader-header">${ib('back', 'Voltar à biblioteca (Alt + ←)', 'back')}<span class="header-divider"></span><div class="reader-document"><strong id="reader-title"></strong><span id="save-status">Posição salva automaticamente</span></div><button id="kindle-toggle" class="reading-mode-button" aria-pressed="false" title="Modo Kindle: avançar por telas (K)">${icon('book')} Kindle</button><button id="restart" class="text-button">Ler do início</button>${ib('reader-favorite', 'Favoritar documento', 'star')}${ib('reader-settings', 'Aparência, brilho e tela quente', 'settings')}${ib('reader-more', 'Mais opções', 'more')}</header>
 <div class="reader-toolbar"><div class="toolbar-group">${ib('sidebar-toggle', 'Sumário, marcadores e notas', 'sidebar')}${ib('find-toggle', 'Buscar no PDF (Ctrl + F)', 'search')}<span class="header-divider"></span>${ib('previous', 'Página anterior', 'left')}<label class="sr-only" for="page-number">Página atual</label><input id="page-number" type="number" min="1" value="1"><span id="page-total">/ 1</span>${ib('next', 'Próxima página', 'right')}</div><div class="toolbar-group">${ib('zoom-out', 'Diminuir zoom (Ctrl + −)', 'minus')}<label class="sr-only" for="zoom">Zoom</label><select id="zoom"><option value="page-width">Largura da página</option><option value="page-fit">Página inteira</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option><option value="3">300%</option><option id="custom-zoom" value="custom" hidden>100%</option></select>${ib('zoom-in', 'Aumentar zoom (Ctrl + +)', 'plus')}<span class="header-divider"></span>${ib('rotate', 'Girar página 90° (R)', 'rotate')}${ib('bookmark', 'Marcar esta página (Ctrl + B)', 'bookmark')}${ib('paper-toggle', 'Alternar papel claro e escuro (D)', 'moon')}${ib('focus', 'Modo foco (F8)', 'focus')}${ib('fullscreen', 'Tela cheia (F11)', 'expand')}</div></div>
 <div id="find-bar" hidden><div class="search-input">${icon('search')}<input id="find-input" type="search" placeholder="Buscar texto neste PDF" aria-label="Buscar texto no PDF"></div><span id="find-count" aria-live="polite"></span>${ib('find-prev', 'Resultado anterior', 'left')}${ib('find-next', 'Próximo resultado', 'right')}${ib('find-close', 'Fechar busca', 'close')}</div>
 <div class="reader-body"><aside id="reader-sidebar" hidden><div class="side-tabs"><button data-tab="outline" class="active">Sumário</button><button data-tab="bookmarks">Marcas</button><button data-tab="notes">Notas</button></div><div id="sidebar-content"></div></aside><div id="viewer-wrap"><div id="viewer-container" tabindex="0"><div id="pdf-viewer" class="pdfViewer"></div></div><div id="reader-loading" class="loading-state" hidden><span class="spinner"></span><p>Abrindo seu PDF…</p><button id="cancel-loading" class="text-button">Voltar à biblioteca</button></div><div id="warm-overlay" aria-hidden="true"></div><div id="brightness-overlay" aria-hidden="true"></div></div></div>
 <footer class="reader-footer"><span id="reading-label">Leitura local</span><span id="reading-progress"></span><button id="add-note" class="text-button">${icon('note')} Adicionar nota</button></footer>
 <button id="exit-focus" hidden class="floating-button">${icon('focus')} Sair do foco <kbd>F8</kbd></button>
</section>
<div id="drop-overlay" hidden><div>${icon('plus')}<h2>Solte seus PDFs aqui</h2><p>Uma cópia de cada arquivo será guardada na biblioteca.</p></div></div>
<div id="toast" role="status" aria-live="polite" hidden></div>
<dialog id="dialog"><div id="dialog-content"></div></dialog>
<div id="popover" hidden></div>`;
