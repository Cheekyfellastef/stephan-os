import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OPENCLAW_UPDATE_BATTLE_BRIDGE_ACTION,
  OPENCLAW_UPDATE_BATTLE_BRIDGE_COMMAND_SCHEMA,
  OPENCLAW_UPDATE_BATTLE_BRIDGE_HOST,
  OPENCLAW_UPDATE_BATTLE_BRIDGE_OPERATOR,
  OPENCLAW_UPDATE_BATTLE_BRIDGE_VERDICT,
  executeOpenClawUpdateBattleBridgeAdapter,
  validateOpenClawUpdateBattleBridgeCommand,
} from './openClawUpdateBattleBridgeAdapterV1.mjs';

const SOURCE_HEAD = 'a'.repeat(40);
const MANIFEST = 'b'.repeat(64);
const PACKET_SHA = 'c'.repeat(64);

function times() {
  const now = Date.now();
  return {
    issuedAtUtc: new Date(now - 30_000).toISOString(),
    expiresAtUtc: new Date(now + 60 * 60_000).toISOString(),
  };
}

function command(overrides = {}) {
  return {
    schema: OPENCLAW_UPDATE_BATTLE_BRIDGE_COMMAND_SCHEMA,
    commandId: 'openclaw-update-command-1',
    action: OPENCLAW_UPDATE_BATTLE_BRIDGE_ACTION.APPLY,
    repository: 'Cheekyfellastef/stephan-os',
    sourceHead: SOURCE_HEAD,
    manifestSha256: MANIFEST,
    packetId: 'openclaw-1.2.4',
    packetSha256: PACKET_SHA,
    currentVersion: '1.2.3',
    targetVersion: '1.2.4',
    approvalId: 'approval-1415-a',
    stageId: 'stage-openclaw-1.2.4',
    backupSetId: 'backup-openclaw-1.2.3',
    stagedUpdateStatus: 'READY_TO_APPLY',
    hostId: OPENCLAW_UPDATE_BATTLE_BRIDGE_HOST,
    requestedBy: OPENCLAW_UPDATE_BATTLE_BRIDGE_OPERATOR,
    operatorApproval: 'operator-approved',
    canaryRequired: true,
    ...times(),
    ...overrides,
  };
}

function rollbackCommand(overrides = {}) {
  return command({
    action: OPENCLAW_UPDATE_BATTLE_BRIDGE_ACTION.ROLLBACK,
    stagedUpdateStatus: 'ROLLBACK_REQUIRED',
    ...overrides,
  });
}

function handlers({ failAt = '', publishFails = false, calls = [] } = {}) {
  const failures = new Set(Array.isArray(failAt) ? failAt : [failAt].filter(Boolean));
  const named = [
    'readCanonicalSourceIdentity',
    'verifyPrivateExecutionPacket',
    'verifyIsolatedStage',
    'verifyProtectedBackupSet',
    'stopVerifiedGateway',
    'applyPinnedUpdate',
    'startCanonicalGateway',
    'verifyPostUpdateHealth',
    'compareProtectedIdentities',
    'rollbackPinnedPackage',
    'restoreProtectedBackup',
    'verifyRollbackHealth',
    'compareRollbackPreservation',
  ];
  const result = Object.fromEntries(named.map((name) => [name, async (input, context) => {
    calls.push([name, context.step]);
    const failed = failures.has(name);
    return {
      ok: !failed,
      blocker: failed ? `FAILED_${name.toUpperCase()}` : '',
      receiptId: `${name}-receipt`,
      observedSourceHead: SOURCE_HEAD,
      observedVersion: name.toLowerCase().includes('rollback') ? input.currentVersion : input.targetVersion,
      proofRefs: [`proofs/openclaw-update/${name}.json`],
    };
  }]));
  result.publishSharedWorkspaceReceipt = async (input, context) => {
    calls.push(['publishSharedWorkspaceReceipt', context.step || context.cause || 'publish']);
    return {
      ok: !publishFails,
      blocker: publishFails ? 'SHARED_WORKSPACE_RECEIPT_WRITE_FAILED' : '',
      receiptId: 'shared-workspace-receipt',
      proofRefs: ['receipts/openclaw-update/current.json'],
    };
  };
  return result;
}

