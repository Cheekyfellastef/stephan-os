import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  DEFAULT_OCTOPUS_SELF_HEAL_COOLDOWN_MS,
  DEFAULT_PERSISTENT_FLYWHEEL_FALLBACK_MS,
  projectOctopusRepairEscalation,
  projectOctopusSelfHealDecision,
  projectOctopusFailedRepairLearningEventV1,
  projectPersistentFlywheelTrigger,
  projectPersistentFlywheelStageWatchV1,
  auditCoreLoopClosureV1,
  planCoreLoopCheckerEscalationsV1,
  CORE_LOOP_CHECKER_RECHECK_MS,
  summarizeLogicalGoalControllerFabric,
  summarizeOctopusBuildProductivity,
  summarizePersistentGapClosure,
  summarizePersistentFlywheelResult,
  summarizePersistentRefillSweep,
} from './stephanosCorePersistentFlywheelV1.mjs';

test('persistent Flywheel wakes on durable state change', () => {
  const projected = projectPersistentFlywheelTrigger({
    nowMs: 10_000,
    lastCycleAtMs: 9_000,
    eventFingerprint: 'worker:running',
    lastEventFingerprint: 'worker:idle',
    cycleRunning: false,
  });
  assert.equal(projected.shouldRun, true);
  assert.equal(projected.reason, 'PERSISTENT_FLYWHEEL_DURABLE_STATE_CHANGED');
});

test('persistent Flywheel has a bounded fallback reconciliation', () => {
  const projected = projectPersistentFlywheelTrigger({
    nowMs: DEFAULT_PERSISTENT_FLYWHEEL_FALLBACK_MS + 1,
    lastCycleAtMs: 0,
    eventFingerprint: 'stable',
    lastEventFingerprint: 'stable',
    cycleRunning: false,
  });
  assert.equal(projected.shouldRun, true);
  assert.equal(projected.reason, 'PERSISTENT_FLYWHEEL_FALLBACK_RECONCILIATION_DUE');
});

test('persistent Flywheel is single-flight', () => {
  const projected = projectPersistentFlywheelTrigger({
    nowMs: 120_000,
    lastCycleAtMs: 0,
    eventFingerprint: 'new',
    lastEventFingerprint: 'old',
    cycleRunning: true,
  });
  assert.equal(projected.shouldRun, false);
  assert.equal(projected.reason, 'PERSISTENT_FLYWHEEL_SINGLE_FLIGHT_ACTIVE');
});

test('Octopus escalates controller-fabric blockers through the existing control-plane repair only', () => {
  const controller = projectOctopusRepairEscalation('CONTROLLER_OR_LOGICAL_FABRIC_ATTENTION_REQUIRED');
  assert.equal(controller.shouldRepairControlPlane, true);
  assert.equal(controller.repairActionId, 'repair-control-plane');
  assert.equal(controller.retryGoalBuilderAfterRepair, true);
  assert.equal(controller.duplicateControllerAllowed, false);
  assert.equal(controller.authorityWideningAllowed, false);

  const allHeld = projectOctopusRepairEscalation('ELASTIC_GOALS_ALL_HELD_REPAIR_REQUIRED');
  assert.equal(allHeld.shouldRepairControlPlane, true);
  assert.equal(allHeld.retryGoalBuilderAfterRepair, true);
  assert.equal(allHeld.duplicateControllerAllowed, false);
  const admission = projectOctopusRepairEscalation('ELASTIC_GOAL_ADMISSION_NOT_PROVEN');
  assert.equal(admission.shouldRepairControlPlane, true);
  assert.equal(admission.repairActionId, 'repair-control-plane');
  assert.equal(admission.retryGoalBuilderAfterRepair, true);
  assert.equal(admission.duplicateControllerAllowed, false);
  assert.equal(admission.authorityWideningAllowed, false);

  const unrelated = projectOctopusRepairEscalation('SAFE_RUNNABLE_WORK_AND_FREE_CAPACITY_STRANDED');
  assert.equal(unrelated.shouldRepairControlPlane, false);
  assert.equal(unrelated.repairActionId, '');
});

test('Octopus self-heal decision fires only for unhealthy build truth and respects cooldown', () => {
  const unhealthy = projectOctopusSelfHealDecision(
    { octopusNeedsRepair: true },
    { nowMs: 1_000, lastAttemptAtMs: null },
  );
  assert.equal(unhealthy.shouldRepair, true);
  assert.equal(unhealthy.reason, 'OCTOPUS_SELF_HEAL_REQUIRED');

  const coolingDown = projectOctopusSelfHealDecision(
    { octopusNeedsRepair: true },
    {
      nowMs: 600_000,
      lastAttemptAtMs: 600_000 - DEFAULT_OCTOPUS_SELF_HEAL_COOLDOWN_MS + 1,
    },
  );
  assert.equal(coolingDown.shouldRepair, false);
  assert.equal(coolingDown.reason, 'OCTOPUS_SELF_HEAL_COOLDOWN_ACTIVE');
  assert.ok(coolingDown.retryAfterMs > 0);

  const healthy = projectOctopusSelfHealDecision(
    { octopusNeedsRepair: false },
    { nowMs: 600_000, lastAttemptAtMs: null },
  );
  assert.equal(healthy.shouldRepair, false);
  assert.equal(healthy.reason, 'OCTOPUS_SELF_HEAL_NOT_REQUIRED');
});

