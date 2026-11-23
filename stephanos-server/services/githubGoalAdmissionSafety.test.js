import './githubGoalEstateBoundedConcurrency.test.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  deriveGoalBodyResourceIds,
  fetchGithubGoalIssues,
  readSeedSourceContractCorrectionEvidenceV1,
  readCurrentOwnerAdmittedGoalPlanV1,
} from './githubPrEvidenceService.js';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const OWNER = 'Cheekyfellastef';
const REPO = 'stephan-os';

function response(payload, status = 200) { return { ok: status >= 200 && status < 300, status, headers: { get: () => '' }, json: async () => payload }; }
function canonicalGoal(overrides = {}) { return { number: 2314, title: 'Canary Goal: Prove multiplexer-backed autonomous goal build V1', state: 'open', user: { login: OWNER }, author_association: 'OWNER', performed_via_github_app: { slug: 'chatgpt' }, labels: [{ name: 'goal' }, { name: 'priority:high' }], body: 'Ordinary durable goal text with no special admission envelope.', html_url: 'https://github.com/Cheekyfellastef/stephan-os/issues/2314', created_at: '2026-09-21T00:00:00Z', updated_at: '2026-09-21T00:00:00Z', ...overrides }; }
function nonOwnerGoal(overrides = {}) { return canonicalGoal({ user: { login: 'contributor' }, author_association: 'CONTRIBUTOR', performed_via_github_app: null, ...overrides }); }
function admissionBody(overrides = {}) { const admission = { schemaVersion: 'stephanos.github-goal-admission.v1', issueNumber: 2314, repository: REPOSITORY, state: 'READY', route: 'OPENCLAW_LOCAL', prerequisites: [], sourceImplementationAllowed: true, mergeAuthority: false, deploymentAuthority: false, runtimeMutationAuthority: false, arbitraryShellAllowed: false, ...overrides }; return `Durable admission.\n\n\`\`\`stephanos-goal-admission-v1\n${JSON.stringify(admission)}\n\`\`\``; }
function ownerAdmissionComment(overrides = {}) { return { user: { login: OWNER }, author_association: 'OWNER', body: admissionBody(), ...overrides }; }
function ownerGoalLabelEvent() { return { event: 'labeled', label: { name: 'goal' }, actor: { login: OWNER } }; }

test('actual current ordinary reader separates selected authority from advisory observation frames', async () => {
  const now = Date.parse('2026-11-19T12:00:00Z');
  const issueUrl = 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/2314';
  const selected = ownerAdmissionComment({ id: 501, issue_url: issueUrl,
    created_at: '2026-11-19T11:58:00Z', updated_at: '2026-11-19T11:58:00Z',
    body: admissionBody({ resourceIds: ['repo:cheekyfellastef/stephan-os:path:scripts/ordinary.mjs'],
      requiredTests: ['node --test scripts/ordinary.test.mjs'] }) });
  const observe = async ({ comments = [selected], issueUpdate = '2026-11-19T11:58:00Z', events = [] } = {}) => {
    const requests = [];
    const fetchImpl = async url => {
      requests.push(String(url));
      if (url === issueUrl) return new Response(JSON.stringify(canonicalGoal({ url: issueUrl,
        body: 'Implement the existing bounded ordinary function.', updated_at: issueUpdate })), { status: 200 });
      if (String(url).startsWith(issueUrl + '/comments?')) return new Response(JSON.stringify(comments), { status: 200 });
      if (String(url).startsWith(issueUrl + '/events?')) return new Response(JSON.stringify(events), { status: 200 });
      throw new Error('UNEXPECTED_ENDPOINT');
    };
    return { observation: await readCurrentOwnerAdmittedGoalPlanV1(2314, {
      env: { GITHUB_TOKEN: 'test-token' }, nowMs: now, fetchImpl }), requests };
  };
  const first = await observe();
  assert.equal(first.observation.status, 'observed');
  assert.equal(first.observation.selectedAuthority.scope.commentId, 501);
  assert.equal(first.observation.sourceMutationAllowed, false);
  const second = await observe({ comments: [selected, ownerAdmissionComment({ id: 502,
    issue_url: issueUrl, body: 'Advisory progress update.', created_at: '2026-11-19T11:59:00Z',
    updated_at: '2026-11-19T11:59:00Z' })], issueUpdate: '2026-11-19T11:59:00Z',
    events: [{ id: 801, event: 'labeled', label: { name: 'status:observing' }, actor: { login: OWNER } }] });
  assert.equal(second.observation.status, 'observed');
  assert.equal(second.observation.authorityFingerprint, first.observation.authorityFingerprint);
  assert.notEqual(second.observation.frameFingerprint, first.observation.frameFingerprint);
  const malformed = await observe({ comments: [selected, ownerAdmissionComment({ id: 503,
    issue_url: issueUrl, body: '```stephanos-goal-admission-v1\n{bad}\n```' })] });
  assert.equal(malformed.observation.status, 'held');
  assert.equal(malformed.observation.reasonCode, 'CURRENT_SOURCE_PLAN_OWNER_EVIDENCE_INVALID');
});
function priorMirror(overrides = {}) {
  return {
    schemaVersion: 'shared-agent-workspace-record.v1',
    kind: 'stephanos.shared_workspace.goal',
    goalId: 'goal-2314',
    participantId: 'programme-authority',
    timestampUtc: '2026-09-22T00:00:00.000Z',
    issueNumber: 2314,
    relatedIssue: '#2314',
    repository: REPOSITORY,
    title: 'Canary Goal: Prove multiplexer-backed autonomous goal build V1',
    status: 'READY',
    state: 'READY',
    route: 'OPENCLAW_LOCAL',
    resourceIds: [],
    source: 'github-goal-estate-mirror',
    githubAdmissionState: 'ADMISSION_PROVEN',
    operatorLaneContainment: { active: false },
    mirrorSchema: 'stephanos.github-goal-mirror.v1',
    mirrorRepository: REPOSITORY,
    mirrorIssueNumber: 2314,
    mirrorObservedAtUtc: '2026-09-22T00:00:00.000Z',
    mirrorLeaseExpiresAtUtc: '2026-09-23T00:00:00.000Z',
    mirrorBuildPickupAllowed: true,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
    ...overrides,
  };
}
async function observe(issue, comments = [], commentStatus = 200, events = [ownerGoalLabelEvent()]) { return fetchGithubGoalIssues({ owner: OWNER, repo: REPO, auth: { configured: true, token: 'test-only', authority: 'test-only' }, fetchImpl: async (url) => { if (url.includes('/events?')) return response(events); if (url.includes('/comments?')) return response(comments, commentStatus); return response([issue]); }, maxPages: 1 }); }

