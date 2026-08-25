import { createHash } from 'node:crypto';

export const OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1 = Object.freeze([
  'shared/agents/openClawProviderPoolQualificationV1.mjs',
  'shared/agents/openClawProviderPoolQualificationV1.test.mjs',
]);

const SCHEMA = 'stephanos.openclaw-builder-provider-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const CANONICAL_REPOSITORY = 'Cheekyfellastef/stephan-os';
const SHA = /^[a-f0-9]{40}$/;
const SAFE_BRANCH = /^[A-Za-z0-9._/-]{1,255}$/;
const LEGACY_PROFILE_PRS = new Set([1910, 1905]);
const text = (value) => String(value ?? '').trim();
const unique = (values) => [...new Set(values)];
const finding = (code, path) => Object.freeze({ severity: 'P0', code, summary: code, path });

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function safeSuccessorBranch(value) {
  const branch = text(value);
  return SAFE_BRANCH.test(branch)
    && !branch.startsWith('/')
    && !branch.endsWith('/')
    && !branch.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

function escalationPaths(analysis) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1.length) return [];
  if (!findings.every((item) => (
    text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface'
  ))) return [];
  const paths = unique(findings.map((item) => text(item?.path))).sort();
  const expected = [...OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1].sort();
  return JSON.stringify(paths) === JSON.stringify(expected) ? paths : [];
}

function exactSource(source, repository, head, path) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(content, 'utf8');
  return Boolean(source && typeof source === 'object' && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA
    && source.repository === repository
    && source.path === path
    && source.ref === head
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === size
    && size > 0
    && size <= 256 * 1024
    && SHA.test(text(source.blobSha))
    && source.blobSha === blobSha(content));
}

function exactLineage(lineage, repository, sourceHead, baseSha) {
  const parents = Array.isArray(lineage?.parents) ? lineage.parents : [];
  return lineage?.schemaVersion === 'stephanos.windows-authority-reconciliation-lineage.v1'
    && lineage?.repository === repository
    && lineage?.sourceHead === sourceHead
    && lineage?.sourceCommitSha === sourceHead
    && lineage?.baseSha === baseSha
    && lineage?.liveMainBeforeSha === baseSha
    && lineage?.liveMainAfterSha === baseSha
    && parents.includes(baseSha)
    && lineage?.comparison?.status === 'ahead'
    && Number.isSafeInteger(lineage?.comparison?.aheadBy)
    && lineage.comparison.aheadBy > 0
    && lineage?.comparison?.behindBy === 0
    && lineage?.comparison?.baseCommitSha === baseSha
    && lineage?.comparison?.mergeBaseCommitSha === baseSha;
}

function requireLiterals(findings, source, path, rules) {
  for (const [literal, code] of rules) if (!source.includes(literal)) findings.push(finding(code, path));
}

function forbidPatterns(findings, source, path, rules) {
  for (const [pattern, code] of rules) if (pattern.test(source)) findings.push(finding(code, path));
}

