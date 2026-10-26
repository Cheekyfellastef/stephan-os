import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, linkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { CANONICAL_MAILBOX_ISSUE as current, CANONICAL_MAILBOX_RECEIPT_PREDECESSOR as previous } from '../shared/agents/canonicalMailboxAuthorityV1.mjs';
import { MAILBOX_ROTATION_OPERATION as operation, MAILBOX_ROTATION_SCHEMA, auditMailboxRotationComments,
  settleMailboxRotationDrain, projectMailboxRotation, mailboxRotationCommandAllowed } from '../shared/agents/canonicalMailboxRotationV1.mjs';
import { buildMailboxRotationFence, findMailboxRotationFence, readMailboxRotationFence,
  mailboxRotationWorkflowAllowed, inventoryMailboxRotationActions } from '../shared/agents/canonicalMailboxRotationFenceV1.mjs';
import { canonicalMailboxSuccessorBody } from '../shared/agents/canonicalMailboxRolloverConsumerV1.mjs';
import { executeMailboxRotationOnHost, readMailboxAuthorityLiteral } from './canonical-mailbox-rotation-host-v1.mjs';
import { createMailboxExecutionLedger } from './canonical-mailbox-execution-ledger-v1.mjs';
import { evaluateMailboxRotationSyncPreflight } from './canonical-mailbox-rotation-sync-preflight-v1.mjs';
import { assertMailboxRotationWorkflowAdmission, readMailboxWorkflowGitHub } from './canonical-mailbox-workflow-admission-v1.mjs';
import { serializeBoundedReceiptJson, prepareMailboxRotationPoll } from './battle-bridge-github-command-mailbox.mjs';
import { buildBattleBridgeGitHubCommandReceipt } from '../shared/agents/battleBridgeGitHubCommandMailbox.mjs';
import { createTrustedMailboxReceiptIndexFromGitHubComments } from '../shared/agents/mailboxReceiptIndexGitHubMirror.mjs';
import { classifyPostSyncRefresh } from '../shared/agents/postSyncRuntimeRefreshCoordinator.mjs';
import { LEGACY_PUBLICATION_CONTRACTS, withMailboxActionEvidence, mailboxActionEvidenceSummary } from '../shared/agents/canonicalMailboxRotationActionEvidenceV1.mjs';

const head='a'.repeat(40), target='b'.repeat(40), merged='c'.repeat(40), now='2026-10-25T23:40:00.000Z';
const repository='Cheekyfellastef/stephan-os';
const record = () => ({schemaVersion:MAILBOX_ROTATION_SCHEMA,transitionId:'rotation-protocol-transition-001',phase:'DRAINING',
  predecessorIssue:current,successorIssue:current+1000,barrierCommentId:100,freezeCommentId:100,cutoverPrNumber:4000,
  cutoverHead:target,preparationHead:head,freezeRequestId:'rotation-freeze-request-001',requestedAt:now,drained:false});
const command = (patch={}) => ({schemaVersion:'stephanos.battle-bridge-github-command.v1',requestId:'rotation-freeze-request-001',
  operation,repository,issueNumber:current,branch:'main',operatorApproval:'operator-approved',expectedHead:head,
  expiresAt:'2026-10-25T23:50:00.000Z',rotationAction:'FREEZE',transitionId:record().transitionId,
  successorIssue:current+1000,cutoverPrNumber:4000,cutoverHead:target,...patch});
const control = (action,patch={}) => { const {successorIssue,cutoverPrNumber,cutoverHead,...c}=command(); return {...c,rotationAction:action,requestId:`rotation-${action.toLowerCase()}-request-001`,...patch}; };
const ordinary = (patch={}) => ({schemaVersion:'stephanos.battle-bridge-github-command.v1',requestId:'ordinary-request-001',
  operation:'READ_DEPLOYMENT_STATUS',repository,issueNumber:current,branch:'main',operatorApproval:'operator-approved',expectedHead:head,expiresAt:'2026-10-25T23:50:00.000Z',...patch});
const comment = (value,id=100,receipt=false,issue=current) => ({id,user:{login:'Cheekyfellastef'},created_at:now,
  html_url:`https://github.com/${repository}/issues/${issue}#issuecomment-${id}`,
  body:`${receipt?'<!-- stephanos-battle-bridge-command-receipt -->\n```json':'```stephanos-battle-bridge-command'}\n${JSON.stringify(value)}\n\`\`\``});
