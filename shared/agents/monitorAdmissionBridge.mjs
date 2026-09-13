import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { acquireSharedWorkspaceOperationLock } from './executionReceiptV1.mjs';
import {
  createMonitorDefinition,
  MONITOR_MULTIPLEXER_MAX_MONITORS,
  MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
} from './monitorMultiplexer.mjs';
import {
  createSharedWorkspaceReceiptRecord,
  createSharedWorkspaceStatusRecord,
  ensureSharedWorkspaceLayout,
  resolveSharedWorkspacePath,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';

export const MONITOR_ADMISSION_ENVELOPE_VERSION = 'stephanos.monitor-admission-envelope.v1';
export const MONITOR_ADMISSION_PROPOSAL_VERSION = 'stephanos.monitor-admission-proposal.v1';
export const MONITOR_ADMISSION_REGISTRY_VERSION = 'stephanos.monitor-admission-registry.v1';
export const MONITOR_ADMISSION_OPERATIONS = Object.freeze({
  UPSERT: 'UPSERT_LOGICAL_MONITOR',
  DISABLE: 'DISABLE_LOGICAL_MONITOR',
  READ: 'READ_LOGICAL_MONITOR_STATUS',
});

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,55}$/i;
const SAFE_REF = /^(?:#[1-9][0-9]*|goal:[a-z0-9][a-z0-9._-]{0,50})$/i;
const SAFE_PROOF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[a-z0-9._/-]+$/i;
const OUTER_FIELDS = new Set(['schemaVersion', 'operation', 'owner', 'claimsHash', 'requestId', 'issuedAtUtc', 'expiresAtUtc', 'idempotencyKey', 'proposal', 'monitorId']);
const PROPOSAL_FIELDS = new Set(['schemaVersion', 'monitorId', 'idempotencyKey', 'handlerType', 'boundedSubject', 'schedule', 'mode', 'notificationPolicy', 'relatedIssueOrGoal', 'enabled', 'proofRefs']);
const SCHEDULE_FIELDS = new Set(['intervalMs', 'nextDueUtc']);
const UNIVERSALLY_FORBIDDEN = /command|shell|powershell|executable|argv|cwd|path|credential|password|secret|token|cookie|browser|selector|javascript|script|url|uri|source|mutation/i;
const unsafeObjectKeys = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_SUBJECT_ITEMS = 32;
const MAX_SUBJECT_BYTES = 4 * 1024;
const MAX_PROOF_REFS = 32;
export const MONITOR_ADMISSION_MAX_IDEMPOTENCY_ENTRIES = 2048;
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (plainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const safeId = (value) => SAFE_ID.test(String(value || '')) ? String(value) : '';
const timestamp = (value) => Number.isFinite(Date.parse(String(value || ''))) ? Date.parse(String(value)) : NaN;
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const catalogueEntry = (subjectFields, routeClass, maximumRuntimeMs, proofRule, notificationPolicy, fallbackVerdict) => Object.freeze({
  subjectFields: Object.freeze(subjectFields), routeClass, maximumRuntimeMs, proofRule,
  notificationPolicy: Object.freeze(notificationPolicy), fallbackVerdict,
});

export const MONITOR_ADMISSION_HANDLER_CATALOGUE = Object.freeze({
  GITHUB_STATE: catalogueEntry(['repository', 'entity', 'number', 'states'], 'github-state-read', 60_000, 'authoritative-state-receipt', ['STATE_CHANGE'], 'MONITOR_ADMISSION_FALLBACK_REQUIRED'),
  RELEASE_ANNOUNCEMENT: catalogueEntry(['product', 'publisher', 'channel', 'keywords'], 'provider-neutral-public-research', 120_000, 'public-release-evidence', ['STATE_CHANGE'], 'MONITOR_ADMISSION_FALLBACK_REQUIRED'),
  NEWS_TOPIC_CHANGE: catalogueEntry(['topic', 'keywords', 'jurisdiction'], 'provider-neutral-public-research', 120_000, 'multi-source-change-evidence', ['STATE_CHANGE'], 'MONITOR_ADMISSION_FALLBACK_REQUIRED'),
  WEATHER_CONDITION: catalogueEntry(['location', 'condition', 'threshold', 'unit'], 'approved-weather-data', 60_000, 'timestamped-provider-receipt', ['STATE_CHANGE', 'TERMINAL_ONLY'], 'MONITOR_ADMISSION_FALLBACK_REQUIRED'),
  MARKET_RATE_THRESHOLD: catalogueEntry(['instrument', 'metric', 'operator', 'threshold', 'currency'], 'approved-market-data', 60_000, 'timestamped-provider-receipt', ['STATE_CHANGE', 'TERMINAL_ONLY'], 'MONITOR_ADMISSION_FALLBACK_REQUIRED'),
  WORKSPACE_HEALTH: catalogueEntry(['component', 'expectedState'], 'shared-workspace-health-read', 30_000, 'workspace-status-proof', ['STATE_CHANGE'], 'MONITOR_ADMISSION_FALLBACK_REQUIRED'),
  SCHEDULED_SUMMARY: catalogueEntry(['topic', 'scope'], 'provider-neutral-summary', 120_000, 'bounded-summary-proof', ['STATE_CHANGE'], 'MONITOR_ADMISSION_FALLBACK_REQUIRED'),
  ONE_SHOT_REMINDER: catalogueEntry(['reminder'], 'deterministic-reminder', 10_000, 'schedule-and-delivery-receipt', ['TERMINAL_ONLY'], 'MONITOR_ADMISSION_FALLBACK_REQUIRED'),
});

function inspect(value, allowed, location, errors) {
  if (!plainObject(value)) { errors.push(`${location}-not-object`); return; }
  for (const [key, child] of Object.entries(value)) {
    if (!allowed.has(key)) errors.push(`unknown-${location}-field:${key}`);
    if (unsafeObjectKeys.has(key) || UNIVERSALLY_FORBIDDEN.test(key)) errors.push(`unsafe-field:${location}.${key}`);
    if (plainObject(child)) inspect(child, new Set(Object.keys(child)), `${location}.${key}`, errors);
  }
}

function validateSubject(subject, entry, errors) {
  if (!plainObject(subject)) { errors.push('bounded-subject-not-object'); return; }
  const allowed = new Set(entry?.subjectFields || []);
  for (const [key, value] of Object.entries(subject)) {
    if (!allowed.has(key)) errors.push(`unknown-bounded-subject-field:${key}`);
    if (unsafeObjectKeys.has(key) || UNIVERSALLY_FORBIDDEN.test(key)) errors.push(`unsafe-field:boundedSubject.${key}`);
    const values = Array.isArray(value) ? value : [value];
    if (Array.isArray(value) && value.length > MAX_SUBJECT_ITEMS) errors.push(`bounded-subject-array-too-large:${key}`);
    if (values.some((item) => !['string', 'number', 'boolean'].includes(typeof item))) errors.push(`invalid-bounded-subject-value:${key}`);
    if (values.some((item) => typeof item === 'string' && (item.length > 240 || /(?:https?:\/\/|[a-z]:\\|\.\.\/|\/home\/|\/workspace\/)/i.test(item)))) errors.push(`unsafe-bounded-subject-value:${key}`);
  }
  if (!Object.keys(subject).length) errors.push('empty-bounded-subject');
  if (Buffer.byteLength(canonical(subject), 'utf8') > MAX_SUBJECT_BYTES) errors.push('bounded-subject-too-large');
}

export function validateMonitorAdmissionEnvelope(envelope = {}, options = {}) {
  const errors = [];
  inspect(envelope, OUTER_FIELDS, 'envelope', errors);
  if (!plainObject(envelope)) return Object.freeze({ valid: false, errors: Object.freeze([...new Set(errors)]) });
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  if (envelope.schemaVersion !== MONITOR_ADMISSION_ENVELOPE_VERSION) errors.push('invalid-envelope-version');
  if (!Object.values(MONITOR_ADMISSION_OPERATIONS).includes(envelope.operation)) errors.push('unsupported-operation');
  const principal = options.authenticatedPrincipal;
  if (!plainObject(principal) || !safeId(principal.subject) || !/^[a-f0-9]{64}$/i.test(String(principal.claimsHash || ''))) errors.push('authenticated-principal-required');
  if (!safeId(envelope.owner) || envelope.owner !== principal?.subject || envelope.claimsHash !== principal?.claimsHash) errors.push('principal-claims-mismatch');
  if (!safeId(envelope.requestId)) errors.push('invalid-request-id');
  if (!safeId(envelope.idempotencyKey)) errors.push('invalid-idempotency-key');
  const issued = timestamp(envelope.issuedAtUtc); const expires = timestamp(envelope.expiresAtUtc);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > nowMs || expires <= nowMs || expires <= issued || expires - issued > 15 * 60_000) errors.push('invalid-or-expired-admission-window');
  if (envelope.operation === MONITOR_ADMISSION_OPERATIONS.UPSERT) {
    if (envelope.monitorId !== undefined) errors.push('unexpected-monitor-id-for-upsert');
    inspect(envelope.proposal, PROPOSAL_FIELDS, 'proposal', errors);
    const proposal = envelope.proposal || {};
    if (proposal.schemaVersion !== MONITOR_ADMISSION_PROPOSAL_VERSION) errors.push('invalid-proposal-version');
    if (!safeId(proposal.monitorId)) errors.push('invalid-monitor-id');
    if (proposal.idempotencyKey !== envelope.idempotencyKey) errors.push('idempotency-key-mismatch');
    const entry = MONITOR_ADMISSION_HANDLER_CATALOGUE[proposal.handlerType];
    if (!entry) errors.push('unsupported-handler-type');
    validateSubject(proposal.boundedSubject, entry, errors);
    inspect(proposal.schedule, SCHEDULE_FIELDS, 'schedule', errors);
    if (!Number.isFinite(Number(proposal.schedule?.intervalMs)) || Number(proposal.schedule?.intervalMs) < 30_000) errors.push('invalid-schedule-interval');
    if (!Number.isFinite(timestamp(proposal.schedule?.nextDueUtc))) errors.push('invalid-schedule-time');
    if (!['RECURRING', 'ONE_SHOT'].includes(proposal.mode)) errors.push('invalid-mode');
    if (!entry?.notificationPolicy.includes(proposal.notificationPolicy)) errors.push('invalid-notification-policy');
    if (!SAFE_REF.test(String(proposal.relatedIssueOrGoal || ''))) errors.push('invalid-related-issue-or-goal');
    if (typeof proposal.enabled !== 'boolean') errors.push('invalid-enabled');
    if (!Array.isArray(proposal.proofRefs) || proposal.proofRefs.length > MAX_PROOF_REFS || proposal.proofRefs.some((ref) => typeof ref !== 'string' || ref.length > 240 || !SAFE_PROOF.test(ref) || ref.includes('..'))) errors.push('unsafe-proof-refs');
  } else {
    if (!safeId(envelope.monitorId)) errors.push('invalid-monitor-id');
    if (envelope.proposal !== undefined) errors.push('unexpected-proposal-for-operation');
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze([...new Set(errors)]) });
}

