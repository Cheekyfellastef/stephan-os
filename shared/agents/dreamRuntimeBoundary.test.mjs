import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DREAM_EVENT_SET_RELATIONS,
  DREAM_RUNTIME_MIGRATION_APPROVAL,
  DREAM_VERSIONED_PRESERVATION_DIRECTORY,
  abortWindowsArtifactStartup,
  classifyDreamEventSets,
  dreamDirectoryHandleNamespace,
  executeDreamRuntimeMigration,
  normalizeDreamHostRelativePath,
  parsePosixPromotionIdentity,
  pathIsInside,
  planDreamRuntimeMigration,
  resolveDreamRuntimeBoundary,
  resolveDreamVersionedPreservationPaths,
  resolveWindowsArtifactCleanupBlocker,
} from './dreamRuntimeBoundary.mjs';

const HEAD = 'a'.repeat(40);

test('Darwin uses the native file-descriptor namespace for handle-bound publication', () => {
  assert.equal(dreamDirectoryHandleNamespace('darwin'), '/dev/fd');
  assert.equal(dreamDirectoryHandleNamespace('linux'), '/proc/self/fd');
  assert.equal(dreamDirectoryHandleNamespace('win32'), '');
});

test('POSIX helper promotion identity is bounded and malformed evidence fails closed', () => {
  const identity = parsePosixPromotionIdentity('PROMOTED:1:2:3:1:4000001');
  assert.equal(identity.dev, 1);
  assert.equal(identity.ino, 2);
  assert.equal(identity.size, 3);
  assert.equal(identity.nlink, 1);
  assert.equal(identity.mtimeMs, 4.000001);
  for (const value of [
    'PROMOTED',
    'PROMOTED:1:2:3:2:4000001',
    'PROMOTED:1:2:3:1:-1',
    'PROMOTED:1:2:3:1:4000001:extra',
    `PROMOTED:1:2:3:1:${'9'.repeat(25)}`,
    `PROMOTED:${Number.MAX_SAFE_INTEGER + 1}:2:3:1:4000001`,
  ]) {
    assert.equal(parsePosixPromotionIdentity(value), null);
  }
});

test('Windows pre-READY failure awaits bounded abort cleanup before process termination', async () => {
  const token = '11111111-1111-4111-8111-111111111111';
  const confirmedEvents = [];
  const confirmed = await abortWindowsArtifactStartup({
    child: {
      stdin: { end: (value) => confirmedEvents.push(`stdin:${value.trim()}`) },
      kill: () => confirmedEvents.push('kill'),
    },
    awaitExit: async () => {
      confirmedEvents.push('await-exit');
      return {
        timedOut: false,
        exit: { code: 0 },
        stdout: `ABORTED:${token}\n`,
        stderr: '',
      };
    },
  }, token);
  assert.equal(confirmed, true);
  assert.deepEqual(confirmedEvents, ['stdin:ABORT', 'await-exit']);

  const timedOutEvents = [];
  const timedOutState = {
    child: {
      stdin: { end: (value) => timedOutEvents.push(`stdin:${value.trim()}`) },
      kill: () => timedOutEvents.push('kill'),
    },
  };
  timedOutState.awaitExit = async () => {
    timedOutEvents.push('await-exit');
    timedOutState.child.kill();
    return { timedOut: true, exit: { code: null }, stdout: '', stderr: '' };
  };
  assert.equal(await abortWindowsArtifactStartup(timedOutState, token), false);
  assert.deepEqual(timedOutEvents, ['stdin:ABORT', 'await-exit', 'kill']);
  assert.equal(resolveWindowsArtifactCleanupBlocker({
    error: { cleanupBlocker: 'DREAM_MIGRATION_WINDOWS_ARTIFACT_CLEANUP_FAILED' },
    publication: null,
    cleaned: false,
    cleanupFailureCode: 'DREAM_MIGRATION_RECEIPT_CLEANUP_FAILED',
  }), 'DREAM_MIGRATION_RECEIPT_CLEANUP_FAILED');
});

function dreamEvent(timestamp, phase, date) {
  return {
    type: 'memory.dream.completed',
    timestamp,
    phase,
    reportPath: `memory/dreaming/${phase}/${date}.md`,
    storageMode: 'workspace',
    lineCount: phase === 'light' ? 2 : 4,
  };
}

function jsonl(records) {
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

const SOURCE_EVENTS = [
  dreamEvent('2026-08-01T02:00:06.909Z', 'light', '2026-08-01'),
  dreamEvent('2026-08-01T02:00:06.909Z', 'rem', '2026-08-01'),
  dreamEvent('2026-08-01T02:00:06.909Z', 'deep', '2026-08-01'),
];

const DESTINATION_EVENTS = [
  dreamEvent('2026-07-29T02:00:02.825Z', 'light', '2026-07-29'),
  dreamEvent('2026-07-29T02:00:02.825Z', 'rem', '2026-07-29'),
  dreamEvent('2026-07-29T02:00:02.825Z', 'deep', '2026-07-29'),
  dreamEvent('2026-07-30T02:00:03.181Z', 'light', '2026-07-30'),
  dreamEvent('2026-07-30T02:00:03.181Z', 'rem', '2026-07-30'),
  dreamEvent('2026-07-30T02:00:03.181Z', 'deep', '2026-07-30'),
];

async function fixture({ sourceEvents = [dreamEvent('2026-07-21T02:00:00.000Z', 'deep', '2026-07-21')] } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-boundary-'));
  const repoRoot = path.join(root, 'repo');
  const workspaceRoot = path.join(root, 'openclaw-workspace');
  const runtimeRoot = path.join(root, 'runtime');
  await fs.mkdir(path.join(repoRoot, 'memory', '.dreams'), { recursive: true });
  await fs.mkdir(path.join(repoRoot, 'memory', 'dreaming', 'deep'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, 'memory', '.dreams', 'events.jsonl'), jsonl(sourceEvents));
  await fs.writeFile(path.join(repoRoot, 'memory', 'dreaming', 'deep', '2026-07-21.md'), '# dream\n');
  return {
    root,
    repoRoot,
    workspaceRoot,
    runtimeRoot,
    sourceEventsPath: path.join(repoRoot, 'memory', '.dreams', 'events.jsonl'),
    destinationEventsPath: path.join(workspaceRoot, 'memory', '.dreams', 'events.jsonl'),
    env: {
      STEPHANOS_OPENCLAW_WORKSPACE: workspaceRoot,
      STEPHANOS_RUNTIME_ROOT: runtimeRoot,
    },
  };
}

async function disjointFixture() {
  const result = await fixture({ sourceEvents: SOURCE_EVENTS });
  await fs.mkdir(path.dirname(result.destinationEventsPath), { recursive: true });
  await fs.writeFile(result.destinationEventsPath, jsonl(DESTINATION_EVENTS));
  return result;
}

async function alreadyVerifiedFixture() {
  const result = await fixture();
  await fs.mkdir(path.dirname(result.destinationEventsPath), { recursive: true });
  await fs.copyFile(result.sourceEventsPath, result.destinationEventsPath);
  const sourceDeepPath = path.join(result.repoRoot, 'memory', 'dreaming', 'deep', '2026-07-21.md');
  const destinationDeepPath = path.join(result.workspaceRoot, 'memory', 'dreaming', 'deep', '2026-07-21.md');
  await fs.mkdir(path.dirname(destinationDeepPath), { recursive: true });
  await fs.copyFile(sourceDeepPath, destinationDeepPath);
  return { ...result, sourceDeepPath, destinationDeepPath };
}

function eventEntry(plan) {
  const entry = plan.entries.find((candidate) => candidate.logicalSourcePath === 'memory/.dreams/events.jsonl');
  assert.ok(entry, 'event entry missing');
  return entry;
}

function fixedNow(value = '2026-08-01T12:30:00.000Z') {
  return () => new Date(value);
}

function fsProxy(overrides = {}) {
  return new Proxy(fs, {
    get(target, property) {
      return Object.hasOwn(overrides, property) ? overrides[property] : target[property];
    },
  });
}

function fsProxyWithOwnedWriteHook(onWrite, overrides = {}) {
  return fsProxy({
    ...overrides,
    open: async (target, flags, mode) => {
      const handle = await fs.open(target, flags, mode);
      return {
        fd: handle.fd,
        writeFile: async (...args) => {
          await handle.writeFile(...args);
          await onWrite(target);
        },
        stat: (...args) => handle.stat(...args),
        close: (...args) => handle.close(...args),
      };
    },
  });
}

async function windowsAncestorIdentityProofForTest(target) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  const segments = path.relative(parsed.root, resolved).split(path.sep).filter(Boolean);
  const ancestors = [parsed.root];
  for (const segment of segments) ancestors.push(path.join(ancestors.at(-1), segment));
  const identities = [];
  for (const ancestor of ancestors) {
    const stat = await fs.lstat(ancestor);
    identities.push(`${BigInt(stat.dev).toString(16).padStart(8, '0')}:${BigInt(stat.ino).toString(16).padStart(16, '0')}`);
  }
  return identities.join(',');
}

