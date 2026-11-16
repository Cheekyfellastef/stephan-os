import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { projectOnionContinuationV1 } from '../shared/agents/onionContinuationDoctrineV1.mjs';
import { projectStephanosCoreOnionContinuationV1 } from '../shared/agents/stephanosCoreOnionContinuationV1.mjs';
import {
  projectPersistentFlywheelStageWatchV1,
  summarizeOctopusBuildProductivity,
  summarizePersistentGapClosure,
} from '../shared/agents/stephanosCorePersistentFlywheelV1.mjs';

const daemonSource = await readFile(new URL('./stephanos-core-daemon.mjs', import.meta.url), 'utf8');

// Run the real initialization, startup and status projection in publication
// order. Pure projector tests cannot expose a first heartbeat overwriting the
// saved parent outcome while the asynchronous refill is still running.
async function firstHeartbeatAfterRestart(savedStatus, {
  lockOwned = true, sourceHead = 'b'.repeat(40), refillSummary = {}, flywheelResult = {},
} = {}) {
  let stored = savedStatus;
  const events = [];
  const state = daemonSource.slice(
    daemonSource.indexOf('let flywheelCycleRunning = false;'),
    daemonSource.indexOf('\nasync function publishControllerLaneTruth('),
  );
  const restoreAt = daemonSource.indexOf('async function restoreOnionContinuation(');
  const reconcileAt = daemonSource.indexOf('async function reconcileOnionContinuation(');
  const continuationFunctions = daemonSource.slice(
    restoreAt >= 0 ? restoreAt : reconcileAt,
    daemonSource.indexOf('\nfunction persistentFlywheelStatus('),
  );
  const status = daemonSource.slice(
    daemonSource.indexOf('function persistentFlywheelStatus('),
    daemonSource.indexOf('\nasync function maybeStartPersistentFlywheel('),
  );
  const startup = daemonSource.slice(
    daemonSource.indexOf('const sourceHead = currentHead();'),
    daemonSource.indexOf('// This bridge reuses the ALREADY locked Core Daemon task'),
  );
  const context = vm.createContext({
    Date, Object, String, Boolean,
    TARGET_MATERIAL_LANES: 15,
    FLYWHEEL_FALLBACK_MS: 60_000,
    OCTOPUS_SELF_HEAL_ACTION_ID: 'repair-goal-builder-flow',
    CONTROL_PLANE_SELF_HEAL_ACTION_ID: 'repair-control-plane',
    OCTOPUS_SELF_HEAL_COOLDOWN_MS: 300_000,
    DEPENDENCY_SELF_HEAL_COOLDOWN_MS: 120_000,
    coreStatusPath: '/fixture/stephanos-core-daemon-current.json',
    projectStephanosCoreOnionContinuationV1,
    projectPersistentFlywheelStageWatchV1,
    summarizeOctopusBuildProductivity,
    summarizePersistentGapClosure,
    fixtureRefillSummary: refillSummary,
    fixtureFlywheelResult: flywheelResult,
    currentHead: () => sourceHead,
    acquireSingleInstance: async () => { events.push('acquire-lock'); return lockOwned ? {} : null; },
    readJsonIfPresent: async () => { events.push('read-status'); return stored; },
    publishHeartbeat: (value) => {
      events.push('publish-heartbeat');
      stored = { sourceHead, onionContinuation: value.onionContinuation };
    },
    console: { log() {} },
    process: { exit() { throw new Error('FIXTURE_PROCESS_EXIT'); } },
  });
  try {
    const result = await vm.runInContext(`(async () => {
      ${state}
      ${continuationFunctions}
      ${status}
      ${startup}
      const first = persistentFlywheelStatus();
      publishHeartbeat(first);
      lastRefillSummary = { ...lastRefillSummary, ...fixtureRefillSummary };
      await reconcileOnionContinuation(fixtureFlywheelResult);
      const reconciled = persistentFlywheelStatus();
      publishHeartbeat(reconciled);
      return { first, reconciled };
    })()`, context);
    return { ...result, stored, events };
  } catch (error) {
    if (error.message !== 'FIXTURE_PROCESS_EXIT') throw error;
    return { exited: true, stored, events };
  }
}

