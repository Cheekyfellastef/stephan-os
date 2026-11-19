import { createHash } from 'node:crypto';
import { isDeepStrictEqual, types } from 'node:util';
import { classifyElasticMissionIdentityV1, projectMissionSeedSourcePlanShapeV1, seedSourceEffectPhaseV1,
  SOURCE_SCOPE_RECONCILIATION_REQUIRED } from '../runtime/seedGrowthWorkV1.mjs';
import { validateEngineeringCodingMemoryPackV1 } from './engineeringIncidentMethodMemoryV1.mjs';
import { authorizationClaimsSha256, issueOpenClawGitHubAuthorization } from './openClawGitHubAuthorization.mjs';
import { buildOpenClawGitHubOperation } from './openClawGitHubOperator.mjs';
import { applyMissionOrchestratorEvent } from './missionOrchestrator.mjs';
import {
  MISSION_CONTROLLER_ROUTE,
} from './missionControllerCapacityRouterV1.mjs';
import { routeProviderIndependentMissionCapacityV1 } from './providerIndependentMissionCapacityRouteV1.mjs';

const OPENCLAW_BRANCH_PATTERN = /^openclaw\/[a-z0-9][a-z0-9._/-]{2,127}$/;
const SHA40_PATTERN = /^[a-f0-9]{40}$/;
const WORKER_GRANT_KEYS_V1 = Object.freeze([
  'schemaVersion', 'grantId', 'controllerId', 'sourceRevision', 'missionId',
  'missionRevision', 'currentPhase', 'actionId', 'actionKind', 'adapter',
  'operation', 'providerRouteIntent', 'capacityRoute', 'capacityReceiptId',
  'capacityProofRefs', 'workerId', 'laneId', 'repository', 'issueNumber',
  'prNumber', 'branch', 'headSha', 'engineeringMemoryPack',
  'engineeringMemoryPackId', 'sourcePlanFingerprint', 'sourcePlanKind', 'boundedActionCount', 'mergeAuthority', 'leaseSeizureAllowed',
]);

// Failure observations retain recovery responsibility; they never authenticate
// source state, renew a grant or authorize cleanup/retry. Inspect own data only.
export function projectMissionWorkerSourceFailureV1(error, action = {}) {
  if (!action || typeof action !== 'object' || types.isProxy(action)) return null;
  const descriptor = error && typeof error === 'object' && !types.isProxy(error)
    ? Object.getOwnPropertyDescriptor(error, 'sourceFailure') : undefined;
  if (!descriptor) return null;
  const actionData = Object.getOwnPropertyDescriptors(action);
  const missionId = typeof actionData.missionId?.value === 'string' ? actionData.missionId.value : '';
  const actionId = typeof actionData.actionId?.value === 'string' ? actionData.actionId.value : '';
  const scope = actionData.allowedFiles?.value;
  const allowed = Array.isArray(scope) && !types.isProxy(scope) && scope.length <= 64
    ? Array.from({ length: scope.length }, (_, index) => Object.getOwnPropertyDescriptor(scope, String(index))?.value) : [];
  const unknown = () => Object.freeze({ schemaVersion: 'stephanos.source-mutation-failure.v1',
    missionId, actionId, sourceFile: '', promotionDisposition: 'UNKNOWN',
    lastConfirmedSourceState: 'UNKNOWN', rollbackDisposition: 'UNPROVEN',
    rollbackReasonCode: 'SOURCE_FAILURE_OBSERVATION_UNPROVEN', sourceState: 'UNKNOWN',
    baselineSha256: '', candidateSha256: '', observedSha256: '',
    recoveryRequired: true, responsibilityRetained: true, mutationAuthority: false });
  if (!Object.hasOwn(descriptor, 'value')) return unknown();
  const value = descriptor.value;
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return unknown();
  const keys = Object.keys(unknown());
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key =>
    !Object.hasOwn(descriptors, key) || !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable)) return unknown();
  const row = Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
  if (row.schemaVersion !== 'stephanos.source-mutation-failure.v1'
      || row.missionId !== missionId || row.actionId !== actionId
      || typeof row.sourceFile !== 'string' || row.sourceFile.length > 256
      || /[\x00-\x1f\x7f]/.test(row.sourceFile) || !allowed.includes(row.sourceFile)
      || !['COMPLETED', 'ATTEMPTED_UNPROVEN'].includes(row.promotionDisposition)
      || !['BASELINE_CAPTURED', 'CANDIDATE_WRITE_COMPLETED', 'CANDIDATE_FILE_BYTES_OBSERVED'].includes(row.lastConfirmedSourceState)
      || !['RESTORED', 'REFUSED', 'FAILED'].includes(row.rollbackDisposition)
      || !['SOURCE_SCOPE_RECONCILIATION_REQUIRED', 'ORIGINAL_SOURCE_ATTEMPT_FENCED',
        'SOURCE_ROLLBACK_AUTHORITY_UNPROVEN', 'SOURCE_ROLLBACK_WRITE_FAILED',
        'SOURCE_ROLLBACK_READBACK_FAILED', 'SOURCE_ROLLBACK_READBACK_MISMATCH', 'SOURCE_ROLLBACK_COMPLETE'].includes(row.rollbackReasonCode)
      || !['UNKNOWN', 'BASELINE_FILE_BYTES_OBSERVED'].includes(row.sourceState)
      || ![row.baselineSha256, row.candidateSha256].every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))
      || (row.sourceState === 'BASELINE_FILE_BYTES_OBSERVED'
        ? row.observedSha256 !== row.baselineSha256 || row.rollbackDisposition !== 'RESTORED'
          || row.rollbackReasonCode !== 'SOURCE_ROLLBACK_COMPLETE'
        : row.observedSha256 !== '' || row.rollbackDisposition === 'RESTORED')
      || row.recoveryRequired !== true || row.responsibilityRetained !== true || row.mutationAuthority !== false) return unknown();
  return Object.freeze(row);
}

