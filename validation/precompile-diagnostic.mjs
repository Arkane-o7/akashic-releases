// Diagnostic mutation only. Never publish this locally resealed installer tree.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const payload=path.join(path.dirname(process.env.TEST_EXECUTABLE),'resources','akashic-runtime');
const source=path.join(payload,'source');
const manifest=JSON.parse(fs.readFileSync(path.join(payload,'manifest.json')));
execFileSync(path.join(source,'.venv','python.exe'),['-c',`
import compileall,py_compile,sys,re,os
assert compileall.compile_dir(sys.argv[1],quiet=1,workers=1,force=True,rx=re.compile(re.escape(os.path.join(sys.argv[1],".venv","tcl")+os.sep)),stripdir=sys.argv[1],prependdir='akashic-runtime',invalidation_mode=py_compile.PycInvalidationMode.CHECKED_HASH)
`,source],{stdio:'inherit'});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function inventory(root,prefix='') {
 const result={};
 for(const name of fs.readdirSync(path.join(root,prefix)).sort()) {
  const rel=prefix?`${prefix}/${name}`:name;
  if(rel==='manifest.json')continue;
  const file=path.join(root,rel),stat=fs.lstatSync(file);
  if(stat.isDirectory())Object.assign(result,inventory(root,rel));
  else if(stat.isFile())result[rel]={sha256:hash(fs.readFileSync(file)),executable:Boolean(stat.mode&0o111)};
  else throw Error('Unexpected diagnostic payload entry '+rel);
 }
 return result;
}
manifest.files=inventory(payload);manifest.runtimeId=hash(JSON.stringify(manifest.files));
fs.writeFileSync(path.join(payload,'manifest.json'),JSON.stringify(manifest,null,2));
console.log('Diagnostic bytecode files:',Object.keys(manifest.files).filter(x=>x.endsWith('.pyc')).length);
