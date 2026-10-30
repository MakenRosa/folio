// A small PDF made in memory, with no file and no external tool: many pages, one of
// them in landscape, and an outline with nested sections, some pointing to named
// destinations. It exercises the side bar of the reader with real PDF.js.
export const SECTIONS = [
  {
    title: 'Parte I',
    page: 1,
    items: [
      {
        title: 'Capítulo 1',
        page: 2,
        items: [
          { title: 'Seção 1.1', page: 3 },
          { title: 'Seção 1.2', page: 5 },
        ],
      },
      { title: 'Capítulo 2', page: 8, items: [{ title: 'Seção 2.1', page: 9 }] },
    ],
  },
  {
    title: 'Parte II',
    page: 20,
    items: [
      { title: 'Capítulo 3', page: 21, named: 'cap3', items: [{ title: 'Seção 3.1', page: 22 }] },
      { title: 'Capítulo 4', page: 40 },
    ],
  },
  { title: 'Apêndice', page: 55, named: 'apendice' },
];

const A4 = [595, 842];

const hex = (text) =>
  'FEFF' +
  [...text].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()).join('');

export function outlinePdf({ pages = 60, landscape = [8], sections = SECTIONS } = {}) {
  // Object numbers: 1 catalog, 2 pages, 3 outline root, 4 font, 5 named destinations,
  // then a page and its content for each page, then the outline items.
  const pageObject = (n) => 6 + 2 * (n - 1);
  const items = [];
  const visit = (list, parent) => {
    const level = [];
    for (const section of list) {
      const item = { ...section, parent, children: [] };
      items.push(item);
      level.push(item);
      item.children = visit(section.items || [], item);
    }
    return level;
  };
  const top = visit(sections, null);
  items.forEach((item, i) => (item.id = 6 + 2 * pages + i));
  const ref = (id) => `${id} 0 R`;
  const size = (n) => (landscape.includes(n) ? [A4[1], A4[0]] : A4);
  const destination = (item) =>
    item.named
      ? `(${item.named})`
      : `[${ref(pageObject(item.page))} /XYZ 0 ${size(item.page)[1]} null]`;

  const objects = [];
  objects[1] = `<< /Type /Catalog /Pages 2 0 R /Outlines 3 0 R /Names << /Dests 5 0 R >> /PageMode /UseOutlines >>`;
  objects[2] = `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => ref(pageObject(i + 1))).join(' ')}] >>`;
  objects[3] = `<< /Type /Outlines /First ${ref(top[0].id)} /Last ${ref(top.at(-1).id)} /Count ${items.length} >>`;
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  const named = items.filter((item) => item.named).sort((a, b) => (a.named < b.named ? -1 : 1));
  objects[5] = `<< /Names [${named.map((item) => `(${item.named}) [${ref(pageObject(item.page))} /Fit]`).join(' ')}] >>`;
  for (let n = 1; n <= pages; n++) {
    const [w, h] = size(n);
    const shade = (0.82 + ((n * 7) % 10) / 100).toFixed(2);
    const content = [
      `${shade} 0.95 0.88 rg 0 0 ${w} ${h} re f`,
      `0.25 0.4 0.33 rg 40 ${h - 120} ${w - 80} 70 re f`,
      `BT /F1 40 Tf 1 g 60 ${h - 100} Td (Pagina ${n}) Tj ET`,
      `BT /F1 14 Tf 0 g 60 ${h - 160} Td (Documento artificial para testar a barra lateral.) Tj ET`,
    ].join('\n');
    objects[pageObject(n)] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /Font << /F1 4 0 R >> >> /Contents ${ref(pageObject(n) + 1)} >>`;
    objects[pageObject(n) + 1] =
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;
  }
  for (const item of items) {
    const siblings = item.parent ? item.parent.children : top;
    const at = siblings.indexOf(item);
    objects[item.id] =
      `<< /Title <${hex(item.title)}> /Parent ${ref(item.parent ? item.parent.id : 3)}` +
      (at > 0 ? ` /Prev ${ref(siblings[at - 1].id)}` : '') +
      (at < siblings.length - 1 ? ` /Next ${ref(siblings[at + 1].id)}` : '') +
      (item.children.length
        ? ` /First ${ref(item.children[0].id)} /Last ${ref(item.children.at(-1).id)} /Count ${item.children.length}`
        : '') +
      ` /Dest ${destination(item)} >>`;
  }

  const chunks = [Buffer.from('%PDF-1.7\n', 'latin1')];
  const offsets = [];
  let length = chunks[0].length;
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = length;
    const chunk = Buffer.from(`${id} 0 obj\n${objects[id]}\nendobj\n`, 'latin1');
    chunks.push(chunk);
    length += chunk.length;
  }
  const entries = ['0000000000 65535 f ']
    .concat(offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `))
    .join('\n');
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length}\n${entries}\ntrailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
      'latin1',
    ),
  );
  return Buffer.concat(chunks);
}
