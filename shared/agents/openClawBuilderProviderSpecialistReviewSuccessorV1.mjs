import { createHash } from 'node:crypto';

export const OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1 = Object.freeze([
  'scripts/windows/restart-approved-stephanos-runtime.ps1',
]);

export const OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1 = Object.freeze([
  '.github/workflows/openclaw-update-preflight-proof.yml',
  'scripts/openclaw-update-preflight.mjs',
  'scripts/openclaw-update-preflight.test.mjs',
  'shared/agents/openClawUpdatePreflightV1.mjs',
  'shared/agents/openClawUpdatePreflightV1.test.mjs',
]);

const SCHEMA = 'stephanos.openclaw-builder-provider-specialist-review-successor.v1';
const OC9_SCHEMA = 'stephanos.openclaw-update-preflight-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const CANONICAL_REPOSITORY = 'Cheekyfellastef/stephan-os';
const FULL_SHA = /^[a-f0-9]{40}$/;
const HARDLINK_PR = 2048;
const HARDLINK_BRANCH = 'fix/battle-bridge-canonical-git-hardlink-v1';
const HARDLINK_PATH = OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1[0];
const HARDLINK_BLOB_SHA = 'cbcf5972fc52be2ab459843be9c66382b5a6b569';
const OC9_PR = 1654;
const OC9_BRANCH = 'agent/1415-openclaw-update-preflight-v1';

const text = (value) => String(value ?? '').trim();
const finding = (code, path = HARDLINK_PATH) => Object.freeze({
  severity: 'P0',
  code,
  summary: code,
  path,
});

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function exactHardlinkEscalation(analysis) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  return findings.length === 1
    && text(findings[0]?.severity).toUpperCase() === 'P0'
    && text(findings[0]?.code) === 'unsupported-high-risk-surface'
    && text(findings[0]?.path) === HARDLINK_PATH;
}

function exactOc9Escalation(analysis) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1.length) return false;
  if (!findings.every((item) => text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface')) return false;
  const paths = [...new Set(findings.map((item) => text(item?.path)))].sort();
  return JSON.stringify(paths) === JSON.stringify([...OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1].sort());
}

function exactLineage(lineage, sourceHead, baseSha) {
  const parents = Array.isArray(lineage?.parents) ? lineage.parents.map((item) => text(item).toLowerCase()) : [];
  return lineage?.schemaVersion === 'stephanos.windows-authority-reconciliation-lineage.v1'
    && lineage?.repository === CANONICAL_REPOSITORY
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

function exactHardlinkSource(source, sourceHead) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(content, 'utf8');
  return Boolean(source && typeof source === 'object' && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA
    && source.repository === CANONICAL_REPOSITORY
    && source.path === HARDLINK_PATH
    && source.ref === sourceHead
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === size
    && size > 0
    && size <= 256 * 1024
    && source.blobSha === HARDLINK_BLOB_SHA
    && gitBlobSha(content) === HARDLINK_BLOB_SHA
    && content.includes("$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git.exe'")
    && content.includes('$canonicalGitLinkType = [string]$canonicalGitItem.LinkType')
    && content.includes("-and $canonicalGitLinkType -ne 'HardLink')")
    && content.includes('FileAttributes]::ReparsePoint')
    && content.includes('$resolvedCanonicalGit = [System.IO.Path]::GetFullPath($canonicalGitItem.FullName)')
    && content.includes('$canonicalNodeItem.LinkType'));
}

function exactOc9Source(source, sourceHead, path) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(content, 'utf8');
  return Boolean(source && typeof source === 'object' && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA
    && source.repository === CANONICAL_REPOSITORY
    && source.path === path
    && source.ref === sourceHead
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === size
    && size > 0
    && size <= 256 * 1024
    && FULL_SHA.test(text(source.blobSha).toLowerCase())
    && text(source.blobSha).toLowerCase() === gitBlobSha(content));
}

function requireLiterals(findings, source, path, rules) {
  for (const [literal, code] of rules) if (!source.includes(literal)) findings.push(finding(code, path));
}

