import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRemoteCodexBattleBridgeHandoff,
  createRemoteCodexOperatorApprovalReceipt,
} from './remoteCodexBattleBridgeHandoffV1.mjs';
import {
  REMOTE_CODEX_RECOVERY_ROUTE,
  REMOTE_CODEX_RECOVERY_TASK_CLASS,
  planRemoteCodexBattleBridgeRecoveryAccelerationV1,
} from './remoteCodexBattleBridgeRecoveryAcceleratorV1.mjs';

const HEAD = 'a'.repeat(40);
const NOW = '2026-08-16T16:22:00.000Z';
const CREATED = '2026-08-16T16:21:00.000Z';
const APPROVED = '2026-08-16T16:20:00.000Z';
const EXPIRES = '2026-08-16T17:00:00.000Z';
const TASK = 'Diagnose the canonical Battle Bridge recovery state and return exact-head Windows proof only.';
const PROOF_COMMANDS = ['node --test shared/agents/remoteCodexBattleBridgeHandoffV1.test.mjs'];
const EXACT_HEAD_PROOF = {
  repository: 'Cheekyfellastef/stephan-os',
  prNumber: 1813,
  expectedHead: HEAD,
  proofTarget: 'PULL_REQUEST_HEAD',
  pullRequestHead: '',
  mergeCommitHead: '',
  githubMainHead: '',
  mergeCommitIncluded: false,
  proofScenario: 'Battle Bridge recovery diagnosis exact head',
};

function handoffFixture() {
  const receiptResult = createRemoteCodexOperatorApprovalReceipt({
    approvalId: 'approval-recovery-accelerator-v1',
    requestId: 'remote-codex-recovery-v1',
    owningIssue: 1822,
    repository: 'Cheekyfellastef/stephan-os',
    expectedHead: HEAD,
    task: TASK,
    requestedProofCommands: PROOF_COMMANDS,
    exactHeadProof: EXACT_HEAD_PROOF,
    approvedAt: APPROVED,
    expiresAt: EXPIRES,
  });
  assert.equal(receiptResult.ok, true);
  const handoffResult = createRemoteCodexBattleBridgeHandoff({
    requestId: 'remote-codex-recovery-v1',
    owningIssue: 1822,
    task: TASK,
    operatorApproval: 'operator-approved',
    operatorApprovalReceipt: receiptResult.receipt,
    repository: 'Cheekyfellastef/stephan-os',
    expectedHead: HEAD,
    exactHeadProof: EXACT_HEAD_PROOF,
    requestedProofCommands: PROOF_COMMANDS,
    createdAt: CREATED,
    expiresAt: EXPIRES,
  });
  assert.equal(handoffResult.ok, true);
  return handoffResult.handoff;
}

function attachmentFixture(overrides = {}) {
  return {
    schemaVersion: 'stephanos.codex-dispatch-surface-attachment.v1',
    surfaceId: 'stephanos-codex-dispatch-local-mcp',
    attached: true,
    can_local_windows_proof: true,
    platform: 'win32',
    sourceHead: HEAD,
    serverSourceSha256: 'b'.repeat(64),
    surfaceReceipt: 'receipt-remote-codex-windows-attachment-v1',
    toolsListed: ['dispatch_codex_task', 'get_codex_task_status', 'read_codex_task_result'],
    requiredDispatchToolsPresent: true,
    observedAt: '2026-08-16T16:21:30.000Z',
    ...overrides,
  };
}

function capacityAllowed() {
  return {
    decision: 'CODEX_DISPATCH_ALLOWED',
    dispatchAllowed: true,
    selectedRoute: 'CODEX',
    exactNextAction: 'Dispatch one eligible Codex task.',
    resetPlan: null,
  };
}

function capacityEmpty() {
  return {
    decision: 'CODEX_BLOCKED_BY_METER',
    dispatchAllowed: false,
    selectedRoute: 'DEFER_UNTIL_RESET',
    exactNextAction: 'Use a qualified fallback until Codex capacity returns.',
    resetPlan: null,
  };
}

function input(overrides = {}) {
  return {
    missionId: 'mission-battle-bridge-recovery-v1',
    taskId: 'task-battle-bridge-recovery-v1',
    taskClass: REMOTE_CODEX_RECOVERY_TASK_CLASS.WINDOWS_RUNTIME_DIAGNOSIS,
    title: 'Diagnose canonical Battle Bridge runtime and recovery state on Windows',
    queueRecord: { jobId: 'job-recovery-v1', issueNumber: 1822, prompt: TASK },
    capacityProjection: capacityAllowed(),
    handoff: handoffFixture(),
    attachment: attachmentFixture(),
    nowUtc: NOW,
    ...overrides,
  };
}

