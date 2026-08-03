from pathlib import Path
import re


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


def replace_regex_once(path: Path, pattern: str, replacement: str, label: str) -> None:
    text = path.read_text(encoding='utf-8')
    matches = list(re.finditer(pattern, text, flags=re.S))
    if len(matches) != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {len(matches)}')
    match = matches[0]
    path.write_text(text[:match.start()] + replacement + text[match.end():], encoding='utf-8')


coordinator = Path('shared/agents/exactHeadReviewDispatchCoordinator.mjs')
script = Path('scripts/exact-head-review-dispatch.mjs')
test = Path('shared/agents/exactHeadReviewDispatchCoordinator.test.mjs')

replace_once(
    coordinator,
    "import { PROTECTED_REVIEW_MARKER } from './operatorMergeApprovalGate.mjs';\n"
    "import { validateProviderNeutralReviewReceipt } from './providerNeutralReviewV1.mjs';\n\n"
    "export const EXACT_HEAD_REVIEW_DISPATCH_SCHEMA = 'stephanos.exact-head-review-dispatch.v1';\n"
    "export const EXACT_HEAD_REVIEW_DISPATCH_VERSION = '1.0.7';\n",
    "import {\n"
    "  INDEPENDENT_REVIEW_JOB,\n"
    "  PROTECTED_REVIEW_MARKER,\n"
    "  parseIndependentReviewSessionId,\n"
    "  validateIndependentReviewWorkflowRun,\n"
    "  validateTrustedProtectedReviewReceipt,\n"
    "} from './operatorMergeApprovalGate.mjs';\n\n"
    "export const EXACT_HEAD_REVIEW_DISPATCH_SCHEMA = 'stephanos.exact-head-review-dispatch.v1';\n"
    "export const EXACT_HEAD_REVIEW_DISPATCH_VERSION = '1.0.8';\n",
    'coordinator imports and version',
)

replace_regex_once(
    coordinator,
    r"function providerNeutralReviewMatchesHead\(item, context = \{\}\) \{.*?\n\}\n\nfunction reviewMatchesHead",
    """function providerNeutralReviewMatchesHead(item, context = {}) {
  if (!isKnownGitHubActionsReviewer(item)) return false;
  const body = commentBody(item);
  if (!body.includes(PROTECTED_REVIEW_MARKER)) return false;
  const receipt = fencedJsonObjects(body).find((candidate) => (
    candidate?.kind === 'stephanos.provider-neutral.review'
  ));
  const session = parseIndependentReviewSessionId(receipt?.reviewerSessionId);
  if (!receipt || receipt.verdict !== 'clean' || !session) return false;

  const workflowRunId = Number(session.workflowRunId);
  const workflowRunAttempt = Number(session.workflowRunAttempt);
  const workflowId = Number(context.independentReviewWorkflowId);
  const run = (Array.isArray(context.independentReviewRuns) ? context.independentReviewRuns : []).find((candidate) => (
    Number(candidate?.id) === workflowRunId
    && Number(candidate?.run_attempt ?? candidate?.runAttempt) === workflowRunAttempt
  ));
  const jobsByRunId = context.independentReviewJobsByRunId
    && typeof context.independentReviewJobsByRunId === 'object'
    && !Array.isArray(context.independentReviewJobsByRunId)
    ? context.independentReviewJobsByRunId
    : {};
  const jobs = Array.isArray(jobsByRunId[String(workflowRunId)])
    ? jobsByRunId[String(workflowRunId)]
    : [];

  const receiptValidation = validateTrustedProtectedReviewReceipt(receipt, {
    repository: text(context.repository),
    prNumber: Number(context.prNumber),
    branch: text(context.branch),
    expectedHead: text(context.headSha).toLowerCase(),
    workflowRunId,
    workflowRunAttempt,
  });
  if (!receiptValidation.valid || receiptValidation.operatorBootstrapRequired === true) return false;

  const workflowValidation = validateIndependentReviewWorkflowRun(run || {}, jobs, {
    repository: text(context.repository),
    prNumber: Number(context.prNumber),
    expectedHead: text(context.headSha).toLowerCase(),
    expectedBranch: text(context.branch),
    expectedBaseBranch: text(context.baseRef),
    expectedBaseSha: text(context.baseSha).toLowerCase(),
    expectedWorkflowId: workflowId,
    workflowRunId,
    workflowRunAttempt,
  });
  return workflowValidation.valid
    && jobs.some((job) => text(job?.name) === INDEPENDENT_REVIEW_JOB);
}

function reviewMatchesHead""",
    'workflow-bound provider-neutral receipt validation',
)

