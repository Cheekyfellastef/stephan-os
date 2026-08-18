export const INDEPENDENT_REVIEW_RUN_DISCOVERY_SCHEMA_VERSION = 'stephanos.independent-review-run-discovery.v1';

const FULL_SHA = /^[0-9a-f]{40}$/i;

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function sameSha(left, right) {
  return FULL_SHA.test(text(left))
    && FULL_SHA.test(text(right))
    && text(left).toLowerCase() === text(right).toLowerCase();
}

export function buildIndependentReviewRunQueryV1({ workflowId, expectedBase } = {}) {
  const id = positiveInteger(workflowId);
  const base = text(expectedBase).toLowerCase();
  if (!id || !FULL_SHA.test(base)) {
    throw new Error('canonical workflow id and exact trusted base are required');
  }
  return `/actions/workflows/${id}/runs?event=pull_request_target&head_sha=${encodeURIComponent(base)}&per_page=100&page=1`;
}

export function selectIndependentReviewRunCandidatesV1(input = {}) {
  const prNumber = positiveInteger(input.prNumber);
  const headRef = text(input.headRef);
  const expectedHead = text(input.expectedHead).toLowerCase();
  const expectedBase = text(input.expectedBase).toLowerCase();
  if (!prNumber || !headRef || !FULL_SHA.test(expectedHead) || !FULL_SHA.test(expectedBase)) {
    throw new Error('exact PR, branch, feature head and trusted base are required');
  }

  return Object.freeze((Array.isArray(input.runs) ? input.runs : []).filter((run) => (
    text(run?.event) === 'pull_request_target'
    // pull_request_target executes the trusted workflow from the base commit.
    && sameSha(run?.head_sha, expectedBase)
    && Array.isArray(run?.pull_requests)
    && run.pull_requests.some((pr) => (
      positiveInteger(pr?.number) === prNumber
      && text(pr?.head?.ref) === headRef
      && sameSha(pr?.head?.sha, expectedHead)
      && text(pr?.base?.ref) === 'main'
      && sameSha(pr?.base?.sha, expectedBase)
    ))
  )).sort((left, right) => positiveInteger(right?.id) - positiveInteger(left?.id)));
}
