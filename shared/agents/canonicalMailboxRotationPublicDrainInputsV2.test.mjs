import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createMailboxRotationOwnerControlGitHubTestReaderV2 as createReader,
  isAuthenticatedMailboxRotationOwnerControlGitHubV2 as productionRecognizes,
  readMailboxRotationPublicDrainInputsV2 as productionRead } from './canonicalMailboxRotationOwnerControlGitHubV2.mjs';
import { formatMailboxRotationOwnerControlV2 as format,
  MAILBOX_ROTATION_OWNER_OBSERVATION_SCHEMA_V2 as observationSchema } from './canonicalMailboxRotationOwnerControlV2.mjs';
import { MAILBOX_ROTATION_OWNER_CONTROL_SCHEMA_V2 as consentSchema } from './canonicalMailboxNativeEvidenceCodecV2.mjs';
import { auditMailboxRotationComments, mailboxRotationDigest } from './canonicalMailboxRotationV1.mjs';
import { LEGACY_PUBLICATION_CONTRACTS as contracts, mailboxActionEvidenceSummary,
  mailboxActionsExecutionQuiescent } from './canonicalMailboxRotationActionEvidenceV1.mjs';
import { localMailboxPublicationRevocations } from '../../scripts/canonical-mailbox-action-evidence-v2.mjs';
import { withMailboxRotationTransactionTestJournalV2 as withJournal } from '../../scripts/canonical-mailbox-rotation-transaction-v2.mjs';
import { createMailboxExecutionLedger } from '../../scripts/canonical-mailbox-execution-ledger-v1.mjs';
import { MAILBOX_OUTBOX_LEDGER_SCHEMA, resolveMailboxOutboxGuardLockPath } from '../../scripts/battle-bridge-github-command-mailbox-outbox-guard-v1.mjs';

const REPO = 'Cheekyfellastef/stephan-os', API = 'https://api.github.com/repos/' + REPO;
const OWNER = { id: 267490109, login: 'Cheekyfellastef', type: 'User' };
const repository = { id: 1179385578, full_name: REPO, owner: OWNER };
const git = x => x.repeat(40), sha = x => x.repeat(64), clone = x => JSON.parse(JSON.stringify(x));
const hash = x => createHash('sha256').update(x).digest('hex');
const secret = 'FIXTURE_ONLY_CREDENTIAL_NEVER_RETURNED', privateBody = 'PUBLIC_COMMENT_BODY_NOT_A_RESULT_FIELD';
const flags = ['nativeExecutionAuthorized', 'freezeCertified', 'protectedMergeAuthorized', 'sourceSyncAuthorized',
  'epochAdoptionAuthorized', 'nativeProducerQualified', 'originalGuardHeld', 'nativeObservationAuthenticated', 'ordinaryReceiptDebtDrained'];
