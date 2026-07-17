import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  appendWorkspaceJsonl,
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceMessageRecord,
  createSharedWorkspaceProofRecord,
  createSharedWorkspaceReceiptRecord,
  createSharedWorkspaceStatusRecord,
  ensureSharedWorkspaceLayout,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';

export const MONITOR_MULTIPLEXER_SCHEMA_VERSION = 'stephanos.monitor-multiplexer.v1';
export const MONITOR_MULTIPLEXER_PARTICIPANT = 'monitor-multiplexer';
export const MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE = 'chatgpt-task-outbox';
export const MONITOR_MULTIPLEXER_MIN_INTERVAL_MS = 30_000;
export const MONITOR_MULTIPLEXER_DEFAULT_INTERVAL_MS = 60_000;
export const MONITOR_MULTIPLEXER_MAX_MONITORS = 1_000;
export const MONITOR_MULTIPLEXER_DEFAULT_CONCURRENCY = 4;
export const MONITOR_MULTIPLEXER_MAX_CONCURRENCY = 16;
export const MONITOR_MULTIPLEXER_NOTIFICATION_BATCH_SIZE = 12;
export const MONITOR_MULTIPLEXER_NOTIFICATION_BODY_LIMIT_BYTES = 12 * 1024;
export const MONITOR_MULTIPLEXER_TEST_STORAGE_SCHEMA = 'stephanos.monitor-multiplexer.test-storage.v1';

export const MONITOR_MODES = Object.freeze({ RECURRING: 'RECURRING', ONE_SHOT: 'ONE_SHOT' });
export const MONITOR_RESULT_STATES = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', BLOCKED: 'BLOCKED' });
export const MONITOR_NOTIFICATION_POLICIES = Object.freeze({ STATE_CHANGE: 'STATE_CHANGE', TERMINAL_ONLY: 'TERMINAL_ONLY' });

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,55}$/i;
const SAFE_REF = /^#[1-9][0-9]*$/;
const SAFE_PROOF = /^(proof|proofs|receipts|evidence\/receipts)\/[a-z0-9._/-]+$/i;
const FORBIDDEN_KEY = /command|shell|powershell|argv|args|cwd|path|url|endpoint|filesystem|script/i;
const FORBIDDEN_TEXT = /secret|token|password|credential|private key|\.env|cookie|session|node_modules|runtime-data/i;
const LOCAL_PATH = /(?:[a-z]:\\|\\\\|\/(?:users|home|workspace|tmp)\/|appdata\\|documents\\github\\)/i;
const RESULT_STATES = new Set(Object.values(MONITOR_RESULT_STATES));

const string = (value, fallback = '') => String(value ?? '').trim() || fallback;
const hash = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
const dateMs = (value) => {
  const parsed = Date.parse(string(value));
  return Number.isFinite(parsed) ? parsed : NaN;
};
const bounded = (value, fallback = '', limit = 240) => {
  const result = string(value, fallback);
  if (!result || FORBIDDEN_TEXT.test(result) || LOCAL_PATH.test(result)) return fallback;
  return result.length > limit ? `${result.slice(0, limit - 3)}...` : result;
};
const safeId = (value) => (SAFE_ID.test(string(value).toLowerCase()) ? string(value).toLowerCase() : '');
const safeRef = (value) => (SAFE_REF.test(string(value)) ? string(value) : '');
const proofRefs = (value, fallback = []) => {
  const source = Array.isArray(value) && value.length ? value : fallback;
  return [...new Set(source.map(String).map((item) => item.trim()).filter((item) => (
    SAFE_PROOF.test(item) && !item.split('/').includes('..')
  )))].slice(0, 32);
};
const clamp = (value, fallback, minimum, maximum) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.trunc(number))) : fallback;
};
const intervalMs = (value) => clamp(value, MONITOR_MULTIPLEXER_DEFAULT_INTERVAL_MS, MONITOR_MULTIPLEXER_MIN_INTERVAL_MS, 30 * 24 * 60 * 60_000);
const runtimeMs = (value) => clamp(value, 30_000, 1_000, 15 * 60_000);
const concurrency = (value) => clamp(value, MONITOR_MULTIPLEXER_DEFAULT_CONCURRENCY, 1, MONITOR_MULTIPLEXER_MAX_CONCURRENCY);
const normalizedEnum = (value, values, fallback) => {
  const result = string(value, fallback).toUpperCase();
  return values.includes(result) ? result : '';
};

