import { ib } from './dom';
import { modal } from './overlays';
export function showHelp() {
  modal(
    `<div class="dialog-heading"><h2>Bem-vindo ao Fólio</h2>${ib('close-help', 'Fechar guia', 'close', 'data-close')}</div><p>Um lugar tranquilo para seus PDFs, inteiramente no seu computador.</p><div class="guide-block"><strong>1. Traga suas leituras</strong><p>Escolha PDFs ou uma pasta inteira (“Adicionar pasta”), ou arraste-os para a janela. Cada PDF é copiado para a biblioteca. O original nunca é alterado. A capa, o número de páginas e o autor aparecem sozinhos, um PDF por vez, enquanto você usa a biblioteca.</p><strong>2. Leia no seu ritmo</strong><p>A página, a posição e o zoom são salvos automaticamente. Use Brilho e Tela quente na barra de leitura para ajustar o conforto rapidamente. Nas preferências ficam as demais opções de aparência. Em telas largas, o botão ao lado do zoom (ou a tecla L) mostra duas páginas lado a lado na rolagem; as preferências deixam a capa sozinha. Ative Kindle no topo do leitor para passar por telas no zoom atual, com uma pequena sobreposição; o Kindle usa uma página por vez. A opção Unir conteúdo das páginas reduz margens vazias no Kindle e pode ser desativada nas preferências. O texto mantém sua diagramação; páginas digitalizadas também funcionam. Na tela cheia, leve o mouse ao topo ou à parte inferior para mostrar os controles. Em zoom muito alto, use a barra horizontal ou Shift + roda para ver as laterais. Depois de um salto (sumário, link do PDF, resultado da busca, miniatura, marca, nota, número de página, Home ou End no Kindle, Ler do início), um botão sobre o PDF leva de volta ao ponto onde você estava, e Alt + ← e Alt + → voltam e avançam entre esses pontos. O botão some depois de alguns segundos.</p><strong>3. Guarde o que importa</strong><p>Favorite documentos, marque páginas e anote suas ideias. Selecione um trecho no PDF e, na barra que aparece junto a ele, escolha uma das quatro cores para realçá-lo, Anotar ou Copiar; as teclas H (realçar na última cor) e N (anotar) fazem o mesmo, e Esc dispensa a barra. Clique num realce, ou no pequeno marcador das notas com texto, para editar a nota, mudar a cor, copiar o texto ou excluir o realce (com Desfazer). Uma seleção que passa de uma página gera um realce por página; para anotar, vale o trecho da primeira. A aba Notas da barra lateral busca no texto e nas citações, mostra a cor de cada realce, leva à página e à altura do trecho (e Alt + ← volta) e exporta tudo em Markdown (“Exportar notas”, também no menu do documento). Notas, realces e marcadores ficam na biblioteca, separados do PDF, que nunca é alterado. Clique com o botão direito em um documento, ou use Shift + F10 com o foco nele, para abrir as opções. Em “Etiquetas…” você agrupa documentos, e cada etiqueta vira um filtro na barra lateral da biblioteca. Com Ctrl + clique, Shift + clique (intervalo) ou a caixa que aparece no cartão, você seleciona vários documentos e favorita, conclui, etiqueta ou remove todos de uma vez. A barra lateral (tecla S) reúne o sumário, que destaca a seção que você está lendo, as miniaturas das páginas, as marcas e as notas. Arraste a borda dela, ou use as setas quando a borda estiver selecionada, para mudar a largura. Ela abre do jeito que você a deixou.</p><strong>4. Acompanhe sua leitura</strong><p>Use Concluir leitura no topo do leitor para marcar um livro como terminado. Metas de leitura na biblioteca permite definir uma meta diária geral, uma meta própria por livro ou nenhuma meta. O progresso de hoje também aparece no rodapé do leitor; clique nele para ajustar a configuração ou os totais do dia. Em Histórico de leitura, consulte o calendário, os dias com meta atingida e quantas páginas e capítulos leu em cada dia.</p></div><div class="shortcuts">${[
      ['Ctrl + O', 'Adicionar PDFs'],
      ['Ctrl + K', 'Buscar na biblioteca'],
      ['Ctrl + F', 'Buscar no PDF'],
      ['Ctrl + B', 'Marcar página'],
      ['Ctrl + + / −', 'Ajustar zoom'],
      ['K', 'Alternar modo Kindle'],
      ['L', 'Alternar duas páginas lado a lado'],
      ['← / → · Page Up / Down', 'Voltar / avançar tela no Kindle'],
      ['Espaço / Shift + Espaço', 'Avançar / voltar tela no Kindle'],
      ['Home / End', 'Início / fim no Kindle'],
      ['S', 'Mostrar ou esconder a barra lateral'],
      ['D', 'Alternar papel escuro'],
      ['R', 'Girar páginas'],
      ['H', 'Realçar o trecho selecionado, na última cor usada'],
      ['N', 'Anotar o trecho selecionado'],
      ['F11 / Esc', 'Entrar / sair da tela cheia'],
      ['Alt + ← / Alt + →', 'Voltar / avançar à posição de antes do salto'],
      ['Botões laterais do mouse', 'O mesmo que Alt + ← e Alt + →'],
      ['Ctrl + W', 'Voltar à biblioteca'],
      ['Shift + F10 / Menu', 'Abrir as opções do documento em foco'],
      ['Ctrl + clique · Shift + clique', 'Selecionar documentos (Shift marca o intervalo)'],
      ['Ctrl + A', 'Selecionar todos os documentos da tela'],
      ['Esc', 'Limpar a seleção da biblioteca, ou dispensar a barra de realce'],
      ['↑ / ↓ · Home / End · letra', 'Percorrer um menu de opções'],
      ['Esc / Tab', 'Fechar o menu (Esc devolve o foco ao botão)'],
    ]
      .map(([k, v]) => `<div><span>${v}</span><kbd>${k}</kbd></div>`)
      .join(
        '',
      )}</div><p class="small-copy">A busca encontra texto existente no PDF; documentos digitalizados sem texto precisam de OCR externo. Para backup, copie a pasta inteira da biblioteca, incluindo o catálogo. PDFs removidos podem ser restaurados em “Removidos”, onde também podem ser excluídos de vez para liberar espaço: as cópias são apagadas, o original não é afetado e o histórico de leitura é mantido.</p><button class="primary" data-close>Começar a ler</button>`,
  );
}
