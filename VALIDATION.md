# Validação do Fólio

## Não publicado: barra lateral do leitor

Execução local em 29/10/2026, Windows x64, com Chromium sem janela, PDF.js real e
comandos nativos simulados (`tests/support/headless-app.mjs`). Passaram a formatação,
a verificação de tipos, 64 testes unitários de TypeScript, a compilação e os 46
cenários de `npm run test:ui`, 13 deles novos em `tests/sidebar.mjs`. O arquivo usa um
PDF artificial de 60 páginas, uma delas em paisagem, com sumário aninhado e destinos
nomeados, gerado na memória por `tests/support/outline-pdf.mjs`:

- A barra começa fechada, com `aria-expanded`, tooltip com a tecla S e a alça como
  `separator` vertical com valores mínimo, máximo e atual.
- O sumário marca a seção atual com `aria-current`, abre o caminho até ela e acompanha a
  leitura, inclusive com destinos nomeados e uma página em paisagem. O contraste do texto
  marcado fica acima de 4,5 nos dois temas, e o destaque tem peso e barra, não só cor.
- A seção entra na área visível com `block: 'nearest'`, sem tirar o foco do campo da
  página, e a lista não volta sozinha enquanto a seção é a mesma.
- Os ramos abrem e fecham com o mouse, Enter, Espaço e as setas; as setas não viram
  página, e Enter e o clique levam à seção.
- A aba Páginas cria 60 botões, mas desenha só as miniaturas perto da área visível,
  com espaço na proporção da página. Ao rolar todo o livro nunca houve mais de 16
  canvases, as primeiras miniaturas foram liberadas e a página em paisagem tomou a forma real.
- A rotação refaz as miniaturas, e fechar o livro com a lista desenhando não deixa
  canvases nem erros.
- Clique, Enter, Espaço, setas, Page Down, Home e End levam à página; a página atual é
  marcada, o par é marcado em duas páginas, só uma página em zoom alto, e uma em Kindle.
- Marcas e Notas seguem funcionando, e as setas trocam de aba sem virar a página.
- Aba, abertura e largura valem para outro livro e depois de reiniciar o navegador.
- A alça só grava a largura ao soltar (mouse) ou ao soltar a tecla; respeita os limites,
  tem foco visível e as setas dela não viram página.
- A posição de leitura se mantém ao alargar e estreitar a barra, na rolagem, em duas
  páginas e no Kindle (diferença de até 0,06 de página).
- Em 800 px a barra tem no máximo 320 px, o PDF mantém ao menos 440 px, e cabeçalho,
  barra do leitor, rodapé e abas não transbordam (`scrollWidth` igual a `clientWidth`) nos
  temas claro e escuro, com os três papéis. A largura escolhida volta numa janela maior.
- A tecla S alterna a barra, não age ao digitar, conta uma vez ao segurar e devolve o foco
  à leitura quando a barra some. O guia lista o atalho.

Os testes unitários cobrem a resolução de destinos, a seção atual (empates e sumário
fora de ordem), o recolhimento, os limites e os passos de largura, o teto de canvases e a
validação das três novas preferências. Os cenários anteriores de controles, metas,
histórico, progresso e duas páginas foram reexecutados e passaram. A suíte nativa
(`npm run test:native`), os testes Rust, os cenários Kindle e de capítulos (`kindle.mjs`,
`joined-pages.mjs`, `chapters.mjs`, que precisam da janela nativa) e o leitor de tela não
foram executados. Uma verificação à parte confirmou que os inícios de capítulo no Kindle
continuam sendo 2, 4 e 6 no PDF de seis páginas. Foram usados somente documentos
artificiais e perfis isolados; relatório em `test-results/sidebar/results.json`.

## Não publicado: duas páginas lado a lado

