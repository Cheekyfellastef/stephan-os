import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createMissionRecord, readMissionRecord, runWithMissionStatePrecondition, appendMissionEvent } from './missionOrchestratorStore.js';
import { createSourceMutationLeaseRecord } from '../../shared/agents/programmeAuthorityV1.mjs';
import { ensureSharedWorkspaceLayout } from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import { readSourceMutationLease, releaseSourceMutationLease, SOURCE_MUTATION_LEASE_FILE } from './programmeAuthorityService.js';
import { assertOriginalSourceAttemptNotFenced, withOriginalSourceAttemptMutationGuard, retireSupervisedOriginalSourceRecovery, verifyOriginalSourceAttemptFence } from './originalSourceAttemptFenceService.js';
import { reconcileExpiredElasticReviewLeaseV1 } from './elasticPrHeadLeaseService.js';
import { createMissionWorkerHeartbeatRecord } from '../../scripts/mission-orchestrator-worker-heartbeat.mjs';
import { publishForgePrePrToGitHub } from './forgePrePrGitHubPublisherService.js';
import { publishMissionWorkerAction } from './missionOrchestratorWorkerService.js';
import { describeSupervisedR7Maintenance, beginSupervisedR7Maintenance, preserveSupervisedR7Maintenance,
  persistRuntimeSupervisedR7Packet, prepareRuntimeSupervisedR7, readSupervisedR7OperatorApproval,
  supervisedRecoveryDigest as digest, supervisedR7FenceBindsLease } from './supervisedR7RecoveryRuntime.js';

const MISSION = 'critical-2962-elastic-goal', BRANCH = 'openclaw/elastic-goal-2962';
const REPO = 'Cheekyfellastef/stephan-os';
const commandId = 'supervised-r7-runtime-test';
const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();