// Both producers use the same envelope. Only absent/null optional memory has
// compatibility equivalence; provider intent and every authority field stay exact.
export function createMissionWorkerActionGrantV1(input) {
  return Object.freeze({ ...input,
    engineeringMemoryPack: input.engineeringMemoryPack ?? null,
    engineeringMemoryPackId: input.engineeringMemoryPackId ?? null,
    sourcePlanFingerprint: input.sourcePlanFingerprint ?? null,
    sourcePlanKind: input.sourcePlanKind ?? null,
  });
}

export function missionWorkerActionGrantsMatchV1(left, right) {
  const normalize = (value, depth = 0) => {
    if (depth > 32) throw new Error('GRANT_JSON_DEPTH');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || types.isProxy(value)) throw new Error('GRANT_JSON_VALUE');
    const array = Array.isArray(value), keys = Reflect.ownKeys(value);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('GRANT_JSON_PROTOTYPE');
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value')
        || (!descriptor.enumerable && !(array && key === 'length'))
        || (array && key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))) throw new Error('GRANT_JSON_PROPERTY');
    }
    if (array) {
      if (keys.length !== value.length + 1) throw new Error('GRANT_JSON_SPARSE_ARRAY');
      return value.map(child => normalize(child, depth + 1));
    }
    return Object.fromEntries(keys.sort().map(key => [key, normalize(value[key], depth + 1)]));
  };
  const canonical = grant => {
    if (!grant || typeof grant !== 'object' || Array.isArray(grant)) return null;
    try { grant = normalize(grant); } catch { return null; }
    if (classifyElasticMissionIdentityV1(grant.missionId, grant.branch).kind === 'NONCANONICAL_ELASTIC') return null;
    const descriptors = Object.getOwnPropertyDescriptors(grant);
    if (Object.values(descriptors).some(row => !Object.hasOwn(row, 'value'))
      || Reflect.ownKeys(grant).some(key => !WORKER_GRANT_KEYS_V1.includes(key))
      || WORKER_GRANT_KEYS_V1.some(key => !key.startsWith('engineeringMemoryPack')
        && !['sourcePlanFingerprint', 'sourcePlanKind'].includes(key) && !Object.hasOwn(grant, key))
      || grant.schemaVersion !== 'stephanos.mission-worker-action-grant.v1'
      || typeof grant.providerRouteIntent !== 'string' || !grant.providerRouteIntent.trim()
      || grant.providerRouteIntent !== grant.providerRouteIntent.trim()) return null;
    const strings = ['grantId', 'controllerId', 'missionId', 'currentPhase', 'actionId',
      'actionKind', 'adapter', 'laneId', 'repository', 'branch'];
    // The fixed signed Git/worktree adapter is not a provider-capacity grant.
    // Preserve its producer's exact empty route without inventing a capacity
    // receipt; source/model handoffs still require their admitted nonempty route.
    const signedLifecycle = grant.actionKind === 'signed-openclaw-operation'
      && grant.adapter === 'openclaw-signed';
    const forgePublication = grant.actionKind === 'forge-escrow-publication'
      && grant.adapter === 'forge-publication';
    const nonCapacity = signedLifecycle || forgePublication;
    if (strings.some(key => typeof grant[key] !== 'string' || !grant[key]
      || grant[key] !== grant[key].trim() || grant[key].length > 256)
      || typeof grant.capacityRoute !== 'string' || grant.capacityRoute.length > 256
      || grant.capacityRoute !== grant.capacityRoute.trim() || (!nonCapacity && !grant.capacityRoute)
      || typeof grant.operation !== 'string' || grant.operation.length > 128
      || (signedLifecycle && (SIGNED_OPERATION_PHASES.get(grant.currentPhase) !== grant.operation
        || grant.capacityRoute !== '' || grant.capacityReceiptId !== null
        || !Array.isArray(grant.capacityProofRefs) || grant.capacityProofRefs.length !== 0
        || grant.workerId !== 'openclaw-standalone'))
      || (forgePublication && (grant.currentPhase !== 'GITHUB_COMMIT' || grant.operation !== 'publish-forge-escrow'
        || grant.capacityRoute !== '' || grant.capacityReceiptId !== null
        || !Array.isArray(grant.capacityProofRefs) || grant.capacityProofRefs.length !== 0
        || grant.workerId !== 'github-first'))
      || typeof grant.sourceRevision !== 'string' || !SHA40_PATTERN.test(grant.sourceRevision)
      || (grant.headSha !== null && (typeof grant.headSha !== 'string' || !SHA40_PATTERN.test(grant.headSha)))
      || !Number.isSafeInteger(grant.missionRevision) || grant.missionRevision < 0
      || !Number.isSafeInteger(grant.issueNumber) || grant.issueNumber < 1
      || (grant.prNumber !== null && (!Number.isSafeInteger(grant.prNumber) || grant.prNumber < 1))
      || ![grant.capacityReceiptId, grant.workerId].every(value => value === null
        || (typeof value === 'string' && value.length > 0 && value.length <= 256 && value === value.trim()))
      || !Array.isArray(grant.capacityProofRefs) || grant.capacityProofRefs.length > 64
      || grant.capacityProofRefs.some(value => typeof value !== 'string' || !value
        || value !== value.trim() || value.length > 512)
      || (grant.sourcePlanFingerprint != null && (typeof grant.sourcePlanFingerprint !== 'string'
        || !/^[0-9a-f]{64}$/.test(grant.sourcePlanFingerprint)))
      || (grant.sourcePlanFingerprint != null
        ? !['CURRENT_ORDINARY_SOURCE_PLAN', 'SEED_SELF'].includes(grant.sourcePlanKind)
        : grant.sourcePlanKind != null)
      || grant.boundedActionCount !== 1 || grant.mergeAuthority !== false
      || grant.leaseSeizureAllowed !== false) return null;
    const normalized = createMissionWorkerActionGrantV1(grant);
    const pack = normalized.engineeringMemoryPack;
    if ((pack === null) !== (normalized.engineeringMemoryPackId === null)) return null;
    if (pack !== null && (!validateEngineeringCodingMemoryPackV1(pack)
      || pack.packId !== normalized.engineeringMemoryPackId)) return null;
    try {
      const serialized = JSON.stringify(normalize(normalized));
      return Buffer.byteLength(serialized, 'utf8') <= 32 * 1024 ? serialized : null;
    } catch { return null; }
  };
  const a = canonical(left), b = canonical(right);
  return a !== null && b !== null && a === b;
}
const SIGNED_OPERATION_PHASES = new Map([
  ['CREATE_WORKTREE', 'create-worktree'],
  ['GITHUB_COMMIT', 'commit'],
  ['GITHUB_PUSH', 'push'],
  ['OPEN_PULL_REQUEST', 'open-pr'],
  ['MERGE_PULL_REQUEST', 'merge-pr'],
]);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function nowIso(options = {}) {
  return options.now instanceof Date ? options.now.toISOString() : new Date().toISOString();
}

