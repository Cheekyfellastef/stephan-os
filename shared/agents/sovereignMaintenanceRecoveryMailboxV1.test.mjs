import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeMaintenanceRecoveryOnBattleBridge as execute, MAINTENANCE_RECOVERY_OPERATIONS as ops,
  projectMaintenanceRecoveryReceiptV1 as project,
  validateMaintenanceRecoveryCommandShape as shape } from './sovereignMaintenanceRecoveryMailboxV1.mjs';
import { validateBattleBridgeGitHubCommand, selectBattleBridgeGitHubCommandBatch,
  executeBattleBridgeGitHubCommand } from './battleBridgeGitHubCommandMailbox.mjs';
import { BATTLE_BRIDGE_GITHUB_COMMAND_MARKER } from './battleBridgeGitHubCommandMailboxCoreV1.mjs';
import { serializeBoundedReceiptJson, createSanitizedMailboxReceiptProjection,
  checkpointTerminalMailboxReceipt } from '../../scripts/battle-bridge-github-command-mailbox.mjs';
import { runMaintenanceCustodyRecoveryV1 } from '../../scripts/sovereign-maintenance-custody-recovery.mjs';
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

function assertPublicDiagnostic(result, operation, code) {
  const receipt = { schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'recovery-diagnostic-roundtrip-01', operation,
    state: result.ok ? 'DONE' : 'BLOCKED', expectedHead: head, result };
  const serialized = JSON.parse(serializeBoundedReceiptJson(receipt));
  let durable;
  checkpointTerminalMailboxReceipt({}, receipt, {
    persist: state => { durable = JSON.parse(JSON.stringify(state)); },
  });
  const core = JSON.parse(serializeBoundedReceiptJson(receipt, 3000));
  assert.equal(core.githubProjectionTruncated, true);
  const packets = [receipt, serialized, durable.lastReceipt, core,
    JSON.parse(serializeBoundedReceiptJson(serialized)),
    JSON.parse(serializeBoundedReceiptJson(durable.lastReceipt)),
    JSON.parse(serializeBoundedReceiptJson(core, 3000))];
  for (const packet of packets) {
    const projected = createSanitizedMailboxReceiptProjection(packet);
    const recovery = projected.operationResult.maintenanceRecovery;
    assert.deepEqual(recovery.diagnostic, { code, diagnosticOnly: true });
    assert.equal(projected.operationResult.ok, result.ok);
    assert.equal(recovery.custodyReleased, false);
    assert.equal(recovery.pcRestartAllowed, false);
    assert.equal(recovery.sourceLeaseReleased, false);
    assert.doesNotMatch(JSON.stringify(projected), /SECRET|PRIVATE|machineHash|signingKey|stderr|cause|stage/);
    if (packet !== receipt)
      assert.deepEqual(packet.result.result.maintenanceRecovery.diagnostic, recovery.diagnostic);
  }
}

test('source failure keeps its exact fixed reason, does not run recovery and survives every public projection', async () => {
  for (const operation of ops) {
    let runnerCalls = 0;
    const result = await executeBattleBridgeGitHubCommand(command({ operation,
      ...(operation === ops[1] ? { expectedCycle: cycle, expectedReportSha256: digest } : {}) }), {
      readMaintenanceRecoverySourceFn: () => { throw Object.assign(
        new Error('MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN'),
        { cause: { message: 'PRIVATE SOURCE C:\\Users\\SECRET' }, stage: 'PRIVATE_STAGE' }); },
      runMaintenanceCustodyRecoveryFn: async () => { runnerCalls++; assert.fail('source failure ran the owner'); },
    });
    assert.equal(runnerCalls, 0);
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'RECOVERY_MAILBOX_RECOVERY_UNPROVEN');
    assertPublicDiagnostic(result, operation, 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN');
  }
});

