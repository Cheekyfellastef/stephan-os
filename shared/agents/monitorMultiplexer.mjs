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
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';

export const MONITOR_MULTIPLEXER_SCHEMA_VERSION = 'stephanos.monitor-multiplexer.v1';
export const MONITOR_MULTIPLEXER_PARTICIPANT = 'monitor-multiplexer';
export const MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE = 'chatgpt-task-outbox';
export const MONITOR_MULTIPLEXER_MIN_INTERVAL_MS = 30_000;
export const MONITOR_MULTIPLEXER_DEFAULT_INTERVAL_MS = 60_000;
export const MONITOR_MULTIPLEXER_MAX_MONITORS = 1_000;

export const MONITOR_MODES = Object.freeze({
  RECURRING: 'RECURRING',
  ONE_SHOT: 'ONE_SHOT',
});

export const MONITOR_RESULT_STATES = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED: 'BLOCKED',
});

export const MONITOR_NOTIFICATION_POLICIES = Object.freeze({
  STATE_CHANGE: 'STATE_CHANGE',
  TERMINAL_ONLY: 'TERMINAL_ONLY',
});

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const SAFE_PROOF_REF = /^(proof|proofs|receipts|evidence\/receipts)\/[a-z0-9._/-]+$/i;
const FORBIDDEN_DEFINITION_KEY = /(?:^|_)(?:command|shell|powershell|argv|args|cwd|path|url|endpoint|filesystem|script)(?:$|_)/i;
const FORBIDDEN_TEXT = /secret|token|password|credential|private key|\.env|cookie|session|node_modules|runtime-data/i;
const LOCAL_PATH_TEXT = /(?:[a-z]:\\|\\\\|\/(?:users|home|workspace|tmp)\/|appdata\\|documents\\github\\)/i;
const TERMINAL_STATES = new Set(Object.values(MONITOR_RESULT_STATES));

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function boundedText(value, fallback = '', limit = 240) {
  const out = text(value, fallback);
  if (!out || FORBIDDEN_TEXT.test(out) || LOCAL_PATH_TEXT.test(out)) return fallback;
  return out.length > limit ? `${out.slice(0, Math.max(0, limit - 3))}...` : out;
}

function safeId(value, fallback = '') {
  const out = text(value).toLowerCase();
  return SAFE_ID.test(out) ? out : fallback;
}

function timestampMs(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function safeProofRefs(value, fallback = []) {
  const source = Array.isArray(value) && value.length > 0 ? value : fallback;
  return [...new Set(source.map(String).map((item) => item.trim()).filter((item) => (
    SAFE_PROOF_REF.test(item)
    && !item.split('/').includes('..')
  )))].slice(0, 32);
}

function shortHash(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function collectForbiddenKeys(value, prefix = '') {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => collectForbiddenKeys(item, `${prefix}${index}.`));
  const errors = [];
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_DEFINITION_KEY.test(key)) errors.push(`forbidden-definition-key:${prefix}${key}`);
    errors.push(...collectForbiddenKeys(child, `${prefix}${key}.`));
  }
  return errors;
}

function normalizeIntervalMs(value) {
  const candidate = Number(value);
  if (!Number.isFinite(candidate)) return MONITOR_MULTIPLEXER_DEFAULT_INTERVAL_MS;
  return Math.max(MONITOR_MULTIPLEXER_MIN_INTERVAL_MS, Math.trunc(candidate));
}

function normalizeMaxRuntimeMs(value) {
  const candidate = Number(value);
  if (!Number.isFinite(candidate)) return 30_000;
  return Math.min(15 * 60_000, Math.max(1_000, Math.trunc(candidate)));
}

function normalizeMode(value) {
  const mode = text(value, MONITOR_MODES.RECURRING).toUpperCase();
  return Object.values(MONITOR_MODES).includes(mode) ? mode : '';
}

function normalizeNotificationPolicy(value) {
  const policy = text(value, MONITOR_NOTIFICATION_POLICIES.STATE_CHANGE).toUpperCase();
  return Object.values(MONITOR_NOTIFICATION_POLICIES).includes(policy) ? policy : '';
}

