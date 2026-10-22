// Complete changed-path estate and reviewed bytes come from hash-authenticated
// base/head trees and blobs, never git diff's unverified object reads. A bounded
// unified replacement hunk is deliberately conservative; unsupported inputs HOLD.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolveBattleBridgeGitExecution } from './battleBridgeExecutionBoundaryV1.mjs';
const sha1 = (type, bytes) => createHash('sha1').update(type+' '+bytes.length+'\0').update(bytes).digest('hex');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = () => { throw Error('AUTHENTICATED_REVIEW_OBJECT_CLOSURE_UNPROVEN'); };

export function captureAuthenticatedReviewDiffV1({root,head,base,
  git=resolveBattleBridgeGitExecution(),run=spawnSync}={}) {
  if(!root || !/^[a-f0-9]{40}$/.test(head??'') || !/^[a-f0-9]{40}$/.test(base??'') || head===base) fail();
  const objects=new Map(); let total=0; const started=Date.now();
  function batch(type, ids) {
    const wanted=[...new Set(ids)].filter(id=>!objects.has(type+':'+id));
    if(!wanted.length)return;
    if(wanted.length>10000 || wanted.some(id=>!/^[a-f0-9]{40}$/.test(id)) || Date.now()-started>30000) fail();
    const r=run(git.executable,[...git.fixedConfigArgs,'-C',root,'cat-file','--batch'],{
      input:wanted.join('\n')+'\n',shell:false,windowsHide:true,env:git.environment,
      timeout:Math.max(1,30000-(Date.now()-started)),maxBuffer:32*1024*1024});
    if(r.error || r.status!==0 || !Buffer.isBuffer(r.stdout)) fail();
    let offset=0;
    for(const id of wanted) {
      const nl=r.stdout.indexOf(10,offset); if(nl<offset)fail();
      const parts=r.stdout.toString('ascii',offset,nl).split(' ');
      if(parts.length!==3 || parts[0]!==id || parts[1]!==type || !/^(0|[1-9][0-9]*)$/.test(parts[2])) fail();
      const size=Number(parts[2]);
      if(!Number.isSafeInteger(size) || size>2*1024*1024 || nl+size+2>r.stdout.length)fail();
      const bytes=Buffer.from(r.stdout.subarray(nl+1,nl+1+size));
      if(r.stdout[nl+1+size]!==10 || sha1(type,bytes)!==id)fail();
      total+=bytes.length;if(total>32*1024*1024)fail();
      objects.set(type+':'+id,bytes);offset=nl+size+2;
    }
    if(offset!==r.stdout.length)fail();
  }
  batch('commit',[head,base]);
  const tree=id=>/^tree ([a-f0-9]{40})\n/.exec(objects.get('commit:'+id).toString('utf8'))?.[1];
  if(!tree(head)||!tree(base))fail();
  const estates=[new Map(),new Map()];
  let frontier=[{side:0,prefix:'',sha:tree(base)},{side:1,prefix:'',sha:tree(head)}],entries=0,depth=0;
  while(frontier.length) {
    if(++depth>64 || frontier.length>10000)fail();
    batch('tree',frontier.map(x=>x.sha)); const next=[];
    for(const item of frontier) {
      const bytes=objects.get('tree:'+item.sha);const names=new Set();
      for(let i=0;i<bytes.length;) {
        const space=bytes.indexOf(32,i),nul=bytes.indexOf(0,space+1);
        if(space<i||nul<space||nul+21>bytes.length||++entries>40000)fail();
        const mode=bytes.toString('ascii',i,space),rawName=bytes.subarray(space+1,nul),name=rawName.toString('utf8');
        if(!Buffer.from(name).equals(rawName)||!name||name==='.'||name==='..'||/[\\/\0]/.test(name)||names.has(name))fail();
        names.add(name);const path=item.prefix+name;
        const sha=bytes.subarray(nul+1,nul+21).toString('hex');i=nul+21;
        if(mode==='40000')next.push({side:item.side,prefix:path+'/',sha});
        else {
          if(!['100644','100755','120000','160000'].includes(mode)||estates[item.side].has(path))fail();
          estates[item.side].set(path,{mode,sha});
        }
      }
    }
    frontier=next;
  }
  const [before,after]=estates;
  const changed=[...new Set([...before.keys(),...after.keys()])].filter(p=>
    before.get(p)?.sha!==after.get(p)?.sha||before.get(p)?.mode!==after.get(p)?.mode).sort();
  if(!changed.length||changed.length>64||changed.some(p=>!/^(?:[a-z0-9]|\.[a-z0-9])[a-z0-9._/-]{0,240}$/i.test(p)||p.includes('..')))fail();
  const blobIds=[];
  for(const p of changed)for(const entry of [before.get(p),after.get(p)])if(entry){
    if(!['100644','100755'].includes(entry.mode))fail();blobIds.push(entry.sha);
  }
  batch('blob',blobIds);
  const lines=entry=>{
    if(!entry)return[];const bytes=objects.get('blob:'+entry.sha),s=bytes.toString('utf8');
    if(!Buffer.from(s).equals(bytes)||s.includes('\0')||s.includes('\r'))fail();
    return s.match(/[^\n]*\n|[^\n]+$/g)||[];
  };
  let diff='';const manifest=[];
  for(const p of changed){
    const a=before.get(p),b=after.get(p),old=lines(a),fresh=lines(b);
    diff+='diff --git a/'+p+' b/'+p+'\n';
    if(!a)diff+='new file mode '+b.mode+'\n';else if(!b)diff+='deleted file mode '+a.mode+'\n';
    else if(a.mode!==b.mode)diff+='old mode '+a.mode+'\nnew mode '+b.mode+'\n';
    diff+='index '+(a?.sha??'0'.repeat(40))+'..'+(b?.sha??'0'.repeat(40))+'\n';
    diff+='--- '+(a?'a/'+p:'/dev/null')+'\n+++ '+(b?'b/'+p:'/dev/null')+'\n';
    // Only identical prefix/suffix lines may be elided. Preserve three context
    // lines on either side; all differing/interior bytes stay in one hunk.
    let prefix=0,suffix=0;
    while(prefix<old.length&&prefix<fresh.length&&old[prefix]===fresh[prefix])prefix++;
    while(suffix<old.length-prefix&&suffix<fresh.length-prefix
      &&old[old.length-1-suffix]===fresh[fresh.length-1-suffix])suffix++;
    const from=Math.max(0,prefix-3),tail=Math.min(3,suffix);
    const oldCount=old.length-suffix+tail-from,newCount=fresh.length-suffix+tail-from;
    diff+='@@ -'+(oldCount?from+1:from)+','+oldCount+' +'+(newCount?from+1:from)+','+newCount+' @@\n';
    for(const [mark,body]of [[' ',old.slice(from,prefix)],['-',old.slice(prefix,old.length-suffix)],
      ['+',fresh.slice(prefix,fresh.length-suffix)],[' ',old.slice(old.length-suffix,old.length-suffix+tail)]])
      for(const line of body){diff+=mark+line;if(!line.endsWith('\n'))diff+='\n\\ No newline at end of file\n';}
    if(Buffer.byteLength(diff)>256*1024)fail();
    manifest.push([p,a?.mode??null,a?.sha??null,b?.mode??null,b?.sha??null,
      a?hash(objects.get('blob:'+a.sha)):null,b?hash(objects.get('blob:'+b.sha)):null]);
  }
  return Object.freeze({changedFiles:Object.freeze(changed),diff,
    reviewedObjectClosureSha256:hash(JSON.stringify([base,head,[...objects.keys()].sort(),manifest,hash(diff)]))});
}
