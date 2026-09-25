import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  applyGoalClosureReceipts,
  buildAffirmativeSchedulerProofSources,
  buildGithubGoalMirrorEstate,
  buildProgrammeStallMonitorRegistration,
  closeCanonicalGoalFromProgrammeProjection,
  claimSourceMutationLease,
  finalizeTerminalImplementationLane,
  publishGithubGoalMirrorEstate,
  publishProgrammeControllerHeartbeat,
  projectGithubGoalMirrorFallback,
  readAuthoritativeProgrammeProjection,
  readSourceMutationLease,
  releaseSourceMutationLease,
  renewSourceMutationLease,
} from './programmeAuthorityService.js';
import {
  AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
  buildCanonicalImplementationLaneProjection,
  buildTerminalLaneFinalizationPlan,
  createSourceMutationLeaseReleaseRecord,
  createTerminalLaneEvidenceRecords,
} from '../../shared/agents/programmeAuthorityV1.mjs';
import {
  appendExecutionReceipt,
  createExecutionReceipt,
} from '../../shared/agents/executionReceiptV1.mjs';
import {
  SHARED_WORKSPACE_RECORD_KINDS,
  createSharedWorkspaceProofRecord,
  createSharedWorkspaceReceiptRecord,
  ensureSharedWorkspaceLayout,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  CANONICAL_GOAL_REPOSITORY,
  planCanonicalGoalClosure,
} from '../../shared/agents/goalClosureConsumerV1.mjs';
import { buildMissionScheduler } from '../../shared/runtime/missionScheduler.mjs';
import {
  closeGithubGoalIssue,
  readGithubGoalIssue,
} from './githubPrEvidenceService.js';
import {
  LEGACY_COMPLETED_RETIRED_MISSION_ID,
  LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
  RETIRED_COMPLETED_LEGACY_ACCEPTANCE,
  SELF_HOSTING_NON_BLOCKING_MISSION_ACCEPTANCES,
} from '../../shared/agents/criticalBacklogGoalBuildingBootstrapV1.mjs';
import {
  createMissionWorkerHeartbeatRecord,
  resolveCanonicalMissionWorkerPaths,
} from '../../scripts/mission-orchestrator-worker-heartbeat.mjs';

const NOW = '2026-07-30T10:00:00.000Z';
const HEAD = 'a'.repeat(40);
const MERGE = 'b'.repeat(40);
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const LANE_ID = 'goal-1497-pr-1617';
const BRANCH = 'feat/canonical-programme-authority-contracts';
const LEASE_ID = 'lease-goal-1497-pr-1617';
const OWNER = 'codex-pr-1617';