test('one authenticated owner acceptance plan keeps tests outside mutation scope despite unrelated comments', async () => {
  const requiredTests = ['node --test scripts/sovereign-goal-builder-worker-evidence.test.mjs'];
  const resourceIds = ['repo:cheekyfellastef/stephan-os:path:shared/agents/canonicalMissionWorkerEvidenceV1.mjs'];
  const result = await observe(canonicalGoal({ comments: 2 }), [ownerAdmissionComment({ body: admissionBody({ resourceIds, requiredTests }) }),
    { user: { login: 'contributor' }, author_association: 'CONTRIBUTOR', body: 'ordinary discussion' }]);
  assert.deepEqual(result.issues[0].admission.requiredTests, requiredTests);
  assert.deepEqual(result.issues[0].admission.resourceIds, resourceIds);
  assert.equal(result.issues[0].admissionProofSource, 'OWNER_AUTHENTICATED_COMMENT');
});

test('invalid or ambiguous owner acceptance cannot silently fall back to general-only label admission', async () => {
  for (const commands of [[], ['node --test ../escape.test.mjs'], ['npm run arbitrary']]) {
    const result = await observe(canonicalGoal({ comments: 1 }), [ownerAdmissionComment({ body: admissionBody({ requiredTests: commands }) })]);
    assert.deepEqual(result.issues, []);
  }
  const body = admissionBody({ requiredTests: ['node --test scripts/a.test.mjs'] });
  assert.deepEqual((await observe(canonicalGoal({ comments: 2 }), [ownerAdmissionComment({ body }), ownerAdmissionComment({ body })])).issues, []);
  const escaped = admissionBody({ requiredTests: [] }).replace('requiredTests', 'required\\u0054ests');
  assert.deepEqual((await observe(canonicalGoal({ comments: 1 }), [ownerAdmissionComment({ body: escaped })])).issues, []);
});

test('an owner test-only admission preserves the label-derived mutation scope', async () => {
  const commands = ['node --test scripts/sovereign-goal-builder-worker-evidence.test.mjs'];
  const result = await observe(canonicalGoal({ comments: 1, body: 'Repair shared/agents/canonicalMissionWorkerEvidenceV1.mjs.' }),
    [ownerAdmissionComment({ body: admissionBody({ requiredTests: commands }) })]);
  assert.deepEqual(result.issues[0].admission.requiredTests, commands);
  assert.deepEqual(result.issues[0].admission.resourceIds,
    ['repo:cheekyfellastef/stephan-os:path:shared/agents/canonicalMissionWorkerEvidenceV1.mjs']);
});

test('contributor test plans never acquire owner test execution authority', async () => {
  const result = await observe(canonicalGoal({ comments: 1 }), [ownerAdmissionComment({ user: { login: 'contributor' },
    author_association: 'CONTRIBUTOR', body: admissionBody({ requiredTests: ['node --test scripts/a.test.mjs'] }) })]);
  assert.equal(result.issues[0].admission.requiredTests, undefined);
});

test('unchanged canonical mirror retains the admitted acceptance plan on bounded revalidation', async () => {
  const requiredTests = ['node --test scripts/a.test.mjs'];
  const result = await fetchGithubGoalIssues({ owner: OWNER, repo: REPO, auth: { configured: true, token: 'test-only' },
    fetchImpl: async url => { assert.equal(url.includes('/comments?'), false); return response([canonicalGoal()]); },
    priorGoalRecords: [priorMirror({ requiredTests })], maxPages: 1, cacheEnabled: false });
  assert.deepEqual(result.issues[0].admission.requiredTests, requiredTests);
});