function expiresAt(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const lifetimeMs = Number.isInteger(options.authorizationLifetimeMs) ? options.authorizationLifetimeMs : 10 * 60 * 1000;
  return new Date(now.getTime() + Math.min(Math.max(lifetimeMs, 60_000), 24 * 60 * 60 * 1000)).toISOString();
}

function actionId(state, kind) {
  const seed = `${state.missionId}:${state.revision}:${state.currentPhase}:${kind}`;
  return `${state.missionId}-r${state.revision}-${createHash('sha256').update(seed).digest('hex').slice(0, 12)}`;
}

function receiptRequirement(operation) {
  const requirements = {
    'create-worktree': 'isolated worktree', commit: 'signed git commit', push: 'signed git push',
    'open-pr': 'pull request creation', 'check-pr': 'pull request checks', 'merge-pr': 'approved squash merge',
  };
  return requirements[operation] || `signed ${operation}`;
}

function operationClaims(state, operation, options = {}) {
  const claims = {
    authorizationId: actionId(state, operation), missionId: state.missionId, operation,
    repository: state.repository,
    repositoryRoot: operation === 'create-worktree' ? text(state.repositoryRoot) : text(state.git?.worktreePath),
    defaultBranch: state.baseBranch || 'main', baseBranch: state.git?.baseBranch || state.baseBranch || 'main',
    branch: state.git?.branch || '', worktreePath: state.git?.worktreePath || '',
    allowedFiles: state.allowedFiles || [], changedFiles: state.git?.changedFiles || [], singleUse: true,
    issuedAt: nowIso(options), expiresAt: expiresAt(options),
  };
  if (operation === 'commit') claims.commitMessage = text(options.commitMessage, `Complete ${state.title || state.missionId}`);
  if (operation === 'open-pr') {
    claims.title = text(options.pullRequestTitle, state.title || state.intendedOutcome);
    claims.body = text(options.pullRequestBody, `Mission: ${state.missionId}\n\n${state.intendedOutcome}`);
  }
  if (operation === 'merge-pr') {
    claims.prNumber = state.pullRequest?.number;
    claims.expectedHeadSha = state.pullRequest?.headSha || '';
  }
  return claims;
}

