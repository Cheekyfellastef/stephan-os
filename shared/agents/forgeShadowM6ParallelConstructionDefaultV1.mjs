import {
  FORGE_M5_ACCEPTANCE_SCHEMA,
  FORGE_M5_ACCEPTANCE_VERDICT,
} from './forgeShadowM5AcceptanceV1.mjs';

export const FORGE_M6_PARALLEL_DEFAULT_SCHEMA = 'stephanos.forge-shadow-m6-parallel-construction-default.v1';
export const FORGE_M6_PARALLEL_DEFAULT_DECISION = Object.freeze({
  DEFAULT_FORGE: 'FOUNDRY_FORGE_DEFAULT_RECOMMENDED',
  PRESERVE_ACTIVE_OWNER: 'PRESERVE_ACTIVE_OWNER',
  GITHUB_ONLY: 'GITHUB_ONLY_RECOMMENDED',
  M5_REQUIRED: 'FORGE_M5_ACCEPTANCE_REQUIRED',
  INVALID: 'FORGE_M6_CANDIDATE_INVALID',
});

const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,239}$/;
const SAFE_SCOPE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/;
const SAFE_PROOF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const TASK_CLASSES = new Set(['SOURCE_BUILD','SOURCE_REPAIR','SOURCE_VERIFICATION']);
const SAFE_OPERATIONS = new Set(['READ_SOURCE','WRITE_SOURCE','RUN_FOCUSED_TESTS','PREPARE_REVIEW_PACKET','PREPARE_PROOF_PACKET']);
const CANDIDATE_KEYS = ['candidateId','taskClass','repository','canonicalMainHead','canonicalMainTree','resourceScopes','operations','sourceOnly','requiresRuntime','requiresDeployment','requiresMerge','requiresCredentialAccess','estimatedParallelGainSeconds','proofRefs'];
const ACTIVE_KEYS = ['active','ownerRoute','candidateId','resourceScopes','proofRefs'];

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function plain(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
}
function dense(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) return false;
  return true;
}
function exactKeys(value, expected) {
  if (!plain(value)) return false;
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== 'string')) return false;
  const sorted = actual.sort();
  const wanted = [...expected].sort();
  return sorted.length === wanted.length && sorted.every((key,index) => key === wanted[index]);
}
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}
function uniqueStrings(value, pattern, maximum = 128) {
  if (!dense(value) || value.length > maximum) return null;
  const entries = value.map(text);
  if (entries.some((entry) => !pattern.test(entry)) || new Set(entries).size !== entries.length) return null;
  return [...entries].sort();
}
function authority() {
  return freeze({ dispatch:false, sourceMutation:false, branchMutation:false, publication:false,
    merge:false, deployment:false, runtimeMutation:false, forgeExecution:false,
    podmanExecution:false, credentialAccess:false, arbitraryCommand:false, recommendationOnly:true });
}
function result(decision, reasons = [], details = {}) {
  return freeze({ schemaVersion:FORGE_M6_PARALLEL_DEFAULT_SCHEMA, decision,
    recommendedRoute:details.recommendedRoute ?? null,
    protectedIntegrationRoute:'CHATGPT_GITHUB', reasons:[...new Set(reasons)],
    ...details, authority:authority() });
}
function validM5(value) {
  if (!plain(value)) return false;
  return value.schemaVersion === FORGE_M5_ACCEPTANCE_SCHEMA
    && value.verdict === FORGE_M5_ACCEPTANCE_VERDICT.PASSED
    && value.accepted === true
    && value.goalCount === 2
    && value.protectedGitHubIntegrationRequired === true
    && value.nextMilestone === 'M6_PARALLEL_CONSTRUCTION_DEFAULT_REVIEW'
    && REPOSITORY.test(text(value.repository))
    && SHA.test(text(value.canonicalMainHead).toLowerCase())
    && SHA.test(text(value.canonicalMainTree).toLowerCase())
    && SHA256.test(text(value.acceptanceDigest).toLowerCase())
    && dense(value.acceptedGoalIds) && value.acceptedGoalIds.length === 2
    && dense(value.forgeAuthorityReceiptIds) && value.forgeAuthorityReceiptIds.length === 2
    && value.authority?.evidenceOnly === true
    && value.authority?.dispatch === false
    && value.authority?.sourceMutation === false
    && value.authority?.merge === false
    && value.authority?.runtimeMutation === false;
}
function normalizeCandidate(value, m5) {
  if (!exactKeys(value,CANDIDATE_KEYS)) return null;
  const candidateId = text(value.candidateId);
  const repository = text(value.repository);
  const canonicalMainHead = text(value.canonicalMainHead).toLowerCase();
  const canonicalMainTree = text(value.canonicalMainTree).toLowerCase();
  const resourceScopes = uniqueStrings(value.resourceScopes,SAFE_SCOPE,128);
  const operations = uniqueStrings(value.operations,SAFE_ID,32);
  const proofRefs = uniqueStrings(value.proofRefs,SAFE_PROOF,128);
  if (!SAFE_ID.test(candidateId) || !TASK_CLASSES.has(value.taskClass)
    || repository !== m5.repository || canonicalMainHead !== m5.canonicalMainHead
    || canonicalMainTree !== m5.canonicalMainTree || !resourceScopes || resourceScopes.length === 0
    || !operations || operations.length === 0 || operations.some((entry) => !SAFE_OPERATIONS.has(entry))
    || !proofRefs || value.sourceOnly !== true
    || value.requiresRuntime !== false || value.requiresDeployment !== false
    || value.requiresMerge !== false || value.requiresCredentialAccess !== false
    || typeof value.estimatedParallelGainSeconds !== 'number'
    || !Number.isFinite(value.estimatedParallelGainSeconds) || value.estimatedParallelGainSeconds < 0
    || value.estimatedParallelGainSeconds > 30 * 24 * 60 * 60) return null;
  return freeze({ ...value, candidateId, repository, canonicalMainHead, canonicalMainTree,
    resourceScopes, operations, proofRefs });
}
function normalizeActive(value) {
  if (value == null) return freeze({ active:false, ownerRoute:null, candidateId:null, resourceScopes:[], proofRefs:[] });
  if (!exactKeys(value,ACTIVE_KEYS) || typeof value.active !== 'boolean') return null;
  const ownerRoute = value.ownerRoute == null ? null : text(value.ownerRoute);
  const candidateId = value.candidateId == null ? null : text(value.candidateId);
  const scopes = uniqueStrings(value.resourceScopes,SAFE_SCOPE,128);
  const proofRefs = uniqueStrings(value.proofRefs,SAFE_PROOF,128);
  if (!scopes || !proofRefs) return null;
  if (value.active) {
    if (!SAFE_ID.test(ownerRoute) || !SAFE_ID.test(candidateId) || scopes.length === 0 || proofRefs.length === 0) return null;
  } else if (ownerRoute !== null || candidateId !== null || scopes.length !== 0 || proofRefs.length !== 0) return null;
  return freeze({ active:value.active, ownerRoute, candidateId, resourceScopes:scopes, proofRefs });
}

