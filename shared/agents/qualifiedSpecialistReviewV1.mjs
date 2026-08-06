import { createHash } from 'node:crypto';
import { validateProviderNeutralReviewReceipt } from './providerNeutralReviewV1.mjs';

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

const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const MAX_REVIEW_CLOCK_SKEW_MS = 15 * 60 * 1000;

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
    return Object.freeze({ required: false, valid: true, analysis, receipt: null, reviewId: 0, blockers: Object.freeze([]) });
  }

  const paths = qualifiedSpecialistEscalationPaths(analysis);
  if (paths.length === 0) {
    return Object.freeze({
      required: false,
      valid: false,
      analysis,
      receipt: null,
      reviewId: 0,
      blockers: Object.freeze(['specialist-review-cannot-cover-non-escalation-findings']),
    });
  }

  const candidates = (Array.isArray(input.reviews) ? input.reviews : [])
    .map((review) => validateSpecialistReviewCandidate(review, {
      repository: input.repository,
      prNumber: input.prNumber,
      branch: input.branch,
      sourceHead: input.sourceHead,
      baseSha: input.baseSha,
      paths,
    }))
    .filter((candidate) => candidate.valid);

  if (candidates.length !== 1) {
    return Object.freeze({
      required: true,
      valid: false,
      analysis,
      receipt: null,
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
    `proofs/specialist-review/reviewer-${QUALIFIED_SPECIALIST_REVIEWER_LOGIN}`,
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
    reviewId: candidate.reviewId,
    paths,
    blockers: Object.freeze([]),
  });
}