function forbidPatterns(findings, source, path, rules) {
  for (const [pattern, code] of rules) if (pattern.test(source)) findings.push(finding(code, path));
}

function reviewOc9Workflow(source, path, findings) {
  requireLiterals(findings, source, path, [
    ['permissions:\n  contents: read', 'oc9-workflow-read-only-permission-missing'],
    ["node --check shared/agents/openClawUpdatePreflightV1.mjs", 'oc9-workflow-model-parse-proof-missing'],
    ["node --check scripts/openclaw-update-preflight.mjs", 'oc9-workflow-cli-parse-proof-missing'],
    ['node --test shared/agents/openClawUpdatePreflightV1.test.mjs scripts/openclaw-update-preflight.test.mjs', 'oc9-workflow-focused-proof-missing'],
    ['git diff --check', 'oc9-workflow-patch-hygiene-proof-missing'],
  ]);
  forbidPatterns(findings, source, path, [
    [/pull_request_target\s*:/i, 'oc9-workflow-pull-request-target-forbidden'],
    [/contents:\s*write|pull-requests:\s*write|actions:\s*write|checks:\s*write/i, 'oc9-workflow-write-permission-forbidden'],
    [/\bsecrets\.[A-Za-z0-9_]+/i, 'oc9-workflow-secret-consumption-forbidden'],
  ]);
}