test('ordinary source repair remains GitHub-first even when Codex has capacity', () => {
  const result = planRemoteCodexBattleBridgeRecoveryAccelerationV1(input({
    taskClass: REMOTE_CODEX_RECOVERY_TASK_CLASS.SOURCE_REPAIR,
    title: 'Repair one bounded repository source defect through the canonical GitHub writer',
  }));
  assert.equal(result.ok, true);
  assert.equal(result.selectedRoute, REMOTE_CODEX_RECOVERY_ROUTE.CHATGPT_GITHUB_FIRST);
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.dispatchCall, null);
});

test('healthy meter plus exact Windows attachment admits Remote Codex recovery acceleration', () => {
  const result = planRemoteCodexBattleBridgeRecoveryAccelerationV1(input());
  assert.equal(result.ok, true);
  assert.equal(result.selectedRoute, REMOTE_CODEX_RECOVERY_ROUTE.REMOTE_CODEX_BATTLE_BRIDGE);
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.dispatchCall.ok, true);
  assert.equal(result.dispatchCall.toolName, 'dispatch_codex_task');
  assert.equal(result.githubAtCodexFallbackAllowed, false);
  assert.equal(result.defaultLinuxCodexFallbackAllowed, false);
  assert.equal(result.finalVerdict, 'REMOTE_CODEX_BATTLE_BRIDGE_RECOVERY_ACCELERATOR_READY');
});

test('empty meter preserves mission and selects OpenClaw or lifeboat fallback', () => {
  const result = planRemoteCodexBattleBridgeRecoveryAccelerationV1(input({ capacityProjection: capacityEmpty() }));
  assert.equal(result.ok, true);
  assert.equal(result.selectedRoute, REMOTE_CODEX_RECOVERY_ROUTE.OPENCLAW_OR_LIFEBOAT);
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.remoteCodexOptional, true);
  assert.equal(result.missionMustSurviveProviderLoss, true);
  assert.equal(result.dispatchCall, null);
});

test('stale Remote Codex Windows attachment cannot consume available meter', () => {
  const result = planRemoteCodexBattleBridgeRecoveryAccelerationV1(input({
    attachment: attachmentFixture({ observedAt: '2026-08-16T16:00:00.000Z' }),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.selectedRoute, REMOTE_CODEX_RECOVERY_ROUTE.OPENCLAW_OR_LIFEBOAT);
  assert.equal(result.dispatchAllowed, false);
  assert.match(result.blocker, /STALE/);
});

test('attachment exact-head mismatch fails over rather than dispatching', () => {
  const result = planRemoteCodexBattleBridgeRecoveryAccelerationV1(input({
    attachment: attachmentFixture({ sourceHead: 'c'.repeat(40) }),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.selectedRoute, REMOTE_CODEX_RECOVERY_ROUTE.OPENCLAW_OR_LIFEBOAT);
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.blocker, 'BATTLE_BRIDGE_ATTACHMENT_HEAD_MISMATCH');
});

test('restored Codex capacity returns Remote Codex to the pool without changing mission identity', () => {
  const base = input({ capacityProjection: capacityEmpty() });
  const unavailable = planRemoteCodexBattleBridgeRecoveryAccelerationV1(base);
  const restored = planRemoteCodexBattleBridgeRecoveryAccelerationV1({ ...base, capacityProjection: capacityAllowed() });
  assert.equal(unavailable.missionId, restored.missionId);
  assert.equal(unavailable.taskId, restored.taskId);
  assert.equal(unavailable.selectedRoute, REMOTE_CODEX_RECOVERY_ROUTE.OPENCLAW_OR_LIFEBOAT);
  assert.equal(restored.selectedRoute, REMOTE_CODEX_RECOVERY_ROUTE.REMOTE_CODEX_BATTLE_BRIDGE);
  assert.equal(restored.dispatchAllowed, true);
});

test('caller-shaped availability or repair booleans are rejected and cannot grant authority', () => {
  const result = planRemoteCodexBattleBridgeRecoveryAccelerationV1({
    ...input({ capacityProjection: capacityEmpty() }),
    meterAvailable: true,
    attached: true,
    canFix: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'RECOVERY_ACCELERATOR_UNEXPECTED_FIELD');
  assert.equal(result.dispatchAllowed, false);
});

test('ready packet still grants zero general mutation authority', () => {
  const result = planRemoteCodexBattleBridgeRecoveryAccelerationV1(input());
  assert.equal(result.ok, true);
  for (const key of [
    'duplicateDispatchAllowed',
    'sourceMutationAllowed',
    'arbitraryShellAllowed',
    'destructiveGitAllowed',
    'mergeAllowed',
    'deploymentAllowed',
    'credentialAccessAllowed',
    'pcRestartAllowed',
  ]) {
    assert.equal(result[key], false, key);
  }
  assert.equal(result.freshTaskReceiptRequired, true);
  assert.equal(result.exactHeadProofRequired, true);
});
