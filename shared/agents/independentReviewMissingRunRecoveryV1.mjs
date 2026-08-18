export const INDEPENDENT_REVIEW_MISSING_RUN_RECOVERY_SCHEMA_VERSION = 'stephanos.independent-review-missing-run-recovery.v1';
export const INDEPENDENT_REVIEW_MISSING_RUN_RETRIGGER_MARKER = 'stephanos:independent-review-missing-run-retrigger:v1';

export const INDEPENDENT_REVIEW_MISSING_RUN_RECOVERY_DECISION = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  ALREADY_RETRIGGERED: 'ALREADY_RETRIGGERED',
  RETRIGGER_READY: 'RETRIGGER_READY',
});

const FULL_SHA = /^[0-9a-f]{40}$/i;
const TRUSTED_GITHUB_ACTIONS = Object.freeze({
  login: 'github-actions[bot]',
  type: 'bot',
  id: 41898282,
});

function text(value) {
  return String(value ?? '').trim();
}

function sameSha(left, right) {
  return FULL_SHA.test(text(left))
    && FULL_SHA.test(text(right))
    && text(left).toLowerCase() === text(right).toLowerCase();
}

function actor(item = {}) {
  return item?.user ?? item?.author ?? item;
}

function trustedGitHubActions(item = {}) {
  const candidate = actor(item);
  return text(candidate?.login).toLowerCase() === TRUSTED_GITHUB_ACTIONS.login
    && text(candidate?.type).toLowerCase() === TRUSTED_GITHUB_ACTIONS.type
    && Number(candidate?.id) === TRUSTED_GITHUB_ACTIONS.id;
}

export function buildIndependentReviewMissingRunRetriggerMarker({ headSha, baseSha } = {}) {
  const head = text(headSha).toLowerCase();
  const base = text(baseSha).toLowerCase();
  if (!FULL_SHA.test(head) || !FULL_SHA.test(base)) {
    throw new Error('exact head and base SHA are required');
  }
  return `<!-- ${INDEPENDENT_REVIEW_MISSING_RUN_RETRIGGER_MARKER} head=${head} base=${base} -->`;
}

function hasTrustedExactMarker(comments = [], { headSha, baseSha } = {}) {
  const marker = buildIndependentReviewMissingRunRetriggerMarker({ headSha, baseSha });
  return (Array.isArray(comments) ? comments : []).some((comment) => (
    trustedGitHubActions(comment) && text(comment?.body).includes(marker)
  ));
}

export function planIndependentReviewMissingRunRecovery(input = {}) {
  const repository = text(input.repository);
  const retryDecision = text(input.retryDecision);
  const pr = input.pr || {};
  const prNumber = Number(pr.number);
  const headSha = text(pr.headSha).toLowerCase();
  const baseSha = text(pr.baseSha).toLowerCase();
  const base = {
    schemaVersion: INDEPENDENT_REVIEW_MISSING_RUN_RECOVERY_SCHEMA_VERSION,
    repository,
    prNumber: Number.isSafeInteger(prNumber) && prNumber > 0 ? prNumber : null,
    branch: text(pr.headRef),
    exactHead: headSha,
    exactBase: baseSha,
    mutationAllowed: false,
    operation: 'none',
    sourceMutationAllowed: false,
    mergeAllowed: false,
    runtimeMutationAllowed: false,
    openClawMutationAllowed: false,
    destructiveGitAllowed: false,
  };

  const valid = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
    && base.prNumber !== null
    && text(pr.state).toLowerCase() === 'open'
    && typeof pr.draft === 'boolean'
    && pr.sameRepository === true
    && text(pr.baseRef) === 'main'
    && text(pr.headRef)
    && FULL_SHA.test(headSha)
    && FULL_SHA.test(baseSha);
  if (!valid) {
    return Object.freeze({
      ...base,
      decision: INDEPENDENT_REVIEW_MISSING_RUN_RECOVERY_DECISION.INVALID_INPUT,
      reason: 'exact open same-repository PR identity is required',
    });
  }

  if (retryDecision !== 'NO_MATCHING_RUN') {
    return Object.freeze({
      ...base,
      decision: INDEPENDENT_REVIEW_MISSING_RUN_RECOVERY_DECISION.NOT_APPLICABLE,
      reason: `review retry decision ${retryDecision || 'unknown'} does not require missing-run recovery`,
    });
  }

  if (hasTrustedExactMarker(input.comments, { headSha, baseSha })) {
    return Object.freeze({
      ...base,
      decision: INDEPENDENT_REVIEW_MISSING_RUN_RECOVERY_DECISION.ALREADY_RETRIGGERED,
      reason: 'a trusted once-per-head missing-run recovery marker already exists',
    });
  }

  return Object.freeze({
    ...base,
    decision: INDEPENDENT_REVIEW_MISSING_RUN_RECOVERY_DECISION.RETRIGGER_READY,
    reason: pr.draft
      ? 'no exact canonical review run exists; mark the exact draft ready once to trigger trusted review'
      : 'no exact canonical review run exists; perform one exact draft-ready pulse to trigger trusted review',
    mutationAllowed: true,
    operation: pr.draft ? 'mark-ready' : 'draft-ready-pulse',
  });
}