test('core daemon restores onion continuation from Shared Workspace state after restart', () => {
  const persisted = projectOnionContinuationV1({
    originalOutcomeId: 'automatic-building',
    blocker: 'LAYER_763',
    blockerDepth: 763,
    safeRepairAvailable: true,
  });

  const restored = projectStephanosCoreOnionContinuationV1({ persisted });
  assert.equal(restored.restoredFromPersistedState, true);
  assert.equal(restored.originalOutcomeId, 'automatic-building');
  assert.equal(restored.blocker, 'LAYER_763');
  assert.equal(restored.blockerDepth, 763);
  assert.equal(restored.nextBlockerDepth, 764);
  assert.equal(restored.shouldContinue, true);
  assert.equal(restored.authorityExpanded, false);
});

test('new blocker continues the same parent outcome at the next depth', () => {
  const persisted = projectOnionContinuationV1({
    originalOutcomeId: 'automatic-building',
    blocker: 'LAYER_763',
    blockerDepth: 763,
    safeRepairAvailable: true,
  });

  const continued = projectStephanosCoreOnionContinuationV1({
    persisted,
    current: {
      originalOutcomeId: 'automatic-building',
      blocker: 'LAYER_764',
      safeRepairAvailable: true,
    },
  });

  assert.equal(continued.blockerChanged, true);
  assert.equal(continued.blockerDepth, 764);
  assert.equal(continued.nextBlockerDepth, 765);
  assert.equal(continued.shouldContinue, true);
  assert.equal(continued.sourceMutationAuthorityGranted, false);
  assert.equal(continued.mergeAuthorityGranted, false);
});

test('schema-mismatched persisted data is not trusted as continuation state', () => {
  const restored = projectStephanosCoreOnionContinuationV1({
    persisted: {
      schemaVersion: 'stephanos.onion-continuation.bad',
      originalOutcomeId: 'forged',
      blocker: 'forged',
      blockerDepth: 999,
    },
  });
  assert.equal(restored.restoredFromPersistedState, false);
  assert.equal(restored.originalOutcomeId, '');
  assert.equal(restored.blocker, '');
  assert.equal(restored.blockerDepth, 0);
});

test('first heartbeat preserves the saved original outcome before background reconciliation and across restarts', async () => {
  const original = projectOnionContinuationV1({
    originalOutcomeId: 'seed-self-maintenance-result',
    blocker: 'REVIEW_CAPACITY_UNAVAILABLE',
    blockerDepth: 7,
    safeRepairAvailable: true,
  });
  let stored = { sourceHead: 'a'.repeat(40), onionContinuation: original };
  for (const sourceHead of ['b'.repeat(40), 'c'.repeat(40)]) {
    const cycle = await firstHeartbeatAfterRestart(stored, { sourceHead });
    assert.deepEqual(cycle.events.slice(0, 3), ['acquire-lock', 'read-status', 'publish-heartbeat']);
    for (const status of [cycle.first, cycle.reconciled]) {
      assert.equal(status.onionContinuation.originalOutcomeId, original.originalOutcomeId);
      assert.equal(status.onionContinuation.blocker, original.blocker);
      assert.equal(status.onionContinuation.blockerDepth, 7);
      assert.equal(status.onionContinuation.originalOutcomeProven, false);
      assert.equal(status.onionContinuation.shouldContinue, true);
      assert.equal(status.onionContinuation.authorityExpanded, false);
      assert.equal(status.onionContinuation.sourceMutationAuthorityGranted, false);
      assert.equal(status.onionContinuation.schedulerAuthorityGranted, false);
      assert.equal(status.onionContinuation.mergeAuthorityGranted, false);
    }
    stored = cycle.stored;
  }
});

test('startup does not restore or publish another Core owner state without the canonical lock', async () => {
  const original = { onionContinuation: projectOnionContinuationV1({ originalOutcomeId: 'keep-owner' }) };
  const cycle = await firstHeartbeatAfterRestart(original, { lockOwned: false });
  assert.equal(cycle.exited, true);
  assert.deepEqual(cycle.events, ['acquire-lock']);
  assert.equal(cycle.stored, original);
});

