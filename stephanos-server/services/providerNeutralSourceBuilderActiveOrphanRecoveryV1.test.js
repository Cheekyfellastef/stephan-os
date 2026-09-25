import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectProviderNeutralActiveOrphanRecovery } from './providerNeutralSourceBuilderActiveOrphanRecoveryV1.js';

const HEAD = 'a'.repeat(40);
const OTHER_HEAD = 'b'.repeat(40);

function item(overrides = {}) {
  return {
    schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    adapter: 'foundry-forge',
    actionGrant: {
      schemaVersion: 'stephanos.mission-worker-action-grant.v1',
      headSha: HEAD,
      sourceRevision: HEAD,
    },
    executionBinding: {
      schemaVersion: 'stephanos.mission-worker-queue-execution-binding.v1',
      headSha: HEAD,
      sourceRevision: HEAD,
    },
    payload: {
      schemaVersion: 'stephanos.mission-worker-action.v1',
      actionKind: 'agent-handoff',
      adapter: 'foundry-forge',
      worktreePath: '/tmp/stephanos-active-orphan',
      expectedHeadSha: HEAD,
    },
    ...overrides,
  };
}

function cleanGitRun(observedHead = HEAD, tracked = '', untracked = '') {
  return (_command, args) => {
    if (args.includes('rev-parse')) return { status: 0, stdout: `${observedHead}\n`, stderr: '' };
    if (args.includes('diff')) return { status: 0, stdout: tracked, stderr: '' };
    if (args.includes('ls-files')) return { status: 0, stdout: untracked, stderr: '' };
    throw new Error(`unexpected git probe: ${args.join(' ')}`);
  };
}

for (const receiptState of ['started', 'progress']) {
  test(`${receiptState} provider-neutral orphan may resume only from a clean exact-head worktree`, () => {
    const result = inspectProviderNeutralActiveOrphanRecovery({
      adapter: 'foundry-forge',
      item: item(),
      latestReceipt: { state: receiptState },
    }, {
      runCommand: cleanGitRun(),
    });

    assert.equal(result.allowed, true);
    assert.equal(result.reason, 'PROVIDER_NEUTRAL_ACTIVE_ORPHAN_CLEAN_EXACT_HEAD');
    assert.equal(result.expectedHead, HEAD);
    assert.equal(result.sourceMutationObserved, false);
    assert.equal(result.providerReplayMayOccur, true);
    assert.equal(result.sourceMutationReplayAllowed, false);
  });
}

test('active orphan blocks when exact worktree head drifted', () => {
  const result = inspectProviderNeutralActiveOrphanRecovery({
    adapter: 'chatgpt-github',
    item: item({
      adapter: 'chatgpt-github',
      payload: {
        ...item().payload,
        adapter: 'chatgpt-github',
      },
    }),
    latestReceipt: { state: 'progress' },
  }, {
    runCommand: cleanGitRun(OTHER_HEAD),
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'PROVIDER_NEUTRAL_ACTIVE_ORPHAN_HEAD_DRIFT');
  assert.equal(result.observedHead, OTHER_HEAD);
});

test('active orphan blocks when tracked source dirt exists', () => {
  const result = inspectProviderNeutralActiveOrphanRecovery({
    adapter: 'foundry-forge',
    item: item(),
    latestReceipt: { state: 'progress' },
  }, {
    runCommand: cleanGitRun(HEAD, 'shared/agents/example.mjs\n', ''),
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'PROVIDER_NEUTRAL_ACTIVE_ORPHAN_WORKTREE_NOT_CLEAN');
  assert.deepEqual(result.changedFiles, ['shared/agents/example.mjs']);
});

test('active orphan blocks when a transient patch or other untracked file exists', () => {
  const result = inspectProviderNeutralActiveOrphanRecovery({
    adapter: 'foundry-forge',
    item: item(),
    latestReceipt: { state: 'started' },
  }, {
    runCommand: cleanGitRun(HEAD, '', '.stephanos-action-1.patch\n'),
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'PROVIDER_NEUTRAL_ACTIVE_ORPHAN_WORKTREE_NOT_CLEAN');
  assert.deepEqual(result.changedFiles, ['.stephanos-action-1.patch']);
});

test('active orphan blocks when durable head bindings disagree', () => {
  const candidate = item();
  candidate.executionBinding = { ...candidate.executionBinding, headSha: OTHER_HEAD, sourceRevision: OTHER_HEAD };
  const result = inspectProviderNeutralActiveOrphanRecovery({
    adapter: 'foundry-forge',
    item: candidate,
    latestReceipt: { state: 'progress' },
  }, {
    runCommand: cleanGitRun(),
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'PROVIDER_NEUTRAL_ACTIVE_ORPHAN_HEAD_BINDING_INVALID');
});

test('active orphan never resumes without the fixed Git proof runner', () => {
  const result = inspectProviderNeutralActiveOrphanRecovery({
    adapter: 'foundry-forge',
    item: item(),
    latestReceipt: { state: 'started' },
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'PROVIDER_NEUTRAL_ACTIVE_ORPHAN_RUNNER_REQUIRED');
});

test('stalled state remains reconciliation-only even on a clean worktree', () => {
  const result = inspectProviderNeutralActiveOrphanRecovery({
    adapter: 'foundry-forge',
    item: item(),
    latestReceipt: { state: 'stalled' },
  }, {
    runCommand: cleanGitRun(),
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'PROVIDER_NEUTRAL_ACTIVE_ORPHAN_RECEIPT_STATE_UNSUPPORTED');
});