const terminal = (cmd,patch={}) => ({...buildBattleBridgeGitHubCommandReceipt({command:cmd,state:'DONE',acceptedAt:now,completedAt:now,processSourceHead:cmd.expectedHead,...patch}),issueNumber:cmd.issueNumber});
const authority = (active=current+1000,retired=[previous,current]) => `export const CANONICAL_MAILBOX_ISSUE = ${active};\nexport const RETIRED_CANONICAL_MAILBOX_ISSUES = Object.freeze([${retired.join(', ')}]);\n`;
const pull = (patch={}) => ({number:4000,state:'open',head:{sha:target,repo:{full_name:repository}},base:{ref:'main'},...patch});
const actions = () => ({complete:true,observedAt:now,pendingRuns:[]});
const sandbox = t => { const root=mkdtempSync(join(tmpdir(),'stephanos-mailbox-rotation-')); t.after(()=>rmSync(root,{recursive:true,force:true})); return root; };

function containedActions(mainHead=head){
  const c=LEGACY_PUBLICATION_CONTRACTS[0],run={id:99,path:c.path,head_sha:c.head,status:'queued',run_attempt:1,workflow_id:315398307,
    event:'issue_comment',head_branch:'main',repository:{full_name:repository},head_repository:{full_name:repository}};
  const proof={run,runAfter:structuredClone(run),attempt:1,workflow:{path:c.path,ref:c.head,sha:c.blob},jobs:{total_count:0,jobs:[]},observedAt:now};
  const source={mainHead,activationHead:target,modules:LEGACY_PUBLICATION_CONTRACTS.slice(0,2).map(c=>({path:c.module,legacyBuilder:c.legacyBuilder,
    apiVersion:2,legacyAbsent:true,replacementPresent:true,localBlob:'d'.repeat(40),mainBlob:'d'.repeat(40),activationBlob:'d'.repeat(40)}))};
  return withMailboxActionEvidence({complete:true,observedAt:now,pendingRuns:[{id:99,workflow:c.path.split('/').at(-1),status:'queued'}]},{proofs:[proof],source});
}

function fixture() {
  const state={acceptedRequestIds:[],pendingReceiptPublications:[]}, events=[];
  return {state,events,selectedCommentId:100,sourceHead:head,now:()=>now,
    readIssue:async number=>({number,state:'open',user:{login:'Cheekyfellastef'},pull_request:undefined,
      repository_url:`https://api.github.com/repos/${repository}`,html_url:`https://github.com/${repository}/issues/${number}`,locked:false,
      title:`INACTIVE canonical mailbox successor to #${current} — Goal #2315`,body:canonicalMailboxSuccessorBody(),comments:0}),
    readPull:async()=>pull(),readAuthoritySource:async()=>authority(),readComments:async()=>[],
    persist:s=>events.push({type:'persist',record:structuredClone(s.mailboxRotation)}),
    publishFence:async r=>events.push({type:'fence',record:structuredClone(r)}),readActions:async()=>actions()};
}

test('FROZEN only permits the nominated exact existing protected native bootstrap',()=>{
  const frozen={...record(),phase:'FROZEN',drained:true};
  const merge={operation:'EXECUTE_PROTECTED_OPENCLAW_PR_MERGE',prNumber:4000,expectedHead:target,expectedBase:head};
  assert.equal(mailboxRotationCommandAllowed(merge,200,frozen),true);
  for(const patch of [{phase:'DRAINING'},{drained:false},{drained:undefined},
    {predecessorIssue:current-1},{cutoverPrNumber:4001},{cutoverHead:merged},{preparationHead:merged}])
    assert.equal(mailboxRotationCommandAllowed(merge,200,{...frozen,...patch}),false,JSON.stringify(patch));
  for(const patch of [{prNumber:4001},{expectedHead:head},{expectedBase:merged},{prNumber:undefined},
    {expectedHead:undefined},{expectedBase:undefined},{operation:'EXECUTE_UNREVIEWED_MERGE'}])
    assert.equal(mailboxRotationCommandAllowed({...merge,...patch},200,frozen),false,JSON.stringify(patch));
});