export function proposalToMonitorDefinition(proposal) {
  const entry = MONITOR_ADMISSION_HANDLER_CATALOGUE[proposal.handlerType];
  return createMonitorDefinition({
    monitorId: proposal.monitorId,
    handlerId: proposal.handlerType.toLowerCase().replaceAll('_', '-'),
    mode: proposal.mode,
    intervalMs: proposal.schedule.intervalMs,
    nextDueUtc: proposal.schedule.nextDueUtc,
    maxRuntimeMs: entry.maximumRuntimeMs,
    enabled: proposal.enabled,
    notificationPolicy: proposal.notificationPolicy,
    relatedIssue: proposal.relatedIssueOrGoal.startsWith('#') ? proposal.relatedIssueOrGoal : '#1585',
    summary: `${proposal.handlerType} logical monitor ${proposal.monitorId}.`,
    proofRefs: proposal.proofRefs,
  }).definition;
}

async function readRegistry(root, repoRoot) {
  const resolved = resolveSharedWorkspacePath({ root, repoRoot, segments: ['status', 'monitor-admission-registry.json'] });
  try {
    const value = JSON.parse(await readFile(resolved.path, 'utf8'));
    return validateRegistry(value) ? value : false;
  } catch (error) { return error?.code === 'ENOENT' ? null : false; }
}

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
function validStoredProposal(value, id) {
  if (!plainObject(value) || value.monitorId !== id || !safeId(value.idempotencyKey)) return false;
  return validateMonitorAdmissionEnvelope({
    schemaVersion: MONITOR_ADMISSION_ENVELOPE_VERSION,
    operation: MONITOR_ADMISSION_OPERATIONS.UPSERT,
    owner: 'registry-validator',
    claimsHash: 'a'.repeat(64),
    requestId: 'registry-validation',
    issuedAtUtc: '1970-01-01T00:00:00.000Z',
    expiresAtUtc: '1970-01-01T00:10:00.000Z',
    idempotencyKey: value.idempotencyKey,
    proposal: value,
  }, {
    authenticatedPrincipal: { subject: 'registry-validator', claimsHash: 'a'.repeat(64) },
    nowMs: 1,
  }).valid;
}

