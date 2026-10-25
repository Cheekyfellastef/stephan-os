import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { preflightBeforeProtectedApproval } from './operator-protected-personal-repository-merge.mjs';
import { parsePersonalRepositoryDispatchInputs } from '../shared/agents/operatorPersonalRepositoryMergeV1.mjs';
import {
  buildProtectedWorkflowDispatchRequest,
  PROTECTED_WORKFLOW_DISPATCH_SCHEMA,
} from '../shared/agents/protectedWorkflowDispatchMailboxV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const BASE = 'ca1dc9a8f634df7703e4d4815679d9d8fecdcdd4';
const HEAD = 'b'.repeat(40);
const TREE = 'c'.repeat(40);
const OTHER_BASE = 'd'.repeat(40);
const WORKFLOW_ID = 77;
const CURRENT_RUN_ID = 9000;
const PRIOR_RUN_ID = 8000;
const WORKFLOW_PATH = '.github/workflows/operator-merge-approval-gate.yml';
const ROOT = '/repos/' + REPOSITORY;
const TITLE = 'Protected operator merge ' + HEAD;
const BOT = { login: 'github-actions[bot]', id: 41898282 };
const OWNER = { login: 'Cheekyfellastef', id: 267490109, type: 'User' };
const EXECUTION_COLLECTED = new Error('FIXTURE_EXECUTION_COLLECTED_BEFORE_IDENTITY');
const AUTHORITY_JOBS = [
  ['personal-repository-evidence', 'failure'],
  ['operator-personal-repository-approval', 'skipped'],
  ['operator-personal-repository-squash-merge', 'skipped'],
];

function runRecord(id, sourceHead = HEAD, overrides = {}) {
  const title = 'Protected operator merge ' + sourceHead;
  return {
    id, run_attempt: 1, workflow_id: WORKFLOW_ID, name: title, display_title: title,
    event: 'workflow_dispatch', head_sha: BASE, head_branch: 'main',
    repository: { full_name: REPOSITORY }, path: WORKFLOW_PATH,
    triggering_actor: { ...BOT }, status: 'completed', conclusion: 'failure',
    created_at: '2026-10-25T10:00:00Z', ...overrides,
  };
}

function earlyFailureJobs(run) {
  return Array.from({ length: run.run_attempt }, (_, index) => {
    const attempt = index + 1;
    return AUTHORITY_JOBS.map(([name, conclusion], offset) => {
      const id = run.id * 100 + attempt * 10 + offset;
      return {
        id, run_id: run.id, run_attempt: attempt, workflow_name: run.name,
        head_branch: 'main', head_sha: BASE, name, status: 'completed', conclusion,
        url: 'https://api.github.com' + ROOT + '/actions/jobs/' + id,
        run_url: 'https://api.github.com' + ROOT + '/actions/runs/' + run.id,
        check_run_url: 'https://api.github.com' + ROOT + '/check-runs/' + id,
        html_url: 'https://github.com/' + REPOSITORY + '/actions/runs/' + run.id + '/job/' + id,
      };
    });
  }).flat();
}

function fixture() {
  const command = {
    schemaVersion: PROTECTED_WORKFLOW_DISPATCH_SCHEMA,
    requestId: 'protected-inventory-fixture-only-20261025',
    operation: 'DISPATCH_PROTECTED_OPERATOR_MERGE', repository: REPOSITORY,
    issueNumber: 3149, operatorApproval: 'operator-approved',
    expiresAt: '2026-10-25T10:08:00Z', mode: 'user-owned-protected-squash',
    prNumber: 3240, expectedBranch: 'fix/2961-inventory-fixture',
    expectedHead: HEAD, expectedHeadTree: TREE, expectedBase: BASE,
    independentReviewRunId: 6000, independentReviewRunAttempt: 1,
    independentReviewArtifactId: 6001, independentReviewArtifactDigest: 'sha256:' + 'e'.repeat(64),
    independentReviewPayloadSha256: 'f'.repeat(64),
  };
  const fence = String.fromCharCode(96).repeat(3);
  const comment = {
    id: 7000, user: { ...OWNER },
    issue_url: 'https://api.github.com' + ROOT + '/issues/3149',
    created_at: '2026-10-25T09:59:00Z', updated_at: '2026-10-25T09:59:00Z',
    body: fence + 'stephanos-protected-workflow-dispatch\n' + JSON.stringify(command) + '\n' + fence,
  };
  const request = buildProtectedWorkflowDispatchRequest(command, { authorizationCommentId: comment.id });
  assert.equal(request.ok, true);
  const event = { repository: { full_name: REPOSITORY }, inputs: request.body.inputs };
  const dispatch = parsePersonalRepositoryDispatchInputs(event.inputs);
  assert.equal(dispatch.valid, true);
  const current = runRecord(CURRENT_RUN_ID, HEAD, { status: 'in_progress', conclusion: null });
  return {
    context: {
      event, dispatch, repository: REPOSITORY, owner: 'Cheekyfellastef', repo: 'stephan-os',
      runId: CURRENT_RUN_ID, runAttempt: 1, authorizationCommentId: comment.id,
      authorizationCommentSha256: createHash('sha256').update(comment.body).digest('hex'),
    },
    comment, current,
    definitions: [{ id: WORKFLOW_ID, name: 'Protected Operator Merge Queue Boundary',
      path: WORKFLOW_PATH, state: 'active' }],
    runs: [current], jobs: new Map(),
    inventoryReply: null,
  };
}

