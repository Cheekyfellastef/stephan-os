import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGoalBuildConveyorOverviewV1 as overview } from './goalBuildConveyorOverviewV1.mjs';

const NOW = Date.parse('2026-11-08T22:00:00Z');
const at = offsetMs => new Date(NOW + offsetMs).toISOString();
const projection = controllers => ({ controllerFleet: { controllers } });
const item = (id, extras = {}) => ({
  controllerId: id, title: id, activityState: 'BUILDING',
  freshness: 'CURRENT', timestampUtc: at(-1000), trafficLight: 'GREEN', ...extras,
});

test('Goal #2961: old, future and declared-stale reports never retain a green controller light', () => {
  const input = projection([
    item('live'), item('expired', { timestampUtc: at(-600001) }),
    item('future', { timestampUtc: at(1000) }),
    item('declared-stale', { freshness: 'STALE' }),
    item('unknown', { freshness: 'UNKNOWN' }),
    item('missing-clock', { timestampUtc: '' }),
    item('invalid-light', { trafficLight: 'UNKNOWN_GREEN' }),
  ]);
  const snapshot = structuredClone(input);
  const cards = overview(input, { nowMs: NOW }).controllers;
  assert.deepEqual(input, snapshot, 'pure read-only projection');
  assert.deepEqual(cards.map(card => card.trafficLight),
    ['AMBER', 'GREY', 'GREY', 'GREY', 'GREY', 'GREY', 'GREY']);
  assert.deepEqual(cards.map(card => card.truth),
    ['CURRENT', 'STALE', 'STALE', 'STALE', 'UNKNOWN', 'STALE', 'CURRENT']);
  assert.equal(cards[0].expiresAtUtc, at(-1000 + 600000));
  for (const card of cards.slice(1, 6)) assert.equal(card.expiresAtUtc, '');
});

test('Goal #2961: fresh negative and degraded lights survive while stale ones expire', () => {
  const cards = overview(projection([
    item('red', { trafficLight: 'RED' }),
    item('amber', { trafficLight: 'AMBER' }),
    item('lowercase', { trafficLight: 'green' }),
    item('expired-red', { trafficLight: 'RED', timestampUtc: at(-700000) }),
    item('fresh-unknown', { trafficLight: null }),
  ]), { nowMs: NOW }).controllers;
  assert.deepEqual(cards.map(card => card.trafficLight),
    ['RED', 'AMBER', 'AMBER', 'GREY', 'GREY']);
  assert.equal(cards[3].truth, 'STALE');
  assert.equal(cards[3].expiresAtUtc, '');
  assert.equal(cards[4].truth, 'CURRENT');
});

// A current system-wide signed gate-19 proof is not bound to an individual
// controller or worker and cannot promote its self-reported BUILDING light.
test('Goal #2002: a reusable gate-19 proof cannot certify controller BUILDING', () => {
  const proofRef = 'workspace:proof/gate-19';
  const input = projection([item('with-proof', { proofRefs: [proofRef] }),
    item('without-proof', { proofRefs: ['self-declared'] })]);
  input.goalBuildGateObservatory = {
    schemaVersion: 'stephanos.goal-build-gate-observatory.v1',
    diagnosticOnly: true, approvalAuthority: false, mergeAuthority: false,
    sourceHead: 'a'.repeat(40), observedAtUtc: at(-1000),
    observationStatus: 'EVIDENCE_AVAILABLE', gates: [
      ...[4, 5, 7, 6].map(id => ({ id, status: 'PASS',
        observedAtUtc: at(-1000), proofRef: 'workspace:proof/gate-' + id })),
      { id: 18, status: 'PASS', observedAtUtc: at(-1000), proofRef: 'workspace:proof/gate-18' },
      { id: 19, status: 'PASS', observedAtUtc: at(-1000), proofRef },
    ],
  };
  const output = overview(input, { nowMs: NOW });
  assert.deepEqual(output.controllers.map(c => c.trafficLight), ['AMBER', 'AMBER']);
  assert.equal(output.stages.find(stage => stage.id === 'pickup').state, 'PROVEN');
});

const signedGate = (id, status = 'PASS', extra = {}) => ({
  id, status, observedAtUtc: at(-1000), proofRef: 'workspace:proof/gate-' + id,
  ...extra,
});
const physicalStage = signedGates => {
  const input = projection([]);
  input.goalBuildGateObservatory = {
    schemaVersion: 'stephanos.goal-build-gate-observatory.v1',
    diagnosticOnly: true, approvalAuthority: false, mergeAuthority: false,
    sourceHead: 'a'.repeat(40), observedAtUtc: at(-1000),
    observationStatus: 'EVIDENCE_AVAILABLE', gates: signedGates,
  };
  return overview(input, { nowMs: NOW }).stages.find(stage => stage.id === 'pickup');
};