// Real Git repositories, canonical mission store, lease store, queue files,
// preservation bytes, journal and CAS. Only GitHub HTTP and the cooperative
// worker heartbeat are fixtures: these tests make NO live Windows claim.
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'supervised-r7-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const paths = { repoRoot: join(home, 'Documents', 'GitHub', 'stephan-os'),
    workspaceRoot: join(home, 'Documents', 'Stephanos-openclaw-workspace'),
    orchestratorRoot: join(home, 'missions') };
  await mkdir(paths.repoRoot, { recursive: true });
  git(paths.repoRoot, ['init','-b','main']);
  git(paths.repoRoot, ['config','user.name','Fixture']); git(paths.repoRoot,['config','user.email','fixture@example.invalid']);
  await writeFile(join(paths.repoRoot,'source.js'),'export const value = 1;\n');
  git(paths.repoRoot,['add','source.js']); git(paths.repoRoot,['commit','-m','fixture base']);
  const head = git(paths.repoRoot,['rev-parse','HEAD']);
  const worktree = join(home,'original'); git(paths.repoRoot,['worktree','add','-b',BRANCH,worktree]);
  await writeFile(join(worktree,'source.js'),'export const value = 2;\n');
  await writeFile(join(worktree,'untracked.txt'),'original dirty bytes');
  const env = { USERPROFILE: home, STEPHANOS_MISSION_ORCHESTRATOR_DIR: paths.orchestratorRoot,
    STEPHANOS_MISSION_WORKER_QUEUE_DIR: join(home,'queue') };
  await mkdir(env.STEPHANOS_MISSION_WORKER_QUEUE_DIR, { recursive:true });
  await ensureSharedWorkspaceLayout({root:paths.workspaceRoot,repoRoot:paths.repoRoot});
  const created = await createMissionRecord({ missionId:MISSION, repository:REPO,
    repositoryRoot:paths.repoRoot, branch:BRANCH, worktreePath:worktree,
    operatorIntent:'fixture', intendedOutcome:'fixture', missionKind:'implementation',
    allowedFiles:['source.js'], requiredTests:['node --test'] }, {root:paths.orchestratorRoot,env});
  const mission = {...created.state, revision:7, currentPhase:'REPAIR_REQUIRED', cancelled:false,
    pullRequest:{...created.state.pullRequest,number:2987,headSha:head},
    dispatch:{...created.state.dispatch,status:'complete',adapter:'foundry-forge'}};
  const statePath = join(paths.orchestratorRoot,MISSION+'.state.json');
  await writeFile(statePath,JSON.stringify(mission));
  const baseTime = Math.floor(Date.now()/1000)*1000 - 2000;
  let time = baseTime;
  const lease = createSourceMutationLeaseRecord({leaseId:MISSION+'-r7-lease',laneId:MISSION,
    repository:REPO,issueNumber:2962,prNumber:2987,branch:BRANCH,headSha:head,ownerId:'mission-worker',
    nowUtc:new Date(baseTime-7200000).toISOString(),expiresAtUtc:new Date(baseTime-3600000).toISOString(),proofRefs:[]});
  const leasePath = join(paths.workspaceRoot,'status',SOURCE_MUTATION_LEASE_FILE);
  await writeFile(leasePath,JSON.stringify(lease));
  const input = {requestId:commandId+'-request',commandId,sourceRevision:head,originalLeaseDigest:digest(lease)};
  const decisions = new Map();
  const fetchImpl = async url => {
    assert.match(url,/^https:\/\/api.github.com\/repos\/Cheekyfellastef\/stephan-os\/issues\/comments\/\d+$/);
    const c = decisions.get(Number(url.split('/').at(-1)));
    return {ok:!!c,text:async()=>JSON.stringify(c)};
  };
  const options = {paths,env,now:()=>time,fetchImpl};
  function decision(id, expected, expires = time+300000) {
    const at = new Date(time).toISOString();
    const record = {id,user:{id:267490109,login:'Cheekyfellastef',type:'User'},author_association:'OWNER',
      issue_url:`https://api.github.com/repos/${REPO}/issues/2961`,created_at:at,updated_at:at,
      body:'```stephanos-supervised-r7-approval\n'+JSON.stringify({
        schemaVersion:'stephanos.supervised-r7-operator-approval.v1',...expected,
        lowerAssuranceExplicitlyAccepted:true,expiresAtUtc:new Date(expires).toISOString()})+'\n```'};
    decisions.set(id,record); return record;
  }
  async function heartbeat(overrides={}) {
    const record = {...createMissionWorkerHeartbeatRecord({timestampUtc:new Date(time).toISOString(),
      repositoryRoot:paths.repoRoot,branch:'main',headSha:head,launchIdentityId:'e'.repeat(64),
      workerStartedAtUtc:new Date(time-60000).toISOString(),lastTickVerdict:'MISSION_WORKER_TICK_PASS'}),...overrides};
    await writeFile(join(paths.workspaceRoot,'status','mission-orchestrator-worker-heartbeat.json'),JSON.stringify(record));
  }
  async function maintenance() {
    const packet = await describeSupervisedR7Maintenance(input,options);
    decision(11,{purpose:packet.purpose,packetDigest:digest(packet),...input});
    await beginSupervisedR7Maintenance(input,11,options);
    await heartbeat();
  }
  async function prepared() {
    await maintenance(); await preserveSupervisedR7Maintenance(options);
    const result = await persistRuntimeSupervisedR7Packet(input,options);
    time+=1000;
    decision(12,{purpose:result.packet.purpose,packetDigest:result.packetDigest,...input});
    await heartbeat(); return result;
  }
  return {paths,env,input,options,lease,leasePath,statePath,worktree,decisions,decision,maintenance,
    prepared,heartbeat,tick:ms=>{time+=ms;},get time(){return time;}};
}

test('real maintenance, preservation, approval, cancellation journal and exact CAS release', async t=>{
  const f=await fixture(t);await f.prepared();
  const result=await retireSupervisedOriginalSourceRecovery(f.input,12,f.options);
  assert.equal(result.state.currentPhase,'CANCELLED');assert.equal(result.state.revision,8);
  const fence=result.state.storeMetadata.originalSourceAttemptFence;
  assert.equal(supervisedR7FenceBindsLease(fence,f.lease),true);
  assert.equal(fence.historicalExecutionOutcome,'UNKNOWN');assert.equal(fence.witnessCommissioned,false);
  const originalFetch=globalThis.fetch;globalThis.fetch=f.options.fetchImpl;t.after(()=>{globalThis.fetch=originalFetch;});
  assert.equal(await verifyOriginalSourceAttemptFence(result.state,f.lease,f.paths,f.env),true);
  const released=await reconcileExpiredElasticReviewLeaseV1({paths:f.paths,env:f.env,
    now:new Date(f.time),sourceRevision:f.input.sourceRevision,missionRecords:[result.state]});
  assert.equal(released.released,true,JSON.stringify(released));
  assert.equal((await readSourceMutationLease({root:f.paths.workspaceRoot,repoRoot:f.paths.repoRoot,nowUtc:new Date(f.time).toISOString()})).present,false);
  assert.equal(await readFile(join(f.worktree,'untracked.txt'),'utf8'),'original dirty bytes');
});

