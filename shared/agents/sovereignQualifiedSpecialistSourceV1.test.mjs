import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { captureAuthenticatedReviewDiffV1 } from './sovereignAuthenticatedReviewDiffV1.mjs';
import { captureSovereignSpecialistGitHubSourceV1 as capture,
  createSovereignSpecialistGitHubSourceTransportV1 as transport } from './sovereignQualifiedSpecialistSourceV1.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const prefix = '/repos/Cheekyfellastef/stephan-os/git/';
const syntheticIdentity = { repository: 'Cheekyfellastef/stephan-os', prNumber: 3424, branch: 'source-proof-fixture',
  sourceHead: 'a'.repeat(40), baseSha: 'b'.repeat(40) };

function repository(t, { largeBytes = 0 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sovereign-source-estate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const environment = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_AUTHOR_NAME: 'Source fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Source fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const fixedConfigArgs = ['-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'), '-c', 'core.autocrlf=false'];
  const git = (...args) => execFileSync('git', [...fixedConfigArgs, '-C', root, ...args], { env: environment, maxBuffer: 8 * 1024 * 1024 });
  const text = (...args) => git(...args).toString('utf8').trim();
  const save = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  git('init', '--quiet');
  save('README.md', 'Untouched root member\n'); save('shared/deep/untouched.txt', 'Untouched nested member\n');
  const oldLines = ['-- counter;', ...Array.from({ length: 80 }, (_, n) => 'old stable line ' + n)];
  save('scripts/windows/fixture.ps1', oldLines.join('\n') + '\n');
  save('scripts/windows/deleted.ps1', 'deleted source\n');
  git('add', '.'); git('commit', '--quiet', '-m', 'source fixture base'); const base = text('rev-parse', 'HEAD');
  const newLines = [...oldLines]; newLines[0] = '++ counter;'; newLines[70] = 'changed line seventy';
  save('scripts/windows/fixture.ps1', largeBytes ? 'x'.repeat(largeBytes) + '\n' : newLines.join('\n') + '\n');
  rmSync(join(root, 'scripts/windows/deleted.ps1')); save('scripts/windows/added.ps1', 'added source\n');
  git('add', '.'); git('commit', '--quiet', '-m', 'source fixture head'); const head = text('rev-parse', 'HEAD');
  const identity = { ...syntheticIdentity, sourceHead: head, baseSha: base };
  const files = text('diff', '--numstat', '--no-renames', base, head).split('\n').map(line => {
    const [additions, deletions, filename] = line.split('\t');
    const old = git('ls-tree', base, filename).toString('utf8'), fresh = git('ls-tree', head, filename).toString('utf8');
    return { filename, status: !old ? 'added' : !fresh ? 'removed' : 'modified',
      sha: text('rev-parse', (fresh ? head : base) + ':' + filename), additions: Number(additions), deletions: Number(deletions) };
  });
  const diff = git('diff', '--full-index', '--no-renames', base, head).toString('utf8');
  const cache = new Map();
  const api = path => {
    if (cache.has(path)) return structuredClone(cache.get(path));
    assert(path.startsWith(prefix)); const suffix = path.slice(prefix.length); let value;
    if (suffix.startsWith('commits/')) { const sha = suffix.slice(8); value = { sha, tree: { sha: text('rev-parse', sha + '^{tree}') } }; }
    else if (suffix.startsWith('trees/')) {
      const sha = suffix.slice(6).split('?')[0];
      value = { sha, truncated: false, tree: git('ls-tree', '-r', '-t', '-z', sha).toString('utf8').split('\0').filter(Boolean).map(line => {
        const tab = line.indexOf('\t'), [mode, type, sha] = line.slice(0, tab).split(' ');
        return { path: line.slice(tab + 1), mode, type, sha, ...(type === 'blob' ? { size: Number(text('cat-file', '-s', sha)) } : {}) };
      }) };
    } else if (suffix.startsWith('blobs/')) { const sha = suffix.slice(6), bytes = git('cat-file', 'blob', sha);
      value = { sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') }; }
    else throw Error('Unexpected fixture endpoint');
    cache.set(path, value); return structuredClone(value);
  };
  return { root, identity, files, diff, api, native: () => captureAuthenticatedReviewDiffV1({ root, head, base,
    git: { executable: 'git', fixedConfigArgs, environment } }) };
}

function response(url, value, { headers = {}, chunks, status = 200, redirected = false } = {}) {
  const bytes = Buffer.from(JSON.stringify(value)); let index = 0;
  return { url, status, redirected, headers: new Headers(headers), body: { getReader: () => ({
    async read() { if (chunks) return index < chunks.length ? { done: false, value: chunks[index++] } : { done: true };
      return index++ === 0 ? { done: false, value: bytes } : { done: true }; },
    async cancel() {}, releaseLock() {},
  }) } };
}

test('GitHub complete estates reconstruct exact native canonical bytes, closure and source evidence across distinct diff representations', async t => {
  const f = repository(t), native = f.native(); const calls = [], signals = new Set();
  const readJson = transport({ token: 'fixture-token', fetchImpl: async (url, options) => {
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); signals.add(options.signal); calls.push(url);
    return response(url, f.api(url.slice('https://api.github.com'.length)));
  } });
  const result = await capture(f.identity, { files: f.files, diff: f.diff, readJson });
  assert.equal(result.binding.fullDiffSha256, native.fullDiffSha256);
  assert.equal(result.binding.reviewedObjectClosureSha256, native.reviewedObjectClosureSha256);
  assert.deepEqual(result.binding.sourceEvidence, native.sourceEvidence);
  assert.equal(result.binding.sourceTree, native.sourceTree); assert.equal(result.binding.baseTree, native.baseTree);
  assert.equal(result.githubRawDiffSha256, hash(f.diff)); assert.notEqual(result.githubRawDiffSha256, result.canonicalDiffSha256);
  assert.equal(signals.size, 1); assert.equal([...signals][0].aborted, true); assert(calls.length > 4);
  const diagnostic = await capture(f.identity, { files: f.files, diff: 'diagnostic only', readJson: async path => f.api(path) });
  assert.deepEqual(diagnostic.binding, result.binding);
});

test('450KB complete source is not truncated; independent consumer bound remains one MiB', async t => {
  const f = repository(t, { largeBytes: 450 * 1024 });
  const result = await capture(f.identity, { files: f.files, diff: f.diff, readJson: async path => f.api(path) });
  assert(result.binding.diffBytes > 450 * 1024); assert.equal(result.binding.fullDiffSha256, f.native().fullDiffSha256);
  const tooLarge = repository(t, { largeBytes: 1024 * 1024 });
  await assert.rejects(capture(tooLarge.identity, { files: tooLarge.files, diff: tooLarge.diff, readJson: async path => tooLarge.api(path) }), /SOURCE_IDENTITY_INVALID/);
});

for (const [name, mutate] of [
  ['missing untouched leaf', (path, value) => { if (path.includes('/trees/')) value.tree = value.tree.filter(row => row.path !== 'README.md'); }],
  ['missing directory', (path, value) => { if (path.includes('/trees/')) value.tree = value.tree.filter(row => row.path !== 'shared'); }],
  ['duplicate member', (path, value) => { if (path.includes('/trees/')) value.tree.push({ ...value.tree[0] }); }],
  ['truncated full estate', (path, value) => { if (path.includes('/trees/')) value.truncated = true; }],
  ['wrong mode', (path, value) => { if (path.includes('/trees/')) value.tree.find(row => row.path === 'README.md').mode = '100755'; }],
  ['wrong commit identity', (path, value) => { if (path.includes('/commits/')) value.sha = 'f'.repeat(40); }],
  ['corrupted blob bytes', (path, value) => { if (path.includes('/blobs/')) value.content = Buffer.from('corrupted').toString('base64'); }],
  ['noncanonical base64', (path, value) => { if (path.includes('/blobs/')) value.content += ' '; }],
]) test('authenticated source rejects ' + name, async t => {
  const f = repository(t);
  await assert.rejects(capture(f.identity, { files: f.files, diff: f.diff, readJson: async path => { const value = f.api(path); mutate(path, value); return value; } }), /^Error: SOVEREIGN_SPECIALIST_/);
});

test('incomplete PR changed-path inventory and unresolved rename metadata remain held', async t => {
  const f = repository(t), options = { diff: f.diff, readJson: async path => f.api(path) };
  await assert.rejects(capture(f.identity, { ...options, files: f.files.slice(1) }), /UNRESOLVED_CHANGED_PATH/);
  const files = structuredClone(f.files); files[0].previous_filename = 'prior-name.ps1';
  await assert.rejects(capture(f.identity, { ...options, files }), /UNRESOLVED_CHANGED_PATH/);
});

test('fixed transport denies arbitrary endpoints, origins, redirects and non-200 success statuses', async () => {
  const controller = new AbortController(); let invoked = 0;
  const read = transport({ token: 'fixture-token', fetchImpl: async url => { invoked++; return response(url, {}); } });
  for (const path of ['https://example.invalid/source', '/repos/other/project/git/blobs/' + 'a'.repeat(40), prefix + 'trees/' + 'a'.repeat(40), prefix + 'blobs/' + 'a'.repeat(40) + '?x=1'])
    await assert.rejects(read(path, { signal: controller.signal }), /TRANSPORT_SCOPE_INVALID/);
  assert.equal(invoked, 0);
  for (const change of [{ url: 'https://example.invalid/' }, { status: 206 }, { status: 201 }, { redirected: true }]) {
    const reader = transport({ token: 'fixture-token', fetchImpl: async url => ({ ...response(url, {}), ...change }) });
    await assert.rejects(reader(prefix + 'commits/' + 'a'.repeat(40), { signal: controller.signal }), /SOURCE_RESPONSE_INVALID/);
  }
});

test('stream byte bounds reject overflow before a full body is buffered', async () => {
  const controller = new AbortController(), path = prefix + 'commits/' + 'a'.repeat(40);
  let reads = 0, cancelled = false;
  const read = transport({ token: 'fixture-token', fetchImpl: async url => ({ url, status: 200, redirected: false, headers: new Headers(),
    body: { getReader: () => ({ async read() { reads++; return { done: false, value: new Uint8Array(300 * 1024) }; }, async cancel() { cancelled = true; }, releaseLock() {} }) } }) });
  await assert.rejects(read(path, { signal: controller.signal }), /SOURCE_RESPONSE_UNBOUNDED/);
  assert.equal(reads, 2); assert.equal(cancelled, true);
  const headerOverflow = transport({ token: 'fixture-token', fetchImpl: async url => response(url, {}, { headers: { 'content-length': '524289' } }) });
  await assert.rejects(headerOverflow(path, { signal: controller.signal }), /SOURCE_RESPONSE_UNBOUNDED/);
  const partial = transport({ token: 'fixture-token', fetchImpl: async url => response(url, {}, { headers: { 'content-length': '10' } }) });
  await assert.rejects(partial(path, { signal: controller.signal }), /SOURCE_RESPONSE_INCOMPLETE/);
});

test('actual source collector aborts the entire capture when a streamed commit body overflows', async () => {
  const signals = new Set(); let cancelled = 0;
  const readJson = transport({ token: 'fixture-token', fetchImpl: async (url, options) => {
    signals.add(options.signal);
    return { url, status: 200, redirected: false, headers: new Headers(), body: { getReader: () => ({
      async read() { return { done: false, value: new Uint8Array(300 * 1024) }; },
      async cancel() { cancelled++; }, releaseLock() {},
    }) } };
  } });
  await assert.rejects(capture(syntheticIdentity, { diff: 'fixture diff', files: [], readJson }), /SOURCE_RESPONSE_UNBOUNDED/);
  assert.equal(signals.size, 1); assert.equal([...signals][0].aborted, true); assert.equal(cancelled, 2);
});

for (const mode of ['never-ending fetch', 'never-ending body']) test('one real collector deadline rejects ' + mode + ' even when transport ignores abort', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const signals = new Set(); let lateResolve, bodyRead = false, cancelled = false;
  const readJson = transport({ token: 'fixture-token', fetchImpl: (url, options) => {
    signals.add(options.signal);
    if (mode === 'never-ending fetch') return new Promise(resolve => { lateResolve = () => resolve(response(url, {})); });
    return Promise.resolve({ url, status: 200, redirected: false, headers: new Headers(), body: { getReader: () => ({
      read() { bodyRead = true; return new Promise(resolve => { lateResolve = () => resolve({ done: true }); }); },
      async cancel() { cancelled = true; }, releaseLock() {},
    }) } });
  } });
  const pending = capture(syntheticIdentity, { diff: 'fixture diff', files: [], readJson });
  const rejected = assert.rejects(pending, /SOURCE_READ_DEADLINE/);
  for (let n = 0; n < 8; n++) await Promise.resolve();
  if (mode === 'never-ending body') assert.equal(bodyRead, true);
  t.mock.timers.tick(60000); await rejected; lateResolve?.(); await Promise.resolve();
  assert.equal(signals.size, 1); assert.equal([...signals][0].aborted, true);
  if (mode === 'never-ending body') assert.equal(cancelled, true);
});

test('real Node fetch gzip response keeps decoded stream bounded without comparing it to compressed Content-Length', async t => {
  const value = { sha: 'a'.repeat(40), note: 'decoded fixture '.repeat(60) }, bytes = Buffer.from(JSON.stringify(value)), compressed = gzipSync(bytes);
  assert(compressed.length < bytes.length);
  const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': compressed.length }); response.end(compressed); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const local = 'http://127.0.0.1:' + server.address().port;
  const reader = transport({ token: 'fixture-token', fetchImpl: async url => {
    // Only the test transport is redirected to loopback; the production API
    // still receives/asserts its fixed GitHub origin and exact GET path.
    const actual = await fetch(local); return { url, status: actual.status, redirected: false, headers: actual.headers, body: actual.body };
  } });
  assert.deepEqual(await reader(prefix + 'commits/' + 'a'.repeat(40), { signal: new AbortController().signal }), value);
});
