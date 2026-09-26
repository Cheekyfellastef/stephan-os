import {
  CANONICAL_CONTROLLER_FLEET,
  createControllerActivityProofRecord,
  createControllerActivityStatusRecord,
} from './controllerFleetTelemetryV1.mjs';
import { writeAtomicJson } from './sharedAgentWorkspaceStore.mjs';

export const CONTROLLER_ACTIVITY_PUBLISHER_SCHEMA_VERSION =
  'stephanos.controller-activity-publisher.v1';

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function list(value) {
  return Array.isArray(value)
    ? value.map(String).map((item) => item.trim()).filter(Boolean)
    : [];
}
function canonicalController(controllerId) {
  return CANONICAL_CONTROLLER_FLEET.find((item) => item.controllerId === controllerId) || null;
}

function fail(blocker) {
  return Object.freeze({
    ok: false,
    blocker,
    finalVerdict: 'CONTROLLER_ACTIVITY_PUBLICATION_BLOCKED',
  });
}

export async function publishControllerActivityV1(input = {}, options = {}) {
  const controllerId = text(input.controllerId);
  const canonical = canonicalController(controllerId);
  if (!canonical) return fail('CONTROLLER_ACTIVITY_CONTROLLER_NOT_CANONICAL');

  const runId = text(input.runId);
  if (!runId || !/^[A-Za-z0-9._-]{1,80}$/.test(runId)) {
    return fail('CONTROLLER_ACTIVITY_RUN_ID_INVALID');
  }

  const materialActionsSucceeded = count(input.materialActionsSucceeded);
  const proofRefs = list(input.proofRefs);
  if (materialActionsSucceeded > 0 && proofRefs.length === 0) {
    return fail('CONTROLLER_ACTIVITY_MATERIAL_PROOF_REQUIRED');
  }
  const timestampUtc = text(input.timestampUtc, new Date().toISOString());
  const workspaceRoot = options.workspaceRoot;
  const repoRoot = options.repoRoot;

  let proofRecord = null;
  let proofWrite = null;
  if (materialActionsSucceeded > 0) {
    proofRecord = createControllerActivityProofRecord({
      controllerId,
      runId,
      timestampUtc,
      participantId: text(input.participantId, 'chatgpt-controller'),
      relatedIssue: text(input.relatedIssue, '#1557'),
      relatedPr: text(input.relatedPr),
      status: 'PASS',
      materialActionsSucceeded,
      refs: proofRefs,
      proofRefs,
      proofRef: proofRefs[0],
      summary: text(
        input.proofSummary,
        `Verified ${materialActionsSucceeded} material action(s) for ${canonical.title} run ${runId}.`,
      ),
    });
    proofWrite = await writeAtomicJson(
      workspaceRoot,
      ['proof', `${proofRecord.proofId}.json`],
      proofRecord,
      { repoRoot },
    );
    if (!proofWrite?.ok) return fail(`CONTROLLER_ACTIVITY_PROOF_WRITE_FAILED:${proofWrite?.reason || 'UNKNOWN'}`);
  }
  const statusRecord = createControllerActivityStatusRecord({
    controllerId,
    title: canonical.title,
    runId,
    timestampUtc,
    runStartedAtUtc: text(input.runStartedAtUtc, timestampUtc),
    runCompletedAtUtc: text(input.runCompletedAtUtc, timestampUtc),
    observedEnabled: input.observedEnabled === true,
    executionState: text(input.executionState, 'IDLE'),
    materialActionsSucceeded,
    goalsAdvanced: count(input.goalsAdvanced),
    sourceChanges: count(input.sourceChanges),
    reviewsAdvanced: count(input.reviewsAdvanced),
    mergesCompleted: count(input.mergesCompleted),
    activeLanes: list(input.activeLanes),
    parkedLanes: list(input.parkedLanes),
    materialLanes: Array.isArray(input.materialLanes) ? input.materialLanes : [],
    targetMaterialLanes: count(input.targetMaterialLanes) || 15,
    safeEligibleWorkRemaining: count(input.safeEligibleWorkRemaining),
    blocker: text(input.blocker),
    lastMaterialActionAtUtc: text(input.lastMaterialActionAtUtc),
    nextAutomaticAction: text(input.nextAutomaticAction),
    proofRefs,
    participantId: text(input.participantId, 'chatgpt-controller'),
    relatedIssue: text(input.relatedIssue, '#1557'),
  });
  const statusWrite = await writeAtomicJson(
    workspaceRoot,
    ['status', `${statusRecord.statusId}.json`],
    statusRecord,
    { repoRoot },
  );
  if (!statusWrite?.ok) return fail(`CONTROLLER_ACTIVITY_STATUS_WRITE_FAILED:${statusWrite?.reason || 'UNKNOWN'}`);

  return Object.freeze({
    ok: true,
    schemaVersion: CONTROLLER_ACTIVITY_PUBLISHER_SCHEMA_VERSION,
    controllerId,
    runId,
    materialActionsSucceeded,
    proofWritten: Boolean(proofWrite?.ok),
    statusWritten: true,
    statusRecord,
    proofRecord,
    finalVerdict: 'CONTROLLER_ACTIVITY_PUBLISHED',
  });
}
