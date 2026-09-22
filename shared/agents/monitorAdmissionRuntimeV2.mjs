import { readFile } from 'node:fs/promises';
import {
  admitLogicalMonitor,
  MONITOR_ADMISSION_REGISTRY_VERSION,
  proposalToMonitorDefinition,
} from './monitorAdmissionBridge.mjs';
import {
  MONITOR_MULTIPLEXER_MAX_CONCURRENCY,
  MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
  runMonitorMultiplexerTick,
} from './monitorMultiplexer.mjs';
import {
  createSharedWorkspaceReceiptRecord,
  createSharedWorkspaceStatusRecord,
  ensureSharedWorkspaceLayout,
  resolveSharedWorkspacePath,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';

export const MONITOR_ADMISSION_RUNTIME_V2_SCHEMA = 'stephanos.monitor-admission-runtime.v2';
export const MONITOR_ADMISSION_RUNTIME_V2_PARTICIPANT = 'monitor-admission-runtime-v2';
export const LOGICAL_CONTROLLER_SCOPE_PREFIX = 'controller:';

const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => String(value ?? '').trim();
const safeId = (value) => /^[a-z0-9][a-z0-9._-]{0,80}$/i.test(text(value)) ? text(value) : '';
const DERIVED_MONITOR_AUTHORITY_FIELDS = Object.freeze([
  'runnerRegistryOnly',
  'arbitraryShellAllowed',
  'arbitraryPowerShellAllowed',
  'arbitraryFilesystemAccess',
  'sourceMutationAllowed',
  'mergeAuthority',
]);

function runtimeMonitorInput(definition = {}) {
  const input = { ...definition };
  for (const key of DERIVED_MONITOR_AUTHORITY_FIELDS) delete input[key];
  return Object.freeze(input);
}

function runtimeSafeRegistry(value) {
  if (!plainObject(value) || value.registrySchemaVersion !== MONITOR_ADMISSION_REGISTRY_VERSION) return false;
  if (!plainObject(value.monitors) || !plainObject(value.idempotency)) return false;
  for (const [monitorId, monitor] of Object.entries(value.monitors)) {
    if (!safeId(monitorId) || !plainObject(monitor) || monitor.monitorId !== monitorId || !plainObject(monitor.proposal)) return false;
    try {
      const expected = proposalToMonitorDefinition(monitor.proposal);
      if (!expected || expected.monitorId !== monitorId || !plainObject(monitor.definition)) return false;
      if (JSON.stringify(expected) !== JSON.stringify(monitor.definition)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function loadMonitorAdmissionRegistryV2(input = {}) {
  const layout = await ensureSharedWorkspaceLayout({ root: input.root, repoRoot: input.repoRoot });
  if (!layout.ok) return Object.freeze({ ok: false, reason: 'MULTIPLEXER_ADMISSION_UNAVAILABLE', registry: null, monitorCount: 0 });
  const resolved = resolveSharedWorkspacePath({
    root: layout.root,
    repoRoot: input.repoRoot,
    segments: ['status', 'monitor-admission-registry.json'],
  });
  if (!resolved.ok) return Object.freeze({ ok: false, reason: resolved.reason || 'MONITOR_ADMISSION_REGISTRY_PATH_BLOCKED', registry: null, monitorCount: 0 });
  try {
    const registry = JSON.parse(await readFile(resolved.path, 'utf8'));
    if (!runtimeSafeRegistry(registry)) return Object.freeze({ ok: false, reason: 'MALFORMED_DURABLE_REGISTRY', registry: null, monitorCount: 0 });
    return Object.freeze({ ok: true, reason: 'MONITOR_ADMISSION_REGISTRY_READY', registry, monitorCount: Object.keys(registry.monitors).length });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: error?.code === 'ENOENT' ? 'MONITOR_ADMISSION_REGISTRY_NOT_FOUND' : 'MONITOR_ADMISSION_REGISTRY_READ_FAILED',
      registry: null,
      monitorCount: 0,
    });
  }
}

export function isLogicalControllerPulseProposalV2(proposal = {}) {
  return proposal?.handlerType === 'SCHEDULED_SUMMARY'
    && typeof proposal?.boundedSubject?.scope === 'string'
    && proposal.boundedSubject.scope.startsWith(LOGICAL_CONTROLLER_SCOPE_PREFIX)
    && Boolean(text(proposal?.boundedSubject?.topic));
}

export function buildMonitorRuntimeProjectionV2(registry = {}) {
  const monitorRecords = plainObject(registry?.monitors) ? Object.values(registry.monitors) : [];
  const monitors = [];
  const controllerRecords = new Map();
  for (const record of monitorRecords) {
    if (!plainObject(record) || !plainObject(record.definition) || !plainObject(record.proposal)) continue;
    monitors.push(runtimeMonitorInput(record.definition));
    if (isLogicalControllerPulseProposalV2(record.proposal)) controllerRecords.set(record.monitorId, record);
  }
  const handlers = Object.create(null);
  if (controllerRecords.size) {
    handlers['scheduled-summary'] = async (context = {}) => {
      const record = controllerRecords.get(context.monitorId);
      if (!record) {
        return Object.freeze({
          state: 'BLOCKED',
          blocker: 'SCHEDULED_SUMMARY_HANDLER_NOT_WIRED',
          summary: 'Scheduled summary is not a logical controller pulse.',
          nextAction: 'Route through a qualified fixed handler or retain the standalone fallback.',
          notify: false,
        });
      }
      const controllerId = text(record.proposal.boundedSubject.scope).slice(LOGICAL_CONTROLLER_SCOPE_PREFIX.length);
      const title = text(record.proposal.boundedSubject.topic);
      return Object.freeze({
        state: 'PASS',
        summary: `Logical controller ${controllerId} pulse due at ${context.timestampUtc}: ${title}`,
        nextAction: 'Consume this pulse through the canonical controller hub and existing Stephanos goal/build machinery.',
        proofRefs: record.proposal.proofRefs,
        notify: true,
      });
    };
  }
  return Object.freeze({
    schemaVersion: MONITOR_ADMISSION_RUNTIME_V2_SCHEMA,
    monitors: Object.freeze(monitors),
    handlers: Object.freeze(handlers),
    monitorCount: monitors.length,
    logicalControllerCount: controllerRecords.size,
    externalTaskSlotsRequired: monitors.length ? 1 : 0,
    notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
    maximumConcurrency: MONITOR_MULTIPLEXER_MAX_CONCURRENCY,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    arbitraryShellAllowed: false,
    arbitraryPowerShellAllowed: false,
    finalVerdict: 'MONITOR_ADMISSION_RUNTIME_PROJECTION_READY',
  });
}

export async function runMonitorAdmissionRuntimeV2(input = {}) {
  const loaded = await loadMonitorAdmissionRegistryV2(input);
  if (!loaded.ok) return Object.freeze({ ...loaded, schemaVersion: MONITOR_ADMISSION_RUNTIME_V2_SCHEMA, finalVerdict: 'MONITOR_ADMISSION_RUNTIME_BLOCKED' });
  const projection = buildMonitorRuntimeProjectionV2(loaded.registry);
  const tick = await runMonitorMultiplexerTick({
    root: input.root,
    repoRoot: input.repoRoot,
    monitors: projection.monitors,
    handlers: projection.handlers,
    relatedIssue: input.relatedIssue || '#1585',
    nowMs: input.nowMs,
    timestampUtc: input.timestampUtc,
    concurrency: input.concurrency ?? MONITOR_MULTIPLEXER_MAX_CONCURRENCY,
  });
  return Object.freeze({
    schemaVersion: MONITOR_ADMISSION_RUNTIME_V2_SCHEMA,
    ok: tick.ok,
    reason: tick.reason,
    monitorCount: projection.monitorCount,
    logicalControllerCount: projection.logicalControllerCount,
    externalTaskSlotsRequired: projection.externalTaskSlotsRequired,
    notificationSurface: projection.notificationSurface,
    maximumConcurrency: projection.maximumConcurrency,
    tick,
    finalVerdict: tick.ok ? 'MONITOR_ADMISSION_RUNTIME_TICK_PASS' : 'MONITOR_ADMISSION_RUNTIME_TICK_BLOCKED',
  });
}

export async function admitLogicalMonitorWithRuntimeV2(envelope = {}, options = {}) {
  const v1 = await admitLogicalMonitor(envelope, options);
  if (v1.ok === true || v1.reason !== 'MULTIPLEXER_PROJECTION_NOT_PROVEN') return v1;

  const loaded = await loadMonitorAdmissionRegistryV2(options);
  const monitorId = envelope?.proposal?.monitorId || envelope?.monitorId || '';
  const persisted = loaded.ok && Boolean(loaded.registry?.monitors?.[monitorId]);
  if (!persisted) return Object.freeze({ ...v1, runtimeConsumerProven: false });

  const layout = await ensureSharedWorkspaceLayout({ root: options.root, repoRoot: options.repoRoot });
  if (!layout.ok) return Object.freeze({ ...v1, runtimeConsumerProven: false, fallbackReason: 'MULTIPLEXER_ADMISSION_UNAVAILABLE' });
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const timestampUtc = new Date(nowMs).toISOString();
  const receiptId = `monitor-admission-runtime-v2-${safeId(envelope.requestId) || safeId(monitorId) || 'request'}`;
  const proofRefs = loaded.registry.monitors[monitorId]?.proposal?.proofRefs || ['proof/monitor-admission.json'];
  const receipt = Object.freeze({
    ...createSharedWorkspaceReceiptRecord({
      receiptId,
      participantId: MONITOR_ADMISSION_RUNTIME_V2_PARTICIPANT,
      timestampUtc,
      correlationId: safeId(envelope.requestId) || receiptId,
      relatedIssue: String(loaded.registry.monitors[monitorId]?.proposal?.relatedIssueOrGoal || '').startsWith('#')
        ? loaded.registry.monitors[monitorId].proposal.relatedIssueOrGoal
        : '#1585',
      receivedRecordId: safeId(envelope.requestId) || receiptId,
      disposition: 'published',
      summary: 'Logical monitor admitted to the live Monitor Multiplexer V2 runtime consumer.',
      proofRefs,
    }),
    verdict: 'MULTIPLEXER_ADMISSION_READY',
    monitorId,
    runtimeConsumer: MONITOR_ADMISSION_RUNTIME_V2_PARTICIPANT,
    notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
    externalTaskSlotsRequired: loaded.monitorCount ? 1 : 0,
    sourceMutationAllowed: false,
    mergeAuthority: false,
  });
  const status = Object.freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: `monitor-admission-runtime-v2-${monitorId}`,
      participantId: MONITOR_ADMISSION_RUNTIME_V2_PARTICIPANT,
      timestampUtc,
      status: 'READY',
      summary: 'Logical monitor is present in the durable registry and consumable by the V2 runtime.',
      proofRefs,
    }),
    verdict: 'MULTIPLEXER_ADMISSION_READY',
    monitorId,
    runtimeConsumer: MONITOR_ADMISSION_RUNTIME_V2_PARTICIPANT,
  });
  const receiptWrite = await writeAtomicJson(layout.root, ['receipts', `${receiptId}.json`], receipt, { repoRoot: options.repoRoot, nowMs });
  if (!receiptWrite.ok) return Object.freeze({ ...v1, runtimeConsumerProven: true, reason: 'MONITOR_ADMISSION_FALLBACK_REQUIRED', fallbackReason: 'MULTIPLEXER_ADMISSION_EVIDENCE_INCOMPLETE' });
  const statusWrite = await writeAtomicJson(layout.root, ['status', `${status.statusId}.json`], status, { repoRoot: options.repoRoot, nowMs });
  if (!statusWrite.ok) return Object.freeze({ ...v1, runtimeConsumerProven: true, reason: 'MONITOR_ADMISSION_FALLBACK_REQUIRED', fallbackReason: 'MULTIPLEXER_ADMISSION_EVIDENCE_INCOMPLETE' });

  return Object.freeze({
    ...v1,
    ok: true,
    reason: 'MULTIPLEXER_ADMISSION_READY',
    blocker: '',
    runtimeConsumerProven: true,
    runtimeConsumer: MONITOR_ADMISSION_RUNTIME_V2_PARTICIPANT,
    receipt,
    status,
    externalTaskSlotsRequired: loaded.monitorCount ? 1 : 0,
  });
}
