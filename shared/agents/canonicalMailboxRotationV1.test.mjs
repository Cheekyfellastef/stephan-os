import assert from 'node:assert/strict';
import test from 'node:test';
import { CANONICAL_MAILBOX_ISSUE as current, CANONICAL_MAILBOX_RECEIPT_PREDECESSOR as previous } from './canonicalMailboxAuthorityV1.mjs';
import { MAILBOX_ROTATION_OPERATION as operation, MAILBOX_ROTATION_SCHEMA, validateMailboxRotationCommandShape,
  auditMailboxRotationComments, mailboxRotationCommandAllowed, settleMailboxRotationDrain,
  projectMailboxRotationReceipt, mailboxRotationDigest } from './canonicalMailboxRotationV1.mjs';
import { selectBattleBridgeGitHubCommandBatch, validateBattleBridgeGitHubCommand } from './battleBridgeGitHubCommandMailbox.mjs';
import { evaluateCanonicalMailboxWorkflowEvent } from '../../scripts/canonical-mailbox-workflow-event-gate.mjs';
export const head = 'a'.repeat(40), target = 'b'.repeat(40), timestamp = '2026-10-25T21:00:00.000Z';
export const record = () => ({ schemaVersion: MAILBOX_ROTATION_SCHEMA, transitionId: 'rotation-test-transition-001',
  phase: 'DRAINING', predecessorIssue: current, successorIssue: current+1000, barrierCommentId: 100,
  cutoverPrNumber: 4000, cutoverHead: target, preparationHead: head,
  freezeRequestId: 'rotation-freeze-request-001', requestedAt: timestamp, drained: false });
export const command = (patch = {}) => ({ schemaVersion: 'stephanos.battle-bridge-github-command.v1',
  requestId: 'rotation-freeze-request-001', operation, repository: 'Cheekyfellastef/stephan-os',
  issueNumber: current, branch: 'main', operatorApproval: 'operator-approved', expectedHead: head,
  expiresAt: '2026-10-25T21:10:00.000Z', rotationAction: 'FREEZE', transitionId: record().transitionId,
  successorIssue: current+1000, cutoverPrNumber: 4000, cutoverHead: target, ...patch });
export const comment = (value, id=90, receipt=false, issue=current) => ({ id,
  html_url: `https://github.com/Cheekyfellastef/stephan-os/issues/${issue}#issuecomment-${id}`,
  user: { login: 'Cheekyfellastef' }, created_at: timestamp,
  body: `${receipt ? '<!-- stephanos-battle-bridge-command-receipt -->\n```json' : '```stephanos-battle-bridge-command'}\n${JSON.stringify(value)}\n\`\`\``,
});
export const ordinary = patch => command({ operation:'READ_DEPLOYMENT_STATUS', requestId:'ordinary-request-001',
  rotationAction:undefined, transitionId:undefined, successorIssue:undefined, cutoverPrNumber:undefined, cutoverHead:undefined, ...patch });
export const terminal = (cmd, patch={}) => ({ schemaVersion:'stephanos.battle-bridge-github-command-receipt.v1',
  repository:cmd.repository,issueNumber:cmd.issueNumber,branch:'main',requestId:cmd.requestId,operation:cmd.operation,
  expectedHead:cmd.expectedHead,state:'DONE',acceptedAt:timestamp,completedAt:timestamp,processSourceHead:head,...patch });

