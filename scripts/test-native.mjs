import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'win32') throw new Error('Native UI tests currently target Windows.');
const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
const runId = `${Date.now()}-${process.pid}`;
const runRoot = path.join(root, 'test-results/native', runId);
await mkdir(runRoot, { recursive: true });
await writeFile(
  path.join(runRoot, 'owner.json'),
  JSON.stringify({ purpose: 'folio-artificial-pdf-tests' }),
);
const config = path.join(runRoot, 'tauri.test.conf.json');
await writeFile(
  config,
  JSON.stringify({
    identifier: `com.folio.pdf.test.t${Date.now()}`,
    app: { appDirectoriesOverride: path.join(runRoot, 'data') },
  }),
);
const server = createServer();
await new Promise((resolve, reject) =>
  server.once('error', reject).listen(0, '127.0.0.1', resolve),
);
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const env = {
  ...process.env,
  FOLIO_CDP_URL: `http://127.0.0.1:${port}`,
  FOLIO_TEST_LIBRARY: path.join(runRoot, 'data/development'),
};
const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)),
    );
  });
const node = (file, ...args) => run(process.execPath, [file, ...args]);
let app;
async function launch() {
  app = spawn(path.join(root, 'src-tauri/target/debug/lume-pdf.exe'), [], {
    cwd: root,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  });
  for (let attempt = 0; attempt < 120; attempt++) {
    if (app.exitCode !== null) throw new Error('Isolated app exited before becoming ready.');
    try {
      const response = await fetch(`${env.FOLIO_CDP_URL}/json/list`);
      if ((await response.json()).some((tab) => tab.url?.includes('tauri.localhost'))) return;
    } catch {
      /* WebView2 is still starting. */
    }
    await delay(250);
  }
  throw new Error('Timed out starting the isolated WebView2.');
}
async function waitClosed() {
  for (let i = 0; i < 80 && app.exitCode === null; i++) await delay(100);
  if (app.exitCode === null) throw new Error('The app did not close after the persistence test.');
}
try {
  const python = process.env.FOLIO_PYTHON || 'python';
  await run(python, ['scripts/fixtures.py']);
  await run(python, ['scripts/scanned-fixture.py']);
  await node(
    'node_modules/@tauri-apps/cli/tauri.js',
    'build',
    '--debug',
    '--no-bundle',
    '--config',
    config,
  );
  await launch();
  for (const file of ['e2e', 'position', 'brightness', 'kindle']) await node(`tests/${file}.mjs`);
  await node('tests/kindle-restart.mjs', 'prepare');
  await waitClosed();
  await launch();
  await node('tests/kindle-restart.mjs', 'verify');
  await waitClosed();
  if (process.argv.includes('--demo')) {
    await launch();
    await node('tests/demo.mjs');
    await waitClosed();
  }
  await writeFile(path.join(runRoot, 'result.json'), JSON.stringify({ passed: true, runId }));
  console.log('Native suites passed. Installed app and personal library were not used.');
} finally {
  // Stop only the child started by this runner. Keep artifacts for diagnosis.
  if (app && app.exitCode === null) app.kill();
}