replace_once(
    coordinator,
    "  const externalReceipt = latestExternalReceipt(comments, reviews, {\n"
    "    repository: text(input.repository),\n"
    "    prNumber: base.prNumber,\n"
    "    branch: text(pr.headRef ?? pr.head_ref),\n"
    "    headSha,\n"
    "  }, workflowsCompletedAtMs);\n",
    "  const externalReceipt = latestExternalReceipt(comments, reviews, {\n"
    "    repository: text(input.repository),\n"
    "    prNumber: base.prNumber,\n"
    "    branch: text(pr.headRef ?? pr.head_ref),\n"
    "    headSha,\n"
    "    baseRef,\n"
    "    baseSha: text(pr.baseSha ?? pr.base_sha),\n"
    "    independentReviewWorkflowId: input.independentReviewWorkflowId,\n"
    "    independentReviewRuns: input.independentReviewRuns,\n"
    "    independentReviewJobsByRunId: input.independentReviewJobsByRunId,\n"
    "  }, workflowsCompletedAtMs);\n",
    'provider-neutral workflow evidence context',
)

replace_once(
    script,
    "} from '../shared/agents/exactHeadReviewDispatchCoordinator.mjs';\n\n"
    "const API_VERSION = '2022-11-28';\n"
    "const USER_AGENT = 'stephanos-exact-head-review-dispatch-v1';\n"
    "const MAX_GITHUB_PAGES = 20;\n",
    "} from '../shared/agents/exactHeadReviewDispatchCoordinator.mjs';\n"
    "import {\n"
    "  INDEPENDENT_REVIEW_WORKFLOW_NAME,\n"
    "  INDEPENDENT_REVIEW_WORKFLOW_PATH,\n"
    "  PROTECTED_REVIEW_MARKER,\n"
    "} from '../shared/agents/operatorMergeApprovalGate.mjs';\n\n"
    "const API_VERSION = '2022-11-28';\n"
    "const USER_AGENT = 'stephanos-exact-head-review-dispatch-v1';\n"
    "const MAX_GITHUB_PAGES = 20;\n"
    "const MAX_INDEPENDENT_REVIEW_SESSIONS = 20;\n"
    "const TRUSTED_GITHUB_ACTIONS_REVIEWER = Object.freeze({\n"
    "  login: 'github-actions[bot]',\n"
    "  type: 'bot',\n"
    "  id: 41898282,\n"
    "});\n",
    'dispatch script imports and bounds',
)

