import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBattleBridgeOutboundBeacon,
  projectPostSyncRefreshBeaconFacts,
  buildBattleBridgeOutboundBeaconMaterialBody,
} from './battle-bridge-outbound-health-beacon-core.mjs';
import { buildBattleBridgeOutboundBeacon as buildCompleteBeacon, buildBattleBridgeOutboundBeaconBody } from './battle-bridge-outbound-health-beacon.mjs';
import { projectSyncAndRefreshStatus } from './battle-bridge-github-sync-and-refresh.mjs';
import {
  POST_SYNC_REFRESH_CLASSIFICATIONS,
  POST_SYNC_REFRESH_TARGETS,
  buildPostSyncRefreshProjection,
  classifyPostSyncRefresh,
  reducePostSyncTargetFailureHistory,
} from '../shared/agents/postSyncRuntimeRefreshCoordinator.mjs';

const HEAD = 'a'.repeat(40);
const OTHER_HEAD = 'b'.repeat(40);
const NOW = new Date('2026-10-30T20:33:22.997Z');
const TARGET = POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER;
const UI = POST_SYNC_REFRESH_TARGETS.UI_4173;

function record(overrides = {}) {
  return {
    timestampUtc: NOW.toISOString(),
    afterHead: HEAD,
    classification: 'REFRESH_READY',
    targetIds: [TARGET],
    resultTargets: [],
    ...overrides,
  };
}

function beaconSurface(input) {
  return buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD,
    now: NOW,
    statusRecords: { postSyncRefresh: input },
  }).surfaces.find((surface) => surface.id === 'postSyncRefresh');
}

function targetFailureHistory(overrides = {}) {
  return reducePostSyncTargetFailureHistory(null, { expectedSourceHead: HEAD,
    observedAtUtc: new Date(NOW.getTime() - 10_000).toISOString(), nowMs: NOW.getTime(),
    targetId: TARGET, failureKind: 'RESULT_UNPROVEN',
    result: { ok: false, exactHeadProofOk: true, sourceHead: HEAD,
      blocker: 'SOVEREIGN_COMMANDER_MAINTENANCE_QUIESCENCE_UNPROVEN' }, ...overrides });
}

test('complete beacon exposes historical target refusal without inventing a current attempt result', () => {
  const history = targetFailureHistory();
  const input = record({ targetFailureHistory: { ...history, stdout: 'PRIVATE_TOP_LEVEL',
    failures: [{ ...history.failures[0], stderr: 'PRIVATE_CHILD_ERROR', path: 'PRIVATE_PATH' }] } });
  const beacon = buildCompleteBeacon({ sourceHead: HEAD, now: NOW, statusRecords: { postSyncRefresh: input } });
  const runtime = beacon.surfaces.find(row => row.id === 'postSyncRefresh').runtimeRefresh;
  assert.equal(runtime.classification, 'REFRESH_READY');
  assert.deepEqual(runtime.resultTargets, []);
  assert.equal(runtime.targetFailureHistory.evidenceState, 'HISTORICAL');
  assert.equal(runtime.targetFailureHistory.expectedSourceHead, HEAD);
  assert.equal(runtime.targetFailureHistory.sourceHeadMatchesExpected, true);
  assert.equal(runtime.targetFailureHistory.failures[0].observedAtUtc, history.failures[0].observedAtUtc);
  assert.equal(runtime.targetFailureHistory.failures[0].ageMs, 10_000);
  assert.equal(runtime.targetFailureHistory.failures[0].historical, true);
  assert.equal(runtime.targetFailureHistory.failures[0].diagnosticOnly, true);
  assert.equal(buildBattleBridgeOutboundBeaconBody(beacon).includes('PRIVATE_'), false);
});

test('public target history rejects ambiguous lists and preserves mismatched original head truth', () => {
  const history = targetFailureHistory();
  const row = history.failures[0];
  for (const invalid of [
    { ...history, expectedSourceHead: [HEAD] },
    { ...history, failures: [row, row] },
    { ...history, failures: Array(8).fill(row) },
    { ...history, failures: [{ ...row, blocker: 'PRIVATE_RAW_UPPERCASE' }] },
    { ...history, failures: [{ ...row, observedAtUtc: new Date(NOW.getTime() + 60_001).toISOString() }] },
  ]) {
    const projected = beaconSurface(record({ targetFailureHistory: invalid })).runtimeRefresh.targetFailureHistory;
    assert.equal(projected.evidenceState, 'INVALID');
    assert.deepEqual(projected.failures, []);
    assert.equal(JSON.stringify(projected).includes('PRIVATE_'), false);
  }
  const mismatch = beaconSurface(record({ targetFailureHistory: { ...history, expectedSourceHead: OTHER_HEAD } })).runtimeRefresh.targetFailureHistory;
  assert.equal(mismatch.evidenceState, 'HEAD_MISMATCH');
  assert.equal(mismatch.expectedSourceHead, OTHER_HEAD);
  assert.equal(mismatch.sourceHeadMatchesExpected, false);
  assert.equal(mismatch.failures[0].observedAtUtc, row.observedAtUtc);
});

