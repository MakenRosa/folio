# Arquitetura e decisões

## Fluxo principal

1. O diálogo nativo (arquivos ou uma pasta), ou o arrastar e soltar, entrega caminhos escolhidos pelo usuário.
2. Um comando Tauri executa a importação fora da thread da interface. Pastas viram os PDFs que
   contêm, em qualquer profundidade (sem seguir links simbólicos nem junções); o andamento conta
   esses arquivos.
3. Rust copia cada arquivo em blocos de 256 KiB, calcula SHA-256 e verifica duplicatas. O resultado
   diz quais livros entraram e quais já existiam (id e título).
4. O catálogo guarda um UUID e os metadados. O caminho original deixa de ser necessário.
5. Uma fila em segundo plano (`src/library/`) abre os livros novos, ou sem capa ou número de
   páginas, um por vez, e grava capa, páginas, autor e (se ainda for o nome do arquivo) título.
6. Ao abrir um documento, a interface carrega PDF.js sob demanda e lê a cópia local.
7. O leitor envia página, coordenadas do PDF, zoom e rotação para o catálogo.

## Responsabilidades

| Área                   | Arquivos                                                            | Responsabilidade                                                 |
| ---------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Coordenação            | `src/main.ts`                                                       | Fluxos de abertura, fechamento, importação e edição de metadados |
| Interface              | `src/ui/`                                                           | Biblioteca, estrutura das telas, diálogos, atalhos e mensagens   |
| Preferências           | `src/preferences.ts`                                                | Compatibilidade, validação e armazenamento de opções visuais     |
| Leitor                 | `src/reader.ts`                                                     | PDF.js, leitura por faixas, busca, zoom, rotação e ciclo de vida |
| Abertura do PDF        | `src/pdf-source.ts`                                                 | Transporte por faixas e capa, comuns ao leitor e à fila          |
| Fila da biblioteca     | `src/library/metadata.ts`, `queue.ts`, `enrich.ts`                  | Título e autor plausíveis, fila que pausa e o trabalho por livro |
| Telas de leitura       | `src/reading/screens.ts`                                            | Cálculo de avanço, sobreposição e retorno nos limites            |
| Duas páginas           | `src/reading/spread.ts`                                             | Pares de páginas, páginas em vista e correspondência com PDF.js  |
| Barra lateral          | `src/reading/outline.ts`, `sidebar.ts`, `thumbnails.ts`             | Seção atual do sumário, limites de largura e de canvases         |
| Barra lateral (tela)   | `src/ui/outline-view.ts`, `thumbnail-list.ts`, `sidebar-resizer.ts` | Árvore do sumário, lista de miniaturas e alça de largura         |
| Progresso e ritmo      | `src/reading/progress.ts`, `src/reading/pace.ts`                    | Percentual único e tempo restante estimado                       |
| Voltar após saltos     | `src/reading/jumps.ts`, `src/ui/jump-pill.ts`                       | Pilhas de posições na sessão do documento e botão flutuante      |
| Inicialização nativa   | `src-tauri/src/main.rs`                                             | Janela, plugins e abertura da biblioteca                         |
| PDFs de fora           | `src-tauri/src/launch.rs`                                           | Argumentos da primeira e da segunda instância, estado e evento   |
| Comandos nativos       | `src-tauri/src/commands.rs`                                         | Contratos IPC e execução de operações locais                     |
| Domínio e persistência | `src-tauri/src/library.rs`                                          | Importação, catálogo, recuperação, notas e marcadores            |

## Escolhas e limites

**Tauri e WebView2.** O aplicativo reutiliza o WebView2 do Windows. Isso mantém o
instalador pequeno, mas seu tamanho não representa a memória total do processo
nem o espaço ocupado pelo runtime compartilhado.

**TypeScript sem framework de interface.** O número de telas é pequeno. Módulos
com responsabilidades explícitas mantêm a implementação direta. `main.ts` continua
como coordenador dos fluxos; a refatoração não pretende criar uma arquitetura
genérica de plugins ou um sistema distribuído.