function validMonitor(value, id) {
  if (!plainObject(value) || value.monitorId !== id || !validStoredProposal(value.proposal, id)
    || !plainObject(value.definition) || !Number.isFinite(timestamp(value.updatedAtUtc))) return false;
  try {
    return canonical(value.definition) === canonical(proposalToMonitorDefinition(value.proposal));
  } catch {
    return false;
  }
}
function validCachedResult(value) {
  return plainObject(value) && typeof value.ok === 'boolean' && typeof value.reason === 'string'
    && Number.isInteger(value.monitorCount) && (value.monitor === null
      || (safeId(value.monitor?.monitorId) && validMonitor(value.monitor, value.monitor.monitorId)));
}
function validateRegistry(value) {
  if (!plainObject(value) || value.registrySchemaVersion !== MONITOR_ADMISSION_REGISTRY_VERSION || !plainObject(value.monitors) || !plainObject(value.idempotency)) return false;
  if (Object.keys(value.monitors).length > MONITOR_MULTIPLEXER_MAX_MONITORS) return false;
  if (Object.keys(value.idempotency).length > MONITOR_ADMISSION_MAX_IDEMPOTENCY_ENTRIES) return false;
  if (Object.entries(value.monitors).some(([id, monitor]) => !safeId(id) || !validMonitor(monitor, id))) return false;
  return !Object.entries(value.idempotency).some(([id, replay]) => !safeId(id) || !plainObject(replay)
    || !/^[a-f0-9]{64}$/.test(String(replay.fingerprint || '')) || !['pending', 'committed'].includes(replay.state)
    || !Number.isFinite(timestamp(replay.updatedAtUtc)) || !validCachedResult(replay.result));
}

