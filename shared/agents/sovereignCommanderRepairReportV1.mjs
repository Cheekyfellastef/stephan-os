import { randomUUID } from 'node:crypto';
import process from 'node:process';

import {
  SHARED_WORKSPACE_RECORD_KINDS,
  SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
  appendWorkspaceJsonl,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';
import { defaultOpenClawWorkspaceRoot } from './runtimeBoundaryRegistry.mjs';

export const SOVEREIGN_COMMANDER_REPAIR_REPORT_SCHEMA =
  'stephanos.sovereign-commander-repair-report.v1';
export const SOVEREIGN_COMMANDER_REPAIR_REPORT_STATUS_FILE =
  'sovereign-commander-repair-current.json';
export const SOVEREIGN_COMMANDER_REPAIR_REPORT_EVENT_FILE =
  'sovereign-commander-repair-cycles.ndjson';
export const SOVEREIGN_QUALIFIED_MAINTENANCE_SCOPE = 'QUALIFIED_GOAL_BUILDER_MAINTENANCE';
export const SOVEREIGN_COMMANDER_REPAIR_OUTCOMES = Object.freeze([
  'NEEDS_REPAIR',
  'REPAIRED',
  'BLOCKED',
  'HEALTHY',
  'MAINTENANCE_COMPLETED',
]);

function text(value) {
  return String(value ?? '').trim();
}

function bounded(value, limit = 160) {
  return text(value).slice(0, limit);
}

function safeCycleId(value) {
  const normalized = text(value)
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || randomUUID();
}

function stepAppliedRepair(step = {}) {
  const verdict = text(step.finalVerdict).toUpperCase();
  return /(?:^|_)(?:REPAIRED|REPAIR_APPLIED|RECOVERED|RESTARTED|FIXED|INSTALLED|STARTED)(?:_|$)/.test(verdict);
}

export function classifySovereignCommanderRepairOutcome(repair = {}) {
  if (repair.scope === SOVEREIGN_QUALIFIED_MAINTENANCE_SCOPE) {
    const maintenance = repair.maintenance;
    // This is a bounded reporting projection of the real owner's result, never
    // a runtime qualification or a substitute for private native provenance.
    const completed = repair.ok === true && !text(repair.blocker)
      && /^[a-f0-9]{40}$/.test(repair.sourceHead ?? '')
      && maintenance?.actionId === 'repair-goal-builder-flow'
      && maintenance?.profile === 'MAINTENANCE_GOAL_BUILDER_V1'
      && maintenance?.operationOk === true && maintenance?.terminalProven === true
      && /^[a-f0-9]{64}$/.test(maintenance?.terminalEvidenceSha256 ?? '')
      && /^[a-f0-9]{64}$/.test(maintenance?.proofHash ?? '');
    return completed ? 'MAINTENANCE_COMPLETED' : 'BLOCKED';
  }
  if (repair.scope !== undefined) return 'BLOCKED';
  if (repair?.ok !== true) {
    return text(repair?.blocker) ? 'BLOCKED' : 'NEEDS_REPAIR';
  }
  if ((Array.isArray(repair?.steps) ? repair.steps : []).some(stepAppliedRepair)) {
    return 'REPAIRED';
  }
  return 'HEALTHY';
}

function projectedActions(repair = {}) {
  return Object.freeze(
    (Array.isArray(repair?.steps) ? repair.steps : [])
      .slice(0, 12)
      .map((step) => Object.freeze({
        actionId: bounded(step?.actionId, 96),
        ok: step?.ok === true,
        finalVerdict: bounded(step?.finalVerdict),
        blocker: bounded(step?.blocker),
      })),
  );
}

function projectedVerification(repair = {}) {
  const core = repair?.core && typeof repair.core === 'object' ? repair.core : {};
  return Object.freeze({
    sourceHead: bounded(repair?.sourceHead, 40),
    readiness: bounded(core?.readiness, 64),
    wakeState: bounded(core?.wakeState, 64),
    awake: core?.awake === true,
    repairRequired: core?.repairRequired === true,
    heartbeatFresh: core?.heartbeatFresh === true,
    busyGraceActive: core?.busyGraceActive === true,
    heartbeatAgeSeconds: typeof core?.heartbeatAgeSeconds === 'number'
      && Number.isFinite(core.heartbeatAgeSeconds) && core.heartbeatAgeSeconds >= 0
      ? core.heartbeatAgeSeconds
      : null,
  });
}

export function buildSovereignCommanderRepairReport({
  repair = {},
  cycleId = '',
  startedAtUtc = '',
  completedAtUtc = new Date().toISOString(),
  source = 'continuous-repair-guardian',
} = {}) {
  const normalizedCycleId = safeCycleId(cycleId);
  const outcome = classifySovereignCommanderRepairOutcome(repair);
  const scopedMaintenance = repair.scope === SOVEREIGN_QUALIFIED_MAINTENANCE_SCOPE;
  const status = outcome === 'MAINTENANCE_COMPLETED' ? 'OBSERVED'
    : outcome === 'BLOCKED' || outcome === 'NEEDS_REPAIR'
    ? 'ATTENTION_REQUIRED'
    : 'READY';
  const blocker = text(repair?.blocker) || (repair.scope !== undefined && outcome === 'BLOCKED'
    ? 'SOVEREIGN_QUALIFIED_MAINTENANCE_PROOF_UNPROVEN' : '');
  const detectedFaults = blocker
    ? Object.freeze([bounded(blocker)])
    : Object.freeze([]);
  const actions = projectedActions(repair);
  const verification = scopedMaintenance ? Object.freeze({
    sourceHead: bounded(repair.sourceHead, 40),
    readiness: 'UNPROVEN', fullStephanosRepairProven: false,
    maintenanceActionId: 'repair-goal-builder-flow',
    maintenanceProfile: 'MAINTENANCE_GOAL_BUILDER_V1',
    operationCompleted: outcome === 'MAINTENANCE_COMPLETED',
    terminalEvidenceSha256: /^[a-f0-9]{64}$/.test(repair.maintenance?.terminalEvidenceSha256 ?? '')
      ? repair.maintenance.terminalEvidenceSha256 : '',
    proofHash: /^[a-f0-9]{64}$/.test(repair.maintenance?.proofHash ?? '')
      ? repair.maintenance.proofHash : '',
    runtimeQualificationGranted: false,
  }) : projectedVerification(repair);
  const summary = scopedMaintenance
    ? outcome === 'MAINTENANCE_COMPLETED'
      ? 'Sovereign Commander completed qualified goal-builder maintenance; whole-system health remains unproven.'
      : 'Sovereign Commander could not complete qualified goal-builder maintenance and recorded the blocker.'
    : outcome === 'HEALTHY'
    ? 'Sovereign Commander completed a repair cycle and verified Stephanos healthy.'
    : outcome === 'REPAIRED'
      ? 'Sovereign Commander repaired Stephanos and verified the post-repair state.'
      : outcome === 'NEEDS_REPAIR'
        ? 'Sovereign Commander detected that Stephanos needs repair.'
        : 'Sovereign Commander could not complete a required repair and escalated the blocker.';
  const common = Object.freeze({
    reportSchema: SOVEREIGN_COMMANDER_REPAIR_REPORT_SCHEMA,
    timestampUtc: completedAtUtc,
    status,
    outcome,
    summary,
    cycleId: normalizedCycleId,
    cycleStartedAtUtc: text(startedAtUtc) || completedAtUtc,
    source: bounded(source, 64),
    sourceHead: bounded(repair?.sourceHead, 40),
    detectedFaults,
    actions,
    verification,
    ...(scopedMaintenance ? { scope: SOVEREIGN_QUALIFIED_MAINTENANCE_SCOPE,
      fullStephanosRepairProven: false } : {}),
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
  });

  return Object.freeze({
    outcome,
    cycleId: normalizedCycleId,
    status: Object.freeze({
      schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
      kind: SHARED_WORKSPACE_RECORD_KINDS.STATUS,
      statusId: 'sovereign-commander-repair-current',
      participantId: 'sovereign-commander',
      ...common,
    }),
    event: Object.freeze({
      schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
      kind: SHARED_WORKSPACE_RECORD_KINDS.EVENT,
      eventId: `sovereign-repair-${normalizedCycleId}`,
      eventKind: 'sovereign-commander-repair-cycle',
      participantId: 'sovereign-commander',
      ...common,
    }),
  });
}

export async function publishSovereignCommanderRepairReport({
  repair = {},
  workspaceRoot = '',
  repoRoot = process.cwd(),
  cycleId = '',
  startedAtUtc = '',
  completedAtUtc = new Date().toISOString(),
  source = 'continuous-repair-guardian',
} = {}) {
  const root = text(workspaceRoot)
    || text(process.env.STEPHANOS_SHARED_WORKSPACE)
    || text(process.env.STEPHANOS_SHARED_AGENT_WORKSPACE)
    || text(process.env.STEPHANOS_OPENCLAW_WORKSPACE)
    || defaultOpenClawWorkspaceRoot();
  const records = buildSovereignCommanderRepairReport({
    repair,
    cycleId,
    startedAtUtc,
    completedAtUtc,
    source,
  });
  const validationNowMs = Date.parse(completedAtUtc);

  const eventWrite = await appendWorkspaceJsonl(
    root,
    ['events', SOVEREIGN_COMMANDER_REPAIR_REPORT_EVENT_FILE],
    records.event,
    { repoRoot, nowMs: validationNowMs },
  );
  if (!eventWrite?.ok) {
    return Object.freeze({
      ok: false,
      outcome: records.outcome,
      blocker: `SOVEREIGN_COMMANDER_REPAIR_EVENT_PUBLICATION_FAILED:${bounded(eventWrite?.reason, 96)}`,
      currentRecord: `status/${SOVEREIGN_COMMANDER_REPAIR_REPORT_STATUS_FILE}`,
      eventStream: `events/${SOVEREIGN_COMMANDER_REPAIR_REPORT_EVENT_FILE}`,
      finalVerdict: 'SOVEREIGN_COMMANDER_REPAIR_REPORT_BLOCKED',
    });
  }

  const statusWrite = await writeAtomicJson(
    root,
    ['status', SOVEREIGN_COMMANDER_REPAIR_REPORT_STATUS_FILE],
    records.status,
    { repoRoot, nowMs: validationNowMs },
  );
  if (!statusWrite?.ok) {
    return Object.freeze({
      ok: false,
      outcome: records.outcome,
      blocker: `SOVEREIGN_COMMANDER_REPAIR_STATUS_PUBLICATION_FAILED:${bounded(statusWrite?.reason, 96)}`,
      currentRecord: `status/${SOVEREIGN_COMMANDER_REPAIR_REPORT_STATUS_FILE}`,
      eventStream: `events/${SOVEREIGN_COMMANDER_REPAIR_REPORT_EVENT_FILE}`,
      finalVerdict: 'SOVEREIGN_COMMANDER_REPAIR_REPORT_BLOCKED',
    });
  }

  return Object.freeze({
    ok: true,
    outcome: records.outcome,
    status: records.status.status,
    blocker: '',
    currentRecord: `status/${SOVEREIGN_COMMANDER_REPAIR_REPORT_STATUS_FILE}`,
    eventStream: `events/${SOVEREIGN_COMMANDER_REPAIR_REPORT_EVENT_FILE}`,
    finalVerdict: 'SOVEREIGN_COMMANDER_REPAIR_REPORT_PUBLISHED',
  });
}