**Catálogo JSON.** O volume esperado é de uma biblioteca pessoal e as alterações
são serializadas por um mutex nativo. Cada gravação usa arquivo temporário,
sincronização e substituição do catálogo. Há backup e recuperação. O custo de
reescrever o catálogo cresce com a biblioteca; não há benchmark que justifique
prometer desempenho constante para centenas de milhares de entradas.

**Leitura por faixas.** O transporte explícito de PDF.js evita depender da descoberta
de suporte a Range no protocolo local. Os pedidos são divididos em blocos limitados.
Canvases são renderizados sob demanda, com teto de 8 megapixels por canvas.

**Retomada.** Coordenadas do próprio PDF preservam a posição melhor que um deslocamento
global de pixels quando o zoom ou o tamanho da janela muda. Há debounce de gravação
durante a leitura e salvamento final no fechamento normal.

**Controles de leitura.** `src/ui/reading-comfort.ts` compartilha as preferências
de brilho e tela quente com o diálogo de aparência. Tema, papel, modo Kindle,
conforto e opções da biblioteca continuam na chave existente `lume.preferences`.
`src/ui/reader-chrome.ts` acompanha a tela cheia nativa e revela cada barra pela
borda correspondente ou pelo foco do teclado. Os menus sobrepõem a área do leitor,
sem redimensionar o PDF quando aparecem. Busca e ajustes abertos mantêm os controles
acessíveis; a animação respeita a preferência de movimento reduzido do sistema.
A tela cheia é um estado da janela, não uma preferência restaurada na abertura.
`tauri-plugin-window-state` lembra tamanho, posição e se a janela estava maximizada, sem
`FULLSCREEN`; ao fechar em tela cheia, o frontend sai dela antes de destruir a janela, para que
o tamanho guardado seja o da janela e não o do monitor. Depois da restauração, `main.rs`
confere se a janela cabe em algum monitor e, se não couber, reduz e centraliza.

**PDFs vindos do Explorer.** O PDF chega como argumento da linha de comando. `launch.rs` resolve
os caminhos (os relativos pela pasta do processo que foi iniciado), mantém só os `.pdf`
existentes e os guarda em `PendingFiles`. O evento `open-files`, emitido quando uma segunda
instância entrega seus argumentos, só avisa que há arquivos: o frontend os pega com
`take_pending_files`, que esvazia a lista. O estado existe porque o aviso pode chegar antes de a
janela escutar (o Explorer abre vários arquivos selecionados em vários processos quase juntos).
No frontend, `openLaunched` importa por `import_pdfs`, abre o primeiro livro com `openBook` e
espera uma importação ou um livro em carga.

**Modo Kindle.** A área visível avança sobre uma sequência de páginas sem intervalos
externos. Há sobreposição para recuperar linhas cortadas, alinhamento a pixels
físicos e tratamento do último trecho parcial. A junção reduz as margens vazias
superiores e inferiores usando uma miniatura do canvas já renderizado. Texto e
áreas de anotações limitam o recorte, incluindo texto claro. Páginas em branco,
fundos incertos e texto girado/inclinado mantêm as dimensões completas. Cabeçalhos,
rodapés e imagens não são descartados. Não é conversão de PDF em EPUB.

O recorte existe somente na área de exibição em memória do PDF.js. As camadas
de seleção, busca e navegação usam as mesmas coordenadas do documento. Um cache
local descartável guarda até mil páginas por documento e oito documentos; ele
evita refazer análises e recompõe os tamanhos ao retomar a leitura. Nenhuma página
é rasterizada só para detectar margens, e os bytes do PDF continuam intactos.

**Aberturas de capítulos.** O sumário fornece páginas de início, com deduplicação
de títulos e subtítulos na mesma página. Cabeçalhos explícitos de capítulo também
são reconhecidos nas primeiras linhas de páginas já renderizadas. Não há OCR nem
varredura de texto de todo o documento. Sem sumário ou cabeçalho reconhecível, a
página continua unida às demais. A opção pode ser desativada independentemente da
redução de margens.

