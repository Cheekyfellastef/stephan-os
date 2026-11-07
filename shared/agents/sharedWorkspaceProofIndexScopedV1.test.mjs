import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHARED_WORKSPACE_PROOF_INDEX_SCHEMA, PROOF_INDEX_STAGES,
  projectSharedWorkspaceProofIndex,
} from './sharedWorkspaceProofIndexV1.mjs';
const NOW = '2026-10-27T16:20:00.000Z';
const SHA = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const TREE = 'c'.repeat(40);
const main = () => ({
  schemaVersion: 'shared-agent-workspace-record.v1',
  kind: 'stephanos.shared_workspace.proof',
  proofId: 'review-3203',
  participantId: 'sovereign-reviewer',
  timestampUtc: NOW, correlationId: 'goal-1574-review-3203', relatedIssue: '#1574', relatedPr: '#3203',
  proofClass: 'INDEPENDENT_REVIEW', status: 'PASS', sourceHead: SHA,
  sourceTree: TREE, baseSha: BASE,
  reviewRunId: 40507004496, reviewRunAttempt: 1, reviewArtifactId: 12735840855,
  reviewArtifactDigest: 'sha256:'+'d'.repeat(64),
  proofRefs: ['proof/private/windows/path.json'],
});
const feed = (items = [main()]) => ({state:'ready',records:{
  proofRecords:items,
  receiptRecords:[],
  goalRecords:[{relatedIssue:'#1574',title:'Provider-neutral build and review continuity'}],
}});
const project = (input={}) => projectSharedWorkspaceProofIndex({feed:feed(),nowMs:Date.parse(NOW),...input});

test('strict bounded read-only projection does not grant any authority or equate CI with merge', () => {
  const p=project();
  assert.equal(p.schemaVersion,SHARED_WORKSPACE_PROOF_INDEX_SCHEMA);
  assert.equal(p.state,'READY');assert.equal(p.total,1);
  const e=p.entries[0];
  assert.equal(e.goal,1574);assert.equal(e.prNumber,3203);
  assert.equal(e.goalTitle,'Provider-neutral build and review continuity');
  assert.equal(e.stage,'INDEPENDENT_REVIEW');assert.equal(e.state,'UNVERIFIED');
  assert.equal(e.reportedResult,'PASS');assert.equal(e.sourceHead,SHA);
  assert.equal(e.sourceTree,TREE);assert.equal(e.baseSha,BASE);
  assert.equal(e.sourceLink,'https://github.com/Cheekyfellastef/stephan-os/actions/runs/40507004496/artifacts/12735840855');
  assert.equal(e.artifactDigest,'sha256:'+'d'.repeat(64));
  assert.equal(e.independentVerification,false);assert.equal(e.reviewerQualification,false);
  assert.equal(e.protectedMergeProven,false);assert.equal(e.installedProven,false);assert.equal(e.osPickupProven,false);
  assert.deepEqual(Object.values(p.authority),[false,false,false,false,false]);
  assert.equal(JSON.stringify(p).includes('proof/private/windows/path.json'),false);
});

test('unreachable feed reports INACCESSIBLE without inferring absence of proof', () => {
  for(const state of ['unavailable','error','loading','']){
    const p=project({feed:{state,records:feed().records}});
    assert.equal(p.state,'INACCESSIBLE');assert.equal(p.total,0);
    assert.deepEqual(p.entries,[]);
    assert.equal(p.blockers[0],'WORKSPACE_FEED_UNAVAILABLE');
  }
});

test('empty scoped feed shows unknown rather than green and honors strict filters', () => {
  assert.equal(project({goal:'#9999'}).blockers[0],'NO_SCOPED_WORKSPACE_PROOF_RECORDS');
  for(const bad of [{goal:'../etc'},{pr:'1&head=abc'},{head:'short'},{goal:{x:1}}]) {
    assert.equal(project(bad).state,'INVALID_FILTER');
  }
  assert.equal(project({goal:'#1574',pr:'#3203',head:SHA}).total,1);
  assert.equal(project({goal:'#1574',pr:'#3203',head:BASE}).total,0);
  assert.equal(project({goal:'#9999'}).total,0);
});

