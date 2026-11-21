import { createHash } from 'node:crypto';
import {
  buildProtectedSecurityReviewReceipt,
  validateTrustedProtectedReviewReceipt,
} from './operatorMergeApprovalGate.mjs';
import {
  bindIndependentReviewReceiptToBase,
  validateIndependentReviewBaseBinding,
} from './operatorMergeBaseBindingV1.mjs';
import { validateQualifiedSpecialistReviewArtifact } from './qualifiedSpecialistReviewV1.mjs';

export const INDEPENDENT_REVIEW_ARTIFACT_SCHEMA_VERSION = 'stephanos.independent-review-artifact.v1';
export const INDEPENDENT_REVIEW_ARTIFACT_SPECIALIST_SCHEMA_VERSION = 'stephanos.independent-review-artifact.v2';
export const INDEPENDENT_REVIEW_ARTIFACT_KIND = 'stephanos.independent-review.artifact';
export const INDEPENDENT_REVIEW_FINDINGS_ARTIFACT_SCHEMA_VERSION = 'stephanos.independent-review-findings-artifact.v1';
export const INDEPENDENT_REVIEW_FINDINGS_ARTIFACT_KIND = 'stephanos.independent-review.findings-artifact';
export const INDEPENDENT_REVIEW_ARTIFACT_FILE = 'independent-review-result.json';
export const INDEPENDENT_REVIEW_ARTIFACT_MAX_BYTES = 256 * 1024;

const INDEPENDENT_REVIEW_FINDINGS_MAX_PROOF_REFS = 200;
const INDEPENDENT_REVIEW_FINDINGS_INLINE_PROOF_REFS = INDEPENDENT_REVIEW_FINDINGS_MAX_PROOF_REFS - 1;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const API_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REPOSITORY_PATTERN = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const BRANCH_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,239}$/i;
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const ARTIFACT_V1_KEYS = Object.freeze([
  'schemaVersion',
  'kind',
  'artifactName',
  'artifactFile',
  'repository',
  'prNumber',
  'branch',
  'sourceHead',
  'baseSha',
  'workflowRunId',
  'workflowRunAttempt',
  'reviewMode',
  'createdAtUtc',
  'receipt',
  'payloadSha256',
]);
const ARTIFACT_V2_KEYS = Object.freeze([
  ...ARTIFACT_V1_KEYS,
  'specialistReviewArtifact',
]);

function text(value) {
  return String(value ?? '').trim();
}

function strictPositiveInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function nonNegativeInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : -1;
}

function unique(values) {
  return [...new Set(values)];
}

function sameKeys(value, expected) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  );
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

function boundFindingsAnalysis(analysis = {}) {
  const proofRefs = Array.isArray(analysis.proofRefs) ? analysis.proofRefs : [];
  if (proofRefs.length <= INDEPENDENT_REVIEW_FINDINGS_MAX_PROOF_REFS) return analysis;
  const included = proofRefs.slice(0, INDEPENDENT_REVIEW_FINDINGS_INLINE_PROOF_REFS);
  const omitted = proofRefs.length - included.length;
  const digest = createHash('sha256').update(canonicalJson(proofRefs), 'utf8').digest('hex');
  return Object.freeze({
    ...analysis,
    proofRefs: Object.freeze([
      ...included,
      [
        'proofs/independent-review/proof-ref-overflow',
        `total-${proofRefs.length}`,
        `included-${included.length}`,
        `omitted-${omitted}`,
        `sha256-${digest}`,
      ].join('/'),
    ]),
  });
}

function payloadCore(artifact = {}) {
  const core = {
    schemaVersion: artifact.schemaVersion,
    kind: artifact.kind,
    artifactName: artifact.artifactName,
    artifactFile: artifact.artifactFile,
    repository: artifact.repository,
    prNumber: artifact.prNumber,
    branch: artifact.branch,
    sourceHead: artifact.sourceHead,
    baseSha: artifact.baseSha,
    workflowRunId: artifact.workflowRunId,
    workflowRunAttempt: artifact.workflowRunAttempt,
    reviewMode: artifact.reviewMode,
    createdAtUtc: artifact.createdAtUtc,
    receipt: artifact.receipt,
  };
  if (artifact.schemaVersion === INDEPENDENT_REVIEW_ARTIFACT_SPECIALIST_SCHEMA_VERSION) {
    core.specialistReviewArtifact = artifact.specialistReviewArtifact;
  }
  return core;
}

