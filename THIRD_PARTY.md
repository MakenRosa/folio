# Dependências e avisos

O código original do Fólio usa a [licença MIT](LICENSE). Esse licenciamento não
substitui as licenças de bibliotecas, fontes ou codecs utilizados pelo aplicativo.

| Componente direto        | Uso                             | Licença declarada |
| ------------------------ | ------------------------------- | ----------------- |
| PDF.js                   | Renderização e busca no PDF     | Apache-2.0        |
| Tauri e plugins oficiais | Janela, WebView2 e diálogos     | MIT ou Apache-2.0 |
| Serde e serde_json       | Serialização do catálogo        | MIT ou Apache-2.0 |
| sha2                     | Deduplicação por conteúdo       | MIT ou Apache-2.0 |
| uuid                     | Identificação das cópias        | MIT ou Apache-2.0 |
| tempfile                 | Gravação por arquivo temporário | MIT ou Apache-2.0 |

As versões exatas estão em `package-lock.json` e `src-tauri/Cargo.lock`.
`scripts/notices.mjs` recolhe os textos de licença dos pacotes instalados e os
inclui nos assets do aplicativo em `licenses/third-party.txt` durante o build.
Os avisos das fontes e dos codecs acompanham os diretórios copiados de PDF.js.

Quando o pacote de uma dependência não contém seu texto de licença, uma cópia
do texto oficial é mantida em `licenses/`. `origins.json` registra origem, versão
e SHA-256; o build verifica esses hashes sem baixar novos textos. O componente
MPL-2.0 `selectors` é usado sem modificações; seu código está disponível na
[revisão de origem](https://github.com/servo/stylo/tree/572ecba2d1600e7c3d490586692a209faf703baa/selectors).

WebView2 é um runtime distribuído pela Microsoft e reutilizado pelo aplicativo.
Ele não está contido no pacote de código-fonte.

O nome do controle Kindle descreve a leitura por telas solicitada no projeto.
O Fólio não tem vínculo com a Amazon e não lê formatos proprietários de Kindle.

Referências: [PDF.js](https://mozilla.github.io/pdf.js/),
[Tauri](https://v2.tauri.app/),
[texto da licença MIT](https://opensource.org/license/mit).
