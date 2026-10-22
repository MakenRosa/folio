# Segurança e dados locais

O Fólio guarda os documentos no computador. A interface não envia PDFs a serviços
externos, não usa fontes remotas e não executa JavaScript embutido nos documentos.
Essas restrições reduzem a superfície de ataque; não substituem atualizações do
Windows, WebView2 e PDF.js.

A aplicação não cifra a biblioteca. Outros processos com acesso à conta do usuário
podem ler os arquivos. Senhas de PDFs não são persistidas.

## Relatar uma vulnerabilidade

Descreva a versão, os passos mínimos de reprodução e o impacto. Use um PDF
artificial. Evite publicar documentos pessoais, segredos ou uma exploração de
alto impacto em uma issue pública.

Use o [canal privado de relato do GitHub](https://github.com/MakenRosa/folio/security/advisories/new),
habilitado neste repositório. Este documento não promete uma equipe de segurança
ou um prazo de resposta que ainda não existem.

## Distribuição

Esta preparação não distribui instalador assinado. A
validação local está descrita em [VALIDATION.md](VALIDATION.md). Não há mecanismo
de atualização automática nesta versão.
