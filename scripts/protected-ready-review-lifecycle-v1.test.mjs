import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  prepareReadyReviewProducer, finishReadyReviewProducer, dispatchReadyReview,
  prepareReadyReview, executeReadyReview, loadProtectedReadyReviewLifecycle, readReadyReviewCollection,
  loadReadyReviewHandoff, readReadyReviewUnresolvedThreads, readyReviewTransports,
} from './protected-ready-review-lifecycle-v1.mjs';
import { validateProtectedReadyReviewLifecycleEvidence, parseReadyReviewInputs,
  sealReadyReviewPayload, READY_REVIEW_HANDOFF_FILE, READY_REVIEW_RECEIPT_FILE } from '../shared/agents/protectedReadyReviewLifecycleV1.mjs';
import { readyLifecycleFixture, fixtureEnv, fixtureTransport, fixtureThreadPage,
  fixtureArtifact, clock } from '../shared/agents/fixtures/protectedReadyReviewLifecycleV1.fixture.mjs';

function active(run) { run.status = 'in_progress'; run.conclusion = null; }
function activeJob(job) { active(job); job.completed_at = null; }
function deps(f, role) { return { ...fixtureTransport(f), env: fixtureEnv(f, role), sourceSha: f.identity.baseSha }; }
function prepareActive(f) {
  active(f.proof.handoff.run); activeJob(f.proof.handoff.dispatchJob);
  active(f.proof.review.run); activeJob(f.proof.review.job);
}

test('loads complete real-shaped GitHub evidence and keeps the base-headed review separate', async () => {
  const f = readyLifecycleFixture(), transport = fixtureTransport(f);
  const proof = await loadProtectedReadyReviewLifecycle({ identity: f.identity, skippedRunIds: [50], ...transport });
  assert.equal(validateProtectedReadyReviewLifecycleEvidence(proof, f.identity, 50).valid, true);
  assert.equal(proof.review.run.head_sha, f.identity.baseSha);
  assert.equal(proof.review.run.event, 'workflow_dispatch');
  assert.ok(transport.calls.includes('/actions/runs/100/attempts/1/jobs?filter=all&per_page=100&page=1'));
  assert.ok(transport.calls.includes('/check-runs/201'));
  assert.equal(transport.calls.filter(p => p.startsWith('/actions/workflows/stephanos-exact-head-review.yml/runs?')).length, 2);
});

test('full artifact bytes and singleton immutable metadata are required before consumer admission', async t => {
  for (const attack of ['corrupt archive', 'different payload', 'different name', 'duplicate metadata']) {
    await t.test(attack, async () => {
      const f = readyLifecycleFixture(), transport = fixtureTransport(f);
      if (attack === 'corrupt archive') transport.download = async () => Buffer.from('corrupted');
      if (attack === 'different payload') transport.artifacts.get(502).zip = transport.artifacts.get(501).zip;
      if (attack === 'different name') transport.artifacts.get(502).metadata.name += '-unbound';
      if (attack === 'duplicate metadata') transport.artifacts.set(503, {
        ...transport.artifacts.get(502), metadata: { ...transport.artifacts.get(502).metadata, id: 503 } });
      await assert.rejects(loadProtectedReadyReviewLifecycle({ identity: f.identity, skippedRunIds: [50], ...transport }), /ARTIFACT/);
    });
  }
});

test('collector rejects producer failure after artifact upload and a later conflicting review', async () => {
  for (const failure of ['producer', 'later pending', 'later canceled', 'later unbound']) {
    const f = readyLifecycleFixture(), transport = fixtureTransport(f);
    if (failure === 'producer') f.proof.handoff.run.conclusion = 'failure';
    else transport.inventory.runs.push({ ...f.proof.review.run, id: 300,
      ...(failure === 'later pending' ? { status: 'in_progress', conclusion: null } : { conclusion: 'cancelled' }),
      ...(failure === 'later unbound' ? { display_title: 'ambiguous execution' } : {}) });
    await assert.rejects(loadProtectedReadyReviewLifecycle({ identity: f.identity, skippedRunIds: [50], ...transport }));
  }
});