test('derives bounded canonical resource scopes only from explicit repo-relative files in goal text', () => {
  const result = deriveGoalBodyResourceIds([
    'Reuse shared/agents/platformStatusProofFlow.mjs.',
    'Wire apps/goal-dashboard/index.html.',
    'Ignore C:\\Windows\\System32\\cmd.exe and https://example.com/not-a-repo-file.js.',
    'Ignore ../unsafe.js and ordinary prose.',
  ].join('\n'), REPOSITORY);
  assert.deepEqual(result, [
    'repo:cheekyfellastef/stephan-os:path:apps/goal-dashboard/index.html',
    'repo:cheekyfellastef/stephan-os:path:shared/agents/platformStatusProofFlow.mjs',
  ]);
});

test('owner-authenticated goal label admission carries explicit goal-body file scopes', async () => {
  const result = await observe(canonicalGoal({
    body: [
      'Canonical modules:',
      'shared/agents/platformStatusProofFlow.mjs',
      'apps/goal-dashboard/index.html',
    ].join('\n'),
  }));
  assert.deepEqual(result.issues[0].admission.resourceIds, [
    'repo:cheekyfellastef/stephan-os:path:apps/goal-dashboard/index.html',
    'repo:cheekyfellastef/stephan-os:path:shared/agents/platformStatusProofFlow.mjs',
  ]);
});

test('prior admitted mirror can safely enrich an empty scope from unchanged owner goal text', async () => {
  let requestCount = 0;
  const result = await fetchGithubGoalIssues({
    owner: OWNER,
    repo: REPO,
    auth: { configured: true, token: 'test-only', authority: 'test-only' },
    fetchImpl: async () => {
      requestCount += 1;
      return response([canonicalGoal({
        body: 'Implement docs/architecture/multiplexer-autonomous-goal-build-v1.md',
      })]);
    },
    priorGoalRecords: [priorMirror()],
    maxPages: 1,
    cacheEnabled: false,
  });
  assert.equal(requestCount, 1);
  assert.deepEqual(result.issues[0].admission.resourceIds, [
    'repo:cheekyfellastef/stephan-os:path:docs/architecture/multiplexer-autonomous-goal-build-v1.md',
  ]);
});

test('owner-authenticated goal label event admits an owner-authored canonical goal', async () => { const result = await observe(canonicalGoal()); assert.equal(result.status, 'fetched'); assert.equal(result.ownerAuthoredGoalsAutoAdmitted, false); assert.equal(result.discoveredIssues.length, 1); assert.equal(result.issues.length, 1); const admitted = result.issues[0]; assert.equal(admitted.issueNumber, 2314); assert.equal(admitted.admissionState, 'ADMISSION_PROVEN'); assert.equal(admitted.admissionProofSource, 'OWNER_AUTHENTICATED_GOAL_LABEL_EVENT'); assert.equal(admitted.schedulerEligible, true); assert.equal(admitted.admission.sourceImplementationAllowed, true); assert.equal(admitted.admission.mergeAuthority, false); assert.equal(admitted.admission.deploymentAuthority, false); assert.equal(admitted.admission.runtimeMutationAuthority, false); assert.equal(admitted.admission.arbitraryShellAllowed, false); });
test('owner-authored goal without owner-authenticated label event remains discovery-only', async () => { const result = await observe(canonicalGoal(), [], 200, [{ event: 'labeled', label: { name: 'goal' }, actor: { login: 'collaborator' } }]); assert.equal(result.discoveredIssues.length, 1); assert.equal(result.discoveredIssues[0].schedulerEligible, false); assert.deepEqual(result.issues, []); });

test('unchanged owner-authored goal revalidates prior admitted mirror with one bulk request', async () => {
  let requestCount = 0;
  const result = await fetchGithubGoalIssues({
    owner: OWNER,
    repo: REPO,
    auth: { configured: true, token: 'test-only', authority: 'test-only' },
    fetchImpl: async (url) => {
      requestCount += 1;
      assert.equal(url.includes('/events?') || url.includes('/comments?'), false);
      return response([canonicalGoal()]);
    },
    priorGoalRecords: [priorMirror()],
    maxPages: 1,
    cacheEnabled: false,
  });
  assert.equal(requestCount, 1);
  assert.equal(result.status, 'fetched');
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].admissionProofSource, 'PRIOR_MIRROR_ADMISSION_REVALIDATED');
  assert.equal(result.issues[0].schedulerEligible, true);
});

