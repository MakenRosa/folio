import { cp, mkdir } from 'node:fs/promises';
import { generateNotices } from './notices.mjs';
await generateNotices();
for (const name of ['cmaps', 'standard_fonts', 'wasm']) {
  await mkdir('public/pdfjs', { recursive: true });
  await cp(`node_modules/pdfjs-dist/${name}`, `public/pdfjs/${name}`, { recursive: true });
}
