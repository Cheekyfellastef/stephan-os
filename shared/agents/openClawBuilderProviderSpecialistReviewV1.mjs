import { createHash } from 'node:crypto';

import {
  OPENCLAW_BUILDER_PROVIDER_SPECIALIST_PATHS_V1,
  OPENCLAW_PROVIDER_POOL_SPECIALIST_PATHS_V1,
  analyzeOpenClawBuilderProviderSpecialistReviewV1 as analyzeLegacyOpenClawBuilderProviderSpecialistReviewV1,
} from './openClawBuilderProviderSpecialistReviewLegacyV1.mjs';
import {
  OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1,
  analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1,
} from './openClawBuilderProviderSpecialistReviewSuccessorV1.mjs';

export const OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1 = Object.freeze([
  'shared/agents/openClawProviderPoolQualificationV1.mjs',
  'shared/agents/openClawProviderPoolQualificationV1.test.mjs',
]);

export {
  OPENCLAW_BUILDER_PROVIDER_SPECIALIST_PATHS_V1,
  OPENCLAW_PROVIDER_POOL_SPECIALIST_PATHS_V1,
  OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1,
};

const PR1999_SCHEMA = 'stephanos.openclaw-provider-pool-pr1999-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const LINEAGE_SCHEMA = 'stephanos.windows-authority-reconciliation-lineage.v1';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const PR1999 = 1999;
const PR1999_BRANCH = 'codex/five-builder-flywheel-repair';
const SHA = /^[0-9a-f]{40}$/;
const text = (value) => String(value ?? '').trim();
const finding = (code, path) => Object.freeze({ severity: 'P0', code, summary: code, path });

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function exactPr1999Source(source, sourceHead, path) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(content, 'utf8');
  return Boolean(source && typeof source === 'object' && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA
    && source.repository === REPOSITORY
    && source.path === path
    && source.ref === sourceHead
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === size
    && size > 0
    && size <= 256 * 1024
    && SHA.test(text(source.blobSha))
    && source.blobSha === blobSha(content));
}

function exactPr1999Lineage(lineage, sourceHead, baseSha) {
  const parents = Array.isArray(lineage?.parents) ? lineage.parents : [];
  return lineage?.schemaVersion === LINEAGE_SCHEMA
    && lineage.repository === REPOSITORY
    && lineage.sourceHead === sourceHead
    && lineage.sourceCommitSha === sourceHead
    && lineage.baseSha === baseSha
    && lineage.liveMainBeforeSha === baseSha
    && lineage.liveMainAfterSha === baseSha
    && parents.includes(baseSha)
    && lineage?.comparison?.status === 'ahead'
    && Number.isSafeInteger(lineage?.comparison?.aheadBy)
    && lineage.comparison.aheadBy > 0
    && lineage.comparison.behindBy === 0
    && lineage.comparison.baseCommitSha === baseSha
    && lineage.comparison.mergeBaseCommitSha === baseSha;
}

