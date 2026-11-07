import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { captureAuthenticatedReviewDiffV1 as capture, formatAuthenticatedReviewDiffV1 as format,
  MAX_AUTHENTICATED_REVIEW_DIFF_BYTES_V1 } from './sovereignAuthenticatedReviewDiffV1.mjs';
import { resolveBattleBridgeGitExecution } from './battleBridgeExecutionBoundaryV1.mjs';
function fixture(fn){
  const root=mkdtempSync(join(tmpdir(),'reviewed-object-closure-'));
  const original=resolveBattleBridgeGitExecution();
  const git={...original,fixedConfigArgs:[...original.fixedConfigArgs,'-c','safe.directory='+root]};
  const invoke=args=>{const r=spawnSync(git.executable,[...git.fixedConfigArgs,'-C',root,...args],{
    env:git.environment,shell:false,windowsHide:true,encoding:'utf8'});assert.equal(r.status,0,String(r.stderr));return r.stdout.trim();};
  try{
    invoke(['init','-b','main']);invoke(['config','user.name','Fixture']);invoke(['config','user.email','fixture@example.invalid']);
    invoke(['config','core.autocrlf','false']);mkdirSync(join(root,'src'));
    writeFileSync(join(root,'src','reviewed.mjs'),'old source\n');writeFileSync(join(root,'unchanged.txt'),'unchanged\n');
    writeFileSync(join(root,'context.txt'),Array.from({length:30},(_,i)=>'context '+i+'\n').join(''));
    invoke(['add','.']);invoke(['commit','-m','base']);const base=invoke(['rev-parse','HEAD']);
    writeFileSync(join(root,'src','reviewed.mjs'),'new source\n');writeFileSync(join(root,'added.txt'),'new file without newline');
    writeFileSync(join(root,'context.txt'),readFileSync(join(root,'context.txt'),'utf8').replace('context 15\n','changed interior\n'));
    invoke(['add','.']);invoke(['commit','-m','head']);const head=invoke(['rev-parse','HEAD']);
    return fn({root,git,invoke,base,head});
  }finally{rmSync(root,{recursive:true,force:true});}
}
test('complete base/head tree estate and reviewed bytes are authenticated without ordinary Git diff',()=>fixture(f=>{
  const r=capture({...f,run(exe,args,options){assert.equal(args.includes('diff'),false);return spawnSync(exe,args,options);}});
  assert.deepEqual(r.changedFiles,['added.txt','context.txt','src/reviewed.mjs']);
  assert.match(r.diff,/-old source\n\+new source/);assert.match(r.diff,/No newline at end of file/);
  assert.match(r.reviewedObjectClosureSha256,/^[a-f0-9]{64}$/);
  f.invoke(['read-tree',f.base]);
  const applied=spawnSync(f.git.executable,[...f.git.fixedConfigArgs,'-C',f.root,'apply','--cached','-'],{
    input:r.diff,env:f.git.environment,shell:false,windowsHide:true,encoding:'utf8'});
  assert.equal(applied.status,0,String(applied.stderr));
  assert.equal(f.invoke(['write-tree']),f.invoke(['rev-parse',f.head+'^{tree}']),
    'in-memory diff reconstructs the complete target tree exactly');
  f.invoke(['read-tree',f.head]);
  f.invoke(['update-index','--skip-worktree','src/reviewed.mjs']);
  writeFileSync(join(f.root,'src','reviewed.mjs'),'hostile checkout bytes');
  assert.deepEqual(capture(f),r,'worktree bytes cannot replace reviewed committed content');
}));
test('temporary corruption of a reviewed non-executable blob is rejected even when restored after Git reads it',()=>fixture(f=>{
  const sha=f.invoke(['rev-parse',f.head+':src/reviewed.mjs']);
  const file=join(f.root,'.git','objects',sha.slice(0,2),sha.slice(2));const original=readFileSync(file);
  let attacked=false;
  assert.throws(()=>capture({...f,run(exe,args,options){
    if(options.input.split('\n').includes(sha)){
      attacked=true;const body=Buffer.from('substituted reviewed code\n');
      chmodSync(file,0o600);writeFileSync(file,deflateSync(Buffer.concat([Buffer.from('blob '+body.length+'\0'),body])));
      try{return spawnSync(exe,args,options);}finally{writeFileSync(file,original);}
    }
    return spawnSync(exe,args,options);
  }}),/OBJECT_CLOSURE_UNPROVEN/);
  assert.equal(attacked,true);assert.match(capture(f).diff,/new source/);
}));