for(const [name,mutate] of [
  ['wrong mission',m=>{m.missionId='critical-9999-elastic-goal';}],
  ['wrong branch',m=>{m.git.branch='wrong';}],
  ['wrong revision',m=>{m.revision=8;}],
  ['active dispatch',m=>{m.dispatch.status='running';}],
]) test(`real target rejects ${name}`,async t=>{const f=await fixture(t);const m=JSON.parse(await readFile(f.statePath));mutate(m);await writeFile(f.statePath,JSON.stringify(m));await assert.rejects(describeSupervisedR7Maintenance(f.input,f.options));});

for(const [name,mutate] of [
  ['wrong author',c=>{c.user.id=123;}], ['edited approval',c=>{c.updated_at='2026-01-01T00:00:00Z';}],
  ['connector self approval',c=>{c.performed_via_github_app={id:1144995};}],
  ['wrong issue',c=>{c.issue_url=c.issue_url.replace('2961','2962');}],
  ['wrong digest',c=>{c.body=c.body.replace(/"packetDigest":"[a-f0-9]+"/,'"packetDigest":"'+'0'.repeat(64)+'"');}],
  ['approval boolean',c=>{c.body=c.body.replace('"lowerAssuranceExplicitlyAccepted":true','"lowerAssuranceExplicitlyAccepted":false');}],
  ['duplicate block',c=>{c.body+='\n'+c.body;}],
]) test(`actual approval reader rejects ${name}`,async t=>{
  const f=await fixture(t),p=await describeSupervisedR7Maintenance(f.input,f.options);
  const expected={purpose:p.purpose,packetDigest:digest(p),...f.input};mutate(f.decision(11,expected));
  await assert.rejects(readSupervisedR7OperatorApproval(11,expected,f.options));
  assert.equal((await readMissionRecord(MISSION,{root:f.paths.orchestratorRoot})).state.storeMetadata.supervisedRecoveryMaintenance,undefined);
});

test('missing and expired approvals cannot install maintenance',async t=>{
  const f=await fixture(t);await assert.rejects(beginSupervisedR7Maintenance(f.input,11,f.options),/APPROVAL_READ_FAILED/);
  const p=await describeSupervisedR7Maintenance(f.input,f.options);
  f.decision(11,{purpose:p.purpose,packetDigest:digest(p),...f.input},f.time-1);
  await assert.rejects(beginSupervisedR7Maintenance(f.input,11,f.options),/APPROVAL_EXPIRED/);
});

test('real maintenance blocks claim, stale publication and source checks without releasing lease',async t=>{
  const f=await fixture(t);await f.maintenance();
  await assert.rejects(assertOriginalSourceAttemptNotFenced(MISSION,{env:f.env}),/ATTEMPT_FENCED/);
  await assert.rejects(appendMissionEvent(MISSION,{eventId:'stale-dispatch-01',eventType:'AGENT_DISPATCHED'}, {root:f.paths.orchestratorRoot,env:f.env}),/ATTEMPT_FENCED/);
  let calls=0;const pub=await publishForgePrePrToGitHub({escrow:{missionId:MISSION},env:f.env,
    githubApi:{getMain:async()=>{calls++;}}});
  assert.equal(pub.reason,'ORIGINAL_SOURCE_ATTEMPT_FENCED');assert.equal(calls,0);
  assert.equal((await readSourceMutationLease({root:f.paths.workspaceRoot,repoRoot:f.paths.repoRoot,nowUtc:new Date(f.time).toISOString()})).present,true);
});

test('original queued and active cooperative work prevents preservation',async t=>{
  const f=await fixture(t);await f.maintenance();
  const pending=join(f.env.STEPHANOS_MISSION_WORKER_QUEUE_DIR,'foundry-forge','pending');await mkdir(pending,{recursive:true});
  const item=join(pending,'stale.json');await writeFile(item,JSON.stringify({missionId:MISSION}));
  await assert.rejects(preserveSupervisedR7Maintenance(f.options),/QUEUE_NOT_QUIESCENT/);
  await rm(item);await f.heartbeat({activeTaskId:MISSION+'-r1-a',activeReceiptId:'active-r7-fixture'});
  await assert.rejects(preserveSupervisedR7Maintenance(f.options),/COOPERATIVE_WORKER_NOT_IDLE/);
});

