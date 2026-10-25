import assert from 'node:assert/strict';
import test from 'node:test';
import { executeMaintenanceRecoveryOnBattleBridge as execute, MAINTENANCE_RECOVERY_OPERATIONS as ops,
  validateMaintenanceRecoveryCommandShape as shape } from './sovereignMaintenanceRecoveryMailboxV1.mjs';
import { validateBattleBridgeGitHubCommand, selectBattleBridgeGitHubCommandBatch,
  executeBattleBridgeGitHubCommand } from './battleBridgeGitHubCommandMailbox.mjs';
import { BATTLE_BRIDGE_GITHUB_COMMAND_MARKER } from './battleBridgeGitHubCommandMailboxCoreV1.mjs';
import { serializeBoundedReceiptJson, createSanitizedMailboxReceiptProjection,
  checkpointTerminalMailboxReceipt } from '../../scripts/battle-bridge-github-command-mailbox.mjs';
const head = 'a'.repeat(40), digest = 'b'.repeat(64);
const cycle = '0a23c41a-124f-4776-97e8-e45ab0309b0b';
const now = new Date('2026-10-25T14:00:00Z');
const command = (extra = {}) => ({ schemaVersion: 'stephanos.battle-bridge-github-command.v1',
  requestId: 'octopus-recovery-test-1', operation: ops[0], repository: 'Cheekyfellastef/stephan-os',
  issueNumber: 3149, branch: 'main', operatorApproval: 'operator-approved', expectedHead: head,
  expiresAt: '2026-10-25T14:30:00Z', ...extra });
const options = { readMaintenanceRecoverySourceFn: () => head,
  runMaintenanceCustodyRecoveryFn: async () => ({ ok: true, originalHoldMatched: true,
    cycleId: cycle, reportSha256: digest, bootWitness: { machineHash: 'private' },
    persistentCustody: { held: true, digest, signingKey: 'SECRET' } }) };

