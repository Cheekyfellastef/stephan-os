import {
  CONTINUITY_TASK_DISPOSITION,
  GITHUB_CONTINUITY_MODE_SCHEMA,
  GITHUB_CONTINUITY_STATE,
} from './githubContinuityModeV1.mjs';
import { MISSION_CONTROLLER_ROUTE } from './missionControllerCapacityRouterV1.mjs';

export const GITHUB_CONTINUITY_EXECUTION_GRANT_SCHEMA = 'stephanos.github-continuity-execution-grant.v1';
export const GITHUB_CONTINUITY_EXECUTION_BATCH_SCHEMA = 'stephanos.github-continuity-execution-batch.v1';

const SAFE_ID = /^[a-z0-9][a-z0-9._:@/-]{2,239}$/i;
const FULL_SHA = /^[0-9a-f]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const MAX_GRANTS = 100;
const ALLOWED_ROUTES = new Set([
  MISSION_CONTROLLER_ROUTE.CODEX,
  MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB,
  MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE,
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function timestamp(value) {
  const normalized = text(value);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueSafeRefs(value) {
  const refs = list(value).map(text).filter(Boolean);
  if (refs.length > 32 || refs.length !== new Set(refs).size) return null;
  return refs.every((ref) => SAFE_REF.test(ref) && !ref.includes('..')) ? refs : null;
}

function freeze(value) {
  return Object.freeze(value);
}

function blockedBatch(input, blocker) {
  return freeze({
    schemaVersion: GITHUB_CONTINUITY_EXECUTION_BATCH_SCHEMA,
    repository: text(input?.repository),
    expectedSourceHead: text(input?.expectedSourceHead).toLowerCase(),
    evaluatedAtUtc: text(input?.nowUtc),
    continuityState: text(input?.continuityPlan?.state),
    grants: freeze([]),
    grantCount: 0,
    sourceMutationAuthorityAdded: false,
    mergeAuthorityAdded: false,
    deploymentAuthorityAdded: false,
    runtimeMutationAuthorityAdded: false,
    protectedMergeDispatchAllowed: false,
    duplicateDispatchAllowed: false,
    arbitraryCommandAllowed: false,
    blocker,
    finalVerdict: 'GITHUB_CONTINUITY_EXECUTION_BLOCKED',
  });
}

function buildGrant(plan, item, index, nowUtc) {
  const missionId = text(item?.missionId);
  const taskId = text(item?.taskId);
  const route = text(item?.route).toUpperCase();
  const adapter = text(item?.adapter);
  const proofRefs = uniqueSafeRefs(item?.proofRefs);
  const receiptId = item?.selectedCapacityReceiptId === null
    ? null
    : text(item?.selectedCapacityReceiptId);

  const valid = item?.disposition === CONTINUITY_TASK_DISPOSITION.CONTINUE
    && item?.dispatchAllowed === true
    && item?.windowsBound !== true
    && SAFE_ID.test(missionId)
    && SAFE_ID.test(taskId)
    && ALLOWED_ROUTES.has(route)
    && SAFE_ID.test(adapter)
    && proofRefs !== null
    && (route === MISSION_CONTROLLER_ROUTE.CODEX
      ? receiptId === null
      : SAFE_ID.test(receiptId || ''));

  if (!valid) return null;

  return freeze({
    schemaVersion: GITHUB_CONTINUITY_EXECUTION_GRANT_SCHEMA,
    grantId: `continuity:${missionId}:${taskId}:${index + 1}`,
    repository: plan.repository,
    expectedSourceHead: plan.expectedSourceHead,
    missionId,
    taskId,
    route,
    adapter,
    selectedCapacityReceiptId: receiptId,
    proofRefs: freeze([...proofRefs]),
    grantedAtUtc: nowUtc,
    executionScope: 'SOURCE_ONLY_EXISTING_ROUTE',
    windowsBound: false,
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
}

export function buildGitHubContinuityExecutionBatch(input = {}) {
  const repository = text(input.repository);
  const expectedSourceHead = text(input.expectedSourceHead).toLowerCase();
  const nowUtc = text(input.nowUtc);
  const plan = input.continuityPlan;

  if (!REPOSITORY.test(repository) || !FULL_SHA.test(expectedSourceHead) || timestamp(nowUtc) === null) {
    return blockedBatch(input, 'GITHUB_CONTINUITY_EXECUTION_IDENTITY_INVALID');
  }
  if (!plan || plan.schemaVersion !== GITHUB_CONTINUITY_MODE_SCHEMA) {
    return blockedBatch(input, 'GITHUB_CONTINUITY_PLAN_INVALID');
  }
  if (plan.repository !== repository || text(plan.expectedSourceHead).toLowerCase() !== expectedSourceHead) {
    return blockedBatch(input, 'GITHUB_CONTINUITY_PLAN_IDENTITY_MISMATCH');
  }
  if (plan.state !== GITHUB_CONTINUITY_STATE.GITHUB_CONTINUITY) {
    return blockedBatch(input, 'GITHUB_CONTINUITY_NOT_ACTIVE');
  }
  if (plan.recoveryHandoffRequired !== true
      || plan.sourceMutationAuthorityAdded !== false
      || plan.mergeAuthorityAdded !== false
      || plan.deploymentAuthorityAdded !== false
      || plan.runtimeMutationAuthorityAdded !== false
      || plan.duplicateDispatchAllowed !== false
      || plan.protectedMergeDispatchAllowed !== false) {
    return blockedBatch(input, 'GITHUB_CONTINUITY_PLAN_AUTHORITY_INVALID');
  }

  const tasks = list(plan.tasks);
  if (tasks.length > MAX_GRANTS) return blockedBatch(input, 'GITHUB_CONTINUITY_TASK_BOUND_EXCEEDED');

  const grants = [];
  for (let index = 0; index < tasks.length; index += 1) {
    const item = tasks[index];
    if (item?.disposition !== CONTINUITY_TASK_DISPOSITION.CONTINUE) continue;
    const grant = buildGrant(plan, item, index, nowUtc);
    if (!grant) return blockedBatch(input, 'GITHUB_CONTINUITY_CONTINUE_TASK_INVALID');
    grants.push(grant);
  }

  return freeze({
    schemaVersion: GITHUB_CONTINUITY_EXECUTION_BATCH_SCHEMA,
    repository,
    expectedSourceHead,
    evaluatedAtUtc: nowUtc,
    continuityState: plan.state,
    grants: freeze(grants),
    grantCount: grants.length,
    sourceMutationAuthorityAdded: false,
    mergeAuthorityAdded: false,
    deploymentAuthorityAdded: false,
    runtimeMutationAuthorityAdded: false,
    protectedMergeDispatchAllowed: false,
    duplicateDispatchAllowed: false,
    arbitraryCommandAllowed: false,
    blocker: '',
    finalVerdict: grants.length > 0
      ? 'GITHUB_CONTINUITY_EXECUTION_GRANTS_READY'
      : 'GITHUB_CONTINUITY_NO_EXECUTABLE_SOURCE_WORK',
  });
}
