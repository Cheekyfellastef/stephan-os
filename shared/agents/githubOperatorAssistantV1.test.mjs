import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildGitHubOperatorBriefing, GITHUB_OPERATOR_ASSISTANT_ALLOWED_COMMANDS, renderGitHubOperatorBriefingHuman } from './githubOperatorAssistantV1.mjs';

test('builds deterministic GitHub operator briefing from evidence fixtures', async () => {
  const fixture = JSON.parse(await readFile(new URL('../../tests/fixtures/github-operator-assistant/input.json', import.meta.url), 'utf8'));
  const briefing = buildGitHubOperatorBriefing(fixture);
  assert.equal(briefing.schemaVersion, 'github-operator-assistant.v1');
  assert.equal(briefing.status, 'BLOCKED');
  assert.deepEqual(briefing.focusIssues, [1284, 1286, 1287]);
  assert.equal(briefing.readyForReview.some((item) => item.number === 1448), true);
  assert.equal(briefing.blocked.some((item) => item.number === 1444 && item.kind === 'pr-runtime-blocked'), true);
  assert.equal(briefing.blocked.some((item) => item.number === 1450 && item.kind === 'pr-head-mismatch'), true);
  assert.equal(briefing.waitingForImplementation.some((item) => item.number === 1286), true);
  assert.equal(briefing.evidence.some((item) => item.prNumber === 1448 && item.marker === 'PR_PUBLICATION_VERIFIER_PASS'), true);
});

test('classifies missing publication proof separately from claimed summaries', () => {
  const briefing = buildGitHubOperatorBriefing({
    generatedAtUtc: '2026-07-08T00:00:00.000Z',
    pullRequests: [{ number: 1500, title: 'Claimed ready', headSha: 'a'.repeat(40), claimedHeadSha: 'a'.repeat(40), checksStatus: 'pass', readyForReview: true }],
    evidence: [],
  });
  assert.equal(briefing.readyForReview.length, 0);
  assert.equal(briefing.waitingForProof[0].kind, 'pr-missing-publication-proof');
});

test('exposes only read-only allowlisted command shapes and renders compact human briefing', () => {
  assert.equal(GITHUB_OPERATOR_ASSISTANT_ALLOWED_COMMANDS.every((command) => !/pr merge|issue close|branch -d|delete-branch|reset --hard|sh -c|powershell/i.test(command)), true);
  const human = renderGitHubOperatorBriefingHuman(buildGitHubOperatorBriefing({ generatedAtUtc: '2026-07-08T00:00:00.000Z' }));
  assert.match(human, /GitHub Operator Assistant V1/);
  assert.match(human, /Ready for review: none/);
});

test('requires an explicit structured publication marker rather than claimed summary text', () => {
 const briefing=buildGitHubOperatorBriefing({
  pullRequests:[{number:1500,headSha:'a'.repeat(40),checksStatus:'pass'}],
  evidence:[{prNumber:1500,summary:'No PR_PUBLICATION_VERIFIER_PASS was found'}],
 });
 assert.equal(briefing.status,'WAITING_FOR_PROOF');
 assert.equal(briefing.readyForReview.length,0);
 assert.equal(briefing.waitingForProof[0].kind,'pr-missing-publication-proof');
});

test('never returns PASS while proof, operator or implementation work remains', () => {
 const withProofMissing=buildGitHubOperatorBriefing({pullRequests:[{number:1500,checksStatus:'pass'}]});
 assert.equal(withProofMissing.status,'WAITING_FOR_PROOF');
 const withOperator=buildGitHubOperatorBriefing({
  pullRequests:[{number:1500,checksStatus:'pass',operatorApprovalRequired:true,publicationVerified:true}],
 });
 assert.equal(withOperator.status,'WAITING_FOR_OPERATOR');
 const withImplementation=buildGitHubOperatorBriefing({issues:[{number:1286,status:'waiting-for-implementation'}]});
 assert.equal(withImplementation.status,'WAITING_FOR_IMPLEMENTATION');
});

