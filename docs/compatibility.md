# Nome e compatibilidade com instalações existentes

O nome público a partir da versão 1.3 é **Fólio**. O projeto foi iniciado como
Lume PDF. Alguns identificadores técnicos continuam estáveis por compatibilidade:

| Contrato           | Valor preservado         | Motivo                                                     |
| ------------------ | ------------------------ | ---------------------------------------------------------- |
| Identidade Tauri   | `com.lume.pdf`           | Mantém a localização dos dados e a identidade da aplicação |
| Executável e crate | `lume-pdf`               | Permite reconhecer atalhos e instalações existentes        |
| Preferências       | `lume.preferences`       | Mantém tema, brilho, tela quente, modo e retomada          |
| Catálogo           | `library.json`, versão 1 | Evita uma migração de documentos e anotações               |

O nome novo aparece na interface, na janela, na documentação e no pacote do projeto.
Não altere esses contratos por uma substituição global do nome antigo.

## Dados

A biblioteca instalada usa `%LOCALAPPDATA%\com.lume.pdf`. Os arquivos `pdfs/`,
`covers/`, `library.json` e `library.backup.json` pertencem ao usuário. O perfil do
WebView2 contém as preferências. Nenhum deles entra no pacote de código-fonte.

Esta preparação mantém a instalação em uso intacta. Não executa um instalador,
não renomeia a pasta instalada e não substitui seus atalhos.

## Abrir com e o programa padrão de PDF

O `tauri.conf.json` declara `.pdf` em `bundle.fileAssociations` (classe `Folio.PDF`,
descrição "Documento PDF", `application/pdf`, papel de visualizador). Sozinha, a
associação do instalador NSIS do Tauri troca o programa de `.pdf` do usuário: ela grava
o valor padrão de `HKCU\Software\Classes\.pdf` e guarda o anterior em `Folio.PDF_backup`.
Sem uma escolha sua nas Configurações do Windows, isso abriria todos os PDFs no Fólio.
Por isso `src-tauri/windows/installer-hooks.nsh` (`bundle.windows.nsis.installerHooks`)
desfaz essa troca:

| Momento     | O que o instalador faz                                                                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instalar    | Mantém a classe `Folio.PDF` (comando `lume-pdf.exe "%1"`), devolve o programa anterior de `.pdf` e inclui `Folio.PDF` em `.pdf\OpenWithProgids`, o que põe o Fólio em **Abrir com** |
| Desinstalar | Apaga a classe, o valor em `OpenWithProgids` e as chaves que ficarem vazias, sem desfazer uma escolha feita depois da instalação                                                    |

Tudo fica em `HKCU` (instalação por usuário). O instalador não grava `UserChoice`, que o
Windows protege e só muda pelo usuário: para abrir os PDFs no Fólio por padrão, use
**Abrir com > Escolher outro aplicativo** ou as Configurações. Se você já escolheu Fólio
e desinstala, o Windows volta a perguntar. Os ganchos compilam com o `makensis` do Tauri,
mas o fluxo (instalar, atualizar, desinstalar, e a lista **Abrir com**) só se comprova em um
instalador gerado e testado em uma máquina de teste.

Um PDF aberto pelo Explorer chega ao aplicativo como argumento da linha de comando. Na
primeira instância, `main.rs` guarda os caminhos `.pdf` existentes em um estado gerenciado e
o frontend os pega com `take_pending_files` no fim da inicialização. Numa segunda instância, o
plugin de instância única entrega os argumentos e a pasta de trabalho à primeira (os caminhos
relativos usam essa pasta), que guarda os arquivos no mesmo estado e emite `open-files`; o
frontend responde pegando o que está guardado. Assim nada se perde se o aviso chegar antes de a
janela estar pronta, como ao abrir vários arquivos de uma vez no Explorer.

## Estado da janela

`tauri-plugin-window-state` guarda tamanho, posição e se estava maximizada em
`%APPDATA%\com.lume.pdf\.window-state.json` (`window-state.development.json` em uma
compilação de desenvolvimento, para não misturar com a instalada). A tela cheia fica de
fora de propósito. A janela é registrada só no Rust, sem permissões em
`capabilities/`. Na primeira execução vale o `center: true`. Se o tamanho ou a posição
guardados não cabem mais em nenhum monitor, a janela abre menor, se preciso, no centro do
monitor mais próximo. O desinstalador remove essa pasta junto com os dados do aplicativo
quando você pede a remoção deles. A identidade de teste usa `appDirectoriesOverride`, que
também leva esse arquivo para a pasta do teste.

## Validação isolada

`npm run test:native` compila uma identidade própria e usa `appDirectoriesOverride`
para guardar todos os dados em uma pasta exclusiva do teste. Cada execução tem um
perfil novo. A conexão de teste compara o caminho da biblioteca com o caminho
esperado antes de permitir operações. Uma biblioteca pessoal não passa por essa
checagem.

## Futuras atualizações instaladas

Antes de distribuir uma atualização para instalações antigas, valide o fluxo do
instalador e os atalhos em uma máquina de teste. A alteração de `productName` pode
afetar nomes de pastas e entradas do instalador mesmo com a identidade preservada.
Não desinstale a versão anterior nem mova dados automaticamente apenas para trocar
a marca. Os testes de interface desta preparação não comprovam uma migração NSIS.

Referência: [configuração de identidade e diretórios do Tauri](https://v2.tauri.app/reference/config/).
