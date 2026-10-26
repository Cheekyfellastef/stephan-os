import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMissionRecord, appendMissionEvent, readMissionRecord } from './missionOrchestratorStore.js';
import { publishMissionWorkerAction } from './missionOrchestratorWorkerService.js';
import { claimNextMissionWorkerItem } from './missionOrchestratorWorkerConsumer.js';

import { DEFAULT_CRITICAL_BACKLOG } from '../../shared/agents/criticalBacklogConveyor.mjs';
import { projectElasticAdmissionGateV1 } from './criticalBacklogConveyorServiceCore.js';
import {
  applyMissionOrchestratorEvent,
  createMissionOrchestratorState,
  RETRYABLE_AGENT_FAILURE_BLOCKERS,
} from '../../shared/agents/missionOrchestrator.mjs';

test('parking preserves bounded model-failure retries without bypassing custody, budget or scope', async t => {
  const failures = [...RETRYABLE_AGENT_FAILURE_BLOCKERS.filter(x => x !== 'SOURCE_ARTIFACT_DIFF_CHECK_FAILED'),
    'PROVIDER_NEUTRAL_STRUCTURED_EDIT_CONTENT_INVALID:stephanos-server/services/example.js'];
  for (const failure of failures) for (const mode of ['released', 'custody-held', 'dirty', 'exhausted', 'mixed', 'running', 'revision-moved']) {
    await t.test(`${failure}:${mode}`, async () => {
      const paths = await roots();
      const mission = elasticImplementationMission(2964);
      let state = createMissionOrchestratorState({...mission, branch: mission.git.branch,
        worktreePath: mission.git.worktreePath, repositoryRoot: paths.repoRoot});
      const proof = receiptId => ({receiptId, requirement: 'fixture proof', source: 'deterministic-test',
        evidenceType: 'command-output', verified: true, exitCode: 0});
      for (const event of [
        {eventType: 'WORKTREE_READY', worktreePath: mission.git.worktreePath, clean: true, receipt: proof('park-retry-worktree')},
        {eventType: 'AGENT_DISPATCHED', agentId: 'foundry-forge'},
        {eventType: 'AGENT_RESULT_RECEIVED', success: false, resultId: 'critical-2964-elastic-goal-r5-original', error: failure},
        {eventType: 'MISSION_PARKED_FOR_REPAIR', reason: failure, repairOwner: 'goal-building-agent',
          repairRef: '#2002', receipt: proof('park-retry-parking')},
      ]) state = applyMissionOrchestratorEvent(state, event);
      assert.equal(state.continuity.parkingStatus, 'PARKED_BLOCKED');
      if (mode === 'exhausted') state.repair.currentRound = 3;
      if (mode === 'mixed') state.blockers.push('SOURCE_MUTATION_LEASE_HELD');
      if (mode === 'running') state.dispatch.status = 'running';
      const before = structuredClone(state), calls = [];
      const result = await retrySafelyBlockedAgentFailure({paths, backlog: [], env: {},
        listMissions: async () => [structuredClone(state)],
        readProgrammeProjection: async () => assert.fail('model retries retain the already authenticated test plan'),
        proveRetryOwnershipReleased: async () => { calls.push('custody'); return {ok: mode !== 'custody-held',
          classification: 'MISSION_WORKER_RETRY_TERMINAL_EXECUTION_RECEIPT_UNPROVEN'}; },
        refreshRetryWorktree: async () => { calls.push('worktree'); return {ok: mode !== 'dirty', classification: 'RETRY_WORKTREE_DIRTY'}; },
        appendEvent: async (missionId, event) => {
          calls.push('append'); assert.equal(missionId, before.missionId);
          assert.equal(event.expectedRevision, before.revision); assert.equal(event.expectedCurrentPhase, 'BLOCKED');
          if (mode === 'revision-moved') return {preconditionFailed: true};
          state = applyMissionOrchestratorEvent(state, event);
          return {state};
        },
      });
      assert.equal(result.retried, mode === 'released');
      if (mode === 'released') {
        assert.deepEqual(calls, ['custody', 'worktree', 'append']);
        assert.equal(state.continuity.parkingStatus, 'ACTIVE');
        assert.equal(state.currentPhase, 'AGENT_IMPLEMENTATION');
        assert.equal(state.dispatch.status, 'pending');
        assert.equal(state.repair.currentRound, before.repair.currentRound + 1);
        assert.deepEqual(state.requiredTests, before.requiredTests);
        assert.deepEqual(state.allowedFiles, before.allowedFiles);
        assert.deepEqual(state.repair.history.at(-1).previousDispatch, before.dispatch);
        assert.equal(state.repair.history.at(-1).previousParkingStatus, 'PARKED_BLOCKED');
        assert.deepEqual(state.continuity.history.slice(0, -1), before.continuity.history);
      } else {
        assert.deepEqual(state, before);
        if (['exhausted', 'mixed', 'running'].includes(mode)) assert.deepEqual(calls, []);
        if (mode === 'custody-held') assert.deepEqual(calls, ['custody']);
        if (mode === 'dirty') assert.deepEqual(calls, ['custody', 'worktree']);
      }
    });
  }
});
import { createMissionWorkerHeartbeatRecord } from '../../scripts/mission-orchestrator-worker-heartbeat.mjs';
import {
  GOAL_BUILDING_SELF_HOSTING_MISSION_ID,
  LEGACY_COMPLETED_RETIRED_MISSION_ID,
  LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
  RETIRED_COMPLETED_LEGACY_ACCEPTANCE,
  SELF_HOSTING_CRITICAL_BACKLOG,
  SELF_HOSTING_NON_BLOCKING_MISSION_ACCEPTANCES,
} from '../../shared/agents/criticalBacklogGoalBuildingBootstrapV1.mjs';
import {
  dispatchElasticGoalBuilds,
  ensureCriticalBacklogMission,
  publishCriticalBacklogProjection,
  projectExecutiveIngressAcceptance,
  recoverOrphanedLegacyCriticalMission,
  parkSafelyBlockedCriticalMission,
  readmitReentryReadyCriticalMission,
  retrySafelyBlockedAgentFailure,
  refreshRetryWorktreeToCurrentMain,
  resolveCriticalBacklogRuntimePaths,
} from './criticalBacklogConveyorService.js';

async function roots() {
  const root = await mkdtemp(join(tmpdir(), 'critical-conveyor-'));
  return resolveCriticalBacklogRuntimePaths({
    repoRoot: join(root, 'repo'),
    workspaceRoot: join(root, 'workspace'),
    worktreeRoot: join(root, 'worktrees'),
    orchestratorRoot: join(root, 'orchestrator'),
    snapshotRoot: join(root, 'snapshots'),
  });
}

