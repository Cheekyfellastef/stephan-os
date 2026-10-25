import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CANONICAL_MAILBOX_ISSUE } from './canonicalMailboxAuthorityV1.mjs';
import {
  FRONTEND_VISIBILITY_EXECUTION_FILES, FRONTEND_VISIBILITY_OBSERVE_OPERATION,
  FRONTEND_VISIBILITY_START_OPERATION, FRONTEND_VISIBILITY_RESULT_SCHEMA,
  FRONTEND_VISIBILITY_SOURCE_IDS, FRONTEND_VISIBILITY_SOURCE_BLOCKERS,
  executeFrontendVisibilityOnBattleBridge, projectFrontendVisibilityReceiptV1,
  validateFrontendVisibilityCommandShape, verifyFrontendExecutionSourceV1,
} from './sovereignFrontendVisibilityMailboxV1.mjs';

const HEAD = 'a'.repeat(40), BUILD = 'b'.repeat(40), DIST = 'c'.repeat(64), SERVED = 'd'.repeat(64);
function command(starting = false, extra = {}) {
  return { schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'frontend-visibility-fixture-01', repository: 'Cheekyfellastef/stephan-os',
    issueNumber: CANONICAL_MAILBOX_ISSUE, branch: 'main', operatorApproval: 'operator-approved',
    expectedHead: HEAD, expiresAt: '2099-01-01T00:00:00.000Z',
    operation: starting ? FRONTEND_VISIBILITY_START_OPERATION : FRONTEND_VISIBILITY_OBSERVE_OPERATION,
    ...(starting ? { expectedDistFingerprint: DIST } : {}), ...extra };
}
function child(starting = false, extra = {}) {
  return { schemaVersion: 'stephanos.frontend-start-only.v1', service: 'stephanos-dist-server', ok: true,
    mode: 'visibility-only', installedHead: HEAD, existingBuildHead: BUILD,
    approvedDistFingerprint: DIST, servedFingerprint: SERVED,
    frontendAvailable: starting, action: starting ? 'started' : 'validated-not-started',
    controlsEnabled: false, externalConnectionsEnabled: false, custodyReleased: false,
    listenerObserved: true, listenerOwnerCount: starting ? 1 : 0,
    exactVisibilityProfile: starting, pageHttpVerified: starting, ...extra };
}
const execute = (input, output) => executeFrontendVisibilityOnBattleBridge(input, {
  runFixedFrontendVisibilityFn: async () => output,
});

test('finite envelope refuses other authority, approval, shell fields and non-string exact identities before running', async () => {
  for (const patch of [
    { repository: 'other/repository' }, { issueNumber: CANONICAL_MAILBOX_ISSUE - 1 },
    { branch: 'repair' }, { operatorApproval: false }, { operatorApproval: 'approved' },
    { requestId: ['frontend-visibility-fixture-01'] }, { requestId: 'bad' },
    { expiresAt: ['2099-01-01T00:00:00.000Z'] }, { expiresAt: 'invalid' },
    { expectedHead: 'main' }, { expectedHead: [HEAD] }, { expectedDistFingerprint: [DIST] },
    { expectedDistFingerprint: 'bad' }, { command: 'anything' }, { args: ['--kill'] },
    { cwd: '/private' }, { environment: { NODE_OPTIONS: '--require private' } },
  ]) {
    let called = false;
    const result = await executeFrontendVisibilityOnBattleBridge(command(true, patch), {
      runFixedFrontendVisibilityFn: async () => { called = true; return child(true); },
    });
    assert.equal(result.ok, false, JSON.stringify(patch)); assert.equal(called, false);
  }
  assert.equal(validateFrontendVisibilityCommandShape(command(false, { expectedDistFingerprint: DIST })).ok, false);
  assert.equal(validateFrontendVisibilityCommandShape(command(true)).ok, true);
  assert.equal(validateFrontendVisibilityCommandShape(command(false)).ok, true);
});

test('observe reports validated identity and native listener evidence without claiming a running frontend', async () => {
  const result = await execute(command(), child(false, { listenerOwnerCount: 1, exactVisibilityProfile: true }));
  assert.equal(result.ok, true); assert.equal(result.sourceHead, HEAD);
  assert.equal(result.frontendVisibility.installedHead, HEAD);
  assert.equal(result.frontendVisibility.existingBuildHead, BUILD);
  assert.equal(result.frontendVisibility.approvedDistFingerprint, DIST);
  assert.equal(result.frontendVisibility.frontendAvailable, null);
  assert.equal(result.frontendVisibility.startupValidated, true);
  assert.equal(result.frontendVisibility.pageHttpVerified, false);
  assert.equal(result.frontendVisibility.browserVerified, false);
});