test('failed preservation and unexplained dirty mutation hold exact lease',async t=>{
  const f=await fixture(t);await f.prepared();
  await appendFile(join(f.worktree,'untracked.txt'),'changed');
  await assert.rejects(retireSupervisedOriginalSourceRecovery(f.input,12,f.options),/UNEXPLAINED_SOURCE_MUTATION/);
  assert.equal((await readMissionRecord(MISSION,{root:f.paths.orchestratorRoot})).state.revision,7);
});

test('renewal between packet and cancellation is rejected by whole-record identity',async t=>{
  const f=await fixture(t);await f.prepared();
  await writeFile(f.leasePath,JSON.stringify({...f.lease,proofRefs:['proofs/changed']}));
  await assert.rejects(retireSupervisedOriginalSourceRecovery(f.input,12,f.options),/TARGET_MISMATCH/);
});

test('a lease mutation during approval IO is rejected before consuming approval',async t=>{
  const f=await fixture(t);await f.prepared();
  const fetchImpl=async url=>{
    await writeFile(f.leasePath,JSON.stringify({...f.lease,proofRefs:['proofs/concurrent-renewal']}));
    return f.options.fetchImpl(url);
  };
  await assert.rejects(retireSupervisedOriginalSourceRecovery(f.input,12,{...f.options,fetchImpl}),/TARGET_MISMATCH/);
  const {state}=await readMissionRecord(MISSION,{root:f.paths.orchestratorRoot});
  assert.equal(state.cancelled,false);assert.equal(state.storeMetadata.originalSourceAttemptFence,undefined);
});

test('interrupted audit persists consumed decision and is recovered under existing lock',async t=>{
  const f=await fixture(t);await f.prepared();
  await assert.rejects(retireSupervisedOriginalSourceRecovery(f.input,12,{...f.options,
    appendMissionAuditFile:async()=>{throw new Error('TEST_INTERRUPTED_AUDIT');}}),/TEST_INTERRUPTED_AUDIT/);
  const stored=JSON.parse(await readFile(f.statePath));
  assert.equal(stored.cancelled,true);assert.equal(stored.storeMetadata.originalSourceAttemptFence.approvalConsumed,true);
  assert.ok(stored.storeMetadata.pendingQuarantineAuditEvent);
  const originalFetch=globalThis.fetch;globalThis.fetch=f.options.fetchImpl;t.after(()=>{globalThis.fetch=originalFetch;});
  assert.equal(await verifyOriginalSourceAttemptFence(stored,f.lease,f.paths,f.env),false);
  const repaired=await runWithMissionStatePrecondition(MISSION,{},async s=>s,{root:f.paths.orchestratorRoot,env:f.env});
  assert.equal(repaired.state.storeMetadata.pendingQuarantineAuditEvent,undefined);
  assert.equal(await verifyOriginalSourceAttemptFence(repaired.state,f.lease,f.paths,f.env),true);
  const log=await readFile(join(f.paths.orchestratorRoot,MISSION+'.events.ndjson'),'utf8');
  assert.equal(log.split('\n').filter(l=>l.includes('cancel-'+commandId)).length,1);
});

test('approval replay with a new command cannot reuse a saved packet',async t=>{
  const f=await fixture(t);await f.prepared();
  await assert.rejects(retireSupervisedOriginalSourceRecovery({...f.input,requestId:'different-request'},12,f.options),/PACKET_BINDING_CHANGED/);
});

test('CAS rejects changed record even with an already durable release marker',async t=>{
  const f=await fixture(t);const at=new Date(f.time).toISOString();
  const interrupted=await releaseSourceMutationLease({...f.lease,nowUtc:at,originalLeaseDigest:digest(f.lease)},
    {root:f.paths.workspaceRoot,repoRoot:f.paths.repoRoot,testOnly:true,
      dependencies:{unlink:async()=>{throw Object.assign(new Error('held'),{code:'EBUSY'});}}});
  assert.equal(interrupted.released,false);
  await writeFile(f.leasePath,JSON.stringify({...f.lease,proofRefs:['proofs/renewed']}));
  const retry=await releaseSourceMutationLease({...f.lease,nowUtc:at,originalLeaseDigest:digest(f.lease)},
    {root:f.paths.workspaceRoot,repoRoot:f.paths.repoRoot});
  assert.equal(retry.released,false);assert.equal(retry.reason,'SOURCE_MUTATION_LEASE_RELEASE_RECORD_CHANGED');
});