export function validateMonitorDefinition(input = {}) {
  const errors = collectForbiddenKeys(input);
  if (!safeId(input.monitorId)) errors.push('invalid-monitor-id');
  if (!safeId(input.handlerId)) errors.push('invalid-handler-id');
  if (!normalizeMode(input.mode)) errors.push('invalid-monitor-mode');
  if (!normalizeNotificationPolicy(input.notificationPolicy)) errors.push('invalid-notification-policy');
  if (!text(input.relatedIssue) && !text(input.relatedPr)) errors.push('missing-related-issue-or-pr');
  if (input.nextDueUtc && !Number.isFinite(timestampMs(input.nextDueUtc))) errors.push('invalid-next-due-utc');
  if (input.proofRefs && safeProofRefs(input.proofRefs).length !== input.proofRefs.length) errors.push('unsafe-proof-ref');
  return Object.freeze({
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    finalVerdict: errors.length === 0 ? 'MONITOR_DEFINITION_PASS' : 'MONITOR_DEFINITION_BLOCKED',
  });
}

export function createMonitorDefinition(input = {}, options = {}) {
  const validation = validateMonitorDefinition(input);
  if (!validation.valid) return Object.freeze({ ok: false, validation });
  const monitorId = safeId(input.monitorId);
  const timestampUtc = text(input.nextDueUtc, options.timestampUtc || new Date(0).toISOString());
  const proofRefs = safeProofRefs(input.proofRefs, [`proof/monitor-${monitorId}.json`]);
  return Object.freeze({
    ok: true,
    validation,
    definition: Object.freeze({
      schemaVersion: MONITOR_MULTIPLEXER_SCHEMA_VERSION,
      monitorId,
      handlerId: safeId(input.handlerId),
      mode: normalizeMode(input.mode),
      intervalMs: normalizeIntervalMs(input.intervalMs),
      maxRuntimeMs: normalizeMaxRuntimeMs(input.maxRuntimeMs),
      nextDueUtc: timestampUtc,
      enabled: input.enabled !== false,
      notificationPolicy: normalizeNotificationPolicy(input.notificationPolicy),
      relatedIssue: text(input.relatedIssue),
      relatedPr: text(input.relatedPr),
      summary: boundedText(input.summary, `Monitor ${monitorId}.`, 160),
      proofRefs,
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
  if (!Array.isArray(definitions)) {
    return Object.freeze({ ok: false, monitors: [], errors: ['definitions-not-array'], finalVerdict: 'MONITOR_REGISTRY_BLOCKED' });
  }
  if (definitions.length > MONITOR_MULTIPLEXER_MAX_MONITORS) {
    return Object.freeze({ ok: false, monitors: [], errors: ['monitor-limit-exceeded'], finalVerdict: 'MONITOR_REGISTRY_BLOCKED' });
  }
  const monitors = [];
  const errors = [];
  const ids = new Set();
  for (const input of definitions) {
    const created = createMonitorDefinition(input, options);
    if (!created.ok) {
      errors.push(...created.validation.errors.map((error) => `${safeId(input?.monitorId, 'unknown')}:${error}`));
      continue;
    }
    if (ids.has(created.definition.monitorId)) {
      errors.push(`${created.definition.monitorId}:duplicate-monitor-id`);
      continue;
    }
    ids.add(created.definition.monitorId);
    monitors.push(created.definition);
  }
  return Object.freeze({
    schemaVersion: MONITOR_MULTIPLEXER_SCHEMA_VERSION,
    ok: errors.length === 0,
    monitors: Object.freeze(monitors),
    errors: Object.freeze(errors),
    monitorCount: monitors.length,
    notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
    externalTaskSlotsRequired: monitors.length > 0 ? 1 : 0,
    runnerRegistryOnly: true,
    arbitraryShellAllowed: false,
    arbitraryPowerShellAllowed: false,
    arbitraryFilesystemAccess: false,
    finalVerdict: errors.length === 0 ? 'MONITOR_REGISTRY_READY' : 'MONITOR_REGISTRY_BLOCKED',
  });
}

function stateFileName(monitorId) {
  return `monitor-${monitorId}.json`;
}

async function readPreviousState(root, definition, options = {}) {
  const resolved = resolveSharedWorkspacePath({
    root,
    repoRoot: options.repoRoot,
    segments: ['status', stateFileName(definition.monitorId)],
  });
  if (!resolved.ok) return null;
  try {
    const record = JSON.parse(await readFile(resolved.path, 'utf8'));
    return record?.monitorId === definition.monitorId ? record : null;
  } catch {
    return null;
  }
}

export function classifyMonitorDue(definition, previousState = null, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const nextDueUtc = text(previousState?.nextDueUtc || definition?.nextDueUtc, new Date(0).toISOString());
  const nextDueMs = timestampMs(nextDueUtc);
  const retired = previousState?.retired === true;
  const enabled = definition?.enabled !== false;
  const due = enabled && !retired && Number.isFinite(nextDueMs) && nextDueMs <= nowMs;
  return Object.freeze({
    due,
    enabled,
    retired,
    nextDueUtc,
    reason: retired ? 'MONITOR_RETIRED' : (!enabled ? 'MONITOR_DISABLED' : (due ? 'MONITOR_DUE' : 'MONITOR_NOT_DUE')),
  });
}

function normalizeHandlerResult(result = {}, definition) {
  const requestedState = text(result.state || result.status || result.verdict, result.ok === false ? MONITOR_RESULT_STATES.FAIL : MONITOR_RESULT_STATES.PASS).toUpperCase();
  const state = TERMINAL_STATES.has(requestedState) ? requestedState : MONITOR_RESULT_STATES.BLOCKED;
  return Object.freeze({
    state,
    summary: boundedText(result.summary, `${definition.monitorId} returned ${state}.`, 240),
    blocker: boundedText(result.blocker, state === MONITOR_RESULT_STATES.BLOCKED ? 'MONITOR_HANDLER_BLOCKED' : '', 120),
    nextAction: boundedText(result.nextAction, state === MONITOR_RESULT_STATES.PASS ? 'Continue on the configured schedule.' : 'Inspect the monitor proof and advance the owning lane.', 240),
    proofRefs: safeProofRefs(result.proofRefs, definition.proofRefs),
    notify: result.notify !== false,
  });
}

async function runWithTimeout(handler, context, maxRuntimeMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => handler(context)),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({
          state: MONITOR_RESULT_STATES.BLOCKED,
          summary: 'Monitor exceeded its bounded runtime window.',
          blocker: 'MONITOR_HANDLER_TIMEOUT',
          nextAction: 'Inspect the bounded monitor handler and reduce or split its work.',
        }), maxRuntimeMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function notificationFingerprint(definition, result) {
  return shortHash(JSON.stringify([
    definition.monitorId,
    result.state,
    result.summary,
    result.blocker,
    result.nextAction,
  ]));
}

function shouldNotify(definition, previousState, result, fingerprint) {
  if (!result.notify) return false;
  if (previousState?.notificationFingerprint === fingerprint) return false;
  if (definition.notificationPolicy === MONITOR_NOTIFICATION_POLICIES.TERMINAL_ONLY) {
    return TERMINAL_STATES.has(result.state);
  }
  return previousState?.state !== result.state
    || previousState?.summary !== result.summary
    || previousState?.blocker !== result.blocker;
}

async function executeMonitor(definition, previousState, handler, input = {}) {
  const timestampUtc = input.timestampUtc;
  const nowMs = input.nowMs;
  let rawResult;
  if (typeof handler !== 'function') {
    rawResult = {
      state: MONITOR_RESULT_STATES.BLOCKED,
      summary: 'Monitor handler is not registered.',
      blocker: 'MONITOR_HANDLER_NOT_REGISTERED',
      nextAction: 'Register the fixed handler ID in the Battle Bridge monitor runner registry.',
    };
  } else {
    try {
      rawResult = await runWithTimeout(handler, Object.freeze({
        monitorId: definition.monitorId,
        handlerId: definition.handlerId,
        relatedIssue: definition.relatedIssue,
        relatedPr: definition.relatedPr,
        previousState,
        timestampUtc,
      }), definition.maxRuntimeMs);
    } catch {
      rawResult = {
        state: MONITOR_RESULT_STATES.FAIL,
        summary: 'Monitor handler failed without publishing unsafe error detail.',
        blocker: 'MONITOR_HANDLER_FAILED',
        nextAction: 'Inspect the local monitor proof and repair the fixed handler.',
      };
    }
  }
  const result = normalizeHandlerResult(rawResult, definition);
  const retired = definition.mode === MONITOR_MODES.ONE_SHOT && TERMINAL_STATES.has(result.state);
  const nextDueUtc = retired
    ? text(previousState?.nextDueUtc || definition.nextDueUtc, timestampUtc)
    : new Date(nowMs + definition.intervalMs).toISOString();
  const fingerprint = notificationFingerprint(definition, result);
  const notificationPending = shouldNotify(definition, previousState, result, fingerprint);
  const proofRefs = safeProofRefs(result.proofRefs, definition.proofRefs);
  const runCount = Number.isSafeInteger(previousState?.runCount) ? previousState.runCount + 1 : 1;
  const statusRecord = Object.freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: `monitor-${definition.monitorId}`,
      participantId: MONITOR_MULTIPLEXER_PARTICIPANT,
      timestampUtc,
      status: result.state,
      summary: result.summary,
      proofRefs,
    }),
    schema: MONITOR_MULTIPLEXER_SCHEMA_VERSION,
    monitorId: definition.monitorId,
    handlerId: definition.handlerId,
    monitorMode: definition.mode,
    notificationPolicy: definition.notificationPolicy,
    notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
    notificationFingerprint: fingerprint,
    notificationPending,
    runCount,
    retired,
    nextDueUtc,
    blocker: result.blocker,
    nextAction: result.nextAction,
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
    ...createSharedWorkspaceProofRecord({
      proofId: `monitor-${definition.monitorId}`,
      participantId: MONITOR_MULTIPLEXER_PARTICIPANT,
      timestampUtc,
      correlationId: definition.monitorId,
      relatedIssue: definition.relatedIssue,
      relatedPr: definition.relatedPr,
      status: result.state,
      summary: result.summary,
      refs: proofRefs,
      proofRefs,
    }),
    monitorId: definition.monitorId,
    runCount,
    blocker: result.blocker,
    nextAction: result.nextAction,
    retired,
  });
  const eventRecord = Object.freeze({
    ...createSharedWorkspaceEventRecord({
      eventId: `monitor-${definition.monitorId}-${shortHash(`${timestampUtc}:${result.state}`)}`,
      participantId: MONITOR_MULTIPLEXER_PARTICIPANT,
      timestampUtc,
      eventKind: 'monitor-tick-result',
      summary: result.summary,
    }),
    monitorId: definition.monitorId,
    state: result.state,
    runCount,
    blocker: result.blocker,
    notificationPending,
    proofRefs,
  });
  return Object.freeze({ definition, previousState, result, statusRecord, proofRecord, eventRecord, notificationPending });
}

