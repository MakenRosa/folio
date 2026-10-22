# Arquitetura e decisões

## Fluxo principal

1. O diálogo nativo entrega caminhos escolhidos pelo usuário.
2. Um comando Tauri executa a importação fora da thread da interface.
3. Rust copia cada arquivo em blocos de 256 KiB, calcula SHA-256 e verifica duplicatas.
4. O catálogo guarda um UUID e os metadados. O caminho original deixa de ser necessário.
5. Ao abrir um documento, a interface carrega PDF.js sob demanda e lê a cópia local.
6. O leitor envia página, coordenadas do PDF, zoom e rotação para o catálogo.

## Responsabilidades

| Área                   | Arquivos                    | Responsabilidade                                                 |
| ---------------------- | --------------------------- | ---------------------------------------------------------------- |
| Coordenação            | `src/main.ts`               | Fluxos de abertura, fechamento, importação e edição de metadados |
| Interface              | `src/ui/`                   | Biblioteca, estrutura das telas, diálogos, atalhos e mensagens   |
| Preferências           | `src/preferences.ts`        | Compatibilidade, validação e armazenamento de opções visuais     |
| Leitor                 | `src/reader.ts`             | PDF.js, leitura por faixas, busca, zoom, rotação e ciclo de vida |
| Telas de leitura       | `src/reading/screens.ts`    | Cálculo de avanço, sobreposição e retorno nos limites            |
| Inicialização nativa   | `src-tauri/src/main.rs`     | Janela, plugins e abertura da biblioteca                         |
| Comandos nativos       | `src-tauri/src/commands.rs` | Contratos IPC e execução de operações locais                     |
| Domínio e persistência | `src-tauri/src/library.rs`  | Importação, catálogo, recuperação, notas e marcadores            |

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

**Modo Kindle.** A área visível avança sobre uma sequência de páginas sem intervalos
externos. Há sobreposição para recuperar linhas cortadas, alinhamento a pixels
físicos e tratamento do último trecho parcial. O layout original, as margens
internas e as imagens são preservados. Não é conversão de PDF em EPUB.

**Offline durante o uso.** PDFs, fontes e módulos de renderização estão locais.
Desenvolvimento e instalação de dependências usam a rede. Links externos no PDF
não são abertos automaticamente. Não há conta, sincronização ou backend remoto.

## Desenvolvimento assistido

O projeto foi desenvolvido com assistência de IA para implementação, refatoração
e testes, a partir de necessidades reais de leitura e feedback sobre o uso. As
decisões acima, os limites e os resultados de teste são documentados para permitir
revisão. A existência de testes não equivale a uma auditoria independente.
