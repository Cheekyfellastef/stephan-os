import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  createSharedWorkspaceProofRecord,
  createSharedWorkspaceStatusRecord,
  createSharedWorkspaceEventRecord,
  ensureSharedWorkspaceLayout,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import { projectStephanosCoreDaemonState } from '../shared/agents/stephanosCoreDaemonV1.mjs';
import * as flywheel from '../shared/agents/stephanosCorePersistentFlywheelV1.mjs';
import * as onion from '../shared/agents/stephanosCoreOnionContinuationV1.mjs';
import * as spine from '../shared/agents/stephanosControlPlaneSpineV1.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(join(repoRoot, 'scripts', 'stephanos-core-daemon.mjs'), 'utf8');

// Run the actual publisher and initial telemetry declarations without loading
// the daemon entrypoint, acquiring its lock, or starting autonomous work.
function sourceChunk(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex, 'publisher source boundaries must exist');
  return source.slice(startIndex, endIndex);
}

function isolatedPublisher(workspaceRoot) {
  const context = vm.createContext({
    Object, String, Promise, Date, process: { pid: process.pid },
    repoRoot, workspaceRoot, resolve,
    readJsonIfPresent: async (path) => { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } },
    createSharedWorkspaceEventRecord,
    FLYWHEEL_FALLBACK_MS: flywheel.DEFAULT_PERSISTENT_FLYWHEEL_FALLBACK_MS,
    TARGET_MATERIAL_LANES: 15,
    OCTOPUS_SELF_HEAL_COOLDOWN_MS: flywheel.DEFAULT_OCTOPUS_SELF_HEAL_COOLDOWN_MS,
    DEPENDENCY_SELF_HEAL_COOLDOWN_MS: 120000,
    OCTOPUS_SELF_HEAL_ACTION_ID: 'repair-goal-builder-flow',
    CONTROL_PLANE_SELF_HEAL_ACTION_ID: 'repair-control-plane',
    RELATED_ISSUE: '#2593',
    PROOF_REF: 'proof/stephanos-core-daemon-current.json',
    ...flywheel, ...onion, ...spine,
    createSharedWorkspaceProofRecord,
    createSharedWorkspaceStatusRecord,
    ensureSharedWorkspaceLayout,
    writeAtomicJson,
  });
  vm.runInContext([
    sourceChunk('let flywheelCycleRunning =', 'async function runBoundedDependencyMaintenance'),
    sourceChunk('function persistentFlywheelStatus()', 'async function maybeStartPersistentFlywheel'),
    sourceChunk('async function publish(', 'async function sample('),
  ].join('\n'), context);
  return context;
}

test('Core publisher atomically writes valid status and proof for startup, degraded and reload states', async () => {
  const tempParent = resolve(tmpdir());
  const root = await mkdtemp(join(tempParent, 'stephanos-core-publish-test-'));
  try {
    const context = isolatedPublisher(root);
    const ready = projectStephanosCoreDaemonState({
      sourceHead: '237fd54f7c33798515b20efd344ea8864aff30ab',
      sovereignCommanderHealthy: true, backendHealthy: true,
      missionWorkerHeartbeatAgeMs: 0, gamingActive: false,
    });
    const states = [
      ready,
      projectStephanosCoreDaemonState({ ...ready, backendHealthy: false }),
      { ...ready, readiness: 'RELOAD_REQUIRED', finalVerdict: 'STEPHANOS_CORE_DAEMON_SOURCE_ADVANCED' },
    ];
    for (const [index, state] of states.entries()) {
      const timestampUtc = new Date(Date.parse('2026-10-05T19:00:00Z') + index * 15000).toISOString();
      await context.publish(state, timestampUtc);
      for (const directory of ['status', 'proof']) {
        const record = JSON.parse(await readFile(join(root, directory, 'stephanos-core-daemon-current.json'), 'utf8'));
        assert.equal(record.schemaVersion, 'shared-agent-workspace-record.v1');
        assert.equal(record.controlPlaneSchemaVersion, 'stephanos.control-plane-spine.v1');
        assert.equal(record.timestampUtc, timestampUtc);
        assert.equal(record.sourceHead, ready.sourceHead);
        assert.equal(record.readiness, state.readiness);
        assert.equal(record.logicalLaneTruth, 'UNKNOWN');
        assert.equal(record.logicalControllerCount, 0);
        assert.equal(record.logicalLaneDeficitToTarget, null);
        assert.equal(record.sourceMutationAllowed, false);
        assert.equal(record.mergeAuthority, false);
        assert.equal(record.allGoalBuildLoopsProvenClosed, false);
        assert.equal(record.loopClosureAudit.totalEdgeCount, 12);
        assert.ok(record.loopClosureUnprovenEdgeCount > 0);
        const validation = validateSharedWorkspaceRecord(record);
        assert.equal(validation.valid, true, validation.errors.join(','));
        assert.deepEqual(await readdir(join(root, directory)), ['stephanos-core-daemon-current.json']);
      }
    }
  } finally {
    assert.equal(dirname(root), tempParent);
    assert.ok(basename(root).startsWith('stephanos-core-publish-test-'));
    await rm(root, { recursive: true, force: true });
  }
});