test('start requires matching source and approved dist plus exclusive native listener and page receipts', async () => {
  for (const patch of [
    { installedHead: BUILD }, { approvedDistFingerprint: 'e'.repeat(64) },
    { existingBuildHead: [BUILD] }, { servedFingerprint: [SERVED] },
    { frontendAvailable: false }, { listenerObserved: false }, { listenerOwnerCount: 0 },
    { listenerOwnerCount: 2 }, { exactVisibilityProfile: false }, { pageHttpVerified: false },
  ]) assert.equal((await execute(command(true), child(true, patch))).ok, false, JSON.stringify(patch));
  for (const flag of ['controlsEnabled', 'externalConnectionsEnabled', 'custodyReleased']) {
    for (const value of [true, undefined, 'false']) {
      assert.equal((await execute(command(true), child(true, { [flag]: value }))).ok, false, `${flag}:${value}`);
    }
  }
  const started = await execute(command(true), child(true));
  const repeated = await execute(command(true), child(true, { action: 'already-running' }));
  assert.equal(started.ok, true); assert.equal(repeated.ok, true);
  assert.equal(repeated.frontendVisibility.action, 'already-running');
  assert.equal(repeated.requestId, started.requestId);
  assert.equal(repeated.frontendVisibility.servedFingerprint, started.frontendVisibility.servedFingerprint);
});

test('unknown child output and private errors fail closed; known private metadata never reaches the public projection', async () => {
  const privateText = 'C:\\private\\fixture ghp_privatefixture123456';
  for (const extra of [{ stdout: privateText }, { pid: 123 }, { arbitraryShellAllowed: true },
    { blocker: privateText, ok: false }, { schemaVersion: privateText }]) {
    const result = await execute(command(true), child(true, extra));
    assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes(privateText), false);
  }
  const failed = await executeFrontendVisibilityOnBattleBridge(command(), {
    runFixedFrontendVisibilityFn: async () => { throw new Error(privateText); },
  });
  assert.equal(failed.blocker, 'FRONTEND_MAILBOX_EXECUTION_UNPROVEN');
  const result = await execute(command(), child(false, { runtimeMarker: privateText,
    buildTimestamp: privateText, launcherCriticalSourceTruth: [{ path: privateText, contents: privateText }] }));
  assert.equal(result.ok, true); assert.equal(JSON.stringify(result).includes(privateText), false);
  assert.equal(JSON.stringify(result).includes('runtimeMarker'), false);
});

test('public projection rejects coerced identities and contradictory observation or enabled controls', async () => {
  const valid = (await execute(command(), child())).frontendVisibility;
  assert.equal(valid.schemaVersion, FRONTEND_VISIBILITY_RESULT_SCHEMA);
  for (const patch of [
    ...['installedHead', 'existingBuildHead', 'approvedDistFingerprint', 'servedFingerprint']
      .map(field => ({ [field]: [valid[field]] })),
    { exactVisibilityProfile: true, listenerOwnerCount: 0 },
    { exactVisibilityProfile: true, listenerOwnerCount: 2 },
    { frontendAvailable: true }, { pageHttpVerified: true }, { browserVerified: true },
    { controlsEnabled: true }, { externalConnectionsEnabled: true },
    { custodyReleased: true }, { sourceLeaseReleased: true },
  ]) assert.equal(projectFrontendVisibilityReceiptV1({ ...valid, ...patch }, command().operation).frontendVisibility, null);
  const safe = projectFrontendVisibilityReceiptV1({ ...valid, rawPath: '/private', stdout: 'private' }, command().operation);
  assert.equal(JSON.stringify(safe).includes('private'), false);
  assert.equal(projectFrontendVisibilityReceiptV1({ frontendVisibility: valid, expectedHead: BUILD }, command().operation).frontendVisibility, null);
  assert.equal(projectFrontendVisibilityReceiptV1({ frontendVisibility: valid, expectedDistFingerprint: 'e'.repeat(64) }, command().operation).frontendVisibility, null);
});

function sourceFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'frontend-mailbox-source-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000, shell: false });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid'); git('config', 'core.autocrlf', 'false');
  for (const path of FRONTEND_VISIBILITY_EXECUTION_FILES) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `// authenticated fixture ${path}\n`);
  }
  git('add', '.'); git('commit', '-m', 'source fixture');
  return { root, git, expectedHead: git('rev-parse', 'HEAD'), platform: process.platform };
}

test('source admission authenticates exact HEAD tree and script bytes while leaving held maintenance and unrelated data untouched', t => {
  const f = sourceFixture(t), held = join(f.root, 'memory/maintenance-custody.json');
  mkdirSync(dirname(held), { recursive: true });
  writeFileSync(held, JSON.stringify({ phase: 'HELD', repairOwner: 'existing-owner', leaseReleased: false }));
  const before = readFileSync(held);
  assert.equal(verifyFrontendExecutionSourceV1(f).sourceHead, f.expectedHead);
  assert.deepEqual(readFileSync(held), before);
  assert.throws(() => verifyFrontendExecutionSourceV1({ ...f, expectedHead: HEAD }), /INSTALLED_HEAD_CHANGED/);
  f.git('checkout', '-b', 'other');
  assert.throws(() => verifyFrontendExecutionSourceV1(f), /CANONICAL_MAIN_REQUIRED/);
});

test('source admission rejects hidden source flags and CRLF bytes even when Git reports a clean text checkout', t => {
  const f = sourceFixture(t), file = FRONTEND_VISIBILITY_EXECUTION_FILES[0], path = join(f.root, file);
  const original = readFileSync(path);
  f.git('update-index', '--assume-unchanged', file); writeFileSync(path, '// unauthorized\n');
  assert.throws(() => verifyFrontendExecutionSourceV1(f), /SOURCE_INDEX_UNSAFE/);
  f.git('update-index', '--no-assume-unchanged', file); f.git('checkout', '--', file);
  f.git('update-index', '--skip-worktree', file);
  assert.throws(() => verifyFrontendExecutionSourceV1(f), /SOURCE_INDEX_UNSAFE/);
  f.git('update-index', '--no-skip-worktree', file);
  f.git('config', 'core.autocrlf', 'true'); rmSync(path); f.git('checkout', '--', file);
  assert.equal(readFileSync(path).includes(Buffer.from('\r\n')), true);
  assert.equal(f.git('status', '--porcelain', '--', file), '');
  assert.throws(() => verifyFrontendExecutionSourceV1(f), /SOURCE_BYTES_CHANGED/);
  writeFileSync(path, original);
  assert.equal(verifyFrontendExecutionSourceV1(f).ok, true);
});

