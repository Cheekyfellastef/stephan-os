import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskFinisherPlan } from './taskFinisherModel.js';

test('no routine finish authority yields recommendations only and blocked tasks', () => {
  const plan = buildTaskFinisherPlan({ finishAuthority: { routineFinishAllowed: false } });
  assert.equal(plan.finishPlanLevel, 'recommendations_only');
  assert.equal(plan.blockedTasks.includes('shell_execute_from_ui'), true);
  assert.equal(plan.blockedTasks.includes('github_merge'), true);
  assert.equal(plan.mergeStillOperatorControlled, true);
});

test('verification failure and dist risk produce codex fix + rebuild + verify + tests', () => {
  const plan = buildTaskFinisherPlan({
    verificationJudge: { judgment: 'needs_fix', blockers: ['failed check'], requiredTestsRun: false },
    repoArchitectureContext: { generatedOutputsLikelyTouched: ['apps/stephanos/dist'], sourceTruthWarnings: ['dist generated output'] },
  });
  assert.equal(plan.routineTasks.includes('request_codex_narrow_fix'), true);
  assert.equal(plan.routineTasks.includes('rebuild_generated_dist'), true);
  assert.equal(plan.routineTasks.includes('rerun_stephanos_verify'), true);
  assert.equal(plan.routineTasks.includes('rerun_targeted_tests'), true);
});

test('memory librarian approvals and openclaw boundary are operator-gated', () => {
  const plan = buildTaskFinisherPlan({
    verificationJudge: { judgment: 'blocked', openClawBoundarySatisfied: false, warnings: ['OpenClaw executed mutation'] },
    memoryLibrarianQueue: { counts: { approvalRequired: 2 } },
    finishAuthority: { routineFinishAllowed: true, mergeAuthorityIncluded: true },
  });
  assert.equal(plan.memoryReviewNeeded, true);
  assert.equal(plan.openClawBoundaryReviewNeeded, true);
  assert.equal(plan.safeToContinueRoutineFinish, false);
  assert.equal(plan.mergeStillOperatorControlled, true);
});