function blocked(state, reason) {
  const blockers = (Array.isArray(reason) ? reason : [reason])
    .map((item) => text(item))
    .filter(Boolean);
  return { schemaVersion: 'stephanos.mission-worker-action.v1', actionId: actionId(state, 'blocked'), missionId: state.missionId, actionKind: 'blocked', executable: false, blockers, finalVerdict: 'BLOCKED' };
}

function capacityRouteForMission(state, options = {}) {
  const grant = options.actionGrant;
  if (
    grant?.schemaVersion === 'stephanos.mission-worker-action-grant.v1'
    && text(grant.missionId).toLowerCase() === text(state.missionId).toLowerCase()
    && Object.values(MISSION_CONTROLLER_ROUTE).includes(text(grant.capacityRoute).toUpperCase())
  ) {
    return {
      route: text(grant.capacityRoute).toUpperCase(),
      adapter: text(grant.adapter),
      workerId: text(grant.workerId),
      selectedCapacityReceiptId: text(grant.capacityReceiptId),
      proofRefs: Array.isArray(grant.capacityProofRefs) ? grant.capacityProofRefs : [],
      dispatchAllowed: true,
      blockers: [],
    };
  }
  if (!options.capacityRouting) {
    return {
      route: MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY,
      adapter: '',
      dispatchAllowed: false,
      blockers: ['provider-independent-capacity-routing-unavailable'],
    };
  }
  return routeProviderIndependentMissionCapacityV1({
    ...options.capacityRouting,
    nowUtc: options.capacityRouting.nowUtc || nowIso(options),
    mission: state,
    preferNonOpenAi: options.capacityRouting.preferNonOpenAi !== false,
    openAiBlackout: options.capacityRouting.openAiBlackout === true,
  });
}

export function projectMissionWorkerActionState(state, options = {}) {
  if (state?.currentPhase !== 'REPAIR_REQUIRED') return state;
  return applyMissionOrchestratorEvent(state, {
    missionId: state.missionId,
    eventType: 'REPAIR_STARTED',
    timestamp: nowIso(options),
    summary: 'Project the next bounded repair action for an exact controller grant.',
  }, options);
}