async function fixture(run) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'programme-authority-'));
  const root = path.join(temp, 'shared-workspace');
  const home = path.join(temp, 'home');
  const repoRoot = process.cwd();
  try {
    await ensureSharedWorkspaceLayout({ root, repoRoot });
    await run({ temp, root, home, repoRoot });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

function leaseInput(overrides = {}) {
  return {
    leaseId: LEASE_ID,
    laneId: LANE_ID,
    repository: REPOSITORY,
    issueNumber: 1497,
    prNumber: 1617,
    branch: BRANCH,
    headSha: HEAD,
    ownerId: OWNER,
    nowUtc: '2026-07-30T09:30:00.000Z',
    expiresAtUtc: '2026-07-30T11:30:00.000Z',
    proofRefs: ['proofs/lease-1617.json'],
    ...overrides,
  };
}

function githubOpen() {
  return {
    status: 'fetched',
    source: 'github-api',
    repository: REPOSITORY,
    prNumber: 1617,
    prState: 'open',
    merged: false,
    mergedAt: '',
    mergeCommitSha: '',
    headSha: HEAD,
    headBranch: BRANCH,
    retrievedAt: NOW,
  };
}

function githubMerged() {
  return {
    ...githubOpen(),
    prState: 'closed',
    merged: true,
    mergedAt: '2026-07-30T09:59:00.000Z',
    mergeCommitSha: MERGE,
  };
}

function githubAuthorityOptions(root, repoRoot, github = githubOpen()) {
  return {
    root,
    repoRoot,
    testOnly: true,
    dependencies: {
      resolveGithubTokenConfig: async () => ({
        configured: true,
        token: 'not-published',
        authority: 'test-only',
      }),
      fetchGithubPrEvidence: async () => github,
    },
  };
}

async function publishWorkerHeartbeat(home) {
  const paths = resolveCanonicalMissionWorkerPaths({ home, env: {} });
  const record = createMissionWorkerHeartbeatRecord({
    timestampUtc: NOW,
    repositoryRoot: paths.repositoryRoot,
    branch: 'main',
    headSha: HEAD,
    pid: 1234,
    launchIdentityId: '1'.repeat(64),
    workerStartedAtUtc: '2026-07-30T09:59:00.000Z',
  });
  await mkdir(path.dirname(paths.heartbeatPath), { recursive: true });
  await writeFile(paths.heartbeatPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return { paths, record };
}

async function publishControllerHeartbeat(root, repoRoot) {
  return publishProgrammeControllerHeartbeat({
    controllerId: 'durable-flywheel-controller',
    sourceRevision: HEAD,
    cycleState: 'ACTIVE_LANE',
    activeLaneId: LANE_ID,
    lastSuccessfulReconciliationUtc: '2026-07-30T09:59:00.000Z',
    lastPublishedReceiptId: 'projection-1617',
    timestampUtc: NOW,
    boundedMutationSteps: 1,
  }, { root, repoRoot });
}

async function publishExecutionReceipt(root, repoRoot) {
  const record = createExecutionReceipt({
    receiptId: 'execution-1617-1',
    repository: REPOSITORY,
    issueNumber: 1497,
    prNumber: 1617,
    branch: BRANCH,
    sourceHead: HEAD,
    workerId: OWNER,
    workerType: 'github-first',
    executionId: 'execution-1617',
    leaseKey: LEASE_ID,
    state: 'started',
    phase: 'bounded-source-mutation',
    sequence: 1,
    timestampUtc: '2026-07-30T09:59:00.000Z',
    heartbeatExpiresAtUtc: '2026-07-30T10:01:00.000Z',
    proofRefs: ['proofs/execution-1617.json'],
    expectedNextAction: 'Continue one bounded mutation step.',
  });
  const publication = await appendExecutionReceipt(root, record, {
    repoRoot,
    nowMs: Date.parse(NOW),
  });
  assert.equal(publication.ok, true);
  return record;
}

test('lease acquisition is durable, non-seizing, exactly renewable and exactly releasable', async () => {
  await fixture(async ({ root, repoRoot }) => {
    const conflictingLaneIdentity = await claimSourceMutationLease(leaseInput({
      issueNumber: 1,
    }), githubAuthorityOptions(root, repoRoot));
    assert.equal(conflictingLaneIdentity.ok, false);
    assert.equal(conflictingLaneIdentity.reason, 'lane-id-issue-mismatch');
    assert.equal((await readSourceMutationLease({ root, repoRoot, nowUtc: NOW })).present, false);

    const wrongGithubIdentity = await claimSourceMutationLease(leaseInput({
      branch: 'feat/wrong-branch',
      headSha: 'c'.repeat(40),
    }), githubAuthorityOptions(root, repoRoot));
    assert.equal(wrongGithubIdentity.ok, false);
    assert.equal(wrongGithubIdentity.reason, 'SOURCE_MUTATION_LEASE_GITHUB_IDENTITY_MISMATCH');
    assert.equal((await readSourceMutationLease({ root, repoRoot, nowUtc: NOW })).present, false);

    const claimed = await claimSourceMutationLease(leaseInput(), githubAuthorityOptions(root, repoRoot));
    assert.equal(claimed.ok, true);
    assert.equal(claimed.claimed, true);
    assert.equal(claimed.leaseSeizureAllowed, false);

    const same = await claimSourceMutationLease(leaseInput(), githubAuthorityOptions(root, repoRoot));
    assert.equal(same.ok, true);
    assert.equal(same.idempotent, true);

    const conflict = await claimSourceMutationLease(leaseInput({
      leaseId: 'different-lease',
      ownerId: 'different-owner',
    }), githubAuthorityOptions(root, repoRoot));
    assert.equal(conflict.ok, false);
    assert.equal(conflict.reason, 'SOURCE_MUTATION_LEASE_ALREADY_OWNED');

    const wrongRenewal = await renewSourceMutationLease({
      ...leaseInput(),
      nowUtc: NOW,
      ownerId: 'different-owner',
    }, { root, repoRoot });
    assert.equal(wrongRenewal.ok, false);

    const movedHeadRenewal = await renewSourceMutationLease({
      ...leaseInput(),
      nowUtc: NOW,
    }, githubAuthorityOptions(root, repoRoot, {
      ...githubOpen(),
      headSha: 'c'.repeat(40),
    }));
    assert.equal(movedHeadRenewal.ok, false);
    assert.equal(movedHeadRenewal.reason, 'SOURCE_MUTATION_LEASE_RENEWAL_GITHUB_IDENTITY_MISMATCH');

    const closedPrRenewal = await renewSourceMutationLease({
      ...leaseInput(),
      nowUtc: NOW,
    }, githubAuthorityOptions(root, repoRoot, {
      ...githubOpen(),
      prState: 'closed',
    }));
    assert.equal(closedPrRenewal.ok, false);
    assert.equal(closedPrRenewal.reason, 'SOURCE_MUTATION_LEASE_RENEWAL_GITHUB_TRUTH_INVALID_OR_NON_ACTIVE');

    const renewed = await renewSourceMutationLease({
      ...leaseInput(),
      nowUtc: NOW,
    }, githubAuthorityOptions(root, repoRoot));
    assert.equal(renewed.ok, true);

    const incompleteRelease = await releaseSourceMutationLease({
      nowUtc: NOW,
      leaseId: LEASE_ID,
    }, { root, repoRoot });
    assert.equal(incompleteRelease.ok, false);
    assert.equal(incompleteRelease.reason, 'SOURCE_MUTATION_LEASE_RELEASE_IDENTITY_INCOMPLETE');
    assert.equal((await readSourceMutationLease({ root, repoRoot, nowUtc: NOW })).present, true);

    const wrongRelease = await releaseSourceMutationLease({
      ...leaseInput(),
      nowUtc: NOW,
      headSha: 'c'.repeat(40),
    }, { root, repoRoot });
    assert.equal(wrongRelease.ok, false);
    assert.equal(wrongRelease.releaseOnlyExactLease, true);
    assert.equal((await readSourceMutationLease({ root, repoRoot, nowUtc: NOW })).present, true);

    const interruptedRelease = await releaseSourceMutationLease({
      ...leaseInput(),
      nowUtc: NOW,
    }, {
      root,
      repoRoot,
      testOnly: true,
      dependencies: {
        unlink: async () => {
          const error = new Error('simulated crash after durable release publication');
          error.code = 'EIO';
          throw error;
        },
      },
    });
    assert.equal(interruptedRelease.ok, false);
    assert.equal(interruptedRelease.reason, 'SOURCE_MUTATION_LEASE_RELEASE_FAILED');
    const canonicalRelease = createSourceMutationLeaseReleaseRecord(interruptedRelease.operationResult?.record ?? leaseInput(), {
      timestampUtc: NOW,
    });
    const releaseMarkerPath = path.join(root, 'status', `${canonicalRelease.statusId}.json`);
    const persistedReleaseMarker = JSON.parse(await readFile(releaseMarkerPath, 'utf8'));
    await writeFile(releaseMarkerPath, `${JSON.stringify({
      ...persistedReleaseMarker,
      participantId: 'not-the-release-authority',
      statusId: 'different-release-status',
    }, null, 2)}\n`, 'utf8');
    const conflictingReleaseEnvelope = await readSourceMutationLease({ root, repoRoot, nowUtc: NOW });
    assert.equal(conflictingReleaseEnvelope.ok, false);
    assert.equal(conflictingReleaseEnvelope.reason, 'SOURCE_MUTATION_LEASE_RELEASE_RECORD_CONFLICT');
    await writeFile(releaseMarkerPath, `${JSON.stringify(persistedReleaseMarker, null, 2)}\n`, 'utf8');
    await writeFile(releaseMarkerPath, `${JSON.stringify({
      ...persistedReleaseMarker,
      kind: 'stephanos.shared_workspace.goal',
      goalId: 'forged-release-goal',
    }, null, 2)}\n`, 'utf8');
    const wrongKindReleaseEnvelope = await readSourceMutationLease({ root, repoRoot, nowUtc: NOW });
    assert.equal(wrongKindReleaseEnvelope.ok, false);
    assert.equal(wrongKindReleaseEnvelope.reason, 'SOURCE_MUTATION_LEASE_RELEASE_RECORD_CONFLICT');
    await writeFile(releaseMarkerPath, `${JSON.stringify(persistedReleaseMarker, null, 2)}\n`, 'utf8');
    for (const releasedAtUtc of [
      '2026-07-30T09:00:00.000Z',
      '2026-07-30T09:45:00.000Z',
      '2099-01-01T00:00:00.000Z',
    ]) {
      await writeFile(releaseMarkerPath, `${JSON.stringify({
        ...persistedReleaseMarker,
        timestampUtc: releasedAtUtc,
        releasedAtUtc,
      }, null, 2)}\n`, 'utf8');
      const impossibleReleaseEnvelope = await readSourceMutationLease({ root, repoRoot, nowUtc: NOW });
      assert.equal(impossibleReleaseEnvelope.ok, false);
      assert.equal(impossibleReleaseEnvelope.reason, 'SOURCE_MUTATION_LEASE_RELEASE_RECORD_CONFLICT');
    }
    await writeFile(releaseMarkerPath, `${JSON.stringify(persistedReleaseMarker, null, 2)}\n`, 'utf8');
    const releasedButPresent = await readSourceMutationLease({ root, repoRoot, nowUtc: NOW });
    assert.equal(releasedButPresent.ok, false);
    assert.equal(releasedButPresent.present, true);
    assert.equal(releasedButPresent.reason, 'SOURCE_MUTATION_LEASE_RELEASE_MARKER_PRESENT');

    const renewalAfterRelease = await renewSourceMutationLease({
      ...leaseInput(),
      nowUtc: NOW,
    }, { root, repoRoot });
    assert.equal(renewalAfterRelease.ok, false);
    assert.equal(renewalAfterRelease.reason, 'SOURCE_MUTATION_LEASE_RELEASE_MARKER_PRESENT');

    const released = await releaseSourceMutationLease({
      ...leaseInput(),
      nowUtc: NOW,
    }, { root, repoRoot });
    assert.equal(released.ok, true);
    assert.equal(released.released, true);
    assert.equal(released.recoveredInterruptedRelease, true);
    assert.equal(released.releaseRecord.schema, 'stephanos.source-mutation-lease-release.v1');
    assert.equal(released.releaseRecord.leaseId, LEASE_ID);
    assert.equal((await readSourceMutationLease({ root, repoRoot, nowUtc: NOW })).present, false);

    const exactReplay = await releaseSourceMutationLease({
      ...leaseInput(),
      nowUtc: NOW,
    }, { root, repoRoot });
    assert.equal(exactReplay.ok, true);
    assert.equal(exactReplay.idempotent, true);
    const fabricatedReplay = await releaseSourceMutationLease({
      ...leaseInput(),
      leaseId: 'never-claimed-lease',
      nowUtc: NOW,
    }, { root, repoRoot });
    assert.equal(fabricatedReplay.ok, false);
    assert.equal(fabricatedReplay.reason, 'SOURCE_MUTATION_LEASE_RELEASE_EVIDENCE_MISSING_OR_CONFLICTING');

    const staleLeaseId = 'lease-goal-1497-pr-1617-stale';
    const stale = await claimSourceMutationLease(leaseInput({
      leaseId: staleLeaseId,
      expiresAtUtc: '2026-07-30T09:31:00.000Z',
    }), githubAuthorityOptions(root, repoRoot));
    assert.equal(stale.ok, true);
    const refusedSeizure = await claimSourceMutationLease(leaseInput({
      leaseId: staleLeaseId,
      nowUtc: NOW,
    }), githubAuthorityOptions(root, repoRoot));
    assert.equal(refusedSeizure.ok, false);
    assert.equal(refusedSeizure.reason, 'SOURCE_MUTATION_LEASE_STALE_REQUIRES_RECONCILIATION');
    assert.equal(refusedSeizure.leaseSeizureAllowed, false);
    const staleRelease = await releaseSourceMutationLease({
      ...leaseInput(),
      leaseId: staleLeaseId,
      nowUtc: NOW,
    }, { root, repoRoot });
    assert.equal(staleRelease.ok, true);

    const sharedPrefix = 'lease-release-key'.padEnd(50, 'a');
    const firstCollisionLease = `${sharedPrefix}-one`;
    const secondCollisionLease = `${sharedPrefix}-two`;
    const firstCollision = await claimSourceMutationLease(leaseInput({
      leaseId:firstCollisionLease,
    }), githubAuthorityOptions(root, repoRoot));
    assert.equal(firstCollision.ok, true);
    assert.equal((await releaseSourceMutationLease({
      ...leaseInput(),
      leaseId:firstCollisionLease,
      nowUtc:NOW,
    }, { root, repoRoot })).ok, true);
    const secondCollision = await claimSourceMutationLease(leaseInput({
      leaseId:secondCollisionLease,
    }), githubAuthorityOptions(root, repoRoot));
    assert.equal(secondCollision.ok, true);
  });
});

test('production composition reads real Shared Workspace, receipt, heartbeat, scheduler and conveyor contracts', async () => {
  await fixture(async ({ root, home, repoRoot }) => {
    await claimSourceMutationLease(leaseInput(), githubAuthorityOptions(root, repoRoot));
    await publishControllerHeartbeat(root, repoRoot);
    await publishWorkerHeartbeat(home);
    await publishExecutionReceipt(root, repoRoot);

    const calls = [];
    const projection = await readAuthoritativeProgrammeProjection({
      root,
      home,
      repoRoot,
      nowUtc: NOW,
      env: {},
      testOnly: true,
      dependencies: {
        resolveGithubTokenConfig: async () => {
          calls.push('github-auth');
          return { configured: true, token: 'not-published', authority: 'test-only' };
        },
        fetchGithubPrEvidence: async () => {
          calls.push('github-pr-evidence');
          return githubOpen();
        },
        readRepositoryHead: async () => ({
          ok: true,
          reason: 'CANONICAL_REPOSITORY_HEAD_READ',
          branch: 'main',
          headSha: HEAD,
        }),
        listMissionRecords: async () => [{
          missionId: LANE_ID,
          issueNumber: 1497,
          repository: REPOSITORY,
          git: { branch: BRANCH },
          pullRequest: { number: 1617 },
          currentPhase: 'AGENT_IMPLEMENTATION',
        }],
      },
    });

    assert.equal(projection.productionSourcesConstructed, true);
    assert.equal(projection.dependencyInjectionUsed, true);
    assert.equal(projection.status, 'ACTIVE');
    assert.equal(projection.lane.laneId, LANE_ID);
    assert.equal(projection.lane.headSha, HEAD);
    assert.equal(projection.executionReceipt.leaseKey, LEASE_ID);
    assert.equal(projection.controllerHeartbeat.fresh, true);
    assert.equal(projection.workerHeartbeat.fresh, true);
    assert.equal(projection.scheduler.decisionReceipt.status, 'ACTIVE_LANE');
    assert.equal(projection.criticalBacklog.schemaVersion, 'stephanos.critical-backlog-conveyor.v1');
    assert.equal(projection.projectionReceipt.chatMemoryAuthoritative, false);
    assert.equal(projection.projectionReceipt.sourceConstructionMode, 'production-contracts');
    assert.equal(projection.projectionReceipt.authorityInjectedByCaller, false);
    assert.equal(projection.projectionReceipt.components.some(({ componentId }) => componentId === 'mission-scheduler'), true);
    assert.equal(projection.projectionReceipt.components.some(({ componentId }) => componentId === 'critical-backlog-conveyor'), true);
    assert.deepEqual(calls, ['github-auth', 'github-pr-evidence']);

    const staleProcesses = await readAuthoritativeProgrammeProjection({
      root,
      home,
      repoRoot,
      nowUtc: NOW,
      env: {},
      testOnly: true,
      dependencies: {
        resolveGithubTokenConfig: async () => ({ configured: true, token: 'not-published', authority: 'test-only' }),
        fetchGithubPrEvidence: async () => githubOpen(),
        readRepositoryHead: async () => ({
          ok: true,
          reason: 'CANONICAL_REPOSITORY_HEAD_READ',
          branch: 'main',
          headSha: 'c'.repeat(40),
        }),
        listMissionRecords: async () => [{
          missionId: LANE_ID,
          issueNumber: 1497,
          repository: REPOSITORY,
          git: { branch: BRANCH },
          pullRequest: { number: 1617 },
          currentPhase: 'AGENT_IMPLEMENTATION',
        }],
      },
    });
    assert.equal(staleProcesses.status, 'HOLD');
    assert.ok(staleProcesses.controllerHeartbeat.errors.includes('controller-source-revision-mismatch'));
    assert.ok(staleProcesses.workerHeartbeat.errors.includes('worker-head-mismatch'));
  });
});

test('production composition admits an active critical mission when the workspace has no goal records', async () => {
  await fixture(async ({ root, home, repoRoot }) => {
    await publishProgrammeControllerHeartbeat({
      controllerId: 'durable-flywheel-controller',
      sourceRevision: HEAD,
      cycleState: 'IDLE',
      activeLaneId: null,
      lastSuccessfulReconciliationUtc: NOW,
      lastPublishedReceiptId: 'wait-for-durable-goal-evidence',
      timestampUtc: NOW,
      boundedMutationSteps: 0,
    }, { root, repoRoot });
    await publishWorkerHeartbeat(home);

    const projection = await readAuthoritativeProgrammeProjection({
      root,
      home,
      repoRoot,
      nowUtc: NOW,
      env: {},
      testOnly: true,
      dependencies: {
        readWorkspaceFeed: async () => ({
          state: 'ready',
          records: { goalRecords: [], statusRecords: [], proofRecords: [] },
        }),
        readRepositoryHead: async () => ({
          ok: true,
          reason: 'CANONICAL_REPOSITORY_HEAD_READ',
          branch: 'main',
          headSha: HEAD,
        }),
        listMissionRecords: async () => [
          {
            missionId: LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
            currentPhase: 'AGENT_IMPLEMENTATION',
          },
          {
            missionId: LEGACY_COMPLETED_RETIRED_MISSION_ID,
            currentPhase: 'COMPLETE',
          },
          {
            missionId: 'critical-1292-1293-dispatch-conveyor',
            repository: REPOSITORY,
            git: { branch: 'openclaw/critical-1292-1293-dispatch-conveyor' },
            currentPhase: 'CREATE_WORKTREE',
          },
        ],
      },
    });

    assert.equal(projection.criticalBacklog.decision, 'WAIT_ACTIVE_MISSION');
    assert.deepEqual(projection.criticalBacklog.nonBlockingPersistedMissionIds, [
      LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
      LEGACY_COMPLETED_RETIRED_MISSION_ID,
    ]);
    assert.deepEqual(
      projection.criticalBacklog.nonBlockingMissionAcceptances,
      SELF_HOSTING_NON_BLOCKING_MISSION_ACCEPTANCES,
    );
    const retiredAcceptance = projection.criticalBacklog.nonBlockingMissionAcceptances
      .find(({ missionId }) => missionId === LEGACY_COMPLETED_RETIRED_MISSION_ID);
    assert.deepEqual(retiredAcceptance, RETIRED_COMPLETED_LEGACY_ACCEPTANCE);
    assert.equal(retiredAcceptance.state, 'CLOSED_RETIRED');
    assert.deepEqual(retiredAcceptance.successorIssueNumbers, [2158]);
    assert.equal(projection.scheduler.failClosed, false);
    assert.equal(projection.scheduler.selectedGoal, '#1292');
    assert.equal(projection.scheduler.selectedRoute, 'OPENCLAW_LOCAL');
    assert.equal(projection.scheduler.decisionReceipt.status, 'LANE_SELECTED');
    assert.equal(projection.status, 'READY', projection.blockers.join(','));
  });
});

test('an exact durable release marker is inactive evidence and cannot strand the next critical mission', async () => {
  await fixture(async ({ root, home, repoRoot }) => {
    const claimed = await claimSourceMutationLease(leaseInput(), githubAuthorityOptions(root, repoRoot));
    assert.equal(claimed.ok, true);
    const interruptedRelease = await releaseSourceMutationLease({
      ...leaseInput(),
      nowUtc: NOW,
    }, {
      root,
      repoRoot,
      testOnly: true,
      dependencies: {
        unlink: async () => {
          const error = new Error('simulated process loss after exact release publication');
          error.code = 'EIO';
          throw error;
        },
      },
    });
    assert.equal(interruptedRelease.ok, false);
    assert.equal(interruptedRelease.reason, 'SOURCE_MUTATION_LEASE_RELEASE_FAILED');
    const releasedRead = await readSourceMutationLease({ root, repoRoot, nowUtc: NOW });
    assert.equal(releasedRead.reason, 'SOURCE_MUTATION_LEASE_RELEASE_MARKER_PRESENT');

    await publishProgrammeControllerHeartbeat({
      controllerId: 'durable-flywheel-controller',
      sourceRevision: HEAD,
      cycleState: 'IDLE',
      activeLaneId: null,
      lastSuccessfulReconciliationUtc: NOW,
      lastPublishedReceiptId: 'released-lease-observed',
      timestampUtc: NOW,
      boundedMutationSteps: 0,
    }, { root, repoRoot });
    await publishWorkerHeartbeat(home);
    let githubFetches = 0;
    const projection = await readAuthoritativeProgrammeProjection({
      root,
      home,
      repoRoot,
      nowUtc: NOW,
      env: {},
      testOnly: true,
      dependencies: {
        readWorkspaceFeed: async () => ({
          state: 'ready',
          records: { goalRecords: [], statusRecords: [], proofRecords: [] },
        }),
        readRepositoryHead: async () => ({
          ok: true,
          reason: 'CANONICAL_REPOSITORY_HEAD_READ',
          branch: 'main',
          headSha: HEAD,
        }),
        listMissionRecords: async () => [{
          missionId: 'critical-1291-worker-watchdog-repair',
          repository: REPOSITORY,
          git: { branch: 'openclaw/critical-1291-worker-watchdog-repair' },
          currentPhase: 'CREATE_WORKTREE',
        }],
        readCapacityRoutingInput: async () => ({
          provenRouteIds: ['CODEX', 'CHATGPT_GITHUB', 'FOUNDRY_FORGE', 'OPENCLAW_LOCAL'],
          availableExecutorSlots: 4,
        }),
        fetchGithubPrEvidence: async () => {
          githubFetches += 1;
          throw new Error('a released lease must not retain GitHub lane authority');
        },
      },
    });

    assert.equal(githubFetches, 0);
    assert.equal(projection.mutationLease, null);
    assert.equal(projection.lane, null);
    assert.equal(projection.sourceReads.lease, 'SOURCE_MUTATION_LEASE_RELEASED_INACTIVE');
    assert.equal(projection.scheduler.selectedGoal, '#1292');
    assert.equal(projection.scheduler.selectedRoute, 'OPENCLAW_LOCAL');
    assert.equal(projection.status, 'READY', projection.blockers.join(','));
    assert.equal(projection.blockers.includes('source:SOURCE_MUTATION_LEASE_RELEASE_MARKER_PRESENT'), false);
  });
});

test('missing mutation lease cannot be replaced by an execution receipt correlation field', async () => {
  await fixture(async ({ root, home, repoRoot }) => {
    await publishControllerHeartbeat(root, repoRoot);
    await publishWorkerHeartbeat(home);
    const projection = await readAuthoritativeProgrammeProjection({
      root,
      home,
      repoRoot,
      nowUtc: NOW,
      env: {},
    });
    assert.notEqual(projection.status, 'ACTIVE');
    assert.equal(projection.lane, null);
    assert.equal(projection.mutationLease, null);

    const forgedProductionCommand = await readAuthoritativeProgrammeProjection({
      root,
      home,
      repoRoot,
      nowUtc: NOW,
      env: {},
      execFile: async (_command, args) => ({
        stdout: args.includes('--abbrev-ref') ? 'main\n' : `${HEAD}\n`,
      }),
    });
    assert.notEqual(forgedProductionCommand.sourceReads.repositoryHead, 'CANONICAL_REPOSITORY_HEAD_READ');
  });
});

test('production composition can discover exact GitHub lane truth before lease acquisition without injected authority objects', async () => {
  await fixture(async ({ root, home, repoRoot }) => {
    await publishControllerHeartbeat(root, repoRoot);
    await publishWorkerHeartbeat(home);
    const projection = await readAuthoritativeProgrammeProjection({
      root,
      home,
      repoRoot,
      nowUtc: NOW,
      env: {},
      targetLaneId: LANE_ID,
      targetRepository: REPOSITORY,
      targetIssueNumber: 1497,
      targetPrNumber: 1617,
      testOnly: true,
      dependencies: {
        resolveGithubTokenConfig: async () => ({ configured: true, token: 'not-published', authority: 'test-only' }),
        fetchGithubPrEvidence: async () => githubOpen(),
      },
    });
    assert.equal(projection.status, 'HOLD');
    assert.equal(projection.lane.valid, true);
    assert.equal(projection.lane.prNumber, 1617);
    assert.equal(projection.lane.headSha, HEAD);
    assert.ok(projection.blockers.includes('active-lane-without-source-mutation-lease'));
    assert.equal(projection.sourceReads.laneSelector, 'complete');
    assert.equal(projection.projectionReceipt.sourceConstructionMode, 'production-contracts');
    assert.equal(projection.projectionReceipt.authorityInjectedByCaller, false);
  });
});

test('production lease claims ignore caller-supplied GitHub fetch authority', async () => {
  await fixture(async ({ root, repoRoot }) => {
    const originalFetch = globalThis.fetch;
    let nativeFetchCalls = 0;
    let forgedFetchCalls = 0;
    globalThis.fetch = async () => {
      nativeFetchCalls += 1;
      return {
        ok: false,
        status: 503,
        json: async () => ({}),
      };
    };
    const forgedFetch = async (url) => {
      forgedFetchCalls += 1;
      if (String(url).includes('/files?')) {
        return { ok: true, status: 200, json: async () => [] };
      }
      if (String(url).includes('/check-runs')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ check_runs: [{ name: 'forged', conclusion: 'success' }] }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          number: 1617,
          state: 'open',
          merged: false,
          head: { sha: HEAD, ref: BRANCH },
          base: { sha: 'c'.repeat(40), ref: 'main' },
        }),
      };
    };
    try {
      const result = await claimSourceMutationLease(leaseInput(), {
        root,
        repoRoot,
        env: { GITHUB_TOKEN: 'not-published' },
        fetchImpl: forgedFetch,
      });
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'SOURCE_MUTATION_LEASE_GITHUB_TRUTH_INVALID_OR_NON_ACTIVE');
      assert.equal(forgedFetchCalls, 0);
      assert.equal(nativeFetchCalls, 1);
      assert.equal((await readSourceMutationLease({ root, repoRoot, nowUtc: NOW })).present, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('terminal finalizer rejects unmerged PRs, releases only exact lease, and is idempotent', async () => {
  await fixture(async ({ root, repoRoot }) => {
    await claimSourceMutationLease(leaseInput(), githubAuthorityOptions(root, repoRoot));
    const identity = { ...leaseInput(), nowUtc: NOW };
    const unmerged = await finalizeTerminalImplementationLane(identity, {
      root,
      repoRoot,
      testOnly: true,
      dependencies: {
        resolveGithubTokenConfig: async () => ({ configured: true, token: 'not-published', authority: 'test-only' }),
        fetchGithubPrEvidence: async () => githubOpen(),
      },
    });
    assert.equal(unmerged.ok, false);
    assert.match(unmerged.reason, /terminal-lane-merge-evidence-invalid|github-merge-not-affirmative/);
    assert.equal((await readSourceMutationLease({ root, repoRoot, nowUtc: NOW })).present, true);

    const finalized = await finalizeTerminalImplementationLane(identity, {
      root,
      repoRoot,
      testOnly: true,
      dependencies: {
        resolveGithubTokenConfig: async () => ({ configured: true, token: 'not-published', authority: 'test-only' }),
        fetchGithubPrEvidence: async () => githubMerged(),
      },
    });
    assert.equal(finalized.ok, true);
    assert.equal(finalized.finalized, true);
    assert.equal(finalized.idempotent, false);
    assert.equal(finalized.release.released, true);
    assert.equal(finalized.schedulesWork, false);
    assert.equal(finalized.mergeAuthority, false);
    assert.equal((await readSourceMutationLease({ root, repoRoot, nowUtc: NOW })).present, false);

    const repeated = await finalizeTerminalImplementationLane(identity, {
      root,
      repoRoot,
      testOnly: true,
      dependencies: {
        resolveGithubTokenConfig: async () => {
          throw new Error('idempotent finalization must not refetch GitHub after durable receipt');
        },
      },
    });
    assert.equal(repeated.ok, true);
    assert.equal(repeated.idempotent, true);
    assert.equal(repeated.release.reason, 'SOURCE_MUTATION_LEASE_ALREADY_RELEASED');

    const receiptPath = path.join(root, 'receipts', `${finalized.records.evidenceId}.json`);
    const proofPath = path.join(root, 'proof', `${finalized.records.evidenceId}.json`);
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    const proof = JSON.parse(await readFile(proofPath, 'utf8'));
    assert.equal(receipt.laneId, LANE_ID);
    assert.equal(receipt.prNumber, 1617);
    assert.equal(receipt.headSha, HEAD);
    assert.equal(receipt.leaseId, LEASE_ID);
    assert.equal(proof.leaseId, LEASE_ID);
    assert.equal(proof.ownerId, OWNER);
    assert.equal(proof.mergeAuthority, false);

    await writeFile(receiptPath, `${JSON.stringify({
      ...receipt,
      relatedIssue: '#1',
      relatedPr: '#2',
      correlationId: 'different-lease',
    }, null, 2)}\n`, 'utf8');
    const conflictingReceiptAliases = await finalizeTerminalImplementationLane(identity, {
      root,
      repoRoot,
      testOnly: true,
      dependencies: {
        resolveGithubTokenConfig: async () => {
          throw new Error('conflicting durable receipt aliases must block before GitHub access');
        },
      },
    });
    assert.equal(conflictingReceiptAliases.ok, false);
    assert.equal(conflictingReceiptAliases.reason, 'TERMINAL_FINALIZATION_EVIDENCE_MISSING');
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');

    await writeFile(receiptPath, `${JSON.stringify({
      ...receipt,
      kind: 'stephanos.shared_workspace.proof',
      proofId: receipt.receiptId,
      refs: receipt.proofRefs,
      status: 'MERGED',
    }, null, 2)}\n`, 'utf8');
    const wrongKindReceipt = await finalizeTerminalImplementationLane(identity, {
      root,
      repoRoot,
      testOnly: true,
      dependencies: {
        resolveGithubTokenConfig: async () => {
          throw new Error('wrong-kind durable receipt must block before GitHub access');
        },
      },
    });
    assert.equal(wrongKindReceipt.ok, false);
    assert.equal(wrongKindReceipt.reason, 'TERMINAL_FINALIZATION_EVIDENCE_MISSING');
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');

    await writeFile(proofPath, `${JSON.stringify({
      ...proof,
      relatedIssue: '#1',
      relatedPr: '#2',
      correlationId: 'different-lease',
    }, null, 2)}\n`, 'utf8');
    const conflictingProofAliases = await finalizeTerminalImplementationLane(identity, {
      root,
      repoRoot,
      testOnly: true,
      dependencies: {
        resolveGithubTokenConfig: async () => {
          throw new Error('conflicting durable proof aliases must block before GitHub access');
        },
      },
    });
    assert.equal(conflictingProofAliases.ok, false);
    assert.equal(conflictingProofAliases.reason, 'TERMINAL_FINALIZATION_EVIDENCE_MISSING');
    await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');

    await writeFile(proofPath, `${JSON.stringify({
      ...proof,
      kind: 'stephanos.shared_workspace.record.receipt',
      receiptId: proof.proofId,
      receivedRecordId: proof.proofId,
      disposition: 'terminal-evidence-published',
    }, null, 2)}\n`, 'utf8');
    const wrongKindProof = await finalizeTerminalImplementationLane(identity, {
      root,
      repoRoot,
      testOnly: true,
      dependencies: {
        resolveGithubTokenConfig: async () => {
          throw new Error('wrong-kind durable proof must block before GitHub access');
        },
      },
    });
    assert.equal(wrongKindProof.ok, false);
    assert.equal(wrongKindProof.reason, 'TERMINAL_FINALIZATION_EVIDENCE_MISSING');
    await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');

    const expectedProofRef = `proof/${finalized.records.evidenceId}.json`;
    await writeFile(proofPath, `${JSON.stringify({
      ...proof,
      proofRefs: [expectedProofRef, 'proof/conflicting-terminal-proof.json'],
      refs: [expectedProofRef],
    }, null, 2)}\n`, 'utf8');
    const conflictingProofRefs = await finalizeTerminalImplementationLane(identity, {
      root,
      repoRoot,
      testOnly: true,
      dependencies: {
        resolveGithubTokenConfig: async () => {
          throw new Error('conflicting durable proof refs must block before GitHub access');
        },
      },
    });
    assert.equal(conflictingProofRefs.ok, false);
    assert.equal(conflictingProofRefs.reason, 'TERMINAL_FINALIZATION_EVIDENCE_MISSING');
    await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');

    await writeFile(proofPath, `${JSON.stringify({ ...proof, mergeCommitSha: '' }, null, 2)}\n`, 'utf8');
    const corruptedMergeProof = await finalizeTerminalImplementationLane(identity, {
      root,
      repoRoot,
      testOnly: true,
      dependencies: {
        resolveGithubTokenConfig: async () => {
          throw new Error('corrupted durable merge proof must block before GitHub access');
        },
      },
    });
    assert.equal(corruptedMergeProof.ok, false);
    assert.equal(corruptedMergeProof.reason, 'TERMINAL_FINALIZATION_EVIDENCE_MISSING');
    await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');

    await rm(proofPath);
    const missingProof = await finalizeTerminalImplementationLane(identity, {
      root,
      repoRoot,
      testOnly: true,
      dependencies: {
        resolveGithubTokenConfig: async () => {
          throw new Error('missing proof must block before GitHub access');
        },
      },
    });
    assert.equal(missingProof.ok, false);
    assert.equal(missingProof.reason, 'TERMINAL_FINALIZATION_EVIDENCE_MISSING');
  });
});

test('terminal finalizer resumes an interrupted exact release from durable evidence', async () => {
  await fixture(async ({ root, repoRoot }) => {
    const claimed = await claimSourceMutationLease(leaseInput(), githubAuthorityOptions(root, repoRoot));
    assert.equal(claimed.ok, true);
    const identity = { ...leaseInput(), nowUtc: NOW };
    const interrupted = await finalizeTerminalImplementationLane(identity, {
      root,
      repoRoot,
      testOnly: true,
      dependencies: {
        resolveGithubTokenConfig: async () => ({
          configured: true,
          token: 'not-published',
          authority: 'test-only',
        }),
        fetchGithubPrEvidence: async () => githubMerged(),
        unlink: async () => {
          const error = new Error('simulated crash after durable release publication');
          error.code = 'EIO';
          throw error;
        },
      },
    });
    assert.equal(interrupted.ok, false);
    assert.equal(interrupted.reason, 'SOURCE_MUTATION_LEASE_RELEASE_FAILED');
    assert.equal(interrupted.terminalEvidencePublished, true);
    const markerPresent = await readSourceMutationLease({ root, repoRoot, nowUtc: NOW });
    assert.equal(markerPresent.ok, false);
    assert.equal(markerPresent.present, true);
    assert.equal(markerPresent.reason, 'SOURCE_MUTATION_LEASE_RELEASE_MARKER_PRESENT');

    const recovered = await finalizeTerminalImplementationLane(identity, {
      root,
      repoRoot,
      testOnly: true,
      dependencies: {
        resolveGithubTokenConfig: async () => {
          throw new Error('durable exact recovery must not refetch GitHub');
        },
      },
    });
    assert.equal(recovered.ok, true);
    assert.equal(recovered.finalized, true);
    assert.equal(recovered.idempotent, true);
    assert.equal(recovered.reason, 'TERMINAL_LANE_ALREADY_FINALIZED');
    assert.equal(recovered.release.recoveredInterruptedRelease, true);
    assert.equal(recovered.release.reason, 'SOURCE_MUTATION_LEASE_RELEASE_COMPLETED_FROM_DURABLE_MARKER');
    assert.equal((await readSourceMutationLease({ root, repoRoot, nowUtc: NOW })).present, false);
  });
});

test('terminal finalizer rejects replayed merge facts that conflict with fresh GitHub evidence', async () => {
  await fixture(async ({ root, repoRoot }) => {
    const claimed = await claimSourceMutationLease(leaseInput(), githubAuthorityOptions(root, repoRoot));
    assert.equal(claimed.ok, true);
    const terminalLane = buildCanonicalImplementationLaneProjection({
      ...leaseInput(),
      github: githubMerged(),
      mutationLease: claimed.record,
      nowUtc: NOW,
    });
    const plan = buildTerminalLaneFinalizationPlan({
      lane: terminalLane,
      mutationLease: claimed.record,
      github: githubMerged(),
      leaseId: LEASE_ID,
      ownerId: OWNER,
      nowUtc: NOW,
    });
    assert.equal(plan.valid, true);
    const records = createTerminalLaneEvidenceRecords(plan, { timestampUtc: NOW });
    await writeFile(
      path.join(root, 'receipts', `${records.evidenceId}.json`),
      `${JSON.stringify(records.receipt, null, 2)}\n`,
      'utf8',
    );
    await writeFile(
      path.join(root, 'proof', `${records.evidenceId}.json`),
      `${JSON.stringify({ ...records.proof, mergeCommitSha: 'c'.repeat(40) }, null, 2)}\n`,
      'utf8',
    );

    const replayed = await finalizeTerminalImplementationLane({
      ...leaseInput(),
      nowUtc: NOW,
    }, {
      root,
      repoRoot,
      testOnly: true,
      dependencies: {
        resolveGithubTokenConfig: async () => ({ configured: true, token: 'not-published', authority: 'test-only' }),
        fetchGithubPrEvidence: async () => githubMerged(),
      },
    });
    assert.equal(replayed.ok, false);
    assert.equal(replayed.reason, 'TERMINAL_RECEIPT_IDENTITY_CONFLICT');
    assert.equal((await readSourceMutationLease({ root, repoRoot, nowUtc: NOW })).present, true);
  });
});

test('scheduler proof bindings require a validated affirmative proof status', () => {
  const proof = {
    ...createSharedWorkspaceProofRecord({
      proofId: 'proof-1617',
      participantId: 'battle-bridge',
      timestampUtc: NOW,
      correlationId: 'goal-1497-pr-1617',
      relatedIssue: '#1497',
      relatedPr: '#1617',
      status: 'FAILED',
      summary: 'Exact-head proof failed.',
      refs: ['proof/failed.json'],
      proofRefs: ['proof/failed.json'],
    }),
    issueNumber: 1497,
    prNumber: 1617,
    headSha: HEAD,
    repository: REPOSITORY,
    branch: BRANCH,
  };
  const failed = buildAffirmativeSchedulerProofSources({
    records: { proofRecords: [proof] },
  }, null, { nowUtc: NOW });
  assert.deepEqual(failed.proofHeadShas, []);
  assert.deepEqual(failed.proofReceipts, []);
  assert.deepEqual(failed.proofRefs, []);

  for (const nonAffirmativeStatus of ['OBSERVED', 'ACCEPTED']) {
    const nonAffirmative = buildAffirmativeSchedulerProofSources({
      records: { proofRecords: [{ ...proof, status: nonAffirmativeStatus }] },
    }, null, { nowUtc: NOW });
    assert.deepEqual(nonAffirmative.proofHeadShas, []);
    assert.deepEqual(nonAffirmative.proofReceipts, []);
    assert.deepEqual(nonAffirmative.proofRefs, []);
  }

  const passed = buildAffirmativeSchedulerProofSources({
    records: { proofRecords: [{ ...proof, status: 'PASS' }] },
  }, null, { nowUtc: NOW });
  assert.deepEqual(passed.proofHeadShas, [HEAD]);
  assert.deepEqual(passed.proofReceipts, [{
    issue: 1497,
    activePr: 1617,
    headSha: HEAD,
    repository: REPOSITORY.toLowerCase(),
    branch: BRANCH,
  }]);
  assert.deepEqual(passed.proofRefs, ['proof/failed.json']);

  for (const incompleteOrConflictingIdentity of [
    { repository: undefined },
    { branch: undefined },
    { repositoryFullName: 'other/repository' },
    { headBranch: 'feat/other-branch' },
  ]) {
    const held = buildAffirmativeSchedulerProofSources({
      records: {
        proofRecords: [{
          ...proof,
          status: 'PASS',
          ...incompleteOrConflictingIdentity,
        }],
      },
    }, null, { nowUtc: NOW });
    assert.deepEqual(held.proofReceipts, []);
  }

  const conflictingAliases = buildAffirmativeSchedulerProofSources({
    records: {
      proofRecords: [{
        ...proof,
        status: 'PASS',
        relatedIssue: '#1',
        relatedPr: '#2',
        issueNumber: 1497,
        prNumber: 1617,
      }],
    },
  }, null, { nowUtc: NOW });
  assert.deepEqual(conflictingAliases.proofHeadShas, []);
  assert.deepEqual(conflictingAliases.proofReceipts, []);
  assert.deepEqual(conflictingAliases.proofRefs, []);

  const conflictingHeadAliases = buildAffirmativeSchedulerProofSources({
    records: {
      proofRecords: [{
        ...proof,
        status: 'PASS',
        sourceHead: 'c'.repeat(40),
      }],
    },
  }, null, { nowUtc: NOW });
  assert.deepEqual(conflictingHeadAliases.proofHeadShas, []);
  assert.deepEqual(conflictingHeadAliases.proofReceipts, []);
  assert.deepEqual(conflictingHeadAliases.proofRefs, []);

  for (const invalidAuthority of [
    { timestampUtc: '2099-01-01T00:00:00.000Z' },
    { headSha: null, sourceHead: HEAD },
    { repository: null, repositoryFullName: REPOSITORY },
  ]) {
    const held = buildAffirmativeSchedulerProofSources({
      records: {
        proofRecords: [{
          ...proof,
          status: 'PASS',
          ...invalidAuthority,
        }],
      },
    }, null, { nowUtc: NOW });
    assert.deepEqual(held.proofHeadShas, []);
    assert.deepEqual(held.proofReceipts, []);
    assert.deepEqual(held.proofRefs, []);
  }
});

test('programme stall registration exposes only a handler for the existing monitor runtime', () => {
  const registration = buildProgrammeStallMonitorRegistration({
    relatedIssue: '#1497',
    nextDueUtc: NOW,
    testOnly: true,
    dependencies: {
      validateWorkspaceConfig: async () => ({ ok: false, reason: 'TEST_NOT_EXECUTED' }),
    },
  });
  assert.equal(registration.ok, true);
  assert.equal(registration.runtime, 'monitor-multiplexer');
  assert.equal(registration.startsNewRuntime, false);
  assert.equal(registration.createsScheduler, false);
  assert.equal(registration.createsWorker, false);
  assert.equal(typeof Object.values(registration.handlers)[0], 'function');
});


function completedClosureGoal(overrides = {}) {
  return {
    issue: 4242,
    title: 'Goal: canonical completion retirement test',
    state: 'COMPLETE',
    prerequisites: [],
    priority: 1,
    criticalPathWeight: 1,
    reversibility: 'HIGH',
    route: 'CHATGPT_GITHUB',
    evidenceAt: NOW,
    resultProofRefs: ['proof/result-4242.json'],
    reusableCapabilityId: 'CAPABILITY_GOAL_RETIREMENT_V1',
    sharedLessonId: 'LESSON_CLOSE_ONLY_AFTER_CANONICAL_PROOF',
    ...overrides,
  };
}

function goalClosureProjection() {
  const schedulerInput = {
    now: NOW,
    goals: [completedClosureGoal()],
    correlationId: 'goal-closure-service-test',
  };
  const scheduler = buildMissionScheduler(schedulerInput);
  const goalClosurePlan = planCanonicalGoalClosure({
    repository: CANONICAL_GOAL_REPOSITORY,
    schedulerInput,
  });
  assert.equal(scheduler.failClosed, false);
  assert.equal(goalClosurePlan.state, 'READY');
  return {
    schemaVersion: AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
    sourceConstructionMode: 'production-contracts',
    chatMemoryAuthoritative: false,
    scheduler,
    goalClosurePlan,
  };
}

function goalClosureDependencies(overrides = {}) {
  return {
    resolveGithubTokenConfig: async () => ({
      configured: true,
      token: 'test-only-token',
      authority: 'test-only',
    }),
    readGithubGoalIssue: async ({ issueNumber }) => ({
      number: issueNumber,
      state: 'open',
      state_reason: '',
      labels: [{ name: 'goal' }],
      pull_request: null,
      repository: CANONICAL_GOAL_REPOSITORY,
    }),
    closeGithubGoalIssue: async ({ issueNumber }) => ({
      number: issueNumber,
      state: 'closed',
      state_reason: 'completed',
      labels: [{ name: 'goal' }],
      repository: CANONICAL_GOAL_REPOSITORY,
    }),
    ...overrides,
  };
}

function durableGoalClosureReceipt(overrides = {}) {
  return {
    ...createSharedWorkspaceReceiptRecord({
      receiptId: 'durable-flywheel-closure-test',
      participantId: 'durable-flywheel-controller',
      timestampUtc: NOW,
      correlationId: 'goal-4242-closure',
      relatedIssue: '#4242',
      receivedRecordId: 'programme-projection-test',
      disposition: 'active',
      summary: 'CLOSE_CANONICAL_GOAL: canonical goal retired.',
      proofRefs: ['receipts/durable-flywheel-closure-test.json'],
    }),
    schema: 'stephanos.durable-flywheel-cycle-receipt.vnext',
    controllerId: 'durable-flywheel-controller',
    goalClosureState: 'CLOSED_COMPLETED',
    goalClosureStateReason: 'completed',
    goalClosureRepository: CANONICAL_GOAL_REPOSITORY,
    goalClosureIssueNumber: 4242,
    goalClosureResultProofRefs: ['proof/result-4242.json'],
    goalClosureReusableCapabilityId: 'CAPABILITY_GOAL_RETIREMENT_V1',
    goalClosureSharedLessonId: 'LESSON_CLOSE_ONLY_AFTER_CANONICAL_PROOF',
    mergeAuthority: false,
    ...overrides,
  };
}

test('canonical CLOSE_READY goal closes once and a forged scheduler binding cannot reach GitHub', async () => {
  const calls = [];
  const projection = goalClosureProjection();
  const result = await closeCanonicalGoalFromProgrammeProjection(projection, {
    testOnly: true,
    dependencies: goalClosureDependencies({
      closeGithubGoalIssue: async ({ issueNumber }) => {
        calls.push(issueNumber);
        return {
          number: issueNumber,
          state: 'closed',
          state_reason: 'completed',
          labels: [{ name: 'goal' }],
          repository: CANONICAL_GOAL_REPOSITORY,
        };
      },
    }),
  });
  assert.deepEqual(calls, [4242]);
  assert.equal(result.state, 'CLOSED_COMPLETED');
  assert.equal(result.stateReason, 'completed');
  assert.deepEqual(result.resultProofRefs, ['proof/result-4242.json']);

  let reads = 0;
  const forged = {
    ...projection,
    goalClosurePlan: {
      ...projection.goalClosurePlan,
      request: { ...projection.goalClosurePlan.request, sharedLessonId: 'FORGED_LESSON' },
    },
  };
  const blocked = await closeCanonicalGoalFromProgrammeProjection(forged, {
    testOnly: true,
    dependencies: goalClosureDependencies({
      readGithubGoalIssue: async () => { reads += 1; return {}; },
    }),
  });
  assert.equal(blocked.state, 'BLOCKED');
  assert.equal(blocked.reason, 'CANONICAL_GOAL_CLOSURE_PLAN_SCHEDULER_MISMATCH');
  assert.equal(reads, 0);
});

test('goal closure accepts GitHub issue identity returned as a decimal string', async () => {
  const projection = goalClosureProjection();
  const result = await closeCanonicalGoalFromProgrammeProjection(projection, {
    testOnly: true,
    dependencies: goalClosureDependencies({
      readGithubGoalIssue: async ({ issueNumber }) => ({
        number: String(issueNumber),
        state: 'open',
        state_reason: '',
        labels: [{ name: 'goal' }],
        pull_request: null,
        repository: CANONICAL_GOAL_REPOSITORY,
      }),
      closeGithubGoalIssue: async ({ issueNumber }) => ({
        number: String(issueNumber),
        state: 'closed',
        state_reason: 'completed',
        labels: [{ name: 'goal' }],
        repository: CANONICAL_GOAL_REPOSITORY,
      }),
    }),
  });
  assert.equal(result.state, 'CLOSED_COMPLETED');
  assert.equal(result.issueNumber, 4242);
});

test('goal closure planner refuses COMPLETE work without all human-AI flywheel outputs', () => {
  for (const patch of [
    { resultProofRefs: [] },
    { reusableCapabilityId: '' },
    { sharedLessonId: '' },
  ]) {
    const plan = planCanonicalGoalClosure({
      repository: CANONICAL_GOAL_REPOSITORY,
      schedulerInput: { now: NOW, goals: [completedClosureGoal(patch)] },
    });
    assert.equal(plan.state, 'BLOCKED');
    assert.equal(plan.issueStateMutationAllowed, false);
  }
});

test('durable completed receipt closes only its bound goal and newer GitHub reopen truth wins', () => {
  const goal = {
    schemaVersion: 'shared-agent-workspace-record.v1',
    kind: SHARED_WORKSPACE_RECORD_KINDS.GOAL,
    goalId: 'goal-4242',
    participantId: 'programme-authority',
    timestampUtc: '2026-07-30T09:59:00.000Z',
    issueNumber: 4242,
    title: 'Goal: preserve history',
    state: 'COMPLETE',
    status: 'COMPLETE',
    resultProofRefs: ['proof/result-4242.json'],
    reusableCapabilityId: 'CAPABILITY_GOAL_RETIREMENT_V1',
    sharedLessonId: 'LESSON_CLOSE_ONLY_AFTER_CANONICAL_PROOF',
  };
  const unrelated = { ...goal, goalId: 'goal-4243', issueNumber: 4243, title: 'Goal: unrelated' };

  const closed = applyGoalClosureReceipts([goal, unrelated], [durableGoalClosureReceipt()]);
  assert.equal(closed[0].state, 'CLOSED');
  assert.equal(closed[0].title, goal.title);
  assert.equal(closed[0].goalClosureState, 'CLOSED_COMPLETED');
  assert.equal(closed[1].state, 'COMPLETE');

  const reopenedAt = '2026-07-30T10:01:00.000Z';
  const reopened = applyGoalClosureReceipts(
    [goal],
    [durableGoalClosureReceipt()],
    { ok: true, issues: [{ issueNumber: 4242, state: 'open', retrievedAt: reopenedAt }] },
  );
  assert.equal(reopened[0].state, 'READY');
  assert.equal(reopened[0].goalClosureState, 'REOPENED_AFTER_COMPLETION');

  for (const forged of [
    durableGoalClosureReceipt({ goalClosureRepository: 'other/repo' }),
    durableGoalClosureReceipt({ goalClosureStateReason: 'not_planned' }),
    durableGoalClosureReceipt({ goalClosureResultProofRefs: [] }),
    durableGoalClosureReceipt({ goalClosureReusableCapabilityId: null }),
    durableGoalClosureReceipt({ controllerId: 'other-controller' }),
    durableGoalClosureReceipt({ mergeAuthority: true }),
  ]) {
    const [unchanged] = applyGoalClosureReceipts([goal], [forged]);
    assert.equal(unchanged.state, 'COMPLETE');
  }
});

test('GitHub goal close adapter emits only the canonical completed-state PATCH', async () => {
  const calls = [];
  const auth = { configured: true, token: 'test-only-token', authority: 'test-only' };
  const closed = await closeGithubGoalIssue({
    owner: 'Cheekyfellastef',
    repo: 'stephan-os',
    issueNumber: 4242,
    auth,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            number: 4242,
            state: 'closed',
            state_reason: 'completed',
            title: 'Goal: test',
            labels: [{ name: 'goal' }],
          };
        },
      };
    },
  });
  assert.equal(closed.state_reason, 'completed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    state: 'closed',
    state_reason: 'completed',
  });

  let networkCalls = 0;
  const rejected = await closeGithubGoalIssue({
    owner: 'Cheekyfellastef',
    repo: 'other-repo',
    issueNumber: 4242,
    auth,
    fetchImpl: async () => { networkCalls += 1; throw new Error('must not run'); },
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'CANONICAL_GOAL_ISSUE_IDENTITY_REQUIRED');
  assert.equal(networkCalls, 0);

  const read = await readGithubGoalIssue({
    owner: 'Cheekyfellastef',
    repo: 'stephan-os',
    issueNumber: 4242,
    auth,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { number: 4242, state: 'open', labels: [{ name: 'goal' }], pull_request: null };
      },
    }),
  });
  assert.equal(read.number, 4242);
  assert.deepEqual(read.labels, [{ name: 'goal' }]);
});