test('accepts only one exact operator-approved canary command', () => {
  const result = validateOpenClawUpdateBattleBridgeCommand(command());
  assert.equal(result.ok, true);
  assert.equal(result.verdict, OPENCLAW_UPDATE_BATTLE_BRIDGE_VERDICT.READY);
  assert.equal(result.command.sourceHead, SOURCE_HEAD);
  assert.equal(result.safety.arbitraryShellAllowed, false);
  assert.equal(result.safety.rollbackMandatoryAfterPostMutationFailure, true);
});

test('rejects generic command, path, environment and credential authority', () => {
  for (const [field, value] of [
    ['command', 'npm install -g openclaw'],
    ['args', ['install']],
    ['path', 'C:/arbitrary'],
    ['environment', { TOKEN: 'secret' }],
    ['token', 'secret'],
    ['url', 'https://example.invalid/openclaw.tgz'],
  ]) {
    const result = validateOpenClawUpdateBattleBridgeCommand(command({ [field]: value }));
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'OPENCLAW_UPDATE_COMMAND_FIELD_NOT_ALLOWED');
    assert.equal(result.field, field);
  }
});

test('rejects wrong host, requester, approval, action, status and no-version-change', () => {
  const cases = [
    [{ hostId: 'other-host' }, 'OPENCLAW_UPDATE_COMMAND_HOST_MISMATCH'],
    [{ requestedBy: 'someone-else' }, 'OPENCLAW_UPDATE_COMMAND_REQUESTER_MISMATCH'],
    [{ operatorApproval: 'implicit' }, 'OPENCLAW_UPDATE_COMMAND_OPERATOR_APPROVAL_REQUIRED'],
    [{ action: 'RUN_ARBITRARY_SHELL' }, 'OPENCLAW_UPDATE_COMMAND_ACTION_NOT_ALLOWED'],
    [{ stagedUpdateStatus: 'APPROVAL_REQUIRED' }, 'OPENCLAW_UPDATE_COMMAND_STAGE_STATUS_MISMATCH'],
    [{ targetVersion: '1.2.3' }, 'OPENCLAW_UPDATE_COMMAND_NO_VERSION_CHANGE'],
  ];
  for (const [override, blocker] of cases) {
    assert.equal(validateOpenClawUpdateBattleBridgeCommand(command(override)).blocker, blocker);
  }
});

test('rejects expired, excessive or future-dated command authority', () => {
  const now = new Date('2026-08-04T12:00:00.000Z');
  const cases = [
    [{ issuedAtUtc: '2026-08-04T10:00:00.000Z', expiresAtUtc: '2026-08-04T11:00:00.000Z' }, 'OPENCLAW_UPDATE_COMMAND_EXPIRED'],
    [{ issuedAtUtc: '2026-08-04T10:00:00.000Z', expiresAtUtc: '2026-08-04T13:00:01.000Z' }, 'OPENCLAW_UPDATE_COMMAND_EXPIRY_WINDOW_INVALID'],
    [{ issuedAtUtc: '2026-08-04T12:02:00.000Z', expiresAtUtc: '2026-08-04T13:00:00.000Z' }, 'OPENCLAW_UPDATE_COMMAND_FROM_FUTURE'],
  ];
  for (const [override, blocker] of cases) {
    assert.equal(validateOpenClawUpdateBattleBridgeCommand(command(override), { now }).blocker, blocker);
  }
});

test('successful apply follows the fixed order and publishes an exact receipt', async () => {
  const calls = [];
  const result = await executeOpenClawUpdateBattleBridgeAdapter(command(), handlers({ calls }));
  assert.equal(result.ok, true);
  assert.equal(result.receipt.verdict, OPENCLAW_UPDATE_BATTLE_BRIDGE_VERDICT.UPDATED_AND_VERIFIED);
  assert.deepEqual(calls.map(([name]) => name), [
    'readCanonicalSourceIdentity',
    'verifyPrivateExecutionPacket',
    'verifyIsolatedStage',
    'verifyProtectedBackupSet',
    'stopVerifiedGateway',
    'applyPinnedUpdate',
    'startCanonicalGateway',
    'verifyPostUpdateHealth',
    'compareProtectedIdentities',
    'publishSharedWorkspaceReceipt',
  ]);
  assert.equal(result.receipt.arbitraryShellAllowed, false);
  assert.equal(result.receipt.mergeAuthority, false);
  assert.ok(result.receipt.proofRefs.includes('receipts/openclaw-update/current.json') === false);
});

