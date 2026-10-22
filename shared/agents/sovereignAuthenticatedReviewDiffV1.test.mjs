import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { captureAuthenticatedReviewDiffV1 as capture } from './sovereignAuthenticatedReviewDiffV1.mjs';
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
