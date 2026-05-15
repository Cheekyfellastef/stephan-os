import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionRepairCodexBridge } from './missionRepairCodexBridge.js';

const baseLoop = {
  status: 'needs-repair',
  missionId: 'm1',
  title: 'Fix failing proof',
  failingAcceptanceFields: ['UI Reality copy feedback'],
  proofFieldsRequired: ['UI Reality copy feedback', 'Support Snapshot proof'],
  requiredProof: ['node --test stephanos-ui/src/state/responsePlanner.test.mjs'],
  repairBoundary: 'Only AIConsole compact status + state adapters',
  forbiddenActions: ['Do not touch pane layout'],
  mergeRecommendation: 'hold',
  likelySubsystem: 'ui-reality',
};

test('no packet when repair loop passed', () => {
  const bridge = buildMissionRepairCodexBridge({ missionRepairLoop: { ...baseLoop, status: 'passed' } });
  assert.equal(bridge.packetCreated, false);
  assert.equal(bridge.status, 'not-required');
});

for (const status of ['needs-repair', 'needs-proof', 'blocked']) {
  test(`creates packet for ${status}`, () => {
    const bridge = buildMissionRepairCodexBridge({ missionRepairLoop: { ...baseLoop, status } });
    assert.equal(bridge.packetCreated, true);
    assert.equal(bridge.approvalRequired, true);
    assert.equal(bridge.codexDispatchPacketDraft.dispatchState, 'draft-only');
  });
}

test('includes failing fields, forbidden actions, required tests, and snapshot fields', () => {
  const bridge = buildMissionRepairCodexBridge({ missionRepairLoop: baseLoop });
  assert.match(bridge.codexDispatchPacketDraft.codexPrompt, /Failing Acceptance Fields:/);
  assert.ok(bridge.codexDispatchPacketDraft.forbiddenActions.some((item) => item.includes('Do not bypass operator approval')));
  assert.ok(bridge.codexDispatchPacketDraft.requiredTests.length > 0);
  assert.ok(bridge.supportSnapshotFieldsRequired.some((field) => field.includes('Mission Repair Codex Bridge Status')));
});
