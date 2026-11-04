import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSharedWorkspaceRouter } from '../stephanos-server/routes/shared-workspace.js';
import { createSharedWorkspaceProofRecord } from '../shared/agents/sharedAgentWorkspaceStore.mjs';
const NOW='2026-10-27T16:20:00.000Z';

async function call(layer,query={}) {
  let statusCode=200,headers={},body=null;
  await layer.route.stack[0].handle({query},{
    set(value){headers={...headers,...value};return this},
    status(code){statusCode=code;return this},
    json(value){body=value;return this},
  });
  return {statusCode,headers,body};
}
function route(input){
  const r=createSharedWorkspaceRouter(input);
  const layer=r.stack.find(x=>x.route?.path==='/proof-index');
  assert.ok(layer,'existing Shared Workspace router must expose bounded read-only proof-index');
  return layer;
}
async function context(){
  const root=await mkdtemp(join(tmpdir(),'stephanos-proofs-'));
  const repoRoot=await mkdtemp(join(tmpdir(),'stephanos-proof-repo-'));
  await mkdir(join(root,'proof'),{recursive:true});
  return {root,repoRoot,env:{HOME:root,USERPROFILE:root,STEPHANOS_SHARED_AGENT_WORKSPACE:root},nowMs:Date.parse(NOW)};
}

test('missing configured workspace fails closed, returns 503 and no internal path',async()=>{
  const c=await context();delete c.env.STEPHANOS_SHARED_AGENT_WORKSPACE;
  const x=await call(route(c));
  assert.equal(x.statusCode,503);
  assert.equal(x.body.state,'INACCESSIBLE');
  assert.equal(x.body.entries.length,0);
  assert.equal(x.headers['Cache-Control'],'no-store, no-cache, must-revalidate');
  assert.equal(JSON.stringify(x.body).includes(c.root),false);
});

test('read-only endpoint safely projects goal-filtered proof while preserving source claim',async()=>{
  const c=await context();
  const record=createSharedWorkspaceProofRecord({proofId:'safe-proof',relatedIssue:'#1290',relatedPr:'#3203',correlationId:'goal-1290-proof',timestampUtc:NOW,status:'PASS',summary:'Workspace ready',proofRefs:['proof/safe-proof']});
  record.sourceHead='a'.repeat(40);
  record.proofClass='CI';
  record.reviewRunId=40507004496;
  record.artifactId=12735840855;
  record.privateKey='BEGIN PRIVATE KEY untrusted';
  await writeFile(join(c.root,'proof','safe-proof.json'),JSON.stringify(record),'utf8');
  // Private-key-shaped fields are forbidden and must not be published. The
  // existing workspace validator will fail closed on the bad record.
  const refused=await call(route(c),{goal:'#1290'});
  assert.equal(refused.body.entries.length,0);
  assert.equal(JSON.stringify(refused.body).includes('BEGIN PRIVATE KEY'),false);
  delete record.privateKey;
  await writeFile(join(c.root,'proof','safe-proof.json'),JSON.stringify(record),'utf8');
  const res=await call(route(c),{goal:'#1290'});
  assert.equal(res.statusCode,200);
  assert.equal(res.body.route,'/api/shared-workspace/proof-index');
  assert.equal(res.body.entries.length,1);
  assert.equal(res.body.entries[0].goal,1290);
  assert.equal(res.body.entries[0].stage,'CI');
  assert.equal(res.body.entries[0].state,'UNVERIFIED');
  assert.equal(res.body.entries[0].reportedResult,'PASS');
  assert.equal(res.body.authority.mergeAuthority,false);
  assert.equal(res.body.entries[0].independentVerification,false);
  assert.equal(JSON.stringify(res.body).includes('proof/safe-proof'),false);
});

test('invalid filters never reach raw path or code execution and return 400',async()=>{
  const c=await context();
  const x=await call(route(c),{goal:'../../secrets'});
  assert.equal(x.statusCode,400);
  assert.equal(x.body.state,'INVALID_FILTER');
  assert.equal(x.body.entries.length,0);
});
