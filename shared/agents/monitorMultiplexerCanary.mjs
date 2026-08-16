import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createSharedWorkspaceProofRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';
import {
  MONITOR_MODES,
  MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
  createMonitorMultiplexerTestStorageAdapter,
  runMonitorMultiplexerTick,
} from './monitorMultiplexer.mjs';

export const MONITOR_MULTIPLEXER_CANARY_SCHEMA = 'stephanos.monitor-multiplexer-canary.v1';
export const MONITOR_MULTIPLEXER_CANARY_MONITOR_COUNT = 13;
export const MONITOR_MULTIPLEXER_CANARY_CONCURRENCY = 3;

const SHA = /^[0-9a-f]{40}$/i;
const SAFE_REQUEST = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;

function hash(value, length = 16) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function listOutbox(root) {
  try {
    return (await readdir(join(root, 'outbox')))
      .filter((name) => name.startsWith('monitor-notify-') && name.endsWith('.json'));
  } catch {
    return [];
  }
}

export function validateMonitorMultiplexerCanaryRequest(input = {}) {
  const expectedHead = String(input.expectedHead || '').trim().toLowerCase();
  const sourceHead = String(input.sourceHead || '').trim().toLowerCase();
  const requestId = String(input.requestId || `monitor-canary-${hash(expectedHead || sourceHead)}`);
  const errors = [];
  if (!SHA.test(expectedHead)) errors.push('EXPECTED_HEAD_INVALID');
  if (!SHA.test(sourceHead)) errors.push('SOURCE_HEAD_INVALID');
  if (expectedHead && sourceHead && expectedHead !== sourceHead) errors.push('EXPECTED_HEAD_MISMATCH');
  if (!SAFE_REQUEST.test(requestId)) errors.push('REQUEST_ID_INVALID');
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    expectedHead,
    sourceHead,
    requestId,
    canaryId: hash(`${requestId}:${expectedHead}`),
    finalVerdict: errors.length ? 'MONITOR_MULTIPLEXER_CANARY_REQUEST_BLOCKED' : 'MONITOR_MULTIPLEXER_CANARY_REQUEST_READY',
  });
}

function definitions(canaryId, timestampUtc) {
  return Object.freeze(Array.from({ length: MONITOR_MULTIPLEXER_CANARY_MONITOR_COUNT }, (_, index) => {
    const ordinal = index + 1;
    const monitorId = `mux-canary-${canaryId}-${String(ordinal).padStart(2, '0')}`;
    return Object.freeze({
      monitorId,
      handlerId: `mux-handler-${canaryId}-${String(ordinal).padStart(2, '0')}`,
      mode: ordinal >= 12 ? MONITOR_MODES.ONE_SHOT : MONITOR_MODES.RECURRING,
      intervalMs: 30_000,
      maxRuntimeMs: 5_000,
      nextDueUtc: timestampUtc,
      relatedIssue: '#1290',
      summary: `Monitor multiplexer canary ${ordinal}.`,
      proofRefs: [`proof/monitor-multiplexer-canary-${canaryId}.json`],
    });
  }));
}

function handlersFor(monitors, concurrencyProbe) {
  return Object.freeze(Object.fromEntries(monitors.map((monitor, index) => [monitor.handlerId, async () => {
    concurrencyProbe.active += 1;
    concurrencyProbe.maximum = Math.max(concurrencyProbe.maximum, concurrencyProbe.active);
    try {
      await delay(8);
      if (index === 10) throw new Error('expected canary failure');
      return {
        state: 'PASS',
        summary: `${monitor.monitorId} passed the fixed canary handler.`,
        proofRefs: monitor.proofRefs,
      };
    } finally {
      concurrencyProbe.active -= 1;
    }
  }])));
}

function totalNotifications(result) {
  return Array.isArray(result?.notificationRecords)
    ? result.notificationRecords.reduce((sum, record) => sum + Number(record?.itemCount || 0), 0)
    : 0;
}

function durableMonitorFieldsPresent(executions = []) {
  return executions.every((execution) => (
    Number.isInteger(execution?.statusRecord?.runCount)
    && Boolean(execution?.statusRecord?.heartbeatUtc)
    && Boolean(execution?.statusRecord?.nextDueUtc)
    && Array.isArray(execution?.statusRecord?.proofRefs)
    && typeof execution?.statusRecord?.retired === 'boolean'
  ));
}