function findingsPayloadCore(artifact = {}) {
  return {
    schemaVersion: artifact.schemaVersion,
    kind: artifact.kind,
    artifactName: artifact.artifactName,
    artifactFile: artifact.artifactFile,
    repository: artifact.repository,
    prNumber: artifact.prNumber,
    branch: artifact.branch,
    sourceHead: artifact.sourceHead,
    baseSha: artifact.baseSha,
    workflowRunId: artifact.workflowRunId,
    workflowRunAttempt: artifact.workflowRunAttempt,
    createdAtUtc: artifact.createdAtUtc,
    analysis: artifact.analysis,
  };
}

export function independentReviewArtifactName(workflowRunId, workflowRunAttempt) {
  const runId = strictPositiveInteger(workflowRunId);
  const runAttempt = strictPositiveInteger(workflowRunAttempt);
  if (!runId || !runAttempt) throw new Error('Independent review artifact name requires an exact run and attempt.');
  return `stephanos-independent-review-${runId}-attempt-${runAttempt}`;
}

export function independentReviewArtifactPayloadSha256(artifact = {}) {
  return createHash('sha256').update(canonicalJson(payloadCore(artifact)), 'utf8').digest('hex');
}

export function independentReviewFindingsArtifactPayloadSha256(artifact = {}) {
  return createHash('sha256').update(canonicalJson(findingsPayloadCore(artifact)), 'utf8').digest('hex');
}

export function buildIndependentReviewFindingsArtifact(input = {}) {
  const repository = text(input.repository);
  const prNumber = strictPositiveInteger(input.prNumber);
  const branch = text(input.branch);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const baseSha = text(input.baseSha).toLowerCase();
  const workflowRunId = strictPositiveInteger(input.workflowRunId);
  const workflowRunAttempt = strictPositiveInteger(input.workflowRunAttempt);
  const createdAtUtc = text(input.createdAtUtc || new Date().toISOString());
  const sourceAnalysis = input.analysis && typeof input.analysis === 'object' && !Array.isArray(input.analysis)
    ? input.analysis
    : {};
  const findings = Array.isArray(sourceAnalysis.findings) ? sourceAnalysis.findings : [];
  if (!REPOSITORY_PATTERN.test(repository)
      || !prNumber
      || !BRANCH_PATTERN.test(branch)
      || branch.includes('..')
      || !SHA_PATTERN.test(sourceHead)
      || !SHA_PATTERN.test(baseSha)
      || !workflowRunId
      || !workflowRunAttempt
      || !EXPLICIT_TIMEZONE.test(createdAtUtc)
      || !Number.isFinite(Date.parse(createdAtUtc))) {
    throw new Error('Independent review findings artifact identity is invalid.');
  }
  if (sourceAnalysis.schemaVersion !== 'stephanos.independent-security-analysis.v1'
      || sourceAnalysis.finalVerdict !== 'INDEPENDENT_SECURITY_REVIEW_FINDINGS'
      || sourceAnalysis.verdict !== 'findings'
      || findings.length < 1
      || findings.length > 100
      || !Array.isArray(sourceAnalysis.proofRefs)
      || sourceAnalysis.proofRefs.length < 1) {
    throw new Error('Independent review findings artifact requires bounded findings analysis.');
  }
  const analysis = boundFindingsAnalysis(sourceAnalysis);
  const core = {
    schemaVersion: INDEPENDENT_REVIEW_FINDINGS_ARTIFACT_SCHEMA_VERSION,
    kind: INDEPENDENT_REVIEW_FINDINGS_ARTIFACT_KIND,
    artifactName: independentReviewArtifactName(workflowRunId, workflowRunAttempt),
    artifactFile: INDEPENDENT_REVIEW_ARTIFACT_FILE,
    repository,
    prNumber,
    branch,
    sourceHead,
    baseSha,
    workflowRunId,
    workflowRunAttempt,
    createdAtUtc,
    analysis,
  };
  return Object.freeze({
    ...core,
    payloadSha256: independentReviewFindingsArtifactPayloadSha256(core),
  });
}

