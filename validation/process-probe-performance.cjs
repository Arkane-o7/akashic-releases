const { app } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
app.whenReady().then(async () => {
 const rows = [];
 for (const closeInput of [false, true, true]) {
  const start = performance.now();
  const result = await new Promise(resolve => {
   const child = execFile('powershell.exe', ['-NoProfile','-NonInteractive','-Command', `$p = Get-Process -Id ${process.pid} -ErrorAction Stop; $p.StartTime.ToUniversalTime().Ticks`], {encoding:'utf8', windowsHide:true, timeout:30000}, (error, stdout) => resolve({ error:error?.message, killed:error?.killed, output:stdout.trim() }));
   if (closeInput) child.stdin.end();
  });
  rows.push({closeInput, elapsedMs:Math.round(performance.now()-start), ...result});
  console.log(rows.at(-1));
 }
 fs.mkdirSync('output/probe', {recursive:true});
 fs.writeFileSync('output/probe/result.json', JSON.stringify(rows,null,2));
 app.exit(rows.filter(r=>r.closeInput).every(r=>!r.error && /^\d+$/.test(r.output)) ? 0 : 1);
}).catch(e=>{ console.error(e); app.exit(1); });