async function withRegistryLock(root, repoRoot, action, options = {}) {
  const acquireLock = options.testAcquireOperationLock || acquireSharedWorkspaceOperationLock;
  const lock = await acquireLock(root, ['locks', 'monitor-admission-registry.lock'], {
    repoRoot,
    operationLockTimeoutMs: options.operationLockTimeoutMs ?? 500,
    operationLockRetryMs: options.operationLockRetryMs ?? 5,
    operationStaleLockMs: options.operationStaleLockMs ?? 30_000,
    operationLockHeartbeatMs: options.operationLockHeartbeatMs ?? 5_000,
  });
  if (!lock.ok) return { lockFailure: lock.reason || 'MONITOR_ADMISSION_LOCK_FAILED' };
  let result;
  let released = false;
  try {
    result = await action();
  } finally {
    released = await lock.release();
  }
  return released ? result : { lockFailure: 'MONITOR_ADMISSION_LOCK_RELEASE_FAILED' };
}

function evidence(envelope, verdict, monitor, timestampUtc, reason = '', options = {}) {
  const record = plainObject(envelope) ? envelope : {};
  const receiptId = options.rejected
    ? `monitor-admission-rejected-${hash(canonical(envelope)).slice(0, 24)}`
    : `monitor-admission-${hash(record.requestId).slice(0, 16)}`;
  const proofRefs = monitor?.proposal?.proofRefs?.length ? monitor.proposal.proofRefs : ['proof/monitor-admission.json'];
  return {
    status: { ...createSharedWorkspaceStatusRecord({ statusId: `monitor-admission-${monitor?.monitorId || record.monitorId || 'fallback'}`, participantId: 'monitor-admission-bridge', timestampUtc, status: verdict === 'MULTIPLEXER_ADMISSION_READY' ? 'READY' : 'ATTENTION_REQUIRED', summary: reason || verdict, proofRefs }), verdict, monitorId: monitor?.monitorId || record.monitorId || '', notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE, executableAuthority: false },
    receipt: { ...createSharedWorkspaceReceiptRecord({ receiptId, participantId: 'monitor-admission-bridge', timestampUtc, correlationId: record.requestId || receiptId, relatedIssue: String(monitor?.proposal?.relatedIssueOrGoal || '').startsWith('#') ? monitor.proposal.relatedIssueOrGoal : '#1585', receivedRecordId: record.requestId || receiptId, disposition: verdict.includes('READY') ? 'published' : 'blocked', summary: reason || verdict, proofRefs }), relatedIssueOrGoal: monitor?.proposal?.relatedIssueOrGoal || '', principalSubject: record.owner || '', claimsHash: record.claimsHash || '', verdict, reason, monitorId: monitor?.monitorId || record.monitorId || '', notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE, handlerExecuted: false, standaloneFallbackCreated: false, sourceMutationAllowed: false, mergeAuthority: false },
  };
}

