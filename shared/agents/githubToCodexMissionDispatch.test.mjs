import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_BUILD_PACKET_FIELDS,
  GOAL_DISPATCH_STATES,
  buildGithubToCodexMissionDispatchContract,
  createCodexMissionDispatchPacket,
  parseActiveBuildPacket,
  verifyGoalDispatchAcceptance,
} from './githubToCodexMissionDispatch.mjs';

const ACTIVE_PACKET = `ACTIVE_BUILD_PACKET
TARGET: #1371 GitHub-to-Codex Mission Dispatch V1
SCOPE: Add source/test contract for active build packet intake and manual Codex handoff.
GUARDRAILS: No arbitrary shell. No direct merge. No fake Codex run claims.
REQUIRED_TESTS: node --test shared/agents/githubToCodexMissionDispatch.test.mjs
REQUIRED_PROOFS: ISSUE_WITH_ACTIVE_BUILD_PACKET=ACCEPTED and MANUAL_DISPATCH_REQUIRED_EXPLICIT=True
DELIVERABLE: Source-only dispatch packet generator with acceptance proof.
NO_MERGE_WITHOUT_EXACT_HEAD_OPERATOR_APPROVAL`;

test('dispatch contract exposes command surface, states, packet fields, and safety guardrails', () => {
  const contract = buildGithubToCodexMissionDispatchContract();

  for (const command of ['/goal-dispatch status', '/goal-dispatch prepare <issue>', '/goal-dispatch active', '/goal-dispatch handoff', '/goal-dispatch verify-pr <issue-or-pr>']) {
    assert.equal(contract.commands.includes(command), true);
  }
  for (const field of ACTIVE_BUILD_PACKET_FIELDS) {
    assert.equal(contract.requiredPacketFields.includes(field), true);
  }
  assert.equal(contract.dispatchStates.includes(GOAL_DISPATCH_STATES.MANUAL_DISPATCH_REQUIRED), true);
  assert.equal(contract.dispatchStates.includes(GOAL_DISPATCH_STATES.MERGE_HELD_FOR_OPERATOR_APPROVAL), true);
  assert.equal(contract.guardrails.fakeCodexRunClaimsAllowed, false);
  assert.equal(contract.guardrails.exactHeadMergeApprovalRequired, true);
  assert.equal(contract.finalVerdict, 'GITHUB_TO_CODEX_MISSION_DISPATCH_CONTRACT_READY');
});

test('active build packet intake accepts complete packet and rejects passive goal text', () => {
  const accepted = parseActiveBuildPacket({ issueNumber: '#1371', body: ACTIVE_PACKET });
  const rejected = parseActiveBuildPacket({ issueNumber: '#1371', body: 'Please build the active goal when you can.' });

  assert.equal(accepted.accepted, true);
  assert.equal(accepted.fields.TARGET.includes('#1371'), true);
  assert.deepEqual(accepted.missingFields, []);
  assert.equal(accepted.finalVerdict, 'ACTIVE_BUILD_PACKET_ACCEPTED');
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.missingFields.includes('ACTIVE_BUILD_PACKET'), true);
  assert.equal(rejected.finalVerdict, 'ACTIVE_BUILD_PACKET_REJECTED');
});

test('manual dispatch packet is explicit when no proven direct Codex dispatch tool exists', () => {
  const dispatch = createCodexMissionDispatchPacket({ issueNumber: '#1371', body: ACTIVE_PACKET });

  assert.equal(dispatch.dispatchState, GOAL_DISPATCH_STATES.MANUAL_DISPATCH_REQUIRED);
  assert.equal(dispatch.codexMissionPacketGenerated, true);
  assert.equal(dispatch.manualDispatchRequired, true);
  assert.equal(dispatch.fakeCodexRunClaim, false);
  assert.equal(dispatch.blocker.includes('Direct Codex dispatch tool is not available'), true);
  assert.equal(dispatch.codexMissionPacket.includes('NO_MERGE_WITHOUT_EXACT_HEAD_OPERATOR_APPROVAL'), true);
  assert.equal(dispatch.finalVerdict, 'CODEX_MISSION_PACKET_READY');
});

test('draft PR status remains merge-held until exact-head operator approval is present', () => {
  const dispatch = createCodexMissionDispatchPacket({
    issueNumber: '#1371',
    body: ACTIVE_PACKET,
    draftPr: '#1400',
    mergeApprovedExactHead: false,
  });

  assert.equal(dispatch.dispatchState, GOAL_DISPATCH_STATES.MERGE_HELD_FOR_OPERATOR_APPROVAL);
  assert.equal(dispatch.mergeApprovalHeld, true);
});

test('acceptance proof records V1/V4 criteria without live Codex claims', () => {
  const proof = verifyGoalDispatchAcceptance({ issueNumber: '#1371', body: ACTIVE_PACKET });

  assert.equal(proof.ISSUE_WITH_ACTIVE_BUILD_PACKET, 'ACCEPTED');
  assert.equal(proof.CODEX_MISSION_PACKET_GENERATED, true);
  assert.equal(proof.MANUAL_DISPATCH_REQUIRED_EXPLICIT, true);
  assert.equal(proof.NO_FAKE_CODEX_RUN_CLAIM, true);
  assert.equal(proof.MERGE_APPROVAL_HELD, true);
  assert.equal(proof.finalVerdict, 'GITHUB_TO_CODEX_MISSION_DISPATCH_V1_PASS');
});
