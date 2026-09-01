import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
} from './programmeAuthorityV1.mjs';
import {
  buildCriticalBacklogProjection,
} from './criticalBacklogConveyor.mjs';
import {
  runDurableFlywheelStartupCycle,
} from './durableFlywheelControllerVNext.mjs';
import {
  ensureCriticalBacklogMission,
} from '../../stephanos-server/services/criticalBacklogConveyorService.js';

const NOW = '2026-09-01T16:00:00.000Z';
const SOURCE_REVISION = 'a'.repeat(40);
const REPOSITORY = 'Cheekyfellastef/stephan-os';

function readyProjection(issue) {
  return {
    schemaVersion: AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
    status: 'READY',
    observedAtUtc: NOW,
    blockers: [],
    chatMemoryAuthoritative: false,
    sourceConstructionMode: 'production-contracts',
    lane: null,
    mutationLease: null,
    scheduler: {
      selectedGoal: `#${issue}`,
      decisionReceipt: { selectedIssue: issue },
    },
    projectionReceipt: {
      receiptId: `programme-projection-${issue}`,
      sourceConstructionMode: 'production-contracts',
    },
  };
}

function implementationMission(issue, overrides = {}) {
  return {
    missionId: `critical-${issue}-elastic-goal`,
    revision: 2,
    currentPhase: 'AGENT_IMPLEMENTATION',
    title: `Elastic goal ${issue}`,
    repository: REPOSITORY,
    operatorIntent: `Build goal ${issue} in the bounded elastic lane.`,
    intendedOutcome: `Goal ${issue} reaches verified source completion.`,
    allowedFiles: [`shared/agents/elastic-${issue}.mjs`],
    requiredTests: [`node --test shared/agents/elastic-${issue}.test.mjs`],
    requiredEvidence: ['focused tests'],
    providerRouteIntent: 'AUTO',
    dispatch: { adapter: 'codex', status: 'pending' },
    git: {
      branch: `openclaw/elastic-goal-${issue}`,
      worktreePath: `C:\\worktrees\\critical-${issue}-elastic-goal`,
    },
    ...overrides,
  };
}

function codexCapacity() {
  return {
    nowUtc: NOW,
    codexStatus: {
      schemaVersion: 'shared-agent-workspace-record.v1',
      statusId: 'codex-capacity-current',
      truthState: 'CURRENT',
      meterTruthUsable: true,
      observedAtUtc: NOW,
      remainingPercent: 100,
      availability: 'AVAILABLE',
      confidence: 'high',
    },
  };
}

function readyMachinery(issue, mission, counters = {}) {
  counters.claims ??= 0;
  counters.reads ??= 0;
  counters.dispatches ??= 0;
  counters.receipts ??= 0;
  return {
    publishControllerHeartbeat: async () => ({ ok: true }),
    loadAuthoritativeProjection: async () => readyProjection(issue),
    publishReceipt: async () => {
      counters.receipts += 1;
      return { ok: true };
    },
    ensureBacklogMission: async () => ({
      ok: true,
      createdMission: true,
      classification: 'ELASTIC_GOAL_MISSION_SELECTED',
      projection: {
        selectedItem: {
          mission: { providerRouteIntent: 'AUTO' },
        },
        activeMission: mission,
      },
    }),
    loadCapacityRoutingInput: async () => codexCapacity(),
    claimSourceMutationLease: async (input) => {
      counters.claims += 1;
      counters.claimInput = input;
      return { ok: true, claimed: true, record: input };
    },
    readSourceMutationLease: async () => {
      counters.reads += 1;
      return {
        ok: true,
        present: true,
        validation: { valid: true, active: true, stale: false },
        record: {
          ...counters.claimInput,
          mergeAuthority: false,
          leaseSeizureAllowed: false,
        },
      };
    },
    publishWorkerAction: async ({ actionGrant }) => {
      counters.dispatches += 1;
      counters.lastGrant = actionGrant;
      return {
        published: true,
        actionGrantAccepted: true,
        action: { actionId: actionGrant.actionId },
      };
    },
    finalizeTerminalLane: async () => ({ ok: true }),
  };
}

test('five scheduler-owned elastic missions do not trip the legacy singleton backlog guard', () => {
  const missions = Array.from({ length: 5 }, (_, index) => ({
    missionId: `critical-${1701 + index}-elastic-goal`,
    currentPhase: 'AGENT_IMPLEMENTATION',
  }));
  const projection = buildCriticalBacklogProjection({ missionRecords: missions });
  assert.notEqual(projection.decision, 'BLOCKED_BY_MULTIPLE_ACTIVE_MISSIONS');
  assert.equal(projection.decision, 'CREATE_NEXT_MISSION');
  assert.equal(projection.elasticMissionIds.length, 5);
  assert.equal(projection.elasticGoalMissionsUseSchedulerCapacity, true);
});

