import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { executeMaintenanceRecoveryOnBattleBridge as execute, MAINTENANCE_RECOVERY_OPERATIONS as ops,
  projectMaintenanceRecoveryReceiptV1 as project,
  validateMaintenanceRecoveryCommandShape as shape } from './sovereignMaintenanceRecoveryMailboxV1.mjs';
import { validateBattleBridgeGitHubCommand, selectBattleBridgeGitHubCommandBatch,
  executeBattleBridgeGitHubCommand } from './battleBridgeGitHubCommandMailbox.mjs';
import { BATTLE_BRIDGE_GITHUB_COMMAND_MARKER } from './battleBridgeGitHubCommandMailboxCoreV1.mjs';
import { serializeBoundedReceiptJson, createSanitizedMailboxReceiptProjection,
  checkpointTerminalMailboxReceipt } from '../../scripts/battle-bridge-github-command-mailbox.mjs';
import { runMaintenanceCustodyRecoveryV1 } from '../../scripts/sovereign-maintenance-custody-recovery.mjs';
import { collectCanonicalIgnitionSourceTruth } from '../../scripts/battle-bridge-ignition-supervisor.mjs';
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
const unknownConfigurationDiagnostic = { stage: 'UNKNOWN', originCount: 'UNKNOWN',
  originMatch: 'UNKNOWN', riskCategories: ['UNKNOWN'] };

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

function assertPublicDiagnostic(result, operation, code, sourceDiagnostic = {}) {
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
    assert.deepEqual(recovery.diagnostic, { code, diagnosticOnly: true,
      ...(code === 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN'
        ? { sourceCode: 'UNKNOWN', ...sourceDiagnostic } : {}) });
    assert.equal(projected.operationResult.ok, result.ok);
    assert.equal(recovery.custodyReleased, false);
    assert.equal(recovery.pcRestartAllowed, false);
    assert.equal(recovery.sourceLeaseReleased, false);
    assert.doesNotMatch(JSON.stringify(projected), /SECRET|PRIVATE|machineHash|signingKey|stderr|cause/);
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

// Execute the unchanged native reader bytes against a module fixture. No
// production source-reader argument, environment switch or new runtime route.
async function nativeSourceReaderFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'recovery-source-reader-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'shared', 'agents'), { recursive: true });
  const readerPath = join(root, 'scripts', 'sovereign-maintenance-custody-store-v1.mjs');
  writeFileSync(readerPath, readFileSync(new URL('../../scripts/sovereign-maintenance-custody-store-v1.mjs', import.meta.url)));
  const collectorPath = join(root, 'scripts', 'battle-bridge-ignition-supervisor.mjs');
  const realCollector = new URL('../../scripts/battle-bridge-ignition-supervisor.mjs', import.meta.url).href;
  writeFileSync(collectorPath, `export { evaluateCanonicalIgnitionSourceTruth } from ${JSON.stringify(realCollector)};
let result; export function setResult(value) { result = value; }
export function collectCanonicalIgnitionSourceTruth() { return result; }\n`);
  const realProjector = new URL('./sovereignMaintenanceSourceDiagnosticV1.mjs', import.meta.url).href;
  writeFileSync(join(root, 'shared', 'agents', 'sovereignMaintenanceSourceDiagnosticV1.mjs'),
    `export * from ${JSON.stringify(realProjector)};\n`);
  writeFileSync(join(root, 'shared', 'agents', 'goalDiscoveryWorkspaceV1.mjs'),
    'export function resolveGoalDiscoveryWorkspaceV1() { throw new Error("unexpected workspace operation"); }\n');
  writeFileSync(join(root, 'scripts', 'sovereign-maintenance-os-anchor-v1.mjs'),
    'export function createMaintenanceOsAnchorV1() { throw new Error("unexpected custody operation"); }\n');
  return { ...(await import(pathToFileURL(collectorPath).href)),
    ...(await import(pathToFileURL(readerPath).href)) };
}