test('normalizes allowlisted GitHub PR HEAD, branch and complete successful check rollups', () => {
 const briefing=buildGitHubOperatorBriefing({
  pullRequests:[{number:1500,headRefName:'owner/feature',headRefOid:'a'.repeat(40),
   statusCheckRollup:[{status:'COMPLETED',conclusion:'SUCCESS'},{state:'SUCCESS'}]}],
  evidence:[{prNumber:1500,marker:'PR_PUBLICATION_VERIFIER_PASS'}],
 });
 assert.equal(briefing.status,'PASS');
 assert.equal(briefing.readyForReview.length,1);
 assert.equal(briefing.readyForReview[0].headSha,'a'.repeat(40));
 assert.equal(briefing.readyForReview[0].branch,'owner/feature');
});

test('rejects missing, pending, failing, draft and contradictory check evidence', () => {
 const verified=[{prNumber:1500,marker:'PR_PUBLICATION_VERIFIER_PASS'}];
 const cases=[
  {number:1500},
  {number:1500,statusCheckRollup:[]},
  {number:1500,statusCheckRollup:[{status:'IN_PROGRESS',conclusion:''}]},
  {number:1500,statusCheckRollup:[{status:'COMPLETED',conclusion:'FAILURE'}]},
  {number:1500,checksStatus:'pass',statusCheckRollup:[{status:'COMPLETED',conclusion:'FAILURE'}]},
  {number:1500,checksStatus:'pass',isDraft:true},
 ];
 for(const pr of cases){
  const briefing=buildGitHubOperatorBriefing({pullRequests:[pr],evidence:verified});
  assert.equal(briefing.readyForReview.length,0);
  assert.equal(briefing.status,'WAITING_FOR_PROOF');
 }
});

test('detects claimed HEAD drift and contradictory GitHub field aliases', () => {
 const verified=[{prNumber:1500,marker:'PR_PUBLICATION_VERIFIER_PASS'}];
 const drift=buildGitHubOperatorBriefing({pullRequests:[{
  number:1500,headRefOid:'a'.repeat(40),claimedHeadSha:'b'.repeat(40),checksStatus:'pass'}],evidence:verified});
 assert.equal(drift.blocked[0].kind,'pr-head-mismatch');
 const conflict=buildGitHubOperatorBriefing({pullRequests:[{
  number:1500,headSha:'a'.repeat(40),headRefOid:'b'.repeat(40),checksStatus:'pass'}],evidence:verified});
 assert.equal(conflict.blocked[0].kind,'pr-head-evidence-conflict');
});

test('fails closed on contradictory per-check result aliases', () => {
 const pr={number:1500,headSha:'a'.repeat(40),publicationVerified:true};
 for(const statusCheckRollup of [
  [{status:'COMPLETED',conclusion:'SUCCESS',state:'FAILURE'}],
  [{status:'COMPLETED',conclusion:'SUCCESS',state:'PENDING'}],
  [{status:'COMPLETED',conclusion:'FAILURE',state:'SUCCESS'}],
 ]){
  const briefing=buildGitHubOperatorBriefing({pullRequests:[{...pr,statusCheckRollup}]});
  assert.equal(briefing.status,'WAITING_FOR_PROOF');
  assert.equal(briefing.readyForReview.length,0);
 }
 const consistent=buildGitHubOperatorBriefing({pullRequests:[{...pr,statusCheckRollup:[{status:'COMPLETED',conclusion:'SUCCESS',state:'SUCCESS'}]}]});
 assert.equal(consistent.status,'PASS');
});