test('Goal #2002: signed pickup requires admission, SELECT, CLAIM and pickup proofs', () => {
  const validIds = [4, 5, 7, 6, 18, 19];
  const valid = validIds.map(id => signedGate(id));
  assert.equal(physicalStage(valid).state, 'PROVEN');
  assert.equal(physicalStage(valid).trafficLight, 'GREEN');
  for (const missing of validIds) {
    const stage = physicalStage(valid.filter(gate => gate.id !== missing));
    assert.notEqual(stage.state, 'PROVEN', 'missing required gate ' + missing);
    assert.notEqual(stage.trafficLight, 'GREEN', 'missing required gate ' + missing);
  }
});

test('Goal #2002: WAITING, STALE and proofless SELECT cannot certify pickup', () => {
  const valid = [4, 5, 7, 6, 18, 19].map(id => signedGate(id));
  for (const invalid of [
    { status: 'WAITING_FOR_PREREQUISITE' },
    { status: 'STALE' },
    { proofRef: '' },
    { observedAtUtc: at(1000) },
  ]) {
    const gates = valid.map(gate => gate.id === 6 ? signedGate(6, 'PASS', invalid) : gate);
    assert.notEqual(physicalStage(gates).trafficLight, 'GREEN',
      'unproven SELECT must not certify pickup: ' + JSON.stringify(invalid));
  }
  const failed = valid.map(gate => gate.id === 6 ? signedGate(6, 'FAIL') : gate);
  assert.notEqual(physicalStage(failed).trafficLight, 'GREEN');
});

test('Goal #2002: prerequisite proofRef aliasing cannot certify physical pickup', () => {
  const ids = [4, 5, 7, 6, 18, 19];
  const valid = ids.map(id => signedGate(id));
  assert.equal(physicalStage(valid).trafficLight, 'GREEN', 'distinct gate records remain accepted');
  const corruptions = [
    ['all prerequisites share one reference', valid.map(gate => ({ ...gate, proofRef: valid[0].proofRef }))],
    ['SELECT reuses CLAIM reference', valid.map(gate => gate.id === 6
      ? { ...gate, proofRef: valid[4].proofRef } : gate)],
    ['CLAIM reuses PICKUP reference', valid.map(gate => gate.id === 18
      ? { ...gate, proofRef: valid[5].proofRef } : gate)],
    ['whitespace disguise cannot make alias distinct', valid.map(gate => gate.id === 19
      ? { ...gate, proofRef: ' ' + valid[4].proofRef + ' ' } : gate)],
    ['object-shaped proof reference must fail closed', valid.map(gate => gate.id === 19
      ? { ...gate, proofRef: { value: 'workspace:proof/gate-19' } } : gate)],
  ];
  for (const [label, gates] of corruptions) {
    const stage = physicalStage(gates);
    assert.notEqual(stage.state, 'PROVEN', label);
    assert.notEqual(stage.trafficLight, 'GREEN', label);
  }
});

test('Goal #2002: duplicate signed gate identities cannot independently certify pickup', () => {
  const valid = [4, 5, 7, 6, 18, 19].map(id => signedGate(id));
  const duplicatedSelect = [...valid, signedGate(6)];
  assert.notEqual(physicalStage(duplicatedSelect).trafficLight, 'GREEN');
  assert.equal(physicalStage(valid).state, 'PROVEN');
});

const signedDisplayStages = gateRecords => overview({
  goalBuildGateObservatory: {
    schemaVersion: 'stephanos.goal-build-gate-observatory.v1',
    diagnosticOnly: true, approvalAuthority: false, mergeAuthority: false,
    sourceHead: 'a'.repeat(40), observedAtUtc: at(-1000),
    observationStatus: 'EVIDENCE_AVAILABLE', gates: gateRecords,
  },
}, { nowMs: NOW }).stages;

