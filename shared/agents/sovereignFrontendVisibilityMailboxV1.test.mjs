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
