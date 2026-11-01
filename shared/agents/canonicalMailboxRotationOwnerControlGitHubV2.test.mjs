import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { gzipSync, brotliCompressSync, deflateSync } from 'node:zlib';
import {
  createMailboxRotationOwnerControlGitHubTestReaderV2 as createReader,
  readMailboxRotationOwnerControlGitHubV2 as productionRead,
  isAuthenticatedMailboxRotationOwnerControlGitHubV2 as productionRecognizes,
  recheckMailboxRotationOwnerControlGitHubV2 as productionRecheck,
} from './canonicalMailboxRotationOwnerControlGitHubV2.mjs';
import { formatMailboxRotationOwnerControlV2 as format,
  MAILBOX_ROTATION_OWNER_OBSERVATION_SCHEMA_V2 as observationSchema } from './canonicalMailboxRotationOwnerControlV2.mjs';
import { MAILBOX_ROTATION_OWNER_CONTROL_SCHEMA_V2 as schema } from './canonicalMailboxNativeEvidenceCodecV2.mjs';

const REPO = 'Cheekyfellastef/stephan-os';
const API = 'https://api.github.com/repos/' + REPO;
const file = 'shared/agents/canonicalMailboxAuthorityV1.mjs';
const git = c => c.repeat(40), sha = c => c.repeat(64);
const clone = v => JSON.parse(JSON.stringify(v));
const secret = 'test-fixture-only-no-real-credential';
const nativeFlags = ['nativeExecutionAuthorized', 'freezeCertified', 'protectedMergeAuthorized',
  'sourceSyncAuthorized', 'epochAdoptionAuthorized', 'nativeProducerQualified',
  'originalGuardHeld', 'nativeObservationAuthenticated', 'ordinaryReceiptDebtDrained'];