function compactIdempotency(records, incomingKey) {
  const compacted = Object.assign(Object.create(null), records);
  if (own(compacted, incomingKey)) return compacted;
  while (Object.keys(compacted).length >= MONITOR_ADMISSION_MAX_IDEMPOTENCY_ENTRIES) {
    const oldest = Object.entries(compacted)
      .filter(([, replay]) => replay.state === 'committed')
      .sort((left, right) => timestamp(left[1].updatedAtUtc) - timestamp(right[1].updatedAtUtc)
        || left[0].localeCompare(right[0]))[0];
    if (!oldest) return null;
    delete compacted[oldest[0]];
  }
  return compacted;
}

export async function admitLogicalMonitor(envelope = {}, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const timestampUtc = new Date(nowMs).toISOString();
  const validation = validateMonitorAdmissionEnvelope(envelope, { authenticatedPrincipal: options.authenticatedPrincipal, nowMs });
  const unsupported = validation.errors.includes('unsupported-handler-type');
  const layout = await ensureSharedWorkspaceLayout({ root: options.root, repoRoot: options.repoRoot });
  if (!layout.ok) return Object.freeze({ ok: false, reason: 'MONITOR_ADMISSION_FALLBACK_REQUIRED', fallbackReason: 'MULTIPLEXER_ADMISSION_UNAVAILABLE', durable: false, validation, handlerExecuted: false });
  if (!validation.valid) {
    const reason = 'MONITOR_ADMISSION_FALLBACK_REQUIRED';
    const proof = evidence(envelope, reason, null, timestampUtc, unsupported ? 'MULTIPLEXER_HANDLER_UNSUPPORTED' : validation.errors.join(','), { rejected: true });
    const write = await writeAtomicJson(layout.root, ['receipts', `${proof.receipt.receiptId}.json`], proof.receipt, { repoRoot: options.repoRoot, nowMs });
    return Object.freeze({ ok: false, reason, fallbackReason: unsupported ? 'MULTIPLEXER_HANDLER_UNSUPPORTED' : 'MONITOR_ADMISSION_BLOCKED', durable: write.ok, receipt: proof.receipt, validation, handlerExecuted: false });
  }
  const storageWrite = options.testWriteAtomicJson || writeAtomicJson;
  const transaction = await withRegistryLock(layout.root, options.repoRoot, async () => {
    let registry = await readRegistry(layout.root, options.repoRoot);
    if (registry === false) return { ok: false, reason: 'MONITOR_ADMISSION_BLOCKED', blocker: 'MALFORMED_DURABLE_REGISTRY', handlerExecuted: false };
    registry ||= {
      ...createSharedWorkspaceStatusRecord({ statusId: 'monitor-admission-registry', participantId: 'monitor-admission-bridge', timestampUtc, status: 'ATTENTION_REQUIRED', summary: 'Logical monitor proposals awaiting canonical multiplexer projection.', proofRefs: ['proof/monitor-admission.json'] }),
      registrySchemaVersion: MONITOR_ADMISSION_REGISTRY_VERSION, monitors: {}, idempotency: {},
    };
    const fingerprint = hash(canonical(envelope));
    const prior = own(registry.idempotency, envelope.idempotencyKey) ? registry.idempotency[envelope.idempotencyKey] : null;
    if (prior?.fingerprint !== undefined && prior.fingerprint !== fingerprint) return { ok: false, reason: 'MONITOR_ADMISSION_BLOCKED', blocker: 'IDEMPOTENCY_REPLAY_CONFLICT', validation, handlerExecuted: false };
    if (prior?.state === 'committed') return { ...prior.result, idempotentRetry: true, handlerExecuted: false };

    const monitors = Object.assign(Object.create(null), registry.monitors);
    if (envelope.operation === MONITOR_ADMISSION_OPERATIONS.READ) {
      const monitor = own(monitors, envelope.monitorId) ? monitors[envelope.monitorId] : null;
      return { ok: Boolean(monitor), reason: monitor ? 'MONITOR_STATUS_READ' : 'MONITOR_NOT_FOUND', monitor, monitorCount: Object.keys(monitors).length, handlerExecuted: false };
    }
    if (!prior && envelope.operation === MONITOR_ADMISSION_OPERATIONS.UPSERT) {
      if (!own(monitors, envelope.proposal.monitorId) && Object.keys(monitors).length >= MONITOR_MULTIPLEXER_MAX_MONITORS) return { ok: false, reason: 'MONITOR_ADMISSION_BLOCKED', blocker: 'MONITOR_REGISTRY_CAPACITY_REACHED', handlerExecuted: false };
      monitors[envelope.proposal.monitorId] = { monitorId: envelope.proposal.monitorId, proposal: envelope.proposal, definition: proposalToMonitorDefinition(envelope.proposal), updatedAtUtc: timestampUtc };
    } else if (!prior && envelope.operation === MONITOR_ADMISSION_OPERATIONS.DISABLE) {
      if (!own(monitors, envelope.monitorId)) return { ok: false, reason: 'MONITOR_ADMISSION_BLOCKED', blocker: 'MONITOR_NOT_FOUND', handlerExecuted: false };
      monitors[envelope.monitorId] = { ...monitors[envelope.monitorId], proposal: { ...monitors[envelope.monitorId].proposal, enabled: false }, definition: { ...monitors[envelope.monitorId].definition, enabled: false }, updatedAtUtc: timestampUtc };
    }
    const monitor = monitors[envelope.proposal?.monitorId || envelope.monitorId];
    // No canonical runtime consumer currently loads this proposal store. Fail closed until that boundary exists.
    const verdict = 'MULTIPLEXER_PROJECTION_NOT_PROVEN';
    const result = { ok: false, reason: verdict, blocker: verdict, monitor, monitorCount: Object.keys(monitors).length };
    const proof = evidence(envelope, verdict, monitor, timestampUtc, 'Canonical runtime multiplexer consumption is not proven.');
    const idempotency = compactIdempotency(registry.idempotency, envelope.idempotencyKey);
    if (!idempotency) return { ok: false, reason: 'MONITOR_ADMISSION_BLOCKED', blocker: 'IDEMPOTENCY_REGISTRY_CAPACITY_REACHED', handlerExecuted: false };
    const pending = { ...registry, timestampUtc, monitors, idempotency: { ...idempotency, [envelope.idempotencyKey]: { fingerprint, state: 'pending', result, updatedAtUtc: timestampUtc } }, updatedAtUtc: timestampUtc, notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE };
    const writes = [];
    if (!prior) writes.push(await storageWrite(layout.root, ['status', 'monitor-admission-registry.json'], pending, { repoRoot: options.repoRoot, nowMs }));
    if (!writes.some((write) => !write.ok)) writes.push(await storageWrite(layout.root, ['status', `${proof.status.statusId}.json`], proof.status, { repoRoot: options.repoRoot, nowMs }));
    if (!writes.some((write) => !write.ok)) writes.push(await storageWrite(layout.root, ['receipts', `${proof.receipt.receiptId}.json`], proof.receipt, { repoRoot: options.repoRoot, nowMs }));
    if (!writes.some((write) => !write.ok)) {
      const committed = { ...pending, idempotency: { ...pending.idempotency, [envelope.idempotencyKey]: { fingerprint, state: 'committed', result, updatedAtUtc: timestampUtc } } };
      writes.push(await storageWrite(layout.root, ['status', 'monitor-admission-registry.json'], committed, { repoRoot: options.repoRoot, nowMs }));
    }
    const failure = writes.find((write) => !write.ok);
    return { ...result, reason: failure ? 'MONITOR_ADMISSION_FALLBACK_REQUIRED' : verdict, fallbackReason: failure ? 'MULTIPLEXER_ADMISSION_EVIDENCE_INCOMPLETE' : '', receipt: proof.receipt, status: proof.status, writes: Object.freeze(writes), handlerExecuted: false, standaloneFallbackCreated: false };
  }, options);
  if (transaction.lockFailure) return Object.freeze({ ok: false, reason: 'MONITOR_ADMISSION_FALLBACK_REQUIRED', fallbackReason: transaction.lockFailure, handlerExecuted: false });
  return Object.freeze(transaction);
}