export function buildIndependentReviewArtifact(input = {}) {
  const repository = text(input.repository);
  const prNumber = strictPositiveInteger(input.prNumber);
  const branch = text(input.branch);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const baseSha = text(input.baseSha).toLowerCase();
  const workflowRunId = strictPositiveInteger(input.workflowRunId);
  const workflowRunAttempt = strictPositiveInteger(input.workflowRunAttempt);
  const createdAtUtc = text(input.createdAtUtc || new Date().toISOString());
  const specialistReviewArtifact = input.specialistReviewArtifact
    && typeof input.specialistReviewArtifact === 'object'
    && !Array.isArray(input.specialistReviewArtifact)
    ? input.specialistReviewArtifact
    : null;
  const receipt = bindIndependentReviewReceiptToBase(buildProtectedSecurityReviewReceipt({
    repository,
    prNumber,
    branch,
    sourceHead,
    workflowRunId,
    workflowRunAttempt,
    timestampUtc: createdAtUtc,
    analysis: input.analysis,
  }), baseSha);
  const review = validateTrustedProtectedReviewReceipt(receipt, {
    repository,
    prNumber,
    branch,
    expectedHead: sourceHead,
    workflowRunId,
    workflowRunAttempt,
  });
  const base = validateIndependentReviewBaseBinding(receipt, baseSha);
  const specialist = specialistReviewArtifact
    ? validateQualifiedSpecialistReviewArtifact(specialistReviewArtifact, {
      repository,
      prNumber,
      branch,
      sourceHead,
      baseSha,
    })
    : null;
  const specialistDigestProof = specialistReviewArtifact
    ? `proofs/specialist-review/artifact-sha256-${specialistReviewArtifact.payloadSha256}`
    : '';
  const receiptProofRefs = Array.isArray(receipt.proofRefs) ? receipt.proofRefs : [];
  if (!review.valid || !base.valid || (specialist && !specialist.valid)
    || (specialistDigestProof && !receiptProofRefs.includes(specialistDigestProof))) {
    throw new Error(`Independent review artifact receipt is invalid: ${[
      ...review.blockers,
      ...base.blockers,
      ...(specialist?.blockers || []),
      ...(specialistDigestProof && !receiptProofRefs.includes(specialistDigestProof)
        ? ['specialist-artifact-digest-proof-missing']
        : []),
    ].join(', ')}`);
  }
  const core = {
    schemaVersion: specialistReviewArtifact
      ? INDEPENDENT_REVIEW_ARTIFACT_SPECIALIST_SCHEMA_VERSION
      : INDEPENDENT_REVIEW_ARTIFACT_SCHEMA_VERSION,
    kind: INDEPENDENT_REVIEW_ARTIFACT_KIND,
    artifactName: independentReviewArtifactName(workflowRunId, workflowRunAttempt),
    artifactFile: INDEPENDENT_REVIEW_ARTIFACT_FILE,
    repository,
    prNumber,
    branch,
    sourceHead,
    baseSha,
    workflowRunId,
    workflowRunAttempt,
    reviewMode: review.reviewMode,
    createdAtUtc,
    receipt,
    ...(specialistReviewArtifact ? { specialistReviewArtifact } : {}),
  };
  return Object.freeze({
    ...core,
    payloadSha256: independentReviewArtifactPayloadSha256(core),
  });
}