function noAuthority(value) {
  for (const flag of nativeFlags) assert.equal(value[flag], false, flag);
  assert.equal(productionRecognizes(value), false);
  assert.equal(JSON.stringify(value).includes(secret), false);
}
function response(url, value, { status = 200, raw, headers = {} } = {}) {
  const body = raw === undefined ? JSON.stringify(value) : raw;
  const result = new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } });
  Object.defineProperty(result, 'url', { value: url });
  return result;
}
function fixture(mutate) {
  const consent = { schemaVersion: schema, repository: REPO, operatorApproval: 'operator-approved',
    transitionId: 'fixture-transition-1', rotationAction: 'FREEZE', state: 'PRE_MERGE',
    source: { protectedMainHead: git('a'), protectedMainTreeSha: git('b'), installedHead: git('a'),
      installedTreeSha: git('b'), installedClosureSha256: sha('c'), sourceRole: 'PREPARATION' },
    activation: { prNumber: 3268, headSha: git('d'), baseSha: git('a'), treeSha: git('e'), mergeCommitSha: null, mergeTreeSha: null },
    epoch: { predecessorIssue: 3149, successorIssue: 3258 },
    barrier: { highestCommandCommentId: 100, inventorySha256: sha('f'), commentCount: 2500 },
    preparation: { headSha: git('a'), treeSha: git('b'), closureSha256: sha('c'), originalFrozenArtifactSha256: null },
    expiresAtUtc: new Date(Date.now() + 300000).toISOString(), probeRequestIds: [] };
  const created = new Date(Date.now() - 1000).toISOString();
  const comment = { id: 12345, url: API + '/issues/comments/12345',
    user: { login: 'Cheekyfellastef', id: 267490109, type: 'User' }, author_association: 'OWNER',
    created_at: created, updated_at: created, body: format(consent),
    issue_url: API + '/issues/3268', html_url: 'https://github.com/' + REPO + '/pull/3268#issuecomment-12345' };
  const observation = { schemaVersion: observationSchema, repository: REPO,
    transitionId: consent.transitionId, state: consent.state, source: clone(consent.source),
    activation: { ...consent.activation, state: 'OPEN' },
    epoch: { ...consent.epoch, activeIssue: 3149, retiredPredecessor: false },
    barrier: clone(consent.barrier), preparation: clone(consent.preparation),
    observedAtUtc: new Date(Date.now() - 10).toISOString() };
  const repository = { id: 1179385578, full_name: REPO, owner: { id: 267490109, login: 'Cheekyfellastef' } };
  const source = Buffer.from('export const CANONICAL_MAILBOX_ISSUE = 3149;\n'
    + 'export const RETIRED_CANONICAL_MAILBOX_ISSUES = Object.freeze([1507, 2158, 2590, 2808]);\n');
  const routes = {
    '/issues/comments/12345': comment,
    '/git/ref/heads/main': { ref: 'refs/heads/main', object: { type: 'commit', sha: git('a') } },
    '/pulls/3268': { number: 3268, html_url: 'https://github.com/' + REPO + '/pull/3268',
      state: 'open', merged: false, draft: false,
      // GitHub may populate a synthetic merge SHA on an UNMERGED pull request.
      merge_commit_sha: git('9'),
      head: { sha: git('d'), repo: clone(repository) }, base: { sha: git('a'), ref: 'main', repo: clone(repository) } },
    '/issues/3149': { number: 3149, url: API + '/issues/3149', state: 'open', comments: 2500 },
    '/issues/3258': { number: 3258, url: API + '/issues/3258', state: 'open', comments: 0,
      user: { id: 267490109, login: 'Cheekyfellastef' },
      body: 'Status: INACTIVE — NO COMMAND AUTHORITY.\n\n<!-- stephanos:canonical-mailbox-successor:v1 predecessor=3149 successor=3258 state=INACTIVE -->\n' },
    ['/git/commits/' + git('a')]: { sha: git('a'), tree: { sha: git('b') } },
    ['/git/commits/' + git('d')]: { sha: git('d'), tree: { sha: git('e') } },
    ['/contents/' + file + '?ref=' + git('a')]: { path: file, type: 'file', encoding: 'base64', size: source.length,
      sha: createHash('sha1').update('blob ' + source.length + '\0').update(source).digest('hex'),
      content: source.toString('base64'), url: API + '/contents/' + file + '?ref=' + git('a') },
  };
  const calls = [], counts = new Map();
  const fetch = async (url, options) => {
    assert(url.startsWith(API + '/'));
    const path = url.slice(API.length), n = (counts.get(path) || 0) + 1;
    counts.set(path, n); calls.push({ url, path, options, n });
    assert(Object.hasOwn(routes, path), path);
    const value = clone(routes[path]);
    const replacement = mutate ? await mutate({ path, n, value, url, options, routes, observation, consent, comment }) : null;
    return replacement || response(url, value);
  };
  return { reader: createReader(fetch), input: { commentId: 12345, token: secret, observation },
    consent, observation, comment, routes, calls };
}

