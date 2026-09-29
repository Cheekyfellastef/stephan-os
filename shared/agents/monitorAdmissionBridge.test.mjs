import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  admitLogicalMonitor,
  MONITOR_ADMISSION_MAX_IDEMPOTENCY_ENTRIES,
  MONITOR_ADMISSION_ENVELOPE_VERSION,
  MONITOR_ADMISSION_HANDLER_CATALOGUE,
  MONITOR_ADMISSION_OPERATIONS,
  MONITOR_ADMISSION_PROPOSAL_VERSION,
  proposalToMonitorDefinition,
  validateMonitorAdmissionEnvelope,
} from './monitorAdmissionBridge.mjs';

const NOW = Date.parse('2026-08-01T12:00:00.000Z');
const OWNER = 'stephan';
const CLAIMS_HASH = 'a'.repeat(64);
const root = () => mkdtemp(join(tmpdir(), 'monitor-admission-'));
function request(overrides = {}, proposalOverrides = {}) {
  return {
    schemaVersion: MONITOR_ADMISSION_ENVELOPE_VERSION,
    operation: MONITOR_ADMISSION_OPERATIONS.UPSERT,
    owner: OWNER,
    claimsHash: CLAIMS_HASH,
    requestId: 'request-1',
    issuedAtUtc: '2026-08-01T11:59:00.000Z',
    expiresAtUtc: '2026-08-01T12:05:00.000Z',
    idempotencyKey: 'intent-1',
    proposal: {
      schemaVersion: MONITOR_ADMISSION_PROPOSAL_VERSION,
      monitorId: 'release-watch', idempotencyKey: 'intent-1', handlerType: 'RELEASE_ANNOUNCEMENT',
      boundedSubject: { product: 'VR mod', publisher: 'Luke Ross', channel: 'public/free' },
      schedule: { intervalMs: 60_000, nextDueUtc: '2026-08-01T12:05:00.000Z' },
      mode: 'RECURRING', notificationPolicy: 'STATE_CHANGE', relatedIssueOrGoal: '#1585', enabled: true,
      proofRefs: ['proof/release-watch.json'], ...proposalOverrides,
    },
    ...overrides,
  };
}
const options = (workspace) => ({ root: workspace, repoRoot: process.cwd(), authenticatedPrincipal: { subject: OWNER, claimsHash: CLAIMS_HASH }, nowMs: NOW });

test('catalogue is provider-neutral, bounded and covers every required family', () => {
  assert.deepEqual(Object.keys(MONITOR_ADMISSION_HANDLER_CATALOGUE), [
    'GITHUB_STATE', 'RELEASE_ANNOUNCEMENT', 'NEWS_TOPIC_CHANGE', 'WEATHER_CONDITION',
    'MARKET_RATE_THRESHOLD', 'WORKSPACE_HEALTH', 'SCHEDULED_SUMMARY', 'ONE_SHOT_REMINDER',
  ]);
  for (const entry of Object.values(MONITOR_ADMISSION_HANDLER_CATALOGUE)) {
    assert.ok(entry.subjectFields.length); assert.ok(entry.maximumRuntimeMs <= 120_000);
    assert.doesNotMatch(entry.routeClass, /codex|shell|browser/i);
    assert.equal(entry.fallbackVerdict, 'MONITOR_ADMISSION_FALLBACK_REQUIRED');
  }
});

test('authenticated claims, expiry, unknown fields and all executable authority fail closed', () => {
  const hostile = [
    request({ owner: 'attacker' }), request({ claimsHash: 'b'.repeat(64) }), request({ expiresAtUtc: '2026-08-01T11:00:00.000Z' }),
    request({ surprise: true }), request({}, { command: 'whoami' }), request({}, { nested: { shell: 'sh' } }),
    request({}, { boundedSubject: { product: 'x', url: 'https://evil.invalid' } }),
    request({}, { boundedSubject: { product: '/workspace/secret' } }), request({}, { handlerType: 'ARBITRARY_JOB' }),
    request({}, { proofRefs: ['../secret'] }),
  ];
  for (const envelope of hostile) assert.equal(validateMonitorAdmissionEnvelope(envelope, options('/tmp')).valid, false);
  assert.equal(validateMonitorAdmissionEnvelope(request(), { nowMs: NOW }).valid, false);
  assert.equal(validateMonitorAdmissionEnvelope(null, options('/tmp')).valid, false);
});