function createNotificationBatch(executions, input = {}) {
  const pending = executions.filter((item) => item.notificationPending);
  if (pending.length === 0) return null;
  const timestampUtc = input.timestampUtc;
  const batchHash = shortHash(`${timestampUtc}:${pending.map((item) => item.statusRecord.notificationFingerprint).join(':')}`);
  const messageId = `monitor-notify-${batchHash}`;
  const proofRefs = safeProofRefs(pending.flatMap((item) => item.statusRecord.proofRefs));
  const items = pending.map((item) => ({
    monitorId: item.definition.monitorId,
    state: item.result.state,
    summary: item.result.summary,
    blocker: item.result.blocker,
    nextAction: item.result.nextAction,
    relatedIssue: item.definition.relatedIssue,
    relatedPr: item.definition.relatedPr,
    proofRefs: item.statusRecord.proofRefs,
  }));
  return Object.freeze({
    ...createSharedWorkspaceMessageRecord({
      messageId,
      participantId: MONITOR_MULTIPLEXER_PARTICIPANT,
      timestampUtc,
      correlationId: messageId,
      relatedIssue: input.relatedIssue || '#1290',
      channel: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
      summary: `${items.length} monitor state change${items.length === 1 ? '' : 's'} require attention.`,
      body: JSON.stringify({
        schemaVersion: MONITOR_MULTIPLEXER_SCHEMA_VERSION,
        notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
        itemCount: items.length,
        items,
      }),
      proofRefs,
    }),
    notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
    itemCount: items.length,
    deduplicated: true,
    externalTaskSlotsRequired: 1,
  });
}