test('equal issue and mirror timestamps are ambiguous and force fresh admission proof', async () => {
  const observedUrls = [];
  const result = await fetchGithubGoalIssues({
    owner: OWNER,
    repo: REPO,
    auth: { configured: true, token: 'test-only', authority: 'test-only' },
    fetchImpl: async (url) => {
      observedUrls.push(url);
      if (url.includes('/events?')) return response([ownerGoalLabelEvent()]);
      if (url.includes('/comments?')) return response([]);
      return response([canonicalGoal({ updated_at: '2026-09-22T00:00:00Z' })]);
    },
    priorGoalRecords: [priorMirror()],
    maxPages: 1,
    cacheEnabled: false,
  });
  assert.ok(observedUrls.some((url) => url.includes('/events?')));
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].admissionProofSource, 'OWNER_AUTHENTICATED_GOAL_LABEL_EVENT');
});

test('changed goal cannot inherit prior admission without fresh event and comment proof', async () => {
  const observedUrls = [];
  const result = await fetchGithubGoalIssues({
    owner: OWNER,
    repo: REPO,
    auth: { configured: true, token: 'test-only', authority: 'test-only' },
    fetchImpl: async (url) => {
      observedUrls.push(url);
      if (url.includes('/events?')) return response([{ event: 'labeled', label: { name: 'goal' }, actor: { login: 'collaborator' } }]);
      if (url.includes('/comments?')) return response([]);
      return response([canonicalGoal({ updated_at: '2026-09-23T00:00:00Z' })]);
    },
    priorGoalRecords: [priorMirror()],
    maxPages: 1,
    cacheEnabled: false,
  });
  assert.ok(observedUrls.some((url) => url.includes('/events?')));
  assert.ok(observedUrls.some((url) => url.includes('/comments?')));
  assert.deepEqual(result.issues, []);
});

test('tampered prior mirror cannot bypass owner-authenticated admission proof', async () => {
  let eventReads = 0;
  const result = await fetchGithubGoalIssues({
    owner: OWNER,
    repo: REPO,
    auth: { configured: true, token: 'test-only', authority: 'test-only' },
    fetchImpl: async (url) => {
      if (url.includes('/events?')) {
        eventReads += 1;
        return response([{ event: 'labeled', label: { name: 'goal' }, actor: { login: 'collaborator' } }]);
      }
      if (url.includes('/comments?')) return response([]);
      return response([canonicalGoal()]);
    },
    priorGoalRecords: [priorMirror({ mergeAuthority: true })],
    maxPages: 1,
    cacheEnabled: false,
  });
  assert.equal(eventReads, 1);
  assert.deepEqual(result.issues, []);
});

test('owner-labelled goal with one canonical owner scope comment is enriched without losing label admission', async () => {
  const resourceIds = ['repo:Cheekyfellastef/stephan-os:path:docs/architecture/multiplexer-autonomous-goal-build-v1.md'];
  const result = await observe(
    canonicalGoal({ comments: 1 }),
    [ownerAdmissionComment({ body: admissionBody({ resourceIds }) })],
  );
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].admissionProofSource, 'OWNER_AUTHENTICATED_COMMENT');
  assert.deepEqual(result.issues[0].admission.resourceIds, resourceIds.map((value) => value.toLowerCase()));
});

test('owner-labelled goal with multiple comments keeps safe label admission rather than scraping mutable discussion for scope', async () => {
  const resourceIds = ['repo:Cheekyfellastef/stephan-os:path:docs/architecture/multiplexer-autonomous-goal-build-v1.md'];
  const result = await observe(
    canonicalGoal({ comments: 2 }),
    [ownerAdmissionComment({ body: admissionBody({ resourceIds }) }), { user: { login: OWNER }, author_association: 'OWNER', body: 'ordinary follow-up' }],
  );
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].admissionProofSource, 'OWNER_AUTHENTICATED_GOAL_LABEL_EVENT');
  assert.deepEqual(result.issues[0].admission.resourceIds, []);
});
test('goal label on a non-owner issue remains discovery-only', async () => { const result = await observe(nonOwnerGoal()); assert.equal(result.discoveredIssues.length, 1); assert.equal(result.discoveredIssues[0].schedulerEligible, false); assert.deepEqual(result.issues, []); });
test('one owner-authenticated closed-world comment admission makes a non-owner discovered goal scheduler eligible', async () => { const result = await observe(nonOwnerGoal(), [ownerAdmissionComment()]); assert.equal(result.issues.length, 1); const admitted = result.issues[0]; assert.equal(admitted.admissionState, 'ADMISSION_PROVEN'); assert.equal(admitted.admissionProofSource, 'OWNER_AUTHENTICATED_COMMENT'); assert.equal(admitted.schedulerEligible, true); assert.equal(admitted.admission.state, 'READY'); assert.equal(admitted.admission.route, 'OPENCLAW_LOCAL'); assert.equal(admitted.admission.sourceImplementationAllowed, true); assert.equal(admitted.admission.mergeAuthority, false); assert.equal(admitted.admission.deploymentAuthority, false); assert.equal(admitted.admission.runtimeMutationAuthority, false); assert.equal(admitted.admission.arbitraryShellAllowed, false); });