export function buildMissionWorkerAction(state, options = {}) {
  if (types.isProxy(state)) return blocked({ missionId: 'invalid', revision: 0, currentPhase: 'BLOCKED' },
    SOURCE_SCOPE_RECONCILIATION_REQUIRED);
  if (classifyElasticMissionIdentityV1(state?.missionId, state?.git?.branch || state?.branch).kind === 'NONCANONICAL_ELASTIC')
    return blocked(state, 'NONCANONICAL_ELASTIC_MISSION_IDENTITY');
  const semantic = projectMissionSeedSourcePlanShapeV1(state || {});
  if (semantic.applicable && seedSourceEffectPhaseV1(state || {}) && !semantic.valid) {
    return { ...blocked(state, SOURCE_SCOPE_RECONCILIATION_REQUIRED), reason: SOURCE_SCOPE_RECONCILIATION_REQUIRED };
  }
  const action = buildMissionWorkerActionData(state, options);
  if (semantic.applicable && seedSourceEffectPhaseV1(state || {}) && semantic.valid
      && action.actionKind === 'agent-handoff'
      && ['codex', 'openclaw-local', 'openclaw-standalone'].includes(action.adapter))
    return blocked(state, 'SOURCE_SEMANTIC_EFFECT_REVALIDATION_UNQUALIFIED');
  return semantic.applicable && seedSourceEffectPhaseV1(state || {}) && action.executable
    ? { ...action, sourcePlanFingerprint: semantic.authorityPlanFingerprint,
      sourcePlanKind: semantic.sourcePlanKind } : action;
}

