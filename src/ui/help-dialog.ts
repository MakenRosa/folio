import { ib } from './dom';
import { modal } from './overlays';
export function showHelp() {
  modal(
    `<div class="dialog-heading"><h2>Bem-vindo ao Fólio</h2>${ib('close-help', 'Fechar guia', 'close', 'data-close')}</div><p>Um lugar tranquilo para seus PDFs, inteiramente no seu computador.</p><div class="guide-block"><strong>1. Traga suas leituras</strong><p>Escolha um ou vários PDFs, ou arraste-os para a janela. Cada arquivo é copiado para a biblioteca. O original nunca é alterado.</p><strong>2. Leia no seu ritmo</strong><p>A página, a posição e o zoom são salvos automaticamente. Nas preferências, diminua o brilho da leitura sem inverter as cores. Combine com tela quente e qualquer cor de página. Ative Kindle no topo do leitor para passar por telas no zoom atual, com uma pequena sobreposição. O texto mantém a diagramação original; páginas digitalizadas também funcionam. Em zoom muito alto, use a barra horizontal ou Shift + roda para ver as laterais.</p><strong>3. Guarde o que importa</strong><p>Favorite documentos, marque páginas e anote suas ideias. Notas e marcadores ficam na biblioteca, separados do PDF.</p></div><div class="shortcuts">${[
      ['Ctrl + O', 'Adicionar PDFs'],
      ['Ctrl + K', 'Buscar na biblioteca'],
      ['Ctrl + F', 'Buscar no PDF'],
      ['Ctrl + B', 'Marcar página'],
      ['Ctrl + + / −', 'Ajustar zoom'],
      ['K', 'Alternar modo Kindle'],
      ['← / → · Page Up / Down', 'Voltar / avançar tela no Kindle'],
      ['Espaço / Shift + Espaço', 'Avançar / voltar tela no Kindle'],
      ['Home / End', 'Início / fim no Kindle'],
      ['D', 'Alternar papel escuro'],
      ['R', 'Girar páginas'],
      ['F8 / F11', 'Foco / tela cheia'],
      ['Alt + ←', 'Voltar à biblioteca'],
    ]
      .map(([k, v]) => `<div><span>${v}</span><kbd>${k}</kbd></div>`)
      .join(
        '',
      )}</div><p class="small-copy">A busca encontra texto existente no PDF; documentos digitalizados sem texto precisam de OCR externo. Para backup, copie a pasta inteira da biblioteca, incluindo o catálogo. PDFs removidos podem ser restaurados em “Removidos”.</p><button class="primary" data-close>Começar a ler</button>`,
  );
}
