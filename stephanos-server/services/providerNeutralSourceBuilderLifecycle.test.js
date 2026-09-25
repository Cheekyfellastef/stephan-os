import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

import { processMissionWorkerAgentClaim } from './missionOrchestratorWorkerConsumer.js';
import { inspectProviderNeutralActiveOrphanRecovery } from './providerNeutralSourceBuilderActiveOrphanRecoveryV1.js';
import {
  createProviderNeutralPatchScratch,
  processNextProviderNeutralSourceBuild,
  proveProviderNeutralWorktreeHead,
  resolveProviderNeutralSourceHeadBinding,
  sameProviderNeutralTransientPatchIdentity,
} from './providerNeutralSourceBuilderService.js';

test('provider-neutral source builder delegates external work to the canonical Mission Worker lifecycle', async () => {
  const calls = [];
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    processAgentClaim: async (adapter, lifecycleOptions, execute) => {
      calls.push({ adapter, lifecycleOptions, execute });
      return {
        processed: true,
        claim: {
          item: {
            payload: {
              missionId: 'critical-2002-provider-neutral-resilience',
              actionId: 'critical-2002-provider-neutral-resilience-r1',
            },
          },
        },
        result: {
          finalVerdict: 'MISSION_WORKER_ITEM_COMPLETE',
          changedFiles: ['shared/agents/example.mjs'],
        },
        executionReceipt: {
          receiptId: 'receipt-provider-neutral-resilience-r1',
          state: 'completed',
        },
        resultPath: 'completed/critical-2002-provider-neutral-resilience-r1.result.json',
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].adapter, 'foundry-forge');
  assert.equal(typeof calls[0].execute, 'function');
  assert.equal(typeof calls[0].lifecycleOptions.runCommand, 'function');
  assert.equal(result.success, true);
  assert.equal(result.finalVerdict, 'PROVIDER_NEUTRAL_SOURCE_CHANGED_AND_TESTED');
  assert.equal(result.executionReceiptId, 'receipt-provider-neutral-resilience-r1');
  assert.equal(result.executionReceiptState, 'completed');
  assert.deepEqual(result.changedFiles, ['shared/agents/example.mjs']);
});

test('provider-neutral source builder keeps independent external adapters productive when one queue is empty', async () => {
  const adapters = [];
  const result = await processNextProviderNeutralSourceBuild({
    processAgentClaim: async (adapter) => {
      adapters.push(adapter);
      if (adapter === 'foundry-forge') return { processed: false, reason: 'queue-empty' };
      return {
        processed: true,
        claim: {
          item: {
            payload: {
              missionId: 'critical-2002-provider-neutral-fallback',
              actionId: 'critical-2002-provider-neutral-fallback-r1',
            },
          },
        },
        result: {
          finalVerdict: 'MISSION_WORKER_ITEM_BLOCKED',
          error: 'bounded provider failure',
          changedFiles: [],
        },
        executionReceipt: {
          receiptId: 'receipt-provider-neutral-fallback-r1',
          state: 'failed',
        },
        resultPath: 'failed/critical-2002-provider-neutral-fallback-r1.result.json',
      };
    },
  });

  assert.deepEqual(adapters, ['foundry-forge', 'chatgpt-github']);
  assert.equal(result.processed, true);
  assert.equal(result.success, false);
  assert.equal(result.adapter, 'chatgpt-github');
  assert.equal(result.executionReceiptState, 'failed');
  assert.equal(result.failureStage, 'WORKER_PRE_PROVIDER');
  assert.equal(result.finalVerdict, 'PROVIDER_NEUTRAL_SOURCE_BUILD_BLOCKED');
});

test('provider-neutral source builder cannot bypass canonical claim/result lifecycle helpers', async () => {
  const source = await readFile(new URL('./providerNeutralSourceBuilderService.js', import.meta.url), 'utf8');
  assert.match(source, /processMissionWorkerAgentClaim/);
  assert.doesNotMatch(source, /claimNextMissionWorkerItem/);
  assert.doesNotMatch(source, /collectAgentWorkerResult/);
});

test('canonical exported agent lifecycle remains limited to registered execution adapters', async () => {
  await assert.rejects(
    () => processMissionWorkerAgentClaim('unregistered-provider', {}, async () => ({ success: true })),
    /MISSION_WORKER_AGENT_ADAPTER_UNSUPPORTED/,
  );
});