function windowsAncestorPathsBase64ForTest(target) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  const segments = path.relative(parsed.root, resolved).split(path.sep).filter(Boolean);
  const ancestors = [parsed.root];
  for (const segment of segments) ancestors.push(path.join(ancestors.at(-1), segment));
  return Buffer.from(JSON.stringify(ancestors), 'utf8').toString('base64');
}

async function runApproved(input, overrides = {}) {
  return executeDreamRuntimeMigration({
    repoRoot: input.repoRoot,
    env: input.env,
    operatorApproval: DREAM_RUNTIME_MIGRATION_APPROVAL,
    sourceHead: HEAD,
    sourceHeadVerifierFn: async () => HEAD,
    now: fixedNow(),
    ...overrides,
  });
}

test('Dream runtime boundary resolves workspace-relative outputs outside Git', async () => {
  const { repoRoot, env, workspaceRoot } = await fixture();
  const boundary = resolveDreamRuntimeBoundary({ repoRoot, env });
  assert.equal(boundary.ok, true);
  assert.equal(boundary.launchContext.cwd, workspaceRoot);
  assert.equal(pathIsInside(repoRoot, boundary.dreamMemoryRoot), false);
  assert.match(boundary.mappings[0].destinationPath, /memory[\\/]\.dreams$/);
  assert.match(boundary.mappings[1].destinationPath, /memory[\\/]dreaming$/);
});

test('boundary fails closed when external workspace points inside repository', async () => {
  const { repoRoot, runtimeRoot } = await fixture();
  const boundary = resolveDreamRuntimeBoundary({
    repoRoot,
    env: {
      STEPHANOS_OPENCLAW_WORKSPACE: path.join(repoRoot, 'runtime'),
      STEPHANOS_RUNTIME_ROOT: runtimeRoot,
    },
  });
  assert.equal(boundary.ok, false);
  assert.equal(boundary.blocker, 'DREAM_RUNTIME_ROOT_INSIDE_REPOSITORY');
});

test('migration plan inventories deterministic copy and hash evidence', async () => {
  const { repoRoot, env } = await fixture();
  const plan = await planDreamRuntimeMigration({ repoRoot, env });
  assert.equal(plan.ok, true);
  assert.equal(plan.copyRequired, 2);
  assert.equal(plan.conflicts, 0);
  assert.equal(plan.entries.every((entry) => /^[0-9a-f]{64}$/.test(entry.sourceSha256)), true);
});

test('copy migration requires explicit approval and never removes source', async () => {
  const input = await fixture();
  const denied = await executeDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  assert.equal(denied.blocker, 'DREAM_MIGRATION_APPROVAL_REQUIRED');

  const result = await runApproved(input, { now: fixedNow('2026-07-21T18:45:00.000Z') });
  assert.equal(result.ok, true, `${result.blocker || ''}:${result.copyFailureReason || ''}:${result.receiptWriteReason || ''}`);
  assert.equal(result.finalVerdict, 'DREAM_RUNTIME_COPY_HASH_VERIFIED');
  assert.equal(result.copied.length, 2);
  assert.equal(result.sourceRemovalPerformed, false);
  assert.equal(await fs.readFile(input.sourceEventsPath, 'utf8'), jsonl([dreamEvent('2026-07-21T02:00:00.000Z', 'deep', '2026-07-21')]));
  assert.equal(await fs.readFile(input.destinationEventsPath, 'utf8'), await fs.readFile(input.sourceEventsPath, 'utf8'));
  assert.match(result.receiptPath, /runtime[\\/]receipts[\\/]runtime-boundary[\\/]dream-migration-/);
});

