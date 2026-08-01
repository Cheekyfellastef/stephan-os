import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  admitLogicalMonitor,
  MONITOR_ADMISSION_ENVELOPE_VERSION,
  MONITOR_ADMISSION_HANDLER_CATALOGUE,
  MONITOR_ADMISSION_OPERATIONS,
  MONITOR_ADMISSION_PROPOSAL_VERSION,
  proposalToMonitorDefinition,
  validateMonitorAdmissionEnvelope,
} from './monitorAdmissionBridge.mjs';

const NOW = Date.parse('2026-08-01T12:00:00.000Z');
const OWNER = 'stephan';
const root = () => mkdtemp(join(tmpdir(), 'monitor-admission-'));
function request(overrides = {}, proposalOverrides = {}) {
  return {
    schemaVersion: MONITOR_ADMISSION_ENVELOPE_VERSION,
    operation: MONITOR_ADMISSION_OPERATIONS.UPSERT,
    owner: OWNER,
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
const options = (workspace) => ({ root: workspace, repoRoot: process.cwd(), trustedOwner: OWNER, nowMs: NOW });

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

test('authentication, expiry, unknown fields and all executable authority fail closed', () => {
  const hostile = [
    request({ owner: 'attacker' }), request({ expiresAtUtc: '2026-08-01T11:00:00.000Z' }),
    request({ surprise: true }), request({}, { command: 'whoami' }), request({}, { nested: { shell: 'sh' } }),
    request({}, { boundedSubject: { product: 'x', url: 'https://evil.invalid' } }),
    request({}, { boundedSubject: { product: '/workspace/secret' } }), request({}, { handlerType: 'ARBITRARY_JOB' }),
    request({}, { proofRefs: ['../secret'] }),
  ];
  for (const envelope of hostile) assert.equal(validateMonitorAdmissionEnvelope(envelope, { trustedOwner: OWNER, nowMs: NOW }).valid, false);
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

test('upsert publishes truthful registration evidence without executing a handler', async () => {
  const workspace = await root();
  const result = await admitLogicalMonitor(request(), options(workspace));
  assert.equal(result.ok, true); assert.equal(result.reason, 'MULTIPLEXER_ADMISSION_READY');
  assert.equal(result.handlerExecuted, false); assert.equal(result.standaloneFallbackCreated, false);
  assert.equal(result.receipt.monitorId, 'release-watch'); assert.equal(result.receipt.handlerExecuted, false);
  const registry = JSON.parse(await readFile(join(workspace, 'status', 'monitor-admission-registry.json'), 'utf8'));
  assert.equal(Object.keys(registry.monitors).length, 1);
  assert.equal(registry.notificationSurface, 'chatgpt-task-outbox');
});

test('identical retry is idempotent and conflicting replay fails closed', async () => {
  const workspace = await root(); const config = options(workspace);
  await admitLogicalMonitor(request(), config);
  const retry = await admitLogicalMonitor(request(), config);
  assert.equal(retry.ok, true); assert.equal(retry.idempotentRetry, true); assert.equal(retry.monitorCount, 1);
  const conflict = await admitLogicalMonitor(request({}, { boundedSubject: { product: 'different' } }), config);
  assert.equal(conflict.ok, false); assert.equal(conflict.blocker, 'IDEMPOTENCY_REPLAY_CONFLICT');
});

test('updates preserve identity and disable/read affect only selected monitor', async () => {
  const workspace = await root(); const config = options(workspace);
  await admitLogicalMonitor(request(), config);
  const update = request({ requestId: 'request-2', idempotencyKey: 'intent-2' }, { idempotencyKey: 'intent-2', schedule: { intervalMs: 120_000, nextDueUtc: '2026-08-01T12:05:00.000Z' } });
  assert.equal((await admitLogicalMonitor(update, config)).reason, 'MONITOR_UPDATE_APPLIED');
  const disable = request({ operation: MONITOR_ADMISSION_OPERATIONS.DISABLE, requestId: 'request-3', idempotencyKey: 'disable-1', monitorId: 'release-watch' }); delete disable.proposal;
  assert.equal((await admitLogicalMonitor(disable, config)).reason, 'MONITOR_DISABLED');
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

test('unavailable storage returns fallback required without fabricated durability', async () => {
  const result = await admitLogicalMonitor(request(), { root: process.cwd(), repoRoot: process.cwd(), trustedOwner: OWNER, nowMs: NOW });
  assert.equal(result.ok, false); assert.equal(result.reason, 'MONITOR_ADMISSION_FALLBACK_REQUIRED');
  assert.equal(result.fallbackReason, 'MULTIPLEXER_ADMISSION_UNAVAILABLE'); assert.equal(result.durable, false);
});

test('capacity edge rejects monitor 1001', async () => {
  const workspace = await root(); const config = options(workspace);
  const first = request(); await admitLogicalMonitor(first, config);
  const registryPath = join(workspace, 'status', 'monitor-admission-registry.json');
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  for (let index = 1; index < 1000; index += 1) registry.monitors[`m-${index}`] = { monitorId: `m-${index}` };
  const { writeFile } = await import('node:fs/promises'); await writeFile(registryPath, JSON.stringify(registry));
  const extra = request({ requestId: 'request-extra', idempotencyKey: 'intent-extra' }, { monitorId: 'extra', idempotencyKey: 'intent-extra' });
  const result = await admitLogicalMonitor(extra, config);
  assert.equal(result.ok, false); assert.equal(result.blocker, 'MONITOR_REGISTRY_CAPACITY_REACHED');
});
