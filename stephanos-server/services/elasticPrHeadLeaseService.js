import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  appendExecutionReceipt,
  createExecutionReceipt,
  readExecutionReceiptHistory,
} from '../../shared/agents/executionReceiptV1.mjs';
import {
  buildMissionWorkerAction,
  projectMissionWorkerActionState,
} from '../../shared/agents/missionOrchestratorWorker.mjs';
import {
  claimSourceMutationLease,
  readSourceMutationLease,
  releaseSourceMutationLease,
  renewSourceMutationLease,
} from './programmeAuthorityService.js';
import { readElasticMissionControllerCapacityRoutingInput } from './elasticOpenClawProviderPoolService.js';
import {
  publishNextMissionWorkerAction,
  resolveMissionWorkerQueueRoot,
} from './missionOrchestratorWorkerService.js';

export const ELASTIC_PR_HEAD_LEASE_DISPATCH_SCHEMA = 'stephanos.elastic-pr-head-lease-dispatch.v1';

const SHA_40 = /^[0-9a-f]{40}$/i;
const ELASTIC_MISSION_ID = /^critical-([1-9]\d*)-elastic-goal(?:$|[-_.])/i;
const PARKED_OR_TERMINAL_PHASES = new Set([
  'AWAITING_OPERATOR_APPROVAL',
  'MERGE_PULL_REQUEST',
  'COMPLETE',
  'CANCELLED',
]);
const SOURCE_PHASES = new Set(['AGENT_IMPLEMENTATION', 'REPAIR_REQUIRED']);
const ACTIVE_EXECUTION_RECEIPT_STATES = new Set(['queued', 'accepted', 'started', 'progress', 'stalled']);
const TERMINAL_EXECUTION_RECEIPT_STATES = new Set(['completed', 'failed', 'cancelled']);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

function elasticIssueNumber(mission = {}) {
  const match = text(mission?.missionId).toLowerCase().match(ELASTIC_MISSION_ID);
  return positiveInteger(match?.[1]);
}

export function exactElasticPrHeadIdentity(mission = {}) {
  const missionId = text(mission?.missionId).toLowerCase();
  const issueNumber = elasticIssueNumber(mission);
  const prNumber = positiveInteger(mission?.pullRequest?.number ?? mission?.prNumber ?? mission?.relatedPr);
  const headSha = text(
    mission?.pullRequest?.headSha
      ?? mission?.headSha
      ?? mission?.git?.headSha,
  ).toLowerCase();
  const branch = text(mission?.git?.branch ?? mission?.branch);
  const repository = text(mission?.repository);
  if (
    !missionId
    || !issueNumber
    || !prNumber
    || !SHA_40.test(headSha)
    || !branch
    || !repository
  ) return null;
  return freeze({ missionId, issueNumber, prNumber, headSha, branch, repository });
}

function leaseIdForMission(mission, identity) {
  const revision = Number.isSafeInteger(Number(mission?.revision)) ? Number(mission.revision) : 0;
  return `${identity.missionId}-r${revision}-lease`.slice(0, 80);
}

function sameLeaseIdentity(lease = {}, identity = {}) {
  return Boolean(
    identity
    && text(lease?.laneId).toLowerCase() === identity.missionId
    && text(lease?.repository).toLowerCase() === identity.repository.toLowerCase()
    && positiveInteger(lease?.issueNumber) === identity.issueNumber
    && positiveInteger(lease?.prNumber) === identity.prNumber
    && text(lease?.branch) === identity.branch
    && text(lease?.headSha).toLowerCase() === identity.headSha
    && text(lease?.ownerId) === 'mission-worker'
  );
}

function grantAdapter(action = {}) {
  if (action.actionKind === 'signed-openclaw-operation') return 'openclaw-signed';
  if (action.actionKind === 'github-inspection') return 'openclaw-github-readonly';
  if (action.actionKind === 'agent-handoff') return text(action.adapter).toLowerCase();
  if (action.actionKind === 'evidence-judgment') return 'verification';
  return '';
}