test('full original codec/binder to fixed GET/re-GET, with no native authority', async () => {
  const f = fixture(), result = await f.reader.read(f.input);
  assert.equal(result.ok, true, result.blocker); assert.equal(f.calls.length, 13);
  assert.equal(result.requestId.startsWith('rotation-v2-'), true);
  assert.equal(result.testTransport, true);
  assert.equal(result.apiTransportAuthenticated, false);
  assert.equal(result.ownerConsentAuthenticated, false);
  assert.equal(result.blocker, 'ORIGINAL_NATIVE_ADMISSION_REQUIRED');
  assert.equal(f.reader.recognized(result), true); noAuthority(result);
  assert(Object.isFrozen(result)); assert(Object.isFrozen(result.consent.source));
  for (const call of f.calls) {
    assert.equal(call.options.method, 'GET'); assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.cache, 'no-store'); assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.headers.Authorization, 'Bearer ' + secret);
  }
});
test('recheck reads independently, retains request identity, invalidates old observation', async () => {
  const f = fixture(), first = await f.reader.read(f.input);
  const next = await f.reader.recheck(first, { token: secret, observation: f.observation });
  assert.equal(next.ok, true, next.blocker); assert.equal(next.requestId, first.requestId);
  assert.equal(next.githubBindingSha256, first.githubBindingSha256); assert.equal(f.calls.length, 26);
  assert.equal(f.reader.recognized(first), false); assert.equal(f.reader.recognized(next), true);
  assert.equal((await productionRecheck(next, { token: secret, observation: f.observation })).ok, false);
  noAuthority(next);
});
test('cloned or cross-reader receipts cannot authorize recheck', async () => {
  const f = fixture(), original = await f.reader.read(f.input), other = fixture();
  for (const value of [clone(original), {}, null, new Proxy(original, {})]) {
    assert.equal((await f.reader.recheck(value, { token: secret, observation: f.observation })).ok, false);
  }
  assert.equal((await other.reader.recheck(original, { token: secret, observation: f.observation })).ok, false);
  assert.equal(other.calls.length, 0);
});
for (const [name, path, change] of [
  ['main ref', '/git/ref/heads/main', v => { v.object.sha = git('1'); }],
  ['main ref kind', '/git/ref/heads/main', v => { v.object.type = 'tag'; }],
  ['head', '/pulls/3268', v => { v.head.sha = git('1'); }],
  ['base', '/pulls/3268', v => { v.base.sha = git('1'); }],
  ['repository id', '/pulls/3268', v => { v.head.repo.id++; }],
  ['repository owner id', '/pulls/3268', v => { v.base.repo.owner.id++; }],
  ['fork repository', '/pulls/3268', v => { v.head.repo.full_name = 'other/stephan-os'; }],
  ['activation number', '/pulls/3268', v => { v.number++; }],
  ['merged activation', '/pulls/3268', v => { v.merged = true; }],
  ['closed activation', '/pulls/3268', v => { v.state = 'closed'; }],
  ['draft activation', '/pulls/3268', v => { v.draft = true; }],
  ['base ref', '/pulls/3268', v => { v.base.ref = 'other'; }],
  ['predecessor count', '/issues/3149', v => { v.comments++; }],
  ['successor commands', '/issues/3258', v => { v.comments = 1; }],
  ['successor owner', '/issues/3258', v => { v.user.id++; }],
  ['successor active', '/issues/3258', v => { v.body = v.body.replace('Status: INACTIVE', 'Status: ACTIVE'); }],
  ['duplicate nomination', '/issues/3258', v => { v.body += '<!-- stephanos:canonical-mailbox-successor:v1 predecessor=3149 successor=4000 state=INACTIVE -->'; }],
  ['main tree', '/git/commits/' + git('a'), v => { v.tree.sha = git('1'); }],
  ['activation tree', '/git/commits/' + git('d'), v => { v.tree.sha = git('1'); }],
  ['substituted commit', '/git/commits/' + git('d'), v => { v.sha = git('1'); }],
]) test('rejects changed ' + name, async () => {
  const f = fixture(({ path: p, value }) => { if (p === path) change(value); });
  const result = await f.reader.read(f.input); assert.equal(result.ok, false, name); noAuthority(result);
});
for (const [name, change] of [
  ['forged owner', v => { v.user.id++; }],
  ['edited approval', v => { v.updated_at = new Date(Date.now()).toISOString(); }],
  ['wrong returned comment id', v => { v.id++; }],
  ['wrong locator', v => { v.url = API + '/issues/comments/9999'; }],
  ['wrong origin', v => { v.issue_url = API + '/issues/3149'; }],
  ['stale approval', v => { v.created_at = v.updated_at = new Date(Date.now() - 900001).toISOString(); }],
]) test('rejects ' + name + ' before any other GET', async () => {
  const f = fixture(({ path, value }) => { if (path.startsWith('/issues/comments/')) change(value); });
  const result = await f.reader.read(f.input); assert.equal(result.ok, false); assert.equal(f.calls.length, 1); noAuthority(result);
});
for (const target of ['/issues/comments/12345', '/git/ref/heads/main', '/pulls/3268', '/issues/3149', '/issues/3258']) {
  test('second independent GET detects drift in ' + target, async () => {
    const f = fixture(({ path, n, value }) => {
      if (path !== target || n !== 2) return;
      if (path.includes('/comments/')) value.updated_at = new Date(Date.now()).toISOString();
      else if (path.includes('/git/ref')) value.object.sha = git('1');
      else if (path.includes('/pulls/')) value.head.sha = git('1');
      else if (path.endsWith('/3149')) value.comments++;
      else value.body += 'changed';
    });
    const result = await f.reader.read(f.input); assert.equal(result.ok, false); noAuthority(result);
  });
}
for (const [name, change] of [
  ['blob hash', v => { v.sha = git('1'); }],
  ['wrong source bytes', v => { v.content = Buffer.from('forged').toString('base64'); }],
  ['ambiguous base64', v => { v.content += '!'; }],
  ['wrong encoding', v => { v.encoding = 'utf-8'; }],
  ['symlink', v => { v.type = 'symlink'; }],
  ['wrong source locator', v => { v.url = v.url.replace('?ref=', '?ref=x'); }],
  ['source over limit', v => { v.size = 65537; }],
]) test('rejects authority ' + name, async () => {
  const f = fixture(({ path, value }) => { if (path.startsWith('/contents/')) change(value); });
  const result = await f.reader.read(f.input); assert.equal(result.ok, false); noAuthority(result);
});
test('valid blob with switched canonical epoch is refused', async () => {
  const f = fixture(({ path, value }) => {
    if (!path.startsWith('/contents/')) return;
    const bytes = Buffer.from(Buffer.from(value.content, 'base64').toString().replace('ISSUE = 3149', 'ISSUE = 3258'));
    value.content = bytes.toString('base64'); value.size = bytes.length;
    value.sha = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
  });
  const result = await f.reader.read(f.input); assert.equal(result.blocker, 'OWNER_CONTROL_PREDECESSOR_EPOCH_CHANGED'); noAuthority(result);
});
for (const status of [301, 302, 401, 403, 404, 429, 500]) test('HTTP ' + status + ' is held without retry or token forwarding', async () => {
  const f = fixture(({ url }) => response(url, {}, { status, headers: { location: 'https://untrusted.invalid/collect' } }));
  const result = await f.reader.read(f.input); assert.equal(result.ok, false); assert.equal(f.calls.length, 1); noAuthority(result);
});
for (const [name, build] of [
  ['oversized declared body', u => response(u, {}, { headers: { 'content-length': '262145' } })],
  ['oversized streamed body', u => response(u, {}, { raw: 'x'.repeat(262145) })],
  ['invalid UTF8', u => response(u, {}, { raw: new Uint8Array([0xff]) })],
  ['bad JSON', u => response(u, {}, { raw: '{' })],
  ['array response', u => response(u, [])],
  ['unexpected content type', u => response(u, {}, { headers: { 'content-type': 'text/html' } })],
  ['wrong final URL', () => response('https://untrusted.invalid/collect', {})],
  ['truncated response', u => response(u, {}, { headers: { 'content-length': '3' } })],
  ['identity length mismatch', u => response(u, {}, { headers: { 'content-encoding': 'identity', 'content-length': '3' } })],
  ['unknown content encoding', u => response(u, {}, { headers: { 'content-encoding': 'unknown' } })],
  ['empty content encoding', u => response(u, {}, { headers: { 'content-encoding': '' } })],
  ['stacked content encodings', u => response(u, {}, { headers: { 'content-encoding': 'gzip, br' } })],
  ['compressed oversized declared body', u => response(u, {}, { headers: { 'content-encoding': 'gzip', 'content-length': '262145' } })],
  ['compressed oversized decoded body', u => response(u, {}, { raw: 'x'.repeat(262145), headers: { 'content-encoding': 'gzip', 'content-length': '290' } })],
  ['compressed invalid UTF8', u => response(u, {}, { raw: new Uint8Array([0xff]), headers: { 'content-encoding': 'gzip', 'content-length': '21' } })],
  ['compressed truncated JSON', u => response(u, {}, { raw: '{', headers: { 'content-encoding': 'gzip', 'content-length': '21' } })],
]) test('rejects ' + name, async () => {
  const f = fixture(({ url }) => build(url)), result = await f.reader.read(f.input);
  assert.equal(result.ok, false); noAuthority(result);
});
for (const [encoding, compress] of [['gzip', gzipSync], ['br', brotliCompressSync], ['deflate', deflateSync]]) {
  test('accepts fetch-decoded ' + encoding + ' bodies on read and recheck with wire length headers', async () => {
    const f = fixture(({ url, value }) => {
      const decoded = JSON.stringify(value);
      const wireLength = compress(Buffer.from(decoded)).length;
      assert.notEqual(wireLength, Buffer.byteLength(decoded));
      return response(url, value, { headers: { 'content-encoding': encoding, 'content-length': String(wireLength) } });
    });
    const first = await f.reader.read(f.input);
    assert.equal(first.ok, true, first.blocker); noAuthority(first);
    const next = await f.reader.recheck(first, { token: secret, observation: f.observation });
    assert.equal(next.ok, true, next.blocker); assert.equal(next.requestId, first.requestId);
    assert.equal(f.reader.recognized(first), false); assert.equal(f.reader.recognized(next), true);
    assert.equal(f.calls.length, 26); noAuthority(next);
  });
}
test('transport errors never disclose the credential or provider error body', async () => {
  const f = fixture(() => { throw Error('OWNER_CONTROL_' + secret.toUpperCase()); });
  const result = await f.reader.read(f.input);
  assert.equal(result.blocker, 'OWNER_CONTROL_GITHUB_READ_FAILED'); noAuthority(result);
});
test('input and observation accessors/proxies are refused without executing them', async () => {
  let calls = 0; const f = fixture();
  const input = { ...f.input }; Object.defineProperty(input, 'token', { get() { calls++; return secret; } });
  const observation = new Proxy(f.observation, { get() { calls++; throw Error(); }, ownKeys() { calls++; throw Error(); } });
  for (const value of [input, { ...f.input, observation }, new Proxy(f.input, { get() { calls++; throw Error(); } })]) {
    assert.equal((await f.reader.read(value)).ok, false);
  }
  assert.equal(calls, 0); assert.equal(f.calls.length, 0);
});
test('caller mutation during awaited IO cannot change the captured observation', async () => {
  const f = fixture(({ n, path }) => { if (n === 1 && path.includes('/comments/')) f.observation.source.installedHead = git('f'); });
  const result = await f.reader.read(f.input); assert.equal(result.ok, true); noAuthority(result);
});
test('an unsuccessful recheck consumes the old observation, never leaves stale authority', async () => {
  const f = fixture(), original = await f.reader.read(f.input);
  f.routes['/pulls/3268'].head.sha = git('1');
  const result = await f.reader.recheck(original, { token: secret, observation: f.observation });
  assert.equal(result.ok, false); assert.equal(f.reader.recognized(original), false); noAuthority(result);
});
test('ordinary read evidence cannot enter post-merge VERIFY through the existing binder', async () => {
  const f = fixture(); f.consent.state = 'ADOPTED_NOT_VERIFIED'; f.consent.rotationAction = 'VERIFY';
  f.consent.probeRequestIds = ['probe-one', 'probe-two'];
  f.routes['/issues/comments/12345'].body = format(f.consent); f.observation.state = f.consent.state;
  const result = await f.reader.read(f.input);
  assert.equal(result.blocker, 'ORIGINAL_FROZEN_NATIVE_PROOF_REQUIRED'); assert.equal(f.calls.length, 1); noAuthority(result);
});
test('unknown options, empty credentials and invalid ids cause no production network read', async () => {
  const f = fixture();
  for (const input of [{ ...f.input, fetchImpl() {} }, { ...f.input, token: '' }, { ...f.input, commentId: -1 },
    { ...f.input, commentId: '12345' }, { ...f.input, commentId: Number.MAX_SAFE_INTEGER + 1 },
    { ...f.input, token: secret + '\n' }]) {
    const result = await productionRead(input); assert.equal(result.ok, false); noAuthority(result);
  }
});
test('fixture transport is unavailable outside node:test and never installs global hooks', () => {
  const url = new URL('./canonicalMailboxRotationOwnerControlGitHubV2.mjs', import.meta.url).href;
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {createMailboxRotationOwnerControlGitHubTestReaderV2 as f} from ${JSON.stringify(url)};\n`
    + `try { f(() => {}); process.exit(1); } catch(e) { if(e.message !== 'TEST_TRANSPORT_NOT_ADMITTED') process.exit(2); }`],
  { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
});
