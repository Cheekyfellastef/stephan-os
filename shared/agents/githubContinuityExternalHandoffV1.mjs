import { createHash } from 'node:crypto';

import {
  GITHUB_CONTINUITY_EXECUTION_GRANT_SCHEMA,
} from './githubContinuityExecutionGrantV1.mjs';
import {
  MISSION_CONTROLLER_ROUTE,
} from './missionControllerCapacityRouterV1.mjs';
import {
  MISSION_ORCHESTRATOR_EVENT_SCHEMA_VERSION,
  MISSION_ORCHESTRATOR_SCHEMA_VERSION,
  applyMissionOrchestratorEvent,
} from './missionOrchestrator.mjs';
import {
  buildMissionWorkerAction,
  projectMissionWorkerActionState,
} from './missionOrchestratorWorker.mjs';
import {
  createSharedWorkspaceHandoffRecord,
} from './sharedAgentWorkspaceStore.mjs';

export const GITHUB_CONTINUITY_EXTERNAL_HANDOFF_SCHEMA =
  'stephanos.github-continuity-external-handoff.v1';
export const GITHUB_CONTINUITY_EXTERNAL_COMPLETION_SCHEMA =
  'stephanos.github-continuity-external-completion.v1';
export const GITHUB_CONTINUITY_EXTERNAL_HANDOFF_BODY_SCHEMA =
  'stephanos.external-build-lane-handoff.v1';
export const MISSION_WORKER_QUEUE_ITEM_SCHEMA =
  'stephanos.mission-worker-queue-item.v1';

export const GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE = Object.freeze({
  EXTERNAL_HANDOFF_CANDIDATE_READY: 'EXTERNAL_HANDOFF_CANDIDATE_READY',
  EXISTING_IN_PROCESS_ROUTE_PRESERVED: 'EXISTING_IN_PROCESS_ROUTE_PRESERVED',
  SAFE_HOLD: 'SAFE_HOLD',
});

const EXTERNAL_ROUTES = new Map([
  [MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB, 'chatgpt-github'],
  [MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE, 'foundry-forge'],
]);
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:@/-]{2,239}$/i;
const SAFE_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_DEPTH = 16;
const MAX_NODES = 8_192;
const MAX_ARRAY_ITEMS = 1_024;
const MAX_STRING = 32_768;

const BUILD_INPUT_KEYS = new Set([
  'repository',
  'expectedSourceHead',
  'nowUtc',
  'executionGrant',
  'missionState',
]);
const COMPLETION_INPUT_KEYS = new Set([
  'handoff',
  'completionReceipt',
  'missionState',
]);
const GRANT_KEYS = Object.freeze([
  'schemaVersion',
  'grantId',
  'repository',
  'expectedSourceHead',
  'missionId',
  'taskId',
  'route',
  'adapter',
  'selectedCapacityReceiptId',
  'proofRefs',
  'grantedAtUtc',
  'executionScope',
  'windowsBound',
  'existingDispatchTakeoverAllowed',
  'sourceMutationAuthorityAdded',
  'mergeAuthorityAdded',
  'deploymentAuthorityAdded',
  'runtimeMutationAuthorityAdded',
  'protectedMergeDispatchAllowed',
  'leaseSeizureAllowed',
  'duplicateDispatchAllowed',
  'arbitraryCommandAllowed',
]);
const COMPLETION_KEYS = Object.freeze([
  'schemaVersion',
  'handoffId',
  'grantId',
  'missionId',
  'taskId',
  'repository',
  'expectedSourceHead',
  'adapter',
  'capacityRoute',
  'success',
  'resultId',
  'changedFiles',
  'receipt',
  'proofRefs',
  'completedAtUtc',
  'error',
  'sourceMutationAuthorityAdded',
  'mergeAuthorityAdded',
  'deploymentAuthorityAdded',
  'runtimeMutationAuthorityAdded',
  'protectedMergeDispatchAllowed',
  'duplicateDispatchAllowed',
  'arbitraryCommandAllowed',
]);