test('provider-neutral source builder surfaces an orphan recovery hold instead of reporting queue empty', async () => {
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    processAgentClaim: async () => ({
      processed: false,
      reason: 'MISSION_WORKER_ORPHAN_RECONCILIATION_REQUIRED:progress',
      orphanRecovery: {
        receiptState: 'progress',
        actionId: 'critical-2002-orphan-r1',
      },
    }),
  });

  assert.equal(result.processed, false);
  assert.equal(result.finalVerdict, 'PROVIDER_NEUTRAL_ORPHAN_RECOVERY_HOLD');
  assert.equal(result.reason, 'MISSION_WORKER_ORPHAN_RECONCILIATION_REQUIRED:progress');
  assert.equal(result.orphanRecovery.adapter, 'foundry-forge');
  assert.equal(result.orphanRecovery.detail.receiptState, 'progress');
});


const HEAD = 'a'.repeat(40);
const OTHER_HEAD = 'b'.repeat(40);

function exactHeadClaim(overrides = {}) {
  return {
    item: {
      executionBinding: { headSha: HEAD },
      actionGrant: { headSha: HEAD },
      payload: { expectedHeadSha: HEAD },
      ...overrides,
    },
  };
}

test('provider-neutral source mutation binds canonical queue identities to one exact head', () => {
  assert.equal(resolveProviderNeutralSourceHeadBinding(exactHeadClaim()), HEAD);
});

test('provider-neutral source mutation rejects conflicting queue head identities', () => {
  assert.throws(
    () => resolveProviderNeutralSourceHeadBinding(exactHeadClaim({
      actionGrant: { headSha: OTHER_HEAD },
    })),
    /PROVIDER_NEUTRAL_SOURCE_HEAD_BINDING_MISMATCH/,
  );
});

test('provider-neutral source mutation requires durable head truth', () => {
  assert.throws(
    () => resolveProviderNeutralSourceHeadBinding({
      item: { executionBinding: {}, actionGrant: {}, payload: {} },
    }),
    /PROVIDER_NEUTRAL_SOURCE_HEAD_BINDING_REQUIRED/,
  );
});

test('provider-neutral source mutation fails closed when the worktree head drifts', () => {
  const run = () => ({ status: 0, stdout: `${OTHER_HEAD}\n`, stderr: '' });
  assert.throws(
    () => proveProviderNeutralWorktreeHead('C:\\worktree', HEAD, run, 'AFTER_PROVIDER'),
    new RegExp(`PROVIDER_NEUTRAL_WORKTREE_HEAD_DRIFT:AFTER_PROVIDER:${HEAD}:${OTHER_HEAD}`),
  );
});

test('provider-neutral source mutation accepts the exact claimed worktree head', () => {
  const run = (_exe, args) => {
    assert.deepEqual(args, ['-C', 'C:\\worktree', 'rev-parse', 'HEAD']);
    return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
  };
  assert.equal(proveProviderNeutralWorktreeHead('C:\\worktree', HEAD, run, 'BEFORE_PROVIDER'), HEAD);
});


test('provider-neutral builder preserves terminal orphan reconciliation telemetry without pretending source changed', async () => {
  const terminal = {
    reconciled: true,
    missionId: 'critical-2002-terminal',
    actionId: 'critical-2002-terminal-r1',
    finalVerdict: 'PROVIDER_NEUTRAL_TERMINAL_ORPHAN_RECONCILED',
  };
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    reconcileTerminalOrphan: async () => terminal,
    processAgentClaim: async () => ({ processed: false, reason: 'queue-empty' }),
  });

  assert.equal(result.processed, false);
  assert.equal(result.reason, 'queue-empty');
  assert.deepEqual(result.terminalReconciliation, terminal);
});