test('single missing exact worker grant without an active lane is an explicit idle wait, never execution proof', () => {
  const idle = summarizePersistentFlywheelResult({
    status: 'HOLD', blockers: ['mission-worker:exact-action-grant-unavailable'],
    allowWorkerTick: false, boundedMutationSteps: 0,
    authoritativeProjection: { status: 'READY', lane: null },
  });
  assert.equal(idle.idleGrantWait, true);
  assert.equal(idle.blockerCount, 1);
  assert.equal(idle.allowWorkerTick, false);
  assert.equal(idle.boundedMutationSteps, 0);
  const active = summarizePersistentFlywheelResult({
    status: 'HOLD', blockers: ['mission-worker:exact-action-grant-unavailable'],
    allowWorkerTick: false, boundedMutationSteps: 0,
    authoritativeProjection: { lane: { laneId: 'busy-lane' } },
  });
  assert.equal(active.idleGrantWait, false);
});

test('Flywheel status summary stays bounded and does not expose blocker bodies', () => {
  const summary = summarizePersistentFlywheelResult({
    status: 'ACTIVE',
    action: 'ADVANCE_ACTIVE_LANE',
    blockers: ['secret-looking blocker text'],
    allowWorkerTick: true,
    boundedMutationSteps: 1,
    sourceRevision: 'a'.repeat(40),
  });
  assert.equal(summary.blockerCount, 1);
  assert.equal(Object.hasOwn(summary, 'blockers'), false);
  assert.equal(summary.safeSummaryOnly, true);
});