test('valid reported failure has no PASS promotion',()=>{
  const p=project({feed:feed([{...main(), status:'BLOCKED'}])});
  assert.equal(p.entries[0].state,'FAILED');
  assert.equal(p.entries[0].nextGate,'INSPECT_ORIGINAL_FAILURE');
});

test('expired and future timestamps classify STALE',()=>{
  for(const at of ['2026-10-27T11:00:00.000Z','2026-10-27T16:24:00.000Z']) {
    const p=project({feed:feed([{...main(),timestampUtc:at}])});
    assert.equal(p.entries[0].state,'STALE');
  }
});

test('different current goal head marks earlier record SUPERSEDED even if reported PASS',()=>{
  const p=project({currentHeads:{1574:BASE}});
  assert.equal(p.entries[0].state,'SUPERSEDED');
  assert.equal(p.entries[0].nextGate,'OBTAIN_CURRENT_HEAD_PROOF');
});

test('foreigner and unsafe proofs are discarded or truncated to safe allowlist fields',()=>{
  const malicious={...main(),proofId:'../../token', participantId:'C:\\private\\key', sourceHead:'h'.repeat(40),
    status:'PASS secret key',reviewRunId:-2, reviewArtifactId:1e15,reviewArtifactDigest:'wrong',
    originalUrl:'https://evil.invalid/?token=abc',localPath:'C:\\Windows\\System32\\config', body:'SECRET'};
  const p=project({feed:feed([malicious,{...main(),proofId:'proof-safe',originalUrl:'https://evil.invalid/?token=abc'}])});
  assert.equal(p.total,1);assert.equal(p.entries[0].proofId,'proof-safe');
  const txt=JSON.stringify(p);
  assert.equal(txt.includes('evil.invalid'),false);assert.equal(txt.includes('C:\\Windows'),false);
  assert.equal(txt.includes('SECRET'),false);
});

test('unknown proof class cannot masquerade as privileged stage',()=>{
  const p=project({feed:feed([{...main(),proofClass:'credential-merge-confirmation', status:'PASS'}])});
  assert.equal(p.entries[0].stage,'UNKNOWN');
  assert.equal(p.entries[0].state,'UNVERIFIED');
});

test('distinct immutable heads, attempts and failures are not overwritten by de-duplication',()=>{
  const first=main();
  const rows=[first,{...first}, {...first,sourceHead:BASE}, {...first, reviewRunAttempt:2},
    {...first, status:'FAILED'}];
  const p=project({feed:feed(rows)});
  assert.equal(p.total,4);
  assert.ok(p.entries.some(x=>x.state==='FAILED'));
});

test('read result is bounded, stable order, deterministic under equal timestamps',()=>{
  const rows=Array.from({length:55},(_,i)=>({...main(), proofId:'proof-'+String(i).padStart(2,'0')}));
  const p=project({feed:feed(rows),limit:3});
  assert.equal(p.shown,3);assert.equal(p.total,55);assert.equal(p.truncated,true);
  assert.deepEqual(p.entries.map(x=>x.proofId),['proof-00','proof-01','proof-02']);
  assert.ok(PROOF_INDEX_STAGES.includes('OS_PICKUP'));
});

test('failed parse, disallowed kinds and missing IDs do not leak raw proof records',()=>{
  const p=project({feed:feed([{...main(),kind:'stephanos.shared_workspace.status'},{...main(),proofId:''},
    {...main(), timestampUtc:'invalid'}])});
  assert.equal(p.total,0);
});

test('claim with only safe repository PR metadata links there without fake artifact ID',()=>{
  const p=project({feed:feed([{...main(),reviewRunId:null,reviewArtifactId:null}])});
  assert.equal(p.entries[0].sourceLink,'https://github.com/Cheekyfellastef/stephan-os/pull/3203/commits/'+SHA);
});

test('receipt record and proof record share one safe index but remain typed',()=>{
  const r={...main(),kind:'stephanos.shared_workspace.record.receipt',receiptId:'receipt-1',proofId:undefined};
  const p=project({feed:{...feed(),records:{...feed().records,receiptRecords:[r]}}});
  assert.equal(p.total,2);
  assert.ok(p.entries.some(x=>x.kind==='RECEIPT_RECORD'));
});
