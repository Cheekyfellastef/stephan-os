import test from 'node:test';
import assert from 'node:assert/strict';
import { answerMissionQuery, buildMissionScheduler } from './missionScheduler.mjs';

const NOW = '2026-07-24T21:00:00.000Z';
const fresh = '2026-07-24T20:55:00.000Z';
const PROOF_SHA = '1111111111111111111111111111111111111111';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const BRANCH = 'feat/mission-scheduler-proof-binding';
function goal(issue, overrides = {}) {
  return { issue, title:`Goal ${issue}`, state:'QUEUED', prerequisites:[], priority:1, criticalPathWeight:1, reversibility:'HIGH', route:'CHATGPT_GITHUB', evidenceAt:fresh, ...overrides };
}
function binding(issue, activePr, headSha = PROOF_SHA, overrides = {}) { return { issue, activePr, headSha, repository:REPOSITORY, branch:BRANCH, ...overrides }; }

test('completed prerequisite unlocks dependant and selects one lane', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state:'COMPLETE',resultProofRefs:['proof://goal-1-result'],reusableCapabilityId:'CAPABILITY_GOAL_1',sharedLessonId:'LESSON_GOAL_1'}), goal(2,{prerequisites:[1],priority:5}), goal(3,{priority:2})] });
  assert.equal(result.failClosed,false); assert.equal(result.selectedGoal,'#2'); assert.equal(result.selectedRoute,'CHATGPT_GITHUB'); assert.equal(result.operatorAction,'NO_OPERATOR_ACTION_REQUIRED');
});

test('missing prerequisite blocks readiness and appears in blocker read model', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(2,{prerequisites:[999]})] });
  assert.equal(result.portfolio[0].lifecycle,'BLOCKED'); assert.equal(result.selectedGoal,null); assert.ok(result.blockers.some(({code,issue}) => code === 'GOAL_BLOCKED' && issue === 2));
});

test('malformed prerequisite fails closed at the goal boundary', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(2,{prerequisites:['unknown',0]})] });
  assert.equal(result.portfolio[0].lifecycle,'BLOCKED'); assert.equal(result.selectedGoal,null); assert.deepEqual(result.portfolio[0].invalidPrerequisites,['index:0','index:1']);
});

test('malformed prerequisite container is preserved as blocked evidence', () => {
  for (const prerequisites of ['999', { issue:999 }]) {
    const result = buildMissionScheduler({ now:NOW, goals:[goal(2,{prerequisites})] });
    assert.equal(result.portfolio[0].invalidPrerequisiteContainer,true); assert.equal(result.portfolio[0].lifecycle,'BLOCKED'); assert.equal(result.selectedGoal,null);
  }
});

test('dependency cycle fails closed and receipt preserves safety truth', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{prerequisites:[2]}),goal(2,{prerequisites:[1]})] });
  assert.equal(result.failClosed,true); assert.equal(result.selectedGoal,null); assert.equal(result.decisionReceipt.status,'BLOCKED_FAIL_CLOSED'); assert.equal(result.decisionReceipt.route,'BLOCKED_UNSAFE_OR_UNKNOWN'); assert.ok(result.decisionReceipt.contradictionCodes.includes('DEPENDENCY_CYCLE'));
});

test('duplicate goal identities fail closed', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1),goal(1,{state:'ACTIVE',activePr:1601})] });
  assert.equal(result.failClosed,true); assert.equal(result.activeGoal,null); assert.deepEqual(result.nextEligible,[]); assert.ok(result.contradictions.some(({code,issue}) => code === 'DUPLICATE_GOAL_IDENTITY' && issue === 1));
});

test('exactly one fresh identified active lane remains authoritative', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state:'ACTIVE',activePr:1601}),goal(2,{priority:99})] });
  assert.equal(result.activeGoal,'#1'); assert.equal(result.activeLane,'PR #1601'); assert.equal(result.selectedGoal,null); assert.match(result.whyNow,/authoritative/);
});

