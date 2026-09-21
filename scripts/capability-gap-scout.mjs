#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  CAPABILITY_GAP_SCOUT_SCHEMA_VERSION,
  projectCapabilityGapScoutV1,
} from '../shared/agents/capabilityGapScoutV1.mjs';
import { readSharedWorkspaceDashboardFeed } from '../shared/agents/shared-workspace-dashboard-feed.mjs';
import {
  createSharedWorkspaceHandoffRecord,
  createSharedWorkspaceStatusRecord,
  ensureSharedWorkspaceLayout,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';

export const CAPABILITY_GAP_SCOUT_RUNNER_SCHEMA_VERSION = 'stephanos.capability-gap-scout-runner.v1';
export const CAPABILITY_GAP_SCOUT_STATUS_ID = 'capability-gap-scout-current';
export const CAPABILITY_GAP_SCOUT_PROOF_REF = 'proof/capability-gap-scout.json';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function readPreviousStatus(workspaceRoot, repoRoot) {
  const resolved = resolveSharedWorkspacePath({
    root: workspaceRoot,
    repoRoot,
    segments: ['status', `${CAPABILITY_GAP_SCOUT_STATUS_ID}.json`],
  });
  if (!resolved.ok) return null;
  try {
    const value = JSON.parse(await readFile(resolved.path, 'utf8'));
    const validation = validateSharedWorkspaceRecord(value);
    if (!validation.valid || value.statusId !== CAPABILITY_GAP_SCOUT_STATUS_ID) return null;
    if (value.scoutSchemaVersion !== CAPABILITY_GAP_SCOUT_SCHEMA_VERSION) return null;
    return value;
  } catch {
    return null;
  }
}

async function readText(filePath) {
  try { return await readFile(filePath, 'utf8'); } catch { return ''; }
}

export async function observeFlywheelOperatorSurface(repoRoot) {
  const [manifest, html, appIndex] = await Promise.all([
    readText(path.join(repoRoot, 'apps', 'flywheel', 'app.json')),
    readText(path.join(repoRoot, 'apps', 'flywheel', 'index.html')),
    readText(path.join(repoRoot, 'apps', 'index.json')),
  ]);
  let listed = false;
  try { listed = JSON.parse(appIndex).includes('flywheel'); } catch {}
  let manifestOk = false;
  try {
    const parsed = JSON.parse(manifest);
    manifestOk = parsed?.entry === 'index.html' && parsed?.role === 'FLYWHEEL_LANDING_TILE';
  } catch {}
  return Object.freeze({
    tilePresent: Boolean(listed && manifestOk && html),
    sharedWorkspaceConnected: Boolean(
      html.includes('/api/shared-workspace/dashboard-feed')
      && html.includes('flywheel-repair-patrol-current')
      && html.includes('capability-gap-scout-current')
    ),
  });
}

function gapPreview(gaps = []) {
  return Object.freeze(gaps.slice(0, 8).map((gap) => Object.freeze({
    gapId: gap.gapId,
    gapClass: gap.gapClass,
    source: gap.source,
    summary: gap.summary,
    canonicalOwner: gap.canonicalOwner,
    downstreamOwner: gap.downstreamOwner,
    ownerResolutionRequired: gap.ownerResolutionRequired,
  })));
}

function statusRecord(projection) {
  return Object.freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: CAPABILITY_GAP_SCOUT_STATUS_ID,
      participantId: 'capability-gap-scout',
      timestampUtc: projection.generatedAtUtc,
      relatedIssue: '#1903',
      status: projection.gapCount ? 'BLOCKED' : 'READY',
      summary: projection.operatorMessage,
      proofRefs: [CAPABILITY_GAP_SCOUT_PROOF_REF],
    }),
    scoutSchemaVersion: CAPABILITY_GAP_SCOUT_SCHEMA_VERSION,
    healthState: projection.state,
    gapCount: projection.gapCount,
    unresolvedOwnerCount: projection.unresolvedOwnerCount,
    gapFingerprint: projection.gapFingerprint,
    gapIds: Object.freeze(projection.gaps.map((gap) => gap.gapId)),
    gapPreview: gapPreview(projection.gaps),
    coverage: projection.coverage,
    selfImprovementOpportunities: projection.selfImprovementOpportunities,
    operatorMessage: projection.operatorMessage,
    scoutAuthority: projection.authority,
  });
}