test('GitHub goal estate is mirrored durably with a bounded outage lease', async () => {
  const goalEstate = {
    ok: true,
    reason: 'GITHUB_GOAL_ESTATE_FETCHED',
    retrievedAt: NOW,
    issues: [{
      issueNumber: 2002,
      repository: REPOSITORY,
      title: 'Goal Building Agent',
      retrievedAt: NOW,
      htmlUrl: 'https://github.com/Cheekyfellastef/stephan-os/issues/2002',
      admission: {
        resourceIds: ['repo:Cheekyfellastef/stephan-os:path:shared/agents'],
      },
      operatorLaneContainment: { active: false },
    }],
    discoveredIssues: [{ issueNumber: 2002, retrievedAt: NOW }],
  };
  const mirror = buildGithubGoalMirrorEstate([], goalEstate, NOW);
  assert.equal(mirror.ok, true);
  assert.deepEqual(mirror.mirroredIssueNumbers, [2002]);
  assert.equal(mirror.records.length, 1);
  const record = mirror.records[0];
  assert.equal(record.goalId, 'goal-2002');
  assert.equal(record.source, 'github-goal-estate-mirror');
  assert.equal(record.mirrorBuildPickupAllowed, true);
  assert.equal(record.state, 'READY');
  assert.equal(record.route, 'OPENCLAW_LOCAL');
  assert.equal(record.mergeAuthority, false);
  assert.equal(
    Date.parse(record.mirrorLeaseExpiresAtUtc) - Date.parse(record.mirrorObservedAtUtc),
    24 * 60 * 60 * 1000,
  );

  const writes = [];
  const publication = await publishGithubGoalMirrorEstate(mirror, {
    root: '/workspace',
    repoRoot: '/repo',
    testOnly: true,
    dependencies: {
      acquireSharedWorkspaceOperationLock: async () => ({
        ok: true,
        release: async () => true,
      }),
      readFile: async () => {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      },
      writeAtomicJson: async (root, segments, candidate) => {
        writes.push({ root, segments, candidate });
        return { ok: true, reason: 'ATOMIC_JSON_WRITTEN' };
      },
    },
  });
  assert.equal(publication.ok, true);
  assert.deepEqual(publication.publishedIssueNumbers, [2002]);
  const goalWrite = writes.find(({ segments }) => segments.join('/') === 'goals/goal-2002.json');
  assert.deepEqual(goalWrite.segments, ['goals', 'goal-2002.json']);
  assert.equal(publication.reconciliationStatus.status, 'READY');
  assert.equal(publication.reconciliationStatus.fallbackAllowed, true);
});