test('multiple active lanes without resource scopes fail closed', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state:'ACTIVE',activePr:1601}),goal(2,{state:'IMPLEMENTING',branch:'feature/two'})] });
  assert.equal(result.failClosed,true); assert.ok(result.contradictions.some(({code}) => code === 'ACTIVE_RESOURCE_SCOPE_MISSING'));
});

test('malformed authority-bearing resource evidence rejects even one active claim', () => {
  const sparseResourceIds = [];
  sparseResourceIds[1] = 'goal:1';
  for (const resourceIds of ['goal:1', [42], ['../bad'], sparseResourceIds]) {
    const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state:'ACTIVE',activePr:1601,resourceIds})] });
    assert.equal(result.failClosed,true);
    assert.deepEqual(result.activeGoals,[]);
    assert.equal(result.portfolio[0].lifecycle,'BLOCKED');
    assert.ok(result.contradictions.some(({code}) => code === 'ACTIVE_RESOURCE_EVIDENCE_INVALID'));
  }
});

test('five resource-disjoint active lanes remain authoritative together', () => {
  const goals = Array.from({ length:5 }, (_, index) => goal(index + 1, {
    state:index % 2 ? 'IMPLEMENTING' : 'ACTIVE',
    branch:`feature/lane-${index + 1}`,
    resourceIds:[`goal:${index + 1}`],
  }));
  const result = buildMissionScheduler({ now:NOW, goals });
  assert.equal(result.failClosed,false);
  assert.deepEqual(result.activeGoals,['#1','#2','#3','#4','#5']);
  assert.equal(result.programmeStatus,'IN_PROGRESS');
  assert.equal(result.elasticCapacity.desiredWidth,5);
  assert.deepEqual(result.parallelCandidates,[]);
  assert.deepEqual(result.decisionReceipt.activeIssues,[1,2,3,4,5]);
});

test('resource conflict and active width overflow fail closed', () => {
  const conflicting = buildMissionScheduler({ now:NOW, goals:[
    goal(1,{state:'ACTIVE',branch:'feature/one',resourceIds:['repo:main']}),
    goal(2,{state:'ACTIVE',branch:'feature/two',resourceIds:['repo:main']}),
  ] });
  assert.equal(conflicting.failClosed,true);
  assert.ok(conflicting.contradictions.some(({code}) => code === 'ACTIVE_RESOURCE_CONFLICT'));

  const overWidth = buildMissionScheduler({
    now:NOW,
    maximumActiveLanes:5,
    goals:Array.from({ length:6 }, (_, index) => goal(index + 1, {
      state:'ACTIVE', branch:`feature/over-${index + 1}`, resourceIds:[`goal:${index + 1}`],
    })),
  });
  assert.equal(overWidth.failClosed,true);
  assert.ok(overWidth.contradictions.some(({code}) => code === 'ACTIVE_LANE_CAPACITY_EXCEEDED'));
});

test('active resource authority uses the canonical hierarchical overlap model', () => {
  const active = (issue, resourceIds) => goal(issue, {
    state:'ACTIVE',
    branch:`agent/active-${issue}`,
    route:'CHATGPT_GITHUB',
    resourceIds,
  });
  const hierarchical = buildMissionScheduler({
    now:NOW,
    goals:[
      active(1, ['repo:cheekyfellastef/stephan-os:path:shared/agents']),
      active(2, ['repo:cheekyfellastef/stephan-os:path:shared/agents/example.mjs']),
    ],
  });
  assert.equal(hierarchical.failClosed, true);
  assert.ok(hierarchical.contradictions.some(({ code }) => code === 'ACTIVE_RESOURCE_CONFLICT'));

  const aliased = buildMissionScheduler({
    now:NOW,
    goals:[active(1, ['repo:cheekyfellastef/stephan-os:path:shared/./agents'])],
  });
  assert.equal(aliased.failClosed, true);
  assert.ok(aliased.contradictions.some(({ code, reason }) => (
    code === 'ACTIVE_RESOURCE_EVIDENCE_INVALID' && reason === 'resource-ids-non-canonical'
  )));

  const win32Aliased = buildMissionScheduler({
    now:NOW,
    goals:[active(1, ['repo:cheekyfellastef/stephan-os:path:shared/agents/example.mjs.'])],
  });
  assert.equal(win32Aliased.failClosed, true);
  assert.ok(win32Aliased.contradictions.some(({ code, reason }) => (
    code === 'ACTIVE_RESOURCE_EVIDENCE_INVALID' && reason === 'resource-ids-non-canonical'
  )));
});

