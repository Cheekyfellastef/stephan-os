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
export const SOVEREIGN_COMMANDER_REPAIR_OUTCOMES = Object.freeze([
  'NEEDS_REPAIR',
  'REPAIRED',
  'BLOCKED',
  'HEALTHY',
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
    heartbeatAgeSeconds: Number.isFinite(Number(core?.heartbeatAgeSeconds))
      ? Number(core.heartbeatAgeSeconds)
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
  const status = outcome === 'BLOCKED' || outcome === 'NEEDS_REPAIR'
    ? 'ATTENTION_REQUIRED'
    : 'READY';
  const detectedFaults = text(repair?.blocker)
    ? Object.freeze([bounded(repair.blocker)])
    : Object.freeze([]);
  const actions = projectedActions(repair);
  const verification = projectedVerification(repair);
  const summary = outcome === 'HEALTHY'
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
