import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DREAM_EVENT_SET_RELATIONS,
  DREAM_RUNTIME_MIGRATION_APPROVAL,
  DREAM_VERSIONED_PRESERVATION_DIRECTORY,
  classifyDreamEventSets,
  executeDreamRuntimeMigration,
  pathIsInside,
  planDreamRuntimeMigration,
  resolveDreamRuntimeBoundary,
  resolveDreamVersionedPreservationPaths,
} from './dreamRuntimeBoundary.mjs';

const HEAD = 'a'.repeat(40);

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

async function runApproved(input, overrides = {}) {
  return executeDreamRuntimeMigration({
    repoRoot: input.repoRoot,
    env: input.env,
    operatorApproval: DREAM_RUNTIME_MIGRATION_APPROVAL,
    sourceHead: HEAD,
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
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'DREAM_RUNTIME_COPY_HASH_VERIFIED');
  assert.equal(result.copied.length, 2);
  assert.equal(result.sourceRemovalPerformed, false);
  assert.equal(await fs.readFile(input.sourceEventsPath, 'utf8'), jsonl([dreamEvent('2026-07-21T02:00:00.000Z', 'deep', '2026-07-21')]));
  assert.equal(await fs.readFile(input.destinationEventsPath, 'utf8'), await fs.readFile(input.sourceEventsPath, 'utf8'));
  assert.match(result.receiptPath, /runtime[\\/]receipts[\\/]runtime-boundary[\\/]dream-migration-/);
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

test('changed source during snapshot copy fails and removes only the new snapshot', async () => {
  const input = await disjointFixture();
  let changed = false;
  const fsImpl = fsProxy({
    copyFile: async (source, destination, flags) => {
      await fs.copyFile(source, destination, flags);
      if (String(destination).endsWith('.snapshot')) {
        await fs.appendFile(source, ' ');
        changed = true;
      }
    },
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
  const fsImpl = fsProxy({
    copyFile: async (source, destination, flags) => {
      await fs.copyFile(source, destination, flags);
      if (String(destination).endsWith('.snapshot')) await fs.appendFile(input.destinationEventsPath, ' ');
    },
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
  const fsImpl = fsProxy({
    copyFile: async (source, destination, flags) => {
      await fs.copyFile(source, destination, flags);
      if (String(destination).endsWith('.snapshot')) {
        reportEntered();
        await hold;
      }
    },
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