export function validateIndependentReviewArtifact(artifact = {}, options = {}) {
  const repository = text(options.repository);
  const prNumber = strictPositiveInteger(options.prNumber);
  const branch = text(options.branch);
  const expectedHead = text(options.expectedHead).toLowerCase();
  const expectedBaseSha = text(options.expectedBaseSha).toLowerCase();
  const expectedPayloadSha256 = text(options.expectedPayloadSha256).toLowerCase();
  const workflowRunId = strictPositiveInteger(options.workflowRunId);
  const workflowRunAttempt = strictPositiveInteger(options.workflowRunAttempt);
  const blockers = [];
  const artifactIsObject = Boolean(artifact && typeof artifact === 'object' && !Array.isArray(artifact));
  artifact = artifactIsObject ? artifact : {};

  if (!artifactIsObject) blockers.push('independent-review-artifact-invalid');
  const specialistArtifactSchema = artifact.schemaVersion === INDEPENDENT_REVIEW_ARTIFACT_SPECIALIST_SCHEMA_VERSION;
  if (!sameKeys(artifact, specialistArtifactSchema ? ARTIFACT_V2_KEYS : ARTIFACT_V1_KEYS)) {
    blockers.push('independent-review-artifact-unbounded-schema');
  }
  if (![INDEPENDENT_REVIEW_ARTIFACT_SCHEMA_VERSION, INDEPENDENT_REVIEW_ARTIFACT_SPECIALIST_SCHEMA_VERSION]
    .includes(artifact.schemaVersion)) {
    blockers.push('independent-review-artifact-schema-mismatch');
  }
  if (artifact.kind !== INDEPENDENT_REVIEW_ARTIFACT_KIND) blockers.push('independent-review-artifact-kind-mismatch');
  if (!REPOSITORY_PATTERN.test(repository) || artifact.repository !== repository) {
    blockers.push('independent-review-artifact-repository-mismatch');
  }
  if (!prNumber || artifact.prNumber !== prNumber) blockers.push('independent-review-artifact-pr-mismatch');
  if (!BRANCH_PATTERN.test(branch) || branch.includes('..') || artifact.branch !== branch) {
    blockers.push('independent-review-artifact-branch-mismatch');
  }
  if (!SHA_PATTERN.test(expectedHead) || artifact.sourceHead !== expectedHead) {
    blockers.push('independent-review-artifact-head-mismatch');
  }
  if (!SHA_PATTERN.test(expectedBaseSha) || artifact.baseSha !== expectedBaseSha) {
    blockers.push('independent-review-artifact-base-mismatch');
  }
  if (!workflowRunId || artifact.workflowRunId !== workflowRunId) {
    blockers.push('independent-review-artifact-run-mismatch');
  }
  if (!workflowRunAttempt || artifact.workflowRunAttempt !== workflowRunAttempt) {
    blockers.push('independent-review-artifact-attempt-mismatch');
  }

  let expectedName = '';
  try {
    expectedName = independentReviewArtifactName(workflowRunId, workflowRunAttempt);
  } catch {
    blockers.push('independent-review-artifact-identity-invalid');
  }
  if (expectedName && artifact.artifactName !== expectedName) {
    blockers.push('independent-review-artifact-name-mismatch');
  }
  if (artifact.artifactFile !== INDEPENDENT_REVIEW_ARTIFACT_FILE) {
    blockers.push('independent-review-artifact-file-mismatch');
  }
  const createdAtUtc = text(artifact.createdAtUtc);
  if (!EXPLICIT_TIMEZONE.test(createdAtUtc) || !Number.isFinite(Date.parse(createdAtUtc))) {
    blockers.push('independent-review-artifact-time-invalid');
  }
  if (!SHA256_PATTERN.test(text(artifact.payloadSha256))) {
    blockers.push('independent-review-artifact-payload-digest-invalid');
  } else if (independentReviewArtifactPayloadSha256(artifact) !== artifact.payloadSha256) {
    blockers.push('independent-review-artifact-payload-digest-mismatch');
  }
  if (expectedPayloadSha256 && artifact.payloadSha256 !== expectedPayloadSha256) {
    blockers.push('independent-review-artifact-expected-payload-digest-mismatch');
  }

  const review = validateTrustedProtectedReviewReceipt(artifact.receipt, {
    repository,
    prNumber,
    branch,
    expectedHead,
    workflowRunId,
    workflowRunAttempt,
  });
  const base = validateIndependentReviewBaseBinding(artifact.receipt, expectedBaseSha);
  const specialist = specialistArtifactSchema
    ? validateQualifiedSpecialistReviewArtifact(artifact.specialistReviewArtifact, {
      repository,
      prNumber,
      branch,
      sourceHead: expectedHead,
      baseSha: expectedBaseSha,
    })
    : null;
  if (!review.valid) blockers.push(...review.blockers);
  if (!base.valid) blockers.push(...base.blockers);
  if (specialist && !specialist.valid) blockers.push(...specialist.blockers);
  if (specialistArtifactSchema) {
    const digestProof = `proofs/specialist-review/artifact-sha256-${text(artifact.specialistReviewArtifact?.payloadSha256)}`;
    if (!Array.isArray(artifact.receipt?.proofRefs) || !artifact.receipt.proofRefs.includes(digestProof)) {
      blockers.push('independent-review-specialist-artifact-digest-proof-missing');
    }
  }
  if (review.valid && artifact.reviewMode !== review.reviewMode) {
    blockers.push('independent-review-artifact-mode-mismatch');
  }
  if (text(artifact.receipt?.timestampUtc) !== createdAtUtc) {
    blockers.push('independent-review-artifact-receipt-time-mismatch');
  }
  if (artifact.receipt?.receiptId !== (
    `independent-review-pr${prNumber}-run${workflowRunId}-attempt${workflowRunAttempt}`
  )) {
    blockers.push('independent-review-artifact-receipt-id-mismatch');
  }

  return Object.freeze({
    valid: blockers.length === 0,
    artifact,
    review,
    base,
    specialist,
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'INDEPENDENT_REVIEW_ARTIFACT_BLOCKED'
      : 'INDEPENDENT_REVIEW_ARTIFACT_READY',
  });
}

