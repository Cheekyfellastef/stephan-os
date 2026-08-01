import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
const OUTER_FIELDS = new Set(['schemaVersion', 'operation', 'owner', 'requestId', 'issuedAtUtc', 'expiresAtUtc', 'idempotencyKey', 'proposal', 'monitorId']);
const PROPOSAL_FIELDS = new Set(['schemaVersion', 'monitorId', 'idempotencyKey', 'handlerType', 'boundedSubject', 'schedule', 'mode', 'notificationPolicy', 'relatedIssueOrGoal', 'enabled', 'proofRefs']);
const SCHEDULE_FIELDS = new Set(['intervalMs', 'nextDueUtc']);
const UNIVERSALLY_FORBIDDEN = /command|shell|powershell|executable|argv|cwd|path|credential|password|secret|token|cookie|browser|selector|javascript|script|url|uri|source|mutation/i;
const unsafeObjectKeys = new Set(['__proto__', 'prototype', 'constructor']);
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
    if (!['string', 'number', 'boolean'].includes(typeof value) && !(Array.isArray(value) && value.every((item) => typeof item === 'string'))) errors.push(`invalid-bounded-subject-value:${key}`);
    if (typeof value === 'string' && (value.length > 240 || /(?:https?:\/\/|[a-z]:\\|\.\.\/|\/home\/|\/workspace\/)/i.test(value))) errors.push(`unsafe-bounded-subject-value:${key}`);
  }
  if (!Object.keys(subject).length) errors.push('empty-bounded-subject');
}

export function validateMonitorAdmissionEnvelope(envelope = {}, options = {}) {
  const errors = [];
  inspect(envelope, OUTER_FIELDS, 'envelope', errors);
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  if (envelope.schemaVersion !== MONITOR_ADMISSION_ENVELOPE_VERSION) errors.push('invalid-envelope-version');
  if (!Object.values(MONITOR_ADMISSION_OPERATIONS).includes(envelope.operation)) errors.push('unsupported-operation');
  if (!safeId(envelope.owner) || envelope.owner !== options.trustedOwner) errors.push('owner-authentication-failed');
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
    if (!Array.isArray(proposal.proofRefs) || proposal.proofRefs.some((ref) => !SAFE_PROOF.test(String(ref)) || String(ref).includes('..'))) errors.push('unsafe-proof-refs');
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
    return value.registrySchemaVersion === MONITOR_ADMISSION_REGISTRY_VERSION ? value : null;
  } catch { return null; }
}

function evidence(envelope, verdict, monitor, timestampUtc, reason = '') {
  const receiptId = `monitor-admission-${hash(envelope.requestId).slice(0, 16)}`;
  const proofRefs = monitor?.proposal?.proofRefs?.length ? monitor.proposal.proofRefs : ['proof/monitor-admission.json'];
  return {
    status: { ...createSharedWorkspaceStatusRecord({ statusId: `monitor-admission-${monitor?.monitorId || envelope.monitorId || 'fallback'}`, participantId: 'monitor-admission-bridge', timestampUtc, status: verdict.includes('BLOCKED') || verdict.includes('FALLBACK') ? 'ATTENTION_REQUIRED' : 'READY', summary: reason || verdict, proofRefs }), verdict, monitorId: monitor?.monitorId || envelope.monitorId || '', notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE, executableAuthority: false },
    receipt: { ...createSharedWorkspaceReceiptRecord({ receiptId, participantId: 'monitor-admission-bridge', timestampUtc, correlationId: envelope.requestId, relatedIssue: '#1585', receivedRecordId: envelope.requestId, disposition: verdict.includes('BLOCKED') || verdict.includes('FALLBACK') ? 'blocked' : 'published', summary: reason || verdict, proofRefs }), verdict, reason, monitorId: monitor?.monitorId || envelope.monitorId || '', notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE, handlerExecuted: false, standaloneFallbackCreated: false, sourceMutationAllowed: false, mergeAuthority: false },
  };
}