test('final proof reread sees changed main, head, tree, draft and owner record', async t => {
  const attacks = {
    main: f => { f.state.main.object.sha = 'e'.repeat(40); },
    head: f => { f.state.pull.head.sha = 'e'.repeat(40); },
    tree: f => { f.state.commit.tree.sha = 'e'.repeat(40); },
    draft: f => { f.state.pull.draft = true; },
    owner: f => { f.proof.handoff.ownerComment.updated_at = clock(2); },
  };
  for (const [name, mutate] of Object.entries(attacks)) await t.test(name, async () => {
    const f = readyLifecycleFixture(), transport = fixtureTransport(f);
    assert.ok(await loadProtectedReadyReviewLifecycle({ identity: f.identity, skippedRunIds: [50], ...transport }));
    mutate(f);
    await assert.rejects(loadProtectedReadyReviewLifecycle({ identity: f.identity, skippedRunIds: [50], ...transport }));
  });
});

test('a complete clean selection is validated before the new draft transition and sealed after reality reread', async () => {
  const f = readyLifecycleFixture(); active(f.proof.handoff.run); f.state.pull.draft = true;
  const d = deps(f, 'dispatch');
  const prepared = await prepareReadyReviewProducer({ command: f.command,
    comment: f.proof.handoff.ownerComment, ...d, now: () => clock(5) });
  assert.equal(prepared.beforeDraft, true);
  assert.equal(prepared.unresolvedReviewThreads, 0);
  assert.ok(d.calls.includes('reviewThreads:2094:null'));
  const dir = mkdtempSync(join(tmpdir(), 'ready-review-test-'));
  try {
    const args = { ...d, env: { ...d.env, GITHUB_OUTPUT: join(dir, 'outputs') }, path: join(dir, 'handoff.json'), now: clock(8) };
    await assert.rejects(finishReadyReviewProducer(prepared, 'READY_FOR_REVIEW_PROVEN', args), /DRAFT_CHANGED/);
    f.state.pull.draft = false;
    const handoff = await finishReadyReviewProducer(prepared, 'READY_FOR_REVIEW_PROVEN', args);
    assert.equal(handoff.command.independentReviewPayloadSha256, f.command.independentReviewPayloadSha256);
    assert.equal(handoff.unresolvedReviewThreads, 0);
    assert.match(readFileSync(join(dir, 'outputs'), 'utf8'), /ready_review=true/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'handoff.json'), 'utf8')).payloadSha256, handoff.payloadSha256);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('draft bootstrap remains HOLD; independently already-ready bootstrap is not mislabeled clean', async () => {
  const f = readyLifecycleFixture({ bootstrap: true, alreadyReady: true }); active(f.proof.handoff.run);
  f.state.pull.draft = true;
  const args = { command: f.command, comment: f.proof.handoff.ownerComment, ...deps(f, 'dispatch'), now: () => clock(5),
    readThreadsPage: async () => { throw new Error('already-ready must not create a new transition gate'); } };
  await assert.rejects(prepareReadyReviewProducer(args), /DRAFT_BOOTSTRAP_READY_NOT_AUTHORIZED/);
  f.state.pull.draft = false;
  const prepared = await prepareReadyReviewProducer(args);
  assert.equal(prepared.beforeDraft, false);
  assert.equal(prepared.unresolvedReviewThreads, null);
  assert.equal(f.proof.independent.payload.reviewMode, 'qualified-operator-bootstrap');
});

