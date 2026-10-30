// Explicit headings only. A sentence mentioning a previous chapter is not a break.
export function isChapterHeading(value: string) {
  const text = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '')
    .trim();
  if (text.length > 110) return false;
  return /^(?:(?:capitulo|chapter|parte|part|livro|book)\s+(?:\d+|[ivxlcdm]+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezassete|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b|prologo\b|epilogo\b|prefacio\b|prologue\b|epilogue\b)/i.test(
    text,
  );
}

export function startsChapter(items: readonly { str?: string; transform?: number[] }[]) {
  const lines: { text: string; y: number }[] = [];
  for (const item of items) {
    if (!item.str?.trim() || !item.transform) continue;
    const y = item.transform[5];
    const previous = lines.at(-1);
    if (previous && Math.abs(previous.y - y) < 2) previous.text += ` ${item.str}`;
    else lines.push({ text: item.str, y });
    if (lines.length > 4) break;
  }
  // Skip a printed page number, but do not search body paragraphs for keywords.
  const first = lines.filter((line) => !/^\s*\d+\s*$/.test(line.text)).slice(0, 2);
  return first.some((line) => isChapterHeading(line.text));
}