function exactPr1999Escalation(analysis) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1.length) return false;
  if (!findings.every((item) => text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface')) return false;
  const paths = [...new Set(findings.map((item) => text(item?.path)))].sort();
  return JSON.stringify(paths) === JSON.stringify([...OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1].sort());
}

function requireLiterals(findings, source, path, rules) {
  for (const [literal, code] of rules) if (!source.includes(literal)) findings.push(finding(code, path));
}

function requirePatterns(findings, source, path, rules) {
  for (const [pattern, code] of rules) if (!pattern.test(source)) findings.push(finding(code, path));
}

function forbidPatterns(findings, source, path, rules) {
  for (const [pattern, code] of rules) if (pattern.test(source)) findings.push(finding(code, path));
}

function forbidPr1999ProviderPoolAuthority(findings, source, path) {
  forbidPatterns(findings, source, path, [
    [/from ['"]node:(?:child_process|http|https|net)['"]|require\(['"](?:child_process|http|https|net)['"]\)/, 'pr1999-provider-pool-process-network-authority-forbidden'],
    [/\b(?:exec|execSync|execFile|spawn|spawnSync|fork)\s*\(|shell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'pr1999-provider-pool-dynamic-execution-forbidden'],
    [/\bgit(?:\.exe)?\b[^\r\n]*(?:push|reset|clean|rebase|checkout|switch|merge|stash|fetch)\b/i, 'pr1999-provider-pool-git-mutation-forbidden'],
  ]);
}

function reviewPr1999ProviderPool(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["import { routeMissionControllerCapacity } from './missionControllerCapacityRouterV1.mjs';", 'pr1999-provider-pool-canonical-router-missing'],
    ['acquireSharedWorkspaceOperationLock', 'pr1999-provider-pool-operation-lock-missing'],
    ['validateExecutionReceipt', 'pr1999-provider-pool-execution-validator-missing'],
    ['validateSharedWorkspaceRecord', 'pr1999-provider-pool-workspace-validator-missing'],
    ["export const OPENCLAW_PROVIDER_POOL_PUBLISHER_ID = 'stephanos-openclaw-provider-pool-publisher-v1';", 'pr1999-provider-pool-publisher-id-not-fixed'],
    ['export const OPENCLAW_PROVIDER_POOL_COMPONENT_FILES = Object.freeze({', 'pr1999-provider-pool-component-map-missing'],
    ['export const OPENCLAW_PROVIDER_POOL_PUBLICATION_LOCK_SEGMENTS = Object.freeze([', 'pr1999-provider-pool-lock-identity-missing'],
    ["'openclaw-provider-pool'", 'pr1999-provider-pool-lock-scope-missing'],
    ["'publication.lock'", 'pr1999-provider-pool-lock-file-missing'],
    ['const OPENCLAW_QUALIFICATION_ISSUE = 1725;', 'pr1999-provider-pool-goal-not-fixed'],
    ["'SOURCE_CONSTRUCTION'", 'pr1999-provider-pool-source-operation-missing'],
    ["'FOCUSED_TESTS'", 'pr1999-provider-pool-test-operation-missing'],
    ['export function validateOpenClawQualificationAuthorityChain', 'pr1999-provider-pool-authority-chain-missing'],
    ["execution.workerType !== 'openclaw'", 'pr1999-provider-pool-worker-binding-missing'],
    ["execution.state !== 'completed'", 'pr1999-provider-pool-completed-execution-gate-missing'],
    ["authority.participantId !== 'stephanos'", 'pr1999-provider-pool-stephanos-authority-gate-missing'],
    ['candidate.qualificationAuthorityReceiptId === expected.authorityReceiptId', 'pr1999-provider-pool-capacity-authority-binding-missing'],
    ['sameStrings(operations, OPENCLAW_CAPACITY_OPERATIONS)', 'pr1999-provider-pool-exact-operations-gate-missing'],
    ['export function validateOpenClawProviderPoolStatusRecord', 'pr1999-provider-pool-status-validator-missing'],
    ['validatePublisherAttestation(status, expected.publisherPublicKeyPem)', 'pr1999-provider-pool-publisher-verification-missing'],
    ['component.componentDigest !== payloadDigest(component.payload)', 'pr1999-provider-pool-component-payload-digest-gate-missing'],
    ['component.componentDigest !== status.hostContextDigests[componentKey]', 'pr1999-provider-pool-status-component-digest-gate-missing'],
    ['status.sourceMutationAllowed !== false', 'pr1999-provider-pool-status-source-denial-missing'],
    ['status.mergeAuthority !== false', 'pr1999-provider-pool-status-merge-denial-missing'],
    ['status.leaseSeizureAllowed !== false', 'pr1999-provider-pool-status-lease-denial-missing'],
    ['status.duplicateDispatchAllowed !== false', 'pr1999-provider-pool-status-duplicate-denial-missing'],
    ['export async function publishOpenClawProviderPoolToSharedWorkspace', 'pr1999-provider-pool-publisher-missing'],
    ['OPENCLAW_PROVIDER_POOL_PUBLICATION_LOCK_SEGMENTS', 'pr1999-provider-pool-fixed-publication-lock-missing'],
    ['verifyOwnership()', 'pr1999-provider-pool-lock-ownership-recheck-missing'],
    ['await operationLock.release()', 'pr1999-provider-pool-lock-release-missing'],
    ['mergeAuthority: false', 'pr1999-provider-pool-merge-denial-missing'],
    ['leaseSeizureAllowed: false', 'pr1999-provider-pool-lease-denial-missing'],
    ['duplicateDispatchAllowed: false', 'pr1999-provider-pool-duplicate-dispatch-denial-missing'],
  ]);
  requirePatterns(findings, source, path, [
    [/algorithm:\s*'Ed25519'[\s\S]*signPayload\(null,[\s\S]*privateKeyPem/, 'pr1999-provider-pool-ed25519-signing-missing'],
    [/verifyPayload\([\s\S]*publicKeyPem[\s\S]*Buffer\.from\(attestation\.signature, 'base64'\)/, 'pr1999-provider-pool-ed25519-verification-missing'],
    [/writeAtomicJson\(root, \['receipts',[\s\S]*OPENCLAW_PROVIDER_POOL_COMPONENT_FILES\[componentKey\]/, 'pr1999-provider-pool-component-write-not-canonical'],
    [/writeAtomicJson\(root, \['status', 'openclaw-provider-pool-current\.json'\]/, 'pr1999-provider-pool-status-write-not-canonical'],
  ]);
  forbidPr1999ProviderPoolAuthority(findings, source, path);
}

function reviewPr1999ProviderPoolTests(source, path, findings) {
  requireLiterals(findings, source, path, [
    ['requires canonical completed OpenClaw execution, exact Shared Workspace projection, and Stephanos promotion receipt', 'pr1999-provider-pool-authority-positive-test-missing'],
    ['capacity is unusable without the exact validated qualification authority, worker and task class', 'pr1999-provider-pool-capacity-binding-test-missing'],
    ["supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS', 'MERGE_PULL_REQUEST']", 'pr1999-provider-pool-privileged-operation-negative-test-missing'],
    ['publishes only the complete trusted OpenClaw qualification chain to the canonical status path', 'pr1999-provider-pool-publication-positive-test-missing'],
    ["publisherId: 'forged-publisher'", 'pr1999-provider-pool-forged-publisher-test-missing'],
    ['ARBITRARY_SHELL', 'pr1999-provider-pool-arbitrary-shell-negative-test-missing'],
    ['Tampered after publication.', 'pr1999-provider-pool-post-publication-tamper-test-missing'],
    ['serializes concurrent OpenClaw provider-pool generations behind one fixed operation lock', 'pr1999-provider-pool-concurrency-lock-test-missing'],
    ['SHARED_WORKSPACE_OPERATION_LOCK_TIMEOUT', 'pr1999-provider-pool-lock-timeout-test-missing'],
    ['assert.deepEqual(finalValidation.hostContext, secondHost)', 'pr1999-provider-pool-final-generation-coherence-test-missing'],
  ]);
  forbidPatterns(findings, source, path, [
    [/shell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'pr1999-provider-pool-test-dynamic-execution-forbidden'],
  ]);
}

function analyzeOpenClawProviderPoolPr1999SpecialistReviewV1(input = {}) {
  const sourceHead = text(input.sourceHead).toLowerCase();
  const baseSha = text(input.baseSha).toLowerCase();
  const eligible = input.repository === REPOSITORY
    && Number(input.prNumber) === PR1999
    && text(input.branch) === PR1999_BRANCH
    && SHA.test(sourceHead)
    && SHA.test(baseSha)
    && exactPr1999Escalation(input.analysis);
  if (!eligible) return Object.freeze({
    schemaVersion: PR1999_SCHEMA, eligible: false, clean: false,
    reviewedPaths: Object.freeze([]), findings: Object.freeze([]), proofRefs: Object.freeze([]),
    finalVerdict: 'OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_NOT_APPLICABLE',
  });

  if (!exactPr1999Lineage(input.lineageEvidence, sourceHead, baseSha)) return Object.freeze({
    schemaVersion: PR1999_SCHEMA, eligible: true, clean: false,
    reviewedPaths: OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1,
    findings: Object.freeze([finding('pr1999-provider-pool-reconciliation-lineage-invalid', OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1[0])]),
    proofRefs: Object.freeze([]), finalVerdict: 'OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_FINDINGS',
  });

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const findings = [];
  const proofRefs = [];
  if (sources.length !== OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1.length) {
    findings.push(finding('pr1999-provider-pool-source-evidence-estate-mismatch', OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1[0]));
  }
  for (const path of OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1) {
    const candidates = sources.filter((source) => text(source?.path) === path);
    if (candidates.length !== 1 || !exactPr1999Source(candidates[0], sourceHead, path)) {
      findings.push(finding('pr1999-provider-pool-source-evidence-invalid', path));
      if (!path.endsWith('.test.mjs')) {
        for (const candidate of candidates) {
          if (typeof candidate?.content === 'string') forbidPr1999ProviderPoolAuthority(findings, candidate.content, path);
        }
      }
      continue;
    }
    if (path.endsWith('.test.mjs')) reviewPr1999ProviderPoolTests(candidates[0].content, path, findings);
    else reviewPr1999ProviderPool(candidates[0].content, path, findings);
    proofRefs.push(`proofs/openclaw-provider-pool-pr1999-specialist/${path}@${sourceHead}#${candidates[0].blobSha}`);
  }

  const clean = findings.length === 0;
  return Object.freeze({
    schemaVersion: PR1999_SCHEMA, eligible: true, clean,
    reviewedPaths: OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1,
    findings: Object.freeze(findings), proofRefs: Object.freeze(proofRefs),
    finalVerdict: clean ? 'OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_CLEAN' : 'OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_FINDINGS',
  });
}

export function analyzeOpenClawBuilderProviderSpecialistReviewV1(input = {}) {
  const legacy = analyzeLegacyOpenClawBuilderProviderSpecialistReviewV1(input);
  if (legacy.eligible) return legacy;
  const pr1999 = analyzeOpenClawProviderPoolPr1999SpecialistReviewV1(input);
  if (pr1999.eligible) return pr1999;
  return analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input);
}
