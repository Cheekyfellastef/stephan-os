import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SOVEREIGN_METER_INDEPENDENCE_MISSION_ID,
  SOVEREIGN_METER_INDEPENDENCE_ISSUE,
  buildSovereignMeterIndependenceSeedV1,
} from './sovereignMeterIndependenceSeedV1.mjs';
import { HIGH_LEVEL_FLYWHEEL_SEEDS_V1 } from '../project/seedGardenProjectionV1.mjs';
import { buildHighLevelFlywheelSeedHeartbeatV1 } from '../agents/starfieldVrOutcomeOwnershipSeedV1.mjs';
import { deriveFlywheelWorkspaceView } from './upliftWorkspaceProjectionV1.mjs';
import { planSeedGrowthWorkV1 } from './seedGrowthWorkV1.mjs';

const NOW = '2026-10-09T12:30:00.000Z';
const NOW_MS = Date.parse(NOW);
const registrySeed = HIGH_LEVEL_FLYWHEEL_SEEDS_V1.find((seed) => seed.seedId === SOVEREIGN_METER_INDEPENDENCE_MISSION_ID);
const feed = (records = {}) => ({
  schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1',
  state: 'ready',
  errors: [],
  records: { goalRecords: [], eventRecords: [], statusRecords: [], proofRecords: [],
    receiptRecords: [], lessonRecords: [], capabilityRecords: [], ...records },
});
const view = (payload) => deriveFlywheelWorkspaceView(payload, { nowMs: NOW_MS });
const pressure = (payload) => planSeedGrowthWorkV1(view(payload), payload, NOW_MS);
const heartbeat = () => buildHighLevelFlywheelSeedHeartbeatV1(registrySeed, { timestampUtc: '2026-10-09T12:15:00.000Z' });
const meterEvent = (rung, i) => ({
  eventId: 'meter-proof-' + i,
  kind: 'stephanos.shared_workspace.event',
  missionId: SOVEREIGN_METER_INDEPENDENCE_MISSION_ID,
  relatedIssue: SOVEREIGN_METER_INDEPENDENCE_ISSUE,
  participantId: 'flywheel',
  timestampUtc: '2026-10-09T12:20:00.000Z',
  status: 'PASS',
  proofRefs: ['proof/meter-independence-' + i],
  meterIndependenceEvidence: {
    schemaVersion: 'stephanos.meter-independence-rung-proof.v1',
    rung,
  },
});

test('meter independence is one canonical owner, not a second scheduler or authority path', () => {
  const seed = buildSovereignMeterIndependenceSeedV1();
  assert.ok(registrySeed);
  assert.equal(registrySeed.issue, '#2968');
  assert.equal(registrySeed.source, 'shared/runtime/sovereignMeterIndependenceSeedV1.mjs');
  assert.equal(seed.growthRungs.length, 8);
  assert.deepEqual(seed.existingOwnerIssueRefs, ['#1898', '#2519']);
  assert.equal(seed.authority.mergeAllowedBySeed, false);
  assert.equal(seed.authority.spendingAllowedBySeed, false);
  assert.equal(seed.growthContract.neverEvadeProviderQuotasOrPaymentBoundaries, true);
});

test('an unplanted or source-unbound seed must not release goal pressure or claim green', () => {
  const unavailable = view(feed());
  const meter = unavailable.outcomeSeeds.find((seed) => seed.missionId === SOVEREIGN_METER_INDEPENDENCE_MISSION_ID);
  assert.ok(meter);
  assert.equal(meter.declared, true);
  assert.equal(meter.planted, false);
  assert.equal(meter.sourceTruth, 'UNKNOWN');
  assert.equal(meter.currentRung, 'AWAITING_LIVE_PROOF');
  assert.equal(pressure(feed()).length, 0);

  const unbound = feed({ statusRecords: [{
    ...heartbeat(),
    seedHeartbeat: { ...heartbeat().seedHeartbeat, contractSource: 'wrong/source.mjs' },
  }] });
  assert.equal(view(unbound).sovereignMeterIndependenceSeedGrowth.planted, false);
  assert.equal(pressure(unbound).length, 0);
});

test('source-bound heartbeat enters the existing canonical seed-to-goal conveyor once', () => {
  const payload = feed({ statusRecords: [heartbeat()] });
  const meter = view(payload).sovereignMeterIndependenceSeedGrowth;
  assert.equal(meter.planted, true);
  assert.equal(meter.sourceTruth, 'CURRENT');
  assert.equal(meter.proofCount, 0);
  assert.equal(meter.nextGrowthRung, 'INVENTORY_METERS');
  const planned = pressure(payload);
  assert.equal(planned.length, 1);
  assert.equal(planned[0].ownerIssueRef, '#2968');
  assert.equal(planned[0].seedId, SOVEREIGN_METER_INDEPENDENCE_MISSION_ID);
  assert.equal(planned[0].pressureKey, 'seed-2968:rung:inventory_meters');
  assert.deepEqual(pressure(payload).map((item) => item.pressureKey), [planned[0].pressureKey]);

  payload.records.eventRecords = [meterEvent('INVENTORY_METERS', 1)];
  assert.equal(pressure(payload)[0].pressureKey, 'seed-2968:rung:map_existing_sovereign_routes');
  assert.equal(view(payload).sovereignMeterIndependenceSeedGrowth.rungProofCount, 1);
});

test('missing or merely asserted proof never advances; full typed proof stops repair pressure', () => {
  const seed = buildSovereignMeterIndependenceSeedV1();
  const payload = feed({ statusRecords: [heartbeat()] });
  payload.records.eventRecords = [{ ...meterEvent(seed.growthRungs[0], 1), proofRefs: [] }];
  assert.equal(view(payload).sovereignMeterIndependenceSeedGrowth.rungProofCount, 0);
  assert.equal(pressure(payload)[0].pressureKey, 'seed-2968:rung:inventory_meters');
  payload.records.eventRecords = seed.growthRungs.map(meterEvent);
  const meter = view(payload).sovereignMeterIndependenceSeedGrowth;
  assert.equal(meter.rungProofCount, 8);
  assert.equal(meter.nextGrowthRung, '');
  assert.equal(meter.pressureState, 'CURRENT');
  assert.equal(pressure(payload).length, 0);
});

test('stale heartbeat cannot manufacture a live canonical seed goal', () => {
  const payload = feed({ statusRecords: [buildHighLevelFlywheelSeedHeartbeatV1(registrySeed, {
    timestampUtc: '2026-10-09T10:00:00.000Z',
  })] });
  assert.equal(pressure(payload).length, 0);
});
