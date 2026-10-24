import { buildMissionWorkerAction } from '../../shared/agents/missionOrchestratorWorker.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { appendExecutionReceipt, readExecutionReceiptHistory, validateExecutionReceipt } from '../../shared/agents/executionReceiptV1.mjs';

import { dispatchElasticGoalBuildsFromCanonicalMain } from './criticalBacklogConveyorService.js';
import {
  dispatchElasticPrHeadBuildsFromCanonicalLease,
  exactElasticPrHeadIdentity,
  inspectOriginalTerminalWorkerPairV1,
  reconcileExpiredElasticReviewLeaseV1,
} from './elasticPrHeadLeaseService.js';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const SOURCE = 'b'.repeat(40);
const HEAD_A = 'a'.repeat(40);
const HEAD_C = 'c'.repeat(40);
const NOW = new Date('2026-09-08T10:00:00.000Z');
const PATHS = {
  workspaceRoot: '/workspace',
  repoRoot: '/repo',
  orchestratorRoot: '/orchestrator',
  snapshotRoot: '/snapshot',
};

function mission(issueNumber, prNumber, headSha, overrides = {}) {
  const missionId = `critical-${issueNumber}-elastic-goal`;
  return {
    missionId,
    revision: 7,
    currentPhase: 'CHECK_PULL_REQUEST',
    repository: REPOSITORY,
    git: {
      branch: `openclaw/elastic-goal-${issueNumber}`,
      worktreePath: `/worktrees/${missionId}`,
    },
    pullRequest: { number: prNumber, headSha },
    allowedFiles: [`shared/agents/goal-${issueNumber}.mjs`],
    requiredTests: [`node --test shared/agents/goal-${issueNumber}.test.mjs`],
    requiredEvidence: [`goal-${issueNumber}-proof`],
    evidenceReceipts: [{
      receiptId: `goal-${issueNumber}-source-proof`, requirement: `goal-${issueNumber}-proof`,
      source: 'mission-orchestrator', evidenceType: 'command-output',
      verified: true, commandOutputHash: 'f'.repeat(64),
    }],
    dispatch: { status: 'idle' },
    ...overrides,
  };
}

function leaseFor(candidate, overrides = {}) {
  const identity = exactElasticPrHeadIdentity(candidate);
  return {
    leaseId: `${identity.missionId}-r${candidate.revision}-lease`,
    laneId: identity.missionId,
    repository: identity.repository,
    issueNumber: identity.issueNumber,
    prNumber: identity.prNumber,
    branch: identity.branch,
    headSha: identity.headSha,
    ownerId: 'mission-worker',
    ...overrides,
  };
}

function admission(missions, selectedMission = missions[0]) {
  return {
    desiredWidth: 5,
    selectedMission,
    elasticMissions: missions,
    activeMissions: missions,
    runnableMissions: missions.filter((item) => item.currentPhase !== 'AWAITING_OPERATOR_APPROVAL'),
  };
}

test('exact identity exists only after an elastic mission owns a PR head', () => {
  const exact = mission(1802, 2096, HEAD_A);
  assert.deepEqual(exactElasticPrHeadIdentity(exact), {
    missionId: 'critical-1802-elastic-goal',
    issueNumber: 1802,
    prNumber: 2096,
    headSha: HEAD_A,
    branch: 'openclaw/elastic-goal-1802',
    repository: REPOSITORY,
  });
  assert.equal(exactElasticPrHeadIdentity({
    ...exact,
    pullRequest: null,
  }), null);
});

