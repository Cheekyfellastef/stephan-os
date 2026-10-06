import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateSourceArtifactEscrowV1 } from '../../shared/agents/sourceArtifactEscrowContinuityV1.mjs';
import {
  SOURCE_ARTIFACT_COMPLETE_FILE_BUNDLE_V1_SCHEMA,
  finalizeSourceArtifactEscrowFromWorktreeV1,
  persistOfflinePublicationOutboxV1,
  persistSourceArtifactEscrowV1,
} from './sourceArtifactEscrowStore.js';

const NOW = '2026-09-11T08:30:00.000Z';
const TEST_COMMAND = 'node --test shared/agents/example.test.mjs';
const CONTENT = Buffer.from('export const example = 1;\n', 'utf8');
const SHA256 = createHash('sha256').update(CONTENT).digest('hex');
const BLOB_SHA = createHash('sha1').update(Buffer.from(`blob ${CONTENT.length}\0`, 'utf8')).update(CONTENT).digest('hex');

function input(overrides = {}) {
  const changed = {
    path: 'shared/agents/example.mjs',
    beforeBlobSha: '1'.repeat(40),
    afterBlobSha: BLOB_SHA,
    sha256: SHA256,
  };
  return {
    missionId: 'critical-1567-elastic-goal',
    actionId: 'agent-critical-1567-source-1',
    repository: 'Cheekyfellastef/stephan-os',
    canonicalIssue: 1567,
    canonicalPr: null,
    canonicalBranch: 'openclaw/elastic-goal-1567',
    exactParentHead: 'a'.repeat(40),
    exactParentTree: 'b'.repeat(40),
    exactResultTree: 'c'.repeat(40),
    executorIdentity: 'mission-worker:codex:run-1567',
    changedFiles: [changed],
    artifactFiles: [{ ...changed, mode: '100644', deleted: false, contentBase64: CONTENT.toString('base64') }],
    requiredTests: [TEST_COMMAND],
    evidenceReceipts: [{
      receiptId: 'codex-test-example',
      requirement: 'source deterministic test',
      testCommand: TEST_COMMAND,
      source: 'codex-cli',
      evidenceType: 'source-test-command',
      verified: true,
      commandOutputHash: 'd'.repeat(64),
      createdAt: NOW,
    }],
    completedAt: NOW,
    commitMessage: 'Persist tested pre-PR source work',
    ...overrides,
  };
}

async function roots() {
  const parent = await mkdtemp(join(tmpdir(), 'source-artifact-store-'));
  const repoRoot = join(parent, 'repo');
  const sharedWorkspaceRoot = join(parent, 'shared-workspace');
  await mkdir(repoRoot, { recursive: true });
  await mkdir(sharedWorkspaceRoot, { recursive: true });
  return { repoRoot, sharedWorkspaceRoot };
}

test('persists a content-addressed externally-readable pre-PR complete-file bundle', async () => {
  const options = await roots();
  const escrow = await persistSourceArtifactEscrowV1(input(), options);
  assert.ok(escrow);
  assert.equal(escrow.canonicalIssue, 1567);
  assert.equal(escrow.canonicalPr, null);
  assert.equal(escrow.externallyReadable, true);
  assert.equal(validateSourceArtifactEscrowV1(escrow, NOW).valid, true);

  const artifactName = escrow.artifactRef.split('/').at(-1);
  const bytes = await readFile(join(options.sharedWorkspaceRoot, 'source-artifacts', artifactName));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), escrow.completeArtifactSha256);
  const bundle = JSON.parse(bytes.toString('utf8'));
  assert.equal(bundle.schemaVersion, SOURCE_ARTIFACT_COMPLETE_FILE_BUNDLE_V1_SCHEMA);
  assert.equal(bundle.missionId, 'critical-1567-elastic-goal');
  assert.equal(bundle.actionId, 'agent-critical-1567-source-1');
  assert.equal(bundle.changedFiles[0].contentBase64, CONTENT.toString('base64'));
  assert.deepEqual(bundle.testsRun, [TEST_COMMAND]);
});

test('queues a proven source artifact for later governed publication without adding push or merge authority', async () => {
  const options = await roots();
  const escrow = await persistSourceArtifactEscrowV1(input(), options);
  const outbox = await persistOfflinePublicationOutboxV1(escrow, options);
  assert.ok(outbox);
  assert.equal(outbox.state, 'PENDING_PUBLICATION');
  assert.equal(outbox.completeArtifactSha256, escrow.completeArtifactSha256);
  assert.equal(outbox.artifactRef, escrow.artifactRef);
  assert.equal(outbox.preserveVerifiedArtifact, true);
  assert.equal(outbox.rebuildRequired, false);
  assert.equal(outbox.pushAuthority, false);
  assert.equal(outbox.mergeAuthority, false);
  const persisted = JSON.parse(await readFile(outbox.path, 'utf8'));
  assert.equal(persisted.outboxId, outbox.outboxId);
  assert.equal(persisted.finalVerdict, 'OFFLINE_PUBLICATION_ARTIFACT_QUEUED');
});