export async function admitLogicalMonitor(envelope = {}, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const timestampUtc = new Date(nowMs).toISOString();
  const validation = validateMonitorAdmissionEnvelope(envelope, { trustedOwner: options.trustedOwner, nowMs });
  const unsupported = validation.errors.includes('unsupported-handler-type');
  const layout = await ensureSharedWorkspaceLayout({ root: options.root, repoRoot: options.repoRoot });
  if (!layout.ok) return Object.freeze({ ok: false, reason: 'MONITOR_ADMISSION_FALLBACK_REQUIRED', fallbackReason: 'MULTIPLEXER_ADMISSION_UNAVAILABLE', durable: false, validation, handlerExecuted: false });
  let registry = await readRegistry(layout.root, options.repoRoot) || {
    ...createSharedWorkspaceStatusRecord({ statusId: 'monitor-admission-registry', participantId: 'monitor-admission-bridge', timestampUtc, status: 'READY', summary: 'Canonical logical monitor admission registry.', proofRefs: ['proof/monitor-admission.json'] }),
    registrySchemaVersion: MONITOR_ADMISSION_REGISTRY_VERSION, monitors: {}, idempotency: {},
  };
  const fingerprint = hash(canonical(envelope));
  const prior = registry.idempotency[envelope.idempotencyKey];
  if (prior) {
    if (prior.fingerprint !== fingerprint) return Object.freeze({ ok: false, reason: 'MONITOR_ADMISSION_BLOCKED', blocker: 'IDEMPOTENCY_REPLAY_CONFLICT', validation, handlerExecuted: false });
    return Object.freeze({ ...prior.result, idempotentRetry: true, handlerExecuted: false });
  }
  if (!validation.valid) {
    const reason = 'MONITOR_ADMISSION_FALLBACK_REQUIRED';
    const proof = evidence(envelope, reason, null, timestampUtc, unsupported ? 'MULTIPLEXER_HANDLER_UNSUPPORTED' : validation.errors.join(','));
    const write = await writeAtomicJson(layout.root, ['receipts', `${proof.receipt.receiptId}.json`], proof.receipt, { repoRoot: options.repoRoot, nowMs });
    return Object.freeze({ ok: false, reason, fallbackReason: unsupported ? 'MULTIPLEXER_HANDLER_UNSUPPORTED' : 'MONITOR_ADMISSION_BLOCKED', durable: write.ok, receipt: proof.receipt, validation, handlerExecuted: false });
  }
  const monitors = { ...registry.monitors };
  let verdict;
  if (envelope.operation === MONITOR_ADMISSION_OPERATIONS.UPSERT) {
    if (!monitors[envelope.proposal.monitorId] && Object.keys(monitors).length >= MONITOR_MULTIPLEXER_MAX_MONITORS) return Object.freeze({ ok: false, reason: 'MONITOR_ADMISSION_BLOCKED', blocker: 'MONITOR_REGISTRY_CAPACITY_REACHED', handlerExecuted: false });
    verdict = monitors[envelope.proposal.monitorId] ? 'MONITOR_UPDATE_APPLIED' : 'MULTIPLEXER_ADMISSION_READY';
    monitors[envelope.proposal.monitorId] = { monitorId: envelope.proposal.monitorId, proposal: envelope.proposal, definition: proposalToMonitorDefinition(envelope.proposal), updatedAtUtc: timestampUtc };
  } else if (envelope.operation === MONITOR_ADMISSION_OPERATIONS.DISABLE) {
    if (!monitors[envelope.monitorId]) return Object.freeze({ ok: false, reason: 'MONITOR_ADMISSION_BLOCKED', blocker: 'MONITOR_NOT_FOUND', handlerExecuted: false });
    verdict = 'MONITOR_DISABLED';
    monitors[envelope.monitorId] = { ...monitors[envelope.monitorId], proposal: { ...monitors[envelope.monitorId].proposal, enabled: false }, definition: { ...monitors[envelope.monitorId].definition, enabled: false }, updatedAtUtc: timestampUtc };
  } else {
    const monitor = monitors[envelope.monitorId] || null;
    return Object.freeze({ ok: Boolean(monitor), reason: monitor ? 'MONITOR_STATUS_READ' : 'MONITOR_NOT_FOUND', monitor, monitorCount: Object.keys(monitors).length, handlerExecuted: false });
  }
  const monitor = monitors[envelope.proposal?.monitorId || envelope.monitorId];
  const result = { ok: true, reason: verdict, monitor, monitorCount: Object.keys(monitors).length };
  registry = { ...registry, timestampUtc, monitors, idempotency: { ...registry.idempotency, [envelope.idempotencyKey]: { fingerprint, result } }, updatedAtUtc: timestampUtc, notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE };
  const proof = evidence(envelope, verdict, monitor, timestampUtc);
  const writes = [
    await writeAtomicJson(layout.root, ['status', 'monitor-admission-registry.json'], registry, { repoRoot: options.repoRoot, nowMs }),
    await writeAtomicJson(layout.root, ['status', `${proof.status.statusId}.json`], proof.status, { repoRoot: options.repoRoot, nowMs }),
    await writeAtomicJson(layout.root, ['receipts', `${proof.receipt.receiptId}.json`], proof.receipt, { repoRoot: options.repoRoot, nowMs }),
  ];
  const failure = writes.find((write) => !write.ok);
  return Object.freeze({ ...result, ok: !failure, reason: failure ? 'MONITOR_ADMISSION_FALLBACK_REQUIRED' : verdict, fallbackReason: failure ? 'MULTIPLEXER_ADMISSION_UNAVAILABLE' : '', receipt: proof.receipt, status: proof.status, writes: Object.freeze(writes), handlerExecuted: false, standaloneFallbackCreated: false });
}
