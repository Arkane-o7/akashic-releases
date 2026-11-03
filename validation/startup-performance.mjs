import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import {extractAll,createPackageWithOptions} from '@electron/asar';
const exe=process.env.TEST_EXE, output='output/startup-performance';
fs.mkdirSync(output,{recursive:true});
const state=path.join(process.env.APPDATA,'Akashic Alpha');
const logFile=path.join(state,'home','.akashic','logs','desktop.log');
const runtime=path.join(path.dirname(exe),'resources','akashic-runtime');
const source=path.join(runtime,'source');
const base=path.join(source,'tui_gateway/contracts/base.py');
const original=fs.readFileSync(base,'utf8');
const python=path.join(source,'.venv/python.exe');
const manifestPath=path.join(runtime,'manifest.json');
const originalManifest=fs.readFileSync(manifestPath,'utf8');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const archive=path.join(path.dirname(exe),'resources','app.asar');
const extracted=path.join(process.env.RUNNER_TEMP,'inventory-app');
extractAll(archive,extracted);
const portable=path.join(extracted,'runtime/portable.cjs');
const originalPortable=fs.readFileSync(portable,'utf8');
const inventoryStart=originalPortable.indexOf('function inventory('),inventoryEnd=originalPortable.indexOf('\nfunction pythonPath',inventoryStart);
assert(inventoryStart>0&&inventoryEnd>inventoryStart);
const implementation=fs.readFileSync('validation/streaming-inventory.cjs','utf8');
const replacement=implementation.slice(implementation.indexOf('function inventory('),implementation.indexOf('\nmodule.exports='));
const results=[];
for(const patched of [false,true,false,true,false,true]) {
 const changed=patched?original.replaceAll('ConfigDict(extra="forbid")','ConfigDict(extra="forbid", defer_build=True)').replace('ConfigDict(extra="forbid", populate_by_name=True)','ConfigDict(extra="forbid", populate_by_name=True, defer_build=True)'):original;
 assert(!patched||changed!==original,'Expected original schema configuration');
 fs.writeFileSync(base,changed);
 execFileSync(python,['-c','import py_compile,sys; py_compile.compile(sys.argv[1],dfile="akashic-runtime/tui_gateway/contracts/base.py",doraise=True,invalidation_mode=py_compile.PycInvalidationMode.CHECKED_HASH)',base],{stdio:'pipe'});
 // Reseal this disposable experimental candidate; the app still performs its
 // full inventory verification. Never upload these modified installers.
 const manifest=JSON.parse(originalManifest);
 for(const key of Object.keys(manifest.files)) {
  if(key==='source/tui_gateway/contracts/base.py'||key.startsWith('source/tui_gateway/contracts/__pycache__/base.'))
   manifest.files[key].sha256=hash(fs.readFileSync(path.join(runtime,key)));
 }
 manifest.runtimeId=hash(JSON.stringify(manifest.files));
 fs.writeFileSync(manifestPath,JSON.stringify(manifest));
 fs.writeFileSync(portable,patched?originalPortable.slice(0,inventoryStart)+replacement+originalPortable.slice(inventoryEnd):originalPortable);
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
