/** Real packaged updater, isolated HTTP feed; no model or updater mocks. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { _electron } from '@playwright/test';
import { load, dump } from 'js-yaml';

const output = path.resolve('output/upgrade');
fs.mkdirSync(output, { recursive: true });
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'akashic-upgrade-')));
// Windows known folders belong to the runner's real OS account. A fabricated
// USERPROFILE can make Chromium fail before startup; the VM itself is fresh.
const config = process.platform === 'win32' ? process.env.APPDATA : path.join(root, 'config');
const local = process.platform === 'win32' ? process.env.LOCALAPPDATA : path.join(root, 'local');
for (const dir of [config, local]) fs.mkdirSync(dir, { recursive: true });
const state = path.join(config, 'Akashic Alpha');
assert.equal(fs.existsSync(state), false, 'Rehearsal requires a fresh disposable account');
const before = '0.1.0-alpha.9001', after = '0.1.0-alpha.9002';
const feed = path.resolve(process.env.UPGRADE_FEED);
const executable = path.resolve(process.env.UPGRADE_EXECUTABLE);
const receipt = { platform: process.platform, format: process.env.UPGRADE_FORMAT, before, after, root, executable, checks: [], requests: [] };
const save = () => fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2));
let mode = 'offline';
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).slice(1);
  receipt.requests.push({ mode, name, range: req.headers.range }); save();
  if (mode === 'offline') { res.writeHead(503).end('Rehearsal: offline'); return; }
  if (path.basename(name) !== name || !fs.existsSync(path.join(feed, name))) { res.writeHead(404).end(); return; }
  const file = path.join(feed, name);
  if (name.endsWith('.yml')) {
    const doc = load(fs.readFileSync(file, 'utf8'));
    if (mode === 'corrupt') {
      doc.sha512 = Buffer.alloc(64, 1).toString('base64');
      for (const f of doc.files) f.sha512 = doc.sha512;
    }
    res.writeHead(200, { 'Content-Type': 'text/yaml' }).end(dump(doc)); return;
  }
  const size = fs.statSync(file).size;
  const match = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  const start = match ? Number(match[1]) : 0;
  const end = match?.[2] ? Number(match[2]) : size - 1;
  res.writeHead(match ? 206 : 200, { 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(match ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
  fs.createReadStream(file, { start, end }).pipe(res);
});
await new Promise(resolve => server.listen(18765, '127.0.0.1', resolve));
const env = Object.fromEntries(['PATH','TMPDIR','TMP','TEMP','LANG','DISPLAY','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS','SystemRoot','SYSTEMROOT','COMSPEC','WINDIR','USERNAME','USERDOMAIN','COMPUTERNAME','SystemDrive','ProgramData','PATHEXT','HOMEDRIVE','HOMEPATH'].flatMap(k => process.env[k] ? [[k, process.env[k]]] : []));
Object.assign(env, { HOME: process.platform === 'win32' ? process.env.USERPROFILE : root, USERPROFILE: process.platform === 'win32' ? process.env.USERPROFILE : root, APPDATA: config, LOCALAPPDATA: local, XDG_CONFIG_HOME: config });
let app, page, automaticPid, onboarding = false;
const log = value => { console.log(value); fs.appendFileSync(path.join(output, 'test.log'), `${value}\n`); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (fn, timeout = 120_000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const result = await fn(); if (result) return result; await delay(1000); } throw new Error('Timed out waiting for native upgrade condition'); };
function collect(dir = state, depth = 0) {
  if (!fs.existsSync(dir) || depth > 8) return;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory() && !['Cache','Code Cache','GPUCache','packages'].includes(item.name)) collect(file, depth + 1);
    else if (item.isFile() && item.name.endsWith('.log')) fs.copyFileSync(file, path.join(output, path.relative(state, file).replace(/[\\/]/g, '_')));
  }
}
const collector = setInterval(() => { try { collect(); } catch {} }, 5000);
const hardTimeout = setTimeout(() => { receipt.result = 'failed'; receipt.error = 'Upgrade exceeded its twelve-minute bound'; log(receipt.error); collect(); save(); process.exit(1); }, 720_000);
const capture = process.platform === 'win32' ? setInterval(() => {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.resolve('validation/capture-windows.ps1'), '-OutputDirectory', output], { timeout: 12_000, stdio: 'ignore' });
  child.on('error', () => {});
}, 20_000) : undefined;
async function launch() {
  app = await _electron.launch({ executablePath: executable, env, args: [], chromiumSandbox: true, timeout: 150_000, recordVideo: { dir: path.join(output, 'videos'), size: { width: 1280, height: 900 } } });
  for (const stream of [app.process().stdout, app.process().stderr]) stream?.on('data', chunk => fs.appendFileSync(path.join(output, 'electron.log'), chunk));
  page = await app.firstWindow({ timeout: 90_000 });
  page.setDefaultTimeout(45_000);
  await page.waitForFunction(() => Boolean(window.akashicDesktop?.updates?.release), { timeout: 90_000 });
  const scope = await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, userData: app.getPath('userData'), python: process.env.AKASHIC_DESKTOP_PYTHON, runtime: process.env.AKASHIC_LOCAL_SOURCE, pid: process.pid }));
  assert.equal(scope.packaged, true); assert.equal(path.resolve(scope.userData), path.join(state, 'electron'));
  const manifest = JSON.parse(fs.readFileSync(path.join(scope.runtime, '..', 'manifest.json'), 'utf8'));
  receipt.checks.push({ scope, payload: { sourceCommit: manifest.sourceCommit, runtimeId: manifest.runtimeId, appVersion: manifest.appVersion, platform: manifest.platform, arch: manifest.arch } }); save(); return scope;
}
async function action(name) {
  const result = await page.evaluate(name => window.akashicDesktop.updates.release[name](), name);
  receipt.checks.push({ action: name, result }); save(); return result;
}
try {
  const first = await launch(); assert.equal(first.version, before);
  assert.notEqual((await action('state')).phase, 'disabled');
  assert.equal((await action('check')).phase, 'error');
  mode = 'corrupt';
  assert.equal((await action('check')).phase, 'available');
  const corrupt = await action('download');
  assert.equal(corrupt.phase, 'error'); assert.match(corrupt.error, /sha512|checksum/i);
  assert.equal((await app.evaluate(({ app }) => app.getVersion())), before);
  mode = 'good';
  assert.equal((await action('check')).phase, 'available');
  assert.equal((await action('download')).phase, 'ready');
  // Save actual profile/appearance via onboarding if the native backend becomes ready.
  // Failure is evidence, not grounds to bypass the updater or pretend onboarding passed.
  try {
    await page.getByLabel('Profile name', { exact: true }).fill('Upgrade rehearsal', { timeout: 90_000 });
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('[data-theme-choice="synth-violet"]').filter({ hasText: 'Dark' }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Set up later', exact: true }).click();
    onboarding = true;
    receipt.checks.push({ onboarding: 'passed' });
  } catch (error) { receipt.checks.push({ onboarding: 'failed', error: String(error) }); }
  // Persist through Chromium, plus a named profile fixture in the real profile directory.
  await page.evaluate(() => localStorage.setItem('upgrade-rehearsal', 'preserve-me'));
  const sentinel = path.join(state, 'home', '.akashic', 'upgrade-rehearsal.txt');
  fs.writeFileSync(sentinel, 'Saved profile data must survive an update.\n');
  await page.screenshot({ path: path.join(output, 'before-update.png') });
  // First-run plugin dependencies can still be installing after onboarding.
  // Observe them finishing; never kill workers or bypass the native safety check.
  const processHistory = [];
  await until(() => {
    const processes = spawnSync(first.python, ['-c', `
import json, os, psutil, sys
root=os.path.normcase(os.path.realpath(sys.argv[1]))+os.sep
rows=[]
for p in psutil.process_iter(['pid','ppid','exe','cmdline']):
    try:
        if p.pid != os.getpid() and os.path.normcase(os.path.realpath(p.exe())).startswith(root): rows.append(p.info)
    except (psutil.NoSuchProcess, psutil.AccessDenied): pass
print(json.dumps(rows))
`, first.runtime], { encoding: 'utf8', timeout: 30_000, env });
    assert.equal(processes.status, 0, processes.stderr);
    const rows = JSON.parse(processes.stdout);
    processHistory.push({ time: new Date().toISOString(), rows });
    fs.writeFileSync(path.join(output, 'runtime-processes.json'), JSON.stringify(processHistory, null, 2));
    const ownership = path.join(state, 'electron', 'backend-ownership.json');
    const owned = fs.existsSync(ownership) ? JSON.parse(fs.readFileSync(ownership)).backends.map(row => row.pid) : [];
    if (fs.existsSync(ownership)) fs.copyFileSync(ownership, path.join(output, 'backend-ownership.json'));
    return rows.every(row => owned.includes(row.pid));
  }, 120_000);
  const video = page.video();
  const originalApp = app;
  // An attached main-process debugger can keep the old Windows executable
  // alive and locked. Disconnect only test instrumentation before requesting
  // the real update; renderer IPC and the app's full quit lifecycle stay intact.
  await app.evaluate(() => {
    const inspector = process.getBuiltinModule('node:inspector');
    setTimeout(() => inspector.close(), 100);
  });
  await delay(300);
  if (onboarding) {
    await page.getByRole('button', { name: 'Restart and update', exact: true }).click();
    await page.getByRole('heading', { name: 'Ready to update', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'update-dialog.png') });
    await page.getByRole('dialog').getByRole('button', { name: 'Restart and update', exact: true }).click();
    receipt.checks.push({ installThroughVisibleButton: true }); save();
    await until(async () => {
      if (page.isClosed()) return true;
      try { const value = await action('state'); assert.notEqual(value.phase, 'error', value.error); return value.phase === 'installing'; }
      catch (error) { if (page.isClosed()) return true; throw error; }
    });
  } else {
    const installing = await action('install');
    assert.equal(installing.phase, 'installing');
  }
  await until(() => page.isClosed());
  // AppImage's wrapper can stay alive while its updater-spawned successor runs.
  // The native new-version startup receipt, not wrapper exit, proves restart.
  // This receipt is emitted by the automatically restarted NEW packaged app.
  const startup = await until(() => {
    collect();
    for (const file of fs.readdirSync(output).filter(f => f.endsWith('.log'))) {
      for (const line of fs.readFileSync(path.join(output, file), 'utf8').split('\n')) {
        const index = line.indexOf('[release-update] startup ');
        if (index < 0) continue;
        try { const row = JSON.parse(line.slice(index + '[release-update] startup '.length)); if (row.version === after) return row; } catch {}
      }
    }
  }, 180_000);
  automaticPid = startup.pid;
  assert.equal(path.resolve(startup.userData), path.join(state, 'electron'));
  assert.equal(startup.enabled, true);
  receipt.checks.push({ automaticRestart: startup }); save();
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'Saved profile data must survive an update.\n');
  // Close only this observed rehearsal process to attach automation to a fresh launch.
  if (process.platform === 'win32') {
    await until(() => {
      const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${automaticPid}).CloseMainWindow()`], { timeout: 15_000, encoding: 'utf8' });
      return result.status === 0 && result.stdout.trim() === 'True';
    }, 90_000);
  }
  else {
    const row = await until(() => {
      const windows = spawnSync('wmctrl', ['-lp'], { encoding: 'utf8' });
      assert.equal(windows.status, 0);
      return windows.stdout.split('\n').find(line => Number(line.trim().split(/\s+/)[2]) === automaticPid);
    }, 90_000);
    const closed = spawnSync('wmctrl', ['-ic', row.trim().split(/\s+/)[0]]);
    assert.equal(closed.status, 0);
  }
  await until(() => { try { process.kill(automaticPid, 0); return false; } catch { return true; } }, 60_000);
  automaticPid = undefined;
  await originalApp.close().catch(() => {});
  if (video) await video.saveAs(path.join(output, 'upgrade.webm'));
  app = undefined;
  const second = await launch(); assert.equal(second.version, after);
  assert.equal(await page.evaluate(() => localStorage.getItem('upgrade-rehearsal')), 'preserve-me');
  assert.equal((await action('check')).phase, 'current');
  if (onboarding) {
    await until(async () => (await page.locator('html').getAttribute('data-akashic-theme')) === 'synth-violet');
    await page.getByText('Upgrade rehearsal', { exact: true }).first().waitFor({ timeout: 90_000 });
    await page.locator('[data-startup-splash]').waitFor({ state: 'hidden', timeout: 120_000 });
    const composer = page.locator('[data-slot="composer-rich-input"][contenteditable="true"]').first();
    await composer.fill('Update verification draft');
    assert.equal(await composer.innerText(), 'Update verification draft');
    await composer.fill('');
    receipt.checks.push({ savedProfileAndThemeVisibleAfterUpdate: true, workspaceInteractiveAfterUpdate: true });
  }
  await page.screenshot({ path: path.join(output, 'after-update.png') });
  receipt.result = 'passed'; save();
  await app.close(); app = undefined;
} catch (error) {
  receipt.result = 'failed'; receipt.error = String(error); save(); log(error.stack || String(error));
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png'), timeout: 5000 }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (capture) clearInterval(capture);
  collect(); save(); clearInterval(collector); clearTimeout(hardTimeout); server.closeAllConnections(); server.close();
  if (app) { try { await Promise.race([app.close(), delay(15_000)]); } catch {} }
  // CI runner is disposable. Bound only the process explicitly launched by this test.
  if (app?.process().pid) {
    if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(app.process().pid), '/T', '/F'], { timeout: 15_000 });
    else { try { app.process().kill('SIGKILL'); } catch {} }
  }
  process.exit(process.exitCode || 0);
}