test('provider-neutral scratch patch is created outside the source worktree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'provider-neutral-scratch-proof-'));
  const worktree = join(root, 'worktree');
  const scratchRoot = join(root, 'scratch');
  try {
    const scratch = await createProviderNeutralPatchScratch({
      actionId: 'critical-2002-scratch-proof-r1',
    }, {
      scratchRoot,
    });

    const fromWorktree = relative(worktree, scratch.patchPath);
    const fromScratchRoot = relative(scratchRoot, scratch.patchPath);
    assert.ok(fromWorktree.startsWith('..'));
    assert.ok(!fromScratchRoot.startsWith('..'));
    assert.equal(scratch.patchPath.endsWith('source.patch'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('provider-neutral transient patch identity rejects swapped recovery files', () => {
  const original = {
    relativePatchPath: '.stephanos-action-1.patch',
    patchPath: '/tmp/worktree/.stephanos-action-1.patch',
    size: 128,
    mtimeMs: 1_234_567,
    dev: 10,
    ino: 20,
  };
  assert.equal(sameProviderNeutralTransientPatchIdentity(original, { ...original }), true);
  assert.equal(sameProviderNeutralTransientPatchIdentity(original, { ...original, ino: 21 }), false);
  assert.equal(sameProviderNeutralTransientPatchIdentity(original, { ...original, mtimeMs: 1_234_568 }), false);
  assert.equal(sameProviderNeutralTransientPatchIdentity(original, { ...original, patchPath: '/tmp/other.patch' }), false);
});


test('provider-neutral scratch configuration inside the source worktree is rejected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'provider-neutral-scratch-inside-'));
  const worktree = join(root, 'worktree');
  try {
    await assert.rejects(
      createProviderNeutralPatchScratch({
        actionId: 'critical-2002-scratch-inside-r1',
      }, {
        scratchRoot: join(worktree, '.scratch'),
        worktreePath: worktree,
      }),
      /PROVIDER_NEUTRAL_SCRATCH_INSIDE_WORKTREE/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('symlinked scratch root cannot alias back inside the source worktree', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'provider-neutral-scratch-symlink-'));
  const worktree = join(root, 'worktree');
  const hiddenScratch = join(worktree, '.hidden-scratch');
  const scratchAlias = join(root, 'scratch-alias');
  try {
    await mkdir(hiddenScratch, { recursive: true });
    try {
      await symlink(hiddenScratch, scratchAlias, 'dir');
    } catch (error) {
      if (['EPERM', 'EACCES'].includes(error?.code)) {
        t.skip('directory symlinks are unavailable in this environment');
        return;
      }
      throw error;
    }

    await assert.rejects(
      createProviderNeutralPatchScratch({
        actionId: 'critical-2002-scratch-symlink-r1',
      }, {
        scratchRoot: scratchAlias,
        worktreePath: worktree,
      }),
      /PROVIDER_NEUTRAL_SCRATCH_INSIDE_WORKTREE/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('symlinked worktree path cannot hide a scratch directory inside the real worktree', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'provider-neutral-worktree-symlink-'));
  const realWorktree = join(root, 'real-worktree');
  const worktreeAlias = join(root, 'worktree-alias');
  const scratchRoot = join(realWorktree, '.scratch');
  try {
    await mkdir(realWorktree, { recursive: true });
    try {
      await symlink(realWorktree, worktreeAlias, 'dir');
    } catch (error) {
      if (['EPERM', 'EACCES'].includes(error?.code)) {
        t.skip('directory symlinks are unavailable in this environment');
        return;
      }
      throw error;
    }

    await assert.rejects(
      createProviderNeutralPatchScratch({
        actionId: 'critical-2002-worktree-symlink-r1',
      }, {
        scratchRoot,
        worktreePath: worktreeAlias,
      }),
      /PROVIDER_NEUTRAL_SCRATCH_INSIDE_WORKTREE/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy transient patch is identity-revalidated, removed, and regenerated outside the worktree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'provider-neutral-transient-replay-'));
  const worktree = join(root, 'worktree');
  const scratchRoot = join(root, 'scratch');
  const legacyPatch = join(worktree, '.stephanos-action-1.patch');
  const head = 'a'.repeat(40);
  let applied = false;
  try {
    await mkdir(worktree, { recursive: true });
    await writeFile(legacyPatch, 'diff --git a/old b/old\n', { mode: 0o600 });
    const action = {
      schemaVersion: 'stephanos.mission-worker-action.v1',
      actionKind: 'agent-handoff',
      adapter: 'foundry-forge',
      missionId: 'critical-2002-transient-replay',
      actionId: 'action-1',
      worktreePath: worktree,
      expectedHeadSha: head,
      allowedFiles: ['shared/agents/**'],
      requiredTests: [],
    };
    const item = {
      schemaVersion: 'stephanos.mission-worker-queue-item.v1',
      adapter: 'foundry-forge',
      actionId: action.actionId,
      missionId: action.missionId,
      createdAt: '2026-09-25T15:00:00.000Z',
      actionGrant: {
        schemaVersion: 'stephanos.mission-worker-action-grant.v1',
        actionId: action.actionId,
        missionId: action.missionId,
        adapter: 'foundry-forge',
        headSha: head,
        sourceRevision: head,
      },
      executionBinding: {
        schemaVersion: 'stephanos.mission-worker-queue-execution-binding.v1',
        executionId: action.actionId,
        missionId: action.missionId,
        headSha: head,
        sourceRevision: head,
      },
      payload: action,
    };
    const runCommand = (_command, args) => {
      if (args.includes('rev-parse')) return { status: 0, stdout: `${head}\n`, stderr: '' };
      if (args.includes('diff') && args.includes('--name-only')) {
        return { status: 0, stdout: applied ? 'shared/agents/example.mjs\n' : '', stderr: '' };
      }
      if (args.includes('ls-files')) {
        return {
          status: 0,
          stdout: existsSync(legacyPatch) ? '.stephanos-action-1.patch\n' : '',
          stderr: '',
        };
      }
      if (args.includes('apply') && args.includes('--check')) return { status: 0, stdout: '', stderr: '' };
      if (args.includes('apply') && !args.includes('--reverse')) {
        applied = true;
        return { status: 0, stdout: '', stderr: '' };
      }
      throw new Error(`unexpected provider-neutral test command: ${args.join(' ')}`);
    };


    const activeResumeProof = inspectProviderNeutralActiveOrphanRecovery({
      adapter: 'foundry-forge',
      item,
      latestReceipt: { state: 'progress' },
    }, { runCommand });
    assert.equal(activeResumeProof.allowed, true);
    assert.equal(activeResumeProof.transientPatchCleanupRequired, true);

    const result = await processNextProviderNeutralSourceBuild({
      preferredAdapter: 'foundry-forge',
      scratchRoot,
      runCommand,
      generatePatch: async () => ({
        patch: [
          'diff --git a/shared/agents/example.mjs b/shared/agents/example.mjs',
          '--- a/shared/agents/example.mjs',
          '+++ b/shared/agents/example.mjs',
          '@@ -1 +1 @@',
          '-old',
          '+new',
          '',
        ].join('\n'),
        summary: 'regenerated bounded patch',
      }),
      reconcileTerminalOrphan: async () => ({ reconciled: false, reason: 'TERMINAL_ORPHAN_NONE' }),
      captureMutationIdentity: async () => ({
        missionId: action.missionId,
        actionId: action.actionId,
        repository: 'Cheekyfellastef/stephan-os',
        canonicalBranch: 'fix/transient-replay',
        exactParentHead: head,
        exactParentTree: 'b'.repeat(40),
        exactResultTree: 'c'.repeat(40),
        changedFiles: [{
          path: 'shared/agents/example.mjs',
          beforeBlobSha: 'd'.repeat(40),
          afterBlobSha: 'e'.repeat(40),
          sha256: 'f'.repeat(64),
        }],
      }),
      persistMutationCheckpoint: async () => ({
        ok: true,
        reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_PERSISTED',
      }),
      processAgentClaim: async (_adapter, _options, execute) => {
        const claim = {
          adapter: 'foundry-forge',
          item,
          recoveredFromOrphan: true,
          recoveredReceiptState: 'progress',
          activeResumeProof,
        };
        const execution = await execute(action, claim);
        return {
          processed: true,
          claim,
          result: {
            finalVerdict: 'MISSION_WORKER_ITEM_COMPLETE',
            changedFiles: execution.changedFiles,
          },
          executionReceipt: { receiptId: 'receipt-progress', state: 'completed' },
          resultPath: '/tmp/result.json',
        };
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.providerInvoked, true);
    assert.equal(result.transientPatchRecovered, true);
    assert.equal(result.mutationCheckpointPersisted, true);
    await assert.rejects(readFile(legacyPatch, 'utf8'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('failed source tests retire only the exact checkpoint after a proven clean rollback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'provider-neutral-rollback-retire-'));
  const worktree = join(root, 'worktree');
  const scratchRoot = join(root, 'scratch');
  const sourceDir = join(worktree, 'shared', 'agents');
  const sourcePath = join(sourceDir, 'rollback-checkpoint.mjs');
  const relativeSource = 'shared/agents/rollback-checkpoint.mjs';
  const checkpoint = {
    missionId: 'critical-2002-rollback-retire',
    actionId: 'critical-2002-rollback-retire-r1',
    fingerprint: 'checkpoint-proof',
  };
  let retired = 0;

  function git(args) {
    const result = spawnSync('git', args, {
      cwd: worktree,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
    return result;
  }

  try {
    await mkdir(sourceDir, { recursive: true });
    await writeFile(sourcePath, 'export const value = 1;\n');
    git(['init']);
    git(['config', 'user.email', 'rollback@example.invalid']);
    git(['config', 'user.name', 'Rollback Test']);
    git(['add', relativeSource]);
    git(['commit', '-m', 'rollback base']);
    const head = git(['rev-parse', 'HEAD']).stdout.trim().toLowerCase();

    const action = {
      schemaVersion: 'stephanos.mission-worker-action.v1',
      actionKind: 'agent-handoff',
      adapter: 'foundry-forge',
      missionId: checkpoint.missionId,
      actionId: checkpoint.actionId,
      worktreePath: worktree,
      expectedHeadSha: head,
      allowedFiles: ['shared/agents/**'],
      requiredTests: ['node --test intentionally-failing.test.mjs'],
    };
    const item = {
      schemaVersion: 'stephanos.mission-worker-queue-item.v1',
      adapter: 'foundry-forge',
      missionId: action.missionId,
      actionId: action.actionId,
      actionGrant: {
        schemaVersion: 'stephanos.mission-worker-action-grant.v1',
        missionId: action.missionId,
        actionId: action.actionId,
        adapter: 'foundry-forge',
        headSha: head,
      },
      executionBinding: {
        schemaVersion: 'stephanos.mission-worker-queue-execution-binding.v1',
        missionId: action.missionId,
        executionId: action.actionId,
        headSha: head,
      },
      payload: action,
    };
    const claim = { adapter: 'foundry-forge', item };

    const runCommand = (executable, args, options = {}) => {
      if (executable === 'git.exe') {
        return spawnSync('git', args, {
          cwd: options.cwd,
          env: options.env || process.env,
          encoding: 'utf8',
          windowsHide: true,
        });
      }
      if (executable === 'cmd.exe') {
        return { status: 1, stdout: '', stderr: 'intentional test failure' };
      }
      throw new Error(`unexpected command: ${executable}`);
    };

    await assert.rejects(
      processNextProviderNeutralSourceBuild({
        preferredAdapter: 'foundry-forge',
        scratchRoot,
        runCommand,
        generatePatch: async () => ({
          patch: [
            `diff --git a/${relativeSource} b/${relativeSource}`,
            `--- a/${relativeSource}`,
            `+++ b/${relativeSource}`,
            '@@ -1 +1 @@',
            '-export const value = 1;',
            '+export const value = 2;',
            '',
          ].join('\n'),
          summary: 'exercise rollback checkpoint retirement',
        }),
        reconcileTerminalOrphan: async () => ({ reconciled: false, reason: 'TERMINAL_ORPHAN_NONE' }),
        captureMutationIdentity: async () => ({
          missionId: action.missionId,
          actionId: action.actionId,
          repository: 'Cheekyfellastef/stephan-os',
          canonicalBranch: 'fix/rollback-retire',
          exactParentHead: head,
          exactParentTree: 'b'.repeat(40),
          exactResultTree: 'c'.repeat(40),
          changedFiles: [{
            path: relativeSource,
            beforeBlobSha: 'd'.repeat(40),
            afterBlobSha: 'e'.repeat(40),
            sha256: 'f'.repeat(64),
          }],
        }),
        persistMutationCheckpoint: async () => ({
          ok: true,
          reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_PERSISTED',
          checkpoint,
        }),
        retireMutationCheckpoint: async (candidate) => {
          retired += 1;
          assert.equal(candidate, checkpoint);
          assert.equal(await readFile(sourcePath, 'utf8'), 'export const value = 1;\n');
          assert.equal(git(['diff', '--name-only', 'HEAD', '--']).stdout.trim(), '');
          return { ok: true, reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_RETIRED' };
        },
        processAgentClaim: async (_adapter, _options, execute) => {
          await execute(action, claim);
          throw new Error('execution should have failed before claim completion');
        },
      }),
      /PROVIDER_NEUTRAL_TEST_FAILED/,
    );

    assert.equal(retired, 1);
    assert.equal(await readFile(sourcePath, 'utf8'), 'export const value = 1;\n');
    assert.equal(git(['diff', '--name-only', 'HEAD', '--']).stdout.trim(), '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('provider-neutral builder surfaces terminal checkpoint cleanup from canonical worker completion', async () => {
  const cleanup = {
    ok: true,
    reason: 'PROVIDER_NEUTRAL_TERMINAL_CHECKPOINT_RETIRED',
  };
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    reconcileTerminalOrphan: async () => ({
      reconciled: false,
      reason: 'TERMINAL_ORPHAN_NONE',
    }),
    processAgentClaim: async () => ({
      processed: true,
      claim: {
        item: {
          payload: {
            missionId: 'critical-2002-terminal-cleanup',
            actionId: 'critical-2002-terminal-cleanup-r1',
          },
        },
      },
      result: {
        finalVerdict: 'MISSION_WORKER_ITEM_COMPLETE',
        changedFiles: ['shared/agents/example.mjs'],
      },
      executionReceipt: {
        receiptId: 'receipt-terminal-cleanup',
        state: 'completed',
      },
      resultPath: 'completed/critical-2002-terminal-cleanup-r1.result.json',
      terminalCheckpointCleanup: cleanup,
    }),
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.terminalCheckpointCleanup, cleanup);
});
