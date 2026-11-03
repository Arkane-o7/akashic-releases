import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {extractAll, createPackageWithOptions} from '@electron/asar';
const exe=process.env.TEST_EXE, output='output/startup-performance';
fs.mkdirSync(output,{recursive:true});
const state=path.join(process.env.APPDATA,'Akashic Alpha');
const logFile=path.join(state,'home','.akashic','logs','desktop.log');
const archive=path.join(path.dirname(exe),'resources','app.asar');
const extracted=path.join(process.env.RUNNER_TEMP,'startup-app');
extractAll(archive,extracted);
const main=path.join(extracted,'dist','electron-main.mjs');
const original=fs.readFileSync(main,'utf8');
const start=original.indexOf('function execText('), end=original.indexOf('\nvar REAP_PROBE_TIMEOUT_MS',start);
assert(start>0&&end>start);
const helper=original.slice(start,end);
assert(helper.includes('execFile(command, args,'));
const results=[];
for(const patched of [false,true,false,true]) {
 let changed=helper.replace('    execFile(command, args,','    const child = execFile(command, args,');
 if(patched) changed=changed.replace('    });\n  });','    });\n    child.stdin?.end();\n  });');
 fs.writeFileSync(main,original.slice(0,start)+changed+original.slice(end));
 await createPackageWithOptions(extracted,archive,{unpack:'**/*.node'});
 const prior=fs.existsSync(logFile)?fs.readFileSync(logFile,'utf8').length:0;
 const begin=Date.now(); const child=spawn(exe,[],{stdio:'ignore'});
 let ready=false;
 while(Date.now()-begin<150000) {
  await new Promise(r=>setTimeout(r,250));
  const log=fs.existsSync(logFile)?fs.readFileSync(logFile,'utf8').slice(prior):'';
  if(log.includes('[boot] Akashic backend is ready.')) {ready=true;break;}
  if(child.exitCode!==null) throw Error('App exited before readiness');
 }
 const log=fs.existsSync(logFile)?fs.readFileSync(logFile,'utf8').slice(prior):'';
 fs.writeFileSync(`${output}/launch-${results.length}.log`,log);
 results.push({patched,ready,readyMs:Date.now()-begin});
 fs.writeFileSync(`${output}/results.json`,JSON.stringify(results,null,2));
 execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`(Get-Process -Id ${child.pid}).CloseMainWindow()`],{timeout:15000,stdio:'ignore'});
 await Promise.race([new Promise(r=>child.once('exit',r)),new Promise((_,reject)=>setTimeout(()=>reject(Error('Quit timed out')),30000))]);
 assert(ready,'Backend did not become ready');
}
