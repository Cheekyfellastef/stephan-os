import {
  INDEPENDENT_REVIEW_ARTIFACT_FILE,
  INDEPENDENT_REVIEW_FINDINGS_ARTIFACT_KIND,
  INDEPENDENT_REVIEW_FINDINGS_ARTIFACT_SCHEMA_VERSION,
  independentReviewArtifactName,
  independentReviewFindingsArtifactPayloadSha256,
} from './operatorMergeReviewArtifactV1.mjs';
import {
  INDEPENDENT_REVIEW_MAX_RUN_ATTEMPT,
} from './independentReviewRetryPlanner.mjs';

export const INDEPENDENT_REVIEW_TERMINAL_FINDINGS_SCHEMA_VERSION =
  'stephanos.independent-review-terminal-findings.v1';
export const INDEPENDENT_REVIEW_TERMINAL_FINDINGS_MARKER =
  'stephanos:independent-review-terminal-findings:v1';

const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;
const FINDINGS_KEYS = Object.freeze([
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
  'createdAtUtc',
  'analysis',
  'payloadSha256',
]);

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function sameKeys(value, expected) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  );
}

function boundedText(value, max) {
  const normalized = text(value);
  return normalized.length <= max ? normalized : '';
}

function counts(findings) {
  return Object.freeze({
    P0: findings.filter((finding) => finding.severity === 'P0').length,
    P1: findings.filter((finding) => finding.severity === 'P1').length,
    P2: findings.filter((finding) => finding.severity === 'P2').length,
  });
}

function normalizeFinding(finding) {
  if (!finding || typeof finding !== 'object' || Array.isArray(finding)) return null;
  const severity = text(finding.severity);
  const code = boundedText(finding.code, 160);
  const path = boundedText(finding.path, 320);
  if (!['P0', 'P1', 'P2'].includes(severity) || !code) return null;
  return Object.freeze({ severity, code, ...(path ? { path } : {}) });
}

export function terminalFindingsMarkerV1({ workflowRunId, workflowRunAttempt, sourceHead, payloadSha256 } = {}) {
  const runId = positiveInteger(workflowRunId);
  const attempt = positiveInteger(workflowRunAttempt);
  const head = text(sourceHead).toLowerCase();
  const digest = text(payloadSha256).toLowerCase();
  if (!runId || !attempt || !SHA.test(head) || !SHA256.test(digest)) {
    throw new Error('terminal findings marker requires exact run, attempt, head and payload digest');
  }
  return `<!-- ${INDEPENDENT_REVIEW_TERMINAL_FINDINGS_MARKER} run=${runId} attempt=${attempt} head=${head} payload=${digest} -->`;
}

