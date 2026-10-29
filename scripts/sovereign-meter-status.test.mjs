import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOVEREIGN_METER_STATUS_SCHEMA,
  buildSovereignMeterStatus,
  normalizeWorkspaceMeterRecord,
  normalizeGithubRateResources,
} from './sovereign-meter-status.mjs';

const NOW = new Date('2026-10-02T11:45:00.000Z');

test('normalizes current Codex capacity into a bounded red meter', () => {
  const meter = normalizeWorkspaceMeterRecord({
    kind: 'stephanos.shared_workspace.record.participant_status',
    participantStatusId: 'codex-capacity-current',
    participantId: 'codex-capacity-governor',
    timestampUtc: '2026-10-02T11:44:00.000Z',
    truthState: 'CURRENT',
    remainingPercent: 3,
    availability: 'AVAILABLE',
    meterTruthUsable: true,
    summary: 'SECRET RAW UI TEXT MUST NOT ESCAPE',
  }, { nowMs: NOW.getTime() });

  assert.equal(meter.meterId, 'codex-capacity');
  assert.equal(meter.remainingPercent, 3);
  assert.equal(meter.trafficLight, 'RED');
  assert.equal(JSON.stringify(meter).includes('SECRET RAW UI TEXT'), false);
});

test('stale capacity cannot be reported green', () => {
  const meter = normalizeWorkspaceMeterRecord({
    participantStatusId: 'some-provider-capacity',
    participantId: 'some-provider',
    timestampUtc: '2026-10-02T09:00:00.000Z',
    truthState: 'CURRENT',
    remainingPercent: 90,
    meterTruthUsable: true,
  }, { nowMs: NOW.getTime() });

  assert.equal(meter.observationState, 'STALE');
  assert.equal(meter.trafficLight, 'AMBER');
});

test('normalizes bounded GitHub rate resources', () => {
  const meters = normalizeGithubRateResources({
    core: { limit: 5000, remaining: 4000, reset: 1790942400 },
    search: { limit: 30, remaining: 3, reset: 1790942400 },
  }, { nowMs: NOW.getTime() });

  assert.equal(meters.length, 2);
  assert.equal(meters.find((item) => item.meterId === 'github-core').trafficLight, 'GREEN');
  assert.equal(meters.find((item) => item.meterId === 'github-search').trafficLight, 'AMBER');
});

test('build status keeps external-only meters explicit and unknown', () => {
  const status = buildSovereignMeterStatus({
    workspaceRecords: [],
    githubRateResources: null,
    now: NOW,
    workspaceReady: false,
    githubRateObservable: false,
  });

  assert.equal(status.schemaVersion, SOVEREIGN_METER_STATUS_SCHEMA);
  assert.equal(status.ok, true);
  assert.equal(status.unknownMeansGreen, false);
  assert.equal(status.meters.find((item) => item.meterId === 'remote-desktop-commander').trafficLight, 'GREY');
  assert.equal(status.meters.find((item) => item.meterId === 'codex-capacity').trafficLight, 'GREY');
  assert.equal(status.meters.find((item) => item.meterId === 'github-api').trafficLight, 'GREY');
  assert.equal(status.readOnly, true);
  assert.equal(status.arbitraryShellAllowed, false);
  assert.equal(status.secretMaterialIncluded, false);
});

test('a recent unknown or contradictory meter record cannot turn green', () => {
  for (const candidate of [
    { truthState: 'UNKNOWN', meterTruthUsable: true },
    { truthState: 'CURRENT', meterTruthUsable: false },
    { truthState: 'CURRENT' },
  ]) {
    const meter = normalizeWorkspaceMeterRecord({
      participantStatusId: 'codex-capacity-current',
      timestampUtc: '2026-10-02T11:44:00.000Z',
      remainingPercent: 95,
      availability: 'AVAILABLE',
      ...candidate,
    }, { nowMs: NOW.getTime() });
    assert.equal(meter.trafficLight, 'AMBER');
    assert.equal(meter.observationState, 'STALE');
  }
});

test('future-dated meter evidence never proves available capacity', () => {
  const meter = normalizeWorkspaceMeterRecord({
    participantStatusId: 'remote-desktop-commander-capacity',
    timestampUtc: '2026-10-02T11:46:00.000Z',
    truthState: 'CURRENT',
    meterTruthUsable: true,
    remainingPercent: 99,
    availability: 'AVAILABLE',
  }, { nowMs: NOW.getTime() });
  assert.equal(meter.trafficLight, 'AMBER');
  assert.equal(meter.observationState, 'STALE');
  assert.equal(meter.ageSeconds, null);
});

test('null and blank percentages stay unknown, never counterfeit depleted capacity', () => {
  for (const value of [null, '', '   ']) {
    const meter = normalizeWorkspaceMeterRecord({
      participantStatusId: 'codex-capacity-current',
      timestampUtc: '2026-10-02T11:44:00.000Z',
      truthState: 'CURRENT',
      meterTruthUsable: true,
      remainingPercent: value,
    }, { nowMs: NOW.getTime() });
    assert.equal(meter.remainingPercent, null);
    assert.equal(meter.trafficLight, 'GREY');
    assert.equal(meter.observationState, 'UNKNOWN');
  }
});

test('impossible GitHub rate counters are omitted and missing reset is not Unix epoch', () => {
  const meters = normalizeGithubRateResources({
    core: { limit: 5000, remaining: null, reset: null },
    search: { limit: 30, remaining: 31, reset: null },
    graphql: { limit: 100, remaining: 50, reset: null },
  }, { nowMs: NOW.getTime() });
  assert.deepEqual(meters.map((item) => item.meterId), ['github-graphql']);
  assert.equal(meters[0].remainingPercent, 50);
  assert.equal(meters[0].naturalResetAtUtc, '');
});

test('an untrusted newer duplicate cannot replace an older current usable meter', () => {
  const result = buildSovereignMeterStatus({
    workspaceRecords: [
      { participantStatusId: 'codex-capacity-current', timestampUtc: '2026-10-02T11:44:00.000Z',
        truthState: 'CURRENT', meterTruthUsable: true, remainingPercent: 12 },
      { participantStatusId: 'codex-capacity-current', timestampUtc: '2026-10-02T11:44:30.000Z',
        truthState: 'UNKNOWN', meterTruthUsable: false, remainingPercent: 95 },
    ],
    now: NOW,
  });
  const meter = result.meters.find((item) => item.meterId === 'codex-capacity');
  assert.equal(meter.remainingPercent, 12);
  assert.equal(meter.observationState, 'CURRENT');
  assert.equal(meter.trafficLight, 'AMBER');
});

test('even a trusted current numeric quota is not green when provider availability is unknown or unavailable', () => {
  const base = {
    participantStatusId: 'codex-capacity-current',
    timestampUtc: '2026-10-02T11:44:00.000Z',
    truthState: 'CURRENT',
    meterTruthUsable: true,
    remainingPercent: 95,
  };
  const observe = (availability) => normalizeWorkspaceMeterRecord({
    ...base, availability,
  }, { nowMs: NOW.getTime() });
  assert.equal(observe('UNKNOWN').trafficLight, 'AMBER');
  assert.equal(observe('UNAVAILABLE').trafficLight, 'RED');
  assert.equal(observe('CAPACITY_UNAVAILABLE').trafficLight, 'RED');
  assert.equal(observe('AVAILABLE').trafficLight, 'GREEN');
});