test('new draft transition requires the existing planner zero-thread predicate and exact complete query evidence', async t => {
  const attacks = {
    unresolved: page => { page.data.repository.pullRequest.reviewThreads = {
      totalCount: 1, nodes: [{ id: 'PRRT_1', isResolved: false }], pageInfo: { hasNextPage: false, endCursor: null } }; },
    truncated: page => { page.data.repository.pullRequest.reviewThreads.totalCount = 1; },
    'unknown resolution': page => { page.data.repository.pullRequest.reviewThreads = {
      totalCount: 1, nodes: [{ id: 'PRRT_1' }], pageInfo: { hasNextPage: false, endCursor: null } }; },
    'unknown page state': page => { delete page.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage; },
    'stale head': page => { page.data.repository.pullRequest.headRefOid = 'e'.repeat(40); },
    'stale base': page => { page.data.repository.pullRequest.baseRefOid = 'e'.repeat(40); },
    'other PR': page => { page.data.repository.pullRequest.number++; },
    'other repository': page => { page.data.repository.nameWithOwner = 'other/repository'; },
    'draft changed': page => { page.data.repository.pullRequest.isDraft = false; },
    'GraphQL partial error': page => { page.errors = [{ message: 'partial data' }]; },
    'over bound': page => { page.data.repository.pullRequest.reviewThreads.totalCount = 601; },
  };
  for (const [name, attack] of Object.entries(attacks)) await t.test(name, async () => {
    const f = readyLifecycleFixture(); active(f.proof.handoff.run); f.state.pull.draft = true;
    const d = deps(f, 'dispatch'), page = fixtureThreadPage(f); attack(page);
    d.threadPages.push(page);
    await assert.rejects(prepareReadyReviewProducer({ command: f.command,
      comment: f.proof.handoff.ownerComment, ...d, now: () => clock(5) }), /REVIEW_(THREAD|NOT_CLEAN)/);
  });
});

test('thread collection paginates completely, rejects changing totals, and never ignores unresolved later pages', async () => {
  const f = readyLifecycleFixture(); f.state.pull.draft = true;
  const first = fixtureThreadPage(f, { totalCount: 101, hasNextPage: true, endCursor: 'cursor-100',
    nodes: Array.from({ length: 100 }, (_, n) => ({ id: `PRRT_${n}`, isResolved: true })) });
  const last = fixtureThreadPage(f, { totalCount: 101, nodes: [{ id: 'PRRT_100', isResolved: true }] });
  const d = fixtureTransport(f); d.threadPages.push(first, last);
  assert.equal(await readReadyReviewUnresolvedThreads(d.readThreadsPage, f.identity), 0);
  assert.deepEqual(d.calls, ['reviewThreads:2094:null', 'reviewThreads:2094:cursor-100']);
  last.data.repository.pullRequest.reviewThreads.nodes[0].isResolved = false;
  d.threadPages.push(first, last);
  assert.equal(await readReadyReviewUnresolvedThreads(d.readThreadsPage, f.identity), 1);
  last.data.repository.pullRequest.reviewThreads.totalCount = 102;
  d.threadPages.push(first, last);
  await assert.rejects(readReadyReviewUnresolvedThreads(d.readThreadsPage, f.identity), /CHANGED/);
  last.data.repository.pullRequest.reviewThreads.totalCount = 101;
  last.data.repository.pullRequest.reviewThreads.nodes[0].id = 'PRRT_0';
  d.threadPages.push(first, last);
  await assert.rejects(readReadyReviewUnresolvedThreads(d.readThreadsPage, f.identity), /DUPLICATE/);
});

test('thread query cannot renew the owner window before the new draft mutation', async () => {
  const f = readyLifecycleFixture(); active(f.proof.handoff.run); f.state.pull.draft = true;
  const d = deps(f, 'dispatch'); let current = clock(5);
  await assert.rejects(prepareReadyReviewProducer({ command: f.command, comment: f.proof.handoff.ownerComment,
    ...d, now: () => current, readThreadsPage: async () => { current = clock(301); return fixtureThreadPage(f); } }), /EXPIRED/);
});