test('detects overdue canonical handoff and rejects foreign acknowledgement',()=>{
 const producer={kind:'goal-stage-handoff',marker:'PRODUCED',prNumber:1449,issueNumber:2972,
  sourceHead:'a'.repeat(40),baseSha:'b'.repeat(40),ref:'producer-1',nextOwner:'protected-merge-owner',
  nextAction:'consume-review',producedAtUtc:'2026-11-03T10:00:00Z',dueAtUtc:'2026-11-03T11:00:00Z'};
 const ack={kind:'goal-stage-handoff',marker:'ACKNOWLEDGED',producerReceiptRef:'producer-1',
  prNumber:1449,issueNumber:2972,sourceHead:'a'.repeat(40),baseSha:'b'.repeat(40),
  ref:'ack-1',receiverOwner:'protected-merge-owner',nextAction:'consume-review',acknowledgedAtUtc:'2026-11-03T10:30:00Z'};
 const f=evidence=>buildGitHubOperatorBriefing({generatedAtUtc:'2026-11-03T12:00:00Z',evidence});
 assert.equal(f([producer]).blocked[0].kind,'automation-debt-stale-handoff');
 assert.equal(f([producer,{...ack,sourceHead:'c'.repeat(40)}]).status,'BLOCKED');
 assert.equal(f([producer,{...ack,producerReceiptRef:'different'}]).status,'BLOCKED');
 assert.equal(f([producer,ack]).status,'WAITING_FOR_PROOF');
});
test('projects pending and incomplete handoffs without treating summary claims as evidence',()=>{
 const producer={kind:'goal-stage-handoff',marker:'PRODUCED',prNumber:2094,issueNumber:2670,
  sourceHead:'d'.repeat(40),baseSha:'e'.repeat(40),ref:'receipt-2',nextOwner:'reviewer',
  nextAction:'review-exact-head',producedAtUtc:'2026-11-03T12:00:00Z',dueAtUtc:'2026-11-03T14:00:00Z'};
 const f=evidence=>buildGitHubOperatorBriefing({generatedAtUtc:'2026-11-03T13:00:00Z',evidence});
 assert.equal(f([producer]).waitingForProof[0].kind,'handoff-awaiting-receiver-ack');
 assert.equal(f([{...producer,baseSha:''}]).blocked[0].kind,'automation-debt-incomplete-handoff');
 assert.equal(f([{...producer,marker:'CLAIMED'}]).status,'PASS');
});

test('rejects future-dated PRODUCED handoffs and retains valid acknowledgements',()=>{
 const p={kind:'goal-stage-handoff',marker:'PRODUCED',prNumber:1449,issueNumber:2972,
  sourceHead:'a'.repeat(40),baseSha:'b'.repeat(40),ref:'future-1',
  nextOwner:'review-owner',nextAction:'consume-review',
  producedAtUtc:'2026-11-03T13:00:01Z',dueAtUtc:'2026-11-03T14:00:00Z'};
 const f=evidence=>buildGitHubOperatorBriefing({generatedAtUtc:'2026-11-03T13:00:00Z',evidence});
 for(const producedAtUtc of ['2026-11-03T13:00:01Z','2026-11-04T13:00:00Z']){
  const b=f([{...p,producedAtUtc,dueAtUtc:'2026-11-05T13:00:00Z'}]);
  assert.equal(b.status,'BLOCKED');
  assert.equal(b.blocked[0].kind,'automation-debt-incomplete-handoff');
  assert.equal(b.waitingForProof.length,0);
 }
 const valid={...p,producedAtUtc:'2026-11-03T12:30:00Z'};
 assert.equal(f([valid]).status,'WAITING_FOR_PROOF');
 const ack={kind:'goal-stage-handoff',marker:'ACKNOWLEDGED',producerReceiptRef:'future-1',ref:'ack',
  prNumber:1449,issueNumber:2972,sourceHead:'a'.repeat(40),baseSha:'b'.repeat(40),
  receiverOwner:'review-owner',nextAction:'consume-review',acknowledgedAtUtc:'2026-11-03T12:45:00Z'};
 assert.equal(f([valid,ack]).status,'WAITING_FOR_PROOF');
 assert.equal(f([p,ack]).status,'BLOCKED');
});