export function receiptRefForPublishedTick(result) {
  const receiptId = String(result?.receipt?.receiptId || '');
  const writes = Array.isArray(result?.writes) ? result.writes : [];
  const receiptWrite = writes.length ? writes[writes.length - 1] : null;
  return receiptId && receiptWrite?.ok === true ? `receipts/${receiptId}.json` : '';
}

export async function runMonitorMultiplexerCanary(input = {}) {
  const request = validateMonitorMultiplexerCanaryRequest(input);
  if (!request.valid) {
    return Object.freeze({
      ok: false,
      schemaVersion: MONITOR_MULTIPLEXER_CANARY_SCHEMA,
      blocker: request.errors[0],
      request,
      finalVerdict: 'MONITOR_MULTIPLEXER_CANARY_BLOCKED',
    });
  }

  const baselineOutbox = new Set(await listOutbox(input.root));
  const baseMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const firstTimestampUtc = new Date(baseMs).toISOString();
  const retryMs = baseMs + 1_000;
  const retryTimestampUtc = new Date(retryMs).toISOString();
  const restartMs = retryMs + 30_000;
  const restartTimestampUtc = new Date(restartMs).toISOString();
  const monitors = definitions(request.canaryId, firstTimestampUtc);
  const concurrencyProbe = { active: 0, maximum: 0 };
  const handlers = handlersFor(monitors, concurrencyProbe);
  const common = {
    root: input.root,
    repoRoot: input.repoRoot,
    monitors,
    handlers,
    concurrency: MONITOR_MULTIPLEXER_CANARY_CONCURRENCY,
    relatedIssue: '#1290',
  };

  const forcedOutboxFailure = await runMonitorMultiplexerTick({
    ...common,
    nowMs: baseMs,
    timestampUtc: firstTimestampUtc,
    testStorageAdapter: createMonitorMultiplexerTestStorageAdapter({
      recordKind: 'notification-outbox',
      occurrence: 1,
    }),
  });

  const retry = await runMonitorMultiplexerTick({
    ...common,
    nowMs: retryMs,
    timestampUtc: retryTimestampUtc,
  });

  const restart = await runMonitorMultiplexerTick({
    ...common,
    nowMs: restartMs,
    timestampUtc: restartTimestampUtc,
  });

  const outboxFiles = await listOutbox(input.root);
  const newOutboxFiles = outboxFiles.filter((name) => !baselineOutbox.has(name));
  const expectedOutboxFiles = (retry.notificationRecords || []).map((record) => `${record.messageId}.json`);
  const retryFailures = retry.executions?.filter((execution) => execution.result?.state === 'FAIL') || [];
  const retryPasses = retry.executions?.filter((execution) => execution.result?.state === 'PASS') || [];
  const retiredSkipped = restart.skipped?.filter((entry) => entry.due?.reason === 'MONITOR_RETIRED') || [];
  const recurringRunCounts = restart.executions?.map((execution) => execution.statusRecord?.runCount) || [];
  const tickReceiptRefs = [
    receiptRefForPublishedTick(forcedOutboxFailure),
    receiptRefForPublishedTick(retry),
    receiptRefForPublishedTick(restart),
  ].filter(Boolean);

  const checks = Object.freeze({
    exactHeadPass: request.expectedHead === request.sourceHead,
    monitorCountPass: retry.registry?.monitorCount === MONITOR_MULTIPLEXER_CANARY_MONITOR_COUNT,
    singleNotificationSurfacePass: retry.registry?.externalTaskSlotsRequired === 1
      && retry.notificationRecords?.every((record) => record.notificationSurface === MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE),
    notificationBatchingPass: retry.notificationRecords?.length === 2
      && totalNotifications(retry) === MONITOR_MULTIPLEXER_CANARY_MONITOR_COUNT,
    isolatedFailurePass: retryFailures.length === 1
      && retryPasses.length === MONITOR_MULTIPLEXER_CANARY_MONITOR_COUNT - 1,
    boundedConcurrencyPass: concurrencyProbe.maximum >= 2
      && concurrencyProbe.maximum <= MONITOR_MULTIPLEXER_CANARY_CONCURRENCY,
    outboxFailureRecoveryPass: forcedOutboxFailure.ok === false
      && forcedOutboxFailure.finalVerdict === 'MONITOR_MULTIPLEXER_PUBLISH_BLOCKED'
      && retry.ok === true
      && totalNotifications(retry) === MONITOR_MULTIPLEXER_CANARY_MONITOR_COUNT,
    deduplicationPass: restart.ok === true
      && totalNotifications(restart) === 0
      && restart.notificationRecords?.length === 0,
    restartResumePass: recurringRunCounts.length === 11
      && recurringRunCounts.every((count) => count === 2),
    oneShotRetirementPass: retiredSkipped.length === 2,
    perMonitorDurabilityPass: durableMonitorFieldsPresent(retry.executions),
    sharedWorkspaceOutboxPass: newOutboxFiles.length === expectedOutboxFiles.length
      && expectedOutboxFiles.every((name) => newOutboxFiles.includes(name)),
    sharedWorkspaceReceiptsPass: tickReceiptRefs.length === 3,
  });

  const checksPass = Object.values(checks).every(Boolean);
  const proofId = `monitor-multiplexer-canary-${request.canaryId}`;
  const proofRef = `proof/${proofId}.json`;
  const proofRefs = [proofRef, ...tickReceiptRefs];
  const proofRecord = Object.freeze({
    ...createSharedWorkspaceProofRecord({
      proofId,
      participantId: 'monitor-multiplexer',
      timestampUtc: restartTimestampUtc,
      correlationId: request.canaryId,
      relatedIssue: '#1290',
      status: checksPass ? 'PASS' : 'BLOCKED',
      summary: checksPass
        ? 'Real monitor multiplexer canary passed its bounded acceptance checks.'
        : 'Monitor multiplexer canary did not satisfy every bounded acceptance check.',
      refs: proofRefs,
      proofRefs,
    }),
    schema: MONITOR_MULTIPLEXER_CANARY_SCHEMA,
    sourceHead: request.sourceHead,
    expectedHeadMatch: request.expectedHead === request.sourceHead,
    monitorCount: MONITOR_MULTIPLEXER_CANARY_MONITOR_COUNT,
    externalTaskSlotsRequired: 1,
    notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
    maxConcurrencyObserved: concurrencyProbe.maximum,
    checks,
    arbitraryShellAllowed: false,
    arbitraryPowerShellAllowed: false,
    arbitraryFilesystemAccess: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
  });
  const proofWrite = await writeAtomicJson(input.root, ['proof', `${proofId}.json`], proofRecord, {
    repoRoot: input.repoRoot,
    nowMs: restartMs,
  });
  const ok = checksPass && proofWrite.ok;

  return Object.freeze({
    ok,
    schemaVersion: MONITOR_MULTIPLEXER_CANARY_SCHEMA,
    requestId: request.requestId,
    canaryId: request.canaryId,
    sourceHead: request.sourceHead,
    expectedHeadMatch: request.expectedHead === request.sourceHead,
    monitorCount: MONITOR_MULTIPLEXER_CANARY_MONITOR_COUNT,
    executedCount: retry.executions?.length || 0,
    unaffectedMonitorCount: retryPasses.length,
    expectedFailureCount: retryFailures.length,
    notificationBatchCount: retry.notificationRecords?.length || 0,
    notificationCount: totalNotifications(retry),
    notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
    externalTaskSlotsRequired: 1,
    maxConcurrencyObserved: concurrencyProbe.maximum,
    receiptCount: tickReceiptRefs.length,
    checks,
    proofRefs,
    proofWrittenToSharedWorkspace: proofWrite.ok === true,
    blocker: ok ? '' : (!checksPass ? 'MONITOR_MULTIPLEXER_CANARY_CHECK_FAILED' : proofWrite.reason),
    arbitraryShellAllowed: false,
    arbitraryPowerShellAllowed: false,
    arbitraryFilesystemAccess: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    finalVerdict: ok ? 'MONITOR_MULTIPLEXER_CANARY_PASS' : 'MONITOR_MULTIPLEXER_CANARY_BLOCKED',
  });
}