test('fixed native failures and bounded timeout/filesystem classifications retain diagnostic codes only', async () => {
  const fixed = ['NATIVE_WINDOWS_BOOT_WITNESS_REQUIRED', 'WINDOWS_BOOT_WITNESS_UNAVAILABLE',
    'WINDOWS_BOOT_WITNESS_INVALID', 'CUSTODY_DIRECTORY_UNSAFE', 'CUSTODY_AUTHENTICATION_REQUIRED',
    'CUSTODY_RECORD_AUTHENTICATION_FAILED', 'CUSTODY_RECORD_INVALID', 'MAINTENANCE_OS_ANCHOR_UNAVAILABLE',
    'MAINTENANCE_OS_ANCHOR_UNPROVEN'];
  const examples = fixed.map(code => [Object.assign(new Error(code),
    { cause: 'SECRET', stage: 'QUERY', failureKind: 'PRIVATE' }), code]);
  examples.push([new DOMException('PRIVATE timeout location', 'TimeoutError'), 'TIMEOUT']);
  for (const code of ['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR', 'EISDIR', 'EEXIST', 'EBUSY', 'EIO'])
    examples.push([Object.assign(new Error('PRIVATE filesystem path C:\\Users\\SECRET'), { code }), code]);
  examples.push([Object.assign(new Error('PRIVATE timeout details'), { code: 'ETIMEDOUT' }), 'TIMEOUT']);
  for (const [error, code] of examples) {
    const result = await execute(command(), { ...options,
      runMaintenanceCustodyRecoveryFn: async () => { throw error; } });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'RECOVERY_MAILBOX_RECOVERY_UNPROVEN');
    assertPublicDiagnostic(result, ops[0], code);
  }
});

test('returned native denials stay blocked and preserve only allowlisted reasons', async () => {
  for (const operation of ops) {
    for (const code of ['LEGACY_MAINTENANCE_REPORT_UNBOUNDED', 'LEGACY_MAINTENANCE_EXACT_LIVE_HOLD_REQUIRED',
      'MAINTENANCE_CUSTODY_RESERVED', 'MAINTENANCE_CUSTODY_RESERVATION_UNPROVEN']) {
      const result = await execute(command({ operation,
        ...(operation === ops[1] ? { expectedCycle: cycle, expectedReportSha256: digest } : {}) }), {
        ...options, runMaintenanceCustodyRecoveryFn: async () => ({ ok: false, blocker: code,
          message: 'SECRET', stage: 'PRIVATE_STAGE', bootWitness: { machineHash: 'PRIVATE' },
          diagnostic: { code: 'SECRET', diagnosticOnly: false }, custodyReleased: true }),
      });
      assert.equal(result.ok, false);
      assert.equal(result.prepared, false);
      assertPublicDiagnostic(result, operation, code);
    }
  }
});