test('source object authentication ignores replacement refs and never executes configured fsmonitor helpers', t => {
  const f = sourceFixture(t), file = FRONTEND_VISIBILITY_EXECUTION_FILES[0];
  const marker = join(f.root, 'helper-executed'), helper = join(f.root, '.git/fsmonitor-test');
  const shellMarker = marker.replace(/\\/g, '/').replace(/'/g, "'\\''");
  writeFileSync(helper, `#!/bin/sh\ntouch '${shellMarker}'\n`); chmodSync(helper, 0o755);
  const originalOid = f.git('rev-parse', `${f.expectedHead}:${file}`);
  const replacementPath = join(f.root, '.git/replacement'); writeFileSync(replacementPath, '// substitute\n');
  const replacement = f.git('hash-object', '-w', replacementPath);
  f.git('replace', originalOid, replacement);
  f.git('config', 'core.fsmonitor', helper);
  assert.equal(verifyFrontendExecutionSourceV1(f).ok, true);
  assert.equal(existsSync(marker), false);
  writeFileSync(join(f.root, file), '// substitute\n');
  assert.throws(() => verifyFrontendExecutionSourceV1(f), /SOURCE_BYTES_CHANGED/);
  assert.equal(existsSync(marker), false);
});

test('a normal Git fast-forward must change all fixed shared blobs to materialize legacy clean CRLF bytes', t => {
  const f = sourceFixture(t);
  const scripts = FRONTEND_VISIBILITY_EXECUTION_FILES.filter(path => path.startsWith('scripts/'));
  const shared = FRONTEND_VISIBILITY_EXECUTION_FILES.filter(path => path.startsWith('shared/'));
  const original = new Map(FRONTEND_VISIBILITY_EXECUTION_FILES.map(path => [path, readFileSync(join(f.root, path))]));
  const explicitPins = paths => paths.map(path => `${path} text eol=lf\n`).join('');
  const productionAttributes = readFileSync(new URL('../../.gitattributes', import.meta.url), 'utf8');
  for (const path of FRONTEND_VISIBILITY_EXECUTION_FILES) assert.ok(productionAttributes.split(/\r?\n/).includes(`${path} text eol=lf`), path);
  const deployment = mkdtempSync(join(tmpdir(), 'frontend-mailbox-deployment-'));
  t.after(() => rmSync(deployment, { recursive: true, force: true }));
  f.git('clone', '--config', 'core.autocrlf=true', '--no-hardlinks', '--branch', 'main', f.root, deployment);
  const deployedGit = (...args) => {
    const result = spawnSync('git', args, { cwd: deployment, encoding: 'utf8', timeout: 10000, shell: false });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  const advance = () => { deployedGit('fetch', 'origin', 'main'); deployedGit('merge', '--ff-only', 'FETCH_HEAD'); };
  const deployedBytes = path => readFileSync(join(deployment, path));
  const containsCrlf = path => deployedBytes(path).includes(Buffer.from('\r\n'));
  assert.equal(deployedGit('status', '--porcelain'), '');
  for (const path of FRONTEND_VISIBILITY_EXECUTION_FILES) assert.equal(containsCrlf(path), true);

  // The attributes arrive after this checkout's clean CRLF files already exist.
  writeFileSync(join(f.root, '.gitattributes'), 'shared/**/*.mjs text eol=lf\n');
  f.git('add', '--', '.gitattributes'); f.git('commit', '-m', 'existing shared LF attributes'); advance();
  assert.equal(deployedGit('status', '--porcelain'), '');
  for (const path of shared) assert.equal(containsCrlf(path), true);
  writeFileSync(join(f.root, '.gitattributes'), 'shared/**/*.mjs text eol=lf\n' + explicitPins(scripts));
  for (const path of scripts) writeFileSync(join(f.root, path), Buffer.concat([original.get(path), Buffer.from('// reviewed four-script update\n')]));
  f.git('add', '--', '.gitattributes', ...scripts); f.git('commit', '-m', 'pin and materialize four scripts'); advance();
  assert.equal(deployedGit('status', '--porcelain'), '');
  for (const path of scripts) assert.equal(containsCrlf(path), false);
  for (const path of shared) assert.equal(containsCrlf(path), true);
  assert.throws(() => verifyFrontendExecutionSourceV1({ root: deployment, expectedHead: deployedGit('rev-parse', 'HEAD') }),
    { message: 'FRONTEND_MAILBOX_SOURCE_BYTES_CHANGED_LOCAL_URLS_CRLF_ONLY' });

  writeFileSync(join(f.root, '.gitattributes'), 'shared/**/*.mjs text eol=lf\n' + explicitPins(FRONTEND_VISIBILITY_EXECUTION_FILES));
  for (const path of shared) writeFileSync(join(f.root, path), Buffer.concat([original.get(path), Buffer.from('// Fixed frontend source admission requires canonical LF deployment bytes.\n')]));
  f.git('add', '--', '.gitattributes', ...shared); f.git('commit', '-m', 'materialize all fixed shared dependencies'); advance();
  assert.equal(deployedGit('status', '--porcelain'), '');
  for (const path of FRONTEND_VISIBILITY_EXECUTION_FILES) assert.equal(containsCrlf(path), false);
  assert.equal(verifyFrontendExecutionSourceV1({ root: deployment, expectedHead: deployedGit('rev-parse', 'HEAD') }).ok, true);

  const localFile = shared[0], localEdit = Buffer.concat([deployedBytes(localFile), Buffer.from('// operator local edit\n')]);
  writeFileSync(join(deployment, localFile), localEdit);
  writeFileSync(join(f.root, localFile), Buffer.concat([readFileSync(join(f.root, localFile)), Buffer.from('// later reviewed source\n')]));
  f.git('add', '--', localFile); f.git('commit', '-m', 'later source update'); deployedGit('fetch', 'origin', 'main');
  const refused = spawnSync('git', ['merge', '--ff-only', 'FETCH_HEAD'], { cwd: deployment, encoding: 'utf8', timeout: 10000, shell: false });
  assert.notEqual(refused.status, 0);
  assert.deepEqual(deployedBytes(localFile), localEdit, 'normal deployment must still preserve real local edits');
});

test('source refusal identifies each fixed dependency and still blocks CRLF, content and identity differences', t => {
  const f = sourceFixture(t);
  for (const [path, id] of Object.entries(FRONTEND_VISIBILITY_SOURCE_IDS)) {
    const original = readFileSync(join(f.root, path));
    writeFileSync(join(f.root, path), original.toString().replace(/\n/g, '\r\n'));
    assert.throws(() => verifyFrontendExecutionSourceV1(f), { message: `FRONTEND_MAILBOX_SOURCE_BYTES_CHANGED_${id}_CRLF_ONLY` });
    writeFileSync(join(f.root, path), original);
  }
  const path = join(f.root, FRONTEND_VISIBILITY_EXECUTION_FILES[0]), original = readFileSync(path);
  for (const content of [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), original]),
    Buffer.concat([original, Buffer.from([0xff])]), Buffer.from(original.toString().replace(/\n/g, '\r'))]) {
    writeFileSync(path, content);
    assert.throws(() => verifyFrontendExecutionSourceV1(f), { message: 'FRONTEND_MAILBOX_SOURCE_BYTES_CHANGED_STARTER_CONTENT' });
  }
  rmSync(path);
  assert.throws(() => verifyFrontendExecutionSourceV1(f), { message: 'FRONTEND_MAILBOX_SOURCE_BYTES_CHANGED_STARTER_IDENTITY' });
  mkdirSync(path);
  assert.throws(() => verifyFrontendExecutionSourceV1(f), { message: 'FRONTEND_MAILBOX_SOURCE_BYTES_CHANGED_STARTER_IDENTITY' });
  rmSync(path, { recursive: true }); writeFileSync(path, Buffer.alloc(1024 * 1024 + 1));
  assert.throws(() => verifyFrontendExecutionSourceV1(f), { message: 'FRONTEND_MAILBOX_SOURCE_BYTES_CHANGED_STARTER_IDENTITY' });
  writeFileSync(path, original);
  assert.equal(verifyFrontendExecutionSourceV1(f).ok, true);
});

