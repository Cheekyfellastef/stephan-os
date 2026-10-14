import test from 'node:test';
import assert from 'node:assert/strict';
import { planChatgptGithubGoalCandidatesV1 as plan } from './chatgptGithubGoalPickerV1.mjs';
const HEAD = 'a'.repeat(40);
const NOW = '2026-10-14T17:30:00.000Z';
const sources = ['canonical', 'seed', 'island', 'chatgpt'];
const owner = () => Object.fromEntries(sources.map(source => [source, {
  disposition:'VERIFIED_UNCLAIMED',mainHead:HEAD,observedAtUtc:NOW,evidenceRef:'trusted-ref/'+source,
}]));
const candidate = (issueNumber, taskId, path) => ({
  issueNumber,taskId,issueTitle:'Goal: '+issueNumber,issueState:'open',sourceHead:HEAD,riskTier:'low',
  taskClass:'docs-only', paths:[path],ownershipEvidence:owner(),
  openPrEvidence:{mainHead:HEAD,observedAtUtc:NOW,evidenceRef:'github/pr-list',claims:[]},
});
const run = (...candidates) => plan({mainHead:HEAD,nowUtc:NOW,candidates});
test('one stuck goal cannot stop unrelated, safely inventoried work', () => {
  const blocked=candidate(2962,'historic-block','docs/history.md');
  blocked.ownershipEvidence.canonical.disposition='CLAIMED';
  const r=run(blocked,candidate(1574,'independent-doc','docs/new-chatgpt-pilot.md'));
  assert.equal(r.decisions[0].disposition,'HELD');
  assert.equal(r.decisions[1].disposition,'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED');
  assert.equal(r.suggestedForIndependentVerification,'independent-doc');
  assert.equal(r.sourceMutationAllowed,false);
});
test('stale/unknown ownership holds only that task', () => {
  const stale=candidate(2002,'stale-claim','docs/a.md');
  stale.ownershipEvidence.seed.observedAtUtc='2026-10-13T17:00:00.000Z';
  const r=run(stale,candidate(1574,'ready-claim','docs/b.md'));
  assert.ok(r.decisions[0].blockers.includes('CROSS_SYSTEM_OWNERSHIP_UNPROVEN'));
  assert.equal(r.decisions[1].disposition,'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED');
});
test('GitHub PR task/path overlap is held, unrelated same-goal slices proceed', () => {
  const c=candidate(1574,'duplicate-proposal','docs/architecture/guide.md');
  c.openPrEvidence.claims=[{issueNumber:42,paths:['docs/architecture']}];
  assert.ok(run(c).decisions[0].blockers.includes('ACTIVE_GITHUB_WORK_COLLISION'));
  const d=candidate(1574,'duplicate-issue','docs/new.md');
  d.openPrEvidence.claims=[{issueNumber:1574,taskId:'other-scope',paths:['docs/unrelated.md']}];
  assert.equal(run(d).decisions[0].disposition,'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED');
  d.openPrEvidence.claims=[{issueNumber:1574,taskId:'duplicate-issue',paths:['docs/unrelated.md']}];
  assert.ok(run(d).decisions[0].blockers.includes('ACTIVE_GITHUB_WORK_COLLISION'));
});
test('duplicate task identities and unsafe source paths are held',()=>{
  const a=candidate(1574,'shared-task','docs/a.md');
  const b=candidate(1903,'shared-task','docs/../b.md');
  const r=run(a,b);
  assert.ok(r.decisions.every(d=>d.blockers.includes('TASK_ID_DUPLICATE_OR_INVALID')));
  assert.ok(r.decisions[1].blockers.includes('SCOPE_INVALID_OR_OVERLAPPING'));
});
test('missing inventories cannot self-authorise and no mutation is ever granted',()=>{
  const c=candidate(1574,'unknown-inventory','docs/a.md');
  c.ownershipEvidence={canonical:{disposition:'VERIFIED_UNCLAIMED'}};
  const r=run(c);
  assert.equal(r.decisions[0].disposition,'HELD');
  assert.equal(r.workerStarted,false);
  assert.equal(r.mergeAllowed,false);
  assert.equal(r.unattendedRefillAllowed,false);
  assert.equal(r.physicalPickupProven,false);
});
test('deterministic work selection not affected by candidate order',()=>{
  const a=candidate(1903,'second-task','docs/second.md');
  const b=candidate(1574,'first-task','docs/first.md');
  assert.equal(run(a,b).suggestedForIndependentVerification,'first-task');
  assert.equal(run(b,a).suggestedForIndependentVerification,'first-task');
});

test('source class may not be disguised to edit executable code', () => {
  const c=candidate(1574,'false-doc-scope','scripts/windows/mutate.ps1');
  assert.ok(run(c).decisions[0].blockers.includes('SCOPE_INVALID_OR_OVERLAPPING'));
});
test('unknown PR scope and invalid planner inputs stay held', () => {
  const c=candidate(1574,'unknown-pr-scope','docs/new.md');
  c.openPrEvidence.claims=[{issueNumber:42,paths:[]}];
  assert.ok(run(c).decisions[0].blockers.includes('GITHUB_PR_INVENTORY_UNPROVEN'));
  assert.equal(plan(null).disposition,'PLANNING_ONLY_NOT_EXECUTION_AUTHORITY');
});
