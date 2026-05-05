import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionRoutingReadiness } from './missionRoutingReadinessModel.js';

test('missing intent/spec produces draft not_ready', () => {
  const result = buildMissionRoutingReadiness({ missionSpec: {} });
  assert.equal(result.routeStatus, 'draft');
  assert.equal(result.readinessLevel, 'not_ready');
});

test('codex assignment can produce ready_for_codex', () => {
  const result = buildMissionRoutingReadiness({ missionSpec: { missionId: 'm1', rawIntent: 'x' }, agentAssignmentMatrix: { assignments: [{ roleId: 'codex_builder' }], summary: {} }, missionEvidenceLedger: { entries: [] } });
  assert.equal(result.routeStatus, 'ready_for_codex');
});

test('openclaw assignment can produce ready_for_openclaw_research without execution', () => {
  const result = buildMissionRoutingReadiness({ missionSpec: { missionId: 'm1', rawIntent: 'x' }, agentAssignmentMatrix: { summary: { openClawAssigned: true } }, openClawDelegation: { authorityLevel: 'research_and_plan', finishAuthority: 'plan_only' } });
  assert.equal(result.routeStatus, 'ready_for_openclaw_research');
  assert.equal(result.openClawResearchReady, true);
});

test('verification blockers produce verification_repair_needed and blocked action requests produce blocked', () => {
  const repair = buildMissionRoutingReadiness({ missionSpec: { missionId: 'm1', rawIntent: 'x' }, verificationJudge: { blockers: ['tests_failed'] } });
  assert.equal(repair.routeStatus, 'verification_repair_needed');
  const blocked = buildMissionRoutingReadiness({ missionSpec: { missionId: 'm1', rawIntent: 'x', approvalBoundary: { blockedActions: ['shell execution'] } } });
  assert.equal(blocked.routeStatus, 'blocked');
});

test('awaiting evidence/verification/memory/operator/routine/complete candidate routing states', () => {
  assert.equal(buildMissionRoutingReadiness({ missionSpec: { missionId: 'm1', rawIntent: 'x' }, verificationJudge: { judgment: 'proof_pending' }, prEvidenceIntake: { normalizedStatus: 'no_pr_evidence' } }).routeStatus, 'awaiting_pr_evidence');
  assert.equal(buildMissionRoutingReadiness({ missionSpec: { missionId: 'm1', rawIntent: 'x' }, verificationJudge: { judgment: 'proof_pending' }, prEvidenceIntake: { normalizedStatus: 'received' } }).routeStatus, 'awaiting_verification_return');
  assert.equal(buildMissionRoutingReadiness({ missionSpec: { missionId: 'm1', rawIntent: 'x' }, memoryLibrarianQueue: { counts: { approvalRequired: 1 } } }).routeStatus, 'memory_review_needed');
  assert.equal(buildMissionRoutingReadiness({ missionSpec: { missionId: 'm1', rawIntent: 'x' }, operatorDecisionConsole: { summary: { highRiskPendingCount: 1 } } }).routeStatus, 'awaiting_operator_decision');
  assert.equal(buildMissionRoutingReadiness({ missionSpec: { missionId: 'm1', rawIntent: 'x' }, taskFinisherPlan: { safeToContinueRoutineFinish: true } }).routeStatus, 'routine_finish_ready');
  assert.equal(buildMissionRoutingReadiness({ missionSpec: { missionId: 'm1', rawIntent: 'x' }, missionEvidenceLedger: { completeness: 'complete' } }).routeStatus, 'complete_candidate');
});