O recorte temporário da área visível impede mostrar o próximo capítulo no rodapé
da tela atual. O avanço só alcança esse início depois que todo o trecho anterior
pôde ser visto. O próximo título alinha ao topo, e a volta recupera o último trecho.
Os pontos de separação acompanham as dimensões atuais das páginas; não são
gravados como coordenadas de leitura e não alteram o arquivo. Essa função separa
páginas de abertura completas, não subdivide uma página que contenha vários títulos.

**Offline durante o uso.** PDFs, fontes e módulos de renderização estão locais.
Desenvolvimento e instalação de dependências usam a rede. Links externos no PDF
não são abertos automaticamente. Não há conta, sincronização ou backend remoto.

**Conclusão e metas.** A conclusão é uma escolha explícita independente da posição.
`src/reading/goals.ts` trata a data local, a contagem e a herança da configuração
global. A meta geral fica nas preferências existentes; a exceção por livro e os
registros diários ficam no catálogo. Campos novos recebem valores padrão ao abrir
catálogos antigos, sem migrar arquivos ou alterar os bytes dos PDFs.

Uma amostra por segundo acompanha a página atual apenas com foco no leitor e sem
diálogo, busca ou menu aberto. Oito segundos qualificam uma página; IDs evitam
contagem repetida no mesmo dia. Uma transição adjacente para um início de capítulo
reconhecido qualifica o anterior. O último capítulo pode ser contado na tela final.
Os inícios são compartilhados com a navegação por capítulos, inclusive em rolagem
contínua, sem varredura integral do PDF. PDFs sem títulos ou sumário reconhecível
precisam do ajuste manual. Esses critérios estimam atividade, sem inferir compreensão.

O registro mantém IDs de páginas/capítulos e ajustes dos totais, preservando a
deduplicação depois de uma correção manual. Os totais históricos são mantidos; após 31 registros, IDs são compactados em
totais. O limite defensivo do catálogo é de 36.500 dias por livro.
O backend valida datas, limites e IDs antes da gravação atômica. Mudanças de
configuração não apagam o registro e a conclusão não gera crédito retroativo.

**Histórico.** `src/reading/history.ts` resolve a configuração por data local.
Alterações da meta geral ficam em uma linha do tempo nas preferências, e as
alterações por livro ficam no catálogo. A inicialização adiciona o primeiro
registro aos livros existentes em uma única gravação, sem inventar metas antigas.
A configuração final de cada dia prevalece naquele dia. Totais de livros
removidos continuam disponíveis no histórico, assim como os de livros excluídos
definitivamente (ver **Biblioteca que escala**). O calendário calcula somente o
mês exibido, sem carregar PDFs. A leitura de páginas e capítulos também é
acompanhada sem meta, usando o relógio monotônico para medir tempo ativo.

**Progresso e tempo restante.** `src/reading/progress.ts` é a única definição do
percentual: da primeira página (0%) à última (100%), com `finished` em 100%. Usa só
`page`, `pages` e `finished`, que o catálogo já guarda, por isso o rodapé (rolagem e
Kindle), o cartão Continuar leitura e as barras da biblioteca coincidem. O percentual
de rolagem do contêiner foi abandonado porque muda com a janela, o zoom e a junção de
páginas. Ao chegar ao fim do documento, o leitor mostra 100% mesmo quando a última tela
começa na penúltima página; a biblioteca não tem esse dado, e a diferença só existe
nesse caso. Guardar uma fração dentro da página exigiria medir cada página, e o
catálogo continua intacto.

`src/reading/pace.ts` mede segundos por página com a mesma amostra por segundo das
metas (foco, sem diálogo, busca ou menu). Uma página só é medida ao chegar a ela e sair
dela por passos curtos para frente (até três páginas, porque telas do Kindle podem
pular uma). A primeira página da sessão, saltos, retornos, interrupções, trocas de
livro e pausas do relógio não geram medida. Abaixo de 3 s a página só foi folheada; acima de
4 min conta 4 min, e acima de 10 min é pausa e é descartada. A média é simples no
início e móvel (cerca de dez páginas) depois, com limite para valores extremos. Fica em
`lume.preferences`, por livro, com até 50 livros (os menos recentes saem primeiro),
normalizada ao carregar. Há estimativa com cinco páginas medidas. O tempo conta a página
atual; o capítulo termina no próximo início de `reader.chapterStarts`. Como esses inícios
vêm do sumário e das páginas já renderizadas, o fim do capítulo pode ser mais distante
que o real. O último capítulo e livros sem capítulos reconhecidos mostram só o livro.

