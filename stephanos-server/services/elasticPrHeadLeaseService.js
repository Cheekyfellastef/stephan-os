import { access, lstat, readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import {
  appendExecutionReceipt,
  createExecutionReceipt,
  readExecutionReceiptHistory,
  validateExecutionReceipt,
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
import { readMissionRecord, runWithMissionStatePrecondition } from './missionOrchestratorStore.js';
import { verifyOriginalSourceAttemptFence } from './originalSourceAttemptFenceService.js';

export const ELASTIC_PR_HEAD_LEASE_DISPATCH_SCHEMA = 'stephanos.elastic-pr-head-lease-dispatch.v1';

const SHA_40 = /^[0-9a-f]{40}$/i;
const ELASTIC_MISSION_ID = /^critical-([1-9]\d*)-elastic-goal(?:$|[-_.])/i;
const PARKED_OR_TERMINAL_PHASES = new Set([
  'BLOCKED',
  'AWAITING_OPERATOR_APPROVAL',
  'MERGE_PULL_REQUEST',
  'COMPLETE',
  'CANCELLED',
]);
const SOURCE_PHASES = new Set(['AGENT_IMPLEMENTATION', 'REPAIR_REQUIRED']);
const ACTIVE_EXECUTION_RECEIPT_STATES = new Set(['queued', 'accepted', 'started', 'progress', 'stalled']);
const TERMINAL_EXECUTION_RECEIPT_STATES = new Set(['completed', 'failed', 'cancelled']);

// Provider result IDs and queue action IDs are different namespaces. Resolve
// their relationship from the canonical consumed result event, never by
// stripping a provider prefix. Caller holds the mission-state precondition
// lock, preventing a concurrent result or retry from replacing this identity.
export async function readOriginalSourceExecutionIdV1(mission, paths, env) {
  const resultId = text(mission?.dispatch?.resultId);
  if (!resultId) return '';
  const record = await readMissionRecord(mission.missionId, { root: paths.orchestratorRoot, env });
  if ((await stat(record.eventPath)).size > 2097152) return '';
  const lines = (await readFile(record.eventPath, 'utf8')).split('\n').filter(Boolean);
  if (lines.length > 2048) return '';
  const processed = new Set(mission?.storeMetadata?.processedEventIds || []);
  const matches = lines.map((line) => JSON.parse(line)).filter((event) =>
    event?.eventType === 'AGENT_RESULT_RECEIVED'
    && text(event.missionId) === text(mission.missionId)
    && text(event.resultId) === resultId
    && processed.has(text(event.eventId)));
  if (matches.length !== 1) return '';
  const eventId = text(matches[0].eventId);
  return eventId.startsWith('result-') ? eventId.slice('result-'.length) : '';
}

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

// Queue receipts must cite already persisted original mission proof or an
// authenticated capacity/lease proof. An empty synthetic reference is not proof.
// Mission receipts have passed the existing orchestrator evidence gate.
function existingQueuedProofRefs(grant, lease, mission) {
  const evidence = Array.isArray(mission?.evidenceReceipts)
    ? mission.evidenceReceipts.filter((receipt) => receipt?.verified === true
      && text(receipt?.requirement) && text(receipt?.source)
      && text(receipt?.evidenceType)
      && (text(receipt?.sha256).match(/^[a-f0-9]{64}$/i)
        || text(receipt?.commandOutputHash).match(/^[a-f0-9]{64}$/i)
        || receipt?.exitCode === 0 || text(receipt?.receiptPath)))
      .map((receipt) => text(receipt.receiptPath || receipt.receiptId))
    : [];
  return [...new Set([
    ...(Array.isArray(grant?.capacityProofRefs) ? grant.capacityProofRefs : []),
    ...(Array.isArray(lease?.proofRefs) ? lease.proofRefs : []),
    ...evidence,
  ].filter((ref) => typeof ref === 'string' && ref.trim().length > 0))].slice(0, 24);
}

function createQueuedExecutionReceipt(grant, lease, nowUtc, proofRefs) {
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
    proofRefs,
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

// A cancelled original can only hand back its own stale source lease after
// durable cancellation, a fully terminal original execution and observation of
// EVERY pending/processing worker adapter. Unknown roots/items fail closed.
// This checks source responsibility, not replacement-goal acceptance.
const ORIGINAL_SOURCE_QUEUE_ADAPTERS = Object.freeze([
  'openclaw-signed', 'openclaw-github-readonly', 'codex',
  'openclaw-standalone', 'openclaw-local', 'chatgpt-github',
  'foundry-forge', 'forge-publication', 'desktop-commander',
  'sovereign-commander', 'stephanos-native', 'openclaw-readonly',
  'openclaw-local-deployment', 'verification',
]);

export async function originalMissionHasQueuedWork({ missionId, leaseId, env }) {
  const root = resolveMissionWorkerQueueRoot(env);
  if (!root) throw new Error('ORIGINAL_MISSION_QUEUE_ROOT_UNAVAILABLE');
  await access(root);
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.length > 64 || entries.some((entry) => entry.isSymbolicLink())) {
    throw new Error('ORIGINAL_MISSION_QUEUE_ROOT_UNSAFE');
  }
  const adapters = new Set([...ORIGINAL_SOURCE_QUEUE_ADAPTERS,
    ...entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)]);
  for (const adapter of adapters) {
    for (const state of ['pending', 'processing']) {
      const directory = resolve(root, adapter, state);
      let items;
      try { items = await readdir(directory, { withFileTypes: true }); }
      catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      if (items.length > 512) throw new Error('ORIGINAL_MISSION_QUEUE_INVENTORY_UNBOUNDED');
      for (const item of items) {
        if (!item.isFile() || !item.name.endsWith('.json')) {
          if (item.isDirectory() || item.isSymbolicLink()) throw new Error('ORIGINAL_MISSION_QUEUE_ENTRY_UNSAFE');
          continue;
        }
        let record;
        try { record = JSON.parse(await readFile(resolve(directory, item.name), 'utf8')); }
        catch { throw new Error('ORIGINAL_MISSION_QUEUE_ITEM_UNREADABLE'); }
        if (text(record?.missionId).toLowerCase() === missionId
          || text(record?.payload?.missionId).toLowerCase() === missionId
          || text(record?.executionBinding?.leaseKey) === leaseId
          || text(record?.actionGrant?.leaseKey) === leaseId) return true;
      }
    }
  }
  return false;
}

// Only publish field *names*, never original or expected field values. The
// mismatch set diagnoses the retained historical worker record and does not
// create proof that the original source writer is inactive.
function originalTerminalBindingMismatchCodes(item, filename, adapter, lease, missionId) {
  const binding = item?.executionBinding;
  return [
    [item?.schemaVersion === 'stephanos.mission-worker-queue-item.v1', 'ITEM_SCHEMA'],
    [text(item?.adapter) === adapter, 'ADAPTER'],
    [text(item?.actionId) === filename.slice(0, -5), 'ACTION_FILENAME'],
    [binding?.schemaVersion === 'stephanos.mission-worker-queue-execution-binding.v1', 'BINDING_SCHEMA'],
    [text(binding?.leaseKey) === text(lease.leaseId), 'LEASE_KEY'],
    [text(binding?.missionId).toLowerCase() === missionId, 'MISSION_ID'],
    [text(binding?.executionId) === text(item?.actionId), 'EXECUTION_ID'],
    [text(binding?.repository).toLowerCase() === text(lease.repository).toLowerCase(), 'REPOSITORY'],
    [Number(binding?.issueNumber) === Number(lease.issueNumber), 'ISSUE_NUMBER'],
    [Number(binding?.prNumber) === Number(lease.prNumber), 'PR_NUMBER'],
    [text(binding?.branch) === text(lease.branch), 'BRANCH'],
    [text(binding?.headSha).toLowerCase() === text(lease.headSha).toLowerCase(), 'HEAD_SHA'],
  ].filter(([matched]) => !matched).map(([, code]) => code);
}

// A terminal item from a strictly older, correctly bound revision is not
// evidence for (or against) the current rN source lease. Without this filter,
// retained rN-1 worker history can mask a genuine exact rN result pair. Only
// terminal folders are filtered; pending/processing inventory remains global.
function isOlderBoundOriginalTerminal(item, filename, adapter, lease, missionId) {
  const current = text(lease?.leaseId).match(/^(critical-[1-9]\d*-elastic-goal)-r([1-9]\d*)-lease$/);
  // Mission intake legitimately starts at r0. Keep canonical decimal syntax:
  // r0 is historical, while r00/negative/future revisions remain unproven.
  const prior = text(item?.executionBinding?.leaseKey).match(/^(critical-[1-9]\d*-elastic-goal)-r(0|[1-9]\d*)-lease$/);
  const binding = item?.executionBinding;
  return Boolean(current && prior
    && current[1] === missionId && prior[1] === missionId
    && Number(prior[2]) < Number(current[2])
    && item?.schemaVersion === 'stephanos.mission-worker-queue-item.v1'
    && text(item?.adapter) === adapter
    && text(item?.actionId) === filename.slice(0, -5)
    && binding?.schemaVersion === 'stephanos.mission-worker-queue-execution-binding.v1'
    && text(binding?.missionId).toLowerCase() === missionId
    && text(binding?.executionId) === text(item?.actionId)
    && text(binding?.repository).toLowerCase() === text(lease?.repository).toLowerCase()
    && Number(binding?.issueNumber) === Number(lease?.issueNumber));
}

// Read-only forensic triage of an ORIGINAL terminal worker result pair.
// The terminal queue pair can explain a lost execution receipt, but it is NOT
// itself a canonical execution receipt and NEVER authorizes lease release.
export async function inspectOriginalTerminalWorkerPairV1({ lease = {}, missionId = '', env = process.env } = {}) {
  const noAuthority = { readOnly: true, terminalExecutionReceiptProven: false,
    leaseReleaseAllowed: false, sourceMutationAllowed: false };
  const originalMissionId = text(missionId).toLowerCase();
  const leaseId = text(lease.leaseId);
  const root = resolveMissionWorkerQueueRoot(env);
  if (!root || !originalMissionId || !leaseId) {
    return freeze({ ...noAuthority, classification: 'ORIGINAL_TERMINAL_QUEUE_UNOBSERVABLE' });
  }
  try { await access(root); } catch {
    return freeze({ ...noAuthority, classification: 'ORIGINAL_TERMINAL_QUEUE_UNOBSERVABLE' });
  }
  let exactPairs = 0;
  let boundWithoutResult = 0;
  let unboundOriginalItems = 0;
  let olderBoundTerminalItems = 0;
  const bindingMismatchCodes = new Set();
  try {
    for (const adapter of ORIGINAL_SOURCE_QUEUE_ADAPTERS) {
      for (const stage of ['completed', 'failed']) {
        const directory = resolve(root, adapter, stage);
        let entries;
        try { entries = await readdir(directory, { withFileTypes: true }); }
        catch (error) {
          if (error?.code === 'ENOENT') continue;
          throw error;
        }
        if (entries.length > 512) throw Error('ORIGINAL_TERMINAL_QUEUE_UNBOUNDED');
        for (const entry of entries) {
          if (entry.isDirectory() || entry.isSymbolicLink()) throw Error('ORIGINAL_TERMINAL_QUEUE_UNSAFE_ENTRY');
          if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.endsWith('.result.json')) continue;
          if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}\.json$/.test(entry.name)) {
            throw Error('ORIGINAL_TERMINAL_QUEUE_UNSAFE_NAME');
          }
          const itemPath = resolve(directory, entry.name);
          if ((await stat(itemPath)).size > 262144) throw Error('ORIGINAL_TERMINAL_QUEUE_ITEM_OVERSIZED');
          const item = JSON.parse(await readFile(itemPath, 'utf8'));
          if (text(item?.missionId).toLowerCase() !== originalMissionId) continue;
          if (isOlderBoundOriginalTerminal(item, entry.name, adapter, lease, originalMissionId)) {
            olderBoundTerminalItems += 1;
            continue;
          }
          const mismatchCodes = originalTerminalBindingMismatchCodes(
            item, entry.name, adapter, lease, originalMissionId,
          );
          if (mismatchCodes.length > 0) {
            unboundOriginalItems += 1;
            for (const code of mismatchCodes) bindingMismatchCodes.add(code);
            continue;
          }
          const resultPath = resolve(directory, entry.name.slice(0, -5) + '.result.json');
          let result;
          try {
            if ((await stat(resultPath)).size > 262144) throw Error('ORIGINAL_TERMINAL_QUEUE_RESULT_OVERSIZED');
            result = JSON.parse(await readFile(resultPath, 'utf8'));
          } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
            boundWithoutResult += 1;
            continue;
          }
          const expected = stage === 'completed' ? 'MISSION_WORKER_ITEM_COMPLETE' : 'MISSION_WORKER_ITEM_BLOCKED';
          if (result?.schemaVersion === 'stephanos.mission-worker-consumption-result.v1'
            && text(result.missionId).toLowerCase() === originalMissionId
            && text(result.actionId) === text(item.actionId)
            && text(result.adapter) === adapter
            && text(result.finalVerdict) === expected) exactPairs += 1;
          else boundWithoutResult += 1;
        }
      }
    }
  } catch {
    return freeze({ ...noAuthority, classification: 'ORIGINAL_TERMINAL_QUEUE_UNOBSERVABLE' });
  }
  // Distinguish the exact missing proof instead of sending the original owner
  // through another opaque repair retry. Mixed/duplicate estates still HOLD.
  const classification = exactPairs > 1
    ? 'ORIGINAL_MULTIPLE_BOUND_TERMINAL_PAIRS'
    : unboundOriginalItems > 0
      ? 'ORIGINAL_TERMINAL_QUEUE_SOURCE_BINDING_UNPROVEN'
      : boundWithoutResult > 0
        ? 'ORIGINAL_BOUND_TERMINAL_RESULT_MISSING_OR_INVALID'
        : exactPairs === 1
          ? 'ORIGINAL_EXACT_TERMINAL_PAIR_PRESENT'
          : 'ORIGINAL_EXACT_TERMINAL_PAIR_NOT_FOUND';
  return freeze({ ...noAuthority, classification,
    exactPairCount: exactPairs,
    incompleteOrUnboundCount: boundWithoutResult + unboundOriginalItems,
    olderBoundTerminalItems,
    // Small, strictly enum-bound forensic report. Never return queue contents,
    // action IDs, paths, observed hashes, file values or release authority.
    bindingMismatchCodes: [...bindingMismatchCodes].sort().slice(0, 12) });
}