test('Goal #2961: non-pickup signed stage cards require own nonblank string proof refs', () => {
  const all = [4, 5, 7, 6, 18, 19, 20, 21, 22].map(id => signedGate(id));
  const accepted = signedDisplayStages(all);
  for (const name of ['admission', 'select', 'claim', 'pickup', 'edit', 'test', 'proof', 'merge']) {
    assert.equal(accepted.find(stage => stage.id === name).trafficLight, 'GREEN',
      'valid distinct proof stays eligible: ' + name);
  }
  for (const [id, invalid, stageNames] of [
    [4, {}, ['admission', 'pickup']],
    [6, [], ['select', 'pickup']],
    [18, '   ', ['claim', 'pickup']],
    [20, {}, ['edit', 'test']],
    [21, [], ['proof']],
    [22, '   ', ['merge']],
  ]) {
    const stages = signedDisplayStages(all.map(gate => gate.id === id
      ? { ...gate, proofRef: invalid } : gate));
    for (const name of stageNames) {
      assert.notEqual(stages.find(stage => stage.id === name).trafficLight, 'GREEN',
        'malformed reference must not make stage green: ' + id + '/' + name);
    }
  }
  const inherited = Object.assign(Object.create({ proofRef: 'workspace:proof/inherited' }), {
    id: 6, status: 'PASS', observedAtUtc: at(-1000),
  });
  assert.notEqual(signedDisplayStages(all.map(g => g.id === 6 ? inherited : g))
    .find(stage => stage.id === 'select').trafficLight, 'GREEN');
});

test('Goal #2961: conflicting signed gate identities or malformed veto cannot greenlight stages', () => {
  const all = [4, 5, 7, 6, 18, 19, 20, 21, 22].map(id => signedGate(id));
  for (const corrupted of [
    [...all, signedGate(6, 'FAIL', { proofRef: 'workspace:proof/veto' })],
    [...all, signedGate(6, 'PASS', { proofRef: 'workspace:proof/duplicated' })],
    [...all, signedGate(24, 'PASS')],
    [...all, { status: 'PASS', observedAtUtc: at(-1000), proofRef: 'workspace:proof/no-id' }],
    [...all, signedGate(8, 'FAIL', { proofRef: {} })],
  ]) {
    const stages = signedDisplayStages(corrupted);
    assert.ok(stages.every(stage => stage.trafficLight !== 'GREEN'),
      'inconsistent identities/unproven veto must not produce green');
  }
});

test('Goal #2961: review and merge display require a causally complete signed chain', () => {
  const ids = [4, 5, 7, 6, 18, 19, 20, 21, 22];
  const valid = ids.map(id => signedGate(id));
  for (const name of ['admission', 'select', 'claim', 'pickup', 'edit', 'test', 'proof', 'merge']) {
    assert.equal(signedDisplayStages(valid).find(stage => stage.id === name).trafficLight, 'GREEN',
      'complete distinct chain remains green: ' + name);
  }
  const wrong = [
    ['review without tested source', valid.filter(gate => gate.id !== 20), 'proof'],
    ['review after failed source', valid.map(g => g.id === 20 ? signedGate(20, 'FAIL') : g), 'proof'],
    ['merge without review', valid.filter(gate => gate.id !== 21), 'merge'],
    ['merge after failed review', valid.map(g => g.id === 21 ? signedGate(21, 'FAIL') : g), 'merge'],
    ['merge without admission', valid.filter(gate => gate.id !== 4), 'merge'],
    ['review with unproven SELECT', valid.map(g => g.id === 6
      ? signedGate(6, 'WAITING_FOR_PREREQUISITE') : g), 'proof'],
    ['merge with reused review receipt', valid.map(g => g.id === 22
      ? signedGate(22, 'PASS', { proofRef: 'workspace:proof/gate-21' }) : g), 'merge'],
  ];
  for (const [name, gates, stageName] of wrong) {
    const stage = signedDisplayStages(gates).find(row => row.id === stageName);
    assert.notEqual(stage.trafficLight, 'GREEN', name);
    assert.notEqual(stage.state, 'PROVEN', name);
  }
  const review = signedDisplayStages(valid.filter(g => g.id !== 20))
    .find(row => row.id === 'proof');
  assert.deepEqual(review.proofRefs, ['workspace:proof/gate-21'],
    'signed event remains visible without being credited as end-to-end progress');
});