test('history age alone is immaterial while exact target retirement changes beacon publication', () => {
  const history = targetFailureHistory();
  const build = (now, targetFailureHistory) => buildCompleteBeacon({ sourceHead: HEAD, now,
    statusRecords: { postSyncRefresh: record({ targetFailureHistory }) } });
  const material = (now, history) => buildBattleBridgeOutboundBeaconMaterialBody(buildBattleBridgeOutboundBeaconBody(build(now, history)));
  const next = new Date(NOW.getTime() + 60_000);
  assert.equal(material(NOW, history), material(next, history));
  const retired = reducePostSyncTargetFailureHistory(history, { expectedSourceHead: HEAD,
    observedAtUtc: next.toISOString(), nowMs: next.getTime(), targetId: TARGET,
    result: { ok: true, exactHeadProofOk: true, sourceHead: HEAD } });
  assert.notEqual(material(next, history), material(next, retired));
});

test('a real coordinator plan remains REFRESH_READY with no completed target', () => {
  const plan = buildPostSyncRefreshProjection({
    classification: POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY,
    plan: { targetIds: [UI, TARGET] },
    results: [],
  }, { beforeHead: OTHER_HEAD, afterHead: HEAD });
  const surface = beaconSurface({ ...plan, timestampUtc: NOW.toISOString() });

  assert.equal(surface.state, 'REFRESH_READY');
  assert.equal(surface.runtimeRefresh.classification, 'REFRESH_READY');
  assert.equal(surface.runtimeRefresh.evidenceState, 'OBSERVED');
  assert.deepEqual(surface.runtimeRefresh.targetIds, [UI, TARGET]);
  assert.deepEqual(surface.runtimeRefresh.resultTargets, []);
  assert.equal('complete' in surface.runtimeRefresh, false);
  assert.equal('freshProcessLoaded' in surface.runtimeRefresh, false);
});

test('complete beacon retains the actual pending Git range and counts without publishing paths or granting execution', () => {
  const plan = classifyPostSyncRefresh([
    'scripts/unmapped-source-fixture.mjs',
    'scripts/battle-bridge-outbound-health-beacon-core.mjs',
    'docs/refresh-fixture.md',
  ]);
  const projection = buildPostSyncRefreshProjection({ classification: plan.classification, plan, results: [] },
    { beforeHead: OTHER_HEAD, afterHead: HEAD });
  const beacon = buildCompleteBeacon({ sourceHead: HEAD, now: NOW, statusRecords: {
    postSyncRefresh: { ...projection, timestampUtc: NOW.toISOString(),
      internal: { unknownPaths: ['C:/Users/PRIVATE_OPERATOR/PRIVATE_SOURCE'] },
      paths: ['PRIVATE_PATH'], stdout: 'PRIVATE_CONTENT', executionAuthority: true },
  } });
  const runtime = beacon.surfaces.find(row => row.id === 'postSyncRefresh').runtimeRefresh;
  assert.equal(runtime.beforeHead, OTHER_HEAD);
  assert.equal(runtime.afterHead, HEAD);
  assert.equal(runtime.afterHeadMatchesExpected, true);
  assert.equal(runtime.changedPathCount, 3);
  assert.equal(runtime.noRuntimePathCount, 1);
  assert.equal(runtime.openClawPathCount, 0);
  assert.equal(runtime.unknownPathCount, 1);
  assert.equal(runtime.unsafePathCount, 0);
  assert.equal(runtime.classification, 'BLOCKED_UNCLASSIFIED_RUNTIME_PATH');
  assert.equal(runtime.evidenceState, 'OBSERVED');
  assert.deepEqual(runtime.targetIds, plan.targetIds);
  assert.deepEqual(runtime.resultTargets, []);
  assert.equal('executionAuthority' in runtime, false);
  assert.equal(beacon.processRestartAllowed, false);
  assert.equal(beacon.sourceMutationAllowed, false);
  const body = buildBattleBridgeOutboundBeaconBody(beacon);
  assert.doesNotMatch(body, /PRIVATE_|unmapped-source-fixture|refresh-fixture/);
});

test('pending range heads require complete SHA strings and preserve independent expected-head truth', () => {
  const input = record({ beforeHead: OTHER_HEAD.toUpperCase(), afterHead: HEAD.toUpperCase() });
  const accepted = projectPostSyncRefreshBeaconFacts(input, HEAD.toUpperCase());
  assert.equal(accepted.beforeHead, OTHER_HEAD);
  assert.equal(accepted.afterHead, HEAD);
  assert.equal(accepted.afterHeadMatchesExpected, true);
  assert.equal(projectPostSyncRefreshBeaconFacts(input, OTHER_HEAD).afterHeadMatchesExpected, false);
  for (const value of [undefined, null, '', ` ${HEAD}`, `${HEAD} `, `${HEAD}\n`, `${HEAD}\r`, `${HEAD}\r\n`, `${HEAD}/PRIVATE_PATH`,
    HEAD.slice(1), `${HEAD}a`, [HEAD], { head: HEAD }, new String(HEAD), 1]) {
    const before = projectPostSyncRefreshBeaconFacts(record({ beforeHead: value }), HEAD);
    assert.equal(before.beforeHead, '');
    assert.equal(before.afterHead, HEAD);
    const after = projectPostSyncRefreshBeaconFacts(record({ beforeHead: OTHER_HEAD, afterHead: value }), HEAD);
    assert.equal(after.beforeHead, OTHER_HEAD);
    assert.equal(after.afterHead, '');
    assert.equal(after.afterHeadMatchesExpected, null);
    assert.equal(projectPostSyncRefreshBeaconFacts(input, value).afterHeadMatchesExpected, null);
  }
});