function buildMissionWorkerActionData(state, options = {}) {
  if (!state || typeof state !== 'object') return blocked({ missionId: 'invalid', revision: 0, currentPhase: 'BLOCKED' }, 'Mission state is required.');
  if (state.nextAction?.type === 'RECONCILE_GOAL_ACCEPTANCE') {
    return { schemaVersion: 'stephanos.mission-worker-action.v1', actionId: actionId(state, 'wait'),
      missionId: state.missionId, actionKind: 'wait', executable: false,
      reason: 'EXTERNAL_MERGE_GOAL_ACCEPTANCE_REQUIRED', finalVerdict: 'NO_ACTION_REQUIRED' };
  }
  if (['COMPLETE', 'CANCELLED', 'BLOCKED', 'AWAITING_OPERATOR_APPROVAL'].includes(state.currentPhase)) {
    return { schemaVersion: 'stephanos.mission-worker-action.v1', actionId: actionId(state, 'wait'), missionId: state.missionId, actionKind: 'wait', executable: false, reason: state.currentPhase, finalVerdict: 'NO_ACTION_REQUIRED' };
  }

  if (state.currentPhase === 'CHECK_PULL_REQUEST') {
    if (!Number.isInteger(state.pullRequest?.number) || !SHA40_PATTERN.test(text(state.pullRequest?.headSha))) return blocked(state, 'Pull request inspection requires an exact pull request number and lowercase head SHA.');
    return {
      schemaVersion: 'stephanos.mission-worker-action.v1', actionId: actionId(state, 'check-pr'), missionId: state.missionId,
      actionKind: 'github-inspection', adapter: 'openclaw-github-readonly', operation: 'check-pr', owner: 'openclaw-standalone', activeWriter: 'none',
      repository: state.repository, repositoryRoot: state.git?.worktreePath || state.repositoryRoot, prNumber: state.pullRequest.number,
      expectedHeadSha: state.pullRequest.headSha, receiptRequirement: receiptRequirement('check-pr'), executable: true, blockers: [], finalVerdict: 'READY_TO_INSPECT_PULL_REQUEST',
    };
  }

  if (state.currentPhase === 'GITHUB_COMMIT' && state.dispatch?.adapter === 'foundry-forge') {
    const source = state.sourcePublication || {};
    if (!/^[a-f0-9]{64}$/.test(text(source.artifactSha256))
        || !text(source.outboxId).startsWith('offline-publication-')
        || source.canonicalBranch !== state.git?.branch
        || !SHA40_PATTERN.test(text(source.exactParentHead))
        || !SHA40_PATTERN.test(text(source.exactResultTree))) {
      return blocked(state, 'Verified Forge source escrow and publication outbox identity required.');
    }
    return {
      schemaVersion: 'stephanos.mission-worker-action.v1',
      actionId: actionId(state, 'forge-publish'), missionId: state.missionId,
      actionKind: 'forge-escrow-publication', adapter: 'forge-publication',
      operation: 'publish-forge-escrow', owner: 'github-first', activeWriter: 'none',
      repository: state.repository, branch: state.git.branch,
      artifactSha256: source.artifactSha256, outboxId: source.outboxId,
      exactParentHead: source.exactParentHead, exactResultTree: source.exactResultTree,
      receiptRequirement: 'signed exact-tree Forge draft PR publication',
      executable: true, blockers: [], finalVerdict: 'READY_TO_PUBLISH_SIGNED_FORGE_DRAFT',
    };
  }

  if (SIGNED_OPERATION_PHASES.has(state.currentPhase)) {
    const operation = SIGNED_OPERATION_PHASES.get(state.currentPhase);
    if (!OPENCLAW_BRANCH_PATTERN.test(text(state.git?.branch))) return blocked(state, 'Signed OpenClaw mutations require an openclaw/* mission branch.');
    if (operation !== 'create-worktree' && !text(state.git?.worktreePath)) return blocked(state, 'Signed GitHub operation requires an isolated worktree path.');
    if (operation === 'merge-pr' && (!Number.isInteger(state.pullRequest?.number) || !SHA40_PATTERN.test(text(state.pullRequest?.headSha)))) return blocked(state, 'Merge operation requires an exact pull request number and lowercase head SHA.');
    const claims = operationClaims(state, operation, options);
    const preview = buildOpenClawGitHubOperation(claims);
    const allowedPreviewBlockers = operation === 'merge-pr' ? new Set(['Pull request head SHA changed or could not be verified.', 'Pull request must be mergeable.', 'Every required check must report success.', 'Exact operator squash-merge approval token is required.']) : new Set();
    const blockers = preview.blockers.filter((reason) => !allowedPreviewBlockers.has(reason));
    if (blockers.length) return blocked(state, blockers.join(' '));
    return {
      schemaVersion: 'stephanos.mission-worker-action.v1', actionId: claims.authorizationId, missionId: state.missionId,
      actionKind: 'signed-openclaw-operation', operation, owner: 'openclaw-standalone', activeWriter: 'none',
      receiptRequirement: receiptRequirement(operation), claims, approvalToken: operation === 'merge-pr' ? state.approval?.requiredToken || '' : '',
      executable: true, blockers: [], finalVerdict: 'READY_TO_ISSUE_AUTHORIZATION',
    };
  }

  if (['AGENT_IMPLEMENTATION', 'REPAIR_REQUIRED'].includes(state.currentPhase)) {
    const capacity = capacityRouteForMission(state, options);
    if (capacity && (capacity.dispatchAllowed !== true || !text(capacity.adapter))) {
      return blocked(state, (capacity.blockers || []).length > 0
        ? capacity.blockers
        : 'No freshly proven build lane can accept this mission.');
    }
    const adapter = text(capacity?.adapter, 'codex');
    const route = text(capacity?.route, MISSION_CONTROLLER_ROUTE.CODEX).toUpperCase();
    const owner = adapter === 'codex' ? 'codex' : text(capacity?.workerId, adapter);
    const activeWriter = adapter === 'codex' ? 'Codex' : owner;
    return {
      schemaVersion: 'stephanos.mission-worker-action.v1', actionId: actionId(state, adapter), missionId: state.missionId,
      actionKind: 'agent-handoff', adapter, capacityRoute: route, capacityReceiptId: text(capacity?.selectedCapacityReceiptId),
      capacityProofRefs: Array.isArray(capacity?.proofRefs) ? capacity.proofRefs : [], owner, activeWriter,
      operatorIntent: state.operatorIntent, intendedOutcome: state.intendedOutcome, repository: state.repository,
      worktreePath: state.git?.worktreePath || '', branch: state.git?.branch || '', allowedFiles: state.allowedFiles || [],
      requiredTests: state.requiredTests || [], requiredEvidence: state.requiredEvidence || [], repairRound: state.repair?.currentRound || 0,
      executable: true, blockers: [], finalVerdict: adapter === 'codex' ? 'READY_TO_DISPATCH_CODEX' : 'READY_TO_PUBLISH_PROVEN_FALLBACK_HANDOFF',
    };
  }
  if (state.currentPhase === 'LIVE_RUNTIME_INVESTIGATION') {
    return {
      schemaVersion: 'stephanos.mission-worker-action.v1', actionId: actionId(state, 'openclaw-readonly'), missionId: state.missionId,
      actionKind: 'agent-handoff', adapter: 'openclaw-readonly', owner: 'openclaw-standalone', activeWriter: 'none',
      operatorIntent: state.operatorIntent, intendedOutcome: state.intendedOutcome, repository: state.repository,
      repositoryRoot: state.repositoryRoot, requiredEvidence: state.requiredEvidence || [], browserProofRequired: state.browserProofRequired === true,
      executable: true, blockers: [], finalVerdict: 'READY_TO_DISPATCH_OPENCLAW_READONLY',
    };
  }
  if (state.currentPhase === 'VERIFYING') {
    return { schemaVersion: 'stephanos.mission-worker-action.v1', actionId: actionId(state, 'verification'), missionId: state.missionId, actionKind: 'evidence-judgment', owner: 'verification-judge', activeWriter: 'none', requiredEvidence: state.requiredEvidence || [], receipts: state.evidenceReceipts || [], executable: true, blockers: [], finalVerdict: 'READY_TO_JUDGE_EVIDENCE' };
  }
  if (state.currentPhase === 'LOCAL_DEPLOYMENT') {
    return { schemaVersion: 'stephanos.mission-worker-action.v1', actionId: actionId(state, 'local-deployment'), missionId: state.missionId, actionKind: 'local-deployment', owner: 'openclaw-standalone', activeWriter: 'none', repository: state.repository, repositoryRoot: state.repositoryRoot, mergeCommitSha: state.pullRequest?.mergeCommitSha || '', steps: ['sync', 'build', 'verify', 'restart'].filter((step) => state.deployment?.[step]?.status !== 'success'), executable: true, blockers: [], finalVerdict: 'READY_FOR_LOCAL_DEPLOYMENT' };
  }
  return blocked(state, `Unsupported mission phase: ${text(state.currentPhase, 'unknown')}`);
}