export function planIndependentReviewTerminalFindingsPublicationV1({
  artifact,
  repository,
  prNumber,
  branch,
  sourceHead,
  baseSha,
  workflowRunId,
  workflowRunAttempt,
} = {}) {
  const expectedRepository = text(repository);
  const expectedPrNumber = positiveInteger(prNumber);
  const expectedBranch = text(branch);
  const expectedHead = text(sourceHead).toLowerCase();
  const expectedBase = text(baseSha).toLowerCase();
  const expectedRunId = positiveInteger(workflowRunId);
  const expectedAttempt = positiveInteger(workflowRunAttempt);

  if (!REPOSITORY.test(expectedRepository)
      || !expectedPrNumber
      || !BRANCH.test(expectedBranch)
      || expectedBranch.includes('..')
      || !SHA.test(expectedHead)
      || !SHA.test(expectedBase)
      || !expectedRunId
      || !expectedAttempt) {
    throw new Error('terminal findings publication requires exact repository/PR/branch/head/base/run identity');
  }

  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    return Object.freeze({ decision: 'NO_ARTIFACT', publishAllowed: false });
  }
  if (artifact.schemaVersion !== INDEPENDENT_REVIEW_FINDINGS_ARTIFACT_SCHEMA_VERSION
      || artifact.kind !== INDEPENDENT_REVIEW_FINDINGS_ARTIFACT_KIND) {
    return Object.freeze({ decision: 'NOT_FINDINGS_ARTIFACT', publishAllowed: false });
  }
  if (!sameKeys(artifact, FINDINGS_KEYS)) throw new Error('terminal findings artifact schema is not closed-world');
  if (artifact.artifactFile !== INDEPENDENT_REVIEW_ARTIFACT_FILE
      || artifact.artifactName !== independentReviewArtifactName(expectedRunId, expectedAttempt)
      || artifact.repository !== expectedRepository
      || artifact.prNumber !== expectedPrNumber
      || artifact.branch !== expectedBranch
      || text(artifact.sourceHead).toLowerCase() !== expectedHead
      || text(artifact.baseSha).toLowerCase() !== expectedBase
      || artifact.workflowRunId !== expectedRunId
      || artifact.workflowRunAttempt !== expectedAttempt) {
    throw new Error('terminal findings artifact identity does not match the exact review run');
  }
  const createdAtUtc = text(artifact.createdAtUtc);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(createdAtUtc) || !Number.isFinite(Date.parse(createdAtUtc))) {
    throw new Error('terminal findings artifact timestamp is invalid');
  }
  const payloadSha256 = text(artifact.payloadSha256).toLowerCase();
  if (!SHA256.test(payloadSha256)
      || independentReviewFindingsArtifactPayloadSha256(artifact) !== payloadSha256) {
    throw new Error('terminal findings artifact payload digest is invalid');
  }

  const analysis = artifact.analysis;
  const rawFindings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  const normalizedFindings = rawFindings.map(normalizeFinding);
  if (analysis?.schemaVersion !== 'stephanos.independent-security-analysis.v1'
      || analysis?.finalVerdict !== 'INDEPENDENT_SECURITY_REVIEW_FINDINGS'
      || analysis?.verdict !== 'findings'
      || rawFindings.length < 1
      || rawFindings.length > 100
      || normalizedFindings.some((finding) => !finding)
      || !Array.isArray(analysis?.proofRefs)
      || analysis.proofRefs.length < 1) {
    throw new Error('terminal findings artifact analysis is invalid');
  }
  const observedCounts = counts(normalizedFindings);
  if (analysis?.counts?.P0 !== observedCounts.P0
      || analysis?.counts?.P1 !== observedCounts.P1
      || analysis?.counts?.P2 !== observedCounts.P2) {
    throw new Error('terminal findings artifact counts do not match findings');
  }

  if (expectedAttempt < INDEPENDENT_REVIEW_MAX_RUN_ATTEMPT) {
    return Object.freeze({
      decision: 'RETRY_BUDGET_REMAINS',
      publishAllowed: false,
      workflowRunId: expectedRunId,
      workflowRunAttempt: expectedAttempt,
      payloadSha256,
      counts: observedCounts,
    });
  }

  const visibleFindings = Object.freeze(normalizedFindings.slice(0, 20));
  return Object.freeze({
    decision: 'PUBLISH_TERMINAL_FINDINGS',
    publishAllowed: true,
    schemaVersion: INDEPENDENT_REVIEW_TERMINAL_FINDINGS_SCHEMA_VERSION,
    repository: expectedRepository,
    prNumber: expectedPrNumber,
    branch: expectedBranch,
    sourceHead: expectedHead,
    baseSha: expectedBase,
    workflowRunId: expectedRunId,
    workflowRunAttempt: expectedAttempt,
    payloadSha256,
    counts: observedCounts,
    findings: visibleFindings,
    omittedFindings: normalizedFindings.length - visibleFindings.length,
    marker: terminalFindingsMarkerV1({
      workflowRunId: expectedRunId,
      workflowRunAttempt: expectedAttempt,
      sourceHead: expectedHead,
      payloadSha256,
    }),
    authority: Object.freeze({
      reviewAccepted: false,
      sourceMutationAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      runtimeMutationAllowed: false,
      providerQualificationAllowed: false,
      arbitraryCommandAllowed: false,
    }),
  });
}

export function renderIndependentReviewTerminalFindingsCommentV1(plan = {}) {
  if (plan?.decision !== 'PUBLISH_TERMINAL_FINDINGS' || plan?.publishAllowed !== true || !text(plan?.marker)) {
    throw new Error('terminal findings comment requires an admitted publication plan');
  }
  const packet = {
    schemaVersion: plan.schemaVersion,
    repository: plan.repository,
    prNumber: plan.prNumber,
    branch: plan.branch,
    sourceHead: plan.sourceHead,
    baseSha: plan.baseSha,
    workflowRunId: plan.workflowRunId,
    workflowRunAttempt: plan.workflowRunAttempt,
    payloadSha256: plan.payloadSha256,
    counts: plan.counts,
    findings: plan.findings,
    omittedFindings: plan.omittedFindings,
    authority: plan.authority,
  };
  return [
    plan.marker,
    '## Provider-neutral independent review terminal findings',
    '',
    'The canonical independent review reached the bounded retry limit with exact-head findings. This is a blocker receipt, not review acceptance or merge authority. A later head change requires a new exact-head review.',
    '',
    '```json',
    JSON.stringify(packet, null, 2),
    '```',
  ].join('\n');
}