export function planForgeM6ParallelConstructionDefault(input = {}) {
  if (!plain(input)) return result(FORGE_M6_PARALLEL_DEFAULT_DECISION.INVALID,['input-not-data-only']);
  const allowed = ['m5Acceptance','candidate','activeDispatch'];
  if (Reflect.ownKeys(input).some((key) => typeof key !== 'string' || !allowed.includes(key))) {
    return result(FORGE_M6_PARALLEL_DEFAULT_DECISION.INVALID,['input-shape-invalid']);
  }
  if (!validM5(input.m5Acceptance)) {
    return result(FORGE_M6_PARALLEL_DEFAULT_DECISION.M5_REQUIRED,['genuine-m5-acceptance-required']);
  }
  const m5 = input.m5Acceptance;
  const candidate = normalizeCandidate(input.candidate,m5);
  if (!candidate) return result(FORGE_M6_PARALLEL_DEFAULT_DECISION.INVALID,['candidate-contract-invalid']);
  const active = normalizeActive(input.activeDispatch);
  if (!active) return result(FORGE_M6_PARALLEL_DEFAULT_DECISION.INVALID,['active-dispatch-contract-invalid']);

  if (active.active) {
    const overlap = candidate.resourceScopes.some((scope) => active.resourceScopes.includes(scope));
    if (active.candidateId === candidate.candidateId || overlap) {
      return result(FORGE_M6_PARALLEL_DEFAULT_DECISION.PRESERVE_ACTIVE_OWNER,['active-owner-is-authoritative'],{
        recommendedRoute:active.ownerRoute, candidateId:candidate.candidateId,
        activeOwnerRoute:active.ownerRoute, activeOwnerProofRefs:active.proofRefs,
        resourceScopes:candidate.resourceScopes, forgeDefaultEligible:false });
    }
  }

  if (candidate.estimatedParallelGainSeconds === 0) {
    return result(FORGE_M6_PARALLEL_DEFAULT_DECISION.GITHUB_ONLY,['no-positive-parallel-gain'],{
      recommendedRoute:'CHATGPT_GITHUB', candidateId:candidate.candidateId,
      resourceScopes:candidate.resourceScopes, forgeDefaultEligible:false });
  }

  return result(FORGE_M6_PARALLEL_DEFAULT_DECISION.DEFAULT_FORGE,[],{
    recommendedRoute:'FOUNDRY_FORGE', candidateId:candidate.candidateId,
    resourceScopes:candidate.resourceScopes, estimatedParallelGainSeconds:candidate.estimatedParallelGainSeconds,
    forgeDefaultEligible:true, m5AcceptanceDigest:m5.acceptanceDigest,
    forgeAuthorityReceiptIds:[...m5.forgeAuthorityReceiptIds],
    proofRefs:[...candidate.proofRefs], activeDispatchDisjoint:active.active === true });
}