test('fixed dispatch follows completed READY producer and does not replay ALREADY_READY or another tuple attempt', async () => {
  const f = readyLifecycleFixture({ alreadyReady: true }); active(f.proof.handoff.run); activeJob(f.proof.handoff.dispatchJob);
  const d = deps(f, 'review-ready'), posts = [];
  d.inventory.runs = [];
  const result = await dispatchReadyReview({ inputs: f.inputs, ...d, now: () => clock(15),
    dispatch: async (path, body) => { posts.push({ path, body }); d.inventory.runs = [f.proof.review.run]; } });
  assert.equal(result.verdict, 'PROTECTED_READY_REVIEW_DISPATCHED');
  assert.equal(result.reviewRunId, 200);
  assert.deepEqual(posts, [{ path: '/actions/workflows/stephanos-exact-head-review.yml/dispatches',
    body: { ref: 'main', inputs: f.inputs } }]);
  d.inventory.runs = [{ ...f.proof.review.run, conclusion: 'failure' }];
  await assert.rejects(dispatchReadyReview({ inputs: f.inputs, ...d, now: () => clock(16),
    dispatch: async () => { posts.push('unexpected'); } }), /ALREADY_DISPATCHED/);
  assert.equal(posts.length, 1);
  d.inventory.runs = []; activeJob(f.proof.handoff.job);
  await assert.rejects(dispatchReadyReview({ inputs: f.inputs, ...d, now: () => clock(17),
    dispatch: async () => { posts.push('unexpected'); } }), /JOB_PROVENANCE/);
  assert.equal(posts.length, 1);
});

test('one POST is followed by bounded observation of its queued bound run while the launcher is active', async () => {
  const f = readyLifecycleFixture(); active(f.proof.handoff.run); activeJob(f.proof.handoff.dispatchJob);
  const d = deps(f, 'review-ready'), waits = []; let posts = 0;
  d.inventory.runs = [];
  const queued = { ...f.proof.review.run, status: 'queued', conclusion: null, run_started_at: null };
  const result = await dispatchReadyReview({ inputs: f.inputs, ...d, now: () => clock(15),
    dispatch: async () => { posts++; }, wait: async ms => {
      waits.push(ms); d.inventory.runs = [queued]; d.runs.set(200, queued);
    } });
  assert.equal(posts, 1);
  assert.deepEqual(waits, [5000]);
  assert.equal(result.reviewRunId, 200); assert.equal(result.launchStatus, 'queued');
  await assert.rejects(loadProtectedReadyReviewLifecycle({ identity: f.identity, skippedRunIds: [50], ...d }), /PROVENANCE_OR_STATE/);
});

test('unobserved, ambiguous, unbound, wrong-actor or expired launches never send a second POST', async t => {
  for (const attack of ['not visible', 'ambiguous', 'unbound handoff', 'wrong actor', 'second attempt', 'expired']) {
    await t.test(attack, async () => {
      const f = readyLifecycleFixture(); active(f.proof.handoff.run); activeJob(f.proof.handoff.dispatchJob);
      const d = deps(f, 'review-ready'); d.inventory.runs = [];
      let posts = 0, waits = 0, current = clock(15);
      const run = { ...f.proof.review.run };
      await assert.rejects(dispatchReadyReview({ inputs: f.inputs, ...d, now: () => current,
        dispatch: async () => {
          posts++;
          if (attack === 'not visible' || attack === 'expired') return;
          if (attack === 'unbound handoff') run.display_title = run.display_title.replace(/binding-[a-f0-9]+$/, `binding-${'e'.repeat(64)}`);
          if (attack === 'wrong actor') run.actor = { login: 'github-actions[bot]', id: 99 };
          if (attack === 'second attempt') run.run_attempt = 2;
          d.runs.set(200, run); d.inventory.runs = attack === 'ambiguous' ? [run, { ...run, id: 300 }] : [run];
        }, wait: async ms => { assert.equal(ms, 5000); waits++; if (attack === 'expired') current = clock(301); },
      }), /PROTECTED_READY_REVIEW_BLOCKED/);
      assert.equal(posts, 1);
      assert.equal(waits, attack === 'not visible' ? 5 : attack === 'expired' ? 1 : 0);
    });
  }
});

