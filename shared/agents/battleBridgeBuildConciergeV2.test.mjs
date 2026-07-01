import test from 'node:test';
import assert from 'node:assert/strict';
import {
  battleBridgeMergeApprovalToken,
  buildConciergePlan,
  buildConciergeProofPacket,
  buildConciergeRoadmap,
  validateExactHeadMergeApproval,
} from './battleBridgeBuildConciergeV2.mjs';

const head = 'c'.repeat(40);

test('PR candidate plan includes PR/head/proof commands/next action', () => {
  const plan = buildConciergePlan({ repositoryRoot: '/repo', workingTreeClean: true, pullRequests: [{ number: 1391, title: 'V2 operator surfaces', headSha: head, state: 'OPEN', mergeable: true, changedFiles: ['shared/agents/a.mjs'], proofCommands: ['npm test'] }] });
  assert.equal(plan.selectedCandidate.prNumber, 1391);
  assert.equal(plan.selectedCandidate.headSha, head);
  assert.deepEqual(plan.selectedCandidate.proofCommands, ['npm test']);
  assert.match(plan.nextOperatorAction, /PR #1391/);
  assert.equal(plan.proofReadiness, 'ready');
});

test('proof packet includes exact-head token', () => {
  const packet = buildConciergeProofPacket({ candidate: { prNumber: 1391, headSha: head }, generatedArtifactsClean: true, commandResults: [{ command: 'npm test', exitCode: 0 }] });
  const token = battleBridgeMergeApprovalToken({ prNumber: 1391, headSha: head });
  assert.equal(packet.requiredApprovalToken, token);
  assert.equal(packet.exactHeadApproval.token, token);
  assert.equal(packet.proofPacketSummary.status, 'PROOF_PACKET_READY_FOR_EXACT_HEAD_APPROVAL');
});

test('validate-merge accepts only matching PR/head/token', () => {
  const token = battleBridgeMergeApprovalToken({ prNumber: 1391, headSha: head });
  assert.equal(validateExactHeadMergeApproval({ prNumber: 1391, headSha: head, currentHeadSha: head, approvalToken: token }).mergeAllowed, true);
  assert.equal(validateExactHeadMergeApproval({ prNumber: 1392, headSha: head, currentHeadSha: head, approvalToken: token }).mergeAllowed, false);
  assert.equal(validateExactHeadMergeApproval({ prNumber: 1391, headSha: head, currentHeadSha: 'd'.repeat(40), approvalToken: token }).mergeAllowed, false);
});

test('dirty tree blocks proof/merge readiness', () => {
  const plan = buildConciergePlan({ repositoryRoot: '/repo', workingTreeClean: false, pullRequests: [{ number: 1391, headSha: head, state: 'OPEN', changedFiles: ['shared/a.mjs'], proofCommands: ['npm test'] }] });
  assert.equal(plan.canStartProof, false);
  assert.equal(plan.dirtyTreeStatus, 'dirty');
  assert.match(plan.mergeHoldState, /HELD/);
  assert.match(plan.blockers.join(' '), /Dirty-tree/);
});


test('roadmap preserves intent-engine approval-only mission and success markers', () => {
  const roadmap = buildConciergeRoadmap();
  assert.match(roadmap.mission, /intent engine and approval authority/);
  assert.equal(roadmap.phases.find((phase) => phase.version === 'V2').status, 'implemented');
  assert.equal(roadmap.activePhase.version, 'V3');
  assert.equal(roadmap.guardrails.unsafeCommandExecutionAllowed, false);
  assert.equal(roadmap.guardrails.visibleReceiptsOrExplicitBlockersRequired, true);
  assert.ok(roadmap.successMarkers.includes('GOAL_COMPLETE_BATTLE_BRIDGE_BUILD_CONCIERGE_ROADMAP'));
  assert.ok(roadmap.successMarkers.includes('NO_CLICK_MONKEY_LOOP'));
  assert.ok(roadmap.successMarkers.includes('INTENT_ENGINE_APPROVAL_ONLY'));
});