function addPrior(f, overrides = {}) {
  const run = runRecord(PRIOR_RUN_ID, HEAD, overrides);
  f.runs.push(run);
  f.jobs.set(run.id, earlyFailureJobs(run));
  return run;
}

function inventoryRows(current, count) {
  return [current, ...Array.from({ length: count - 1 }, (_, index) =>
    runRecord(10000 + index, (index + 1).toString(16).padStart(40, '0')))];
}

function paginate(items, page, itemKey) {
  return { total_count: items.length, [itemKey]: items.slice((page - 1) * 100, page * 100) };
}

// Exercise the actual exported preflight and its DEFAULT execution collector.
// The sentinel stops before PR/check/review admission: collection success grants
// no approval or mutation authority. All fetches are fixture-only bounded GETs.
async function collect(t, f) {
  const requests = [];
  let identityReads = 0;
  let error;
  let globalInventoryReads = 0;
  let unrelatedBaseCount = 500;
  const saved = new Map(['GH_TOKEN', 'GITHUB_REPOSITORY'].map(key => [key, process.env[key]]));
  process.env.GH_TOKEN = 'fixture-token-no-network';
  process.env.GITHUB_REPOSITORY = REPOSITORY;
  const mock = t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.github.com', 'no external fixture endpoint');
    assert.equal(options.method || 'GET', 'GET', 'no mutation request is admitted by this harness');
    assert.equal(options.body, undefined);
    requests.push(url);
    unrelatedBaseCount++;
    let payload;
    if (url.pathname === ROOT + '/actions/workflows') {
      assert.equal(url.search, '?per_page=100&page=1');
      payload = { total_count: f.definitions.length, workflows: f.definitions };
    } else if (url.pathname === ROOT + '/actions/runs/' + CURRENT_RUN_ID) {
      assert.equal(url.search, '');
      payload = f.current;
    } else if (url.pathname === ROOT + '/issues/comments/' + f.comment.id) {
      assert.equal(url.search, '');
      payload = f.comment;
    } else if (url.pathname === ROOT + '/actions/workflows/' + WORKFLOW_ID + '/runs') {
      assert.equal(url.searchParams.get('event'), 'workflow_dispatch');
      assert.equal(url.searchParams.get('per_page'), '100');
      const page = Number(url.searchParams.get('page'));
      assert.ok(Number.isSafeInteger(page) && page >= 1 && page <= 20);
      if (!url.searchParams.has('head_sha')) {
        // A deliberately unstable global estate is available only as a red
        // regression control. The repaired collector must never request it.
        globalInventoryReads++;
        const foreign = Array.from({ length: unrelatedBaseCount }, (_, index) =>
          runRecord(30000 + index, (index + 30000).toString(16).padStart(40, '0'), { head_sha: OTHER_BASE }));
        payload = paginate([...f.runs, ...foreign], page, 'workflow_runs');
      } else {
        assert.equal(url.searchParams.get('head_sha'), BASE, 'bind to dispatch base, never the feature head');
        assert.notEqual(url.searchParams.get('head_sha'), HEAD);
        assert.deepEqual([...url.searchParams.keys()].sort(), ['event', 'head_sha', 'page', 'per_page']);
        payload = f.inventoryReply ? f.inventoryReply(page) : paginate(f.runs, page, 'workflow_runs');
      }
    } else {
      const match = url.pathname.match(new RegExp('^' + ROOT + '/actions/runs/([1-9][0-9]*)/jobs$'));
      assert.ok(match, 'unexpected endpoint: ' + url.pathname);
      const runId = Number(match[1]);
      assert.ok(f.jobs.has(runId), 'unexpected job inventory: ' + runId);
      assert.equal(url.searchParams.get('filter'), 'all', 'all run attempts must be retained');
      assert.equal(url.searchParams.get('per_page'), '100');
      assert.equal(url.searchParams.get('page'), '1');
      assert.deepEqual([...url.searchParams.keys()].sort(), ['filter', 'page', 'per_page']);
      payload = { total_count: f.jobs.get(runId).length, jobs: f.jobs.get(runId) };
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  try {
    await preflightBeforeProtectedApproval(f.context, {
      readIdentity: async () => { identityReads++; throw EXECUTION_COLLECTED; },
    });
  } catch (caught) {
    error = caught;
  } finally {
    mock.mock.restore();
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return {
    error, identityReads, requests, globalInventoryReads, unrelatedBaseCount,
    inventoryRequests: requests.filter(url => url.pathname.endsWith('/workflows/' + WORKFLOW_ID + '/runs')),
    jobRequests: requests.filter(url => url.pathname.endsWith('/jobs')),
  };
}

function assertCollected(result) {
  assert.equal(result.error, EXECUTION_COLLECTED,
    result.error?.message + ' ' + JSON.stringify(result.error?.details));
  assert.equal(result.identityReads, 1);
  assert.equal(result.globalInventoryReads, 0);
}

function assertHeld(result, blocker) {
  assert.notEqual(result.error, EXECUTION_COLLECTED);
  assert.equal(result.identityReads, 0);
  assert.ok(result.error?.details?.blockers?.includes(blocker),
    result.error?.message + ' ' + JSON.stringify(result.error?.details));
}

test('actual collector reads both exact-base pages while unrelated global history changes', async t => {
  const f = fixture();
  f.runs = inventoryRows(f.current, 101);
  const result = await collect(t, f);
  assertCollected(result);
  assert.deepEqual(result.inventoryRequests.map(url => url.searchParams.get('page')), ['1', '2']);
  assert.ok(result.unrelatedBaseCount > 500);
  assert.equal(result.jobRequests.length, 0);
});

test('a same-base source collision on page two remains blocking', async t => {
  for (const actor of [BOT, OWNER]) {
    const f = fixture();
    f.runs = inventoryRows(f.current, 100);
    addPrior(f, { status: 'in_progress', conclusion: null, triggering_actor: { ...actor } });
    const result = await collect(t, f);
    assertHeld(result, 'personal-repository-prior-attempt-exists');
    assert.equal(result.inventoryRequests.length, 2);
    assert.equal(result.jobRequests.length, 1);
  }
});

test('a page-two early failure qualifies only after complete all-attempt job proof', async t => {
  const f = fixture();
  f.runs = inventoryRows(f.current, 100);
  const prior = addPrior(f, { run_attempt: 2 });
  const result = await collect(t, f);
  assertCollected(result);
  assert.equal(result.inventoryRequests.length, 2);
  assert.equal(result.jobRequests.length, 1);
  assert.equal(result.jobRequests[0].pathname, ROOT + '/actions/runs/' + prior.id + '/jobs');
  assert.equal(result.jobRequests[0].searchParams.get('filter'), 'all');
  assert.deepEqual(f.jobs.get(prior.id).map(job => job.run_attempt), [1, 1, 1, 2, 2, 2]);
});

test('missing earlier-attempt jobs and malformed terminal job bindings remain blocking', async t => {
  for (const mutate of [
    jobs => jobs.filter(job => job.run_attempt === 2),
    jobs => { jobs[0].run_id++; return jobs; },
    jobs => { jobs[0].head_sha = OTHER_BASE; return jobs; },
    jobs => { jobs[0].url += '/forged'; return jobs; },
    jobs => { jobs[0].run_attempt = 3; return jobs; },
    jobs => { jobs[1].id = jobs[0].id; return jobs; },
  ]) {
    const f = fixture();
    const prior = addPrior(f, { run_attempt: 2 });
    f.jobs.set(prior.id, mutate(f.jobs.get(prior.id)));
    assertHeld(await collect(t, f), 'personal-repository-prior-attempt-exists');
  }
});

test('prior approval or squash execution cannot become an early read-only failure', async t => {
  for (const [index, status, conclusion] of [
    [1, 'completed', 'success'], [1, 'in_progress', null],
    [2, 'completed', 'failure'], [2, 'completed', 'success'],
  ]) {
    const f = fixture();
    const prior = addPrior(f);
    Object.assign(f.jobs.get(prior.id)[index], { status, conclusion });
    assertHeld(await collect(t, f), 'personal-repository-prior-attempt-exists');
  }
});

test('the actual evidence-success approval-success merge-failure pattern stays held', async t => {
  const f = fixture();
  const prior = addPrior(f);
  const jobs = f.jobs.get(prior.id);
  jobs[0].conclusion = 'success';
  jobs[1].conclusion = 'success';
  jobs[2].conclusion = 'failure';
  assertHeld(await collect(t, f), 'personal-repository-prior-attempt-exists');
});

test('current run attempt two is rejected by the real actor-handoff gate', async t => {
  const f = fixture();
  f.current.run_attempt = 2;
  f.context.runAttempt = 2;
  const result = await collect(t, f);
  assert.equal(result.error?.message, 'PROTECTED_WORKFLOW_HANDOFF_RUN_IDENTITY_INVALID');
  assert.equal(result.identityReads, 0);
  assert.equal(result.inventoryRequests.length, 0);
});

test('wrong or missing current run and authorization identity cannot reach collection success', async t => {
  for (const [mutate, message] of [
    [f => { f.current.head_sha = HEAD; }, 'PROTECTED_WORKFLOW_HANDOFF_RUN_IDENTITY_INVALID'],
    [f => { delete f.current.repository; }, 'PROTECTED_WORKFLOW_HANDOFF_RUN_IDENTITY_INVALID'],
    [f => { f.current.path = '.github/workflows/unrelated.yml'; }, 'PROTECTED_WORKFLOW_HANDOFF_RUN_IDENTITY_INVALID'],
    [f => { f.current.created_at = '2026-10-25T10:08:01Z'; }, 'PROTECTED_WORKFLOW_DISPATCH_EXPIRED'],
    [f => { f.comment.body += '\nchanged'; }, 'PROTECTED_WORKFLOW_AUTHORIZATION_COMMENT_DIGEST_MISMATCH'],
    [f => { f.comment.user.id++; }, 'PROTECTED_WORKFLOW_AUTHORIZATION_COMMENT_AUTHOR_MISMATCH'],
  ]) {
    const f = fixture(); mutate(f);
    const result = await collect(t, f);
    assert.equal(result.error?.message, message);
    assert.equal(result.identityReads, 0);
    assert.equal(result.inventoryRequests.length, 0);
  }
});

test('same-source returned rows with missing or malformed identity remain held', async t => {
  for (const mutate of [
    run => { delete run.id; },
    run => { delete run.head_sha; },
    run => { run.head_sha = 'invalid'; },
    run => { run.repository.full_name = 'other/repository'; },
    run => { run.path = '.github/workflows/other.yml'; },
    run => { run.workflow_id++; },
    run => { run.head_branch = 'feature'; },
  ]) {
    const f = fixture();
    const prior = addPrior(f);
    mutate(prior);
    assertHeld(await collect(t, f), 'personal-repository-prior-attempt-invalid');
  }
});

test('same-base total changes remain a hard paginator failure', async t => {
  const f = fixture();
  f.runs = inventoryRows(f.current, 101);
  f.inventoryReply = page => ({ ...paginate(f.runs, page, 'workflow_runs'), total_count: page === 1 ? 101 : 102 });
  const result = await collect(t, f);
  assert.equal(result.error?.message, 'GitHub paginated total changed during the bounded read.');
  assert.equal(result.error?.details?.page, 2);
  assert.ok(result.error?.details?.path.endsWith('&head_sha=' + BASE));
  assert.equal(result.identityReads, 0);
});

test('a truncated terminal page cannot hide same-base source attempts', async t => {
  const f = fixture();
  f.runs = inventoryRows(f.current, 100);
  addPrior(f);
  f.inventoryReply = page => ({ total_count: 101, workflow_runs: page === 1 ? f.runs.slice(0, 100) : [] });
  const result = await collect(t, f);
  assert.equal(result.error?.message, 'GitHub pagination did not return the declared complete collection.');
  assert.equal(result.error?.details?.expectedTotal, 101);
  assert.equal(result.error?.details?.observedTotal, 100);
  assert.equal(result.identityReads, 0);
});

test('invalid same-base collections never become an empty successful history', async t => {
  const f = fixture();
  f.inventoryReply = () => ({ total_count: 0, workflow_runs: null });
  const result = await collect(t, f);
  assert.equal(result.error?.message, 'GitHub paginated response had an invalid collection.');
  assert.equal(result.identityReads, 0);
});

test('the existing twenty-page inventory bound still fails closed', async t => {
  const f = fixture();
  f.runs = inventoryRows(f.current, 2001);
  const result = await collect(t, f);
  assert.equal(result.error?.message, 'GitHub pagination exceeded the bounded maximum.');
  assert.equal(result.error?.details?.pages, 20);
  assert.equal(result.inventoryRequests.length, 20);
  assert.equal(result.inventoryRequests.at(-1).searchParams.get('page'), '20');
  assert.equal(result.identityReads, 0);
});

test('the summed all-attempt proof bound is enforced before job hydration', async t => {
  const f = fixture();
  addPrior(f, { run_attempt: 8 });
  const extra = runRecord(PRIOR_RUN_ID + 1);
  f.runs.push(extra);
  f.jobs.set(extra.id, earlyFailureJobs(extra));
  const result = await collect(t, f);
  assertHeld(result, 'personal-repository-prior-run-attempt-limit-exceeded');
  assert.equal(result.jobRequests.length, 0);
});