test('FREEZE persists the local hold before publishing its verified global fence and never self-certifies drain',async()=>{
  const f=fixture(),r=await executeMailboxRotationOnHost(command(),f);
  assert.equal(r.ok,true);assert.equal(f.state.mailboxRotation.phase,'DRAINING');
  assert.equal(f.events[0].type,'persist');assert.equal(f.events[1].type,'fence');
  assert.equal(f.events[0].record.globalFencePublished,undefined);
  assert.equal(f.state.mailboxRotation.globalFencePublished,true);
  assert.equal(settleMailboxRotationDrain(f.state,{outboxPendingCount:0,now}).mailboxRotation.phase,'FROZEN');
});
test('failed fence publication retains a durable hold, not a successful freeze',async()=>{
  const f=fixture();f.publishFence=async()=>{throw Error('network ambiguous')};
  await assert.rejects(executeMailboxRotationOnHost(command(),f),/network ambiguous/);
  assert.equal(f.events[0].record.phase,'DRAINING');
  assert.equal(settleMailboxRotationDrain(f.state,{outboxPendingCount:0,now}).mailboxRotation.phase,'DRAINING');
});
test('wrong activation head, active successor or foreign source cannot freeze',async()=>{
  for (const patch of [{sourceHead:target},{readPull:async()=>pull({head:{sha:head,repo:{full_name:repository}}})},
    {readAuthoritySource:async()=>authority(current)}, {readIssue:async n=>({number:n,state:'open',user:{login:'attacker'},body:canonicalMailboxSuccessorBody()})}]) {
    const f={...fixture(),...patch};assert.equal((await executeMailboxRotationOnHost(command(),f)).ok,false);assert.equal(f.events.length,0);
  }
});
test('DRAIN explicitly extends the barrier; STATUS retains late work and CANCEL cannot silently change authority',async()=>{
  const f=fixture();await executeMailboxRotationOnHost(command(),f);
  f.selectedCommentId=200;f.readComments=async()=>[comment(ordinary(),150)];
  await executeMailboxRotationOnHost(control('STATUS'),f);
  assert.deepEqual(f.state.mailboxRotationInventory.pendingAfterBarrier,['ordinary-request-001']);
  await executeMailboxRotationOnHost(control('DRAIN'),f);
  assert.equal(f.state.mailboxRotation.barrierCommentId,200);
  assert.deepEqual(f.state.mailboxRotationInventory.pendingBeforeBarrier,['ordinary-request-001']);
  await executeMailboxRotationOnHost(control('CANCEL'),f);
  assert.equal(f.state.mailboxRotation.phase,'CANCELLED');assert.equal(current,3149);
});
test('active/waiting Actions demote an earlier FROZEN record and prevent drain certification',async()=>{
  const f=fixture();await executeMailboxRotationOnHost(command(),f);
  f.state.mailboxRotation={...f.state.mailboxRotation,phase:'FROZEN',drained:true};
  f.readActions=async()=>({...actions(),pendingRuns:[{id:99,status:'waiting'}]});f.selectedCommentId=201;
  await executeMailboxRotationOnHost(control('STATUS'),f);
  assert.equal(f.state.mailboxRotation.phase,'DRAINING');assert.equal(f.state.mailboxRotation.drained,false);
});
test('durable reservation survives process loss and denies identical IDs across epochs without rerunning effects',t=>{
  const root=sandbox(t),cmd=ordinary();const first=createMailboxExecutionLedger(root);first.reserve(cmd);
  const reopened=createMailboxExecutionLedger(root);assert.equal(reopened.read(cmd.requestId).phase,'RESERVED');
  assert.throws(()=>reopened.reserve({...cmd,issueNumber:current+1000}),/ALREADY_SEEN/);
  reopened.complete(terminal(cmd));assert.equal(first.read(cmd.requestId).phase,'TERMINAL');
  assert.throws(()=>first.complete(terminal({...cmd,issueNumber:current+1000})),/EPOCH_CONFLICT/);
  first.importHistorical('retired-unfinished-001',previous,'RETIRED');
  assert.throws(()=>first.reserve({...cmd,requestId:'retired-unfinished-001'}),/ALREADY_SEEN/);
});
test('request identity is case sensitive on Windows and malformed/linked tombstones fail closed',t=>{
  const root=sandbox(t),ledger=createMailboxExecutionLedger(root),cmd=ordinary();
  ledger.reserve(cmd);ledger.reserve({...cmd,requestId:cmd.requestId.toUpperCase()});
  const parent=join(root,'execution-ledger-v1'), dir=join(parent,readdirSync(parent)[0]);
  const file=join(dir,readdirSync(dir)[0]);
  writeFileSync(file,'{partial');assert.throws(()=>ledger.has(cmd.requestId));
  // Both case-specific entries are probed; a hardlink is never a valid clean miss.
  const otherDir=join(parent,readdirSync(parent)[1]);const other=join(otherDir,readdirSync(otherDir)[0]);
  linkSync(other,join(root,'linked-entry.json'));
  assert.throws(()=>ledger.has(cmd.requestId.toUpperCase()),/UNSAFE/);
});
test('selection consults tombstones and keeps late commands observable instead of terminalizing or dropping them',t=>{
  const ledger=createMailboxExecutionLedger(sandbox(t)),cmd=ordinary();ledger.reserve(cmd);
  const state={mailboxRotation:record(),consumedRequestIds:[],acceptedRequestIds:[]};
  const result=prepareMailboxRotationPoll(state,[comment(cmd,90),comment(ordinary({requestId:'late-request-001'}),150)],{ledger,readComments:()=>[]});
  assert.equal(result.consumedRequestIds.has(cmd.requestId),true);
  assert.deepEqual(result.deferredRequestIds,['late-request-001']);
});
test('native receipt-only private deliveries retain their IDs and require matching terminal head/operation to drain',()=>{
  const cmd=ordinary(),accepted=comment(terminal(cmd,{state:'ACCEPTED'}),101,true),done=comment(terminal(cmd),102,true);
  const observed=auditMailboxRotationComments([accepted,done],{issueNumber:current});
  assert.deepEqual(observed.requestIds,[cmd.requestId]);assert.deepEqual(observed.terminalIds,[cmd.requestId]);assert.deepEqual(observed.acceptedIds,[]);
  const wrong=comment(terminal({...cmd,expectedHead:target}),102,true);
  assert.deepEqual(auditMailboxRotationComments([accepted,wrong],{issueNumber:current}).acceptedIds,[cmd.requestId]);
});

