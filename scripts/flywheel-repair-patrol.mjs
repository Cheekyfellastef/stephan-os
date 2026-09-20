#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { runConstraintLifecycleAudit } from './constraint-lifecycle-audit.mjs';
import {
  FLYWHEEL_REPAIR_PATROL_SCHEMA_VERSION,
  projectFlywheelRepairPatrolV1,
} from '../shared/agents/flywheelRepairPatrolV1.mjs';
import {
  createSharedWorkspaceHandoffRecord,
  createSharedWorkspaceStatusRecord,
  ensureSharedWorkspaceLayout,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';

export const FLYWHEEL_REPAIR_PATROL_RUNNER_SCHEMA_VERSION = 'stephanos.flywheel-repair-patrol-runner.v1';
export const FLYWHEEL_REPAIR_PATROL_STATUS_ID = 'flywheel-repair-patrol-current';
export const FLYWHEEL_REPAIR_PATROL_PROOF_REF = 'proof/flywheel-repair-patrol.json';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function parseTimestamp(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

async function readPreviousStatus(workspaceRoot, repoRoot) {
  const resolved = resolveSharedWorkspacePath({
    root: workspaceRoot,
    repoRoot,
    segments: ['status', `${FLYWHEEL_REPAIR_PATROL_STATUS_ID}.json`],
  });
  if (!resolved.ok) return null;
  try {
    const value = JSON.parse(await readFile(resolved.path, 'utf8'));
    const validation = validateSharedWorkspaceRecord(value);
    if (!validation.valid || value.statusId !== FLYWHEEL_REPAIR_PATROL_STATUS_ID) return null;
    if (value.patrolSchemaVersion !== FLYWHEEL_REPAIR_PATROL_SCHEMA_VERSION) return null;
    return value;
  } catch {
    return null;
  }
}

function repairTargets(findings = []) {
  return findings.slice(0, 24).map((finding) => Object.freeze({
    findingId: finding.findingId,
    file: finding.file,
    line: finding.line,
    signalId: finding.signalId,
  }));
}

function statusRecord(projection) {
  const state = projection.state === 'HEALTHY' ? 'READY' : 'BLOCKED';
  return Object.freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: FLYWHEEL_REPAIR_PATROL_STATUS_ID,
      participantId: 'flywheel-repair-patrol',
      timestampUtc: projection.generatedAtUtc,
      relatedIssue: '#1903',
      status: state,
      summary: projection.state === 'HEALTHY'
        ? 'Flywheel repair patrol found no orphaned flywheel continuity endpoints.'
        : `Flywheel repair patrol found ${projection.findingCount} continuity endpoint${projection.findingCount === 1 ? '' : 's'} requiring governed repair continuation.`,
      proofRefs: [FLYWHEEL_REPAIR_PATROL_PROOF_REF],
    }),
    patrolSchemaVersion: FLYWHEEL_REPAIR_PATROL_SCHEMA_VERSION,
    healthState: projection.state,
    findingCount: projection.findingCount,
    findingFingerprint: projection.findingFingerprint,
    findingIds: Object.freeze(projection.findings.map((finding) => finding.findingId)),
    nextDueUtc: projection.nextDueUtc,
    broadAuditFindingCount: projection.broadAuditFindingCount,
    broadAuditUnclassifiedCount: projection.broadAuditUnclassifiedCount,
    patrolAuthority: projection.authority,
  });
}

function handoffRecord(projection, previousStatus) {
  if (!projection.changed || !projection.continuation) return null;
  const priorFingerprint = text(previousStatus?.findingFingerprint);
  const eventFingerprint = digest([
    projection.continuation.kind,
    priorFingerprint,
    projection.findingFingerprint,
  ]).slice(0, 24);
  const handoffId = `flywheel-repair-${eventFingerprint}`;
  return Object.freeze(createSharedWorkspaceHandoffRecord({
    handoffId,
    participantId: 'flywheel-repair-patrol',
    fromParticipantId: 'flywheel-repair-patrol',
    toParticipantId: 'mission-orchestrator',
    timestampUtc: projection.generatedAtUtc,
    correlationId: handoffId,
    relatedIssue: '#1903',
    proofRefs: [FLYWHEEL_REPAIR_PATROL_PROOF_REF],
    summary: projection.state === 'HEALTHY'
      ? 'Flywheel continuity findings cleared; capture the proven repair lesson and rearm patrol.'
      : `${projection.findingCount} flywheel continuity finding${projection.findingCount === 1 ? '' : 's'} require existing-owner repair routing.`,
    body: JSON.stringify({
      schemaVersion: FLYWHEEL_REPAIR_PATROL_RUNNER_SCHEMA_VERSION,
      patrolSchemaVersion: projection.schemaVersion,
      continuation: projection.continuation,
      repairTargets: repairTargets(projection.findings),
      totalFindingCount: projection.findingCount,
      findingFingerprint: projection.findingFingerprint,
      previousFindingFingerprint: priorFingerprint || null,
      canonicalOwner: '#1903',
      constraints: {
        existingOwnerFirst: true,
        duplicateGoalForbidden: true,
        duplicateControllerForbidden: true,
        sourceMutationAllowed: false,
        mergeAuthority: false,
        deploymentAuthority: false,
        runtimeMutationAuthority: false,
        authorityWideningAllowed: false,
      },
    }),
  }));
}

