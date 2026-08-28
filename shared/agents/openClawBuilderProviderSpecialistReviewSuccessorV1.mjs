import { createHash } from 'node:crypto';

export const OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1 = Object.freeze([
  'scripts/windows/restart-approved-stephanos-runtime.ps1',
]);

const SCHEMA = 'stephanos.openclaw-builder-provider-specialist-review-successor.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const CANONICAL_REPOSITORY = 'Cheekyfellastef/stephan-os';
const FULL_SHA = /^[a-f0-9]{40}$/;
const HARDLINK_PR = 2048;
const HARDLINK_BRANCH = 'fix/battle-bridge-canonical-git-hardlink-v1';
const HARDLINK_PATH = OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1[0];
const HARDLINK_BLOB_SHA = 'cbcf5972fc52be2ab459843be9c66382b5a6b569';

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

function exactEscalation(analysis) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  return findings.length === 1
    && text(findings[0]?.severity).toUpperCase() === 'P0'
    && text(findings[0]?.code) === 'unsupported-high-risk-surface'
    && text(findings[0]?.path) === HARDLINK_PATH;
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

export function analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input = {}) {
  const repository = text(input.repository);
  const prNumber = Number(input.prNumber);
  const branch = text(input.branch);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const baseSha = text(input.baseSha).toLowerCase();
  const eligible = repository === CANONICAL_REPOSITORY
    && prNumber === HARDLINK_PR
    && branch === HARDLINK_BRANCH
    && FULL_SHA.test(sourceHead)
    && FULL_SHA.test(baseSha)
    && exactEscalation(input.analysis);

  if (!eligible) return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: false,
    clean: false,
    reviewedPaths: Object.freeze([]),
    findings: Object.freeze([]),
    proofRefs: Object.freeze([]),
    finalVerdict: 'OPENCLAW_BUILDER_PROVIDER_SUCCESSOR_SPECIALIST_NOT_APPLICABLE',
  });

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