function frozenFenceFixture(summary={}) {
  const r={...record(),...summary,phase:'FROZEN',drained:true},cmd=control('STATUS'),
    receipt=terminal(cmd,{result:{ok:true,result:{mailboxRotation:projectMailboxRotation(r,auditMailboxRotationComments([],{issueNumber:current}))}}});
  const publicReceipt=JSON.parse(serializeBoundedReceiptJson(receipt));
  const proofs=new Map([[100,comment(command())],[101,comment(cmd,101)],[102,comment(publicReceipt,102,true)]]);
  const fence={id:103,user:{login:'Cheekyfellastef'},body:buildMailboxRotationFence(r,{commandCommentId:101,receiptCommentId:102,receiptIssue:current})};
  return {r,proofs,fence,read:()=>readMailboxRotationFence(async()=>[fence],async id=>proofs.get(id))};
}
test('a FROZEN global fence requires real serialized owner receipt and admits only the exact activation PR',async()=>{
  const f=frozenFenceFixture(),fence=await f.read();
  assert.equal(mailboxRotationWorkflowAllowed(fence,{mode:'protected',prNumber:4000,head:target}),true);
  for (const input of [{mode:'observer'},{mode:'bootstrap'},{mode:'protected',prNumber:4001,head:target},{mode:'protected',prNumber:4000,head}]) assert.equal(mailboxRotationWorkflowAllowed(fence,input),false);
  assert.equal(mailboxRotationWorkflowAllowed(fence,{mode:'receipt'}),true);
});
test('forged/missing receipt, foreign owner and ambiguous global projections never relax the freeze',async()=>{
  const f=frozenFenceFixture();f.proofs.delete(102);await assert.rejects(f.read(),/RECEIPT_INVALID/);
  const g=frozenFenceFixture();g.proofs.get(102).user.login='attacker';await assert.rejects(g.read(),/RECEIPT_INVALID/);
  assert.throws(()=>findMailboxRotationFence([g.fence,g.fence]),/AMBIGUOUS/);
});