test('expired retirement approval cannot consume a decision or cancel the mission',async t=>{
  const f=await fixture(t);await f.prepared();f.tick(301000);await f.heartbeat();
  await assert.rejects(retireSupervisedOriginalSourceRecovery(f.input,12,f.options),/APPROVAL_EXPIRED/);
  const {state}=await readMissionRecord(MISSION,{root:f.paths.orchestratorRoot});
  assert.equal(state.revision,7);assert.equal(state.storeMetadata.originalSourceAttemptFence,undefined);
});

test('maintenance retry is idempotent; replacing an expired attempt requires a fresh exact approval',async t=>{
  const f=await fixture(t);await f.maintenance();
  const before=await readFile(f.statePath,'utf8');f.tick(1000);
  await beginSupervisedR7Maintenance(f.input,11,f.options);
  assert.equal(await readFile(f.statePath,'utf8'),before);
  const next={...f.input,requestId:f.input.requestId+'-next',commandId:f.input.commandId+'-next'};
  await assert.rejects(beginSupervisedR7Maintenance(next,11,f.options),/APPROVAL_BINDING/);
  const packet=await describeSupervisedR7Maintenance(next,f.options);
  f.decision(13,{purpose:packet.purpose,packetDigest:digest(packet),...next});
  await beginSupervisedR7Maintenance(next,13,f.options);
  const {state}=await readMissionRecord(MISSION,{root:f.paths.orchestratorRoot});
  assert.equal(state.storeMetadata.supervisedRecoveryMaintenanceHistory.length,1);
  assert.equal(state.storeMetadata.supervisedRecoveryMaintenance.commandId,next.commandId);
});

test('a stale source callback cannot cross the installed maintenance boundary',async t=>{
  const f=await fixture(t);let entered,finish;
  const started=new Promise(r=>{entered=r;}), unblock=new Promise(r=>{finish=r;});
  const write=withOriginalSourceAttemptMutationGuard(MISSION,async()=>{entered();await unblock;
    await appendFile(join(f.worktree,'untracked.txt'),' completed before maintenance');},
    {env:f.env,missionStoreOptions:{root:f.paths.orchestratorRoot}});
  await started;
  const reserving=f.maintenance();finish();await write;await reserving;
  let ran=false;
  await assert.rejects(withOriginalSourceAttemptMutationGuard(MISSION,async()=>{ran=true;},
    {env:f.env,missionStoreOptions:{root:f.paths.orchestratorRoot}}),/ATTEMPT_FENCED/);
  assert.equal(ran,false);
});

test('a pre-maintenance publisher snapshot cannot advance the reserved repair revision',async t=>{
  const f=await fixture(t);
  const before=(await readMissionRecord(MISSION,{root:f.paths.orchestratorRoot})).state;
  await f.maintenance();
  const published=await publishMissionWorkerAction(before,{root:f.paths.orchestratorRoot,env:f.env});
  assert.equal(published.published,false);assert.equal(published.repairStarted,false);
  assert.equal(published.reason,'repair-transition-precondition-failed');
  for (const eventType of ['REPAIR_STARTED','AGENT_RESULT_COLLECTED','REVIEW_COMPLETED']) {
    await assert.rejects(appendMissionEvent(MISSION,{eventId:'late-'+eventType,eventType,
      expectedRevision:7,expectedCurrentPhase:'REPAIR_REQUIRED'},
    {root:f.paths.orchestratorRoot,env:f.env}),/ATTEMPT_FENCED/);
  }
  const {state}=await readMissionRecord(MISSION,{root:f.paths.orchestratorRoot});
  assert.equal(state.revision,7);assert.equal(state.currentPhase,'REPAIR_REQUIRED');
  await preserveSupervisedR7Maintenance(f.options);
  assert.ok((await persistRuntimeSupervisedR7Packet(f.input,f.options)).packetDigest);
});