test('real read-only recovery status preserves observed missing/unproven custody without inventing anchor detail', async t => {
  const root = mkdtempSync(join(tmpdir(), 'recovery-mailbox-status-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'status')); mkdirSync(join(root, 'events'));
  const report = { reportSchema: 'stephanos.sovereign-commander-repair-report.v1',
    source: 'continuous-repair-guardian', cycleId: cycle, sourceHead: head,
    cycleStartedAtUtc: new Date(Date.now() - 60_000).toISOString(), detectedFaults: ['ETIMEDOUT'] };
  const reportPath = join(root, 'status', 'sovereign-commander-repair-current.json');
  writeFileSync(reportPath, JSON.stringify(report));
  const before = readFileSync(reportPath);
  const health = { service: 'stephanos-sovereign-commander', continuousRepairGuardian: {
    timeoutCustodyHeld: true, running: false, maintenanceInFlight: false,
    lastCycleId: cycle, lastStartedAtUtc: report.cycleStartedAtUtc,
    lastBlocker: 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN' } };
  for (const missing of [true, false]) {
    const result = await execute(command(), { ...options,
      runMaintenanceCustodyRecoveryFn: input => runMaintenanceCustodyRecoveryV1({ ...input,
        workspaceRoot: root, tokenReader: () => 'PRIVATE_FIXTURE_TOKEN_'.repeat(3),
        bootReader: () => ({ schemaVersion: 'stephanos.windows-boot-witness.v1', machineHash: digest,
          bootStartedAtUtc: new Date(Date.now() - 86400_000).toISOString(), observedAtUtc: new Date().toISOString() }),
        fetchFn: async () => ({ ok: true, json: async () => health }),
        anchor: { readLatest: () => {
          if (missing) return null;
          throw Object.assign(new Error('MAINTENANCE_OS_ANCHOR_UNPROVEN'), { stage: 'QUERY', cause: 'PRIVATE' });
        }, append: () => assert.fail('observation wrote custody') },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.originalHoldMatched, true);
    assert.equal(result.held, true);
    assert.equal(result.prepared, false);
    assertPublicDiagnostic(result, ops[0], missing ? 'MAINTENANCE_CUSTODY_STATE_MISSING' : 'MAINTENANCE_CUSTODY_STATE_UNPROVEN');
    assert.deepEqual(readFileSync(reportPath), before);
    assert.deepEqual(readdirSync(join(root, 'status')), ['sovereign-commander-repair-current.json']);
    assert.deepEqual(readdirSync(join(root, 'events')), []);
  }
  const reserved = await execute(command(), { ...options,
    runMaintenanceCustodyRecoveryFn: async () => ({ ok: true, originalHoldMatched: false,
      persistentCustody: { held: true, digest, blocker: 'MAINTENANCE_CUSTODY_RESERVED', rawRecord: 'SECRET' } }) });
  assert.equal(reserved.ok, true);
  assert.equal(reserved.originalHoldMatched, false);
  assertPublicDiagnostic(reserved, ops[0], 'MAINTENANCE_CUSTODY_RESERVED');
});

test('unknown errors remain red UNKNOWN diagnostics without exposing private messages, causes or guessed stages', async () => {
  const unknown = [new Error('SECRET MAINTENANCE_OS_ANCHOR_UNPROVEN'),
    Object.assign(new Error('PRIVATE'), { name: 'TimeoutError PRIVATE', code: 'EACCES PRIVATE' }),
    Object.assign(new Error('PRIVATE'), { cause: { code: 'ENOENT' }, stage: 'QUERY' }),
    new SyntaxError('PRIVATE report bytes'), 'MAINTENANCE_OS_ANCHOR_UNPROVEN', null];
  for (const error of unknown) {
    const result = await execute(command(), { ...options,
      runMaintenanceCustodyRecoveryFn: async () => { throw error; } });
    assert.equal(result.ok, false);
    assertPublicDiagnostic(result, ops[0], 'UNKNOWN');
  }
  for (const blocker of ['PRIVATE', ' MAINTENANCE_CUSTODY_RESERVED', { toString: () => 'MAINTENANCE_CUSTODY_RESERVED' }]) {
    const result = await execute(command(), { ...options,
      runMaintenanceCustodyRecoveryFn: async () => ({ ok: false, blocker,
        diagnostic: { code: 'MAINTENANCE_CUSTODY_RESERVED', diagnosticOnly: true } }) });
    assert.equal(result.ok, false);
    assertPublicDiagnostic(result, ops[0], 'UNKNOWN');
  }
});

test('diagnostic re-projection fails closed on malformed data and is idempotent without authority', () => {
  const malformed = [null, 'MAINTENANCE_CUSTODY_RESERVED', [], {},
    Object.assign([], { code: 'MAINTENANCE_CUSTODY_RESERVED', diagnosticOnly: true }),
    { code: 'SECRET', diagnosticOnly: true },
    { code: 'MAINTENANCE_CUSTODY_RESERVED', diagnosticOnly: false },
    { code: 'MAINTENANCE_CUSTODY_RESERVED', diagnosticOnly: 'true' },
    { code: { toString: () => 'MAINTENANCE_CUSTODY_RESERVED' }, diagnosticOnly: true }];
  for (const diagnostic of malformed) {
    const raw = { diagnostic, prepared: false, held: false, custodyReleased: true,
      pcRestartAllowed: true, sourceLeaseReleased: true, stage: 'PRIVATE', cause: 'SECRET' };
    const once = project(raw, ops[0]);
    assert.deepEqual(once.maintenanceRecovery.diagnostic, { code: 'UNKNOWN', diagnosticOnly: true });
    assert.deepEqual(project(once, ops[0]), once);
    assertPublicDiagnostic({ ok: false, ...raw }, ops[0], 'UNKNOWN');
  }
  const valid = project({ diagnostic: { code: 'ENOENT', diagnosticOnly: true, cause: 'SECRET', stage: 'PRIVATE' } }, ops[0]);
  assert.deepEqual(valid.maintenanceRecovery.diagnostic, { code: 'ENOENT', diagnosticOnly: true });
  assert.deepEqual(project(valid, ops[0]), valid);
  assert.doesNotMatch(JSON.stringify(valid), /SECRET|PRIVATE|cause|stage/);
  assert.deepEqual(project({ diagnostic: malformed[0] }, 'UNREGISTERED'), {});
});