test('owner-authenticated comment admission carries only canonical resource-disjoint repo path scopes', async () => {
  const resourceIds = [
    'repo:Cheekyfellastef/stephan-os:path:docs/architecture/multiplexer-autonomous-goal-build-v1.md',
    'repo:Cheekyfellastef/stephan-os:path:shared/agents/example-scope.mjs',
  ];
  const result = await observe(nonOwnerGoal(), [ownerAdmissionComment({ body: admissionBody({ resourceIds }) })]);
  assert.equal(result.issues.length, 1);
  assert.deepEqual(result.issues[0].admission.resourceIds, resourceIds.map((value) => value.toLowerCase()).sort());
});

test('owner admission cannot redirect a bounded source lane outside the admitted repository', async () => {
  for (const resourceIds of [
    ['repo:other/repository:path:shared/agents/example.mjs'],
    ['goal:2314'],
    [],
    ['../unsafe'],
  ]) {
    const result = await observe(nonOwnerGoal(), [ownerAdmissionComment({ body: admissionBody({ resourceIds }) })]);
    assert.deepEqual(result.issues, []);
  }
});
test('mutable issue body cannot grant non-owner admission', async () => { const result = await observe(nonOwnerGoal({ body: admissionBody(), created_at: '2026-09-21T00:00:00Z', updated_at: '2026-09-21T00:00:00Z', performed_via_github_app: { slug: 'chatgpt' } })); assert.equal(result.discoveredIssues.length, 1); assert.equal(result.discoveredIssues[0].schedulerEligible, false); assert.deepEqual(result.issues, []); });
test('non-owner comment cannot grant admission', async () => { const result = await observe(nonOwnerGoal(), [ownerAdmissionComment({ user: { login: 'collaborator' }, author_association: 'COLLABORATOR' })]); assert.equal(result.discoveredIssues.length, 1); assert.deepEqual(result.issues, []); });
test('owner comment cannot widen protected authority', async () => { const result = await observe(nonOwnerGoal(), [ownerAdmissionComment({ body: admissionBody({ mergeAuthority: true, deploymentAuthority: true, runtimeMutationAuthority: true, arbitraryShellAllowed: true }) })]); assert.equal(result.discoveredIssues.length, 1); assert.deepEqual(result.issues, []); });
test('multiple owner admission receipts fail closed as ambiguous', async () => { const result = await observe(nonOwnerGoal(), [ownerAdmissionComment(), ownerAdmissionComment()]); assert.equal(result.discoveredIssues.length, 1); assert.deepEqual(result.issues, []); });
test('comment read failure leaves non-owner goal discovery-only and does not become authority', async () => { const result = await observe(nonOwnerGoal(), [], 503); assert.equal(result.status, 'fetched'); assert.equal(result.admissionReadFailureCount, 1); assert.equal(result.discoveredIssues.length, 1); assert.deepEqual(result.issues, []); });

test('owner admission is discovered on a later bounded comment page', async () => { const firstPage = Array.from({ length: 100 }, (_, index) => ({ user: { login: `reader-${index}` }, author_association: 'NONE', body: 'ordinary comment' })); const observedCommentPages = []; const result = await fetchGithubGoalIssues({ owner: OWNER, repo: REPO, auth: { configured: true, token: 'test-only', authority: 'test-only' }, fetchImpl: async (url) => { if (!url.includes('/comments?')) return response([nonOwnerGoal()]); const page = Number(new URL(url).searchParams.get('page')); observedCommentPages.push(page); return response(page === 1 ? firstPage : [ownerAdmissionComment()]); }, maxPages: 1, maxCommentPages: 3 }); assert.deepEqual(observedCommentPages, [1, 2]); assert.equal(result.admissionReadFailureCount, 0); assert.equal(result.issues.length, 1); assert.equal(result.issues[0].schedulerEligible, true); });

test('full bounded comment window remains discovery-only because admission read is incomplete', async () => { const firstPage = [ownerAdmissionComment(), ...Array.from({ length: 99 }, (_, index) => ({ user: { login: `reader-a-${index}` }, author_association: 'NONE', body: 'ordinary comment' }))]; const secondPage = Array.from({ length: 100 }, (_, index) => ({ user: { login: `reader-b-${index}` }, author_association: 'NONE', body: 'ordinary comment' })); const observedCommentPages = []; const result = await fetchGithubGoalIssues({ owner: OWNER, repo: REPO, auth: { configured: true, token: 'test-only', authority: 'test-only' }, fetchImpl: async (url) => { if (!url.includes('/comments?')) return response([nonOwnerGoal()]); const page = Number(new URL(url).searchParams.get('page')); observedCommentPages.push(page); return response(page === 1 ? firstPage : secondPage); }, maxPages: 1, maxCommentPages: 2 }); assert.deepEqual(observedCommentPages, [1, 2]); assert.equal(result.admissionReadFailureCount, 1); assert.equal(result.discoveredIssues.length, 1); assert.deepEqual(result.issues, []); });

