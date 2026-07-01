import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXACT_HEAD_MERGE_HOLD,
  MANUAL_DISPATCH_REQUIRED,
  PLATFORM_STATUS_PROOF_FLOW_SCHEMA_VERSION,
  buildPlatformStatusProofFlow,
} from './platformStatusProofFlow.mjs';

const goals = [
  { issue: '#1291', title: 'Battle Bridge platform status hard-build slice', nextAction: 'Wire supervisor and Codex dispatch truths into active goals.' },
  { issue: '#1371', title: 'Proof flow active-goal dispatch readiness', nextAction: 'Expose manual dispatch and exact-head merge holds.' },
];

const passProbes = ['backend', 'openclaw-gateway', 'stephanos-ui', 'mission-orchestrator-worker', 'shared-agent-workspace']
  .map((serviceId) => ({ serviceId, status: 'PASS', checkedAtUtc: '2026-07-01T00:00:00Z', summary: `${serviceId} pass` }));

test('platform status proof flow projects supervisor, manual dispatch blocker, and exact-head hold for active goals', () => {
  const flow = buildPlatformStatusProofFlow({
    now: '2026-07-01T00:00:00Z',
    supervisorProbes: passProbes,
    codexIntegration: { capabilities: { returnDispatchReceipt: true } },
    goals,
  });

  assert.equal(flow.schemaVersion, PLATFORM_STATUS_PROOF_FLOW_SCHEMA_VERSION);
  assert.equal(flow.supervisor.finalVerdict, 'BATTLE_BRIDGE_SUPERVISOR_PASS');
  assert.equal(flow.finalVerdict, MANUAL_DISPATCH_REQUIRED);
  assert.equal(flow.activeGoals.length, 2);
  for (const goal of flow.activeGoals) {
    assert.equal(goal.supervisorVerdict, 'BATTLE_BRIDGE_SUPERVISOR_PASS');
    assert.equal(goal.codexDispatchReadiness, MANUAL_DISPATCH_REQUIRED);
    assert.equal(goal.missingIntegrationBlocker, 'BLOCKED_BY_MISSING_INTEGRATION');
    assert.deepEqual(goal.missingCapabilities, ['launchCodexJob', 'returnProofMetadata']);
    assert.equal(goal.manualDispatchRequired, true);
    assert.equal(goal.exactHeadMergeHold, true);
    assert.equal(goal.mergeHoldReason, EXACT_HEAD_MERGE_HOLD);
    assert.equal(goal.nextProof, 'manual-codex-dispatch-receipt');
  }
});

test('supported direct Codex dispatch keeps exact-head merge hold visible until approved', () => {
  const flow = buildPlatformStatusProofFlow({
    supervisorProbes: passProbes,
    codexIntegration: {
      capabilities: { launchCodexJob: true, returnDispatchReceipt: true, returnProofMetadata: true },
      dispatch: (record) => ({ receiptId: `receipt-${record.jobId}`, accepted: true }),
    },
    goals: [{ ...goals[0], exactHeadMergeApproved: false }],
  });

  assert.equal(flow.activeGoals[0].codexDispatchReadiness, 'DIRECT_CODEX_DISPATCH_READY');
  assert.equal(flow.activeGoals[0].manualDispatchRequired, false);
  assert.equal(flow.activeGoals[0].missingIntegrationBlocker, '');
  assert.equal(flow.activeGoals[0].dispatchDecision, 'DISPATCHED');
  assert.equal(flow.activeGoals[0].finalVerdict, EXACT_HEAD_MERGE_HOLD);
  assert.equal(flow.activeGoals[0].nextProof, 'exact-head-merge-approval');
});