function denied(value) {
  for (const key of flags) assert.equal(value[key], false, key);
  assert.equal(productionRecognizes(value), false);
  assert.equal(JSON.stringify(value).includes(secret), false);
  assert.equal(JSON.stringify(value).includes(privateBody), false);
}
function response(url, data, { status = 200, raw, headers = {}, redirected = false } = {}) {
  const result = new Response(raw ?? JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
  Object.defineProperty(result, 'url', { value: url }); Object.defineProperty(result, 'redirected', { value: redirected });
  return result;
}
function write(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value) + '\n'); }
function envelope(id, state, { issueNumber = 3149, schemaVersion, marker = true } = {}) {
  const value = { schemaVersion: schemaVersion ?? ('stephanos.battle-bridge-github-command' + (state ? '-receipt' : '') + '.v1'),
    repository: REPO, issueNumber, branch: 'main', requestId: id, operation: 'READ_DEPLOYMENT_STATUS', expectedHead: git('a'), ...(state ? { state } : {}) };
  return (state && marker ? '<!-- stephanos-battle-bridge-command-receipt -->\n' : '')
    + '```' + (state ? 'json' : 'stephanos-battle-bridge-command') + '\n' + JSON.stringify(value) + '\n```';
}
function comments(count, { pending = false, ambiguous = false, metadataBytes = 0 } = {}) {
  const bodies = [envelope('ordinary-paired', ''), envelope('ordinary-paired', 'ACCEPTED'),
    pending ? privateBody : envelope('ordinary-paired', 'DONE'), envelope('private-pair', 'ACCEPTED'),
    pending ? privateBody : envelope('private-pair', 'DONE'), envelope('private-terminal-only', 'BLOCKED'),
    ...Array.from({ length: 3 }, (_, i) => envelope('retired-' + i, 'DONE', { issueNumber: 2808 })),
    envelope('foreign-schema', '', { schemaVersion: 'stephanos.battle-bridge-command.v1' }),
    envelope('missing-schema', '').replace(/"schemaVersion":"[^"]+",/, '')];
  if (ambiguous) bodies.push('```stephanos-battle-bridge-command\n{"schemaVersion":');
  const at = new Date(Date.now() - 5000).toISOString();
  return Array.from({ length: count }, (_, i) => ({ id: 1000 + i, url: API + '/issues/comments/' + (1000 + i),
    issue_url: API + '/issues/3149', html_url: 'https://github.com/' + REPO + '/issues/3149#issuecomment-' + (1000 + i),
    user: clone(OWNER), author_association: 'OWNER', created_at: at, updated_at: at,
    body: bodies[i] ?? privateBody, metadataPadding: 'x'.repeat(metadataBytes) }));
}
function fixture(t, config = {}) {
  const history = comments(config.commentCount ?? 12, config), audit = auditMailboxRotationComments(history, { issueNumber: 3149 });
  const consent = { schemaVersion: consentSchema, repository: REPO, operatorApproval: 'operator-approved', transitionId: 'fixture-public-drain',
    rotationAction: 'FREEZE', state: 'PRE_MERGE', source: { protectedMainHead: git('a'), protectedMainTreeSha: git('b'),
      installedHead: git('a'), installedTreeSha: git('b'), installedClosureSha256: sha('c'), sourceRole: 'PREPARATION' },
    activation: { prNumber: 3268, headSha: git('d'), baseSha: git('a'), treeSha: git('e'), mergeCommitSha: null, mergeTreeSha: null },
    epoch: { predecessorIssue: 3149, successorIssue: 3258 },
    barrier: { highestCommandCommentId: audit.highestCommandCommentId, inventorySha256: audit.inventoryDigest, commentCount: history.length },
    preparation: { headSha: git('a'), treeSha: git('b'), closureSha256: sha('c'), originalFrozenArtifactSha256: null },
    expiresAtUtc: new Date(Date.now() + 300000).toISOString(), probeRequestIds: [] };
  const created = new Date(Date.now() - 1000).toISOString();
  const comment = { id: 123456, url: API + '/issues/comments/123456', issue_url: API + '/issues/3268',
    html_url: 'https://github.com/' + REPO + '/pull/3268#issuecomment-123456', user: clone(OWNER), author_association: 'OWNER',
    created_at: created, updated_at: created, body: format(consent) };
  const observation = { schemaVersion: observationSchema, repository: REPO, transitionId: consent.transitionId, state: consent.state,
    source: clone(consent.source), activation: { ...consent.activation, state: 'OPEN' }, epoch: { ...consent.epoch, activeIssue: 3149, retiredPredecessor: false },
    barrier: clone(consent.barrier), preparation: clone(consent.preparation), observedAtUtc: new Date().toISOString() };
  const workspace = mkdtempSync(join(tmpdir(), 'mailbox-public-drain-')), root = join(workspace, 'github-command-mailbox');
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const state = join(root, 'state.json'), deferred = join(root, 'receipt-publication-deferred-v1.json');
  write(state, { acceptedRequestIds: [], pendingReceiptPublications: [], retained: 'original owner data' });
  write(deferred, { schemaVersion: MAILBOX_OUTBOX_LEDGER_SCHEMA, timestampUtc: new Date().toISOString(),
    storeId: '1234567890abcdef1234567890abcdef', headSequence: 0, nextSequence: 0, legacy: null });
  mkdirSync(deferred + '.ledger-v3/index', { recursive: true }); mkdirSync(deferred + '.ledger-v3/segments');
  const origin = { kind: 'ACTIVATION_PR_OWNER_CONTROL_V2', prNumber: 3268, commentId: comment.id,
    commentBodySha256: hash(comment.body), createdAtUtc: created };
  withJournal(workspace, api => { const p = api.prepare({ origin, consent }); api.reserve(p.journal.generationSha256); });
  if (config.localDebt) {
    createMailboxExecutionLedger(root).reserve({ requestId: 'ordinary-debt', issueNumber: 3149 });
    const stored = JSON.parse(readFileSync(state, 'utf8')); stored.acceptedRequestIds = ['ordinary-debt'];
    stored.pendingReceiptPublications = [{ publicationId: 'ordinary-debt:DONE', receipt: { requestId: 'ordinary-debt', state: 'DONE',
      issueNumber: 3149, schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1', operation: 'READ_DEPLOYMENT_STATUS' } }];
    write(state, stored);
  }
  const local = withJournal(workspace, api => api.captureDrainInputs(api.inspect().journal.generationSha256)).drainInputCandidate;
  const sourcePath = 'shared/agents/canonicalMailboxAuthorityV1.mjs';
  const source = Buffer.from('export const CANONICAL_MAILBOX_ISSUE = 3149;\nexport const RETIRED_CANONICAL_MAILBOX_ISSUES = Object.freeze([1507, 2158, 2590, 2808]);\n');
  const routes = {
    '/issues/comments/123456': comment,
    '/git/ref/heads/main': { ref: 'refs/heads/main', object: { type: 'commit', sha: git('a') } },
    '/commits/main': { sha: git('a') },
    '/pulls/3268': { number: 3268, html_url: 'https://github.com/' + REPO + '/pull/3268', state: 'open', merged: false, draft: false,
      head: { sha: git('d'), repo: clone(repository) }, base: { sha: git('a'), ref: 'main', repo: clone(repository) } },
    '/issues/3149': { number: 3149, url: API + '/issues/3149', state: 'open', comments: history.length },
    '/issues/3258': { number: 3258, url: API + '/issues/3258', state: 'open', comments: 0, user: clone(OWNER),
      body: 'Status: INACTIVE\n<!-- stephanos:canonical-mailbox-successor:v1 predecessor=3149 successor=3258 state=INACTIVE -->\n' },
    ['/git/commits/' + git('a')]: { sha: git('a'), tree: { sha: git('b') } },
    ['/git/commits/' + git('d')]: { sha: git('d'), tree: { sha: git('e') } },
    ['/contents/' + sourcePath + '?ref=' + git('a')]: { path: sourcePath, type: 'file', encoding: 'base64', size: source.length,
      sha: createHash('sha1').update('blob ' + source.length + '\0').update(source).digest('hex'), content: source.toString('base64'),
      url: API + '/contents/' + sourcePath + '?ref=' + git('a') },
  };
  const localModules = localMailboxPublicationRevocations();
  for (const m of localModules) for (const head of [git('a'), git('d')]) routes['/contents/' + m.path + '?ref=' + head] =
    { path: m.path, type: 'file', size: 10000, sha: m.localBlob };
  const runs = [];
  if (config.actions) {
    for (let i = 0; i < (config.actionCount ?? 5); i++) {
      const c = contracts[i % contracts.length], status = i === 4 ? 'in_progress' : 'queued';
      const run = { id: 9000 + i, path: c.path, head_sha: c.head, status, run_attempt: 1, workflow_id: 315398307,
        event: 'issue_comment', head_branch: 'main', repository: clone(repository), head_repository: clone(repository), metadataPadding: 'x'.repeat(config.runBytes ?? 14000) };
      runs.push(run); routes['/actions/runs/' + run.id] = run;
      routes['/contents/' + c.path + '?ref=' + c.head] = { path: c.path, sha: c.blob, type: 'file', size: 5500 };
      routes['/actions/runs/' + run.id + '/attempts/1/jobs?per_page=100'] = { total_count: status === 'queued' ? 0 : 2,
        jobs: status === 'queued' ? [] : ['proof', 'mirror'].map((name, j) => ({ id: 8000 + j, run_id: run.id, head_sha: run.head_sha,
          name, status: 'completed', conclusion: 'success', completed_at: created, steps: [{ name: 'Complete job', status: 'completed' }] })) };
    }
    for (let i = runs.length; i < (config.totalQueued ?? 22); i++) runs.push({ id: 10000 + i, path: '.github/workflows/unrelated-proof.yml',
      status: 'queued', event: 'pull_request', metadataPadding: 'x'.repeat(config.runBytes ?? 14000) });
  }
  const calls = [], counts = new Map(), sizes = [];
  const env = { ...process.env, STEPHANOS_SHARED_WORKSPACE_ROOT: workspace };
  const fetch = async (url, options) => {
    assert.equal(existsSync(resolveMailboxOutboxGuardLockPath({ env })), false, 'public async IO must run outside the original synchronous guard');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Authorization, 'Bearer ' + secret);
    const path = url.slice(API.length), n = (counts.get(path) || 0) + 1; counts.set(path, n); calls.push({ path, n });
    let value, match = path.match(/^\/issues\/3149\/comments\?per_page=25&page=([0-9]+)$/);
    if (match) value = history.slice((Number(match[1]) - 1) * 25, Number(match[1]) * 25);
    else if ((match = path.match(/^\/actions\/runs\?status=([^&]+)&per_page=10&page=([0-9]+)$/))) {
      const selected = runs.filter(run => run.status === match[1]);
      value = { total_count: selected.length, workflow_runs: selected.slice((Number(match[2]) - 1) * 10, Number(match[2]) * 10) };
    } else { assert(Object.hasOwn(routes, path), path); value = routes[path]; }
    value = clone(value); sizes.push({ path, bytes: Buffer.byteLength(JSON.stringify(value)) });
    const change = await config.mutate?.({ path, n, value, url, options, calls, routes, history, local, observation });
    return change || response(url, value);
  };
  const reader = createReader(fetch), input = { token: secret, observation, drainInputCandidate: local, expectedGenerationSha256: local.journalGenerationSha256 };
  return { reader, input, consent, local, history, routes, runs, calls, counts, sizes, state, deferred,
    read: async () => { const first = await reader.read({ commentId: comment.id, token: secret, observation });
      assert.equal(first.ok, true, first.blocker); const result = await reader.readPublicDrainInputs(first, input);
      assert.equal(reader.recognized(first), false); return result; } };
}

test('actual-size 2500-comment estate and21 queued records fit fixed pages, preserve five aggregates and original reservation', async t => {
  const f = fixture(t, { commentCount: 2500, metadataBytes: 5500, actions: true });
  assert(Buffer.byteLength(JSON.stringify({ total_count: 21, workflow_runs: f.runs.filter(r => r.status === 'queued') })) > 256 * 1024);
  const original = [hash(readFileSync(f.state)), hash(readFileSync(f.deferred))];
  const result = await f.read(); assert.equal(result.ok, true, result.blocker); denied(result);
  const c = result.drainInputCandidate, p = c.publicEvidence; denied(c);
  assert.equal(c.fullDrainProofComplete, false); assert.equal(c.localCaptureAuthenticated, false); assert.equal(c.installedSourceAuthenticated, false);
  assert.equal(c.ordinaryReceiptDebtCount, null); assert.equal(c.counts.currentRotationReservationCount, 1); assert.equal(c.counts.reservedCount, 1);
  assert.equal(c.historyPendingBeforeCount, 0); assert.equal(c.historyPendingAfterCount, 0); assert.equal(c.orphanAcceptedCount, 0);
  assert.equal(p.commentCount, 2500); assert.equal(p.commandCount, 1); assert.equal(p.terminalRequestCount, 3);
  assert.equal(p.retiredEpochCommentCount, 3); assert.equal(p.noncanonicalSchemaCommentCount, 2); assert.equal(p.unclassifiedProtocolCommentCount, 0);
  assert.equal(p.pendingRuns.length, 5); assert.equal(c.actionPendingAggregateCount, 5); assert.equal(c.actionBlockingCount, 0);
  assert.equal(p.aggregateDispositions.filter(x => x.reason === 'LEGACY_PUBLICATION_ENTRYPOINT_REVOKED').length, 4);
  assert.equal(p.aggregateDispositions.filter(x => x.reason === 'EXACT_WORKFLOW_DAG_TERMINAL').length, 1);
  assert.equal(f.calls.filter(x => x.path.startsWith('/issues/3149/comments?')).length, 202);
  assert.equal(f.counts.get('/issues/3149/comments?per_page=25&page=101'), 2);
  assert.equal(f.counts.get('/commits/main'), 2); assert.equal(f.counts.get('/actions/runs/9000'), 2);
  assert(f.sizes.every(x => x.bytes <= 256 * 1024)); assert(p.decodedResponseBytes > 25 * 1024 * 1024 && p.decodedResponseBytes < 64 * 1024 * 1024);
  assert(f.calls.every(x => !/^\/actions\/runs\?/.test(x.path) || x.path.includes('per_page=10')));
  assert.equal(result.apiTransportAuthenticated, false); assert.equal(c.publicHistoryAuthenticated, false); assert.equal(c.actionsAuthenticated, false);
  assert.equal(f.reader.recognized(result.ownerControlObservation), true); assert.equal(productionRecognizes(result.ownerControlObservation), false);
  assert(Object.isFrozen(c.counts)); assert.deepEqual([hash(readFileSync(f.state)), hash(readFileSync(f.deferred))], original);
});
test('orphan ACCEPTED, public pending work and private ordinary publications stay visible without debt arithmetic', async t => {
  const f = fixture(t, { pending: true, localDebt: true }), r = await f.read(); assert.equal(r.ok, true, r.blocker);
  const c = r.drainInputCandidate; assert.equal(c.historyPendingBeforeCount, 1); assert.equal(c.orphanAcceptedCount, 1);
  assert.equal(c.publicEvidence.unresolvedAcceptedCount, 2); assert.equal(c.counts.acceptedCount, 1); assert.equal(c.counts.inlinePublicationCount, 1);
  assert.equal(c.counts.reservedCount, 2); assert.equal(c.counts.currentRotationReservationCount, 1); assert.equal(c.ordinaryReceiptDebtCount, null); denied(c);
});
test('malformed owner protocol input is retained as unknown instead of projected as zero history debt', async t => {
  const f = fixture(t, { commentCount: 13, ambiguous: true }), r = await f.read(); assert.equal(r.ok, true, r.blocker);
  assert.equal(r.blocker, 'OWNER_CONTROL_PUBLIC_PROTOCOL_UNCLASSIFIED'); assert.equal(r.drainInputCandidate.publicHistoryClassificationComplete, false);
  assert.equal(r.drainInputCandidate.historyPendingBeforeCount, null); assert.equal(r.drainInputCandidate.orphanAcceptedCount, null);
  assert.equal(r.drainInputCandidate.publicEvidence.unclassifiedProtocolCommentCount, 1); assert.equal(r.drainInputCandidate.ordinaryReceiptDebtCount, null);
});
for (const [name, mutate, expected] of [
  ['short middle page', ({ path, value }) => { if (path.endsWith('per_page=25&page=1')) value.pop(); }, 'HISTORY_INCOMPLETE'],
  ['duplicate ID', ({ path, value }) => { if (path.endsWith('per_page=25&page=1')) value[1] = clone(value[0]); }, 'COMMENT_IDENTITY_INVALID'],
  ['reordered page', ({ path, value }) => { if (path.endsWith('per_page=25&page=1')) value.reverse(); }, 'COMMENT_IDENTITY_INVALID'],
  ['same-count body edit', ({ path, n, value }) => { if (path.endsWith('per_page=25&page=2') && n === 2) value[0].body += 'edited'; }, 'HISTORY_CHANGED'],
  ['wrong issue locator', ({ path, value }) => { if (path.endsWith('per_page=25&page=1')) value[0].issue_url = API + '/issues/3258'; }, 'COMMENT_IDENTITY_INVALID'],
  ['wrong numeric owner', ({ path, value }) => { if (path.endsWith('per_page=25&page=1')) value[0].user.id++; }, 'COMMENT_OWNER_MISMATCH'],
  ['changed final issue count', ({ path, n, value }) => { if (path === '/issues/3149' && n === 6) value.comments++; }, 'HISTORY_COUNT_CHANGED'],
  ['moved main during Actions', ({ path, n, value }) => { if (path === '/commits/main' && n === 2) value.sha = git('f'); }, 'MAIN_CHANGED'],
  ['edited consent after acquisition', ({ path, n, value }) => { if (path === '/issues/comments/123456' && n === 5) value.updated_at = new Date().toISOString(); }, 'EDITED_COMMENT'],
  ['activation moved after acquisition', ({ path, n, value }) => { if (path === '/pulls/3268' && n === 5) value.head.sha = git('f'); }, 'ACTIVATION_CHANGED'],
]) test(name + ' cannot produce a completed public candidate', async t => {
  const f = fixture(t, { commentCount: 50, mutate }), r = await f.read(); assert.equal(r.ok, false); assert.match(r.blocker, new RegExp(expected)); denied(r);
});
for (const [name, mutate, expected] of [
  ['unauthorized', ({ url, value }) => response(url, value, { status: 401 }), 'RESPONSE_INVALID'],
  ['redirect', ({ url, value }) => response(url, value, { redirected: true }), 'RESPONSE_INVALID'],
  ['wrong origin', ({ value }) => response('https://example.invalid/public', value), 'RESPONSE_INVALID'],
  ['decoded oversized body', ({ url }) => response(url, null, { raw: JSON.stringify({ padding: 'x'.repeat(300000) }), headers: { 'content-encoding': 'gzip', 'content-length': '1' } }), 'RESPONSE_TOO_LARGE'],
  ['invalid UTF8', ({ url }) => response(url, null, { raw: Buffer.from([255]) }), 'READ_FAILED'],
]) test('public GET ' + name + ' remains bounded and closed', async t => {
  const f = fixture(t, { mutate: x => x.path.includes('/comments?') ? mutate(x) : null }), r = await f.read();
  assert.equal(r.ok, false); assert.match(r.blocker, new RegExp(expected)); denied(r);
});
for (const [name, mutate] of [
  ['partial jobs', ({ path, value }) => { if (path === '/actions/runs/9004/attempts/1/jobs?per_page=100') value.jobs.pop(); }],
  ['changed attempt', ({ path, n, value }) => { if (path === '/actions/runs/9000' && n === 2) value.run_attempt++; }],
  ['changed run head', ({ path, n, value }) => { if (path === '/actions/runs/9000' && n === 2) value.head_sha = git('f'); }],
  ['revocation blob mismatch', ({ path, value }) => { if (path.includes('mailboxReceiptIndexGitHubMirror.mjs?ref=' + git('d'))) value.sha = git('f'); }],
]) test(name + ' preserves all aggregates and reports actual blocking execution', async t => {
  const f = fixture(t, { actions: true, mutate }), r = await f.read(); assert.equal(r.ok, true, r.blocker);
  assert.equal(r.blocker, 'OWNER_CONTROL_PUBLIC_ACTIONS_PENDING'); assert.equal(r.drainInputCandidate.actionPendingAggregateCount, 5);
  assert(r.drainInputCandidate.actionBlockingCount > 0); assert.equal(r.drainInputCandidate.publicEvidence.actionsExecutionQuiescent, false); denied(r);
});
test('changed or duplicated paginated run inventory cannot be normalized as complete', async t => {
  for (const mode of ['count', 'duplicate', 'same-count-edit']) {
    const f = fixture(t, { actions: true, mutate: ({ path, n, value }) => {
      if (path === '/actions/runs?status=queued&per_page=10&page=2') {
        if (mode === 'count') value.total_count++;
        if (mode === 'duplicate') value.workflow_runs[1] = clone(value.workflow_runs[0]);
        if (mode === 'same-count-edit' && n === 2) value.workflow_runs[0].metadataPadding += 'changed';
      }
    } });
    const r = await f.read(); assert.equal(r.ok, false); assert.match(r.blocker, /ACTIONS_INCOMPLETE|ACTIONS_INVENTORY_CHANGED/); denied(r);
  }
});
test('new execution-capable aggregate stays blocking rather than inheriting legacy publication exclusions', async t => {
  const f = fixture(t, { actions: true, mutate: ({ path, value }) => {
    if (path.startsWith('/actions/runs?status=queued') && value.workflow_runs.length) value.workflow_runs[0].head_sha = git('9');
  } });
  const r = await f.read(); assert.equal(r.ok, true, r.blocker); assert.equal(r.drainInputCandidate.actionPendingAggregateCount, 5);
  assert(r.drainInputCandidate.actionBlockingCount >= 1); denied(r);
});
test('GET/replay exhaustion fails closed before reporting a full inventory', async t => {
  const f = fixture(t, { commentCount: 2500, actions: true, actionCount: 100, totalQueued: 100, runBytes: 0 }), r = await f.read();
  assert.equal(r.ok, false); assert.match(r.blocker, /GET_BOUND|TRANSCRIPT_BOUND/); denied(r);
});
test('aggregate decoded-byte bound applies across otherwise individually bounded GET responses', async t => {
  const f = fixture(t, { commentCount: 2500, metadataBytes: 5500, actions: true, actionCount: 100, totalQueued: 100, runBytes: 0,
    mutate: ({ path, value }) => { if (/^\/actions\/runs\/[0-9]+/.test(path)) value.padding = 'x'.repeat(240000); } });
  const r = await f.read(); assert.equal(r.ok, false); assert.equal(r.blocker, 'OWNER_CONTROL_PUBLIC_BYTE_BOUND'); denied(r);
});
test('a local estate change during public IO cannot be promoted into continuous guard or current native-capture proof', async t => {
  let changed = false, f;
  f = fixture(t, { mutate: ({ path }) => {
    if (path.includes('/comments?') && !changed) {
      changed = true; const state = JSON.parse(readFileSync(f.state, 'utf8')); state.retained = 'changed outside the original guard'; write(f.state, state);
    }
  } });
  const original = clone(f.local), r = await f.read(); assert.equal(r.ok, true, r.blocker);
  assert.equal(r.drainInputCandidate.stateSha256, original.stateSha256);
  assert.equal(r.drainInputCandidate.observedAtUtc, original.observedAtUtc);
  assert.equal(r.drainInputCandidate.journalGenerationSha256, original.journalGenerationSha256);
  assert.equal(r.drainInputCandidate.localCaptureAuthenticated, false); assert.equal(r.drainInputCandidate.localCaptureRecheckRequired, true);
  assert.equal(r.drainInputCandidate.fullDrainProofComplete, false); denied(r.drainInputCandidate);
});
test('the public deadline rejects delayed transport without accepting stale zero-blocking summary', async t => {
  const now = Date.now(); t.mock.timers.enable({ apis: ['Date'], now });
  const stale = { complete: true, pendingRuns: [], observedAt: new Date(now - 121000).toISOString() };
  assert.equal(mailboxActionEvidenceSummary(stale).actionBlockingCount, 0);
  assert.equal(mailboxActionsExecutionQuiescent(stale, { now: new Date(now).toISOString() }), false);
  let shifted = false;
  const f = fixture(t, { mutate: ({ path }) => { if (path.includes('/comments?') && !shifted) { shifted = true; t.mock.timers.setTime(now + 121000); } } });
  const r = await f.read(); assert.equal(r.ok, false); assert.match(r.blocker, /DEADLINE/); denied(r);
});
test('serialized/cross-reader evidence and extra transport/clock input never gain production authentication', async t => {
  const f = fixture(t), first = await f.reader.read({ commentId: 123456, token: secret, observation: f.input.observation });
  for (const value of [clone(first), {}, null]) assert.equal((await f.reader.readPublicDrainInputs(value, f.input)).ok, false);
  assert.equal((await productionRead(first, f.input)).blocker, 'OWNER_CONTROL_PRIOR_READ_NOT_AUTHENTICATED');
  const result = await f.reader.readPublicDrainInputs(first, { ...f.input, now: Date.now() });
  assert.equal(result.ok, false); assert.equal(f.reader.recognized(first), false); denied(result);
});
test('local capture substitution or stale generation is rejected, while a matching candidate never inherits native authentication', async t => {
  for (const change of [c => { c.requestId = 'foreign'; }, c => { c.sourceBinding.installedHead = git('f'); },
    c => { c.journalGenerationSha256 = sha('9'); }, c => { c.nativeExecutionAuthorized = true; },
    c => { c.counts.currentRotationReservationCount = 0; }, c => { c.observedAtUtc = new Date(Date.now() - 121000).toISOString(); c.captureStartedAtUtc = c.observedAtUtc; }]) {
    const f = fixture(t), first = await f.reader.read({ commentId: 123456, token: secret, observation: f.input.observation });
    const input = clone(f.input); change(input.drainInputCandidate);
    const r = await f.reader.readPublicDrainInputs(first, input); assert.equal(r.ok, false); assert.match(r.blocker, /LOCAL_/); denied(r);
  }
  const f = fixture(t), r = await f.read(); assert.equal(r.ok, true, r.blocker); denied(r.drainInputCandidate);
  assert.equal(r.drainInputCandidate.localCaptureAuthenticated, false); assert.equal(r.drainInputCandidate.localCaptureRecheckRequired, true);
});
test('getters/proxies are refused before caller-local data can influence a read', async t => {
  const f = fixture(t), first = await f.reader.read({ commentId: 123456, token: secret, observation: f.input.observation });
  let touched = false; const input = { ...f.input };
  Object.defineProperty(input, 'drainInputCandidate', { enumerable: true, get() { touched = true; return f.local; } });
  const r = await f.reader.readPublicDrainInputs(first, input); assert.equal(r.ok, false); assert.equal(touched, false); denied(r);
});