test('production-style cache bounds repeated goal-estate observations until refresh expiry', async () => { let clockMs = 1_000_000; let requestCount = 0; const options = { owner: OWNER, repo: REPO, auth: { configured: true, token: 'test-only', authority: 'test-only' }, fetchImpl: async (url) => { requestCount += 1; if (url.includes('/events?')) return response([ownerGoalLabelEvent()]); return url.includes('/comments?') ? response([ownerAdmissionComment()]) : response([canonicalGoal()]); }, maxPages: 1, cacheEnabled: true, cacheTtlMs: 60_000, nowMs: () => clockMs }; const first = await fetchGithubGoalIssues(options); assert.equal(requestCount, 2); clockMs += 30_000; const cached = await fetchGithubGoalIssues(options); assert.equal(cached, first); assert.equal(requestCount, 2); clockMs += 31_000; const refreshed = await fetchGithubGoalIssues(options); assert.notEqual(refreshed, first); assert.equal(requestCount, 4); assert.equal(refreshed.issues.length, 1); });

test('failed goal-estate reads back off instead of hammering GitHub every controller cycle', async () => { let clockMs = 2_000_000; let requestCount = 0; const options = { owner: OWNER, repo: 'stephan-os-failure-backoff-test', auth: { configured: true, token: 'test-only', authority: 'test-only' }, fetchImpl: async () => { requestCount += 1; return response({}, 503); }, cacheEnabled: true, failureBackoffMs: 30_000, nowMs: () => clockMs }; const first = await fetchGithubGoalIssues(options); assert.equal(first.status, 'error'); assert.equal(requestCount, 1); clockMs += 2_000; const backedOff = await fetchGithubGoalIssues(options); assert.equal(backedOff, first); assert.equal(requestCount, 1); clockMs += 29_000; await fetchGithubGoalIssues(options); assert.equal(requestCount, 2); });

test('goal-estate request is aborted by a bounded timeout', async () => { const started = Date.now(); const result = await fetchGithubGoalIssues({ owner: OWNER, repo: 'stephan-os-timeout-test', auth: { configured: true, token: 'test-only', authority: 'test-only' }, fetchImpl: async (_url, options) => new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); }, { once: true }); }), cacheEnabled: false, requestTimeoutMs: 1_000 }); assert.equal(result.status, 'error'); assert.match(result.recommendedNextAction, /408/); assert.ok(Date.now() - started < 5_000); });

test('401 primary credential rejection falls back to approved gh-cli token', async () => { const seenTokens = []; const result = await fetchGithubGoalIssues({ owner: OWNER, repo: REPO, auth: { configured: true, token: 'expired-primary', authority: 'env' }, ghTokenProvider: async () => 'approved-gh-cli-token', fetchImpl: async (url, options) => { const token = options.headers.Authorization.replace('Bearer ', ''); seenTokens.push(token); if (token === 'expired-primary') return response({}, 401); if (url.includes('/events?')) return response([ownerGoalLabelEvent()]); return url.includes('/comments?') ? response([ownerAdmissionComment()]) : response([canonicalGoal()]); }, maxPages: 1 }); assert.equal(seenTokens[0], 'expired-primary'); assert.ok(seenTokens.includes('approved-gh-cli-token')); assert.equal(result.status, 'fetched'); assert.equal(result.issues.length, 1); });

test('entire goal-estate observation is bounded by one total deadline across pagination', async () => {
  let listRequests = 0, eventRequests = 0, active = 0;
  const result = await fetchGithubGoalIssues({
    owner: OWNER, repo: 'stephan-os-total-deadline-test',
    auth: { configured: true, token: 'test-only', authority: 'test-only' },
    fetchImpl: async (url, { signal }) => {
      const isList = url.includes('/issues?');
      if (isList) listRequests++; else eventRequests++;
      active++;
      try {
        return await new Promise((resolve, reject) => {
          const finish = () => {
            signal.removeEventListener('abort', abort);
            resolve(response(isList ? Array.from({ length: 100 }, () => canonicalGoal()) : [ownerGoalLabelEvent()]));
          };
          const timer = setTimeout(finish, 700);
          const abort = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          };
          if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
        });
      } finally { active--; }
    },
    cacheEnabled: false, requestTimeoutMs: 1000, maxPages: 10,
  });
  assert.equal(result.status, 'error');
  assert.match(result.recommendedNextAction, /408/);
  assert.deepEqual(result.issues, []);
  assert.equal(listRequests, 1, 'deadline must prevent a second estate page');
  assert.ok(eventRequests <= 4, 'only the bounded in-flight authority reads may start');
  assert.equal(active, 0, 'all started requests must drain before returning');
});

test('unavailable authentication resolution participates in failure backoff', async () => { let clockMs = 3_000_000; const options = { owner: OWNER, repo: 'stephan-os-auth-backoff-test', auth: { configured: false, token: '', authority: 'none' }, cacheEnabled: true, failureBackoffMs: 30_000, nowMs: () => clockMs }; const first = await fetchGithubGoalIssues(options); assert.equal(first.status, 'error'); clockMs += 2_000; const backedOff = await fetchGithubGoalIssues(options); assert.equal(backedOff, first); });