test('Goal #2961: duplicate independent runtime service identity cannot promote conflicting health', () => {
  const service = (serviceId, trafficLight) => ({
    serviceId, sourceHead: 'a'.repeat(40),
    freshness: 'CURRENT', observedAtUtc: at(-1000), trafficLight,
  });
  const input = {
    captainsBridge: { runtimeHealth: { services: [
      service('mission-worker', 'GREEN'),
      service('mission-worker', 'RED'),
      service('backend', 'GREEN'),
      service('backend', 'RED'),
    ] } },
  };
  const statusRecords = [{
    statusId: 'stephanos-core-daemon-current',
    timestampUtc: at(-1000), sourceHead: 'a'.repeat(40),
    missionWorkerHealthy: true, backendHealthy: true,
  }];
  const original = structuredClone(input);
  const result = overview(input, { nowMs: NOW, statusRecords });
  assert.deepEqual(input, original, 'read-only adapter cannot rewrite conflicting input');
  for (const id of ['missionWorkerHealthy', 'backendHealthy']) {
    const entry = result.health.find(item => item.id === id);
    assert.equal(entry.state, 'UNKNOWN', id + ' must not choose a convenient first GREEN');
    assert.equal(entry.evidenceSource, 'AMBIGUOUS_INDEPENDENT_SERVICE_IDENTITY');
    assert.equal(entry.expiresAtUtc, '', 'an ambiguous source has no qualified expiry');
  }
  const onePerService = {
    captainsBridge: { runtimeHealth: { services: [
      service('mission-worker', 'GREEN'), service('backend', 'GREEN'),
    ] } },
  };
  const valid = overview(onePerService, { nowMs: NOW, statusRecords });
  for (const id of ['missionWorkerHealthy', 'backendHealthy']) {
    assert.equal(valid.health.find(item => item.id === id).state, 'HEALTHY',
      'unique fresh service observation remains available');
  }
});

test('Goal #2961: same-clock capacity conflicts cannot choose a convenient READY receipt', () => {
  const capacity = (state, receiptId, offset = -1000) => ({
    kind: 'stephanos.shared_workspace.status',
    statusId: 'sovereign-commander-build-capacity-current',
    participantId: 'stephanos-sovereign-builder-08', timestampUtc: at(offset),
    capacityReceipt: {
      schemaVersion: 'stephanos.build-lane-capacity-receipt.v1',
      route: 'SOVEREIGN_COMMANDER', repository: 'Cheekyfellastef/stephan-os',
      workerId: 'stephanos-sovereign-builder-08', state, receiptId,
      queueDepth: 0, observedAtUtc: at(offset), expiresAtUtc: at(offset + 240000),
    },
  });
  const ready = capacity('READY', 'capacity-ready');
  const blocked = capacity('BLOCKED', 'capacity-blocked');
  const differentReady = capacity('READY', 'another-independent-receipt');
  const scenarios = [
    [ready, blocked], [blocked, ready], [ready, differentReady],
    [ready, blocked, ready], [ready, differentReady, blocked],
  ];
  for (const records of scenarios) {
    const originals = structuredClone(records);
    const result = overview({}, { nowMs: NOW, statusRecords: records });
    assert.deepEqual(records, originals, 'projection must not change source receipts');
    assert.equal(result.octopusFleet.capacityBuilderCount, 1);
    const [builder] = result.octopusFleet.capacityBuilders;
    assert.equal(builder.state, 'UNKNOWN', 'equal-clock disagreement must fail closed');
    assert.equal(builder.trafficLight, 'GREY');
    assert.equal(builder.expiresAtUtc, '');
    assert.equal(builder.receiptId, '');
    assert.equal(builder.physicalBuildProven, false);
  }
  const identical = overview({}, { nowMs: NOW, statusRecords: [ready, structuredClone(ready)] });
  assert.equal(identical.octopusFleet.capacityBuilders[0].state, 'READY',
    'exact duplicate publication does not invent a conflicting receipt');
  for (const records of [
    [capacity('BLOCKED', 'older', -2000), ready],
    [ready, capacity('BLOCKED', 'older', -2000)],
  ]) {
    assert.equal(overview({}, { nowMs: NOW, statusRecords: records })
      .octopusFleet.capacityBuilders[0].state, 'READY',
      'unique newer valid receipt wins over genuinely older observations');
  }
});