function forbiddenKeys(value, prefix = '') {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => forbiddenKeys(item, `${prefix}${index}.`));
  return Object.entries(value).flatMap(([key, child]) => [
    ...(FORBIDDEN_KEY.test(key) ? [`forbidden-definition-key:${prefix}${key}`] : []),
    ...forbiddenKeys(child, `${prefix}${key}.`),
  ]);
}

export const MONITOR_MULTIPLEXER_TEST_RECORD_KINDS = Object.freeze([
  'notification-outbox',
  'monitor-status',
  'monitor-proof',
  'monitor-event',
  'registry-status',
  'receipt',
]);

export function createMonitorMultiplexerTestStorageAdapter(input = {}) {
  const recordKind = MONITOR_MULTIPLEXER_TEST_RECORD_KINDS.includes(input.recordKind)
    ? input.recordKind
    : '';
  return Object.freeze({
    schemaVersion: MONITOR_MULTIPLEXER_TEST_STORAGE_SCHEMA,
    recordKind,
    occurrence: clamp(input.occurrence, 1, 1, MONITOR_MULTIPLEXER_MAX_MONITORS * 4),
    testOnly: true,
    acceptsExternalPath: false,
    acceptsCommand: false,
    valid: Boolean(recordKind),
  });
}

function recordKindFor(segments = []) {
  if (segments[0] === 'outbox') return 'notification-outbox';
  if (segments[0] === 'proof') return 'monitor-proof';
  if (segments[0] === 'events') return 'monitor-event';
  if (segments[0] === 'receipts') return 'receipt';
  if (segments[0] === 'status' && segments[1] === 'monitor-multiplexer-registry.json') return 'registry-status';
  if (segments[0] === 'status') return 'monitor-status';
  return 'unknown';
}

function storageFor(input) {
  const fault = input.testStorageAdapter?.schemaVersion === MONITOR_MULTIPLEXER_TEST_STORAGE_SCHEMA
    && input.testStorageAdapter.testOnly === true
    && input.testStorageAdapter.valid === true
    ? input.testStorageAdapter
    : null;
  let matchingOccurrence = 0;
  const invoke = async (operation, root, segments, record, options) => {
    const recordKind = recordKindFor(segments);
    if (fault && recordKind === fault.recordKind) {
      matchingOccurrence += 1;
      if (matchingOccurrence === fault.occurrence) {
        return Object.freeze({
          ok: false,
          reason: 'INJECTED_TEST_WRITE_FAILURE',
          recordKind,
          testFault: true,
        });
      }
    }
    try {
      return await operation(root, segments, record, options);
    } catch {
      return Object.freeze({ ok: false, reason: 'MONITOR_STORAGE_WRITE_FAILED', recordKind });
    }
  };
  return Object.freeze({
    writeAtomicJson: (...args) => invoke(writeAtomicJson, ...args),
    appendWorkspaceJsonl: (...args) => invoke(appendWorkspaceJsonl, ...args),
    testOnly: Boolean(fault),
    acceptsExternalPath: false,
    acceptsCommand: false,
  });
}