map_workflow_run = """function mapWorkflowRun(run) {
  return {
    id: run?.id ?? null,
    name: text(run?.name),
    workflowPath: text(run?.path),
    headSha: text(run?.head_sha),
    status: text(run?.status),
    conclusion: text(run?.conclusion),
    event: text(run?.event),
    runAttempt: Number(run?.run_attempt ?? 0),
    createdAt: run?.created_at ?? null,
    updatedAt: run?.updated_at ?? null,
    completedAt: run?.updated_at ?? null,
    htmlUrl: text(run?.html_url),
  };
}
"""
map_workflow_run_with_helpers = map_workflow_run + """
function mapIndependentReviewRun(run) {
  return {
    id: run?.id ?? null,
    run_attempt: Number(run?.run_attempt ?? 0),
    workflow_id: Number(run?.workflow_id ?? 0),
    name: text(run?.name),
    path: text(run?.path),
    event: text(run?.event),
    repository: { full_name: text(run?.repository?.full_name) },
    head_sha: text(run?.head_sha),
    status: text(run?.status),
    conclusion: text(run?.conclusion),
    pull_requests: Array.isArray(run?.pull_requests)
      ? run.pull_requests.map((pullRequest) => ({
        number: positiveInteger(pullRequest?.number, 0),
        head: {
          sha: text(pullRequest?.head?.sha),
          ref: text(pullRequest?.head?.ref),
        },
        base: {
          sha: text(pullRequest?.base?.sha),
          ref: text(pullRequest?.base?.ref),
        },
      }))
      : [],
  };
}

function mapIndependentReviewJob(job) {
  return {
    id: job?.id ?? null,
    name: text(job?.name),
    run_attempt: Number(job?.run_attempt ?? 0),
    run_url: text(job?.run_url),
    status: text(job?.status),
    conclusion: text(job?.conclusion),
  };
}

function exactGitHubActionsReviewer(comment = {}) {
  return text(comment?.user?.login).toLowerCase() === TRUSTED_GITHUB_ACTIONS_REVIEWER.login
    && text(comment?.user?.type).toLowerCase() === TRUSTED_GITHUB_ACTIONS_REVIEWER.type
    && Number(comment?.user?.id) === TRUSTED_GITHUB_ACTIONS_REVIEWER.id;
}

function candidateIndependentReviewSessions(comments = []) {
  const sessions = new Map();
  for (const comment of Array.isArray(comments) ? comments : []) {
    if (!exactGitHubActionsReviewer(comment)) continue;
    const body = text(comment?.body);
    if (!body.includes(PROTECTED_REVIEW_MARKER)) continue;
    for (const match of body.matchAll(/github-actions-independent-review-run-([1-9][0-9]*)-attempt-([1-9][0-9]*)/g)) {
      const workflowRunId = positiveInteger(match[1], 0);
      const workflowRunAttempt = positiveInteger(match[2], 0);
      if (!workflowRunId || !workflowRunAttempt) continue;
      sessions.set(`${workflowRunId}:${workflowRunAttempt}`, { workflowRunId, workflowRunAttempt });
      if (sessions.size >= MAX_INDEPENDENT_REVIEW_SESSIONS) return [...sessions.values()];
    }
  }
  return [...sessions.values()];
}

async function loadIndependentReviewEvidence({ owner, repo, repository, token, comments }) {
  const sessions = candidateIndependentReviewSessions(comments);
  const empty = {
    independentReviewWorkflowId: 0,
    independentReviewRuns: [],
    independentReviewJobsByRunId: {},
  };
  if (!sessions.length) return empty;

  const definitions = await githubPages(`/repos/${owner}/${repo}/actions/workflows`, {
    token,
    itemKey: 'workflows',
  });
  const pathMatches = definitions.filter((workflow) => (
    text(workflow?.path) === INDEPENDENT_REVIEW_WORKFLOW_PATH
  ));
  const nameCollisions = definitions.filter((workflow) => (
    text(workflow?.name) === INDEPENDENT_REVIEW_WORKFLOW_NAME
    && text(workflow?.path) !== INDEPENDENT_REVIEW_WORKFLOW_PATH
  ));
  const definition = pathMatches.length === 1 ? pathMatches[0] : null;
  const independentReviewWorkflowId = definition
    && text(definition?.name) === INDEPENDENT_REVIEW_WORKFLOW_NAME
    && text(definition?.state).toLowerCase() === 'active'
    && nameCollisions.length === 0
    ? positiveInteger(definition?.id, 0)
    : 0;
  if (!independentReviewWorkflowId) return empty;

  const independentReviewRuns = [];
  const independentReviewJobsByRunId = {};
  for (const session of sessions) {
    try {
      const rawRun = await githubRequest(
        `/repos/${owner}/${repo}/actions/runs/${session.workflowRunId}`,
        { token },
      );
      const rawJobs = await githubPages(
        `/repos/${owner}/${repo}/actions/runs/${session.workflowRunId}/attempts/${session.workflowRunAttempt}/jobs`,
        { token, itemKey: 'jobs' },
      );
      independentReviewRuns.push(mapIndependentReviewRun(rawRun));
      independentReviewJobsByRunId[String(session.workflowRunId)] = rawJobs.map(mapIndependentReviewJob);
    } catch (error) {
      console.warn(`INDEPENDENT_REVIEW_EVIDENCE_UNAVAILABLE=${session.workflowRunId}:${session.workflowRunAttempt}:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    independentReviewWorkflowId,
    independentReviewRuns,
    independentReviewJobsByRunId,
  };
}
"""
replace_once(script, map_workflow_run, map_workflow_run_with_helpers, 'independent review evidence helpers')

replace_once(
    script,
    "  const runs = (await githubPages(\n"
    "    `/repos/${owner}/${repo}/actions/runs?head_sha=${encodeURIComponent(text(pr?.head?.sha))}&event=pull_request`,\n"
    "    { token, itemKey: 'workflow_runs' },\n"
    "  )).map(mapWorkflowRun);\n"
    "  const laneEvidence = canonicalLaneEvidence(comments, {\n",
    "  const runs = (await githubPages(\n"
    "    `/repos/${owner}/${repo}/actions/runs?head_sha=${encodeURIComponent(text(pr?.head?.sha))}&event=pull_request`,\n"
    "    { token, itemKey: 'workflow_runs' },\n"
    "  )).map(mapWorkflowRun);\n"
    "  const independentReviewEvidence = await loadIndependentReviewEvidence({\n"
    "    owner,\n"
    "    repo,\n"
    "    repository,\n"
    "    token,\n"
    "    comments,\n"
    "  });\n"
    "  const laneEvidence = canonicalLaneEvidence(comments, {\n",
    'load independent review workflow evidence',
)