function exactOriginalCancellation(lease, mission) {
  const match = text(lease?.leaseId).match(/-r([1-9]\d*)-lease$/);
  const revision = Number(match?.[1]);
  const eventId = text(mission?.storeMetadata?.lastEventId);
  return Boolean(match
    && Number.isSafeInteger(revision)
    && mission?.revision === revision + 1
    && mission?.currentPhase === 'CANCELLED'
    && mission?.cancelled === true
    && ['complete', 'idle'].includes(text(mission?.dispatch?.status).toLowerCase())
    && /^cancel-[a-z0-9._-]{8,127}$/.test(eventId)
    && mission?.storeMetadata?.processedEventIds?.includes(eventId) === true);
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


// Completed read-only custody is distinct from a source writer and from an
// expired, unexplained execution. Preserve the queued chain; never manufacture
// historical accepted/completed execution receipts from a later observation.
async function readCompletedInspectionPair(actionId, env) {
  const root = resolveMissionWorkerQueueRoot(env);
  if (!root || !/^[a-z0-9._-]+$/.test(actionId)) throw new Error('REVIEW_QUEUE_ROOT_UNPROVEN');
  const directory = resolve(root, 'openclaw-github-readonly', 'completed');
  for (const path of [root, resolve(root, 'openclaw-github-readonly'), directory]) {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('REVIEW_QUEUE_PATH_UNSAFE');
  }
  const read = async suffix => {
    const path = resolve(directory, actionId + suffix);
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 1048576)
      throw new Error('REVIEW_QUEUE_RECORD_UNSAFE');
    const bytes = await readFile(path);
    const after = await lstat(path);
    if (before.ino !== after.ino || before.dev !== after.dev || before.size !== bytes.length
        || before.mtimeMs !== after.mtimeMs) throw new Error('REVIEW_QUEUE_RECORD_CHANGED');
    return JSON.parse(bytes);
  };
  return { item: await read('.json'), result: await read('.result.json') };
}