test('source-head drift after copy-required outputs removes newly owned destinations before receipt', async () => {
  const input = await fixture();
  let reads = 0;
  const result = await runApproved(input, {
    sourceHeadVerifierFn: async () => {
      reads += 1;
      return reads === 1 ? HEAD : 'b'.repeat(40);
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED');
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  for (const entry of plan.entries) {
    await assert.rejects(() => fs.lstat(entry.destinationPath), (error) => error.code === 'ENOENT');
  }
  const receiptFiles = await fs.readdir(plan.receiptRoot).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error));
  assert.deepEqual(receiptFiles.filter((name) => name.startsWith('dream-migration-')), []);
});

test('source-head drift after receipt removes newly owned copy outputs and receipt', async () => {
  const input = await fixture();
  let reads = 0;
  const result = await runApproved(input, {
    sourceHeadVerifierFn: async () => {
      reads += 1;
      return reads < 3 ? HEAD : 'b'.repeat(40);
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED');
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  for (const entry of plan.entries) {
    await assert.rejects(() => fs.lstat(entry.destinationPath), (error) => error.code === 'ENOENT');
  }
  const receiptFiles = await fs.readdir(plan.receiptRoot);
  assert.deepEqual(receiptFiles.filter((name) => name.startsWith('dream-migration-')), []);
});

test('receipt remains non-authoritative through the final source-head verification', async () => {
  const input = await fixture();
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  let reads = 0;
  let finalVerificationObservedPendingOnly = false;
  const result = await runApproved(input, {
    sourceHeadVerifierFn: async () => {
      reads += 1;
      if (reads === 3) {
        const receiptFiles = await fs.readdir(plan.receiptRoot);
        finalVerificationObservedPendingOnly = receiptFiles.some((name) => name.startsWith('.stephanos-pending-'))
          && receiptFiles.every((name) => !name.startsWith('dream-migration-'));
      }
      return HEAD;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(finalVerificationObservedPendingOnly, true);
  const receiptFiles = await fs.readdir(plan.receiptRoot);
  assert.equal(receiptFiles.filter((name) => name.startsWith('dream-migration-')).length, 1);
  assert.equal(receiptFiles.filter((name) => name.startsWith('.stephanos-pending-')).length, 0);
});

test('already-verified destination changes are rejected before receipt publication', async () => {
  const input = await alreadyVerifiedFixture();
  let headReads = 0;
  const result = await runApproved(input, {
    sourceHeadVerifierFn: async () => {
      headReads += 1;
      if (headReads === 1) await fs.appendFile(input.destinationEventsPath, ' ');
      return HEAD;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_MIGRATION_DESTINATION_CHANGED');
  assert.equal(result.failedEntry.logicalSourcePath, 'memory/.dreams/events.jsonl');
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  const receiptFiles = await fs.readdir(plan.receiptRoot).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error));
  assert.deepEqual(receiptFiles.filter((name) => name.startsWith('dream-migration-')), []);
});

test('already-verified source changes are rejected before receipt publication', async () => {
  const input = await alreadyVerifiedFixture();
  let headReads = 0;
  const result = await runApproved(input, {
    sourceHeadVerifierFn: async () => {
      headReads += 1;
      if (headReads === 1) await fs.appendFile(input.sourceEventsPath, ' ');
      return HEAD;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_MIGRATION_SOURCE_CHANGED');
  assert.equal(result.failedEntry.logicalSourcePath, 'memory/.dreams/events.jsonl');
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  const receiptFiles = await fs.readdir(plan.receiptRoot).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error));
  assert.deepEqual(receiptFiles.filter((name) => name.startsWith('dream-migration-')), []);
});

test('already-verified changes during receipt write remove the owned receipt', async () => {
  const input = await alreadyVerifiedFixture();
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  let changed = false;
  let authoritativeReceiptVisibleDuringWrite = null;
  const fsImpl = fsProxyWithOwnedWriteHook(async (target) => {
    if (!changed && path.basename(String(target)).includes('dream-migration-')) {
      changed = true;
      const receiptFiles = await fs.readdir(plan.receiptRoot);
      authoritativeReceiptVisibleDuringWrite = receiptFiles.some((name) => name.startsWith('dream-migration-'));
      await fs.appendFile(input.destinationEventsPath, ' ');
    }
  });
  const result = await runApproved(input, { fsImpl });
  assert.equal(changed, true);
  assert.equal(authoritativeReceiptVisibleDuringWrite, false);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_MIGRATION_DESTINATION_CHANGED');
  assert.equal(result.cleanupBlocker, '');
  const receiptFiles = await fs.readdir(plan.receiptRoot);
  assert.deepEqual(receiptFiles.filter((name) => name.startsWith('dream-migration-')), []);
});

test('owned-artifact cleanup never deletes a concurrent path replacement', async () => {
  const input = await fixture();
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  const deepEntry = plan.entries.find((entry) => entry.logicalSourcePath === 'memory/dreaming/deep/2026-07-21.md');
  assert.ok(deepEntry);
  const savedOwnedCopy = path.join(input.root, 'saved-owned-copy.md');
  let replacementInjected = false;
  const fsImpl = fsProxy({
    rename: async (source, destination) => {
      if (
        !replacementInjected
        && (process.platform !== 'linux' || String(source).startsWith('/proc/self/fd/'))
        && path.basename(String(source)) === path.basename(deepEntry.destinationPath)
        && String(destination).includes('.stephanos-owned-delete-')
      ) {
        replacementInjected = true;
        await fs.rename(source, savedOwnedCopy);
        await fs.writeFile(source, 'concurrent-replacement');
      }
      return fs.rename(source, destination);
    },
  });
  let headReads = 0;
  const result = await runApproved(input, {
    fsImpl,
    sourceHeadVerifierFn: async () => {
      headReads += 1;
      return headReads === 1 ? HEAD : 'b'.repeat(40);
    },
  });
  assert.equal(replacementInjected, true);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED');
  assert.equal(result.cleanupBlocker, 'DREAM_MIGRATION_ARTIFACT_CLEANUP_FAILED');
  assert.equal(await fs.readFile(deepEntry.destinationPath, 'utf8'), 'concurrent-replacement');
  assert.equal(await fs.readFile(savedOwnedCopy, 'utf8'), '# dream\n');
});

test('copy verification failure surfaces an ownership-bound cleanup failure', async () => {
  const input = await fixture();
  let changed = false;
  const fsImpl = fsProxyWithOwnedWriteHook(async (target) => {
    if (!changed && path.basename(String(target)).endsWith(path.basename(input.destinationEventsPath))) {
      changed = true;
      await fs.appendFile(input.sourceEventsPath, ' ');
    }
  }, {
    unlink: async (target, ...args) => {
      if (path.basename(String(target)).startsWith('.stephanos-pending-')) return fs.unlink(target, ...args);
      const error = new Error('blocked cleanup');
      error.code = 'EPERM';
      throw error;
    },
  });
  const result = await runApproved(input, { fsImpl });
  assert.equal(changed, true);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_MIGRATION_HASH_MISMATCH');
  assert.equal(result.cleanupBlocker, 'DREAM_MIGRATION_COPY_CLEANUP_FAILED');
  assert.equal(await fs.readFile(input.destinationEventsPath, 'utf8'), jsonl([dreamEvent('2026-07-21T02:00:00.000Z', 'deep', '2026-07-21')]));
});

test('post-copy verification exception rolls back the copy and prior preservation artifacts', async () => {
  const input = await disjointFixture();
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  const eventsPaths = resolveDreamVersionedPreservationPaths(eventEntry(plan), plan);
  const deepEntry = plan.entries.find((entry) => entry.logicalSourcePath === 'memory/dreaming/deep/2026-07-21.md');
  assert.ok(deepEntry);
  let injected = false;
  const fsImpl = fsProxy({
    readFile: async (target, ...args) => {
      if (!injected && path.resolve(String(target)) === path.resolve(deepEntry.destinationPath)) {
        injected = true;
        const error = new Error('post-copy verification failed');
        error.code = 'EIO';
        throw error;
      }
      return fs.readFile(target, ...args);
    },
  });
  const result = await runApproved(input, { fsImpl });
  assert.equal(injected, true);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_MIGRATION_COPY_VERIFICATION_FAILED');
  assert.equal(result.cleanupBlocker, '');
  await assert.rejects(() => fs.lstat(deepEntry.destinationPath), (error) => error.code === 'ENOENT');
  await assert.rejects(() => fs.lstat(eventsPaths.snapshotPath), (error) => error.code === 'ENOENT');
  await assert.rejects(() => fs.lstat(eventsPaths.manifestPath), (error) => error.code === 'ENOENT');
});

test('later copy blocker rolls back a prior preservation and its own copied output', async () => {
  const input = await disjointFixture();
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  const eventsPaths = resolveDreamVersionedPreservationPaths(eventEntry(plan), plan);
  const deepEntry = plan.entries.find((entry) => entry.logicalSourcePath === 'memory/dreaming/deep/2026-07-21.md');
  assert.ok(deepEntry);
  let changed = false;
  const fsImpl = fsProxyWithOwnedWriteHook(async (target) => {
    if (!changed && path.basename(String(target)).endsWith(path.basename(deepEntry.destinationPath))) {
      changed = true;
      await fs.appendFile(deepEntry.sourcePath, ' ');
    }
  });
  const result = await runApproved(input, { fsImpl });
  assert.equal(changed, true);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_MIGRATION_HASH_MISMATCH');
  assert.equal(result.cleanupBlocker, '');
  await assert.rejects(() => fs.lstat(eventsPaths.snapshotPath), (error) => error.code === 'ENOENT');
  await assert.rejects(() => fs.lstat(eventsPaths.manifestPath), (error) => error.code === 'ENOENT');
  await assert.rejects(() => fs.lstat(deepEntry.destinationPath), (error) => error.code === 'ENOENT');
  const receiptFiles = await fs.readdir(plan.receiptRoot);
  assert.deepEqual(receiptFiles.filter((name) => name.startsWith('dream-migration-')), []);
});

test('later copy preflight exception rolls back prior preservation artifacts', async () => {
  const input = await disjointFixture();
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  const eventsPaths = resolveDreamVersionedPreservationPaths(eventEntry(plan), plan);
  const deepEntry = plan.entries.find((entry) => entry.logicalSourcePath === 'memory/dreaming/deep/2026-07-21.md');
  assert.ok(deepEntry);
  let deepSourceReads = 0;
  const fsImpl = fsProxy({
    readFile: async (target, ...args) => {
      if (path.resolve(String(target)) === path.resolve(deepEntry.sourcePath)) {
        deepSourceReads += 1;
        if (deepSourceReads === 2) {
          const error = new Error('copy preflight failed');
          error.code = 'EIO';
          throw error;
        }
      }
      return fs.readFile(target, ...args);
    },
  });
  const result = await runApproved(input, { fsImpl });
  assert.equal(deepSourceReads, 2);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_MIGRATION_COPY_PREFLIGHT_FAILED');
  assert.equal(result.cleanupBlocker, '');
  await assert.rejects(() => fs.lstat(deepEntry.destinationPath), (error) => error.code === 'ENOENT');
  await assert.rejects(() => fs.lstat(eventsPaths.snapshotPath), (error) => error.code === 'ENOENT');
  await assert.rejects(() => fs.lstat(eventsPaths.manifestPath), (error) => error.code === 'ENOENT');
  const receiptFiles = await fs.readdir(plan.receiptRoot);
  assert.deepEqual(receiptFiles.filter((name) => name.startsWith('dream-migration-')), []);
});

test('event identity contract classifies the investigated files as disjoint', () => {
  const relation = classifyDreamEventSets(jsonl(SOURCE_EVENTS), jsonl(DESTINATION_EVENTS));
  assert.equal(relation.ok, true);
  assert.equal(relation.relation, DREAM_EVENT_SET_RELATIONS.DISJOINT_EVENT_SETS);
  assert.equal(relation.sourceEventCount, 3);
  assert.equal(relation.destinationEventCount, 6);
  assert.equal(relation.overlappingEventCount, 0);
  assert.equal(relation.conflictingDuplicateIdentityCount, 0);
});

test('conflicting duplicate identities take precedence over append-shaped sequences', () => {
  const destinationEvent = dreamEvent('2026-07-30T02:00:03.181Z', 'deep', '2026-07-30');
  const conflictingEvent = { ...destinationEvent, lineCount: destinationEvent.lineCount + 1 };
  const appendedEvent = dreamEvent('2026-08-01T02:00:06.909Z', 'deep', '2026-08-01');
  const relation = classifyDreamEventSets(
    jsonl([conflictingEvent, appendedEvent]),
    jsonl([destinationEvent]),
  );
  assert.equal(relation.ok, true);
  assert.equal(relation.relation, DREAM_EVENT_SET_RELATIONS.CONFLICTING_DUPLICATE_IDENTITIES);
  assert.equal(relation.overlappingEventCount, 1);
  assert.equal(relation.conflictingDuplicateIdentityCount, 1);
});

test('repeated identical event identities are ambiguous rather than append relations', () => {
  const event = dreamEvent('2026-07-30T02:00:03.181Z', 'deep', '2026-07-30');
  const relation = classifyDreamEventSets(jsonl([event, event]), jsonl([event]));
  assert.equal(relation.ok, false);
  assert.equal(relation.relation, DREAM_EVENT_SET_RELATIONS.MALFORMED_OR_AMBIGUOUS);
  assert.equal(relation.blocker, 'DREAM_EVENT_SET_DUPLICATE_IDENTITIES');
});

test('disjoint occupied destination is preserved as a deterministic version without mutating originals', async () => {
  const input = await disjointFixture();
  const sourceBefore = await fs.readFile(input.sourceEventsPath);
  const canonicalBefore = await fs.readFile(input.destinationEventsPath);
  const result = await runApproved(input);
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'DREAM_RUNTIME_COPY_AND_VERSIONED_PRESERVATION_VERIFIED');
  assert.equal(result.preserved.length, 1);
  const preserved = result.preserved[0];
  assert.equal(preserved.state, 'versioned-and-verified');
  assert.equal(preserved.relationClassification, DREAM_EVENT_SET_RELATIONS.DISJOINT_EVENT_SETS);
  assert.equal(
    preserved.versionedSnapshotPath.includes(path.join(DREAM_VERSIONED_PRESERVATION_DIRECTORY, 'v1')),
    true,
  );
  assert.deepEqual(await fs.readFile(input.sourceEventsPath), sourceBefore);
  assert.deepEqual(await fs.readFile(input.destinationEventsPath), canonicalBefore);
  assert.deepEqual(await fs.readFile(preserved.versionedSnapshotPath), sourceBefore);
  const manifest = JSON.parse(await fs.readFile(preserved.preservationManifestPath, 'utf8'));
  assert.equal(manifest.logicalSourcePath, 'memory/.dreams/events.jsonl');
  assert.equal(manifest.sourceHead, HEAD);
  assert.equal(manifest.previousCanonicalDestinationSha256, eventEntry(result.boundary).destinationSha256);
  assert.equal(manifest.canonicalDestinationPreserved, true);
  assert.equal(manifest.sourceRemovalPerformed, false);
  assert.equal(manifest.proofRefs.length, 2);
  assert.equal(
    manifest.proofRefs[1],
    path.relative(result.boundary.dreamMemoryRoot, preserved.versionedSnapshotPath).split(path.sep).join('/'),
  );
  assert.match(manifest.proofRefs[1], /^\.stephanos-preservation\/v1\//);
});

test('idempotent retry returns the same verified snapshot and manifest', async () => {
  const input = await disjointFixture();
  const first = await runApproved(input);
  const second = await runApproved(input, { now: fixedNow('2026-08-01T12:31:00.000Z') });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.preserved[0].state, 'already-versioned-and-verified');
  assert.equal(second.preserved[0].versionedSnapshotPath, first.preserved[0].versionedSnapshotPath);
  assert.equal(second.preserved[0].preservationManifestPath, first.preserved[0].preservationManifestPath);
  const snapshotDirectory = path.dirname(first.preserved[0].versionedSnapshotPath);
  assert.deepEqual((await fs.readdir(snapshotDirectory)).filter((name) => name.endsWith('.snapshot')), [path.basename(first.preserved[0].versionedSnapshotPath)]);
});

test('idempotent snapshot reuse rejects a manifest bound to a different source head', async () => {
  const input = await disjointFixture();
  const first = await runApproved(input);
  assert.equal(first.ok, true);
  const retry = await runApproved(input, {
    sourceHead: 'b'.repeat(40),
    sourceHeadVerifierFn: async () => 'b'.repeat(40),
    now: fixedNow('2026-08-01T12:31:00.000Z'),
  });
  assert.equal(retry.ok, false);
  assert.equal(retry.blocker, 'DREAM_VERSIONED_RECEIPT_CONFLICT');
  const manifest = JSON.parse(await fs.readFile(first.preserved[0].preservationManifestPath, 'utf8'));
  assert.equal(manifest.sourceHead, HEAD);
});

test('source-head drift before manifest publication leaves no success artifact', async () => {
  const input = await disjointFixture();
  let reads = 0;
  const result = await runApproved(input, {
    sourceHeadVerifierFn: async () => {
      reads += 1;
      return reads === 1 ? HEAD : 'b'.repeat(40);
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED');
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  const paths = resolveDreamVersionedPreservationPaths(eventEntry(plan), plan);
  await assert.rejects(() => fs.lstat(paths.snapshotPath), (error) => error.code === 'ENOENT');
  await assert.rejects(() => fs.lstat(paths.manifestPath), (error) => error.code === 'ENOENT');
  const receiptFiles = await fs.readdir(plan.receiptRoot).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error));
  assert.deepEqual(receiptFiles.filter((name) => name.startsWith('dream-migration-')), []);
});

test('source-head drift immediately after manifest write removes owned preservation artifacts', async () => {
  const input = await disjointFixture();
  let reads = 0;
  const result = await runApproved(input, {
    sourceHeadVerifierFn: async () => {
      reads += 1;
      return reads < 3 ? HEAD : 'b'.repeat(40);
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED');
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  const paths = resolveDreamVersionedPreservationPaths(eventEntry(plan), plan);
  await assert.rejects(() => fs.lstat(paths.snapshotPath), (error) => error.code === 'ENOENT');
  await assert.rejects(() => fs.lstat(paths.manifestPath), (error) => error.code === 'ENOENT');
});

test('source-head drift immediately after migration receipt write removes all owned success artifacts', async () => {
  const input = await disjointFixture();
  let reads = 0;
  const result = await runApproved(input, {
    sourceHeadVerifierFn: async () => {
      reads += 1;
      return reads < 5 ? HEAD : 'b'.repeat(40);
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED');
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  const paths = resolveDreamVersionedPreservationPaths(eventEntry(plan), plan);
  await assert.rejects(() => fs.lstat(paths.snapshotPath), (error) => error.code === 'ENOENT');
  await assert.rejects(() => fs.lstat(paths.manifestPath), (error) => error.code === 'ENOENT');
  const receiptFiles = await fs.readdir(plan.receiptRoot);
  assert.deepEqual(receiptFiles.filter((name) => name.startsWith('dream-migration-')), []);
});

test('same deterministic snapshot name with different content is rejected', async () => {
  const input = await disjointFixture();
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  const paths = resolveDreamVersionedPreservationPaths(eventEntry(plan), plan);
  await fs.mkdir(path.dirname(paths.snapshotPath), { recursive: true });
  await fs.writeFile(paths.snapshotPath, 'different-content');
  const result = await runApproved(input);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_VERSIONED_SNAPSHOT_COLLISION');
  assert.equal(await fs.readFile(input.destinationEventsPath, 'utf8'), jsonl(DESTINATION_EVENTS));
});

test('reparse ancestor is rejected deterministically', async () => {
  const input = await disjointFixture();
  const reparsePath = path.join(input.workspaceRoot, 'memory', DREAM_VERSIONED_PRESERVATION_DIRECTORY);
  const fsImpl = fsProxy({
    lstat: async (target) => {
      if (path.resolve(target) === path.resolve(reparsePath)) {
        return { isSymbolicLink: () => true, isDirectory: () => true, isFile: () => false, nlink: 1 };
      }
      return fs.lstat(target);
    },
  });
  const result = await runApproved(input, { fsImpl });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_MIGRATION_REPARSE_ANCESTOR_BLOCKED');
});

test('hard-linked snapshot target is rejected', async () => {
  const input = await disjointFixture();
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  const paths = resolveDreamVersionedPreservationPaths(eventEntry(plan), plan);
  await fs.mkdir(path.dirname(paths.snapshotPath), { recursive: true });
  const seed = path.join(input.root, 'hard-link-seed');
  await fs.writeFile(seed, jsonl(SOURCE_EVENTS));
  await fs.link(seed, paths.snapshotPath);
  const result = await runApproved(input);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_MIGRATION_HARD_LINK_BLOCKED');
});

test('path traversal and caller-controlled absolute paths are rejected by the fixed layout', async () => {
  const input = await disjointFixture();
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  const entry = eventEntry(plan);
  assert.throws(
    () => resolveDreamVersionedPreservationPaths({
      ...entry,
      relativePath: '../escape',
      logicalSourcePath: 'memory/.dreams/../escape',
    }, plan),
    (error) => error.code === 'DREAM_VERSIONED_LOGICAL_PATH_INVALID',
  );
  assert.throws(
    () => resolveDreamVersionedPreservationPaths({
      ...entry,
      relativePath: path.resolve(input.root, 'absolute'),
      logicalSourcePath: path.resolve(input.root, 'absolute'),
    }, plan),
    (error) => error.code === 'DREAM_VERSIONED_LOGICAL_PATH_INVALID',
  );
});

test('POSIX literal backslashes are rejected instead of reinterpreted as separators', () => {
  assert.equal(normalizeDreamHostRelativePath('a\\b', 'linux'), '');
  assert.equal(normalizeDreamHostRelativePath('a\\b', 'darwin'), '');
  assert.equal(normalizeDreamHostRelativePath('a\\b', 'win32'), 'a/b');
  assert.equal(normalizeDreamHostRelativePath('a/b', 'linux'), 'a/b');
});

test('destination inside checkout remains blocked for versioned preservation', async () => {
  const input = await disjointFixture();
  const result = await executeDreamRuntimeMigration({
    repoRoot: input.repoRoot,
    env: {
      STEPHANOS_OPENCLAW_WORKSPACE: path.join(input.repoRoot, 'external-looking'),
      STEPHANOS_RUNTIME_ROOT: input.runtimeRoot,
    },
    operatorApproval: DREAM_RUNTIME_MIGRATION_APPROVAL,
    sourceHead: HEAD,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_RUNTIME_ROOT_INSIDE_REPOSITORY');
});

test('malformed deterministic manifest is rejected without overwrite', async () => {
  const input = await disjointFixture();
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  const paths = resolveDreamVersionedPreservationPaths(eventEntry(plan), plan);
  await fs.mkdir(path.dirname(paths.manifestPath), { recursive: true });
  await fs.writeFile(paths.manifestPath, '{malformed');
  const result = await runApproved(input);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_VERSIONED_MANIFEST_MALFORMED');
  assert.equal(await fs.readFile(paths.manifestPath, 'utf8'), '{malformed');
});

test('duplicate conflicting receipt is rejected', async () => {
  const input = await disjointFixture();
  const first = await runApproved(input);
  const manifestPath = first.preserved[0].preservationManifestPath;
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.previousCanonicalDestinationSha256 = 'f'.repeat(64);
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  const retry = await runApproved(input, { now: fixedNow('2026-08-01T12:31:00.000Z') });
  assert.equal(retry.ok, false);
  assert.equal(retry.blocker, 'DREAM_VERSIONED_RECEIPT_CONFLICT');
});

test('deterministic manifest proof references reject unrelated bounded replacements', async () => {
  const input = await disjointFixture();
  const first = await runApproved(input);
  const manifestPath = first.preserved[0].preservationManifestPath;
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.proofRefs = ['receipts/runtime-boundary/unrelated.json', 'dream-preservation/unrelated.snapshot'];
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  const retry = await runApproved(input, { now: fixedNow('2026-08-01T12:31:00.000Z') });
  assert.equal(retry.ok, false);
  assert.equal(retry.blocker, 'DREAM_VERSIONED_RECEIPT_CONFLICT');
});

test('receipt publication collision rolls back only newly owned migration artifacts', async () => {
  const input = await disjointFixture();
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  const receiptPath = path.join(plan.receiptRoot, 'dream-migration-2026-08-01T12-30-00-000Z.json');
  await fs.mkdir(path.dirname(receiptPath), { recursive: true });
  await fs.writeFile(receiptPath, 'pre-existing-receipt');
  const sourceBefore = await fs.readFile(input.sourceEventsPath);
  const canonicalBefore = await fs.readFile(input.destinationEventsPath);
  const result = await runApproved(input);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_MIGRATION_RECEIPT_WRITE_FAILED');
  assert.equal(result.receiptWriteReason, 'EEXIST');
  assert.equal(result.cleanupBlocker, '');
  const paths = resolveDreamVersionedPreservationPaths(eventEntry(plan), plan);
  await assert.rejects(() => fs.lstat(paths.snapshotPath), (error) => error.code === 'ENOENT');
  await assert.rejects(() => fs.lstat(paths.manifestPath), (error) => error.code === 'ENOENT');
  assert.deepEqual(await fs.readFile(input.sourceEventsPath), sourceBefore);
  assert.deepEqual(await fs.readFile(input.destinationEventsPath), canonicalBefore);
  assert.equal(await fs.readFile(receiptPath, 'utf8'), 'pre-existing-receipt');
});

test('partial receipt publication failure removes the handle-owned receipt and migration artifacts', async () => {
  const input = await disjointFixture();
  let injected = false;
  const fsImpl = fsProxy({
    open: async (target, flags, mode) => {
      const handle = await fs.open(target, flags, mode);
      if (!path.basename(String(target)).includes('dream-migration-')) return handle;
      return {
        fd: handle.fd,
        writeFile: async (...args) => {
          await handle.writeFile(...args);
          injected = true;
          const error = new Error('partial receipt write');
          error.code = 'EIO';
          throw error;
        },
        stat: (...args) => handle.stat(...args),
        close: (...args) => handle.close(...args),
      };
    },
  });
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  const paths = resolveDreamVersionedPreservationPaths(eventEntry(plan), plan);
  const result = await runApproved(input, { fsImpl });
  assert.equal(injected, true);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_MIGRATION_RECEIPT_WRITE_FAILED');
  assert.equal(result.receiptWriteReason, 'EIO');
  assert.equal(result.cleanupBlocker, '');
  await assert.rejects(() => fs.lstat(paths.snapshotPath), (error) => error.code === 'ENOENT');
  await assert.rejects(() => fs.lstat(paths.manifestPath), (error) => error.code === 'ENOENT');
  const receiptFiles = await fs.readdir(plan.receiptRoot);
  assert.deepEqual(receiptFiles.filter((name) => name.startsWith('dream-migration-')), []);
});

test('receipt publication reports cleanup failure when created-file identity is unavailable', async () => {
  const input = await disjointFixture();
  let injected = false;
  const fsImpl = fsProxy({
    open: async (target, flags, mode) => {
      const handle = await fs.open(target, flags, mode);
      if (!path.basename(String(target)).includes('dream-migration-')) return handle;
      return {
        fd: handle.fd,
        writeFile: async (...args) => {
          await handle.writeFile(...args);
          injected = true;
          const error = new Error('receipt publication failed');
          error.code = 'EIO';
          throw error;
        },
        stat: async () => {
          const error = new Error('receipt identity unavailable');
          error.code = 'EIO';
          throw error;
        },
        close: (...args) => handle.close(...args),
      };
    },
  });
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  const paths = resolveDreamVersionedPreservationPaths(eventEntry(plan), plan);
  const result = await runApproved(input, { fsImpl });
  assert.equal(injected, true);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_MIGRATION_RECEIPT_WRITE_FAILED');
  assert.equal(result.receiptWriteReason, 'EIO');
  assert.equal(result.cleanupBlocker, 'DREAM_MIGRATION_RECEIPT_CLEANUP_FAILED');
  await assert.rejects(() => fs.lstat(paths.snapshotPath), (error) => error.code === 'ENOENT');
  await assert.rejects(() => fs.lstat(paths.manifestPath), (error) => error.code === 'ENOENT');
  const receiptFiles = await fs.readdir(plan.receiptRoot);
  assert.equal(receiptFiles.filter((name) => name.startsWith('dream-migration-')).length, 0);
  assert.equal(receiptFiles.filter((name) => name.startsWith('.stephanos-pending-') && name.includes('dream-migration-')).length, 1);
});

test('Windows native publication keeps the final name hidden and aborts its owned staging file', {
  skip: process.platform !== 'win32',
  timeout: 30_000,
}, async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'stephanos-native-artifact-'));
  const artifactName = 'dream-migration-native-abort.json';
  const artifactPath = path.join(parent, artifactName);
  const token = '11111111-1111-4111-8111-111111111111';
  const stagingPath = path.join(parent, `.stephanos-pending-${token}-${artifactName}`);
  const helper = path.resolve('scripts', 'windows', 'dream-runtime-artifact-io.ps1');
  const expectedAncestorIdentities = await windowsAncestorIdentityProofForTest(parent);
  const child = spawn('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', helper,
    '-Mode', 'Publish',
    '-ParentPath', parent,
    '-ArtifactName', artifactName,
    '-Token', token,
    '-ExpectedAncestorIdentities', expectedAncestorIdentities,
    '-AncestorPathsBase64', windowsAncestorPathsBase64ForTest(parent),
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {});
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let stdout = '';
  let stderr = '';
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (stdout.includes(`READY:${token}:`)) resolveReady();
  });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  child.stdin.write(`${Buffer.from('{"finalVerdict":"TEST_ONLY"}\n').toString('base64')}\n`);
  const started = await Promise.race([
    ready.then(() => true),
    exited.then(() => false),
  ]);
  assert.equal(started, true, `helper exited before READY: ${stderr.trim()}`);
  await assert.rejects(() => fs.lstat(artifactPath), (error) => error.code === 'ENOENT');
  assert.equal(await fs.readFile(stagingPath, 'utf8'), '{"finalVerdict":"TEST_ONLY"}\n');
  child.stdin.end('ABORT\n');
  assert.equal(await exited, 0);
  assert.equal(stderr, '');
  assert.equal(stdout.split(/\r?\n/).includes(`ABORTED:${token}`), true);
  await assert.rejects(() => fs.lstat(artifactPath), (error) => error.code === 'ENOENT');
  await assert.rejects(() => fs.lstat(stagingPath), (error) => error.code === 'ENOENT');
});

test('Windows native publication rejects a replaced earlier ancestor by exact chain identity', {
  skip: process.platform !== 'win32',
  timeout: 30_000,
}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stephanos-native-chain-'));
  const approvedAncestor = path.join(root, 'approved');
  const parent = path.join(approvedAncestor, 'receipt-root');
  await fs.mkdir(parent, { recursive: true });
  const expectedAncestorIdentities = await windowsAncestorIdentityProofForTest(parent);
  const parkedAncestor = `${approvedAncestor}.parked`;
  await fs.rename(approvedAncestor, parkedAncestor);
  await fs.mkdir(parent, { recursive: true });
  const artifactName = 'dream-migration-chain-attack.json';
  const token = '22222222-2222-4222-8222-222222222222';
  const helper = path.resolve('scripts', 'windows', 'dream-runtime-artifact-io.ps1');
  const child = spawn('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', helper,
    '-Mode', 'Publish',
    '-ParentPath', parent,
    '-ArtifactName', artifactName,
    '-Token', token,
    '-ExpectedAncestorIdentities', expectedAncestorIdentities,
    '-AncestorPathsBase64', windowsAncestorPathsBase64ForTest(parent),
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {});
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  child.stdin.end(`${Buffer.from('{"finalVerdict":"TEST_ONLY"}\n').toString('base64')}\nCOMMIT\n`);
  assert.equal(await exited, 2);
  assert.equal(stdout.includes(`COMMITTED:${token}`), false);
  assert.match(stderr, /DREAM_MIGRATION_EXACT_ANCESTOR_CHANGED/);
  await assert.rejects(() => fs.lstat(path.join(parent, artifactName)), (error) => error.code === 'ENOENT');
  await assert.rejects(
    () => fs.lstat(path.join(parkedAncestor, 'receipt-root', artifactName)),
    (error) => error.code === 'ENOENT',
  );
});

test('partial manifest publication self-cleans before snapshot rollback', async () => {
  const input = await disjointFixture();
  let injected = false;
  const fsImpl = fsProxy({
    open: async (target, flags, mode) => {
      const handle = await fs.open(target, flags, mode);
      if (!path.basename(String(target)).includes('dream-preservation-v1-')) return handle;
      return {
        fd: handle.fd,
        writeFile: async (...args) => {
          await handle.writeFile(...args);
          injected = true;
          const error = new Error('partial manifest write');
          error.code = 'EIO';
          throw error;
        },
        stat: (...args) => handle.stat(...args),
        close: (...args) => handle.close(...args),
      };
    },
  });
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  const paths = resolveDreamVersionedPreservationPaths(eventEntry(plan), plan);
  const result = await runApproved(input, { fsImpl });
  assert.equal(injected, true);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_VERSIONED_MANIFEST_WRITE_FAILED');
  assert.equal(result.cleanupBlocker, '');
  await assert.rejects(() => fs.lstat(paths.snapshotPath), (error) => error.code === 'ENOENT');
  await assert.rejects(() => fs.lstat(paths.manifestPath), (error) => error.code === 'ENOENT');
  const receiptFiles = await fs.readdir(plan.receiptRoot);
  assert.deepEqual(receiptFiles.filter((name) => name.startsWith('dream-migration-')), []);
});

test('later preservation blocker rolls back prior owned artifacts and preserves the collision', async () => {
  const input = await disjointFixture();
  const deepDestinationPath = path.join(input.workspaceRoot, 'memory', 'dreaming', 'deep', '2026-07-21.md');
  await fs.mkdir(path.dirname(deepDestinationPath), { recursive: true });
  await fs.writeFile(deepDestinationPath, '# prior dream\n');
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  assert.equal(plan.versionedPreservationRequired, 2);
  const eventsEntry = eventEntry(plan);
  const deepEntry = plan.entries.find((entry) => entry.logicalSourcePath === 'memory/dreaming/deep/2026-07-21.md');
  assert.ok(deepEntry);
  const eventsPaths = resolveDreamVersionedPreservationPaths(eventsEntry, plan);
  const deepPaths = resolveDreamVersionedPreservationPaths(deepEntry, plan);
  await fs.mkdir(path.dirname(deepPaths.snapshotPath), { recursive: true });
  await fs.writeFile(deepPaths.snapshotPath, 'pre-existing-collision');
  const result = await runApproved(input);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_VERSIONED_SNAPSHOT_COLLISION');
  assert.equal(result.cleanupBlocker, '');
  await assert.rejects(() => fs.lstat(eventsPaths.snapshotPath), (error) => error.code === 'ENOENT');
  await assert.rejects(() => fs.lstat(eventsPaths.manifestPath), (error) => error.code === 'ENOENT');
  assert.equal(await fs.readFile(deepPaths.snapshotPath, 'utf8'), 'pre-existing-collision');
  await assert.rejects(() => fs.lstat(deepPaths.manifestPath), (error) => error.code === 'ENOENT');
  const receiptFiles = await fs.readdir(plan.receiptRoot);
  assert.deepEqual(receiptFiles.filter((name) => name.startsWith('dream-migration-')), []);
});

test('later preservation setup exception rolls back prior preserved artifacts', async () => {
  const input = await disjointFixture();
  const deepDestinationPath = path.join(input.workspaceRoot, 'memory', 'dreaming', 'deep', '2026-07-21.md');
  await fs.mkdir(path.dirname(deepDestinationPath), { recursive: true });
  await fs.writeFile(deepDestinationPath, '# prior dream\n');
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  assert.equal(plan.versionedPreservationRequired, 2);
  const eventsPaths = resolveDreamVersionedPreservationPaths(eventEntry(plan), plan);
  const deepEntry = plan.entries.find((entry) => entry.logicalSourcePath === 'memory/dreaming/deep/2026-07-21.md');
  assert.ok(deepEntry);
  const deepPaths = resolveDreamVersionedPreservationPaths(deepEntry, plan);
  let lockCalls = 0;
  const result = await runApproved(input, {
    acquireOperationLockFn: async () => {
      lockCalls += 1;
      if (lockCalls === 2) {
        const error = new Error('preservation lock setup failed');
        error.code = 'EIO';
        throw error;
      }
      return { ok: true, release: async () => true };
    },
  });
  assert.equal(lockCalls, 2);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_VERSIONED_PRESERVATION_SETUP_FAILED');
  assert.equal(result.preservationFailureReason, 'EIO');
  assert.equal(result.cleanupBlocker, '');
  await assert.rejects(() => fs.lstat(eventsPaths.snapshotPath), (error) => error.code === 'ENOENT');
  await assert.rejects(() => fs.lstat(eventsPaths.manifestPath), (error) => error.code === 'ENOENT');
  await assert.rejects(() => fs.lstat(deepPaths.snapshotPath), (error) => error.code === 'ENOENT');
  await assert.rejects(() => fs.lstat(deepPaths.manifestPath), (error) => error.code === 'ENOENT');
  const receiptFiles = await fs.readdir(plan.receiptRoot);
  assert.deepEqual(receiptFiles.filter((name) => name.startsWith('dream-migration-')), []);
});

test('snapshot path-verification failure self-cleans through handle-owned identity', async () => {
  const input = await disjointFixture();
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  const paths = resolveDreamVersionedPreservationPaths(eventEntry(plan), plan);
  const sourceBefore = await fs.readFile(input.sourceEventsPath);
  const canonicalBefore = await fs.readFile(input.destinationEventsPath);
  let injected = false;
  const fsImpl = fsProxy({
    lstat: async (target, ...args) => {
      if (!injected && path.resolve(String(target)) === path.resolve(paths.snapshotPath)) {
        const info = await fs.lstat(target, ...args);
        assert.equal(info.isFile(), true);
        injected = true;
        const error = new Error('snapshot path verification failed');
        error.code = 'EIO';
        throw error;
      }
      return fs.lstat(target, ...args);
    },
  });
  const result = await runApproved(input, { fsImpl });
  assert.equal(injected, true);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_VERSIONED_COPY_FAILED');
  assert.equal(result.cleanupBlocker, '');
  await assert.rejects(() => fs.lstat(paths.snapshotPath), (error) => error.code === 'ENOENT');
  await assert.rejects(() => fs.lstat(paths.manifestPath), (error) => error.code === 'ENOENT');
  assert.deepEqual(await fs.readFile(input.sourceEventsPath), sourceBefore);
  assert.deepEqual(await fs.readFile(input.destinationEventsPath), canonicalBefore);
});

test('ancestor identity change during exclusive publication blocks success and rolls back', async () => {
  const input = await disjointFixture();
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  const paths = resolveDreamVersionedPreservationPaths(eventEntry(plan), plan);
  const snapshotParent = path.dirname(paths.snapshotPath);
  let snapshotOpened = false;
  let ancestorChangeInjected = false;
  const fsImpl = fsProxy({
    open: async (target, flags, mode) => {
      const handle = await fs.open(target, flags, mode);
      if (String(target).endsWith(path.basename(paths.snapshotPath))) snapshotOpened = true;
      return handle;
    },
    lstat: async (target, ...args) => {
      const info = await fs.lstat(target, ...args);
      if (
        snapshotOpened
        && !ancestorChangeInjected
        && path.resolve(String(target)) === path.resolve(snapshotParent)
      ) {
        ancestorChangeInjected = true;
        return {
          isDirectory: () => true,
          isSymbolicLink: () => false,
          dev: info.dev,
          ino: Number(info.ino) + 1,
          birthtimeMs: info.birthtimeMs,
        };
      }
      return info;
    },
  });
  const result = await runApproved(input, { fsImpl });
  assert.equal(ancestorChangeInjected, true);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_VERSIONED_COPY_FAILED');
  assert.equal(result.cleanupBlocker, '');
  await assert.rejects(() => fs.lstat(paths.snapshotPath), (error) => error.code === 'ENOENT');
  await assert.rejects(() => fs.lstat(paths.manifestPath), (error) => error.code === 'ENOENT');
});

test('ancestor swap during publication cannot redirect or retain an escaped artifact', { skip: process.platform !== 'linux' }, async () => {
  const input = await disjointFixture();
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  const paths = resolveDreamVersionedPreservationPaths(eventEntry(plan), plan);
  const snapshotParent = path.dirname(paths.snapshotPath);
  const parkedParent = `${snapshotParent}.parked`;
  const externalParent = await fs.mkdtemp(path.join(os.tmpdir(), 'stephanos-dream-external-'));
  let injected = false;
  const fsImpl = fsProxy({
    open: async (target, flags, mode) => {
      const targetPath = String(target);
      const isSnapshotPublication = targetPath.startsWith('/proc/self/fd/')
        && path.basename(targetPath).endsWith(path.basename(paths.snapshotPath));
      if (!isSnapshotPublication) return fs.open(target, flags, mode);
      await fs.rename(snapshotParent, parkedParent);
      await fs.symlink(externalParent, snapshotParent, 'dir');
      const handle = await fs.open(target, flags, mode);
      await fs.unlink(snapshotParent);
      await fs.rename(parkedParent, snapshotParent);
      injected = true;
      return {
        fd: handle.fd,
        writeFile: async (...args) => {
          await handle.writeFile(...args);
          const error = new Error('forced post-open publication failure');
          error.code = 'EIO';
          throw error;
        },
        stat: (...args) => handle.stat(...args),
        close: (...args) => handle.close(...args),
      };
    },
  });
  const result = await runApproved(input, { fsImpl });
  assert.equal(injected, true);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_VERSIONED_COPY_FAILED');
  assert.equal(result.cleanupBlocker, '');
  await assert.rejects(() => fs.lstat(paths.snapshotPath), (error) => error.code === 'ENOENT');
  await assert.rejects(
    () => fs.lstat(path.join(externalParent, path.basename(paths.snapshotPath))),
    (error) => error.code === 'ENOENT',
  );
});

test('Linux promotion binds the authoritative name to the opened pending inode', { skip: process.platform !== 'linux' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-linkat-'));
  const pendingName = '.stephanos-pending-hostile-receipt.json';
  const pendingPath = path.join(root, pendingName);
  const displacedPath = path.join(root, 'owned-displaced');
  const finalPath = path.join(root, 'dream-migration-hostile.json');
  await fs.writeFile(pendingPath, 'owned-receipt');
  const pendingHandle = await fs.open(pendingPath, 'r');
  const parentHandle = await fs.open(root, 'r');
  await fs.rename(pendingPath, displacedPath);
  await fs.writeFile(pendingPath, 'attacker-replacement');
  try {
    const helper = spawn('python3', [
      path.resolve('scripts/posix/dream-runtime-artifact-io.py'),
      '--pending-name', pendingName,
      '--artifact-name', path.basename(finalPath),
    ], { stdio: ['ignore', 'pipe', 'pipe', pendingHandle.fd, parentHandle.fd] });
    const outcome = await new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      helper.stdout.setEncoding('utf8');
      helper.stderr.setEncoding('utf8');
      helper.stdout.on('data', (chunk) => { stdout += chunk; });
      helper.stderr.on('data', (chunk) => { stderr += chunk; });
      helper.once('exit', (code) => resolve({ code, stdout, stderr }));
    });
    assert.deepEqual(outcome, {
      code: 2,
      stdout: '',
      stderr: 'DREAM_MIGRATION_RECEIPT_COMMIT_IDENTITY_CHANGED\n',
    });
    await assert.rejects(() => fs.lstat(finalPath), (error) => error.code === 'ENOENT');
    assert.equal(await fs.readFile(pendingPath, 'utf8'), 'attacker-replacement');
    assert.equal(await fs.readFile(displacedPath, 'utf8'), 'owned-receipt');
  } finally {
    await pendingHandle.close();
    await parentHandle.close();
  }
});

test('cross-platform publication adapters preserve the structural commit invariant', async () => {
  const posixHelper = await fs.readFile(path.resolve('scripts/posix/dream-runtime-artifact-io.py'), 'utf8');
  assert.match(posixHelper, /linkat\(-100, b"\/proc\/self\/fd\/3"/);
  assert.match(posixHelper, /system = platform\.system\(\)[\s\S]*if system == "Darwin"/);
  assert.match(posixHelper, /fclonefileat\(pending_fd, parent_fd/);
  assert.doesNotMatch(posixHelper, /renameatx_np/);
  assert.match(
    posixHelper,
    /except BaseException:\s+fail\("DREAM_MIGRATION_RECEIPT_COMMIT_CLEANUP_UNVERIFIED"\)/,
  );
  const boundarySource = await fs.readFile(path.resolve('shared/agents/dreamRuntimeBoundary.mjs'), 'utf8');
  assert.match(boundarySource, /expectedDarwinHash = sha256\(await pendingHandle\.readFile\(\)\)/);
  assert.match(
    boundarySource,
    /finalLinked = output\.code === 0;[\s\S]*publishedIdentity = helperIdentity;[\s\S]*\} finally \{\s+await pendingHandle\.close\(\);/,
  );
  assert.match(
    boundarySource,
    /if \(finalLinked && boundary\)[\s\S]*publishedIdentity \|\| identity/,
  );
  const promotionSource = boundarySource.slice(
    boundarySource.indexOf('async function promoteOwnedArtifact'),
    boundarySource.indexOf('async function writeReceipt'),
  );
  const helperExitIndex = promotionSource.indexOf('finalLinked = output.code === 0;');
  const helperParseIndex = promotionSource.indexOf('parsePosixPromotionIdentity(output.stdout)');
  const helperIdentityIndex = promotionSource.indexOf('publishedIdentity = helperIdentity;');
  const closeIndex = promotionSource.indexOf('await pendingHandle.close();');
  const heldVerificationIndex = promotionSource.lastIndexOf(
    'assertRegularSingleLink(operationArtifactPath, { fsImpl })',
  );
  const postPromotionChainIndex = promotionSource.lastIndexOf(
    'assertSafeDirectoryChainUnchanged(ancestorIdentities, { fsImpl })',
  );
  const canonicalVerificationIndex = promotionSource.lastIndexOf(
    'assertRegularSingleLink(artifactPath, { fsImpl })',
  );
  assert.equal(helperExitIndex > 0 && helperExitIndex < helperParseIndex, true);
  assert.equal(helperIdentityIndex > helperParseIndex && helperIdentityIndex < closeIndex, true);
  assert.equal(heldVerificationIndex > closeIndex, true);
  assert.equal(postPromotionChainIndex > heldVerificationIndex, true);
  assert.equal(canonicalVerificationIndex > postPromotionChainIndex, true);
  assert.match(posixHelper, /PROMOTED:\{info\.st_dev\}:\{info\.st_ino\}:\{info\.st_size\}/);
  const windowsHelper = await fs.readFile(path.resolve('scripts/windows/dream-runtime-artifact-io.ps1'), 'utf8');
  assert.match(windowsHelper, /AncestorPathsBase64/);
  assert.equal((windowsHelper.match(/Assert-AncestorChainUnchanged/g) || []).length >= 6, true);
  assert.match(
    windowsHelper,
    /if \(\$Mode -eq 'EnsureDirectory'\)[\s\S]*EnsureRelativeDirectory[\s\S]*Assert-AncestorChainUnchanged[\s\S]*DIRECTORY_READY/,
  );
  assert.match(
    windowsHelper,
    /if \(\$directoryCreated -and -not \$directoryReady\)[\s\S]*DeleteByHandle\(\$directory\)[\s\S]*DREAM_MIGRATION_DIRECTORY_CREATE_CLEANUP_FAILED/,
  );
  assert.match(
    boundarySource,
    /DREAM_MIGRATION_DIRECTORY_CREATE_CLEANUP_FAILED[\s\S]*error\.cleanupBlocker = 'DREAM_MIGRATION_DIRECTORY_CREATE_CLEANUP_FAILED'/,
  );
  assert.match(windowsHelper, /if \(\$renamed\)[\s\S]*DeleteByHandle\(\$pending\)/);
});

test('missing preservation directories are created relative to the validated parent handle', { skip: process.platform !== 'linux' }, async () => {
  const input = await disjointFixture();
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  const preservationRoot = path.join(input.workspaceRoot, 'memory', DREAM_VERSIONED_PRESERVATION_DIRECTORY);
  const preservationParent = path.dirname(preservationRoot);
  const parkedParent = `${preservationParent}.parked`;
  const externalParent = await fs.mkdtemp(path.join(os.tmpdir(), 'stephanos-dream-directory-external-'));
  let injected = false;
  const fsImpl = fsProxy({
    mkdir: async (target, options) => {
      const targetPath = String(target);
      const isPreservationRootCreation = !injected
        && targetPath.startsWith('/proc/self/fd/')
        && path.basename(targetPath) === DREAM_VERSIONED_PRESERVATION_DIRECTORY;
      if (!isPreservationRootCreation) return fs.mkdir(target, options);
      await fs.rename(preservationParent, parkedParent);
      await fs.symlink(externalParent, preservationParent, 'dir');
      await fs.mkdir(target, options);
      await fs.unlink(preservationParent);
      await fs.rename(parkedParent, preservationParent);
      injected = true;
    },
  });
  const result = await runApproved(input, { fsImpl });
  assert.equal(injected, true);
  assert.equal(result.ok, true);
  await assert.rejects(
    () => fs.lstat(path.join(externalParent, DREAM_VERSIONED_PRESERVATION_DIRECTORY)),
    (error) => error.code === 'ENOENT',
  );
  assert.equal((await fs.lstat(preservationRoot)).isDirectory(), true);
  assert.equal(result.boundary.repoRoot, plan.repoRoot);
});

test('changed source during snapshot copy fails and removes only the new snapshot', async () => {
  const input = await disjointFixture();
  let changed = false;
  const fsImpl = fsProxyWithOwnedWriteHook(async (target) => {
    if (String(target).endsWith('.snapshot')) {
      await fs.appendFile(input.sourceEventsPath, ' ');
      changed = true;
    }
  });
  const result = await runApproved(input, { fsImpl });
  assert.equal(changed, true);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_MIGRATION_SOURCE_CHANGED');
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  assert.equal(plan.ok, true, 'the intentionally changed source remains preserved and is re-inventoried');
  assert.notEqual(eventEntry(plan).sourceSha256, result.failedEntry.sourceSha256);
  assert.equal((await fs.readFile(input.sourceEventsPath, 'utf8')).endsWith(' '), true);
  const preservationRoot = path.join(input.workspaceRoot, 'memory', DREAM_VERSIONED_PRESERVATION_DIRECTORY);
  const snapshots = await fs.readdir(preservationRoot, { recursive: true }).catch(() => []);
  assert.equal(snapshots.some((name) => String(name).endsWith('.snapshot')), false);
});

test('canonical destination mutation during copy is detected and never repaired in place', async () => {
  const input = await disjointFixture();
  const canonicalBefore = await fs.readFile(input.destinationEventsPath, 'utf8');
  const fsImpl = fsProxyWithOwnedWriteHook(async (target) => {
    if (String(target).endsWith('.snapshot')) await fs.appendFile(input.destinationEventsPath, ' ');
  });
  const result = await runApproved(input, { fsImpl });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_CANONICAL_DESTINATION_CHANGED');
  assert.equal(await fs.readFile(input.destinationEventsPath, 'utf8'), `${canonicalBefore} `);
});

test('conflicting concurrent preservation is serialized by existing operation-lock machinery', async () => {
  const input = await disjointFixture();
  let releaseCopy;
  let reportEntered;
  const entered = new Promise((resolve) => { reportEntered = resolve; });
  const hold = new Promise((resolve) => { releaseCopy = resolve; });
  const fsImpl = fsProxyWithOwnedWriteHook(async (target) => {
    if (String(target).endsWith('.snapshot')) {
      reportEntered();
      await hold;
    }
  });
  const firstPromise = runApproved(input, { fsImpl });
  await entered;
  const second = await runApproved(input, {
    now: fixedNow('2026-08-01T12:31:00.000Z'),
    operationLockOptions: {
      operationLockTimeoutMs: 20,
      operationLockRetryMs: 2,
      operationStaleLockMs: 5_000,
    },
  });
  assert.equal(second.ok, false);
  assert.equal(second.blocker, 'DREAM_VERSIONED_PRESERVATION_CONCURRENT');
  releaseCopy();
  const first = await firstPromise;
  assert.equal(first.ok, true);
});

test('blocked preservation surfaces an operation-lock release cleanup failure', async () => {
  const input = await disjointFixture();
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  const paths = resolveDreamVersionedPreservationPaths(eventEntry(plan), plan);
  await fs.mkdir(path.dirname(paths.snapshotPath), { recursive: true });
  await fs.writeFile(paths.snapshotPath, 'pre-existing-collision');
  const result = await runApproved(input, {
    acquireOperationLockFn: async () => ({
      ok: true,
      release: async () => false,
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_VERSIONED_SNAPSHOT_COLLISION');
  assert.equal(result.cleanupBlocker, 'DREAM_VERSIONED_LOCK_RELEASE_FAILED');
  assert.equal(result.lockCleanupBlocker, 'DREAM_VERSIONED_LOCK_RELEASE_FAILED');
  assert.equal(await fs.readFile(paths.snapshotPath, 'utf8'), 'pre-existing-collision');
  await assert.rejects(() => fs.lstat(paths.manifestPath), (error) => error.code === 'ENOENT');
});

test('malformed or ambiguous event conflicts fail closed', async () => {
  const input = await disjointFixture();
  await fs.writeFile(input.sourceEventsPath, '{not-json}\n');
  const plan = await planDreamRuntimeMigration({ repoRoot: input.repoRoot, env: input.env });
  assert.equal(plan.ok, false);
  assert.equal(plan.blocker, 'DREAM_EVENT_SET_MALFORMED_OR_AMBIGUOUS');
});

test('symbolic links fail closed', async (t) => {
  const { repoRoot, env, root } = await fixture();
  const target = path.join(root, 'outside.txt');
  await fs.writeFile(target, 'outside');
  const link = path.join(repoRoot, 'memory', '.dreams', 'link.txt');
  try {
    await fs.symlink(target, link);
  } catch (error) {
    if (error?.code === 'EPERM') return t.skip('symlink creation not permitted');
    throw error;
  }
  const plan = await planDreamRuntimeMigration({ repoRoot, env });
  assert.equal(plan.ok, false);
  assert.equal(plan.blocker, 'DREAM_MIGRATION_SYMLINK_BLOCKED');
});