Execução local em 29/10/2026, Windows x64, com Chromium sem janela, PDF.js real e
comandos nativos simulados (`tests/support/headless-app.mjs`). Passaram a formatação,
a verificação de tipos, 45 testes unitários de TypeScript, a compilação e os 33
cenários de `npm run test:ui`, nove deles novos em `tests/spread.mjs`:

- O botão ao lado do zoom forma pares (`.spread`) e volta à página única; "Largura da
  página" e "Página inteira" mantêm o par na janela, sem barra horizontal.
- "Capa separada" deixa a página 1 sozinha e forma 2–3, 4–5; o botão restaura a última
  disposição escolhida.
- Próxima e anterior, as setas e os botões avançam por par, com início e fim desabilitados
  nas duas disposições.
- O Kindle força uma coluna sem apagar a preferência, desabilita o botão e o seletor
  com explicação, e a volta à rolagem restaura a disposição e o ponto de leitura.
- Trocar a disposição mantém o ponto lido em coordenadas do PDF.
- A tecla L alterna a disposição e é ignorada ao digitar; o botão responde ao teclado.
- As duas páginas de um par contam nas metas após oito segundos, e o ritmo mede dois
  passos de duas páginas como segundos por página.
- A disposição, a página e a posição sobrevivem ao fechamento do livro e à reinicialização
  do navegador.
- Janela de 800 px, tema escuro e papel sépia sem transbordar o cabeçalho, a barra do
  leitor e o rodapé (`scrollWidth` igual a `clientWidth`), também em 900 px e após redimensionar.

Os testes unitários cobrem o agrupamento de páginas (comparado com o laço do PDF.js),
a preferência `spread`, a contagem de páginas e capítulos nas metas e o ritmo em passos
de duas páginas. Os cenários de metas, histórico, progresso e controles anteriores foram
reexecutados e passaram. A suíte nativa (`npm run test:native`) e os testes Rust não
foram executados nesta verificação. Foram usados somente documentos artificiais e
perfis isolados; relatórios em `test-results/spread/results.json`.

## 1.8.0: histórico de leitura

Execução local em 29/10/2026, Windows x64. Passaram 18 testes unitários de
TypeScript, seis testes Rust, formatação, verificação de tipos e Clippy.
A suíte de interface passou 16 cenários, incluindo seis novos para o histórico:

- Calendário com páginas, capítulos e resultados das metas em cada dia.
- Filtro por livro, metas compartilhadas e próprias, ausência de meta e registros de livros removidos.
- Meses anteriores e registros antigos cuja meta não é conhecida.
- Mudança de meta sem reescrever resultados anteriores e reinício do navegador.
- Tema escuro, teclado e janela de 800 × 600 sem transbordamento horizontal.
- Leitura sem meta salva no histórico após tempo ativo no leitor.

A suíte nativa completa também passou. A verificação de reinício real confirmou
a linha do tempo das metas e exibiu os totais salvos no histórico pela interface.
Os testes Rust verificaram migração idempotente, alteração de meta por data,
rejeição de data inválida, persistência de mais de 31 dias e restauração.
Não houve erros JavaScript ou pedidos externos nos cenários observados.

Foram usados documentos artificiais e perfis isolados. Os relatórios ficam em
`test-results/history/results.json`, `reader-chrome/results.json`,
`goals/results.json`, `kindle/restart.json` e `native/<execução>/result.json`.
Registros que versões anteriores nunca salvaram ou já descartaram não podem
ser reconstruídos por esta atualização.

O executável de produção 1.8.0 foi instalado e aberto na instalação local.
O calendário e os totais existentes foram conferidos pela interface real.
A comparação com o backup confirmou PDFs idênticos pelo SHA-256, catálogo,
preferências, posições, conclusão, metas e totais anteriores preservados.
O executável instalado corresponde ao artefato de produção verificado.

As tentativas anteriores foram bloqueadas pelo Controle Inteligente de
Aplicativos, com restauração da versão 1.7.0. A instalação bem-sucedida ocorreu
após o usuário desativar esse controle manualmente. A automação não alterou
as políticas de segurança do Windows.

