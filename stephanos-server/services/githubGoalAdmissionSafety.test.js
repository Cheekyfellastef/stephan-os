import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchGithubGoalIssues } from './githubPrEvidenceService.js';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const OWNER = 'Cheekyfellastef';
const REPO = 'stephan-os';

function response(payload, status = 200) { return { ok: status >= 200 && status < 300, status, headers: { get: () => '' }, json: async () => payload }; }
function canonicalGoal(overrides = {}) { return { number: 2314, title: 'Canary Goal: Prove multiplexer-backed autonomous goal build V1', state: 'open', user: { login: OWNER }, author_association: 'OWNER', performed_via_github_app: { slug: 'chatgpt' }, labels: [{ name: 'goal' }, { name: 'priority:high' }], body: 'Ordinary durable goal text with no special admission envelope.', html_url: 'https://github.com/Cheekyfellastef/stephan-os/issues/2314', created_at: '2026-09-21T00:00:00Z', updated_at: '2026-09-21T00:00:00Z', ...overrides }; }
function nonOwnerGoal(overrides = {}) { return canonicalGoal({ user: { login: 'contributor' }, author_association: 'CONTRIBUTOR', performed_via_github_app: null, ...overrides }); }
function admissionBody(overrides = {}) { const admission = { schemaVersion: 'stephanos.github-goal-admission.v1', issueNumber: 2314, repository: REPOSITORY, state: 'READY', route: 'OPENCLAW_LOCAL', prerequisites: [], sourceImplementationAllowed: true, mergeAuthority: false, deploymentAuthority: false, runtimeMutationAuthority: false, arbitraryShellAllowed: false, ...overrides }; return `Durable admission.\n\n\`\`\`stephanos-goal-admission-v1\n${JSON.stringify(admission)}\n\`\`\``; }
function ownerAdmissionComment(overrides = {}) { return { user: { login: OWNER }, author_association: 'OWNER', body: admissionBody(), ...overrides }; }
async function observe(issue, comments = [], commentStatus = 200) { return fetchGithubGoalIssues({ owner: OWNER, repo: REPO, auth: { configured: true, token: 'test-only', authority: 'test-only' }, fetchImpl: async (url) => url.includes('/comments?') ? response(comments, commentStatus) : response([issue]), maxPages: 1 }); }

test('owner-authored canonical goal is scheduler eligible without a ceremonial admission comment', async () => { const result = await observe(canonicalGoal()); assert.equal(result.status, 'fetched'); assert.equal(result.ownerAuthoredGoalsAutoAdmitted, true); assert.equal(result.discoveredIssues.length, 1); assert.equal(result.issues.length, 1); const admitted = result.issues[0]; assert.equal(admitted.issueNumber, 2314); assert.equal(admitted.admissionState, 'ADMISSION_PROVEN'); assert.equal(admitted.admissionProofSource, 'OWNER_AUTHORED_GOAL_ISSUE'); assert.equal(admitted.schedulerEligible, true); assert.equal(admitted.admission.sourceImplementationAllowed, true); assert.equal(admitted.admission.mergeAuthority, false); assert.equal(admitted.admission.deploymentAuthority, false); assert.equal(admitted.admission.runtimeMutationAuthority, false); assert.equal(admitted.admission.arbitraryShellAllowed, false); });
test('goal label on a non-owner issue remains discovery-only', async () => { const result = await observe(nonOwnerGoal()); assert.equal(result.discoveredIssues.length, 1); assert.equal(result.discoveredIssues[0].schedulerEligible, false); assert.deepEqual(result.issues, []); });
test('one owner-authenticated closed-world comment admission makes a non-owner discovered goal scheduler eligible', async () => { const result = await observe(nonOwnerGoal(), [ownerAdmissionComment()]); assert.equal(result.issues.length, 1); const admitted = result.issues[0]; assert.equal(admitted.admissionState, 'ADMISSION_PROVEN'); assert.equal(admitted.admissionProofSource, 'OWNER_AUTHENTICATED_COMMENT'); assert.equal(admitted.schedulerEligible, true); assert.equal(admitted.admission.state, 'READY'); assert.equal(admitted.admission.route, 'OPENCLAW_LOCAL'); assert.equal(admitted.admission.sourceImplementationAllowed, true); assert.equal(admitted.admission.mergeAuthority, false); assert.equal(admitted.admission.deploymentAuthority, false); assert.equal(admitted.admission.runtimeMutationAuthority, false); assert.equal(admitted.admission.arbitraryShellAllowed, false); });
test('mutable issue body cannot grant non-owner admission', async () => { const result = await observe(nonOwnerGoal({ body: admissionBody(), created_at: '2026-09-21T00:00:00Z', updated_at: '2026-09-21T00:00:00Z', performed_via_github_app: { slug: 'chatgpt' } })); assert.equal(result.discoveredIssues.length, 1); assert.equal(result.discoveredIssues[0].schedulerEligible, false); assert.deepEqual(result.issues, []); });
test('non-owner comment cannot grant admission', async () => { const result = await observe(nonOwnerGoal(), [ownerAdmissionComment({ user: { login: 'collaborator' }, author_association: 'COLLABORATOR' })]); assert.equal(result.discoveredIssues.length, 1); assert.deepEqual(result.issues, []); });
test('owner comment cannot widen protected authority', async () => { const result = await observe(nonOwnerGoal(), [ownerAdmissionComment({ body: admissionBody({ mergeAuthority: true, deploymentAuthority: true, runtimeMutationAuthority: true, arbitraryShellAllowed: true }) })]); assert.equal(result.discoveredIssues.length, 1); assert.deepEqual(result.issues, []); });
test('multiple owner admission receipts fail closed as ambiguous', async () => { const result = await observe(nonOwnerGoal(), [ownerAdmissionComment(), ownerAdmissionComment()]); assert.equal(result.discoveredIssues.length, 1); assert.deepEqual(result.issues, []); });
test('comment read failure leaves non-owner goal discovery-only and does not become authority', async () => { const result = await observe(nonOwnerGoal(), [], 503); assert.equal(result.status, 'fetched'); assert.equal(result.admissionReadFailureCount, 1); assert.equal(result.discoveredIssues.length, 1); assert.deepEqual(result.issues, []); });

