// Evaluated only from the protected native profile, with every file handle held
// by its parent. Capture the complete declared module graph before any engine.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isBuiltin } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
const sourceRoot=fileURLToPath(new URL('../', import.meta.url));
const manifest=JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url),'utf8'));
if(manifest.SchemaVersion!=='stephanos.reviewer-profile-manifest.v1'
  || !/^[a-f0-9]{40}$/.test(manifest.SourceHead??'')
  || !/^[a-f0-9]{40}$/.test(manifest.SourceTree??'')
  || !Array.isArray(manifest.Files) || manifest.Files.length!==25)
  throw Error('INSTALLED_REVIEWER_MANIFEST_INVALID');
const modules=new Map();
for(const row of manifest.Files) {
  if(!/^(scripts|shared\/agents)\/[a-zA-Z0-9-]+\.mjs$/.test(row.Path)) continue;
  const url=pathToFileURL(resolvePath(sourceRoot,row.Path)).href;
  if(modules.has(url)) throw Error('INSTALLED_REVIEWER_MODULE_DUPLICATE');
  const bytes=readFileSync(new URL(url));
  if(bytes.length>2097152 || createHash('sha256').update(bytes).digest('hex')!==row.Sha256)
    throw Error('INSTALLED_REVIEWER_SOURCE_CHANGED');
  const source=bytes.toString('utf8');
  if(!Buffer.from(source).equals(bytes)) throw Error('INSTALLED_REVIEWER_SOURCE_ENCODING');
  modules.set(url,source);
}
if(modules.size!==21)throw Error('INSTALLED_REVIEWER_MODULE_CLOSURE_INVALID');
export function resolve(specifier,context) {
  if(isBuiltin(specifier))return{url:specifier.startsWith('node:')?specifier:'node:'+specifier,shortCircuit:true};
  let url;
  try{url=specifier.startsWith('file:')?new URL(specifier).href
    :specifier.startsWith('.')?new URL(specifier,context.parentURL).href
    :pathToFileURL(resolvePath(specifier)).href;}catch{throw Error('INSTALLED_REVIEWER_IMPORT_DENIED');}
  if(!modules.has(url))throw Error('INSTALLED_REVIEWER_IMPORT_DENIED');
  return{url,shortCircuit:true};
}
export function load(url,context,nextLoad) {
  if(url.startsWith('node:'))return nextLoad(url,context);
  if(!modules.has(url))throw Error('INSTALLED_REVIEWER_IMPORT_DENIED');
  return{format:'module',source:modules.get(url),shortCircuit:true};
}
