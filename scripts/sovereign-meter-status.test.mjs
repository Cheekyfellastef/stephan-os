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
