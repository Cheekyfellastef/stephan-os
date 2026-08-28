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
import {
  SOURCE_MUTATION_LEASE_FILE,
} from './programmeAuthorityService.js';
import {
  reconcileStaleSourceMutationLease,
} from './sourceMutationLeaseReconciliationService.js';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const NOW = '2026-08-28T14:00:00.000Z';
const HEAD = 'a'.repeat(40);
const LEASE_ID = 'lease-goal-2012-pr-2012-stale';
const LANE_ID = 'goal-2012-pr-2012';
const OWNER = 'codex-app-root';
const BRANCH = 'codex/ignition-browser-window-idempotence';

function staleLease() {
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
  });
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

async function fixture(run) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'stale-source-lease-reconcile-'));
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
  return {
    root,
    repoRoot,
    testOnly: true,
    dependencies: {
      listMissionRecords: async () => [],
      readCurrentExecutionReceipt: async () => ({
        ok: true,
        reason: 'NO_EXECUTION_RECEIPTS',
        receipt: null,
      }),
      ...overrides,
    },
  };
}

test('exact abandoned stale lease is released only after durable release publication', async () => {
  await fixture(async ({ root, repoRoot, lease, leasePath }) => {
    const reconciled = await reconcileStaleSourceMutationLease(
      { nowUtc: NOW },
      options(root, repoRoot),
    );
    assert.equal(reconciled.ok, true);
    assert.equal(reconciled.reconciled, true);
    assert.equal(reconciled.released, true);
    assert.equal(reconciled.leaseSeizureAllowed, false);
    await assert.rejects(readFile(leasePath, 'utf8'), { code: 'ENOENT' });

    const release = createSourceMutationLeaseReleaseRecord(lease, { timestampUtc: NOW });
    const published = JSON.parse(await readFile(path.join(root, 'status', `${release.statusId}.json`), 'utf8'));
    assert.equal(published.leaseId, LEASE_ID);
    assert.equal(published.ownerId, OWNER);

    const replay = await reconcileStaleSourceMutationLease(
      { nowUtc: '2026-08-28T14:01:00.000Z' },
      options(root, repoRoot),
    );
    assert.equal(replay.ok, true);
    assert.equal(replay.reconciled, false);
    assert.equal(replay.reason, 'STALE_SOURCE_LEASE_RECONCILIATION_NOT_REQUIRED');
  });
});

test('running mission owner prevents stale lease release', async () => {
  await fixture(async ({ root, repoRoot, leasePath }) => {
    const reconciled = await reconcileStaleSourceMutationLease(
      { nowUtc: NOW },
      options(root, repoRoot, {
        listMissionRecords: async () => [{
          missionId: LANE_ID,
          dispatch: { status: 'running', workerId: OWNER, actionId: 'action-2012' },
        }],
      }),
    );
    assert.equal(reconciled.ok, false);
    assert.equal(reconciled.reason, 'STALE_SOURCE_LEASE_LIVE_MISSION_OWNER_PRESENT');
    assert.equal(reconciled.leaseSeizureAllowed, false);
    assert.equal(typeof await readFile(leasePath, 'utf8'), 'string');
  });
});

test('nonterminal execution prevents stale lease release', async () => {
  await fixture(async ({ root, repoRoot, leasePath }) => {
    const reconciled = await reconcileStaleSourceMutationLease(
      { nowUtc: NOW },
      options(root, repoRoot, {
        readCurrentExecutionReceipt: async () => ({
          ok: true,
          reason: 'EXECUTION_RECEIPT_CURRENT',
          receipt: terminalReceipt({ state: 'started' }),
        }),
      }),
    );
    assert.equal(reconciled.ok, false);
    assert.equal(reconciled.reason, 'STALE_SOURCE_LEASE_NONTERMINAL_EXECUTION_PRESENT');
    assert.equal(typeof await readFile(leasePath, 'utf8'), 'string');
  });
});

test('terminal execution must match exact lease identity before release', async () => {
  await fixture(async ({ root, repoRoot, leasePath }) => {
    const mismatched = await reconcileStaleSourceMutationLease(
      { nowUtc: NOW },
      options(root, repoRoot, {
        readCurrentExecutionReceipt: async () => ({
          ok: true,
          reason: 'EXECUTION_RECEIPT_CURRENT',
          receipt: terminalReceipt({ workerId: 'different-owner' }),
        }),
      }),
    );
    assert.equal(mismatched.ok, false);
    assert.equal(mismatched.reason, 'STALE_SOURCE_LEASE_EXECUTION_IDENTITY_MISMATCH');
    assert.equal(typeof await readFile(leasePath, 'utf8'), 'string');
  });
});

test('exact terminal execution permits stale lease release', async () => {
  await fixture(async ({ root, repoRoot, leasePath }) => {
    const reconciled = await reconcileStaleSourceMutationLease(
      { nowUtc: NOW },
      options(root, repoRoot, {
        readCurrentExecutionReceipt: async () => ({
          ok: true,
          reason: 'EXECUTION_RECEIPT_CURRENT',
          receipt: terminalReceipt(),
        }),
      }),
    );
    assert.equal(reconciled.ok, true);
    assert.equal(reconciled.released, true);
    assert.equal(reconciled.executionState, 'completed');
    await assert.rejects(readFile(leasePath, 'utf8'), { code: 'ENOENT' });
  });
});