test('owner admission is discovered on a later bounded comment page', async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ user: { login: `reader-${index}` }, author_association: 'NONE', body: 'ordinary comment' })); const observedCommentPages = [];
  const result = await fetchGithubGoalIssues({ owner: OWNER, repo: REPO, auth: { configured: true, token: 'test-only', authority: 'test-only' }, fetchImpl: async (url) => { if (!url.includes('/comments?')) return response([nonOwnerGoal()]); const page = Number(new URL(url).searchParams.get('page')); observedCommentPages.push(page); return response(page === 1 ? firstPage : [ownerAdmissionComment()]); }, maxPages: 1, maxCommentPages: 3 });
  assert.deepEqual(observedCommentPages, [1, 2]); assert.equal(result.admissionReadFailureCount, 0); assert.equal(result.issues.length, 1); assert.equal(result.issues[0].schedulerEligible, true);
});

test('full bounded comment window remains discovery-only because admission read is incomplete', async () => {
  const firstPage = [ownerAdmissionComment(), ...Array.from({ length: 99 }, (_, index) => ({ user: { login: `reader-a-${index}` }, author_association: 'NONE', body: 'ordinary comment' }))]; const secondPage = Array.from({ length: 100 }, (_, index) => ({ user: { login: `reader-b-${index}` }, author_association: 'NONE', body: 'ordinary comment' })); const observedCommentPages = [];
  const result = await fetchGithubGoalIssues({ owner: OWNER, repo: REPO, auth: { configured: true, token: 'test-only', authority: 'test-only' }, fetchImpl: async (url) => { if (!url.includes('/comments?')) return response([nonOwnerGoal()]); const page = Number(new URL(url).searchParams.get('page')); observedCommentPages.push(page); return response(page === 1 ? firstPage : secondPage); }, maxPages: 1, maxCommentPages: 2 });
  assert.deepEqual(observedCommentPages, [1, 2]); assert.equal(result.admissionReadFailureCount, 1); assert.equal(result.discoveredIssues.length, 1); assert.deepEqual(result.issues, []);
});

