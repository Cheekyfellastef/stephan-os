import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createSourceMutationLeaseRecord,
  createSourceMutationLeaseReleaseRecord,
} from '../../shared/agents/programmeAuthorityV1.mjs';
import { ensureSharedWorkspaceLayout } from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import { SOURCE_MUTATION_LEASE_FILE } from './programmeAuthorityService.js';
import {
  reconcileStaleSourceMutationLease,
} from './sourceMutationLeaseReconciliationService.js';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const NOW = '2026-08-28T14:00:00.000Z';
const HEAD = 'a'.repeat(40);
const LEASE_ID = 'lease-goal-2012-pr-2012-stale';
const LANE_ID = 'goal-2012-pr-2012';
const OWNER = 'chatgpt-github-builder';
const BRANCH = 'codex/ignition-browser-window-idempotence';

function staleLease(overrides = {}) {
  return createSourceMutationLeaseRecord({
    leaseId: LEASE_ID,
    laneId: LANE_ID,
    repository: REPOSITORY,
    issueNumber: 2012,
    prNumber: 2012,
    branch: BRANCH,
    headSha: HEAD,
    ownerId: OWNER,
    acquiredAtUtc: '2026-08-28T10:00:00.000Z',
    expiresAtUtc: '2026-08-28T12:00:00.000Z',
    proofRefs: ['proofs/source-lease-2012.json'],
    ...overrides,
  });
}

function terminalGithub(overrides = {}) {
  return {
    status: 'fetched',
    source: 'github-api',
    repository: REPOSITORY,
    prNumber: 2012,
    prState: 'closed',
    merged: false,
    mergedAt: '',
    mergeCommitSha: '',
    headSha: HEAD,
    headBranch: BRANCH,
    retrievedAt: NOW,
    ...overrides,
  };
}

function terminalReceipt(overrides = {}) {
  return {
    repository: REPOSITORY,
    issueNumber: 2012,
    prNumber: 2012,
    branch: BRANCH,
    sourceHead: HEAD,
    workerId: OWNER,
    executionId: 'execution-2012',
    leaseKey: LEASE_ID,
    state: 'completed',
    ...overrides,
  };
}

function terminalMission(overrides = {}) {
  return {
    missionId: LANE_ID,
    repository: REPOSITORY,
    issueNumber: 2012,
    prNumber: 2012,
    currentPhase: 'COMPLETE',
    finalVerdict: 'MISSION_ORCHESTRATOR_COMPLETE',
    leaseKey: LEASE_ID,
    activeWriter: 'none',
    activeAgent: { status: 'idle' },
    dispatch: {
      status: 'complete',
      workerId: OWNER,
      leaseKey: LEASE_ID,
    },
    git: {
      branch: BRANCH,
      commitSha: HEAD,
    },
    pullRequest: {
      number: 2012,
      headSha: HEAD,
      state: 'closed',
    },
    ...overrides,
  };
}