**Duas páginas lado a lado.** `spread` é uma preferência global (`none`, `odd`,
`even`) que usa o `spreadMode` do `PDFViewer`: `odd` forma os pares 1–2, 3–4, e `even`
deixa a página 1 sozinha e forma 2–3, 4–5 (a capa separada). Só vale na rolagem. O Kindle
depende de uma coluna, porque junta páginas e calcula as telas pelo deslocamento; ao
ativá-lo, `Reader.setMode` aplica a página única no viewer sem alterar a preferência, e a
volta à rolagem a restaura. A ordem é a mesma da junção: primeiro as caixas das páginas,
depois a disposição, e então `restoreAnchor` devolve o ponto de leitura em coordenadas do
PDF. Em um par, esse ponto fica na página da esquerda, que tem o topo da linha. PDF.js
refaz "Largura da página" e "Página inteira" para o par. Os pares usam margens e um
preenchimento menores em `ui.css`, para que a largura de dois PDFs caiba sem barra
horizontal.

Página anterior e próxima, as setas e os botões usam `nextPage()` e `previousPage()` do
PDF.js, que avançam um par e, se só uma das páginas está inteira na tela, uma página. O
botão do início e do fim considera o par da página atual. `spreadPages` repete o
agrupamento do PDF.js (com um teste que copia o laço dele) para os limites e para
as metas. A página "atual" de PDF.js pode ser qualquer uma do par, então o leitor
acompanha a primeira do par como identidade da tela.

As metas contam as duas páginas em vista. Decisão: as duas estão na tela pelo mesmo
tempo, e contar só uma exigiria 40 páginas para uma meta de 20, o que pune quem lê em
monitor largo. Uma página do par conta quando metade da largura e um quarto da altura
(ou da janela, se menor) estão visíveis, então um zoom alto em que só uma página cabe
volta a contar uma. `ReadingActivity` recebe `page` e `last` e devolve listas de páginas
e capítulos. Um capítulo que começa na segunda página do par (o caso comum em livros, em
páginas ímpares com a capa separada) conclui o capítulo anterior quando o par qualifica;
um início na primeira página conclui o anterior na chegada, como na página única. O ritmo
recebe a primeira página do par, então dois passos de duas páginas medem segundos por
página, dentro do limite de três páginas. Notas com trecho selecionado usam a página
do trecho (`data-page-number`), não a página "atual".

**Voltar após saltos.** `src/reading/jumps.ts` guarda duas pilhas (voltar e avançar, até 50
posições cada, só na memória e só enquanto o documento está aberto). Uma posição é a âncora
em coordenadas do PDF que o leitor já usa (`pageNumber`, `top`, `left`), por isso vale depois de
mudar o zoom, a rotação ou o modo; `Reader.restoreAnchor` a restaura, zerando o retorno de borda
do Kindle. `Reader` registra a posição de partida antes do salto e a mantém só se a chegada
ficou em outra página (ou, nos destinos de links e do sumário, a mais de uma tela na mesma
página); um salto mantido limpa o avançar. Os links internos, o sumário e as ações nomeadas
`FirstPage`, `LastPage`, `GoBack` e `GoForward` passam pelo `PDFLinkService`, cujos
`goToDestination`, `goToPage` e `executeNamedAction` são embrulhados no construtor. `jumpTo`
atende miniaturas, marcas, notas, o campo de página e "Ler do início"; `boundary`, Home e End
do Kindle. Na busca, a posição de partida é guardada ao chamar `find` e só vira salto no primeiro
resultado encontrado em outra página; os resultados seguintes da mesma busca não contam, e
fechar a busca, outro salto ou voltar encerram a "sessão". Rolar e virar página (`turn`,
`turnPair`, `goTo`) não passam por aqui. `main.ts` zera o `PaceTracker` a cada salto; as metas
já ignoram as páginas intermediárias, que nunca estão na tela. O botão (`src/ui/jump-pill.ts`)
fica dentro de `#viewer-wrap`, em posição absoluta, para não deslocar o PDF. Alt + ← e
Alt + →, e os botões laterais do mouse (capturados no documento para o WebView não os tratar
como navegação), chamam `Reader.back` e `Reader.forward`.