const correctionNow = Date.parse('2026-11-19T10:00:00Z');
function correctionFixture() {
  const issueUrl = 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/2955';
  const intent = { id: 100, issue_url: issueUrl, user: { id: 267490109, login: OWNER, type: 'User' },
    author_association: 'OWNER', performed_via_github_app: null,
    created_at: '2026-11-19T09:00:00Z', updated_at: '2026-11-19T09:00:00Z',
    body: 'Existing exact authenticated original outcome; this fixture supplies no live authority.' };
  const binding = { childIssueNumber: 2955, missionId: 'critical-2955-elastic-goal',
    seedId: 'starfield-vr-outcome-ownership', pressureKey: 'seed-2655:rung:observing', targetRung: 'OBSERVING',
    originalIntentCommentId: intent.id, originalIntentIssueNumber: 2955,
    originalIntentBodySha256: createHash('sha256').update(intent.body).digest('hex'), contractPreimageSha256: 'a'.repeat(64) };
  const plan = { schemaVersion: 'stephanos.seed-source-contract-correction.v1', decision: 'CORRECT', repository: REPOSITORY,
    binding, expiresAtUtc: '2026-11-19T10:04:00Z', runtimePolicyHead: 'b'.repeat(40), runtimePolicyTree: 'c'.repeat(40),
    sourceContract: { allowedFiles: ['shared/runtime/usefulFeatureV1.mjs'],
      requiredTests: ['node --test scripts/seed-useful.test.mjs'], requiredEvidence: ['Real original failure and useful replay'],
      usefulOutcome: 'Actual useful behavior', domainAcceptanceContract: 'existing-starfield-domain-contract', executionRelationship: 'SELF' } };
  const body = value => '```stephanos-seed-source-contract-correction-v1\n' + JSON.stringify(value) + '\n```';
  const selected = { ...intent, id: 101, created_at: '2026-11-19T09:59:00Z',
    updated_at: '2026-11-19T09:59:00Z', body: body(plan) };
  return { issueUrl, intent, binding, plan, body, selected };
}
async function readCorrection(fixture, { comments = [fixture.selected], pages, fixedComment,
  fixedIntent = fixture.intent, fetchOverride } = {}) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (fetchOverride) return fetchOverride(url, options);
    const payload = url.includes('/comments?')
      ? (pages ? pages(Number(new URL(url).searchParams.get('page'))) : comments)
      : url.endsWith('/101') ? fixedComment || fixture.selected : fixedIntent;
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  const observation = await readSeedSourceContractCorrectionEvidenceV1(fixture.binding,
    { env: { GITHUB_TOKEN: 'test-only' }, fetchImpl, nowMs: () => correctionNow });
  return { observation, requests };
}

test('correction reader uses actual complete cohort and exact immutable reads but grants no correction authority', async () => {
  const fixture = correctionFixture();
  const { observation, requests } = await readCorrection(fixture);
  assert.equal(observation.status, 'observed');
  assert.equal(observation.reasonCode, 'SEED_CORRECTION_PRIVATE_PRODUCER_REQUIRED');
  assert.equal(observation.completeCohort, true);
  assert.deepEqual(observation.decision, fixture.plan);
  assert.equal(observation.decisionCommentId, 101);
  assert.equal(observation.mutationAuthority, false);
  assert.equal(observation.correctionAllowed, false);
  assert.equal(observation.dispatchAllowed, false);
  assert.deepEqual(requests.map(row => row.url), [fixture.issueUrl + '/comments?per_page=100&page=1',
    'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/comments/101',
    'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/comments/100']);
  assert.ok(requests.every(row => row.options.redirect === 'error' && row.options.signal));
});

test('correction reader must observe the terminal cohort page before selecting an immutable plan', async () => {
  const fixture = correctionFixture();
  const ordinary = Array.from({ length: 99 }, (_, index) => ({ ...fixture.intent, id: 1000 + index,
    user: { id: index + 1, login: 'reader', type: 'User' }, body: 'Ordinary non-authority comment' }));
  const { observation, requests } = await readCorrection(fixture, { pages: page => page === 1 ? [fixture.selected, ...ordinary] : [] });
  assert.equal(observation.status, 'observed');
  assert.equal(requests.filter(row => row.url.includes('/comments?')).length, 2);
  const incomplete = await readCorrection(fixture, { pages: page => Array.from({ length: 100 }, (_, index) => ({
    ...ordinary[0], id: page * 1000 + index })) });
  assert.equal(incomplete.observation.reasonCode, 'SEED_CORRECTION_COHORT_INCOMPLETE');
  assert.equal(incomplete.requests.length, 10);
});