## 1.7.0: conclusão e metas diárias

Execução local em 29/10/2026, Windows x64. Passaram 14 testes unitários de
TypeScript, cinco testes Rust, verificação de tipos, formatação e Clippy.
Os testes Rust incluem abertura de catálogo antigo sem perda de campos,
persistência de conclusão e metas, restauração e rejeição atômica de dados inválidos.

Os cinco cenários de controles da versão 1.6 foram reexecutados. A nova suíte
`tests/goals.mjs`, com Edge sem janela, PDF.js real e biblioteca nativa simulada,
passou estes cinco cenários:

- Concluir e desfazer, preservando posição e estado após reabrir o documento.
- Soma global com vários livros, meta própria, ausência de meta, páginas,
  capítulos, validação de quantidade e substituição dos totais manuais.
- Página contabilizada por leitura ativa, deduplicação diária, pausa com diálogo
  aberto e capítulo reconhecido na transição para o seguinte.
- Tema escuro, janela de 800 × 600 e persistência após reiniciar o navegador.
- Virada da data local sem atribuir um formulário do dia anterior ao novo dia.

A suíte nativa completa foi reexecutada com identidade, biblioteca e perfil
isolados. Passaram importação, busca, notas, marcadores, PDFs protegidos e
corrompidos, retomada, brilho, Kindle, junção de páginas e separação de capítulos.
O teste de reinício real também salvou pela interface uma meta própria, os
totais diários e a conclusão. Todos permaneceram após encerrar e reabrir o
processo. A posição do PDF teve diferença de zero pixels.

Não houve erros JavaScript ou pedidos externos nos cenários observados. Foram
usados PDFs artificiais; a biblioteca instalada não participou dessas suítes.
Relatórios: `test-results/goals/results.json`, `reader-chrome/results.json`,
`kindle/restart.json` e `native/<execução>/result.json`. A contagem por atividade
continua sendo uma estimativa, ajustável pelo usuário, e não mede compreensão.

## 1.6.0: controles e preferências

Execução local em 27/10/2026, Windows x64, com Edge sem janela e perfil de teste
isolado. O aplicativo instalado permaneceu em uso e não foi reinstalado,
encerrado ou usado nos testes. Foram usados apenas PDFs artificiais.

Os cinco cenários de `npm run test:ui` passaram:

- Brilho e tela quente na barra alteram a aparência real do PDF e permanecem
  sincronizados com o diálogo de preferências. O modo foco não está presente.
- As barras somem e reaparecem por bordas independentes, mantendo dimensões e
  posição do PDF. Um ajuste aberto mantém os controles acessíveis.
- Teclado e busca revelam os controles; Esc fecha primeiro o ajuste ou a busca,
  e F11 alterna a tela cheia, restaurando as barras ao sair.
- Os controles cabem em 800 × 600 e respeitam movimento reduzido.
- Tema escuro, Kindle, brilho, tela quente, visualização em lista, ordenação
  e retomada permanecem após fechar e reabrir o processo do navegador de teste.

Não houve erros JavaScript ou requisições externas observados. A interface e
PDF.js são reais; as chamadas de janela e biblioteca Tauri são simuladas nessa
suíte. Isso verifica o comportamento visual, mas não comprova a transição de
tela cheia do Windows. A suíte nativa abaixo é evidência histórica da versão
1.5.0 e não foi reexecutada nesta rodada para não interromper a leitura em uso.
Relatório: `test-results/reader-chrome/results.json`.

Também passaram a compilação de produção do frontend e `npm run check`:
formatação, TypeScript, dez testes unitários de interface/domínio, três testes
Rust, `cargo fmt` e Clippy sem avisos. Nenhum instalador foi executado nesta rodada.

## 1.5.0: validação nativa anterior

Execução local em 25/10/2026, Windows x64 e WebView2. Foram usados exclusivamente
PDFs artificiais e um perfil próprio de testes. O aplicativo instalado e a
biblioteca pessoal não participaram da suíte.