test('conveyor retains canonical programme HOLD evidence on deferred legacy admission', async () => {
  const paths = await roots();
  const result = await ensureCriticalBacklogMission({
    allowLegacyMissionCreation: false,
    paths,
    now: new Date('2026-10-08T04:00:00.000Z'),
    readProgrammeProjection: async () => ({
      status: 'HOLD',
      blockers: ['active-lane-execution-receipt-missing', 'critical-backlog-active-lane-status-mismatch'],
      scheduler: { failClosed: false, elasticCapacity: { status: 'RUNNING' } },
      machineryInventory: { sourceHead: 'a'.repeat(40) },
    }),
    listMissions: async () => [],
    publishProjection: async () => ({ ok: true }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CREATE_NEXT_MISSION_DEFERRED_TO_DURABLE_CONTROLLER');
  assert.equal(result.programmeStatus, 'HOLD');
  assert.deepEqual(result.programmeBlockers, [
    'active-lane-execution-receipt-missing',
    'critical-backlog-active-lane-status-mismatch',
  ]);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.createdMission, false);
});


test('elastic admission gate diagnoses a canonical programme HOLD without authorizing the bypass', async () => {
  const gate = projectElasticAdmissionGateV1({
    programmeStatus: 'HOLD',
    programmeBlockers: ['source-mutation-lease-held', 'phase-lease-reconciliation-blocked'],
    sourceRevision: 'a'.repeat(40),
    scheduler: { failClosed: false, elasticCapacity: { status: 'RUNNING' } },
  });
  assert.equal(gate.admissionPreflightEligible, false);
  assert.equal(gate.blocker, 'AUTHORITATIVE_PROGRAMME_HOLD');
  assert.deepEqual(gate.programmeBlockers, ['source-mutation-lease-held', 'phase-lease-reconciliation-blocked']);
  assert.equal(gate.canonicalOwner, '#2961');
  assert.equal(gate.sourceMutationAllowed, false);
  assert.equal(gate.leaseOverrideAllowed, false);

  const paths = await roots();
  const result = await ensureCriticalBacklogMission({
    allowLegacyMissionCreation: false, paths,
    now: new Date('2026-10-09T20:50:00.000Z'),
    readProgrammeProjection: async () => ({
      status: 'HOLD', blockers: ['source-mutation-lease-held'],
      scheduler: { failClosed: false, elasticCapacity: { status: 'RUNNING' } },
      machineryInventory: { sourceHead: 'a'.repeat(40) },
    }),
    listMissions: async () => [],
    publishProjection: async () => ({ ok: true }),
  });
  assert.equal(result.elasticAdmissionGate.blocker, 'AUTHORITATIVE_PROGRAMME_HOLD');
  assert.equal(result.elasticAdmissionGate.admissionPreflightEligible, false);
  assert.equal(result.elasticAdmission, null);
  assert.equal(result.elasticIgnition, null);
  assert.equal(result.mergeAuthority, false);
});

test('elastic admission gate identifies head, scheduler and capacity faults separately', () => {
  const gate = projectElasticAdmissionGateV1({
    programmeStatus: 'READY', sourceRevision: '',
    scheduler: { failClosed: true, elasticCapacity: { status: 'PAUSED' } },
  });
  assert.deepEqual(gate.gateReasons, [
    'ELASTIC_ADMISSION_SOURCE_HEAD_INVALID',
    'PROGRAMME_SCHEDULER_FAIL_CLOSED',
    'ELASTIC_SCHEDULER_CAPACITY_NOT_RUNNING',
  ]);
  assert.equal(gate.admissionPreflightEligible, false);
  const eligible = projectElasticAdmissionGateV1({
    programmeStatus: 'READY', sourceRevision: 'b'.repeat(40),
    scheduler: { failClosed: false, elasticCapacity: { status: 'RUNNING' } },
  });
  assert.equal(eligible.admissionPreflightEligible, true);
  assert.equal(eligible.mergeAuthority, false);
});
test('retry worktree refresh fast-forwards only a clean matching branch to canonical current main', () => {
  const oldHead = '1'.repeat(40);
  const newHead = '2'.repeat(40);
  let merged = false;
  const result = refreshRetryWorktreeToCurrentMain({
    mission: { repositoryRoot: 'C:\\repo', git: { worktreePath: 'C:\\worktree', branch: 'openclaw/retry-proof' } },
    repoRoot: 'C:\\repo',
    runCommand: (_exe, args) => {
      const cwd = args[1];
      const command = args.slice(2).join(' ');
      if (command === 'status --porcelain=v1 --untracked-files=all') return { status: 0, stdout: '', stderr: '' };
      if (command === 'branch --show-current') return { status: 0, stdout: 'openclaw/retry-proof\n', stderr: '' };
      if (command === 'rev-parse HEAD') return { status: 0, stdout: ((cwd === 'C:\\repo' || merged) ? newHead : oldHead) + '\n', stderr: '' };
      if (command === 'merge-base --is-ancestor ' + oldHead + ' ' + newHead) return { status: 0, stdout: '', stderr: '' };
      if (command === 'merge --ff-only ' + newHead) { merged = true; return { status: 0, stdout: 'Fast-forward\n', stderr: '' }; }
      throw new Error('unexpected git command: ' + command);
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.classification, 'RETRY_WORKTREE_FAST_FORWARDED');
  assert.equal(result.beforeHead, oldHead);
  assert.equal(result.afterHead, newHead);
  assert.equal(result.clean, true);
});

test('retry worktree refresh refuses a dirty worktree before mutation', () => {
  let calls = 0;
  const result = refreshRetryWorktreeToCurrentMain({
    mission: { repositoryRoot: 'C:\\repo', git: { worktreePath: 'C:\\worktree', branch: 'openclaw/retry-proof' } },
    repoRoot: 'C:\\repo',
    runCommand: () => { calls += 1; return { status: 0, stdout: '?? partial.txt\n', stderr: '' }; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.classification, 'RETRY_WORKTREE_NOT_CLEAN');
  assert.equal(calls, 1);
});
function inMemoryMissionStore(initial = []) {
  const records = structuredClone(initial);
  return {
    records,
    listMissions: async () => structuredClone(records),
    createMission: async (mission) => {
      if (records.some((record) => record.missionId === mission.missionId)) {
        throw new Error(`Mission already exists: ${mission.missionId}`);
      }
      const state = {
        missionId: mission.missionId,
        currentPhase: 'CREATE_WORKTREE',
        git: { branch: mission.branch, worktreePath: mission.worktreePath },
      };
      records.push(state);
      return { state };
    },
  };
}

const now = new Date('2026-07-17T18:00:00.000Z');

function activeCriticalMission(overrides = {}) {
  const mission = DEFAULT_CRITICAL_BACKLOG[0].mission;
  return {
    missionId: mission.missionId,
    title: mission.title,
    repository: mission.repository,
    operatorIntent: mission.operatorIntent,
    intendedOutcome: mission.intendedOutcome,
    allowedFiles: [...mission.allowedFiles],
    requiredTests: [...mission.requiredTests],
    requiredEvidence: [...mission.requiredEvidence],
    revision: 7,
    currentPhase: 'AGENT_IMPLEMENTATION',
    git: {
      branch: mission.branch,
      worktreePath: '/bounded/critical-1291-worker-watchdog-repair',
    },
    ...overrides,
  };
}

function elasticImplementationMission(issueNumber = 91) {
  return {
    missionId: `critical-${issueNumber}-elastic-goal`,
    title: `Elastic goal ${issueNumber}`,
    repository: 'Cheekyfellastef/stephan-os',
    operatorIntent: `Advance durable goal #${issueNumber} through one bounded implementation lane.`,
    intendedOutcome: `Durable goal #${issueNumber} reaches its next governed source checkpoint.`,
    allowedFiles: [`shared/agents/elastic-goal-${issueNumber}.mjs`],
    requiredTests: [`node --test shared/agents/elastic-goal-${issueNumber}.test.mjs`],
    requiredEvidence: ['focused elastic-goal proof'],
    revision: 1,
    currentPhase: 'AGENT_IMPLEMENTATION',
    git: {
      branch: `openclaw/elastic-goal-${issueNumber}`,
      worktreePath: `/bounded/critical-${issueNumber}-elastic-goal`,
    },
  };
}

test('continuity parking can see an elastic blocked goal outside the static backlog', async () => {
  const paths = await roots();
  const mission = {
    ...elasticImplementationMission(1818),
    revision: 8,
    currentPhase: 'BLOCKED',
    dispatch: { status: 'complete' },
    continuity: { parkingStatus: 'ACTIVE' },
    blockers: ['CONTROLLER_STALLED_MISSION: elastic verification stalled'],
  };
  let observedEvent = null;
  const result = await parkSafelyBlockedCriticalMission({
    paths,
    listMissions: async () => [mission],
    appendEvent: async (_missionId, event) => {
      observedEvent = event;
      return {
        state: {
          ...mission,
          revision: 9,
          continuity: { parkingStatus: 'PARKED_BLOCKED' },
        },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.parked, true);
  assert.equal(result.classification, 'BLOCKED_MISSION_PROOF_PARKED');
  assert.equal(result.missionId, 'critical-1818-elastic-goal');
  assert.equal(observedEvent.eventType, 'MISSION_PARKED_FOR_REPAIR');
});

test('a busy blocked mission parking transition does not stop independently admitted elastic work', async () => {
  const paths = await roots();
  const blocked = { ...elasticImplementationMission(3036), revision: 3, currentPhase: 'BLOCKED',
    dispatch: { status: 'failed' }, continuity: { parkingStatus: 'ACTIVE' },
    blockers: ['SOURCE_ARTIFACT_PARENT_HEAD_GRANT_MISMATCH'] };
  const independent = { ...elasticImplementationMission(4008), currentPhase: 'VERIFYING',
    dispatch: { status: 'complete' }, continuity: { parkingStatus: 'ACTIVE' } };
  const before = JSON.stringify([blocked, independent]);
  let transitions = 0, admissions = 0, dispatches = 0;
  for (const authorityStatus of ['READY', 'HOLD']) {
    const result = await ensureCriticalBacklogMission({
      paths, allowLegacyMissionCreation: false,
      listMissions: async () => [blocked, independent],
      appendMissionEvent: async (id, event) => {
        transitions += 1;
        assert.equal(id, blocked.missionId);
        assert.equal(event.eventType, 'MISSION_PARKED_FOR_REPAIR');
        throw Object.assign(new Error('Mission state lock is busy.'), {
          code: 'MISSION_STATE_LOCK_BUSY', missionId: id,
        });
      },
      readProgrammeProjection: async () => ({ status: authorityStatus,
        blockers: authorityStatus === 'HOLD' ? ['source-lease-custody-unproven'] : [],
        machineryInventory: { sourceHead: 'a'.repeat(40) },
        scheduler: { failClosed: false, elasticCapacity: { status: 'RUNNING' } } }),
      ensureElasticMissions: async () => { admissions += 1; return {
        ok: true, selectedMission: independent, elasticMissions: [independent],
        activeMissions: [independent], runnableMissions: [independent], desiredWidth: 1,
      }; },
      readCapacityRouting: async () => null,
      dispatchElasticBuilds: async () => { dispatches += 1; return { ok: true, dispatchCount: 0, held: [] }; },
      publishProjection: async () => ({ ok: true }),
      dispatchActiveCriticalMission: async () => ({ ok: true }),
    });
    assert.equal(result.parking.classification, 'BLOCKED_MISSION_PARKING_LOCK_BUSY');
    assert.equal(result.parking.missionId, blocked.missionId);
    assert.equal(result.parking.parked, false);
    assert.equal(result.parking.stateTransitionDeferred, true);
    if (authorityStatus === 'READY') {
      assert.equal(result.classification, 'ELASTIC_GOAL_MISSION_SELECTED');
      assert.equal(result.elasticAdmission.selectedMission.missionId, independent.missionId);
    } else {
      assert.equal(result.programmeStatus, 'HOLD');
      assert.deepEqual(result.programmeBlockers, ['source-lease-custody-unproven']);
      assert.equal(result.elasticAdmission, null);
    }
    assert.equal(JSON.stringify([blocked, independent]), before);
    assert.equal(result.mergeAuthority, false);
  }
  assert.equal(transitions, 2);
  assert.equal(admissions, 1);
  assert.equal(dispatches, 1);
});

test('parking deferral does not suppress fenced originals, I/O errors or untyped exceptions', async () => {
  const blocked = { ...elasticImplementationMission(3036), currentPhase: 'BLOCKED',
    dispatch: { status: 'failed' }, continuity: { parkingStatus: 'ACTIVE' }, blockers: ['source-parent-mismatch'] };
  for (const error of [Object.assign(new Error('I/O failed'), { code: 'EACCES' }),
    new Error('ORIGINAL_SOURCE_ATTEMPT_FENCED'), new Error('Mission state lock is busy.')]) {
    let authorityReads = 0;
    await assert.rejects(ensureCriticalBacklogMission({ paths: await roots(),
      listMissions: async () => [blocked], appendMissionEvent: async () => { throw error; },
      readProgrammeProjection: async () => { authorityReads += 1; return {}; },
    }), actual => actual === error);
    assert.equal(authorityReads, 0);
  }
});

test('continuity re-entry can see a repaired elastic goal outside the static backlog', async () => {
  const paths = await roots();
  const mission = {
    ...elasticImplementationMission(1818),
    revision: 10,
    currentPhase: 'BLOCKED',
    dispatch: { status: 'complete' },
    continuity: {
      parkingStatus: 'REENTRY_READY',
      pendingResolvedBlockers: ['CONTROLLER_STALLED_MISSION: elastic verification stalled'],
    },
    blockers: ['CONTROLLER_STALLED_MISSION: elastic verification stalled'],
  };
  let observedEvent = null;
  const result = await readmitReentryReadyCriticalMission({
    paths,
    listMissions: async () => [mission],
    appendEvent: async (_missionId, event) => {
      observedEvent = event;
      return {
        state: {
          ...mission,
          revision: 11,
          currentPhase: 'VERIFYING',
          blockers: [],
          continuity: { parkingStatus: 'ACTIVE' },
        },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.reentered, true);
  assert.equal(result.classification, 'REENTRY_ADMITTED');
  assert.equal(result.missionId, 'critical-1818-elastic-goal');
  assert.equal(observedEvent.eventType, 'MISSION_REENTERED');
  assert.equal(observedEvent.capacityAvailable, true);
});

test('idle conveyor creates exactly one bounded critical mission and publishes active status', async () => {
  const paths = await roots();
  const store = inMemoryMissionStore();
  const result = await ensureCriticalBacklogMission({ paths, now, ...store });
  const firstSchedulableMission = SELF_HOSTING_CRITICAL_BACKLOG[0].mission;
  assert.equal(result.ok, true);
  assert.equal(result.createdMission, true);
  assert.equal(store.records.length, 1);
  assert.equal(store.records[0].missionId, firstSchedulableMission.missionId);
  assert.equal(store.records[0].git.branch, firstSchedulableMission.branch);
  assert.notEqual(store.records[0].missionId, LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID);
  assert.equal(result.projection.decision, 'WAIT_ACTIVE_MISSION');
  const status = JSON.parse(await readFile(join(paths.workspaceRoot, 'status', 'critical-backlog-conveyor-current.json'), 'utf8'));
  assert.equal(status.activeMissionId, firstSchedulableMission.missionId);
  assert.equal(status.oneActiveMissionEnforced, true);
  assert.equal(status.mergeAuthority, false);
  assert.doesNotMatch(JSON.stringify(status), /critical-conveyor-.*(?:repo|worktrees)/);
});


test('discovery-mode conveyor defers legacy mission creation to the durable controller', async () => {
  const paths = await roots();
  const store = inMemoryMissionStore();
  const result = await ensureCriticalBacklogMission({
    paths,
    now,
    ...store,
    allowLegacyMissionCreation: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.createdMission, false);
  assert.equal(result.legacyMissionCreationAllowed, false);
  assert.equal(result.classification, 'CREATE_NEXT_MISSION_DEFERRED_TO_DURABLE_CONTROLLER');
  assert.equal(store.records.length, 0);
  assert.equal(result.projection.decision, 'CREATE_NEXT_MISSION');
});

test('stale CREATE_WORKTREE mission is classified orphaned only with fresh idle worker and no active lease', async () => {
  const paths = await roots();
  const mission = SELF_HOSTING_CRITICAL_BACKLOG[0].mission;
  let state = createMissionOrchestratorState({
    ...mission,
    repositoryRoot: paths.repoRoot,
    worktreePath: join(paths.worktreeRoot, mission.missionId),
  }, { now: new Date('2026-09-23T12:00:00.000Z') });
  assert.equal(state.currentPhase, 'CREATE_WORKTREE');
  const head = 'a'.repeat(40);
  const heartbeat = createMissionWorkerHeartbeatRecord({
    timestampUtc: '2026-09-23T14:29:50.000Z',
    repositoryRoot: paths.repoRoot,
    branch: 'main',
    headSha: head,
    taskName: 'Stephanos Mission Orchestrator Worker',
    pid: 24408,
    launchIdentityId: 'b'.repeat(64),
    workerStartedAtUtc: '2026-09-23T11:59:00.000Z',
    lastTickVerdict: 'MISSION_WORKER_TICK_PASS',
  });
  let appendCalls = 0;
  const recovered = await recoverOrphanedLegacyCriticalMission({
    backlog: SELF_HOSTING_CRITICAL_BACKLOG,
    env: { STEPHANOS_MISSION_WORKER_HEAD_SHA: head },
    now: new Date('2026-09-23T14:30:00.000Z'),
    paths,
    listMissions: async () => [structuredClone(state)],
    readWorkerHeartbeat: async () => heartbeat,
    readMutationLease: async () => null,
    appendEvent: async (missionId, event, options) => {
      appendCalls += 1;
      assert.equal(missionId, state.missionId);
      assert.equal(event.eventType, 'MISSION_BLOCKED');
      assert.equal(event.expectedRevision, state.revision);
      assert.equal(event.expectedCurrentPhase, 'CREATE_WORKTREE');
      assert.match(event.reason, /ORPHANED_ACTIVE_MISSION/);
      state = applyMissionOrchestratorEvent(state, event, { now: options.now });
      return { state: structuredClone(state), preconditionFailed: false };
    },
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.classification, 'ORPHANED_ACTIVE_MISSION_BLOCKED_FOR_PARKING');
  assert.equal(appendCalls, 1);
  assert.equal(state.currentPhase, 'BLOCKED');
});

test('external handoff pending worker is live but never classified idle for orphan recovery', async () => {
  const paths = await roots();
  const mission = SELF_HOSTING_CRITICAL_BACKLOG[0].mission;
  const state = createMissionOrchestratorState({
    ...mission,
    repositoryRoot: paths.repoRoot,
    worktreePath: join(paths.worktreeRoot, mission.missionId),
  }, { now: new Date('2026-09-23T12:00:00.000Z') });
  const head = 'a'.repeat(40);
  const heartbeat = createMissionWorkerHeartbeatRecord({
    timestampUtc: '2026-09-23T14:29:50.000Z',
    repositoryRoot: paths.repoRoot,
    branch: 'main',
    headSha: head,
    taskName: 'Stephanos Mission Orchestrator Worker',
    pid: 24408,
    launchIdentityId: 'b'.repeat(64),
    workerStartedAtUtc: '2026-09-23T11:59:00.000Z',
    lastTickVerdict: 'MISSION_WORKER_EXTERNAL_HANDOFF_PENDING',
  });
  let appendCalls = 0;
  const recovered = await recoverOrphanedLegacyCriticalMission({
    backlog: SELF_HOSTING_CRITICAL_BACKLOG,
    env: { STEPHANOS_MISSION_WORKER_HEAD_SHA: head },
    now: new Date('2026-09-23T14:30:00.000Z'),
    paths,
    listMissions: async () => [structuredClone(state)],
    readWorkerHeartbeat: async () => heartbeat,
    readMutationLease: async () => null,
    appendEvent: async () => { appendCalls += 1; },
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recovered, false);
  assert.equal(recovered.classification, 'ORPHAN_RECOVERY_WORKER_NOT_PROVEN_IDLE');
  assert.equal(recovered.workerFresh, true);
  assert.equal(appendCalls, 0);
});

test('fresh CREATE_WORKTREE work is never auto-classified as orphaned', async () => {
  const paths = await roots();
  const mission = SELF_HOSTING_CRITICAL_BACKLOG[0].mission;
  const state = createMissionOrchestratorState({
    ...mission,
    repositoryRoot: paths.repoRoot,
    worktreePath: join(paths.worktreeRoot, mission.missionId),
  }, { now: new Date('2026-09-23T14:25:00.000Z') });
  let appendCalls = 0;
  const recovered = await recoverOrphanedLegacyCriticalMission({
    backlog: SELF_HOSTING_CRITICAL_BACKLOG,
    now: new Date('2026-09-23T14:30:00.000Z'),
    paths,
    listMissions: async () => [structuredClone(state)],
    appendEvent: async () => { appendCalls += 1; },
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recovered, false);
  assert.equal(recovered.classification, 'ORPHAN_CANDIDATE_WITHIN_PROGRESS_WINDOW');
  assert.equal(appendCalls, 0);
});

test('persisted #1291 and retired #1507 stay recorded but do not consume construction capacity', async () => {
  const paths = await roots();
  const legacy = activeCriticalMission();
  const retired = {
    missionId: LEGACY_COMPLETED_RETIRED_MISSION_ID,
    currentPhase: 'COMPLETE',
  };
  const store = inMemoryMissionStore([legacy, retired]);
  const result = await ensureCriticalBacklogMission({ paths, now, ...store });
  const firstSchedulableMission = SELF_HOSTING_CRITICAL_BACKLOG[0].mission;

  assert.equal(result.ok, true);
  assert.equal(result.createdMission, true);
  assert.equal(store.records.length, 3);
  assert.equal(store.records[0].missionId, LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID);
  assert.equal(store.records[0].currentPhase, 'AGENT_IMPLEMENTATION');
  assert.equal(store.records[1].missionId, LEGACY_COMPLETED_RETIRED_MISSION_ID);
  assert.equal(store.records[2].missionId, firstSchedulableMission.missionId);
  assert.equal(result.projection.activeMission?.missionId, firstSchedulableMission.missionId);
  assert.deepEqual(result.projection.nonBlockingPersistedMissionIds, [
    LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
    LEGACY_COMPLETED_RETIRED_MISSION_ID,
  ]);
  assert.deepEqual(result.projection.nonBlockingMissionAcceptances, SELF_HOSTING_NON_BLOCKING_MISSION_ACCEPTANCES);
  assert.equal(result.projection.nonBlockingMissionAcceptances[1].state, 'CLOSED_RETIRED');
  assert.deepEqual(result.projection.nonBlockingMissionAcceptances[1].successorIssueNumbers, [2158]);
  assert.deepEqual(result.projection.nonBlockingMissionAcceptances[1], RETIRED_COMPLETED_LEGACY_ACCEPTANCE);
});

test('completed legacy backlog creates Goal Building Agent self-hosting mission instead of idling', async () => {
  assert.equal(SELF_HOSTING_CRITICAL_BACKLOG.length, DEFAULT_CRITICAL_BACKLOG.length - 1);
  const paths = await roots();
  const completedLegacy = DEFAULT_CRITICAL_BACKLOG.map((entry) => ({
    missionId: entry.mission.missionId,
    currentPhase: 'COMPLETE',
  }));
  const store = inMemoryMissionStore(completedLegacy);
  const result = await ensureCriticalBacklogMission({ paths, now, ...store });
  assert.equal(result.ok, true);
  assert.equal(result.createdMission, true);
  assert.equal(result.missionRecord?.missionId, GOAL_BUILDING_SELF_HOSTING_MISSION_ID);
  assert.equal(result.missionRecord?.currentPhase, 'CREATE_WORKTREE');
  assert.equal(store.records.at(-1).missionId, GOAL_BUILDING_SELF_HOSTING_MISSION_ID);
  assert.equal(result.projection.decision, 'WAIT_ACTIVE_MISSION');
  assert.equal(result.projection.selectedItem?.itemId, 'goal-building-self-hosting');
  assert.equal(result.projection.activeMission?.missionId, GOAL_BUILDING_SELF_HOSTING_MISSION_ID);
  assert.notEqual(result.classification, 'BACKLOG_COMPLETE');
});

test('subsequent ticks wait on the same active mission without duplicate creation', async () => {
  const paths = await roots();
  const store = inMemoryMissionStore();
  const first = await ensureCriticalBacklogMission({ paths, now, ...store });
  const second = await ensureCriticalBacklogMission({ paths, now: new Date(now.getTime() + 60_000), ...store });
  assert.equal(first.createdMission, true);
  assert.equal(second.createdMission, false);
  assert.equal(store.records.length, 1);
  assert.equal(second.classification, 'WAIT_ACTIVE_MISSION');
  assert.equal(second.publication.changed, false);
});

test('mission creation fails closed when the preflight status cannot be published', async () => {
  const paths = await roots();
  const store = inMemoryMissionStore();
  const result = await ensureCriticalBacklogMission({
    paths,
    now,
    ...store,
    publishProjection: async () => ({ ok: false, reason: 'workspace-unavailable' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.classification, 'CREATE_NEXT_MISSION_PUBLICATION_BLOCKED');
  assert.equal(result.createdMission, false);
  assert.equal(store.records.length, 0);
});

test('external active mission prevents critical mission creation', async () => {
  const paths = await roots();
  const store = inMemoryMissionStore([{ missionId: 'external-active-mission', currentPhase: 'CHECK_PULL_REQUEST' }]);
  const result = await ensureCriticalBacklogMission({ paths, now, ...store });
  assert.equal(result.ok, true);
  assert.equal(result.createdMission, false);
  assert.equal(result.classification, 'WAIT_EXTERNAL_ACTIVE_MISSION');
  assert.equal(store.records.length, 1);
});

test('multiple active missions fail closed and never create another lane', async () => {
  const paths = await roots();
  const store = inMemoryMissionStore([
    { missionId: 'external-active-one', currentPhase: 'AGENT_IMPLEMENTATION' },
    { missionId: 'external-active-two', currentPhase: 'CHECK_PULL_REQUEST' },
  ]);
  const result = await ensureCriticalBacklogMission({ paths, now, ...store });
  assert.equal(result.ok, false);
  assert.equal(result.createdMission, false);
  assert.equal(result.classification, 'BLOCKED_BY_MULTIPLE_ACTIVE_MISSIONS');
  assert.equal(store.records.length, 2);
});

test('active legacy critical implementation is dispatched through canonical proven capacity', async () => {
  const paths = await roots();
  const sourceHead = 'a'.repeat(40);
  const store = inMemoryMissionStore([activeCriticalMission()]);
  let publishCalls = 0;
  const result = await ensureCriticalBacklogMission({
    paths,
    now,
    ...store,
    backlog: DEFAULT_CRITICAL_BACKLOG,
    testOnly: true,
    readProgrammeProjection: async () => ({ machineryInventory: { sourceHead } }),
    readCapacityRouting: async () => ({ providerNeutralCapacity: 'fresh' }),
    blockedAdapters: ['OPENCLAW-LOCAL'],
    publishActiveMission: async (mission, options) => {
      publishCalls += 1;
      assert.equal(mission.missionId, DEFAULT_CRITICAL_BACKLOG[0].mission.missionId);
      assert.equal(options.sourceRevision, sourceHead);
      assert.equal(options.capacityRouting.providerNeutralCapacity, 'fresh');
      assert.deepEqual(options.capacityRouting.blockedAdapters, ['openclaw-local']);
      return {
        published: true,
        adapter: 'foundry-forge',
        action: {
          adapter: 'foundry-forge',
          capacityRoute: 'FOUNDRY_FORGE',
          capacityReceiptId: 'forge-capacity-1',
        },
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.classification, 'WAIT_ACTIVE_MISSION');
  assert.equal(result.activeMissionIgnition.classification, 'CRITICAL_ACTIVE_MISSION_DISPATCH_LIVE');
  assert.equal(result.activeMissionIgnition.published, true);
  assert.equal(result.activeMissionIgnition.adapter, 'foundry-forge');
  assert.equal(result.activeMissionIgnition.sourceRevision, sourceHead);
  assert.equal(publishCalls, 1);
});

test('active legacy critical implementation exposes missing proven capacity instead of silently idling', async () => {
  const paths = await roots();
  const sourceHead = 'b'.repeat(40);
  const store = inMemoryMissionStore([activeCriticalMission()]);
  let publishCalls = 0;
  const result = await ensureCriticalBacklogMission({
    paths,
    now,
    ...store,
    backlog: DEFAULT_CRITICAL_BACKLOG,
    testOnly: true,
    readProgrammeProjection: async () => ({ machineryInventory: { sourceHead } }),
    readCapacityRouting: async () => null,
    publishActiveMission: async () => {
      publishCalls += 1;
      return { published: true };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.classification, 'WAIT_ACTIVE_MISSION');
  assert.equal(result.activeMissionIgnition.classification, 'CRITICAL_ACTIVE_MISSION_CAPACITY_ROUTING_UNAVAILABLE');
  assert.deepEqual(result.activeMissionIgnition.blockers, ['provider-independent-capacity-routing-unavailable']);
  assert.equal(result.finalVerdict, 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_BLOCKED');
  assert.equal(publishCalls, 0);
});

test('active legacy critical implementation preserves an existing running dispatch', async () => {
  const paths = await roots();
  const store = inMemoryMissionStore([activeCriticalMission({
    dispatch: { status: 'running', adapter: 'foundry-forge' },
  })]);
  let readCalls = 0;
  let publishCalls = 0;
  const result = await ensureCriticalBacklogMission({
    paths,
    now,
    ...store,
    backlog: DEFAULT_CRITICAL_BACKLOG,
    testOnly: true,
    readProgrammeProjection: async () => {
      readCalls += 1;
      return { machineryInventory: { sourceHead: 'c'.repeat(40) } };
    },
    publishActiveMission: async () => {
      publishCalls += 1;
      return { published: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.activeMissionIgnition.classification, 'CRITICAL_ACTIVE_MISSION_ALREADY_RUNNING');
  assert.equal(readCalls, 1);
  assert.equal(publishCalls, 0);
});

test('elastic dispatcher retries the next distinct proven capacity when the first publication path rejects the handoff', async () => {
  const mission = elasticImplementationMission();
  const attempts = [];
  const result = await dispatchElasticGoalBuilds({
    desiredWidth: 5,
    selectedMission: null,
    activeMissions: [],
    runnableMissions: [mission],
  }, {
    now,
    sourceRevision: 'd'.repeat(40),
    paths: {
      repoRoot: '/repo',
      workspaceRoot: '/workspace',
      orchestratorRoot: '/orchestrator',
      snapshotRoot: '/snapshots',
    },
    resolveCapacityCandidates: () => [
      {
        route: 'CHATGPT_GITHUB',
        adapter: 'chatgpt-github',
        workerId: 'github-worker',
        receiptId: 'github-capacity-1',
        proofRefs: ['github-capacity-proof'],
      },
      {
        route: 'FOUNDRY_FORGE',
        adapter: 'foundry-forge',
        workerId: 'forge-worker',
        receiptId: 'forge-capacity-1',
        proofRefs: ['forge-capacity-proof'],
      },
    ],
    publishWorkerAction: async ({ actionGrant }) => {
      attempts.push(actionGrant.adapter);
      if (actionGrant.adapter === 'chatgpt-github') {
        return { published: false, actionGrantAccepted: false, reason: 'github-publication-unavailable' };
      }
      return { published: true, actionGrantAccepted: true, reason: 'published' };
    },
  });

  assert.deepEqual(attempts, ['chatgpt-github', 'foundry-forge']);
  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_EXTERNAL_BUILD_DISPATCH_LIVE');
  assert.equal(result.dispatchCount, 1);
  assert.equal(result.pickupPendingCount, 1);
  assert.equal(result.handoffPublicationIsTerminal, false);
  assert.equal(result.responsibilityRetainedUntilPickup, true);
  assert.equal(result.dispatched[0].handoffState, 'PICKUP_PENDING');
  assert.equal(result.dispatched[0].pickupProven, false);
  assert.equal(result.dispatched[0].responsibilityRetained, true);
  assert.equal(result.dispatched[0].publicationIsTerminal, false);
  assert.equal(result.dispatched[0].adapter, 'foundry-forge');
  assert.equal(result.dispatched[0].workerId, 'forge-worker');
  assert.deepEqual(result.held, []);
  assert.equal(result.blockedLaneDoesNotStallFleet, true);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
});

test('elastic dispatcher reconciles an indeterminate publication on the same exact candidate before considering fallback', async () => {
  const mission = elasticImplementationMission(92);
  const attempts = [];
  let firstAttempt = true;
  const result = await dispatchElasticGoalBuilds({
    desiredWidth: 5,
    selectedMission: null,
    activeMissions: [],
    runnableMissions: [mission],
  }, {
    now,
    sourceRevision: 'e'.repeat(40),
    paths: {
      repoRoot: '/repo',
      workspaceRoot: '/workspace',
      orchestratorRoot: '/orchestrator',
      snapshotRoot: '/snapshots',
    },
    resolveCapacityCandidates: () => [
      {
        route: 'CHATGPT_GITHUB',
        adapter: 'chatgpt-github',
        workerId: 'github-worker',
        receiptId: 'github-capacity-1',
        proofRefs: ['github-capacity-proof'],
      },
      {
        route: 'FOUNDRY_FORGE',
        adapter: 'foundry-forge',
        workerId: 'forge-worker',
        receiptId: 'forge-capacity-1',
        proofRefs: ['forge-capacity-proof'],
      },
    ],
    publishWorkerAction: async ({ actionGrant }) => {
      attempts.push(actionGrant.adapter);
      if (actionGrant.adapter !== 'chatgpt-github') throw new Error('fallback-must-not-run');
      if (firstAttempt) {
        firstAttempt = false;
        throw new Error('event-append-failed-after-publication');
      }
      return { published: true, actionGrantAccepted: true, reason: 'external-action-publication-reconciled' };
    },
  });

  assert.deepEqual(attempts, ['chatgpt-github', 'chatgpt-github']);
  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_EXTERNAL_BUILD_DISPATCH_LIVE');
  assert.equal(result.dispatchCount, 1);
  assert.equal(result.pickupPendingCount, 1);
  assert.equal(result.handoffPublicationIsTerminal, false);
  assert.equal(result.responsibilityRetainedUntilPickup, true);
  assert.equal(result.dispatched[0].handoffState, 'PICKUP_PENDING');
  assert.equal(result.dispatched[0].pickupProven, false);
  assert.equal(result.dispatched[0].responsibilityRetained, true);
  assert.equal(result.dispatched[0].publicationIsTerminal, false);
  assert.equal(result.dispatched[0].adapter, 'chatgpt-github');
  assert.equal(result.dispatched[0].workerId, 'github-worker');
  assert.deepEqual(result.held, []);
});

test('elastic dispatcher fails closed after repeated indeterminate publication and never assigns a second writer', async () => {
  const mission = elasticImplementationMission(93);
  const attempts = [];
  const result = await dispatchElasticGoalBuilds({
    desiredWidth: 5,
    selectedMission: null,
    activeMissions: [],
    runnableMissions: [mission],
  }, {
    now,
    sourceRevision: 'f'.repeat(40),
    paths: {
      repoRoot: '/repo',
      workspaceRoot: '/workspace',
      orchestratorRoot: '/orchestrator',
      snapshotRoot: '/snapshots',
    },
    resolveCapacityCandidates: () => [
      {
        route: 'CHATGPT_GITHUB',
        adapter: 'chatgpt-github',
        workerId: 'github-worker',
        receiptId: 'github-capacity-1',
        proofRefs: ['github-capacity-proof'],
      },
      {
        route: 'FOUNDRY_FORGE',
        adapter: 'foundry-forge',
        workerId: 'forge-worker',
        receiptId: 'forge-capacity-1',
        proofRefs: ['forge-capacity-proof'],
      },
    ],
    publishWorkerAction: async ({ actionGrant }) => {
      attempts.push(actionGrant.adapter);
      if (actionGrant.adapter !== 'chatgpt-github') throw new Error('fallback-must-not-run');
      throw new Error('event-append-still-indeterminate');
    },
  });

  assert.deepEqual(attempts, ['chatgpt-github', 'chatgpt-github']);
  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_EXTERNAL_BUILD_DISPATCH_HELD');
  assert.equal(result.dispatchCount, 0);
  assert.deepEqual(result.dispatched, []);
  assert.equal(result.held.length, 1);
  assert.match(result.held[0].reason, /^EXTERNAL_DISPATCH_INDETERMINATE:/);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
});

test('publication emits one idempotent event file for one state change', async () => {
  const paths = await roots();
  const projection = {
    decision: 'WAIT_ACTIVE_MISSION',
    finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_ACTIVE',
    selectedItem: { itemId: 'worker-watchdog-self-heal' },
    activeMission: { missionId: 'critical-1291-worker-watchdog-repair', currentPhase: 'AGENT_IMPLEMENTATION' },
    completedItemIds: [],
    remainingItemIds: ['worker-watchdog-self-heal'],
    exactNextAction: 'Continue the active mission.',
  };
  const first = await publishCriticalBacklogProjection(projection, { paths, now });
  const second = await publishCriticalBacklogProjection(projection, { paths, now: new Date(now.getTime() + 60_000) });
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  const events = await readdir(join(paths.workspaceRoot, 'events', 'critical-backlog-conveyor'));
  assert.equal(events.length, 1);
  assert.match(events[0], /^critical-backlog-[a-f0-9]{20}\.json$/);
});


test('executive ingress acceptance is bound to exact handoff correlation and selected goal', () => {
  const acceptance = projectExecutiveIngressAcceptance({
    executiveSelectedGoal: '#2002',
    executiveHandoffId: 'stephanos-chat-2002-handoff',
    executiveCorrelationId: 'stephanos-chat-2002',
  }, {
    ok: true,
    elasticAdmission: {
      selectedMission: { missionId: 'critical-2002-elastic-goal' },
    },
    elasticIgnition: {
      classification: 'ELASTIC_GOAL_BUILD_DISPATCH_LIVE',
    },
  });

  assert.equal(acceptance.accepted, true);
  assert.equal(acceptance.consumer, 'critical-backlog-conveyor');
  assert.equal(acceptance.handoffId, 'stephanos-chat-2002-handoff');
  assert.equal(acceptance.correlationId, 'stephanos-chat-2002');
  assert.equal(acceptance.selectedGoal, '#2002');
  assert.equal(acceptance.acceptedGoalIssue, 2002);
  assert.equal(acceptance.dispatchClassification, 'ELASTIC_GOAL_BUILD_DISPATCH_LIVE');
});

test('executive ingress acceptance fails closed when conveyor goal differs from requested goal', () => {
  const acceptance = projectExecutiveIngressAcceptance({
    executiveSelectedGoal: '#2002',
    executiveHandoffId: 'stephanos-chat-2002-handoff',
    executiveCorrelationId: 'stephanos-chat-2002',
  }, {
    ok: true,
    elasticAdmission: {
      selectedMission: { missionId: 'critical-1556-elastic-goal' },
    },
  });

  assert.equal(acceptance.accepted, false);
  assert.equal(acceptance.classification, 'EXECUTIVE_INGRESS_SELECTED_GOAL_MISMATCH');
  assert.equal(acceptance.acceptedGoalIssue, 1556);
});


test('legacy retry candidate without terminal identity is parked without blocking unrelated conveyor work', async () => {
  const paths = await roots();
  const mission = elasticImplementationMission(1290);
  let state = createMissionOrchestratorState({
    ...mission,
    repositoryRoot: paths.repoRoot,
    baseBranch: 'main',
    branch: mission.git.branch,
    worktreePath: mission.git.worktreePath,
  }, { now: new Date('2026-10-07T03:00:00.000Z') });

  state = applyMissionOrchestratorEvent(state, {
    eventType: 'WORKTREE_READY',
    missionId: state.missionId,
    timestamp: '2026-10-07T03:01:00.000Z',
    worktreePath: mission.git.worktreePath,
    clean: true,
    receipt: {
      receiptId: 'legacy-retry-worktree',
      requirement: 'isolated worktree',
      source: 'deterministic-test',
      evidenceType: 'command-output',
      verified: true,
      exitCode: 0,
      createdAt: '2026-10-07T03:01:00.000Z',
    },
  });
  state = applyMissionOrchestratorEvent(state, {
    eventType: 'AGENT_DISPATCHED',
    missionId: state.missionId,
    timestamp: '2026-10-07T03:02:00.000Z',
    agentId: 'foundry-forge',
  });
  state = applyMissionOrchestratorEvent(state, {
    eventType: 'AGENT_RESULT_RECEIVED',
    missionId: state.missionId,
    timestamp: '2026-10-07T03:03:00.000Z',
    success: false,
    error: 'PROVIDER_NEUTRAL_MODEL_STRUCTURED_EDITS_MISSING',
  });
  // Simulate a persisted pre-#2860 failure that lacks durable terminal identity.
  state.dispatch = { ...state.dispatch, resultId: '' };

  let appendCalled = false;
  const result = await retrySafelyBlockedAgentFailure({
    backlog: SELF_HOSTING_CRITICAL_BACKLOG,
    paths,
    now: new Date('2026-10-07T03:04:00.000Z'),
    listMissions: async () => [structuredClone(state)],
    appendEvent: async () => {
      appendCalled = true;
      throw new Error('legacy identity gap must not synthesize retry authority');
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.retried, false);
  assert.equal(result.parked, true);
  assert.equal(result.classification, 'RETRYABLE_AGENT_FAILURE_TERMINAL_IDENTITY_UNPROVEN');
  assert.equal(result.missionId, 'critical-1290-elastic-goal');
  assert.equal(appendCalled, false);
});

test('legacy retry ignores an older released result event when current failure identity is unproven', async () => {
  const paths = await roots();
  const mission = elasticImplementationMission(1290);
  let state = createMissionOrchestratorState({
    ...mission,
    repositoryRoot: paths.repoRoot,
    baseBranch: 'main',
    branch: mission.git.branch,
    worktreePath: mission.git.worktreePath,
  }, { now: new Date('2026-10-07T03:00:00.000Z') });

  state = applyMissionOrchestratorEvent(state, {
    eventType: 'WORKTREE_READY',
    missionId: state.missionId,
    timestamp: '2026-10-07T03:01:00.000Z',
    worktreePath: mission.git.worktreePath,
    clean: true,
    receipt: {
      receiptId: 'legacy-retry-old-result-worktree',
      requirement: 'isolated worktree',
      source: 'deterministic-test',
      evidenceType: 'command-output',
      verified: true,
      exitCode: 0,
      createdAt: '2026-10-07T03:01:00.000Z',
    },
  });
  state = applyMissionOrchestratorEvent(state, {
    eventType: 'AGENT_DISPATCHED',
    missionId: state.missionId,
    timestamp: '2026-10-07T03:02:00.000Z',
    agentId: 'foundry-forge',
  });
  state = applyMissionOrchestratorEvent(state, {
    eventType: 'AGENT_RESULT_RECEIVED',
    missionId: state.missionId,
    timestamp: '2026-10-07T03:03:00.000Z',
    success: false,
    error: 'PROVIDER_NEUTRAL_MODEL_STRUCTURED_EDITS_MISSING',
  });

  state.dispatch = { ...state.dispatch, resultId: '' };
  state.storeMetadata = {
    processedEventIds: ['result-critical-1290-elastic-goal-old-released-attempt'],
    lastEventId: 'legacy-current-failure-without-terminal-identity',
  };

  let proofCalled = false;
  const result = await retrySafelyBlockedAgentFailure({
    backlog: SELF_HOSTING_CRITICAL_BACKLOG,
    paths,
    now: new Date('2026-10-07T03:04:00.000Z'),
    listMissions: async () => [structuredClone(state)],
    proveRetryOwnershipReleased: async () => {
      proofCalled = true;
      throw new Error('older released attempt must never authorize current retry');
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.retried, false);
  assert.equal(result.parked, true);
  assert.equal(result.classification, 'RETRYABLE_AGENT_FAILURE_TERMINAL_IDENTITY_UNPROVEN');
  assert.equal(proofCalled, false);
});


test('elastic blocked goal is visible to bounded retry admission even though it is absent from static backlog', async () => {
  const paths = await roots();
  const mission = elasticImplementationMission(1290);
  let state = createMissionOrchestratorState({
    ...mission,
    repositoryRoot: paths.repoRoot,
    baseBranch: 'main',
    branch: mission.git.branch,
    worktreePath: mission.git.worktreePath,
  }, { now: new Date('2026-10-07T03:00:00.000Z') });
  state = applyMissionOrchestratorEvent(state, {
    eventType: 'WORKTREE_READY',
    missionId: state.missionId,
    timestamp: '2026-10-07T03:01:00.000Z',
    worktreePath: mission.git.worktreePath,
    clean: true,
    receipt: {
      receiptId: 'elastic-retry-worktree',
      requirement: 'isolated worktree',
      source: 'deterministic-test',
      evidenceType: 'command-output',
      verified: true,
      exitCode: 0,
      createdAt: '2026-10-07T03:01:00.000Z',
    },
  });
  state = applyMissionOrchestratorEvent(state, {
    eventType: 'AGENT_DISPATCHED',
    missionId: state.missionId,
    timestamp: '2026-10-07T03:02:00.000Z',
    agentId: 'foundry-forge',
  });
  state = applyMissionOrchestratorEvent(state, {
    eventType: 'AGENT_RESULT_RECEIVED',
    missionId: state.missionId,
    timestamp: '2026-10-07T03:03:00.000Z',
    success: false,
    resultId: 'critical-1290-elastic-goal-r2-test',
    error: 'PROVIDER_NEUTRAL_MODEL_STRUCTURED_EDITS_MISSING',
  });
  assert.equal(state.currentPhase, 'BLOCKED');

  const configuredQueueRoot = join(paths.orchestratorRoot, 'configured-worker-queue');
  const configuredWorkspaceRoot = paths.workspaceRoot + '-configured';
  const result = await retrySafelyBlockedAgentFailure({
    backlog: SELF_HOSTING_CRITICAL_BACKLOG,
    paths,
    env: {
      STEPHANOS_MISSION_WORKER_QUEUE_DIR: configuredQueueRoot,
      STEPHANOS_SHARED_AGENT_WORKSPACE: configuredWorkspaceRoot,
    },
    now: new Date('2026-10-07T03:04:00.000Z'),
    listMissions: async () => [structuredClone(state)],
    proveRetryOwnershipReleased: async (proofInput) => {
      assert.equal(proofInput.missionId, state.missionId);
      assert.equal(proofInput.actionId, 'critical-1290-elastic-goal-r2-test');
      assert.equal(proofInput.adapter, 'foundry-forge');
      assert.equal(proofInput.queueRoot, configuredQueueRoot);
      assert.equal(proofInput.sharedWorkspaceRoot, configuredWorkspaceRoot);
      return {
        ok: true,
        classification: 'MISSION_WORKER_RETRY_OWNERSHIP_RELEASE_PROVEN',
        executionReceiptId: 'terminal-execution-receipt',
      };
    },
    refreshRetryWorktree: async () => ({ ok: true, classification: 'RETRY_WORKTREE_ALREADY_CURRENT', beforeHead: 'a'.repeat(40), targetHead: 'a'.repeat(40), afterHead: 'a'.repeat(40), clean: true }),
    appendEvent: async (missionId, retryEvent, options) => {
      assert.equal(missionId, state.missionId);
      assert.equal(retryEvent.eventType, 'AGENT_FAILURE_RETRY_ADMITTED');
      assert.deepEqual(retryEvent.retryableBlockers, ['PROVIDER_NEUTRAL_MODEL_STRUCTURED_EDITS_MISSING']);
      state = applyMissionOrchestratorEvent(state, retryEvent, { now: options.now });
      return { state: structuredClone(state), preconditionFailed: false };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.retried, true);
  assert.equal(result.classification, 'RETRYABLE_AGENT_FAILURE_READMITTED');
  assert.equal(result.missionId, 'critical-1290-elastic-goal');
  assert.equal(result.repairRound, 1);
  assert.equal(state.currentPhase, 'AGENT_IMPLEMENTATION');
  assert.equal(state.dispatch.status, 'pending');
  assert.deepEqual(state.blockers, []);
});


test('unprovable older retry candidate does not starve a later independently provable blocked mission', async () => {
  const paths = await roots();

  const blockedMission = (issueNumber, resultId, minute) => {
    const mission = elasticImplementationMission(issueNumber);
    let state = createMissionOrchestratorState({
      ...mission,
      repositoryRoot: paths.repoRoot,
      baseBranch: 'main',
      branch: mission.git.branch,
      worktreePath: mission.git.worktreePath,
    }, { now: new Date(`2026-10-07T04:${String(minute).padStart(2, '0')}:00.000Z`) });

    state = applyMissionOrchestratorEvent(state, {
      eventType: 'WORKTREE_READY',
      missionId: state.missionId,
      timestamp: `2026-10-07T04:${String(minute + 1).padStart(2, '0')}:00.000Z`,
      worktreePath: mission.git.worktreePath,
      clean: true,
      receipt: {
        receiptId: `retry-scan-worktree-${issueNumber}`,
        requirement: 'isolated worktree',
        source: 'deterministic-test',
        evidenceType: 'command-output',
        verified: true,
        exitCode: 0,
        createdAt: `2026-10-07T04:${String(minute + 1).padStart(2, '0')}:00.000Z`,
      },
    });
    state = applyMissionOrchestratorEvent(state, {
      eventType: 'AGENT_DISPATCHED',
      missionId: state.missionId,
      timestamp: `2026-10-07T04:${String(minute + 2).padStart(2, '0')}:00.000Z`,
      agentId: 'foundry-forge',
    });
    state = applyMissionOrchestratorEvent(state, {
      eventType: 'AGENT_RESULT_RECEIVED',
      missionId: state.missionId,
      timestamp: `2026-10-07T04:${String(minute + 3).padStart(2, '0')}:00.000Z`,
      success: false,
      resultId,
      error: 'PROVIDER_NEUTRAL_MODEL_STRUCTURED_EDITS_MISSING',
    });
    return state;
  };

  let older = blockedMission(1290, 'critical-1290-elastic-goal-r2-old', 0);
  let later = blockedMission(1645, 'critical-1645-elastic-goal-r2-live', 10);
  const proofAttempts = [];

  const result = await retrySafelyBlockedAgentFailure({
    backlog: SELF_HOSTING_CRITICAL_BACKLOG,
    paths,
    env: {
      STEPHANOS_SHARED_AGENT_WORKSPACE: paths.workspaceRoot,
    },
    now: new Date('2026-10-07T04:20:00.000Z'),
    listMissions: async () => [structuredClone(older), structuredClone(later)],
    proveRetryOwnershipReleased: async ({ missionId }) => {
      proofAttempts.push(missionId);
      if (missionId === older.missionId) {
        return {
          ok: false,
          classification: 'MISSION_WORKER_RETRY_TERMINAL_EXECUTION_RECEIPT_UNPROVEN',
        };
      }
      return {
        ok: true,
        classification: 'MISSION_WORKER_RETRY_OWNERSHIP_RELEASE_PROVEN',
        executionReceiptId: 'terminal-execution-receipt-live',
      };
    },
    refreshRetryWorktree: async () => ({ ok: true, classification: 'RETRY_WORKTREE_ALREADY_CURRENT', beforeHead: 'a'.repeat(40), targetHead: 'a'.repeat(40), afterHead: 'a'.repeat(40), clean: true }),
    appendEvent: async (missionId, retryEvent, options) => {
      assert.equal(missionId, later.missionId);
      later = applyMissionOrchestratorEvent(later, retryEvent, { now: options.now });
      return { state: structuredClone(later), preconditionFailed: false };
    },
  });

  assert.deepEqual(proofAttempts, [older.missionId, later.missionId]);
  assert.equal(result.ok, true);
  assert.equal(result.retried, true);
  assert.equal(result.classification, 'RETRYABLE_AGENT_FAILURE_READMITTED');
  assert.equal(result.missionId, later.missionId);
  assert.equal(older.currentPhase, 'BLOCKED');
  assert.equal(later.currentPhase, 'AGENT_IMPLEMENTATION');
  assert.equal(later.dispatch.status, 'pending');
});

test('original expired-review-lease HOLD triggers one guarded recovery then rereads real Programme Authority before admission', async () => {
  const paths = await roots();
  const sourceRevision = 'a'.repeat(40);
  let authorityReads = 0;
  let recoveryCalls = 0;
  let admissionCalls = 0;
  const existingGoal = {
    missionId: 'critical-2955-elastic-goal',
    currentPhase: 'AGENT_IMPLEMENTATION',
    issueNumber: 2955,
  };
  const result = await ensureCriticalBacklogMission({
    allowLegacyMissionCreation: false, paths,
    now: new Date('2026-10-10T02:24:39.000Z'),
    readProgrammeProjection: async () => {
      authorityReads += 1;
      return {
        status: authorityReads === 1 ? 'HOLD' : 'READY',
        blockers: authorityReads === 1 ? ['lane:elastic-lease-expired-or-not-active'] : [],
        scheduler: { failClosed: false, elasticCapacity: { status: 'RUNNING' } },
        machineryInventory: { sourceHead: sourceRevision },
      };
    },
    listMissions: async () => [{
      missionId: 'critical-2956-elastic-goal', revision: 6,
      currentPhase: 'CHECK_PULL_REQUEST', dispatch: { status: 'idle' },
    }],
    reconcileExpiredReviewLease: async (payload) => {
      recoveryCalls += 1;
      assert.equal(payload.sourceRevision, sourceRevision);
      assert.equal(payload.missionRecords[0].missionId, 'critical-2956-elastic-goal');
      return { ok: true, released: true, classification: 'ELASTIC_EXPIRED_REVIEW_LEASE_SAFELY_RELEASED' };
    },
    ensureElasticMissions: async () => {
      admissionCalls += 1;
      return {
        ok: true, desiredWidth: 15, selectedMission: existingGoal,
        elasticMissions: [existingGoal], activeMissions: [existingGoal],
        runnableMissions: [existingGoal],
      };
    },
    readCapacityRouting: async () => ({ ok: true }),
    dispatchElasticBuilds: async () => ({ ok: true, dispatchCount: 1, held: [] }),
    publishProjection: async () => ({ ok: true }),
  });
  assert.equal(recoveryCalls, 1);
  assert.equal(authorityReads, 2);
  assert.equal(admissionCalls, 1);
  assert.equal(result.classification, 'ELASTIC_GOAL_MISSION_SELECTED');
  assert.equal(result.programmeStatus, 'READY');
  assert.equal(result.elasticReviewLeaseRecovery.released, true);
  assert.equal(result.elasticAdmission.selectedMission.missionId, 'critical-2955-elastic-goal');
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.duplicateActiveMissionAllowed, false);
});

test('failed exact-owner stale review lease recovery cannot bypass authority HOLD or grant dispatch', async () => {
  const paths = await roots();
  let authorityReads = 0;
  let admissions = 0;
  const result = await ensureCriticalBacklogMission({
    allowLegacyMissionCreation: false, paths,
    now: new Date('2026-10-10T02:24:39.000Z'),
    readProgrammeProjection: async () => {
      authorityReads += 1;
      return {
        status: 'HOLD', blockers: ['lane:elastic-lease-expired-or-not-active'],
        scheduler: { failClosed: false, elasticCapacity: { status: 'RUNNING' } },
        machineryInventory: { sourceHead: 'a'.repeat(40) },
      };
    },
    listMissions: async () => [],
    reconcileExpiredReviewLease: async () => ({
      ok: false, released: false, blocker: 'EXACT_ORIGINAL_MISSION_UNAVAILABLE_OR_AMBIGUOUS',
    }),
    ensureElasticMissions: async () => { admissions += 1; throw Error('forbidden'); },
    publishProjection: async () => ({ ok: true }),
  });
  assert.equal(authorityReads, 1);
  assert.equal(admissions, 0);
  assert.equal(result.programmeStatus, 'HOLD');
  assert.equal(result.elasticAdmission, null);
  assert.equal(result.elasticReviewLeaseRecovery.released, false);
  assert.equal(result.mergeAuthority, false);
});

test('completed-inspection revision HOLD triggers one guarded recovery then rereads real Programme Authority before admission', async () => {
  const paths = await roots();
  const sourceRevision = 'a'.repeat(40);
  let authorityReads = 0;
  let recoveryCalls = 0;
  let admissionCalls = 0;
  const existingGoal = {
    missionId: 'critical-2955-elastic-goal',
    currentPhase: 'AGENT_IMPLEMENTATION',
    issueNumber: 2955,
  };
  const result = await ensureCriticalBacklogMission({
    allowLegacyMissionCreation: false, paths,
    now: new Date('2026-10-10T02:24:39.000Z'),
    readProgrammeProjection: async () => {
      authorityReads += 1;
      return {
        status: authorityReads === 1 ? 'HOLD' : 'READY',
        blockers: authorityReads === 1 ? ['lane:elastic-mission-phase-binding-unproven'] : [],
        scheduler: { failClosed: false, elasticCapacity: { status: 'RUNNING' } },
        machineryInventory: { sourceHead: sourceRevision },
      };
    },
    listMissions: async () => [{
      missionId: 'critical-2956-elastic-goal', revision: 6,
      currentPhase: 'CHECK_PULL_REQUEST', dispatch: { status: 'idle' },
    }],
    reconcileExpiredReviewLease: async (payload) => {
      recoveryCalls += 1;
      assert.equal(payload.sourceRevision, sourceRevision);
      assert.equal(payload.missionRecords[0].missionId, 'critical-2956-elastic-goal');
      return { ok: true, released: true, classification: 'ELASTIC_CONSUMED_READONLY_INSPECTION_LEASE_RELEASED' };
    },
    ensureElasticMissions: async () => {
      admissionCalls += 1;
      return {
        ok: true, desiredWidth: 15, selectedMission: existingGoal,
        elasticMissions: [existingGoal], activeMissions: [existingGoal],
        runnableMissions: [existingGoal],
      };
    },
    readCapacityRouting: async () => ({ ok: true }),
    dispatchElasticBuilds: async () => ({ ok: true, dispatchCount: 1, held: [] }),
    publishProjection: async () => ({ ok: true }),
  });
  assert.equal(recoveryCalls, 1);
  assert.equal(authorityReads, 2);
  assert.equal(admissionCalls, 1);
  assert.equal(result.classification, 'ELASTIC_GOAL_MISSION_SELECTED');
  assert.equal(result.programmeStatus, 'READY');
  assert.equal(result.elasticReviewLeaseRecovery.released, true);
  assert.equal(result.elasticAdmission.selectedMission.missionId, 'critical-2955-elastic-goal');
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.duplicateActiveMissionAllowed, false);
});

test('parked diff failure retries only with fresh stronger owner acceptance and terminal released ownership', async t => {
  const expectedGate = {
    valid: 'RETRY_READMITTED', 'valid-expanded-scope': 'RETRY_READMITTED',
    'valid-reversed-expanded-scope': 'RETRY_READMITTED', 'unchanged-plan': 'OWNER_TEST_SET_UNCHANGED',
    'untrusted-owner': 'OWNER_PLAN_INVALID', 'editable-oracle': 'OWNER_SOURCE_SCOPE_MISMATCH',
    'ownership-held': 'OWNERSHIP_RELEASE_UNPROVEN', 'worktree-dirty': 'WORKTREE_REFRESH_BLOCKED',
    'duplicate-owner': 'OWNER_MIRROR_AMBIGUOUS', 'unknown-failure': 'CONTINUITY_NOT_RETRYABLE',
    'budget-exhausted': 'REPAIR_BUDGET_EXHAUSTED', 'revision-moved': 'RETRY_PRECONDITION_MOVED',
    'source-scope-changed': 'OWNER_SOURCE_SCOPE_MISMATCH', 'missing-owner': 'OWNER_MIRROR_MISSING',
    'unsupplied-plan': 'OWNER_TEST_PLAN_UNSUPPLIED', 'missing-previous': 'PREVIOUS_TESTS_NOT_RETAINED',
    'editable-oracle-matched-scope': 'STRENGTHENED_PLAN_REJECTED', 'terminal-missing': 'TERMINAL_IDENTITY_UNPROVEN',
    'already-running': 'PHASE_NOT_BLOCKED', 'invalid-budget': 'REPAIR_BUDGET_INVALID',
    'invalid-revision': 'REVISION_UNPROVEN',
  };
  for (const mode of Object.keys(expectedGate)) await t.test(mode, async () => {
    const paths = await roots();
    let state = createMissionOrchestratorState({
      missionId: 'critical-2964-elastic-goal', title: 'Original goal', operatorIntent: 'Build bounded source',
      intendedOutcome: 'Real behavior', missionKind: 'implementation', repository: 'Cheekyfellastef/stephan-os',
      branch: 'openclaw/elastic-goal-2964', worktreePath: join(paths.repoRoot, 'worker'),
      allowedFiles: ['stephanos-server/services/example.js'], requiredEvidence: ['focused tests'],
      requiredTests: ['npm run stephanos:verify', 'node --test scripts/previous.test.mjs'],
    });
    const event = (eventType, fields) => {state = applyMissionOrchestratorEvent(state, {missionId: state.missionId, eventType, ...fields});};
    const receipt = id => ({receiptId: id, requirement: 'proof', source: 'test', evidenceType: 'command-output', verified: true, exitCode: 0, createdAt: new Date().toISOString()});
    event('WORKTREE_READY', {worktreePath: state.git.worktreePath, clean: true, receipt: receipt('retry-fixture-worktree')});
    event('AGENT_DISPATCHED', {agentId: 'foundry-forge'});
    event('AGENT_RESULT_RECEIVED', {success: false, resultId: 'critical-2964-elastic-goal-r1-original', error: mode === 'unknown-failure' ? 'UNKNOWN_EXECUTION' : 'SOURCE_ARTIFACT_DIFF_CHECK_FAILED'});
    event('MISSION_PARKED_FOR_REPAIR', {reason: 'Failed attempt preserved', repairOwner: '#2961', receipt: receipt('retry-fixture-park')});
    const oracle = 'node --test scripts/acceptance/legacy-goal-declared-tests.acceptance.mjs';
    if (['editable-oracle', 'editable-oracle-matched-scope'].includes(mode)) state.allowedFiles.push('scripts/acceptance/**');
    if (mode === 'budget-exhausted') state.repair.currentRound = state.repair.maximumRounds;
    if (mode === 'invalid-budget') state.repair.maximumRounds = -1;
    if (mode === 'invalid-revision') state.revision = -1;
    if (mode === 'terminal-missing') state.dispatch.resultId = '';
    if (mode === 'already-running') { state.currentPhase = 'AGENT_IMPLEMENTATION'; state.dispatch.status = 'running'; }
    if (mode.includes('expanded-scope')) state.allowedFiles.push(state.allowedFiles[0] + '/**');
    if (mode === 'valid-reversed-expanded-scope') state.allowedFiles.reverse();
    const original = structuredClone(state);
    const record = {schemaVersion: 'shared-agent-workspace-record.v1', kind: 'stephanos.shared_workspace.goal',
      goalId: 'goal-2964', issueNumber: 2964, repository: state.repository,
      source: mode === 'untrusted-owner' ? 'untrusted-contributor' : 'github-goal-estate-mirror',
      mirrorSchema: 'stephanos.github-goal-mirror.v1', githubAdmissionState: 'ADMISSION_PROVEN',
      mirrorIssueNumber: 2964, mirrorRepository: state.repository, mirrorBuildPickupAllowed: true,
      requiredTests: [...state.requiredTests, ...(mode === 'unchanged-plan' ? [] : [oracle])],
      resourceIds: ['repo:cheekyfellastef/stephan-os:path:' + (mode === 'source-scope-changed' ? 'shared/agents/other.mjs' : 'stephanos-server/services/example.js')]};
    if (mode === 'unsupplied-plan') delete record.requiredTests;
    if (mode === 'missing-previous') record.requiredTests = ['npm run stephanos:verify', oracle];
    if (mode === 'editable-oracle-matched-scope') record.resourceIds.push('repo:cheekyfellastef/stephan-os:path:scripts/acceptance');
    let ownershipCalls = 0, refreshCalls = 0, appendCalls = 0, authorityCalls = 0;
    const result = await retrySafelyBlockedAgentFailure({paths, backlog: [], env: {},
      listMissions: async () => [structuredClone(state)],
      readProgrammeProjection: async () => { authorityCalls++; return {goalMirrorEstate: {
        records: mode === 'missing-owner' ? [] : mode === 'duplicate-owner' ? [record, record] : [record]}}; },
      proveRetryOwnershipReleased: async input => {ownershipCalls++; assert.equal(input.actionId, original.dispatch.resultId); return {ok: mode !== 'ownership-held'};},
      refreshRetryWorktree: async () => {refreshCalls++; return {ok: mode !== 'worktree-dirty', clean: mode !== 'worktree-dirty'};},
      appendEvent: async (_id, retryEvent) => {
        appendCalls++;
        assert.equal(retryEvent.expectedRevision, original.revision);
        assert.equal(retryEvent.expectedCurrentPhase, 'BLOCKED');
        assert.deepEqual(retryEvent.retryRequiredTests, [...original.requiredTests, oracle]);
        if (mode === 'revision-moved') return {preconditionFailed: true};
        state = applyMissionOrchestratorEvent(state, retryEvent);
        return {state};
      },
    });
    const scan = result.retryScan;
    assert.equal(scan.snapshotStage, 'BEFORE_RETRY');
    assert.equal(scan.recovery.gateCode, expectedGate[mode]);
    assert.equal(scan.recovery.matchCount, 1);
    assert.equal(scan.recovery.state.phase, original.currentPhase);
    assert.equal(scan.recovery.state.revision, original.revision < 0 ? null : original.revision);
    assert.equal(scan.recovery.state.dispatchStatus, original.dispatch.status);
    assert.equal(scan.recordCount, 1);
    const beforeCandidate = ['unknown-failure', 'budget-exhausted', 'already-running', 'invalid-budget'].includes(mode);
    assert.equal(scan.candidateCount, beforeCandidate ? 0 : 1);
    assert.equal(scan.evaluatedCount, beforeCandidate ? 0 : 1);
    assert.equal(authorityCalls, beforeCandidate || mode === 'invalid-revision' ? 0 : 1,
      'diagnostics must not add an authority read or evaluate an unreached gate');
    assert.equal(result.retried, mode.startsWith('valid'));
    if (mode.startsWith('valid')) {
      assert.equal(state.currentPhase, 'AGENT_IMPLEMENTATION');
      assert.equal(state.repair.currentRound, 1);
      assert.deepEqual(state.requiredTests, [...original.requiredTests, oracle]);
      assert.deepEqual(state.repair.history[0].previousDispatch, original.dispatch);
      assert.deepEqual(state.allowedFiles, original.allowedFiles);
      assert.equal(ownershipCalls, 1); assert.equal(refreshCalls, 1); assert.equal(appendCalls, 1);
    } else {
      assert.deepEqual(state, original);
      if (mode !== 'revision-moved') assert.equal(appendCalls, 0);
      if (!['ownership-held', 'worktree-dirty', 'revision-moved'].includes(mode)) assert.equal(ownershipCalls, 0);
    }
  });
});

test('retry diagnostics preserve later admission and mark unreached original-task guards unevaluated', async t => {
  for (const earlierWins of [false, true]) await t.test(earlierWins ? 'earlier candidate admitted' : 'earlier acceptance held', async () => {
    const paths = await roots();
    const blocked = issueNumber => ({ ...elasticImplementationMission(issueNumber), currentPhase: 'BLOCKED',
      requiredTests: ['npm run stephanos:verify', ...elasticImplementationMission(issueNumber).requiredTests],
      updatedAt: '2026-10-25T09:50:00.000Z', continuity: { parkingStatus: 'PARKED_BLOCKED' },
      blockers: ['SOURCE_ARTIFACT_DIFF_CHECK_FAILED'], repair: { currentRound: 0, maximumRounds: 3 },
      dispatch: { status: 'failed', adapter: 'foundry-forge', resultId: 'critical-' + issueNumber + '-elastic-goal-r1-old' } });
    const earlier = blocked(1557), original = blocked(2964);
    if (earlierWins) {
      earlier.blockers = ['PROVIDER_NEUTRAL_MODEL_PATCH_MISSING'];
      earlier.continuity.parkingStatus = 'ACTIVE';
    }
    const oracle = 'node --test scripts/acceptance/legacy-goal-declared-tests.acceptance.mjs';
    const mirror = state => ({schemaVersion: 'shared-agent-workspace-record.v1', kind: 'stephanos.shared_workspace.goal',
      goalId: 'goal-' + state.missionId.split('-')[1], issueNumber: Number(state.missionId.split('-')[1]), repository: state.repository,
      source: 'github-goal-estate-mirror', mirrorSchema: 'stephanos.github-goal-mirror.v1', githubAdmissionState: 'ADMISSION_PROVEN',
      mirrorIssueNumber: Number(state.missionId.split('-')[1]), mirrorRepository: state.repository, mirrorBuildPickupAllowed: true,
      requiredTests: [...state.requiredTests, ...(state === original ? [oracle] : [])],
      resourceIds: state.allowedFiles.map(file => 'repo:cheekyfellastef/stephan-os:path:' + file)});
    const calls = [], selected = earlierWins ? earlier : original;
    const result = await retrySafelyBlockedAgentFailure({ paths, backlog: [], env: {},
      listMissions: async () => [original, earlier],
      readProgrammeProjection: async () => { calls.push('authority'); return {goalMirrorEstate: {records: [mirror(earlier), mirror(original)]}}; },
      proveRetryOwnershipReleased: async ({missionId}) => { calls.push('custody:' + missionId); return {ok: true}; },
      refreshRetryWorktree: async ({mission}) => { calls.push('worktree:' + mission.missionId); return {ok: true}; },
      appendEvent: async (missionId, event) => {
        calls.push('append:' + missionId);
        assert.equal(missionId, selected.missionId);
        assert.equal(event.expectedRevision, selected.revision);
        assert.equal(event.expectedCurrentPhase, 'BLOCKED');
        assert.deepEqual(event.retryRequiredTests, earlierWins ? undefined : [...original.requiredTests, oracle]);
        return {state: {...selected, currentPhase: 'AGENT_IMPLEMENTATION', blockers: [],
          continuity: {parkingStatus: 'ACTIVE'}, dispatch: {...selected.dispatch, status: 'pending'}}};
      },
    });
    assert.deepEqual(calls, [...(earlierWins ? [] : ['authority']), 'custody:' + selected.missionId,
      'worktree:' + selected.missionId, 'append:' + selected.missionId]);
    assert.equal(result.retried, true); assert.equal(result.missionId, selected.missionId);
    assert.deepEqual(result.retryScan.reasons.map(row => row.issueNumber), [1557, 2964]);
    assert.equal(result.retryScan.candidateCount, 2);
    assert.equal(result.retryScan.evaluatedCount, earlierWins ? 1 : 2);
    assert.equal(result.retryScan.recovery.gateCode, earlierWins ? 'NOT_EVALUATED' : 'RETRY_READMITTED');
    assert.equal(result.retryScan.recovery.state.phase, 'BLOCKED');
    assert.equal(original.currentPhase, 'BLOCKED'); assert.equal(original.dispatch.status, 'failed');
  });
});

test('original-task budget exclusion is visible beyond bounded rows without evaluating admission or custody', async () => {
  const paths = await roots();
  const completed = Array.from({length: 12}, (_, index) => ({...elasticImplementationMission(1000 + index), currentPhase: 'COMPLETE'}));
  const original = {...elasticImplementationMission(2964), currentPhase: 'BLOCKED',
    continuity: {parkingStatus: 'PARKED_BLOCKED'}, blockers: ['SOURCE_ARTIFACT_DIFF_CHECK_FAILED'],
    dispatch: {status: 'failed'}, repair: {currentRound: 3, maximumRounds: 3}};
  const forbidden = async () => assert.fail('excluded mission must not trigger a proof read or mutation');
  const result = await retrySafelyBlockedAgentFailure({ paths, backlog: [], env: {},
    listMissions: async () => [...completed, original], readProgrammeProjection: forbidden,
    proveRetryOwnershipReleased: forbidden, refreshRetryWorktree: forbidden, appendEvent: forbidden });
  assert.equal(result.classification, 'NO_RETRYABLE_BLOCKED_AGENT_FAILURE');
  assert.equal(result.retryScan.recordCount, 13);
  assert.equal(result.retryScan.candidateCount, 0); assert.equal(result.retryScan.evaluatedCount, 0);
  assert.deepEqual(result.retryScan.reasons, []); assert.equal(result.retryScan.truncated, false);
  assert.equal(result.retryScan.recovery.matchCount, 1);
  assert.equal(result.retryScan.recovery.gateCode, 'REPAIR_BUDGET_EXHAUSTED');
  assert.equal(result.retryScan.recovery.state.phase, 'BLOCKED');
});

test('strengthened retry contract persists before actual queue publication and claim', async () => {
  const paths = await roots();
  const options = {root: paths.orchestratorRoot, queueRoot: join(paths.orchestratorRoot, 'queue'), env: {},
    capacityRouting: {nowUtc: new Date().toISOString(), codexStatus: {
      schemaVersion: 'shared-agent-workspace-record.v1', statusId: 'codex-capacity-current', truthState: 'CURRENT',
      meterTruthUsable: true, observedAtUtc: new Date(Date.now() - 1000).toISOString(), remainingPercent: 90,
      availability: 'AVAILABLE', confidence: 'high', naturalResetAtUtc: '',
    }}};
  let {state} = await createMissionRecord({missionId: 'critical-2964-elastic-goal', title: 'Original bounded goal',
    operatorIntent: 'Real source and independent tests', intendedOutcome: 'Implemented behavior', missionKind: 'implementation',
    repository: 'Cheekyfellastef/stephan-os', branch: 'openclaw/elastic-goal-2964',
    worktreePath: join(paths.repoRoot, 'worker'),
    allowedFiles: ['stephanos-server/services/example.js', 'stephanos-server/services/example.js/**'],
    requiredEvidence: ['focused test'], requiredTests: ['npm run stephanos:verify']}, options);
  const proof = receiptId => ({receiptId, requirement: 'bounded proof', source: 'fixture', evidenceType: 'command-output', verified: true, exitCode: 0});
  for (const event of [
    {eventType: 'WORKTREE_READY', worktreePath: state.git.worktreePath, clean: true, receipt: proof('retry-queue-worktree')},
    {eventType: 'AGENT_DISPATCHED', agentId: 'foundry-forge'},
    {eventType: 'AGENT_RESULT_RECEIVED', success: false, resultId: 'critical-2964-elastic-goal-r1-old', error: 'SOURCE_ARTIFACT_DIFF_CHECK_FAILED'},
    {eventType: 'MISSION_PARKED_FOR_REPAIR', reason: 'Preserved failure', repairOwner: '#2961', receipt: proof('retry-queue-park')},
  ]) ({state} = await appendMissionEvent(state.missionId, {eventId: `queue-fixture-${event.eventType.toLowerCase()}`, ...event}, options));
  const original = structuredClone(state);
  const extra = 'node --test scripts/acceptance/legacy-goal-declared-tests.acceptance.mjs';
  const record = {schemaVersion: 'shared-agent-workspace-record.v1', kind: 'stephanos.shared_workspace.goal',
    goalId: 'goal-2964', issueNumber: 2964, repository: state.repository, source: 'github-goal-estate-mirror',
    mirrorSchema: 'stephanos.github-goal-mirror.v1', mirrorIssueNumber: 2964, mirrorRepository: state.repository,
    mirrorBuildPickupAllowed: true, githubAdmissionState: 'ADMISSION_PROVEN', requiredTests: [extra],
    resourceIds: ['repo:cheekyfellastef/stephan-os:path:stephanos-server/services/example.js']};
  const result = await retrySafelyBlockedAgentFailure({paths, env: {}, backlog: [],
    listMissions: async () => [(await readMissionRecord(state.missionId, options)).state],
    readProgrammeProjection: async () => ({goalMirrorEstate: {records: [record]}}),
    proveRetryOwnershipReleased: async () => ({ok: true}),
    refreshRetryWorktree: async () => ({ok: true, clean: true}),
  });
  assert.equal(result.retried, true, JSON.stringify(result));
  const persisted = (await readMissionRecord(state.missionId, options)).state;
  const expected = [...original.requiredTests, extra];
  assert.deepEqual(persisted.requiredTests, expected);
  assert.deepEqual(persisted.allowedFiles, original.allowedFiles);
  assert.deepEqual(persisted.repair.history[0].previousDispatch, original.dispatch);
  const publication = await publishMissionWorkerAction(persisted, options);
  assert.equal(publication.published, true, JSON.stringify(publication));
  const queued = JSON.parse(await readFile(publication.path, 'utf8'));
  assert.deepEqual(queued.payload.requiredTests, expected);
  assert.deepEqual(queued.payload.allowedFiles, original.allowedFiles);
  const claim = await claimNextMissionWorkerItem(publication.adapter, options);
  assert.ok(claim);
  assert.deepEqual(claim.item.payload.requiredTests, expected);
  assert.equal(claim.item.payload.allowedFiles.includes('scripts/acceptance/**'), false);
});
