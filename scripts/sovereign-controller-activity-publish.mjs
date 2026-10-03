#!/usr/bin/env node
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { CANONICAL_CONTROLLER_FLEET } from '../shared/agents/controllerFleetTelemetryV1.mjs';
import { publishControllerActivityV1 } from '../shared/agents/controllerActivityPublisherV1.mjs';

export const SOVEREIGN_CONTROLLER_ACTIVITY_PUBLISH_SCHEMA =
  'stephanos.sovereign-controller-activity-publish.v1';
export const SOVEREIGN_CONTROLLER_ACTIVITY_PUBLISH_MARKER =
  'SOVEREIGN_COMMANDER_CONTROLLER_ACTIVITY_PUBLISH_RESULT=';

const CONTROLLER_IDS = new Set(CANONICAL_CONTROLLER_FLEET.map((item) => item.controllerId));
const EXECUTION_STATES = new Set(['RUNNING', 'ACTIVE', 'READY', 'IDLE', 'BLOCKED', 'WAITING', 'SAFE_HOLD', 'FAILED']);
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/#@()+-]{0,159}$/;
const PROOF_REF = /^(proof|receipts)\/[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

function text(value) {
  return String(value ?? '').trim();
}

function count(value, name) {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 100000) {
    throw new Error(`CONTROLLER_ACTIVITY_${name}_INVALID`);
  }
  return parsed;
}

function time(value, name, optional = true) {
  const candidate = text(value);
  if (!candidate && optional) return '';
  const ms = Date.parse(candidate);
  if (!Number.isFinite(ms)) throw new Error(`CONTROLLER_ACTIVITY_${name}_INVALID`);
  return new Date(ms).toISOString();
}

function tokens(value, name, max = 15) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) throw new Error(`CONTROLLER_ACTIVITY_${name}_INVALID`);
  const result = value.map((item) => text(item));
  if (result.some((item) => !TOKEN.test(item))) throw new Error(`CONTROLLER_ACTIVITY_${name}_INVALID`);
  return result;
}

function proofRefs(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new Error('CONTROLLER_ACTIVITY_PROOF_REFS_INVALID');
  const refs = [...new Set(value.map((item) => text(item)))];
  if (refs.some((item) => !PROOF_REF.test(item))) throw new Error('CONTROLLER_ACTIVITY_PROOF_REFS_INVALID');
  return refs;
}

function boundedText(value, name, max = 240) {
  const candidate = text(value);
  if (candidate.length > max || /[\u0000-\u001f\u007f]/.test(candidate)) {
    throw new Error(`CONTROLLER_ACTIVITY_${name}_INVALID`);
  }
  return candidate;
}

function materialLanes(value, refs) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 15) throw new Error('CONTROLLER_ACTIVITY_MATERIAL_LANES_INVALID');
  const allowed = new Set([
    'laneId', 'goalId', 'prNumber', 'resourceId', 'workerId', 'provider',
    'lastMaterialAction', 'lastMaterialActionAtUtc', 'proofRef', 'blocker',
    'retryState', 'failoverState', 'nextAutomaticAction',
  ]);
  return value.map((lane) => {
    if (!lane || typeof lane !== 'object' || Array.isArray(lane)) {
      throw new Error('CONTROLLER_ACTIVITY_MATERIAL_LANES_INVALID');
    }
    if (Object.keys(lane).some((key) => !allowed.has(key))) {
      throw new Error('CONTROLLER_ACTIVITY_MATERIAL_LANES_INVALID');
    }
    const proofRef = text(lane.proofRef);
    if (!PROOF_REF.test(proofRef) || !refs.includes(proofRef)) {
      throw new Error('CONTROLLER_ACTIVITY_MATERIAL_LANE_PROOF_REQUIRED');
    }
    const prNumber = lane.prNumber === undefined || lane.prNumber === null
      ? null
      : count(lane.prNumber, 'MATERIAL_LANE_PR_NUMBER');
    return Object.freeze({
      laneId: boundedText(lane.laneId, 'MATERIAL_LANE_ID', 160),
      goalId: boundedText(lane.goalId, 'MATERIAL_LANE_GOAL_ID', 160),
      ...(prNumber ? { prNumber } : {}),
      resourceId: boundedText(lane.resourceId, 'MATERIAL_LANE_RESOURCE_ID', 160),
      workerId: boundedText(lane.workerId, 'MATERIAL_LANE_WORKER_ID', 160),
      provider: boundedText(lane.provider, 'MATERIAL_LANE_PROVIDER', 120),
      lastMaterialAction: boundedText(lane.lastMaterialAction, 'MATERIAL_LANE_LAST_ACTION', 160),
      lastMaterialActionAtUtc: time(lane.lastMaterialActionAtUtc, 'MATERIAL_LANE_LAST_ACTION_TIME'),
      proofRef,
      blocker: boundedText(lane.blocker, 'MATERIAL_LANE_BLOCKER', 160),
      retryState: boundedText(lane.retryState, 'MATERIAL_LANE_RETRY_STATE', 120),
      failoverState: boundedText(lane.failoverState, 'MATERIAL_LANE_FAILOVER_STATE', 120),
      nextAutomaticAction: boundedText(lane.nextAutomaticAction, 'MATERIAL_LANE_NEXT_ACTION', 240),
    });
  });
}