test('goal mirror provides bounded failover when GitHub goal estate is unavailable', () => {
  const mirror = buildGithubGoalMirrorEstate([], {
    ok: true,
    reason: 'GITHUB_GOAL_ESTATE_FETCHED',
    retrievedAt: NOW,
    issues: [{
      issueNumber: 2002,
      repository: REPOSITORY,
      title: 'Goal Building Agent',
      retrievedAt: NOW,
      admission: { resourceIds: ['repo:Cheekyfellastef/stephan-os:path:shared/agents'] },
      operatorLaneContainment: { active: false },
    }],
    discoveredIssues: [{ issueNumber: 2002, retrievedAt: NOW }],
  }, NOW);
  const scheduler = {
    selectedGoal: '#2002',
    decisionReceipt: { selectedIssue: 2002 },
    parallelCandidateDetails: [{ candidateId: '#2002', issue: 2002 }],
  };
  const reconciliationStatus = {
    schemaVersion: 'shared-agent-workspace-record.v1',
    kind: SHARED_WORKSPACE_RECORD_KINDS.STATUS,
    statusId: 'github-goal-mirror-reconciliation',
    participantId: 'programme-authority',
    timestampUtc: NOW,
    status: 'READY',
    schema: 'stephanos.github-goal-mirror-reconciliation.v1',
    mirrorObservedAtUtc: NOW,
    mirrorLeaseExpiresAtUtc: '2026-07-31T10:00:00.000Z',
    mirroredIssueNumbers: [2002],
    fallbackAllowed: true,
    singleCanonicalScheduler: true,
    duplicateMissionPreventionByCanonicalIssueIdentity: true,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
  };
  const twoHoursLater = '2026-07-30T12:00:00.000Z';
  const fallback = projectGithubGoalMirrorFallback(
    mirror.records,
    { ok: false, reason: 'GITHUB_GOAL_ESTATE_READ_FAILED' },
    scheduler,
    twoHoursLater,
    [reconciliationStatus],
  );
  assert.equal(fallback.active, true);
  assert.equal(fallback.valid, true);
  assert.deepEqual(fallback.issueNumbers, [2002]);
  assert.equal(fallback.singleCanonicalScheduler, true);
  assert.equal(fallback.duplicateMissionPreventionByCanonicalIssueIdentity, true);

  const expired = projectGithubGoalMirrorFallback(
    mirror.records,
    { ok: false, reason: 'GITHUB_GOAL_ESTATE_READ_FAILED' },
    scheduler,
    '2026-07-31T11:00:01.000Z',
    [reconciliationStatus],
  );
  assert.equal(expired.active, true);
  assert.equal(expired.valid, false);
  assert.deepEqual(expired.missingIssueNumbers, [2002]);
});