function receiptWorkerType(grant = {}) {
  const adapter = text(grant.adapter).toLowerCase();
  if (adapter.includes('openclaw')) return 'openclaw';
  if (adapter.includes('github')) return 'github-first';
  if (adapter.includes('codex')) return 'remote-codex';
  return 'orchestration-engine';
}

function createQueuedExecutionReceipt(grant, lease, nowUtc) {
  return createExecutionReceipt({
    repository: grant.repository,
    issueNumber: grant.issueNumber,
    prNumber: grant.prNumber,
    branch: grant.branch,
    sourceHead: grant.headSha,
    workerId: text(grant.workerId, 'mission-worker'),
    workerType: receiptWorkerType(grant),
    executionId: grant.actionId,
    leaseKey: lease.leaseId,
    state: 'queued',
    phase: 'pr-head-dispatch-queued',
    sequence: 1,
    timestampUtc: nowUtc,
    proofRefs: [],
    expectedNextAction: 'Mission Worker must append accepted before executor authority is invoked.',
  });
}

function nextReceiptTimestamp(previous, nowUtc) {
  const requested = Date.parse(nowUtc);
  const previousMs = Date.parse(previous?.timestampUtc || '');
  return new Date(Math.max(
    Number.isFinite(requested) ? requested : Date.now(),
    Number.isFinite(previousMs) ? previousMs + 1 : 0,
  )).toISOString();
}

function createFailedPublicationReceipt(previous, nowUtc, blocker) {
  return createExecutionReceipt({
    repository: previous.repository,
    issueNumber: previous.issueNumber,
    prNumber: previous.prNumber,
    branch: previous.branch,
    sourceHead: previous.sourceHead,
    workerId: previous.workerId,
    workerType: previous.workerType,
    executionId: previous.executionId,
    leaseKey: previous.leaseKey,
    state: 'failed',
    phase: 'pr-head-queue-publication-failed',
    sequence: previous.sequence + 1,
    predecessorReceiptId: previous.receiptId,
    timestampUtc: nextReceiptTimestamp(previous, nowUtc),
    blocker,
    proofRefs: previous.proofRefs,
    expectedNextAction: 'Surface the publication blocker and admit a new bounded execution only after canonical reconciliation.',
  });
}

