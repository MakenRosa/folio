# Fólio

[![Validação Windows](https://github.com/MakenRosa/folio/actions/workflows/ci.yml/badge.svg)](https://github.com/MakenRosa/folio/actions/workflows/ci.yml)

Leitor de PDF para Windows com biblioteca local, retomada de leitura e controles
de conforto. Feito com Tauri 2, Rust, TypeScript e PDF.js, sem conta ou servidor.

O projeto nasceu de uma necessidade cotidiana: guardar uma cópia dos livros,
continuar de onde a leitura parou e reduzir o brilho sem inverter o papel.
O modo Kindle acrescenta avanço por telas no zoom atual, inclusive quando uma
tela atravessa a divisão entre duas páginas do PDF.

![Biblioteca do Fólio com documentos artificiais](docs/media/biblioteca.png)

[Demonstração](docs/demo.md) · [Arquitetura](docs/architecture.md) ·
[Resultados dos testes](VALIDATION.md) · [Como contribuir](CONTRIBUTING.md)

## O que está implementado

- Importação de um ou vários PDFs, ou de uma pasta inteira com as subpastas
  (**Adicionar pasta**), por diálogo ou arrastar e soltar. Cada arquivo é copiado
  para a biblioteca; SHA-256 evita duplicatas de conteúdo. Links simbólicos e
  junções dentro da pasta não são seguidos, e arquivos que não são PDF são ignorados.
- A importação já entrega a biblioteca pronta: uma fila em segundo plano, um PDF
  por vez e parada enquanto um documento está aberto, gera a capa e lê o número de
  páginas e o autor (e o título, se você ainda não renomeou o documento). Os cartões
  se atualizam sozinhos. PDFs com senha ou inválidos ficam como estão. O resumo diz
  qual documento já existia ("Mostrar") e abre o documento recém-adicionado ("Abrir").
- **Abrir pelo Explorer.** O instalador coloca o Fólio na lista **Abrir com** dos arquivos `.pdf`,
  sem torná-lo o programa padrão: a escolha do Windows (Configurações > Aplicativos padrão) fica
  como estava, e você decide se quer mudar. Um PDF aberto assim, ou mandado ao Fólio já aberto,
  entra pela importação de sempre (cópia para a biblioteca, sem duplicatas) e abre na hora, mesmo
  sobre outro documento, que tem a posição salva. Com vários arquivos, o primeiro abre e o aviso resume
  o resto; se uma importação estiver em andamento, eles esperam por ela.
- A janela lembra o tamanho, a posição e se estava maximizada. A tela cheia não é lembrada, e uma
  janela que não cabe mais nos monitores (outro monitor, resolução menor) volta menor, ao centro.
- Busca na biblioteca (por título, autor, nome do arquivo, etiquetas ou texto das notas), grade/lista, ordenação,
  favoritos, concluídos, renomeação, exportação de cópia e restauração de documentos removidos.
- **Biblioteca que escala.** **Etiquetas…** no menu do documento abre um diálogo (Enter adiciona,
  cada etiqueta tem o botão de remover, e as já usadas são sugeridas). Cada documento aceita até 20
  etiquetas de até 40 caracteres; maiúsculas e acentos não distinguem duas etiquetas ("Ficção" e
  "ficcao" são a mesma). A seção **Etiquetas** da barra lateral lista todas, com a contagem, e cada
  uma filtra a biblioteca. Os cartões mostram as primeiras etiquetas sob o autor. A busca também
  encontra etiquetas e notas (o texto e a citação); quando só as notas respondem, o cartão diz
  "Encontrado nas notas".
- **Seleção múltipla.** Ctrl + clique marca ou desmarca um cartão, Shift + clique marca o intervalo
  até ele, e a caixa que aparece no cartão (ao passar o mouse ou com o foco) faz o mesmo; Ctrl + A
  marca todos os documentos da tela, e Esc limpa a seleção. Um clique simples continua abrindo o
  documento. Uma barra fixa no pé da biblioteca mostra "N selecionados" e as ações em lote, gravadas de
  uma só vez: **Favoritar**, **Marcar como concluído**, **Adicionar etiqueta**, **Remover da
  biblioteca** (com **Desfazer** para todos) e **Limpar seleção**. Em Removidos, as ações são
  **Restaurar** e **Excluir definitivamente**. A seleção vale para o que está na tela: trocar de
  filtro a limpa, e uma busca ou um filtro que esconde um cartão o tira da seleção.
- **Cartões e calendário pelo teclado.** Os cartões da biblioteca são uma parada de Tab só (o cartão
  ativo; nele, Tab percorre o botão do documento, o favorito e as opções). As setas movem o foco entre
  os cartões (na grade, nas quatro direções, pela posição real na tela; na lista, ↑ e ↓), Home e End
  vão ao primeiro e ao último, Enter abre e Espaço marca o cartão (Shift + Espaço, o intervalo). No
  calendário do histórico os dias também são uma parada de Tab só: ← → andam um dia, ↑ ↓ uma semana,
  Home e End vão ao começo e ao fim da semana, Page Up e Page Down trocam de mês, e Enter ou Espaço
  escolhem o dia.
- **Esvaziar Removidos.** O botão no topo de Removidos e **Excluir definitivamente** no menu de cada
  item excluem, depois de uma confirmação que mostra quantos documentos são e quanto espaço
  liberam, as cópias de `pdfs/` e as capas de `covers/`. O catálogo é gravado primeiro, sem os
  documentos; se um arquivo não puder ser excluído, o documento sai do catálogo mesmo assim e o aviso
  diz quais arquivos ficaram. O arquivo original, fora da biblioteca, não é afetado, e o histórico
  de leitura é mantido. Reimportar o mesmo PDF depois cria um documento novo.
- Busca textual no PDF, seleção, sumário, zoom, rotação, marcas e notas.
- **Barras do leitor.** O cabeçalho tem Voltar, o título, **Concluir leitura**, o favorito e o
  menu **⋯**. A barra de ferramentas tem, à esquerda, a barra lateral, a busca e a página; à
  direita, o zoom, o modo **Kindle** e as **duas páginas**, a marca da página, **Aparência** e a
  tela cheia. O menu **⋯** reúne **Ler do início**, **Girar página** (tecla R, com **Desfazer**),
  Meta de leitura…, Renomear na biblioteca…, Etiquetas…, Exportar uma cópia…, Exportar notas…,
  Preferências…, Guia e atalhos… (F1) e Remover da biblioteca. O rodapé mostra o progresso à
  esquerda e, à direita, a meta do dia e **Adicionar nota**.
- **Notas e realces no próprio texto.** Ao selecionar um trecho (com o mouse ou pelo teclado), uma
  barra pequena aparece junto à seleção (acima da primeira linha, quando há espaço), sem cobri-la nem sair da janela: **Realçar** em
  amarelo, verde, azul ou rosa, **Adicionar nota** (abre a nota com a citação e as linhas do trecho) e
  **Copiar**. Ela some ao desfazer a seleção, ao rolar, ao clicar fora e com Esc. Com um trecho
  selecionado, **H** realça na última cor usada e **N** adiciona uma nota (sem trecho, avisam como
  selecioná-lo). Pelo teclado, com o foco nas páginas, **Shift + ← →** cresce a seleção por palavra
  e **Shift + ↑ ↓** por linha, na rolagem e no Kindle (as setas sem Shift continuam virando páginas ou
  telas); sem seleção, ela começa no primeiro texto à vista, fica no texto das páginas e a tela
  acompanha o fim dela. O realce é desenhado sobre a página
  em uma camada que não atrapalha a seleção nem os links, acompanha o zoom, a rotação, as duas
  páginas lado a lado, o modo Kindle e a junção de margens, e é legível nos papéis claro, sépia e
  escuro. Uma nota com texto ganha um pequeno ícone de nota na margem. Clicar num realce (ou no
  ícone) abre um menu: **Editar nota**, **Mudar cor**, **Copiar texto** e **Excluir realce**, com
  **Desfazer** no aviso. Uma seleção que atravessa páginas vira um realce por página; ao anotar,
  vale o trecho da primeira página. A aba **Notas** da barra lateral tem busca (texto e citação,
  sem diferenciar maiúsculas e acentos), a cor de cada realce ("Realce" quando não há texto) e o menu
  da nota; clicar leva à página e à altura do realce, e isso conta como salto (Alt + ← volta).
  **Exportar notas…** (na aba e no menu do documento) grava um arquivo `.md` com o título, o autor,
  e as notas por página, cada uma com a citação, o texto e a data.
- Tela cheia com barras ocultas, reveladas pelo mouse nas bordas ou pelo teclado.
  Os controles aparecem sobre o PDF sem deslocar a leitura, e uma linha fina na borda inferior
  mostra o progresso enquanto eles estão ocultos. F11 alterna a tela cheia.
- Retomada opcional de página, posição e zoom por documento.
- **Concluir leitura** no topo do leitor, com opção de desfazer, sem perder a posição.
- **Metas de leitura** diárias em páginas ou capítulos. A meta geral conta toda a leitura
  do dia, em qualquer documento, também nos de Removidos e nos excluídos definitivamente.
  Cada documento fica sem meta própria (só entra na meta geral) ou tem uma meta própria, que
  também entra na meta geral. A biblioteca mostra o progresso da meta geral; o rodapé do
  leitor mostra o da meta do documento, quando ele tem uma, ou o da geral. O diálogo tem duas
  partes, cada uma com o seu **Salvar**: **Meta geral** (quantidade em páginas ou capítulos, ou
  sem meta geral, com o progresso de hoje e uma barra) e, quando ele é aberto a partir de um
  documento (menu do cartão, menu ⋯ ou rodapé do leitor), **Este documento**, com "Sem meta
  própria" ou "Meta própria". Não há lista de documentos para escolher: para configurar outro,
  abra o menu dele. **Ajustar leitura de hoje** (do documento aberto; pela biblioteca, o
  documento é escolhido no próprio ajuste) e **Como a contagem funciona** ficam recolhidos no
  fim, e **Ver histórico** é um link junto ao título.
- Interface clara/escura/sistema, papel claro/sépia/escuro, tela quente e brilho
  da leitura de 10% a 100%, combináveis e salvos automaticamente. O botão **Aparência**, na
  barra de leitura, abre um painel com o papel, o brilho (**Restaurar**), a tela quente
  (**Desativar**) e **Mais preferências…**, que leva à seção Aparência das Preferências; um ponto no
  ícone avisa que o brilho ou a tela quente estão alterados. A tecla D percorre os papéis.
- Modo Kindle com avanço instantâneo por telas e pequena sobreposição para
  preservar linhas cortadas. A opção **Unir conteúdo das páginas**, ativada por
  padrão, reduz margens vazias entre páginas. Aceita teclado e roda do mouse.
- **Capítulos em nova tela** separa páginas de abertura reconhecidas pelo sumário
  ou por cabeçalhos explícitos. O título aparece junto ao começo do capítulo,
  após a última tela do trecho anterior. Pode ser desativado nas preferências.
- **Progresso e tempo restante.** O percentual vai de 0% na primeira página a 100%
  na última, ou em documentos concluídos, e é o mesmo no rodapé do leitor (rolagem e
  Kindle) e na biblioteca. Depois de cinco páginas lidas de um documento, o rodapé e a
  faixa Continuar estimam o tempo restante no capítulo, quando há capítulos
  reconhecidos, e no documento.
- **Duas páginas lado a lado** na rolagem contínua, para monitores largos. Escolha
  **Duas páginas** ou **Duas páginas, capa separada** (a página 1 fica sozinha) no
  botão ao lado do zoom, na tecla L ou nas preferências; a escolha vale para todos os
  documentos e fica salva. Página anterior e próxima, as setas e os botões avançam por
  par, e "Largura da página" e "Página inteira" consideram o par. O modo Kindle usa
  uma coluna: ao ativá-lo a disposição fica de lado e ela volta quando você retorna à rolagem.

- **Barra lateral do leitor** com Sumário, Páginas, Marcas e Notas, que abre e fecha com
  a tecla S. O sumário marca a seção que você está lendo e rola até ela sem tirar o foco;
  os níveis se recolhem, e por padrão aparecem o primeiro nível e o caminho até a seção
  atual; a lista é uma parada de Tab só (as setas andam pelos itens). A aba Páginas mostra miniaturas com o número de cada página, desenhadas só perto
  da área visível, e marca a página atual ou as duas páginas de um par. A barra lembra se
  estava aberta, a aba e a largura em todos os documentos. Arraste a borda dela, ou use as
  setas, para mudar a largura (de 220 a 480 px, no máximo 40% da janela).
- **Voltar depois de um salto.** Ao usar o sumário, um link do PDF, o primeiro resultado da
  busca, uma miniatura, uma marca ou nota, o campo de página, Home e End no Kindle ou **Ler do
  início**, o Fólio guarda onde você estava e mostra sobre o PDF o botão "Voltar à pág. X" (e,
  depois de voltar, "Avançar à pág. Y"), que some sozinho em cerca de 15 s. **Alt + ←** volta e
  **Alt + →** avança, assim como os botões laterais do mouse sobre o leitor, por até 50 posições
  enquanto o documento está aberto. Rolar e virar página não contam como salto. Para voltar à
  biblioteca use o botão do topo ou **Ctrl + W**.
- **Menus que cabem na tela e funcionam pelo teclado.** O menu de opções de um documento,
  o botão "Mais opções" do leitor e o painel Aparência abrem abaixo do botão
  ou, quando faltar espaço, acima dele, sempre dentro da janela, e fecham ao rolar a
  biblioteca ou redimensionar a janela. No menu, o foco vai ao primeiro item; use as setas,
  Home, End ou a primeira letra de um item, Esc para fechar (o foco volta ao botão) ou Tab para
  sair. Clique com o botão direito num documento da biblioteca, ou Shift + F10 (ou a tecla
  Menu) com o foco nele, para abrir as mesmas opções; em Removidos, há Restaurar e Excluir definitivamente.

O texto e as imagens mantêm sua diagramação. Para ver as margens originais,
desative a junção nas preferências ou volte à rolagem contínua. Não há
refluxo de texto, OCR, edição de páginas, assinatura digital ou preenchimento
de formulários. O papel escuro inverte também as imagens. As miniaturas mostram a página
inteira, também no Kindle com margens unidas, e seguem a rotação e o papel escolhidos.
O sumário só marca seções cujo destino aponta para uma página do documento; links
externos ou destinos quebrados continuam na lista, sem marca, com aparência de indisponíveis. Notas, realces e marcas
ficam no catálogo, sem alterar o PDF. Senhas de PDFs não são armazenadas.

As metas contam páginas do PDF, não telas do Kindle: uma página conta após oito
segundos com o leitor ativo e apenas uma vez por dia. Com duas páginas lado a lado,
as duas que estão na tela contam juntas depois desses oito segundos, e uma página
do par que fica fora da janela (por exemplo, em zoom alto) não conta. Capítulos contam ao avançar
da última página acompanhada para o próximo início reconhecido, ou ao chegar ao
fim do documento. A contagem é uma estimativa de atividade, não uma confirmação
de que todo o conteúdo foi lido. Saltos não preenchem páginas intermediárias;
PDFs sem capítulos reconhecíveis permitem registro manual. O dia segue o relógio
local. O histórico mantém os totais antigos e compacta os IDs de páginas após os
31 registros mais recentes. A atualização
não inventa histórico anterior, e concluir um documento não soma suas páginas à meta.

O percentual conta páginas do PDF, da primeira (0%) à última (100%), e não depende
do zoom, da janela ou das telas do Kindle. No Kindle, a última tela pode começar na
penúltima página: o leitor mostra 100% ao chegar ao fim do documento, mas a
biblioteca só conhece a página salva e mostra o valor dessa página. O tempo restante
usa o ritmo medido em segundos por página, só com leitura ativa e os mesmos critérios
das metas. Pausas longas e saltos são descartados, e o ritmo de cada documento fica nas
preferências (até 50 documentos). É uma estimativa: páginas mais densas ou mais leves
mudam o resultado, e nada é exibido antes de cinco páginas medidas. Com duas páginas
lado a lado, o tempo em um par é dividido entre as duas páginas.

## Histórico de leitura

Abra **Histórico de leitura** na biblioteca ou **Ver histórico** nas metas. O
calendário mensal mostra páginas e capítulos por dia, metas atingidas, dias
abaixo da meta e o dia atual em andamento. Filtre por documento e selecione um dia
para ver os totais e os documentos que contribuíram. Leituras de documentos sem meta
também são registradas. Registros de documentos removidos continuam disponíveis e, depois de
**Excluir definitivamente**, os dias de leitura do documento continuam contando no calendário (o documento
aparece no filtro, sem arquivo, e não volta à biblioteca nem a Removidos).

O resultado usa a meta que valia naquele dia. A última alteração feita no próprio
dia prevalece, mas mudanças posteriores não reavaliam a meta de dias anteriores. Na
biblioteca inteira, cada dia conta toda a leitura daquele dia, em qualquer documento
(com meta própria ou sem), contra a meta geral do dia. Em um documento, o dia usa a
meta própria que ele tinha; sem meta própria, aparecem os totais dele e o status
**Sem meta própria**. Os dias passados são recalculados com essa regra. Dias com
totais antigos, mas sem configuração registrada, exibem **Meta não registrada**. O
aplicativo não reconstrói leituras que nunca foram salvas ou já foram descartadas
por versões anteriores.

## Executar a partir do código

Ambiente validado: Windows x64, Node.js 24, Rust com toolchain MSVC,
Microsoft C++ Build Tools e WebView2. O runtime WebView2 precisa estar instalado.
Outros sistemas não foram validados.

```powershell
git clone https://github.com/MakenRosa/folio.git
cd folio
npm ci
npm run tauri -- dev
```

`npm run dev` sozinho inicia apenas o frontend. A biblioteca e os comandos de
arquivos precisam da janela Tauri. As fontes, mapas e codecs de PDF.js são
preparados automaticamente; o uso normal do aplicativo não depende de rede.

Para compilar:

```powershell
npm run tauri -- build
```

O instalador NSIS fica em `src-tauri/target/release/bundle/nsis/`. Ele registra o Fólio
em **Abrir com** para `.pdf` sem mudar o programa padrão (veja
[compatibilidade](docs/compatibility.md#abrir-com-e-o-programa-padrão-de-pdf)). Não há
instalador público assinado nesta preparação. Para instalações antigas de
Lume PDF, leia [compatibilidade](docs/compatibility.md) antes de distribuir uma
atualização com o nome novo.

## Verificar

Python 3.12 ou posterior é usado para gerar documentos artificiais e empacotar
o código. Não faz parte do aplicativo instalado.

```powershell
python -m pip install -r requirements-test.txt
npm run build
npm run check
npx playwright install chromium
python scripts/fixtures.py
npm run test:ui
npm run test:native
npm run package:source
```

Se Python não estiver no PATH, defina `FOLIO_PYTHON` com o caminho do executável.
A suíte nativa cria sua própria identidade, biblioteca e perfil WebView2 dentro
de `test-results/native/`. Ela valida o destino antes de importar documentos e
encerra somente o processo que iniciou. Não use uma biblioteca pessoal como
fixture de teste. Evidências locais ficam em `test-results/` e não entram no ZIP.

`npm run test:ui` usa um navegador sem janela e um perfil próprio em
`test-results/reader-chrome/`. Exercita a interface, PDF.js e preferências reais,
com comandos nativos simulados. Pode ser executado sem abrir ou encerrar o leitor
instalado. Para usar um Edge já disponível, defina `FOLIO_BROWSER_CHANNEL=msedge`.
A suíte nativa abre uma janela de testes e complementa essa verificação com Tauri.

O [workflow de Windows](https://github.com/MakenRosa/folio/actions/workflows/ci.yml)
é executado em pushes para `main` e pull requests. Os resultados documentados
em `VALIDATION.md` são da execução local; o histórico remoto está no GitHub Actions.

## Dados e decisões técnicas

As instalações existentes usam `%LOCALAPPDATA%\com.lume.pdf`. `pdfs/` guarda as
cópias, `covers/` as capas e `library.json` o catálogo com progresso e notas.
`library.backup.json` permite recuperar o catálogo anterior. As preferências
ficam no perfil WebView2. Para backup, feche o aplicativo e copie a pasta inteira.
O tamanho e a posição da janela ficam em `%APPDATA%\com.lume.pdf\.window-state.json`, e
podem ser apagados sem perda de dados.

Rust faz a cópia em blocos e a persistência do catálogo. PDF.js é carregado sob
demanda; o transporte lê faixas da cópia local e a renderização limita canvases
ativos e resolução. O modo Kindle desloca a área visível, sem construir uma
imagem gigante do documento. Veja as escolhas, custos e limites em
[arquitetura](docs/architecture.md).

O Fólio demonstra integração desktop, persistência local, interface e testes.
Não inclui backend web, autenticação ou serviços distribuídos. Foi desenvolvido
com assistência de IA e refinado a partir do uso e de testes locais.

## Licença

Código original sob [MIT](LICENSE). Dependências mantêm suas próprias licenças;
consulte [THIRD_PARTY.md](THIRD_PARTY.md). Os PDFs das demonstrações são artificiais.
O projeto não tem vínculo com a Amazon.