export function validateMonitorDefinition(input = {}) {
  const errors = forbiddenKeys(input);
  const mode = normalizedEnum(input.mode, Object.values(MONITOR_MODES), MONITOR_MODES.RECURRING);
  const policy = normalizedEnum(input.notificationPolicy, Object.values(MONITOR_NOTIFICATION_POLICIES), MONITOR_NOTIFICATION_POLICIES.STATE_CHANGE);
  const issue = safeRef(input.relatedIssue);
  const pr = safeRef(input.relatedPr);
  if (!safeId(input.monitorId)) errors.push('invalid-monitor-id');
  if (!safeId(input.handlerId)) errors.push('invalid-handler-id');
  if (!mode) errors.push('invalid-monitor-mode');
  if (!policy) errors.push('invalid-notification-policy');
  if (!issue && !pr) errors.push('missing-or-invalid-related-issue-or-pr');
  if (input.relatedIssue && !issue) errors.push('invalid-related-issue');
  if (input.relatedPr && !pr) errors.push('invalid-related-pr');
  if (input.nextDueUtc && !Number.isFinite(dateMs(input.nextDueUtc))) errors.push('invalid-next-due-utc');
  if (input.proofRefs !== undefined && !Array.isArray(input.proofRefs)) errors.push('proof-refs-not-array');
  if (Array.isArray(input.proofRefs) && proofRefs(input.proofRefs).length !== input.proofRefs.length) errors.push('unsafe-proof-ref');
  const unique = [...new Set(errors)];
  return Object.freeze({ valid: unique.length === 0, errors: Object.freeze(unique), finalVerdict: unique.length ? 'MONITOR_DEFINITION_BLOCKED' : 'MONITOR_DEFINITION_PASS' });
}

export function createMonitorDefinition(input = {}, options = {}) {
  const validation = validateMonitorDefinition(input);
  if (!validation.valid) return Object.freeze({ ok: false, validation });
  const monitorId = safeId(input.monitorId);
  return Object.freeze({
    ok: true,
    validation,
    definition: Object.freeze({
      schemaVersion: MONITOR_MULTIPLEXER_SCHEMA_VERSION,
      monitorId,
      handlerId: safeId(input.handlerId),
      mode: normalizedEnum(input.mode, Object.values(MONITOR_MODES), MONITOR_MODES.RECURRING),
      intervalMs: intervalMs(input.intervalMs),
      maxRuntimeMs: runtimeMs(input.maxRuntimeMs),
      nextDueUtc: string(input.nextDueUtc, options.timestampUtc || new Date(0).toISOString()),
      enabled: input.enabled !== false,
      notificationPolicy: normalizedEnum(input.notificationPolicy, Object.values(MONITOR_NOTIFICATION_POLICIES), MONITOR_NOTIFICATION_POLICIES.STATE_CHANGE),
      relatedIssue: safeRef(input.relatedIssue),
      relatedPr: safeRef(input.relatedPr),
      summary: bounded(input.summary, `Monitor ${monitorId}.`, 160),
      proofRefs: proofRefs(input.proofRefs, [`proof/monitor-${monitorId}.json`]),
      runnerRegistryOnly: true,
      arbitraryShellAllowed: false,
      arbitraryPowerShellAllowed: false,
      arbitraryFilesystemAccess: false,
      sourceMutationAllowed: false,
      mergeAuthority: false,
    }),
  });
}

export function createMonitorRegistry(definitions = [], options = {}) {
  if (!Array.isArray(definitions)) return Object.freeze({ ok: false, monitors: [], errors: ['definitions-not-array'], finalVerdict: 'MONITOR_REGISTRY_BLOCKED' });
  if (definitions.length > MONITOR_MULTIPLEXER_MAX_MONITORS) return Object.freeze({ ok: false, monitors: [], errors: ['monitor-limit-exceeded'], finalVerdict: 'MONITOR_REGISTRY_BLOCKED' });
  const monitors = [];
  const errors = [];
  const ids = new Set();
  for (const input of definitions) {
    const created = createMonitorDefinition(input, options);
    if (!created.ok) {
      errors.push(...created.validation.errors.map((error) => `${safeId(input?.monitorId) || 'unknown'}:${error}`));
    } else if (ids.has(created.definition.monitorId)) {
      errors.push(`${created.definition.monitorId}:duplicate-monitor-id`);
    } else {
      ids.add(created.definition.monitorId);
      monitors.push(created.definition);
    }
  }
  return Object.freeze({
    schemaVersion: MONITOR_MULTIPLEXER_SCHEMA_VERSION,
    ok: errors.length === 0,
    monitors: Object.freeze(monitors),
    errors: Object.freeze(errors),
    monitorCount: monitors.length,
    notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
    externalTaskSlotsRequired: monitors.length ? 1 : 0,
    runnerRegistryOnly: true,
    arbitraryShellAllowed: false,
    arbitraryPowerShellAllowed: false,
    arbitraryFilesystemAccess: false,
    finalVerdict: errors.length ? 'MONITOR_REGISTRY_BLOCKED' : 'MONITOR_REGISTRY_READY',
  });
}

