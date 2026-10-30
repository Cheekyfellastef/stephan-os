import { createHash } from 'node:crypto';
import { adjudicateForgeSidecarCapacity } from './stallSentinelReviewPipelineV1.mjs';

export const FORGE_M5_ACCEPTANCE_SCHEMA = 'stephanos.forge-shadow-m5-acceptance.v1';
export const FORGE_M5_ACCEPTANCE_VERDICT = Object.freeze({
  PASSED: 'FORGE_M5_ACCEPTANCE_PASSED',
  REQUIRED: 'FORGE_M5_ACCEPTANCE_REQUIRED',
  FAILED: 'FORGE_M5_ACCEPTANCE_FAILED',
  CAPACITY_NOT_PROVEN: 'FORGE_M5_CAPACITY_NOT_PROVEN',
  EVIDENCE_INVALID: 'FORGE_M5_EVIDENCE_INVALID',
});

const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^(?:sha256:)?[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,239}$/;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/@+-]+(?:\/[A-Za-z0-9._/@+-]+)*$/;
const SAFE_PROOF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function dense(value) {
  if (!Array.isArray(value)) return false;
  for (let i = 0; i < value.length; i += 1) if (!Object.hasOwn(value, i)) return false;
  return true;
}
function plain(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
}
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}
function exactKeys(value, expected) {
  if (!plain(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function digest(value) { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
function authority() {
  return freeze({ sourceMutation:false, branchMutation:false, publication:false, dispatch:false,
    merge:false, deployment:false, runtimeMutation:false, forgeExecution:false,
    podmanExecution:false, credentialAccess:false, arbitraryCommand:false, evidenceOnly:true });
}
function result(verdict, reasons = [], details = {}) {
  return freeze({ schemaVersion:FORGE_M5_ACCEPTANCE_SCHEMA, verdict,
    accepted:verdict === FORGE_M5_ACCEPTANCE_VERDICT.PASSED,
    reasons:[...new Set(reasons)], ...details, authority:authority() });
}

const RECEIPT_KEYS = ['receiptId','route','goalId','missionId','laneId','repository','baseHead','baseTree','intendedTree','changedFiles','focusedTestSuiteId','focusedTestsPassed','artifactDigests','proofRefs'];
const GOAL_KEYS = ['goalId','github','forge','protectedIntegration'];
const INTEGRATION_KEYS = ['repository','goalId','prNumber','head','tree','finalMainHead','finalMainTree','protected','proofRefs'];

function normalizeStrings(value, pattern, min = 0) {
  if (!dense(value) || value.length < min || value.length > 128) return null;
  const entries = value.map(text);
  if (entries.some((entry) => !pattern.test(entry)) || new Set(entries).size !== entries.length) return null;
  return [...entries].sort();
}
function normalizeReceipt(receipt, route, expected) {
  if (!exactKeys(receipt, RECEIPT_KEYS)) return null;
  if (!SAFE_ID.test(text(receipt.receiptId)) || receipt.route !== route
    || text(receipt.goalId) !== expected.goalId || !SAFE_ID.test(text(receipt.missionId))
    || !SAFE_ID.test(text(receipt.laneId)) || receipt.repository !== expected.repository
    || text(receipt.baseHead).toLowerCase() !== expected.baseHead
    || text(receipt.baseTree).toLowerCase() !== expected.baseTree
    || !SHA.test(text(receipt.intendedTree).toLowerCase())
    || !SAFE_ID.test(text(receipt.focusedTestSuiteId)) || receipt.focusedTestsPassed !== true) return null;
  const changedFiles = normalizeStrings(receipt.changedFiles, SAFE_PATH);
  const artifactDigests = normalizeStrings(receipt.artifactDigests, SHA256, 1);
  const proofRefs = normalizeStrings(receipt.proofRefs, SAFE_PROOF, 1);
  if (!changedFiles || !artifactDigests || !proofRefs) return null;
  return freeze({ ...receipt, baseHead:expected.baseHead, baseTree:expected.baseTree,
    intendedTree:text(receipt.intendedTree).toLowerCase(), changedFiles, artifactDigests, proofRefs });
}
function normalizeIntegration(value, expected, intendedTree) {
  if (!exactKeys(value, INTEGRATION_KEYS)) return null;
  const refs = normalizeStrings(value.proofRefs, SAFE_PROOF, 1);
  if (!refs || value.repository !== expected.repository || value.goalId !== expected.goalId
    || !Number.isSafeInteger(value.prNumber) || value.prNumber <= 0
    || !SHA.test(text(value.head).toLowerCase()) || text(value.tree).toLowerCase() !== intendedTree
    || !SHA.test(text(value.finalMainHead).toLowerCase()) || text(value.finalMainTree).toLowerCase() !== intendedTree
    || value.protected !== true) return null;
  return freeze({ ...value, head:text(value.head).toLowerCase(), tree:intendedTree,
    finalMainHead:text(value.finalMainHead).toLowerCase(), finalMainTree:intendedTree, proofRefs:refs });
}
function normalizeGoal(value, expected) {
  if (!exactKeys(value, GOAL_KEYS) || text(value.goalId) !== expected.goalId) return null;
  const github = normalizeReceipt(value.github, 'CHATGPT_GITHUB', expected);
  const forge = normalizeReceipt(value.forge, 'FOUNDRY_FORGE', expected);
  if (!github || !forge) return null;
  const integration = normalizeIntegration(value.protectedIntegration, expected, github.intendedTree);
  if (!integration) return null;
  return freeze({ goalId:expected.goalId, github, forge, protectedIntegration:integration });
}

export function evaluateForgeShadowM5Acceptance(input = {}) {
  if (!plain(input)) return result(FORGE_M5_ACCEPTANCE_VERDICT.EVIDENCE_INVALID, ['input-not-data-only']);
  const allowed = ['repository','canonicalMainHead','canonicalMainTree','nowUtc','forgeSidecar','goalRuns'];
  if (Reflect.ownKeys(input).some((key) => typeof key !== 'string' || !allowed.includes(key))) {
    return result(FORGE_M5_ACCEPTANCE_VERDICT.EVIDENCE_INVALID, ['input-shape-invalid']);
  }
  const repository = text(input.repository);
  const baseHead = text(input.canonicalMainHead).toLowerCase();
  const baseTree = text(input.canonicalMainTree).toLowerCase();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !SHA.test(baseHead) || !SHA.test(baseTree)
    || !Number.isFinite(Date.parse(text(input.nowUtc)))) {
    return result(FORGE_M5_ACCEPTANCE_VERDICT.EVIDENCE_INVALID, ['canonical-identity-invalid']);
  }

  const forgeCapacity = adjudicateForgeSidecarCapacity(input.forgeSidecar, { nowUtc:input.nowUtc });
  if (!forgeCapacity?.runtimeReady || !forgeCapacity?.canCarryRealWork) {
    return result(FORGE_M5_ACCEPTANCE_VERDICT.CAPACITY_NOT_PROVEN, ['forge-m2-m3-runtime-capacity-not-proven'], { forgeCapacity });
  }
  if (forgeCapacity.repository !== repository || forgeCapacity.canonicalMainHead !== baseHead
    || forgeCapacity.canonicalMainTree !== baseTree) {
    return result(FORGE_M5_ACCEPTANCE_VERDICT.CAPACITY_NOT_PROVEN, ['forge-capacity-identity-mismatch'], { forgeCapacity });
  }

  if (!dense(input.goalRuns)) return result(FORGE_M5_ACCEPTANCE_VERDICT.EVIDENCE_INVALID, ['goal-runs-not-dense']);
  if (input.goalRuns.length < 2) return result(FORGE_M5_ACCEPTANCE_VERDICT.REQUIRED, ['two-distinct-real-goals-required'], { completedGoals:input.goalRuns.length });
  if (input.goalRuns.length > 2) return result(FORGE_M5_ACCEPTANCE_VERDICT.EVIDENCE_INVALID, ['exactly-two-goals-required']);
  const ids = input.goalRuns.map((entry) => text(entry?.goalId));
  if (ids.some((id) => !SAFE_ID.test(id)) || new Set(ids).size !== 2) {
    return result(FORGE_M5_ACCEPTANCE_VERDICT.EVIDENCE_INVALID, ['goal-identities-invalid-or-duplicated']);
  }

  const normalized = input.goalRuns.map((entry) => normalizeGoal(entry, { repository, baseHead, baseTree, goalId:text(entry.goalId) }));
  if (normalized.some((entry) => !entry)) return result(FORGE_M5_ACCEPTANCE_VERDICT.EVIDENCE_INVALID, ['goal-evidence-invalid']);

  const failures = [];
  for (const goal of normalized) {
    if (goal.github.receiptId === goal.forge.receiptId || goal.github.missionId === goal.forge.missionId
      || goal.github.laneId === goal.forge.laneId) failures.push(`${goal.goalId}:duplicate-execution-identity`);
    if (goal.github.intendedTree !== goal.forge.intendedTree) failures.push(`${goal.goalId}:intended-tree-mismatch`);
    if (canonicalJson(goal.github.changedFiles) !== canonicalJson(goal.forge.changedFiles)) failures.push(`${goal.goalId}:changed-file-estate-mismatch`);
    if (goal.github.focusedTestSuiteId !== goal.forge.focusedTestSuiteId) failures.push(`${goal.goalId}:focused-test-suite-mismatch`);
    if (canonicalJson(goal.github.artifactDigests) !== canonicalJson(goal.forge.artifactDigests)) failures.push(`${goal.goalId}:artifact-digest-mismatch`);
    if (goal.protectedIntegration?.tree !== goal.github.intendedTree) failures.push(`${goal.goalId}:protected-integration-tree-mismatch`);
  }
  if (failures.length) return result(FORGE_M5_ACCEPTANCE_VERDICT.FAILED, failures, { goalCount:normalized.length });

  const acceptanceDigest = digest({ repository, baseHead, baseTree,
    goals:normalized.map((goal) => ({ goalId:goal.goalId, tree:goal.github.intendedTree,
      files:goal.github.changedFiles, tests:goal.github.focusedTestSuiteId,
      artifacts:goal.github.artifactDigests, finalMainHead:goal.protectedIntegration.finalMainHead })) });
  return result(FORGE_M5_ACCEPTANCE_VERDICT.PASSED, [], {
    repository, canonicalMainHead:baseHead, canonicalMainTree:baseTree,
    goalCount:2, acceptedGoalIds:normalized.map((goal) => goal.goalId).sort(),
    acceptanceDigest:`sha256:${acceptanceDigest}`,
    forgeAuthorityReceiptIds:[forgeCapacity.m2ReceiptId, forgeCapacity.m3RuntimeReceiptId],
    protectedGitHubIntegrationRequired:true,
    nextMilestone:'M6_PARALLEL_CONSTRUCTION_DEFAULT_REVIEW',
  });
}