export async function runFlywheelRepairPatrol(input = {}) {
  const repoRoot = path.resolve(text(input.repoRoot));
  const workspaceRoot = path.resolve(text(input.workspaceRoot));
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const timestampUtc = text(input.timestampUtc) || new Date(nowMs).toISOString();
  if (!text(input.repoRoot) || !text(input.workspaceRoot)) {
    return Object.freeze({
      schemaVersion: FLYWHEEL_REPAIR_PATROL_RUNNER_SCHEMA_VERSION,
      ok: false,
      reason: 'CANONICAL_PATROL_PATHS_REQUIRED',
      finalVerdict: 'FLYWHEEL_REPAIR_PATROL_BLOCKED',
    });
  }

  const layout = await ensureSharedWorkspaceLayout({ root: workspaceRoot, repoRoot });
  if (!layout.ok) {
    return Object.freeze({
      schemaVersion: FLYWHEEL_REPAIR_PATROL_RUNNER_SCHEMA_VERSION,
      ok: false,
      reason: layout.reason,
      finalVerdict: 'FLYWHEEL_REPAIR_PATROL_BLOCKED',
    });
  }

  const previousStatus = await readPreviousStatus(layout.root, repoRoot);
  const nextDueMs = parseTimestamp(previousStatus?.nextDueUtc);
  if (Number.isFinite(nextDueMs) && nowMs < nextDueMs) {
    return Object.freeze({
      schemaVersion: FLYWHEEL_REPAIR_PATROL_RUNNER_SCHEMA_VERSION,
      ok: true,
      skipped: true,
      reason: 'FLYWHEEL_REPAIR_PATROL_NOT_DUE',
      state: previousStatus.healthState || 'UNKNOWN',
      findingCount: Number(previousStatus.findingCount || 0),
      changed: false,
      handoffId: '',
      nextDueUtc: previousStatus.nextDueUtc,
      finalVerdict: 'FLYWHEEL_REPAIR_PATROL_NOT_DUE',
    });
  }

  const auditImpl = input.runConstraintLifecycleAuditImpl || runConstraintLifecycleAudit;
  let audit;
  try {
    audit = await auditImpl({ repoRoot, generatedAt: timestampUtc });
  } catch {
    return Object.freeze({
      schemaVersion: FLYWHEEL_REPAIR_PATROL_RUNNER_SCHEMA_VERSION,
      ok: false,
      reason: 'CONSTRAINT_LIFECYCLE_AUDIT_FAILED',
      finalVerdict: 'FLYWHEEL_REPAIR_PATROL_BLOCKED',
    });
  }

  const projection = projectFlywheelRepairPatrolV1({ audit, previousStatus, nowMs });
  if (!projection.valid) {
    return Object.freeze({
      schemaVersion: FLYWHEEL_REPAIR_PATROL_RUNNER_SCHEMA_VERSION,
      ok: false,
      reason: projection.blocker,
      finalVerdict: 'FLYWHEEL_REPAIR_PATROL_BLOCKED',
    });
  }

  const status = statusRecord(projection);
  const statusWrite = await writeAtomicJson(
    layout.root,
    ['status', `${FLYWHEEL_REPAIR_PATROL_STATUS_ID}.json`],
    status,
    { repoRoot, nowMs },
  );
  if (!statusWrite.ok) {
    return Object.freeze({
      schemaVersion: FLYWHEEL_REPAIR_PATROL_RUNNER_SCHEMA_VERSION,
      ok: false,
      reason: statusWrite.reason || 'FLYWHEEL_REPAIR_PATROL_STATUS_WRITE_FAILED',
      finalVerdict: 'FLYWHEEL_REPAIR_PATROL_BLOCKED',
    });
  }

  const handoff = handoffRecord(projection, previousStatus);
  let handoffWrite = null;
  if (handoff) {
    const validation = validateSharedWorkspaceRecord(handoff, { nowMs });
    if (!validation.valid) {
      return Object.freeze({
        schemaVersion: FLYWHEEL_REPAIR_PATROL_RUNNER_SCHEMA_VERSION,
        ok: false,
        reason: validation.refusalReason || 'FLYWHEEL_REPAIR_PATROL_HANDOFF_INVALID',
        finalVerdict: 'FLYWHEEL_REPAIR_PATROL_BLOCKED',
      });
    }
    handoffWrite = await writeAtomicJson(
      layout.root,
      ['handoffs', `${handoff.handoffId}.json`],
      handoff,
      { repoRoot, nowMs },
    );
    if (!handoffWrite.ok) {
      return Object.freeze({
        schemaVersion: FLYWHEEL_REPAIR_PATROL_RUNNER_SCHEMA_VERSION,
        ok: false,
        reason: handoffWrite.reason || 'FLYWHEEL_REPAIR_PATROL_HANDOFF_WRITE_FAILED',
        finalVerdict: 'FLYWHEEL_REPAIR_PATROL_BLOCKED',
      });
    }
  }

  return Object.freeze({
    schemaVersion: FLYWHEEL_REPAIR_PATROL_RUNNER_SCHEMA_VERSION,
    ok: true,
    skipped: false,
    reason: projection.state === 'HEALTHY' ? 'FLYWHEEL_REPAIR_PATROL_HEALTHY' : 'FLYWHEEL_REPAIR_PATROL_REPAIR_REQUIRED',
    state: projection.state,
    findingCount: projection.findingCount,
    changed: projection.changed,
    handoffId: handoff?.handoffId || '',
    nextDueUtc: projection.nextDueUtc,
    statusPath: statusWrite.path,
    handoffPath: handoffWrite?.path || '',
    finalVerdict: projection.state === 'HEALTHY'
      ? 'FLYWHEEL_REPAIR_PATROL_PASS'
      : 'FLYWHEEL_REPAIR_PATROL_REPAIR_REQUIRED',
  });
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}` || process.argv[1]?.endsWith('flywheel-repair-patrol.mjs')) {
  const [repoRoot, workspaceRoot] = process.argv.slice(2);
  const result = await runFlywheelRepairPatrol({ repoRoot, workspaceRoot });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
