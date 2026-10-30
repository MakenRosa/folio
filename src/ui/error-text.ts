// What a failure says to the reader. The backend (Rust), the system (Windows) and PDF.js each
// fail in their own words and language; the reader gets one short sentence in Portuguese and
// can open the original text behind "Detalhes". Pure: no DOM, so that it can be tested alone.
export type ErrorText = {
  // The friendly sentence.
  message: string;
  // The technical text of the error, as it came. Empty when it adds nothing to the sentence.
  detail: string;
};
export const GENERIC_ERROR = 'Algo deu errado. Tente de novo.';

// What is known of an error before choosing the sentence. `text` is lower case, for the rules.
type Facts = {
  text: string;
  name: string;
  code: number | null;
  status: number | null;
  missing: boolean;
  os: number | null;
};
type Rule = [matches: (facts: Facts) => boolean, say: string];

const field = (error: unknown, key: string): unknown =>
  error && typeof error === 'object' ? (error as Record<string, unknown>)[key] : undefined;

// The text of an error as a developer would want to read it, e.g. "InvalidPDFException: Invalid
// PDF structure." The commands of the app fail with a plain string.
export function technicalText(error: unknown): string {
  let text: string;
  if (error === null || error === undefined) text = '';
  else if (typeof error === 'string') text = error;
  else if (error instanceof Error) text = String(error);
  else if (typeof field(error, 'message') === 'string') {
    const name = field(error, 'name');
    text = `${typeof name === 'string' && name ? `${name}: ` : ''}${field(error, 'message')}`;
  } else {
    try {
      text = JSON.stringify(error) ?? String(error);
    } catch {
      text = String(error);
    }
  }
  text = text.trim();
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
}

function factsOf(error: unknown, technical: string): Facts {
  const number = (value: unknown) => (typeof value === 'number' ? value : null);
  const name = field(error, 'name');
  const os = /\(os error (\d+)\)/i.exec(technical);
  return {
    text: technical.toLowerCase(),
    name: typeof name === 'string' ? name : '',
    code: number(field(error, 'code')),
    status: number(field(error, 'status')),
    missing: field(error, 'missing') === true,
    os: os ? Number(os[1]) : null,
  };
}

const has = (facts: Facts, pattern: RegExp) => pattern.test(facts.text);
// Windows error numbers, from the "(os error N)" at the end of what Rust says of a failed file.
const osIn = (facts: Facts, ...numbers: number[]) =>
  facts.os !== null && numbers.includes(facts.os);