function renderingFixture(f){
  const objects=new Map();
  const native=capture({...f,run(exe,args,options){
    const result=spawnSync(exe,args,options);
    if(result.status===0&&args.includes('--batch')){
      let cursor=0;
      while(cursor<result.stdout.length){
        const end=result.stdout.indexOf(10,cursor);
        const [sha,type,size]=result.stdout.toString('ascii',cursor,end).split(' ');
        objects.set(type+':'+sha,Buffer.from(result.stdout.subarray(end+1,end+1+Number(size))));
        cursor=end+Number(size)+2;
      }
    }
    return result;
  }});
  const estate=head=>new Map(f.invoke(['ls-tree','-r',head]).split('\n').filter(Boolean).map(line=>{
    const [mode,,sha,path]=line.split(/[\t ]/);return[path,{mode,sha}];
  }));
  return{native,input:{base:f.base,head:f.head,before:estate(f.base),after:estate(f.head),
    blobs:new Map([...objects].filter(([key])=>key.startsWith('blob:')).map(([key,bytes])=>[key.slice(5),bytes])),
    authenticatedObjectIds:[...objects.keys()]}};
}
test('native transport and pure renderer bind identical complete bytes, trees and object closure',()=>fixture(f=>{
  const {native,input}=renderingFixture(f),rendered=format(input);
  for(const key of Object.keys(rendered))assert.deepEqual(rendered[key],native[key],key);
  assert.equal(native.sourceTree,f.invoke(['rev-parse',f.head+'^{tree}']));
  assert.equal(native.baseTree,f.invoke(['rev-parse',f.base+'^{tree}']));
  assert.equal(native.representation,'authenticated-replacement-hunks-v1');
  assert.equal(native.fullDiff,native.diff);assert.equal(native.fullDiffBytes,Buffer.byteLength(native.diff));
  assert.equal(native.fullDiffSha256,createHash('sha256').update(native.diff).digest('hex'));
  const oldManifest=native.sourceEvidence.map(r=>[r.path,r.oldMode,r.oldBlobSha,r.newMode,r.newBlobSha,
    r.oldContentSha256,r.newContentSha256]);
  assert.equal(native.reviewedObjectClosureSha256,createHash('sha256').update(JSON.stringify([
    f.base,f.head,[...input.authenticatedObjectIds].sort(),oldManifest,native.fullDiffSha256])).digest('hex'),
    'existing native closure representation is preserved exactly');
  assert.equal(native.sourceEvidence[0].oldBlobSha,null);
  assert.equal(Object.hasOwn(rendered,'liveSourceBindingVerified'),false,'renderer cannot grant transport trust');
  assert.equal(Object.hasOwn(rendered,'approvalAuthority'),false);
}));
test('pure renderer rejects forged, missing, duplicate or surplus changed-object identity',()=>fixture(f=>{
  const {input}=renderingFixture(f),first=input.blobs.keys().next().value;
  const bad=new Map(input.blobs);bad.set(first,Buffer.from('attacker substituted reviewed bytes\n'));
  const missing=new Map(input.blobs);missing.delete(first);
  const surplus=new Map(input.blobs);surplus.set('f'.repeat(40),Buffer.from('unreviewed'));
  const cases=[{...input,blobs:bad},{...input,blobs:missing},{...input,blobs:surplus},
    {...input,authenticatedObjectIds:input.authenticatedObjectIds.concat(input.authenticatedObjectIds[0])},
    {...input,authenticatedObjectIds:input.authenticatedObjectIds.filter(k=>k!=='blob:'+first)},
    {...input,authenticatedObjectIds:input.authenticatedObjectIds.concat('commit:'+'f'.repeat(40))},
    {...input,authenticatedObjectIds:input.authenticatedObjectIds.filter(k=>!k.startsWith('tree:'))},
    {...input,base:'f'.repeat(40)}, {...input,before:new Map([...input.before,['../escape',{mode:'100644',sha:first}]])}];
  for(const row of cases)assert.throws(()=>format(row),/OBJECT_CLOSURE_UNPROVEN/);
  const changed=new Map(input.after);changed.set('added.txt',{...changed.get('added.txt'),mode:'120000'});
  assert.throws(()=>format({...input,after:changed}),/OBJECT_CLOSURE_UNPROVEN/);
}));
test('large complete canonical diffs remain bounded without truncating reviewed bytes',()=>{
  const make=bytes=>{
    const content=Buffer.from('+ real code\n'.repeat(Math.ceil(bytes/12)));
    const sha=createHash('sha1').update('blob '+content.length+'\0').update(content).digest('hex');
    return{base:'a'.repeat(40),head:'b'.repeat(40),before:new Map(),
      after:new Map([['src/reviewed.mjs',{mode:'100644',sha}]]),blobs:new Map([[sha,content]]),
      authenticatedObjectIds:['commit:'+'a'.repeat(40),'commit:'+'b'.repeat(40),'tree:'+'c'.repeat(40),'blob:'+sha]};
  };
  const r=format(make(450000));
  assert.ok(r.fullDiffBytes>256*1024);assert.ok(r.fullDiffBytes<MAX_AUTHENTICATED_REVIEW_DIFF_BYTES_V1);
  assert.equal(r.sourceEvidence.length,1);assert.equal(r.fullDiff.endsWith('++ real code\n'),true);
  assert.throws(()=>format(make(MAX_AUTHENTICATED_REVIEW_DIFF_BYTES_V1)),/OBJECT_CLOSURE_UNPROVEN/);
});
test('hunk lines resembling file headers retain their exact changed-line count',()=>fixture(f=>{
  writeFileSync(join(f.root,'src','reviewed.mjs'),'++ counter;\n--- metadata-looking source\n');
  f.invoke(['add','.']);f.invoke(['commit','-m','header-like additions']);
  const first=f.invoke(['rev-parse','HEAD']);
  const added=capture({...f,base:f.head,head:first});
  assert.equal(added.changedLineCount,3,'one removal and two additions');
  writeFileSync(join(f.root,'src','reviewed.mjs'),'-- counter;\n');
  f.invoke(['add','.']);f.invoke(['commit','-m','header-like removal']);
  const second=f.invoke(['rev-parse','HEAD']);
  const removed=capture({...f,base:second,head:first});
  assert.equal(removed.changedLineCount,3,'two additions and one header-like removal');
}));