function missionWorkerRequestData(action, authorization) {
  return { schemaVersion: 'stephanos.mission-worker-request.v1', actionId: action.actionId, missionId: action.missionId, operation: action.operation, authorization, approvalToken: action.approvalToken || '', receiptRequirement: action.receiptRequirement, finalVerdict: 'MISSION_WORKER_REQUEST_ISSUED' };
}

// Semantic comparison only; the existing signed executor still verifies the
// Ed25519 signature and current authorization lifetime before Git effects.
export function missionWorkerSignedRequestMatchesActionV1(request, action) {
  if (action?.actionKind !== 'signed-openclaw-operation' || action.executable !== true
      || types.isProxy(request) || types.isProxy(request?.authorization)) return false;
  const authorization = request?.authorization;
  return authorization?.schemaVersion === 'stephanos.openclaw-github-authorization.v1'
    && authorization.algorithm === 'Ed25519' && authorization.finalVerdict === 'STEPHANOS_AUTHORIZATION_ISSUED'
    && Object.keys(authorization).sort().join(',') === 'algorithm,claims,claimsSha256,finalVerdict,schemaVersion,signature'
    && typeof authorization.signature === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(authorization.signature)
    && isDeepStrictEqual(authorization.claims, action.claims)
    && authorization.claimsSha256 === authorizationClaimsSha256(action.claims)
    && isDeepStrictEqual(request, missionWorkerRequestData(action, authorization));
}

export function issueMissionWorkerAuthorization(action, privateKeyPem, options = {}) {
  if (action?.actionKind !== 'signed-openclaw-operation' || action.executable !== true) return { finalVerdict: 'BLOCKED', blockers: ['Worker action is not an executable signed OpenClaw operation.'] };
  const authorization = issueOpenClawGitHubAuthorization(action.claims, privateKeyPem, options);
  if (authorization.finalVerdict !== 'STEPHANOS_AUTHORIZATION_ISSUED') return authorization;
  return missionWorkerRequestData(action, authorization);
}
