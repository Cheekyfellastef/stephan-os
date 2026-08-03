from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


coordinator = Path('shared/agents/exactHeadReviewDispatchCoordinator.mjs')
replace_once(
    coordinator,
    "export const EXACT_HEAD_REVIEW_DISPATCH_SCHEMA = 'stephanos.exact-head-review-dispatch.v1';\nexport const EXACT_HEAD_REVIEW_DISPATCH_VERSION = '1.0.6';\n",
    "import { PROTECTED_REVIEW_MARKER } from './operatorMergeApprovalGate.mjs';\nimport { validateProviderNeutralReviewReceipt } from './providerNeutralReviewV1.mjs';\n\nexport const EXACT_HEAD_REVIEW_DISPATCH_SCHEMA = 'stephanos.exact-head-review-dispatch.v1';\nexport const EXACT_HEAD_REVIEW_DISPATCH_VERSION = '1.0.7';\n",
    'coordinator imports and version',
)
replace_once(
    coordinator,
    """const TRUSTED_CODEX_REVIEWER = Object.freeze({
  login: 'chatgpt-codex-connector[bot]',
  type: 'bot',
  id: 199175422,
});
""",
    """const TRUSTED_CODEX_REVIEWER = Object.freeze({
  login: 'chatgpt-codex-connector[bot]',
  type: 'bot',
  id: 199175422,
});
const TRUSTED_GITHUB_ACTIONS_REVIEWER = Object.freeze({
  login: 'github-actions[bot]',
  type: 'bot',
  id: 41898282,
});
""",
    'trusted provider-neutral reviewer identity',
)
replace_once(
    coordinator,
    """function isKnownCodexReviewer(item) {
  const actor = item?.user ?? item?.author ?? {};
  return normalizedLogin(actor?.login) === TRUSTED_CODEX_REVIEWER.login
    && normalizedLogin(actor?.type) === TRUSTED_CODEX_REVIEWER.type
    && Number(actor?.id) === TRUSTED_CODEX_REVIEWER.id;
}

function reviewMatchesHead(item, headSha) {
  if (!isKnownCodexReviewer(item)) return false;
  const commitId = text(item?.commitId ?? item?.commit_id);
  if (commitId && sameSha(commitId, headSha)) return true;
  return sameSha(reviewedCommitSha(commentBody(item)), headSha);
}

function latestExternalReceipt(comments, reviews, headSha, notBeforeMs) {
  return newest([
    ...(comments || []).filter((item) => reviewMatchesHead(item, headSha)),
    ...(reviews || []).filter((item) => reviewMatchesHead(item, headSha)),
  ].filter((item) => {
    const timestamp = itemTimestamp(item);
    return timestamp !== null && timestamp > notBeforeMs;
  }));
}
""",
    """function actorMatches(item, expected) {
  const actor = item?.user ?? item?.author ?? {};
  return normalizedLogin(actor?.login) === expected.login
    && normalizedLogin(actor?.type) === expected.type
    && Number(actor?.id) === expected.id;
}

function isKnownCodexReviewer(item) {
  return actorMatches(item, TRUSTED_CODEX_REVIEWER);
}

function isKnownGitHubActionsReviewer(item) {
  return actorMatches(item, TRUSTED_GITHUB_ACTIONS_REVIEWER);
}

function fencedJsonObjects(body) {
  const objects = [];
  for (const match of text(body).matchAll(/```json\\s*([\\s\\S]*?)```/gi)) {
    try {
      const value = JSON.parse(match[1]);
      if (value && typeof value === 'object' && !Array.isArray(value)) objects.push(value);
    } catch {
      // Malformed display JSON is not review evidence.
    }
  }
  return objects;
}

function providerNeutralReviewMatchesHead(item, context = {}) {
  if (!isKnownGitHubActionsReviewer(item)) return false;
  const body = commentBody(item);
  if (!body.includes(PROTECTED_REVIEW_MARKER)) return false;
  const receipt = fencedJsonObjects(body).find((candidate) => (
    candidate?.kind === 'stephanos.provider-neutral.review'
  ));
  if (!receipt || receipt.verdict !== 'clean') return false;
  const validation = validateProviderNeutralReviewReceipt(receipt, {
    repository: text(context.repository),
    prNumber: Number(context.prNumber),
    branch: text(context.branch),
    expectedHead: text(context.headSha).toLowerCase(),
  });
  return validation.valid;
}

function reviewMatchesHead(item, context = {}) {
  if (isKnownCodexReviewer(item)) {
    const commitId = text(item?.commitId ?? item?.commit_id);
    if (commitId && sameSha(commitId, context.headSha)) return true;
    return sameSha(reviewedCommitSha(commentBody(item)), context.headSha);
  }
  return providerNeutralReviewMatchesHead(item, context);
}

function latestExternalReceipt(comments, reviews, context, notBeforeMs) {
  return newest([
    ...(comments || []).filter((item) => reviewMatchesHead(item, context)),
    ...(reviews || []).filter((item) => reviewMatchesHead(item, context)),
  ].filter((item) => {
    const timestamp = itemTimestamp(item);
    return timestamp !== null && timestamp > notBeforeMs;
  }));
}
""",
    'provider-neutral receipt recognition',
)
replace_once(
    coordinator,
    """  const externalReceipt = latestExternalReceipt(comments, reviews, headSha, workflowsCompletedAtMs);
""",
    """  const externalReceipt = latestExternalReceipt(comments, reviews, {
    repository: text(input.repository),
    prNumber: base.prNumber,
    branch: text(pr.headRef ?? pr.head_ref),
    headSha,
  }, workflowsCompletedAtMs);
""",
    'external receipt context',
)
replace_once(
    coordinator,
    "reason: 'a Codex exact-head review receipt exists and needs one durable coordinator receipt',",
    "reason: 'an authenticated exact-head review receipt exists and needs one durable coordinator receipt',",
    'generalized receipt reason',
)
replace_once(
    coordinator,
    """  return [
    markerFor(EXACT_HEAD_REVIEW_MARKERS.DISPATCH, head),
    '@codex review',
    '',
    `Automated bounded exact-head review request for PR #${Number(prNumber)}.`,
    '',
    `Review exact head \\`${head}\\` only.`,
    '',
    'All required exact-head workflows succeeded:',
    ...workflowNames.map((name) => `- ${name}`),
    '',
    'Return any current P0/P1/P2 findings with exact file references and explicitly confirm when no unresolved P0 or P1 remains.',
    '',
    'Constraints: read-only review only; do not modify the branch, open another PR or implementation job, merge, mark ready, or touch Battle Bridge/runtime state. Any later head change voids this review.',
  ].join('\\n');
""",
    """  return [
    markerFor(EXACT_HEAD_REVIEW_MARKERS.DISPATCH, head),
    '## Provider-neutral exact-head review handoff',
    '',
    `Automated bounded review handoff for PR #${Number(prNumber)} at exact head \\`${head}\\`.`,
    '',
    'All required exact-head workflows succeeded:',
    ...workflowNames.map((name) => `- ${name}`),
    '',
    'The trusted GitHub Actions independent-review lane is expected to publish an authenticated exact-head receipt. This coordinator does not request or consume Codex review capacity.',
    '',
    'Return any current P0/P1/P2 findings with exact file references and explicitly confirm when no unresolved P0 or P1 remains.',
    '',
    'Constraints: read-only review only; do not modify the branch, open another PR or implementation job, merge, mark ready, or touch Battle Bridge/runtime state. Any later head change voids this review.',
  ].join('\\n');
""",
    'provider-neutral dispatch comment',
)
replace_once(
    coordinator,
    "'One exact-head review request was posted, but no matching Codex review receipt has appeared. Duplicate review dispatch is rejected. The Programme Completion Controller should inspect the external review route; no merge, mark-ready action, implementation dispatch, or runtime mutation is authorised.',",
    "'One exact-head review handoff was posted, but no matching authenticated provider-neutral or Codex receipt has appeared. Duplicate dispatch is rejected. The Programme Completion Controller should inspect the independent review route; no merge, mark-ready action, implementation dispatch, or runtime mutation is authorised.',",
    'provider-neutral escalation text',
)