export function validateSovereignControllerActivityPayload(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('CONTROLLER_ACTIVITY_PAYLOAD_INVALID');
  }
  const allowed = new Set([
    'schemaVersion', 'controllerId', 'runId', 'timestampUtc', 'runStartedAtUtc', 'runCompletedAtUtc',
    'observedEnabled', 'executionState', 'materialActionsSucceeded', 'goalsAdvanced', 'sourceChanges',
    'reviewsAdvanced', 'mergesCompleted', 'activeLanes', 'parkedLanes', 'materialLanes',
    'safeEligibleWorkRemaining', 'blocker', 'lastMaterialActionAtUtc', 'nextAutomaticAction',
    'proofRefs', 'relatedIssue',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error('CONTROLLER_ACTIVITY_FIELD_NOT_ALLOWED');
  if (input.schemaVersion !== SOVEREIGN_CONTROLLER_ACTIVITY_PUBLISH_SCHEMA) {
    throw new Error('CONTROLLER_ACTIVITY_SCHEMA_INVALID');
  }
  const controllerId = text(input.controllerId);
  if (!CONTROLLER_IDS.has(controllerId)) throw new Error('CONTROLLER_ACTIVITY_CONTROLLER_NOT_CANONICAL');
  const runId = text(input.runId);
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(runId)) throw new Error('CONTROLLER_ACTIVITY_RUN_ID_INVALID');
  if (typeof input.observedEnabled !== 'boolean') throw new Error('CONTROLLER_ACTIVITY_ENABLEMENT_INVALID');
  const executionState = text(input.executionState).toUpperCase();
  if (!EXECUTION_STATES.has(executionState)) throw new Error('CONTROLLER_ACTIVITY_EXECUTION_STATE_INVALID');
  const refs = proofRefs(input.proofRefs);
  const lanes = materialLanes(input.materialLanes, refs);
  const activeLanes = tokens(input.activeLanes, 'ACTIVE_LANES');
  const parkedLanes = tokens(input.parkedLanes, 'PARKED_LANES');
  const activeLaneCount = input.activeLaneCount === undefined
    ? activeLanes.length
    : count(input.activeLaneCount, 'ACTIVE_LANE_COUNT');
  const parkedLaneCount = input.parkedLaneCount === undefined
    ? parkedLanes.length
    : count(input.parkedLaneCount, 'PARKED_LANE_COUNT');
  if (activeLaneCount > 15 || parkedLaneCount > 15) {
    throw new Error('CONTROLLER_ACTIVITY_LANE_COUNT_INVALID');
  }
  const materialActionsSucceeded = count(input.materialActionsSucceeded, 'MATERIAL_ACTIONS');
  if ((materialActionsSucceeded > 0 || lanes.length > 0) && refs.length === 0) {
    throw new Error('CONTROLLER_ACTIVITY_MATERIAL_PROOF_REQUIRED');
  }
  return Object.freeze({
    controllerId,
    runId,
    timestampUtc: time(input.timestampUtc || new Date().toISOString(), 'TIMESTAMP', false),
    runStartedAtUtc: time(input.runStartedAtUtc, 'RUN_STARTED'),
    runCompletedAtUtc: time(input.runCompletedAtUtc, 'RUN_COMPLETED'),
    observedEnabled: input.observedEnabled,
    executionState,
    materialActionsSucceeded,
    goalsAdvanced: count(input.goalsAdvanced, 'GOALS_ADVANCED'),
    sourceChanges: count(input.sourceChanges, 'SOURCE_CHANGES'),
    reviewsAdvanced: count(input.reviewsAdvanced, 'REVIEWS_ADVANCED'),
    mergesCompleted: count(input.mergesCompleted, 'MERGES_COMPLETED'),
    activeLanes,
    parkedLanes,
    activeLaneCount,
    parkedLaneCount,
    materialLanes: lanes,
    targetMaterialLanes: 15,
    safeEligibleWorkRemaining: count(input.safeEligibleWorkRemaining, 'SAFE_ELIGIBLE_WORK'),
    blocker: boundedText(input.blocker, 'BLOCKER', 160),
    lastMaterialActionAtUtc: time(input.lastMaterialActionAtUtc, 'LAST_MATERIAL_ACTION_TIME'),
    nextAutomaticAction: boundedText(input.nextAutomaticAction, 'NEXT_ACTION', 240),
    proofRefs: refs,
    participantId: `chatgpt-controller-${controllerId.slice(0, 12)}`,
    relatedIssue: /^#\d{1,9}$/.test(text(input.relatedIssue)) ? text(input.relatedIssue) : '#1903',
  });
}