export async function reconcileCompletedElasticInspectionLeaseV1({
  nowUtc, env, paths, sourceRevision, mission, leaseRead,
  readLease = readSourceMutationLease, releaseLease = releaseSourceMutationLease,
  readHistory = readExecutionReceiptHistory, noWork = originalMissionHasQueuedWork,
  readPair = readCompletedInspectionPair, readMission = readMissionRecord,
  withMission = runWithMissionStatePrecondition,
  readSourceExecutionId = readOriginalSourceExecutionIdV1,
} = {}) {
  const hold = blocker => freeze({ ok: false, released: false,
    classification: 'ELASTIC_COMPLETED_INSPECTION_LEASE_HELD', blocker,
    sourceMutationAllowed: false, leaseSeizureAllowed: false, mergeAuthority: false });
  const lease = leaseRead?.record;
  const identity = exactElasticPrHeadIdentity(mission);
  const match = /^(critical-[1-9]\d*-elastic-goal)-r([1-9]\d*)-lease$/.exec(text(lease?.leaseId));
  const revision = Number(match?.[2]);
  if (!leaseRead?.present || leaseRead.validation?.valid !== true || !match
      || !identity || !sameLeaseIdentity(lease, identity) || match[1] !== identity.missionId
      || mission.revision !== revision + 1
      || !['CHECK_PULL_REQUEST', 'REPAIR_REQUIRED', 'AWAITING_OPERATOR_APPROVAL'].includes(phaseOf(mission))
      || mission.cancelled === true || mission.storeMetadata?.originalSourceAttemptFence
      || mission.storeMetadata?.supervisedRecoveryMaintenance
      || (mission.continuity?.parkingStatus && mission.continuity.parkingStatus !== 'ACTIVE')
      || !['complete', 'idle'].includes(text(mission.dispatch?.status).toLowerCase())
      || !SHA_40.test(text(sourceRevision)) || !Number.isFinite(Date.parse(nowUtc)))
    return hold('COMPLETED_INSPECTION_EXACT_SUCCESSOR_REQUIRED');
  const prior = { ...mission, revision, currentPhase: 'CHECK_PULL_REQUEST' };
  const action = buildMissionWorkerAction(prior);
  if (action?.executable !== true || action.actionKind !== 'github-inspection'
      || action.adapter !== 'openclaw-github-readonly' || action.operation !== 'check-pr'
      || action.activeWriter !== 'none') return hold('COMPLETED_INSPECTION_READONLY_ACTION_REQUIRED');
  const eventId = 'worker-' + action.actionId;
  if (mission.storeMetadata?.lastEventId !== eventId
      || !mission.storeMetadata?.processedEventIds?.includes(eventId))
    return hold('COMPLETED_INSPECTION_CONSUMED_EVENT_REQUIRED');
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const originalLeaseDigest = digest(lease);
  try {
    const guarded = await withMission(identity.missionId, {
      expectedRevision: mission.revision, expectedCurrentPhase: mission.currentPhase,
    }, async current => {
      if (digest(current) !== digest(mission)) return hold('COMPLETED_INSPECTION_MISSION_CHANGED');
      const record = await readMission(identity.missionId, { root: paths.orchestratorRoot, env });
      if ((await stat(record.eventPath)).size > 2097152) return hold('COMPLETED_INSPECTION_JOURNAL_UNBOUNDED');
      const lines = (await readFile(record.eventPath, 'utf8')).trim().split('\n');
      if (lines.length > 2048) return hold('COMPLETED_INSPECTION_JOURNAL_UNBOUNDED');
      const events = lines.map(line => JSON.parse(line));
      const matches = events.filter(event => event.eventId === eventId);
      if (matches.length !== 1 || events.at(-1)?.eventId !== eventId)
        return hold('COMPLETED_INSPECTION_JOURNAL_BINDING_UNPROVEN');
      const event = matches[0];
      const { item, result } = await readPair(action.actionId, env);
      const grant = item?.actionGrant, binding = item?.executionBinding;
      const exact = value => value?.missionId === identity.missionId
        && value.repository?.toLowerCase() === identity.repository.toLowerCase()
        && value.issueNumber === identity.issueNumber && value.prNumber === identity.prNumber
        && value.branch === identity.branch && value.headSha === identity.headSha;
      if (item?.schemaVersion !== 'stephanos.mission-worker-queue-item.v1'
          || item.adapter !== action.adapter || item.actionId !== action.actionId || item.missionId !== identity.missionId
          || item.payload?.actionKind !== 'github-inspection' || item.payload?.operation !== 'check-pr'
          || item.payload?.activeWriter !== 'none' || item.payload?.actionId !== action.actionId
          || item.payload?.missionId !== identity.missionId || item.payload?.repository !== identity.repository
          || item.payload?.prNumber !== identity.prNumber || item.payload?.expectedHeadSha !== identity.headSha
          || grant?.schemaVersion !== 'stephanos.mission-worker-action-grant.v1'
          || grant.controllerId !== 'durable-flywheel-controller' || !exact(grant)
          || grant.grantId !== 'grant-' + action.actionId || grant.laneId !== identity.missionId || grant.missionRevision !== revision
          || grant.currentPhase !== 'CHECK_PULL_REQUEST' || grant.actionId !== action.actionId
          || grant.actionKind !== 'github-inspection' || grant.adapter !== action.adapter
          || grant.operation !== 'check-pr' || grant.boundedActionCount !== 1
          || grant.mergeAuthority !== false || grant.leaseSeizureAllowed !== false
          || !SHA_40.test(text(grant.sourceRevision))
          || binding?.schemaVersion !== 'stephanos.mission-worker-queue-execution-binding.v1'
          || !exact(binding) || binding.executionId !== action.actionId || binding.leaseKey !== lease.leaseId
          || binding.missionRevision !== revision || binding.grantId !== grant.grantId
          || binding.sourceRevision !== grant.sourceRevision)
        return hold('COMPLETED_INSPECTION_QUEUE_BINDING_UNPROVEN');
      if (result?.schemaVersion !== 'stephanos.mission-worker-consumption-result.v1'
          || result.actionId !== action.actionId || result.missionId !== identity.missionId
          || result.operation !== 'check-pr' || result.eventId !== eventId
          || result.stateRevision !== mission.revision || result.currentPhase !== mission.currentPhase
          || result.finalVerdict !== 'MISSION_WORKER_ITEM_COMPLETE' || result.execution?.success !== true
          || event.eventType !== 'PULL_REQUEST_CHECKS_UPDATED' || event.missionId !== identity.missionId
          || event.prNumber !== identity.prNumber || event.headSha !== identity.headSha
          || event.receipt?.verified !== true || event.receipt?.source !== action.adapter
          || event.receipt?.evidenceType !== 'github-inspection'
          || !/^[a-f0-9]{64}$/.test(text(event.receipt?.commandOutputHash))
          || event.receipt.commandOutputHash !== result.execution.commandOutputHash
          || event.receipt.createdAt !== result.execution.completedAt
          || !Number.isFinite(Date.parse(result.execution.completedAt))
          || Date.parse(result.execution.completedAt) > Date.parse(nowUtc)
          || result.inspection?.headSha !== identity.headSha || result.inspection?.prNumber !== identity.prNumber
          || digest(result.inspection?.checks) !== digest(event.checks)
          || event.prState !== result.inspection?.prState || event.mergeable !== result.inspection?.mergeable)
        return hold('COMPLETED_INSPECTION_RESULT_EVENT_UNPROVEN');
      const history = await readHistory(paths.workspaceRoot, {
        leaseKey: lease.leaseId, expectedHead: lease.headSha,
      }, { repoRoot: paths.repoRoot });
      // A stale queue publisher may have recorded queued -> failed while the
      // exact read-only result was subsequently consumed by the old contextless
      // consumer. Preserve that failure, require its narrow publication shape,
      // and use the independently retained result/event to reconcile custody.
      const failedPublicationOnly = history?.receipts?.length === 2
        && history.receipts[0].state === 'queued' && history.receipts[0].sequence === 1
        && history.latestReceipt?.state === 'failed' && history.latestReceipt.sequence === 2
        && history.latestReceipt.predecessorReceiptId === history.receipts[0].receiptId
        && history.latestReceipt.phase === 'pr-head-queue-publication-failed'
        && history.latestReceipt.blocker === 'action-grant-mismatch'
        && Date.parse(result.execution.completedAt) >= Date.parse(history.latestReceipt.timestampUtc);
      if (history?.ok !== true || !history.receipts?.length || !history.latestReceipt
          || (!['queued', 'completed'].includes(history.latestReceipt.state) && !failedPublicationOnly)
          || history.receipts.some(receipt => receipt.executionId !== action.actionId
            || receipt.leaseKey !== lease.leaseId || receipt.sourceHead !== lease.headSha
            || receipt.repository?.toLowerCase() !== identity.repository.toLowerCase()
            || receipt.issueNumber !== identity.issueNumber || receipt.prNumber !== identity.prNumber
            || receipt.branch !== identity.branch))
        return hold('COMPLETED_INSPECTION_EXCLUSIVE_READONLY_CHAIN_UNPROVEN');
      const sourceId = await readSourceExecutionId(current, paths, env);
      const sourceMatch = text(sourceId).match(new RegExp('^' + identity.missionId + '-r([1-9]\\d*)-[a-f0-9]{12}$'));
      if (!sourceMatch || Number(sourceMatch[1]) >= revision) return hold('COMPLETED_INSPECTION_PRIOR_SOURCE_UNPROVEN');
      const sourceHistory = await readHistory(paths.workspaceRoot, { executionId: sourceId }, { repoRoot: paths.repoRoot });
      const terminal = sourceHistory?.latestReceipt;
      if (sourceHistory?.ok !== true || !sourceHistory.receipts?.length || terminal?.state !== 'completed'
          || terminal.executionId !== sourceId || terminal.leaseKey !== identity.missionId + '-r' + sourceMatch[1] + '-lease'
          || terminal.repository?.toLowerCase() !== identity.repository.toLowerCase()
          || terminal.issueNumber !== identity.issueNumber || terminal.branch !== identity.branch)
        return hold('COMPLETED_INSPECTION_PRIOR_SOURCE_TERMINAL_UNPROVEN');
      if (await noWork({ missionId: identity.missionId, leaseId: lease.leaseId, env }) !== false)
        return hold('COMPLETED_INSPECTION_ORIGINAL_WORK_IN_FLIGHT');
      const again = await readLease({ root: paths.workspaceRoot, repoRoot: paths.repoRoot, nowUtc });
      if (again.validation?.valid !== true || digest(again.record) !== originalLeaseDigest)
        return hold('COMPLETED_INSPECTION_LEASE_CHANGED');
      const release = await releaseLease({ ...lease, nowUtc, originalLeaseDigest }, {
        root: paths.workspaceRoot, repoRoot: paths.repoRoot, env,
      });
      if (release?.ok !== true || release.released !== true) return hold('COMPLETED_INSPECTION_EXACT_CAS_RELEASE_UNPROVEN');
      return freeze({ ok: true, released: true, classification: 'ELASTIC_CONSUMED_READONLY_INSPECTION_LEASE_RELEASED',
        originalMissionId: identity.missionId, originalLeaseId: lease.leaseId,
        consumedEventId: eventId, completedResultDigest: digest(result), originalLeaseDigest,
        historicalReceiptChainPreserved: true, terminalExecutionReceiptReconstructed: false,
        sourceMutationAllowed: false, leaseSeizureAllowed: false, mergeAuthority: false, goalComplete: false });
    }, { root: paths.orchestratorRoot, env });
    return guarded?.preconditionFailed === false ? guarded.result : hold('COMPLETED_INSPECTION_MISSION_PRECONDITION_CHANGED');
  } catch { return hold('COMPLETED_INSPECTION_PROOF_UNOBSERVABLE'); }
}