test('array subjects reject URLs, paths, oversized items, counts, and aggregate payloads', () => {
  const subjects = [
    { product: 'x', keywords: ['https://evil.invalid'] },
    { product: 'x', keywords: ['/workspace/private'] },
    { product: 'x', keywords: ['x'.repeat(241)] },
    { product: 'x', keywords: Array.from({ length: 33 }, () => 'x') },
    { product: 'x'.repeat(3000), keywords: ['x'] },
  ];
  for (const boundedSubject of subjects) assert.equal(validateMonitorAdmissionEnvelope(request({}, { boundedSubject }), options('/tmp')).valid, false);
});

test('proposal converts deterministically to runner-registry-only multiplexer shape', () => {
  const proposal = request().proposal;
  assert.deepEqual(proposalToMonitorDefinition(proposal), proposalToMonitorDefinition(structuredClone(proposal)));
  const definition = proposalToMonitorDefinition(proposal);
  assert.equal(definition.handlerId, 'release-announcement');
  assert.equal(definition.runnerRegistryOnly, true);
  assert.equal(definition.arbitraryShellAllowed, false);
  assert.equal(definition.sourceMutationAllowed, false);
  assert.equal(definition.maxRuntimeMs, 120_000);
});

test('upsert remains explicitly non-ready until canonical multiplexer consumption exists', async () => {
  const workspace = await root();
  const result = await admitLogicalMonitor(request(), options(workspace));
  assert.equal(result.ok, false); assert.equal(result.reason, 'MULTIPLEXER_PROJECTION_NOT_PROVEN');
  assert.equal(result.handlerExecuted, false); assert.equal(result.standaloneFallbackCreated, false);
  assert.equal(result.receipt.monitorId, 'release-watch'); assert.equal(result.receipt.handlerExecuted, false);
  const registry = JSON.parse(await readFile(join(workspace, 'status', 'monitor-admission-registry.json'), 'utf8'));
  assert.equal(Object.keys(registry.monitors).length, 1);
  assert.equal(registry.notificationSurface, 'chatgpt-task-outbox');
  assert.equal(registry.idempotency['intent-1'].state, 'committed');
});

test('identical retry is idempotent and conflicting replay fails closed', async () => {
  const workspace = await root(); const config = options(workspace);
  await admitLogicalMonitor(request(), config);
  const retry = await admitLogicalMonitor(request(), config);
  assert.equal(retry.ok, false); assert.equal(retry.idempotentRetry, true); assert.equal(retry.monitorCount, 1);
  const conflict = await admitLogicalMonitor(request({}, { boundedSubject: { product: 'different' } }), config);
  assert.equal(conflict.ok, false); assert.equal(conflict.blocker, 'IDEMPOTENCY_REPLAY_CONFLICT');
});

test('updates preserve identity and disable/read affect only selected monitor', async () => {
  const workspace = await root(); const config = options(workspace);
  await admitLogicalMonitor(request(), config);
  const update = request({ requestId: 'request-2', idempotencyKey: 'intent-2' }, { idempotencyKey: 'intent-2', schedule: { intervalMs: 120_000, nextDueUtc: '2026-08-01T12:05:00.000Z' } });
  assert.equal((await admitLogicalMonitor(update, config)).reason, 'MULTIPLEXER_PROJECTION_NOT_PROVEN');
  const disable = request({ operation: MONITOR_ADMISSION_OPERATIONS.DISABLE, requestId: 'request-3', idempotencyKey: 'disable-1', monitorId: 'release-watch' }); delete disable.proposal;
  assert.equal((await admitLogicalMonitor(disable, config)).reason, 'MULTIPLEXER_PROJECTION_NOT_PROVEN');
  const read = request({ operation: MONITOR_ADMISSION_OPERATIONS.READ, requestId: 'request-4', idempotencyKey: 'read-1', monitorId: 'release-watch' }); delete read.proposal;
  const status = await admitLogicalMonitor(read, config);
  assert.equal(status.ok, true); assert.equal(status.monitor.monitorId, 'release-watch'); assert.equal(status.monitor.definition.enabled, false);
});

test('unsupported admission writes one fallback receipt and no monitor', async () => {
  const workspace = await root();
  const result = await admitLogicalMonitor(request({}, { handlerType: 'UNSUPPORTED' }), options(workspace));
  assert.equal(result.ok, false); assert.equal(result.reason, 'MONITOR_ADMISSION_FALLBACK_REQUIRED');
  assert.equal(result.fallbackReason, 'MULTIPLEXER_HANDLER_UNSUPPORTED'); assert.equal(result.durable, true);
  assert.equal(result.receipt.standaloneFallbackCreated, false);
});

