import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCanonicalCodexMissionPacket, intakeActiveBuildPacket, trackMissionPrStatus } from './githubCodexMissionDispatch.mjs';

const activePacket = `Scope:\n- active build packet intake\n- generate canonical Codex mission packet\nRequired proofs/tests:\nCODEX_MISSION_PACKET_GENERATED=True\nAcceptance:\nISSUE_WITH_ACTIVE_BUILD_PACKET=ACCEPTED\nMANUAL_DISPATCH_REQUIRED_EXPLICIT=True`;

test('active build packet is accepted and converted to manual Codex handoff without fake run claim', () => {
  const intake = intakeActiveBuildPacket({ issueNumber: 1371, activeBuildPacket: activePacket });
  assert.equal(intake.ISSUE_WITH_ACTIVE_BUILD_PACKET, 'ACCEPTED');
  const packet = generateCanonicalCodexMissionPacket({ intake, codexDispatchToolAvailable: false });
  assert.equal(packet.CODEX_MISSION_PACKET_GENERATED, true);
  assert.equal(packet.MANUAL_DISPATCH_REQUIRED_EXPLICIT, true);
  assert.equal(packet.NO_FAKE_CODEX_RUN_CLAIM, true);
  assert.equal(packet.MERGE_APPROVAL_HELD, true);
});

test('passive vague goal without active packet is rejected', () => {
  const intake = intakeActiveBuildPacket({ issueNumber: 1371, title: 'Improve dispatch', body: 'make it better' });
  assert.equal(intake.ISSUE_WITH_ACTIVE_BUILD_PACKET, 'REJECTED');
  assert.equal(intake.PASSIVE_GOAL_WITHOUT_PACKET, 'REJECTED');
  assert.equal(generateCanonicalCodexMissionPacket({ intake }).CODEX_MISSION_PACKET_GENERATED, false);
});

test('PR discovery tracks status but keeps exact-head merge approval held', () => {
  const status = trackMissionPrStatus({ issueNumber: 1371, pullRequests: [{ number: 44, body: 'Links #1371', state: 'OPEN' }] });
  assert.equal(status.prDiscovered, true);
  assert.equal(status.prStatus, 'open');
  assert.equal(status.exactHeadOperatorMergeApprovalRequired, true);
  assert.equal(status.mergeApprovalHeld, true);
});
