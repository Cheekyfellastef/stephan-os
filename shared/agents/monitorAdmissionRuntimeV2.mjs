import { readFile, writeFile } from 'node:fs/promises';
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
import {
  LOGICAL_GOAL_CONTROLLER_FABRIC_FILE,
  LOGICAL_GOAL_CONTROLLER_FABRIC_SCHEMA,
  buildLogicalGoalControllerMonitorProposals,
} from './logicalGoalControllerFabricV1.mjs';

export const MONITOR_ADMISSION_RUNTIME_V2_SCHEMA = 'stephanos.monitor-admission-runtime.v2';
export const MONITOR_ADMISSION_RUNTIME_V2_PARTICIPANT = 'monitor-admission-runtime-v2';
export const LOGICAL_CONTROLLER_SCOPE_PREFIX = 'controller:';
export const MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_SCHEMA = 'stephanos.monitor-admission-registry-bootstrap.v1';
export const MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_FILE = 'monitor-admission-registry-bootstrap.json';

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
    if (error?.code === 'ENOENT') {
      const marker = resolveSharedWorkspacePath({
        root: layout.root,
        repoRoot: input.repoRoot,
        segments: ['archive', MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_FILE],
      });
      if (!marker.ok) return Object.freeze({
        ok: false,
        reason: marker.reason || 'MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_PATH_BLOCKED',
        registry: null,
        monitorCount: 0,
      });

      try {
        const bootstrap = JSON.parse(await readFile(marker.path, 'utf8'));
        if (bootstrap?.bootstrapSchema !== MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_SCHEMA
          || bootstrap?.registrySchemaVersion !== MONITOR_ADMISSION_REGISTRY_VERSION
          || bootstrap?.state !== 'INITIALIZED') {
          return Object.freeze({
            ok: false,
            reason: 'MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_MARKER_INVALID',
            registry: null,
            monitorCount: 0,
          });
        }
        return Object.freeze({
          ok: false,
          reason: 'MONITOR_ADMISSION_REGISTRY_MISSING_AFTER_BOOTSTRAP',
          registry: null,
          monitorCount: 0,
        });
      } catch (markerError) {
        if (markerError?.code !== 'ENOENT') {
          return Object.freeze({
            ok: false,
            reason: 'MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_MARKER_READ_FAILED',
            registry: null,
            monitorCount: 0,
          });
        }
      }

      const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
      const registry = Object.freeze({
        registrySchemaVersion: MONITOR_ADMISSION_REGISTRY_VERSION,
        monitors: Object.freeze({}),
        idempotency: Object.freeze({}),
      });
      const initializedAtUtc = new Date(nowMs).toISOString();
      const bootstrap = Object.freeze({
        ...createSharedWorkspaceReceiptRecord({
          receiptId: 'monitor-admission-registry-bootstrap',
          participantId: MONITOR_ADMISSION_RUNTIME_V2_PARTICIPANT,
          timestampUtc: initializedAtUtc,
          correlationId: 'monitor-admission-registry-bootstrap',
          relatedIssue: '#1585',
          receivedRecordId: 'monitor-admission-registry-bootstrap',
          disposition: 'initialized',
          summary: 'Durable bootstrap marker proving the monitor admission registry has been initialized once.',
          proofRefs: ['proof/monitor-admission-registry-bootstrap.json'],
        }),
        bootstrapSchema: MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_SCHEMA,
        registrySchemaVersion: MONITOR_ADMISSION_REGISTRY_VERSION,
        state: 'INITIALIZED',
        initializedAtUtc,
        authorityWidened: false,
      });
      const markerWrite = await writeAtomicJson(
        layout.root,
        ['archive', MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_FILE],
        bootstrap,
        { repoRoot: input.repoRoot, nowMs },
      );
      if (!markerWrite.ok) return Object.freeze({
        ok: false,
        reason: 'MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_MARKER_WRITE_FAILED',
        registry: null,
        monitorCount: 0,
      });
      try {
        await writeFile(resolved.path, JSON.stringify(registry, null, 2) + '\n', {
          flag: 'wx',
          mode: 0o600,
        });
      } catch (registryError) {
        if (registryError?.code !== 'EEXIST') return Object.freeze({
          ok: false,
          reason: 'MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_WRITE_FAILED',
          registry: null,
          monitorCount: 0,
        });
        try {
          const concurrent = JSON.parse(await readFile(resolved.path, 'utf8'));
          if (!runtimeSafeRegistry(concurrent)) return Object.freeze({
            ok: false,
            reason: 'MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_CONFLICT',
            registry: null,
            monitorCount: 0,
          });
          return Object.freeze({
            ok: true,
            reason: 'MONITOR_ADMISSION_REGISTRY_READY',
            registry: concurrent,
            monitorCount: Object.keys(concurrent.monitors).length,
            durableRegistryPresent: true,
          });
        } catch {
          return Object.freeze({
            ok: false,
            reason: 'MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_CONFLICT',
            registry: null,
            monitorCount: 0,
          });
        }
      }
      return Object.freeze({
        ok: true,
        reason: 'MONITOR_ADMISSION_REGISTRY_BOOTSTRAPPED_EMPTY',
        registry,
        monitorCount: 0,
        durableRegistryPresent: true,
      });
    }
    return Object.freeze({
      ok: false,
      reason: 'MONITOR_ADMISSION_REGISTRY_READ_FAILED',
      registry: null,
      monitorCount: 0,
    });
  }
}

