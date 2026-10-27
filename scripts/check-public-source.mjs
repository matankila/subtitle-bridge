import {readdirSync,readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
const ignored=new Set(['.git','node_modules','dist','.vinext','.wrangler','.next','data']);
const bad=[];let files=0;
function walk(dir='.'){
 for(const e of readdirSync(dir,{withFileTypes:true})){
  if(ignored.has(e.name))continue;const path=join(dir,e.name);if(lstatSync(path).isSymbolicLink()){bad.push(path+': unexpected symlink');continue;}
  if(e.isDirectory()){walk(path);continue;}files++;
  if((/^\.env/.test(e.name)||/^\.dev.vars/.test(e.name))&&!e.name.endsWith('.example'))bad.push(path+': real environment file');
  if(/\.(?:sqlite(?:-wal|-shm)?|db|pem|zip)$/.test(e.name))bad.push(path+': runtime/private artifact');
  const text=readFileSync(path,'utf8');
  const patterns=[new RegExp('appgprj_'+'[a-f0-9]{12,}'),new RegExp('github_'+'pat_[A-Za-z0-9_]{20,}'),new RegExp('gh[pousr]_'+'[A-Za-z0-9]{25,}'),new RegExp('AIza'+'[A-Za-z0-9_-]{25,}'),new RegExp('AQ\\.'+'[A-Za-z0-9_-]{30,}'),new RegExp('-----BEGIN '+'(?:RSA |EC |OPENSSH )?PRIVATE KEY-----')];
  if(patterns.some(p=>p.test(text)))bad.push(path+': secret/project-identity pattern');
 }
}
walk();if(bad.length){console.error(bad.join('\n'));process.exitCode=1;}else console.log(`Public-source checks passed (${files} files; no runtime state or known secret patterns).`);
