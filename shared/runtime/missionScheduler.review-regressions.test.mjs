import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionScheduler, answerMissionQuery } from './missionScheduler.mjs';

const NOW = '2026-07-24T21:00:00.000Z';
const fresh = '2026-07-24T20:55:00.000Z';
const PROVEN_HEAD = '1111111111111111111111111111111111111111';
const flywheelOutputs = { resultProofRefs:['proof:result'], reusableCapabilityId:'CAPABILITY_V1', sharedLessonId:'LESSON_V1' };
function goal(issue, overrides = {}) {
  return { issue, title:`Goal ${issue}`, state:'QUEUED', prerequisites:[], priority:1, criticalPathWeight:1, reversibility:'HIGH', route:'CHATGPT_GITHUB', evidenceAt:fresh, ...overrides };
}

test('supplied non-array goals evidence fails closed', () => {
  for (const goals of [{}, 'not-a-portfolio', 42, null]) {
    const result = buildMissionScheduler({ now:NOW, goals });
    assert.equal(result.failClosed, true);
    assert.equal(result.programmeStatus, 'BLOCKED');
    assert.ok(result.contradictions.some(({ code }) => code === 'INVALID_GOALS_CONTAINER'));
    assert.equal(result.decisionReceipt.status, 'BLOCKED_FAIL_CLOSED');
  }
});

test('omitted goals remains a valid empty programme', () => {
  const result = buildMissionScheduler({ now:NOW });
  assert.equal(result.failClosed, false);
  assert.equal(result.programmeStatus, 'WAITING');
});

test('merge-ready work is surfaced in the top-level projection and receipt', () => {
  const result = buildMissionScheduler({ now:NOW, proofHeadShas:[PROVEN_HEAD], goals:[goal(1556,{state:'IMPLEMENTED',proofState:'PASS',activePr:1601,headSha:PROVEN_HEAD})] });
  assert.equal(result.programmeStatus, 'MERGE_READY');
  assert.equal(result.selectedGoal, '#1556');
  assert.equal(result.selectedLifecycle, 'MERGE_READY');
  assert.equal(result.decisionReceipt.status, 'MERGE_READY');
  assert.equal(result.decisionReceipt.selectedIssue, 1556);
});

test('close-ready work is surfaced only after all flywheel outputs exist', () => {
  const incomplete = buildMissionScheduler({ now:NOW, goals:[goal(1556,{state:'COMPLETE'})] });
  assert.equal(incomplete.portfolio[0].lifecycle, 'FLYWHEEL_OUTPUTS_REQUIRED');
  assert.equal(incomplete.selectedGoal, null);
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1556,{state:'COMPLETE',...flywheelOutputs})] });
  assert.equal(result.programmeStatus, 'CLOSE_READY');
  assert.equal(result.selectedGoal, '#1556');
  assert.equal(result.selectedLifecycle, 'CLOSE_READY');
  assert.equal(result.decisionReceipt.status, 'CLOSE_READY');
});

test('unsafe integer issue identities and prerequisites are rejected', () => {
  const oversized = '9007199254740992';
  const result = buildMissionScheduler({ now:NOW, goals:[goal(oversized),goal(2,{prerequisites:['9007199254740993']})] });
  assert.equal(result.portfolio[0].issue, null);
  assert.equal(result.portfolio[0].lifecycle, 'BLOCKED');
  assert.deepEqual(result.portfolio[1].invalidPrerequisites, ['9007199254740993']);
  assert.equal(result.portfolio[1].lifecycle, 'BLOCKED');
  assert.equal(result.selectedGoal, null);
});

test('self-referential duplicate and supersession claims fail closed', () => {
  for (const relation of ['duplicateOf', 'supersededBy']) {
    const result = buildMissionScheduler({ now:NOW, goals:[goal(1556,{[relation]:1556})] });
    assert.equal(result.portfolio[0].lifecycle, 'BLOCKED');
    assert.deepEqual(result.portfolio[0].invalidInvalidationClaims, [relation]);
    assert.equal(result.selectedGoal, null);
  }
});

