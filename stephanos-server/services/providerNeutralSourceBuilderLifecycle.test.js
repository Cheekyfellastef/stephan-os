import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

import { processMissionWorkerAgentClaim } from './missionOrchestratorWorkerConsumer.js';
import { inspectProviderNeutralActiveOrphanRecovery } from './providerNeutralSourceBuilderActiveOrphanRecoveryV1.js';
import { PROVIDER_NEUTRAL_SOURCE_MUTATION_CHECKPOINT_V2_SCHEMA } from './providerNeutralSourceMutationCheckpointV2.js';
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
      prepareMutationCheckpointV2: async () => ({
        ok: true,
        reason: 'PROVIDER_NEUTRAL_MUTATION_V2_PREPARED',
        checkpoint: {
          schemaVersion: PROVIDER_NEUTRAL_SOURCE_MUTATION_CHECKPOINT_V2_SCHEMA,
          exactParentHead: head,
          exactResultTree: 'c'.repeat(40),
          changedPaths: ['shared/agents/example.mjs'],
          patchSha256: 'f'.repeat(64),
        },
        durablePatchPath: join(scratchRoot, 'durable.patch'),
      }),
      inspectMutationCheckpointV2Recovery: async () => ({
        allowed: true,
        reason: 'PROVIDER_NEUTRAL_MUTATION_V2_SOURCE_CHANGED',
        resumeStage: 'SOURCE_CHANGED',
        expectedHead: head,
        expectedResultTree: 'c'.repeat(40),
        changedFiles: ['shared/agents/example.mjs'],
        durablePatchPath: join(scratchRoot, 'durable.patch'),
        checkpoint: {
          schemaVersion: PROVIDER_NEUTRAL_SOURCE_MUTATION_CHECKPOINT_V2_SCHEMA,
          patchSha256: 'f'.repeat(64),
        },
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
    assert.equal(result.mutationCheckpointV2Prepared, true);
    await assert.rejects(readFile(legacyPatch, 'utf8'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('provider-neutral normal source build durably prepares V2 before source apply', async () => {
  const root = await mkdtemp(join(tmpdir(), 'provider-neutral-v2-order-'));
  const worktree = join(root, 'worktree');
  const scratchRoot = join(root, 'scratch');
  const head = 'a'.repeat(40);
  const resultTree = 'b'.repeat(40);
  const events = [];
  let applied = false;
  try {
    await mkdir(worktree, { recursive: true });
    const action = {
      schemaVersion: 'stephanos.mission-worker-action.v1',
      actionKind: 'agent-handoff',
      adapter: 'foundry-forge',
      missionId: 'critical-2002-v2-order',
      actionId: 'critical-2002-v2-order-r1',
      repository: 'Cheekyfellastef/stephan-os',
      branch: 'fix/v2-order',
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
      actionGrant: {
        schemaVersion: 'stephanos.mission-worker-action-grant.v1',
        actionId: action.actionId,
        missionId: action.missionId,
        adapter: 'foundry-forge',
        repository: action.repository,
        branch: action.branch,
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
    const durablePatchPath = join(root, 'durable.patch');
    const runCommand = (_command, args) => {
      if (args.includes('rev-parse')) return { status: 0, stdout: `${head}\n`, stderr: '' };
      if (args.includes('diff') && args.includes('--name-only')) {
        return { status: 0, stdout: applied ? 'shared/agents/example.mjs\n' : '', stderr: '' };
      }
      if (args.includes('ls-files')) return { status: 0, stdout: '', stderr: '' };
      if (args.includes('apply') && args.includes('--check')) {
        events.push('apply-check');
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args.includes('apply') && !args.includes('--reverse')) {
        events.push('apply');
        applied = true;
        return { status: 0, stdout: '', stderr: '' };
      }
      throw new Error(`unexpected V2 ordering command: ${args.join(' ')}`);
    };

    const result = await processNextProviderNeutralSourceBuild({
      preferredAdapter: 'foundry-forge',
      scratchRoot,
      runCommand,
      generatePatch: async () => {
        events.push('provider');
        return {
          patch: [
            'diff --git a/shared/agents/example.mjs b/shared/agents/example.mjs',
            '--- a/shared/agents/example.mjs',
            '+++ b/shared/agents/example.mjs',
            '@@ -1 +1 @@',
            '-old',
            '+new',
            '',
          ].join('\n'),
          summary: 'V2 ordering proof',
        };
      },
      reconcileTerminalOrphan: async () => ({ reconciled: false, reason: 'TERMINAL_ORPHAN_NONE' }),
      prepareMutationCheckpointV2: async () => {
        events.push('prepare-v2');
        assert.equal(applied, false);
        return {
          ok: true,
          reason: 'PROVIDER_NEUTRAL_MUTATION_V2_PREPARED',
          checkpoint: {
            schemaVersion: PROVIDER_NEUTRAL_SOURCE_MUTATION_CHECKPOINT_V2_SCHEMA,
            exactParentHead: head,
            exactResultTree: resultTree,
            changedPaths: ['shared/agents/example.mjs'],
            patchSha256: 'c'.repeat(64),
          },
          durablePatchPath,
        };
      },
      inspectMutationCheckpointV2Recovery: async () => {
        events.push('inspect-applied-v2');
        assert.equal(applied, true);
        return {
          allowed: true,
          reason: 'PROVIDER_NEUTRAL_MUTATION_V2_SOURCE_CHANGED',
          resumeStage: 'SOURCE_CHANGED',
          expectedHead: head,
          expectedResultTree: resultTree,
          changedFiles: ['shared/agents/example.mjs'],
          durablePatchPath,
          checkpoint: {
            schemaVersion: PROVIDER_NEUTRAL_SOURCE_MUTATION_CHECKPOINT_V2_SCHEMA,
            patchSha256: 'c'.repeat(64),
          },
        };
      },
      processAgentClaim: async (_adapter, _options, execute) => {
        const claim = { adapter: 'foundry-forge', item, processingPath: join(root, 'processing.json') };
        const execution = await execute(action, claim);
        return {
          processed: true,
          claim,
          result: {
            finalVerdict: 'MISSION_WORKER_ITEM_COMPLETE',
            changedFiles: execution.changedFiles,
          },
          executionReceipt: { receiptId: 'v2-order-receipt', state: 'completed' },
          resultPath: join(root, 'result.json'),
        };
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.providerInvoked, true);
    assert.equal(result.mutationCheckpointV2Prepared, true);
    assert.ok(events.indexOf('prepare-v2') > events.indexOf('provider'));
    assert.ok(events.indexOf('apply') > events.indexOf('prepare-v2'));
    assert.ok(events.indexOf('inspect-applied-v2') > events.indexOf('apply'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('PATCH_PREPARED recovery applies durable V2 patch without provider replay', async () => {
  const root = await mkdtemp(join(tmpdir(), 'provider-neutral-v2-prepared-recovery-'));
  const worktree = join(root, 'worktree');
  const head = 'd'.repeat(40);
  const resultTree = 'e'.repeat(40);
  const durablePatchPath = join(root, 'durable.patch');
  let applied = false;
  let inspections = 0;
  try {
    await mkdir(worktree, { recursive: true });
    await writeFile(durablePatchPath, 'durable-v2-patch');
    const action = {
      schemaVersion: 'stephanos.mission-worker-action.v1',
      actionKind: 'agent-handoff',
      adapter: 'foundry-forge',
      missionId: 'critical-2002-v2-prepared-recovery',
      actionId: 'critical-2002-v2-prepared-recovery-r1',
      repository: 'Cheekyfellastef/stephan-os',
      branch: 'fix/v2-prepared-recovery',
      worktreePath: worktree,
      expectedHeadSha: head,
      allowedFiles: ['shared/agents/**'],
      requiredTests: [],
    };
    const checkpoint = {
      schemaVersion: PROVIDER_NEUTRAL_SOURCE_MUTATION_CHECKPOINT_V2_SCHEMA,
      patchSha256: 'f'.repeat(64),
      exactParentHead: head,
      exactResultTree: resultTree,
      changedPaths: ['shared/agents/example.mjs'],
    };
    const item = {
      schemaVersion: 'stephanos.mission-worker-queue-item.v1',
      adapter: 'foundry-forge',
      actionId: action.actionId,
      missionId: action.missionId,
      actionGrant: {
        schemaVersion: 'stephanos.mission-worker-action-grant.v1',
        actionId: action.actionId,
        missionId: action.missionId,
        adapter: 'foundry-forge',
        repository: action.repository,
        branch: action.branch,
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
      if (args.includes('apply') && args.includes('--check')) return { status: 0, stdout: '', stderr: '' };
      if (args.includes('apply') && !args.includes('--reverse')) {
        applied = true;
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args.includes('diff') && args.includes('--name-only')) {
        return { status: 0, stdout: applied ? 'shared/agents/example.mjs\n' : '', stderr: '' };
      }
      if (args.includes('ls-files')) return { status: 0, stdout: '', stderr: '' };
      throw new Error(`unexpected prepared recovery command: ${args.join(' ')}`);
    };

    const result = await processNextProviderNeutralSourceBuild({
      preferredAdapter: 'foundry-forge',
      runCommand,
      generatePatch: async () => {
        throw new Error('provider must not run during PATCH_PREPARED recovery');
      },
      reconcileTerminalOrphan: async () => ({ reconciled: false, reason: 'TERMINAL_ORPHAN_NONE' }),
      inspectMutationCheckpointV2Recovery: async () => {
        inspections += 1;
        if (inspections === 1) {
          assert.equal(applied, false);
          return {
            allowed: true,
            reason: 'PROVIDER_NEUTRAL_MUTATION_V2_PATCH_PREPARED',
            resumeStage: 'PATCH_PREPARED',
            expectedHead: head,
            expectedResultTree: resultTree,
            changedFiles: ['shared/agents/example.mjs'],
            durablePatchPath,
            checkpoint,
          };
        }
        assert.equal(applied, true);
        return {
          allowed: true,
          reason: 'PROVIDER_NEUTRAL_MUTATION_V2_SOURCE_CHANGED',
          resumeStage: 'SOURCE_CHANGED',
          expectedHead: head,
          expectedResultTree: resultTree,
          changedFiles: ['shared/agents/example.mjs'],
          durablePatchPath,
          checkpoint,
        };
      },
      processAgentClaim: async (_adapter, _options, execute) => {
        const claim = {
          adapter: 'foundry-forge',
          item,
          processingPath: join(root, 'processing.json'),
          recoveredFromOrphan: true,
          recoveredReceiptState: 'progress',
          activeResumeProof: {
            allowed: true,
            reason: 'PROVIDER_NEUTRAL_MUTATION_V2_PATCH_PREPARED',
            resumeStage: 'PATCH_PREPARED',
            expectedHead: head,
            expectedResultTree: resultTree,
            changedFiles: ['shared/agents/example.mjs'],
            durablePatchPath,
            checkpoint,
          },
        };
        const execution = await execute(action, claim);
        return {
          processed: true,
          claim,
          result: {
            finalVerdict: 'MISSION_WORKER_ITEM_COMPLETE',
            changedFiles: execution.changedFiles,
          },
          executionReceipt: { receiptId: 'v2-prepared-receipt', state: 'completed' },
          resultPath: join(root, 'result.json'),
        };
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.providerInvoked, false);
    assert.equal(result.mutationCheckpointRecovered, true);
    assert.equal(result.mutationCheckpointV2PreparedRecovered, true);
    assert.equal(inspections, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