for(const [name,mutate] of [
  ['source mutation',async f=>appendFile(join(f.worktree,'untracked.txt'),'during approval read')],
  ['stale queue',async f=>{
    const dir=join(f.env.STEPHANOS_MISSION_WORKER_QUEUE_DIR,'forge-publication','pending');
    await mkdir(dir,{recursive:true});await writeFile(join(dir,'late.json'),JSON.stringify({missionId:MISSION}));
  }],
  ['worker activity',async f=>f.heartbeat({activeTaskId:MISSION+'-late',activeReceiptId:'late-active-receipt'})],
]) test(`${name} during release authentication blocks CAS`,async t=>{
  const f=await fixture(t);await f.prepared();
  const cancelled=await retireSupervisedOriginalSourceRecovery(f.input,12,f.options);
  const originalFetch=globalThis.fetch;let called=false;
  globalThis.fetch=async url=>{called=true;await mutate(f);return f.options.fetchImpl(url);};
  t.after(()=>{globalThis.fetch=originalFetch;});
  const released=await reconcileExpiredElasticReviewLeaseV1({paths:f.paths,env:f.env,
    sourceRevision:f.input.sourceRevision,missionRecords:[cancelled.state]});
  assert.equal(called,true);assert.equal(released.released,false);
  assert.equal((await readSourceMutationLease({root:f.paths.workspaceRoot,repoRoot:f.paths.repoRoot,
    nowUtc:new Date(f.time).toISOString()})).present,true);
});

for(const [name,mutate] of [
  ['new untracked file',async f=>writeFile(join(f.worktree,'late.txt'),'unpreserved')],
  ['staged bytes',async f=>{git(f.worktree,['add','source.js']);}],
  ['missing backup',async f=>rm(join(f.paths.workspaceRoot,'source-artifacts','supervised-r7',commandId,'dirty','untracked.txt'))],
  ['damaged history bundle',async f=>appendFile(join(f.paths.workspaceRoot,'source-artifacts','supervised-r7',commandId,'original-history.bundle'),'damage')],
]) test(`post-cancellation ${name} blocks release`,async t=>{
  const f=await fixture(t);await f.prepared();
  const cancelled=await retireSupervisedOriginalSourceRecovery(f.input,12,f.options);
  await mutate(f);
  const originalFetch=globalThis.fetch;globalThis.fetch=f.options.fetchImpl;t.after(()=>{globalThis.fetch=originalFetch;});
  const released=await reconcileExpiredElasticReviewLeaseV1({paths:f.paths,env:f.env,
    sourceRevision:f.input.sourceRevision,missionRecords:[cancelled.state]});
  assert.equal(released.released,false);
  assert.equal((await readSourceMutationLease({root:f.paths.workspaceRoot,repoRoot:f.paths.repoRoot,nowUtc:new Date(f.time).toISOString()})).present,true);
});

test('restart finishes an interrupted release using the consumed decision after expiry',async t=>{
  const f=await fixture(t);await f.prepared();
  const cancelled=await retireSupervisedOriginalSourceRecovery(f.input,12,f.options);
  const interrupted=await releaseSourceMutationLease({...f.lease,nowUtc:new Date(f.time).toISOString(),originalLeaseDigest:digest(f.lease)},
    {root:f.paths.workspaceRoot,repoRoot:f.paths.repoRoot,testOnly:true,
      dependencies:{unlink:async()=>{throw Object.assign(new Error('held'),{code:'EBUSY'});}}});
  assert.equal(interrupted.released,false);
  f.tick(601000);await f.heartbeat();
  const originalFetch=globalThis.fetch,originalNow=Date.now;
  globalThis.fetch=f.options.fetchImpl;Date.now=()=>f.time;
  t.after(()=>{globalThis.fetch=originalFetch;Date.now=originalNow;});
  const resumed=await reconcileExpiredElasticReviewLeaseV1({paths:f.paths,env:f.env,now:new Date(f.time),
    sourceRevision:f.input.sourceRevision,missionRecords:[cancelled.state]});
  assert.equal(resumed.released,true,JSON.stringify(resumed));
  const audit=await readFile(join(f.paths.orchestratorRoot,MISSION+'.events.ndjson'),'utf8');
  const replay=await retireSupervisedOriginalSourceRecovery(f.input,12,f.options);
  assert.equal(replay.duplicate,true);
  assert.equal(await readFile(join(f.paths.orchestratorRoot,MISSION+'.events.ndjson'),'utf8'),audit);
});

test('advancing clock preserves a valid bounded evidence window for retirement preparation', async t => {
  const f = await fixture(t);
  await f.maintenance();
  const options = { ...f.options, now: () => { f.tick(1); return f.time; } };
  await preserveSupervisedR7Maintenance(options);
  const prepared = await persistRuntimeSupervisedR7Packet(f.input, options);
  const evidence = prepared.packet.maintenanceEvidence;
  assert.equal(Date.parse(evidence.expiresAtUtc) - Date.parse(evidence.observedAtUtc), 600000);
  assert.ok(Date.parse(prepared.packet.preparedAtUtc) < Date.parse(prepared.packet.expiresAtUtc));
});