test('outer drain keeps aggregate status visible and still requires every native and outbox predicate',async()=>{
  const f=fixture();f.readActions=async()=>containedActions();await executeMailboxRotationOnHost(command(),f);
  const settled=settleMailboxRotationDrain(f.state,{outboxPendingCount:0,now});
  assert.equal(settled.mailboxRotation.phase,'FROZEN');assert.equal(settled.mailboxRotation.actionPendingAggregateCount,1);
  assert.equal(settled.mailboxRotation.actionBlockingCount,0);assert.equal(f.state.mailboxRotationActions.pendingRuns[0].status,'queued');
  assert.match(projectMailboxRotation(settled.mailboxRotation,settled.mailboxRotationInventory).actionsQuiescenceDigest,/^[a-f0-9]{64}$/);
  for(const patch of [{acceptedRequestIds:['live-native-action']},{pendingReceiptPublications:[{}]},
    {mailboxRotationInventory:{...f.state.mailboxRotationInventory,pendingAfterBarrier:['late-action-001']}}])
    assert.equal(settleMailboxRotationDrain({...f.state,...patch},{outboxPendingCount:0,now}).mailboxRotation.phase,'DRAINING');
  assert.equal(settleMailboxRotationDrain(f.state,{outboxPendingCount:1,now}).mailboxRotation.phase,'DRAINING');
});

test('public FROZEN evidence binds the real aggregate count, zero blocking work and native evidence digest',async()=>{
  const summary=mailboxActionEvidenceSummary(containedActions()),f=frozenFenceFixture(summary),fence=await f.read();
  assert.equal(fence.actionPendingAggregateCount,1);assert.equal(fence.actionBlockingCount,0);assert.equal(fence.actionsQuiescenceDigest,summary.actionsQuiescenceDigest);
  for(const patch of [{actionPendingAggregateCount:0},{actionBlockingCount:1},{actionsQuiescenceDigest:'e'.repeat(64)}]){
    const g=frozenFenceFixture(summary);g.fence.body=buildMailboxRotationFence({...g.r,...patch},{commandCommentId:101,receiptCommentId:102,receiptIssue:current});
    await assert.rejects(g.read(),/EXECUTION_EVIDENCE_INVALID/);
  }
});

