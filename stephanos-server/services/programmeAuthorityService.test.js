import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildAffirmativeSchedulerProofSources,
  buildProgrammeStallMonitorRegistration,
  claimSourceMutationLease,
  finalizeTerminalImplementationLane,
  publishProgrammeControllerHeartbeat,
  readAuthoritativeProgrammeProjection,
  readSourceMutationLease,
  releaseSourceMutationLease,
  renewSourceMutationLease,
} from './programmeAuthorityService.js';
import {
  buildCanonicalImplementationLaneProjection,
  buildTerminalLaneFinalizationPlan,
  createSourceMutationLeaseReleaseRecord,
  createTerminalLaneEvidenceRecords,
} from '../../shared/agents/programmeAuthorityV1.mjs';
import {
  appendExecutionReceipt,
  createExecutionReceipt,
} from '../../shared/agents/executionReceiptV1.mjs';
import { ensureSharedWorkspaceLayout } from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import { createSharedWorkspaceProofRecord } from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
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
  };
  const failed = buildAffirmativeSchedulerProofSources({
    records: { proofRecords: [proof] },
  }, null);
  assert.deepEqual(failed.proofHeadShas, []);
  assert.deepEqual(failed.proofReceipts, []);
  assert.deepEqual(failed.proofRefs, []);

  for (const nonAffirmativeStatus of ['OBSERVED', 'ACCEPTED']) {
    const nonAffirmative = buildAffirmativeSchedulerProofSources({
      records: { proofRecords: [{ ...proof, status: nonAffirmativeStatus }] },
    }, null);
    assert.deepEqual(nonAffirmative.proofHeadShas, []);
    assert.deepEqual(nonAffirmative.proofReceipts, []);
    assert.deepEqual(nonAffirmative.proofRefs, []);
  }

  const passed = buildAffirmativeSchedulerProofSources({
    records: { proofRecords: [{ ...proof, status: 'PASS' }] },
  }, null);
  assert.deepEqual(passed.proofHeadShas, [HEAD]);
  assert.deepEqual(passed.proofReceipts, [{ issue: 1497, activePr: 1617, headSha: HEAD }]);
  assert.deepEqual(passed.proofRefs, ['proof/failed.json']);

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
  }, null);
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
  }, null);
  assert.deepEqual(conflictingHeadAliases.proofHeadShas, []);
  assert.deepEqual(conflictingHeadAliases.proofReceipts, []);
  assert.deepEqual(conflictingHeadAliases.proofRefs, []);
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