test('scheduler exposes five resource-disjoint ready candidates without granting mutation authority', () => {
  const goals = Array.from({ length:7 }, (_, index) => goal(index + 1, {
    priority:100 - index,
    resourceIds:[index === 5 ? 'goal:1' : `goal:${index + 1}`],
  }));
  const result = buildMissionScheduler({ now:NOW, goals, availableExecutorSlots:8, maximumActiveLanes:5 });
  assert.equal(result.failClosed,false);
  assert.deepEqual(result.parallelCandidates,['#1','#2','#3','#4','#5']);
  assert.equal(result.parallelHeld.find(({candidateId}) => candidateId === '#6').reasonCode,'RESOURCE_CONFLICT');
  assert.equal(result.parallelHeld.find(({candidateId}) => candidateId === '#7').reasonCode,'PARALLEL_CAPACITY_FULL');
  assert.equal(result.readOnly,true);
  assert.equal(result.elasticCapacity.remainingAdmissionSlots,5);
});

test('scheduler holds new ready admissions when executor capacity is degraded', () => {
  const goals = Array.from({ length:3 }, (_, index) => goal(index + 1, { resourceIds:[`goal:${index + 1}`] }));
  const result = buildMissionScheduler({ now:NOW, goals, availableExecutorSlots:3 });
  assert.equal(result.failClosed,false);
  assert.equal(result.elasticCapacity.status,'DEGRADED_CAPACITY');
  assert.equal(result.selectedGoal,null);
  assert.deepEqual(result.parallelCandidates,[]);
  assert.ok(result.parallelHeld.every(({ reasonCode }) => reasonCode === 'CAPACITY_SAFE_HOLD'));
  assert.match(result.whyNow,/held.*capacity/i);
});

test('invalid parallel capacity policy fails closed', () => {
  const result = buildMissionScheduler({ now:NOW, minimumActiveLanes:4, goals:[goal(1,{resourceIds:['goal:1']})] });
  assert.equal(result.failClosed,true);
  assert.ok(result.contradictions.some(({code}) => code === 'INVALID_PARALLEL_CAPACITY_POLICY'));
});

test('active state without lane identity fails closed and is not next eligible', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state:'ACTIVE'})] });
  assert.equal(result.failClosed,true); assert.equal(result.activeGoal,null); assert.deepEqual(result.nextEligible,[]); assert.equal(result.portfolio[0].lifecycle,'BLOCKED'); assert.ok(result.contradictions.some(({code}) => code === 'ACTIVE_LANE_IDENTITY_MISSING'));
});

test('active lane without goal identity fails closed', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(null,{state:'ACTIVE',activePr:1601})] });
  assert.equal(result.failClosed,true); assert.equal(result.activeGoal,null); assert.equal(result.decisionReceipt.activeIssue,null); assert.equal(result.portfolio[0].lifecycle,'BLOCKED'); assert.ok(result.contradictions.some(({code}) => code === 'INVALID_GOAL_IDENTITY'));
});

test('stale active evidence fails closed instead of remaining authoritative', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state:'ACTIVE',activePr:1601,evidenceAt:'2026-07-24T19:00:00.000Z'})] });
  assert.equal(result.failClosed,true); assert.equal(result.activeGoal,null); assert.equal(result.programmeStatus,'BLOCKED'); assert.ok(result.contradictions.some(({code}) => code === 'STALE_ACTIVE_EVIDENCE'));
});

