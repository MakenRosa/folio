# Contribuindo com o Fólio

O Fólio é um leitor de PDF para Windows. A interface usa português brasileiro.
O código e os comentários técnicos usam inglês quando isso facilita acompanhar
as bibliotecas utilizadas.

## Ambiente

Siga a instalação de dependências no [README](README.md). Antes de enviar uma
alteração, execute `npm run check`. Para mudanças na interface, persistência ou
renderização, execute também `npm run test:native` em Windows.

O teste nativo compila uma identidade separada, gera PDFs artificiais e usa uma
pasta nova em `test-results/native/`. Não aponte os testes para uma biblioteca
pessoal. A aplicação instalada pode continuar aberta durante a validação.

## Escopo de uma contribuição

- Descreva o problema observado e a mudança de comportamento.
- Mantenha os contratos de armazenamento descritos em [compatibilidade](docs/compatibility.md).
- Prefira funções pequenas e mudanças localizadas. Não introduza um framework
  apenas para reorganizar uma tela.
- Teste transições e falhas relevantes. Testes que apenas repetem a implementação
  oferecem pouca proteção.
- Use arquivos artificiais ou autorizados nas reproduções. Nunca inclua livros,
  catálogos pessoais, perfis do WebView2 ou dados de terceiros.
- Descreva o uso relevante de assistência de IA e revise o código produzido.

## Pull requests

Explique o comportamento antes e depois, como foi validado e qualquer limitação.
Capturas ajudam quando a interface muda. A automação verifica formatação, tipos,
testes e análise estática; a revisão humana continua necessária.

Contribuições ao código original seguem a licença MIT do projeto. Dependências
mantêm suas próprias licenças.
