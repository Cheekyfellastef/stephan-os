import { createHash } from 'node:crypto';
import {
  createProviderNeutralReviewReceipt,
  validateProviderNeutralReviewReceipt,
} from './providerNeutralReviewV1.mjs';

export const QUALIFIED_SPECIALIST_REVIEW_MARKER = '<!-- stephanos-qualified-specialist-review -->';
export const QUALIFIED_SPECIALIST_REVIEWER_LOGIN = 'chatgpt-codex-connector';
export const QUALIFIED_SPECIALIST_REVIEWER_ID = 'chatgpt-github-specialist';
export const QUALIFIED_SPECIALIST_REVIEWER_CLASS = 'external-qualified';
export const QUALIFIED_SPECIALIST_REVIEW_PROVIDER = 'chatgpt-github-specialist';
export const QUALIFIED_SPECIALIST_REVIEW_MODEL_CLASS = 'gpt-5-6-thinking';
export const QUALIFIED_SPECIALIST_REVIEW_SCOPE = 'windows-authority-specialist';
export const QUALIFIED_SPECIALIST_IMPLEMENTER_PROVIDER = 'canonical-programme-builder';
export const QUALIFIED_SPECIALIST_FINDING_CODE = 'unsupported-high-risk-surface';
export const QUALIFIED_SPECIALIST_PROGRAMME_ISSUE = 1568;
export const QUALIFIED_SPECIALIST_ARTIFACT_SCHEMA_VERSION = 'stephanos.qualified-specialist-review-artifact.v1';
export const QUALIFIED_SPECIALIST_ARTIFACT_KIND = 'stephanos.qualified-specialist-review.artifact';
export const QUALIFIED_SPECIALIST_REVIEW_APP_SLUG = 'chatgpt-codex-connector';
export const QUALIFIED_SPECIALIST_REVIEW_APP_ID = 1144995;
export const QUALIFIED_SPECIALIST_REVIEW_BOT_ID = 199175422;

const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const MAX_REVIEW_CLOCK_SKEW_MS = 15 * 60 * 1000;
const MAX_SPECIALIST_RESPONSE_DELAY_MS = 30 * 60 * 1000;
const MAX_SPECIALIST_COMMENT_BODY_BYTES = 64 * 1024;
const QUALIFIED_REQUEST_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const SPECIALIST_ARTIFACT_KEYS = Object.freeze([
  'schemaVersion',
  'kind',
  'repository',
  'prNumber',
  'branch',
  'sourceHead',
  'baseSha',
  'escalationPaths',
  'request',
  'response',
  'receipt',
  'payloadSha256',
]);
const SPECIALIST_REQUEST_KEYS = Object.freeze([
  'id',
  'userLogin',
  'userId',
  'userType',
  'authorAssociation',
  'createdAtUtc',
  'updatedAtUtc',
  'body',
]);
const SPECIALIST_RESPONSE_KEYS = Object.freeze([
  'id',
  'userLogin',
  'userId',
  'userType',
  'appSlug',
  'appId',
  'createdAtUtc',
  'updatedAtUtc',
  'body',
  'reviewedCommitRef',
  'resolvedCommitId',
]);

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
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

function extractJsonObjects(markdown = '') {
  const objects = [];
  const pattern = /```json\s*([\s\S]*?)```/gi;
  for (const match of text(markdown).matchAll(pattern)) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) objects.push(parsed);
    } catch {
      // Malformed JSON cannot satisfy specialist review.
    }
  }
  return objects;
}