test('missing or malformed saved continuation cannot inject outcome or mutation authority on startup', async () => {
  for (const savedStatus of [null, {}, { onionContinuation: null }, {
    onionContinuation: { schemaVersion: 'wrong-schema', originalOutcomeId: 'forged',
      originalOutcomeProven: true, blockerDepth: 99, sourceMutationAuthorityGranted: true },
  }]) {
    const cycle = await firstHeartbeatAfterRestart(savedStatus);
    assert.equal(cycle.first.onionContinuation.originalOutcomeId, '');
    assert.equal(cycle.first.onionContinuation.blockerDepth, 0);
    assert.equal(cycle.first.onionContinuation.originalOutcomeProven, false);
    assert.equal(cycle.first.onionContinuation.sourceMutationAuthorityGranted, false);
    assert.equal(cycle.first.onionContinuation.schedulerAuthorityGranted, false);
    assert.equal(cycle.first.onionContinuation.mergeAuthorityGranted, false);
  }
});

test('valid-schema malformed advisory fields cannot crash startup or claim successful restoration', async () => {
  const valid = projectOnionContinuationV1({ originalOutcomeId: 'original', blocker: 'WAITING_FOR_PROOF' });
  for (const patch of [
    { originalOutcomeId: { toString: null } },
    { blocker: { toString: null } },
    { blockerDepth: { toString: null } },
    { evidenceRefs: [{ toString: null }] },
  ]) {
    const cycle = await firstHeartbeatAfterRestart({ onionContinuation: { ...valid, ...patch } });
    const restored = cycle.first.onionContinuation;
    assert.equal(restored.restoredFromPersistedState, false);
    assert.equal(restored.originalOutcomeId, '');
    assert.equal(restored.blocker, 'CORE_PERSISTED_CONTINUATION_INVALID');
    assert.equal(restored.originalOutcomeProven, false);
    assert.equal(restored.safeRepairAvailable, false);
    assert.equal(restored.terminalPacketValid, false);
    assert.equal(restored.sourceMutationAuthorityGranted, false);
    assert.equal(restored.schedulerAuthorityGranted, false);
    assert.equal(restored.mergeAuthorityGranted, false);
    assert.equal(cycle.events.includes('publish-heartbeat'), true);
  }
});

test('startup preserves a recorded operator boundary and its proof through the first heartbeat', async () => {
  const original = projectOnionContinuationV1({
    originalOutcomeId: 'original-seed-result', blocker: 'OPERATOR_APPROVAL_REQUIRED',
    hardBoundary: true, boundaryId: 'operator-source-approval',
    terminalIdentity: 'operator-source-approval', evidenceRefs: ['proof/held-source-approval.json'],
    terminalOwner: '#2961', terminalAction: 'WAIT_FOR_EXISTING_OPERATOR_APPROVAL',
    reEvaluationTrigger: 'EXACT_APPROVAL_RECEIPT_CHANGED',
  });
  const cycle = await firstHeartbeatAfterRestart({ onionContinuation: original });
  for (const status of [cycle.first, cycle.reconciled]) {
    assert.equal(status.onionContinuation.originalOutcomeId, original.originalOutcomeId);
    assert.equal(status.onionContinuation.hardBoundary, true);
    assert.equal(status.onionContinuation.terminalState, original.terminalState);
    assert.equal(status.onionContinuation.shouldContinue, false);
    assert.equal(status.onionContinuation.sourceMutationAuthorityGranted, false);
    assert.equal(status.onionContinuation.mergeAuthorityGranted, false);
  }
});

function heldParent(originalOutcomeId, overrides = {}) {
  return projectOnionContinuationV1({
    originalOutcomeId, blocker: 'WAIT_FOR_SOURCE_APPROVAL', blockerDepth: 5,
    hardBoundary: true, boundaryId: 'same-boundary-id',
    terminalIdentity: 'same-boundary-id', evidenceRefs: ['proof/' + originalOutcomeId + '.json'],
    terminalOwner: '#2961', terminalAction: 'WAIT_FOR_EXISTING_OPERATOR_APPROVAL',
    reEvaluationTrigger: 'EXACT_APPROVAL_RECEIPT_CHANGED', ...overrides,
  });
}

