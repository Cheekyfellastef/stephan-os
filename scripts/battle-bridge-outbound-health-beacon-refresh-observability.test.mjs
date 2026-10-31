import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBattleBridgeOutboundBeacon,
  projectPostSyncRefreshBeaconFacts,
} from './battle-bridge-outbound-health-beacon-core.mjs';
import {
  POST_SYNC_REFRESH_CLASSIFICATIONS,
  POST_SYNC_REFRESH_TARGETS,
  buildPostSyncRefreshProjection,
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
