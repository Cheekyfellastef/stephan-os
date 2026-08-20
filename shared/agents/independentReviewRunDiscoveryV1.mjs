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

export function independentReviewWorkflowDispatchRunNameV1({ prNumber, expectedHead, expectedBase } = {}) {
  const pr = positiveInteger(prNumber);
  const head = text(expectedHead).toLowerCase();
  const base = text(expectedBase).toLowerCase();
  if (!pr || !FULL_SHA.test(head) || !FULL_SHA.test(base)) {
    throw new Error('exact PR, feature head and trusted base are required for workflow-dispatch run identity');
  }
  return `Independent Merge Security Review PR #${pr} head ${head} base ${base}`;
}

export function buildIndependentReviewRunQueryV1({ workflowId, expectedHead } = {}) {
  const id = positiveInteger(workflowId);
  const head = text(expectedHead).toLowerCase();
  if (!id || !FULL_SHA.test(head)) {
    throw new Error('canonical workflow id and exact feature head are required');
  }
  return `/actions/workflows/${id}/runs?event=pull_request_target&head_sha=${encodeURIComponent(head)}&per_page=100&page=1`;
}

export function buildIndependentReviewWorkflowDispatchRunQueryV1({ workflowId, expectedBase } = {}) {
  const id = positiveInteger(workflowId);
  const base = text(expectedBase).toLowerCase();
  if (!id || !FULL_SHA.test(base)) {
    throw new Error('canonical workflow id and exact trusted base are required');
  }
  return `/actions/workflows/${id}/runs?event=workflow_dispatch&head_sha=${encodeURIComponent(base)}&per_page=100&page=1`;
}

function exactPullRequestTargetRun(run, { prNumber, headRef, expectedHead, expectedBase }) {
  return text(run?.event) === 'pull_request_target'
    // The trusted workflow executes from the base, but the Actions REST run
    // identity reports the pull request feature commit as run.head_sha.
    && sameSha(run?.head_sha, expectedHead)
    && Array.isArray(run?.pull_requests)
    && run.pull_requests.some((pr) => (
      positiveInteger(pr?.number) === prNumber
      && text(pr?.head?.ref) === headRef
      && sameSha(pr?.head?.sha, expectedHead)
      && text(pr?.base?.ref) === 'main'
      && sameSha(pr?.base?.sha, expectedBase)
    ));
}

function exactWorkflowDispatchRun(run, { prNumber, expectedHead, expectedBase }) {
  return text(run?.event) === 'workflow_dispatch'
    && text(run?.head_branch) === 'main'
    && sameSha(run?.head_sha, expectedBase)
    && text(run?.display_title) === independentReviewWorkflowDispatchRunNameV1({
      prNumber,
      expectedHead,
      expectedBase,
    });
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
    exactPullRequestTargetRun(run, { prNumber, headRef, expectedHead, expectedBase })
    || exactWorkflowDispatchRun(run, { prNumber, expectedHead, expectedBase })
  )).sort((left, right) => positiveInteger(right?.id) - positiveInteger(left?.id)));
}