test('goal mirror parks unadmitted goals and tombstones goals missing from the live GitHub estate', () => {
  const initial = buildGithubGoalMirrorEstate([], {
    ok: true,
    retrievedAt: NOW,
    issues: [{
      issueNumber: 2002,
      repository: REPOSITORY,
      title: 'Goal Building Agent',
      retrievedAt: NOW,
      admission: { resourceIds: ['repo:Cheekyfellastef/stephan-os:path:shared/agents'] },
      operatorLaneContainment: { active: false },
    }],
    discoveredIssues: [{ issueNumber: 2002, retrievedAt: NOW }],
  }, NOW);

  const parked = buildGithubGoalMirrorEstate(initial.records, {
    ok: true,
    retrievedAt: '2026-07-30T10:30:00.000Z',
    issues: [],
    discoveredIssues: [{ issueNumber: 2002, retrievedAt: '2026-07-30T10:30:00.000Z' }],
  }, '2026-07-30T10:30:00.000Z');
  assert.equal(parked.records[0].state, 'WAITING_FOR_EXTERNAL_CONDITION');
  assert.equal(parked.records[0].githubAdmissionState, 'ADMISSION_UNPROVEN');
  assert.equal(parked.records[0].mirrorBuildPickupAllowed, false);

  const tombstoned = buildGithubGoalMirrorEstate(parked.records, {
    ok: true,
    retrievedAt: '2026-07-30T11:00:00.000Z',
    issues: [],
    discoveredIssues: [],
  }, '2026-07-30T11:00:00.000Z');
  assert.equal(tombstoned.records[0].state, 'CLOSED');
  assert.equal(tombstoned.records[0].route, 'CLOSED');
  assert.equal(tombstoned.records[0].githubAdmissionState, 'NOT_OPEN_OR_GOAL_LABEL_REMOVED');
  assert.equal(tombstoned.records[0].mirrorBuildPickupAllowed, false);
});