test('unsafe active route fails closed', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state:'ACTIVE',activePr:1601,route:'BLOCKED_UNSAFE_OR_UNKNOWN'})] });
  assert.equal(result.failClosed,true); assert.equal(result.activeGoal,null); assert.equal(result.portfolio[0].lifecycle,'BLOCKED'); assert.ok(result.contradictions.some(({code}) => code === 'ACTIVE_ROUTE_NOT_EXECUTABLE'));
});

test('active approval route requires operator action', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state:'ACTIVE',activePr:1601,route:'OPERATOR_APPROVAL'})] });
  assert.equal(result.activeGoal,'#1'); assert.equal(result.operatorNeeded,true); assert.equal(result.operatorAction,'OPERATOR_APPROVAL_REQUIRED');
});

test('invalidated active goal fails closed', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state:'ACTIVE',activePr:1601,supersededBy:9})] });
  assert.equal(result.failClosed,true); assert.equal(result.activeGoal,null); assert.equal(result.portfolio[0].lifecycle,'SUPERSEDED'); assert.ok(result.contradictions.some(({code}) => code === 'ACTIVE_GOAL_INVALIDATED'));
});

test('active claim with malformed dependencies fails closed', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state:'ACTIVE',activePr:1601,prerequisites:['unknown']})] });
  assert.equal(result.failClosed,true); assert.equal(result.activeGoal,null); assert.equal(result.portfolio[0].lifecycle,'BLOCKED'); assert.ok(result.contradictions.some(({code}) => code === 'ACTIVE_RELATION_EVIDENCE_INVALID'));
});

test('unknown and blocked states are never selected', () => {
  for (const state of ['UNKNOWN','BLOCKED','STALLED']) {
    const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state})] });
    assert.equal(result.portfolio[0].lifecycle,'BLOCKED'); assert.equal(result.selectedGoal,null);
  }
});

test('operator priority lexicographically outranks unbounded ordinary score', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{priority:1000000}),goal(2,{operatorPriority:true,priority:1})] });
  assert.equal(result.selectedGoal,'#2');
});

test('large finite priorities compare without weighted-score overflow', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{priority:1e307}),goal(2,{priority:1e308})] });
  assert.equal(result.selectedGoal,'#2');
});

test('duplicate and superseded work is not selected', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{duplicateOf:10,priority:100}),goal(2,{supersededBy:11,priority:100}),goal(3)] });
  assert.equal(result.selectedGoal,'#3'); assert.equal(result.portfolio[0].lifecycle,'DUPLICATE'); assert.equal(result.portfolio[1].lifecycle,'SUPERSEDED');
});

test('malformed invalidation claims are preserved and blocked', () => {
  for (const relation of [{duplicateOf:'unknown'},{supersededBy:0}]) {
    const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{priority:100,...relation}),goal(2)] });
    assert.equal(result.portfolio[0].lifecycle,'BLOCKED'); assert.equal(result.selectedGoal,'#2'); assert.equal(result.portfolio[0].invalidInvalidationClaims.length,1);
  }
});

test('superseded prerequisite does not satisfy dependency', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state:'SUPERSEDED',supersededBy:9}),goal(2,{prerequisites:[1]})] });
  assert.equal(result.portfolio.find(({issue}) => issue === 2).lifecycle,'WAITING_FOR_DEPENDENCY'); assert.equal(result.selectedGoal,null);
});

test('invalidated completed prerequisite does not satisfy dependency', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state:'COMPLETE',supersededBy:9}),goal(2,{prerequisites:[1]})] });
  assert.equal(result.portfolio.find(({issue}) => issue === 1).lifecycle,'SUPERSEDED'); assert.equal(result.portfolio.find(({issue}) => issue === 2).lifecycle,'WAITING_FOR_DEPENDENCY'); assert.equal(result.selectedGoal,null);
});

