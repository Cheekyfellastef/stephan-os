import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { captureSourceArtifactIdentityFromWorktreeV1 } from './sourceArtifactEscrowStore.js';
import {
  inspectProviderNeutralAppliedMutationRecoveryV1,
  persistProviderNeutralSourceMutationCheckpointV1,
  readProviderNeutralSourceMutationCheckpointV1,
  retireProviderNeutralSourceMutationCheckpointV1,
} from './providerNeutralSourceMutationCheckpointV1.js';

const MISSION_ID = 'critical-2002-applied-checkpoint';
const ACTION_ID = 'critical-2002-applied-checkpoint-r1';
const SOURCE_PATH = 'shared/agents/checkpoint-fixture.mjs';

function git(cwd, args, env = process.env) {
  const result = spawnSync('git', args, {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result;
}

function runGit(_executable, args, options = {}) {
  return spawnSync('git', args.slice(2), {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    windowsHide: true,
  });
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'provider-neutral-mutation-checkpoint-'));
  const repoRoot = join(root, 'repo');
  const workspaceRoot = join(root, 'workspace');
  const queueRoot = join(root, 'queue');
  await mkdir(repoRoot, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(queueRoot, { recursive: true });

  git(repoRoot, ['init']);
  git(repoRoot, ['config', 'user.email', 'checkpoint@example.invalid']);
  git(repoRoot, ['config', 'user.name', 'Checkpoint Test']);
  await mkdir(join(repoRoot, 'shared', 'agents'), { recursive: true });
  await writeFile(join(repoRoot, SOURCE_PATH), 'export const value = 1;\n');
  git(repoRoot, ['add', SOURCE_PATH]);
  git(repoRoot, ['commit', '-m', 'checkpoint base']);
  const head = git(repoRoot, ['rev-parse', 'HEAD']).stdout.trim().toLowerCase();

  await writeFile(join(repoRoot, SOURCE_PATH), 'export const value = 2;\n');

  const action = {
    schemaVersion: 'stephanos.mission-worker-action.v1',
    actionKind: 'agent-handoff',
    missionId: MISSION_ID,
    actionId: ACTION_ID,
    adapter: 'foundry-forge',
    repository: 'Cheekyfellastef/stephan-os',
    branch: 'fix/applied-checkpoint',
    worktreePath: repoRoot,
    allowedFiles: ['shared/agents/**'],
    requiredTests: ['node --test checkpoint.test.mjs'],
  };
  const item = {
    schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    adapter: 'foundry-forge',
    actionId: ACTION_ID,
    missionId: MISSION_ID,
    actionGrant: {
      schemaVersion: 'stephanos.mission-worker-action-grant.v1',
      missionId: MISSION_ID,
      actionId: ACTION_ID,
      adapter: 'foundry-forge',
      repository: 'Cheekyfellastef/stephan-os',
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

  const identity = await captureSourceArtifactIdentityFromWorktreeV1(
    action,
    {
      success: true,
      changedFiles: [SOURCE_PATH],
      resultId: ACTION_ID,
      completedAt: '2026-09-25T16:05:00.000Z',
    },
    { item, processingPath },
    { runCommand: runGit, actionGrant: item.actionGrant },
  );

  return { root, repoRoot, workspaceRoot, queueRoot, processingPath, action, item, identity, head };
}

function checkpointInput(f, patchSha256 = createHash('sha256').update('patch-v1').digest('hex')) {
  return {
    missionId: MISSION_ID,
    actionId: ACTION_ID,
    adapter: 'foundry-forge',
    repository: f.identity.repository,
    branch: f.identity.canonicalBranch,
    exactParentHead: f.identity.exactParentHead,
    exactParentTree: f.identity.exactParentTree,
    exactResultTree: f.identity.exactResultTree,
    patchSha256,
    changedFiles: f.identity.changedFiles,
    createdAtUtc: '2026-09-25T16:05:00.000Z',
  };
}

test('exact applied source mutation checkpoint is durable, idempotent, and recoverable', async () => {
  const f = await fixture();
  try {
    const options = {
      sharedWorkspaceRoot: f.workspaceRoot,
      repoRoot: f.repoRoot,
      runCommand: runGit,
    };
    const first = await persistProviderNeutralSourceMutationCheckpointV1(checkpointInput(f), options);
    assert.equal(first.ok, true);
    assert.equal(first.reason, 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_PERSISTED');

    const second = await persistProviderNeutralSourceMutationCheckpointV1(checkpointInput(f), options);
    assert.equal(second.ok, true);
    assert.equal(second.reason, 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_IDEMPOTENT');

    const read = await readProviderNeutralSourceMutationCheckpointV1(MISSION_ID, ACTION_ID, options);
    assert.equal(read.ok, true);
    assert.equal(read.checkpoint.exactResultTree, f.identity.exactResultTree);
    assert.deepEqual(read.checkpoint.changedFiles, f.identity.changedFiles);

    const recovered = await inspectProviderNeutralAppliedMutationRecoveryV1({
      adapter: 'foundry-forge',
      item: f.item,
      processingPath: f.processingPath,
      latestReceipt: { state: 'progress' },
    }, options);
    assert.equal(recovered.allowed, true);
    assert.equal(recovered.reason, 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_EXACT_MATCH');
    assert.equal(recovered.resumeStage, 'SOURCE_CHANGED');
    assert.equal(recovered.providerReplayMayOccur, false);
    assert.equal(recovered.sourceMutationReplayAllowed, false);
    assert.deepEqual(recovered.changedFiles, [SOURCE_PATH]);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('conflicting mutation checkpoint cannot replace exact applied truth', async () => {
  const f = await fixture();
  try {
    const options = {
      sharedWorkspaceRoot: f.workspaceRoot,
      repoRoot: f.repoRoot,
      runCommand: runGit,
    };
    assert.equal((await persistProviderNeutralSourceMutationCheckpointV1(checkpointInput(f), options)).ok, true);
    const conflict = await persistProviderNeutralSourceMutationCheckpointV1(
      checkpointInput(f, createHash('sha256').update('different-patch').digest('hex')),
      options,
    );
    assert.equal(conflict.ok, false);
    assert.equal(conflict.reason, 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_CONFLICT');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('checkpoint recovery blocks when tracked source bytes changed after checkpoint', async () => {
  const f = await fixture();
  try {
    const options = {
      sharedWorkspaceRoot: f.workspaceRoot,
      repoRoot: f.repoRoot,
      runCommand: runGit,
    };
    assert.equal((await persistProviderNeutralSourceMutationCheckpointV1(checkpointInput(f), options)).ok, true);
    await writeFile(join(f.repoRoot, SOURCE_PATH), 'export const value = 3;\n');

    const recovered = await inspectProviderNeutralAppliedMutationRecoveryV1({
      adapter: 'foundry-forge',
      item: f.item,
      processingPath: f.processingPath,
      latestReceipt: { state: 'progress' },
    }, options);
    assert.equal(recovered.allowed, false);
    assert.equal(recovered.reason, 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_WORKTREE_MISMATCH');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('checkpoint recovery blocks when any extra changed path appears', async () => {
  const f = await fixture();
  try {
    const options = {
      sharedWorkspaceRoot: f.workspaceRoot,
      repoRoot: f.repoRoot,
      runCommand: runGit,
    };
    assert.equal((await persistProviderNeutralSourceMutationCheckpointV1(checkpointInput(f), options)).ok, true);
    await writeFile(join(f.repoRoot, 'shared', 'agents', 'unexpected.mjs'), 'export const unexpected = true;\n');

    const recovered = await inspectProviderNeutralAppliedMutationRecoveryV1({
      adapter: 'foundry-forge',
      item: f.item,
      processingPath: f.processingPath,
      latestReceipt: { state: 'progress' },
    }, options);
    assert.equal(recovered.allowed, false);
    assert.equal(recovered.reason, 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_CHANGED_SET_MISMATCH');
    assert.deepEqual(recovered.observedPaths, [SOURCE_PATH, 'shared/agents/unexpected.mjs']);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('checkpoint bytes are compact proof only and never contain source file contents', async () => {
  const f = await fixture();
  try {
    const options = {
      sharedWorkspaceRoot: f.workspaceRoot,
      repoRoot: f.repoRoot,
      runCommand: runGit,
    };
    const persisted = await persistProviderNeutralSourceMutationCheckpointV1(checkpointInput(f), options);
    assert.equal(persisted.ok, true);
    const bytes = await readFile(persisted.path, 'utf8');
    assert.doesNotMatch(bytes, /export const value = 2/);
    assert.doesNotMatch(bytes, /contentBase64/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});


test('exact rolled-back mutation checkpoint can be retired idempotently', async () => {
  const f = await fixture();
  try {
    const options = {
      sharedWorkspaceRoot: f.workspaceRoot,
      repoRoot: f.repoRoot,
      runCommand: runGit,
    };
    const persisted = await persistProviderNeutralSourceMutationCheckpointV1(checkpointInput(f), options);
    assert.equal(persisted.ok, true);

    const retired = await retireProviderNeutralSourceMutationCheckpointV1(persisted.checkpoint, options);
    assert.equal(retired.ok, true);
    assert.equal(retired.reason, 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_RETIRED');

    const read = await readProviderNeutralSourceMutationCheckpointV1(MISSION_ID, ACTION_ID, options);
    assert.equal(read.ok, false);
    assert.equal(read.reason, 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_MISSING');

    const repeated = await retireProviderNeutralSourceMutationCheckpointV1(persisted.checkpoint, options);
    assert.equal(repeated.ok, true);
    assert.equal(repeated.reason, 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_ALREADY_ABSENT');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('checkpoint retirement refuses a different mutation identity and preserves canonical proof', async () => {
  const f = await fixture();
  try {
    const options = {
      sharedWorkspaceRoot: f.workspaceRoot,
      repoRoot: f.repoRoot,
      runCommand: runGit,
    };
    const persisted = await persistProviderNeutralSourceMutationCheckpointV1(checkpointInput(f), options);
    assert.equal(persisted.ok, true);

    const conflict = await retireProviderNeutralSourceMutationCheckpointV1(
      checkpointInput(f, createHash('sha256').update('other-rollback').digest('hex')),
      options,
    );
    assert.equal(conflict.ok, false);
    assert.equal(conflict.reason, 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_RETIRE_CONFLICT');

    const read = await readProviderNeutralSourceMutationCheckpointV1(MISSION_ID, ACTION_ID, options);
    assert.equal(read.ok, true);
    assert.equal(read.checkpoint.fingerprint, persisted.checkpoint.fingerprint);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