test('CRLF-only classification cannot hide invalid UTF-8 behind replacement-character decoding', t => {
  const f = sourceFixture(t), file = FRONTEND_VISIBILITY_EXECUTION_FILES[0], path = join(f.root, file);
  writeFileSync(path, '// encoding \uFFFD\n');
  f.git('add', '--', file); f.git('commit', '-m', 'authenticated replacement character');
  f.expectedHead = f.git('rev-parse', 'HEAD');
  writeFileSync(path, Buffer.concat([Buffer.from('// encoding '), Buffer.from([0xff, 13, 10])]));
  assert.throws(() => verifyFrontendExecutionSourceV1(f), { message: 'FRONTEND_MAILBOX_SOURCE_BYTES_CHANGED_STARTER_CONTENT' });
});

test('only the fixed source-ID and reason cross-product escapes the execution error boundary', async () => {
  assert.equal(FRONTEND_VISIBILITY_SOURCE_BLOCKERS.length, 27);
  assert.equal(new Set(FRONTEND_VISIBILITY_SOURCE_BLOCKERS).size, 27);
  for (const blocker of FRONTEND_VISIBILITY_SOURCE_BLOCKERS) {
    const result = await executeFrontendVisibilityOnBattleBridge(command(), {
      runFixedFrontendVisibilityFn: async () => { throw new Error(blocker); },
    });
    assert.equal(result.ok, false); assert.equal(result.blocker, blocker);
    assert.equal(result.custodyReleased, false); assert.equal(result.arbitraryShellAllowed, false);
  }
  for (const blocker of [
    'FRONTEND_MAILBOX_SOURCE_BYTES_CHANGED_UNKNOWN_CONTENT',
    'FRONTEND_MAILBOX_SOURCE_BYTES_CHANGED_STARTER_ACCEPTED',
    'FRONTEND_MAILBOX_SOURCE_BYTES_CHANGED_STARTER_CONTENT C:\\private\\fixture',
    'FRONTEND_MAILBOX_SOURCE_BYTES_CHANGED_scripts/sovereign-frontend-start-only.mjs_CONTENT',
    'ghp_privatefixture123456',
  ]) {
    const result = await executeFrontendVisibilityOnBattleBridge(command(), {
      runFixedFrontendVisibilityFn: async () => { throw new Error(blocker); },
    });
    assert.equal(result.blocker, 'FRONTEND_MAILBOX_EXECUTION_UNPROVEN');
    assert.equal(JSON.stringify(result).includes(blocker), false);
  }
});