// A receiver ACK is not timely merely because it eventually arrived.
test('retains automation debt when receiver acknowledgement missed producer deadline',()=>{
  const producer={kind:'goal-stage-handoff',marker:'PRODUCED',prNumber:1449,issueNumber:2972,
    sourceHead:'a'.repeat(40),baseSha:'b'.repeat(40),ref:'deadline-receipt-1',
    nextOwner:'protected-merge-owner',nextAction:'consume-exact-review',
    producedAtUtc:'2026-11-03T10:00:00Z',dueAtUtc:'2026-11-03T11:00:00Z'};
  const ack={kind:'goal-stage-handoff',marker:'ACKNOWLEDGED',producerReceiptRef:producer.ref,
    prNumber:1449,issueNumber:2972,sourceHead:producer.sourceHead,baseSha:producer.baseSha,
    ref:'deadline-ack-1',receiverOwner:producer.nextOwner,nextAction:producer.nextAction,
    acknowledgedAtUtc:'2026-11-03T11:00:01Z'};
  const f=evidence=>buildGitHubOperatorBriefing({generatedAtUtc:'2026-11-03T12:00:00Z',evidence});
  const late=f([producer,ack]);
  assert.equal(late.status,'BLOCKED');
  assert.equal(late.blocked[0].kind,'automation-debt-stale-handoff');
  assert.equal(f([producer,{...ack,acknowledgedAtUtc:'2026-11-03T11:00:00Z'}]).status,'WAITING_FOR_PROOF');
  assert.equal(f([producer,{...ack,acknowledgedAtUtc:'2026-11-03T10:30:00Z'}]).status,'WAITING_FOR_PROOF');
  assert.equal(f([producer,{...ack,acknowledgedAtUtc:'2026-11-03T09:59:59Z'}]).status,'BLOCKED');
  assert.equal(f([producer,{...ack,acknowledgedAtUtc:'2026-11-03T12:00:01Z'}]).status,'BLOCKED');
});


test('fails closed on duplicate producer receipts and ambiguous receiver acknowledgements',()=>{
 const p={kind:'goal-stage-handoff',marker:'PRODUCED',prNumber:1449,issueNumber:2972,
  sourceHead:'a'.repeat(40),baseSha:'b'.repeat(40),ref:'producer-unique-1',
  nextOwner:'merge-owner',nextAction:'guarded-merge',
  producedAtUtc:'2026-11-03T12:00:00Z',dueAtUtc:'2026-11-03T13:00:00Z'};
 const a={kind:'goal-stage-handoff',marker:'ACKNOWLEDGED',producerReceiptRef:p.ref,
  prNumber:p.prNumber,issueNumber:p.issueNumber,sourceHead:p.sourceHead,baseSha:p.baseSha,
  ref:'receiver-unique-1',receiverOwner:p.nextOwner,nextAction:p.nextAction,
  acknowledgedAtUtc:'2026-11-03T12:30:00Z'};
 const f=evidence=>buildGitHubOperatorBriefing({generatedAtUtc:'2026-11-03T12:45:00Z',evidence});
 assert.equal(f([p,a]).status,'WAITING_FOR_PROOF');
 for(const collision of [{...p},{...p,nextOwner:'foreign-owner'}]){
  const r=f([p,collision,a]);
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.blocked[0].kind,'automation-debt-duplicate-producer-receipt');
 }
 for(const duplicateAck of [{...a},{...a,receiverOwner:'foreign-owner',ref:'receiver-unique-2'}]){
  const r=f([p,a,duplicateAck]);
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.blocked[0].kind,'automation-debt-ambiguous-receiver-ack');
 }
 assert.equal(f([p,a,{...a,producerReceiptRef:'other-unrelated-producer'}]).status,'WAITING_FOR_PROOF');
 const p2={...p,ref:'producer-unique-2',issueNumber:2670};
 const a2={...a,producerReceiptRef:p2.ref,issueNumber:p2.issueNumber,ref:'receiver-unique-2'};
 assert.equal(f([p,p2,a,a2]).status,'WAITING_FOR_PROOF');
 assert.equal(f([p]).status,'WAITING_FOR_PROOF');
 assert.equal(f([p,{...p},a]).blocked.length,2);
});