replace_once(
    script,
    "    workflowRuns: runs,\n"
    "    canonicalLaneConfirmed: laneEvidence.confirmed,\n",
    "    workflowRuns: runs,\n"
    "    ...independentReviewEvidence,\n"
    "    canonicalLaneConfirmed: laneEvidence.confirmed,\n",
    'return independent review workflow evidence',
)

replace_once(
    script,
    "      baseRef: text(pr?.base?.ref),\n"
    "      headRef: text(pr?.head?.ref),\n",
    "      baseRef: text(pr?.base?.ref),\n"
    "      baseSha: text(pr?.base?.sha),\n"
    "      headRef: text(pr?.head?.ref),\n",
    'bind PR base SHA',
)

replace_once(
    script,
    "    workflowRuns: context.workflowRuns,\n"
    "    comments: context.comments,\n"
    "    reviews: context.reviews,\n",
    "    workflowRuns: context.workflowRuns,\n"
    "    independentReviewWorkflowId: context.independentReviewWorkflowId,\n"
    "    independentReviewRuns: context.independentReviewRuns,\n"
    "    independentReviewJobsByRunId: context.independentReviewJobsByRunId,\n"
    "    comments: context.comments,\n"
    "    reviews: context.reviews,\n",
    'evaluate with independent review workflow evidence',
)

replace_once(
    test,
    "import { createProviderNeutralReviewReceipt } from './providerNeutralReviewV1.mjs';\n",
    "import {\n"
    "  INDEPENDENT_REVIEW_JOB,\n"
    "  INDEPENDENT_REVIEW_WORKFLOW_NAME,\n"
    "  INDEPENDENT_REVIEW_WORKFLOW_PATH,\n"
    "  buildProtectedSecurityReviewReceipt,\n"
    "} from './operatorMergeApprovalGate.mjs';\n",
    'test trusted review imports',
)

replace_once(
    test,
    "const BRANCH = 'agent/provider-neutral-review';\n",
    "const BRANCH = 'agent/provider-neutral-review';\n"
    "const BASE_SHA = 'c'.repeat(40);\n"
    "const REVIEW_RUN_ID = 123;\n"
    "const REVIEW_RUN_ATTEMPT = 1;\n"
    "const REVIEW_WORKFLOW_ID = 456;\n",
    'test review identity constants',
)

replace_once(
    test,
    "function successfulRuns(headSha = HEAD) {\n",
    "function independentReviewRun(overrides = {}) {\n"
    "  const run = {\n"
    "    id: REVIEW_RUN_ID,\n"
    "    run_attempt: REVIEW_RUN_ATTEMPT,\n"
    "    workflow_id: REVIEW_WORKFLOW_ID,\n"
    "    name: INDEPENDENT_REVIEW_WORKFLOW_NAME,\n"
    "    path: INDEPENDENT_REVIEW_WORKFLOW_PATH,\n"
    "    event: 'pull_request_target',\n"
    "    repository: { full_name: REPOSITORY },\n"
    "    head_sha: BASE_SHA,\n"
    "    status: 'completed',\n"
    "    conclusion: 'success',\n"
    "    pull_requests: [{\n"
    "      number: 1559,\n"
    "      head: { sha: HEAD, ref: BRANCH },\n"
    "      base: { sha: BASE_SHA, ref: 'main' },\n"
    "    }],\n"
    "  };\n"
    "  return { ...run, ...overrides };\n"
    "}\n\n"
    "function independentReviewJobs(overrides = {}) {\n"
    "  return [{\n"
    "    id: 9001,\n"
    "    name: INDEPENDENT_REVIEW_JOB,\n"
    "    run_attempt: REVIEW_RUN_ATTEMPT,\n"
    "    run_url: `https://api.github.com/repos/${REPOSITORY}/actions/runs/${REVIEW_RUN_ID}`,\n"
    "    status: 'completed',\n"
    "    conclusion: 'success',\n"
    "    ...overrides,\n"
    "  }];\n"
    "}\n\n"
    "function successfulRuns(headSha = HEAD) {\n",
    'test independent review workflow fixtures',
)