test('refuses escrow when an exact required test command is not grounded', async () => {
  const options = await roots();
  const result = await persistSourceArtifactEscrowV1(input({
    evidenceReceipts: [{
      receiptId: 'wrong-test', requirement: 'source deterministic test', testCommand: 'node --test some-other.test.mjs',
      source: 'codex-cli', evidenceType: 'source-test-command', verified: true, commandOutputHash: 'e'.repeat(64), createdAt: NOW,
    }],
  }), options);
  assert.equal(result, null);
});

test('refuses escrow when complete-file bytes do not match the claimed Git blob identity', async () => {
  const options = await roots();
  const altered = Buffer.from('export const example = 2;\n', 'utf8');
  const base = input();
  const result = await persistSourceArtifactEscrowV1({
    ...base,
    artifactFiles: [{ ...base.artifactFiles[0], contentBase64: altered.toString('base64') }],
  }, options);
  assert.equal(result, null);
});

test('source escrow reuses the Mission Worker bounded runner instead of owning child-process execution', async () => {
  const storeSource = await readFile(new URL('./sourceArtifactEscrowStore.js', import.meta.url), 'utf8');
  const workerSource = await readFile(new URL('../../scripts/mission-orchestrator-worker.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(storeSource, /node:child_process|spawnSync|function defaultRun/);
  assert.match(storeSource, /const run = options\.runCommand;/);
  assert.match(storeSource, /SOURCE_ARTIFACT_BOUNDED_RUNNER_REQUIRED/);
  assert.match(workerSource, /runCommand: options\.runCommand \|\| defaultRun,/);
});


test('rejects expired escrow using the current publication clock', async () => {
  const options = await roots();
  const escrow = await persistSourceArtifactEscrowV1(input(), options);
  assert.ok(escrow);
  const outbox = await persistOfflinePublicationOutboxV1(escrow, {
    ...options,
    now: new Date('2026-11-30T00:00:00.000Z'),
  });
  assert.equal(outbox, null);
});

test('preserves invalid UTF-8 staged blob bytes exactly in source escrow', async () => {
  const options = await roots();
  const binaryPath = join(options.repoRoot, 'shared', 'agents', 'binary.bin');
  await mkdir(join(options.repoRoot, 'shared', 'agents'), { recursive: true });
  await writeFile(binaryPath, Buffer.from([0x00, 0x01, 0x02, 0x03]));

  const runCommand = (executable, args, runOptions = {}) => spawnSync(
    executable === 'git.exe' && process.platform !== 'win32' ? 'git' : executable,
    args,
    {
      cwd: runOptions.cwd,
      env: runOptions.env || process.env,
      encoding: Object.hasOwn(runOptions, 'encoding') ? runOptions.encoding : 'utf8',
      shell: false,
      windowsHide: true,
    },
  );
  for (const args of [
    ['-C', options.repoRoot, 'init'],
    ['-C', options.repoRoot, 'config', 'user.email', 'offline-test@example.invalid'],
    ['-C', options.repoRoot, 'config', 'user.name', 'Offline Test'],
    ['-C', options.repoRoot, 'add', '.'],
    ['-C', options.repoRoot, 'commit', '-m', 'baseline'],
  ]) {
    const result = runCommand('git.exe', args, { cwd: options.repoRoot });
    assert.equal(result.status, 0, String(result.stderr || result.stdout || ''));
  }

  const binary = Buffer.from([0xff, 0xfe, 0x00, 0x80, 0xc3, 0x28]);
  await writeFile(binaryPath, binary);
  const completedAt = '2026-09-28T17:30:00.000Z';
  const execution = {
    success: true,
    resultId: 'binary-run-1',
    changedFiles: ['shared/agents/binary.bin'],
    completedAt,
    sourceTestReceipts: [{
      receiptId: 'binary-test',
      requirement: 'source deterministic test',
      testCommand: TEST_COMMAND,
      source: 'test',
      evidenceType: 'source-test-command',
      verified: true,
      commandOutputHash: 'f'.repeat(64),
      createdAt: completedAt,
    }],
  };
  const finalized = await finalizeSourceArtifactEscrowFromWorktreeV1({
    missionId: 'binary-mission',
    actionId: 'binary-action',
    adapter: 'stephanos-native',
    repository: 'Cheekyfellastef/stephan-os',
    branch: 'feat/binary-test',
    worktreePath: options.repoRoot,
    requiredTests: [TEST_COMMAND],
  }, execution, {
    processingPath: join(options.repoRoot, '..', 'binary-claim.json'),
  }, {
    ...options,
    runCommand,
    actionGrant: { issueNumber: 2494, prNumber: null },
    persistOfflinePublicationOutbox: async () => ({ outboxId: 'binary-test-outbox' }),
  });

  assert.equal(finalized.testsPassed, true);
  const artifactName = finalized.sourceArtifactEscrow.artifactRef.split('/').at(-1);
  const bundle = JSON.parse(await readFile(join(options.sharedWorkspaceRoot, 'source-artifacts', artifactName), 'utf8'));
  assert.deepEqual(
    Buffer.from(bundle.changedFiles[0].contentBase64, 'base64'),
    binary,
  );
});