const stateName = (monitorId) => `monitor-${monitorId}.json`;
async function previousState(root, definition, options) {
  const resolved = resolveSharedWorkspacePath({ root, repoRoot: options.repoRoot, segments: ['status', stateName(definition.monitorId)] });
  if (!resolved.ok) return null;
  try {
    const record = JSON.parse(await readFile(resolved.path, 'utf8'));
    return validateSharedWorkspaceRecord(record, options).valid && record.monitorId === definition.monitorId ? record : null;
  } catch {
    return null;
  }
}

export function classifyMonitorDue(definition, previous = null, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const nextDueUtc = string(previous?.nextDueUtc || definition?.nextDueUtc, new Date(0).toISOString());
  const retired = previous?.retired === true;
  const enabled = definition?.enabled !== false;
  const due = enabled && !retired && Number.isFinite(dateMs(nextDueUtc)) && dateMs(nextDueUtc) <= nowMs;
  return Object.freeze({ due, enabled, retired, nextDueUtc, reason: retired ? 'MONITOR_RETIRED' : (!enabled ? 'MONITOR_DISABLED' : (due ? 'MONITOR_DUE' : 'MONITOR_NOT_DUE')) });
}

async function withTimeout(handler, context, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => handler(context)),
      new Promise((resolve) => { timer = setTimeout(() => resolve({ state: 'BLOCKED', blocker: 'MONITOR_HANDLER_TIMEOUT', summary: 'Monitor exceeded its bounded runtime window.', nextAction: 'Inspect the bounded monitor handler and reduce or split its work.' }), milliseconds); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeResult(result, definition) {
  const requested = string(result?.state || result?.status || result?.verdict, result?.ok === false ? 'FAIL' : 'PASS').toUpperCase();
  const state = RESULT_STATES.has(requested) ? requested : 'BLOCKED';
  return Object.freeze({
    state,
    summary: bounded(result?.summary, `${definition.monitorId} returned ${state}.`),
    blocker: bounded(result?.blocker, state === 'BLOCKED' ? 'MONITOR_HANDLER_BLOCKED' : '', 120),
    nextAction: bounded(result?.nextAction, state === 'PASS' ? 'Continue on the configured schedule.' : 'Inspect the monitor proof and advance the owning lane.'),
    proofRefs: proofRefs(result?.proofRefs, definition.proofRefs),
    notify: result?.notify !== false,
  });
}

async function execute(definition, previous, handler, context) {
  let raw;
  if (typeof handler !== 'function') raw = { state: 'BLOCKED', blocker: 'MONITOR_HANDLER_NOT_REGISTERED', summary: 'Monitor handler is not registered.', nextAction: 'Register the fixed handler ID in the Battle Bridge monitor runner registry.' };
  else {
    try { raw = await withTimeout(handler, Object.freeze({ monitorId: definition.monitorId, handlerId: definition.handlerId, relatedIssue: definition.relatedIssue, relatedPr: definition.relatedPr, previousState: previous, timestampUtc: context.timestampUtc }), definition.maxRuntimeMs); }
    catch { raw = { state: 'FAIL', blocker: 'MONITOR_HANDLER_FAILED', summary: 'Monitor handler failed without publishing unsafe error detail.', nextAction: 'Inspect the local monitor proof and repair the fixed handler.' }; }
  }
  const result = normalizeResult(raw, definition);
  const fingerprint = hash(JSON.stringify([definition.monitorId, result.state, result.summary, result.blocker, result.nextAction]));
  const changed = previous?.notificationFingerprint !== fingerprint && (definition.notificationPolicy === 'TERMINAL_ONLY' || previous?.state !== result.state || previous?.summary !== result.summary || previous?.blocker !== result.blocker);
  const notificationPending = result.notify && changed;
  const retired = definition.mode === 'ONE_SHOT' && RESULT_STATES.has(result.state);
  const runCount = Number.isSafeInteger(previous?.runCount) ? previous.runCount + 1 : 1;
  const nextDueUtc = retired ? string(previous?.nextDueUtc || definition.nextDueUtc, context.timestampUtc) : new Date(context.nowMs + definition.intervalMs).toISOString();
  const common = { monitorId: definition.monitorId, runCount, blocker: result.blocker, nextAction: result.nextAction, retired };
  const statusRecord = Object.freeze({
    ...createSharedWorkspaceStatusRecord({ statusId: `monitor-${definition.monitorId}`, participantId: MONITOR_MULTIPLEXER_PARTICIPANT, timestampUtc: context.timestampUtc, status: result.state, summary: result.summary, proofRefs: result.proofRefs }),
    schema: MONITOR_MULTIPLEXER_SCHEMA_VERSION,
    ...common,
    handlerId: definition.handlerId,
    monitorMode: definition.mode,
    notificationPolicy: definition.notificationPolicy,
    notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
    notificationFingerprint: fingerprint,
    notificationPending,
    heartbeatUtc: context.timestampUtc,
    lastRunUtc: context.timestampUtc,
    nextDueUtc,
    relatedIssue: definition.relatedIssue,
    relatedPr: definition.relatedPr,
    runnerRegistryOnly: true,
    arbitraryShellAllowed: false,
    arbitraryPowerShellAllowed: false,
    arbitraryFilesystemAccess: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
  });
  const proofRecord = Object.freeze({
    ...createSharedWorkspaceProofRecord({ proofId: `monitor-${definition.monitorId}`, participantId: MONITOR_MULTIPLEXER_PARTICIPANT, timestampUtc: context.timestampUtc, correlationId: definition.monitorId, relatedIssue: definition.relatedIssue, relatedPr: definition.relatedPr, status: result.state, summary: result.summary, refs: result.proofRefs, proofRefs: result.proofRefs }),
    ...common,
  });
  const eventRecord = Object.freeze({
    ...createSharedWorkspaceEventRecord({ eventId: `monitor-${definition.monitorId}-${hash(`${context.timestampUtc}:${result.state}`)}`, participantId: MONITOR_MULTIPLEXER_PARTICIPANT, timestampUtc: context.timestampUtc, eventKind: 'monitor-tick-result', summary: result.summary }),
    ...common,
    state: result.state,
    heartbeatUtc: context.timestampUtc,
    notificationPending,
    proofRefs: result.proofRefs,
  });
  return Object.freeze({ definition, previousState: previous, result, statusRecord, proofRecord, eventRecord, notificationPending });
}

async function mapBounded(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const alertItem = (execution) => ({ monitorId: execution.definition.monitorId, state: execution.result.state, summary: execution.result.summary, blocker: execution.result.blocker, nextAction: execution.result.nextAction, relatedIssue: execution.definition.relatedIssue, relatedPr: execution.definition.relatedPr, proofRefs: execution.result.proofRefs.slice(0, 4), notificationFingerprint: execution.statusRecord.notificationFingerprint });
const alertBody = (items, batchIndex, batchCount) => JSON.stringify({ schemaVersion: MONITOR_MULTIPLEXER_SCHEMA_VERSION, notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE, batchIndex, batchCount, itemCount: items.length, items });
function alertBatches(executions, timestampUtc, relatedIssue) {
  const items = executions.filter((item) => item.notificationPending).map(alertItem);
  const groups = [];
  let current = [];
  for (const item of items) {
    const candidate = [...current, item];
    if (current.length && (candidate.length > MONITOR_MULTIPLEXER_NOTIFICATION_BATCH_SIZE || Buffer.byteLength(alertBody(candidate, 1, 999)) > MONITOR_MULTIPLEXER_NOTIFICATION_BODY_LIMIT_BYTES)) {
      groups.push(current);
      current = [item];
    } else current = candidate;
  }
  if (current.length) groups.push(current);
  return Object.freeze(groups.map((group, index) => {
    const messageId = `monitor-notify-${hash(`${timestampUtc}:${index}:${group.map((item) => item.notificationFingerprint).join(':')}`)}`;
    return Object.freeze({
      ...createSharedWorkspaceMessageRecord({ messageId, participantId: MONITOR_MULTIPLEXER_PARTICIPANT, timestampUtc, correlationId: messageId, relatedIssue: safeRef(relatedIssue) || '#1290', channel: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE, summary: `${group.length} monitor state change${group.length === 1 ? '' : 's'} require attention.`, body: alertBody(group, index + 1, groups.length), proofRefs: proofRefs(group.flatMap((item) => item.proofRefs), ['proof/monitor-multiplexer.json']) }),
      notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
      batchIndex: index + 1,
      batchCount: groups.length,
      itemCount: group.length,
      deduplicated: true,
      externalTaskSlotsRequired: 1,
    });
  }));
}

function registryStatus(registry, executions, skipped, notifications, timestampUtc, limit) {
  const failedCount = executions.filter((item) => item.result.state === 'FAIL').length;
  const blockedCount = executions.filter((item) => item.result.state === 'BLOCKED').length;
  const find = (definition) => executions.find((item) => item.definition.monitorId === definition.monitorId) || skipped.find((item) => item.definition.monitorId === definition.monitorId);
  const refs = proofRefs(executions.flatMap((item) => item.result.proofRefs), ['proof/monitor-multiplexer.json']);
  return Object.freeze({
    ...createSharedWorkspaceStatusRecord({ statusId: 'monitor-multiplexer-registry', participantId: MONITOR_MULTIPLEXER_PARTICIPANT, timestampUtc, status: failedCount || blockedCount ? 'ATTENTION_REQUIRED' : 'READY', summary: `${registry.monitorCount} monitors registered; ${executions.length} ran; ${skipped.length} were not due.`, proofRefs: refs }),
    schema: MONITOR_MULTIPLEXER_SCHEMA_VERSION,
    heartbeatUtc: timestampUtc,
    monitorCount: registry.monitorCount,
    executedCount: executions.length,
    skippedCount: skipped.length,
    failedCount,
    blockedCount,
    retiredCount: executions.filter((item) => item.statusRecord.retired).length,
    notificationCount: notifications.reduce((sum, item) => sum + item.itemCount, 0),
    notificationBatchCount: notifications.length,
    notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
    externalTaskSlotsRequired: registry.monitorCount ? 1 : 0,
    independentFailureIsolation: true,
    boundedConcurrency: true,
    maxConcurrency: limit,
    restartResumeSupported: true,
    oneShotRetirementSupported: true,
    notificationDeduplicationSupported: true,
    runnerRegistryOnly: true,
    arbitraryShellAllowed: false,
    arbitraryPowerShellAllowed: false,
    arbitraryFilesystemAccess: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    monitors: registry.monitors.map((definition) => {
      const item = find(definition);
      return { monitorId: definition.monitorId, handlerId: definition.handlerId, state: item?.result?.state || item?.previousState?.state || 'WAITING', nextDueUtc: item?.statusRecord?.nextDueUtc || item?.due?.nextDueUtc || definition.nextDueUtc, heartbeatUtc: item?.statusRecord?.heartbeatUtc || item?.previousState?.heartbeatUtc || '', retired: item?.statusRecord?.retired === true || item?.due?.retired === true };
    }),
    finalVerdict: failedCount || blockedCount ? 'MONITOR_MULTIPLEXER_ATTENTION_REQUIRED' : 'MONITOR_MULTIPLEXER_READY',
  });
}

export function buildMonitorMultiplexerContract(input = {}) {
  const requestedIntervalMs = Number.isFinite(Number(input.intervalMs)) ? Number(input.intervalMs) : MONITOR_MULTIPLEXER_DEFAULT_INTERVAL_MS;
  const normalizedInterval = intervalMs(requestedIntervalMs);
  return Object.freeze({
    schemaVersion: MONITOR_MULTIPLEXER_SCHEMA_VERSION,
    contractKind: 'stephanos.monitor_multiplexer.runtime_loop.contract',
    startupIntegrationPoint: 'battle-bridge-supervisor-startup',
    intervalMs: normalizedInterval,
    requestedIntervalMs,
    minimumIntervalMs: MONITOR_MULTIPLEXER_MIN_INTERVAL_MS,
    intervalGuardApplied: normalizedInterval !== requestedIntervalMs,
    concurrency: concurrency(input.concurrency),
    maximumConcurrency: MONITOR_MULTIPLEXER_MAX_CONCURRENCY,
    boundedConcurrency: true,
    notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
    externalTaskSlotsRequired: 1,
    maxMonitors: MONITOR_MULTIPLEXER_MAX_MONITORS,
    stoppable: true,
    restartResumeSupported: true,
    independentFailureIsolation: true,
    runnerRegistryOnly: true,
    arbitraryShellAllowed: false,
    arbitraryPowerShellAllowed: false,
    arbitraryFilesystemAccess: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    testStorageAdapterProductionEnabled: false,
    finalVerdict: 'MONITOR_MULTIPLEXER_CONTRACT_READY',
  });
}

function receiptRecord(input, status, failure = null) {
  const blocked = Boolean(failure);
  return Object.freeze({
    ...createSharedWorkspaceReceiptRecord({ receiptId: input.tickId, participantId: MONITOR_MULTIPLEXER_PARTICIPANT, timestampUtc: input.timestampUtc, correlationId: input.tickId, relatedIssue: safeRef(input.relatedIssue) || '#1290', receivedRecordId: 'monitor-multiplexer-registry', disposition: blocked ? 'blocked' : 'published', summary: blocked ? 'Monitor multiplexer publish was blocked.' : `Monitor multiplexer tick published ${input.executions.length} execution results.`, proofRefs: status.proofRefs }),
    monitorCount: input.registry.monitorCount,
    executedCount: input.executions.length,
    notificationCount: status.notificationCount,
    notificationBatchCount: input.notifications.length,
    notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
    externalTaskSlotsRequired: input.registry.monitorCount ? 1 : 0,
    blockedReason: failure?.reason || '',
    fingerprintCommitted: !blocked,
  });
}

export async function runMonitorMultiplexerTick(input = {}) {
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const timestampUtc = input.timestampUtc || new Date(nowMs).toISOString();
  const limit = concurrency(input.concurrency);
  const registry = createMonitorRegistry(input.monitors, { timestampUtc });
  if (!registry.ok) return Object.freeze({ ok: false, reason: registry.errors[0] || 'MONITOR_REGISTRY_BLOCKED', registry, finalVerdict: 'MONITOR_MULTIPLEXER_TICK_BLOCKED' });
  const layout = await ensureSharedWorkspaceLayout({ root: input.root, repoRoot: input.repoRoot });
  if (!layout.ok) return Object.freeze({ ok: false, reason: layout.reason, registry, finalVerdict: 'MONITOR_MULTIPLEXER_TICK_BLOCKED' });
  const handlers = input.handlers && typeof input.handlers === 'object' ? input.handlers : {};
  const storage = storageFor(input);
  const due = [];
  const skipped = [];
  for (const definition of registry.monitors) {
    const previous = await previousState(layout.root, definition, { repoRoot: input.repoRoot, nowMs });
    const classification = classifyMonitorDue(definition, previous, { nowMs });
    (classification.due ? due : skipped).push(classification.due ? { definition, previous } : { definition, previousState: previous, due: classification });
  }
  const executions = await mapBounded(due, limit, ({ definition, previous }) => execute(definition, previous, handlers[definition.handlerId], { timestampUtc, nowMs }));
  const notifications = alertBatches(executions, timestampUtc, input.relatedIssue);
  const status = registryStatus(registry, executions, skipped, notifications, timestampUtc, limit);
  const tickId = `monitor-mux-${hash(timestampUtc)}`;
  const context = { tickId, timestampUtc, relatedIssue: input.relatedIssue, registry, executions, notifications };
  const writes = [];

  // Fail safe: an alert is persisted before its fingerprint can be committed.
  for (const notification of notifications) {
    const write = await storage.writeAtomicJson(layout.root, ['outbox', `${notification.messageId}.json`], notification, { repoRoot: input.repoRoot, nowMs });
    writes.push(write);
    if (!write.ok) {
      const receipt = receiptRecord(context, status, write);
      writes.push(await storage.writeAtomicJson(layout.root, ['receipts', `${tickId}.json`], receipt, { repoRoot: input.repoRoot, nowMs }));
      return Object.freeze({ ok: false, reason: write.reason || 'MONITOR_NOTIFICATION_OUTBOX_WRITE_FAILED', registry, executions: Object.freeze(executions), skipped: Object.freeze(skipped), notificationRecord: notifications[0] || null, notificationRecords: notifications, registryStatus: status, receipt, writes: Object.freeze(writes), finalVerdict: 'MONITOR_MULTIPLEXER_PUBLISH_BLOCKED' });
    }
  }

  for (const execution of executions) {
    writes.push(await storage.writeAtomicJson(layout.root, ['status', stateName(execution.definition.monitorId)], execution.statusRecord, { repoRoot: input.repoRoot, nowMs }));
    writes.push(await storage.writeAtomicJson(layout.root, ['proof', `monitor-${execution.definition.monitorId}.json`], execution.proofRecord, { repoRoot: input.repoRoot, nowMs }));
    writes.push(await storage.appendWorkspaceJsonl(layout.root, ['events', 'monitor-multiplexer.jsonl'], execution.eventRecord, { repoRoot: input.repoRoot, nowMs }));
  }
  writes.push(await storage.writeAtomicJson(layout.root, ['status', 'monitor-multiplexer-registry.json'], status, { repoRoot: input.repoRoot, nowMs }));
  const failure = writes.find((item) => !item.ok) || null;
  const receipt = receiptRecord(context, status, failure);
  const receiptWrite = await storage.writeAtomicJson(layout.root, ['receipts', `${tickId}.json`], receipt, { repoRoot: input.repoRoot, nowMs });
  writes.push(receiptWrite);
  const finalFailure = failure || (!receiptWrite.ok ? receiptWrite : null);
  return Object.freeze({
    ok: !finalFailure,
    reason: finalFailure?.reason || 'MONITOR_MULTIPLEXER_TICK_PUBLISHED',
    registry,
    executions: Object.freeze(executions),
    skipped: Object.freeze(skipped),
    notificationRecord: notifications[0] || null,
    notificationRecords: notifications,
    registryStatus: status,
    receipt,
    writes: Object.freeze(writes),
    finalVerdict: finalFailure ? 'MONITOR_MULTIPLEXER_PUBLISH_BLOCKED' : status.finalVerdict,
  });
}

export function startMonitorMultiplexer(input = {}) {
  const contract = buildMonitorMultiplexerContract(input);
  const setTimer = input.setIntervalFn || setInterval;
  const clearTimer = input.clearIntervalFn || clearInterval;
  let stopped = false;
  let inFlight = false;
  const tick = async () => {
    if (stopped || inFlight) return null;
    inFlight = true;
    try { return await runMonitorMultiplexerTick({ ...input, concurrency: contract.concurrency }); }
    finally { inFlight = false; }
  };
  if (input.runImmediately !== false) void tick();
  const timer = setTimer(() => { void tick(); }, contract.intervalMs);
  return Object.freeze({
    schemaVersion: MONITOR_MULTIPLEXER_SCHEMA_VERSION,
    contract,
    runNow: tick,
    stop() {
      if (!stopped) { stopped = true; clearTimer(timer); }
      return { stopped: true, finalVerdict: 'MONITOR_MULTIPLEXER_STOPPED' };
    },
  });
}