test('whyNow reports the lexicographic comparator rather than an obsolete weighted score', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[
    goal(1,{operatorPriority:true,priority:1}),
    goal(2,{priority:1_000_000}),
  ] });
  assert.equal(result.selectedGoal, '#1');
  assert.match(result.whyNow, /lexicographic scheduler order/i);
  assert.doesNotMatch(result.whyNow, /highest eligible score/i);
});

test('completed prerequisites remain gated by approval and non-executable routes', () => {
  const gates = [
    { approvalRequired:true },
    { route:'OPERATOR_APPROVAL' },
    { route:'WAITING_FOR_EXTERNAL_CONDITION' },
    { route:'BLOCKED_UNSAFE_OR_UNKNOWN' },
  ];
  for (const gate of gates) {
    const result = buildMissionScheduler({ now:NOW, goals:[
      goal(1,{ state:'COMPLETE', ...flywheelOutputs, ...gate }),
      goal(2,{ prerequisites:[1] }),
    ] });
    assert.equal(result.portfolio[1].lifecycle, 'WAITING_FOR_DEPENDENCY');
    assert.notEqual(result.selectedGoal, '#2');
  }
});

test('malformed approval gate values remain blocking evidence', () => {
  for (const approvalRequired of ['true', 1, null]) {
    const result = buildMissionScheduler({ now:NOW, goals:[
      goal(1,{ state:'COMPLETE', ...flywheelOutputs, approvalRequired }),
      goal(2,{ prerequisites:[1] }),
    ] });
    assert.equal(result.portfolio[0].invalidApprovalRequired, true);
    assert.equal(result.portfolio[0].lifecycle, 'BLOCKED');
    assert.equal(result.portfolio[1].lifecycle, 'WAITING_FOR_DEPENDENCY');
    assert.notEqual(result.selectedGoal, '#2');
  }
});

test('explicitly malformed scheduler clocks fail closed', () => {
  const cases = [
    { now:'not-a-date' },
    { freshnessMs:'not-a-number' },
    { freshnessMs:'900000' },
    { freshnessMs:[900000] },
    { freshnessMs:true },
    { freshnessMs:0 },
    { freshnessMs:-1 },
  ];
  for (const clock of cases) {
    const result = buildMissionScheduler({ ...clock, goals:[goal(1)] });
    assert.equal(result.failClosed, true);
    assert.equal(result.programmeStatus, 'BLOCKED');
    assert.equal(result.selectedGoal, null);
    assert.ok(result.contradictions.some(({ code }) => code === 'INVALID_SCHEDULER_CLOCK'));
    assert.equal(result.decisionReceipt.status, 'BLOCKED_FAIL_CLOSED');
  }
});

test('third repair cycle requires structural review and model-test evidence', () => {
  const blocked = buildMissionScheduler({ now:NOW, goals:[goal(1,{repairCycleCount:3})] });
  assert.equal(blocked.portfolio[0].lifecycle, 'STRUCTURAL_REVIEW_REQUIRED');
  assert.equal(blocked.selectedGoal, null);
  const released = buildMissionScheduler({ now:NOW, goals:[goal(1,{repairCycleCount:3,structuralReviewProofRefs:['review:1'],modelTestProofRefs:['test:model']})] });
  assert.equal(released.portfolio[0].lifecycle, 'READY');
  assert.equal(released.selectedGoal, '#1');
});

test('malformed convergence evidence fails closed for an active claim', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1,{state:'ACTIVE',activePr:1601,repairCycleCount:'3'})] });
  assert.equal(result.failClosed, true);
  assert.ok(result.contradictions.some(({ code }) => code === 'ACTIVE_FLYWHEEL_EVIDENCE_INVALID'));
});

test('chat projection bounds nested arrays and long evidence strings', () => {
  const huge = 'x'.repeat(10_000);
  const prerequisites = Array.from({length:1000}, (_, index) => index + 2);
  const result = answerMissionQuery({ now:NOW, proofRefs:[huge], goals:[goal(1,{prerequisites})] }, 'what is blocked');
  assert.equal(result.blockers[0].prerequisites.length, 20);
  assert.ok(result.proofRefs[0].length < 600);
  assert.ok(JSON.stringify(result).length < 20_000);
});
