import test from 'node:test';
import assert from 'node:assert/strict';
import { answerMissionQuery, buildMissionScheduler } from './missionScheduler.mjs';

const NOW = '2026-07-24T21:00:00.000Z';
const fresh = '2026-07-24T20:55:00.000Z';
function goal(issue, overrides = {}) {
  return { issue, title:`Goal ${issue}`, state:'QUEUED', prerequisites:[], priority:1, criticalPathWeight:1, reversibility:'HIGH', route:'CHATGPT_GITHUB', evidenceAt:fresh, ...overrides };
}

test('completed prerequisite unlocks dependant and selects one lane', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state:'COMPLETE'}), goal(2,{prerequisites:[1],priority:5}), goal(3,{priority:2})] });
  assert.equal(result.failClosed,false); assert.equal(result.selectedGoal,'#2'); assert.equal(result.selectedRoute,'CHATGPT_GITHUB'); assert.equal(result.operatorAction,'NO_OPERATOR_ACTION_REQUIRED');
});

test('missing prerequisite blocks readiness and appears in blocker read model', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(2,{prerequisites:[999]})] });
  assert.equal(result.portfolio[0].lifecycle,'BLOCKED'); assert.equal(result.selectedGoal,null); assert.ok(result.blockers.some(({code,issue}) => code === 'GOAL_BLOCKED' && issue === 2));
});

test('dependency cycle fails closed and receipt preserves safety truth', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{prerequisites:[2]}),goal(2,{prerequisites:[1]})] });
  assert.equal(result.failClosed,true); assert.equal(result.selectedGoal,null); assert.equal(result.decisionReceipt.status,'BLOCKED_FAIL_CLOSED'); assert.equal(result.decisionReceipt.route,'BLOCKED_UNSAFE_OR_UNKNOWN'); assert.ok(result.decisionReceipt.contradictionCodes.includes('DEPENDENCY_CYCLE'));
});

test('exactly one fresh identified active lane remains authoritative', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state:'ACTIVE',activePr:1601}),goal(2,{priority:99})] });
  assert.equal(result.activeGoal,'#1'); assert.equal(result.activeLane,'PR #1601'); assert.equal(result.selectedGoal,null); assert.match(result.whyNow,/authoritative/);
});

test('multiple identified active lanes fail closed', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state:'ACTIVE',activePr:1601}),goal(2,{state:'IMPLEMENTING',branch:'feature/two'})] });
  assert.equal(result.failClosed,true); assert.ok(result.contradictions.some(({code}) => code === 'MULTIPLE_ACTIVE_LANES'));
});

test('active state without lane identity fails closed and is not next eligible', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state:'ACTIVE'})] });
  assert.equal(result.failClosed,true); assert.equal(result.activeGoal,null); assert.deepEqual(result.nextEligible,[]); assert.equal(result.portfolio[0].lifecycle,'BLOCKED'); assert.ok(result.contradictions.some(({code}) => code === 'ACTIVE_LANE_IDENTITY_MISSING'));
});

test('active lane without goal identity fails closed', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(null,{state:'ACTIVE',activePr:1601})] });
  assert.equal(result.failClosed,true); assert.equal(result.activeGoal,null); assert.equal(result.decisionReceipt.activeIssue,null); assert.equal(result.portfolio[0].lifecycle,'BLOCKED'); assert.ok(result.contradictions.some(({code}) => code === 'ACTIVE_GOAL_IDENTITY_MISSING'));
});

test('stale active evidence fails closed instead of remaining authoritative', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state:'ACTIVE',activePr:1601,evidenceAt:'2026-07-24T19:00:00.000Z'})] });
  assert.equal(result.failClosed,true); assert.equal(result.activeGoal,null); assert.equal(result.programmeStatus,'BLOCKED'); assert.ok(result.contradictions.some(({code}) => code === 'STALE_ACTIVE_EVIDENCE'));
});

test('operator priority outranks ordinary score', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{priority:100}),goal(2,{operatorPriority:true,priority:1})] });
  assert.equal(result.selectedGoal,'#2');
});

test('duplicate and superseded work is not selected', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{duplicateOf:10,priority:100}),goal(2,{supersededBy:11,priority:100}),goal(3)] });
  assert.equal(result.selectedGoal,'#3'); assert.equal(result.portfolio[0].lifecycle,'DUPLICATE'); assert.equal(result.portfolio[1].lifecycle,'SUPERSEDED');
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

test('chat query returns current lane rationale and lifecycle blockers', () => {
  const answer = answerMissionQuery({ now:NOW, proofRefs:['receipt-1601'], goals:[goal(1,{state:'ACTIVE',activePr:1601}),goal(2,{prerequisites:[999]})] }, 'what is blocked');
  assert.equal(answer.programmeStatus,'IN_PROGRESS'); assert.equal(answer.activeGoal,'#1'); assert.equal(answer.activeLane,'PR #1601'); assert.equal(answer.operatorAction,'NO_OPERATOR_ACTION_REQUIRED'); assert.ok(answer.blockers.some(({issue}) => issue === 2)); assert.deepEqual(answer.proofRefs,['receipt-1601']);
});