## Resultados

| Verificação                       | Resultado                                                |
| --------------------------------- | -------------------------------------------------------- |
| Integração nativa                 | 14 cenários aprovados                                    |
| Brilho                            | 6 cenários aprovados                                     |
| Leitura por telas                 | 12 cenários aprovados                                    |
| União de páginas                  | 4 cenários aprovados; retomada com diferença de 0 pixels |
| Separação de capítulos            | 4 cenários aprovados; 24 linhas anteriores preservadas   |
| Retomada ao reabrir o PDF         | Diferença de 0 pixels; opção de abrir do início aprovada |
| Retomada após encerrar o processo | Modo Kindle e posição preservados, diferença de 0 pixels |
| PDF de 300 páginas                | Navegação até a página 285, 4 canvases ativos            |
| PDF digitalizado de 41,18 MB      | Abertura e navegação por telas aprovadas                 |
| Interface automatizada            | Nenhum erro JavaScript ou pedido externo observado       |

A suíte cobre cópia e hash, independência do arquivo original, deduplicação,
falha parcial, busca, notas, marcadores, favoritos, zoom, rotação, cores,
restauração, senha incorreta/correta/cancelamento, PDF corrompido e janela de
800 × 600. O teste de reinício encerra o processo antes do debounce de gravação.

Durante a preparação, o teste extenso encontrou uma disputa entre a atualização
da página visível e o campo de navegação. O número digitado podia ser sobrescrito
antes da confirmação. O campo agora preserva o rascunho enquanto tem foco. A
regressão digita 285, provoca rolagem e verifica o valor antes de navegar.

Na versão 1.4.0, o PDF artificial de margens passou de 1122 para 567 pixels de
altura por página a 100% de zoom. O intervalo entre a última linha de uma página
e a primeira da seguinte ficou em 21,67 pixels, mantendo todas as linhas.
A suíte também verificou busca, rodapé, imagem próxima à borda, texto quase
branco, página vazia, zoom, rotação e retorno às margens originais. O SHA-256 da
cópia importada permaneceu igual ao original após essas operações.

Na versão 1.5.0, a suíte verificou o título em uma tela própria com texto do novo
capítulo, todas as 24 linhas anteriores acessíveis, retorno ao trecho anterior,
detecção com e sem sumário, páginas comuns unidas, zoom, redimensionamento,
capítulo final curto, busca, desativação da opção e retomada. O PDF permaneceu
idêntico pelo SHA-256. Os testes de cálculo percorrem combinações de altura,
zoom e escala de pixels para conferir cobertura sem lacunas entre capítulos.

## Verificações de código

`npm run check` reúne formatação, TypeScript, dez testes de preferências,
compatibilidade, capítulos, margens e cálculo de telas, três testes Rust de domínio, `cargo fmt` e
Clippy com avisos tratados como erro. Os testes nativos complementam esses
checks com uma janela real de WebView2.

Para reproduzir, siga os comandos do [README](README.md). Os relatórios locais
são `test-results/results.json`, `position.json`, `brightness/results.json`,
`kindle/results.json`, `kindle/restart.json`, `joined-pages/results.json`, `chapters/results.json` e
`native/<execução>/result.json`.
Esses arquivos podem conter caminhos do ambiente e não são distribuídos no ZIP.

## Limites da evidência

As medidas descrevem esta máquina e estes documentos. Quatro canvases ativos
não equivalem a uma medida da memória total de Rust e WebView2. O teste de
ausência de rede observa requisições da interface nos cenários executados;
não é uma auditoria completa do sistema operacional.

Não foram validados Linux, macOS, leitor de tela, atualização NSIS de uma
instalação antiga com a nova marca ou execução do workflow em GitHub. A seleção
de arquivos é exercitada pelo comando nativo; o diálogo visual do Windows e o
arrastar e soltar não foram revalidados manualmente nesta rodada.
