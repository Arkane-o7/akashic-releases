const { app } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
app.whenReady().then(async () => {
 const rows = [];
 const path = require('node:path');
 const os = require('node:os');
 const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'akashic-probe-'));
 const env = {...process.env, HOME:isolated, USERPROFILE:isolated, APPDATA:path.join(isolated,'AppData','Roaming'), LOCALAPPDATA:path.join(isolated,'AppData','Local')};
 fs.mkdirSync(env.APPDATA,{recursive:true}); fs.mkdirSync(env.LOCALAPPDATA,{recursive:true});
 for (const closeInput of [true, false, true, false]) {
  const start = performance.now();
  const result = await new Promise(resolve => {
   const child = execFile('powershell.exe', ['-NoProfile','-NonInteractive','-Command', `$p = Get-Process -Id ${process.pid} -ErrorAction Stop; $p.StartTime.ToUniversalTime().Ticks`], {env, encoding:'utf8', windowsHide:true, timeout:30000}, (error, stdout) => resolve({ error:error?.message, killed:error?.killed, output:stdout.trim() }));
   if (closeInput) child.stdin.end();
  });
  rows.push({closeInput, elapsedMs:Math.round(performance.now()-start), ...result});
  console.log(rows.at(-1));
 }
 fs.mkdirSync('output/probe', {recursive:true});
 fs.writeFileSync('output/probe/result.json', JSON.stringify(rows,null,2));
 app.exit(rows.filter(r=>r.closeInput).every(r=>!r.error && /^\d+$/.test(r.output)) ? 0 : 1);
}).catch(e=>{ console.error(e); app.exit(1); });