test('receipt and handoff IDs are validated before they can select API paths', async t => {
  for (const key of ['readyRunId', 'readyArtifactId', 'prNumber']) await t.test(`normalized ${key}`, async () => {
    const f = readyLifecycleFixture(), d = fixtureTransport(f);
    await assert.rejects(loadReadyReviewHandoff({ ...parseReadyReviewInputs(f.inputs), [key]: '1/../../issues/7' }, d), /NORMALIZED/);
    assert.deepEqual(d.calls, []);
  });
  for (const [key, value] of [['handoffRunId', '1/../../issues/7'], ['handoffArtifactId', -1],
    ['escalationCommentId', '900'], ['handoffRunId', Number.MAX_SAFE_INTEGER + 1]]) {
    await t.test(`receipt ${key} ${value}`, async () => {
      const f = readyLifecycleFixture(), d = fixtureTransport(f), old = f.proof.review.artifact;
      const { payloadSha256, ...body } = old.payload;
      const artifact = fixtureArtifact(502, old.metadata.name, READY_REVIEW_RECEIPT_FILE,
        sealReadyReviewPayload({ ...body, [key]: value }), f.proof.review.run, clock(51));
      d.artifacts.set(502, artifact);
      await assert.rejects(loadProtectedReadyReviewLifecycle({ identity: f.identity, skippedRunIds: [50], ...d }), /NORMALIZED|COMMENT_ID_INVALID/);
      assert.equal(d.calls.some(path => path.includes('/actions/runs/100') || path.includes('/issues/comments/')), false);
      assert.equal(d.calls.some(path => path.includes('..') || path.includes(String(Number.MAX_SAFE_INTEGER + 1))), false);
    });
  }
  await t.test('handoff owner comment ID', async () => {
    const f = readyLifecycleFixture(), d = fixtureTransport(f), old = f.proof.handoff.artifact;
    const { payloadSha256, ...body } = old.payload;
    const payload = sealReadyReviewPayload({ ...body, authorizationCommentId: '900/../901' });
    d.artifacts.set(501, fixtureArtifact(501, old.metadata.name, READY_REVIEW_HANDOFF_FILE, payload, f.proof.handoff.run, clock(9)));
    await assert.rejects(loadReadyReviewHandoff({ ...parseReadyReviewInputs(f.inputs), handoffSha256: payload.payloadSha256 }, d), /API_ID_INVALID/);
    assert.equal(d.calls.some(path => path.includes('/issues/comments/')), false);
  });
});

test('thread transport exposes only the fixed read-only query and typed variables under existing permissions', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options }); return { ok: true, text: async () => '{}' };
  });
  const transport = readyReviewTransports({ GITHUB_TOKEN: 'fixture-token' });
  await transport.readThreadsPage(2094, null);
  const request = calls[0], body = JSON.parse(request.options.body);
  assert.equal(request.url, 'https://api.github.com/graphql');
  assert.equal(request.options.method, 'POST'); assert.equal(request.options.redirect, 'error');
  assert.match(body.query, /^query\(/); assert.doesNotMatch(body.query, /mutation|reviewDecision/);
  assert.match(body.query, /repository\(owner:"Cheekyfellastef",name:"stephan-os"\)/);
  assert.match(body.query, /reviewThreads\(first:100,after:\$after\)/);
  assert.deepEqual(body.variables, { number: 2094, after: null });
  await assert.rejects(transport.readThreadsPage('2094', null), /API_ID_INVALID/);
  await assert.rejects(transport.readThreadsPage(2094, {}), /QUERY_INPUT/);
  assert.equal(calls.length, 1);
});

test('target runs unchanged engine on full exact input and keeps a genuine clean result', async () => {
  const f = readyLifecycleFixture(); prepareActive(f);
  const d = deps(f, 'exact-head-review');
  const prepared = await prepareReadyReview({ inputs: f.inputs, ...d, now: clock(15) });
  const receipt = await executeReadyReview({ prepared, input: f.input, ...d, now: () => clock(50) });
  assert.equal(receipt.engineReceipt.verdict, 'STEPHANOS_REVIEW_PASS');
  assert.deepEqual(receipt.engineReceipt.findings, []);
  assert.equal(receipt.qualification, null);
  assert.equal(receipt.independentReviewMode, 'clean-independent');
  await assert.rejects(executeReadyReview({ prepared, input: { ...f.input, headSha: 'e'.repeat(40) }, ...d,
    now: () => clock(50) }), /ENGINE_INPUT_BINDING/);
});

test('authenticated owner READY cannot substitute for separate owner escalation of actual engine findings', async () => {
  const f = readyLifecycleFixture({ engineFindings: true }); prepareActive(f);
  const d = deps(f, 'exact-head-review');
  const prepared = await prepareReadyReview({ inputs: f.inputs, ...d, now: clock(15) });
  f.proof.escalationComment = null;
  await assert.rejects(executeReadyReview({ prepared, input: f.input, ...d, now: () => clock(50) }), /OWNER_COMMENT_ABSENT/);
});