export function validateIndependentReviewArtifactSet(payload = {}, options = {}) {
  const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
  const totalCount = nonNegativeInteger(payload?.total_count);
  const workflowRunId = strictPositiveInteger(options.workflowRunId);
  const workflowRunAttempt = strictPositiveInteger(options.workflowRunAttempt);
  const expectedArtifactId = options.expectedArtifactId === undefined
    ? 0
    : strictPositiveInteger(options.expectedArtifactId);
  const expectedArchiveDigest = text(options.expectedArchiveDigest).toLowerCase();
  const blockers = [];

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    blockers.push('independent-review-artifact-list-invalid');
  }
  let expectedName = '';
  try {
    expectedName = independentReviewArtifactName(workflowRunId, workflowRunAttempt);
  } catch {
    blockers.push('independent-review-artifact-run-identity-invalid');
  }
  if (totalCount < 0 || totalCount !== artifacts.length) {
    blockers.push('independent-review-artifact-pagination-mismatch');
  }
  const currentArtifacts = expectedName
    ? artifacts.filter((item) => text(item?.name) === expectedName)
    : [];
  if (currentArtifacts.length !== 1) blockers.push('independent-review-artifact-count-not-one');
  const allowedPriorName = new RegExp(
    `^stephanos-independent-review-${workflowRunId}-attempt-([1-9][0-9]*)$`,
  );
  const unexpectedArtifacts = artifacts.filter((item) => {
    if (text(item?.name) === expectedName) return false;
    const priorAttempt = text(item?.name).match(allowedPriorName);
    return !priorAttempt || Number.parseInt(priorAttempt[1], 10) >= workflowRunAttempt;
  });
  if (unexpectedArtifacts.length) blockers.push('independent-review-artifact-extra-unexpected');
  const artifact = currentArtifacts.length === 1
    ? currentArtifacts[0]
    : (artifacts.length === 1 ? artifacts[0] : {});
  const artifactId = strictPositiveInteger(artifact?.id);
  if (!artifactId) blockers.push('independent-review-artifact-id-invalid');
  if (expectedArtifactId && artifactId !== expectedArtifactId) blockers.push('independent-review-artifact-id-mismatch');
  if (expectedName && text(artifact?.name) !== expectedName) blockers.push('independent-review-artifact-name-mismatch');
  if (artifact?.expired !== false) blockers.push('independent-review-artifact-expired');
  if (
    !strictPositiveInteger(artifact?.size_in_bytes)
    || artifact.size_in_bytes > INDEPENDENT_REVIEW_ARTIFACT_MAX_BYTES
  ) {
    blockers.push('independent-review-artifact-size-invalid');
  }
  if (strictPositiveInteger(artifact?.workflow_run?.id) !== workflowRunId) {
    blockers.push('independent-review-artifact-workflow-run-mismatch');
  }
  const archiveDigest = text(artifact?.digest).toLowerCase();
  if (!API_DIGEST_PATTERN.test(archiveDigest)) {
    blockers.push('independent-review-artifact-archive-digest-invalid');
  }
  if (expectedArchiveDigest && archiveDigest !== expectedArchiveDigest) {
    blockers.push('independent-review-artifact-archive-digest-mismatch');
  }

  return Object.freeze({
    valid: blockers.length === 0,
    artifact,
    artifactId,
    artifactName: text(artifact?.name),
    archiveDigest,
    sizeInBytes: strictPositiveInteger(artifact?.size_in_bytes),
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'INDEPENDENT_REVIEW_ARTIFACT_SET_BLOCKED'
      : 'INDEPENDENT_REVIEW_ARTIFACT_SET_READY',
  });
}