test('fixed shapes reject arbitrary authority and incomplete incident bindings', () => {
  for (const extra of [{ shell: 'whoami' }, { mode: 'recover' }, { expectedDigest: digest },
    { workspaceRoot: 'C:/elsewhere' }, { repository: 'elsewhere/repo' }, { issueNumber: 2808 },
    { branch: 'other' }, { operatorApproval: false }, { expectedHead: 'invalid' },
    { operation: ops[1] }, { operation: ops[1], expectedCycle: cycle, expectedReportSha256: 'bad' }])
    assert.equal(shape(command(extra)).ok, false, JSON.stringify(extra));
});
test('canonical envelope requires owner, unexpired approval and valid schema', () => {
  const good = { authorLogin: 'Cheekyfellastef', now, authoredAt: now };
  assert.equal(validateBattleBridgeGitHubCommand(command(), good).ok, true);
  assert.equal(validateBattleBridgeGitHubCommand(command(), { ...good, authorLogin: 'other' }).ok, false);
  assert.equal(validateBattleBridgeGitHubCommand(command({ expiresAt: '2026-10-25T13:00:00Z' }), good).ok, false);
  assert.equal(validateBattleBridgeGitHubCommand(command({ schemaVersion: 'invalid' }), good).ok, false);
});
test('canonical worker selects the fixed operation and terminalizes forbidden fields', () => {
  const comment = c => ({ id: 123, user: { login: 'Cheekyfellastef' }, created_at: now.toISOString(),
    body: '```' + BATTLE_BRIDGE_GITHUB_COMMAND_MARKER + '\n' + JSON.stringify(c) + '\n```' });
  const batch = selectBattleBridgeGitHubCommandBatch([comment(command())], { now, maxBatch: 1, consumedRequestIds: new Set() });
  assert.equal(batch.commands[0].command.operation, ops[0]);
  const invalid = selectBattleBridgeGitHubCommandBatch([comment(command({ shell: 'bad' }))], { now, maxBatch: 1, consumedRequestIds: new Set() });
  assert.equal(invalid.commands.length, 0);
  assert.equal(invalid.terminalRejections[0].blocker, 'RECOVERY_MAILBOX_FIELD_NOT_ALLOWED');
});
test('execution checks live canonical head before invoking recovery', async () => {
  let invoked = false;
  const result = await execute(command(), { readMaintenanceRecoverySourceFn: () => 'c'.repeat(40),
    runMaintenanceCustodyRecoveryFn: async () => { invoked = true; } });
  assert.equal(result.ok, false); assert.equal(invoked, false);
});
test('public observation is bounded and redacts witness and custody secrets', async () => {
  const result = await executeBattleBridgeGitHubCommand(command(), options);
  assert.equal(result.ok, true); assert.equal(result.digest, digest);
  assert.equal(result.cycleId, cycle); assert.equal(result.originalHoldMatched, true);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
  assert.equal(result.custodyReleased, false); assert.equal(result.pcRestartAllowed, false);
});
test('prepare passes only fixed exact incident inputs to existing recovery owner', async () => {
  let seen;
  const result = await execute(command({ operation: ops[1], expectedCycle: cycle, expectedReportSha256: digest }),
    { ...options, runMaintenanceCustodyRecoveryFn: async input => { seen = input;
      return { ok: true, prepared: true, persistentCustody: { held: true, digest, reservationId: cycle } }; } });
  assert.deepEqual(seen, { mode: 'prepare', expectedMain: head, expectedCycle: cycle,
    expectedReportSha256: digest, operatorApproval: 'operator-approved' });
  assert.equal(result.prepared, true); assert.equal(result.sourceLeaseReleased, false);
});
test('exceptions and untrusted error contents cannot escape into public mailbox', async () => {
  for (const fn of [async () => { throw new Error('SECRET'); }, async () => ({ ok: false, blocker: 'SECRET' })]) {
    const result = await execute(command(), { ...options, runMaintenanceCustodyRecoveryFn: fn });
    assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes('SECRET'), false);
  }
});
test('prepare cannot report success without exact durable incident readback', async () => {
  for (const status of [{ held: true, digest, reservationId: 'other' }, { held: false, digest, reservationId: cycle }, { held: true, reservationId: cycle }]) {
    const result = await execute(command({ operation: ops[1], expectedCycle: cycle, expectedReportSha256: digest }),
      { ...options, runMaintenanceCustodyRecoveryFn: async () => ({ ok: true, prepared: true, persistentCustody: status }) });
    assert.equal(result.ok, false); assert.equal(result.prepared, false);
  }
});
test('real mailbox serialization, checkpoint and sanitized readback preserve recovery bindings', async () => {
  for (const operation of ops) {
    const c = command(operation === ops[1] ? { operation, expectedCycle: cycle, expectedReportSha256: digest } : {});
    const result = await executeBattleBridgeGitHubCommand(c, { ...options,
      runMaintenanceCustodyRecoveryFn: async () => ({ ok: true, prepared: operation === ops[1],
        cycleId: cycle, reportSha256: digest, originalHoldMatched: true,
        persistentCustody: { held: true, digest, reservationId: cycle } }) });
    const receipt = { schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
      requestId: c.requestId, operation, state: 'DONE', expectedHead: head, result };
    const wire = serializeBoundedReceiptJson(receipt);
    const serialized = JSON.parse(wire);
    const expected = { originalHoldMatched: true, prepared: operation === ops[1], held: true,
      digest, cycleId: cycle, reportSha256: digest, custodyReleased: false,
      pcRestartAllowed: false, sourceLeaseReleased: false };
    assert.deepEqual(serialized.result.result.maintenanceRecovery, expected);
    assert.deepEqual(createSanitizedMailboxReceiptProjection(receipt).operationResult.maintenanceRecovery, expected);
    assert.deepEqual(createSanitizedMailboxReceiptProjection(serialized).operationResult.maintenanceRecovery, expected);
    const state = { consumedRequestIds: [], acceptedRequestIds: [] };
    checkpointTerminalMailboxReceipt(state, receipt, { persist() {} });
    assert.deepEqual(state.lastReceipt.result.result.maintenanceRecovery, expected);
    assert.deepEqual(JSON.parse(serializeBoundedReceiptJson(serialized)).result.result.maintenanceRecovery, expected);
    const core = JSON.parse(serializeBoundedReceiptJson(receipt, 3000));
    assert.deepEqual(core.result.result.maintenanceRecovery, expected);
    assert.deepEqual(createSanitizedMailboxReceiptProjection(core).operationResult.maintenanceRecovery, expected);
  }
});
test('recovery projections reject malformed bindings and never expose nested private data', () => {
  const result = { ok: true, cycleId: 'SECRET', reportSha256: 'SECRET', digest: 'SECRET',
    held: 'true', prepared: 'true', originalHoldMatched: 'true', bootWitness: { machineHash: 'SECRET' },
    signingKey: 'SECRET', rawReport: 'SECRET', custodyReleased: true, pcRestartAllowed: true };
  const receipt = { operation: ops[0], requestId: 'recovery-public-redaction', result };
  for (const projected of [JSON.parse(serializeBoundedReceiptJson(receipt)), createSanitizedMailboxReceiptProjection(receipt)]) {
    assert.equal(JSON.stringify(projected).includes('SECRET'), false);
    const fields = projected.result?.result?.maintenanceRecovery || projected.operationResult.maintenanceRecovery;
    assert.equal(fields.held, false); assert.equal(fields.prepared, false);
    assert.equal(fields.custodyReleased, false); assert.equal(fields.pcRestartAllowed, false);
  }
});