test('invalidated closed prerequisite does not satisfy dependency', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state:'CLOSED',duplicateOf:9}),goal(2,{prerequisites:[1]})] });
  assert.equal(result.portfolio.find(({issue}) => issue === 1).lifecycle,'DUPLICATE'); assert.equal(result.portfolio.find(({issue}) => issue === 2).lifecycle,'WAITING_FOR_DEPENDENCY'); assert.equal(result.selectedGoal,null);
});

test('stale completed prerequisite does not satisfy dependency', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state:'COMPLETE',evidenceAt:'2026-07-24T19:00:00.000Z'}),goal(2,{prerequisites:[1]})] });
  assert.equal(result.portfolio.find(({issue}) => issue === 1).lifecycle,'STALLED'); assert.equal(result.portfolio.find(({issue}) => issue === 2).lifecycle,'WAITING_FOR_DEPENDENCY'); assert.equal(result.selectedGoal,null);
});

test('completed prerequisite with unmet dependency cannot unlock downstream work', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state:'QUEUED'}),goal(2,{state:'COMPLETE',prerequisites:[1]}),goal(3,{prerequisites:[2]})] });
  assert.equal(result.portfolio.find(({issue}) => issue === 2).lifecycle,'WAITING_FOR_DEPENDENCY');
  assert.equal(result.portfolio.find(({issue}) => issue === 3).lifecycle,'WAITING_FOR_DEPENDENCY');
  assert.notEqual(result.selectedGoal,'#3');
});

test('active claim with unmet dependency fails closed', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state:'QUEUED'}),goal(2,{state:'ACTIVE',activePr:1601,prerequisites:[1]})] });
  assert.equal(result.failClosed,true); assert.equal(result.activeGoal,null); assert.ok(result.contradictions.some(({code}) => code === 'ACTIVE_DEPENDENCY_UNSATISFIED'));
});

test('dependency blocker takes precedence over approval request', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(2,{approvalRequired:true,prerequisites:[999]})] });
  assert.equal(result.portfolio[0].lifecycle,'BLOCKED'); assert.equal(result.operatorNeeded,false); assert.equal(result.operatorAction,'NO_OPERATOR_ACTION_REQUIRED');
});

test('merge readiness is restricted to implemented goals', () => {
  for (const state of ['UNKNOWN','BLOCKED','STALLED','QUEUED']) {
    const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state,proofState:'PASS',activePr:1601})] });
    assert.notEqual(result.portfolio[0].lifecycle,'MERGE_READY');
  }
  const implemented = buildMissionScheduler({ now:NOW, proofReceipts:[binding(2,1601)], goals:[goal(2,{state:'IMPLEMENTED',proofState:'PASS',activePr:1601,repository:REPOSITORY,branch:BRANCH,headSha:PROOF_SHA,operatorApprovalReceipt:binding(2,1601)})] });
  assert.equal(implemented.portfolio[0].lifecycle,'MERGE_READY');

  for (const mismatchedApproval of [
    binding(2,1601,PROOF_SHA, { repository:'other/repository' }),
    binding(2,1601,PROOF_SHA, { branch:'feat/other-lane' }),
  ]) {
    const held = buildMissionScheduler({
      now:NOW,
      proofReceipts:[binding(2,1601)],
      goals:[goal(2,{state:'IMPLEMENTED',proofState:'PASS',activePr:1601,repository:REPOSITORY,branch:BRANCH,headSha:PROOF_SHA,operatorApprovalReceipt:mismatchedApproval})],
    });
    assert.equal(held.portfolio[0].lifecycle,'APPROVAL_REQUIRED');
  }

  for (const mismatchedProof of [
    binding(2,1601,PROOF_SHA, { repository:'other/repository' }),
  ]) {
    const held = buildMissionScheduler({
      now:NOW,
      proofReceipts:[mismatchedProof],
      goals:[goal(2,{state:'IMPLEMENTED',proofState:'PASS',activePr:1601,repository:REPOSITORY,branch:BRANCH,headSha:PROOF_SHA,operatorApprovalReceipt:binding(2,1601)})],
    });
    assert.equal(held.portfolio[0].lifecycle,'IMPLEMENTED_NEEDS_PROOF');
  }
});