test('production-style cache bounds repeated goal-estate observations until refresh expiry', async () => {
  let clockMs = 1_000_000; let requestCount = 0; const options = { owner: OWNER, repo: REPO, auth: { configured: true, token: 'test-only', authority: 'test-only' }, fetchImpl: async (url) => { requestCount += 1; return url.includes('/comments?') ? response([ownerAdmissionComment()]) : response([canonicalGoal()]); }, maxPages: 1, cacheEnabled: true, cacheTtlMs: 60_000, nowMs: () => clockMs };
  const first = await fetchGithubGoalIssues(options); assert.equal(requestCount, 1); clockMs += 30_000; const cached = await fetchGithubGoalIssues(options); assert.equal(cached, first); assert.equal(requestCount, 1); clockMs += 31_000; const refreshed = await fetchGithubGoalIssues(options); assert.notEqual(refreshed, first); assert.equal(requestCount, 2); assert.equal(refreshed.issues.length, 1);
});

test('failed goal-estate reads back off instead of hammering GitHub every controller cycle', async () => {
  let clockMs = 2_000_000; let requestCount = 0;
  const options = { owner: OWNER, repo: 'stephan-os-failure-backoff-test', auth: { configured: true, token: 'test-only', authority: 'test-only' }, fetchImpl: async () => { requestCount += 1; return response({}, 503); }, cacheEnabled: true, failureBackoffMs: 30_000, nowMs: () => clockMs };
  const first = await fetchGithubGoalIssues(options); assert.equal(first.status, 'error'); assert.equal(requestCount, 1);
  clockMs += 2_000; const backedOff = await fetchGithubGoalIssues(options); assert.equal(backedOff, first); assert.equal(requestCount, 1);
  clockMs += 29_000; await fetchGithubGoalIssues(options); assert.equal(requestCount, 2);
});

test('goal-estate request is aborted by a bounded timeout', async () => {
  const started = Date.now();
  const result = await fetchGithubGoalIssues({ owner: OWNER, repo: 'stephan-os-timeout-test', auth: { configured: true, token: 'test-only', authority: 'test-only' }, fetchImpl: async (_url, options) => new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); }, { once: true }); }), cacheEnabled: false, requestTimeoutMs: 1_000 });
  assert.equal(result.status, 'error'); assert.match(result.recommendedNextAction, /408/); assert.ok(Date.now() - started < 5_000);
});

test('401 primary credential rejection falls back to approved gh-cli token', async () => {
  const seenTokens = [];
  const result = await fetchGithubGoalIssues({ owner: OWNER, repo: REPO, auth: { configured: true, token: 'expired-primary', authority: 'env' }, ghTokenProvider: async () => 'approved-gh-cli-token', fetchImpl: async (url, options) => { const token = options.headers.Authorization.replace('Bearer ', ''); seenTokens.push(token); if (token === 'expired-primary') return response({}, 401); return url.includes('/comments?') ? response([ownerAdmissionComment()]) : response([canonicalGoal()]); }, maxPages: 1 });
  assert.equal(seenTokens[0], 'expired-primary'); assert.ok(seenTokens.includes('approved-gh-cli-token')); assert.equal(result.status, 'fetched'); assert.equal(result.issues.length, 1);
});

test('entire goal-estate observation is bounded by one total deadline across pagination', async () => {
  let requestCount = 0;
  const result = await fetchGithubGoalIssues({ owner: OWNER, repo: 'stephan-os-total-deadline-test', auth: { configured: true, token: 'test-only', authority: 'test-only' }, fetchImpl: async (_url, options) => { requestCount += 1; return new Promise((resolve, reject) => { const timer = setTimeout(() => resolve(response(Array.from({ length: 100 }, () => canonicalGoal()))), 700); options.signal.addEventListener('abort', () => { clearTimeout(timer); const error = new Error('aborted'); error.name = 'AbortError'; reject(error); }, { once: true }); }); }, cacheEnabled: false, requestTimeoutMs: 1_000, maxPages: 10 });
  assert.equal(result.status, 'error'); assert.match(result.recommendedNextAction, /408/); assert.ok(requestCount <= 2, `expected total deadline to stop pagination, saw ${requestCount} requests`);
});

test('unavailable authentication resolution participates in failure backoff', async () => {
  let clockMs = 3_000_000;
  const options = { owner: OWNER, repo: 'stephan-os-auth-backoff-test', auth: { configured: false, token: '', authority: 'none' }, cacheEnabled: true, failureBackoffMs: 30_000, nowMs: () => clockMs };
  const first = await fetchGithubGoalIssues(options); assert.equal(first.status, 'error');
  clockMs += 2_000; const backedOff = await fetchGithubGoalIssues(options); assert.equal(backedOff, first);
});