export async function loadLogicalGoalControllerFabricForMonitorRuntimeV2(input = {}) {
  const layout = await ensureSharedWorkspaceLayout({ root: input.root, repoRoot: input.repoRoot });
  if (!layout.ok) return Object.freeze({ ok: false, reason: 'LOGICAL_GOAL_CONTROLLER_FABRIC_WORKSPACE_UNAVAILABLE', fabric: null });
  const resolved = resolveSharedWorkspacePath({
    root: layout.root,
    repoRoot: input.repoRoot,
    segments: ['status', LOGICAL_GOAL_CONTROLLER_FABRIC_FILE],
  });
  if (!resolved.ok) return Object.freeze({ ok: false, reason: resolved.reason || 'LOGICAL_GOAL_CONTROLLER_FABRIC_PATH_BLOCKED', fabric: null });
  try {
    const fabric = JSON.parse(await readFile(resolved.path, 'utf8'));
    if (fabric?.schemaVersion !== LOGICAL_GOAL_CONTROLLER_FABRIC_SCHEMA
      || fabric?.valid !== true
      || !Array.isArray(fabric?.controllers)
      || fabric.controllers.some((controller) => !safeId(controller?.logicalControllerId))) {
      return Object.freeze({ ok: false, reason: 'LOGICAL_GOAL_CONTROLLER_FABRIC_MALFORMED', fabric: null });
    }
    return Object.freeze({ ok: true, reason: 'LOGICAL_GOAL_CONTROLLER_FABRIC_READY', fabric });
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({ ok: true, reason: 'LOGICAL_GOAL_CONTROLLER_FABRIC_NOT_YET_PUBLISHED', fabric: null });
    return Object.freeze({ ok: false, reason: 'LOGICAL_GOAL_CONTROLLER_FABRIC_READ_FAILED', fabric: null });
  }
}

export function isLogicalControllerPulseProposalV2(proposal = {}) {
  return proposal?.handlerType === 'SCHEDULED_SUMMARY'
    && typeof proposal?.boundedSubject?.scope === 'string'
    && proposal.boundedSubject.scope.startsWith(LOGICAL_CONTROLLER_SCOPE_PREFIX)
    && Boolean(text(proposal?.boundedSubject?.topic));
}

export function buildMonitorRuntimeProjectionV2(registry = {}, options = {}) {
  const monitorRecords = plainObject(registry?.monitors) ? Object.values(registry.monitors) : [];
  const logicalGoalProposals = buildLogicalGoalControllerMonitorProposals(options.logicalGoalControllerFabric, {
    nowMs: options.nowMs,
  });
  const syntheticGoalRecords = logicalGoalProposals.map((proposal) => Object.freeze({
    monitorId: proposal.monitorId,
    proposal,
    definition: proposalToMonitorDefinition(proposal),
    updatedAtUtc: new Date(Number.isFinite(options.nowMs) ? options.nowMs : Date.now()).toISOString(),
    syntheticLogicalGoalController: true,
  }));
  const existingIds = new Set(monitorRecords.map((record) => record?.monitorId).filter(Boolean));
  const logicalControllerCollisions = syntheticGoalRecords
    .filter((record) => existingIds.has(record.monitorId))
    .map((record) => record.monitorId);
  const combinedMonitorRecords = [
    ...monitorRecords,
    ...syntheticGoalRecords.filter((record) => !existingIds.has(record.monitorId)),
  ];
  const monitors = [];
  const controllerRecords = new Map();
  for (const record of combinedMonitorRecords) {
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
    logicalGoalControllerCount: syntheticGoalRecords.length - logicalControllerCollisions.length,
    logicalControllerCollisions: Object.freeze(logicalControllerCollisions),
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
  const logicalGoalControllerFabric = await loadLogicalGoalControllerFabricForMonitorRuntimeV2(input);
  const projection = buildMonitorRuntimeProjectionV2(loaded.registry, {
    logicalGoalControllerFabric: logicalGoalControllerFabric.fabric,
    nowMs: input.nowMs,
  });
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
    logicalGoalControllerCount: projection.logicalGoalControllerCount,
    logicalGoalControllerFabricReason: logicalGoalControllerFabric.reason,
    logicalControllerCollisions: projection.logicalControllerCollisions,
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