test('fails closed on a present but invalid receiver acknowledgement before producer deadline',()=>{
 const p={kind:'goal-stage-handoff',marker:'PRODUCED',prNumber:1449,issueNumber:2972,
  sourceHead:'a'.repeat(40),baseSha:'b'.repeat(40),ref:'bounded-producer-ack',
  nextOwner:'original-merge-owner',nextAction:'consume-exact-review',
  producedAtUtc:'2026-11-03T12:00:00Z',dueAtUtc:'2026-11-03T13:00:00Z'};
 const ack={kind:'goal-stage-handoff',marker:'ACKNOWLEDGED',
  producerReceiptRef:p.ref,prNumber:p.prNumber,issueNumber:p.issueNumber,
  sourceHead:p.sourceHead,baseSha:p.baseSha,ref:'bounded-receiver-ack',
  receiverOwner:p.nextOwner,nextAction:p.nextAction,acknowledgedAtUtc:'2026-11-03T12:10:00Z'};
 const f=evidence=>buildGitHubOperatorBriefing({generatedAtUtc:'2026-11-03T12:30:00Z',evidence});
 assert.equal(f([p,ack]).status,'WAITING_FOR_PROOF');
 assert.equal(f([p]).waitingForProof[0].kind,'handoff-awaiting-receiver-ack');
 const cases=[
  {prNumber:2094},{issueNumber:2670},{sourceHead:'c'.repeat(40)},
  {baseSha:'d'.repeat(40)},{receiverOwner:'unrelated-owner'},
  {nextAction:'wrong-action'},{ref:''},{acknowledgedAtUtc:'2026-11-03T11:59:59Z'},
  {acknowledgedAtUtc:'2026-11-03T12:31:00Z'},
  {acknowledgedAtUtc:'2026-11-03T13:00:01Z'},
 ];
 for(const altered of cases){
  const briefing=f([p,{...ack,...altered}]);
  assert.equal(briefing.status,'BLOCKED');
  assert.equal(briefing.blocked[0].kind,'automation-debt-mismatched-receiver-ack');
  assert.equal(briefing.waitingForProof.length,0);
 }
});


test('flags a previously acknowledged handoff when the observed current PR identity changes',()=>{
 const producer={kind:'goal-stage-handoff',marker:'PRODUCED',prNumber:1449,issueNumber:2972,
  sourceHead:'a'.repeat(40),baseSha:'b'.repeat(40),ref:'review-stage-producer-1',
  nextOwner:'protected-merge-owner',nextAction:'consume-exact-review',
  producedAtUtc:'2026-11-03T12:00:00Z',dueAtUtc:'2026-11-03T16:00:00Z'};
 const ack={kind:'goal-stage-handoff',marker:'ACKNOWLEDGED',producerReceiptRef:producer.ref,
  prNumber:producer.prNumber,issueNumber:producer.issueNumber,
  sourceHead:producer.sourceHead,baseSha:producer.baseSha,ref:'review-stage-ack-1',
  receiverOwner:producer.nextOwner,nextAction:producer.nextAction,
  acknowledgedAtUtc:'2026-11-03T13:00:00Z'};
 const project=(pr)=>buildGitHubOperatorBriefing({generatedAtUtc:'2026-11-03T14:00:00Z',
  evidence:[producer,ack],pullRequests:pr?[{number:1449,publicationVerified:true,
   checksStatus:'pass',isDraft:false,...pr}]:[]});
 assert.equal(project({headSha:producer.sourceHead,baseSha:producer.baseSha}).status,'WAITING_FOR_PROOF');
 for(const changed of [
  {headSha:'c'.repeat(40),baseSha:producer.baseSha},
  {headSha:producer.sourceHead,baseSha:'d'.repeat(40)},
  {headRefOid:'c'.repeat(40),baseRefOid:producer.baseSha},
 ]){
  const r=project(changed);
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.blocked[0].kind,'automation-debt-stale-source-identity');
  assert.equal(r.waitingForProof.length,0);
 }
 // A missing current PR snapshot must not be invented as a source-identity conflict.
 assert.equal(project(null).status,'WAITING_FOR_PROOF');
 assert.equal(project({}).status,'WAITING_FOR_PROOF');
});