test('rejected request identities cannot overwrite an accepted request receipt', async () => {
  const workspace = await root();
  const accepted = await admitLogicalMonitor(request(), options(workspace));
  const acceptedPath = join(workspace, 'receipts', `${accepted.receipt.receiptId}.json`);
  const acceptedBytes = await readFile(acceptedPath, 'utf8');
  const rejected = await admitLogicalMonitor(request({ owner: 'attacker' }), options(workspace));
  assert.equal(rejected.ok, false);
  assert.match(rejected.receipt.receiptId, /^monitor-admission-rejected-/);
  assert.notEqual(rejected.receipt.receiptId, accepted.receipt.receiptId);
  assert.equal(await readFile(acceptedPath, 'utf8'), acceptedBytes);
});

test('null envelopes return durable fallback evidence without dereferencing input', async () => {
  const workspace = await root();
  const result = await admitLogicalMonitor(null, options(workspace));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'MONITOR_ADMISSION_FALLBACK_REQUIRED');
  assert.equal(result.fallbackReason, 'MONITOR_ADMISSION_BLOCKED');
  assert.equal(result.durable, true);
  assert.match(result.receipt.receiptId, /^monitor-admission-rejected-/);
});

test('unavailable storage returns fallback required without fabricated durability', async () => {
  const result = await admitLogicalMonitor(request(), { root: process.cwd(), repoRoot: process.cwd(), authenticatedPrincipal: { subject: OWNER, claimsHash: CLAIMS_HASH }, nowMs: NOW });
  assert.equal(result.ok, false); assert.equal(result.reason, 'MONITOR_ADMISSION_FALLBACK_REQUIRED');
  assert.equal(result.fallbackReason, 'MULTIPLEXER_ADMISSION_UNAVAILABLE'); assert.equal(result.durable, false);
});

test('capacity edge rejects monitor 1001', async () => {
  const workspace = await root(); const config = options(workspace);
  const first = request(); await admitLogicalMonitor(first, config);
  const registryPath = join(workspace, 'status', 'monitor-admission-registry.json');
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  for (let index = 1; index < 1000; index += 1) {
    const monitorId = `m-${index}`;
    const proposal = { ...registry.monitors['release-watch'].proposal, monitorId };
    registry.monitors[monitorId] = {
      ...registry.monitors['release-watch'],
      monitorId,
      proposal,
      definition: proposalToMonitorDefinition(proposal),
    };
  }
  await writeFile(registryPath, JSON.stringify(registry));
  const extra = request({ requestId: 'request-extra', idempotencyKey: 'intent-extra' }, { monitorId: 'extra', idempotencyKey: 'intent-extra' });
  const result = await admitLogicalMonitor(extra, config);
  assert.equal(result.ok, false); assert.equal(result.blocker, 'MONITOR_REGISTRY_CAPACITY_REACHED');
});

test('prototype identities are own properties and proposal provenance is preserved', async () => {
  const workspace = await root();
  const hostileName = request({ idempotencyKey: 'constructor' }, { monitorId: 'constructor', idempotencyKey: 'constructor', relatedIssueOrGoal: '#42' });
  const result = await admitLogicalMonitor(hostileName, options(workspace));
  assert.equal(result.reason, 'MULTIPLEXER_PROJECTION_NOT_PROVEN');
  assert.equal(result.receipt.relatedIssue, '#42');
  assert.equal(result.receipt.relatedIssueOrGoal, '#42');
  assert.equal(result.receipt.claimsHash, CLAIMS_HASH);
});

test('concurrent admissions are serialized without losing either monitor', async () => {
  const workspace = await root(); const config = options(workspace);
  const second = request({ requestId: 'request-2', idempotencyKey: 'intent-2' }, { monitorId: 'second', idempotencyKey: 'intent-2' });
  await Promise.all([admitLogicalMonitor(request(), config), admitLogicalMonitor(second, config)]);
  const registry = JSON.parse(await readFile(join(workspace, 'status', 'monitor-admission-registry.json'), 'utf8'));
  assert.deepEqual(Object.keys(registry.monitors).sort(), ['release-watch', 'second']);
  assert.deepEqual(Object.keys(registry.idempotency).sort(), ['intent-1', 'intent-2']);
});

test('abandoned registry lock is reclaimed through the canonical operation lease', async () => {
  const workspace = await root();
  await mkdir(join(workspace, 'locks', 'monitor-admission-registry.lock'), { recursive: true });
  await utimes(join(workspace, 'locks', 'monitor-admission-registry.lock'), new Date(0), new Date(0));
  const result = await admitLogicalMonitor(request(), {
    ...options(workspace),
    operationStaleLockMs: 1,
    operationLockHeartbeatMs: 1,
  });
  assert.equal(result.reason, 'MULTIPLEXER_PROJECTION_NOT_PROVEN');
});