test('claims the canonical lease before publishing one exact PR-head worker grant', async () => {
  const candidate = mission(1802, 2096, HEAD_A);
  const calls = [];
  let claimedRecord = null;
  const result = await dispatchElasticPrHeadBuildsFromCanonicalLease(admission([candidate]), {
    testOnly: true,
    now: NOW,
    paths: PATHS,
    sourceRevision: SOURCE,
    readSourceMutationLease: async () => ({ ok: true, present: false, reason: 'SOURCE_MUTATION_LEASE_NOT_CLAIMED' }),
    claimSourceMutationLease: async (input) => {
      calls.push(['claim', input]);
      claimedRecord = { ...input };
      return { ok: true, claimed: true, record: claimedRecord };
    },
    renewSourceMutationLease: async () => {
      throw new Error('renew must not run on first claim');
    },
    releaseSourceMutationLease: async () => {
      throw new Error('release must not run on active work');
    },
    readExecutionReceiptHistory: async () => ({ ok: true, receipts: [], latestReceipt: null }),
    appendExecutionReceipt: async (root, receipt) => {
      calls.push(['receipt', receipt]);
      return { ok: true };
    },
    isActionInFlight: async () => false,
    publishWorkerAction: async (options) => {
      calls.push(['publish', options.actionGrant]);
      return {
        published: true,
        actionGrantAccepted: true,
        adapter: 'openclaw-github-readonly',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_PR_HEAD_DISPATCH_LIVE');
  assert.equal(result.dispatchCount, 1);
  assert.deepEqual(result.newlyOccupiedMissionIds, ['critical-1802-elastic-goal']);
  assert.equal(calls[0][0], 'receipt');
  assert.equal(calls[0][1].state, 'queued');
  assert.equal(calls[0][1].leaseKey, claimedRecord.leaseId);
  assert.equal(calls[1][0], 'claim');
  assert.equal(calls[1][1].prNumber, 2096);
  assert.equal(calls[1][1].headSha, HEAD_A);
  assert.equal(calls[1][1].branch, 'openclaw/elastic-goal-1802');
  assert.equal(calls[1][1].ownerId, 'mission-worker');
  assert.equal(calls[2][0], 'publish');
  assert.equal(calls[2][1].prNumber, 2096);
  assert.equal(calls[2][1].headSha, HEAD_A);
  assert.equal(calls[2][1].laneId, 'critical-1802-elastic-goal');
  assert.equal(calls[2][1].boundedActionCount, 1);
  assert.equal(calls[2][1].mergeAuthority, false);
  assert.equal(calls[2][1].leaseSeizureAllowed, false);
  assert.deepEqual(result.activeLease, claimedRecord);
});

test('renews an exact running PR-head lease without publishing a duplicate action', async () => {
  const candidate = mission(1802, 2096, HEAD_A, { dispatch: { status: 'running' } });
  const lease = leaseFor(candidate);
  let renewCount = 0;
  let publishCount = 0;
  const result = await dispatchElasticPrHeadBuildsFromCanonicalLease(admission([candidate]), {
    now: NOW,
    paths: PATHS,
    sourceRevision: SOURCE,
    readSourceMutationLease: async () => ({ ok: true, present: true, reason: 'SOURCE_MUTATION_LEASE_ACTIVE', record: lease }),
    renewSourceMutationLease: async (input) => {
      renewCount += 1;
      assert.equal(input.leaseId, lease.leaseId);
      assert.equal(input.headSha, HEAD_A);
      return { ok: true, renewed: true, record: lease };
    },
    claimSourceMutationLease: async () => {
      throw new Error('claim must not run for an exact active lease');
    },
    releaseSourceMutationLease: async () => {
      throw new Error('release must not run for active source work');
    },
    publishWorkerAction: async () => {
      publishCount += 1;
      return { published: true, actionGrantAccepted: true };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_PR_HEAD_LEASE_ALREADY_RUNNING');
  assert.equal(renewCount, 1);
  assert.equal(publishCount, 0);
});

test('releases a parked exact lease and refills the same lease slot with the next PR-head mission', async () => {
  const parked = mission(1802, 2096, HEAD_A, {
    currentPhase: 'AWAITING_OPERATOR_APPROVAL',
    dispatch: { status: 'complete', resultId: 'critical-1802-elastic-goal-r7-123456789abc' },
  });
  const next = mission(1899, 1920, HEAD_C);
  const parkedLease = leaseFor(parked);
  const terminal = { state: 'completed', executionId: parked.dispatch.resultId, leaseKey: parkedLease.leaseId,
    sourceHead: parkedLease.headSha, repository: parkedLease.repository,
    issueNumber: parkedLease.issueNumber, prNumber: parkedLease.prNumber, branch: parkedLease.branch };
  const calls = [];
  const result = await dispatchElasticPrHeadBuildsFromCanonicalLease(admission([parked, next], parked), {
    now: NOW,
    paths: PATHS,
    sourceRevision: SOURCE,
    runWithMissionStatePrecondition: async (_id, _expected, operation) => ({ preconditionFailed: false, result: await operation(parked) }),
    readOriginalSourceExecutionId: async (current) => current.dispatch.resultId,
    originalMissionInFlightFn: async () => false,
    readSourceMutationLease: async () => ({ ok: true, present: true, reason: 'SOURCE_MUTATION_LEASE_ACTIVE', record: parkedLease }),
    releaseSourceMutationLease: async (input) => {
      calls.push(['release', input]);
      return { ok: true, released: true, reason: 'SOURCE_MUTATION_LEASE_RELEASED' };
    },
    claimSourceMutationLease: async (input) => {
      calls.push(['claim', input]);
      return { ok: true, claimed: true, record: { ...input } };
    },
    renewSourceMutationLease: async () => {
      throw new Error('renew must not run after parked lease release');
    },
    readExecutionReceiptHistory: async (_root, filters) => filters.leaseKey === parkedLease.leaseId
      || filters.executionId === terminal.executionId
      ? { ok: true, receipts: [terminal], latestReceipt: terminal }
      : { ok: true, receipts: [], latestReceipt: null },
    appendExecutionReceipt: async () => ({ ok: true }),
    isActionInFlight: async () => false,
    publishWorkerAction: async (options) => {
      calls.push(['publish', options.actionGrant]);
      return { published: true, actionGrantAccepted: true, adapter: 'openclaw-github-readonly' };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_PR_HEAD_DISPATCH_LIVE');
  assert.equal(calls[0][0], 'release');
  assert.equal(calls[0][1].prNumber, 2096);
  assert.equal(calls[1][0], 'claim');
  assert.equal(calls[1][1].prNumber, 1920);
  assert.equal(calls[1][1].headSha, HEAD_C);
  assert.equal(calls[2][0], 'publish');
  assert.equal(calls[2][1].prNumber, 1920);
  assert.equal(result.releasedLease.ok, true);
});

test('BLOCKED source owner cannot release a terminal receipt with idle queue without an original-writer fence', async () => {
  const parked = mission(2962, 2987, HEAD_A, {
    currentPhase: 'BLOCKED',
    dispatch: { status: 'complete', resultId: 'critical-2962-elastic-goal-r7-123456789abc' },
  });
  const lease = leaseFor(parked);
  const terminal = { state: 'completed', executionId: parked.dispatch.resultId, leaseKey: lease.leaseId,
    sourceHead: lease.headSha, repository: lease.repository, issueNumber: lease.issueNumber,
    prNumber: lease.prNumber, branch: lease.branch };
  let mutationCount = 0;
  const result = await dispatchElasticPrHeadBuildsFromCanonicalLease(admission([parked]), {
    now: NOW, paths: PATHS, sourceRevision: SOURCE,
    readSourceMutationLease: async () => ({ ok: true, present: true, record: lease }),
    runWithMissionStatePrecondition: async (_id, _expected, operation) =>
      ({ preconditionFailed: false, result: await operation(parked) }),
    readOriginalSourceExecutionId: async () => parked.dispatch.resultId,
    readExecutionReceiptHistory: async () => ({ ok: true, receipts: [terminal], latestReceipt: terminal }),
    originalMissionInFlightFn: async () => false,
    releaseSourceMutationLease: async () => { mutationCount++; return { ok: true, released: true }; },
    claimSourceMutationLease: async () => { mutationCount++; return { ok: true, claimed: true }; },
    publishWorkerAction: async () => { mutationCount++; return { published: true }; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.held[0].reason, 'PARKED_ORIGINAL_AUTHENTICATED_FENCE_REQUIRED');
  assert.equal(result.activeLease.leaseId, lease.leaseId);
  assert.equal(mutationCount, 0);
});

test('a lease owned by another canonical lane blocks PR-head takeover without seizure', async () => {
  const candidate = mission(1802, 2096, HEAD_A);
  const foreign = {
    ...leaseFor(candidate),
    laneId: 'critical-1899-elastic-goal',
    issueNumber: 1899,
    prNumber: 1920,
    branch: 'openclaw/elastic-goal-1899',
    headSha: HEAD_C,
  };
  let claimCount = 0;
  let publishCount = 0;
  const result = await dispatchElasticPrHeadBuildsFromCanonicalLease(admission([candidate]), {
    now: NOW,
    paths: PATHS,
    sourceRevision: SOURCE,
    readSourceMutationLease: async () => ({ ok: true, present: true, reason: 'SOURCE_MUTATION_LEASE_ACTIVE', record: foreign }),
    claimSourceMutationLease: async () => {
      claimCount += 1;
      return { ok: true };
    },
    renewSourceMutationLease: async () => ({ ok: true }),
    releaseSourceMutationLease: async () => ({ ok: true }),
    publishWorkerAction: async () => {
      publishCount += 1;
      return { published: true, actionGrantAccepted: true };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_PR_HEAD_LEASE_OCCUPIED');
  assert.equal(result.held[0].reason, 'SOURCE_MUTATION_LEASE_OWNED_BY_OTHER_LANE');
  assert.equal(result.leaseSeizureAllowed, false);
  assert.equal(claimCount, 0);
  assert.equal(publishCount, 0);
});

test('parking or STOP cannot release an orphan lease, even when the worker is idle', async () => {
  for (const phase of ['BLOCKED', 'CANCELLED', 'COMPLETE', 'AWAITING_OPERATOR_APPROVAL', 'MERGE_PULL_REQUEST']) {
    const parked = mission(2962, 2987, HEAD_A, { currentPhase: phase, dispatch: { status: 'complete' } });
    const lease = leaseFor(parked);
    let mutations = 0;
    const result = await dispatchElasticPrHeadBuildsFromCanonicalLease(admission([parked]), {
      now: NOW, paths: PATHS, sourceRevision: SOURCE,
      readSourceMutationLease: async () => ({ ok: true, present: true, record: lease }),
      runWithMissionStatePrecondition: async (_id, expected, operation) => {
        assert.equal(expected.expectedRevision, 7);
        assert.equal(expected.expectedCurrentPhase, phase);
        return { preconditionFailed: false, result: await operation(parked) };
      },
      readExecutionReceiptHistory: async () => ({ ok: true, receipts: [], latestReceipt: null }),
      originalMissionInFlightFn: async () => false,
      releaseSourceMutationLease: async () => { mutations++; },
      claimSourceMutationLease: async () => { mutations++; },
      publishWorkerAction: async () => { mutations++; },
    });
    assert.equal(result.ok, false);
    assert.equal(result.held[0].reason, 'PARKED_ORIGINAL_TERMINAL_EXECUTION_UNPROVEN');
    assert.equal(result.activeLease.leaseId, lease.leaseId);
    assert.equal(mutations, 0);
  }
});

test('parked lease release holds on original identity, queue uncertainty, running writer or re-entry race', async () => {
  const parked = mission(2962, 2987, HEAD_A, { currentPhase: 'BLOCKED',
    dispatch: { status: 'complete', resultId: 'critical-2962-elastic-goal-r7-123456789abc' } });
  const lease = leaseFor(parked);
  const terminal = { state: 'failed', executionId: parked.dispatch.resultId, leaseKey: lease.leaseId, sourceHead: HEAD_A,
    repository: REPOSITORY, issueNumber: 2962, prNumber: 2987, branch: lease.branch };
  const cases = [
    { receipt: { ...terminal, sourceHead: HEAD_C }, reason: 'PARKED_ORIGINAL_TERMINAL_IDENTITY_MISMATCH' },
    { receipt: { ...terminal, prNumber: 3000 }, reason: 'PARKED_ORIGINAL_TERMINAL_IDENTITY_MISMATCH' },
    { receipt: { ...terminal, leaseKey: lease.laneId + '-r6-lease' }, reason: 'PARKED_ORIGINAL_TERMINAL_IDENTITY_MISMATCH' },
    { receipt: { ...terminal, state: 'started' }, reason: 'PARKED_ORIGINAL_TERMINAL_EXECUTION_UNPROVEN' },
    { hiddenActive: true, reason: 'PARKED_ORIGINAL_TERMINAL_EXECUTION_UNPROVEN' },
    { missingOriginal: true, reason: 'PARKED_ORIGINAL_SOURCE_EXECUTION_UNPROVEN' },
    { originalActive: true, reason: 'PARKED_ORIGINAL_SOURCE_EXECUTION_UNPROVEN' },
    { originalMismatch: true, reason: 'PARKED_ORIGINAL_SOURCE_EXECUTION_UNPROVEN' },
    { missingResultId: true, reason: 'PARKED_ORIGINAL_SOURCE_EXECUTION_UNPROVEN' },
    { inFlight: true, reason: 'PARKED_ORIGINAL_WORK_STILL_IN_FLIGHT' },
    { inFlight: undefined, reason: 'PARKED_ORIGINAL_WORK_STILL_IN_FLIGHT' },
    { queueThrows: true, reason: 'PARKED_ORIGINAL_WRITER_PROOF_UNOBSERVABLE' },
    { running: true, reason: 'PARKED_ORIGINAL_DISPATCH_STILL_RUNNING' },
    { resumed: true, reason: 'PARKED_ORIGINAL_MISSION_STATE_CHANGED' },
  ];
  for (const scenario of cases) {
    let releases = 0;
    const receipt = scenario.receipt || terminal;
    const result = await dispatchElasticPrHeadBuildsFromCanonicalLease(admission([parked]), {
      now: NOW, paths: PATHS, sourceRevision: SOURCE,
      readSourceMutationLease: async () => ({ ok: true, present: true, record: lease }),
      readExecutionReceiptHistory: async (_root, filters) => {
        if (filters.executionId) {
          assert.equal(filters.executionId, parked.dispatch.resultId);
          if (scenario.missingOriginal) return { ok: true, receipts: [], latestReceipt: null };
          const original = scenario.originalActive ? { ...terminal, state: 'started' }
            : scenario.originalMismatch ? { ...terminal, executionId: 'another-check' } : terminal;
          return { ok: true, receipts: [original], latestReceipt: original };
        }
        const receipts = scenario.hiddenActive
          ? [{ ...terminal, executionId: 'earlier-source-writer', state: 'started' }, receipt] : [receipt];
        return { ok: true, receipts, latestReceipt: receipt };
      },
      readOriginalSourceExecutionId: async (current) => current.dispatch.resultId,
      runWithMissionStatePrecondition: async (_id, _expected, operation) => scenario.resumed
        ? { preconditionFailed: true, result: null }
        : { preconditionFailed: false, result: await operation(scenario.running
          ? { ...parked, dispatch: { status: 'running' } }
          : scenario.missingResultId ? { ...parked, dispatch: { status: 'complete' } } : parked) },
      originalMissionInFlightFn: async () => {
        if (scenario.queueThrows) throw Error('unobservable');
        return Object.hasOwn(scenario, 'inFlight') ? scenario.inFlight : false;
      },
      releaseSourceMutationLease: async () => { releases++; return { ok: true, released: true }; },
      claimSourceMutationLease: async () => { throw Error('no refill permitted'); },
    });
    assert.equal(result.held[0].reason, scenario.reason);
    assert.equal(releases, 0);
  }
});

test('canonical consumed action binds opaque provider result IDs to the original receipt across lease revisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'parked-source-action-binding-'));
  const originalActionId = 'critical-2962-elastic-goal-r1-123456789abc';
  const checkActionId = 'critical-2962-elastic-goal-r7-abcdef123456';
  const eventId = `result-${originalActionId}`;
  try {
    for (const scenario of [
      { providerResultId: `stephanos-native-${originalActionId}`, releases: 1 },
      { providerResultId: 'provider-opaque-result-001', releases: 1 },
      { duplicate: true, releases: 0 },
      { unprocessed: true, releases: 0 },
      { otherMission: true, releases: 0 },
      { wrongResult: true, releases: 0 },
      { malformedAction: true, releases: 0 },
      { missingLog: true, releases: 0 },
    ]) {
      const resultId = scenario.providerResultId || `stephanos-native-${originalActionId}`;
      const parked = mission(2962, 2987, HEAD_A, { currentPhase: 'MERGE_PULL_REQUEST',
        dispatch: { adapter: 'stephanos-native', status: 'complete', resultId },
        storeMetadata: { processedEventIds: scenario.unprocessed ? [] : [eventId] } });
      const lease = leaseFor(parked);
      const terminal = { state: 'completed', executionId: checkActionId, leaseKey: lease.leaseId,
        sourceHead: HEAD_A, repository: REPOSITORY, issueNumber: 2962, prNumber: 2987, branch: lease.branch };
      const original = { ...terminal, executionId: originalActionId,
        leaseKey: 'critical-2962-elastic-goal-r1-lease', sourceHead: SOURCE, prNumber: 0 };
      const event = { eventId: scenario.malformedAction ? 'result-unknown-action' : eventId,
        eventType: 'AGENT_RESULT_RECEIVED', missionId: scenario.otherMission ? 'other-mission' : parked.missionId,
        resultId: scenario.wrongResult ? 'another-provider-result' : resultId };
      if (scenario.malformedAction) parked.storeMetadata.processedEventIds = [event.eventId];
      const eventPath = join(root, `${parked.missionId}.events.ndjson`);
      await writeFile(join(root, `${parked.missionId}.state.json`), JSON.stringify(parked));
      if (scenario.missingLog) await rm(eventPath, { force: true });
      else await writeFile(eventPath, `${JSON.stringify(event)}\n${scenario.duplicate ? JSON.stringify(event) + '\n' : ''}`);
      let releases = 0;
      const result = await dispatchElasticPrHeadBuildsFromCanonicalLease(admission([parked]), {
        now: NOW, paths: { ...PATHS, orchestratorRoot: root }, sourceRevision: SOURCE,
        readSourceMutationLease: async () => ({ ok: true, present: true, record: lease }),
        readExecutionReceiptHistory: async (_root, filters) => {
          if (filters.executionId) {
            assert.equal(filters.executionId, originalActionId);
            return { ok: true, receipts: [original], latestReceipt: original };
          }
          return { ok: true, receipts: [terminal], latestReceipt: terminal };
        },
        originalMissionInFlightFn: async () => false,
        releaseSourceMutationLease: async () => { releases++; return { ok: true, released: true }; },
        claimSourceMutationLease: async () => assert.fail('parked goal must not refill itself'),
        publishWorkerAction: async () => assert.fail('parked goal must not re-dispatch'),
      });
      assert.equal(releases, scenario.releases, JSON.stringify(scenario));
      assert.equal(result.ok, scenario.releases === 1);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('signed PR-head commit actions use the canonical openclaw-signed adapter', async () => {
  const candidate = mission(1802, 2096, HEAD_A, {
    currentPhase: 'GITHUB_COMMIT',
    git: {
      branch: 'openclaw/elastic-goal-1802',
      worktreePath: '/worktrees/critical-1802-elastic-goal',
      changedFiles: ['shared/agents/goal-1802.mjs'],
    },
  });
  const lease = leaseFor(candidate);
  let publishedGrant = null;
  const result = await dispatchElasticPrHeadBuildsFromCanonicalLease(admission([candidate]), {
    now: NOW,
    paths: PATHS,
    sourceRevision: SOURCE,
    readSourceMutationLease: async () => ({ ok: true, present: true, reason: 'SOURCE_MUTATION_LEASE_ACTIVE', record: lease }),
    renewSourceMutationLease: async () => ({ ok: true, renewed: true, record: lease }),
    claimSourceMutationLease: async () => { throw new Error('claim must not run'); },
    releaseSourceMutationLease: async () => { throw new Error('release must not run'); },
    readExecutionReceiptHistory: async () => ({ ok: true, receipts: [], latestReceipt: null }),
    appendExecutionReceipt: async () => ({ ok: true }),
    isActionInFlight: async () => false,
    publishWorkerAction: async ({ actionGrant }) => {
      publishedGrant = actionGrant;
      return { published: true, actionGrantAccepted: true };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_PR_HEAD_DISPATCH_LIVE');
  assert.equal(publishedGrant.actionKind, 'signed-openclaw-operation');
  assert.equal(publishedGrant.adapter, 'openclaw-signed');
  assert.equal(publishedGrant.operation, 'commit');
});

test('an in-flight non-handoff grant renews its lease without republishing a duplicate action', async () => {
  const candidate = mission(1802, 2096, HEAD_A);
  const lease = leaseFor(candidate);
  let publishCount = 0;
  const result = await dispatchElasticPrHeadBuildsFromCanonicalLease(admission([candidate]), {
    now: NOW,
    paths: PATHS,
    sourceRevision: SOURCE,
    readSourceMutationLease: async () => ({ ok: true, present: true, reason: 'SOURCE_MUTATION_LEASE_ACTIVE', record: lease }),
    renewSourceMutationLease: async () => ({ ok: true, renewed: true, record: lease }),
    claimSourceMutationLease: async () => { throw new Error('claim must not run'); },
    releaseSourceMutationLease: async () => { throw new Error('release must not run'); },
    readExecutionReceiptHistory: async () => ({ ok: true, receipts: [{ state: 'queued' }], latestReceipt: { state: 'queued' } }),
    isActionInFlight: async ({ adapter, actionId }) => {
      assert.equal(adapter, 'openclaw-github-readonly');
      assert.match(actionId, /^critical-1802-elastic-goal-r7-/);
      return true;
    },
    publishWorkerAction: async () => {
      publishCount += 1;
      return { published: true, actionGrantAccepted: true };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_PR_HEAD_ACTION_ALREADY_IN_FLIGHT');
  assert.equal(publishCount, 0);
});

test('aggregate ignition preserves a failed PR-head lease verdict even when sibling pre-PR work is healthy', async () => {
  const result = await dispatchElasticGoalBuildsFromCanonicalMain({
    desiredWidth: 1,
    selectedMission: null,
    elasticMissions: [],
    activeMissions: [],
    runnableMissions: [],
  }, {
    testOnly: true,
    now: NOW,
    paths: PATHS,
    readProgrammeProjection: async () => ({ machineryInventory: { sourceHead: SOURCE } }),
    readCapacityRouting: async () => ({}),
    dispatchPrHeadBuilds: async () => ({
      ok: false,
      classification: 'ELASTIC_PR_HEAD_LEASE_RENEWAL_BLOCKED',
      dispatched: [],
      held: [{ missionId: 'critical-1802-elastic-goal', reason: 'LEASE_RENEWAL_FAILED' }],
      handledMissionIds: ['critical-1802-elastic-goal'],
    }),
    resolveCapacityCandidates: () => [],
  });

  assert.equal(result.ok, false);
  assert.equal(result.classification, 'ELASTIC_GOAL_BUILD_DISPATCH_PARTIAL_BLOCKED');
  assert.equal(result.prHeadLease.ok, false);
  assert.equal(result.held.some((item) => item.reason === 'LEASE_RENEWAL_FAILED'), true);
});

test('guarded expired r7 review lease can be released only after matching owner/phase and no pending worker action', async () => {
  const review = mission(1802, 2096, HEAD_A);
  const stale = leaseFor(review);
  const calls = [];
  const result = await reconcileExpiredElasticReviewLeaseV1({
    now: NOW, sourceRevision: SOURCE, paths: PATHS,
    env: { STEPHANOS_MISSION_WORKER_QUEUE_DIR: '/worker-queue' },
    missionRecords: [review],
    readLease: async () => ({
      ok: true, present: true, reason: 'SOURCE_MUTATION_LEASE_STALE',
      validation: { valid: true, active: false, stale: true, finalVerdict: 'SOURCE_MUTATION_LEASE_STALE' },
      record: stale,
    }),
    readReceiptHistoryFn: async () => ({ ok: true, latestReceipt: null }),
    isActionInFlightFn: async (input) => {
      calls.push(['queue-observed', input.adapter]);
      assert.equal(input.adapter, 'openclaw-github-readonly');
      return false;
    },
    releaseLease: async (input) => {
      calls.push(['released', input.leaseId]);
      assert.equal(input.ownerId, 'mission-worker');
      assert.equal(input.headSha, HEAD_A);
      assert.equal(input.prNumber, 2096);
      return { ok: true, released: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.released, true);
  assert.equal(result.classification, 'ELASTIC_EXPIRED_REVIEW_LEASE_SAFELY_RELEASED');
  assert.equal(result.originalMissionId, 'critical-1802-elastic-goal');
  assert.deepEqual(calls.map((item) => item[0]), ['queue-observed', 'released']);
  assert.equal(result.leaseSeizureAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.materialPickupProven, false);
});

test('stale review lease refuses release for running, mismatched, queued, or unproven ownership', async () => {
  const review = mission(1802, 2096, HEAD_A);
  const stale = leaseFor(review);
  const goodLease = async () => ({
    ok: true, present: true, reason: 'SOURCE_MUTATION_LEASE_STALE',
    validation: { valid: true, active: false, stale: true, finalVerdict: 'SOURCE_MUTATION_LEASE_STALE' },
    record: stale,
  });
  let releases = 0;
  const base = {
    now: NOW, sourceRevision: SOURCE, paths: PATHS,
    env: { STEPHANOS_MISSION_WORKER_QUEUE_DIR: '/worker-queue' },
    missionRecords: [review],
    readLease: goodLease,
    readReceiptHistoryFn: async () => ({ ok: true, latestReceipt: null }),
    isActionInFlightFn: async () => false,
    releaseLease: async () => { releases += 1; return { ok: true, released: true }; },
  };
  const cases = [
    { missionRecords: [mission(1802, 2096, HEAD_A, { dispatch: { status: 'running' } })] },
    { missionRecords: [mission(1802, 2096, HEAD_A, { currentPhase: 'AGENT_IMPLEMENTATION' })] },
    { missionRecords: [mission(1802, 2096, HEAD_C)] },
    { missionRecords: [review, review] },
    { isActionInFlightFn: async () => true },
    { readReceiptHistoryFn: async () => ({ ok: true, latestReceipt: { state: 'started' } }) },
    { readReceiptHistoryFn: async () => ({ ok: false, reason: 'READ_FAILED' }) },
    { readLease: async () => ({ ...(await goodLease()), validation: { valid: true, active: true, stale: false } }) },
    { readLease: async () => ({ ...(await goodLease()), record: { ...stale, ownerId: 'another-worker' } }) },
    { sourceRevision: '' },
    { env: {} },
  ];
  for (const scenario of cases) {
    const result = await reconcileExpiredElasticReviewLeaseV1({ ...base, ...scenario });
    assert.equal(result.released, false, result.blocker);
    assert.equal(result.leaseSeizureAllowed, false);
    assert.equal(result.dispatchAuthority, false);
  }
  assert.equal(releases, 0, 'no unsafe source lease must be released');
});

test('canonical completed implementation dispatch in CHECK_PULL_REQUEST can release expired review lease only after queue/history prove idle', async () => {
  const review = mission(1802, 2096, HEAD_A, { dispatch: { status: 'complete' } });
  const stale = leaseFor(review);
  let released = 0;
  const args = {
    now: NOW, sourceRevision: SOURCE, paths: PATHS,
    env: { STEPHANOS_MISSION_WORKER_QUEUE_DIR: '/worker-queue' },
    missionRecords: [review],
    readLease: async () => ({
      ok: true, present: true, reason: 'SOURCE_MUTATION_LEASE_STALE',
      validation: { valid: true, active: false, stale: true, finalVerdict: 'SOURCE_MUTATION_LEASE_STALE' },
      record: stale,
    }),
    readReceiptHistoryFn: async () => ({ ok: true, latestReceipt: null }),
    isActionInFlightFn: async () => false,
    releaseLease: async () => {
      released += 1;
      return { ok: true, released: true };
    },
  };
  const safe = await reconcileExpiredElasticReviewLeaseV1(args);
  assert.equal(safe.released, true);
  assert.equal(released, 1);
  assert.equal(safe.leaseSeizureAllowed, false);

  const activeQueue = await reconcileExpiredElasticReviewLeaseV1({
    ...args, isActionInFlightFn: async () => true,
  });
  assert.equal(activeQueue.released, false);
  assert.equal(activeQueue.blocker, 'EXACT_REVIEW_ACTION_STILL_IN_FLIGHT');
  assert.equal(released, 1);

  const pending = await reconcileExpiredElasticReviewLeaseV1({
    ...args, missionRecords: [mission(1802, 2096, HEAD_A, { dispatch: { status: 'pending' } })],
  });
  assert.equal(pending.released, false);
  assert.equal(pending.blocker, 'REVIEW_DISPATCH_NOT_SAFELY_TERMINAL');
  assert.equal(released, 1);
});

test('cancelled original source lease never releases on terminal receipt and empty queue without an authenticated fence', async () => {
  const baseMission = mission(2962, 2987, HEAD_A, {
    currentPhase: 'CANCELLED', revision: 8, cancelled: true,
    dispatch: { status: 'complete' },
    storeMetadata: {
      lastEventId: 'cancel-operator-superseded-2962',
      processedEventIds: ['cancel-operator-superseded-2962'],
    },
  });
  const oldLease = leaseFor({ ...baseMission, revision: 7 });
  const observation = {
    ok: true, present: true, record: oldLease,
    validation: { valid: true, active: false, stale: true, finalVerdict: 'SOURCE_MUTATION_LEASE_STALE' },
  };
  const terminal = {
    ok: true,
    receipts: [{ state: 'completed', leaseKey: oldLease.leaseId }],
    latestReceipt: { state: 'completed', leaseKey: oldLease.leaseId },
  };
  const calls = [];
  const args = {
    now: NOW, sourceRevision: SOURCE, paths: PATHS,
    env: { USERPROFILE: '/fake', STEPHANOS_MISSION_WORKER_QUEUE_DIR: '/queue' },
    missionRecords: [baseMission],
    readLease: async () => observation,
    readReceiptHistoryFn: async () => terminal,
    originalMissionInFlightFn: async () => false,
    releaseLease: async (input) => {
      calls.push(input);
      return { ok: true, released: true };
    },
  };
  const safe = await reconcileExpiredElasticReviewLeaseV1(args);
  assert.equal(safe.released, false);
  assert.equal(safe.blocker, 'CANCELLED_ORIGINAL_SOURCE_FENCE_REQUIRED');
  assert.equal(safe.sourceMutationAllowed, false);
  assert.equal(calls.length, 0, 'no unfenced cancelled-source lease release');
  for (const [overrides, expected] of [
    [{ missionRecords: [{ ...baseMission, currentPhase: 'REPAIR_REQUIRED', cancelled: false }] }, 'REVIEW_LEASE_MISSION_REVISION_OR_HEAD_MISMATCH'],
    [{ missionRecords: [{ ...baseMission, revision: 9 }] }, 'REVIEW_LEASE_MISSION_REVISION_OR_HEAD_MISMATCH'],
    [{ missionRecords: [{ ...baseMission, storeMetadata: { lastEventId: 'forged', processedEventIds: ['forged'] } }] }, 'REVIEW_LEASE_MISSION_REVISION_OR_HEAD_MISMATCH'],
    [{ missionRecords: [{ ...baseMission, dispatch: { status: 'running' } }] }, 'REVIEW_LEASE_MISSION_REVISION_OR_HEAD_MISMATCH'],
    [{ readReceiptHistoryFn: async () => ({ ok: true, receipts: [], latestReceipt: null }) }, 'CANCELLED_ORIGINAL_SOURCE_FENCE_REQUIRED'],
    [{ readReceiptHistoryFn: async () => ({ ok: true, receipts: [{ state: 'started' }], latestReceipt: { state: 'started' } }) }, 'CANCELLED_ORIGINAL_SOURCE_FENCE_REQUIRED'],
    [{ originalMissionInFlightFn: async () => true }, 'CANCELLED_ORIGINAL_SOURCE_FENCE_REQUIRED'],
    [{ originalMissionInFlightFn: async () => { throw Error('unknown'); } }, 'CANCELLED_ORIGINAL_SOURCE_FENCE_REQUIRED'],
    [{ readLease: async () => ({ ...observation, validation: { ...observation.validation, active: true, stale: false } }) }, 'CANONICAL_LEASE_EXPIRED_STATE_NOT_PROVEN'],
    [{ missionRecords: [{ ...baseMission, git: { ...baseMission.git, branch: 'openclaw/unrelated' } }] }, 'REVIEW_LEASE_MISSION_REVISION_OR_HEAD_MISMATCH'],
  ]) {
    const denied = await reconcileExpiredElasticReviewLeaseV1({ ...args, ...overrides });
    assert.equal(denied.released, false);
    assert.equal(denied.blocker, expected);
  }
  assert.equal(calls.length, 0, 'no unsafe cancelled-source release in any case');
});

test('completed original r7 repair lease retires only with failed required checks and terminal exact worker proof', async () => {
  const repairing = mission(2962, 2987, HEAD_A, {
    currentPhase: 'REPAIR_REQUIRED',
    dispatch: { status: 'complete' },
    pullRequest: { number: 2987, headSha: HEAD_A,
      checks: [{ name: 'required', required: true, status: 'failure' }] },
    continuity: { parkingStatus: 'ACTIVE' },
  });
  const stale = leaseFor(repairing);
  const terminal = {
    state: 'completed', leaseKey: stale.leaseId, sourceHead: stale.headSha,
    branch: stale.branch, repository: stale.repository,
    issueNumber: stale.issueNumber, prNumber: stale.prNumber,
  };
  let releases = 0;
  const base = {
    now: NOW, sourceRevision: SOURCE, paths: PATHS,
    env: { STEPHANOS_MISSION_WORKER_QUEUE_DIR: '/worker-queue' },
    missionRecords: [repairing],
    readLease: async () => ({
      ok: true, present: true, reason: 'SOURCE_MUTATION_LEASE_STALE',
      validation: { valid: true, active: false, stale: true, finalVerdict: 'SOURCE_MUTATION_LEASE_STALE' },
      record: stale,
    }),
    readReceiptHistoryFn: async () => ({
      ok: true, receipts: [terminal], latestReceipt: terminal,
    }),
    originalMissionInFlightFn: async () => false,
    releaseLease: async (identity) => {
      assert.equal(identity.leaseId, stale.leaseId);
      assert.equal(identity.ownerId, 'mission-worker');
      releases += 1;
      return { ok: true, released: true };
    },
  };
  const passing = await reconcileExpiredElasticReviewLeaseV1(base);
  assert.equal(passing.released, true);
  assert.equal(passing.classification, 'ELASTIC_COMPLETED_FAILED_CHECKS_EXACT_LEASE_RELEASED');
  assert.equal(passing.repairStillRequired, true);
  assert.equal(passing.goalComplete, false);
  assert.equal(passing.sourceMutationAllowed, false);
  assert.equal(passing.dispatchAuthority, false);
  assert.equal(passing.mergeAuthority, false);
  assert.equal(releases, 1);
  const cases = [
    [{ missionRecords: [{ ...repairing, dispatch: { status: 'running' } }] }, 'REPAIR_ORIGINAL_DISPATCH_NOT_TERMINAL'],
    [{ missionRecords: [{ ...repairing, dispatch: { status: 'pending' } }] }, 'REPAIR_ORIGINAL_DISPATCH_NOT_TERMINAL'],
    [{ missionRecords: [{ ...repairing, pullRequest: { ...repairing.pullRequest, checks: [] } }] }, 'REPAIR_REQUIRED_CHECK_FAILURE_NOT_PROVEN'],
    [{ missionRecords: [{ ...repairing, pullRequest: { ...repairing.pullRequest, checks: [{ required: false, status: 'failure' }] } }] }, 'REPAIR_REQUIRED_CHECK_FAILURE_NOT_PROVEN'],
    [{ missionRecords: [{ ...repairing, continuity: { parkingStatus: 'PARKED_BLOCKED' } }] }, 'REPAIR_ORIGINAL_CONTINUITY_NOT_ACTIVE'],
    [{ readReceiptHistoryFn: async () => ({ ok: true, receipts: [], latestReceipt: null }) }, 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING'],
    [{ readReceiptHistoryFn: async () => ({ ok: false, reason: 'MALFORMED_EXECUTION_RECEIPT_HISTORY' }) }, 'REPAIR_ORIGINAL_EXECUTION_HISTORY_UNVERIFIED'],
    [{ readReceiptHistoryFn: async () => ({ ok: true, receipts: [terminal], latestReceipt: { ...terminal, state: 'queued' } }) }, 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_NONTERMINAL'],
    [{ readReceiptHistoryFn: async () => ({ ok: true, receipts: [terminal], latestReceipt: { ...terminal, state: 'progress' } }) }, 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_NONTERMINAL'],
    [{ readReceiptHistoryFn: async () => ({ ok: true, receipts: [terminal], latestReceipt: { ...terminal, state: 'started' } }) }, 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_NONTERMINAL'],
    [{ readReceiptHistoryFn: async () => ({ ok: true, receipts: [terminal], latestReceipt: { ...terminal, sourceHead: HEAD_C } }) }, 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_IDENTITY_MISMATCH'],
    [{ readReceiptHistoryFn: async () => ({ ok: true, receipts: [terminal], latestReceipt: { ...terminal, leaseKey: 'wrong-owner' } }) }, 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_IDENTITY_MISMATCH'],
    [{ originalMissionInFlightFn: async () => true }, 'REPAIR_ORIGINAL_WORK_STILL_IN_FLIGHT'],
    [{ originalMissionInFlightFn: async () => { throw new Error('unobservable'); } }, 'REPAIR_ORIGINAL_WORKER_QUEUE_UNOBSERVABLE'],
    [{ missionRecords: [{ ...repairing, revision: 8 }] }, 'REVIEW_LEASE_MISSION_REVISION_OR_HEAD_MISMATCH'],
    [{ missionRecords: [repairing, repairing] }, 'EXACT_ORIGINAL_MISSION_UNAVAILABLE_OR_AMBIGUOUS'],
    [{ missionRecords: [{ ...repairing, pullRequest: { ...repairing.pullRequest, headSha: HEAD_C } }] }, 'REVIEW_LEASE_MISSION_REVISION_OR_HEAD_MISMATCH'],
    [{ missionRecords: [{ ...repairing, currentPhase: 'AGENT_IMPLEMENTATION' }] }, 'EXACT_READ_ONLY_REVIEW_PHASE_NOT_PROVEN'],
  ];
  for (const [input, blocker] of cases) {
    const result = await reconcileExpiredElasticReviewLeaseV1({ ...base, ...input });
    assert.equal(result.released, false, JSON.stringify(input));
    assert.equal(result.blocker, blocker);
    assert.equal(result.leaseSeizureAllowed, false);
  }
  assert.equal(releases, 1, 'only the fully grounded original exact lease may be released');
});

test('missing original r7 execution receipt is triaged against exact immutable terminal queue pair without releasing lease', async () => {
  const root = await mkdtemp(join(tmpdir(), 'original-worker-r7-triage-'));
  const repairing = mission(2962, 2987, HEAD_A, {
    currentPhase: 'REPAIR_REQUIRED',
    dispatch: { status: 'complete' },
    pullRequest: { number: 2987, headSha: HEAD_A,
      checks: [{ required: true, status: 'failure' }] },
    continuity: { parkingStatus: 'ACTIVE' },
  });
  const lease = leaseFor(repairing);
  const missionId = repairing.missionId;
  const actionId = 'original-r7-source-action';
  const adapter = 'forge-publication';
  const directory = join(root, adapter, 'completed');
  const env = { STEPHANOS_MISSION_WORKER_QUEUE_DIR: root };
  const queuePath = join(directory, actionId + '.json');
  const resultPath = join(directory, actionId + '.result.json');
  const item = {
    schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    adapter, actionId, missionId,
    executionBinding: {
      schemaVersion: 'stephanos.mission-worker-queue-execution-binding.v1',
      executionId: actionId, missionId, leaseKey: lease.leaseId,
      repository: lease.repository, issueNumber: lease.issueNumber,
      prNumber: lease.prNumber, branch: lease.branch, headSha: lease.headSha,
    },
  };
  const workerResult = {
    schemaVersion: 'stephanos.mission-worker-consumption-result.v1',
    adapter, actionId, missionId,
    finalVerdict: 'MISSION_WORKER_ITEM_COMPLETE',
  };
  let leaseReleaseCalls = 0;
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(queuePath, JSON.stringify(item));
    await writeFile(resultPath, JSON.stringify(workerResult));
    const triage = await inspectOriginalTerminalWorkerPairV1({ lease, missionId, env });
    assert.equal(triage.classification, 'ORIGINAL_EXACT_TERMINAL_PAIR_PRESENT');
    assert.equal(triage.exactPairCount, 1);
    assert.equal(triage.terminalExecutionReceiptProven, false);
    assert.equal(triage.leaseReleaseAllowed, false);

    const reconciled = await reconcileExpiredElasticReviewLeaseV1({
      now: NOW, paths: PATHS, sourceRevision: SOURCE, env,
      missionRecords: [repairing],
      readLease: async () => ({
        ok: true, present: true, record: lease,
        validation: { valid: true, active: false, stale: true, finalVerdict: 'SOURCE_MUTATION_LEASE_STALE' },
      }),
      readReceiptHistoryFn: async () => ({ ok: true, receipts: [], latestReceipt: null }),
      releaseLease: async () => { leaseReleaseCalls += 1; return { ok: true, released: true }; },
    });
    assert.equal(reconciled.blocker, 'REPAIR_ORIGINAL_TERMINAL_PAIR_PRESENT_RECEIPT_MISSING');
    assert.equal(reconciled.released, false);
    assert.equal(reconciled.sourceMutationAllowed, false);
    assert.equal(leaseReleaseCalls, 0);

    await writeFile(resultPath, JSON.stringify({ ...workerResult, actionId: 'forged-other-action' }));
    const forged = await inspectOriginalTerminalWorkerPairV1({ lease, missionId, env });
    assert.equal(forged.classification, 'ORIGINAL_BOUND_TERMINAL_RESULT_MISSING_OR_INVALID');
    assert.equal(forged.exactPairCount, 0);
    await rm(resultPath);
    const missing = await inspectOriginalTerminalWorkerPairV1({ lease, missionId, env });
    assert.equal(missing.classification, 'ORIGINAL_BOUND_TERMINAL_RESULT_MISSING_OR_INVALID');
    await writeFile(resultPath, JSON.stringify(workerResult));
    await writeFile(queuePath, JSON.stringify({
      ...item, executionBinding: { ...item.executionBinding, headSha: HEAD_C },
    }));
    const wrongHead = await inspectOriginalTerminalWorkerPairV1({ lease, missionId, env });
    assert.equal(wrongHead.classification, 'ORIGINAL_TERMINAL_QUEUE_SOURCE_BINDING_UNPROVEN');
    assert.deepEqual(wrongHead.bindingMismatchCodes, ['HEAD_SHA']);
    assert.equal(wrongHead.terminalExecutionReceiptProven, false);
    assert.equal(wrongHead.leaseReleaseAllowed, false);
    const wrongHeadRecovery = await reconcileExpiredElasticReviewLeaseV1({
      now: NOW, paths: PATHS, sourceRevision: SOURCE, env,
      missionRecords: [repairing],
      readLease: async () => ({
        ok: true, present: true, record: lease,
        validation: { valid: true, active: false, stale: true, finalVerdict: 'SOURCE_MUTATION_LEASE_STALE' },
      }),
      readReceiptHistoryFn: async () => ({ ok: true, receipts: [], latestReceipt: null }),
      releaseLease: async () => { leaseReleaseCalls += 1; return { ok: true, released: true }; },
    });
    assert.equal(wrongHeadRecovery.blocker, 'REPAIR_ORIGINAL_BINDING_HEAD_SHA_MISMATCH');
    assert.equal(wrongHeadRecovery.released, false);
    assert.equal(leaseReleaseCalls, 0);
    await writeFile(queuePath, JSON.stringify({
      ...item, executionBinding: { ...item.executionBinding, leaseKey: 'unrelated-lease' },
    }));
    const wrongLease = await inspectOriginalTerminalWorkerPairV1({ lease, missionId, env });
    assert.deepEqual(wrongLease.bindingMismatchCodes, ['LEASE_KEY']);
    assert.equal(wrongLease.leaseReleaseAllowed, false);
    await writeFile(queuePath, JSON.stringify({
      ...item, executionBinding: {
        ...item.executionBinding, leaseKey: 'unrelated-lease', headSha: HEAD_C,
      },
    }));
    const multiMismatch = await inspectOriginalTerminalWorkerPairV1({ lease, missionId, env });
    assert.deepEqual(multiMismatch.bindingMismatchCodes, ['HEAD_SHA', 'LEASE_KEY']);
    assert.equal(multiMismatch.leaseReleaseAllowed, false);
    assert.equal(JSON.stringify(multiMismatch).includes('unrelated-lease'), false);
    await writeFile(queuePath, JSON.stringify(item));
    const secondActionId = 'original-r7-source-action-duplicate';
    await writeFile(join(directory, secondActionId + '.json'), JSON.stringify({
      ...item, actionId: secondActionId,
      executionBinding: { ...item.executionBinding, executionId: secondActionId },
    }));
    await writeFile(join(directory, secondActionId + '.result.json'), JSON.stringify({
      ...workerResult, actionId: secondActionId,
    }));
    const duplicates = await inspectOriginalTerminalWorkerPairV1({ lease, missionId, env });
    assert.equal(duplicates.classification, 'ORIGINAL_MULTIPLE_BOUND_TERMINAL_PAIRS');
    assert.equal(duplicates.exactPairCount, 2);
    assert.equal(duplicates.terminalExecutionReceiptProven, false);
    assert.equal(duplicates.leaseReleaseAllowed, false);
    const unknownRoot = await inspectOriginalTerminalWorkerPairV1({
      lease, missionId, env: { STEPHANOS_MISSION_WORKER_QUEUE_DIR: join(root, 'unknown') },
    });
    assert.equal(unknownRoot.classification, 'ORIGINAL_TERMINAL_QUEUE_UNOBSERVABLE');
    assert.equal(leaseReleaseCalls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('older bound terminal revisions cannot mask an exact original r7 pair or authorize lease release', async () => {
  const root = await mkdtemp(join(tmpdir(), 'original-worker-historical-triage-'));
  const current = mission(2962, 2987, HEAD_A, {
    currentPhase: 'REPAIR_REQUIRED',
    dispatch: { status: 'complete' },
    pullRequest: { number: 2987, headSha: HEAD_A,
      checks: [{ required: true, status: 'failure' }] },
    continuity: { parkingStatus: 'ACTIVE' },
  });
  const lease = leaseFor(current);
  const adapter = 'forge-publication';
  const directory = join(root, adapter, 'completed');
  const env = { STEPHANOS_MISSION_WORKER_QUEUE_DIR: root };
  const exactId = 'original-r7-source';
  const olderId = 'historical-r6-source';
  const intakeId = 'historical-r0-intake';
  const binding = {
    schemaVersion: 'stephanos.mission-worker-queue-execution-binding.v1',
    missionId: current.missionId, leaseKey: lease.leaseId,
    repository: lease.repository, issueNumber: lease.issueNumber,
    prNumber: lease.prNumber, branch: lease.branch, headSha: lease.headSha,
  };
  const entry = (id, overrides = {}) => ({
    schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    adapter, actionId: id, missionId: current.missionId,
    executionBinding: { ...binding, executionId: id, ...overrides },
  });
  const workerResult = (id) => ({
    schemaVersion: 'stephanos.mission-worker-consumption-result.v1',
    adapter, actionId: id, missionId: current.missionId,
    finalVerdict: 'MISSION_WORKER_ITEM_COMPLETE',
  });
  const writePair = async (id, item) => {
    await writeFile(join(directory, id + '.json'), JSON.stringify(item));
    await writeFile(join(directory, id + '.result.json'), JSON.stringify(workerResult(id)));
  };
  let releases = 0;
  const heldRecovery = () => reconcileExpiredElasticReviewLeaseV1({
    now: NOW, paths: PATHS, sourceRevision: SOURCE, env,
    missionRecords: [current],
    readLease: async () => ({
      ok: true, present: true, record: lease,
      validation: { valid: true, active: false, stale: true, finalVerdict: 'SOURCE_MUTATION_LEASE_STALE' },
    }),
    readReceiptHistoryFn: async () => ({ ok: true, receipts: [], latestReceipt: null }),
    releaseLease: async () => { releases += 1; return { ok: true, released: true }; },
  });
  try {
    await mkdir(directory, { recursive: true });
    await writePair(olderId, entry(olderId, {
      leaseKey: current.missionId + '-r6-lease', headSha: HEAD_C, prNumber: 2868,
    }));
    await writePair(intakeId, entry(intakeId, {
      leaseKey: current.missionId + '-r0-lease', headSha: HEAD_C, prNumber: 2868,
    }));
    // An archived, correctly scoped terminal attempt from r6 must not
    // impersonate a current r7 binding mismatch or grant r7 completion.
    const historyOnly = await inspectOriginalTerminalWorkerPairV1({
      lease, missionId: current.missionId, env,
    });
    assert.equal(historyOnly.classification, 'ORIGINAL_EXACT_TERMINAL_PAIR_NOT_FOUND');
    assert.equal(historyOnly.olderBoundTerminalItems, 2);
    assert.deepEqual(historyOnly.bindingMismatchCodes, []);
    const before = await heldRecovery();
    assert.equal(before.released, false);
    assert.equal(before.blocker, 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING');

    await writePair(exactId, entry(exactId));
    const exact = await inspectOriginalTerminalWorkerPairV1({
      lease, missionId: current.missionId, env,
    });
    assert.equal(exact.classification, 'ORIGINAL_EXACT_TERMINAL_PAIR_PRESENT');
    assert.equal(exact.exactPairCount, 1);
    assert.equal(exact.olderBoundTerminalItems, 2);
    assert.equal(exact.terminalExecutionReceiptProven, false);
    const stillHeld = await heldRecovery();
    assert.equal(stillHeld.blocker, 'REPAIR_ORIGINAL_TERMINAL_PAIR_PRESENT_RECEIPT_MISSING');
    assert.equal(stillHeld.released, false);

    // A CURRENT r7 item with a tampered head must still poison the evidence,
    // even when older legitimate attempts exist.
    await writePair(exactId, entry(exactId, { headSha: HEAD_C }));
    const tampered = await inspectOriginalTerminalWorkerPairV1({
      lease, missionId: current.missionId, env,
    });
    assert.equal(tampered.classification, 'ORIGINAL_TERMINAL_QUEUE_SOURCE_BINDING_UNPROVEN');
    assert.deepEqual(tampered.bindingMismatchCodes, ['HEAD_SHA']);
    const badRecovery = await heldRecovery();
    assert.equal(badRecovery.blocker, 'REPAIR_ORIGINAL_BINDING_HEAD_SHA_MISMATCH');
    assert.equal(badRecovery.released, false);
    // Noncanonical zero padding is not a historical revision and must HOLD.
    await writePair(intakeId, entry(intakeId, {
      leaseKey: current.missionId + '-r00-lease', headSha: HEAD_C, prNumber: 2868,
    }));
    const malformed = await inspectOriginalTerminalWorkerPairV1({ lease, missionId: current.missionId, env });
    assert.equal(malformed.classification, 'ORIGINAL_TERMINAL_QUEUE_SOURCE_BINDING_UNPROVEN');
    assert.equal(malformed.incompleteOrUnboundCount, 2);
    assert.equal((await heldRecovery()).released, false);
    assert.equal(releases, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('real durable receipt writer accepts exact queued PR-head proof from original mission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elastic-pr-head-receipt-real-writer-'));
  const candidate = mission(1802, 2096, HEAD_A);
  const paths = { ...PATHS, workspaceRoot: root, repoRoot: resolve('.') };
  const lease = leaseFor(candidate);
  let published = 0;
  try {
    const result = await dispatchElasticPrHeadBuildsFromCanonicalLease(admission([candidate]), {
      now: NOW, paths, sourceRevision: SOURCE,
      readSourceMutationLease: async () => ({
        ok: true, present: true, reason: 'SOURCE_MUTATION_LEASE_ACTIVE', record: lease,
      }),
      renewSourceMutationLease: async () => ({ ok: true, renewed: true, record: lease }),
      readExecutionReceiptHistory: (...args) => readExecutionReceiptHistory(...args),
      isActionInFlight: async () => false,
      publishWorkerAction: async () => {
        published += 1;
        return { published: true, actionGrantAccepted: true };
      },
    });
    assert.equal(result.classification, 'ELASTIC_PR_HEAD_DISPATCH_LIVE', JSON.stringify(result.held));
    assert.equal(published, 1);
    const history = await readExecutionReceiptHistory(root, { leaseKey: lease.leaseId }, { repoRoot: resolve('.') });
    assert.equal(history.ok, true, history.reason);
    assert.equal(history.latestReceipt?.state, 'queued');
    assert.equal(history.latestReceipt?.sourceHead, HEAD_A);
    assert.equal(history.latestReceipt?.prNumber, 2096);
    assert.equal(history.latestReceipt?.leaseKey, lease.leaseId);
    assert.deepEqual(history.latestReceipt?.proofRefs, ['goal-1802-source-proof']);
    assert.equal(validateExecutionReceipt(history.latestReceipt).valid, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('missing source and capacity proof blocks queued receipt before writer or handoff', async () => {
  const candidate = mission(1802, 2096, HEAD_A, { evidenceReceipts: [] });
  const lease = leaseFor(candidate);
  let appendCalls = 0;
  let published = 0;
  const result = await dispatchElasticPrHeadBuildsFromCanonicalLease(admission([candidate]), {
    now: NOW, paths: PATHS, sourceRevision: SOURCE,
    readSourceMutationLease: async () => ({ ok: true, present: true, reason: 'SOURCE_MUTATION_LEASE_ACTIVE', record: lease }),
    renewSourceMutationLease: async () => ({ ok: true, renewed: true, record: lease }),
    readExecutionReceiptHistory: async () => ({ ok: true, receipts: [], latestReceipt: null }),
    isActionInFlight: async () => false,
    appendExecutionReceipt: async () => { appendCalls += 1; return { ok: true }; },
    publishWorkerAction: async () => { published += 1; return { published: true, actionGrantAccepted: true }; },
  });
  assert.equal(result.classification, 'ELASTIC_PR_HEAD_QUEUED_RECEIPT_PROOF_BLOCKED');
  assert.equal(result.held[0].reason, 'CANONICAL_QUEUED_EXECUTION_PROOF_REQUIRED');
  assert.equal(appendCalls, 0);
  assert.equal(published, 0);
  assert.equal(result.leaseSeizureAllowed, false);
});

test('first PR-head lease claim is refused before reservation when queued proof is absent', async () => {
  const candidate = mission(1802, 2096, HEAD_A, { evidenceReceipts: [] });
  let leaseClaims = 0;
  let queuedAppends = 0;
  let workerPublishes = 0;
  const result = await dispatchElasticPrHeadBuildsFromCanonicalLease(admission([candidate]), {
    now: NOW, paths: PATHS, sourceRevision: SOURCE,
    readSourceMutationLease: async () => ({
      ok: true, present: false, reason: 'SOURCE_MUTATION_LEASE_NOT_CLAIMED',
    }),
    claimSourceMutationLease: async () => {
      leaseClaims += 1;
      return { ok: true };
    },
    appendExecutionReceipt: async () => {
      queuedAppends += 1;
      return { ok: true };
    },
    publishWorkerAction: async () => {
      workerPublishes += 1;
      return { published: true, actionGrantAccepted: true };
    },
  });
  assert.equal(result.classification, 'ELASTIC_PR_HEAD_QUEUED_RECEIPT_PROOF_BLOCKED');
  assert.equal(result.held[0].reason, 'CANONICAL_QUEUED_EXECUTION_PROOF_REQUIRED');
  assert.equal(leaseClaims, 0, 'must not reserve global lease without valid first receipt');
  assert.equal(queuedAppends, 0);
  assert.equal(workerPublishes, 0);
  assert.equal(result.leaseSeizureAllowed, false);
});

test('failed receipt persistence or unobservable history never reserves the global lease', async () => {
  const candidate = mission(1802, 2096, HEAD_A);
  const cases = [
    { append: async () => ({ ok: false, reason: 'EXECUTION_RECEIPT_WRITE_FAILED' }), classification: 'ELASTIC_PR_HEAD_QUEUED_RECEIPT_BLOCKED' },
    { append: async () => { throw new Error('private filesystem detail'); }, classification: 'ELASTIC_PR_HEAD_QUEUED_RECEIPT_BLOCKED' },
    { history: async () => ({ ok: false, reason: 'EXECUTION_RECEIPT_HISTORY_INVALID' }), classification: 'ELASTIC_PR_HEAD_EXECUTION_RECEIPT_HISTORY_BLOCKED' },
    { history: async () => { throw new Error('history unavailable'); }, classification: 'ELASTIC_PR_HEAD_EXECUTION_RECEIPT_HISTORY_UNAVAILABLE' },
    { inFlight: async () => true, classification: 'ELASTIC_PR_HEAD_RUNNING_WITHOUT_LEASE' },
  ];
  for (const scenario of cases) {
    let claims = 0;
    let publishes = 0;
    const result = await dispatchElasticPrHeadBuildsFromCanonicalLease(admission([candidate]), {
      now: NOW, paths: PATHS, sourceRevision: SOURCE,
      readSourceMutationLease: async () => ({ ok: true, present: false }),
      claimSourceMutationLease: async () => { claims += 1; return { ok: true, record: leaseFor(candidate) }; },
      readExecutionReceiptHistory: scenario.history ?? (async () => ({ ok: true, receipts: [], latestReceipt: null })),
      appendExecutionReceipt: scenario.append ?? (async () => ({ ok: true })),
      isActionInFlight: scenario.inFlight ?? (async () => false),
      publishWorkerAction: async () => { publishes += 1; return { published: true, actionGrantAccepted: true }; },
    });
    assert.equal(result.classification, scenario.classification);
    assert.equal(result.activeLease, null);
    assert.equal(claims, 0);
    assert.equal(publishes, 0);
    assert.equal(JSON.stringify(result).includes('private filesystem detail'), false);
  }
});

test('persisted queued intent survives interrupted or refused lease claim and replays without another receipt', async () => {
  for (const failure of ['exception', 'refusal', 'wrong-identity']) {
    const root = await mkdtemp(join(tmpdir(), 'elastic-receipt-before-lease-'));
    const candidate = mission(1802, 2096, HEAD_A);
    const paths = { ...PATHS, workspaceRoot: root, repoRoot: resolve('.') };
    let appends = 0;
    let publishes = 0;
    let healthy = false;
    const options = {
      now: NOW, paths, sourceRevision: SOURCE,
      readSourceMutationLease: async () => ({ ok: true, present: false }),
      readExecutionReceiptHistory,
      appendExecutionReceipt: async (...args) => { appends += 1; return appendExecutionReceipt(...args); },
      isActionInFlight: async () => false,
      claimSourceMutationLease: async (input) => {
        // Use the real authenticated receipt reader at the claim boundary.
        const history = await readExecutionReceiptHistory(root, { leaseKey: input.leaseId }, { repoRoot: resolve('.') });
        assert.equal(history.ok, true, history.reason);
        assert.equal(history.receipts.length, 1);
        assert.equal(history.latestReceipt.state, 'queued');
        assert.equal(history.latestReceipt.sourceHead, input.headSha);
        if (!healthy) {
          if (failure === 'exception') throw Error('private claim failure');
          if (failure === 'refusal') return { ok: false, reason: 'LEASE_BUSY' };
          return { ok: true, record: { ...input, headSha: HEAD_C } };
        }
        return { ok: true, record: { ...input } };
      },
      publishWorkerAction: async () => {
        publishes += 1;
        assert.equal(healthy, true, 'queued intent alone never authorizes publication');
        return { published: true, actionGrantAccepted: true };
      },
    };
    try {
      const stopped = await dispatchElasticPrHeadBuildsFromCanonicalLease(admission([candidate]), options);
      assert.equal(stopped.classification, 'ELASTIC_PR_HEAD_LEASE_CLAIM_BLOCKED');
      assert.equal(stopped.activeLease, null);
      assert.equal(publishes, 0);
      assert.equal(appends, 1);
      assert.equal(JSON.stringify(stopped).includes('private claim failure'), false);
      healthy = true;
      const replay = await dispatchElasticPrHeadBuildsFromCanonicalLease(admission([candidate]), {
        ...options, now: new Date(NOW.getTime() + 2000),
      });
      assert.equal(replay.classification, 'ELASTIC_PR_HEAD_DISPATCH_LIVE', JSON.stringify(replay.held));
      assert.equal(replay.dispatchCount, 1);
      assert.equal(appends, 1, 'retry must reuse durable sequence 1 and its original timestamp');
      assert.equal(publishes, 1);
      const history = await readExecutionReceiptHistory(root, { leaseKey: leaseFor(candidate).leaseId }, { repoRoot: resolve('.') });
      assert.equal(history.receipts.length, 1);
      assert.equal(history.latestReceipt.receiptId, replay.dispatched[0].queuedReceiptId);
      assert.equal(validateExecutionReceipt(history.latestReceipt).valid, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('terminal or already accepted receipt without a lease cannot reclaim writer authority', async () => {
  const candidate = mission(1802, 2096, HEAD_A);
  for (const state of ['accepted', 'started', 'progress', 'completed', 'failed', 'cancelled']) {
    let claims = 0;
    const result = await dispatchElasticPrHeadBuildsFromCanonicalLease(admission([candidate]), {
      now: NOW, paths: PATHS, sourceRevision: SOURCE,
      readSourceMutationLease: async () => ({ ok: true, present: false }),
      readExecutionReceiptHistory: async () => ({ ok: true, receipts: [{ state }], latestReceipt: { state } }),
      isActionInFlight: async () => false,
      claimSourceMutationLease: async () => { claims += 1; throw Error('must not claim'); },
      appendExecutionReceipt: async () => { throw Error('must not append'); },
      publishWorkerAction: async () => { throw Error('must not publish'); },
    });
    assert.equal(result.ok, false);
    assert.equal(result.activeLease, null);
    assert.equal(claims, 0);
  }
});


async function completedInspectionFixture() {
  const root = await mkdtemp(join(tmpdir(), 'completed-elastic-review-'));
  const paths = { workspaceRoot: join(root, 'workspace'), repoRoot: join(root, 'repo'), orchestratorRoot: join(root, 'orchestrator') };
  const env = { ...process.env, STEPHANOS_MISSION_WORKER_QUEUE_DIR: join(root, 'queue') };
  const prior = mission(1802, 2096, HEAD_A, { revision: 6, dispatch: { status: 'complete', resultId: 'source-result' } });
  const lease = leaseFor(prior);
  const action = buildMissionWorkerAction(prior);
  const eventId = 'worker-' + action.actionId;
  const sourceId = prior.missionId + '-r1-aaaaaaaaaaaa';
  const checks = [{ id: 'verify', name: 'verify', status: 'failure', required: true }];
  const completedAt = new Date(NOW.getTime() - 1000).toISOString();
  const event = { eventId, missionId: prior.missionId, eventType: 'PULL_REQUEST_CHECKS_UPDATED',
    prNumber: 2096, headSha: HEAD_A, prState: 'open', mergeable: true, checks,
    receipt: { verified: true, source: 'openclaw-github-readonly', evidenceType: 'github-inspection', commandOutputHash: 'f'.repeat(64), createdAt: completedAt } };
  const current = { ...prior, revision: 7, currentPhase: 'REPAIR_REQUIRED',
    pullRequest: { ...prior.pullRequest, checks },
    storeMetadata: { lastEventId: eventId, processedEventIds: ['result-' + sourceId, eventId] } };
  const identity = { missionId: prior.missionId, repository: REPOSITORY, issueNumber: 1802,
    prNumber: 2096, branch: prior.git.branch, headSha: HEAD_A };
  const grant = { schemaVersion: 'stephanos.mission-worker-action-grant.v1', controllerId: 'durable-flywheel-controller',
    grantId: 'grant-' + action.actionId, ...identity, laneId: prior.missionId, missionRevision: 6,
    currentPhase: 'CHECK_PULL_REQUEST', actionId: action.actionId, actionKind: 'github-inspection',
    adapter: 'openclaw-github-readonly', operation: 'check-pr', boundedActionCount: 1,
    mergeAuthority: false, leaseSeizureAllowed: false, sourceRevision: SOURCE };
  const item = { schemaVersion: 'stephanos.mission-worker-queue-item.v1', adapter: grant.adapter,
    actionId: action.actionId, missionId: prior.missionId, actionGrant: grant, payload: action,
    executionBinding: { schemaVersion: 'stephanos.mission-worker-queue-execution-binding.v1', ...identity,
      executionId: action.actionId, leaseKey: lease.leaseId, missionRevision: 6, grantId: grant.grantId, sourceRevision: SOURCE } };
  const result = { schemaVersion: 'stephanos.mission-worker-consumption-result.v1', actionId: action.actionId,
    missionId: prior.missionId, operation: 'check-pr', eventId, stateRevision: 7, currentPhase: 'REPAIR_REQUIRED',
    finalVerdict: 'MISSION_WORKER_ITEM_COMPLETE', execution: { success: true, commandOutputHash: 'f'.repeat(64), completedAt },
    inspection: { prNumber: 2096, headSha: HEAD_A, prState: 'open', mergeable: true, checks } };
  const queued = { ...identity, sourceHead: HEAD_A, leaseKey: lease.leaseId, executionId: action.actionId, state: 'queued' };
  const sourceReceipt = { ...identity, executionId: sourceId, leaseKey: prior.missionId + '-r1-lease', state: 'completed' };
  const facts = { root, paths, env, lease, current, item, result, event,
    events: [{ eventId: 'result-' + sourceId, missionId: prior.missionId, eventType: 'AGENT_RESULT_RECEIVED', resultId: 'source-result' }, event],
    history: { ok: true, receipts: [queued], latestReceipt: queued },
    sourceHistory: { ok: true, receipts: [sourceReceipt], latestReceipt: sourceReceipt }, releases: [] };
  facts.persist = async () => {
    await mkdir(paths.orchestratorRoot, { recursive: true });
    await writeFile(join(paths.orchestratorRoot, current.missionId + '.state.json'), JSON.stringify(current));
    await writeFile(join(paths.orchestratorRoot, current.missionId + '.events.ndjson'), facts.events.map(e => JSON.stringify(e)).join('\n') + '\n');
    const dir = join(env.STEPHANOS_MISSION_WORKER_QUEUE_DIR, 'openclaw-github-readonly', 'completed');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, action.actionId + '.json'), JSON.stringify(item));
    await writeFile(join(dir, action.actionId + '.result.json'), JSON.stringify(result));
  };
  facts.args = { now: NOW, env, paths, sourceRevision: SOURCE, missionRecords: [current],
    readLease: async () => ({ ok: true, present: true, record: lease, validation: { valid: true, active: true, stale: false } }),
    releaseLease: async expected => { facts.releases.push(expected); return { ok: true, released: true }; },
    readReceiptHistoryFn: async (_root, query) => query.executionId === sourceId ? facts.sourceHistory : facts.history,
    originalMissionInFlightFn: async () => false };
  return facts;
}

test('consumed read-only inspection retires exact epoch without fabricating queued receipt history', async () => {
  const f = await completedInspectionFixture();
  try {
    await f.persist();
    const before = JSON.stringify(f.history);
    const outcome = await reconcileExpiredElasticReviewLeaseV1(f.args);
    assert.equal(outcome.released, true, JSON.stringify(outcome));
    assert.equal(outcome.classification, 'ELASTIC_CONSUMED_READONLY_INSPECTION_LEASE_RELEASED');
    assert.equal(outcome.terminalExecutionReceiptReconstructed, false);
    assert.equal(outcome.sourceMutationAllowed, false);
    assert.equal(f.releases.length, 1);
    assert.equal(f.releases[0].leaseId, f.lease.leaseId);
    assert.match(f.releases[0].originalLeaseDigest, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(f.history), before);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('completed inspection custody rejects source, identity, journal, receipt and live-writer substitutions', async t => {
  const mutations = {
    'extra revision': f => { f.current.revision += 1; },
    'source phase': f => { f.current.currentPhase = 'AGENT_IMPLEMENTATION'; },
    'original fence': f => { f.current.storeMetadata.originalSourceAttemptFence = { schemaVersion: 'retained' }; },
    'maintenance': f => { f.current.storeMetadata.supervisedRecoveryMaintenance = {}; },
    'parked': f => { f.current.continuity = { parkingStatus: 'PARKED' }; },
    'cancelled': f => { f.current.cancelled = true; },
    'source writer grant': f => { f.item.actionGrant.actionKind = 'agent-handoff'; },
    'writer payload': f => { f.item.payload.activeWriter = 'source'; },
    'foreign lease binding': f => { f.item.executionBinding.leaseKey = 'other-lease'; },
    'foreign head': f => { f.item.actionGrant.headSha = HEAD_C; },
    'expanded grant': f => { f.item.actionGrant.mergeAuthority = true; },
    'duplicate event': f => { f.events.push(f.event); },
    'unconsumed event': f => { f.current.storeMetadata.processedEventIds = []; },
    'wrong last event': f => { f.current.storeMetadata.lastEventId = 'different'; },
    'result hash mismatch': f => { f.result.execution.commandOutputHash = 'e'.repeat(64); },
    'result successor mismatch': f => { f.result.stateRevision += 1; },
    'result failed': f => { f.result.execution.success = false; },
    'different check evidence': f => { f.result.inspection.checks = []; },
    'nonterminal receipt': f => { f.history.latestReceipt.state = 'started'; },
    'additional execution': f => { f.history.receipts.push({ ...f.history.latestReceipt, executionId: 'foreign-action' }); },
    'source incomplete': f => { f.sourceHistory.latestReceipt.state = 'started'; },
    'active original work': f => { f.args.originalMissionInFlightFn = async () => true; },
    'lease changed before CAS': f => { let reads = 0; f.args.readLease = async () => ({ ok: true, present: true,
      record: ++reads === 1 ? f.lease : { ...f.lease, renewedAtUtc: NOW.toISOString() },
      validation: { valid: true, active: true, stale: false } }); },
    'CAS refusal': f => { f.args.releaseLease = async () => ({ ok: false, released: false }); },
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async () => {
    const f = await completedInspectionFixture();
    try {
      mutate(f); await f.persist();
      const outcome = await reconcileExpiredElasticReviewLeaseV1(f.args);
      assert.equal(outcome.released, false, JSON.stringify(outcome));
      assert.equal(f.releases.length, 0);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});


test('completed inspection pending and passing outcomes retain normal operator and review gates', async t => {
  for (const [status, phase] of [['pending', 'CHECK_PULL_REQUEST'], ['success', 'AWAITING_OPERATOR_APPROVAL']]) await t.test(phase, async () => {
    const f = await completedInspectionFixture();
    try {
      f.event.checks[0].status = status;
      f.current.currentPhase = phase; f.result.currentPhase = phase;
      await f.persist();
      const outcome = await reconcileExpiredElasticReviewLeaseV1(f.args);
      assert.equal(outcome.released, true, JSON.stringify(outcome));
      assert.equal(outcome.mergeAuthority, false);
      assert.equal(outcome.sourceMutationAllowed, false);
      assert.equal(f.current.currentPhase, phase);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});


test('consumed read-only publication-failure chain is preserved while exact custody is reconciled', async t => {
  for (const variant of ['exact', 'wrong-stage', 'wrong-blocker', 'extra-record', 'failure-after-consumption']) await t.test(variant, async () => {
    const f = await completedInspectionFixture();
    try {
      const queued = { ...f.history.latestReceipt, receiptId: 'inspection-queued', sequence: 1 };
      const failed = { ...queued, receiptId: 'inspection-failed', sequence: 2, predecessorReceiptId: queued.receiptId,
        state: 'failed', phase: 'pr-head-queue-publication-failed', blocker: 'action-grant-mismatch',
        timestampUtc: new Date(NOW.getTime() - 2000).toISOString() };
      if (variant === 'failure-after-consumption') failed.timestampUtc = NOW.toISOString();
      if (variant === 'wrong-stage') failed.phase = 'readonly-inspection-failed';
      if (variant === 'wrong-blocker') failed.blocker = 'different-failure';
      f.history = { ok: true, receipts: [queued, failed], latestReceipt: failed };
      if (variant === 'extra-record') f.history.receipts.push({ ...failed, state: 'started', receiptId: 'unexpected' });
      await f.persist();
      const before = JSON.stringify(f.history);
      const result = await reconcileExpiredElasticReviewLeaseV1(f.args);
      assert.equal(result.released, variant === 'exact', JSON.stringify(result));
      assert.equal(f.releases.length, variant === 'exact' ? 1 : 0);
      assert.equal(JSON.stringify(f.history), before);
      if (variant === 'exact') {
        assert.equal(result.terminalExecutionReceiptReconstructed, false);
        assert.equal(result.sourceMutationAllowed, false);
      }
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});