**Barra lateral.** `src/reading/outline.ts` resolve uma vez cada destino do sumário para
um número de página (`resolveOutline`); a mesma árvore alimenta os inícios de capítulo
(`ChapterBreaks.outline`) e o destaque da seção, sem duplicar a leitura de destinos
nomeados e referências. A seção atual é o último item, na ordem do sumário, que começa na
página atual ou antes dela (`current.page`, a mesma do rodapé): um capítulo novo encerra as
subseções do anterior, e na mesma página vence o mais fundo ou o posterior. Itens sem página
(link externo, destino quebrado) nunca são marcados. Por padrão ficam abertos só o primeiro
nível e os ramos que contêm a seção; o usuário abre e fecha à mão, e entrar em outra seção
reabre o caminho até ela. A lista é um DOM construído uma vez; mudar de página só troca
`aria-current` e rola até o item com `block: 'nearest'`, apenas quando a seção muda, para não
puxar a lista de volta enquanto o usuário a explora. Depois de clicar num item, PDF.js foca o
texto da página de destino quando ela é desenhada; isso é dele e não foi alterado.

As miniaturas (`Reader.thumbnail`) desenham a página inteira, com a rotação do leitor, em
130 px de largura (até o dobro de pixels em telas densas), sem tocar nas páginas do viewer.
Um `IntersectionObserver` pede só as páginas perto da área visível; um desenho por vez, o
mais próximo do meio primeiro. Há um teto de 16 canvases vivos (`THUMBNAIL.maxLive`): os mais
antigos fora da vista são liberados (largura e altura zeradas, para devolver a memória na
hora) e os que estão na vista nunca saem. Sair da vista cancela o desenho em andamento, e
fechar o livro, trocar de aba ou esconder a barra cancela tudo (`Reader.destroy` também). Depois
de cada desenho, `page.cleanup()` libera o que a página decodificou, como imagens grandes.
Cada botão nasce com um espaço na proporção da primeira página, a mesma que PDF.js assume, e
toma a forma real quando a página é desenhada; num PDF com páginas de tamanhos diferentes a
lista pode se deslocar um pouco. O Kindle recorta as páginas na área de exibição, mas a miniatura
usa o retângulo original (`fullViewport`). A lista tem um botão por página, sem virtualização
do DOM: é leve até alguns milhares de páginas, e só os desenhos são limitados.

O estado da barra (aberta, aba e largura) é uma preferência global, normalizada, e vale para
qualquer livro. A janela só limita o que é mostrado: a largura é `min(--sidebar-width, 40vw)`
em CSS, então encolher a janela não regrava a preferência e a largura escolhida volta numa
janela maior. Arrastar ou usar as setas na alça apenas mostra a largura; ela é gravada ao
soltar. O `ResizeObserver` do viewer e a chamada final a `reader.resize()` refazem o zoom
"Largura da página", e PDF.js mantém a posição pelas coordenadas do documento, o que vale
para a rolagem, as duas páginas e o Kindle. A tecla S e os atalhos da barra não disparam ao
digitar, e as setas da alça, das abas, do sumário e das miniaturas não viram páginas.

**Menus e painéis flutuantes.** `#popover` (`popover()` em `src/ui/overlays.ts`) serve ao
menu de opções do documento e aos ajustes rápidos de Brilho e Tela quente. A posição vem de
`placePopover` (`src/ui/popover-position.ts`), uma função sem DOM: abre abaixo do âncora quando
cabe, acima quando não cabe, e fica sempre a 8 px das bordas da janela. Se nenhum lado comporta
o painel, ele usa o lado maior com `max-height` e rolagem interna, e só sem espaço útil em
nenhum lado (menos de 120 px) cobre o âncora. O painel é medido com a altura natural e
posicionado antes de aparecer. Rolar o contêiner do âncora ou redimensionar a janela fecha o
painel, que não é reposicionado. Rolar dentro dele não fecha.