test('pre-mutation failure blocks without running rollback mutations', async () => {
  const calls = [];
  const result = await executeOpenClawUpdateBattleBridgeAdapter(
    command(),
    handlers({ failAt: 'verifyIsolatedStage', calls }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.receipt.verdict, OPENCLAW_UPDATE_BATTLE_BRIDGE_VERDICT.BLOCKED);
  assert.equal(calls.some(([name]) => name === 'rollbackPinnedPackage'), false);
  assert.equal(calls.some(([name]) => name === 'applyPinnedUpdate'), false);
});

test('post-mutation failure automatically runs the fixed rollback path', async () => {
  const calls = [];
  const result = await executeOpenClawUpdateBattleBridgeAdapter(
    command(),
    handlers({ failAt: 'verifyPostUpdateHealth', calls }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.receipt.verdict, OPENCLAW_UPDATE_BATTLE_BRIDGE_VERDICT.ROLLED_BACK_AND_VERIFIED);
  const names = calls.map(([name]) => name);
  assert.ok(names.indexOf('rollbackPinnedPackage') > names.indexOf('verifyPostUpdateHealth'));
  assert.ok(names.includes('restoreProtectedBackup'));
  assert.ok(names.includes('verifyRollbackHealth'));
  assert.ok(names.includes('compareRollbackPreservation'));
});

test('rollback failure remains blocked with restore path instead of claiming recovery', async () => {
  const calls = [];
  const result = await executeOpenClawUpdateBattleBridgeAdapter(
    command(),
    handlers({ failAt: ['verifyPostUpdateHealth', 'restoreProtectedBackup'], calls }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.receipt.verdict, OPENCLAW_UPDATE_BATTLE_BRIDGE_VERDICT.BLOCKED);
  assert.match(result.receipt.blocker, /FAILED_RESTOREPROTECTEDBACKUP/);
});

test('receipt publication failure after update triggers rollback', async () => {
  const calls = [];
  const result = await executeOpenClawUpdateBattleBridgeAdapter(
    command(),
    handlers({ publishFails: true, calls }),
  );
  assert.equal(result.ok, false);
  assert.ok(calls.some(([name]) => name === 'rollbackPinnedPackage'));
  assert.notEqual(result.receipt.verdict, OPENCLAW_UPDATE_BATTLE_BRIDGE_VERDICT.UPDATED_AND_VERIFIED);
});

test('operator-requested rollback runs no apply handler', async () => {
  const calls = [];
  const result = await executeOpenClawUpdateBattleBridgeAdapter(
    rollbackCommand(),
    handlers({ calls }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.receipt.verdict, OPENCLAW_UPDATE_BATTLE_BRIDGE_VERDICT.ROLLED_BACK_AND_VERIFIED);
  assert.equal(calls.some(([name]) => name === 'applyPinnedUpdate'), false);
  assert.equal(calls.some(([name]) => name === 'rollbackPinnedPackage'), true);
});

test('missing fixed handlers fails closed before execution', async () => {
  const result = await executeOpenClawUpdateBattleBridgeAdapter(command(), {});
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'OPENCLAW_UPDATE_HANDLER_NOT_CONFIGURED');
  assert.ok(result.missingHandlers.includes('applyPinnedUpdate'));
});

test('unsafe proof references are removed and the receipt remains bounded', async () => {
  const calls = [];
  const custom = handlers({ calls });
  custom.verifyPrivateExecutionPacket = async () => ({
    ok: true,
    receiptId: 'private-packet-receipt',
    proofRefs: [
      '../secret',
      'C:/Users/Stephan/private.json',
      'proofs/openclaw-update/private-packet.json',
      ...Array.from({ length: 100 }, (_, index) => `proofs/openclaw-update/${index}.json`),
    ],
  });
  const result = await executeOpenClawUpdateBattleBridgeAdapter(command(), custom);
  assert.equal(result.ok, true);
  assert.ok(result.receipt.proofRefs.length <= 40);
  assert.equal(result.receipt.proofRefs.some((ref) => ref.includes('..') || ref.includes(':')), false);
});
