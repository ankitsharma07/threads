import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
for(const file of readdirSync(new URL('.',import.meta.url)).filter(name=>name.endsWith('.test.js')).sort()) {
  const result=spawnSync(process.execPath,[`tests/${file}`],{cwd:root,stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status||1);
}