async function fixture(run) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'programme-authority-stale-lease-'));
  const root = path.join(temp, 'workspace');
  const repoRoot = process.cwd();
  try {
    const layout = await ensureSharedWorkspaceLayout({ root, repoRoot });
    assert.equal(layout.ok, true);
    const lease = staleLease();
    const leasePath = path.join(root, 'status', SOURCE_MUTATION_LEASE_FILE);
    await writeFile(leasePath, `${JSON.stringify(lease, null, 2)}\n`, 'utf8');
    await run({ root, repoRoot, lease, leasePath });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

function options(root, repoRoot, overrides = {}) {
  const github = overrides.github ?? terminalGithub();
  const execution = overrides.execution ?? {
    ok: true,
    reason: 'EXECUTION_RECEIPT_CURRENT',
    receipt: terminalReceipt(),
  };
  const missions = overrides.missions ?? [terminalMission()];
  const dependencies = {
    resolveGithubTokenConfig: async () => ({
      configured: true,
      token: 'test-only-not-published',
      authority: 'test-only',
    }),
    fetchGithubPrEvidence: async () => github,
    readCurrentExecutionReceipt: async () => execution,
    listMissionRecords: async () => missions,
    ...(overrides.dependencies ?? {}),
  };
  return {
    root,
    repoRoot,
    testOnly: true,
    dependencies,
  };
}

async function reconcile(root, repoRoot, input = {}, overrides = {}) {
  return reconcileStaleSourceMutationLease(
    { nowUtc: NOW, ...input },
    options(root, repoRoot, overrides),
  );
}

test('exact terminal PR, execution, mission and worker lineage releases only the historical lease', async () => {
  await fixture(async ({ root, repoRoot, lease, leasePath }) => {
    const result = await reconcile(root, repoRoot);
    assert.equal(result.ok, true);
    assert.equal(result.reconciled, true);
    assert.equal(result.released, true);
    assert.equal(result.leaseSeizureAllowed, false);
    assert.equal(result.successorLeaseClaimed, false);
    assert.equal(result.canonicalAuthority, 'programme-authority-service');
    assert.equal(result.independentReleaseAuthority, false);
    assert.equal(result.exactTerminalLineageProved, true);
    await assert.rejects(readFile(leasePath, 'utf8'), { code: 'ENOENT' });

    const release = createSourceMutationLeaseReleaseRecord(lease, { timestampUtc: NOW });
    const published = JSON.parse(await readFile(path.join(root, 'status', `${release.statusId}.json`), 'utf8'));
    assert.equal(published.leaseId, LEASE_ID);
    assert.equal(published.ownerId, OWNER);

    const replay = await reconcileStaleSourceMutationLease(
      { nowUtc: '2026-08-28T14:01:00.000Z' },
      options(root, repoRoot, {
        dependencies: {
          resolveGithubTokenConfig: async () => {
            throw new Error('no GitHub read is needed after the exact lease is absent');
          },
        },
      }),
    );
    assert.equal(replay.ok, true);
    assert.equal(replay.reconciled, false);
    assert.equal(replay.reason, 'STALE_SOURCE_LEASE_RECONCILIATION_NOT_REQUIRED');
    assert.equal(replay.successorLeaseClaimed, false);
  });
});

test('nonterminal historical PR blocks release', async () => {
  await fixture(async ({ root, repoRoot, leasePath }) => {
    const result = await reconcile(root, repoRoot, {}, {
      github: terminalGithub({ prState: 'open' }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'STALE_SOURCE_LEASE_HISTORICAL_PR_NONTERMINAL');
    assert.equal(typeof await readFile(leasePath, 'utf8'), 'string');
  });
});

test('missing execution lineage blocks release', async () => {
  await fixture(async ({ root, repoRoot, leasePath }) => {
    const result = await reconcile(root, repoRoot, {}, {
      execution: { ok: true, reason: 'NO_EXECUTION_RECEIPTS', receipt: null },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'STALE_SOURCE_LEASE_EXECUTION_LINEAGE_MISSING');
    assert.equal(typeof await readFile(leasePath, 'utf8'), 'string');
  });
});

test('nonterminal execution blocks release', async () => {
  await fixture(async ({ root, repoRoot, leasePath }) => {
    const result = await reconcile(root, repoRoot, {}, {
      execution: {
        ok: true,
        reason: 'EXECUTION_RECEIPT_CURRENT',
        receipt: terminalReceipt({ state: 'progress' }),
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'STALE_SOURCE_LEASE_NONTERMINAL_EXECUTION_PRESENT');
    assert.equal(typeof await readFile(leasePath, 'utf8'), 'string');
  });
});

test('execution identity mismatch blocks release', async () => {
  await fixture(async ({ root, repoRoot, leasePath }) => {
    const result = await reconcile(root, repoRoot, {}, {
      execution: {
        ok: true,
        reason: 'EXECUTION_RECEIPT_CURRENT',
        receipt: terminalReceipt({ workerId: 'different-owner' }),
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'STALE_SOURCE_LEASE_EXECUTION_IDENTITY_MISMATCH');
    assert.equal(typeof await readFile(leasePath, 'utf8'), 'string');
  });
});

test('missing mission and worker lineage blocks release', async () => {
  await fixture(async ({ root, repoRoot, leasePath }) => {
    const result = await reconcile(root, repoRoot, {}, { missions: [] });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'STALE_SOURCE_LEASE_MISSION_LINEAGE_MISSING');
    assert.equal(typeof await readFile(leasePath, 'utf8'), 'string');
  });
});

test('ambiguous mission lineage blocks release', async () => {
  await fixture(async ({ root, repoRoot, leasePath }) => {
    const result = await reconcile(root, repoRoot, {}, {
      missions: [terminalMission(), terminalMission()],
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'STALE_SOURCE_LEASE_MISSION_LINEAGE_AMBIGUOUS');
    assert.equal(typeof await readFile(leasePath, 'utf8'), 'string');
  });
});

test('nonterminal mission or worker blocks release', async () => {
  await fixture(async ({ root, repoRoot, leasePath }) => {
    const result = await reconcile(root, repoRoot, {}, {
      missions: [terminalMission({
        currentPhase: 'AGENT_IMPLEMENTATION',
        activeWriter: OWNER,
        activeAgent: { status: 'running' },
        dispatch: { status: 'running', workerId: OWNER, leaseKey: LEASE_ID },
      })],
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'STALE_SOURCE_LEASE_NONTERMINAL_MISSION_OR_WORKER_PRESENT');
    assert.equal(typeof await readFile(leasePath, 'utf8'), 'string');
  });
});

test('mission branch, head, owner and lease binding must match exactly', async () => {
  for (const mission of [
    terminalMission({ git: { branch: 'codex/different-branch', commitSha: HEAD } }),
    terminalMission({ git: { branch: BRANCH, commitSha: 'b'.repeat(40) } }),
    terminalMission({ dispatch: { status: 'complete', workerId: 'different-owner', leaseKey: LEASE_ID } }),
    terminalMission({ leaseKey: 'different-lease', dispatch: { status: 'complete', workerId: OWNER, leaseKey: 'different-lease' } }),
  ]) {
    await fixture(async ({ root, repoRoot, leasePath }) => {
      const result = await reconcile(root, repoRoot, {}, { missions: [mission] });
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'STALE_SOURCE_LEASE_MISSION_IDENTITY_MISMATCH');
      assert.equal(typeof await readFile(leasePath, 'utf8'), 'string');
    });
  }
});

test('wrong explicitly requested historical lease cannot be reconciled', async () => {
  await fixture(async ({ root, repoRoot, leasePath }) => {
    const result = await reconcile(root, repoRoot, {
      leaseId: 'different-lease',
      laneId: LANE_ID,
      repository: REPOSITORY,
      issueNumber: 2012,
      prNumber: 2012,
      branch: BRANCH,
      headSha: HEAD,
      ownerId: OWNER,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'STALE_SOURCE_LEASE_EXPECTED_IDENTITY_MISMATCH');
    assert.equal(typeof await readFile(leasePath, 'utf8'), 'string');
  });
});

test('Programme Authority operation-lock contention blocks reconciliation', async () => {
  await fixture(async ({ root, repoRoot, leasePath }) => {
    const result = await reconcile(root, repoRoot, {}, {
      dependencies: {
        acquireSharedWorkspaceOperationLock: async () => ({
          ok: false,
          reason: 'SHARED_WORKSPACE_OPERATION_LOCK_TIMEOUT',
        }),
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'STALE_SOURCE_LEASE_RECONCILIATION_BUSY');
    assert.equal(result.release.reason, 'SOURCE_MUTATION_LEASE_OPERATION_BUSY');
    assert.equal(typeof await readFile(leasePath, 'utf8'), 'string');
  });
});

test('canonical release failure blocks and exact replay safely completes interrupted release', async () => {
  await fixture(async ({ root, repoRoot, leasePath }) => {
    const failed = await reconcile(root, repoRoot, {}, {
      dependencies: {
        unlink: async () => {
          const error = new Error('simulated exact canonical release failure');
          error.code = 'EIO';
          throw error;
        },
      },
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.reason, 'STALE_SOURCE_LEASE_CANONICAL_RELEASE_FAILED');
    assert.equal(failed.release.reason, 'SOURCE_MUTATION_LEASE_RELEASE_FAILED');
    assert.equal(typeof await readFile(leasePath, 'utf8'), 'string');

    const recovered = await reconcile(root, repoRoot);
    assert.equal(recovered.ok, true);
    assert.equal(recovered.reconciled, true);
    assert.equal(recovered.release.recoveredInterruptedRelease, true);
    assert.equal(recovered.successorLeaseClaimed, false);
    await assert.rejects(readFile(leasePath, 'utf8'), { code: 'ENOENT' });
  });
});

test('compatibility service delegates release authority and contains no independent mutation plane', async () => {
  const source = await readFile(new URL('./sourceMutationLeaseReconciliationService.js', import.meta.url), 'utf8');
  assert.match(source, /reconcileStaleSourceMutationLeaseWithProgrammeAuthority/);
  assert.doesNotMatch(source, /\bunlink\b/);
  assert.doesNotMatch(source, /\bwriteAtomicJson\b/);
  assert.doesNotMatch(source, /createSourceMutationLeaseReleaseRecord/);
  assert.doesNotMatch(source, /acquireSharedWorkspaceOperationLock/);
  assert.doesNotMatch(source, /readSourceMutationLease/);
});