test('a different explicit parent cannot inherit another parents terminal packet or blocker depth', () => {
  for (const persisted of [
    heldParent('seed-A'),
    heldParent('seed-A', { hardBoundary: false, safeRepairAvailable: false, noSafeRepairId: 'same-boundary-id' }),
    heldParent('seed-A', { originalOutcomeProven: true, terminalIdentity: 'seed-A' }),
  ]) {
    for (const current of [
      { originalOutcomeId: 'seed-B' },
      { originalOutcomeId: 'seed-B', hardBoundary: true, boundaryId: 'same-boundary-id' },
      { originalOutcomeId: 'seed-B', safeRepairAvailable: false, noSafeRepairId: 'same-boundary-id' },
    ]) {
      const next = projectStephanosCoreOnionContinuationV1({ persisted, current });
      assert.equal(next.originalOutcomeId, 'seed-B');
      assert.equal(next.blocker, '');
      assert.equal(next.blockerDepth, 0);
      assert.equal(next.blockerChanged, false);
      assert.equal(next.originalOutcomeProven, false);
      assert.equal(next.terminalIdentity, '');
      assert.deepEqual(next.evidenceRefs, []);
      assert.equal(next.terminalOwner, '');
      assert.equal(next.terminalAction, '');
      assert.equal(next.reEvaluationTrigger, '');
      assert.equal(next.terminalPacketValid, false);
      assert.equal(next.terminalState, '');
      assert.equal(next.shouldContinue, true);
      assert.equal(next.sourceMutationAuthorityGranted, false);
      assert.equal(next.mergeAuthorityGranted, false);
    }
  }
});

test('fresh explicit parent evidence and same-parent boundary patches retain their own identities', () => {
  const persisted = heldParent('seed-A');
  const fresh = heldParent('seed-B', { blockerDepth: 2 });
  const replaced = projectStephanosCoreOnionContinuationV1({ persisted, current: fresh });
  assert.equal(replaced.originalOutcomeId, 'seed-B');
  assert.equal(replaced.blockerDepth, 2);
  assert.deepEqual(replaced.evidenceRefs, ['proof/seed-B.json']);
  assert.equal(replaced.terminalPacketValid, true);
  assert.equal(replaced.shouldContinue, false);

  for (const current of [{}, { originalOutcomeId: 'seed-A' }, { blocker: 'NEW_OBSERVATION_SAME_HELD_PARENT' }]) {
    const same = projectStephanosCoreOnionContinuationV1({ persisted, current });
    assert.equal(same.originalOutcomeId, 'seed-A');
    assert.deepEqual(same.evidenceRefs, ['proof/seed-A.json']);
    assert.equal(same.terminalPacketValid, true);
    assert.equal(same.shouldContinue, false);
  }
  const mismatch = projectStephanosCoreOnionContinuationV1({
    persisted, current: { originalOutcomeId: 'seed-A', boundaryId: 'different-boundary-id' },
  });
  assert.equal(mismatch.terminalPacketValid, false);
  assert.equal(mismatch.terminalState, '');
});

test('actual refill canary preserves specific retained parent and its boundary without claiming refill completion', async () => {
  for (const original of [
    heldParent('specific-seed'),
    heldParent('specific-seed', { hardBoundary: false, safeRepairAvailable: true }),
  ]) {
    const cycle = await firstHeartbeatAfterRestart({ onionContinuation: original }, {
      refillSummary: { refillSafeEligibleWorkRemaining: 1, refillMaterialActionsSucceeded: 0,
        refillFinalVerdict: 'SOURCE_PICKUP_HELD' },
    });
    const continued = cycle.reconciled.onionContinuation;
    assert.equal(continued.originalOutcomeId, 'specific-seed');
    assert.equal(continued.blocker, original.blocker);
    assert.equal(continued.blockerDepth, original.blockerDepth);
    assert.equal(continued.terminalState, original.terminalState);
    assert.equal(continued.shouldContinue, original.shouldContinue);
    assert.equal(continued.originalOutcomeProven, false);
    assert.equal(continued.sourceMutationAuthorityGranted, false);
  }
});