test('canonical conveyor service selects scheduler elastic admission before the legacy backlog', async () => {
  let legacyReads = 0;
  const selectedMission = implementationMission(1711, { currentPhase: 'CREATE_WORKTREE' });
  const result = await ensureCriticalBacklogMission({
    env: {},
    now: new Date(NOW),
    paths: {
      repoRoot: 'C:\\repo',
      workspaceRoot: 'C:\\workspace',
      worktreeRoot: 'C:\\worktrees',
      orchestratorRoot: 'C:\\orchestrator',
      snapshotRoot: 'C:\\snapshots',
    },
    readProgrammeProjection: async () => ({
      status: 'READY',
      scheduler: {
        failClosed: false,
        elasticCapacity: { status: 'RUNNING' },
      },
    }),
    ensureElasticMissions: async () => ({
      ok: true,
      createdMissionCount: 5,
      elasticMissions: [selectedMission],
      selectedMission,
    }),
    listMissions: async () => {
      legacyReads += 1;
      return [];
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_GOAL_MISSION_SELECTED');
  assert.equal(result.projection.activeMission.missionId, selectedMission.missionId);
  assert.equal(result.projection.oneActiveMissionEnforced, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(legacyReads, 0);
});

test('pre-PR elastic implementation dispatches from the isolated openclaw worktree without fabricating a PR lease', async () => {
  const issue = 1721;
  const counters = {};
  const result = await runDurableFlywheelStartupCycle(
    readyMachinery(issue, implementationMission(issue), counters),
    { nowUtc: NOW, sourceRevision: SOURCE_REVISION, env: {} },
  );
  assert.equal(result.status, 'READY', JSON.stringify(result));
  assert.equal(result.action, 'DISPATCH_PRE_PR_ISOLATED_SOURCE_MISSION');
  assert.equal(result.allowWorkerTick, true);
  assert.equal(result.workerActionGrant.missionId, `critical-${issue}-elastic-goal`);
  assert.equal(result.workerActionGrant.prNumber, null);
  assert.equal(result.workerActionGrant.headSha, null);
  assert.equal(result.workerActionGrant.branch, `openclaw/elastic-goal-${issue}`);
  assert.equal(result.workerActionGrant.mergeAuthority, false);
  assert.equal(result.workerActionGrant.leaseSeizureAllowed, false);
  assert.equal(counters.claims, 0);
  assert.equal(counters.reads, 0);
  assert.equal(counters.dispatches, 1);
});

test('partial PR identity fails closed rather than downgrading to the pre-PR lease-free boundary', async () => {
  const issue = 1722;
  const counters = {};
  const mission = implementationMission(issue, {
    pullRequest: { number: 2199, headSha: '' },
  });
  const result = await runDurableFlywheelStartupCycle(
    readyMachinery(issue, mission, counters),
    { nowUtc: NOW, sourceRevision: SOURCE_REVISION, env: {} },
  );
  assert.equal(result.status, 'HOLD');
  assert.equal(result.allowWorkerTick, false);
  assert.ok(result.blockers.includes('source-mutation-lease:grant-identity-incomplete'));
  assert.equal(counters.claims, 0);
  assert.equal(counters.dispatches, 0);
});

test('once PR and exact head exist the original exact source mutation lease remains mandatory', async () => {
  const issue = 1723;
  const prNumber = 2200;
  const headSha = 'b'.repeat(40);
  const counters = {};
  const mission = implementationMission(issue, {
    pullRequest: { number: prNumber, headSha },
  });
  const result = await runDurableFlywheelStartupCycle(
    readyMachinery(issue, mission, counters),
    { nowUtc: NOW, sourceRevision: SOURCE_REVISION, env: {} },
  );
  assert.equal(result.status, 'READY', JSON.stringify(result));
  assert.equal(counters.claims, 1);
  assert.equal(counters.reads, 1);
  assert.equal(counters.dispatches, 1);
  assert.equal(counters.claimInput.issueNumber, issue);
  assert.equal(counters.claimInput.prNumber, prNumber);
  assert.equal(counters.claimInput.headSha, headSha);
  assert.equal(counters.claimInput.branch, `openclaw/elastic-goal-${issue}`);
  assert.equal(result.verifiedSourceMutationLeaseIdentity.prNumber, prNumber);
  assert.equal(result.verifiedSourceMutationLeaseIdentity.headSha, headSha);
  assert.equal(result.workerActionGrant.mergeAuthority, false);
});