test('goal mirror refresh preserves active and complete lifecycle truth', () => {
  for (const [state, route] of [
    ['ACTIVE', 'CHATGPT_GITHUB'],
    ['COMPLETE', 'WAITING_FOR_EXTERNAL_CONDITION'],
  ]) {
    const existing = {
      schemaVersion: 'shared-agent-workspace-record.v1',
      kind: SHARED_WORKSPACE_RECORD_KINDS.GOAL,
      goalId: 'goal-2002',
      participantId: 'programme-authority',
      timestampUtc: '2026-07-30T09:00:00.000Z',
      issueNumber: 2002,
      relatedIssue: '#2002',
      repository: REPOSITORY,
      title: 'Goal Building Agent',
      status: state,
      state,
      route,
      prerequisites: [],
      resourceIds: ['repo:Cheekyfellastef/stephan-os:path:shared/agents'],
      mirrorSchema: 'stephanos.github-goal-mirror.v1',
      mirrorRepository: REPOSITORY,
      mirrorIssueNumber: 2002,
      mirrorObservedAtUtc: '2026-07-30T09:00:00.000Z',
      mirrorLeaseExpiresAtUtc: '2026-07-31T09:00:00.000Z',
      mirrorBuildPickupAllowed: false,
      mergeAuthority: false,
      deploymentAuthority: false,
      runtimeMutationAuthority: false,
      arbitraryShellAllowed: false,
    };
    const refreshed = buildGithubGoalMirrorEstate([existing], {
      ok: true,
      retrievedAt: NOW,
      issues: [{
        issueNumber: 2002,
        repository: REPOSITORY,
        title: 'Goal Building Agent',
        retrievedAt: NOW,
        admission: { resourceIds: existing.resourceIds },
        operatorLaneContainment: { active: false },
      }],
      discoveredIssues: [{ issueNumber: 2002, retrievedAt: NOW }],
    }, NOW);
    assert.equal(refreshed.records[0].state, state);
    assert.equal(refreshed.records[0].route, route);
    assert.equal(refreshed.records[0].mirrorBuildPickupAllowed, false);
  }
});

