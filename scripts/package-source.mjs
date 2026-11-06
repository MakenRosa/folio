import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a stable version.');
const name = `folio-${version}`;
const stage = path.join('release', `source-${Date.now()}`, name);
await mkdir(stage, { recursive: true });
// Explicit roots prevent a new local report or private PDF from entering a release.
const roots = [
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.prettierignore',
  '.prettierrc.json',
  '.github/workflows/ci.yml',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'THIRD_PARTY.md',
  'VALIDATION.md',
  'package.json',
  'package-lock.json',
  'requirements-test.txt',
  'index.html',
  'tsconfig.json',
  'vite.config.ts',
  'src',
  'docs',
  'licenses',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'src-tauri/build.rs',
  'src-tauri/tauri.conf.json',
  'src-tauri/capabilities',
  'src-tauri/icons',
  'src-tauri/src',
  'src-tauri/windows',
  ...[
    'assets.mjs',
    'notices.mjs',
    'fixtures.py',
    'scanned-fixture.py',
    'test-native.mjs',
    'package-source.mjs',
  ].map((f) => `scripts/${f}`),
  ...[
    'e2e.mjs',
    'position.mjs',
    'brightness.mjs',
    'kindle.mjs',
    'kindle-restart.mjs',
    'joined-pages.mjs',
    'chapters.mjs',
    'reader-chrome.mjs',
    'goals.mjs',
    'history.mjs',
    'progress.mjs',
    'spread.mjs',
    'sidebar.mjs',
    'demo.mjs',
    'support',
    'unit',
  ].map((f) => `tests/${f}`),
];
const files = [];
const binary = new Set(['.png', '.ico']);
async function copy(relative) {
  const info = await lstat(relative);
  if (info.isSymbolicLink()) throw new Error(`Symlink not allowed: ${relative}`);
  if (info.isDirectory()) {
    for (const name of (await readdir(relative)).sort()) await copy(`${relative}/${name}`);
    return;
  }
  if (!info.isFile() || info.size > 10 * 1024 * 1024)
    throw new Error(`Unexpected file: ${relative}`);
  if (
    /\.(pdf|exe|log|sqlite|db|zip)$/i.test(relative) ||
    /(^|\/)(\.env|library[^/]*\.json)$/.test(relative)
  ) {
    throw new Error(`Private or generated file: ${relative}`);
  }
  const bytes = await readFile(relative);
  if (!binary.has(path.extname(relative))) {
    const text = bytes.toString('utf8');
    const privatePath = /[A-Z]:[\\/]+Users[\\/]+[^%\s]+/i;
    const credential =
      /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
    if (privatePath.test(text) || credential.test(text))
      throw new Error(`Review sensitive text: ${relative}`);
    if (!relative.startsWith('licenses/') && text.includes(String.fromCodePoint(0x2014))) {
      throw new Error(`Replace the em dash in: ${relative}`);
    }
  }
  const destination = path.join(stage, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(relative, destination);
  files.push({
    path: relative,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
for (const entry of roots) await copy(entry);
await writeFile(
  path.join(stage, 'SOURCE-MANIFEST.json'),
  JSON.stringify({ version, files }, null, 2) + '\n',
);
const archive = path.resolve('release', `${name}-source.zip`);
const python = process.env.FOLIO_PYTHON || 'python';
// Python's standard library creates and reopens the ZIP, checking every entry and hash.
execFileSync(
  python,
  [
    '-c',
    `
import hashlib, json, pathlib, sys, zipfile
stage, target = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
manifest = json.loads((stage / 'SOURCE-MANIFEST.json').read_text(encoding='utf-8'))
with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for item in sorted(stage.rglob('*')):
        if item.is_file(): archive.write(item, item.relative_to(stage.parent).as_posix())
with zipfile.ZipFile(target) as archive:
    prefix = stage.name + '/'
    expected = {prefix + f['path'] for f in manifest['files']} | {prefix + 'SOURCE-MANIFEST.json'}
    assert set(archive.namelist()) == expected
    assert archive.testzip() is None
    for f in manifest['files']:
        assert hashlib.sha256(archive.read(prefix + f['path'])).hexdigest() == f['sha256']
print('Verified source archive:', len(manifest['files']), 'files')
`,
    path.resolve(stage),
    archive,
  ],
  { stdio: 'inherit', windowsHide: true },
);
const archiveHash = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex');
await writeFile(`${archive}.sha256`, `${archiveHash}  ${path.basename(archive)}\n`);
console.log(archive);