test('Core publisher refuses secret-bearing telemetry without replacing prior status or proof', async () => {
  const tempParent = resolve(tmpdir());
  const root = await mkdtemp(join(tempParent, 'stephanos-core-publish-test-'));
  try {
    const context = isolatedPublisher(root);
    const state = projectStephanosCoreDaemonState({
      sourceHead: '237fd54f7c33798515b20efd344ea8864aff30ab',
      sovereignCommanderHealthy: true, backendHealthy: true,
      missionWorkerHeartbeatAgeMs: 0,
    });
    await context.publish(state, '2026-10-05T19:00:00.000Z');
    const paths = ['status', 'proof'].map((directory) => join(root, directory, 'stephanos-core-daemon-current.json'));
    const before = await Promise.all(paths.map((path) => readFile(path, 'utf8')));
    await assert.rejects(
      context.publish(state, '2026-10-05T19:00:15.000Z', {
        ...context.persistentFlywheelStatus(), logicalSessionToken: 'sentinel',
      }),
      /STEPHANOS_CORE_DAEMON_HEARTBEAT_WRITE_FAILED/,
    );
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(path, 'utf8'))), before);
  } finally {
    assert.equal(dirname(root), tempParent);
    assert.ok(basename(root).startsWith('stephanos-core-publish-test-'));
    await rm(root, { recursive: true, force: true });
  }
});


