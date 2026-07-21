import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DREAM_RUNTIME_MIGRATION_APPROVAL,
  executeDreamRuntimeMigration,
  pathIsInside,
  planDreamRuntimeMigration,
  resolveDreamRuntimeBoundary,
} from './dreamRuntimeBoundary.mjs';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-boundary-'));
  const repoRoot = path.join(root, 'repo');
  const workspaceRoot = path.join(root, 'openclaw-workspace');
  const runtimeRoot = path.join(root, 'runtime');
  await fs.mkdir(path.join(repoRoot, 'memory', '.dreams'), { recursive: true });
  await fs.mkdir(path.join(repoRoot, 'memory', 'dreaming', 'deep'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, 'memory', '.dreams', 'events.jsonl'), '{"event":1}\n');
  await fs.writeFile(path.join(repoRoot, 'memory', 'dreaming', 'deep', '2026-07-21.md'), '# dream\n');
  return {
    root,
    repoRoot,
    workspaceRoot,
    runtimeRoot,
    env: {
      STEPHANOS_OPENCLAW_WORKSPACE: workspaceRoot,
      STEPHANOS_RUNTIME_ROOT: runtimeRoot,
    },
  };
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
  const { repoRoot, env } = await fixture();
  const denied = await executeDreamRuntimeMigration({ repoRoot, env });
  assert.equal(denied.blocker, 'DREAM_MIGRATION_APPROVAL_REQUIRED');

  const result = await executeDreamRuntimeMigration({
    repoRoot,
    env,
    operatorApproval: DREAM_RUNTIME_MIGRATION_APPROVAL,
    now: () => new Date('2026-07-21T18:45:00.000Z'),
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'DREAM_RUNTIME_COPY_HASH_VERIFIED');
  assert.equal(result.copied.length, 2);
  assert.equal(result.sourceRemovalPerformed, false);
  assert.equal(await fs.readFile(path.join(repoRoot, 'memory', '.dreams', 'events.jsonl'), 'utf8'), '{"event":1}\n');
  assert.equal(await fs.readFile(path.join(env.STEPHANOS_OPENCLAW_WORKSPACE, 'memory', '.dreams', 'events.jsonl'), 'utf8'), '{"event":1}\n');
  assert.match(result.receiptPath, /runtime[\\/]receipts[\\/]runtime-boundary[\\/]dream-migration-/);
});

test('destination conflicts fail closed without overwrite', async () => {
  const { repoRoot, env } = await fixture();
  const destination = path.join(env.STEPHANOS_OPENCLAW_WORKSPACE, 'memory', '.dreams', 'events.jsonl');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, 'different\n');
  const plan = await planDreamRuntimeMigration({ repoRoot, env });
  assert.equal(plan.ok, false);
  assert.equal(plan.blocker, 'DREAM_MIGRATION_DESTINATION_CONFLICT');
  assert.equal(await fs.readFile(destination, 'utf8'), 'different\n');
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

test('destination ancestor symbolic links fail closed', async (t) => {
  const { repoRoot, env, root } = await fixture();
  const outside = path.join(root, 'outside-destination');
  await fs.mkdir(outside, { recursive: true });
  await fs.mkdir(env.STEPHANOS_OPENCLAW_WORKSPACE, { recursive: true });
  try {
    await fs.symlink(outside, path.join(env.STEPHANOS_OPENCLAW_WORKSPACE, 'memory'), 'dir');
  } catch (error) {
    if (error?.code === 'EPERM') return t.skip('symlink creation not permitted');
    throw error;
  }
  const plan = await planDreamRuntimeMigration({ repoRoot, env });
  assert.equal(plan.ok, false);
  assert.equal(plan.blocker, 'DREAM_MIGRATION_DESTINATION_SYMLINK_BLOCKED');
});

test('migration blocks when a source changes during the copy window', async () => {
  const { repoRoot, env } = await fixture();
  const mutatedSource = path.join(repoRoot, 'memory', '.dreams', 'events.jsonl');
  let mutated = false;
  const fsImpl = {
    ...fs,
    async copyFile(source, destination, flags) {
      await fs.copyFile(source, destination, flags);
      if (!mutated) {
        mutated = true;
        await fs.writeFile(mutatedSource, '{"event":2}\n');
      }
    },
  };
  const result = await executeDreamRuntimeMigration({
    repoRoot,
    env,
    fsImpl,
    operatorApproval: DREAM_RUNTIME_MIGRATION_APPROVAL,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DREAM_MIGRATION_SOURCE_CHANGED_DURING_COPY');
});
