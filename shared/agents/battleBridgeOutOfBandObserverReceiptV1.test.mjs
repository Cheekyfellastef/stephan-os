import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BATTLE_BRIDGE_OUT_OF_BAND_OBSERVER_RECEIPT_MARKER,
  buildBattleBridgeOutOfBandObserverReceipt,
  buildBattleBridgeOutOfBandObserverReceiptBody,
} from './battleBridgeOutOfBandObserverReceiptV1.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const request = { requestId: 'observer-request-20260818', expectedHead: A };

function assertReadOnly(receipt) {
  assert.equal(receipt.readOnly, true);
  assert.equal(receipt.mutationPerformed, false);
  assert.equal(receipt.arbitraryShellAllowed, false);
  assert.equal(receipt.arbitraryPowerShellAllowed, false);
  assert.equal(receipt.sourceMutationAllowed, false);
  assert.equal(receipt.destructiveGitAllowed, false);
  assert.equal(receipt.taskMutationAllowed, false);
  assert.equal(receipt.processRestartAllowed, false);
  assert.equal(receipt.liveOpenClawUpdateAllowed, false);
  assert.equal(receipt.secretValuesExposed, false);
}

test('reachable exact Battle Bridge head terminates DONE with exact-head truth', () => {
  const receipt = buildBattleBridgeOutOfBandObserverReceipt({
    request,
    settingsProof: { ready: true },
    remoteReceipt: { ok: true, observedHead: A },
    tailnetOutcome: 'success',
    remoteOutcome: 'success',
    workflowRunId: 123,
    observedAtUtc: '2026-08-18T13:40:00Z',
  });
  assert.equal(receipt.state, 'DONE');
  assert.equal(receipt.blocker, '');
  assert.equal(receipt.observedHead, A);
  assert.equal(receipt.exactHeadMatch, true);
  assert.equal(receipt.finalVerdict, 'BATTLE_BRIDGE_OUT_OF_BAND_OBSERVER_PASS');
  assertReadOnly(receipt);
});

test('reachable stale Battle Bridge head terminates STALE without mutating Git', () => {
  const receipt = buildBattleBridgeOutOfBandObserverReceipt({
    request,
    settingsProof: { ready: true },
    remoteReceipt: { ok: true, observedHead: B },
    tailnetOutcome: 'success',
    remoteOutcome: 'success',
  });
  assert.equal(receipt.state, 'STALE');
  assert.equal(receipt.blocker, 'BATTLE_BRIDGE_LOCAL_HEAD_STALE');
  assert.equal(receipt.observedHead, B);
  assert.equal(receipt.exactHeadMatch, false);
  assertReadOnly(receipt);
});

test('missing or unsafe observer settings terminate BLOCKED instead of silence', () => {
  const receipt = buildBattleBridgeOutOfBandObserverReceipt({
    request,
    settingsProof: { ready: false, missing: ['SECRET_NAME_ONLY'] },
    tailnetOutcome: 'skipped',
    remoteOutcome: 'skipped',
  });
  assert.equal(receipt.state, 'BLOCKED');
  assert.equal(receipt.blocker, 'BATTLE_BRIDGE_OUT_OF_BAND_OBSERVER_SETTINGS_BLOCKED');
  assert.equal(receipt.observedHead, '');
  assertReadOnly(receipt);
  assert.doesNotMatch(JSON.stringify(receipt), /SECRET_NAME_ONLY/);
});

test('transport failure terminates UNREACHABLE instead of pending forever', () => {
  const tailnet = buildBattleBridgeOutOfBandObserverReceipt({
    request,
    settingsProof: { ready: true },
    tailnetOutcome: 'failure',
    remoteOutcome: 'skipped',
  });
  assert.equal(tailnet.state, 'UNREACHABLE');
  assert.equal(tailnet.blocker, 'BATTLE_BRIDGE_TAILNET_UNREACHABLE');
  assertReadOnly(tailnet);

  const ssh = buildBattleBridgeOutOfBandObserverReceipt({
    request,
    settingsProof: { ready: true },
    tailnetOutcome: 'success',
    remoteOutcome: 'failure',
  });
  assert.equal(ssh.state, 'UNREACHABLE');
  assert.equal(ssh.blocker, 'BATTLE_BRIDGE_SSH_OBSERVER_UNREACHABLE');
  assertReadOnly(ssh);
});

test('GitHub-visible body is bounded to safe observer fields', () => {
  const receipt = buildBattleBridgeOutOfBandObserverReceipt({
    request,
    settingsProof: { ready: true },
    remoteReceipt: { ok: true, observedHead: A, secret: 'must-not-project' },
    tailnetOutcome: 'success',
    remoteOutcome: 'success',
  });
  const body = buildBattleBridgeOutOfBandObserverReceiptBody(receipt);
  assert.match(body, new RegExp(BATTLE_BRIDGE_OUT_OF_BAND_OBSERVER_RECEIPT_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(body, /"state": "DONE"/);
  assert.match(body, /"exactHeadMatch": true/);
  assert.doesNotMatch(body, /must-not-project|private.?key|token|credential/i);
});
