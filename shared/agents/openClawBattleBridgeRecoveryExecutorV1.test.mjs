import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  BATTLE_BRIDGE_MOBILE_RECOVERY_ATTESTATION_SCHEMA,
  BATTLE_BRIDGE_MOBILE_RECOVERY_REQUEST_SCHEMA,
  BATTLE_BRIDGE_RECOVERY_ISSUE,
  BATTLE_BRIDGE_RECOVERY_OWNER,
  BATTLE_BRIDGE_RECOVERY_REPOSITORY,
  BATTLE_BRIDGE_RECOVERY_WORKFLOW,
  recoveryRequestSha256,
} from './battleBridgeMobileRecoveryLifeboatV1.mjs';
import {
  OPENCLAW_BATTLE_BRIDGE_FIXED_ADAPTER_ID,
  OPENCLAW_BATTLE_BRIDGE_FIXED_ADAPTER_RELATIVE_PATH,
  OPENCLAW_BATTLE_BRIDGE_QUALIFIED_ACTIONS,
  prepareOpenClawBattleBridgeRecoveryExecution,
} from './openClawBattleBridgeRecoveryExecutorV1.mjs';

const NOW = Date.parse('2026-08-16T16:10:00.000Z');

function requestFor(action = 'PROBE_BATTLE_BRIDGE') {
  return {
    schemaVersion: BATTLE_BRIDGE_MOBILE_RECOVERY_REQUEST_SCHEMA,
    repository: BATTLE_BRIDGE_RECOVERY_REPOSITORY,
    issueNumber: BATTLE_BRIDGE_RECOVERY_ISSUE,
    requestId: 'mobile-recovery-openclaw-v1',
    nonce: '0123456789abcdef0123456789abcdef',
    action,
    requesterLogin: BATTLE_BRIDGE_RECOVERY_OWNER,
    authorAssociation: 'OWNER',
    requestedAtUtc: '2026-08-16T16:09:00.000Z',
    expiresAtUtc: '2026-08-16T16:14:00.000Z',
  };
}

function attestationFor(request) {
  return {
    schemaVersion: BATTLE_BRIDGE_MOBILE_RECOVERY_ATTESTATION_SCHEMA,
    repository: BATTLE_BRIDGE_RECOVERY_REPOSITORY,
    issueNumber: BATTLE_BRIDGE_RECOVERY_ISSUE,
    requestId: request.requestId,
    requestSha256: recoveryRequestSha256(request),
    action: request.action,
    workflowPath: BATTLE_BRIDGE_RECOVERY_WORKFLOW,
    reviewerLogin: 'github-actions[bot]',
    verdict: 'ATTESTED',
    attestedAtUtc: '2026-08-16T16:09:20.000Z',
    expiresAtUtc: request.expiresAtUtc,
  };
}