test('composition admits only the fixed exact-head owner rotation envelope', () => {
  const cmd=command();
  const selected=selectBattleBridgeGitHubCommandBatch([comment(cmd)],{now:new Date(timestamp),currentHead:head,maxBatch:1});
  assert.equal(selected.commands[0].command.rotationAction,'FREEZE');
  assert.equal(validateBattleBridgeGitHubCommand({...cmd,issueNumber:previous},{author:'Cheekyfellastef',now:new Date(timestamp)}).ok,false);
  for (const patch of [{shell:'anything'},{successorIssue:current},{cutoverHead:'main'},{rotationAction:'MERGE'},{operatorApproval:'yes'}]) assert.equal(validateMailboxRotationCommandShape({...cmd,...patch}).ok,false);
});
test('VERIFY needs two distinct probes and cannot inherit freeze-only fields',()=>{
  const {successorIssue,cutoverPrNumber,cutoverHead,...cmd}=command();
  assert.equal(validateMailboxRotationCommandShape({...cmd,rotationAction:'VERIFY',probeRequestIds:['probe-first-001','probe-second-001']}).ok,true);
  assert.equal(validateMailboxRotationCommandShape({...cmd,rotationAction:'VERIFY',probeRequestIds:['probe-first-001','probe-first-001']}).ok,false);
  assert.equal(validateMailboxRotationCommandShape({...cmd,rotationAction:'STATUS',cutoverHead}).ok,false);
});
test('inventory requires matching operation/head, trusted owner and exact source issue',()=>{
  const cmd=ordinary({}), good=terminal(cmd);
  const trusted=comment(cmd), wrongHead=comment({...good,expectedHead:target},91,true);
  assert.deepEqual(auditMailboxRotationComments([trusted,wrongHead],{issueNumber:current}).pendingBeforeBarrier,[cmd.requestId]);
  assert.equal(auditMailboxRotationComments([trusted,comment(good,92,true)],{issueNumber:current}).terminalIds.length,1);
  assert.equal(auditMailboxRotationComments([{...trusted,user:{login:'attacker'}}],{issueNumber:current}).commandCount,0);
  assert.equal(auditMailboxRotationComments([comment({...cmd,issueNumber:previous})],{issueNumber:current}).commandCount,0);
});
test('freeze drains pre-barrier actions while retaining late ordinary commands',()=>{
  const rotation=record(), cmd=ordinary({});
  assert.equal(mailboxRotationCommandAllowed(cmd,90,rotation),true);
  assert.equal(mailboxRotationCommandAllowed(cmd,110,rotation),false);
  assert.equal(mailboxRotationCommandAllowed(cmd,90,{...rotation,phase:'FROZEN'}),false);
  assert.equal(mailboxRotationCommandAllowed(command({transitionId:'different-transition-001'}),110,rotation),false);
  assert.equal(mailboxRotationCommandAllowed(command(),110,rotation),true);
});
test('freeze permits only its exact protected environment packet and reviewed update head',()=>{
  const rotation={...record(),phase:'FROZEN'};
  const approval={operation:'APPROVE_PROTECTED_MERGE_ENVIRONMENT',prNumber:4000,expectedPullRequestHead:target};
  assert.equal(mailboxRotationCommandAllowed(approval,120,rotation),true);
  assert.equal(mailboxRotationCommandAllowed({...approval,prNumber:4001},120,rotation),false);
  assert.equal(mailboxRotationCommandAllowed({operation:'UPDATE_STEPHANOS_FROM_CHAT',expectedHead:target},120,rotation),false);
  assert.equal(mailboxRotationCommandAllowed({operation:'UPDATE_STEPHANOS_FROM_CHAT',expectedHead:target},120,rotation,{approvedUpdateHead:target}),true);
});
test('only the outer guard can attest FROZEN after every action and publication drains',()=>{
  const inventory=auditMailboxRotationComments([],{issueNumber:current});
  const state={mailboxRotation:{...record(),globalFencePublished:true},mailboxRotationInventory:inventory,
    mailboxRotationActions:{complete:true,observedAt:timestamp,pendingRuns:[]},acceptedRequestIds:[],pendingReceiptPublications:[]};
  const settle = (s, count=0) => settleMailboxRotationDrain(s,{outboxPendingCount:count,now:timestamp});
  assert.equal(settle(state).mailboxRotation.phase,'FROZEN');
  for (const patch of [{acceptedRequestIds:['inflight-001']},{pendingReceiptPublications:[{}]},
    {mailboxRotationInventory:{...inventory,pendingBeforeBarrier:['prior-action-001']}},
    {mailboxRotationInventory:{...inventory,pendingAfterBarrier:['late-action-001']}},
    {mailboxRotationInventory:{...inventory,acceptedIds:['accepted-action-001']}},
    {mailboxRotation:{...record(),globalFencePublished:false}},
    {mailboxRotationActions:{complete:true,observedAt:timestamp,pendingRuns:[{id:10}]}},
    {mailboxRotationActions:{complete:true,observedAt:'2026-10-25T20:00:00Z',pendingRuns:[]}}]) assert.equal(settle({...state,...patch}).mailboxRotation.phase,'DRAINING');
  assert.equal(settle(state,1).mailboxRotation.phase,'DRAINING');
  assert.throws(()=>settleMailboxRotationDrain(state,{}),/OUTBOX_UNPROVEN/);
});
test('inventory preserves late commands and has a stable content-bound digest',()=>{
  const cmd=ordinary({}), after=comment(cmd,101);
  const inventory=auditMailboxRotationComments([after],{issueNumber:current,barrierCommentId:100});
  assert.deepEqual(inventory.pendingAfterBarrier,[cmd.requestId]);
  assert.notEqual(inventory.inventoryDigest,auditMailboxRotationComments([comment({...cmd,expectedHead:target},101)],{issueNumber:current}).inventoryDigest);
  assert.equal(mailboxRotationDigest({a:1,b:2}),mailboxRotationDigest({b:2,a:1}));
});
test('public rotation projection is operation-bound and cannot expose arbitrary data',()=>{
  const projected=projectMailboxRotationReceipt({mailboxRotation:{...record(),secret:'private',inventoryDigest:'C:/private',drained:true}},operation);
  assert.equal(JSON.stringify(projected).includes('private'),false);
  assert.equal(projected.mailboxRotation.mergeAuthority,false);
  assert.deepEqual(projectMailboxRotationReceipt({mailboxRotation:record()},'OTHER'),{});
});
test('receipt-only predecessor ingress has zero executable authority',()=>{
  const event={action:'created',repository:{full_name:'Cheekyfellastef/stephan-os'},issue:{number:previous},
    comment:{user:{login:'Cheekyfellastef'},body:'<!-- stephanos-battle-bridge-command-receipt -->'}};
  assert.equal(evaluateCanonicalMailboxWorkflowEvent(event,{mode:'receipt'}).admitted,true);
  assert.equal(evaluateCanonicalMailboxWorkflowEvent(event,{mode:'protected'}).admitted,false);
});