Com `menu: true` o painel recebe `role="menu"`, os botões viram `menuitem` com `tabindex="-1"`,
e o botão de origem ganha `aria-haspopup="menu"` e `aria-expanded`. O foco vai ao primeiro item.
`src/ui/menu-navigation.ts` (também sem DOM) decide o destino de setas, Home, End e letras, e
pula itens desabilitados. Tab fecha o menu e devolve o foco ao dono antes de seguir, e Esc, tratado
em `shortcuts.ts`, fecha o menu antes da busca e da tela cheia. As teclas de leitura (setas, K, L,
S, R) não agem com o foco num menu. O dono do foco fica em `dataset.owner` (id); o menu do
cartão pode ter como dono o controle que estava em foco, diferente do botão que o ancora. Os
ajustes de Brilho e Tela quente continuam sendo `role="dialog"`, com o foco no controle.

O menu do cartão (`bookMenu` em `main.ts`) é o mesmo para o botão "⋯", o botão direito (no
ponteiro), Shift + F10 e a tecla Menu (junto ao cartão) e o botão do leitor. Nos Removidos
oferece Restaurar e Excluir definitivamente. O menu do sistema do WebView é suprimido sobre os
cartões e o painel.

**Biblioteca que escala.** O catálogo (`library.json`) ganhou `tags` em cada livro (`#[serde(default)]`;
validadas em `normalize_tags`, que apara espaços, descarta vazias e repetidas ignorando maiúsculas e
acentos, e recusa mais de 20 etiquetas ou uma com mais de 40 caracteres) e a lista `archived`, de
registros mínimos (`id`, `title`, `author`, `readingDays`, `goalHistory`) dos livros excluídos
definitivamente. `Snapshot` devolve `archived`, e `history()` em `main.ts` o soma aos livros e aos
Removidos (`src/library/archive.ts` o põe no formato de um livro). A importação compara o hash só
com a biblioteca e Removidos, nunca com `archived`.

Os comandos em lote são `update_books` (uma lista de `{id, patch}` com o mesmo `Patch` de
`update_book`, validada inteira antes de gravar), `remove_books`, `restore_books` e `purge_books`.
Todos copiam o catálogo, alteram a cópia e gravam uma só vez, de forma atômica (arquivo temporário e
backup); se um item falhar, nada é gravado. `purge_books` só aceita livros de Removidos: grava o
catálogo sem eles (e com os registros em `archived`), depois apaga `pdfs/<id>.pdf` e
`covers/<id>.png` e devolve `{purged, freed, failed}`. Um arquivo que não pôde ser apagado vai em
`failed`, sem desfazer o catálogo; um que já não existia é ignorado. Só nomes simples de arquivo são
apagados.

No cliente, `src/library/` tem a lógica pura: `tags.ts` (chaves, limites, contagens, sugestões),
`search.ts` (onde um livro foi encontrado: `book` ou só `notes`) e `selection.ts` (intervalos e
poda da seleção). `library-view.ts` desenha a lista, as etiquetas da barra lateral (redesenhadas só
quando mudam, para o foco não se perder) e `updateSelection`, que atualiza as caixas dos cartões e a
barra de ações sem redesenhar a lista. A seleção (um `Set` de ids em `main.ts`) é podada a cada
desenho para o que está na tela, e é limpa ao trocar de filtro e ao abrir um livro. Ctrl + A e Esc
ficam em `shortcuts.ts`. Os diálogos são `tags-dialog.ts` e `purge-dialog.ts`.

**Importação pronta.** `src/library/queue.ts` processa um PDF por vez e para quando um livro é aberto
(o trabalho em curso é cancelado e volta ao início da fila; retomar espera 300 ms). Cada livro é
tentado uma vez por sessão: senha ou arquivo inválido são ignorados em silêncio. `enrich.ts` abre
a cópia com `openPdfSource`, desenha a página 1 com cerca de 240 px, grava a capa (`save_cover`)
e o resto (`update_book`) e libera o documento. A regra do título e do autor é pura
(`src/library/metadata.ts`): o título do PDF só vale se o do livro ainda for o nome do arquivo
sem extensão e se for plausível. O cartão é atualizado no lugar (`updateBookCard`), sem perder
a rolagem nem o foco; a lista inteira só é redesenhada se o novo texto muda a ordem por título
ou o resultado de uma busca.