test('actual refill canary supplies a missing parent while explicit live parent remains authoritative', async () => {
  const refillSummary = { refillSafeEligibleWorkRemaining: 1, refillMaterialActionsSucceeded: 0,
    refillFinalVerdict: 'SOURCE_PICKUP_HELD' };
  const fallback = await firstHeartbeatAfterRestart(null, { refillSummary });
  assert.equal(fallback.reconciled.onionContinuation.originalOutcomeId, 'automatic-building-refill');
  assert.equal(fallback.reconciled.onionContinuation.blocker, 'SOURCE_PICKUP_HELD');
  assert.equal(fallback.reconciled.onionContinuation.shouldContinue, true);
  assert.equal(fallback.reconciled.onionContinuation.originalOutcomeProven, false);

  const explicit = await firstHeartbeatAfterRestart({ onionContinuation: heldParent('seed-A') }, {
    refillSummary, flywheelResult: { onionContinuation: { originalOutcomeId: 'seed-B', blocker: 'NEW_PARENT_WORK' } },
  });
  const next = explicit.reconciled.onionContinuation;
  assert.equal(next.originalOutcomeId, 'seed-B');
  assert.equal(next.blocker, 'NEW_PARENT_WORK');
  assert.equal(next.blockerDepth, 0);
  assert.equal(next.hardBoundary, false);
  assert.equal(next.terminalPacketValid, false);
  assert.deepEqual(next.evidenceRefs, []);
  assert.equal(next.shouldContinue, true);
  assert.equal(next.sourceMutationAuthorityGranted, false);
});

test('actual refill canary advances its own nonterminal blocker and depth across repeated observations', async () => {
  let stored = { onionContinuation: projectOnionContinuationV1({
    originalOutcomeId: 'automatic-building-refill', blocker: 'INITIAL_PICKUP_HELD', blockerDepth: 2,
  }) };
  for (const [blocker, depth] of [['WORKER_CAPACITY_UNAVAILABLE', 3], ['SOURCE_PICKUP_HELD', 4]]) {
    const cycle = await firstHeartbeatAfterRestart(stored, {
      refillSummary: { refillSafeEligibleWorkRemaining: 1, refillMaterialActionsSucceeded: 0,
        refillFinalVerdict: blocker },
    });
    const next = cycle.reconciled.onionContinuation;
    assert.equal(next.originalOutcomeId, 'automatic-building-refill');
    assert.equal(next.blocker, blocker);
    assert.equal(next.blockerDepth, depth);
    assert.equal(next.blockerChanged, true);
    assert.equal(next.terminalRequested, false);
    assert.equal(next.originalOutcomeProven, false);
    assert.equal(next.shouldContinue, true);
    assert.equal(next.sourceMutationAuthorityGranted, false);
    stored = cycle.stored;
  }
});

test('actual refill canary never replaces any requested terminal state including an unproven unnamed boundary', async () => {
  const parent = 'automatic-building-refill';
  for (const original of [
    heldParent(parent),
    heldParent(parent, { hardBoundary: false, safeRepairAvailable: false, noSafeRepairId: 'same-boundary-id' }),
    heldParent(parent, { originalOutcomeProven: true, terminalIdentity: parent }),
    heldParent(parent, { evidenceRefs: [] }),
    projectOnionContinuationV1({ hardBoundary: true, blocker: 'UNRESOLVED_PARENT_IDENTITY' }),
  ]) {
    assert.equal(original.terminalRequested, true);
    const cycle = await firstHeartbeatAfterRestart({ onionContinuation: original }, {
      refillSummary: { refillSafeEligibleWorkRemaining: 1, refillMaterialActionsSucceeded: 0,
        refillFinalVerdict: 'NEW_REFILL_OBSERVATION' },
    });
    const next = cycle.reconciled.onionContinuation;
    for (const field of ['originalOutcomeId', 'blocker', 'blockerDepth', 'terminalRequested',
      'terminalIdentity', 'terminalPacketValid', 'terminalState', 'shouldContinue',
      'originalOutcomeProven', 'hardBoundary', 'safeRepairAvailable']) {
      assert.equal(next[field], original[field], field);
    }
    assert.deepEqual(next.evidenceRefs, original.evidenceRefs);
    assert.equal(next.sourceMutationAuthorityGranted, false);
    assert.equal(next.mergeAuthorityGranted, false);
  }
});
