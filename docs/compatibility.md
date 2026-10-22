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