script = Path('scripts/exact-head-review-dispatch.mjs')
replace_once(
    script,
    """    pr: {
      number: positiveInteger(pr?.number),
      state: text(pr?.state),
      baseRef: text(pr?.base?.ref),
      headSha: text(pr?.head?.sha),
      sameRepository: text(pr?.head?.repo?.full_name).toLowerCase() === repository.toLowerCase(),
    },
""",
    """    pr: {
      number: positiveInteger(pr?.number),
      state: text(pr?.state),
      baseRef: text(pr?.base?.ref),
      headRef: text(pr?.head?.ref),
      headSha: text(pr?.head?.sha),
      sameRepository: text(pr?.head?.repo?.full_name).toLowerCase() === repository.toLowerCase(),
    },
""",
    'dispatch context head branch',
)
replace_once(
    script,
    """  const decision = evaluateExactHeadReviewDispatch({
    now: new Date().toISOString(),
""",
    """  const decision = evaluateExactHeadReviewDispatch({
    repository,
    now: new Date().toISOString(),
""",
    'dispatch context repository',
)

test_path = Path('shared/agents/exactHeadReviewDispatchCoordinator.test.mjs')
replace_once(
    test_path,
    """import {
  EXACT_HEAD_REVIEW_DECISION,
""",
    """import { createProviderNeutralReviewReceipt } from './providerNeutralReviewV1.mjs';
import {
  EXACT_HEAD_REVIEW_DECISION,
""",
    'test provider-neutral import',
)
replace_once(
    test_path,
    """const UNTRUSTED_ACTOR = 'untrusted-commenter';
const TRUSTED_CODEX_REVIEWER = Object.freeze({
""",
    """const UNTRUSTED_ACTOR = 'untrusted-commenter';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const BRANCH = 'agent/provider-neutral-review';
const TRUSTED_CODEX_REVIEWER = Object.freeze({
""",
    'test repository and branch constants',
)
replace_once(
    test_path,
    """const TRUSTED_CODEX_REVIEWER = Object.freeze({
  login: 'chatgpt-codex-connector[bot]',
  type: 'Bot',
  id: 199175422,
});
""",
    """const TRUSTED_CODEX_REVIEWER = Object.freeze({
  login: 'chatgpt-codex-connector[bot]',
  type: 'Bot',
  id: 199175422,
});
const TRUSTED_GITHUB_ACTIONS_REVIEWER = Object.freeze({
  login: 'github-actions[bot]',
  type: 'Bot',
  id: 41898282,
});
""",
    'test GitHub Actions identity',
)
replace_once(
    test_path,
    """  return {
    now: NOW,
    trustedCoordinatorLogin: TRUSTED_COORDINATOR,
""",
    """  return {
    repository: REPOSITORY,
    now: NOW,
    trustedCoordinatorLogin: TRUSTED_COORDINATOR,
""",
    'test repository context',
)
replace_once(
    test_path,
    """      baseRef: 'main',
      headSha: HEAD,
""",
    """      baseRef: 'main',
      headRef: BRANCH,
      headSha: HEAD,
""",
    'test head branch context',
)
insert_before = "test('accepts a review object only when its exact commit matches', () => {"
addition = r"""
function providerNeutralComment({
  id = 93,
  headSha = HEAD,
  user = TRUSTED_GITHUB_ACTIONS_REVIEWER,
  createdAt = '2026-07-19T16:29:30Z',
} = {}) {
  const receipt = createProviderNeutralReviewReceipt({
    receiptId: `review-1559-${headSha.slice(0, 12)}`,
    repository: REPOSITORY,
    issueNumber: 1559,
    prNumber: 1559,
    branch: BRANCH,
    sourceHead: headSha,
    reviewerId: 'github-actions-independent-security-review',
    reviewerClass: 'external-qualified',
    provider: 'github-actions-independent-review',
    modelClass: 'source-controlled-high-assurance',
    reviewerSessionId: 'github-actions-independent-review-run-123-attempt-1',
    implementerProvider: 'github-first',
    implementerSessionId: 'source-change-session-1',
    riskTier: 'standard',
    assuranceMode: 'independent',
    reviewScope: ['complete-diff'],
    findings: [],
    verdict: 'clean',
    timestampUtc: createdAt,
    proofRefs: ['proofs/independent-review/receipt'],
    quorumChecks: [],
    blocker: '',
  });
  return {
    id,
    body: `<!-- stephanos-protected-security-review -->\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\``,
    user,
    createdAt,
  };
}

test('records an authenticated provider-neutral GitHub Actions receipt', () => {
  const result = evaluateExactHeadReviewDispatch(baseInput({
    comments: [providerNeutralComment()],
  }));
  assert.equal(result.decision, EXACT_HEAD_REVIEW_DECISION.RECORD_REVIEW_RECEIPT);
  assert.equal(result.externalReceiptId, 93);
  assert.match(result.reason, /authenticated exact-head review receipt/i);
});

test('rejects forged or stale provider-neutral review comments', () => {
  const forged = evaluateExactHeadReviewDispatch(baseInput({
    comments: [providerNeutralComment({
      user: { ...TRUSTED_GITHUB_ACTIONS_REVIEWER, id: 7 },
    })],
  }));
  assert.equal(forged.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);

  const stale = evaluateExactHeadReviewDispatch(baseInput({
    comments: [providerNeutralComment({ headSha: OLD_HEAD })],
  }));
  assert.equal(stale.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);
});

test('provider-neutral handoff never dispatches the Codex reviewer', () => {
  const body = buildReviewDispatchComment({ prNumber: 1559, headSha: HEAD });
  assert.match(body, /Provider-neutral exact-head review handoff/);
  assert.match(body, /does not request or consume Codex review capacity/);
  assert.doesNotMatch(body, /@codex review/);
});

"""
text = test_path.read_text(encoding='utf-8')
if insert_before not in text:
    raise SystemExit('provider-neutral test insertion marker missing')
if 'records an authenticated provider-neutral GitHub Actions receipt' in text:
    raise SystemExit('provider-neutral tests already present')
test_path.write_text(text.replace(insert_before, addition + insert_before, 1), encoding='utf-8')