function collectedSourceFailure({ dirty = false, topologyCode = '', failFetch = false,
  configuration = 'remote.origin.url\nhttps://github.com/Cheekyfellastef/stephan-os.git\0',
  configurationAfter = configuration } = {}) {
  const calls = [];
  let configurationReads = 0;
  const result = collectCanonicalIgnitionSourceTruth({
    createGitProbeContextFn: () => null,
    cwd: '/canonical/repo', platform: 'linux', environment: {},
    inspectTopologyFn: () => topologyCode
      ? { ok: false, blocker: topologyCode, pathname: 'PRIVATE topology path' }
      : { ok: true, stableIdentities: {} },
    spawnSyncFn: (_executable, args) => {
      const operation = args.slice(args.findIndex(value => value.startsWith('--work-tree=')) + 1);
      calls.push(operation[0]);
      let stdout = '';
      if (operation[0] === 'config') stdout = ++configurationReads === 1 ? configuration : configurationAfter;
      else if (operation[0] === 'ls-files') stdout = 'H tracked-source.mjs\n';
      else if (operation[0] === 'status') stdout = dirty ? ' M scripts/PRIVATE-source.mjs\n' : '';
      else if (operation[0] === 'branch') stdout = 'main\n';
      else if (operation.includes('@{upstream}')) stdout = 'origin/main\n';
      else if (operation[0] === 'rev-parse') stdout = head + '\n'
        + (operation.includes('HEAD') && operation.includes('origin/main') ? head + '\n' : '');
      else if (operation[0] === 'rev-list') stdout = '0\t0\n';
      else if (operation[0] === 'fetch') {
        if (failFetch) return { status: 128, stdout: '', stderr: 'PRIVATE credential and path' };
      }
      else assert.fail('unexpected Git step in source-failure fixture');
      return { status: 0, stdout, stderr: '' };
    },
  });
  return { result, calls };
}