test('Goal #2961: same-clock canonical watchdog identities cannot promote healthy worker telemetry', () => {
  const head = 'a'.repeat(40);
  const watchdog = (healthy, offset = -1000) => ({
    statusId: 'battle-bridge-worker-watchdog-current', timestampUtc: at(offset),
    status: healthy ? 'WORKER_WATCHDOG_HEALTHY' : 'WORKER_WATCHDOG_BLOCKED',
    classification: healthy ? 'WORKER_WATCHDOG_HEALTHY' : 'WORKER_WATCHDOG_BLOCKED',
    finalAssessment: {
      finalVerdict: healthy ? 'WORKER_WATCHDOG_HEALTHY' : 'WORKER_WATCHDOG_BLOCKED',
      healthy, processHealthy: true, heartbeatFresh: true,
      heartbeatPidMatchesProcess: true, processLaunchIdentityValid: true,
      heartbeatLaunchIdentityMatchesProcess: true, repositoryFromCanonicalMain: true,
      heartbeatMatchesCanonicalRepositoryHead: true, remoteMainHeadProven: true,
      sourceHead: head, canonicalRepositoryHead: head, remoteMainHead: head,
    },
  });
  const good = watchdog(true);
  const bad = watchdog(false);
  const health = records => overview({}, { nowMs: NOW, statusRecords: records })
    .health.find(item => item.id === 'missionWorkerHealthy');
  assert.equal(health([good]).state, 'HEALTHY', 'unique authenticated positive is retained');
  assert.equal(health([bad]).state, 'UNKNOWN', 'unique negative cannot be promoted');
  for (const records of [[good, bad], [bad, good], [good, structuredClone(good)]]) {
    const before = structuredClone(records);
    const result = health(records);
    assert.equal(result.state, 'UNKNOWN', 'same-clock identity tie must fail closed');
    assert.equal(result.expiresAtUtc, '', 'ambiguous latest cannot have a current expiry');
    assert.deepEqual(records, before, 'read-only projection cannot mutate canonical records');
  }
  assert.equal(health([watchdog(false, -2000), good]).state, 'HEALTHY',
    'a unique genuinely newer positive supersedes older negative');
  assert.equal(health([watchdog(true, -2000), bad]).state, 'UNKNOWN',
    'a uniquely newer negative supersedes older positive');
  assert.equal(health([bad, watchdog(true, 1000)]).state, 'UNKNOWN',
    'future-dated newest identity cannot renew an older observation');
});


test('Goal #2961: newer canonical negatives veto older healthy Core aggregates without granting work', () => {
  const head = 'a'.repeat(40);
  const otherHead = 'b'.repeat(40);
  const core = (ago = -90000) => ({
    statusId: 'stephanos-core-daemon-current', timestampUtc: at(ago),
    sourceHead: head, missionWorkerHealthy: true, backendHealthy: true, daemonHealthy: true,
  });
  const watchdog = (ago = -1000, sourceHead = head, healthy = false) => ({
    statusId: 'battle-bridge-worker-watchdog-current', timestampUtc: at(ago),
    finalAssessment: { healthy, sourceHead },
  });
  const refresh = (ago = -1000, sourceHead = head, afterHead = head,
    ok = false, safeRefreshesCompleted = false) => ({
    statusId: 'post-sync-runtime-refresh-current', timestampUtc: at(ago),
    safeRefreshesCompleted, afterHead,
    resultTargets: [{ targetId: 'stephanos-backend-8787', ok, sourceHead }],
  });
  const scenarios = [
    ['newer worker negative', [core(), watchdog()],
      { missionWorkerHealthy: 'UNKNOWN', backendHealthy: 'HEALTHY' }],
    ['newer backend negative', [core(), refresh()],
      { missionWorkerHealthy: 'HEALTHY', backendHealthy: 'UNKNOWN' }],
    ['two newer negatives', [core(), watchdog(), refresh()],
      { missionWorkerHealthy: 'UNKNOWN', backendHealthy: 'UNKNOWN' }],
    ['healthy Core alone', [core()],
      { missionWorkerHealthy: 'HEALTHY', backendHealthy: 'HEALTHY' }],
    ['older negative watchdog', [core(-20000), watchdog(-40000)],
      { missionWorkerHealthy: 'HEALTHY' }],
    ['foreign-head negative watchdog', [core(), watchdog(-1000, otherHead)],
      { missionWorkerHealthy: 'HEALTHY' }],
    ['foreign-head negative backend', [core(), refresh(-1000, head, otherHead)],
      { backendHealthy: 'HEALTHY' }],
    ['stale canonical negative', [core(-190000), watchdog(-160000)],
      { missionWorkerHealthy: 'HEALTHY' }],
    ['newer positive but unqualified watchdog', [core(), watchdog(-1000, head, true)],
      { missionWorkerHealthy: 'HEALTHY' }],
    ['backend target positive with refresh negative', [core(), refresh(-1000, head, head, true)],
      { backendHealthy: 'HEALTHY' }],
    ['co-timed negative is not a newer veto', [core(-1000), watchdog(-1000)],
      { missionWorkerHealthy: 'HEALTHY' }],
  ];
  for (const [label, records, expected] of scenarios) {
    const untouched = structuredClone(records);
    const health = overview({}, { nowMs: NOW, statusRecords: records }).health;
    for (const [id, state] of Object.entries(expected)) {
      const observation = health.find(item => item.id === id);
      assert.equal(observation.state, state, label + ': ' + id);
      if (state === 'UNKNOWN') {
        assert.equal(observation.evidenceSource, 'NEWER_CANONICAL_NEGATIVE_VETO', label);
        assert.equal(observation.expiresAtUtc, '', 'veto must not invent a proof expiry');
      }
    }
    assert.deepEqual(records, untouched, 'read-only projection cannot change native receipts');
  }
});

