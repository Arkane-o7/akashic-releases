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
const timer = setTimeout(() => { receipt.result = 'failed'; receipt.error = 'Test exceeded twelve minutes'; collect(); save(); process.exit(1); }, 720000);
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
  assert.ok(process.env.VM_MODEL_URL && process.env.VM_MODEL_KEY, 'Dedicated test model is required');
  await page.getByRole('button', { name: /Local or custom model/ }).click();
  await page.getByRole('textbox', { name: 'Base URL', exact: true }).fill(process.env.VM_MODEL_URL);
  await page.getByPlaceholder('API key (optional — only if your endpoint requires one)').fill(process.env.VM_MODEL_KEY);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('button', { name: /Model.*qwen/i })).toBeVisible({ timeout: 180000 });
  await expect(page.locator('.setup-journey')).toHaveCount(0, { timeout: 30000 });
  await expect(page.locator('[data-startup-splash]')).toHaveCount(0, { timeout: 120000 });
  const composer = page.locator('[data-slot="composer-rich-input"][contenteditable="true"]').first();
  await composer.fill('What is 17 plus 25? Answer in one short sentence, with the number written in digits. Do not use tools. /no_think');
  await composer.press('Enter');
  const answer = /^(?:The (?:answer|sum) is |17\s*\+\s*25\s*(?:=|equals|is)\s*|17 plus 25 (?:is|equals) )?42[.!]?$/i;
  // A bare '42.' is valid Markdown for an ordered-list marker. Verify the
  // actual assistant rendering, not a particular paragraph node type.
  const visibleAnswer = () => page.locator('[data-role="assistant"] p').filter({ hasText: answer })
    .or(page.locator('[data-role="assistant"] ol[start="42"]')).first();
  await expect(visibleAnswer()).toBeVisible({ timeout: 240000 });
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, { timeout: 60000 });
  receipt.checks.push({ realModel: 'qwen3.5:4b', prompt: '17 plus 25', visibleCorrectAnswer: true });
  // Let settled activity arrive before normal quit; no forced acceptance.
  await new Promise(resolve => setTimeout(resolve, 3000));
  receipt.checks.push({ onboarding: 'passed', composer: 'interactive' }); save();
  await page.screenshot({ path: path.join(output, 'onboarding-complete.png') });
  const update = await page.evaluate(() => window.akashicDesktop.updates.release.state());
  receipt.checks.push({ update });
  if (process.env.TEST_UPDATE_ENABLED === '1') assert.notEqual(update.phase, 'disabled');
  else assert.equal(update.phase, 'disabled'); // Public preview has manual updates.
  receipt.checks.push({ navigationBeforeQuit: await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => /lastRoute|lastSessionId/.test(key)))) });
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
  receipt.checks.push({ navigationAfterRestart: await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => /lastRoute|lastSessionId/.test(key)))) });
  const restoredAnswer = visibleAnswer();
  const automaticallyRestored = await restoredAnswer.isVisible();
  if (!automaticallyRestored) {
    // Verify retained history independently of the automatic-navigation finding.
    const savedChat = page.locator('[data-akashic-chat-row]');
    await expect(savedChat).toHaveCount(1, { timeout: 60000 });
    await savedChat.click();
  }
  await expect(restoredAnswer).toBeVisible({ timeout: 120000 });
  receipt.checks.push({ profileThemeAndConversationSurviveRestart: true, automaticallyRestoredConversation: automaticallyRestored });
  await page.screenshot({ path: path.join(output, 'saved-conversation.png') });
  const runtimeEnv = await app.evaluate(() => ({ ...process.env }));
  const extensionHome = path.join(root, 'extension-home');
  fs.mkdirSync(extensionHome, { recursive: true });
  fs.writeFileSync(path.join(extensionHome, 'config.yaml'), '{}');
  const extensionCode = await new Promise((resolve, reject) => {
    const child = spawn(python, [path.resolve('validation/extensions.py'), runtime, extensionHome, path.join(output, 'extensions.json')], { cwd: runtime, env: { ...runtimeEnv, AKASHIC_HOME: extensionHome }, timeout: 180000, windowsHide: true });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => fs.appendFileSync(path.join(output, 'extensions.log'), chunk));
    child.once('error', reject); child.once('exit', resolve);
  });
  assert.equal(extensionCode, 0, 'Installed-runtime extension checks must pass');
  receipt.checks.push({ skillsPluginStdioAndHttpsMcp: 'passed' });
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
  // Evidence must not retain the temporary model credential.
  for (const name of fs.readdirSync(output)) if (/\.(log|json)$/.test(name)) {
    const file = path.join(output, name);
    let text = fs.readFileSync(file, 'utf8');
    for (const secret of [process.env.VM_MODEL_KEY, process.env.VM_MODEL_URL].filter(Boolean)) text = text.replaceAll(secret, '[redacted test endpoint]');
    fs.writeFileSync(file, text);
  }
  console.log(JSON.stringify(receipt).replaceAll(process.env.VM_MODEL_KEY || 'NEVER_A_SECRET', '[redacted]'));
  process.exit(process.exitCode || 0);
}