test('same-epoch revocation does not authorize adoption: sync still needs matching FROZEN proof and exact merged epoch',async()=>{
  const a=containedActions(merged),f=frozenFenceFixture(mailboxActionEvidenceSummary(a)),fence=await f.read();
  const input={state:{mailboxRotation:{...f.r,globalFencePublished:true},acceptedRequestIds:[],pendingReceiptPublications:[]},
    predecessorComments:[],pull:pull({merged:true,merge_commit_sha:merged}),authoritySource:authority(),mainHead:merged,fence,actions:a,now,
    outboxLedger:{schemaVersion:'stephanos.battle-bridge-mailbox-outbox-ledger.v3',storeId:'a'.repeat(32),headSequence:10,nextSequence:10,legacy:null}};
  assert.equal(evaluateMailboxRotationSyncPreflight(input).ok,true);
  assert.equal(evaluateMailboxRotationSyncPreflight({...input,fence:null}).ok,false);
  assert.equal(evaluateMailboxRotationSyncPreflight({...input,actions:containedActions(head)}).blocker,'MAILBOX_ROTATION_SYNC_ACTIONS_PENDING');
  assert.equal(evaluateMailboxRotationSyncPreflight({...input,now:'2026-10-26T00:00:00Z'}).ok,false);
  assert.equal(evaluateMailboxRotationSyncPreflight({...input,state:{...input.state,acceptedRequestIds:['live-native-action']}}).ok,false);
});
test('workflow admission rechecks live main around proof reads and fails stale checkout before side effects',async()=>{
  const f=frozenFenceFixture();
  const api=async path=> path==='/branches/main'?{commit:{sha:head}}:path.startsWith('/issues/2315/')?[f.fence]:f.proofs.get(Number(path.split('/').at(-1)));
  assert.equal((await assertMailboxRotationWorkflowAdmission({mode:'protected',prNumber:4000,head:target,api,checkoutHead:()=>head})).admitted,true);
  await assert.rejects(assertMailboxRotationWorkflowAdmission({mode:'bootstrap',api,checkoutHead:()=>head}),/GLOBAL_FREEZE/);
  await assert.rejects(assertMailboxRotationWorkflowAdmission({mode:'receipt',api,checkoutHead:()=>target}),/SOURCE_STALE/);
  let reads=0;
  await assert.rejects(assertMailboxRotationWorkflowAdmission({mode:'receipt',checkoutHead:()=>head,
    api:async path=>path==='/branches/main'?{commit:{sha:++reads===1?head:target}}:api(path)}),/MAIN_MOVED/);
});
test('every production workflow ingress and privileged final step uses the same fresh-source freeze fence',()=>{
  for (const file of ['protected-workflow-dispatch-mailbox.yml','battle-bridge-out-of-band-observer-v1.yml',
    'battle-bridge-tailscale-bootstrap-pipe.yml','mailbox-receipt-index.yml','codex-banked-reset-telemetry.yml']) {
    const source=readFileSync(new URL(`../.github/workflows/${file}`,import.meta.url),'utf8');
    assert.match(source,/GITHUB_TOKEN: \$\{\{ github.token \}\}/);
    assert.match(source,/canonical-mailbox-workflow-event-gate.mjs/);
    if (file.includes('bootstrap-pipe') || file.includes('observer')) assert.match(source,/event-gate.mjs \w+\n          ssh/);
    else if (file.includes('receipt-index') || file.includes('telemetry')) assert.match(source,/await recheck\(\);[\s\S]*await github.rest.issues.update\(/);
  }
  for (const file of ['dispatch-protected-merge-from-mailbox.mjs','operator-protected-personal-repository-merge.mjs','operator-protected-merge-gate-v2.mjs']) {
    const source=readFileSync(new URL(`./${file}`,import.meta.url),'utf8');
    assert.match(source,/await assertMailboxRotationWorkflowAdmission\(\{ mode: 'protected'/);
  }
});
test('Actions inventory includes queued, waiting and old-head production runs but rejects truncation',async()=>{
  const r=await inventoryMailboxRotationActions(async status=>({total_count:1,workflow_runs:[{id:99,status,event:'workflow_dispatch',path:'.github/workflows/operator-merge-approval-gate.yml',head_sha:head}]}),now);
  assert.equal(r.complete,true);assert.equal(r.pendingRuns.length,1);
  await assert.rejects(inventoryMailboxRotationActions(async()=>({total_count:101,workflow_runs:[]})),/INCOMPLETE/);
});
test('source sync requires complete native drain, actual global fence, fresh Actions drain, merged activation and empty segmented outbox',async()=>{
  const f=frozenFenceFixture(),fence=await f.read(),input={state:{mailboxRotation:{...f.r,globalFencePublished:true},acceptedRequestIds:[],pendingReceiptPublications:[]},
    predecessorComments:[],pull:pull({merged:true,merge_commit_sha:merged}),authoritySource:authority(),mainHead:merged,fence,actions:actions(),
    outboxLedger:{schemaVersion:'stephanos.battle-bridge-mailbox-outbox-ledger.v3',storeId:'a'.repeat(32),headSequence:10,nextSequence:10,legacy:null}};
  assert.equal(evaluateMailboxRotationSyncPreflight(input).ok,true);
  for (const patch of [{fence:null},{actions:{complete:false,pendingRuns:[]}},{actions:{complete:true,pendingRuns:[{id:1}]}},
    {state:{}},{state:{mailboxRotation:{...f.r,phase:'CANCELLED'}}},
    {state:{...input.state,acceptedRequestIds:['pending-request-001']}},{outboxLedger:{...input.outboxLedger,nextSequence:11}},
    {predecessorComments:[comment(ordinary(),150)]},{pull:pull({merged:true,merge_commit_sha:head})}]) assert.equal(evaluateMailboxRotationSyncPreflight({...input,...patch}).ok,false);
});
test('receipt dual-read preserves terminal predecessor provenance while excluding predecessor commands, ACCEPTED and spoofed records',()=>{
  const cmd=ordinary({issueNumber:previous}),done=terminal(cmd);
  const record=createTrustedMailboxReceiptIndexFromGitHubComments([],{ownerLogin:'Cheekyfellastef',timestampUtc:now,predecessorComments:[
    comment(cmd,1,false,previous),comment(done,2,true,previous),
    comment(terminal({...cmd,requestId:'unfinished-previous-001'},{state:'ACCEPTED'}),3,true,previous),
    {...comment(terminal({...cmd,requestId:'spoofed-previous-001'}),4,true,previous),user:{login:'attacker'}}]});
  assert.equal(record.activeReceipt,null);assert.deepEqual(record.recentReceipts.map(r=>r.requestId),[cmd.requestId]);
});
test('only the exact native protocol adapters naturally reload; GitHub-only helpers grant no host execution',()=>{
  const native=['scripts/canonical-mailbox-execution-ledger-v1.mjs','scripts/canonical-mailbox-rotation-host-v1.mjs',
    'scripts/canonical-mailbox-rotation-sync-preflight-v1.mjs','scripts/stephanos-codex-dispatch-host-operation-v1.mjs'];
  const cloud=['scripts/canonical-mailbox-rollover-github-adapter.mjs','scripts/canonical-mailbox-workflow-admission-v1.mjs',
    'scripts/canonical-mailbox-workflow-event-gate.mjs','scripts/dispatch-protected-merge-from-mailbox.mjs','scripts/operator-protected-merge-gate-v2.mjs'];
  const result=classifyPostSyncRefresh([...native,...cloud]);
  assert.equal(result.automaticExecutionAllowed,true);assert.deepEqual(result.internal.unknownPaths,[]);
  assert.deepEqual(result.targetIds,['natural-reload']);assert.equal(result.noRuntimePathCount,cloud.length);
  for(const path of native.concat(cloud)) {
    const sibling=path.replace(/\.mjs$/,'-other.mjs');const r=classifyPostSyncRefresh([sibling]);
    assert.equal(r.automaticExecutionAllowed,false);assert.equal(r.unknownPathCount,1);
  }
});
test('A→B→C keeps one durable execution identity and successor proof derives from changed authority',async t=>{
  const root=sandbox(t),ledger=createMailboxExecutionLedger(root),source=readFileSync(new URL('../shared/agents/canonicalMailboxRotationV1.mjs',import.meta.url),'utf8');
  const authoritySource=readFileSync(new URL('../shared/agents/canonicalMailboxAuthorityV1.mjs',import.meta.url),'utf8');
  writeFileSync(join(root,'canonicalMailboxRotationActionEvidenceV1.mjs'),readFileSync(new URL('../shared/agents/canonicalMailboxRotationActionEvidenceV1.mjs',import.meta.url),'utf8'));
  let predecessor=current;
  for (const [i,epoch] of [current+1000,current+2000].entries()) {
    const a=join(root,`authority-${i}.mjs`),r=join(root,`rotation-${i}.mjs`);
    writeFileSync(a,authoritySource.replace(`CANONICAL_MAILBOX_ISSUE = ${current}`,`CANONICAL_MAILBOX_ISSUE = ${epoch}`)
      .replace(/RETIRED_CANONICAL_MAILBOX_ISSUES = Object.freeze\(\[[^\]]*\]\)/,
        `RETIRED_CANONICAL_MAILBOX_ISSUES = Object.freeze([1507, 2158, 2590, 2808, ${predecessor}])`));
    writeFileSync(r,source.replace('./canonicalMailboxAuthorityV1.mjs',pathToFileURL(a).href));
    const module=await import(pathToFileURL(r).href),rotation={...record(),predecessorIssue:predecessor,successorIssue:epoch};
    const ids=[`epoch-${i}-probe-first`,`epoch-${i}-probe-second`],comments=[];
    for (const [n,id] of ids.entries()) {
      const cmd=ordinary({issueNumber:epoch,requestId:id,expectedHead:merged,operation:n?'READ_CAPABILITY_REGISTRY':'READ_DEPLOYMENT_STATUS'});
      ledger.reserve(cmd);comments.push(comment(cmd,100+n*3,false,epoch),comment(terminal(cmd,{state:'ACCEPTED'}),101+n*3,true,epoch),comment(terminal(cmd),102+n*3,true,epoch));
      ledger.complete(terminal(cmd));
    }
    assert.equal(module.verifyMailboxRotationProbes(comments,rotation,{sourceHead:merged,requestIds:ids}),true);
    assert.equal(module.verifyMailboxRotationProbes(comments,rotation,{sourceHead:head,requestIds:ids}),false);
    const wrong=structuredClone(comments);
    const accepted=JSON.parse(wrong[1].body.match(/```json\s*([\s\S]*?)```/)[1]);accepted.operation='READ_CAPABILITY_REGISTRY';
    wrong[1]=comment(accepted,101,true,epoch);
    assert.equal(module.verifyMailboxRotationProbes(wrong,rotation,{sourceHead:merged,requestIds:ids}),false);
    const hostPath=join(root,`host-${i}.mjs`);
    writeFileSync(hostPath,readFileSync(new URL('./canonical-mailbox-rotation-host-v1.mjs',import.meta.url),'utf8')
      .replace('../shared/agents/canonicalMailboxAuthorityV1.mjs',pathToFileURL(a).href)
      .replace('../shared/agents/canonicalMailboxRotationV1.mjs',pathToFileURL(r).href)
      .replace('../shared/agents/canonicalMailboxRotationActionEvidenceV1.mjs',pathToFileURL(join(root,'canonicalMailboxRotationActionEvidenceV1.mjs')).href)
      .replace('../shared/agents/canonicalMailboxRolloverConsumerV1.mjs',new URL('../shared/agents/canonicalMailboxRolloverConsumerV1.mjs',import.meta.url).href));
    const host=await import(pathToFileURL(hostPath).href),state={mailboxRotation:{...rotation,phase:'FROZEN',drained:true,globalFencePublished:true}},
      options={...fixture(),state,sourceHead:merged,selectedCommentId:200,
        readPull:async()=>pull({merged:true,merge_commit_sha:merged}),readAuthoritySource:async()=>authority(epoch,[previous,predecessor]),
        readComments:async issue=>issue===epoch?comments:[]};
    assert.equal((await host.executeMailboxRotationOnHost(control('CANCEL',{issueNumber:epoch,expectedHead:merged}),options)).blocker,'MAILBOX_ROTATION_PROTECTED_ROLLBACK_REQUIRED');
    assert.equal((await host.executeMailboxRotationOnHost(control('VERIFY',{issueNumber:epoch,expectedHead:merged,probeRequestIds:ids}),options)).ok,true);
    assert.equal(state.mailboxRotation.phase,'VERIFIED');
    assert.throws(()=>ledger.reserve(ordinary({issueNumber:epoch+1000,requestId:ids[0]})),/ALREADY_SEEN/);
    predecessor=epoch;
  }
  assert.throws(()=>readMailboxAuthorityLiteral('export const CANONICAL_MAILBOX_ISSUE = userInput;'),/SOURCE_INVALID/);
});
test('merge-queue public fence evidence needs no expanded permission; main remains authenticated and paths fixed',async t=>{
  const originalFetch=globalThis.fetch, original={};
  for(const key of ['GITHUB_ACTIONS','GITHUB_JOB','GITHUB_TOKEN']) original[key]=process.env[key];
  t.after(()=>{globalThis.fetch=originalFetch;for(const [key,value] of Object.entries(original)) value===undefined?delete process.env[key]:process.env[key]=value;});
  process.env.GITHUB_ACTIONS='true';process.env.GITHUB_JOB='operator-merge-queue-boundary';process.env.GITHUB_TOKEN='test-only-fixed-value';
  const requests=[];
  globalThis.fetch=async(url,options)=>{requests.push({url,options});return {status:200,text:async()=>JSON.stringify({commit:{sha:head}})};};
  await readMailboxWorkflowGitHub('/issues/2315/comments?per_page=100&page=1');
  await readMailboxWorkflowGitHub('/branches/main');
  assert.equal(requests[0].options.headers.Authorization,undefined);
  assert.equal(requests[1].options.headers.Authorization,'Bearer test-only-fixed-value');
  assert.equal(requests[0].options.redirect,'error');
  await assert.rejects(readMailboxWorkflowGitHub('/issues/999/comments'),/PATH_DENIED/);
  globalThis.fetch=async()=>({status:403,text:async()=>''});
  await assert.rejects(readMailboxWorkflowGitHub('/issues/comments/100'),/FRESH_READ_FAILED/);
});