test('idempotency history compacts oldest committed results at its independent bound', async () => {
  const workspace = await root(); const config = options(workspace);
  await admitLogicalMonitor(request(), config);
  const registryPath = join(workspace, 'status', 'monitor-admission-registry.json');
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  const template = registry.idempotency['intent-1'];
  for (let index = 1; index < MONITOR_ADMISSION_MAX_IDEMPOTENCY_ENTRIES; index += 1) {
    registry.idempotency[`history-${index}`] = {
      ...template,
      fingerprint: String(index).padStart(64, '0'),
      updatedAtUtc: new Date(NOW - ((MONITOR_ADMISSION_MAX_IDEMPOTENCY_ENTRIES - index) * 1000)).toISOString(),
    };
  }
  await writeFile(registryPath, JSON.stringify(registry));
  const next = request({ requestId: 'request-next', idempotencyKey: 'intent-next' }, { idempotencyKey: 'intent-next' });
  assert.equal((await admitLogicalMonitor(next, config)).reason, 'MULTIPLEXER_PROJECTION_NOT_PROVEN');
  const compacted = JSON.parse(await readFile(registryPath, 'utf8'));
  assert.equal(Object.keys(compacted.idempotency).length, MONITOR_ADMISSION_MAX_IDEMPOTENCY_ENTRIES);
  assert.equal(compacted.idempotency['intent-next'].state, 'committed');
  assert.equal(compacted.idempotency['history-1'], undefined);
});

test('pending publication is repaired on retry before idempotency commits', async () => {
  const workspace = await root(); let calls = 0;
  const failReceiptOnce = async (...args) => {
    calls += 1;
    if (calls === 3) return { ok: false, reason: 'INJECTED_FAILURE' };
    const { writeAtomicJson } = await import('./sharedAgentWorkspaceStore.mjs');
    return writeAtomicJson(...args);
  };
  const first = await admitLogicalMonitor(request(), { ...options(workspace), testWriteAtomicJson: failReceiptOnce });
  assert.equal(first.reason, 'MONITOR_ADMISSION_FALLBACK_REQUIRED');
  let registry = JSON.parse(await readFile(join(workspace, 'status', 'monitor-admission-registry.json'), 'utf8'));
  assert.equal(registry.idempotency['intent-1'].state, 'pending');
  const retry = await admitLogicalMonitor(request(), options(workspace));
  assert.equal(retry.reason, 'MULTIPLEXER_PROJECTION_NOT_PROVEN');
  registry = JSON.parse(await readFile(join(workspace, 'status', 'monitor-admission-registry.json'), 'utf8'));
  assert.equal(registry.idempotency['intent-1'].state, 'committed');
});

test('malformed durable state fails closed', async () => {
  const workspace = await root();
  await import('./sharedAgentWorkspaceStore.mjs').then(({ ensureSharedWorkspaceLayout }) => ensureSharedWorkspaceLayout({ root: workspace, repoRoot: process.cwd() }));
  await writeFile(join(workspace, 'status', 'monitor-admission-registry.json'), JSON.stringify({ registrySchemaVersion: 'stephanos.monitor-admission-registry.v1', monitors: {} }));
  const result = await admitLogicalMonitor(request(), options(workspace));
  assert.equal(result.blocker, 'MALFORMED_DURABLE_REGISTRY');
});

test('stored monitor proposal, definition and timestamp require their complete canonical schemas', async () => {
  for (const mutate of [
    (monitor) => { monitor.proposal = { monitorId: monitor.monitorId }; },
    (monitor) => { monitor.definition = {}; },
    (monitor) => { monitor.updatedAtUtc = 'not-a-timestamp'; },
  ]) {
    const workspace = await root();
    await admitLogicalMonitor(request(), options(workspace));
    const registryPath = join(workspace, 'status', 'monitor-admission-registry.json');
    const registry = JSON.parse(await readFile(registryPath, 'utf8'));
    mutate(registry.monitors['release-watch']);
    await writeFile(registryPath, JSON.stringify(registry));
    const read = request({ operation: MONITOR_ADMISSION_OPERATIONS.READ, requestId: 'read-2', idempotencyKey: 'read-2', monitorId: 'release-watch' });
    delete read.proposal;
    const result = await admitLogicalMonitor(read, options(workspace));
    assert.equal(result.blocker, 'MALFORMED_DURABLE_REGISTRY');
  }
});
