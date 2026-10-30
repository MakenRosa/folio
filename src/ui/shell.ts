import { icon } from '../icons';
import { ib } from './dom';
import { SIDEBAR_WIDTH } from '../reading/sidebar';
// What the header of the reader says of saving. The position and the reading credit are saved the
// same way, so none of the texts names one of them.
export const SAVE_STATUS = {
  idle: 'Salvamento automático',
  saving: 'Salvando…',
  saved: 'Salvo automaticamente',
  retrying: 'Não foi possível salvar. Tentando novamente…',
};
// A button of the bar that appears when documents are selected. The text goes away on narrow
// windows, and the name stays in `aria-label` and in the tooltip.
const selectionAction = (id: string, ico: string, label: string, extra = '') =>
  `<button id="${id}" class="selection-action ${extra}" type="button" aria-label="${label}" title="${label}">${icon(ico)}<span>${label}</span></button>`;
export const appShell = `
<div id="library" class="library-shell">
 <aside class="library-sidebar">
  <div class="brand"><span class="brand-mark">${icon('book')}</span><div>Fólio<span>PDF READER</span></div></div>
  <button id="import-main" class="primary add-button">${icon('plus')}<span class="add-label">Adicionar PDFs</span><kbd>Ctrl + O</kbd><span class="add-bar" aria-hidden="true" hidden><i></i></span></button><span id="import-status" class="sr-only" role="status" aria-live="polite"></span><button id="import-folder" class="text-button add-folder" title="Adicionar todos os PDFs de uma pasta, com as subpastas">${icon('folder')} Adicionar pasta</button>
  <div class="nav-label">SUA BIBLIOTECA</div>
  <nav aria-label="Biblioteca">
   ${[
     ['all', 'book', 'Todos os documentos'],
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
  <div id="tag-section" class="tag-section" hidden><div id="tag-label" class="nav-label">ETIQUETAS</div><nav id="tag-nav" aria-labelledby="tag-label"></nav></div>
  <div class="sidebar-bottom"><div class="local-note"><span class="status-dot"></span> Só no seu computador<span>Seus arquivos. Seu espaço.</span></div>
   <button class="nav-item" data-filter="trash">${icon('trash')}<span>Removidos</span></button>
   <button id="goals" class="nav-item">${icon('target')}<span>Metas de leitura</span></button><button id="reading-history" class="nav-item">${icon('history')}<span>Histórico de leitura</span></button><button id="settings" class="nav-item">${icon('settings')}<span>Preferências</span></button>
   <button id="help" class="nav-item">${icon('help')}<span>Guia e atalhos</span></button>
  </div>
 </aside>
 <main class="library-main">
  <header class="library-top"><span class="eyebrow">UM ESPAÇO PARA LER</span><div class="search-input">${icon('search')}<input id="library-search" type="search" placeholder="Buscar na biblioteca" aria-label="Buscar na biblioteca"><kbd>Ctrl + K</kbd></div>${ib('theme-toggle', 'Alternar tema da interface', 'moon')}</header>
  <div class="library-content"><div class="heading-row"><div><h1 id="library-title">Sua biblioteca</h1><p id="library-subtitle">Boas leituras começam por aqui.</p></div><span id="library-total" class="quiet-label"></span></div>
   <div id="trash-bar" class="trash-bar" hidden><span id="trash-summary"></span><button id="empty-trash" class="secondary danger" type="button">${icon('trash')} Esvaziar Removidos</button></div>
   <button id="library-goal" class="library-goal" title="Configurar metas de leitura"><span id="library-goal-text">Definir meta diária</span><span class="goal-track" aria-hidden="true" hidden><i></i></span></button><section id="continue" aria-label="Continuar leitura" hidden></section>
   <div class="collection-toolbar"><span id="collection-label">TODOS OS DOCUMENTOS</span><div><label class="sr-only" for="sort">Ordenação</label><select id="sort"><option value="recent">Última atividade</option><option value="added">Adicionados recentemente</option><option value="title">Título A–Z</option><option value="size">Maior tamanho</option></select><div class="segmented" role="radiogroup" aria-label="Visualização">${ib('view-grid', 'Visualização em grade', 'grid', 'role="radio" aria-checked="true"')}${ib('view-list', 'Visualização em lista', 'list', 'role="radio" aria-checked="false" tabindex="-1"')}</div></div></div>
   <div id="books" class="book-grid"></div>
   <div id="empty"></div>
   <footer class="library-footer"><span>${icon('folder')} Os PDFs adicionados são copiados para sua biblioteca.</span><button id="folder-link" class="text-button">Abrir pasta ${icon('arrow')}</button></footer>
  </div>
 </main>
 <div id="selection-bar" class="selection-bar" role="group" aria-label="Ações para os documentos selecionados" hidden>
  <span id="selection-count" class="selection-count" role="status" aria-live="polite"></span>
  <div class="selection-actions">${[
    selectionAction('select-favorite', 'star', 'Favoritar'),
    selectionAction('select-finish', 'check', 'Marcar como concluído'),
    selectionAction('select-tag', 'tag', 'Adicionar etiqueta'),
    selectionAction('select-remove', 'archive', 'Remover da biblioteca', 'danger'),
    selectionAction('select-restore', 'undo', 'Restaurar'),
    selectionAction('select-purge', 'trash', 'Excluir definitivamente', 'danger'),
    selectionAction('select-clear', 'close', 'Limpar seleção'),
  ].join('')}</div>
 </div>
</div>
<section id="reader" hidden aria-label="Leitor de PDF"><div class="reader-top">
 <header class="reader-header">${ib('back', 'Voltar à biblioteca (Ctrl + W)', 'back')}<span class="header-divider"></span><div class="reader-document"><strong id="reader-title"></strong><span id="save-status">${SAVE_STATUS.idle}</span></div><button id="kindle-toggle" class="reading-mode-button" aria-pressed="false" title="Modo Kindle: avançar por telas (K). Use ← →, Espaço ou a roda do mouse.">${icon('book')} Kindle</button><button id="finish-reading" class="reading-mode-button" aria-pressed="false" title="Marcar como concluído">Concluir leitura</button>${ib('restart', 'Ler do início', 'restart')}${ib('reader-favorite', 'Favoritar documento', 'star')}${ib('reader-settings', 'Preferências: aparência, brilho e tela quente', 'settings')}${ib('reader-more', 'Mais opções', 'more', 'aria-haspopup="menu" aria-expanded="false"')}</header>
 <div class="reader-toolbar"><div class="toolbar-group">${ib('sidebar-toggle', 'Barra lateral: sumário, páginas, marcas e notas (S)', 'sidebar', 'aria-expanded="false" aria-controls="reader-sidebar"')}${ib('find-toggle', 'Buscar no PDF (Ctrl + F)', 'search')}<span class="header-divider"></span>${ib('previous', 'Página anterior', 'left')}<label class="sr-only" for="page-number">Página atual</label><input id="page-number" type="number" min="1" value="1"><span id="page-total">/ 1</span>${ib('next', 'Próxima página', 'right')}</div><div class="toolbar-group">${ib('zoom-out', 'Diminuir zoom (Ctrl + −)', 'minus')}<label class="sr-only" for="zoom">Zoom</label><select id="zoom"><option value="page-width">Largura da página</option><option value="page-fit">Página inteira</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option><option value="3">300%</option><option id="custom-zoom" value="custom" hidden>100%</option></select>${ib('zoom-in', 'Aumentar zoom (Ctrl + +)', 'plus')}${ib('spread-toggle', 'Duas páginas lado a lado (L)', 'spread', 'aria-pressed="false"')}<span class="header-divider"></span>${ib('rotate', 'Girar página 90° (R)', 'rotate')}${ib('bookmark', 'Marcar esta página (Ctrl + B)', 'bookmark')}<span class="header-divider"></span>${ib('paper-toggle', 'Papel claro. Mudar para sépia (D)', 'file')}<button id="reading-brightness" class="reading-quick" data-menu aria-haspopup="dialog" aria-controls="popover" aria-expanded="false">${icon('sun')}<span class="quick-name">Brilho</span><span id="reading-brightness-value">100%</span></button><button id="reading-warm" class="reading-quick" data-menu aria-haspopup="dialog" aria-controls="popover" aria-expanded="false">${icon('warm')}<span class="quick-name">Tela quente</span><span id="reading-warm-value">0%</span></button>${ib('fullscreen', 'Tela cheia (F11)', 'expand')}</div></div>
 <div id="find-bar" hidden><div class="search-input">${icon('search')}<input id="find-input" type="search" placeholder="Buscar texto neste PDF" aria-label="Buscar texto neste PDF"></div><span id="find-count" aria-live="polite"></span>${ib('find-prev', 'Resultado anterior', 'left')}${ib('find-next', 'Próximo resultado', 'right')}${ib('find-close', 'Fechar busca', 'close')}</div>
 </div><div class="reader-body"><aside id="reader-sidebar" aria-label="Barra lateral do leitor" hidden><div class="side-tabs" role="tablist" aria-label="Seções da barra lateral">${[
   ['outline', 'Sumário'],
   ['pages', 'Páginas'],
   ['bookmarks', 'Marcas'],
   ['notes', 'Notas'],
 ]
   .map(
     ([id, label]) =>
       `<button id="tab-${id}" role="tab" data-tab="${id}" aria-selected="${id === 'outline'}" aria-controls="sidebar-content" tabindex="${id === 'outline' ? 0 : -1}" class="${id === 'outline' ? 'active' : ''}">${label}</button>`,
   )
   .join(
     '',
   )}</div><div id="sidebar-content" role="tabpanel" aria-labelledby="tab-outline"></div><div id="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="Largura da barra lateral" aria-controls="reader-sidebar" aria-valuemin="${SIDEBAR_WIDTH.min}" aria-valuemax="${SIDEBAR_WIDTH.max}" aria-valuenow="${SIDEBAR_WIDTH.fallback}" aria-valuetext="${SIDEBAR_WIDTH.fallback} px" tabindex="0" title="Arraste para mudar a largura, ou use as setas"></div></aside><div id="viewer-wrap"><div id="viewer-container" tabindex="0" role="region" aria-label="Páginas do documento"><div id="pdf-viewer" class="pdfViewer"></div></div><div id="jump-pill" class="jump-pill" role="group" aria-label="Voltar ou avançar entre posições da leitura" data-side="back" hidden><button id="jump-back" class="jump-go" type="button">${icon('undo')}<span id="jump-back-text" class="jump-text"></span></button><button id="jump-forward" class="jump-go" type="button" hidden><span id="jump-forward-text" class="jump-text"></span>${icon('arrow')}</button><button id="jump-dismiss" class="jump-dismiss" type="button" title="Dispensar" aria-label="Dispensar">${icon('close')}</button></div><span id="jump-status" class="sr-only" role="status" aria-live="polite"></span><div id="reader-loading" class="loading-state" role="status" hidden><span class="spinner"></span><p>Abrindo seu PDF…</p><button id="cancel-loading" class="text-button">Voltar à biblioteca</button></div><div id="warm-overlay" aria-hidden="true"></div><div id="brightness-overlay" aria-hidden="true"></div></div></div>
 <footer class="reader-footer"><span class="reading-status"><span id="reading-progress"></span><span id="reading-time" title="Estimativa pelo seu ritmo de leitura neste documento" hidden></span></span><span id="reading-label">Leitura local</span><button id="reader-goal" class="text-button" title="Configurar meta e ver progresso de hoje">Meta diária</button><button id="add-note" class="text-button">${icon('note')} Adicionar nota</button></footer>
 <div id="reading-line" class="reading-line" aria-hidden="true"><i></i></div>
</section>
<div id="drop-overlay" hidden><div>${icon('plus')}<h2>Solte PDFs ou pastas aqui</h2><p>Uma cópia de cada PDF será guardada na biblioteca.</p></div></div>
<div id="toast" role="status" aria-live="polite"></div>
<dialog id="dialog"><div id="dialog-content"></div></dialog>
<div id="popover" hidden></div>
<div id="highlight-bar" class="highlight-bar" role="toolbar" aria-label="Ações para o trecho selecionado" hidden></div>`;
