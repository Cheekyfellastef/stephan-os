// Synthetic Git objects only. This fixture has no host, authority or custody.
import {createHash} from 'node:crypto';
export const fixtureSha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function fixtureGitObject(type,value) {
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);
  return {sha:createHash('sha1').update(type+' '+bytes.length+'\0').update(bytes).digest('hex'),bytes};
}
export function fixtureProofWire(commit,trees) {
  return ['STEPHANOS_FIXED_RUNTIME_SOURCE_V1',commit.sha,commit.bytes.toString('base64'),
    ...[...trees].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([sha,bytes])=>sha+':'+bytes.toString('base64'))].join(' ');
}
export function makeFixedRuntimeSourceProofFixtureV1({
  files=[{path:'scripts/fixture.mjs',content:'export const fixture = true;\n',mode:'100644'}],
  extras=[],message='fixture commit',
}={}) {
  const allTrees=new Map(),entriesByTree=new Map(),root=new Map(),members=[];
  for(const row of [...files,...extras]) {
    let node=root;const parts=row.path.split('/');
    for(const part of parts.slice(0,-1)) {
      if(!node.has(part))node.set(part,new Map());
      node=node.get(part);
    }
    const blob=fixtureGitObject('blob',row.content??'fixture\n');
    node.set(parts.at(-1),{mode:row.mode??'100644',sha:blob.sha});
    if(files.includes(row))members.push({Path:row.path,GitMode:row.mode??'100644',GitBlobSha:blob.sha});
  }
  function build(node) {
    const rows=[...node].map(([name,value])=>value instanceof Map
      ?{name,mode:'40000',sha:build(value)}:{name,...value});
    rows.sort((a,b)=>Buffer.compare(Buffer.from(a.name+(a.mode==='40000'?'/':'')),Buffer.from(b.name+(b.mode==='40000'?'/':''))));
    const object=fixtureGitObject('tree',Buffer.concat(rows.map(row=>Buffer.concat([
      Buffer.from(row.mode+' '+row.name+'\0'),Buffer.from(row.sha,'hex')]))));
    allTrees.set(object.sha,object.bytes);entriesByTree.set(object.sha,new Map(rows.map(row=>[row.name,row])));
    return object.sha;
  }
  const tree=build(root),trees=new Map();
  for(const member of members) {
    let id=tree;const parts=member.Path.split('/');
    for(const part of parts) {
      trees.set(id,allTrees.get(id));const row=entriesByTree.get(id).get(part);
      if(row.mode==='40000')id=row.sha;
    }
  }
  const commit=fixtureGitObject('commit','tree '+tree+'\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\n\n'+message+'\n');
  const raw=fixtureProofWire(commit,trees);
  const ordered=[...members].sort((a,b)=>a.Path<b.Path?-1:a.Path>b.Path?1:0);
  const gitClosureSha256=fixtureSha256('stephanos.fixed-runtime-git-closure.v1\0'+ordered.map(row=>row.Path+'\0'+row.GitMode+'\0'+row.GitBlobSha+'\n').join(''));
  return {head:commit.sha,tree,commit,trees,allTrees,entriesByTree,raw,members,
    paths:members.map(row=>row.Path),gitClosureSha256,sourceProofSha256:fixtureSha256(raw)};
}
