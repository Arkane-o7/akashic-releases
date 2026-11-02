// Disposable diagnostic only: retain the safety gate and trace its inputs.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { extractAll, createPackageWithOptions } from '@electron/asar';
const resources = path.join(path.dirname(process.env.UPGRADE_EXECUTABLE), 'resources');
const archive = path.join(resources, 'app.asar');
const dir = path.join(process.env.RUNNER_TEMP, 'gate-diagnostic');
extractAll(archive, dir);
let changed = 0;
function visit(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') visit(file);
    else if (entry.isFile() && /\.(cjs|mjs|js)$/.test(entry.name)) {
      let source = fs.readFileSync(file, 'utf8');
      const needle = 'if exe.startswith(root): blocked.append(p.pid)';
      if (!source.includes(needle)) continue;
      source = source.replace(needle, 'if exe.startswith(root): blocked.append((p.pid, p.ppid(), exe))');
      source = source.replace("if blocked:\n    print('Close other", "if blocked:\n    print('UPDATE_GATE_DIAGNOSTIC owned=' + str(sorted(owned)) + ' blocked=' + str(blocked))\n    print('Close other");
      fs.writeFileSync(file, source); changed++;
    }
  }
}
visit(dir);
assert.equal(changed, 1, 'Exactly one native safety gate must be traced');
await createPackageWithOptions(dir, archive, { unpack: '**/*.node' });
console.log('Disposable Windows installation instrumented; safety gate unchanged.');