function specialistPathProof(path) {
  return `proofs/specialist-review/path/${path}`;
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function explicitTimeMs(value) {
  const valueText = text(value);
  if (!EXPLICIT_TIMEZONE.test(valueText)) return Number.NaN;
  return Date.parse(valueText);
}

function commentCreatedAtMs(comment = {}) {
  return explicitTimeMs(comment?.created_at ?? comment?.createdAtUtc);
}

function commentUpdatedAtMs(comment = {}) {
  return explicitTimeMs(comment?.updated_at ?? comment?.updatedAtUtc);
}

function compareCommentOrder(left = {}, right = {}) {
  const leftTime = commentCreatedAtMs(left);
  const rightTime = commentCreatedAtMs(right);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return Number.NaN;
  if (leftTime !== rightTime) return leftTime - rightTime;
  const leftId = positiveInteger(left?.id);
  const rightId = positiveInteger(right?.id);
  if (!leftId || !rightId) return Number.NaN;
  return leftId - rightId;
}

function commentComesAfter(left = {}, right = {}) {
  return compareCommentOrder(left, right) > 0;
}

function commentComesBefore(left = {}, right = {}) {
  return compareCommentOrder(left, right) < 0;
}

function commentBody(comment = {}) {
  return text(comment?.body);
}

function commentActor(comment = {}) {
  return comment?.user && typeof comment.user === 'object'
    ? comment.user
    : {
      login: comment?.userLogin,
      id: comment?.userId,
      type: comment?.userType,
    };
}

function commentAssociation(comment = {}) {
  return text(comment?.author_association ?? comment?.authorAssociation).toUpperCase();
}

function commentApp(comment = {}) {
  return comment?.performed_via_github_app && typeof comment.performed_via_github_app === 'object'
    ? comment.performed_via_github_app
    : { slug: comment?.appSlug, id: comment?.appId };
}

function isQualifiedOperatorInvocation(comment = {}) {
  return QUALIFIED_REQUEST_ASSOCIATIONS.has(commentAssociation(comment))
    && /(^|\s)@codex\b/i.test(commentBody(comment));
}

function qualifiedRequestMatches(comment = {}, options = {}) {
  const body = commentBody(comment);
  const createdAtMs = commentCreatedAtMs(comment);
  const updatedAtMs = commentUpdatedAtMs(comment);
  const sourceHead = text(options.sourceHead).toLowerCase();
  const baseSha = text(options.baseSha).toLowerCase();
  const paths = Array.isArray(options.paths) ? options.paths : [];
  return isQualifiedOperatorInvocation(comment)
    && Buffer.byteLength(body, 'utf8') <= MAX_SPECIALIST_COMMENT_BODY_BYTES
    && /qualified\s+Windows-authority\s+specialist\s+review/i.test(body)
    && /complete\s+exact-head\s+diff/i.test(body)
    && /fixed\s+executable/i.test(body)
    && body.toLowerCase().includes(sourceHead)
    && body.toLowerCase().includes(baseSha)
    && paths.length > 0
    && paths.every((path) => body.includes(path))
    && Number.isFinite(createdAtMs)
    && Number.isFinite(updatedAtMs)
    && updatedAtMs >= createdAtMs;
}

function isTrustedProviderResponse(comment = {}) {
  const actor = commentActor(comment);
  const app = commentApp(comment);
  return text(actor?.login).toLowerCase() === `${QUALIFIED_SPECIALIST_REVIEW_APP_SLUG}[bot]`
    && Number(actor?.id) === QUALIFIED_SPECIALIST_REVIEW_BOT_ID
    && text(actor?.type).toLowerCase() === 'bot'
    && text(app?.slug).toLowerCase() === QUALIFIED_SPECIALIST_REVIEW_APP_SLUG
    && Number(app?.id) === QUALIFIED_SPECIALIST_REVIEW_APP_ID;
}

export function qualifiedSpecialistCommentHeadRef(comment = {}) {
  if (!isTrustedProviderResponse(comment)) return '';
  const match = commentBody(comment).match(/Reviewed commit:\*?\*?\s*`?([a-f0-9]{7,40})`?(?![a-f0-9])/i);
  return text(match?.[1]).toLowerCase();
}

function responseMatches(comment = {}, options = {}) {
  const body = commentBody(comment);
  const createdAtMs = commentCreatedAtMs(comment);
  const updatedAtMs = commentUpdatedAtMs(comment);
  const reviewedCommitRef = qualifiedSpecialistCommentHeadRef(comment);
  const resolvedCommitId = text(comment?.resolved_commit_id ?? comment?.resolvedCommitId).toLowerCase();
  const sourceHead = text(options.sourceHead).toLowerCase();
  const reviewedHeadMatches = reviewedCommitRef.length >= 7
    && sourceHead.startsWith(reviewedCommitRef);
  const resolvedHeadMatches = !resolvedCommitId || resolvedCommitId === sourceHead;
  return isTrustedProviderResponse(comment)
    && Buffer.byteLength(body, 'utf8') <= MAX_SPECIALIST_COMMENT_BODY_BYTES
    && /^Codex Review:\s*Didn't find any major issues\./i.test(body)
    && reviewedHeadMatches
    && resolvedHeadMatches
    && Number.isFinite(createdAtMs)
    && Number.isFinite(updatedAtMs)
    && updatedAtMs === createdAtMs;
}

function normalizedRequest(comment = {}) {
  const actor = commentActor(comment);
  return Object.freeze({
    id: positiveInteger(comment?.id),
    userLogin: text(actor?.login),
    userId: positiveInteger(actor?.id),
    userType: text(actor?.type),
    authorAssociation: commentAssociation(comment),
    createdAtUtc: text(comment?.created_at ?? comment?.createdAtUtc),
    updatedAtUtc: text(comment?.updated_at ?? comment?.updatedAtUtc),
    body: commentBody(comment),
  });
}

function normalizedResponse(comment = {}) {
  const actor = commentActor(comment);
  const app = commentApp(comment);
  return Object.freeze({
    id: positiveInteger(comment?.id),
    userLogin: text(actor?.login),
    userId: positiveInteger(actor?.id),
    userType: text(actor?.type),
    appSlug: text(app?.slug),
    appId: positiveInteger(app?.id),
    createdAtUtc: text(comment?.created_at ?? comment?.createdAtUtc),
    updatedAtUtc: text(comment?.updated_at ?? comment?.updatedAtUtc),
    body: commentBody(comment),
    reviewedCommitRef: qualifiedSpecialistCommentHeadRef(comment),
    resolvedCommitId: text(comment?.resolved_commit_id ?? comment?.resolvedCommitId).toLowerCase(),
  });
}

function specialistArtifactPayloadCore(artifact = {}) {
  return {
    schemaVersion: artifact.schemaVersion,
    kind: artifact.kind,
    repository: artifact.repository,
    prNumber: artifact.prNumber,
    branch: artifact.branch,
    sourceHead: artifact.sourceHead,
    baseSha: artifact.baseSha,
    escalationPaths: artifact.escalationPaths,
    request: artifact.request,
    response: artifact.response,
    receipt: artifact.receipt,
  };
}

export function qualifiedSpecialistReviewArtifactPayloadSha256(artifact = {}) {
  return sha256(canonicalJson(specialistArtifactPayloadCore(artifact)));
}

function buildQualifiedSpecialistReviewArtifact(requestComment, responseComment, options = {}) {
  const repository = text(options.repository);
  const prNumber = positiveInteger(options.prNumber);
  const branch = text(options.branch);
  const sourceHead = text(options.sourceHead).toLowerCase();
  const baseSha = text(options.baseSha).toLowerCase();
  const paths = Object.freeze([...(Array.isArray(options.paths) ? options.paths : [])].sort());
  const request = normalizedRequest(requestComment);
  const response = normalizedResponse(responseComment);
  const reviewerProvider = `github-app-${response.appSlug}`.toLowerCase();
  const proofRefs = [
    `proofs/specialist-review/head-${sourceHead.slice(0, 12)}`,
    `proofs/specialist-review/base-${baseSha.slice(0, 12)}`,
    ...paths.map(specialistPathProof),
    `proofs/specialist-review/request-comment-${request.id}`,
    `proofs/specialist-review/response-comment-${response.id}`,
    `proofs/specialist-review/reviewer-app-${response.appId}`,
    `proofs/specialist-review/request-body-sha256-${sha256(request.body)}`,
    `proofs/specialist-review/response-body-sha256-${sha256(response.body)}`,
  ];
  const receipt = createProviderNeutralReviewReceipt({
    receiptId: `specialist-pr-${prNumber}-${sourceHead.slice(0, 12)}`,
    repository,
    issueNumber: QUALIFIED_SPECIALIST_PROGRAMME_ISSUE,
    prNumber,
    branch,
    sourceHead,
    reviewerId: reviewerProvider,
    reviewerClass: QUALIFIED_SPECIALIST_REVIEWER_CLASS,
    provider: reviewerProvider,
    modelClass: 'provider-managed-specialist',
    reviewerSessionId: `github-comment-${response.id}`,
    implementerProvider: QUALIFIED_SPECIALIST_IMPLEMENTER_PROVIDER,
    implementerSessionId: `pr-${prNumber}-implementation-lane`,
    riskTier: 'high',
    assuranceMode: 'specialist',
    reviewScope: ['complete-exact-head-diff', QUALIFIED_SPECIALIST_REVIEW_SCOPE, 'fixed-executable-and-task-authority'],
    findings: [],
    verdict: 'clean',
    timestampUtc: response.createdAtUtc,
    proofRefs,
    quorumChecks: [],
    blocker: '',
  });
  const core = {
    schemaVersion: QUALIFIED_SPECIALIST_ARTIFACT_SCHEMA_VERSION,
    kind: QUALIFIED_SPECIALIST_ARTIFACT_KIND,
    repository,
    prNumber,
    branch,
    sourceHead,
    baseSha,
    escalationPaths: paths,
    request,
    response,
    receipt,
  };
  return Object.freeze({
    ...core,
    payloadSha256: qualifiedSpecialistReviewArtifactPayloadSha256(core),
  });
}

export function validateQualifiedSpecialistReviewArtifact(artifact = {}, options = {}) {
  const repository = text(options.repository);
  const prNumber = positiveInteger(options.prNumber);
  const branch = text(options.branch);
  const sourceHead = text(options.sourceHead ?? options.expectedHead).toLowerCase();
  const baseSha = text(options.baseSha ?? options.expectedBaseSha).toLowerCase();
  const paths = Object.freeze([...(Array.isArray(options.paths) ? options.paths : artifact?.escalationPaths || [])].sort());
  const blockers = [];
  if (!sameKeys(artifact, SPECIALIST_ARTIFACT_KEYS)) blockers.push('specialist-artifact-unbounded-schema');
  if (artifact?.schemaVersion !== QUALIFIED_SPECIALIST_ARTIFACT_SCHEMA_VERSION) blockers.push('specialist-artifact-schema-mismatch');
  if (artifact?.kind !== QUALIFIED_SPECIALIST_ARTIFACT_KIND) blockers.push('specialist-artifact-kind-mismatch');
  if (artifact?.repository !== repository) blockers.push('specialist-artifact-repository-mismatch');
  if (artifact?.prNumber !== prNumber) blockers.push('specialist-artifact-pr-mismatch');
  if (artifact?.branch !== branch) blockers.push('specialist-artifact-branch-mismatch');
  if (artifact?.sourceHead !== sourceHead) blockers.push('specialist-artifact-head-mismatch');
  if (artifact?.baseSha !== baseSha) blockers.push('specialist-artifact-base-mismatch');
  if (JSON.stringify(artifact?.escalationPaths) !== JSON.stringify(paths)) blockers.push('specialist-artifact-paths-mismatch');
  if (!sameKeys(artifact?.request, SPECIALIST_REQUEST_KEYS)) blockers.push('specialist-artifact-request-schema-mismatch');
  if (!sameKeys(artifact?.response, SPECIALIST_RESPONSE_KEYS)) blockers.push('specialist-artifact-response-schema-mismatch');
  if (!qualifiedRequestMatches(artifact?.request, { sourceHead, baseSha, paths })) blockers.push('specialist-artifact-request-invalid');
  if (!responseMatches(artifact?.response, { sourceHead })) blockers.push('specialist-artifact-response-invalid');

  const requestCreatedAtMs = commentCreatedAtMs(artifact?.request);
  const requestUpdatedAtMs = commentUpdatedAtMs(artifact?.request);
  const responseCreatedAtMs = commentCreatedAtMs(artifact?.response);
  if (!Number.isFinite(requestCreatedAtMs)
    || !Number.isFinite(requestUpdatedAtMs)
    || !Number.isFinite(responseCreatedAtMs)
    || !commentComesAfter(artifact?.response, artifact?.request)
    || requestUpdatedAtMs > responseCreatedAtMs
    || responseCreatedAtMs - requestCreatedAtMs > MAX_SPECIALIST_RESPONSE_DELAY_MS) {
    blockers.push('specialist-artifact-causality-invalid');
  }

  const receiptValidation = validateProviderNeutralReviewReceipt(artifact?.receipt, {
    repository,
    issueNumber: QUALIFIED_SPECIALIST_PROGRAMME_ISSUE,
    prNumber,
    branch,
    expectedHead: sourceHead,
    riskTier: 'high',
  });
  if (!receiptValidation.valid) blockers.push(...receiptValidation.errors.map((item) => `specialist-artifact-receipt:${item}`));
  const expectedProvider = `github-app-${text(artifact?.response?.appSlug)}`.toLowerCase();
  if (artifact?.receipt?.reviewerId !== expectedProvider
    || artifact?.receipt?.provider !== expectedProvider
    || artifact?.receipt?.reviewerClass !== QUALIFIED_SPECIALIST_REVIEWER_CLASS
    || artifact?.receipt?.modelClass !== 'provider-managed-specialist'
    || artifact?.receipt?.reviewerSessionId !== `github-comment-${artifact?.response?.id}`
    || artifact?.receipt?.timestampUtc !== artifact?.response?.createdAtUtc) {
    blockers.push('specialist-artifact-receipt-provenance-mismatch');
  }
  if (artifact?.receipt?.verdict !== 'clean'
    || artifact?.receipt?.assuranceMode !== 'specialist'
    || artifact?.receipt?.riskTier !== 'high'
    || artifact?.receipt?.findings?.length !== 0
    || artifact?.receipt?.blocker !== '') {
    blockers.push('specialist-artifact-receipt-not-clean');
  }
  const expectedProofs = [
    `proofs/specialist-review/head-${sourceHead.slice(0, 12)}`,
    `proofs/specialist-review/base-${baseSha.slice(0, 12)}`,
    ...paths.map(specialistPathProof),
    `proofs/specialist-review/request-comment-${artifact?.request?.id}`,
    `proofs/specialist-review/response-comment-${artifact?.response?.id}`,
    `proofs/specialist-review/reviewer-app-${artifact?.response?.appId}`,
    `proofs/specialist-review/request-body-sha256-${sha256(text(artifact?.request?.body))}`,
    `proofs/specialist-review/response-body-sha256-${sha256(text(artifact?.response?.body))}`,
  ];
  for (const proof of expectedProofs) {
    if (!Array.isArray(artifact?.receipt?.proofRefs) || !artifact.receipt.proofRefs.includes(proof)) {
      blockers.push(`specialist-artifact-proof-missing:${proof}`);
    }
  }
  if (!/^[a-f0-9]{64}$/.test(text(artifact?.payloadSha256))) {
    blockers.push('specialist-artifact-payload-digest-invalid');
  } else if (qualifiedSpecialistReviewArtifactPayloadSha256(artifact) !== artifact.payloadSha256) {
    blockers.push('specialist-artifact-payload-digest-mismatch');
  }
  return Object.freeze({
    valid: blockers.length === 0,
    artifact,
    receipt: artifact?.receipt || null,
    blockers: Object.freeze(unique(blockers)),
  });
}

function providerNeutralArtifactCandidates(comments = [], options = {}) {
  const ordered = [...comments]
    .filter((comment) => positiveInteger(comment?.id) && Number.isFinite(commentCreatedAtMs(comment)))
    .sort((left, right) => commentCreatedAtMs(left) - commentCreatedAtMs(right) || positiveInteger(left.id) - positiveInteger(right.id));
  const requests = ordered.filter((comment) => qualifiedRequestMatches(comment, options));
  const candidates = [];
  for (const request of requests) {
    const nextInvocation = ordered.find((comment) => (
      commentComesAfter(comment, request)
      && isQualifiedOperatorInvocation(comment)
    ));
    const providerResults = ordered.filter((comment) => (
      commentComesAfter(comment, request)
      && (!nextInvocation || commentComesBefore(comment, nextInvocation))
      && isTrustedProviderResponse(comment)
      && /^Codex Review:/i.test(commentBody(comment))
    ));
    if (providerResults.length !== 1 || !responseMatches(providerResults[0], options)) continue;
    const artifact = buildQualifiedSpecialistReviewArtifact(request, providerResults[0], options);
    const validation = validateQualifiedSpecialistReviewArtifact(artifact, options);
    if (validation.valid) candidates.push(Object.freeze({
      valid: true,
      reviewId: artifact.response.id,
      receipt: artifact.receipt,
      artifact,
      blockers: Object.freeze([]),
    }));
  }
  return candidates;
}

export function qualifiedSpecialistEscalationPaths(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (analysis?.schemaVersion !== 'stephanos.independent-security-analysis.v1'
    || analysis?.finalVerdict !== 'INDEPENDENT_SECURITY_REVIEW_FINDINGS'
    || analysis?.verdict !== 'findings'
    || findings.length < 1
    || findings.some((item) => (
      text(item?.severity).toUpperCase() !== 'P0'
      || text(item?.code) !== QUALIFIED_SPECIALIST_FINDING_CODE
      || !text(item?.path)
    ))
    || Number(analysis?.counts?.P0) !== findings.length
    || Number(analysis?.counts?.P1) !== 0
    || Number(analysis?.counts?.P2) !== 0) {
    return Object.freeze([]);
  }
  return Object.freeze(unique(findings.map((item) => text(item.path))).sort());
}

function validateSpecialistReviewCandidate(review = {}, options = {}) {
  const repository = text(options.repository);
  const prNumber = positiveInteger(options.prNumber);
  const branch = text(options.branch);
  const sourceHead = text(options.sourceHead).toLowerCase();
  const baseSha = text(options.baseSha).toLowerCase();
  const paths = Array.isArray(options.paths) ? options.paths : [];
  const blockers = [];
  const reviewId = positiveInteger(review?.id);
  const body = text(review?.body);
  const submittedAt = text(review?.submitted_at);
  const submittedAtMs = Date.parse(submittedAt);

  if (!reviewId) blockers.push('specialist-review-id-invalid');
  if (text(review?.state).toUpperCase() !== 'APPROVED') blockers.push('specialist-review-not-approved');
  if (text(review?.commit_id).toLowerCase() !== sourceHead) blockers.push('specialist-review-head-mismatch');
  if (text(review?.user?.login).toLowerCase() !== QUALIFIED_SPECIALIST_REVIEWER_LOGIN) {
    blockers.push('specialist-reviewer-login-mismatch');
  }
  if (!EXPLICIT_TIMEZONE.test(submittedAt) || !Number.isFinite(submittedAtMs)) {
    blockers.push('specialist-review-time-invalid');
  }
  if (!body.includes(QUALIFIED_SPECIALIST_REVIEW_MARKER)) blockers.push('specialist-review-marker-missing');

  const objects = extractJsonObjects(body);
  if (objects.length !== 1) blockers.push('specialist-review-receipt-count-not-one');
  const receipt = objects[0] || {};
  const receiptValidation = validateProviderNeutralReviewReceipt(receipt, {
    repository,
    issueNumber: QUALIFIED_SPECIALIST_PROGRAMME_ISSUE,
    prNumber,
    branch,
    expectedHead: sourceHead,
    riskTier: 'high',
  });
  if (!receiptValidation.valid) {
    blockers.push(...receiptValidation.errors.map((item) => `specialist-receipt:${item}`));
  }

  const expectedSession = `github-specialist-${sourceHead.slice(0, 12)}`;
  const expectedImplementerSession = `pr-${prNumber}-implementation-lane`;
  if (receipt.reviewerId !== QUALIFIED_SPECIALIST_REVIEWER_ID) blockers.push('specialist-reviewer-id-mismatch');
  if (receipt.reviewerClass !== QUALIFIED_SPECIALIST_REVIEWER_CLASS) blockers.push('specialist-reviewer-class-mismatch');
  if (receipt.provider !== QUALIFIED_SPECIALIST_REVIEW_PROVIDER) blockers.push('specialist-review-provider-mismatch');
  if (receipt.modelClass !== QUALIFIED_SPECIALIST_REVIEW_MODEL_CLASS) blockers.push('specialist-review-model-class-mismatch');
  if (receipt.reviewerSessionId !== expectedSession) blockers.push('specialist-review-session-mismatch');
  if (receipt.implementerProvider !== QUALIFIED_SPECIALIST_IMPLEMENTER_PROVIDER
    || receipt.implementerSessionId !== expectedImplementerSession) {
    blockers.push('specialist-review-implementation-binding-mismatch');
  }
  if (receipt.assuranceMode !== 'specialist' || receipt.riskTier !== 'high') {
    blockers.push('specialist-review-assurance-mismatch');
  }
  if (receipt.verdict !== 'clean' || receipt.findings?.length !== 0 || receipt.blocker !== '') {
    blockers.push('specialist-review-not-clean');
  }
  if (!Array.isArray(receipt.reviewScope)
    || !receipt.reviewScope.includes('complete-exact-head-diff')
    || !receipt.reviewScope.includes(QUALIFIED_SPECIALIST_REVIEW_SCOPE)
    || !receipt.reviewScope.includes('fixed-executable-and-task-authority')) {
    blockers.push('specialist-review-scope-incomplete');
  }

  const expectedProofs = [
    `proofs/specialist-review/head-${sourceHead.slice(0, 12)}`,
    `proofs/specialist-review/base-${baseSha.slice(0, 12)}`,
    ...paths.map(specialistPathProof),
  ];
  for (const proof of expectedProofs) {
    if (!Array.isArray(receipt.proofRefs) || !receipt.proofRefs.includes(proof)) {
      blockers.push(`specialist-review-proof-missing:${proof}`);
    }
  }

  const receiptAtMs = Date.parse(text(receipt.timestampUtc));
  if (!Number.isFinite(receiptAtMs)
    || !Number.isFinite(submittedAtMs)
    || receiptAtMs > submittedAtMs
    || submittedAtMs - receiptAtMs > MAX_REVIEW_CLOCK_SKEW_MS) {
    blockers.push('specialist-review-receipt-time-not-bound');
  }

  return Object.freeze({
    valid: blockers.length === 0,
    reviewId,
    receipt,
    blockers: Object.freeze(unique(blockers)),
  });
}

export function adjudicateQualifiedSpecialistReview(input = {}) {
  const analysis = input.analysis && typeof input.analysis === 'object' ? input.analysis : {};
  if (analysis?.finalVerdict === 'INDEPENDENT_SECURITY_REVIEW_CLEAN'
    && analysis?.verdict === 'clean'
    && Array.isArray(analysis?.findings)
    && analysis.findings.length === 0) {
    return Object.freeze({ required: false, valid: true, analysis, receipt: null, artifact: null, reviewId: 0, blockers: Object.freeze([]) });
  }

  const paths = qualifiedSpecialistEscalationPaths(analysis);
  if (paths.length === 0) {
    return Object.freeze({
      required: false,
      valid: false,
      analysis,
      receipt: null,
      artifact: null,
      reviewId: 0,
      blockers: Object.freeze(['specialist-review-cannot-cover-non-escalation-findings']),
    });
  }

  const legacyCandidates = (Array.isArray(input.reviews) ? input.reviews : [])
    .map((review) => validateSpecialistReviewCandidate(review, {
      repository: input.repository,
      prNumber: input.prNumber,
      branch: input.branch,
      sourceHead: input.sourceHead,
      baseSha: input.baseSha,
      paths,
    }))
    .filter((candidate) => candidate.valid);
  const artifactCandidates = providerNeutralArtifactCandidates(
    Array.isArray(input.comments) ? input.comments : [],
    {
      repository: input.repository,
      prNumber: input.prNumber,
      branch: input.branch,
      sourceHead: input.sourceHead,
      baseSha: input.baseSha,
      paths,
    },
  );
  const candidates = [...legacyCandidates, ...artifactCandidates];

  if (candidates.length !== 1) {
    return Object.freeze({
      required: true,
      valid: false,
      analysis,
      receipt: null,
      artifact: null,
      reviewId: 0,
      blockers: Object.freeze([
        candidates.length === 0
          ? 'qualified-specialist-review-missing'
          : 'qualified-specialist-review-ambiguous',
      ]),
    });
  }

  const candidate = candidates[0];
  const receiptDigest = createHash('sha256')
    .update(canonicalJson(candidate.receipt), 'utf8')
    .digest('hex');
  const proofRefs = unique([
    ...(Array.isArray(analysis.proofRefs) ? analysis.proofRefs : []),
    ...(Array.isArray(candidate.receipt.proofRefs) ? candidate.receipt.proofRefs : []),
    `proofs/specialist-review/review-${candidate.reviewId}`,
    `proofs/specialist-review/receipt-sha256-${receiptDigest}`,
    ...(candidate.artifact ? [
      `proofs/specialist-review/artifact-sha256-${candidate.artifact.payloadSha256}`,
      `proofs/specialist-review/reviewer-${candidate.artifact.receipt.provider}`,
    ] : [
      `proofs/specialist-review/reviewer-${QUALIFIED_SPECIALIST_REVIEWER_LOGIN}`,
    ]),
  ]);
  const cleanAnalysis = Object.freeze({
    schemaVersion: 'stephanos.independent-security-analysis.v1',
    findings: Object.freeze([]),
    counts: Object.freeze({ P0: 0, P1: 0, P2: 0 }),
    verdict: 'clean',
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_CLEAN',
  });

  return Object.freeze({
    required: true,
    valid: true,
    analysis: cleanAnalysis,
    receipt: candidate.receipt,
    artifact: candidate.artifact || null,
    reviewId: candidate.reviewId,
    paths,
    blockers: Object.freeze([]),
  });
}
