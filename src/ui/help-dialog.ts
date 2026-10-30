import { ib } from './dom';
import { modal } from './overlays';
// The keys, with what each does. The first column of a row is the action, the second the keys.
const SHORTCUTS = [
  ['Ctrl + O', 'Adicionar PDFs'],
  ['Ctrl + K', 'Buscar na biblioteca (no leitor, o documento é fechado antes)'],
  ['Ctrl + F', 'Buscar no PDF'],
  ['Ctrl + B', 'Marcar esta página'],
  ['Ctrl + + / −', 'Ajustar zoom'],
  ['K', 'Alternar modo Kindle'],
  ['L', 'Alternar duas páginas lado a lado'],
  ['← / →', 'Página anterior / seguinte (no Kindle, a tela). Com zoom alto, rolam para os lados'],
  ['Page Up / Down', 'Rolar uma tela (no Kindle, voltar / avançar tela)'],
  ['Espaço / Shift + Espaço', 'Avançar / voltar tela no Kindle'],
  ['Home / End', 'Início / fim no Kindle'],
  ['S', 'Mostrar ou esconder a barra lateral'],
  ['D', 'Mudar o papel: claro, sépia e escuro, em ciclo'],
  ['R', 'Girar páginas'],
  [
    'Shift + ← / →',
    'Selecionar o trecho por palavra (com o foco nas páginas, na rolagem e no Kindle)',
  ],
  ['Shift + ↑ / ↓', 'Selecionar o trecho por linha. Sem seleção, começa no primeiro texto à vista'],
  ['H', 'Realçar o trecho selecionado, na última cor usada'],
  ['N', 'Adicionar nota ao trecho selecionado'],
  ['F11', 'Entrar / sair da tela cheia'],
  ['F1 / ?', 'Abrir este guia (o “?” só com os atalhos de uma tecla ligados)'],
  [
    'Esc',
    'Fechar uma coisa por vez: menu, barra de realce, busca, seleção da biblioteca, tela cheia, ou o aviso em foco. Na busca da biblioteca e na das notas, limpa o texto primeiro',
  ],
  ['Alt + ← / Alt + →', 'Voltar / avançar à posição de antes do salto'],
  ['Botões laterais do mouse', 'O mesmo que Alt + ← e Alt + →'],
  ['Ctrl + W', 'Voltar à biblioteca'],
  ['Shift + F10 / Menu', 'Abrir as opções do documento em foco'],
  [
    '← → ↑ ↓ · Home / End',
    'Na biblioteca, mover o foco entre os documentos (na lista, só ↑ ↓). Tab entra na lista e sai dela',
  ],
  [
    'Espaço',
    'Na biblioteca, selecionar o documento em foco (Enter abre; Shift + Espaço marca o intervalo)',
  ],
  [
    'Setas · Home / End · Page Up / Down',
    'No calendário do Histórico, mover o foco por dia e semana, ir ao começo e ao fim da semana e trocar de mês (Enter ou Espaço escolhe o dia)',
  ],
  ['Ctrl + clique · Shift + clique', 'Selecionar documentos (Shift marca o intervalo)'],
  ['Ctrl + A', 'Selecionar todos os documentos da tela'],
  ['↑ / ↓ · Home / End · letra', 'Percorrer um menu de opções'],
  ['Esc / Tab', 'Fechar o menu (Esc devolve o foco ao botão)'],
];
// Each topic is a heading of its own, with a few sentences: a reader looks for one, not for all.
const TOPICS = [
  [
    '1. Traga suas leituras',
    'Escolha PDFs ou uma pasta inteira (“Adicionar pasta”), ou arraste-os para a janela. Cada PDF é copiado para a biblioteca, e o original nunca é alterado. A capa, o número de páginas e o autor aparecem sozinhos, um PDF por vez, enquanto você usa a biblioteca.',
  ],
  [
    '2. Leia no seu ritmo',
    'A página, a posição e o zoom são salvos automaticamente. Brilho e Tela quente, na barra de leitura, ajustam o conforto rapidamente; as demais opções de aparência ficam nas preferências. Ative Kindle no topo do leitor para passar por telas, ou use o botão ao lado do zoom (ou a tecla L) para ver duas páginas lado a lado.',
  ],
  [
    '3. Guarde o que importa',
    'Favorite documentos, marque páginas e anote suas ideias. Selecione um trecho no PDF, com o mouse ou com Shift + setas, e, na barra que aparece junto a ele, escolha uma das quatro cores para realçá-lo, Adicionar nota ou Copiar. Notas, realces e marcas ficam na biblioteca, separados do PDF, que nunca é alterado.',
  ],
  [
    '4. Acompanhe sua leitura',
    'Use Concluir leitura, no topo do leitor, para marcar um documento como concluído. Metas de leitura, na biblioteca, define a meta diária geral, que conta toda a leitura do dia, em qualquer documento. Cada documento fica sem meta própria (só entra na meta geral) ou tem uma meta própria, que também entra na meta geral. O progresso de hoje aparece no rodapé do leitor, com a meta do documento, se ele tem uma, ou a meta geral; clique nele para ajustar a configuração ou os totais do dia. Em Histórico de leitura, consulte o calendário, os dias com meta atingida e quantas páginas e capítulos leu em cada dia.',
  ],
];
const DETAILS = [
  [
    'Kindle e duas páginas',
    'O Kindle passa por telas no zoom atual, com uma pequena sobreposição, e usa uma página por vez. Use ← →, Espaço ou a roda do mouse para passar as telas, e Home e End para ir ao início e ao fim. A opção Unir conteúdo das páginas reduz margens vazias no Kindle e pode ser desativada nas preferências. O texto mantém sua diagramação, e páginas digitalizadas também funcionam. Na rolagem, em telas largas, as duas páginas ficam lado a lado, e as preferências deixam a capa sozinha.',
  ],
  [
    'Zoom, tela cheia e saltos',
    'Em zoom muito alto, ← e → rolam o PDF para os lados; a barra horizontal e Shift + roda também servem. Na tela cheia, leve o mouse ao topo ou à parte inferior (ou use Tab) para mostrar os controles; uma linha fina na borda inferior mostra o progresso enquanto eles estão escondidos. Depois de um salto (sumário, link do PDF, resultado da busca, miniatura, marca, nota, número de página, Home ou End no Kindle, Ler do início), um botão sobre o PDF leva de volta ao ponto onde você estava, e Alt + ← e Alt + → voltam e avançam entre esses pontos. O botão some depois de alguns segundos.',
  ],
  [
    'Realces e notas',
    'Para selecionar sem o mouse, ponha o foco nas páginas (Tab) e use Shift + ← e → para crescer a seleção por palavra, ou Shift + ↑ e ↓ por linha, na rolagem e no Kindle. Se ainda não há seleção, ela começa no primeiro texto à vista, ou onde você clicou; a tela acompanha o fim da seleção (no Kindle, vira). A seleção fica no texto das páginas. As teclas H (realçar na última cor usada, marcada na barra) e N (adicionar nota) fazem o mesmo que a barra de realce, avisam quando não há trecho selecionado, e Esc dispensa a barra e a seleção. Clique num realce, ou no ícone de nota na margem (as notas com texto), para editar a nota, mudar a cor, copiar o texto ou excluir o realce (com Desfazer). Uma seleção que passa de uma página gera um realce por página; para anotar, vale o trecho da primeira. A aba Notas da barra lateral busca no texto e nas citações, mostra a cor de cada realce, leva à página e à altura do trecho, pela citação ou por “Página N” (e Alt + ← volta) e exporta tudo em Markdown (“Exportar notas…”, também no menu do documento).',
  ],
  [
    'Documentos e etiquetas',
    'Na biblioteca, Tab leva ao documento ativo (abrir, favoritar e opções); os outros ficam fora da ordem de Tab. Use as setas para trocar de documento (na grade, nas quatro direções; na lista, ↑ e ↓), Home e End para ir ao primeiro e ao último, Enter para abrir e Espaço para selecionar. Clique com o botão direito em um documento, ou use Shift + F10 com o foco nele, para abrir as opções. Em “Etiquetas…” você agrupa documentos, e cada etiqueta vira um filtro na barra lateral da biblioteca. Com Ctrl + clique, Shift + clique (intervalo) ou a caixa que aparece no cartão, você seleciona vários documentos e favorita, conclui, etiqueta ou remove todos de uma vez.',
  ],
  [
    'Barra lateral do leitor',
    'A barra lateral (tecla S) reúne o sumário, que destaca a seção que você está lendo (Tab entra na lista e sai dela; as setas andam pelos itens, e → e ← abrem e fecham as seções), as miniaturas das páginas, as marcas (o botão de cada linha remove a marca, com Desfazer) e as notas. Arraste a borda dela, ou use as setas quando a borda estiver selecionada, para mudar a largura. Ela abre do jeito que você a deixou.',
  ],
];
const section = ([title, text]: string[]) => `<h3>${title}</h3><p>${text}</p>`;
export function showHelp() {
  modal(
    `<div class="scroll-dialog guide-view"><div class="dialog-heading"><div><span class="eyebrow">BEM-VINDO AO FÓLIO</span><h2 tabindex="-1" autofocus>Guia e atalhos</h2></div>${ib('close-help', 'Fechar guia', 'close', 'data-close')}</div><p>Um lugar tranquilo para seus PDFs, inteiramente no seu computador.</p>${TOPICS.map(section).join('')}<h3>Atalhos</h3><p>As teclas de uma letra (K, L, S, D, R, H e N) e o “?” podem ser desligados em Preferências, em “Atalhos de uma tecla”. F1 abre este guia sempre; no leitor, ele também está em “Mais opções”.</p><dl class="shortcuts">${SHORTCUTS.map(([k, v]) => `<div><dt>${v}</dt><dd><kbd>${k}</kbd></dd></div>`).join('')}</dl>${DETAILS.map(section).join('')}<p class="small-copy">A busca encontra texto existente no PDF; documentos digitalizados sem texto precisam de OCR externo. Para backup, copie a pasta inteira da biblioteca, incluindo o catálogo. PDFs removidos podem ser restaurados em “Removidos”, onde também podem ser excluídos de vez para liberar espaço: as cópias são excluídas, o original não é afetado e o histórico de leitura é mantido.</p><div class="dialog-actions"><button class="primary" data-close>Começar a ler</button></div></div>`,
  );
}