test('Goal #2961: independent GREEN cannot mask a newer canonical negative', () => {
  const head = 'a'.repeat(40);
  const foreign = 'b'.repeat(40);
  const core = {
    statusId: 'stephanos-core-daemon-current', timestampUtc: at(-90000),
    sourceHead: head, missionWorkerHealthy: true, backendHealthy: true,
  };
  const service = (id, observed = -45000, sourceHead = head, trafficLight = 'GREEN') => ({
    serviceId: id, freshness: 'CURRENT', observedAtUtc: at(observed),
    sourceHead, trafficLight,
  });
  const watchdog = (observed = -1000, sourceHead = head) => ({
    statusId: 'battle-bridge-worker-watchdog-current', timestampUtc: at(observed),
    finalAssessment: { healthy: false, sourceHead },
  });
  const refresh = (observed = -1000, sourceHead = head, afterHead = head) => ({
    statusId: 'post-sync-runtime-refresh-current', timestampUtc: at(observed),
    safeRefreshesCompleted: false, afterHead,
    resultTargets: [{ targetId: 'stephanos-backend-8787', ok: false, sourceHead }],
  });
  const cases = [
    ['later worker negative', service('mission-worker'), [core, watchdog()],
      'missionWorkerHealthy', 'UNKNOWN'],
    ['co-timed worker negative', service('mission-worker'), [core, watchdog(-45000)],
      'missionWorkerHealthy', 'UNKNOWN'],
    ['later backend negative', service('backend'), [core, refresh()],
      'backendHealthy', 'UNKNOWN'],
    ['co-timed backend negative', service('backend'), [core, refresh(-45000)],
      'backendHealthy', 'UNKNOWN'],
    ['older worker negative', service('mission-worker', -1000), [core, watchdog(-45000)],
      'missionWorkerHealthy', 'HEALTHY'],
    ['older backend negative', service('backend', -1000), [core, refresh(-45000)],
      'backendHealthy', 'HEALTHY'],
    ['foreign worker head', service('mission-worker'), [core, watchdog(-1000, foreign)],
      'missionWorkerHealthy', 'UNKNOWN'],
    ['foreign backend head', service('backend'), [core, refresh(-1000, foreign, foreign)],
      'backendHealthy', 'UNKNOWN'],
    ['stale native negative', service('mission-worker'), [core, watchdog(-180000)],
      'missionWorkerHealthy', 'HEALTHY'],
    ['future native negative', service('mission-worker'), [core, watchdog(1000)],
      'missionWorkerHealthy', 'HEALTHY'],
    ['newer independent positive', service('mission-worker', -1000), [core, watchdog(-45000)],
      'missionWorkerHealthy', 'HEALTHY'],
    ['independent RED remains RED', service('mission-worker', -45000, head, 'RED'),
      [core, watchdog()], 'missionWorkerHealthy', 'UNHEALTHY'],
    ['no native negative', service('mission-worker'), [core],
      'missionWorkerHealthy', 'HEALTHY'],
    ['source-head fallback from Core', service('mission-worker', -45000, ''),
      [core, watchdog()], 'missionWorkerHealthy', 'UNKNOWN'],
  ];
  for (const [label, independent, statusRecords, id, expectedState] of cases) {
    const projection = { captainsBridge: { runtimeHealth: { services: [independent] } } };
    const originalProjection = structuredClone(projection);
    const originalRecords = structuredClone(statusRecords);
    const actual = overview(projection, { nowMs: NOW, statusRecords }).health.find(row => row.id === id);
    assert.equal(actual.state, expectedState, label);
    if (expectedState === 'UNKNOWN') {
      const identityConflict = ['foreign worker head', 'foreign backend head',
        'source-head fallback from Core'].includes(label);
      assert.equal(actual.evidenceSource, identityConflict
        ? 'UNBOUND_OR_CONFLICTING_INDEPENDENT_SERVICE_HEAD'
        : 'NEWER_CANONICAL_NEGATIVE_VETO', label);
      assert.equal(actual.expiresAtUtc, '', 'no contradictory proof expiry: ' + label);
    }
    assert.deepEqual(projection, originalProjection, 'pure projection: ' + label);
    assert.deepEqual(statusRecords, originalRecords, 'canonical receipts unchanged: ' + label);
  }
});