async function defaultActionInFlight({ adapter, actionId, env }) {
  const root = resolveMissionWorkerQueueRoot(env);
  if (!root || !adapter || !actionId) return false;
  for (const state of ['pending', 'processing']) {
    try {
      await access(resolve(root, adapter, state, `${actionId}.json`));
      return true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return false;
}

function exactPrHeadWorkerGrant(mission, identity, sourceRevision, capacityRouting, now) {
  const projectedState = projectMissionWorkerActionState(mission, { now });
  const projectedIdentity = exactElasticPrHeadIdentity(projectedState);
  if (!projectedIdentity || !sameLeaseIdentity({
    laneId: identity.missionId,
    repository: identity.repository,
    issueNumber: identity.issueNumber,
    prNumber: identity.prNumber,
    branch: identity.branch,
    headSha: identity.headSha,
    ownerId: 'mission-worker',
  }, projectedIdentity)) return null;
  const action = buildMissionWorkerAction(projectedState, { now, capacityRouting });
  if (action?.executable !== true) return null;
  const adapter = grantAdapter(action);
  if (!adapter) return null;
  const actionId = text(action.actionId).toLowerCase();
  const missionId = text(projectedState.missionId).toLowerCase();
  const currentPhase = text(projectedState.currentPhase).toUpperCase();
  if (!actionId || !missionId || !currentPhase || !SHA_40.test(sourceRevision)) return null;
  return freeze({
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    grantId: `grant-${actionId}`.slice(0, 80),
    controllerId: 'durable-flywheel-controller',
    sourceRevision: sourceRevision.toLowerCase(),
    missionId,
    missionRevision: Number(projectedState.revision),
    currentPhase,
    actionId,
    actionKind: text(action.actionKind),
    adapter,
    operation: text(action.operation),
    capacityRoute: text(action.capacityRoute),
    capacityReceiptId: text(action.capacityReceiptId) || null,
    capacityProofRefs: freeze(Array.isArray(action.capacityProofRefs) ? [...action.capacityProofRefs] : []),
    workerId: text(action.owner) || null,
    laneId: identity.missionId,
    repository: identity.repository,
    issueNumber: identity.issueNumber,
    prNumber: identity.prNumber,
    branch: identity.branch,
    headSha: identity.headSha,
    boundedActionCount: 1,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  });
}

function missionInventory(admission = {}) {
  const byId = new Map();
  const values = [
    admission.selectedMission,
    ...(Array.isArray(admission.elasticMissions) ? admission.elasticMissions : []),
    ...(Array.isArray(admission.activeMissions) ? admission.activeMissions : []),
    ...(Array.isArray(admission.runnableMissions) ? admission.runnableMissions : []),
  ];
  for (const mission of values) {
    const missionId = text(mission?.missionId).toLowerCase();
    if (missionId && !byId.has(missionId)) byId.set(missionId, mission);
  }
  return [...byId.values()];
}

function phaseOf(mission = {}) {
  return text(mission?.currentPhase).toUpperCase();
}

function baseResult(additions = {}) {
  return freeze({
    schemaVersion: ELASTIC_PR_HEAD_LEASE_DISPATCH_SCHEMA,
    ok: additions.ok !== false,
    classification: text(additions.classification, 'ELASTIC_PR_HEAD_LEASE_NOT_REQUIRED'),
    dispatchCount: Array.isArray(additions.dispatched) ? additions.dispatched.length : 0,
    dispatched: additions.dispatched ?? [],
    held: additions.held ?? [],
    handledMissionIds: additions.handledMissionIds ?? [],
    newlyOccupiedMissionIds: additions.newlyOccupiedMissionIds ?? [],
    releasedLease: additions.releasedLease ?? null,
    activeLease: additions.activeLease ?? null,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    leaseSeizureAllowed: false,
  });
}

export async function dispatchElasticPrHeadBuildsFromCanonicalLease(admission = {}, options = {}) {
  const normalized = options && typeof options === 'object' ? options : {};
  const env = normalized.env || process.env;
  const now = normalized.now instanceof Date ? normalized.now : new Date();
  const nowUtc = now.toISOString();
  const paths = normalized.paths || {};
  const sourceRevision = text(normalized.sourceRevision).toLowerCase();
  const missions = missionInventory(admission);
  const exactMissions = missions
    .map((mission) => ({ mission, identity: exactElasticPrHeadIdentity(mission) }))
    .filter((entry) => entry.identity)
    .sort((left, right) => left.identity.missionId.localeCompare(right.identity.missionId));
  const handledMissionIds = exactMissions.map(({ identity }) => identity.missionId);
  if (!exactMissions.length) return baseResult({ handledMissionIds });
  if (!SHA_40.test(sourceRevision)) {
    return baseResult({
      ok: false,
      classification: 'ELASTIC_PR_HEAD_SOURCE_REVISION_UNPROVEN',
      handledMissionIds,
      held: exactMissions.map(({ identity }) => ({ missionId: identity.missionId, reason: 'SOURCE_REVISION_REQUIRED' })),
    });
  }

  const serviceOptions = { root: paths.workspaceRoot, repoRoot: paths.repoRoot, env };
  const receiptOptions = { repoRoot: paths.repoRoot };
  const readLease = normalized.readSourceMutationLease ?? readSourceMutationLease;
  const claimLease = normalized.claimSourceMutationLease ?? claimSourceMutationLease;
  const renewLease = normalized.renewSourceMutationLease ?? renewSourceMutationLease;
  const releaseLease = normalized.releaseSourceMutationLease ?? releaseSourceMutationLease;
  const readCapacityRouting = normalized.readCapacityRouting ?? readElasticMissionControllerCapacityRoutingInput;
  const publishWorkerAction = normalized.publishWorkerAction ?? publishNextMissionWorkerAction;
  const isActionInFlight = normalized.isActionInFlight ?? defaultActionInFlight;
  const readReceiptHistory = normalized.readExecutionReceiptHistory ?? readExecutionReceiptHistory;
  const appendReceipt = normalized.appendExecutionReceipt ?? appendExecutionReceipt;

  let leaseRead = await readLease({
    root: paths.workspaceRoot,
    repoRoot: paths.repoRoot,
    nowUtc,
  });
  let releasedLease = null;
  let currentLease = leaseRead?.present ? leaseRead.record : null;
  let leasedEntry = currentLease
    ? exactMissions.find(({ identity }) => sameLeaseIdentity(currentLease, identity)) ?? null
    : null;

  if (
    currentLease
    && leasedEntry
    && PARKED_OR_TERMINAL_PHASES.has(phaseOf(leasedEntry.mission))
  ) {
    releasedLease = await releaseLease({
      leaseId: currentLease.leaseId,
      laneId: currentLease.laneId,
      repository: currentLease.repository,
      issueNumber: currentLease.issueNumber,
      prNumber: currentLease.prNumber,
      branch: currentLease.branch,
      headSha: currentLease.headSha,
      ownerId: currentLease.ownerId,
      nowUtc,
    }, serviceOptions);
    if (releasedLease?.ok !== true) {
      return baseResult({
        ok: false,
        classification: 'ELASTIC_PR_HEAD_PARKED_LEASE_RELEASE_BLOCKED',
        handledMissionIds,
        held: [{ missionId: leasedEntry.identity.missionId, reason: text(releasedLease?.reason, 'LEASE_RELEASE_FAILED') }],
        activeLease: currentLease,
        releasedLease,
      });
    }
    currentLease = null;
    leasedEntry = null;
    leaseRead = { ok: true, present: false, reason: 'SOURCE_MUTATION_LEASE_RELEASED' };
  }

  if (currentLease) {
    if (!leaseRead?.ok || !leasedEntry) {
      return baseResult({
        ok: true,
        classification: 'ELASTIC_PR_HEAD_LEASE_OCCUPIED',
        handledMissionIds,
        held: exactMissions.map(({ identity }) => ({
          missionId: identity.missionId,
          reason: leasedEntry ? text(leaseRead?.reason, 'SOURCE_MUTATION_LEASE_NOT_ACTIVE') : 'SOURCE_MUTATION_LEASE_OWNED_BY_OTHER_LANE',
        })),
        activeLease: currentLease,
      });
    }
    if (text(leasedEntry.mission?.dispatch?.status).toLowerCase() === 'running') {
      const renewal = await renewLease({
        leaseId: currentLease.leaseId,
        laneId: currentLease.laneId,
        repository: currentLease.repository,
        issueNumber: currentLease.issueNumber,
        prNumber: currentLease.prNumber,
        branch: currentLease.branch,
        headSha: currentLease.headSha,
        ownerId: currentLease.ownerId,
        nowUtc,
      }, serviceOptions);
      if (renewal?.ok !== true) {
        return baseResult({
          ok: false,
          classification: 'ELASTIC_PR_HEAD_LEASE_RENEWAL_BLOCKED',
          handledMissionIds,
          held: [{ missionId: leasedEntry.identity.missionId, reason: text(renewal?.reason, 'LEASE_RENEWAL_FAILED') }],
          activeLease: currentLease,
          releasedLease,
        });
      }
      return baseResult({
        classification: 'ELASTIC_PR_HEAD_LEASE_ALREADY_RUNNING',
        handledMissionIds,
        activeLease: renewal.record ?? currentLease,
        releasedLease,
      });
    }
    const renewal = await renewLease({
      leaseId: currentLease.leaseId,
      laneId: currentLease.laneId,
      repository: currentLease.repository,
      issueNumber: currentLease.issueNumber,
      prNumber: currentLease.prNumber,
      branch: currentLease.branch,
      headSha: currentLease.headSha,
      ownerId: currentLease.ownerId,
      nowUtc,
    }, serviceOptions);
    if (renewal?.ok !== true) {
      return baseResult({
        ok: false,
        classification: 'ELASTIC_PR_HEAD_LEASE_RENEWAL_BLOCKED',
        handledMissionIds,
        held: [{ missionId: leasedEntry.identity.missionId, reason: text(renewal?.reason, 'LEASE_RENEWAL_FAILED') }],
        activeLease: currentLease,
        releasedLease,
      });
    }
    currentLease = renewal.record ?? currentLease;
  } else {
    const runningWithoutLease = exactMissions.find(({ mission }) => (
      !PARKED_OR_TERMINAL_PHASES.has(phaseOf(mission))
      && text(mission?.dispatch?.status).toLowerCase() === 'running'
    ));
    if (runningWithoutLease) {
      return baseResult({
        ok: false,
        classification: 'ELASTIC_PR_HEAD_RUNNING_WITHOUT_LEASE',
        handledMissionIds,
        held: [{ missionId: runningWithoutLease.identity.missionId, reason: 'RUNNING_PR_HEAD_MISSION_WITHOUT_CANONICAL_LEASE' }],
        releasedLease,
      });
    }
    const selectedId = text(admission?.selectedMission?.missionId).toLowerCase();
    leasedEntry = exactMissions.find(({ identity, mission }) => (
      identity.missionId === selectedId
      && !PARKED_OR_TERMINAL_PHASES.has(phaseOf(mission))
    )) ?? exactMissions.find(({ mission }) => !PARKED_OR_TERMINAL_PHASES.has(phaseOf(mission))) ?? null;
    if (!leasedEntry) {
      return baseResult({
        classification: releasedLease ? 'ELASTIC_PR_HEAD_PARKED_LEASE_RELEASED' : 'ELASTIC_PR_HEAD_LEASE_NOT_REQUIRED',
        handledMissionIds,
        releasedLease,
      });
    }
    const requestedLeaseId = leaseIdForMission(leasedEntry.mission, leasedEntry.identity);
    const claim = await claimLease({
      leaseId: requestedLeaseId,
      laneId: leasedEntry.identity.missionId,
      repository: leasedEntry.identity.repository,
      issueNumber: leasedEntry.identity.issueNumber,
      prNumber: leasedEntry.identity.prNumber,
      branch: leasedEntry.identity.branch,
      headSha: leasedEntry.identity.headSha,
      ownerId: 'mission-worker',
      nowUtc,
      proofRefs: [],
    }, serviceOptions);
    if (claim?.ok !== true) {
      return baseResult({
        ok: false,
        classification: 'ELASTIC_PR_HEAD_LEASE_CLAIM_BLOCKED',
        handledMissionIds,
        held: [{ missionId: leasedEntry.identity.missionId, reason: text(claim?.reason, 'LEASE_CLAIM_FAILED') }],
        releasedLease,
      });
    }
    currentLease = claim.record;
  }

  const currentPhase = phaseOf(leasedEntry.mission);
  let capacityRouting = normalized.capacityRouting ?? null;
  if (SOURCE_PHASES.has(currentPhase) && !capacityRouting) {
    capacityRouting = await readCapacityRouting({
      root: paths.workspaceRoot,
      repoRoot: paths.repoRoot,
      nowUtc,
      sourceRevision,
      env,
    });
    if (!capacityRouting) {
      return baseResult({
        ok: false,
        classification: 'ELASTIC_PR_HEAD_CAPACITY_ROUTING_UNAVAILABLE',
        handledMissionIds,
        held: [{ missionId: leasedEntry.identity.missionId, reason: 'PROVIDER_INDEPENDENT_CAPACITY_ROUTING_UNAVAILABLE' }],
        activeLease: currentLease,
        releasedLease,
      });
    }
  }

  const grant = exactPrHeadWorkerGrant(
    leasedEntry.mission,
    leasedEntry.identity,
    sourceRevision,
    capacityRouting,
    now,
  );
  if (!grant) {
    return baseResult({
      ok: false,
      classification: 'ELASTIC_PR_HEAD_EXACT_ACTION_GRANT_UNAVAILABLE',
      handledMissionIds,
      held: [{ missionId: leasedEntry.identity.missionId, reason: 'EXACT_PR_HEAD_ACTION_GRANT_UNAVAILABLE' }],
      activeLease: currentLease,
      releasedLease,
    });
  }

  if (!paths.workspaceRoot || !text(currentLease?.leaseId)) {
    return baseResult({
      ok: false,
      classification: 'ELASTIC_PR_HEAD_EXECUTION_RECEIPT_CONTEXT_UNAVAILABLE',
      handledMissionIds,
      held: [{ missionId: leasedEntry.identity.missionId, reason: 'EXECUTION_RECEIPT_WORKSPACE_OR_LEASE_REQUIRED' }],
      activeLease: currentLease,
      releasedLease,
    });
  }

  let receiptHistory;
  try {
    receiptHistory = await readReceiptHistory(paths.workspaceRoot, {
      executionId: grant.actionId,
      leaseKey: currentLease.leaseId,
      expectedHead: grant.headSha,
    }, receiptOptions);
  } catch (error) {
    return baseResult({
      ok: false,
      classification: 'ELASTIC_PR_HEAD_EXECUTION_RECEIPT_HISTORY_UNAVAILABLE',
      handledMissionIds,
      held: [{ missionId: leasedEntry.identity.missionId, reason: `EXECUTION_RECEIPT_HISTORY_FAILED:${text(error?.message, 'unknown')}` }],
      activeLease: currentLease,
      releasedLease,
    });
  }
  if (receiptHistory?.ok !== true) {
    return baseResult({
      ok: false,
      classification: 'ELASTIC_PR_HEAD_EXECUTION_RECEIPT_HISTORY_BLOCKED',
      handledMissionIds,
      held: [{ missionId: leasedEntry.identity.missionId, reason: text(receiptHistory?.reason, 'EXECUTION_RECEIPT_HISTORY_BLOCKED') }],
      activeLease: currentLease,
      releasedLease,
    });
  }
  let executionReceipt = receiptHistory.latestReceipt ?? null;

  let inFlight = false;
  try {
    inFlight = await isActionInFlight({ adapter: grant.adapter, actionId: grant.actionId, env });
  } catch (error) {
    return baseResult({
      ok: false,
      classification: 'ELASTIC_PR_HEAD_IN_FLIGHT_PROOF_UNAVAILABLE',
      handledMissionIds,
      held: [{ missionId: leasedEntry.identity.missionId, reason: `IN_FLIGHT_PROOF_FAILED:${text(error?.message, 'unknown')}` }],
      activeLease: currentLease,
      releasedLease,
    });
  }
  if (inFlight) {
    if (!executionReceipt || !ACTIVE_EXECUTION_RECEIPT_STATES.has(executionReceipt.state)) {
      return baseResult({
        ok: false,
        classification: 'ELASTIC_PR_HEAD_IN_FLIGHT_RECEIPT_MISMATCH',
        handledMissionIds,
        held: [{ missionId: leasedEntry.identity.missionId, reason: 'IN_FLIGHT_PR_HEAD_ACTION_WITHOUT_ACTIVE_CANONICAL_RECEIPT' }],
        activeLease: currentLease,
        releasedLease,
      });
    }
    return baseResult({
      classification: 'ELASTIC_PR_HEAD_ACTION_ALREADY_IN_FLIGHT',
      handledMissionIds,
      activeLease: currentLease,
      releasedLease,
    });
  }

  if (executionReceipt && TERMINAL_EXECUTION_RECEIPT_STATES.has(executionReceipt.state)) {
    return baseResult({
      ok: false,
      classification: 'ELASTIC_PR_HEAD_EXECUTION_ALREADY_TERMINAL',
      handledMissionIds,
      held: [{ missionId: leasedEntry.identity.missionId, reason: `EXECUTION_RECEIPT_ALREADY_${executionReceipt.state.toUpperCase()}` }],
      activeLease: currentLease,
      releasedLease,
    });
  }
  if (executionReceipt && executionReceipt.state !== 'queued') {
    return baseResult({
      ok: false,
      classification: 'ELASTIC_PR_HEAD_ACTIVE_RECEIPT_WITHOUT_QUEUE_PROOF',
      handledMissionIds,
      held: [{ missionId: leasedEntry.identity.missionId, reason: `ACTIVE_EXECUTION_RECEIPT_WITHOUT_IN_FLIGHT_QUEUE:${executionReceipt.state}` }],
      activeLease: currentLease,
      releasedLease,
    });
  }

  if (!executionReceipt) {
    executionReceipt = createQueuedExecutionReceipt(grant, currentLease, nowUtc);
    let queuedAppend;
    try {
      queuedAppend = await appendReceipt(paths.workspaceRoot, executionReceipt, receiptOptions);
    } catch (error) {
      queuedAppend = { ok: false, reason: `append-exception:${text(error?.message, 'unknown')}` };
    }
    if (queuedAppend?.ok !== true) {
      return baseResult({
        ok: false,
        classification: 'ELASTIC_PR_HEAD_QUEUED_RECEIPT_BLOCKED',
        handledMissionIds,
        held: [{ missionId: leasedEntry.identity.missionId, reason: text(queuedAppend?.reason, 'QUEUED_EXECUTION_RECEIPT_APPEND_FAILED') }],
        activeLease: currentLease,
        releasedLease,
      });
    }
  }

  let publication;
  try {
    publication = await publishWorkerAction({
      env,
      now,
      nowUtc,
      sourceRevision,
      repoRoot: paths.repoRoot,
      sharedWorkspaceRoot: paths.workspaceRoot,
      root: paths.orchestratorRoot,
      snapshotRoot: paths.snapshotRoot,
      capacityRouting,
      actionGrant: grant,
    });
  } catch (error) {
    publication = {
      published: false,
      actionGrantAccepted: false,
      reason: `publication-exception:${text(error?.message, 'unknown')}`,
    };
  }
  if (publication?.published !== true || publication?.actionGrantAccepted !== true) {
    const publicationBlocker = text(publication?.reason, 'PR_HEAD_ACTION_NOT_PUBLISHED');
    const failedReceipt = createFailedPublicationReceipt(executionReceipt, nowUtc, publicationBlocker);
    try {
      const failedAppend = await appendReceipt(paths.workspaceRoot, failedReceipt, receiptOptions);
      if (failedAppend?.ok !== true) {
        return baseResult({
          ok: false,
          classification: 'ELASTIC_PR_HEAD_DISPATCH_AND_RECEIPT_TERMINALIZATION_BLOCKED',
          handledMissionIds,
          held: [{ missionId: leasedEntry.identity.missionId, reason: `${publicationBlocker};${text(failedAppend?.reason, 'FAILED_RECEIPT_APPEND_FAILED')}` }],
          activeLease: currentLease,
          releasedLease,
        });
      }
    } catch (error) {
      return baseResult({
        ok: false,
        classification: 'ELASTIC_PR_HEAD_DISPATCH_AND_RECEIPT_TERMINALIZATION_BLOCKED',
        handledMissionIds,
        held: [{ missionId: leasedEntry.identity.missionId, reason: `${publicationBlocker};FAILED_RECEIPT_APPEND_EXCEPTION:${text(error?.message, 'unknown')}` }],
        activeLease: currentLease,
        releasedLease,
      });
    }
    return baseResult({
      ok: false,
      classification: 'ELASTIC_PR_HEAD_DISPATCH_BLOCKED',
      handledMissionIds,
      held: [{ missionId: leasedEntry.identity.missionId, reason: publicationBlocker }],
      activeLease: currentLease,
      releasedLease,
    });
  }

  return baseResult({
    classification: 'ELASTIC_PR_HEAD_DISPATCH_LIVE',
    handledMissionIds,
    dispatched: [{
      missionId: leasedEntry.identity.missionId,
      issueNumber: leasedEntry.identity.issueNumber,
      prNumber: leasedEntry.identity.prNumber,
      headSha: leasedEntry.identity.headSha,
      branch: leasedEntry.identity.branch,
      repository: leasedEntry.identity.repository,
      adapter: grant.adapter,
      capacityRoute: grant.capacityRoute,
      capacityReceiptId: grant.capacityReceiptId,
      actionId: grant.actionId,
      grantId: grant.grantId,
      executionId: executionReceipt.executionId,
      leaseKey: executionReceipt.leaseKey,
      queuedReceiptId: executionReceipt.receiptId,
      resourceScopes: freeze(Array.isArray(leasedEntry.mission?.allowedFiles) ? [...leasedEntry.mission.allowedFiles] : []),
    }],
    newlyOccupiedMissionIds: [leasedEntry.identity.missionId],
    activeLease: currentLease,
    releasedLease,
  });
}