const ZERO_AUTHORITY = Object.freeze({
  queueWriteAllowed: false,
  sharedWorkspaceWriteAllowed: false,
  existingDispatchTakeoverAllowed: false,
  sourceMutationAuthorityAdded: false,
  mergeAuthorityAdded: false,
  deploymentAuthorityAdded: false,
  runtimeMutationAuthorityAdded: false,
  protectedMergeDispatchAllowed: false,
  leaseSeizureAllowed: false,
  duplicateDispatchAllowed: false,
  arbitraryCommandAllowed: false,
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function canonicalTimestamp(value) {
  const normalized = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalized)) return null;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString() === normalized ? parsed : null;
}

function snapshotDataOnly(value, state = { nodes: 0 }, depth = 0, seen = new Set()) {
  state.nodes += 1;
  if (state.nodes > MAX_NODES || depth > MAX_DEPTH) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.length <= MAX_STRING ? value : undefined;
  if (!value || typeof value !== 'object' || seen.has(value)) return undefined;

  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return undefined;
      if (Object.getOwnPropertySymbols(value).length > 0) return undefined;
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const lengthDescriptor = descriptors.length;
      const length = lengthDescriptor?.value;
      if (!lengthDescriptor || lengthDescriptor.get || lengthDescriptor.set
          || !Number.isSafeInteger(length) || length < 0 || length > MAX_ARRAY_ITEMS) return undefined;
      const expected = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
      if (Object.keys(descriptors).some((key) => !expected.has(key))) return undefined;
      seen.add(value);
      const output = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
          seen.delete(value);
          return undefined;
        }
        const normalized = snapshotDataOnly(descriptor.value, state, depth + 1, seen);
        if (normalized === undefined) {
          seen.delete(value);
          return undefined;
        }
        output.push(normalized);
      }
      seen.delete(value);
      return Object.freeze(output);
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    if (Object.getOwnPropertySymbols(value).length > 0) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    seen.add(value);
    const output = Object.create(null);
    for (const key of Object.keys(descriptors).sort()) {
      if (RESERVED_KEYS.has(key)) {
        seen.delete(value);
        return undefined;
      }
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        seen.delete(value);
        return undefined;
      }
      const normalized = snapshotDataOnly(descriptor.value, state, depth + 1, seen);
      if (normalized === undefined) {
        seen.delete(value);
        return undefined;
      }
      Object.defineProperty(output, key, {
        value: normalized,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    seen.delete(value);
    return Object.freeze(output);
  } catch {
    return undefined;
  }
}

function closedWorldSnapshot(value, allowedKeys) {
  const snapshot = snapshotDataOnly(value);
  if (!snapshot || Array.isArray(snapshot)) return null;
  if (Object.keys(snapshot).some((key) => !allowedKeys.has(key))) return null;
  return snapshot;
}

function exactKeys(record, keys) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function safeRefs(value, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.length > 32) return null;
  const refs = value.map(text);
  if (refs.some((ref) => !SAFE_REF.test(ref) || ref.includes('..'))) return null;
  if (new Set(refs).size !== refs.length) return null;
  return Object.freeze(refs);
}

function safePath(value) {
  const path = text(value).replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!path || path.startsWith('/') || /^[a-z]:\//i.test(path) || path.split('/').includes('..')) return false;
  return !/(^|\/)(?:\.git|node_modules|runtime|runtime-data|data|tmp)(?:\/|$)|(^|\/)\.env(?:\.|$)|\.(?:pem|pfx|key)$/i.test(path);
}

function safeChangedFiles(value) {
  if (!Array.isArray(value) || value.length > 256) return null;
  const files = value.map((item) => text(item).replace(/\\/g, '/'));
  if (files.some((file) => !safePath(file)) || new Set(files).size !== files.length) return null;
  return Object.freeze(files);
}

function issueIdentity(missionId) {
  const normalized = text(missionId).toLowerCase();
  const goalLane = /^goal-([1-9]\d*)-pr-([1-9]\d*)(?:$|[-_.])/.exec(normalized);
  if (goalLane) return { issueNumber: Number(goalLane[1]), prNumber: Number(goalLane[2]) };
  const criticalGoal = /^critical-([1-9]\d*)(?:$|[-_.])/.exec(normalized);
  return { issueNumber: criticalGoal ? Number(criticalGoal[1]) : null, prNumber: null };
}