test('applicable revocation, malformed owner decisions and competing plans cannot fall back to an older correction', async () => {
  const fixture = correctionFixture();
  const revoke = { schemaVersion: fixture.plan.schemaVersion, decision: 'REVOKE', repository: REPOSITORY,
    binding: fixture.binding, expiresAtUtc: fixture.plan.expiresAtUtc, correctionCommentId: fixture.selected.id };
  for (const [other, reason] of [
    [{ ...fixture.selected, id: 102, body: fixture.body(revoke) }, 'SEED_CORRECTION_REVOKED'],
    [{ ...fixture.selected, id: 102 }, 'SEED_CORRECTION_DECISION_AMBIGUOUS'],
    [{ ...fixture.selected, id: 102, body: '```stephanos-seed-source-contract-correction-v1\n{"decision":"REVOKE"}\n```' }, 'SEED_CORRECTION_OWNER_DECISION_INVALID'],
    [{ ...fixture.selected, id: 102, updated_at: '2026-11-19T09:01:00Z' }, 'SEED_CORRECTION_OWNER_DECISION_INVALID'],
    [{ ...fixture.selected, id: 102, body: fixture.body({ ...fixture.plan, binding: { ...fixture.binding, contractPreimageSha256: 'd'.repeat(64) } }) }, 'SEED_CORRECTION_OWNER_DECISION_INVALID'],
    [{ ...fixture.selected, id: 102, body: fixture.body({ ...fixture.plan, authenticated: true }) }, 'SEED_CORRECTION_OWNER_DECISION_INVALID'],
    [{ ...fixture.selected, id: 102, body: fixture.body({ ...fixture.plan, expiresAtUtc: '2026-11-19T09:30:00Z' }) }, 'SEED_CORRECTION_OWNER_DECISION_INVALID'],
  ]) {
    const { observation, requests } = await readCorrection(fixture, { comments: [fixture.selected, other] });
    assert.equal(observation.reasonCode, reason);
    assert.equal(requests.length, 1, 'invalid current cohort must not select an older plan');
    assert.equal(observation.correctionAllowed, false);
  }
});

test('immutable correction and original intent reads reject identity or content movement after cohort observation', async () => {
  const fixture = correctionFixture();
  for (const fixedComment of [ { ...fixture.selected, body: fixture.selected.body + '\nchanged' },
    { ...fixture.selected, updated_at: '2026-11-19T09:01:00Z' },
    { ...fixture.selected, user: { ...fixture.selected.user, id: 2 } },
    { ...fixture.selected, performed_via_github_app: { slug: 'connector' } } ]) {
    const { observation } = await readCorrection(fixture, { fixedComment });
    assert.equal(observation.status, 'held');
    assert.equal(observation.correctionAllowed, false);
  }
  const changedIntent = await readCorrection(fixture, { fixedIntent: { ...fixture.intent, body: 'Other outcome' } });
  assert.equal(changedIntent.observation.reasonCode, 'SEED_CORRECTION_ORIGINAL_INTENT_CHANGED');
});

test('correction reader holds on incomplete, oversized or failed current cohort and never fetches a selected comment', async () => {
  const fixture = correctionFixture();
  for (const [payload, status, reason] of [
    [[], 503, 'SEED_CORRECTION_COHORT_READ_FAILED'],
    [{ incomplete: true }, 200, 'SEED_CORRECTION_COHORT_INVALID'],
    [[{ ...fixture.intent, body: 'x'.repeat(1024 * 1024) }], 200, 'SEED_CORRECTION_COHORT_UNBOUNDED'],
    [[fixture.selected, fixture.selected], 200, 'SEED_CORRECTION_COHORT_INVALID'],
  ]) {
    const result = await readCorrection(fixture, { fetchOverride: async () => new Response(JSON.stringify(payload), { status }) });
    assert.equal(result.observation.reasonCode, reason);
    assert.equal(result.requests.length, 1);
  }
});

test('Node correction binding refuses proxies and accessors without invoking them or a network reader', async () => {
  const fixture = correctionFixture();
  let effects = 0;
  const options = { env: { GITHUB_TOKEN: 'test-only' }, fetchImpl: async () => { effects++; throw Error('unexpected'); } };
  const proxy = new Proxy(fixture.binding, { ownKeys() { effects++; throw Error('trap'); }, get() { effects++; throw Error('trap'); } });
  const accessor = { ...fixture.binding };
  Object.defineProperty(accessor, 'missionId', { enumerable: true, get() { effects++; throw Error('getter'); } });
  for (const binding of [proxy, accessor, { ...fixture.binding, authenticated: true }]) {
    const result = await readSeedSourceContractCorrectionEvidenceV1(binding, options);
    assert.equal(result.reasonCode, 'SEED_CORRECTION_BINDING_INVALID');
  }
  assert.equal(effects, 0);
});

test('correction observation respects the existing shared GitHub quota hold before another read', async () => {
  const fixture = correctionFixture();
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'seed-correction-rate-hold-'));
  let requests = 0;
  const options = { env: { GITHUB_TOKEN: 'test-only' }, workspaceRoot, nowMs: () => correctionNow,
    fetchImpl: async () => { requests++; return new Response('{}', { status: 429 }); } };
  const first = await readSeedSourceContractCorrectionEvidenceV1(fixture.binding, options);
  assert.equal(first.reasonCode, 'SEED_CORRECTION_RATE_LIMIT_BACKOFF');
  const held = await readSeedSourceContractCorrectionEvidenceV1(fixture.binding, options);
  assert.equal(held.reasonCode, 'SEED_CORRECTION_RATE_LIMIT_BACKOFF');
  assert.equal(requests, 1);
  assert.equal(held.correctionAllowed, false);
});
