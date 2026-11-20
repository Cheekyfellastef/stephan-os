import test from 'node:test';
import assert from 'node:assert/strict';
import {
  battleBridgeMergeApprovalToken,
  buildConciergePlan,
  buildConciergeProofPacket,
  chooseSafeProofCandidates,
  validateConciergeCommand,
  validateExactHeadMergeApproval,
} from './battleBridgeBuildConciergeV1.mjs';

const head = 'a'.repeat(40);

test('chooses safe proof candidates without inventing unknown proof', () => {
  const candidates = chooseSafeProofCandidates({ pullRequests: [
    { number: 7, title: 'dirty dist', headSha: head, state: 'OPEN', changedFiles: ['apps/stephanos/dist/index.html'], proofCommands: ['npm test'] },
    { number: 8, title: 'source safe', headSha: head, state: 'OPEN', mergeable: true, changedFiles: ['shared/agents/example.mjs'], proofCommands: ['node --test shared/agents/example.test.mjs'] },
  ] });
  assert.equal(candidates[0].prNumber, 8);
  assert.equal(candidates[0].safeToProof, true);
  assert.equal(candidates[1].safeToProof, false);
  assert.match(candidates[1].blockers.join(' '), /generated|forbidden/i);
});

test('blocks arbitrary shell and allows declared bounded proof commands', () => {
  assert.equal(validateConciergeCommand('node --test shared/agents/battleBridgeBuildConciergeV1.test.mjs').allowed, true);
  assert.equal(validateConciergeCommand('rm -rf /').allowed, false);
});

test('plan blocks dirty-tree auto mutation before worktree proof', () => {
  const plan = buildConciergePlan({ repositoryRoot: '/repo', workingTreeClean: false, pullRequests: [{ number: 8, headSha: head, state: 'OPEN', changedFiles: ['shared/a.mjs'], proofCommands: ['npm test'] }] });
  assert.equal(plan.canStartProof, false);
  assert.match(plan.blockers.join(' '), /Dirty-tree/);
  assert.equal(plan.guardrails.pcRestartAllowed, false);
});

test('proof packet requests exact-head approval but never allows merge itself', () => {
  const packet = buildConciergeProofPacket({ candidate: { prNumber: 8, headSha: head, branch: 'feature' }, worktreePath: '/tmp/worktree', generatedArtifactsClean: true, commandResults: [{ command: 'npm test', exitCode: 0, evidencePath: 'proof/battle-bridge/npm-test.txt' }] });
  assert.equal(packet.finalVerdict, 'PROOF_PACKET_READY_FOR_EXACT_HEAD_APPROVAL');
  assert.equal(packet.mergeAllowed, false);
  assert.equal(packet.requiredApprovalToken, battleBridgeMergeApprovalToken({ prNumber: 8, headSha: head }));
});

test('merge approval is bound to PR number and current exact head', () => {
  const token = battleBridgeMergeApprovalToken({ prNumber: 8, headSha: head });
  assert.equal(validateExactHeadMergeApproval({ prNumber: 8, headSha: head, currentHeadSha: head, approvalToken: token }).mergeAllowed, true);
  assert.equal(validateExactHeadMergeApproval({ prNumber: 8, headSha: head, currentHeadSha: 'b'.repeat(40), approvalToken: token }).mergeAllowed, false);
  assert.equal(validateExactHeadMergeApproval({ prNumber: 8, headSha: head, currentHeadSha: head, approvalToken: 'APPROVE' }).mergeAllowed, false);
});
