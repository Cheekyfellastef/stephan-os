import {
  readSharedWorkspaceDashboardFeed,
  SHARED_WORKSPACE_FEED_RECORD_SCOPES,
} from './shared-workspace-dashboard-feed.mjs';
import {
  createSharedWorkspaceEventRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';
import { deriveFlywheelWorkspaceView } from '../runtime/upliftWorkspaceProjectionV1.mjs';

export const WORKSPACE_INTEGRITY_SEED_PRESSURE_SCHEMA_V1 =
  'stephanos.workspace-integrity-seed-pressure.v1';
export const WORKSPACE_INTEGRITY_SEED_PRESSURE_PARTICIPANT =
  'workspace-integrity-seed';
export const WORKSPACE_INTEGRITY_SEED_PRESSURE_UMBRELLA_GOAL = '#2670';

const PRESSURE_GAPS = Object.freeze([
  Object.freeze({
    countKey: 'inventoryProofCount',
    capabilityId: 'workspace-integrity-inventory-visible-components',
    rung: 'INVENTORY_VISIBLE_COMPONENTS',
    action: 'Inventory every visible workspace, card and visualiser and publish stable component identities.',
  }),
  Object.freeze({
    countKey: 'identityProofCount',
    capabilityId: 'workspace-integrity-stable-identities',
    rung: 'STABLE_IDENTITIES',
    action: 'Assign a stable workspaceId and componentId to every inventoried visual component.',
  }),
  Object.freeze({
    countKey: 'canonicalBindingProofCount',
    capabilityId: 'workspace-integrity-canonical-source-bindings',
    rung: 'CANONICAL_SOURCE_BINDINGS',
    action: 'Bind every component to one canonical source, transport, transformation and consumer path.',
  }),
  Object.freeze({
    countKey: 'contractProofCount',
    capabilityId: 'workspace-integrity-contracts-proven',
    rung: 'CONTRACTS_PROVEN',
    action: 'Publish and verify schema, version and unit contracts for every binding.',
  }),
  Object.freeze({
    countKey: 'hydrationProofCount',
    capabilityId: 'workspace-integrity-hydration-proven',
    rung: 'HYDRATION_PROVEN',
    action: 'Prove hydration from canonical source through transport to each consuming workspace.',
  }),
  Object.freeze({
    countKey: 'reconciliationProofCount',
    capabilityId: 'workspace-integrity-source-render-reconciled',
    rung: 'SOURCE_RENDER_RECONCILED',
    action: 'Reconcile canonical source values with rendered values and surface every mismatch as red.',
  }),
  Object.freeze({
    countKey: 'syntheticProofCount',
    capabilityId: 'workspace-integrity-synthetic-proof-current',
    rung: 'SYNTHETIC_PROOF_CURRENT',
    action: 'Run harmless synthetic end-to-end probes so green means the full path was exercised.',
  }),
  Object.freeze({
    countKey: 'orphanAuditProofCount',
    capabilityId: 'workspace-integrity-orphan-free',
    rung: 'ORPHAN_FREE',
    action: 'Close orphan consumers and important sources with no declared consumer.',
  }),
  Object.freeze({
    countKey: 'continuousAuditProofCount',
    capabilityId: 'workspace-integrity-continuously-verified',
    rung: 'CONTINUOUSLY_VERIFIED',
    action: 'Keep the full integrity mesh continuously verified and turn regressions into canonical repair pressure.',
  }),
]);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

function firstUnprovedGap(growth = {}) {
  for (const gap of PRESSURE_GAPS) {
    if (Number(growth?.[gap.countKey] || 0) < 1) return gap;
  }
  if (text(growth?.pressureState).toUpperCase() === 'ACTIVE') {
    return Object.freeze({
      countKey: '',
      capabilityId: 'workspace-integrity-regression-repair',
      rung: 'REGRESSION_REPAIR',
      action: text(
        growth?.nextBestAction,
        'Repair the first evidenced workspace-integrity regression through its existing canonical owner.',
      ),
    });
  }
  return null;
}

export function buildWorkspaceIntegritySeedPressureEventV1(input = {}) {
  const growth = input.growth && typeof input.growth === 'object'
    ? input.growth
    : {};
  if (
    growth.planted !== true
    || text(growth.pressureState).toUpperCase() !== 'ACTIVE'
  ) return null;

  const gap = firstUnprovedGap(growth);
  if (!gap) return null;

  const timestampUtc = text(input.timestampUtc, new Date().toISOString());
  const eventId = `workspace-integrity-pressure-${gap.capabilityId}`;
  const base = createSharedWorkspaceEventRecord({
    eventId,
    participantId: WORKSPACE_INTEGRITY_SEED_PRESSURE_PARTICIPANT,
    timestampUtc,
    eventKind: 'workspace-integrity-seed-pressure',
    summary: gap.action,
    capabilityFailure: {
      failureClass: 'CAPABILITY_GAP',
      genuineCapabilityFailure: true,
      capabilityId: gap.capabilityId,
      targetRefs: [`goal:${WORKSPACE_INTEGRITY_SEED_PRESSURE_UMBRELLA_GOAL}`],
      teacherHint: 'workspace-integrity-provenance',
      observedAtUtc: timestampUtc,
    },
  });

  return freeze({
    ...base,
    missionId: 'workspace-integrity-provenance',
    workspaceIntegritySeedPressure: {
      schemaVersion: WORKSPACE_INTEGRITY_SEED_PRESSURE_SCHEMA_V1,
      capabilityId: gap.capabilityId,
      targetRung: gap.rung,
      nextBestAction: gap.action,
      seedIssueRef: '#2898',
      umbrellaGoalRef: WORKSPACE_INTEGRITY_SEED_PRESSURE_UMBRELLA_GOAL,
      createsReplacementMachinery: false,
      authorityWidened: false,
    },
  });
}

function resultBase(overrides = {}) {
  return freeze({
    schemaVersion: WORKSPACE_INTEGRITY_SEED_PRESSURE_SCHEMA_V1,
    ok: true,
    published: false,
    deduped: false,
    planted: false,
    pressureState: 'UNKNOWN',
    capabilityId: '',
    targetRung: '',
    eventId: '',
    reason: 'WORKSPACE_INTEGRITY_SEED_PRESSURE_IDLE',
    authority: {
      sourceMutationAllowed: false,
      runtimeMutationAllowed: false,
      dispatchAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      approvalBypassAllowed: false,
      createsReplacementController: false,
      createsReplacementQueue: false,
    },
    finalVerdict: 'WORKSPACE_INTEGRITY_SEED_PRESSURE_IDLE',
    ...overrides,
  });
}

export async function publishWorkspaceIntegritySeedPressureEventV1(input = {}) {
  const repoRoot = input.repoRoot || process.cwd();
  const nowMs = Number.isFinite(input.nowMs)
    ? input.nowMs
    : Number.isFinite(Date.parse(text(input.timestampUtc)))
      ? Date.parse(text(input.timestampUtc))
      : Date.now();
  const timestampUtc = text(input.timestampUtc, new Date(nowMs).toISOString());
  const dashboardFeed = input.dashboardFeed || await (input.readDashboardFeed || readSharedWorkspaceDashboardFeed)({
    root: input.root || input.workspaceRoot,
    repoRoot,
    nowMs,
    recordScope: SHARED_WORKSPACE_FEED_RECORD_SCOPES.FULL_HISTORY,
  });
  const workspaceView = input.workspaceView || (input.deriveWorkspaceView || deriveFlywheelWorkspaceView)(dashboardFeed);
  const growth = workspaceView?.workspaceIntegritySeedGrowth || {};
  if (
    growth.planted !== true
    || text(growth.pressureState).toUpperCase() !== 'ACTIVE'
  ) {
    return resultBase({
      planted: growth.planted === true,
      pressureState: text(growth.pressureState, 'UNKNOWN'),
      reason: growth.planted === true
        ? 'WORKSPACE_INTEGRITY_SEED_PRESSURE_CURRENT'
        : 'WORKSPACE_INTEGRITY_SEED_NOT_PLANTED',
      finalVerdict: growth.planted === true
        ? 'WORKSPACE_INTEGRITY_SEED_PRESSURE_CURRENT'
        : 'WORKSPACE_INTEGRITY_SEED_NOT_PLANTED',
    });
  }

  const event = buildWorkspaceIntegritySeedPressureEventV1({
    growth,
    timestampUtc,
  });
  if (!event) return resultBase({
    planted: true,
    pressureState: text(growth.pressureState, 'ACTIVE'),
  });

  const existingEvents = Array.isArray(dashboardFeed?.records?.eventRecords)
    ? dashboardFeed.records.eventRecords
    : [];
  const existing = existingEvents.find((record) => text(record?.eventId) === event.eventId);
  if (existing) {
    return resultBase({
      planted: true,
      pressureState: text(growth.pressureState, 'ACTIVE'),
      capabilityId: event.workspaceIntegritySeedPressure.capabilityId,
      targetRung: event.workspaceIntegritySeedPressure.targetRung,
      eventId: event.eventId,
      deduped: true,
      reason: 'WORKSPACE_INTEGRITY_SEED_PRESSURE_EVENT_DEDUPED',
      finalVerdict: 'WORKSPACE_INTEGRITY_SEED_PRESSURE_EVENT_DEDUPED',
    });
  }

  const workspaceRoot = input.root || input.workspaceRoot || dashboardFeed?.workspaceRoot;
  if (!workspaceRoot || workspaceRoot === 'UNKNOWN') {
    return resultBase({
      ok: false,
      planted: true,
      pressureState: text(growth.pressureState, 'ACTIVE'),
      capabilityId: event.workspaceIntegritySeedPressure.capabilityId,
      targetRung: event.workspaceIntegritySeedPressure.targetRung,
      eventId: event.eventId,
      reason: 'WORKSPACE_INTEGRITY_SEED_PRESSURE_WORKSPACE_UNAVAILABLE',
      finalVerdict: 'WORKSPACE_INTEGRITY_SEED_PRESSURE_WORKSPACE_UNAVAILABLE',
    });
  }

  const writeRecord = input.writeRecord || writeAtomicJson;
  const publication = await writeRecord(
    workspaceRoot,
    ['events', `${event.eventId}.json`],
    event,
    { repoRoot },
  );
  if (publication?.ok !== true) {
    return resultBase({
      ok: false,
      planted: true,
      pressureState: text(growth.pressureState, 'ACTIVE'),
      capabilityId: event.workspaceIntegritySeedPressure.capabilityId,
      targetRung: event.workspaceIntegritySeedPressure.targetRung,
      eventId: event.eventId,
      reason: text(publication?.reason, 'WORKSPACE_INTEGRITY_SEED_PRESSURE_PUBLICATION_FAILED'),
      finalVerdict: 'WORKSPACE_INTEGRITY_SEED_PRESSURE_PUBLICATION_FAILED',
    });
  }

  return resultBase({
    planted: true,
    pressureState: text(growth.pressureState, 'ACTIVE'),
    capabilityId: event.workspaceIntegritySeedPressure.capabilityId,
    targetRung: event.workspaceIntegritySeedPressure.targetRung,
    eventId: event.eventId,
    published: true,
    reason: 'WORKSPACE_INTEGRITY_SEED_PRESSURE_EVENT_PUBLISHED',
    finalVerdict: 'WORKSPACE_INTEGRITY_SEED_PRESSURE_EVENT_PUBLISHED',
  });
}