function grantDigest(grant, actionId) {
  return createHash('sha256').update(JSON.stringify({
    grantId: grant.grantId,
    repository: grant.repository,
    expectedSourceHead: grant.expectedSourceHead,
    missionId: grant.missionId,
    taskId: grant.taskId,
    route: grant.route,
    adapter: grant.adapter,
    selectedCapacityReceiptId: grant.selectedCapacityReceiptId,
    proofRefs: grant.proofRefs,
    actionId,
  })).digest('hex');
}

function blockedBuild(input, blocker) {
  return Object.freeze({
    schemaVersion: GITHUB_CONTINUITY_EXTERNAL_HANDOFF_SCHEMA,
    state: GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE.SAFE_HOLD,
    repository: text(input?.repository),
    expectedSourceHead: text(input?.expectedSourceHead).toLowerCase(),
    grantId: text(input?.executionGrant?.grantId),
    actionId: '',
    handoffId: '',
    queueItemCandidate: null,
    sharedWorkspaceHandoffCandidate: null,
    blockers: Object.freeze([blocker]),
    authority: ZERO_AUTHORITY,
    finalVerdict: 'GITHUB_CONTINUITY_EXTERNAL_HANDOFF_SAFE_HOLD',
  });
}

function validateGrant(grant, identity) {
  if (!exactKeys(grant, GRANT_KEYS)) return 'execution-grant-shape-invalid';
  const route = text(grant.route).toUpperCase();
  const adapter = text(grant.adapter);
  const proofRefs = safeRefs(grant.proofRefs);
  const receiptId = grant.selectedCapacityReceiptId === null ? null : text(grant.selectedCapacityReceiptId);
  if (grant.schemaVersion !== GITHUB_CONTINUITY_EXECUTION_GRANT_SCHEMA) return 'execution-grant-schema-invalid';
  if (grant.repository !== identity.repository || text(grant.expectedSourceHead).toLowerCase() !== identity.expectedSourceHead) return 'execution-grant-identity-mismatch';
  if (!SAFE_ID.test(text(grant.grantId)) || !SAFE_ID.test(text(grant.missionId)) || !SAFE_ID.test(text(grant.taskId))) return 'execution-grant-id-invalid';
  if (!Object.values(MISSION_CONTROLLER_ROUTE).includes(route)) return 'execution-grant-route-invalid';
  if (!SAFE_ID.test(adapter) || proofRefs === null) return 'execution-grant-route-evidence-invalid';
  if (route === MISSION_CONTROLLER_ROUTE.CODEX) {
    if (receiptId !== null || adapter !== 'codex') return 'execution-grant-codex-binding-invalid';
  } else {
    if (!SAFE_ID.test(receiptId || '')) return 'execution-grant-capacity-receipt-invalid';
  }
  if (canonicalTimestamp(grant.grantedAtUtc) === null) return 'execution-grant-time-invalid';
  if (grant.executionScope !== 'SOURCE_ONLY_EXISTING_ROUTE' || grant.windowsBound !== false) return 'execution-grant-scope-invalid';
  if (grant.existingDispatchTakeoverAllowed !== false
      || grant.sourceMutationAuthorityAdded !== false
      || grant.mergeAuthorityAdded !== false
      || grant.deploymentAuthorityAdded !== false
      || grant.runtimeMutationAuthorityAdded !== false
      || grant.protectedMergeDispatchAllowed !== false
      || grant.leaseSeizureAllowed !== false
      || grant.duplicateDispatchAllowed !== false
      || grant.arbitraryCommandAllowed !== false) return 'execution-grant-authority-invalid';
  return '';
}

function validateMissionState(state, grant, repository) {
  if (!state || state.schemaVersion !== MISSION_ORCHESTRATOR_SCHEMA_VERSION) return 'mission-state-schema-invalid';
  if (text(state.repository) !== repository || text(state.missionId) !== text(grant.missionId)) return 'mission-state-identity-mismatch';
  if (!['AGENT_IMPLEMENTATION', 'REPAIR_REQUIRED'].includes(text(state.currentPhase).toUpperCase())) return 'mission-state-not-source-handoff-ready';
  if (text(state.dispatch?.status).toLowerCase() === 'running') return 'existing-dispatch-owns-mission';
  if (!Array.isArray(state.allowedFiles) || state.allowedFiles.length < 1 || state.allowedFiles.some((file) => !safePath(file))) return 'mission-state-source-scope-invalid';
  if (!Array.isArray(state.requiredTests) || state.requiredTests.length < 1) return 'mission-state-tests-invalid';
  if (!Array.isArray(state.requiredEvidence) || state.requiredEvidence.length < 1) return 'mission-state-evidence-invalid';
  return '';
}