function reviewProviderPool(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["import { routeMissionControllerCapacity } from './missionControllerCapacityRouterV1.mjs';", 'openclaw-provider-pool-canonical-router-missing'],
    ['validateExecutionReceipt', 'openclaw-provider-pool-execution-validator-missing'],
    ['toSharedWorkspaceExecutionReceipt', 'openclaw-provider-pool-workspace-projection-missing'],
    ['validateSharedWorkspaceRecord', 'openclaw-provider-pool-workspace-validator-missing'],
    ['const OPENCLAW_QUALIFICATION_ISSUE = 1725;', 'openclaw-provider-pool-goal-not-fixed'],
    ['export function validateOpenClawQualificationAuthorityChain', 'openclaw-provider-pool-authority-chain-gate-missing'],
    ['issueNumber: OPENCLAW_QUALIFICATION_ISSUE', 'openclaw-provider-pool-execution-goal-binding-missing'],
    ["execution.workerType !== 'openclaw'", 'openclaw-provider-pool-worker-type-binding-missing'],
    ["execution.state !== 'completed'", 'openclaw-provider-pool-completed-execution-gate-missing'],
    ['execution.operatorActionRequired !== false', 'openclaw-provider-pool-operator-action-gate-missing'],
    ['canonicalJson(host.realWorkWorkspaceReceipt) !== canonicalJson(canonicalWorkspace.record)', 'openclaw-provider-pool-canonical-workspace-gate-missing'],
    ["authority.participantId !== 'stephanos'", 'openclaw-provider-pool-stephanos-authority-gate-missing'],
    ['authority.relatedIssue !== String(OPENCLAW_QUALIFICATION_ISSUE)', 'openclaw-provider-pool-authority-goal-binding-missing'],
    ['authority.receivedRecordId !== execution.receiptId', 'openclaw-provider-pool-authority-execution-binding-missing'],
    ['authority.disposition !== OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION', 'openclaw-provider-pool-production-disposition-gate-missing'],
    ['candidate.qualificationAuthorityReceiptId === expected.authorityReceiptId', 'openclaw-provider-pool-capacity-authority-binding-missing'],
    ['const host = snapshot(trustedHostContext);', 'openclaw-provider-pool-trusted-host-only-gate-missing'],
    ['const openClawPoolEligible = qualification.valid && authority.valid && capacity.valid;', 'openclaw-provider-pool-complete-chain-gate-missing'],
    ['mergeAuthority: false', 'openclaw-provider-pool-merge-denial-missing'],
    ['leaseSeizureAllowed: false', 'openclaw-provider-pool-lease-denial-missing'],
    ['duplicateDispatchAllowed: false', 'openclaw-provider-pool-duplicate-dispatch-denial-missing'],
  ]);
  forbidPatterns(findings, source, path, [
    [/(?:from\s*|require\s*\(|import\s*\()\s*['"](?:node:)?(?:child_process|fs|fs\/promises)['"]/, 'openclaw-provider-pool-local-execution-authority-forbidden'],
    [/\b(?:exec|execSync|execFile|spawn|spawnSync|fork)\s*\(|shell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'openclaw-provider-pool-dynamic-execution-forbidden'],
  ]);
}

function reviewProviderPoolTests(source, path, findings) {
  requireLiterals(findings, source, path, [
    ['requires canonical completed OpenClaw execution, exact Shared Workspace projection, and Stephanos promotion receipt', 'openclaw-provider-pool-authority-chain-positive-test-missing'],
    ['capacity is unusable without the exact validated qualification authority, worker and task class', 'openclaw-provider-pool-capacity-binding-test-missing'],
    ['caller-shaped qualification, capacity and fake authority evidence cannot self-admit OpenClaw', 'openclaw-provider-pool-caller-forgery-test-missing'],
    ['syntactically valid trusted qualification without canonical authority cannot route', 'openclaw-provider-pool-syntax-only-forgery-test-missing'],
    ['existing mutation owner is preserved even when OpenClaw is canonically qualified', 'openclaw-provider-pool-owner-preservation-test-missing'],
    ['normal AUTO routing does not silently replace a healthy existing provider policy', 'openclaw-provider-pool-no-silent-route-replacement-test-missing'],
    ['assert.equal(result.mergeAuthority, false)', 'openclaw-provider-pool-merge-denial-test-missing'],
    ['assert.equal(result.leaseSeizureAllowed, false)', 'openclaw-provider-pool-lease-denial-test-missing'],
    ['assert.equal(result.duplicateDispatchAllowed, false)', 'openclaw-provider-pool-duplicate-dispatch-test-missing'],
  ]);
}

export function analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input = {}) {
  const repository = text(input.repository);
  const prNumber = Number(input.prNumber);
  const branch = text(input.branch);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const baseSha = text(input.baseSha).toLowerCase();
  const paths = escalationPaths(input.analysis);
  const eligible = repository === CANONICAL_REPOSITORY
    && Number.isSafeInteger(prNumber)
    && prNumber > 0
    && !LEGACY_PROFILE_PRS.has(prNumber)
    && safeSuccessorBranch(branch)
    && SHA.test(sourceHead)
    && SHA.test(baseSha)
    && paths.length === OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1.length;

  if (!eligible) return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: false,
    clean: false,
    reviewedPaths: Object.freeze([]),
    findings: Object.freeze([]),
    proofRefs: Object.freeze([]),
    finalVerdict: 'OPENCLAW_BUILDER_PROVIDER_SPECIALIST_NOT_APPLICABLE',
  });

  if (!exactLineage(input.lineageEvidence, repository, sourceHead, baseSha)) return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean: false,
    reviewedPaths: Object.freeze(paths),
    findings: Object.freeze([finding('openclaw-provider-pool-reconciliation-lineage-invalid', paths[0])]),
    proofRefs: Object.freeze([]),
    finalVerdict: 'OPENCLAW_BUILDER_PROVIDER_SPECIALIST_FINDINGS',
  });

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const findings = [];
  const proofRefs = [];
  for (const path of OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1) {
    const candidates = sources.filter((source) => text(source?.path) === path);
    if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
      findings.push(finding('openclaw-provider-pool-source-evidence-invalid', path));
      continue;
    }
    if (path.endsWith('/openClawProviderPoolQualificationV1.mjs')) {
      reviewProviderPool(candidates[0].content, path, findings);
    } else {
      reviewProviderPoolTests(candidates[0].content, path, findings);
    }
    proofRefs.push(`proofs/openclaw-builder-provider-specialist/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }
  if (sources.length !== OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1.length) {
    findings.push(finding('openclaw-provider-pool-source-evidence-estate-mismatch', OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1[0]));
  }

  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean: findings.length === 0,
    reviewedPaths: Object.freeze([...OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1]),
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: findings.length === 0
      ? 'OPENCLAW_BUILDER_PROVIDER_SPECIALIST_CLEAN'
      : 'OPENCLAW_BUILDER_PROVIDER_SPECIALIST_FINDINGS',
  });
}