**Avisos e erros.** `toast()` (`src/ui/toast-stack.ts`, reexportada por `overlays.ts`) empilha
até três avisos em `#toast`, a região `aria-live="polite"` que fica sempre no DOM. Cada aviso
tem o próprio relógio, pausado pelo ponteiro ou pelo foco; a ação vem antes do botão
`.toast-close`. `fail()` usa `describeError` (`src/ui/error-text.ts`, sem DOM): o texto técnico
do Rust, do Windows (`os error N`) ou do PDF.js vira uma frase em português, e o original fica
em "Detalhes". Erros usam `role="alert"` e não somem sozinhos. O andamento da importação vai
para o botão `#import-main` (`src/ui/import-progress.ts`), sem um aviso por arquivo. As dicas
mostradas (`hints` nas preferências, nomes em `src/hints.ts`) não voltam.

## Desenvolvimento assistido

O projeto foi desenvolvido com assistência de IA para implementação, refatoração
e testes, a partir de necessidades reais de leitura e feedback sobre o uso. As
decisões acima, os limites e os resultados de teste são documentados para permitir
revisão. A existência de testes não equivale a uma auditoria independente.

**Notas e realces no texto.** `Note` ganhou `rects` (uma lista de `[x1, y1, x2, y2]` em unidades do PDF,
uma linha de texto cada) e `color` (`yellow`, `green`, `blue` ou `pink`), ambos opcionais e omitidos
na gravação das notas antigas. `notes::normalize` (`src-tauri/src/notes.rs`) valida o conjunto no
`Patch`: números finitos e limitados, no máximo 500 retângulos por nota e 100 000 por documento, cor
do conjunto, e uma nota sem retângulos perde a cor. O texto pode ser vazio num realce.

No cliente, `reading/selection-capture.ts` lê a seleção página a página: para cada `.page` que a
seleção toca, usa um `Range` limitado à camada de texto dela, junta os retângulos de `getClientRects()`
por linha (`mergeLineRects`, em `reading/note-rects.ts`) e os converte para o PDF com
`viewport.convertToPdfPoint`, de modo que o mesmo realce vale em qualquer zoom, rotação ou modo. A
junção de margens do Kindle (`joined-pages.ts`) só troca o `viewBox` da página, e `convertToPdfPoint`
e `convertToViewportRectangle` já o consideram: o realce usa as coordenadas do documento e o que fica
numa margem recortada simplesmente cai fora da camada (`overflow: clip`). `reading/note-layer.ts` desenha
uma camada `.note-layer` por página, como último filho do `.page`, em porcentagens da página, e a
refaz em `pagerendered`, `scalechanging`, `rotationchanging` e depois de `setMode` e `relayout`, já
que o PDF.js apaga o que não conhece ao redesenhar. A camada ignora o ponteiro; o clique num realce
é encontrado pela posição (`getBoundingClientRect` das marcas), e só o marcador das notas com texto é
um botão. A mistura é `multiply` nos papéis claro e sépia e normal, com cores translúcidas, no escuro,
que inverte as cores do canvas. `Reader.jumpToNote` leva ao realce com `scrollPageIntoView` e entra no
histórico de saltos (`leave` e `arrive`). A barra flutuante é `ui/selection-bar.ts` (posicionada por
`placePopover`), o menu é `ui/note-menu.ts` (o `popover` com `menu: true`) e a aba é `ui/notes-panel.ts`.

`export_notes(id, destination, offsetMinutes?)` gera o Markdown com `notes::markdown` (mesma ordem de
leitura de `noteOrder`), exige `.md` e grava com `tempfile` na pasta do destino seguido de `persist`.
O fuso vem do cliente porque o catálogo guarda só instantes.
