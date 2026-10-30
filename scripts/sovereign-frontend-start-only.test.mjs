import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectFrontendVisibilitySnapshotV1, bindFrontendVisibilitySnapshotV1, isExactFrontendListenerV1 } from './sovereign-frontend-start-only.mjs';
import { createStephanosDistManifest } from './stephanos-build-utils.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'frontend-start-only-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false, windowsHide: true, timeout: 10000 });
    assert.equal(r.status, 0, r.stderr || r.error?.message); return r.stdout.trim();
  };
  git('init', '-b', 'main');
  git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
  writeFileSync(join(root, 'index.html'), '<html><body>launcher<script type="module" src="main.js"></script></body></html>');
  writeFileSync(join(root, 'main.js'), 'globalThis.fixture=true;');
  mkdirSync(join(root, 'scripts')); writeFileSync(join(root, 'scripts/fixed.mjs'), '// fixed source');
  git('add', '.'); git('commit', '-m', 'fixture');
  const expectedHead = git('rev-parse', 'HEAD');
  mkdirSync(join(root, 'apps/stephanos/dist/assets'), { recursive: true });
  writeFileSync(join(root, 'apps/stephanos/dist/index.html'), '<html><body>runtime<script type="module" src="./assets/a.js"></script></body></html>');
  writeFileSync(join(root, 'apps/stephanos/dist/assets/a.js'), 'globalThis.runtimeFixture=true;');
  writeFileSync(join(root, 'apps/stephanos/dist/stephanos-build.json'), JSON.stringify({ gitCommit: expectedHead, sourceFingerprint: 'b'.repeat(64) }));
  const expectedDistFingerprint = createStephanosDistManifest({ rootDir: root }).fingerprint;
  return { root, expectedHead, expectedDistFingerprint, git };
}