test('qualified attested probe becomes one fixed checkout-independent OpenClaw packet', () => {
  const request = requestFor();
  const result = prepareOpenClawBattleBridgeRecoveryExecution({
    request,
    attestation: attestationFor(request),
    nowMs: NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'openclaw-standalone');
  assert.equal(result.executionPacket.fixedAdapterId, OPENCLAW_BATTLE_BRIDGE_FIXED_ADAPTER_ID);
  assert.equal(result.executionPacket.fixedAdapterRelativePath, OPENCLAW_BATTLE_BRIDGE_FIXED_ADAPTER_RELATIVE_PATH);
  assert.equal(result.executionPacket.fixedOperation, 'PROBE_BATTLE_BRIDGE');
  assert.equal(result.executionPacket.sourceCheckoutRequiredToStartExecutor, false);
  assert.equal(result.executionPacket.openClawGatewayRequired, false);
  assert.equal(result.executionPacket.openClawMissionRunnerMayInvoke, true);
  assert.equal(result.executionPacket.lifeboatSentinelMayInvoke, true);
  assert.equal(result.executionPacket.freshPostActionProofRequired, true);
});

test('only the initial probe and wake family is qualified', () => {
  assert.deepEqual(OPENCLAW_BATTLE_BRIDGE_QUALIFIED_ACTIONS, [
    'PROBE_BATTLE_BRIDGE',
    'WAKE_CANONICAL_MAILBOX',
    'WAKE_CANONICAL_RECOVERY_MESH',
  ]);

  for (const action of OPENCLAW_BATTLE_BRIDGE_QUALIFIED_ACTIONS) {
    const request = requestFor(action);
    const result = prepareOpenClawBattleBridgeRecoveryExecution({ request, attestation: attestationFor(request), nowMs: NOW });
    assert.equal(result.ok, true, action);
    assert.equal(result.executionPacket.action, action);
  }
});

test('full recovery and checkout repair remain blocked until separately qualified', () => {
  for (const action of [
    'REPAIR_CONTROL_PLANE_TASKS',
    'RESTORE_CANONICAL_MAIN_PRESERVING_RUNTIME_STATE',
    'RESTART_CANONICAL_BACKEND',
    'REBUILD_AND_RESTART_CANONICAL_UI',
    'ROLLBACK_LIFEBOAT_TO_LAST_KNOWN_GOOD',
    'FULL_BATTLE_BRIDGE_RECOVERY',
  ]) {
    const request = requestFor(action);
    const result = prepareOpenClawBattleBridgeRecoveryExecution({ request, attestation: attestationFor(request), nowMs: NOW });
    assert.equal(result.ok, false, action);
    assert.equal(result.blocker, 'OPENCLAW_RECOVERY_ACTION_NOT_YET_QUALIFIED');
  }
});

test('raw request without GitHub-hosted attestation has zero execution authority', () => {
  const result = prepareOpenClawBattleBridgeRecoveryExecution({ request: requestFor(), nowMs: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'OPENCLAW_RECOVERY_ATTESTATION_BLOCKED');
  assert.equal(result.executionPacket, null);
});

test('consumed request id cannot be replayed through OpenClaw', () => {
  const request = requestFor('WAKE_CANONICAL_MAILBOX');
  const result = prepareOpenClawBattleBridgeRecoveryExecution({
    request,
    attestation: attestationFor(request),
    nowMs: NOW,
    consumedRequestIds: [request.requestId],
  });
  assert.equal(result.ok, false);
  assert.equal(result.executionPacket, null);
  assert.ok(result.upstreamBlockers.some((item) => String(item).includes('request-replayed')));
});

test('executor packet grants no generic mutation authority', () => {
  const request = requestFor('WAKE_CANONICAL_RECOVERY_MESH');
  const result = prepareOpenClawBattleBridgeRecoveryExecution({ request, attestation: attestationFor(request), nowMs: NOW });
  assert.equal(result.ok, true);
  const packet = result.executionPacket;
  for (const key of [
    'arbitraryShellAllowed',
    'callerSelectedExecutableAllowed',
    'callerSelectedPathAllowed',
    'callerSelectedUrlAllowed',
    'callerSelectedTaskAllowed',
    'gitMutationAllowed',
    'sourceMutationAllowed',
    'mergeAllowed',
    'deploymentAllowed',
    'pcRestartAllowed',
  ]) {
    assert.equal(packet[key], false, key);
  }
});

test('Windows adapter exposes only fixed probe/wake operations and no generic shell inputs', async () => {
  const source = await readFile(new URL('../../scripts/windows/battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1', import.meta.url), 'utf8');
  assert.match(source, /ValidateSet\('PROBE_BATTLE_BRIDGE', 'WAKE_CANONICAL_MAILBOX', 'WAKE_CANONICAL_RECOVERY_MESH'\)/);
  assert.match(source, /Stephanos Battle Bridge GitHub Command Mailbox/);
  assert.match(source, /Stephanos Battle Bridge Recovery Mesh/);
  assert.match(source, /C:\\Windows\\System32\\wscript\.exe/);
  assert.match(source, /checkoutIndependentExecutor = \$true/);
  assert.match(source, /freshPostActionProofRequired = \$true/);
  assert.doesNotMatch(source, /Invoke-Expression/i);
  assert.doesNotMatch(source, /Start-Process/i);
  assert.doesNotMatch(source, /git\.exe/i);
  assert.doesNotMatch(source, /reset --hard/i);
  assert.doesNotMatch(source, /git clean/i);
  assert.doesNotMatch(source, /Remove-Item/i);
  assert.doesNotMatch(source, /Stop-Process/i);
  assert.doesNotMatch(source, /Restart-Computer/i);
});
