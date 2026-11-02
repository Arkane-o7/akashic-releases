// Black-box checks of the publicly distributed app. No private source or credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { _electron, expect } from '@playwright/test';

const output = path.resolve('evidence');
fs.mkdirSync(output, { recursive: true });
const receipt = { platform: process.platform, arch: process.arch, checks: [], result: 'running' };
const save = () => fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akashic-public-test-'));
const env = Object.fromEntries(['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'SystemDrive', 'ProgramData', 'PATHEXT', 'HOMEDRIVE', 'HOMEPATH'].flatMap(k => process.env[k] ? [[k, process.env[k]]] : []));
if (process.platform === 'win32') {
  Object.assign(env, { HOME: process.env.USERPROFILE, USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA });
  assert.equal(fs.existsSync(path.join(env.APPDATA, 'Akashic Alpha')), false, 'Use a disposable clean Windows account');
} else {
  Object.assign(env, { HOME: root, XDG_CONFIG_HOME: path.join(root, 'config') });
}
let app, page, state, runtime, python;
let processes = [];
const timer = setTimeout(() => { receipt.result = 'failed'; receipt.error = 'Test exceeded eight minutes'; collect(); save(); process.exit(1); }, 480000);
function collect(dir = state, depth = 0) {
  if (!dir || !fs.existsSync(dir) || depth > 7) return;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory() && !['Cache', 'Code Cache', 'GPUCache', 'packages'].includes(item.name)) collect(file, depth + 1);
    if (item.isFile() && item.name.endsWith('.log')) fs.copyFileSync(file, path.join(output, path.relative(state, file).replace(/[\\/]/g, '_')));
  }
}
async function launch() {
  app = await _electron.launch({ executablePath: process.env.TEST_EXECUTABLE, env, chromiumSandbox: true, timeout: 120000, recordVideo: { dir: path.join(output, 'videos'), size: { width: 1280, height: 900 } } });
  processes.push(app.process());
  for (const stream of [app.process().stdout, app.process().stderr]) stream?.on('data', chunk => fs.appendFileSync(path.join(output, 'electron.log'), chunk));
  page = await app.firstWindow();
  const scope = await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, userData: app.getPath('userData'), runtime: process.env.AKASHIC_LOCAL_SOURCE, python: process.env.AKASHIC_DESKTOP_PYTHON }));
  assert.equal(scope.packaged, true);
  state = path.dirname(scope.userData); runtime = scope.runtime; python = scope.python;
  receipt.checks.push({ scope }); save();
  return page;
}
async function diagnoseWindows() {
  if (process.platform !== 'win32' || !python || !runtime) return;
  const home = path.join(root, 'diagnostic-home');
  fs.mkdirSync(path.join(home, '.akashic'), { recursive: true });
  fs.writeFileSync(path.join(home, '.akashic', 'config.yaml'), '{}');
  const child = spawn(python, ['-c', "import faulthandler,runpy,sys; faulthandler.dump_traceback_later(15,repeat=True); sys.argv=['akashic','serve','--host','127.0.0.1','--port','0']; runpy.run_module('akashic_cli.main',run_name='__main__')"], {
    cwd: runtime, env: { ...env, HOME: home, USERPROFILE: home, AKASHIC_HOME: path.join(home, '.akashic'), PYTHONPATH: runtime, PYTHONNOUSERSITE: '1', PYTHONUNBUFFERED: '1', AKASHIC_DISABLE_LAZY_INSTALLS: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  const timeout = setTimeout(() => child.kill(), 75000);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => fs.appendFileSync(path.join(output, 'backend-stacks.log'), chunk));
  await new Promise(resolve => { child.once('error', resolve); child.once('exit', resolve); });
  clearTimeout(timeout);
}
async function closeNormally() {
  let timeout;
  try {
    await Promise.race([app.close(), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('App did not quit within 30 seconds')), 30000);
    })]);
  } finally { clearTimeout(timeout); }
}
const collector = setInterval(() => { try { collect(); } catch {} }, 10000);
try {
  await launch();
  await expect(page.getByRole('heading', { name: 'What should we call you?', exact: true })).toBeVisible({ timeout: 120000 });
  await page.getByLabel('Profile name', { exact: true }).fill('Public installer test');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.locator('[data-theme-choice="synth-violet"]').filter({ hasText: 'Dark' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Set up later', exact: true }).click();
  await expect(page.locator('[data-startup-splash]')).toHaveCount(0, { timeout: 120000 });
  const composer = page.locator('[data-slot="composer-rich-input"][contenteditable="true"]').first();
  await composer.fill('Installer verification draft');
  await expect(composer).toHaveText('Installer verification draft');
  receipt.checks.push({ onboarding: 'passed', composer: 'interactive' }); save();
  await page.screenshot({ path: path.join(output, 'onboarding-complete.png') });
  const update = await page.evaluate(() => window.akashicDesktop.updates.release.state());
  receipt.checks.push({ update });
  if (process.env.TEST_UPDATE_ENABLED === '1') assert.notEqual(update.phase, 'disabled');
  else assert.equal(update.phase, 'disabled'); // Public preview has manual updates.
  receipt.checks.push({ shutdownRequested: true }); save();
  await closeNormally(); app = undefined;
  await launch();
  await expect(page.locator('[data-startup-splash]')).toHaveCount(0, { timeout: 120000 });
  await expect(page.locator('html')).toHaveAttribute('data-akashic-theme', 'synth-violet', { timeout: 60000 });
  // The initial HTML splash precedes the React startup-splash element. Absence
  // of that element alone cannot establish readiness after a fresh launch.
  await expect(page.getByText('Public installer test', { exact: true }).first()).toBeVisible({ timeout: 120000 });
  await expect(page.locator('[data-slot="composer-rich-input"][contenteditable="true"]').first()).toBeVisible();
  await page.screenshot({ path: path.join(output, 'after-restart.png') });
  receipt.checks.push({ profileAndThemeSurviveRestart: true });
  receipt.result = 'passed';
} catch (error) {
  receipt.result = 'failed'; receipt.error = String(error); save();
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png'), timeout: 5000 }).catch(() => {});
  await diagnoseWindows();
  process.exitCode = 1;
} finally {
  collect(); save(); clearTimeout(timer); clearInterval(collector);
  if (app) await Promise.race([app.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 10000))]);
  for (const child of processes) if (child.exitCode === null) child.kill();
  console.log(JSON.stringify(receipt));
  process.exit(process.exitCode || 0);
}