// The first rule that matches decides, so the specific ones come first.
const RULES: Rule[] = [
  // PDF.js: a password.
  [
    (f) => (f.name === 'PasswordException' && f.code === 2) || has(f, /incorrect password/),
    'A senha informada está incorreta.',
  ],
  [
    (f) => f.name === 'PasswordException' || has(f, /no password given|password required/),
    'Este PDF está protegido por senha.',
  ],
  // PDF.js and the import: not a PDF, or one that cannot be read.
  [
    (f) =>
      f.name === 'InvalidPDFException' ||
      f.name === 'FormatError' ||
      has(f, /invalid pdf|invalid or corrupt|não contém um pdf válido/),
    'Este arquivo não é um PDF válido ou está danificado.',
  ],
  // A copy that is gone from the library, or from the disk.
  [
    (f) => f.missing || f.status === 404 || has(f, /missing pdf|pdf não encontrado/),
    'Este PDF não está mais na biblioteca.',
  ],
  // The reading was cut: the file changed, the window closed, the transport gave up.
  [
    (f) =>
      f.name === 'AbortException' ||
      f.name === 'ResponseException' ||
      has(
        f,
        /não foi possível ler parte do pdf|alterada ou está incompleta|worker was (destroyed|terminated)|loading aborted|unexpected server response|failed to fetch|networkerror|load failed/,
      ),
    'A leitura do PDF foi interrompida. Tente abrir de novo.',
  ],
  // The commands of the app (library.rs, commands.rs, reading.rs).
  [(f) => has(f, /selecione um arquivo \.pdf/), 'Só arquivos .pdf podem ser adicionados.'],
  [(f) => has(f, /não é um arquivo/), 'Escolha um arquivo, não uma pasta.'],
  [(f) => has(f, /arquivo está vazio/), 'O arquivo está vazio.'],
  [
    (f) => has(f, /escolha uma pasta fora da biblioteca/),
    'Escolha uma pasta fora da biblioteca para exportar a cópia.',
  ],
  [(f) => has(f, /título entre 1 e 500/), 'Use um título entre 1 e 500 caracteres.'],
  [
    (f) => has(f, /limite de notas excedido/),
    'Limite de notas excedido. Encurte as notas ou apague algumas.',
  ],
  [(f) => has(f, /capa inválida/), 'Não foi possível guardar a capa deste PDF.'],
  [(f) => has(f, /a meta deve estar entre/), 'A meta deve estar entre 1 e 10.000.'],
  [
    (f) => has(f, /data do histórico inválida|informe a data da alteração da meta/),
    'Não foi possível salvar a meta. Confira a data e tente de novo.',
  ],
  [
    (f) => has(f, /histórico diário excede/),
    'O histórico de leitura chegou ao limite de 100 anos.',
  ],
  [(f) => has(f, /registro diário inválido/), 'Não foi possível salvar o registro de leitura.'],
  [
    (f) => has(f, /não foi possível ler o catálogo|catálogo e backup ilegíveis/),
    'Não foi possível ler o catálogo da biblioteca. Seus PDFs estão preservados.',
  ],
  [
    (f) => has(f, /poison/),
    'A biblioteca encontrou um erro interno. Feche o Fólio e abra de novo.',
  ],
  // The system, whatever its language: Windows says "(os error N)" in the system language.
  [
    (f) => osIn(f, 5) || has(f, /access is denied|acesso negado/),
    'O Windows negou o acesso ao arquivo. Confira as permissões.',
  ],
  [
    (f) =>
      osIn(f, 32, 33) ||
      has(f, /used by another process|em uso por outro processo|sharing violation/),
    'O arquivo está em uso por outro programa. Feche-o e tente de novo.',
  ],
  [
    (f) =>
      osIn(f, 2, 3) ||
      has(f, /cannot find the (file|path)|não pode encontrar o (arquivo|caminho)|no such file/),
    'O arquivo ou a pasta não foi encontrado. Ele pode ter sido movido ou apagado.',
  ],
  [
    (f) =>
      osIn(f, 39, 112) || has(f, /not enough space|no space left|espaço (insuficiente|em disco)/),
    'Não há espaço livre suficiente no disco.',
  ],
  [(f) => osIn(f, 19), 'O disco está protegido contra gravação.'],
  [
    (f) => osIn(f, 53, 64, 67, 1231),
    'Não foi possível acessar o local de rede. Confira a conexão.',
  ],
  [(f) => osIn(f, 123, 161, 206), 'O nome ou o caminho do arquivo não é aceito pelo Windows.'],
  [
    (f) => osIn(f, 23, 1117, 1392),
    'O Windows não conseguiu ler o arquivo. O disco ou o arquivo pode estar com problema.',
  ],
  [(f) => f.os !== null, 'O Windows não conseguiu concluir a operação com o arquivo.'],
];

export function describeError(error: unknown): ErrorText {
  const technical = technicalText(error);
  const facts = factsOf(error, technical);
  const message = RULES.find(([matches]) => matches(facts))?.[1] ?? GENERIC_ERROR;
  // The original text is shown only when it says more than the sentence.
  const plain = (text: string) => text.toLowerCase().replace(/[\s.]+$/, '');
  return { message, detail: plain(technical) === plain(message) ? '' : technical };
}