function actionGrantFromContinuity(grant) {
  return Object.freeze({
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    missionId: grant.missionId,
    capacityRoute: grant.route,
    adapter: grant.adapter,
    workerId: grant.adapter,
    capacityReceiptId: grant.selectedCapacityReceiptId,
    capacityProofRefs: Object.freeze([...grant.proofRefs]),
  });
}

export function buildGitHubContinuityExternalHandoffV1(rawInput = {}) {
  const input = closedWorldSnapshot(rawInput, BUILD_INPUT_KEYS);
  if (!input) return blockedBuild(null, 'handoff-input-not-data-only-or-closed-world');

  const repository = text(input.repository);
  const expectedSourceHead = text(input.expectedSourceHead).toLowerCase();
  const nowUtc = text(input.nowUtc);
  if (!REPOSITORY.test(repository) || !SHA40.test(expectedSourceHead) || canonicalTimestamp(nowUtc) === null) {
    return blockedBuild(input, 'handoff-identity-invalid');
  }

  const grantBlocker = validateGrant(input.executionGrant, { repository, expectedSourceHead });
  if (grantBlocker) return blockedBuild(input, grantBlocker);

  const route = text(input.executionGrant.route).toUpperCase();
  if (route === MISSION_CONTROLLER_ROUTE.CODEX) {
    return Object.freeze({
      schemaVersion: GITHUB_CONTINUITY_EXTERNAL_HANDOFF_SCHEMA,
      state: GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE.EXISTING_IN_PROCESS_ROUTE_PRESERVED,
      repository,
      expectedSourceHead,
      grantId: input.executionGrant.grantId,
      actionId: '',
      handoffId: '',
      queueItemCandidate: null,
      sharedWorkspaceHandoffCandidate: null,
      blockers: Object.freeze([]),
      authority: ZERO_AUTHORITY,
      finalVerdict: 'GITHUB_CONTINUITY_EXISTING_IN_PROCESS_ROUTE_PRESERVED',
    });
  }

  const expectedAdapter = EXTERNAL_ROUTES.get(route);
  if (!expectedAdapter || input.executionGrant.adapter !== expectedAdapter) {
    return blockedBuild(input, 'execution-grant-external-route-binding-invalid');
  }

  const missionBlocker = validateMissionState(input.missionState, input.executionGrant, repository);
  if (missionBlocker) return blockedBuild(input, missionBlocker);

  const now = new Date(nowUtc);
  const projectedState = projectMissionWorkerActionState(input.missionState, { now });
  if (!projectedState || !['AGENT_IMPLEMENTATION'].includes(text(projectedState.currentPhase).toUpperCase())) {
    return blockedBuild(input, 'mission-state-repair-projection-invalid');
  }

  const action = buildMissionWorkerAction(projectedState, {
    now,
    actionGrant: actionGrantFromContinuity(input.executionGrant),
  });
  if (action?.executable !== true || action.actionKind !== 'agent-handoff'
      || action.adapter !== expectedAdapter || text(action.capacityRoute).toUpperCase() !== route
      || text(action.capacityReceiptId) !== text(input.executionGrant.selectedCapacityReceiptId)
      || JSON.stringify(action.capacityProofRefs || []) !== JSON.stringify(input.executionGrant.proofRefs || [])
      || action.repository !== repository) {
    return blockedBuild(input, 'canonical-mission-worker-action-binding-invalid');
  }

  const identity = issueIdentity(projectedState.missionId);
  const handoffBody = Object.freeze({
    schemaVersion: GITHUB_CONTINUITY_EXTERNAL_HANDOFF_BODY_SCHEMA,
    missionId: projectedState.missionId,
    taskId: input.executionGrant.taskId,
    grantId: input.executionGrant.grantId,
    actionId: action.actionId,
    adapter: action.adapter,
    capacityRoute: action.capacityRoute,
    capacityReceiptId: action.capacityReceiptId,
    repository,
    expectedSourceHead,
    branch: projectedState.git?.branch || '',
    allowedFiles: Object.freeze([...(action.allowedFiles || [])]),
    requiredTests: Object.freeze([...(action.requiredTests || [])]),
    requiredEvidence: Object.freeze([...(action.requiredEvidence || [])]),
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  });
  const digest = grantDigest(input.executionGrant, action.actionId);
  const handoffId = `continuity-handoff-${digest.slice(0, 24)}`;
  const workspaceHandoff = createSharedWorkspaceHandoffRecord({
    handoffId,
    participantId: 'mission-orchestrator',
    fromParticipantId: 'mission-orchestrator',
    toParticipantId: expectedAdapter === 'chatgpt-github' ? 'chatgpt' : 'future-agent',
    timestampUtc: nowUtc,
    correlationId: projectedState.missionId,
    relatedIssue: `#${identity.issueNumber || 1637}`,
    relatedPr: identity.prNumber ? `#${identity.prNumber}` : '',
    proofRefs: input.executionGrant.proofRefs,
    summary: `${expectedAdapter} is the exact GitHub Continuity source owner for ${projectedState.missionId}.`,
    body: JSON.stringify(handoffBody),
  });

  const queueItem = Object.freeze({
    schemaVersion: MISSION_WORKER_QUEUE_ITEM_SCHEMA,
    adapter: expectedAdapter,
    actionId: action.actionId,
    missionId: projectedState.missionId,
    createdAt: nowUtc,
    payload: Object.freeze({ ...action }),
  });

  return Object.freeze({
    schemaVersion: GITHUB_CONTINUITY_EXTERNAL_HANDOFF_SCHEMA,
    state: GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE.EXTERNAL_HANDOFF_CANDIDATE_READY,
    repository,
    expectedSourceHead,
    grantId: input.executionGrant.grantId,
    taskId: input.executionGrant.taskId,
    actionId: action.actionId,
    handoffId,
    missionRevision: projectedState.revision,
    queueItemCandidate: queueItem,
    sharedWorkspaceHandoffCandidate: workspaceHandoff,
    blockers: Object.freeze([]),
    authority: ZERO_AUTHORITY,
    finalVerdict: 'GITHUB_CONTINUITY_EXTERNAL_HANDOFF_CANDIDATE_READY',
  });
}

function validMissionReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return false;
  if (!text(receipt.requirement) || !text(receipt.source) || !text(receipt.evidenceType) || receipt.verified !== true) return false;
  if (SHA256.test(text(receipt.sha256)) || SHA256.test(text(receipt.commandOutputHash))) return true;
  if (Number.isInteger(receipt.exitCode) && receipt.exitCode === 0) return true;
  const receiptPath = text(receipt.receiptPath).replace(/\\/g, '/');
  return SAFE_REF.test(receiptPath) && !receiptPath.includes('..');
}

function blockedCompletion(blocker) {
  return Object.freeze({
    schemaVersion: GITHUB_CONTINUITY_EXTERNAL_COMPLETION_SCHEMA,
    valid: false,
    eventCandidate: null,
    projectedMissionState: null,
    blockers: Object.freeze([blocker]),
    authority: ZERO_AUTHORITY,
    finalVerdict: 'GITHUB_CONTINUITY_EXTERNAL_COMPLETION_BLOCKED',
  });
}

export function adjudicateGitHubContinuityExternalCompletionV1(rawInput = {}) {
  const input = closedWorldSnapshot(rawInput, COMPLETION_INPUT_KEYS);
  if (!input) return blockedCompletion('completion-input-not-data-only-or-closed-world');
  const handoff = input.handoff;
  const completion = input.completionReceipt;
  const state = input.missionState;
  if (!handoff || handoff.schemaVersion !== GITHUB_CONTINUITY_EXTERNAL_HANDOFF_SCHEMA
      || handoff.state !== GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE.EXTERNAL_HANDOFF_CANDIDATE_READY
      || !handoff.queueItemCandidate || !handoff.sharedWorkspaceHandoffCandidate) {
    return blockedCompletion('handoff-candidate-invalid');
  }
  if (!completion || !exactKeys(completion, COMPLETION_KEYS)
      || completion.schemaVersion !== GITHUB_CONTINUITY_EXTERNAL_COMPLETION_SCHEMA) {
    return blockedCompletion('completion-receipt-shape-invalid');
  }
  const proofRefs = safeRefs(completion.proofRefs, 1);
  const changedFiles = safeChangedFiles(completion.changedFiles);
  const completedAtMs = canonicalTimestamp(completion.completedAtUtc);
  if (!proofRefs || !changedFiles || completedAtMs === null) return blockedCompletion('completion-evidence-invalid');
  if (completion.repository !== handoff.repository
      || text(completion.expectedSourceHead).toLowerCase() !== handoff.expectedSourceHead
      || completion.handoffId !== handoff.handoffId
      || completion.grantId !== handoff.grantId
      || completion.missionId !== handoff.queueItemCandidate.missionId
      || completion.taskId !== handoff.taskId
      || completion.adapter !== handoff.queueItemCandidate.adapter
      || text(completion.capacityRoute).toUpperCase() !== text(handoff.queueItemCandidate.payload?.capacityRoute).toUpperCase()) {
    return blockedCompletion('completion-handoff-identity-mismatch');
  }
  if (completion.sourceMutationAuthorityAdded !== false
      || completion.mergeAuthorityAdded !== false
      || completion.deploymentAuthorityAdded !== false
      || completion.runtimeMutationAuthorityAdded !== false
      || completion.protectedMergeDispatchAllowed !== false
      || completion.duplicateDispatchAllowed !== false
      || completion.arbitraryCommandAllowed !== false) {
    return blockedCompletion('completion-authority-invalid');
  }
  if (typeof completion.success !== 'boolean') return blockedCompletion('completion-success-invalid');
  if (completion.success === true) {
    if (!SAFE_ID.test(text(completion.resultId)) || text(completion.error)) return blockedCompletion('completion-success-payload-invalid');
    if (!validMissionReceipt(completion.receipt)) return blockedCompletion('completion-mission-receipt-invalid');
  } else {
    if (!text(completion.error) || changedFiles.length > 0 || completion.resultId !== '') return blockedCompletion('completion-failure-payload-invalid');
  }
  if (!state || state.schemaVersion !== MISSION_ORCHESTRATOR_SCHEMA_VERSION
      || state.missionId !== completion.missionId
      || state.repository !== completion.repository
      || text(state.dispatch?.status).toLowerCase() !== 'running'
      || text(state.dispatch?.adapter) !== completion.adapter) {
    return blockedCompletion('completion-mission-state-mismatch');
  }

  const eventCandidate = Object.freeze({
    schemaVersion: MISSION_ORCHESTRATOR_EVENT_SCHEMA_VERSION,
    missionId: completion.missionId,
    eventType: 'AGENT_RESULT_RECEIVED',
    timestamp: completion.completedAtUtc,
    summary: completion.success
      ? `GitHub Continuity external lane completed ${completion.taskId}.`
      : `GitHub Continuity external lane failed ${completion.taskId}.`,
    success: completion.success,
    resultId: completion.resultId,
    changedFiles,
    receipt: completion.receipt,
    error: completion.error,
  });
  const projected = applyMissionOrchestratorEvent(state, eventCandidate, {
    now: new Date(completion.completedAtUtc),
  });
  if (completion.success === true) {
    if (projected?.dispatch?.status !== 'complete' || projected?.dispatch?.resultId !== completion.resultId
        || text(projected?.currentPhase).toUpperCase() === 'BLOCKED') {
      return blockedCompletion('completion-event-preflight-failed');
    }
  } else if (text(projected?.currentPhase).toUpperCase() !== 'BLOCKED') {
    return blockedCompletion('failure-event-preflight-failed');
  }

  return Object.freeze({
    schemaVersion: GITHUB_CONTINUITY_EXTERNAL_COMPLETION_SCHEMA,
    valid: true,
    handoffId: completion.handoffId,
    grantId: completion.grantId,
    missionId: completion.missionId,
    taskId: completion.taskId,
    eventCandidate,
    projectedMissionState: projected,
    blockers: Object.freeze([]),
    authority: ZERO_AUTHORITY,
    finalVerdict: completion.success
      ? 'GITHUB_CONTINUITY_EXTERNAL_COMPLETION_EVENT_READY'
      : 'GITHUB_CONTINUITY_EXTERNAL_FAILURE_EVENT_READY',
  });
}