test('Goal #2961: independent GREEN source-head integrity refuses unbound or conflicting producers', () => {
  const head = 'a'.repeat(40), other = 'b'.repeat(40);
  const core = sourceHead => ({ statusId: 'stephanos-core-daemon-current', sourceHead,
    timestampUtc: at(-90000), missionWorkerHealthy: true, backendHealthy: true });
  const service = (id, sourceHead, trafficLight = 'GREEN', clock = -45000) => ({
    serviceId: id, sourceHead, trafficLight, freshness: 'CURRENT', observedAtUtc: at(clock),
  });
  const watchdog = (sourceHead = head, clock = -1000) => ({
    statusId: 'battle-bridge-worker-watchdog-current', timestampUtc: at(clock),
    finalAssessment: { sourceHead, healthy: false },
  });
  const refresh = (sourceHead = head, clock = -1000) => ({
    statusId: 'post-sync-runtime-refresh-current', timestampUtc: at(clock),
    safeRefreshesCompleted: false, afterHead: sourceHead,
    resultTargets: [{ targetId: 'stephanos-backend-8787', ok: false, sourceHead }],
  });
  const missing = service('mission-worker', head); delete missing.sourceHead;
  const inherited = Object.assign(Object.create({ sourceHead: head }), {
    serviceId: 'mission-worker', trafficLight: 'GREEN',
    freshness: 'CURRENT', observedAtUtc: at(-45000),
  });
  const cases = [
    ['valid worker', service('mission-worker', head), [core(head)], 'missionWorkerHealthy', 'HEALTHY'],
    ['blank worker', service('mission-worker', ''), [core(head)], 'missionWorkerHealthy', 'UNKNOWN'],
    ['missing own head', missing, [core(head)], 'missionWorkerHealthy', 'UNKNOWN'],
    ['inherited head', inherited, [core(head)], 'missionWorkerHealthy', 'UNKNOWN'],
    ['malformed head', service('mission-worker', 'a'.repeat(39)), [core(head)], 'missionWorkerHealthy', 'UNKNOWN'],
    ['foreign Core head', service('mission-worker', other), [core(head)], 'missionWorkerHealthy', 'UNKNOWN'],
    ['foreign native head', service('mission-worker', other), [watchdog()], 'missionWorkerHealthy', 'UNKNOWN'],
    ['native lacks head', service('mission-worker', head), [watchdog('')], 'missionWorkerHealthy', 'UNKNOWN'],
    ['canonical negative veto', service('mission-worker', head), [core(head), watchdog()], 'missionWorkerHealthy', 'UNKNOWN'],
    ['older native negative', service('mission-worker', head, 'GREEN', -1000), [core(head), watchdog(head, -45000)], 'missionWorkerHealthy', 'HEALTHY'],
    ['stale foreign native', service('mission-worker', head), [core(head), watchdog(other, -200000)], 'missionWorkerHealthy', 'HEALTHY'],
    ['no competing observer', service('mission-worker', head), [], 'missionWorkerHealthy', 'HEALTHY'],
    ['RED remains negative', service('mission-worker', '', 'RED'), [core(head)], 'missionWorkerHealthy', 'UNHEALTHY'],
    ['AMBER remains degraded', service('mission-worker', '', 'AMBER'), [core(head)], 'missionWorkerHealthy', 'DEGRADED'],
    ['blank backend', service('backend', ''), [core(head)], 'backendHealthy', 'UNKNOWN'],
    ['conflicting backend native', service('backend', other), [refresh()], 'backendHealthy', 'UNKNOWN'],
    ['backend negative veto', service('backend', head), [core(head), refresh()], 'backendHealthy', 'UNKNOWN'],
    ['older backend native', service('backend', head, 'GREEN', -1000), [core(head), refresh(head, -45000)], 'backendHealthy', 'HEALTHY'],
  ];
  for (const [label, independent, statusRecords, id, expected] of cases) {
    const input = { captainsBridge: { runtimeHealth: { services: [independent] } } };
    const snapshot = structuredClone(statusRecords);
    const actual = overview(input, { nowMs: NOW, statusRecords }).health.find(row => row.id === id);
    assert.equal(actual.state, expected, label);
    if (expected === 'UNKNOWN') {
      assert.equal(actual.observedAtUtc, '', label + ': no fabricated time');
      assert.equal(actual.expiresAtUtc, '', label + ': no fabricated expiry');
    }
    assert.deepEqual(statusRecords, snapshot, label + ': native receipts unchanged');
  }
});