function parsePayload(argv = process.argv.slice(2)) {
  const index = argv.indexOf('--payload-base64');
  if (index < 0 || !argv[index + 1]) throw new Error('CONTROLLER_ACTIVITY_PAYLOAD_REQUIRED');
  const encoded = text(argv[index + 1]);
  if (encoded.length > 48000 || !/^[A-Za-z0-9+/=_-]+$/.test(encoded)) {
    throw new Error('CONTROLLER_ACTIVITY_PAYLOAD_ENCODING_INVALID');
  }
  const raw = Buffer.from(encoded, 'base64url').toString('utf8');
  if (!raw || Buffer.byteLength(raw, 'utf8') > 32000) throw new Error('CONTROLLER_ACTIVITY_PAYLOAD_TOO_LARGE');
  return JSON.parse(raw);
}

export async function publishSovereignControllerActivity(input, options = {}) {
  const payload = validateSovereignControllerActivityPayload(input);
  const repoRoot = options.repoRoot || fileURLToPath(new URL('../', import.meta.url));
  const result = await publishControllerActivityV1(payload, {
    repoRoot,
    workspaceRoot: options.workspaceRoot ?? process.env.STEPHANOS_SHARED_AGENT_WORKSPACE,
  });
  if (!result.ok) return result;
  return Object.freeze({
    ok: true,
    schemaVersion: SOVEREIGN_CONTROLLER_ACTIVITY_PUBLISH_SCHEMA,
    controllerId: result.controllerId,
    runId: result.runId,
    statusWritten: result.statusWritten === true,
    proofWritten: result.proofWritten === true,
    statusId: text(result.statusRecord?.statusId),
    proofId: text(result.proofRecord?.proofId),
    executionState: text(result.statusRecord?.controllerActivity?.executionState),
    materialLaneCount: Array.isArray(result.statusRecord?.controllerActivity?.materialLanes)
      ? result.statusRecord.controllerActivity.materialLanes.length
      : 0,
    materialActionsSucceeded: Number(result.materialActionsSucceeded) || 0,
    finalVerdict: 'SOVEREIGN_CONTROLLER_ACTIVITY_PUBLISHED',
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    secretMaterialIncluded: false,
  });
}

async function main() {
  const result = await publishSovereignControllerActivity(parsePayload());
  process.stdout.write(`${SOVEREIGN_CONTROLLER_ACTIVITY_PUBLISH_MARKER}${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stdout.write(`${SOVEREIGN_CONTROLLER_ACTIVITY_PUBLISH_MARKER}${JSON.stringify({
      ok: false,
      blocker: text(error?.message || error),
      finalVerdict: 'SOVEREIGN_CONTROLLER_ACTIVITY_PUBLICATION_BLOCKED',
      arbitraryShellAllowed: false,
      sourceMutationAllowed: false,
      mergeAuthority: false,
      secretMaterialIncluded: false,
    })}\n`);
    process.exitCode = 1;
  });
}