test('goal mirror publication serializes observations and rejects an older overlapping refresh', async () => {
  const older = buildGithubGoalMirrorEstate([], {
    ok: true,
    retrievedAt: NOW,
    issues: [{
      issueNumber: 2002,
      repository: REPOSITORY,
      title: 'Goal Building Agent',
      retrievedAt: NOW,
      admission: { resourceIds: ['repo:Cheekyfellastef/stephan-os:path:shared/agents'] },
      operatorLaneContainment: { active: false },
    }],
    discoveredIssues: [{ issueNumber: 2002, retrievedAt: NOW }],
  }, NOW);
  const newerStatus = {
    schemaVersion: 'shared-agent-workspace-record.v1',
    kind: SHARED_WORKSPACE_RECORD_KINDS.STATUS,
    statusId: 'github-goal-mirror-reconciliation',
    participantId: 'programme-authority',
    timestampUtc: '2026-07-30T10:30:00.000Z',
    status: 'READY',
    schema: 'stephanos.github-goal-mirror-reconciliation.v1',
    mirrorObservedAtUtc: '2026-07-30T10:30:00.000Z',
    mirrorLeaseExpiresAtUtc: '2026-07-31T10:30:00.000Z',
    mirroredIssueNumbers: [2002],
    fallbackAllowed: true,
    singleCanonicalScheduler: true,
    duplicateMissionPreventionByCanonicalIssueIdentity: true,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
  };
  let writes = 0;
  const result = await publishGithubGoalMirrorEstate(older, {
    root: '/workspace',
    repoRoot: '/repo',
    testOnly: true,
    dependencies: {
      acquireSharedWorkspaceOperationLock: async () => ({ ok: true, release: async () => true }),
      readFile: async (pathValue) => {
        if (String(pathValue).includes('github-goal-mirror-reconciliation.json')) {
          return JSON.stringify(newerStatus);
        }
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      },
      writeAtomicJson: async () => {
        writes += 1;
        return { ok: true, reason: 'ATOMIC_JSON_WRITTEN' };
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.classification, 'GITHUB_GOAL_MIRROR_OBSERVATION_SUPERSEDED');
  assert.deepEqual(result.supersededIssueNumbers, [2002]);
  assert.equal(writes, 0);
});

test('failed goal revocation leaves a durable fail-closed reconciliation fence', async () => {
  const priorReady = buildGithubGoalMirrorEstate([], {
    ok: true,
    retrievedAt: '2026-07-30T09:00:00.000Z',
    issues: [{
      issueNumber: 2002,
      repository: REPOSITORY,
      title: 'Goal Building Agent',
      retrievedAt: '2026-07-30T09:00:00.000Z',
      admission: { resourceIds: ['repo:Cheekyfellastef/stephan-os:path:shared/agents'] },
      operatorLaneContainment: { active: false },
    }],
    discoveredIssues: [{ issueNumber: 2002, retrievedAt: '2026-07-30T09:00:00.000Z' }],
  }, '2026-07-30T09:00:00.000Z').records[0];

  const revoked = buildGithubGoalMirrorEstate([priorReady], {
    ok: true,
    retrievedAt: NOW,
    issues: [],
    discoveredIssues: [],
  }, NOW);
  const statusWrites = [];
  const result = await publishGithubGoalMirrorEstate(revoked, {
    root: '/workspace',
    repoRoot: '/repo',
    testOnly: true,
    dependencies: {
      acquireSharedWorkspaceOperationLock: async () => ({ ok: true, release: async () => true }),
      readFile: async (pathValue) => {
        if (String(pathValue).includes('goal-2002.json')) return JSON.stringify(priorReady);
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      },
      writeAtomicJson: async (root, segments, candidate) => {
        if (segments.join('/') === 'goals/goal-2002.json') {
          return { ok: false, reason: 'SIMULATED_GOAL_WRITE_FAILURE' };
        }
        statusWrites.push(candidate);
        return { ok: true, reason: 'ATOMIC_JSON_WRITTEN' };
      },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.fallbackFenced, true);
  assert.equal(result.reconciliationStatus.status, 'BLOCKED');
  assert.equal(result.reconciliationStatus.fallbackAllowed, false);
  assert.ok(statusWrites.some((record) => record.status === 'RECONCILING'));
  assert.ok(statusWrites.some((record) => record.status === 'BLOCKED'));

  const scheduler = {
    selectedGoal: '#2002',
    decisionReceipt: { selectedIssue: 2002 },
    parallelCandidateDetails: [{ candidateId: '#2002', issue: 2002 }],
  };
  const fallback = projectGithubGoalMirrorFallback(
    [priorReady],
    { ok: false, reason: 'GITHUB_GOAL_ESTATE_READ_FAILED' },
    scheduler,
    '2026-07-30T12:00:00.000Z',
    [result.reconciliationStatus],
  );
  assert.equal(fallback.valid, false);
  assert.equal(fallback.classification, 'GOAL_MIRROR_FAILOVER_RECONCILIATION_UNPROVEN');
});