// Recover only the *expired* exact lease owned by the old read-only PR review.
// Programme Authority may be held by this stale record before normal elastic
// admission and this dispatcher can run. Reuse the existing canonical source
// lease release guard: no deletion, overwrite, lease seizure or new worker.
export async function reconcileExpiredElasticReviewLeaseV1({
  now = new Date(),
  env = process.env,
  paths = {},
  sourceRevision = '',
  missionRecords = [],
  readLease = readSourceMutationLease,
  releaseLease = releaseSourceMutationLease,
  readReceiptHistoryFn = readExecutionReceiptHistory,
  isActionInFlightFn = defaultActionInFlight,
  originalMissionInFlightFn = originalMissionHasQueuedWork,
} = {}) {
  const held = (reason) => freeze({
    ok: false, released: false,
    classification: 'ELASTIC_EXPIRED_REVIEW_LEASE_RECONCILIATION_HELD',
    blocker: reason, sourceMutationAllowed: false,
    leaseSeizureAllowed: false, mergeAuthority: false,
    dispatchAuthority: false, materialPickupProven: false,
  });
  const nowUtc = now instanceof Date && Number.isFinite(now.getTime()) ? now.toISOString() : '';
  if (!nowUtc || !SHA_40.test(text(sourceRevision)) || !paths.workspaceRoot || !paths.repoRoot) {
    return held('CANONICAL_SOURCE_AND_WORKSPACE_REQUIRED');
  }
  const leaseRead = await readLease({
    root: paths.workspaceRoot, repoRoot: paths.repoRoot, nowUtc,
  });
  const completedMission = missionRecords.filter(m => m.missionId === leaseRead?.record?.laneId);
  if (leaseRead?.present && leaseRead.validation?.valid === true && completedMission.length === 1
      && completedMission[0].revision === Number(text(leaseRead.record.leaseId).match(/-r([1-9]\d*)-lease$/)?.[1]) + 1
      && ['CHECK_PULL_REQUEST', 'REPAIR_REQUIRED', 'AWAITING_OPERATOR_APPROVAL'].includes(phaseOf(completedMission[0]))
      && !completedMission[0].storeMetadata?.originalSourceAttemptFence
      && completedMission[0].storeMetadata?.lastEventId === 'worker-' + buildMissionWorkerAction({
        ...completedMission[0], revision: completedMission[0].revision - 1, currentPhase: 'CHECK_PULL_REQUEST',
      })?.actionId) {
    return reconcileCompletedElasticInspectionLeaseV1({ nowUtc, env, paths, sourceRevision,
      mission: completedMission[0], leaseRead, readLease, releaseLease, readHistory: readReceiptHistoryFn,
      noWork: originalMissionInFlightFn });
  }
  const supervisedReleaseResume = leaseRead?.reason === 'SOURCE_MUTATION_LEASE_RELEASE_MARKER_PRESENT'
    && missionRecords.some(m => m.missionId === leaseRead.record?.laneId
      && m.storeMetadata?.originalSourceAttemptFence?.schemaVersion === 'stephanos.supervised-r7-retirement-fence.v1');
  if (!leaseRead?.present || (leaseRead?.reason === 'SOURCE_MUTATION_LEASE_RELEASE_MARKER_PRESENT' && !supervisedReleaseResume)) {
    return held('EXACT_STALE_SOURCE_LEASE_NOT_PRESENT');
  }
  if ((!supervisedReleaseResume && (leaseRead.ok !== true
      || leaseRead.validation?.valid !== true
      || leaseRead.validation?.active !== false
      || leaseRead.validation?.stale !== true
      || leaseRead.validation?.finalVerdict !== 'SOURCE_MUTATION_LEASE_STALE'))
      || leaseRead.validation?.valid !== true) {
    return held('CANONICAL_LEASE_EXPIRED_STATE_NOT_PROVEN');
  }
  const lease = leaseRead.record;
  if (text(lease?.ownerId) !== 'mission-worker') return held('ORIGINAL_MISSION_WORKER_OWNER_REQUIRED');
  const candidates = (Array.isArray(missionRecords) ? missionRecords : [])
    .filter((mission) => exactElasticPrHeadIdentity(mission)?.missionId === text(lease?.laneId).toLowerCase());
  if (candidates.length !== 1) return held('EXACT_ORIGINAL_MISSION_UNAVAILABLE_OR_AMBIGUOUS');
  const mission = candidates[0];
  const identity = exactElasticPrHeadIdentity(mission);
  const originalCancelled = phaseOf(mission) === 'CANCELLED';
  if (!identity || !sameLeaseIdentity(lease, identity)
      || (originalCancelled
        ? !exactOriginalCancellation(lease, mission)
        : text(lease.leaseId) !== leaseIdForMission(mission, identity))) {
    return held('REVIEW_LEASE_MISSION_REVISION_OR_HEAD_MISMATCH');
  }
  // Durable operator cancellation retires a superseded SOURCE ATTEMPT only.
  // It cannot prove the issue accepted, deploy anything or create a new writer.
  // The original lease's rN revision remains bound to the rN+1 cancellation
  // event; no unrelated mission, head, branch, PR or receipt may authorize it.
  if (originalCancelled) {
    if (mission.storeMetadata?.originalSourceAttemptFence) {
      try {
        const guarded = await runWithMissionStatePrecondition(identity.missionId, {
          expectedRevision: mission.revision, expectedCurrentPhase: 'CANCELLED',
        }, async (current) => {
          if (await verifyOriginalSourceAttemptFence(current, lease, paths, env) !== true) {
            return { ok: false, released: false, reason: 'ORIGINAL_SOURCE_FENCE_PROOF_UNVERIFIED' };
          }
          return releaseLease({ ...lease, nowUtc,
            originalLeaseDigest: current.storeMetadata.originalSourceAttemptFence.originalLeaseDigest,
          }, { root: paths.workspaceRoot, repoRoot: paths.repoRoot, env });
        }, { root: paths.orchestratorRoot, env });
        if (guarded.preconditionFailed || guarded.result?.ok !== true
            || guarded.result?.released !== true) return held('ORIGINAL_QUARANTINED_EXACT_RELEASE_UNPROVEN');
        return freeze({ ok: true, released: true,
          classification: 'ELASTIC_QUARANTINED_ORIGINAL_EXACT_LEASE_RELEASED',
          originalMissionId: identity.missionId, originalLeaseId: lease.leaseId,
          sourceMutationAllowed: false, leaseSeizureAllowed: false, mergeAuthority: false,
          goalComplete: false, materialPickupProven: false,
        });
      } catch { return held('ORIGINAL_QUARANTINED_FENCE_OR_RELEASE_UNOBSERVABLE'); }
    }
    // Queue emptiness and terminal receipts do not exclude detached source writers.
    // No legacy fallback release is permitted without the authenticated fence.
    return held('CANCELLED_ORIGINAL_SOURCE_FENCE_REQUIRED');
  }
  // A completed original source execution may have already reached
  // REPAIR_REQUIRED because the *existing* PR's required checks failed.
  // This is not a review-phase lease and must never be promoted to one.
  // Retire only this exact expired execution lease, after its original
  // terminal execution history and every possible worker queue are proven
  // idle. The repair mission and PR remain open; this grants no new writer.
  if (phaseOf(mission) === 'REPAIR_REQUIRED') {
    if (text(mission?.dispatch?.status).toLowerCase() !== 'complete') {
      return held('REPAIR_ORIGINAL_DISPATCH_NOT_TERMINAL');
    }
    if (mission?.continuity?.parkingStatus
        && text(mission.continuity.parkingStatus).toUpperCase() !== 'ACTIVE') {
      return held('REPAIR_ORIGINAL_CONTINUITY_NOT_ACTIVE');
    }
    const failedRequiredCheck = Array.isArray(mission?.pullRequest?.checks)
      && mission.pullRequest.checks.some((check) => check?.required !== false
        && ['failure', 'failed', 'cancelled', 'timed_out', 'action_required']
          .includes(text(check?.status).toLowerCase()));
    if (!failedRequiredCheck) return held('REPAIR_REQUIRED_CHECK_FAILURE_NOT_PROVEN');
    if (!resolveMissionWorkerQueueRoot(env)) return held('CANONICAL_WORKER_QUEUE_UNAVAILABLE');
    let history;
    let inFlight;
    try {
      history = await readReceiptHistoryFn(paths.workspaceRoot, {
        leaseKey: lease.leaseId, expectedHead: lease.headSha,
      }, { repoRoot: paths.repoRoot });
      // A generic receipt refusal obscures whether the original worker never
      // published terminal evidence, is still active, or has mismatched binding.
      // Keep all three fail-closed, but return distinct diagnosis to the
      // existing Supervisor so it can repair the correct original-owner step.
      if (history?.ok !== true || !Array.isArray(history?.receipts)) {
        return held('REPAIR_ORIGINAL_EXECUTION_HISTORY_UNVERIFIED');
      }
      if (history.receipts.length === 0 || !history.latestReceipt) {
        // Inspect real immutable terminal queue evidence rather than looping on
        // an opaque missing receipt. Even an exact result is NOT a release grant.
        const triage = await inspectOriginalTerminalWorkerPairV1({ lease, missionId: identity.missionId, env });
        const reasonByEvidence = {
          ORIGINAL_EXACT_TERMINAL_PAIR_PRESENT: 'REPAIR_ORIGINAL_TERMINAL_PAIR_PRESENT_RECEIPT_MISSING',
          ORIGINAL_MULTIPLE_BOUND_TERMINAL_PAIRS: 'REPAIR_ORIGINAL_TERMINAL_QUEUE_DUPLICATE_PAIRS',
          ORIGINAL_TERMINAL_QUEUE_SOURCE_BINDING_UNPROVEN: 'REPAIR_ORIGINAL_TERMINAL_SOURCE_BINDING_UNPROVEN',
          ORIGINAL_BOUND_TERMINAL_RESULT_MISSING_OR_INVALID: 'REPAIR_ORIGINAL_BOUND_RESULT_MISSING_OR_INVALID',
        };
        // One exact malformed field is actionable for the existing original
        // owner. More than one mismatch remains a generic HOLD, never a lease
        // release or evidence-rewriting permission.
        const fieldReasons = {
          ITEM_SCHEMA: 'REPAIR_ORIGINAL_QUEUE_ITEM_SCHEMA_MISMATCH',
          ADAPTER: 'REPAIR_ORIGINAL_QUEUE_ADAPTER_MISMATCH',
          ACTION_FILENAME: 'REPAIR_ORIGINAL_QUEUE_ACTION_FILENAME_MISMATCH',
          BINDING_SCHEMA: 'REPAIR_ORIGINAL_BINDING_SCHEMA_MISMATCH',
          LEASE_KEY: 'REPAIR_ORIGINAL_BINDING_LEASE_KEY_MISMATCH',
          MISSION_ID: 'REPAIR_ORIGINAL_BINDING_MISSION_ID_MISMATCH',
          EXECUTION_ID: 'REPAIR_ORIGINAL_BINDING_EXECUTION_ID_MISMATCH',
          REPOSITORY: 'REPAIR_ORIGINAL_BINDING_REPOSITORY_MISMATCH',
          ISSUE_NUMBER: 'REPAIR_ORIGINAL_BINDING_ISSUE_NUMBER_MISMATCH',
          PR_NUMBER: 'REPAIR_ORIGINAL_BINDING_PR_NUMBER_MISMATCH',
          BRANCH: 'REPAIR_ORIGINAL_BINDING_BRANCH_MISMATCH',
          HEAD_SHA: 'REPAIR_ORIGINAL_BINDING_HEAD_SHA_MISMATCH',
        };
        const mismatches = triage.bindingMismatchCodes || [];
        return held(triage.classification === 'ORIGINAL_TERMINAL_QUEUE_SOURCE_BINDING_UNPROVEN'
          && mismatches.length === 1
          ? (fieldReasons[mismatches[0]] || 'REPAIR_ORIGINAL_TERMINAL_SOURCE_BINDING_UNPROVEN')
          : reasonByEvidence[triage.classification]
            || 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING');
      }
      if (!TERMINAL_EXECUTION_RECEIPT_STATES.has(
        text(history.latestReceipt.state).toLowerCase())) {
        return held('REPAIR_ORIGINAL_EXECUTION_RECEIPT_NONTERMINAL');
      }
      if (text(history.latestReceipt.leaseKey) !== text(lease.leaseId)
          || text(history.latestReceipt.sourceHead).toLowerCase() !== text(lease.headSha).toLowerCase()
          || text(history.latestReceipt.branch) !== text(lease.branch)
          || text(history.latestReceipt.repository).toLowerCase() !== text(lease.repository).toLowerCase()
          || Number(history.latestReceipt.issueNumber) !== Number(lease.issueNumber)
          || Number(history.latestReceipt.prNumber) !== Number(lease.prNumber)) {
        return held('REPAIR_ORIGINAL_EXECUTION_RECEIPT_IDENTITY_MISMATCH');
      }
      inFlight = await originalMissionInFlightFn({
        missionId: identity.missionId, leaseId: lease.leaseId, env,
      });
    } catch {
      return held('REPAIR_ORIGINAL_WORKER_QUEUE_UNOBSERVABLE');
    }
    if (inFlight !== false) return held('REPAIR_ORIGINAL_WORK_STILL_IN_FLIGHT');
    const released = await releaseLease({
      leaseId: lease.leaseId, laneId: lease.laneId, repository: lease.repository,
      issueNumber: lease.issueNumber, prNumber: lease.prNumber,
      branch: lease.branch, headSha: lease.headSha, ownerId: lease.ownerId, nowUtc,
    }, { root: paths.workspaceRoot, repoRoot: paths.repoRoot, env });
    if (released?.ok !== true || released.released !== true) {
      return held('REPAIR_ORIGINAL_EXACT_LEASE_RELEASE_UNPROVEN');
    }
    return freeze({
      ok: true, released: true,
      classification: 'ELASTIC_COMPLETED_FAILED_CHECKS_EXACT_LEASE_RELEASED',
      originalMissionId: identity.missionId, originalLeaseId: lease.leaseId,
      originalPhase: 'REPAIR_REQUIRED', repairStillRequired: true,
      sourceHead: sourceRevision.toLowerCase(),
      nextAction: 'REREAD_CANONICAL_PROGRAMME_AND_SCHEDULE_REPAIR',
      goalComplete: false, replacementAcceptanceProven: false,
      leaseSeizureAllowed: false, sourceMutationAllowed: false,
      mergeAuthority: false, dispatchAuthority: false, materialPickupProven: false,
    });
  }
  if (phaseOf(mission) !== 'CHECK_PULL_REQUEST') {
    return held('EXACT_READ_ONLY_REVIEW_PHASE_NOT_PROVEN');
  }
  // The real mission orchestrator sets dispatch.status='complete' after
  // successful implementation and *then* transitions to CHECK_PULL_REQUEST.
  // 'idle' is also admitted for an undispatched exact review action. Neither
  // state alone authorizes release: queue absence and canonical execution
  // receipt proof below are still mandatory. 'running', 'pending', 'failed',
  // and unknown states must never be mistaken for a completed source writer.
  if (!['idle', 'complete'].includes(text(mission?.dispatch?.status).toLowerCase())) {
    return held('REVIEW_DISPATCH_NOT_SAFELY_TERMINAL');
  }
  const grant = exactPrHeadWorkerGrant(
    mission, identity, text(sourceRevision).toLowerCase(), null, now,
  );
  if (!grant || grant.actionKind !== 'github-inspection'
      || grant.adapter !== 'openclaw-github-readonly'
      || grant.leaseSeizureAllowed !== false
      || grant.mergeAuthority !== false) {
    return held('EXACT_REVIEW_ONLY_GRANT_NOT_PROVEN');
  }
  if (!resolveMissionWorkerQueueRoot(env)) return held('CANONICAL_WORKER_QUEUE_UNAVAILABLE');
  let receiptHistory;
  let inFlight;
  try {
    receiptHistory = await readReceiptHistoryFn(paths.workspaceRoot, {
      executionId: grant.actionId,
      leaseKey: lease.leaseId,
      expectedHead: grant.headSha,
    }, { repoRoot: paths.repoRoot });
    if (receiptHistory?.ok !== true) return held('REVIEW_EXECUTION_RECEIPT_HISTORY_UNPROVEN');
    inFlight = await isActionInFlightFn({
      adapter: grant.adapter, actionId: grant.actionId, env,
    });
  } catch {
    return held('REVIEW_WORKER_IN_FLIGHT_OBSERVATION_FAILED');
  }
  if (inFlight !== false) return held('EXACT_REVIEW_ACTION_STILL_IN_FLIGHT');
  if (receiptHistory.latestReceipt
    && !TERMINAL_EXECUTION_RECEIPT_STATES.has(
      text(receiptHistory.latestReceipt.state).toLowerCase(),
    )) {
    return held('NONTERMINAL_REVIEW_EXECUTION_RECEIPT');
  }
  const release = await releaseLease({
    leaseId: lease.leaseId, laneId: lease.laneId,
    repository: lease.repository, issueNumber: lease.issueNumber,
    prNumber: lease.prNumber, branch: lease.branch,
    headSha: lease.headSha, ownerId: lease.ownerId, nowUtc,
  }, { root: paths.workspaceRoot, repoRoot: paths.repoRoot, env });
  if (release?.ok !== true || release.released !== true) {
    return held('EXACT_SOURCE_LEASE_RELEASE_NOT_PROVEN');
  }
  return freeze({
    ok: true, released: true,
    classification: 'ELASTIC_EXPIRED_REVIEW_LEASE_SAFELY_RELEASED',
    originalMissionId: identity.missionId,
    sourceHead: sourceRevision.toLowerCase(),
    originalLeaseId: lease.leaseId,
    nextAction: 'REREAD_CANONICAL_PROGRAMME_AND_ADMIT_EXISTING_GOAL',
    leaseSeizureAllowed: false, sourceMutationAllowed: false,
    mergeAuthority: false, dispatchAuthority: false,
    materialPickupProven: false,
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
  let capacityRouting = normalized.capacityRouting ?? null;

  let leaseRead = await readLease({
    root: paths.workspaceRoot,
    repoRoot: paths.repoRoot,
    nowUtc,
  });
  let releasedLease = null;
  let currentLease = leaseRead?.present ? leaseRead.record : null;
  let pendingLeaseClaim = null;
  let leasedEntry = currentLease
    ? exactMissions.find(({ identity }) => sameLeaseIdentity(currentLease, identity)) ?? null
    : null;

  if (
    currentLease
    && leasedEntry
    && PARKED_OR_TERMINAL_PHASES.has(phaseOf(leasedEntry.mission))
  ) {
    // Parking/STOP changes scheduling intent, not original-writer liveness.
    // All parked phases must retain the original lease until authentic exact
    // terminal history and every original queue are proven safe. Serialize
    // with mission dispatch/re-entry so a stale parked snapshot cannot release
    // a lease after another cycle has resumed that mission.
    const guarded = normalized.runWithMissionStatePrecondition ?? runWithMissionStatePrecondition;
    try {
      const outcome = await guarded(leasedEntry.identity.missionId, {
        expectedRevision: leasedEntry.mission.revision,
        expectedCurrentPhase: phaseOf(leasedEntry.mission),
      }, async (current) => {
        const hold = (reason) => ({ ok: false, released: false, reason });
        if (text(current?.dispatch?.status).toLowerCase() === 'running') {
          return hold('PARKED_ORIGINAL_DISPATCH_STILL_RUNNING');
        }
        const history = await readReceiptHistory(paths.workspaceRoot, {
          leaseKey: currentLease.leaseId, expectedHead: currentLease.headSha,
        }, receiptOptions);
        if (history?.ok !== true || !Array.isArray(history.receipts) || !history.receipts.length) {
          return hold('PARKED_ORIGINAL_TERMINAL_EXECUTION_UNPROVEN');
        }
        // Receipt publication for one action must never conceal a different
        // unfinished execution using the same lease. The authenticated reader
        // verifies each chain; require the last member of EVERY chain terminal.
        const chains = new Map();
        for (const receipt of history.receipts) {
          if (!text(receipt.executionId)
              || text(receipt.leaseKey) !== currentLease.leaseId
              || text(receipt.sourceHead).toLowerCase() !== currentLease.headSha.toLowerCase()
              || text(receipt.repository).toLowerCase() !== currentLease.repository.toLowerCase()
              || text(receipt.branch) !== currentLease.branch
              || Number(receipt.issueNumber) !== currentLease.issueNumber
              || Number(receipt.prNumber) !== currentLease.prNumber) {
            return hold('PARKED_ORIGINAL_TERMINAL_IDENTITY_MISMATCH');
          }
          chains.set(receipt.executionId, receipt);
        }
        if ([...chains.values()].some((receipt) =>
          !TERMINAL_EXECUTION_RECEIPT_STATES.has(text(receipt.state).toLowerCase()))) {
          return hold('PARKED_ORIGINAL_TERMINAL_EXECUTION_UNPROVEN');
        }
        // Resolve the canonical consumed source action independently of the
        // provider result namespace and later PR checks. Older source revisions
        // can predate this lease; preserve their original receipt binding.
        const resolveSourceExecutionId = normalized.readOriginalSourceExecutionId
          ?? readOriginalSourceExecutionIdV1;
        const sourceExecutionId = text(await resolveSourceExecutionId(current, paths, env));
        const actionPrefix = `${currentLease.laneId}-r`;
        const sourceSuffix = sourceExecutionId.startsWith(actionPrefix)
          ? sourceExecutionId.slice(actionPrefix.length) : '';
        const sourceMatch = sourceSuffix.match(/^(0|[1-9]\d*)-[a-f0-9]{12}$/);
        if (!sourceMatch) return hold('PARKED_ORIGINAL_SOURCE_EXECUTION_UNPROVEN');
        const sourceHistory = await readReceiptHistory(paths.workspaceRoot, {
          executionId: sourceExecutionId,
        }, receiptOptions);
        const sourceReceipt = sourceHistory?.latestReceipt;
        if (sourceHistory?.ok !== true || !sourceHistory.receipts?.length || !sourceReceipt
            || !TERMINAL_EXECUTION_RECEIPT_STATES.has(text(sourceReceipt.state).toLowerCase())
            || text(sourceReceipt.executionId) !== sourceExecutionId
            || text(sourceReceipt.leaseKey) !== `${actionPrefix}${sourceMatch[1]}-lease`
            || text(sourceReceipt.repository).toLowerCase() !== currentLease.repository.toLowerCase()
            || text(sourceReceipt.branch) !== currentLease.branch
            || Number(sourceReceipt.issueNumber) !== currentLease.issueNumber) {
          return hold('PARKED_ORIGINAL_SOURCE_EXECUTION_UNPROVEN');
        }
        const originalInFlight = normalized.originalMissionInFlightFn ?? originalMissionHasQueuedWork;
        if (await originalInFlight({ missionId: currentLease.laneId, leaseId: currentLease.leaseId, env }) !== false) {
          return hold('PARKED_ORIGINAL_WORK_STILL_IN_FLIGHT');
        }
        // BLOCKED/CANCELLED can leave detached source-writing descendants alive.
        // Only the authenticated original-attempt fence can authorise release.
        if (phaseOf(current) === 'BLOCKED' || phaseOf(current) === 'CANCELLED') {
          if (!current?.storeMetadata?.originalSourceAttemptFence) {
            return hold('PARKED_ORIGINAL_AUTHENTICATED_FENCE_REQUIRED');
          }
          if (await verifyOriginalSourceAttemptFence(current, currentLease, paths, env) !== true) {
            return hold('PARKED_ORIGINAL_AUTHENTICATED_FENCE_UNVERIFIED');
          }
        }
        return releaseLease({
          leaseId: currentLease.leaseId, laneId: currentLease.laneId,
          repository: currentLease.repository, issueNumber: currentLease.issueNumber,
          prNumber: currentLease.prNumber, branch: currentLease.branch,
          headSha: currentLease.headSha, ownerId: currentLease.ownerId, nowUtc,
        }, serviceOptions);
      }, { root: paths.orchestratorRoot, env });
      releasedLease = outcome?.preconditionFailed === false ? outcome.result
        : { ok: false, released: false, reason: 'PARKED_ORIGINAL_MISSION_STATE_CHANGED' };
    } catch {
      releasedLease = { ok: false, released: false, reason: 'PARKED_ORIGINAL_WRITER_PROOF_UNOBSERVABLE' };
    }
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
    // Before reserving the global source lease, prove the exact queued action
    // can publish its first durable execution receipt. Previously an action
    // with no valid proof refs claimed the lease and then deadlocked itself.
    // Read qualified capacity first where the selected phase requires it.
    if (SOURCE_PHASES.has(phaseOf(leasedEntry.mission)) && !capacityRouting) {
      capacityRouting = await readCapacityRouting({
        root: paths.workspaceRoot, repoRoot: paths.repoRoot,
        nowUtc, sourceRevision, env,
      });
      if (!capacityRouting) {
        return baseResult({
          ok: false,
          classification: 'ELASTIC_PR_HEAD_CAPACITY_ROUTING_UNAVAILABLE',
          handledMissionIds,
          held: [{ missionId: leasedEntry.identity.missionId, reason: 'PROVIDER_INDEPENDENT_CAPACITY_ROUTING_UNAVAILABLE' }],
          releasedLease,
        });
      }
    }
    const previewGrant = exactPrHeadWorkerGrant(
      leasedEntry.mission, leasedEntry.identity, sourceRevision, capacityRouting, now,
    );
    if (!previewGrant) {
      return baseResult({
        ok: false,
        classification: 'ELASTIC_PR_HEAD_EXACT_ACTION_GRANT_UNAVAILABLE',
        handledMissionIds,
        held: [{ missionId: leasedEntry.identity.missionId, reason: 'EXACT_PR_HEAD_ACTION_GRANT_UNAVAILABLE' }],
        releasedLease,
      });
    }
    const previewProofRefs = existingQueuedProofRefs(previewGrant, null, leasedEntry.mission);
    const previewReceipt = createQueuedExecutionReceipt(
      previewGrant, { leaseId: requestedLeaseId }, nowUtc, previewProofRefs,
    );
    const previewValidation = validateExecutionReceipt(previewReceipt);
    if (!previewValidation.valid) {
      return baseResult({
        ok: false,
        classification: 'ELASTIC_PR_HEAD_QUEUED_RECEIPT_PROOF_BLOCKED',
        handledMissionIds,
        held: [{ missionId: leasedEntry.identity.missionId,
          reason: previewProofRefs.length === 0
            ? 'CANONICAL_QUEUED_EXECUTION_PROOF_REQUIRED'
            : `CANONICAL_QUEUED_EXECUTION_RECEIPT_INVALID:${previewValidation.refusalReason}` }],
        releasedLease,
      });
    }
    // Validation alone is not durable evidence: a refused/failed receipt write
    // after claim used to strand the programme behind a lease with no chain.
    // Prepare the exact reservation, but persist/replay the canonical queued
    // receipt below BEFORE claiming it. A queued receipt grants no writer
    // authority; publication still requires the canonical lease claim.
    pendingLeaseClaim = {
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
    };
  }

  const currentPhase = phaseOf(leasedEntry.mission);
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

  const receiptLease = currentLease ?? pendingLeaseClaim;
  if (!paths.workspaceRoot || !text(receiptLease?.leaseId)) {
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
      leaseKey: receiptLease.leaseId,
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
    if (pendingLeaseClaim) {
      return baseResult({
        ok: false,
        classification: 'ELASTIC_PR_HEAD_RUNNING_WITHOUT_LEASE',
        handledMissionIds,
        held: [{ missionId: leasedEntry.identity.missionId, reason: 'IN_FLIGHT_PR_HEAD_ACTION_WITHOUT_CANONICAL_LEASE' }],
        releasedLease,
      });
    }
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
    const proofRefs = existingQueuedProofRefs(grant, receiptLease, leasedEntry.mission);
    if (proofRefs.length === 0) {
      return baseResult({
        ok: false,
        classification: 'ELASTIC_PR_HEAD_QUEUED_RECEIPT_PROOF_BLOCKED',
        handledMissionIds,
        held: [{ missionId: leasedEntry.identity.missionId, reason: 'CANONICAL_QUEUED_EXECUTION_PROOF_REQUIRED' }],
        activeLease: currentLease,
        releasedLease,
      });
    }
    executionReceipt = createQueuedExecutionReceipt(grant, receiptLease, nowUtc, proofRefs);
    const validation = validateExecutionReceipt(executionReceipt);
    if (!validation.valid) {
      return baseResult({
        ok: false,
        classification: 'ELASTIC_PR_HEAD_QUEUED_RECEIPT_PROOF_BLOCKED',
        handledMissionIds,
        held: [{ missionId: leasedEntry.identity.missionId, reason: `CANONICAL_QUEUED_EXECUTION_RECEIPT_INVALID:${validation.refusalReason}` }],
        activeLease: currentLease,
        releasedLease,
      });
    }
    let queuedAppend;
    try {
      queuedAppend = await appendReceipt(paths.workspaceRoot, executionReceipt, receiptOptions);
    } catch {
      queuedAppend = { ok: false, reason: 'QUEUED_EXECUTION_RECEIPT_APPEND_EXCEPTION' };
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

  if (pendingLeaseClaim) {
    let claim;
    try {
      claim = await claimLease(pendingLeaseClaim, serviceOptions);
    } catch {
      claim = { ok: false, reason: 'SOURCE_MUTATION_LEASE_CLAIM_EXCEPTION' };
    }
    if (claim?.ok !== true || !sameLeaseIdentity(claim.record, leasedEntry.identity)
        || text(claim.record?.leaseId) !== pendingLeaseClaim.leaseId) {
      return baseResult({
        ok: false,
        classification: 'ELASTIC_PR_HEAD_LEASE_CLAIM_BLOCKED',
        handledMissionIds,
        held: [{ missionId: leasedEntry.identity.missionId, reason: claim?.ok === true
          ? 'SOURCE_MUTATION_LEASE_CLAIM_IDENTITY_MISMATCH'
          : text(claim?.reason, 'LEASE_CLAIM_FAILED') }],
        releasedLease,
      });
    }
    currentLease = claim.record;
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