test('missing pending range fields stay unknown without changing legacy target evidence', () => {
  const fields = ['changedPathCount', 'noRuntimePathCount', 'openClawPathCount', 'unknownPathCount', 'unsafePathCount'];
  const missing = projectPostSyncRefreshBeaconFacts(null, HEAD);
  assert.equal(missing.beforeHead, '');
  assert.equal(missing.afterHead, '');
  assert.equal(missing.afterHeadMatchesExpected, null);
  assert.equal(missing.evidenceState, 'MISSING');
  const legacy = projectPostSyncRefreshBeaconFacts(record(), HEAD);
  assert.equal(legacy.beforeHead, '');
  assert.equal(legacy.afterHead, HEAD);
  assert.equal(legacy.afterHeadMatchesExpected, true);
  assert.equal(legacy.evidenceState, 'OBSERVED');
  assert.deepEqual(legacy.targetIds, [TARGET]);
  assert.deepEqual(legacy.resultTargets, []);
  for (const field of fields) {
    assert.equal(missing[field], null, field);
    assert.equal(legacy[field], null, field);
  }
});

test('pending path counts accept only nonnegative safe integers without coercion', () => {
  const fields = ['changedPathCount', 'noRuntimePathCount', 'openClawPathCount', 'unknownPathCount', 'unsafePathCount'];
  for (const field of fields) {
    for (const value of [0, 1, 4000]) {
      assert.equal(projectPostSyncRefreshBeaconFacts(record({ [field]: value }), HEAD)[field], value, field);
    }
    for (const value of [undefined, null, '', '0', '12', false, true, {}, [], [1], new Number(1),
      -1, 0.5, Infinity, -Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      const runtime = projectPostSyncRefreshBeaconFacts(record({ [field]: value }), HEAD);
      assert.equal(runtime[field], null, field);
      assert.equal(runtime.classification, 'REFRESH_READY');
      assert.deepEqual(runtime.targetIds, [TARGET]);
      assert.deepEqual(runtime.resultTargets, []);
    }
  }
});

test('Spatial metadata remains bounded and malformed values cannot produce public completion', () => {
  const success = { classification: 'REFRESH_COMPLETE', phase: 'complete', finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_PASS' };
  for (const fields of [
    ...['true', 1, null, {}, []].map(spatialAdoptionRequired => ({ spatialAdoptionRequired })),
    ...[-1, 3, 0.5, '0', null, Infinity].map(spatialAdoptionPathCount => ({ spatialAdoptionRequired: false, spatialAdoptionPathCount })),
    { spatialAdoptionRequired: false, spatialAdoptionPathCount: 1 },
    { spatialAdoptionPathCount: 1 },
    { classification: undefined },
    { classification: 'UNRECOGNIZED_REFRESH_CLASSIFICATION' },
  ]) {
    const surface = beaconSurface(record({ ...success, ...fields }));
    assert.equal(surface.runtimeRefresh.evidenceState, 'INVALID', JSON.stringify(fields));
    assert.equal(surface.state, 'UNPROVEN', JSON.stringify(fields));
    assert.equal(surface.blocker, 'POST_SYNC_REFRESH_EVIDENCE_INVALID');
    assert.equal(surface.rawState, String(fields.classification ?? (Object.hasOwn(fields, 'classification')
      ? success.finalVerdict : success.classification)).toUpperCase());
  }
  const legacy = beaconSurface(record(success));
  assert.equal(legacy.state, 'REFRESH_COMPLETE');
  assert.equal(legacy.runtimeRefresh.evidenceState, 'OBSERVED');
  assert.equal(legacy.runtimeRefresh.spatialAdoptionRequired, null);
  assert.equal(legacy.runtimeRefresh.spatialAdoptionPathCount, null);
});

test('Spatial adoption hold stays visible after net revert and contradicts every success signal', () => {
  const hold = { classification: 'BLOCKED_SPATIAL_ADOPTION_REQUIRED', phase: 'blocked',
    finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_BLOCKED', blocker: 'SPATIAL_RESIDENT_ADOPTION_UNPROVEN',
    spatialAdoptionRequired: true, spatialAdoptionPathCount: 0, exactHeadProofOk: false, ok: false };
  for (const spatialAdoptionPathCount of [0, 1, 2]) {
    const surface = beaconSurface(record({ ...hold, spatialAdoptionPathCount }));
    assert.equal(surface.state, 'BLOCKED_SPATIAL_ADOPTION_REQUIRED');
    assert.equal(surface.runtimeRefresh.evidenceState, 'OBSERVED');
    assert.equal(surface.runtimeRefresh.spatialAdoptionRequired, true);
    assert.equal(surface.runtimeRefresh.spatialAdoptionPathCount, spatialAdoptionPathCount);
    for (const contradiction of [
      { classification: 'REFRESH_COMPLETE' }, { classification: 'NO_RUNTIME_REFRESH_REQUIRED' },
      { phase: 'complete' }, { finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_PASS' }, { ok: true }, { exactHeadProofOk: true },
    ]) {
      const invalid = beaconSurface(record({ ...hold, spatialAdoptionPathCount, ...contradiction }));
      assert.equal(invalid.runtimeRefresh.evidenceState, 'INVALID');
      assert.equal(invalid.state, 'UNPROVEN');
      assert.equal(invalid.blocker, 'POST_SYNC_REFRESH_EVIDENCE_INVALID');
    }
  }
  for (const spatialAdoptionRequired of [false, undefined]) {
    const invalid = beaconSurface(record({ ...hold, spatialAdoptionRequired }));
    assert.equal(invalid.runtimeRefresh.evidenceState, 'INVALID');
    assert.equal(invalid.state, 'UNPROVEN');
  }
});

test('stale contradictory Spatial success cannot regain public event-proof status', () => {
  const input = record({ classification: 'REFRESH_COMPLETE', phase: 'complete', finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_PASS',
    spatialAdoptionRequired: true, spatialAdoptionPathCount: 0, exactHeadProofOk: true,
    timestampUtc: new Date(NOW.getTime() - 3_600_000).toISOString() });
  const beacon = buildCompleteBeacon({ sourceHead: HEAD, now: NOW, statusRecords: { postSyncRefresh: input } });
  const surface = beacon.surfaces.find(row => row.id === 'postSyncRefresh');
  assert.equal(surface.runtimeRefresh.evidenceState, 'INVALID');
  assert.equal(surface.state, 'UNPROVEN');
  assert.equal(surface.rawState, 'REFRESH_COMPLETE');
  const coverage = beacon.telemetry.coverage.find(row => row.surfaceId === 'postSyncRefresh');
  assert.ok(coverage);
  assert.notEqual(coverage?.state, 'CURRENT_EXACT_HEAD_EVENT_PROOF');
  assert.equal(coverage?.answered, false);
});

function assertSpatialPublicHold(input, label = '') {
  const beacon = buildCompleteBeacon({ sourceHead: HEAD, now: NOW, statusRecords: { postSyncRefresh: input } });
  const surface = beacon.surfaces.find(row => row.id === 'postSyncRefresh');
  const coverage = beacon.telemetry.coverage.find(row => row.surfaceId === 'postSyncRefresh');
  const health = beacon.telemetry.executive.questions.find(row => row.questionClass === 'POST_SYNC_REFRESH_HEALTH');
  assert.equal(coverage.answered, false, label);
  assert.equal(health.answered, false, label);
  assert.notEqual(coverage.gapClass, 'NONE', label);
  assert.notEqual(coverage.state, 'CURRENT_EXACT_HEAD_EVENT_PROOF', label);
  assert.equal(surface.runtimeRefresh.spatialAdoptionRequired, true, label);
  return surface;
}

test('a real successful target checkpoint leaves Spatial publicly unpaid at every age', () => {
  const mailbox = POST_SYNC_REFRESH_TARGETS.GITHUB_MAILBOX;
  const plan = classifyPostSyncRefresh(['scripts/battle-bridge-github-command-mailbox.mjs', 'scripts/spatial-window-host.mjs']);
  const checkpoint = buildPostSyncRefreshProjection({ ok: false, classification: 'REFRESH_READY', plan,
    results: [{ targetId: mailbox, ok: true, exactHeadProofOk: true, sourceHead: HEAD, blocker: '' }],
    exactHeadProofOk: false }, { beforeHead: OTHER_HEAD, afterHead: HEAD });
  for (const age of [0, 3_600_000]) {
    const surface = assertSpatialPublicHold({ ...checkpoint, phase: 'checkpoint-1', timestampUtc: new Date(NOW.getTime() - age).toISOString() });
    assert.equal(surface.runtimeRefresh.evidenceState, 'OBSERVED');
    assert.equal(surface.runtimeRefresh.classification, 'REFRESH_READY');
    assert.equal(surface.rawState, 'REFRESH_READY');
    assert.equal(surface.state, 'BLOCKED_SPATIAL_ADOPTION_REQUIRED');
    assert.equal(surface.blocker, 'SPATIAL_RESIDENT_ADOPTION_UNPROVEN');
  }
});

test('Spatial public debt is invariant across canonical classifications, persisted phases, age and target outcomes', () => {
  const classifications = Object.values(POST_SYNC_REFRESH_CLASSIFICATIONS);
  const phases = ['plan', 'blocked', 'complete', ...Array.from({ length: 7 }, (_, index) => `checkpoint-${index + 1}`)];
  const mailbox = POST_SYNC_REFRESH_TARGETS.GITHUB_MAILBOX;
  let combinations = 0;
  for (const classification of classifications) for (const phase of phases) for (const age of [0, 3_600_000])
    for (const spatialAdoptionPathCount of [0, 1, 2]) for (const outcome of ['absent', 'pass', 'failure']) {
      const failure = outcome === 'failure';
      const blocker = failure ? 'GITHUB_MAILBOX_EXACT_HEAD_PROOF_FAILED'
        : classification === 'APPROVAL_REQUIRED_OPENCLAW' ? 'OPENCLAW_REFRESH_APPROVAL_REQUIRED' : '';
      const input = record({ beforeHead: OTHER_HEAD, classification, phase, timestampUtc: new Date(NOW.getTime() - age).toISOString(),
        finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_BLOCKED', ok: false, exactHeadProofOk: false, blocker,
        targetIds: [mailbox], resultTargets: outcome === 'absent' ? [] : [{ targetId: mailbox,
          ok: !failure, exactHeadProofOk: !failure, sourceHead: HEAD, blocker: failure ? blocker : '' }],
        spatialAdoptionRequired: true, spatialAdoptionPathCount });
      const label = JSON.stringify({ classification, phase, age, spatialAdoptionPathCount, outcome });
      const surface = assertSpatialPublicHold(input, label);
      assert.equal(surface.rawState, classification, label);
      assert.equal(surface.runtimeRefresh.classification, classification, label);
      if (surface.runtimeRefresh.evidenceState === 'OBSERVED') {
        assert.equal(surface.state, 'BLOCKED_SPATIAL_ADOPTION_REQUIRED', label);
        assert.equal(surface.blocker, blocker || 'SPATIAL_RESIDENT_ADOPTION_UNPROVEN', label);
      } else {
        assert.equal(surface.state, 'UNPROVEN', label);
      }
      combinations += 1;
    }
  assert.equal(combinations, classifications.length * phases.length * 2 * 3 * 3);
});

test('partially populated refresh evidence retains a typed Spatial obligation', () => {
  for (const shape of [
    { targetIds: undefined }, { resultTargets: undefined },
    { targetIds: undefined, resultTargets: undefined }, { targetIds: null, resultTargets: null },
  ]) {
    const surface = assertSpatialPublicHold(record({ spatialAdoptionRequired: true, spatialAdoptionPathCount: 0, ...shape }));
    assert.equal(surface.runtimeRefresh.evidenceState, 'MISSING');
    assert.equal(surface.state, 'BLOCKED_SPATIAL_ADOPTION_REQUIRED');
    assert.equal(surface.blocker, 'SPATIAL_RESIDENT_ADOPTION_UNPROVEN');
  }
});

test('omitted or false Spatial metadata preserves legacy public state, age and blocker behavior', () => {
  for (const classification of Object.values(POST_SYNC_REFRESH_CLASSIFICATIONS).filter(value => value !== 'BLOCKED_SPATIAL_ADOPTION_REQUIRED')) {
    for (const age of [0, 3_600_000]) {
      const input = record({ classification, blocker: 'EXISTING_BLOCKER', timestampUtc: new Date(NOW.getTime() - age).toISOString() });
      for (const spatial of [{}, { spatialAdoptionRequired: false, spatialAdoptionPathCount: 0 }]) {
        const surface = beaconSurface({ ...input, ...spatial });
        assert.equal(surface.state, age ? 'STALE' : classification);
        assert.equal(surface.rawState, classification);
        assert.equal(surface.blocker, 'EXISTING_BLOCKER');
        assert.equal(surface.runtimeRefresh.evidenceState, 'OBSERVED');
      }
    }
  }
});

test('a stale pending range retains its own head while changed range and counts remain publishable', () => {
  const input = record({ beforeHead: 'c'.repeat(40), afterHead: OTHER_HEAD, unknownPathCount: 33,
    timestampUtc: '2026-10-28T20:33:22.997Z', classification: 'BLOCKED_UNCLASSIFIED_RUNTIME_PATH' });
  const surface = beaconSurface(input);
  assert.equal(surface.state, 'STALE');
  assert.equal(surface.runtimeRefresh.beforeHead, 'c'.repeat(40));
  assert.equal(surface.runtimeRefresh.afterHead, OTHER_HEAD);
  assert.equal(surface.runtimeRefresh.afterHeadMatchesExpected, false);
  assert.equal(surface.runtimeRefresh.unknownPathCount, 33);
  assert.deepEqual(surface.runtimeRefresh.resultTargets, []);
  const material = overrides => buildBattleBridgeOutboundBeaconMaterialBody(buildBattleBridgeOutboundBeaconBody(
    buildCompleteBeacon({ sourceHead: HEAD, now: NOW, statusRecords: { postSyncRefresh: { ...input, ...overrides } } })));
  assert.notEqual(material({}), material({ beforeHead: 'd'.repeat(40) }));
  assert.notEqual(material({}), material({ unknownPathCount: 34 }));
});

test('blocked target facts remain visible without inventing a result for a later target', () => {
  const plan = buildPostSyncRefreshProjection({
    classification: POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_REFRESH_FAILED,
    plan: { targetIds: [UI, TARGET] },
    blocker: 'UI_PUBLICATION_CUSTODY_UNPROVEN',
    results: [{
      targetId: UI,
      ok: false,
      exactHeadProofOk: false,
      sourceHead: HEAD,
      blocker: 'UI_PUBLICATION_CUSTODY_UNPROVEN',
    }],
  }, { beforeHead: OTHER_HEAD, afterHead: HEAD });
  const surface = beaconSurface({ ...plan, timestampUtc: NOW.toISOString() });

  assert.equal(surface.state, 'BLOCKED_REFRESH_FAILED');
  assert.equal(surface.runtimeRefresh.evidenceState, 'OBSERVED');
  assert.deepEqual(surface.runtimeRefresh.resultTargets, [{
    targetId: UI,
    ok: false,
    exactHeadProofOk: false,
    sourceHead: HEAD,
    sourceHeadMatchesExpected: true,
    blocker: 'UI_PUBLICATION_CUSTODY_UNPROVEN',
  }]);
  assert.equal(surface.runtimeRefresh.resultTargets.some((item) => item.targetId === TARGET), false);
});

test('reported success and mismatched target source remain independent observations', () => {
  const facts = projectPostSyncRefreshBeaconFacts(record({
    classification: 'REFRESH_COMPLETE',
    resultTargets: [{ targetId: TARGET, ok: true, exactHeadProofOk: true, sourceHead: OTHER_HEAD }],
  }), HEAD);

  assert.equal(facts.resultTargets[0].ok, true);
  assert.equal(facts.resultTargets[0].exactHeadProofOk, true);
  assert.equal(facts.resultTargets[0].sourceHeadMatchesExpected, false);
  assert.equal('processLoadedProven' in facts, false);
  assert.equal('runtimeMutationAllowed' in facts, false);
});

test('missing target booleans and source stay unknown instead of becoming false or pass', () => {
  const facts = projectPostSyncRefreshBeaconFacts(record({
    resultTargets: [{ targetId: TARGET }],
  }), HEAD);

  assert.deepEqual(facts.resultTargets, [{
    targetId: TARGET,
    ok: null,
    exactHeadProofOk: null,
    sourceHead: '',
    sourceHeadMatchesExpected: null,
    blocker: '',
  }]);
});

test('malformed booleans and SHA suffixes cannot become affirmative evidence', () => {
  const facts = projectPostSyncRefreshBeaconFacts(record({
    resultTargets: [{ targetId: TARGET, ok: 'true', exactHeadProofOk: 1, sourceHead: `${HEAD}/private` }],
  }), HEAD);

  assert.equal(facts.evidenceState, 'INVALID');
  assert.equal(facts.resultTargets[0].ok, null);
  assert.equal(facts.resultTargets[0].exactHeadProofOk, null);
  assert.equal(facts.resultTargets[0].sourceHead, '');
  assert.equal(facts.resultTargets[0].sourceHeadMatchesExpected, null);
  assert.equal(JSON.stringify(facts).includes('private'), false);
});

test('missing or malformed expected source cannot produce a head match', () => {
  const input = record({ resultTargets: [{ targetId: TARGET, sourceHead: HEAD }] });
  for (const expected of ['', `${HEAD}suffix`, null, 123]) {
    assert.equal(projectPostSyncRefreshBeaconFacts(input, expected).resultTargets[0].sourceHeadMatchesExpected, null);
  }
  assert.equal(projectPostSyncRefreshBeaconFacts(input, HEAD.toUpperCase()).resultTargets[0].sourceHeadMatchesExpected, true);
});

test('canonical target identities are accepted and unknown or path-bearing identities are omitted', () => {
  const all = Object.values(POST_SYNC_REFRESH_TARGETS);
  const accepted = projectPostSyncRefreshBeaconFacts(record({
    targetIds: all,
    resultTargets: all.map((targetId) => ({ targetId, sourceHead: HEAD })),
  }), HEAD);
  assert.equal(accepted.evidenceState, 'OBSERVED');
  assert.deepEqual(accepted.targetIds, all);
  assert.equal(accepted.resultTargets.length, all.length);

  const rejected = projectPostSyncRefreshBeaconFacts(record({
    targetIds: [TARGET, 'C:\\Users\\private\\token.txt'],
    resultTargets: [{ targetId: TARGET }, { targetId: 'C:\\Users\\private\\token.txt', ok: true }],
  }), HEAD);
  assert.equal(rejected.evidenceState, 'INVALID');
  assert.deepEqual(rejected.targetIds, [TARGET]);
  assert.equal(rejected.resultTargets.length, 1);
  assert.equal(JSON.stringify(rejected).includes('private'), false);
});

test('duplicate conflicting results do not select the favorable observation', () => {
  const facts = projectPostSyncRefreshBeaconFacts(record({
    targetIds: [TARGET, TARGET],
    resultTargets: [
      { targetId: TARGET, ok: true, exactHeadProofOk: true, sourceHead: HEAD },
      { targetId: TARGET, ok: false, exactHeadProofOk: false, blocker: 'OWNER_CUSTODY_UNPROVEN' },
    ],
  }), HEAD);

  assert.equal(facts.evidenceState, 'INVALID');
  assert.deepEqual(facts.targetIds, [TARGET]);
  assert.deepEqual(facts.resultTargets, []);
});

test('oversized evidence stays bounded and cannot hide a contradictory result after the prefix', () => {
  const all = Object.values(POST_SYNC_REFRESH_TARGETS);
  const facts = projectPostSyncRefreshBeaconFacts(record({
    targetIds: [...all, ...Array(10_000).fill('private-target')],
    resultTargets: [
      ...all.map((targetId) => ({ targetId, ok: true, sourceHead: HEAD })),
      { targetId: TARGET, ok: false, blocker: 'OWNER_CUSTODY_UNPROVEN' },
    ],
  }), HEAD);

  assert.equal(facts.truncated, true);
  assert.equal(facts.evidenceState, 'TRUNCATED');
  assert.deepEqual(facts.targetIds, all);
  assert.deepEqual(facts.resultTargets, []);
  assert.equal(JSON.stringify(facts).includes('private-target'), false);
  assert.ok(JSON.stringify(facts).length < 2_000);
});

test('private paths, raw logs, invented authority and overlong blockers are never copied', () => {
  const surface = beaconSurface(record({
    privatePath: 'C:\\Users\\private\\token.txt',
    resultTargets: [{
      targetId: TARGET,
      sourceHead: HEAD,
      ok: false,
      blocker: `OWNER_CUSTODY_${'X'.repeat(160)}`,
      privatePath: 'C:\\Users\\private\\token.txt',
      stderr: 'private raw log',
      token: 'private-token',
      freshProcessLoaded: true,
      mergeAuthority: true,
      sourceMutationAllowed: true,
    }],
  }));
  const text = JSON.stringify(surface);

  assert.equal(surface.runtimeRefresh.evidenceState, 'INVALID');
  assert.equal(surface.runtimeRefresh.resultTargets[0].blocker, '');
  for (const forbidden of ['private', 'stderr', 'token', 'freshProcessLoaded', 'mergeAuthority', 'sourceMutationAllowed']) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

test('typed target blockers are preserved while path/log text is rejected', () => {
  const projected = (blocker) => projectPostSyncRefreshBeaconFacts(record({
    resultTargets: [{ targetId: TARGET, blocker }],
  }), HEAD);
  const typed = `REFRESH_PROOF_FAILED:${TARGET}`;
  assert.equal(projected(typed).resultTargets[0].blocker, typed);
  for (const blocker of ['C:\\Users\\private\\token.txt', '/private/token', 'failed at /private', 'ERROR:private-token']) {
    const facts = projected(blocker);
    assert.equal(facts.resultTargets[0].blocker, '');
    assert.equal(facts.evidenceState, 'INVALID');
  }
});

test('missing records and malformed arrays remain explicit and do not gain target results', () => {
  const missing = beaconSurface(null);
  assert.equal(missing.state, 'UNPROVEN');
  assert.equal(missing.runtimeRefresh.evidenceState, 'MISSING');
  assert.equal(missing.runtimeRefresh.classification, 'UNKNOWN');
  assert.deepEqual(missing.runtimeRefresh.resultTargets, []);

  const malformed = projectPostSyncRefreshBeaconFacts(record({
    targetIds: { targetId: TARGET },
    resultTargets: 'success',
  }), HEAD);
  assert.equal(malformed.evidenceState, 'MISSING');
  assert.deepEqual(malformed.targetIds, []);
  assert.deepEqual(malformed.resultTargets, []);
});

test('stale outer observation remains stale despite preserved historical target success', () => {
  const surface = beaconSurface(record({
    timestampUtc: '2026-10-28T20:33:22.997Z',
    classification: 'REFRESH_COMPLETE',
    resultTargets: [{ targetId: TARGET, ok: true, exactHeadProofOk: true, sourceHead: HEAD }],
  }));

  assert.equal(surface.state, 'STALE');
  assert.equal(surface.runtimeRefresh.classification, 'REFRESH_COMPLETE');
  assert.equal(surface.runtimeRefresh.resultTargets[0].ok, true);
});

function caretakerEvidence(overrides = {}) {
  return { schemaVersion: 'stephanos.sovereign-caretaker-execution.v1',
    expectedSourceHead: HEAD, observedAtUtc: NOW.toISOString(), exitStatus: 2,
    spawnErrorCode: '', terminationSignal: '', failureReceiptRecognized: true,
    reportedBlocker: 'SOVEREIGN_COMMANDER_MAINTENANCE_QUIESCENCE_UNPROVEN',
    reportedVerdict: 'SOVEREIGN_COMMANDER_WATCHDOG_BLOCKED', diagnosticOnly: true, ...overrides };
}

test('complete beacon preserves the fixed caretaker denial through actual sync projection and retry-plan surfaces', () => {
  const evidence = caretakerEvidence({ stdout: 'PRIVATE_RAW_OUTPUT', stderr: 'PRIVATE_ERROR', token: 'PRIVATE_TOKEN' });
  const syncAndRefreshRecord = projectSyncAndRefreshStatus({
    sourceHead: HEAD, ok: false, blocker: 'SOVEREIGN_COMMANDER_WATCHDOG_EXECUTION_FAILED',
    controlPlaneRepair: { repairAttempted: true, repair: { sovereignCaretakerExecution: evidence } },
  });
  const plan = buildPostSyncRefreshProjection({
    classification: 'REFRESH_READY', plan: { targetIds: [TARGET] }, results: [],
  }, { beforeHead: OTHER_HEAD, afterHead: HEAD });
  const beacon = buildCompleteBeacon({ sourceHead: HEAD, now: NOW, syncAndRefreshRecord,
    statusRecords: { postSyncRefresh: { ...plan, timestampUtc: NOW.toISOString(), lastSovereignCaretakerFailure: evidence } } });
  const sync = beacon.surfaces.find(item => item.id === 'githubSync').sovereignCaretakerExecution;
  assert.equal(sync.evidenceState, 'OBSERVED');
  assert.equal(sync.expectedSourceHead, HEAD);
  assert.equal(sync.observedAtUtc, NOW.toISOString());
  assert.equal(sync.exitStatus, 2);
  assert.equal(sync.reportedBlocker, evidence.reportedBlocker);
  assert.equal(sync.diagnosticOnly, true);
  const refresh = beacon.surfaces.find(item => item.id === 'postSyncRefresh');
  assert.equal(refresh.state, 'REFRESH_READY');
  assert.equal(refresh.runtimeRefresh.lastSovereignCaretakerFailure.evidenceState, 'HISTORICAL');
  assert.equal(refresh.runtimeRefresh.lastSovereignCaretakerFailure.observedAtUtc, evidence.observedAtUtc);
  assert.equal(refresh.runtimeRefresh.lastSovereignCaretakerFailure.reportedBlocker, evidence.reportedBlocker);
  assert.equal(refresh.runtimeRefresh.sovereignCaretakerExecution.evidenceState, 'MISSING');
  assert.doesNotMatch(buildBattleBridgeOutboundBeaconBody(beacon), /PRIVATE_/);
  assert.equal(beacon.processRestartAllowed, false);
});

test('public caretaker observation retains its original source and age instead of borrowing the beacon head', () => {
  for (const [overrides, state] of [
    [{ expectedSourceHead: OTHER_HEAD }, 'HEAD_MISMATCH'],
    [{ observedAtUtc: new Date(NOW.getTime() - 600_000).toISOString() }, 'STALE'],
    [{ observedAtUtc: new Date(NOW.getTime() + 61_000).toISOString() }, 'FUTURE_DATED'],
  ]) {
    const evidence = caretakerEvidence(overrides);
    const surface = beaconSurface(record({ sovereignCaretakerExecution: evidence, lastSovereignCaretakerFailure: evidence }));
    const actual = surface.runtimeRefresh.sovereignCaretakerExecution;
    assert.equal(actual.evidenceState, state);
    if (state !== 'FUTURE_DATED') {
      assert.equal(actual.expectedSourceHead, evidence.expectedSourceHead);
      assert.equal(actual.observedAtUtc, evidence.observedAtUtc);
      assert.equal(surface.runtimeRefresh.lastSovereignCaretakerFailure.evidenceState, 'HISTORICAL');
    } else {
      assert.equal(actual.reportedBlocker, undefined);
      assert.equal(surface.runtimeRefresh.lastSovereignCaretakerFailure.evidenceState, 'FUTURE_DATED');
    }
  }
});

test('public caretaker evidence rejects spoofed shape and closed-code smuggling', () => {
  for (const overrides of [
    { schemaVersion: 'PRIVATE_SCHEMA' }, { expectedSourceHead: [HEAD] },
    { expectedSourceHead: `${HEAD}/PRIVATE_PATH` }, { observedAtUtc: 'PRIVATE_TIME' },
  ]) {
    const projected = beaconSurface(record({ sovereignCaretakerExecution: caretakerEvidence(overrides) })).runtimeRefresh.sovereignCaretakerExecution;
    assert.equal(projected.evidenceState, 'INVALID');
    assert.doesNotMatch(JSON.stringify(projected), /PRIVATE_/);
  }
  const projected = beaconSurface(record({ sovereignCaretakerExecution: caretakerEvidence({
    reportedBlocker: 'SOVEREIGN_COMMANDER_PRIVATE_SECRET', spawnErrorCode: 'PRIVATE_ERROR', terminationSignal: 'PRIVATE_SIGNAL',
  }) })).runtimeRefresh.sovereignCaretakerExecution;
  assert.equal(projected.failureReceiptRecognized, false);
  assert.equal(projected.reportedBlocker, '');
  assert.equal(projected.spawnErrorCode, 'CHILD_PROCESS_ERROR');
  assert.equal(projected.terminationSignal, 'UNKNOWN');
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE_/);
});

test('caretaker diagnostic age alone is immaterial but changed denial remains publishable', () => {
  const build = (now, reportedBlocker) => buildCompleteBeacon({ sourceHead: HEAD, now,
    statusRecords: { postSyncRefresh: record({ lastSovereignCaretakerFailure: caretakerEvidence({ reportedBlocker }) }) } });
  const material = value => buildBattleBridgeOutboundBeaconMaterialBody(buildBattleBridgeOutboundBeaconBody(value));
  const blocker = 'SOVEREIGN_COMMANDER_MAINTENANCE_QUIESCENCE_UNPROVEN';
  const first = build(NOW, blocker);
  const later = build(new Date(NOW.getTime() + 60_000), blocker);
  assert.equal(material(first), material(later));
  assert.notEqual(material(first), material(build(NOW, 'SOVEREIGN_COMMANDER_NORMAL_OPERATOR_REQUIRED')));
});