test('Core daemon embeds the canonical Flywheel instead of a second scheduler process', async () => {
  const source = await readFile(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');
  assert.match(source, /runDurableFlywheelStartupCycle/);
  assert.match(source, /projectPersistentFlywheelTrigger/);
  assert.match(source, /lastFlywheelWakeReason = trigger\.reason/);
  assert.match(source, /canonicalSchedulerDelegation: true/);
  assert.match(source, /flywheelSingleFlight: true/);
  assert.match(source, /sourceMutationAllowed: false/);
  assert.match(source, /schedulerAuthority: false/);
  assert.doesNotMatch(source, /spawn\([^\n]*flywheel/i);
});

test('logical goal controllers are first-class persistent Flywheel occupancy evidence', () => {
  const summary = summarizeLogicalGoalControllerFabric({
    authoritativeProjection: {
      logicalGoalControllerFabric: {
        valid: true,
        controllers: [
          { continuityState: 'ACTIVE', selectedForAdmission: true, retired: false },
          { continuityState: 'TRACKING', selectedForAdmission: false, retired: false },
          { continuityState: 'PARKED', selectedForAdmission: false, retired: false },
          { continuityState: 'RETIRED', selectedForAdmission: false, retired: true },
        ],
      },
    },
  }, 15);
  assert.equal(summary.logicalLaneTruth, 'CURRENT');
  assert.equal(summary.logicalControllerCount, 3);
  assert.equal(summary.logicalActiveLaneCount, 1);
  assert.equal(summary.logicalTrackingLaneCount, 1);
  assert.equal(summary.logicalParkedLaneCount, 1);
  assert.equal(summary.logicalSelectedForAdmissionCount, 1);
  assert.equal(summary.logicalLaneDeficitToTarget, 14);
});

test('persistent refill summary preserves work-conserving evidence without raw blocker bodies', () => {
  const summary = summarizePersistentRefillSweep({
    ok: true,
    materialActionsSucceeded: 4,
    sweepAttemptCount: 7,
    cycleDecision: { safeEligibleWorkRemaining: 2, provenSafeFreeLanes: 3 },
    parkedLaneBlockers: ['lane-a:blocker'],
    workConservingSweepExhausted: true,
    finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_WORK_CONSERVING_SWEEP_EXHAUSTED',
  });
  assert.equal(summary.refillMaterialActionsSucceeded, 4);
  assert.equal(summary.refillSweepAttemptCount, 7);
  assert.equal(summary.refillSafeEligibleWorkRemaining, 2);
  assert.equal(summary.refillProvenSafeFreeLanes, 3);
  assert.equal(summary.refillParkedLaneCount, 1);
  assert.equal(Object.hasOwn(summary, 'parkedLaneBlockers'), false);
});

test('Octopus productivity exposes material build truth and detects unused capacity', () => {
  const building = summarizeOctopusBuildProductivity({
    refillStatus: 'READY',
    refillMaterialActionsSucceeded: 3,
    refillSweepAttemptCount: 5,
    refillSafeEligibleWorkRemaining: 2,
    refillProvenSafeFreeLanes: 4,
    refillNoRunnableSourceWorkProven: false,
    refillWorkConservingSweepExhausted: false,
    refillParkedLaneCount: 0,
  }, { lastMaterialBuildAtUtc: '2026-10-03T21:45:00.000Z' });
  assert.equal(building.octopusBuildVerdict, 'BUILDING');
  assert.equal(building.octopusNeedsRepair, false);
  assert.equal(building.octopusMaterialActionsLastCycle, 3);
  assert.equal(building.octopusLastMaterialBuildAtUtc, '2026-10-03T21:45:00.000Z');

  const stalled = summarizeOctopusBuildProductivity({
    refillStatus: 'READY',
    refillMaterialActionsSucceeded: 0,
    refillSweepAttemptCount: 15,
    refillSafeEligibleWorkRemaining: 3,
    refillProvenSafeFreeLanes: 5,
    refillNoRunnableSourceWorkProven: false,
    refillWorkConservingSweepExhausted: true,
    refillParkedLaneCount: 0,
  });
  assert.equal(stalled.octopusBuildVerdict, 'STALLED_WITH_CAPACITY');
  assert.equal(stalled.octopusBuildStallDetected, true);
  assert.equal(stalled.octopusNeedsRepair, true);

  const idle = summarizeOctopusBuildProductivity({
    refillStatus: 'READY',
    refillMaterialActionsSucceeded: 0,
    refillSweepAttemptCount: 1,
    refillSafeEligibleWorkRemaining: 0,
    refillProvenSafeFreeLanes: 0,
    refillNoRunnableSourceWorkProven: true,
    refillWorkConservingSweepExhausted: false,
    refillParkedLaneCount: 0,
  });
  assert.equal(idle.octopusBuildVerdict, 'IDLE_PROVEN');
  assert.equal(idle.octopusNeedsRepair, false);
});

test('Core daemon reuses canonical work-conserving refill up to the 15-lane target', async () => {
  const source = await readFile(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');
  assert.match(source, /runBattleBridgeGoalDiscoveryHeartbeat/);
  assert.match(source, /TARGET_MATERIAL_LANES = 15/);
  assert.match(source, /maxWorkConservingAttempts: TARGET_MATERIAL_LANES/);
  assert.match(source, /summarizeLogicalGoalControllerFabric/);
});

test('Core daemon publishes existing controller-lane truth after canonical Flywheel reconciliation', async () => {
  const source = await readFile(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');
  assert.match(source, /collectSovereignControllerLaneStatus/);
  assert.match(source, /publishSharedWorkspaceControllerLaneStatus/);
  assert.match(source, /publishSharedWorkspaceStephanosBuildTruth/);
  assert.match(source, /buildStephanosBuildTruth/);
  assert.match(source, /async function publishControllerLaneTruth\(\)/);
  assert.match(source, /CONTROLLER_LANE_TRUTH_PUBLISHED/);
  assert.match(source, /CONTROLLER_LANE_TRUTH_PUBLICATION_FAILED/);
  const reconcileIndex = source.indexOf('const result = await runDurableFlywheelStartupCycle');
  const laneSummaryIndex = source.indexOf('lastLogicalLaneSummary = summarizeLogicalGoalControllerFabric');
  const lanePublishIndex = source.indexOf('await publishControllerLaneTruth()');
  assert.ok(reconcileIndex >= 0);
  assert.ok(laneSummaryIndex > reconcileIndex);
  assert.ok(lanePublishIndex > laneSummaryIndex, 'controller-lane truth must publish after canonical programme reconciliation');
  assert.doesNotMatch(source, /setInterval\([^)]*controllerLane/i);
  assert.doesNotMatch(source, /setTimeout\([^)]*controllerLane/i);
});

test('Core daemon runs Octopus material refill before Flywheel reconciliation and isolates failures', async () => {
  const source = await readFile(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');
  const refillIndex = source.indexOf('const refill = await runBattleBridgeGoalDiscoveryHeartbeat');
  const flywheelIndex = source.indexOf('const result = await runDurableFlywheelStartupCycle');
  assert.ok(refillIndex >= 0);
  assert.ok(flywheelIndex >= 0);
  assert.ok(refillIndex < flywheelIndex, 'Octopus refill must run before Flywheel reconciliation');
  assert.match(source, /lastRefillError = ''/);
  assert.match(source, /OCTOPUS_REFILL_CYCLE_FAILED/);
  assert.match(source, /summarizeOctopusBuildProductivity/);
  assert.match(source, /octopusLastError/);
});

test('Core daemon consumes Octopus repair truth through bounded Sovereign recovery and verifies refill', async () => {
  const source = await readFile(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');
  assert.match(source, /lastOctopusBuildSummary\.octopusNeedsRepair/);
  assert.match(source, /projectOctopusSelfHealDecision/);
  assert.match(source, /OCTOPUS_SELF_HEAL_ACTION_ID = 'repair-goal-builder-flow'/);
  assert.match(source, /CONTROL_PLANE_SELF_HEAL_ACTION_ID = 'repair-control-plane'/);
  assert.match(source, /projectOctopusRepairEscalation/);
  assert.match(source, /goal-builder-retry/);
  assert.match(source, /OCTOPUS_CONTROLLER_FABRIC_SELF_HEAL_COMPLETED/);
  assert.match(source, /SOVEREIGN_COMMANDER_OPERATION\.MAINTENANCE_ACTION/);
  assert.match(source, /executeSovereignCommanderCommandV1/);
  assert.match(source, /await maybeSelfHealOctopus\(sourceHead\)/);
  assert.match(source, /A thrown refill and a truthfully stalled refill are both repair/);
  assert.match(source, /const verificationRefill = await runBattleBridgeGoalDiscoveryHeartbeat/);
  assert.match(source, /OCTOPUS_SELF_HEAL_VERIFIED_RECOVERED/);
  assert.match(source, /OCTOPUS_SELF_HEAL_COOLDOWN_MS/);
  assert.doesNotMatch(source, /DESKTOP_COMMANDER.*octopus/i);
});

test('persistent refill stays behind genuine gaming protection without latching on stale phase text', async () => {
  const source = await readFile(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');
  assert.match(source, /PERSISTENT_FLYWHEEL_GAMING_PROTECTED/);
  assert.match(source, /maybeStartPersistentFlywheel\(sourceHead, state\.gamingActive\)/);
  assert.match(source, /return value\?\.active === true;/);
  assert.doesNotMatch(source, /gaming\|vr\|flat/);
});


test('Core daemon breaks the Commander repair circular dependency and publishes wake truth', async () => {
  const source = await readFile(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');
  assert.match(source, /ensureSovereignCommanderRuntime/);
  assert.match(source, /probeSovereignCommanderRuntimeCompatibility/);
  assert.match(source, /maybeRepairCoreDependencies/);
  assert.match(source, /BATTLE_BRIDGE_SELF_HEAL_ACTION_ID = 'repair-battle-bridge'/);
  assert.match(source, /MISSION_WORKER_START_ACTION_ID = 'start-mission-orchestrator-worker'/);
  assert.match(source, /CORE_DEPENDENCY_SELF_HEAL_VERIFIED_RECOVERED/);
  assert.match(source, /projectStephanosControlPlaneSpine/);
  assert.match(source, /controlPlane\.wakeState/);
  assert.match(source, /dependencySelfHealEnabled: true/);
});

test('canonical programme HOLD wakes bounded Sovereign repair instead of looking idle', () => {
  const refill = summarizePersistentRefillSweep({
    ok: true,
    finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_CANONICAL_PROGRAMME_HOLD',
    conveyorResult: { programmeStatus: 'HOLD', programmeBlockers: ['lease-blocked'] },
    controllerContinuity: 'RECONCILE_CANONICAL_PROGRAMME_HOLD',
    materialActionsSucceeded: 0,
    sweepAttemptCount: 1,
    cycleDecision: { safeEligibleWorkRemaining: 0, provenSafeFreeLanes: 0 },
    parkedLaneBlockers: [],
    noRunnableSourceWorkProven: false,
  });
  assert.equal(refill.refillCanonicalProgrammeHeld, true);
  const summary = summarizeOctopusBuildProductivity(refill);
  assert.equal(summary.octopusBuildVerdict, 'PROGRAMME_HOLD');
  assert.equal(summary.octopusBuildStallDetected, true);
  assert.equal(summary.octopusNeedsRepair, true);
  assert.equal(summary.octopusProgrammeHeld, true);
  const wake = projectOctopusSelfHealDecision(summary, {
    nowMs: 1_000,
    lastAttemptAtMs: null,
  });
  assert.equal(wake.shouldRepair, true);
  assert.equal(wake.reason, 'OCTOPUS_SELF_HEAL_REQUIRED');
});

test('all parked work is repair pressure even when zero runnable work was observed', () => {
  const summary = summarizeOctopusBuildProductivity({
    refillStatus: 'READY',
    refillMaterialActionsSucceeded: 0,
    refillSafeEligibleWorkRemaining: 0,
    refillProvenSafeFreeLanes: 0,
    refillNoRunnableSourceWorkProven: true,
    refillParkedLaneCount: 2,
    refillCanonicalProgrammeHeld: false,
  });
  assert.equal(summary.octopusBuildVerdict, 'PARKED');
  assert.equal(summary.octopusNeedsRepair, true);
  assert.equal(summary.octopusBuildStallDetected, true);
  assert.equal(summary.octopusProgrammeHeld, false);
});

test('a genuinely empty proven-idle conveyor does not start redundant repair', () => {
  const summary = summarizeOctopusBuildProductivity({
    refillStatus: 'READY',
    refillMaterialActionsSucceeded: 0,
    refillSafeEligibleWorkRemaining: 0,
    refillProvenSafeFreeLanes: 0,
    refillNoRunnableSourceWorkProven: true,
    refillParkedLaneCount: 0,
    refillCanonicalProgrammeHeld: false,
  });
  assert.equal(summary.octopusBuildVerdict, 'IDLE_PROVEN');
  assert.equal(summary.octopusNeedsRepair, false);
  assert.equal(projectOctopusSelfHealDecision(summary).shouldRepair, false);
});


const AUDIT_HEAD = 'a'.repeat(40);
const AUDIT_NOW = '2026-10-09T19:00:00.000Z';
function auditFixture() {
  return {
    coreState: { sourceHead: AUDIT_HEAD, sovereignCommanderHealthy: true, backendHealthy: true,
      missionWorkerHealthy: true, gamingActive: false },
    flywheel: {
      flywheelFallbackIntervalMs: 60_000,
      flywheelLastCycleFinishedAtUtc: '2026-10-09T18:59:30.000Z',
      refillStatus: 'READY', refillMaterialActionsSucceeded: 0,
      refillSafeEligibleWorkRemaining: 0, refillProvenSafeFreeLanes: 0,
      octopusBuildVerdict: 'IDLE_PROVEN',
    },
    observedAtUtc: AUDIT_NOW,
  };
}

test('meta-check never upgrades healthy checkers or an idle flywheel to proven goal-to-live closure', () => {
  const audit = auditCoreLoopClosureV1(auditFixture());
  assert.equal(audit.allLoopsProvenClosed, false);
  assert.equal(audit.classification, 'LOOP_CLOSURE_EVIDENCE_INCOMPLETE');
  assert.equal(audit.edges.find((edge) => edge.id === 'DEPENDENCIES_TO_WATCH').state, 'CLOSED');
  assert.equal(audit.edges.find((edge) => edge.id === 'ADMISSION_TO_SELECT').state, 'UNKNOWN');
  assert.equal(audit.edges.find((edge) => edge.id === 'MERGE_TO_LIVE_ACCEPTANCE').state, 'UNKNOWN');
  assert.equal(audit.mergeAuthority, false);
  assert.equal(audit.noNewMutationAuthority, true);
});

test('fresh controller heartbeats cannot conceal work stranded at a closed edge', () => {
  const input = auditFixture();
  input.flywheel.refillSafeEligibleWorkRemaining = 3;
  input.flywheel.refillProvenSafeFreeLanes = 2;
  const audit = auditCoreLoopClosureV1(input);
  assert.equal(audit.classification, 'LOOP_GAPS_DETECTED');
  assert.equal(audit.edges.find((edge) => edge.id === 'RECONCILIATION_TO_GOAL_ADMISSION').reason,
    'RUNNABLE_WORK_WITH_FREE_CAPACITY_STRANDED');
  assert.equal(audit.nextAction.ownerIssue, '#2002');
});

test('contradictory BUILDING claim with no material actions fails the loop meta-check', () => {
  const input = auditFixture();
  input.flywheel.octopusBuildVerdict = 'BUILDING';
  const audit = auditCoreLoopClosureV1(input);
  assert.equal(audit.edges.find((edge) => edge.id === 'RECONCILIATION_TO_GOAL_ADMISSION').state, 'GAP');
  assert.equal(audit.allLoopsProvenClosed, false);
});

test('dispatch or an action claim alone is never evidence of physical worker pickup', () => {
  const input = auditFixture();
  input.worker = {
    activeTaskId: 'task-1', activeReceiptId: 'claim:123',
    executionPhase: 'processing:codex',
    headSha: AUDIT_HEAD,
    timestampUtc: AUDIT_NOW,
  };
  const audit = auditCoreLoopClosureV1(input);
  assert.equal(audit.edges.find((edge) => edge.id === 'CLAIM_TO_PHYSICAL_PICKUP').state, 'UNKNOWN');
  assert.equal(audit.allLoopsProvenClosed, false);
});

test('fresh exact-head physical worker receipt proves only pickup, never completion', () => {
  const input = auditFixture();
  input.worker = {
    activeTaskId: 'task-1', activeReceiptId: 'receipt-1',
    executionPhase: 'running-tests',
    headSha: AUDIT_HEAD,
    timestampUtc: AUDIT_NOW,
  };
  const audit = auditCoreLoopClosureV1(input);
  assert.equal(audit.edges.find((edge) => edge.id === 'CLAIM_TO_PHYSICAL_PICKUP').state, 'CLOSED');
  assert.equal(audit.edges.find((edge) => edge.id === 'PICKUP_TO_EXECUTION').state, 'IN_PROGRESS');
  assert.equal(audit.edges.find((edge) => edge.id === 'EXECUTION_TO_DETERMINISTIC_PROOF').state, 'UNKNOWN');
  assert.equal(audit.allLoopsProvenClosed, false);
});

test('stale worker, incorrect head and expired lease independently block closure', () => {
  const input = auditFixture();
  input.worker = {
    activeTaskId: 'task-1', activeReceiptId: 'receipt-1',
    executionPhase: 'running-tests', headSha: 'b'.repeat(40),
    timestampUtc: '2026-10-09T18:40:00.000Z',
  };
  input.lease = { active: true, expiresAtUtc: '2026-10-09T18:59:00.000Z' };
  const audit = auditCoreLoopClosureV1(input);
  assert.equal(audit.edges.find((edge) => edge.id === 'CLAIM_TO_PHYSICAL_PICKUP').reason, 'WORKER_SOURCE_HEAD_MISMATCH');
  assert.equal(audit.edges.find((edge) => edge.id === 'PICKUP_TO_EXECUTION').reason, 'ACTIVE_SOURCE_MUTATION_LEASE_EXPIRED');
  assert.equal(audit.classification, 'LOOP_GAPS_DETECTED');
});

test('missing fresh reconciliation is a detected gap, not an all-green state', () => {
  const input = auditFixture();
  input.flywheel.flywheelLastCycleFinishedAtUtc = '2026-10-09T18:30:00.000Z';
  const audit = auditCoreLoopClosureV1(input);
  assert.equal(audit.edges.find((edge) => edge.id === 'WATCH_TO_RECONCILIATION').reason,
    'PERSISTENT_CYCLE_MISSING_OR_STALE');
  assert.equal(audit.classification, 'LOOP_GAPS_DETECTED');
});

test('gaming protection pauses repair checks without claiming missing proof is green', () => {
  const input = auditFixture();
  input.coreState.gamingActive = true;
  const audit = auditCoreLoopClosureV1(input);
  assert.equal(audit.edges.find((edge) => edge.id === 'WATCH_TO_RECONCILIATION').state, 'PAUSED');
  assert.equal(audit.allLoopsProvenClosed, false);
});


test('unresolved canonical Flywheel owners are deduped and never called completed', () => {
  const closure = summarizePersistentGapClosure({
    ok: true,
    attachments: [
      { disposition: 'ATTACH_TO_EXISTING_GOAL', ownerGoals: ['#2961', '#2961'] },
      { disposition: 'CANONICAL_GOAL_CREATED_AND_ADMITTED', ownerGoals: ['#2954'] },
    ],
    canonicalGoalAdmissionHeldCount: 0,
  });
  assert.equal(closure.gapClosureStatus, 'PENDING_PROOF');
  assert.equal(closure.gapClosureUnresolvedOwnerCount, 2);
  assert.deepEqual(closure.gapClosureOwnerRefs, ['#2954', '#2961']);
  assert.equal(closure.gapClosureCompletionProven, false);
  assert.equal(closure.gapClosureMergeAuthority, false);
});

test('an owned actionable gap with proven idle and no worker pickup triggers existing guarded repair', () => {
  const gapClosureSummary = summarizePersistentGapClosure({
    ok: true, attachments: [{ disposition: 'ATTACH_TO_EXISTING_GOAL', ownerGoals: ['#2961'] }],
  });
  const summary = summarizeOctopusBuildProductivity({
    refillStatus: 'READY', refillMaterialActionsSucceeded: 0,
    refillNoRunnableSourceWorkProven: true, refillParkedLaneCount: 0,
  }, { gapClosureSummary });
  assert.equal(summary.octopusBuildVerdict, 'OWNED_GAP_PICKUP_MISSING');
  assert.equal(summary.octopusNeedsRepair, true);
  assert.equal(projectOctopusSelfHealDecision(summary, { nowMs: 1000 }).shouldRepair, true);
  assert.equal(projectOctopusSelfHealDecision(summary, { nowMs: 1000, lastAttemptAtMs: 900 }).shouldRepair, false);
});

test('material building takes priority, and unknown gap evidence cannot manufacture repair', () => {
  const gapClosureSummary = summarizePersistentGapClosure({
    ok: true, attachments: [{ disposition: 'ATTACH_TO_EXISTING_GOAL', ownerGoals: ['#2961'] }],
  });
  const active = summarizeOctopusBuildProductivity({
    refillStatus: 'READY', refillMaterialActionsSucceeded: 1,
  }, { gapClosureSummary });
  assert.equal(active.octopusBuildVerdict, 'BUILDING');
  assert.equal(active.octopusNeedsRepair, false);
  const unknown = summarizePersistentGapClosure();
  assert.equal(unknown.gapClosureStatus, 'UNKNOWN');
  const idle = summarizeOctopusBuildProductivity({
    refillStatus: 'READY', refillNoRunnableSourceWorkProven: true,
  }, { gapClosureSummary: unknown });
  assert.equal(idle.octopusBuildVerdict, 'IDLE_PROVEN');
  assert.equal(idle.octopusNeedsRepair, false);
});

test('Core Daemon wires Flywheel-owned gap proof into existing Sovereign repair flow', async () => {
  const source = await readFile(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');
  assert.match(source, /summarizePersistentGapClosure\(result\?\.learningGoalReconciliation\)/);
  assert.match(source, /gapClosureSummary: lastGapClosureSummary/);
  assert.match(source, /maybeSelfHealOctopus\(sourceHead\)/);
  assert.match(source, /OCTOPUS_SELF_HEAL_ACTION_ID = 'repair-goal-builder-flow'/);
});


test('failed Sovereign repair is deduped by source head and real blocker under original owner', () => {
  const input = {
    sourceHead: AUDIT_HEAD, attemptAtUtc: AUDIT_NOW, attemptCount: 3,
    blocker: 'ELASTIC_GOAL_ADMISSION_NOT_PROVEN', needsRepair: true,
  };
  const first = projectOctopusFailedRepairLearningEventV1(input);
  const retried = projectOctopusFailedRepairLearningEventV1({ ...input, attemptCount: 4 });
  assert.equal(first.publish, true);
  assert.equal(first.eventId, retried.eventId);
  assert.equal(first.ownerIssue, '#2961');
  assert.equal(first.reason, 'ELASTIC_GOAL_ADMISSION_NOT_PROVEN');
  assert.equal(first.leaseOverrideAllowed, false);
  assert.equal(first.mergeAuthority, false);
});

test('failed repair learning pressure requires a proven attempt, typed blocker and still-blocked system', () => {
  const data = {
    sourceHead: AUDIT_HEAD, attemptAtUtc: AUDIT_NOW, attemptCount: 1,
    blocker: 'ELASTIC_GOAL_ADMISSION_NOT_PROVEN', needsRepair: true,
  };
  for (const overrides of [
    { sourceHead: '' }, { attemptAtUtc: '' }, { attemptCount: 0 },
    { blocker: 'free text containing untrusted details' }, { needsRepair: false },
  ]) assert.equal(projectOctopusFailedRepairLearningEventV1({ ...data, ...overrides }).publish, false);
});

test('a refill heartbeat is not proof of canonical goal admission, and a real admission hold is a GAP', () => {
  const idle = auditCoreLoopClosureV1(auditFixture());
  const edge = idle.edges.find((item) => item.id === 'RECONCILIATION_TO_GOAL_ADMISSION');
  assert.equal(edge.state, 'UNKNOWN');
  assert.equal(edge.reason, 'REFILL_SWEEP_NOT_CANONICAL_ADMISSION_PROOF');
  const held = auditFixture();
  held.flywheel.gapClosureAdmissionHeldCount = 2;
  const blocked = auditCoreLoopClosureV1(held);
  assert.equal(blocked.edges.find((item) => item.id === 'RECONCILIATION_TO_GOAL_ADMISSION').state, 'GAP');
  assert.equal(blocked.edges.find((item) => item.id === 'RECONCILIATION_TO_GOAL_ADMISSION').reason,
    'CANONICAL_GOAL_ADMISSION_HELD');
});

test('Flywheel stage timeout is an evidence-backed STALLED state, not permission to run another cycle', () => {
  const overdue = projectPersistentFlywheelStageWatchV1({
    cycleRunning: true, stage: 'REFILL',
    stageStartedAtUtc: '2026-10-09T20:00:00.000Z',
    observedAtUtc: '2026-10-09T20:03:01.000Z',
  });
  assert.equal(overdue.state, 'STALLED');
  assert.equal(overdue.deadlineMs, 180000);
  assert.equal(overdue.blocker, 'PERSISTENT_FLYWHEEL_STAGE_DEADLINE_EXCEEDED');
  assert.equal(overdue.ownerIssue, '#2961');
  assert.equal(overdue.singleFlightRetained, true);
  assert.equal(overdue.duplicateCycleAllowed, false);
  assert.equal(overdue.workerLeaseOverrideAllowed, false);
  const active = projectPersistentFlywheelStageWatchV1({
    cycleRunning: true, stage: 'REFILL',
    stageStartedAtUtc: '2026-10-09T20:00:00.000Z',
    observedAtUtc: '2026-10-09T20:01:25.000Z',
  });
  assert.equal(active.state, 'IN_PROGRESS', '85s startup never signals a proved stall');
});

test('unknown timing remains unknown and finished Flywheel remains IDLE, never false-green', () => {
  assert.equal(projectPersistentFlywheelStageWatchV1({
    cycleRunning: true, stage: 'REFILL', stageStartedAtUtc: '',
  }).state, 'UNKNOWN');
  assert.equal(projectPersistentFlywheelStageWatchV1({
    cycleRunning: true, stage: 'NOT_IN_CATALOG',
    stageStartedAtUtc: '2026-10-09T20:00:00.000Z',
  }).state, 'UNKNOWN');
  const idle = projectPersistentFlywheelStageWatchV1({
    cycleRunning: false, stage: 'REFILL',
    stageStartedAtUtc: '2026-10-09T20:00:00.000Z',
  });
  assert.equal(idle.state, 'IDLE');
  assert.equal(idle.blocker, '');
});

test('existing loop meta-check routes overdue in-flight stage to existing repair owner', () => {
  const input = auditFixture();
  input.flywheel.flywheelCycleRunning = true;
  input.flywheel.flywheelStageWatchState = 'STALLED';
  const result = auditCoreLoopClosureV1(input);
  const watch = result.edges.find((edge) => edge.id === 'WATCH_TO_RECONCILIATION');
  assert.equal(watch.state, 'GAP');
  assert.equal(watch.reason, 'PERSISTENT_CYCLE_STAGE_STALLED');
  assert.equal(watch.ownerIssue, '#2593');
  assert.equal(result.allLoopsProvenClosed, false);
});

test('checker-of-checkers independently routes every unresolved edge even if an earlier GAP persists', () => {
  const input = auditFixture();
  input.flywheel.refillSafeEligibleWorkRemaining = 2;
  input.flywheel.refillProvenSafeFreeLanes = 1;
  const audit = auditCoreLoopClosureV1(input);
  const plan = planCoreLoopCheckerEscalationsV1(audit);
  assert.equal(audit.totalEdgeCount, 12);
  assert.equal(plan.totalAuditedEdgeCount, 12);
  assert.equal(plan.measuredGapEdgeCount, audit.gapCount);
  assert.equal(plan.needsProofEdgeCount, audit.unprovenCount);
  assert.equal(plan.candidates.length, audit.gapCount + audit.unprovenCount);
  assert.equal(new Set(plan.candidates.map((c) => c.edgeId)).size, plan.candidates.length);
  assert.equal(plan.candidates[0].state, 'GAP');
  assert.ok(plan.candidates.some((edge) => edge.edgeId === 'LIVE_TO_REGRESSION_RESCAN'));
  assert.ok(plan.candidates.some((edge) => edge.edgeId === 'GAP_TO_GOAL_AND_RETRY'));
  assert.ok(plan.candidates.every((edge) => /^#[0-9]+$/.test(edge.ownerIssue)));
  assert.ok(plan.candidates.every((edge) => edge.eventId.endsWith('-w' + plan.windowId)));
  assert.equal(plan.mergeAuthority, false);
  assert.equal(plan.noDuplicateController, true);
});

test('known cases reenter the original owner after one six-hour window, never each heartbeat', () => {
  const input = auditFixture();
  const audit = auditCoreLoopClosureV1(input);
  const initial = planCoreLoopCheckerEscalationsV1(audit);
  const sameWindow = planCoreLoopCheckerEscalationsV1(audit, {
    observedAtUtc: new Date(Date.parse(AUDIT_NOW) + 15_000).toISOString(),
  });
  const later = planCoreLoopCheckerEscalationsV1(audit, {
    observedAtUtc: new Date(Date.parse(AUDIT_NOW) + CORE_LOOP_CHECKER_RECHECK_MS).toISOString(),
  });
  assert.deepEqual(initial.candidates.map((edge) => edge.eventId),
    sameWindow.candidates.map((edge) => edge.eventId));
  assert.ok(initial.candidates.every((edge, index) => later.candidates[index].eventId !== edge.eventId));
  assert.deepEqual(initial.candidates.map((edge) => edge.ownerIssue),
    later.candidates.map((edge) => edge.ownerIssue));
  const noHead = planCoreLoopCheckerEscalationsV1(audit, { sourceHead: 'unknown' });
  assert.equal(noHead.candidates.length, 0);
  assert.equal(noHead.mergeAuthority, false);
});

test('expired persisted mutation lease is an observed checker gap despite no runtime .active flag', () => {
  const input = auditFixture();
  input.lease = {
    schema: 'stephanos.source-mutation-lease.v1',
    status: 'ACTIVE',
    leaseId: 'critical-2956-elastic-goal-r6-lease',
    expiresAtUtc: '2026-10-09T18:58:00.000Z',
  };
  const audit = auditCoreLoopClosureV1(input);
  const edge = audit.edges.find((value) => value.id === 'PICKUP_TO_EXECUTION');
  assert.equal(edge.state, 'GAP');
  assert.equal(edge.reason, 'ACTIVE_SOURCE_MUTATION_LEASE_EXPIRED');
  assert.equal(audit.allLoopsProvenClosed, false);
  input.lease.status = 'RELEASED';
  const noLongerActive = auditCoreLoopClosureV1(input);
  assert.notEqual(noLongerActive.edges.find((value) => value.id === 'PICKUP_TO_EXECUTION').state, 'GAP');
});

test('failed checker event publication is itself a measured gap with its canonical owner', () => {
  const input = auditFixture();
  input.flywheel.loopClosureGapEventPublicationVerdict = 'CANONICAL_FLYWHEEL_GAP_EVENT_BLOCKED:DISK_FULL';
  const audit = auditCoreLoopClosureV1(input);
  const edge = audit.edges.find((value) => value.id === 'GAP_TO_GOAL_AND_RETRY');
  assert.equal(edge.state, 'GAP');
  assert.equal(edge.ownerIssue, '#2670');
  assert.equal(edge.reason, 'CANONICAL_FLYWHEEL_GAP_PUBLICATION_FAILED');
  const plan = planCoreLoopCheckerEscalationsV1(audit);
  assert.ok(plan.candidates.some((value) => value.edgeId === 'GAP_TO_GOAL_AND_RETRY' && value.state === 'GAP'));
});

test('checker routes root #2670 proof to the existing concrete #2972 owner instead of creating a duplicate goal', () => {
  const audit = auditCoreLoopClosureV1(auditFixture());
  const originalEdge = audit.edges.find((edge) => edge.id === 'GAP_TO_GOAL_AND_RETRY');
  assert.equal(originalEdge.ownerIssue, '#2670');
  const plan = planCoreLoopCheckerEscalationsV1(audit);
  const candidate = plan.candidates.find((edge) => edge.edgeId === 'GAP_TO_GOAL_AND_RETRY');
  assert.equal(candidate.auditOwnerIssue, '#2670');
  assert.equal(candidate.ownerIssue, '#2972');
  assert.equal(candidate.state, 'UNKNOWN');
  assert.equal(plan.noNewGoalScopeAuthority, true);
});