test('merge readiness respects blocked and waiting routes', () => {
  for (const route of ['BLOCKED_UNSAFE_OR_UNKNOWN','WAITING_FOR_EXTERNAL_CONDITION','unknown-route']) {
    const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state:'IMPLEMENTED',proofState:'PASS',activePr:1601,route})] });
    assert.notEqual(result.portfolio[0].lifecycle,'MERGE_READY'); assert.equal(result.selectedGoal,null);
  }
});

test('null portfolio entries normalize to blocked records without throwing', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[null] });
  assert.equal(result.portfolio[0].lifecycle,'BLOCKED'); assert.equal(result.selectedGoal,null);
});

test('stale queued evidence is stalled and not selected', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{evidenceAt:'2026-07-24T19:00:00.000Z'})] });
  assert.equal(result.portfolio[0].evidenceFreshness,'STALE'); assert.equal(result.portfolio[0].lifecycle,'STALLED'); assert.equal(result.selectedGoal,null);
});

test('runtime-required work routes away from GitHub-only execution', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{route:'BATTLE_BRIDGE_FIXED_TEST'})] }); assert.equal(result.selectedRoute,'BATTLE_BRIDGE_FIXED_TEST');
});

test('waiting route is not eligible', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{route:'WAITING_FOR_EXTERNAL_CONDITION'})] });
  assert.equal(result.portfolio[0].lifecycle,'WAITING_FOR_EXTERNAL_CONDITION'); assert.equal(result.selectedGoal,null); assert.equal(result.programmeStatus,'WAITING');
});

test('approval requirement asks operator even when goal is not selected', () => {
  const approval = buildMissionScheduler({ now:NOW, goals:[goal(1,{approvalRequired:true})] });
  assert.equal(approval.portfolio[0].lifecycle,'APPROVAL_REQUIRED'); assert.equal(approval.operatorNeeded,true); assert.equal(approval.operatorAction,'OPERATOR_APPROVAL_REQUIRED'); assert.equal(approval.programmeStatus,'APPROVAL_REQUIRED');
  const ordinary = buildMissionScheduler({ now:NOW, goals:[goal(2)] }); assert.equal(ordinary.operatorAction,'NO_OPERATOR_ACTION_REQUIRED');
});

test('freeze is idempotent across nested pre-frozen values', () => {
  const result = buildMissionScheduler({ now:NOW, proofRefs:Object.freeze(['receipt-1601']), goals:[] });
  assert.equal(result.failClosed,false); assert.deepEqual(result.decisionReceipt.proofRefs,['receipt-1601']); assert.ok(Object.isFrozen(result));
});

test('empty portfolio reports no evidence', () => {
  const answer = answerMissionQuery({ now:NOW, goals:[] }, 'what is going on');
  assert.equal(answer.evidenceFreshness,'NO_EVIDENCE');
});

test('chat query returns current lane rationale and lifecycle blockers', () => {
  const answer = answerMissionQuery({ now:NOW, proofRefs:['receipt-1601'], goals:[goal(1,{state:'ACTIVE',activePr:1601}),goal(2,{prerequisites:[999]})] }, 'what is blocked');
  assert.equal(answer.programmeStatus,'IN_PROGRESS'); assert.equal(answer.activeGoal,'#1'); assert.equal(answer.activeLane,'PR #1601'); assert.equal(answer.operatorAction,'NO_OPERATOR_ACTION_REQUIRED'); assert.ok(answer.blockers.some(({issue}) => issue === 2)); assert.deepEqual(answer.proofRefs,['receipt-1601']);
});