test('held repair is disjoint: frozen shell/runtime bytes need no backend, gateway, workspace or remote source', async t => {
  const f = fixture(t);
  const before = readFileSync(join(f.root, 'apps/stephanos/dist/index.html'));
  const snapshot = collectFrontendVisibilitySnapshotV1(f);
  const server = await bindFrontendVisibilitySnapshotV1(snapshot, { port: 0 });
  t.after(() => new Promise(done => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await (await fetch(`${base}/__stephanos/health`)).json();
  assert.equal(health.mode, 'visibility-only'); assert.equal(health.custodyReleased, false);
  assert.equal(health.backendHealth, 'UNVERIFIED'); assert.equal(health.controlsEnabled, false);
  const shell = await fetch(base);
  assert.match(await shell.text(), /launcher.*Frontend visibility mode|Frontend visibility mode.*launcher/s);
  assert.match(shell.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.match(await (await fetch(`${base}/apps/stephanos/dist/`)).text(), /runtime/);
  assert.equal((await fetch(`${base}/apps/stephanos/dist/assets/a.js`)).status, 200);
  assert.deepEqual(readFileSync(join(f.root, 'apps/stephanos/dist/index.html')), before);
  writeFileSync(join(f.root, 'apps/stephanos/dist/assets/a.js'), 'changed-after-start');
  assert.equal(await (await fetch(`${base}/apps/stephanos/dist/assets/a.js`)).text(), 'globalThis.runtimeFixture=true;');
  for (const route of ['/__stephanos/restart', '/api/execute', '/__stephanos/openclaw-readonly-validation'])
    assert.equal((await fetch(base + route, { method: 'POST', body: '{}' })).status, 405);
  for (const route of ['/scripts/fixed.mjs', '/.git/config', '/unknown', '/__stephanos/restart'])
    assert.equal((await fetch(base + route)).status, 404);
});

test('changed bytes, missing files, source edits and changed head refuse before binding', t => {
  const f = fixture(t);
  assert.throws(() => collectFrontendVisibilitySnapshotV1({ ...f, expectedHead: 'a'.repeat(40) }), /INSTALLED_HEAD_CHANGED/);
  writeFileSync(join(f.root, 'scripts/fixed.mjs'), '// changed');
  assert.throws(() => collectFrontendVisibilitySnapshotV1(f), /LOCAL_SOURCE_UNPROVEN/);
  f.git('checkout', '--', 'scripts/fixed.mjs');
  writeFileSync(join(f.root, 'apps/stephanos/dist/assets/a.js'), 'wrong');
  assert.throws(() => collectFrontendVisibilitySnapshotV1(f), /ASSET_FINGERPRINT_CHANGED/);
  rmSync(join(f.root, 'apps/stephanos/dist/index.html'));
  assert.throws(() => collectFrontendVisibilitySnapshotV1(f), /REQUIRED_FILE_MISSING/);
});

test('exclusive bind leaves foreign listener untouched and concurrent start has one owner', async t => {
  const f = fixture(t), snapshot = collectFrontendVisibilitySnapshotV1(f);
  const owner = await bindFrontendVisibilitySnapshotV1(snapshot, { port: 0 });
  t.after(() => new Promise(done => owner.close(done)));
  const port = owner.address().port;
  await assert.rejects(bindFrontendVisibilitySnapshotV1(snapshot, { port }), { code: 'EADDRINUSE' });
  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
  const probe = await bindFrontendVisibilitySnapshotV1(snapshot, { port: 0 });
  const unused = probe.address().port;
  await new Promise(done => probe.close(done));
  const starts = await Promise.allSettled([bindFrontendVisibilitySnapshotV1(snapshot, { port: unused }), bindFrontendVisibilitySnapshotV1(snapshot, { port: unused })]);
  assert.equal(starts.filter(r => r.status === 'fulfilled').length, 1);
  const winner = starts.find(r => r.status === 'fulfilled').value;
  await new Promise(done => winner.close(done));
});

test('HTTP self-description cannot qualify a foreign Windows process or a different invocation', () => {
  const options = { expectedHead: 'a'.repeat(40), expectedDistFingerprint: 'b'.repeat(64), script: 'C:\\installed path\\fixed.mjs' };
  const row = { pid: 123, executablePath: 'C:\\Program Files\\nodejs\\node.exe',
    commandLine: `"C:\\Program Files\\nodejs\\node.exe" "C:\\installed path\\fixed.mjs" serve --expected-head ${options.expectedHead} --expected-dist-fingerprint ${options.expectedDistFingerprint} --operator-approved` };
  const witness = { schemaVersion: 'stephanos.frontend-listener.v1', owners: [row] };
  assert.equal(isExactFrontendListenerV1(witness, options), true);
  assert.equal(isExactFrontendListenerV1({ ...witness, owners: [{ ...row, commandLine: row.commandLine + ' arbitrary' }] }, options), false);
  assert.equal(isExactFrontendListenerV1({ ...witness, owners: [{ ...row, executablePath: 'C:\\foreign.exe' }] }, options), false);
  assert.equal(isExactFrontendListenerV1({ ...witness, owners: [row, row] }, options), false);
});

test('repository fsmonitor cannot execute a helper during read-only validation', t => {
  const f = fixture(t), marker = join(f.root, 'helper-executed');
  const helper = join(f.root, '.git', 'fsmonitor-fixture');
  const shellMarker = marker.replace(/\\/g, '/').replace(/'/g, "'\\''");
  writeFileSync(helper, `#!/bin/sh\nprintf executed > '${shellMarker}'\nprintf 'fixture-token\\0'\n`);
  chmodSync(helper, 0o755);
  f.git('config', 'core.fsmonitor', `"${helper.replace(/\\/g, '/')}"`);
  const snapshot = collectFrontendVisibilitySnapshotV1(f);
  assert.equal(snapshot.files.get('main.js').toString(), 'globalThis.fixture=true;');
  assert.equal(existsSync(marker), false, 'the fixed Git read boundary must not execute repository-controlled helpers');
});

test('blob replacement refs cannot substitute launcher bytes at the pinned head', t => {
  const f = fixture(t);
  const original = f.git('rev-parse', `${f.expectedHead}:main.js`);
  const replacementFile = join(f.root, '.git', 'replacement-fixture.js');
  writeFileSync(replacementFile, 'globalThis.substituted=true;');
  const replacement = f.git('hash-object', '-w', replacementFile);
  f.git('replace', original, replacement);
  const snapshot = collectFrontendVisibilitySnapshotV1(f);
  assert.equal(snapshot.files.get('main.js').toString(), 'globalThis.fixture=true;');
  assert.equal(f.git('rev-parse', 'HEAD'), f.expectedHead);
});

test('tree replacement refs cannot alter the authenticated commit/tree/blob chain', t => {
  const f = fixture(t);
  const originalTree = f.git('rev-parse', `${f.expectedHead}^{tree}`);
  writeFileSync(join(f.root, 'main.js'), 'globalThis.substitutedTree=true;');
  f.git('add', 'main.js');
  const replacementTree = f.git('write-tree');
  f.git('reset', '--mixed', f.expectedHead);
  f.git('checkout', '--', 'main.js');
  f.git('replace', originalTree, replacementTree);
  const snapshot = collectFrontendVisibilitySnapshotV1(f);
  assert.equal(snapshot.files.get('main.js').toString(), 'globalThis.fixture=true;');
});