test('Goal #2961: current Core head vetoes old-head canonical-native GREEN', () => {
  const A = 'a'.repeat(40), B = 'b'.repeat(40);
  const core = (sourceHead, offset, healthy = false) => ({
    statusId: 'stephanos-core-daemon-current', timestampUtc: at(offset),
    sourceHead, daemonHealthy: true, missionWorkerHealthy: healthy, backendHealthy: healthy,
  });
  const worker = (sourceHead, offset) => ({
    statusId: 'battle-bridge-worker-watchdog-current', timestampUtc: at(offset),
    status: 'WORKER_WATCHDOG_HEALTHY', classification: 'WORKER_WATCHDOG_HEALTHY',
    finalAssessment: {
      finalVerdict: 'WORKER_WATCHDOG_HEALTHY', healthy: true, processHealthy: true,
      heartbeatFresh: true, heartbeatPidMatchesProcess: true, processLaunchIdentityValid: true,
      heartbeatLaunchIdentityMatchesProcess: true, repositoryFromCanonicalMain: true,
      heartbeatMatchesCanonicalRepositoryHead: true, remoteMainHeadProven: true,
      sourceHead, canonicalRepositoryHead: sourceHead, remoteMainHead: sourceHead,
    },
  });
  const backend = (sourceHead, offset) => ({
    statusId: 'post-sync-runtime-refresh-current', timestampUtc: at(offset),
    safeRefreshesCompleted: true, unknownPathCount: 0, unsafePathCount: 0, afterHead: sourceHead,
    resultTargets: [{ targetId: 'stephanos-backend-8787', ok: true, exactHeadProofOk: true,
      canonicalActionVerified: true, unrelatedTasksChanged: false,
      proofKind: 'canonical-target-readback', blocker: '', sourceHead }],
  });
  const cases = [
    ['old worker and newer negative Core','missionWorkerHealthy',[worker(A,-90000),core(B,-1000)],'UNKNOWN'],
    ['old backend and newer negative Core','backendHealthy',[backend(A,-90000),core(B,-1000)],'UNKNOWN'],
    ['old worker and newer positive Core','missionWorkerHealthy',[worker(A,-90000),core(B,-1000,true)],'UNKNOWN'],
    ['old backend and newer positive Core','backendHealthy',[backend(A,-90000),core(B,-1000,true)],'UNKNOWN'],
    ['old worker and co-timed conflicting Core','missionWorkerHealthy',[worker(A,-1000),core(B,-1000)],'UNKNOWN'],
    ['old backend and co-timed conflicting Core','backendHealthy',[backend(A,-1000),core(B,-1000)],'UNKNOWN'],
    ['new worker after older Core','missionWorkerHealthy',[core(A,-90000),worker(B,-1000)],'HEALTHY'],
    ['new backend after older Core','backendHealthy',[core(A,-90000),backend(B,-1000)],'HEALTHY'],
    ['same-head worker','missionWorkerHealthy',[worker(A,-90000),core(A,-1000)],'HEALTHY'],
    ['same-head backend','backendHealthy',[backend(A,-90000),core(A,-1000)],'HEALTHY'],
    ['worker with no Core','missionWorkerHealthy',[worker(A,-90000)],'HEALTHY'],
    ['backend with no Core','backendHealthy',[backend(A,-90000)],'HEALTHY'],
    ['worker with stale foreign Core','missionWorkerHealthy',[core(B,-700000),worker(A,-1000)],'HEALTHY'],
    ['backend with stale foreign Core','backendHealthy',[core(B,-700000),backend(A,-1000)],'HEALTHY'],
  ];
  for (const [label, field, records, expected] of cases) for (const ordered of [records,[...records].reverse()]) {
    const snapshot = structuredClone(ordered);
    const result = overview({}, { nowMs: NOW, statusRecords: ordered });
    const observation = result.health.find(row => row.id === field);
    assert.equal(observation.state, expected, label);
    if (expected === 'UNKNOWN') {
      assert.equal(observation.evidenceSource, 'NEWER_CORE_SOURCE_HEAD_VETO', label);
      assert.equal(observation.observedAtUtc, '', label + ' has no credited timestamp');
      assert.equal(observation.expiresAtUtc, '', label + ' has no proof expiry');
    }
    assert.equal(result.buildingGoalCount, null, 'service health is never BUILD proof');
    assert.deepEqual(ordered, snapshot, label + ' input immutable');
  }
});
