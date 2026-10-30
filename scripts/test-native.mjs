import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
const server = createServer();
await new Promise((resolve, reject) =>
  server.once('error', reject).listen(0, '127.0.0.1', resolve),
);
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
// The DevTools port goes into the test build's own window options. Some WebView2 installations
// (the GitHub Windows runner, for one) ignore WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, and setting
// the options replaces Tauri's default arguments, so those are kept here too.
const { app: appConfig } = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
const config = path.join(runRoot, 'tauri.test.conf.json');
await writeFile(
  config,
  JSON.stringify({
    identifier: `com.folio.pdf.test.t${Date.now()}`,
    app: {
      appDirectoriesOverride: path.join(runRoot, 'data'),
      windows: appConfig.windows.map((window) => ({
        ...window,
        additionalBrowserArgs: `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port=${port}`,
      })),
    },
  }),
);
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
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
    env: { ...env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  });
  // Kept for the error below: a panic or a WebView2 failure is told on stderr.
  let stderr = '';
  app.stderr.on('data', (chunk) => (stderr = (stderr + chunk).slice(-4000)));
  // The first WebView2 start on a fresh CI machine can take far longer than on a desktop.
  let last = 'no answer yet';
  for (let attempt = 0; attempt < 480; attempt++) {
    if (app.exitCode !== null)
      throw new Error(`Isolated app exited before becoming ready (${app.exitCode}).\n${stderr}`);
    try {
      const response = await fetch(`${env.FOLIO_CDP_URL}/json/list`);
      const tabs = await response.json();
      if (tabs.some((tab) => tab.url?.includes('tauri.localhost'))) return;
      last = `pages: ${tabs.map((tab) => tab.url).join(', ') || 'none'}`;
    } catch (error) {
      /* WebView2 is still starting. */
      last = String(error?.cause?.code || error);
    }
    await delay(250);
  }
  throw new Error(
    `Timed out starting the isolated WebView2 (last: ${last}).\n${stderr}\n${launchReport()}`,
  );
}
// What the machine shows when WebView2 never answers: its processes, the app's windows, the
// files WebView2 left in the isolated profile, and a picture of the screen for the CI evidence.
function launchReport() {
  const shell = (script) => {
    try {
      return execFileSync('powershell', ['-NoProfile', '-Command', script], {
        encoding: 'utf8',
        timeout: 30000,
      }).trim();
    } catch (error) {
      return `(${String(error).split('\n')[0]})`;
    }
  };
  const shot = path.join(root, 'test-results', 'native-launch-timeout.png').replaceAll("'", "''");
  return [
    'WebView2 processes:',
    shell(
      'Get-CimInstance Win32_Process -Filter "Name=\'msedgewebview2.exe\'" | Select-Object -First 3 -ExpandProperty CommandLine',
    ),
    'App windows:',
    shell(
      `Get-Process -Id ${app.pid} | Format-List Responding,MainWindowTitle,MainWindowHandle,SessionId | Out-String`,
    ),
    'Profile files:',
    shell(
      `Get-ChildItem -Recurse -Depth 2 '${runRoot.replaceAll("'", "''")}\\data' | Select-Object -First 25 -ExpandProperty FullName`,
    ),
    'Screen:',
    shell(
      `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $p = New-Object System.Drawing.Bitmap $b.Width, $b.Height; [System.Drawing.Graphics]::FromImage($p).CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size); $p.Save('${shot}'); "saved $($b.Width)x$($b.Height)"`,
    ),
  ].join('\n');
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
  for (const file of ['e2e', 'position', 'brightness', 'kindle', 'joined-pages', 'chapters'])
    await node(`tests/${file}.mjs`);
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
