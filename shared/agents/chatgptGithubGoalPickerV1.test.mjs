import test from 'node:test';
import assert from 'node:assert/strict';
import { planChatgptGithubGoalCandidatesV1 as plan } from './chatgptGithubGoalPickerV1.mjs';
const HEAD = 'a'.repeat(40);
const NOW = '2026-10-14T17:30:00.000Z';
const sources = ['canonical', 'seed', 'island', 'chatgpt'];
const owner = (issueNumber,taskId,path) => Object.fromEntries(sources.map(source => [source, {
  issueNumber,taskId,paths:[path],
  disposition:'VERIFIED_UNCLAIMED',mainHead:HEAD,observedAtUtc:NOW,evidenceRef:'trusted-ref/'+source,
}]));
const candidate = (issueNumber, taskId, path) => ({
  issueNumber,taskId,issueTitle:'Goal: '+issueNumber,issueState:'open',sourceHead:HEAD,riskTier:'low',
  taskClass:'docs-only', paths:[path],ownershipEvidence:owner(issueNumber,taskId,path),
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

test('borrowed identity- or path-scoped ownership attestations cannot qualify a different task',()=>{
  const c=candidate(1574,'real-task','docs/real.md');
  const v=c.ownershipEvidence.seed;
  v.taskId='other-task';
  assert.ok(run(c).decisions[0].blockers.includes('CROSS_SYSTEM_OWNERSHIP_UNPROVEN'));
  v.taskId='real-task';v.paths=['docs/other.md'];
  assert.ok(run(c).decisions[0].blockers.includes('CROSS_SYSTEM_OWNERSHIP_UNPROVEN'));
  v.paths=['docs/real.md'];v.issueNumber=1903;
  assert.ok(run(c).decisions[0].blockers.includes('CROSS_SYSTEM_OWNERSHIP_UNPROVEN'));
});
test('reserved generated and metadata segments reject case aliases',()=>{
  for(const path of ['docs/Dist/wrong.md','docs/.GiT/config.md','docs/Node_Modules/readme.md']){
    const c=candidate(1574,'case-alias',path);
    assert.ok(run(c).decisions[0].blockers.includes('SCOPE_INVALID_OR_OVERLAPPING'),path);
  }
});

test('competing eligible proposals are serialised deterministically by source scope', () => {
  const first = candidate(1574,'scope-first','docs/shared.md');
  const later = candidate(1903,'scope-later','DOCS/SHARED.md');
  const disjoint = candidate(2961,'disjoint-task','docs/free.md');
  for (const order of [[later,disjoint,first],[first,later,disjoint]]) {
    const r = run(...order);
    const byTask = Object.fromEntries(r.decisions.map(d => [d.taskId,d]));
    assert.equal(r.suggestedForIndependentVerification,'scope-first');
    assert.equal(byTask['scope-first'].disposition,'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED');
    assert.ok(byTask['scope-later'].blockers.includes('BATCH_SCOPE_COLLISION_DEFERRED'));
    assert.equal(byTask['disjoint-task'].disposition,'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED');
    assert.equal(r.sourceMutationAllowed,false);
    assert.equal(r.physicalPickupProven,false);
  }
});

test('ancestor path contention cannot produce two eligible tasks or a global idle switch', () => {
  const ancestor=candidate(1574,'parent-scope','docs/overlap.md');
  const child=candidate(1903,'child-scope','docs/overlap.md/child.md');
  const held=candidate(2962,'historical-lease','docs/stuck.md');
  held.ownershipEvidence.canonical.disposition='CLAIMED';
  const spare=candidate(3103,'spare-source','docs/independent.md');
  const r=run(child,spare,held,ancestor);
  const byTask=Object.fromEntries(r.decisions.map(d=>[d.taskId,d]));
  assert.ok(byTask['child-scope'].blockers.includes('BATCH_SCOPE_COLLISION_DEFERRED'));
  assert.equal(byTask['parent-scope'].disposition,'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED');
  assert.equal(byTask['spare-source'].disposition,'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED');
  assert.equal(byTask['historical-lease'].disposition,'HELD');
});

test('held or unproven proposal cannot starve an independently eligible overlapping proposal', () => {
  const held=candidate(1574,'unproven-proposal','docs/one.md');
  held.ownershipEvidence.island.observedAtUtc='2026-10-12T10:00:00.000Z';
  const ready=candidate(1903,'verified-proposal','docs/one.md');
  const result=run(held,ready);
  assert.ok(result.decisions[0].blockers.includes('CROSS_SYSTEM_OWNERSHIP_UNPROVEN'));
  assert.equal(result.decisions[1].disposition,'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED');
  assert.equal(result.suggestedForIndependentVerification,'verified-proposal');
});
