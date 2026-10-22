import { execFileSync } from 'node:child_process';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export async function generateNotices() {
  const supplements = JSON.parse(await readFile('licenses/origins.json', 'utf8'));
  const metadata = JSON.parse(
    execFileSync(
      'cargo',
      [
        'metadata',
        '--manifest-path',
        'src-tauri/Cargo.toml',
        '--locked',
        '--format-version',
        '1',
        '--filter-platform',
        'x86_64-pc-windows-msvc',
      ],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true },
    ),
  );
  const packages = metadata.packages
    .filter((p) => p.source)
    .map((p) => ({
      name: p.name,
      version: p.version,
      license: p.license,
      folder: path.dirname(p.manifest_path),
      licenseFile: p.license_file,
    }));
  for (const name of ['pdfjs-dist', '@tauri-apps/api', '@tauri-apps/plugin-dialog']) {
    const folder = path.resolve('node_modules', name);
    const p = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'));
    packages.push({ name: p.name, version: p.version, license: p.license, folder });
  }
  const sections = ['Third-party notices for Fólio. Includes native build dependencies.'];
  const missing = [];
  for (const p of packages.sort((a, b) => a.name.localeCompare(b.name))) {
    const names = (await readdir(p.folder, { withFileTypes: true }))
      .filter((f) => f.isFile() && /^(licen[sc]e|copying|notice|copyright)([._-]|$)/i.test(f.name))
      .map((f) => f.name);
    if (p.licenseFile && !names.includes(p.licenseFile)) names.push(p.licenseFile);
    sections.push(`\n${p.name} ${p.version}\nLicense expression: ${p.license || 'See package'}\n`);
    for (const name of names) sections.push(await readFile(path.resolve(p.folder, name), 'utf8'));
    if (!names.length) {
      const extra = supplements.filter((e) => e.packages.includes(`${p.name}@${p.version}`));
      if (!extra.length) missing.push(`${p.name}@${p.version}`);
      for (const entry of extra) {
        const bytes = await readFile(path.join('licenses', entry.file));
        if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
          throw new Error(`License checksum mismatch: ${entry.file}`);
        }
        sections.push(`Source: ${entry.source || entry.url}\n`, bytes.toString('utf8'));
      }
    }
  }
  if (missing.length) throw new Error(`Missing license texts: ${missing.join(', ')}`);
  await mkdir('public/licenses', { recursive: true });
  await writeFile('public/licenses/third-party.txt', sections.join('\n'));
  await writeFile('public/licenses/folio.txt', await readFile('LICENSE'));
  console.log(`Collected license texts for ${packages.length} dependency packages.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await generateNotices();
}
