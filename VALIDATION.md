# Validação do Fólio 1.3.0

Execução local em 22/10/2026, Windows x64 e WebView2. Foram usados exclusivamente
PDFs artificiais e um perfil próprio de testes. O aplicativo instalado e a
biblioteca pessoal não participaram da suíte.

## Resultados

| Verificação                       | Resultado                                                |
| --------------------------------- | -------------------------------------------------------- |
| Integração nativa                 | 14 cenários aprovados                                    |
| Brilho                            | 6 cenários aprovados                                     |
| Leitura por telas                 | 12 cenários aprovados                                    |
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

## Verificações de código

`npm run check` reúne formatação, TypeScript, cinco testes de preferências,
compatibilidade e cálculo de telas, três testes Rust de domínio, `cargo fmt` e
Clippy com avisos tratados como erro. Os testes nativos complementam esses
checks com uma janela real de WebView2.

Para reproduzir, siga os comandos do [README](README.md). Os relatórios locais
são `test-results/results.json`, `position.json`, `brightness/results.json`,
`kindle/results.json`, `kindle/restart.json` e `native/<execução>/result.json`.
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