function createRegistryStatus(registry, executions, skipped, notificationRecord, input = {}) {
  const timestampUtc = input.timestampUtc;
  const proofRefs = safeProofRefs(executions.flatMap((item) => item.statusRecord.proofRefs), ['proof/monitor-multiplexer.json']);
  const failedCount = executions.filter((item) => item.result.state === MONITOR_RESULT_STATES.FAIL).length;
  const blockedCount = executions.filter((item) => item.result.state === MONITOR_RESULT_STATES.BLOCKED).length;
  const retiredCount = executions.filter((item) => item.statusRecord.retired).length;
  return Object.freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: 'monitor-multiplexer-registry',
      participantId: MONITOR_MULTIPLEXER_PARTICIPANT,
      timestampUtc,
      status: failedCount || blockedCount ? 'ATTENTION_REQUIRED' : 'READY',
      summary: `${registry.monitorCount} monitors registered; ${executions.length} ran; ${skipped.length} were not due.`,
      proofRefs,
    }),
    schema: MONITOR_MULTIPLEXER_SCHEMA_VERSION,
    monitorCount: registry.monitorCount,
    executedCount: executions.length,
    skippedCount: skipped.length,
    failedCount,
    blockedCount,
    retiredCount,
    notificationCount: notificationRecord?.itemCount || 0,
    notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
    externalTaskSlotsRequired: registry.monitorCount > 0 ? 1 : 0,
    independentFailureIsolation: true,
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
      const execution = executions.find((item) => item.definition.monitorId === definition.monitorId);
      const skippedItem = skipped.find((item) => item.definition.monitorId === definition.monitorId);
      return {
        monitorId: definition.monitorId,
        handlerId: definition.handlerId,
        state: execution?.result.state || skippedItem?.previousState?.state || 'WAITING',
        nextDueUtc: execution?.statusRecord.nextDueUtc || skippedItem?.due.nextDueUtc || definition.nextDueUtc,
        retired: execution?.statusRecord.retired === true || skippedItem?.due.retired === true,
      };
    }),
    finalVerdict: failedCount || blockedCount ? 'MONITOR_MULTIPLEXER_ATTENTION_REQUIRED' : 'MONITOR_MULTIPLEXER_READY',
  });
}