test('requires exact terminal live-verification evidence after the receiver acknowledges a handoff',()=>{
 const p={kind:'goal-stage-handoff',marker:'PRODUCED',prNumber:1449,issueNumber:2972,
  sourceHead:'a'.repeat(40),baseSha:'b'.repeat(40),ref:'terminal-producer-1',nextOwner:'merge-steward',
  nextAction:'consume-reviewed-merge',acceptancePredicate:'original-user-facing-live-outcome',
  producedAtUtc:'2026-11-03T12:00:00Z',dueAtUtc:'2026-11-03T13:00:00Z'};
 const ack={kind:'goal-stage-handoff',marker:'ACKNOWLEDGED',producerReceiptRef:p.ref,ref:'terminal-ack-1',
  prNumber:p.prNumber,issueNumber:p.issueNumber,sourceHead:p.sourceHead,baseSha:p.baseSha,
  receiverOwner:p.nextOwner,nextAction:p.nextAction,acknowledgedAtUtc:'2026-11-03T12:20:00Z'};
 const done={kind:'goal-stage-handoff',marker:'VERIFIED_DONE',producerReceiptRef:p.ref,receiverAckRef:ack.ref,
  ref:'terminal-proof-receipt-1',verificationRef:'canonical-live-proof-1',acceptancePredicate:p.acceptancePredicate,
  prNumber:p.prNumber,issueNumber:p.issueNumber,sourceHead:p.sourceHead,baseSha:p.baseSha,
  receiverOwner:p.nextOwner,nextAction:p.nextAction,verifiedAtUtc:'2026-11-03T12:30:00Z'};
 const f=evidence=>buildGitHubOperatorBriefing({generatedAtUtc:'2026-11-03T12:40:00Z',evidence});
 const pending=f([p,ack]);
 assert.equal(pending.status,'WAITING_FOR_PROOF');
 assert.equal(pending.waitingForProof[0].kind,'handoff-awaiting-terminal-verification');
 assert.equal(f([p,ack,done]).status,'PASS');
 for(const altered of [
  {receiverAckRef:'different'}, {sourceHead:'c'.repeat(40)}, {baseSha:'d'.repeat(40)},
  {receiverOwner:'other'}, {nextAction:'other'}, {acceptancePredicate:'other'},
  {verificationRef:''}, {ref:''}, {verifiedAtUtc:'2026-11-03T12:19:59Z'},
  {verifiedAtUtc:'2026-11-03T12:40:01Z'}
 ]){
  const b=f([p,ack,{...done,...altered}]);
  assert.equal(b.status,'BLOCKED');
  assert.equal(b.blocked[0].kind,'automation-debt-invalid-terminal-proof');
 }
 assert.equal(f([p,done]).blocked[0].kind,'automation-debt-terminal-without-ack');
 assert.equal(f([p,ack,done,{...done,ref:'duplicate'}]).blocked[0].kind,'automation-debt-ambiguous-terminal-proof');
});


test('terminal capability proof cannot invent an acceptance predicate absent from the producer',()=>{
 const p={kind:'goal-stage-handoff',marker:'PRODUCED',prNumber:1449,issueNumber:2972,
  sourceHead:'a'.repeat(40),baseSha:'b'.repeat(40),ref:'predicate-producer-1',
  nextOwner:'original-merge-owner',nextAction:'guarded-merge',
  producedAtUtc:'2026-11-03T12:00:00Z',dueAtUtc:'2026-11-03T14:00:00Z'};
 const a={kind:'goal-stage-handoff',marker:'ACKNOWLEDGED',producerReceiptRef:p.ref,
  prNumber:p.prNumber,issueNumber:p.issueNumber,sourceHead:p.sourceHead,baseSha:p.baseSha,
  ref:'predicate-ack-1',receiverOwner:p.nextOwner,nextAction:p.nextAction,
  acknowledgedAtUtc:'2026-11-03T12:20:00Z'};
 const v={kind:'goal-stage-handoff',marker:'VERIFIED_DONE',producerReceiptRef:p.ref,
  receiverAckRef:a.ref,ref:'predicate-terminal-1',verificationRef:'independent-live-proof-1',
  acceptancePredicate:'operator-visible-live-outcome',prNumber:p.prNumber,
  issueNumber:p.issueNumber,sourceHead:p.sourceHead,baseSha:p.baseSha,
  receiverOwner:p.nextOwner,nextAction:p.nextAction,verifiedAtUtc:'2026-11-03T12:25:00Z'};
 const briefing=e=>buildGitHubOperatorBriefing({generatedAtUtc:'2026-11-03T12:30:00Z',evidence:e});
 assert.equal(briefing([p,a]).status,'WAITING_FOR_PROOF');
 const missing=briefing([p,a,v]);
 assert.equal(missing.status,'BLOCKED');
 assert.equal(missing.blocked[0].kind,'automation-debt-invalid-terminal-proof');
 assert.equal(briefing([{...p,acceptancePredicate:v.acceptancePredicate},a,v]).status,'PASS');
 assert.equal(briefing([{...p,acceptancePredicate:'different-acceptance'},a,v]).status,'BLOCKED');
});