function handoffRecord(projection, previousStatus) {
  const previousGapCount = Number(previousStatus?.gapCount || 0);
  if (!projection.changed && !(previousGapCount > 0 && projection.gapCount === 0)) return null;
  const previousFingerprint = text(previousStatus?.gapFingerprint);
  const handoffId = `capability-gap-scout-${digest([
    previousFingerprint,
    projection.gapFingerprint,
    projection.gapCount,
  ]).slice(0, 24)}`;
  const gaps = projection.gaps.slice(0, 12).map((gap) => ({
    gapId: gap.gapId,
    gapClass: gap.gapClass,
    summary: gap.summary,
    canonicalOwner: gap.canonicalOwner,
    downstreamOwner: gap.downstreamOwner,
    ownerResolutionRequired: gap.ownerResolutionRequired,
    evidenceRefs: gap.evidenceRefs,
  }));
  return Object.freeze(createSharedWorkspaceHandoffRecord({
    handoffId,
    participantId: 'capability-gap-scout',
    fromParticipantId: 'capability-gap-scout',
    toParticipantId: 'mission-orchestrator',
    timestampUtc: projection.generatedAtUtc,
    correlationId: handoffId,
    relatedIssue: '#1903',
    proofRefs: [CAPABILITY_GAP_SCOUT_PROOF_REF],
    summary: projection.gapCount
      ? `${projection.gapCount} evidence-backed capability gap${projection.gapCount === 1 ? '' : 's'} require existing-owner flywheel routing.`
      : 'Previously observed capability gaps cleared; capture the proven lesson and keep scouting.',
    body: JSON.stringify({
      schemaVersion: CAPABILITY_GAP_SCOUT_RUNNER_SCHEMA_VERSION,
      scoutSchemaVersion: projection.schemaVersion,
      gapFingerprint: projection.gapFingerprint,
      previousGapFingerprint: previousFingerprint || null,
      gaps,
      coverage: projection.coverage,
      canonicalOwner: '#1903',
      gapIntakeOwner: '#1721',
      flywheelOwner: '#1607',
      nextAction: projection.gapCount
        ? 'ROUTE_EVIDENCE_BACKED_GAPS_TO_EXISTING_OWNERS'
        : 'CAPTURE_RECOVERY_LESSON_AND_CONTINUE_SCOUTING',
      constraints: {
        existingOwnerFirst: true,
        duplicateGoalForbidden: true,
        duplicateControllerForbidden: true,
        sourceMutationAllowed: false,
        schedulerMutationAllowed: false,
        goalCreationAllowed: false,
        dispatchAllowed: false,
        mergeAllowed: false,
        deploymentAllowed: false,
        runtimeMutationAllowed: false,
        authorityWideningAllowed: false,
      },
    }),
  }));
}

export async function runCapabilityGapScout(input = {}) {
  const repoRoot = path.resolve(text(input.repoRoot));
  const workspaceRoot = path.resolve(text(input.workspaceRoot));
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const generatedAtUtc = text(input.timestampUtc) || new Date(nowMs).toISOString();
  if (!text(input.repoRoot) || !text(input.workspaceRoot)) {
    return Object.freeze({ ok: false, reason: 'CAPABILITY_GAP_SCOUT_PATHS_REQUIRED', finalVerdict: 'CAPABILITY_GAP_SCOUT_BLOCKED' });
  }

  const layout = await ensureSharedWorkspaceLayout({ root: workspaceRoot, repoRoot });
  if (!layout.ok) return Object.freeze({ ok: false, reason: layout.reason, finalVerdict: 'CAPABILITY_GAP_SCOUT_BLOCKED' });

  const [previousStatus, workspaceFeed, surfaceObservation] = await Promise.all([
    readPreviousStatus(layout.root, repoRoot),
    (input.readWorkspaceFeedImpl || readSharedWorkspaceDashboardFeed)({
      root: layout.root,
      repoRoot,
      nowMs,
      recordScope: 'current-state',
    }),
    (input.observeFlywheelOperatorSurfaceImpl || observeFlywheelOperatorSurface)(repoRoot),
  ]);

  const projection = projectCapabilityGapScoutV1({
    audit: input.audit,
    workspaceFeed,
    surfaceObservation,
    observedChannels: input.observedChannels || {},
    reactiveWakeupProven: input.reactiveWakeupProven === true,
    previousStatus,
    nowMs,
    generatedAtUtc,
  });

  const status = statusRecord(projection);
  const statusWrite = await writeAtomicJson(
    layout.root,
    ['status', `${CAPABILITY_GAP_SCOUT_STATUS_ID}.json`],
    status,
    { repoRoot, nowMs },
  );
  if (!statusWrite.ok) return Object.freeze({ ok: false, reason: statusWrite.reason, finalVerdict: 'CAPABILITY_GAP_SCOUT_BLOCKED' });

  const handoff = handoffRecord(projection, previousStatus);
  let handoffWrite = null;
  if (handoff) {
    const validation = validateSharedWorkspaceRecord(handoff, { nowMs });
    if (!validation.valid) return Object.freeze({ ok: false, reason: validation.refusalReason, finalVerdict: 'CAPABILITY_GAP_SCOUT_BLOCKED' });
    handoffWrite = await writeAtomicJson(
      layout.root,
      ['handoffs', `${handoff.handoffId}.json`],
      handoff,
      { repoRoot, nowMs },
    );
    if (!handoffWrite.ok) return Object.freeze({ ok: false, reason: handoffWrite.reason, finalVerdict: 'CAPABILITY_GAP_SCOUT_BLOCKED' });
  }

  return Object.freeze({
    schemaVersion: CAPABILITY_GAP_SCOUT_RUNNER_SCHEMA_VERSION,
    ok: true,
    reason: projection.gapCount ? 'CAPABILITY_GAPS_FOUND' : 'CAPABILITY_GAP_SCOUT_CLEAR',
    state: projection.state,
    gapCount: projection.gapCount,
    unresolvedOwnerCount: projection.unresolvedOwnerCount,
    coveragePercent: projection.coverage.coveragePercent,
    missingChannels: projection.coverage.missingChannels,
    selfImprovementOpportunityCount: projection.selfImprovementOpportunities.length,
    changed: projection.changed,
    handoffId: handoff?.handoffId || '',
    statusPath: statusWrite.path,
    handoffPath: handoffWrite?.path || '',
    operatorMessage: projection.operatorMessage,
    finalVerdict: projection.gapCount ? 'CAPABILITY_GAP_SCOUT_GAPS_FOUND' : 'CAPABILITY_GAP_SCOUT_PASS',
  });
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}` || process.argv[1]?.endsWith('capability-gap-scout.mjs')) {
  const [repoRoot, workspaceRoot] = process.argv.slice(2);
  const result = await runCapabilityGapScout({ repoRoot, workspaceRoot });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