test('actual unchanged qualification composes with already-ready bootstrap without erasing residual findings', async () => {
  const f = readyLifecycleFixture({ bootstrap: true, alreadyReady: true, engineFindings: true }); prepareActive(f);
  const d = deps(f, 'exact-head-review');
  const prepared = await prepareReadyReview({ inputs: f.inputs, ...d, now: clock(15) });
  const receipt = await executeReadyReview({ prepared, input: f.input, ...d, now: () => clock(50) });
  assert.equal(receipt.engineReceipt.verdict, 'STEPHANOS_REVIEW_FINDINGS');
  assert.equal(receipt.independentReviewMode, 'qualified-operator-bootstrap');
  assert.equal(receipt.qualification.finalVerdict, 'EXACT_HEAD_QUALIFIED_ESCALATION_PASS');
  assert.equal(receipt.qualification.mergeAuthority, false);
  assert.equal(receipt.escalationCommentId, 901);
});

test('incomplete, oversized or unstable GitHub inventories cannot establish absence or select old success', async () => {
  await assert.rejects(readReadyReviewCollection(async () => ({ total_count: 101, workflow_runs: [{ id: 1 }] }), '/runs', 'workflow_runs'), /TRUNCATED/);
  await assert.rejects(readReadyReviewCollection(async () => ({ total_count: 601, workflow_runs: [] }), '/runs', 'workflow_runs'), /INCOMPLETE/);
  let page = 0;
  await assert.rejects(readReadyReviewCollection(async () => (++page === 1
    ? { total_count: 101, workflow_runs: Array.from({ length: 100 }, (_, n) => ({ id: n + 1 })) }
    : { total_count: 102, workflow_runs: [{ id: 101 }] }), '/runs', 'workflow_runs'), /CHANGED/);
});

test('canonical workflows preserve draft guards, pin main source and upload separate single files after successful jobs', () => {
  const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const mailbox = source('.github/workflows/protected-workflow-dispatch-mailbox.yml');
  const reviewer = source('.github/workflows/stephanos-exact-head-review.yml');
  assert.match(mailbox, /review-ready:\n    needs: \[dispatch\]\n    if: needs\.dispatch\.outputs\.ready_review == 'true'/);
  assert.match(mailbox, /ref: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(mailbox, /ref: main|overwrite: true/);
  assert.match(mailbox, /path: protected-ready-review-handoff\.json/);
  assert.match(mailbox, /permissions:\n      actions: write\n      contents: read\n      issues: read\n      pull-requests: read/);
  assert.match(reviewer, /github\.event_name == 'pull_request_target' && !github\.event\.pull_request\.draft/);
  assert.match(reviewer, /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main' && github\.sha == inputs\.base_sha/);
  assert.match(reviewer, /test "\$\{GITHUB_WORKFLOW_SHA\}" = "\$\{GITHUB_SHA\}"/);
  assert.match(reviewer, /path: protected-ready-review-receipt\.json/);
  assert.match(reviewer, /path: review-proof\//);
  assert.match(reviewer, /if: github\.event_name != 'workflow_dispatch'[\s\S]*node scripts\/exact-head-qualified-escalation-v1\.mjs/);
  const collector = source('scripts/operator-protected-personal-repository-merge.mjs');
  assert.match(collector, /initialReadyReview = await loadReadyReviewForSnapshot/);
  assert.match(collector, /refreshedAuthority = await readPersonalRepositoryAuthoritySnapshot[\s\S]*refreshedReadyReview = await loadReadyReviewForSnapshot/);
  assert.match(collector, /readyReviewLifecycleEvidence: refreshedReadyReview/);
  const dispatcher = source('scripts/dispatch-protected-merge-from-mailbox.mjs');
  assert.ok(dispatcher.indexOf('await prepareReadyReviewProducer') < dispatcher.indexOf('await graphqlReady(before.pull.node_id)'));
});