test('actual native source-reader failures survive the execute wrapper and every public path without owner execution', async t => {
  const native = await nativeSourceReaderFixture(t);
  const cases = [
    [collectedSourceFailure({ dirty: true }), { sourceCode: 'CANONICAL_CHECKOUT_DIRTY' }, ['config', 'ls-files', 'status']],
    [collectedSourceFailure({ topologyCode: 'GIT_OBJECT_ALTERNATES_PRESENT' }), { sourceCode: 'GIT_OBJECT_ALTERNATES_PRESENT' }, []],
    [collectedSourceFailure({ failFetch: true }), { sourceCode: 'FIXED_AUTHORITY_GIT_FAILED', sourceStep: 'source-fetch' },
      ['config', 'ls-files', 'status', 'branch', 'rev-parse', 'rev-parse', 'fetch']],
  ];
  for (const [{ result: source, calls }, expected, expectedCalls] of cases) {
    assert.deepEqual(calls, expectedCalls);
    native.setResult(source);
    for (const operation of ops) {
      let runnerCalls = 0;
      const result = await executeBattleBridgeGitHubCommand(command({ operation,
        ...(operation === ops[1] ? { expectedCycle: cycle, expectedReportSha256: digest } : {}) }), {
        readMaintenanceRecoverySourceFn: native.readMaintenanceRecoverySourceV1,
        runMaintenanceCustodyRecoveryFn: async () => { runnerCalls++; assert.fail('source rejection ran recovery'); },
      });
      assert.equal(runnerCalls, 0);
      assert.equal(result.ok, false);
      assert.equal(result.blocker, 'RECOVERY_MAILBOX_RECOVERY_UNPROVEN');
      assertPublicDiagnostic(result, operation, 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN', expected);
    }
  }
});

test('real configuration refusals survive native reading, execute and every public projection without invoking recovery', async t => {
  const native = await nativeSourceReaderFixture(t);
  const baseline = 'remote.origin.url\nhttps://github.com/Cheekyfellastef/stephan-os.git\0';
  const noncanonical = 'remote.origin.url\nhttps://PRIVATE:SECRET@example.invalid/repo.git\0';
  const risky = 'credential.https://PRIVATE:SECRET@example.invalid.helper\nPRIVATE command\0'
    + 'http.https://PRIVATE:SECRET@example.invalid.extraheader\nSECRET value\0'
    + 'core.fsmonitor\nPRIVATE command\0includeif.gitdir:PRIVATE_SECRET.path\nPRIVATE path\0';
  for (const [configuration, expected] of [
    ['', { originCount: 'ZERO', originMatch: 'UNKNOWN', riskCategories: [] }],
    ['PRIVATE malformed configuration\0', { originCount: 'ZERO', originMatch: 'UNKNOWN', riskCategories: [] }],
    [noncanonical, { originCount: 'ONE', originMatch: 'NONCANONICAL', riskCategories: [] }],
    [baseline + baseline, { originCount: 'MULTIPLE', originMatch: 'CANONICAL', riskCategories: [] }],
    [baseline + noncanonical + risky, { originCount: 'MULTIPLE', originMatch: 'NONCANONICAL',
      riskCategories: ['CORE_FSMONITOR', 'CREDENTIAL', 'HTTP', 'INCLUDE_IF'] }],
  ]) {
    const { result: source, calls } = collectedSourceFailure({ configuration });
    assert.equal(source.ok, false);
    assert.deepEqual(calls, ['config']);
    native.setResult(source);
    let thrown;
    try { native.readMaintenanceRecoverySourceV1(); } catch (error) { thrown = error; }
    assert.equal(thrown?.message, 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN');
    assert.deepEqual(thrown.sourceConfiguration, { stage: 'BEFORE_FETCH', ...expected });
    assert.doesNotMatch(JSON.stringify(thrown), /PRIVATE|SECRET|https|riskyKeys|configurationProof/);
    for (const operation of ops) {
      let runnerCalls = 0;
      const result = await executeBattleBridgeGitHubCommand(command({ operation,
        ...(operation === ops[1] ? { expectedCycle: cycle, expectedReportSha256: digest } : {}) }), {
        readMaintenanceRecoverySourceFn: native.readMaintenanceRecoverySourceV1,
        runMaintenanceCustodyRecoveryFn: async () => { runnerCalls++; assert.fail('configuration rejection ran recovery'); },
      });
      assert.equal(runnerCalls, 0);
      assert.equal(result.ok, false);
      assert.equal(result.blocker, 'RECOVERY_MAILBOX_RECOVERY_UNPROVEN');
      assertPublicDiagnostic(result, operation, 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN',
        { sourceCode: 'CANONICAL_GIT_CONFIGURATION_INVALID',
          sourceConfiguration: { stage: 'BEFORE_FETCH', ...expected } });
    }
  }
});

test('actual after-fetch configuration refusals remain red and valid source keeps the existing recovery invocation', async t => {
  const native = await nativeSourceReaderFixture(t);
  const baseline = 'remote.origin.url\nhttps://github.com/Cheekyfellastef/stephan-os.git\0';
  for (const [configurationAfter, sourceCode, riskCategories] of [
    [baseline + 'http.https://PRIVATE:SECRET@example.invalid.extraheader\nPRIVATE value\0',
      'CANONICAL_GIT_CONFIGURATION_INVALID', ['HTTP']],
    [baseline + 'harmless.PRIVATE_SECRET\nPRIVATE value\0', 'CANONICAL_GIT_CONFIGURATION_CHANGED', []],
  ]) {
    const { result: source, calls } = collectedSourceFailure({ configurationAfter });
    assert.equal(source.ok, false);
    assert.equal(source.blocker.code, sourceCode);
    assert.equal(calls.filter(call => call === 'config').length, 2);
    assert.equal(calls.filter(call => call === 'fetch').length, 1);
    native.setResult(source);
    for (const operation of ops) {
      let runnerCalls = 0;
      const result = await executeBattleBridgeGitHubCommand(command({ operation,
        ...(operation === ops[1] ? { expectedCycle: cycle, expectedReportSha256: digest } : {}) }), {
        readMaintenanceRecoverySourceFn: native.readMaintenanceRecoverySourceV1,
        runMaintenanceCustodyRecoveryFn: async () => { runnerCalls++; assert.fail('configuration drift ran recovery'); },
      });
      assert.equal(result.ok, false);
      assert.equal(runnerCalls, 0);
      assertPublicDiagnostic(result, operation, 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN',
        { sourceCode, sourceConfiguration: { stage: 'AFTER_FETCH',
          originCount: 'ONE', originMatch: 'CANONICAL', riskCategories } });
    }
  }
  const clean = collectedSourceFailure();
  assert.equal(clean.result.ok, true);
  native.setResult(clean.result);
  assert.equal(native.readMaintenanceRecoverySourceV1(), head);
  let invoked;
  const result = await executeBattleBridgeGitHubCommand(command(), {
    ...options, readMaintenanceRecoverySourceFn: native.readMaintenanceRecoverySourceV1,
    runMaintenanceCustodyRecoveryFn: async input => { invoked = input;
      return options.runMaintenanceCustodyRecoveryFn(input); },
  });
  assert.equal(result.ok, true);
  assert.equal(result.diagnostic, undefined);
  assert.deepEqual(invoked, { mode: 'status', expectedMain: head, expectedCycle: undefined,
    expectedReportSha256: undefined, operatorApproval: 'operator-approved' });
});

test('native source diagnostics retain the closed producer vocabulary and reject untrusted codes or steps', async t => {
  const native = await nativeSourceReaderFixture(t);
  const sourceCodes = [
    'CANONICAL_CHECKOUT_DIRTY', 'CANONICAL_GIT_CONFIGURATION_CHANGED', 'CANONICAL_GIT_CONFIGURATION_INVALID',
    'CANONICAL_GIT_METADATA_SCAN_FAILED', 'CANONICAL_GIT_METADATA_SCAN_LIMIT_EXCEEDED',
    'CANONICAL_GIT_REPARSE_POINT_PRESENT', 'CANONICAL_GIT_TOPOLOGY_CHANGED', 'CANONICAL_GIT_TOPOLOGY_INVALID',
    'CANONICAL_GIT_TOPOLOGY_UNPROVEN', 'CANONICAL_MAIN_NOT_CURRENT', 'CANONICAL_MAIN_SOURCE_UNPROVEN',
    'CANONICAL_REMOTE_TRUTH_INVALID', 'CANONICAL_SOURCE_STATUS_INVALID', 'CANONICAL_SOURCE_TRUTH_CHANGED',
    'CANONICAL_SOURCE_TRUTH_UNPROVEN', 'CANONICAL_TRACKED_VISIBILITY_CHANGED', 'CANONICAL_UPSTREAM_UNPROVEN',
    'FIXED_AUTHORITY_GIT_FAILED', 'GIT_COMMON_DIRECTORY_REDIRECT_PRESENT', 'GIT_GRAFTS_PRESENT',
    'GIT_OBJECT_ALTERNATES_PRESENT', 'HIDDEN_TRACKED_PATHS_PRESENT', 'IGNITION_RUNTIME_AGGREGATE_SCAN_FAILED',
  ];
  for (const sourceCode of [...sourceCodes, 'PRIVATE_CODE', ' CANONICAL_CHECKOUT_DIRTY', undefined,
    ['CANONICAL_CHECKOUT_DIRTY'], { toString: () => 'CANONICAL_CHECKOUT_DIRTY' }]) {
    native.setResult({ blocker: { code: sourceCode, sourceStep: 'source-fetch',
      detail: 'PRIVATE source text', pathname: 'SECRET', error: 'PRIVATE' } });
    let thrown;
    try { native.readMaintenanceRecoverySourceV1(); } catch (error) { thrown = error; }
    assert.equal(thrown?.message, 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN');
    const expectedCode = sourceCodes.includes(sourceCode) ? sourceCode : 'UNKNOWN';
    const expected = { sourceCode: expectedCode,
      ...(expectedCode === 'FIXED_AUTHORITY_GIT_FAILED' ? { sourceStep: 'source-fetch' } : {}),
      ...(['CANONICAL_GIT_CONFIGURATION_INVALID', 'CANONICAL_GIT_CONFIGURATION_CHANGED'].includes(expectedCode)
        ? { sourceConfiguration: unknownConfigurationDiagnostic } : {}) };
    assert.equal(thrown.sourceCode, expectedCode);
    assert.equal(thrown.sourceStep, expected.sourceStep);
    assert.doesNotMatch(JSON.stringify(thrown), /PRIVATE|SECRET|detail|pathname/);
    const result = await execute(command(), { ...options,
      readMaintenanceRecoverySourceFn: native.readMaintenanceRecoverySourceV1 });
    assertPublicDiagnostic(result, ops[0], 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN', expected);
  }
  for (const sourceStep of [undefined, 'PRIVATE_STEP', ' source-fetch', ['source-fetch'],
    { toString: () => 'source-fetch' }]) {
    native.setResult({ blocker: { code: 'FIXED_AUTHORITY_GIT_FAILED', sourceStep } });
    const result = await execute(command(), { ...options,
      readMaintenanceRecoverySourceFn: native.readMaintenanceRecoverySourceV1 });
    assertPublicDiagnostic(result, ops[0], 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN',
      { sourceCode: 'FIXED_AUTHORITY_GIT_FAILED', sourceStep: 'UNKNOWN' });
  }
});

test('actual native reader preserves source predicates and does not accept a blocker merely because its head matches', async t => {
  const native = await nativeSourceReaderFixture(t);
  const clean = { publicationState: 'healthy-synced', branch: 'main', detachedHead: false,
    hasUpstream: true, upstreamBranch: 'origin/main', workingTreeDirty: false, aheadCount: 0, behindCount: 0,
    headPublished: true, blockedForRemoteTruth: false, head, originHead: head };
  native.setResult(clean);
  assert.equal(native.readMaintenanceRecoverySourceV1(), head);
  for (const extra of [{ blocker: { code: 'CANONICAL_CHECKOUT_DIRTY' } }, { workingTreeDirty: true },
    { branch: 'other' }, { detachedHead: true }, { upstreamBranch: 'origin/other' }, { hasUpstream: false },
    { aheadCount: 1 }, { behindCount: 1 }, { headPublished: false }, { blockedForRemoteTruth: true },
    { publicationState: 'unknown' }, { head: 'invalid' }, { originHead: 'c'.repeat(40) }]) {
    native.setResult({ ...clean, ...extra });
    assert.throws(() => native.readMaintenanceRecoverySourceV1(),
      { message: 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN' });
  }
});

test('public source diagnostic fields are closed, operation-bound and idempotent without new authority', () => {
  const examples = [
    [{ sourceCode: 'CANONICAL_CHECKOUT_DIRTY', sourceStep: 'source-fetch' }, { sourceCode: 'CANONICAL_CHECKOUT_DIRTY' }],
    [{ sourceCode: 'FIXED_AUTHORITY_GIT_FAILED', sourceStep: 'source-fetch' },
      { sourceCode: 'FIXED_AUTHORITY_GIT_FAILED', sourceStep: 'source-fetch' }],
    [{ sourceCode: 'FIXED_AUTHORITY_GIT_FAILED', sourceStep: 'PRIVATE_STEP' },
      { sourceCode: 'FIXED_AUTHORITY_GIT_FAILED', sourceStep: 'UNKNOWN' }],
    [{ sourceCode: 'PRIVATE_CODE', sourceStep: 'source-fetch' }, { sourceCode: 'UNKNOWN' }],
    [{ sourceCode: { toString: () => 'CANONICAL_CHECKOUT_DIRTY' } }, { sourceCode: 'UNKNOWN' }],
  ];
  for (const [fields, expected] of examples) {
    const result = { ok: false, diagnostic: { code: 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN',
      diagnosticOnly: true, ...fields, detail: 'SECRET', cause: 'PRIVATE', configKeys: ['PRIVATE'] } };
    assertPublicDiagnostic(result, ops[0], 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN', expected);
    const once = project(result, ops[0]);
    assert.deepEqual(project(once, ops[0]), once);
  }
  const other = project({ diagnostic: { code: 'ENOENT', diagnosticOnly: true,
    sourceCode: 'CANONICAL_CHECKOUT_DIRTY', sourceStep: 'source-fetch' } }, ops[0]);
  assert.deepEqual(other.maintenanceRecovery.diagnostic, { code: 'ENOENT', diagnosticOnly: true });
  assert.deepEqual(project({ diagnostic: { code: 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN',
    diagnosticOnly: true, sourceCode: 'CANONICAL_CHECKOUT_DIRTY' } }, 'UNREGISTERED'), {});
});

test('configuration projection retains every finite category and rejects malformed or private metadata', () => {
  const categories = [
    'ALIAS', 'CORE_WORKTREE', 'CORE_SPARSE_CHECKOUT', 'CORE_SPARSE_CHECKOUT_CONE', 'INDEX_SPARSE',
    'CORE_HOOKS_PATH', 'CORE_FSMONITOR', 'CORE_TRUST_CTIME', 'CORE_CHECK_STAT', 'CORE_IGNORE_STAT',
    'CORE_UNTRACKED_CACHE', 'CORE_SSH_COMMAND', 'CORE_ALTERNATE_REFS_COMMAND', 'CORE_ASKPASS',
    'CORE_GIT_PROXY', 'CORE_PAGER', 'DIFF_EXTERNAL', 'CREDENTIAL', 'FILTER', 'DIFF_COMMAND',
    'DIFF_TEXTCONV', 'MERGE_DRIVER', 'BRANCH_MERGE_OPTIONS', 'REMOTE_VCS', 'REMOTE_PROXY',
    'REMOTE_UPLOAD_PACK', 'REMOTE_RECEIVE_PACK', 'URL_REWRITE', 'INCLUDE_PATH', 'INCLUDE_IF',
    'PROTOCOL', 'EXTENSIONS_WORKTREE_CONFIG', 'SUBMODULE_UPDATE', 'GC_HOOK_OR_COMMAND',
    'GC_RECENT_OBJECTS_HOOK', 'PAGER', 'INTERACTIVE_DIFF_FILTER', 'SEQUENCE_EDITOR', 'CORE_EDITOR',
    'GPG', 'COMMIT_GPG_SIGN', 'TAG_GPG_SIGN', 'HTTP',
  ].sort();
  const good = { stage: 'AFTER_FETCH', originCount: 'MULTIPLE', originMatch: 'NONCANONICAL',
    riskCategories: categories };
  const cases = [
    [good, good],
    [undefined, unknownConfigurationDiagnostic],
    [null, unknownConfigurationDiagnostic],
    ['PRIVATE', unknownConfigurationDiagnostic],
    [[], unknownConfigurationDiagnostic],
    [{}, unknownConfigurationDiagnostic],
    [{ stage: 'before_fetch', originCount: 1, originMatch: true,
      riskCategories: 'HTTP' }, unknownConfigurationDiagnostic],
    [{ stage: ['BEFORE_FETCH'], originCount: { toString() { throw new Error('SECRET'); } },
      originMatch: 'CANONICAL ', riskCategories: [{ toString() { throw new Error('SECRET'); } }] },
      unknownConfigurationDiagnostic],
    [{ ...good, riskCategories: ['HTTP', 'PRIVATE credential.https://SECRET', 'HTTP'] },
      { ...good, riskCategories: ['HTTP', 'UNKNOWN'] }],
    [{ ...good, riskCategories: Array(1) }, { ...good, riskCategories: ['UNKNOWN'] }],
    [{ ...good, riskCategories: Array(1000).fill('HTTP') }, { ...good, riskCategories: ['UNKNOWN'] }],
    [{ stage: 'BEFORE_FETCH', originCount: 'ONE', originMatch: 'CANONICAL', riskCategories: [],
      rawKeys: ['http.PRIVATE_SECRET'], rawValues: ['PRIVATE_SECRET'], command: 'PRIVATE', path: 'SECRET' },
      { stage: 'BEFORE_FETCH', originCount: 'ONE', originMatch: 'CANONICAL', riskCategories: [] }],
  ];
  for (const sourceCode of ['CANONICAL_GIT_CONFIGURATION_INVALID', 'CANONICAL_GIT_CONFIGURATION_CHANGED']) {
    for (const [sourceConfiguration, expected] of cases) {
      const result = { ok: false, diagnostic: { code: 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN',
        diagnosticOnly: true, sourceCode, sourceConfiguration, raw: 'PRIVATE_SECRET' } };
      assertPublicDiagnostic(result, ops[0], 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN',
        { sourceCode, sourceConfiguration: expected });
      const once = project(result, ops[0]);
      assert.deepEqual(project(once, ops[0]), once);
    }
  }
  for (const sourceCode of ['CANONICAL_CHECKOUT_DIRTY', 'UNKNOWN', 'PRIVATE']) {
    const result = { ok: false, diagnostic: { code: 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN',
      diagnosticOnly: true, sourceCode, sourceConfiguration: good } };
    assertPublicDiagnostic(result, ops[0], 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN',
      { sourceCode: sourceCode === 'PRIVATE' ? 'UNKNOWN' : sourceCode });
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