export function buildMonitorMultiplexerContract(input = {}) {
  const requestedIntervalMs = Number.isFinite(Number(input.intervalMs)) ? Number(input.intervalMs) : MONITOR_MULTIPLEXER_DEFAULT_INTERVAL_MS;
  const intervalMs = normalizeIntervalMs(requestedIntervalMs);
  return Object.freeze({
    schemaVersion: MONITOR_MULTIPLEXER_SCHEMA_VERSION,
    contractKind: 'stephanos.monitor_multiplexer.runtime_loop.contract',
    startupIntegrationPoint: 'battle-bridge-supervisor-startup',
    intervalMs,
    requestedIntervalMs,
    minimumIntervalMs: MONITOR_MULTIPLEXER_MIN_INTERVAL_MS,
    intervalGuardApplied: intervalMs !== requestedIntervalMs,
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
    finalVerdict: 'MONITOR_MULTIPLEXER_CONTRACT_READY',
  });
}

export async function runMonitorMultiplexerTick(input = {}) {
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const timestampUtc = input.timestampUtc || new Date(nowMs).toISOString();
  const registry = createMonitorRegistry(input.monitors, { timestampUtc });
  if (!registry.ok) {
    return Object.freeze({
      ok: false,
      reason: registry.errors[0] || 'MONITOR_REGISTRY_BLOCKED',
      registry,
      finalVerdict: 'MONITOR_MULTIPLEXER_TICK_BLOCKED',
    });
  }
  const layout = await ensureSharedWorkspaceLayout({ root: input.root, repoRoot: input.repoRoot });
  if (!layout.ok) return Object.freeze({ ok: false, reason: layout.reason, registry, finalVerdict: 'MONITOR_MULTIPLEXER_TICK_BLOCKED' });
  const handlers = input.handlers && typeof input.handlers === 'object' ? input.handlers : {};
  const dueItems = [];
  const skipped = [];
  for (const definition of registry.monitors) {
    const previousState = await readPreviousState(layout.root, definition, { repoRoot: input.repoRoot });
    const due = classifyMonitorDue(definition, previousState, { nowMs });
    if (due.due) dueItems.push({ definition, previousState });
    else skipped.push({ definition, previousState, due });
  }
  const settled = await Promise.allSettled(dueItems.map(({ definition, previousState }) => executeMonitor(
    definition,
    previousState,
    handlers[definition.handlerId],
    { timestampUtc, nowMs },
  )));
  const executions = settled.map((settledItem, index) => {
    if (settledItem.status === 'fulfilled') return settledItem.value;
    const { definition, previousState } = dueItems[index];
    return executeMonitor(definition, previousState, null, { timestampUtc, nowMs });
  });
  const resolvedExecutions = await Promise.all(executions);
  const notificationRecord = createNotificationBatch(resolvedExecutions, { timestampUtc, relatedIssue: input.relatedIssue });
  const registryStatus = createRegistryStatus(registry, resolvedExecutions, skipped, notificationRecord, { timestampUtc });
  const tickId = `monitor-mux-${shortHash(timestampUtc)}`;
  const writes = [];
  for (const execution of resolvedExecutions) {
    writes.push(await writeAtomicJson(layout.root, ['status', stateFileName(execution.definition.monitorId)], execution.statusRecord, { repoRoot: input.repoRoot, nowMs }));
    writes.push(await writeAtomicJson(layout.root, ['proof', `monitor-${execution.definition.monitorId}.json`], execution.proofRecord, { repoRoot: input.repoRoot, nowMs }));
    writes.push(await appendWorkspaceJsonl(layout.root, ['events', 'monitor-multiplexer.jsonl'], execution.eventRecord, { repoRoot: input.repoRoot, nowMs }));
  }
  writes.push(await writeAtomicJson(layout.root, ['status', 'monitor-multiplexer-registry.json'], registryStatus, { repoRoot: input.repoRoot, nowMs }));
  if (notificationRecord) {
    writes.push(await writeAtomicJson(layout.root, ['outbox', `${notificationRecord.messageId}.json`], notificationRecord, { repoRoot: input.repoRoot, nowMs }));
  }
  const receipt = Object.freeze({
    ...createSharedWorkspaceReceiptRecord({
      receiptId: tickId,
      participantId: MONITOR_MULTIPLEXER_PARTICIPANT,
      timestampUtc,
      correlationId: tickId,
      relatedIssue: input.relatedIssue || '#1290',
      receivedRecordId: 'monitor-multiplexer-registry',
      disposition: 'published',
      summary: `Monitor multiplexer tick published ${resolvedExecutions.length} execution results.`,
      proofRefs: registryStatus.proofRefs,
    }),
    monitorCount: registry.monitorCount,
    executedCount: resolvedExecutions.length,
    notificationCount: notificationRecord?.itemCount || 0,
    notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
    externalTaskSlotsRequired: registry.monitorCount > 0 ? 1 : 0,
  });
  writes.push(await writeAtomicJson(layout.root, ['receipts', `${tickId}.json`], receipt, { repoRoot: input.repoRoot, nowMs }));
  const failedWrite = writes.find((write) => !write.ok);
  if (failedWrite) {
    return Object.freeze({
      ok: false,
      reason: failedWrite.reason,
      registry,
      executions: resolvedExecutions,
      skipped,
      notificationRecord,
      registryStatus,
      receipt,
      writes,
      finalVerdict: 'MONITOR_MULTIPLEXER_PUBLISH_BLOCKED',
    });
  }
  return Object.freeze({
    ok: true,
    reason: 'MONITOR_MULTIPLEXER_TICK_PUBLISHED',
    registry,
    executions: Object.freeze(resolvedExecutions),
    skipped: Object.freeze(skipped),
    notificationRecord,
    registryStatus,
    receipt,
    writes: Object.freeze(writes),
    finalVerdict: registryStatus.finalVerdict,
  });
}

export function startMonitorMultiplexer(input = {}) {
  const contract = buildMonitorMultiplexerContract({ intervalMs: input.intervalMs });
  const setTimer = input.setIntervalFn || setInterval;
  const clearTimer = input.clearIntervalFn || clearInterval;
  let stopped = false;
  let inFlight = false;
  const tick = async () => {
    if (stopped || inFlight) return null;
    inFlight = true;
    try {
      return await runMonitorMultiplexerTick(input);
    } finally {
      inFlight = false;
    }
  };
  if (input.runImmediately !== false) void tick();
  const timer = setTimer(() => { void tick(); }, contract.intervalMs);
  return Object.freeze({
    schemaVersion: MONITOR_MULTIPLEXER_SCHEMA_VERSION,
    contract,
    runNow: tick,
    stop() {
      if (!stopped) {
        stopped = true;
        clearTimer(timer);
      }
      return { stopped: true, finalVerdict: 'MONITOR_MULTIPLEXER_STOPPED' };
    },
  });
}
