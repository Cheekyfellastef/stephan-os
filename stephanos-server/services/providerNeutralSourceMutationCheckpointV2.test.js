import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  inspectProviderNeutralSourceMutationCheckpointV2Recovery,
  prepareProviderNeutralSourceMutationCheckpointV2,
  readProviderNeutralSourceMutationCheckpointV2,
} from './providerNeutralSourceMutationCheckpointV2.js';

const MISSION_ID = 'critical-2002-preapply-checkpoint';
const ACTION_ID = 'critical-2002-preapply-checkpoint-r1';
const SOURCE_PATH = 'shared/agents/preapply-checkpoint-fixture.mjs';

function git(cwd, args, env = process.env) {
  const result = spawnSync('git', args, {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

function runGit(_executable, args, options = {}) {
  return spawnSync('git', args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    windowsHide: true,
  });
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'provider-neutral-preapply-v2-'));
  const repoRoot = join(root, 'repo');
  const workspaceRoot = join(root, 'workspace');
  const queueRoot = join(root, 'queue');
  await mkdir(join(repoRoot, 'shared', 'agents'), { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(queueRoot, { recursive: true });

  git(repoRoot, ['init']);
  git(repoRoot, ['config', 'user.email', 'preapply@example.invalid']);
  git(repoRoot, ['config', 'user.name', 'Preapply Test']);
  await writeFile(join(repoRoot, SOURCE_PATH), 'export const value = 1;\n');
  git(repoRoot, ['add', SOURCE_PATH]);
  git(repoRoot, ['commit', '-m', 'preapply base']);
  const head = git(repoRoot, ['rev-parse', 'HEAD']).stdout.trim().toLowerCase();

  const patchPath = join(root, 'generated.patch');
  const patch = [
    `diff --git a/${SOURCE_PATH} b/${SOURCE_PATH}`,
    `--- a/${SOURCE_PATH}`,
    `+++ b/${SOURCE_PATH}`,
    '@@ -1 +1 @@',
    '-export const value = 1;',
    '+export const value = 2;',
    '',
  ].join('\n');
  await writeFile(patchPath, patch, { mode: 0o600 });

  const action = {
    schemaVersion: 'stephanos.mission-worker-action.v1',
    actionKind: 'agent-handoff',
    missionId: MISSION_ID,
    actionId: ACTION_ID,
    adapter: 'foundry-forge',
    repository: 'Cheekyfellastef/stephan-os',
    branch: 'fix/preapply-checkpoint-v2',
    worktreePath: repoRoot,
    allowedFiles: ['shared/agents/**'],
    requiredTests: [],
    expectedHeadSha: head,
  };
  const item = {
    schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    adapter: 'foundry-forge',
    actionId: ACTION_ID,
    missionId: MISSION_ID,
    createdAt: '2026-09-25T16:20:00.000Z',
    actionGrant: {
      schemaVersion: 'stephanos.mission-worker-action-grant.v1',
      missionId: MISSION_ID,
      actionId: ACTION_ID,
      adapter: 'foundry-forge',
      repository: action.repository,
      branch: action.branch,
      headSha: head,
      sourceRevision: head,
    },
    executionBinding: {
      schemaVersion: 'stephanos.mission-worker-queue-execution-binding.v1',
      executionId: ACTION_ID,
      missionId: MISSION_ID,
      headSha: head,
      sourceRevision: head,
    },
    payload: action,
  };
  const processingPath = join(queueRoot, `${ACTION_ID}.json`);
  await writeFile(processingPath, `${JSON.stringify(item)}\n`);
  const claim = {
    adapter: 'foundry-forge',
    item,
    processingPath,
  };
  const options = {
    sharedWorkspaceRoot: workspaceRoot,
    repoRoot,
    runCommand: runGit,
  };
  return { root, repoRoot, workspaceRoot, queueRoot, patchPath, patch, action, item, claim, processingPath, head, options };
}

async function prepare(f) {
  return prepareProviderNeutralSourceMutationCheckpointV2({
    action: f.action,
    claim: f.claim,
    patchPath: f.patchPath,
    createdAtUtc: '2026-09-25T16:21:00.000Z',
  }, f.options);
}

test('pre-apply checkpoint is durable while source worktree remains untouched', async () => {
  const f = await fixture();
  try {
    const prepared = await prepare(f);
    assert.equal(prepared.ok, true);
    assert.equal(prepared.reason, 'PROVIDER_NEUTRAL_MUTATION_V2_PREPARED');
    assert.equal(git(f.repoRoot, ['status', '--porcelain=v1', '--untracked-files=normal']).stdout, '');
    assert.equal(await readFile(prepared.durablePatchPath, 'utf8'), f.patch);

    const recovered = await inspectProviderNeutralSourceMutationCheckpointV2Recovery({
      adapter: 'foundry-forge',
      item: f.item,
      processingPath: f.processingPath,
      latestReceipt: { state: 'progress' },
    }, f.options);
    assert.equal(recovered.allowed, true);
    assert.equal(recovered.resumeStage, 'PATCH_PREPARED');
    assert.equal(recovered.providerReplayMayOccur, false);
    assert.equal(recovered.sourceMutationReplayAllowed, false);
    assert.equal(recovered.durablePatchPath, prepared.durablePatchPath);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('same pre-apply checkpoint classifies exact applied result without provider replay', async () => {
  const f = await fixture();
  try {
    const prepared = await prepare(f);
    git(f.repoRoot, ['apply', '--whitespace=error-all', prepared.durablePatchPath]);
    const recovered = await inspectProviderNeutralSourceMutationCheckpointV2Recovery({
      adapter: 'foundry-forge',
      item: f.item,
      processingPath: f.processingPath,
      latestReceipt: { state: 'started' },
    }, f.options);
    assert.equal(recovered.allowed, true);
    assert.equal(recovered.resumeStage, 'SOURCE_CHANGED');
    assert.equal(recovered.expectedResultTree, prepared.checkpoint.exactResultTree);
    assert.deepEqual(recovered.changedFiles, [SOURCE_PATH]);
    assert.equal(recovered.providerReplayMayOccur, false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('pre-apply checkpoint is idempotent and record never contains patch source text', async () => {
  const f = await fixture();
  try {
    const first = await prepare(f);
    const second = await prepare(f);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.reason, 'PROVIDER_NEUTRAL_MUTATION_V2_IDEMPOTENT');
    const recordBytes = await readFile(first.checkpointPath, 'utf8');
    assert.equal(recordBytes.includes('export const value = 2'), false);
    assert.equal(recordBytes.includes(f.patch), false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('tampered durable patch invalidates prepared recovery before mutation', async () => {
  const f = await fixture();
  try {
    const prepared = await prepare(f);
    await writeFile(prepared.durablePatchPath, 'diff --git a/evil b/evil\n');
    const read = await readProviderNeutralSourceMutationCheckpointV2(MISSION_ID, ACTION_ID, f.options);
    assert.equal(read.ok, false);
    assert.equal(read.reason, 'PROVIDER_NEUTRAL_MUTATION_V2_PATCH_IDENTITY_MISMATCH');
    const recovered = await inspectProviderNeutralSourceMutationCheckpointV2Recovery({
      adapter: 'foundry-forge',
      item: f.item,
      processingPath: f.processingPath,
      latestReceipt: { state: 'progress' },
    }, f.options);
    assert.equal(recovered.allowed, false);
    assert.equal(recovered.reason, 'PROVIDER_NEUTRAL_MUTATION_V2_PATCH_IDENTITY_MISMATCH');
    assert.equal(git(f.repoRoot, ['status', '--porcelain=v1']).stdout, '');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('partial or foreign dirt never satisfies the pre-apply checkpoint', async () => {
  const f = await fixture();
  try {
    await prepare(f);
    await writeFile(join(f.repoRoot, SOURCE_PATH), 'export const value = 999;\n');
    const recovered = await inspectProviderNeutralSourceMutationCheckpointV2Recovery({
      adapter: 'foundry-forge',
      item: f.item,
      processingPath: f.processingPath,
      latestReceipt: { state: 'progress' },
    }, f.options);
    assert.equal(recovered.allowed, false);
    assert.equal(recovered.reason, 'PROVIDER_NEUTRAL_MUTATION_V2_WORKTREE_MISMATCH');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('extra changed path blocks even when planned source path matches', async () => {
  const f = await fixture();
  try {
    const prepared = await prepare(f);
    git(f.repoRoot, ['apply', prepared.durablePatchPath]);
    await writeFile(join(f.repoRoot, 'shared', 'agents', 'extra.mjs'), 'export const extra = true;\n');
    const recovered = await inspectProviderNeutralSourceMutationCheckpointV2Recovery({
      adapter: 'foundry-forge',
      item: f.item,
      processingPath: f.processingPath,
      latestReceipt: { state: 'progress' },
    }, f.options);
    assert.equal(recovered.allowed, false);
    assert.equal(recovered.reason, 'PROVIDER_NEUTRAL_MUTATION_V2_CHANGED_SET_MISMATCH');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