test('Core publisher emits one deduped typed Flywheel repair event for a measured gap', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-core-publish-test-'));
  try {
    const context = isolatedPublisher(root);
    const state = projectStephanosCoreDaemonState({
      sourceHead: '237fd54f7c33798515b20efd344ea8864aff30ab',
      sovereignCommanderHealthy: true, backendHealthy: true,
      missionWorkerHeartbeatAgeMs: 0, gamingActive: false,
    });
    for (const timestampUtc of ['2026-10-09T19:00:00.000Z', '2026-10-09T19:00:15.000Z']) {
      await context.publish(state, timestampUtc, context.persistentFlywheelStatus(), { publishEvents: true });
    }
    const events = await readdir(join(root, 'events'));
    assert.equal(events.length, 1);
    assert.match(events[0], /^core-loop-gap-[a-f0-9]{12}-watch-to-reconciliation-w[0-9]+\.json$/);
    const event = JSON.parse(await readFile(join(root, 'events', events[0]), 'utf8'));
    assert.equal(event.eventKind, 'goal-conveyor-incident');
    assert.equal(event.relatedIssue, '#2593');
    assert.equal(event.missionId, 'goal-conveyor-fleet-care');
    assert.equal(event.loopClosureEdgeId, 'WATCH_TO_RECONCILIATION');
    assert.equal(event.mergeAuthority, false);
    assert.equal(event.sourceMutationAuthority, false);
    assert.equal(validateSharedWorkspaceRecord(event).valid, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('failed unattended repair publishes one typed Flywheel learning gap owned by existing repair goal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-core-publish-test-'));
  try {
    const context = isolatedPublisher(root);
    const state = projectStephanosCoreDaemonState({
      sourceHead: '237fd54f7c33798515b20efd344ea8864aff30ab',
      sovereignCommanderHealthy: true, backendHealthy: true,
      missionWorkerHeartbeatAgeMs: 0, gamingActive: false,
    });
    vm.runInContext("lastOctopusSelfHealAttemptCount = 1; lastOctopusSelfHealAtUtc = '2026-10-09T20:18:58.332Z'; lastOctopusSelfHealBlocker = 'ELASTIC_GOAL_ADMISSION_NOT_PROVEN'; lastOctopusBuildSummary = Object.freeze({ ...lastOctopusBuildSummary, octopusNeedsRepair: true });", context);
    await context.publish(state, '2026-10-09T20:32:00.000Z', context.persistentFlywheelStatus(), { publishEvents: true });
    const first = await readdir(join(root, 'events'));
    assert.equal(first.length, 1, 'at most one new event per heartbeat');
    assert.match(first[0], /^core-octopus-repair-gap-[a-f0-9]{12}-elastic-goal-admission-not-proven\.json$/);
    const event = JSON.parse(await readFile(join(root, 'events', first[0]), 'utf8'));
    assert.equal(event.relatedIssue, '#2961');
    assert.equal(event.blocker, 'ELASTIC_GOAL_ADMISSION_NOT_PROVEN');
    assert.equal(event.closedLoopLearning.learningEligibleCapabilityFailure, true);
    assert.equal(event.leaseOverrideAllowed, false);
    assert.equal(event.mergeAuthority, false);
    assert.equal(validateSharedWorkspaceRecord(event).valid, true);
    await context.publish(state, '2026-10-09T20:32:15.000Z', context.persistentFlywheelStatus(), { publishEvents: true });
    const later = await readdir(join(root, 'events'));
    assert.equal(later.filter((name) => name === first[0]).length, 1, 'stable root gap deduplication');
    assert.ok(later.length <= 2, 'generic loop gap uses following heartbeat, no event storm');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('fresh healthy reconciliation routes missing edge proof to existing owner without inventing failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-core-publish-test-'));
  try {
    const context = isolatedPublisher(root);
    const at = '2026-10-09T20:55:00.000Z';
    const state = projectStephanosCoreDaemonState({
      sourceHead: '237fd54f7c33798515b20efd344ea8864aff30ab',
      sovereignCommanderHealthy: true, backendHealthy: true,
      missionWorkerHeartbeatAgeMs: 0, gamingActive: false,
    });
    const flywheel = {
      ...context.persistentFlywheelStatus(),
      flywheelLastCycleFinishedAtUtc: at,
      refillStatus: 'READY',
      refillCanonicalProgrammeHeld: false,
      refillSafeEligibleWorkRemaining: 0,
      refillProvenSafeFreeLanes: 0,
    };
    await context.publish(state, at, flywheel, { publishEvents: true });
    const firstFiles = await readdir(join(root, 'events'));
    assert.equal(firstFiles.length, 1, 'one missing-proof request per heartbeat');
    assert.match(firstFiles[0],
      /^core-loop-proof-needed-[a-f0-9]{12}-reconciliation-to-goal-admission-w[0-9]+\.json$/);
    const event = JSON.parse(await readFile(join(root, 'events', firstFiles[0]), 'utf8'));
    assert.equal(event.eventKind, 'goal-conveyor-proof-needed');
    assert.equal(event.relatedIssue, '#2002');
    assert.equal(event.evidenceTruth, 'UNKNOWN');
    assert.equal(event.learningCandidate.requiresExistingGoalSearch, true);
    assert.equal(event.learningCandidate.observedState, 'UNKNOWN');
    assert.equal(event.closedLoopLearning, undefined, 'absence of proof is not a proven capability failure');
    assert.equal(event.newGoalScopeAuthorized, false);
    assert.equal(event.sourceMutationAuthority, false);
    assert.equal(event.mergeAuthority, false);
    assert.equal(validateSharedWorkspaceRecord(event).valid, true);
    await context.publish(state, '2026-10-09T20:55:15.000Z', flywheel, { publishEvents: true });
    const followupFiles = await readdir(join(root, 'events'));
    assert.equal(followupFiles.filter((name) => name === firstFiles[0]).length, 1,
      'same source-head and edge never duplicate pressure');
    assert.equal(followupFiles.length, 2, 'one additional UNKNOWN edge requested on the following heartbeat');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Core publisher does not pressure UNKNOWN edges when reconciliation itself is stalled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-core-publish-test-'));
  try {
    const context = isolatedPublisher(root);
    const state = projectStephanosCoreDaemonState({
      sourceHead: '237fd54f7c33798515b20efd344ea8864aff30ab',
      sovereignCommanderHealthy: true, backendHealthy: true,
      missionWorkerHeartbeatAgeMs: 0, gamingActive: false,
    });
    await context.publish(state, '2026-10-09T20:55:00.000Z',
      context.persistentFlywheelStatus(), { publishEvents: true });
    const events = await readdir(join(root, 'events'));
    assert.equal(events.length, 1);
    assert.ok(events.every((name) => !name.startsWith('core-loop-proof-needed-')),
      'stale reconciliation publishes the measured GAP first, not missing-proof noise');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('daemon checker sweeps all observed gaps AND missing handoffs without leaving persistent UNKNOWNs unqueued', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-core-publish-test-'));
  try {
    const context = isolatedPublisher(root);
    const head = '237fd54f7c33798515b20efd344ea8864aff30ab';
    const state = projectStephanosCoreDaemonState({
      sourceHead: head, sovereignCommanderHealthy: true, backendHealthy: true,
      missionWorkerHeartbeatAgeMs: 0, gamingActive: false,
    });
    const at = '2026-10-10T06:15:00.000Z';
    const flywheelSnapshot = {
      ...context.persistentFlywheelStatus(),
      flywheelLastCycleFinishedAtUtc: at,
      refillSafeEligibleWorkRemaining: 3,
      refillProvenSafeFreeLanes: 2,
      refillMaterialActionsSucceeded: 0,
      refillCanonicalProgrammeHeld: true,
    };
    const audit = context.auditCoreLoopClosureV1({
      coreState: state, flywheel: flywheelSnapshot, observedAtUtc: at,
    });
    const candidateCount = audit.gapCount + audit.unprovenCount;
    assert.ok(audit.gapCount > 0);
    assert.ok(audit.unprovenCount > 0);
    for (let i = 0; i < candidateCount; i += 1) {
      await context.publish(state, new Date(Date.parse(at) + i * 15_000).toISOString(),
        flywheelSnapshot, { publishEvents: true });
    }
    const filenames = await readdir(join(root, 'events'));
    assert.equal(filenames.length, candidateCount, 'all unresolved handoffs receive an independent existing-owner event');
    const events = await Promise.all(filenames.map(async (name) =>
      JSON.parse(await readFile(join(root, 'events', name), 'utf8'))));
    const byEdge = new Map(events.map((event) => [event.loopClosureEdgeId, event]));
    assert.equal(byEdge.size, candidateCount, 'one event per unresolved edge, including late ones');
    assert.equal(byEdge.get('RECONCILIATION_TO_GOAL_ADMISSION').evidenceTruth, 'GAP');
    assert.equal(byEdge.get('PROOF_TO_PROTECTED_MERGE').evidenceTruth, 'UNKNOWN');
    assert.equal(byEdge.get('PROOF_TO_PROTECTED_MERGE').eventKind, 'goal-conveyor-proof-needed');
    assert.equal(byEdge.get('PROOF_TO_PROTECTED_MERGE').closedLoopLearning, undefined);
    assert.ok(events.every((e) => e.newGoalScopeAuthorized === false));
    assert.ok(events.every((e) => e.sourceMutationAuthority === false && e.mergeAuthority === false));
    assert.ok(events.every((e) => validateSharedWorkspaceRecord(e).valid));
    // Once every edge has a local event, the next heartbeat must be idle.
    await context.publish(state, new Date(Date.parse(at) + 90 * 60_000).toISOString(),
      flywheelSnapshot, { publishEvents: true });
    assert.equal((await readdir(join(root, 'events'))).length, candidateCount);
    // Same unresolved evidence may be re-escalated after the bounded window,
    // using the same owners, while the old immutable events remain intact.
    await context.publish(state, new Date(Date.parse(at) + flywheel.CORE_LOOP_CHECKER_RECHECK_MS).toISOString(),
      flywheelSnapshot, { publishEvents: true });
    assert.equal((await readdir(join(root, 'events'))).length, candidateCount + 1);
    const status = JSON.parse(await readFile(join(root, 'status', 'stephanos-core-daemon-current.json'), 'utf8'));
    assert.equal(status.allGoalBuildLoopsProvenClosed, false);
    assert.equal(status.checkerEscalationPlan.totalAuditedEdgeCount, 12);
    assert.ok(status.checkerEscalationCandidateCount > 0);
    assert.equal(status.checkerEscalationPlan.mergeAuthority, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