replace_once(
    test,
    "      baseRef: 'main',\n"
    "      headRef: BRANCH,\n",
    "      baseRef: 'main',\n"
    "      baseSha: BASE_SHA,\n"
    "      headRef: BRANCH,\n",
    'test PR base SHA',
)

replace_once(
    test,
    "    workflowRuns: successfulRuns(),\n"
    "    comments: [],\n",
    "    workflowRuns: successfulRuns(),\n"
    "    independentReviewWorkflowId: REVIEW_WORKFLOW_ID,\n"
    "    independentReviewRuns: [independentReviewRun()],\n"
    "    independentReviewJobsByRunId: {\n"
    "      [String(REVIEW_RUN_ID)]: independentReviewJobs(),\n"
    "    },\n"
    "    comments: [],\n",
    'test default independent review workflow evidence',
)

provider_block = r"\nfunction providerNeutralComment\(\{.*?\n\}\n\ntest\('provider-neutral handoff never dispatches the Codex reviewer'"
provider_replacement = """
function providerNeutralComment({
  id = 93,
  headSha = HEAD,
  user = TRUSTED_GITHUB_ACTIONS_REVIEWER,
  createdAt = '2026-07-19T16:29:30Z',
  workflowRunId = REVIEW_RUN_ID,
  workflowRunAttempt = REVIEW_RUN_ATTEMPT,
} = {}) {
  const receipt = buildProtectedSecurityReviewReceipt({
    repository: REPOSITORY,
    prNumber: 1559,
    branch: BRANCH,
    sourceHead: headSha,
    workflowRunId,
    workflowRunAttempt,
    timestampUtc: createdAt,
    analysis: {
      schemaVersion: 'stephanos.independent-security-analysis.v1',
      findings: [],
      counts: { P0: 0, P1: 0, P2: 0 },
      verdict: 'clean',
      proofRefs: ['proofs/changed-file/shared/agents/example.mjs'],
      finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_CLEAN',
    },
  });
  return {
    id,
    body: `<!-- stephanos-protected-security-review -->\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\``,
    user,
    createdAt,
  };
}

test('records only a workflow-bound authenticated provider-neutral GitHub Actions receipt', () => {
  const result = evaluateExactHeadReviewDispatch(baseInput({
    comments: [providerNeutralComment()],
  }));
  assert.equal(result.decision, EXACT_HEAD_REVIEW_DECISION.RECORD_REVIEW_RECEIPT);
  assert.equal(result.externalReceiptId, 93);
  assert.match(result.reason, /authenticated exact-head review receipt/i);
});

test('rejects forged, stale or workflow-unbound provider-neutral review comments', () => {
  const forgedActor = evaluateExactHeadReviewDispatch(baseInput({
    comments: [providerNeutralComment({
      user: { ...TRUSTED_GITHUB_ACTIONS_REVIEWER, id: 7 },
    })],
  }));
  assert.equal(forgedActor.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);

  const staleHead = evaluateExactHeadReviewDispatch(baseInput({
    comments: [providerNeutralComment({ headSha: OLD_HEAD })],
  }));
  assert.equal(staleHead.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);

  const missingRun = evaluateExactHeadReviewDispatch(baseInput({
    comments: [providerNeutralComment()],
    independentReviewRuns: [],
    independentReviewJobsByRunId: {},
  }));
  assert.equal(missingRun.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);

  const lookalikeWorkflow = evaluateExactHeadReviewDispatch(baseInput({
    comments: [providerNeutralComment()],
    independentReviewRuns: [independentReviewRun({
      path: '.github/workflows/lookalike-independent-review.yml',
    })],
  }));
  assert.equal(lookalikeWorkflow.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);

  const wrongBase = evaluateExactHeadReviewDispatch(baseInput({
    comments: [providerNeutralComment()],
    independentReviewRuns: [independentReviewRun({
      pull_requests: [{
        number: 1559,
        head: { sha: HEAD, ref: BRANCH },
        base: { sha: OLD_HEAD, ref: 'main' },
      }],
    })],
  }));
  assert.equal(wrongBase.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);

  const failedJob = evaluateExactHeadReviewDispatch(baseInput({
    comments: [providerNeutralComment()],
    independentReviewJobsByRunId: {
      [String(REVIEW_RUN_ID)]: independentReviewJobs({ conclusion: 'failure' }),
    },
  }));
  assert.equal(failedJob.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);
});

test('provider-neutral handoff never dispatches the Codex reviewer'"""
replace_regex_once(test, provider_block, provider_replacement, 'workflow-bound provider-neutral hostile tests')