function reviewOc9Cli(source, path, findings) {
  requireLiterals(findings, source, path, [
    ['const MAX_INPUT_BYTES = 256 * 1024;', 'oc9-cli-bounded-input-missing'],
    ['buildOpenClawUpdatePreflightV1(input)', 'oc9-cli-canonical-model-call-missing'],
    ['OPENCLAW_UPDATE_PREFLIGHT_ERROR=', 'oc9-cli-fail-closed-error-missing'],
    ['BLOCKED_WITH_RESTORE_PATH ? 2 : 0', 'oc9-cli-blocked-exit-contract-missing'],
  ]);
  forbidPatterns(findings, source, path, [
    [/from ['"]node:(?:child_process|fs|http|https|net)['"]|require\(['"](?:child_process|fs|http|https|net)['"]\)/, 'oc9-cli-process-filesystem-network-authority-forbidden'],
    [/shell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'oc9-cli-dynamic-execution-forbidden'],
  ]);
}

function reviewOc9CliTests(source, path, findings) {
  requireLiterals(findings, source, path, [
    ['CLI reads one bounded JSON observation from stdin and writes no mutation claim', 'oc9-cli-test-mutation-denial-missing'],
    ['CLI exits 2 for a blocked preflight while still returning the rollback packet', 'oc9-cli-test-blocked-rollback-missing'],
    ['CLI rejects malformed JSON without emitting a packet', 'oc9-cli-test-malformed-json-missing'],
    ['CLI entrypoint detection handles Windows paths without depending on file URL spelling', 'oc9-cli-test-windows-entrypoint-missing'],
  ]);
  forbidPatterns(findings, source, path, [
    [/shell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'oc9-cli-test-dynamic-execution-forbidden'],
    [/from ['"]node:(?:http|https|net)['"]|require\(['"](?:http|https|net)['"]\)/, 'oc9-cli-test-network-authority-forbidden'],
  ]);
}

function reviewOc9Model(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["APPROVAL_REQUIRED: 'APPROVAL_REQUIRED'", 'oc9-model-approval-status-missing'],
    ["BLOCKED_WITH_RESTORE_PATH: 'BLOCKED_WITH_RESTORE_PATH'", 'oc9-model-blocked-status-missing'],
    ["MANUAL_ONLY: 'MANUAL_ONLY'", 'oc9-model-manual-only-class-missing'],
    ['SECRET_PATH_PATTERN', 'oc9-model-secret-path-gate-missing'],
    ['OPENCLAW_GATEWAY_APPROVED_ENDPOINT', 'oc9-model-gateway-endpoint-binding-missing'],
    ['OPENCLAW_GATEWAY_STARTUP_SOURCE', 'oc9-model-gateway-source-binding-missing'],
    ['getOpenClawGatewayStartupCommand()', 'oc9-model-gateway-command-binding-missing'],
    ["mutationAllowed: false", 'oc9-model-mutation-denial-missing'],
    ["updateAttempted: false", 'oc9-model-update-attempt-denial-missing'],
    ["absolutePathsPublished: false", 'oc9-model-absolute-path-denial-missing'],
    ['REQUEST_EXACT_OPERATOR_APPROVAL', 'oc9-model-exact-approval-step-missing'],
    ['RESTORE_PREVIOUS_PINNED_OPENCLAW_PACKAGE', 'oc9-model-rollback-package-step-missing'],
    ['RESTORE_PROTECTED_CONFIG_SOURCE_AND_RUNTIME_IDENTITIES', 'oc9-model-rollback-protected-state-step-missing'],
  ]);
  forbidPatterns(findings, source, path, [
    [/from ['"]node:(?:child_process|fs|http|https|net)['"]|require\(['"](?:child_process|fs|http|https|net)['"]\)/, 'oc9-model-process-filesystem-network-authority-forbidden'],
    [/\b(?:exec|execSync|execFile|spawn|spawnSync|fork)\s*\(|shell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'oc9-model-dynamic-execution-forbidden'],
  ]);
}

function reviewOc9ModelTests(source, path, findings) {
  requireLiterals(findings, source, path, [
    ['builds a deterministic approval-required manifest without publishing absolute paths', 'oc9-model-test-deterministic-manifest-missing'],
    ['blocks unknown and secret-bearing inventory paths while retaining a rollback plan', 'oc9-model-test-secret-block-missing'],
    ['fails closed on gateway identity drift and unpinned update packets', 'oc9-model-test-gateway-drift-missing'],
    ['requires digests for protected identities but not rebuildable generated output', 'oc9-model-test-protected-digest-missing'],
    ['rejects conflicting duplicate path identities with order-independent blocked evidence', 'oc9-model-test-conflict-order-independence-missing'],
    ['fails closed on links, malformed existence evidence, invalid sizes and stale absent digests', 'oc9-model-test-malformed-inventory-missing'],
    ['reports no update needed when the pinned target version already matches', 'oc9-model-test-no-update-missing'],
  ]);
  forbidPatterns(findings, source, path, [
    [/shell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'oc9-model-test-dynamic-execution-forbidden'],
    [/from ['"]node:(?:http|https|net)['"]|require\(['"](?:http|https|net)['"]\)/, 'oc9-model-test-network-authority-forbidden'],
  ]);
}

function reviewOc9Source(source, path, findings) {
  if (path === '.github/workflows/openclaw-update-preflight-proof.yml') reviewOc9Workflow(source, path, findings);
  else if (path === 'scripts/openclaw-update-preflight.mjs') reviewOc9Cli(source, path, findings);
  else if (path === 'scripts/openclaw-update-preflight.test.mjs') reviewOc9CliTests(source, path, findings);
  else if (path === 'shared/agents/openClawUpdatePreflightV1.mjs') reviewOc9Model(source, path, findings);
  else if (path === 'shared/agents/openClawUpdatePreflightV1.test.mjs') reviewOc9ModelTests(source, path, findings);
}

function analyzeHardlink(input, repository, prNumber, branch, sourceHead, baseSha) {
  const eligible = repository === CANONICAL_REPOSITORY
    && prNumber === HARDLINK_PR
    && branch === HARDLINK_BRANCH
    && FULL_SHA.test(sourceHead)
    && FULL_SHA.test(baseSha)
    && exactHardlinkEscalation(input.analysis);
  if (!eligible) return null;

  if (!exactLineage(input.lineageEvidence, sourceHead, baseSha)) return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean: false,
    reviewedPaths: OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1,
    findings: Object.freeze([finding('battle-bridge-hardlink-reconciliation-lineage-invalid')]),
    proofRefs: Object.freeze([]),
    finalVerdict: 'OPENCLAW_BUILDER_PROVIDER_SUCCESSOR_SPECIALIST_FINDINGS',
  });

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const candidate = sources.length === 1 ? sources[0] : null;
  const clean = exactHardlinkSource(candidate, sourceHead);
  const findings = clean
    ? Object.freeze([])
    : Object.freeze([finding('battle-bridge-hardlink-exact-source-proof-invalid')]);
  const proofRefs = clean
    ? Object.freeze([
      `proofs/provider-neutral-windows-specialist/pr-${HARDLINK_PR}`,
      `proofs/provider-neutral-windows-specialist/${HARDLINK_PATH}@${sourceHead}#${HARDLINK_BLOB_SHA}`,
      'proofs/provider-neutral-windows-specialist/hardlink-only-canonical-git-identity',
    ])
    : Object.freeze([]);

  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean,
    reviewedPaths: OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1,
    findings,
    proofRefs,
    finalVerdict: clean
      ? 'OPENCLAW_BUILDER_PROVIDER_SUCCESSOR_SPECIALIST_CLEAN'
      : 'OPENCLAW_BUILDER_PROVIDER_SUCCESSOR_SPECIALIST_FINDINGS',
  });
}

function analyzeOc9(input, repository, prNumber, branch, sourceHead, baseSha) {
  const eligible = repository === CANONICAL_REPOSITORY
    && prNumber === OC9_PR
    && branch === OC9_BRANCH
    && FULL_SHA.test(sourceHead)
    && FULL_SHA.test(baseSha)
    && exactOc9Escalation(input.analysis);
  if (!eligible) return null;

  if (!exactLineage(input.lineageEvidence, sourceHead, baseSha)) return Object.freeze({
    schemaVersion: OC9_SCHEMA,
    eligible: true,
    clean: false,
    reviewedPaths: OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1,
    findings: Object.freeze([finding('oc9-update-preflight-reconciliation-lineage-invalid', OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1[0])]),
    proofRefs: Object.freeze([]),
    finalVerdict: 'OPENCLAW_UPDATE_PREFLIGHT_SPECIALIST_FINDINGS',
  });

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const findings = [];
  const proofRefs = [];
  if (sources.length !== OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1.length) {
    findings.push(finding('oc9-update-preflight-source-evidence-estate-mismatch', OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1[0]));
  }

  for (const path of OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1) {
    const candidates = sources.filter((source) => text(source?.path) === path);
    if (candidates.length !== 1 || !exactOc9Source(candidates[0], sourceHead, path)) {
      findings.push(finding('oc9-update-preflight-source-evidence-invalid', path));
      continue;
    }
    reviewOc9Source(candidates[0].content, path, findings);
    proofRefs.push(`proofs/openclaw-update-preflight-specialist/pr-${OC9_PR}/${path}@${sourceHead}#${candidates[0].blobSha}`);
  }

  const clean = findings.length === 0;
  return Object.freeze({
    schemaVersion: OC9_SCHEMA,
    eligible: true,
    clean,
    reviewedPaths: OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1,
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: clean
      ? 'OPENCLAW_UPDATE_PREFLIGHT_SPECIALIST_CLEAN'
      : 'OPENCLAW_UPDATE_PREFLIGHT_SPECIALIST_FINDINGS',
  });
}

export function analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input = {}) {
  const repository = text(input.repository);
  const prNumber = Number(input.prNumber);
  const branch = text(input.branch);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const baseSha = text(input.baseSha).toLowerCase();

  const hardlink = analyzeHardlink(input, repository, prNumber, branch, sourceHead, baseSha);
  if (hardlink) return hardlink;
  const oc9 = analyzeOc9(input, repository, prNumber, branch, sourceHead, baseSha);
  if (oc9) return oc9;

  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: false,
    clean: false,
    reviewedPaths: Object.freeze([]),
    findings: Object.freeze([]),
    proofRefs: Object.freeze([]),
    finalVerdict: 'OPENCLAW_BUILDER_PROVIDER_SUCCESSOR_SPECIALIST_NOT_APPLICABLE',
  });
}
