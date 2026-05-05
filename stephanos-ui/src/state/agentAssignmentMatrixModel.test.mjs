import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentAssignmentMatrix } from './agentAssignmentMatrixModel.js';

test('assigns codex for build and preserves no-merge authority', () => {
  const result = buildAgentAssignmentMatrix({ missionSpec: { missionId: 'm1', riskLevel: 'low' }, verificationJudge: {} });
  const codex = result.assignments.find((a) => a.roleId === 'codex_builder');
  assert.ok(codex);
  assert.equal(codex.authorityLevel, 'build_via_codex');
  assert.equal(codex.blockedActions.includes('merge_authority'), true);
  assert.equal(result.summary.codexAssigned, true);
});

test('openclaw appears only with delegation and remains research/propose only', () => {
  const none = buildAgentAssignmentMatrix({ missionSpec: { missionId: 'm2' }, openClawDelegation: { status: 'inactive' } });
  assert.equal(none.assignments.some((a) => a.roleId === 'openclaw_delegate'), false);
  const yes = buildAgentAssignmentMatrix({ missionSpec: { missionId: 'm2' }, openClawDelegation: { status: 'preview_only' } });
  const openClaw = yes.assignments.find((a) => a.roleId === 'openclaw_delegate');
  assert.ok(openClaw);
  assert.equal(['research_only', 'propose_only'].includes(openClaw.authorityLevel), true);
});

test('assigns operator and specialist roles based on evidence and capability gaps', () => {
  const result = buildAgentAssignmentMatrix({
    missionSpec: { missionId: 'm3', riskLevel: 'high' },
    verificationJudge: { blockers: ['missing verify'] },
    memoryLibrarianQueue: { pendingCount: 2, counts: { capabilityGaps: 1 } },
    prEvidenceIntake: { prNumber: 42 },
  });
  assert.ok(result.assignments.find((a) => a.roleId === 'operator'));
  assert.ok(result.assignments.find((a) => a.roleId === 'verification_judge'));
  assert.ok(result.assignments.find((a) => a.roleId === 'memory_librarian'));
  assert.ok(result.assignments.find((a) => a.roleId === 'capability_radar'));
  assert.ok(result.assignments.find((a) => a.roleId === 'skill_forge'));
  assert.equal(result.summary.recommendedLeadRole, 'operator');
});
