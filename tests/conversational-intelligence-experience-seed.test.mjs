import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildConversationalIntelligenceSeedV1,
} from '../shared/runtime/conversationalIntelligenceSeedV1.mjs';
import {
  HIGH_LEVEL_FLYWHEEL_SEEDS_V1,
} from '../shared/project/seedGardenProjectionV1.mjs';
import { buildHighLevelFlywheelSeedHeartbeatV1 } from '../shared/agents/starfieldVrOutcomeOwnershipSeedV1.mjs';
import { deriveFlywheelWorkspaceView } from '../shared/runtime/upliftWorkspaceProjectionV1.mjs';
import { planSeedGrowthWorkV1 } from '../shared/runtime/seedGrowthWorkV1.mjs';

const NOW = '2026-10-09T14:30:00.000Z';
const NOW_MS = Date.parse(NOW);
const SEED_ID = 'stephanos-flywheel-conversational-intelligence';

function fixture(events = []) {
  const seed = HIGH_LEVEL_FLYWHEEL_SEEDS_V1.find((item) => item.seedId === SEED_ID);
  return {
    schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1',
    state: 'ready', errors: [],
    records: {
      goalRecords: [], eventRecords: events,
      proofRecords: [], capabilityRecords: [], lessonRecords: [], receiptRecords: [],
      statusRecords: [buildHighLevelFlywheelSeedHeartbeatV1(seed, { timestampUtc: NOW })],
    },
  };
}

function event({ issue = '#2434', id = 'stephanos-ai-restart-history', kind = 'capability-gap' } = {}) {
  return {
    schemaVersion: 'shared-agent-workspace-record.v1',
    kind: 'stephanos.shared_workspace.event',
    eventId: id, timestampUtc: NOW, participantId: 'flywheel',
    relatedIssue: issue, eventKind: kind,
    capabilityId: id, status: 'BLOCKED',
    summary: 'Stephanos AI failed to resume canonical conversation on the iPad after a browser crash.',
    proofRefs: ['proof/stephanos-ai-real-ipad-recovery-failure'],
  };
}

test('reuses one existing Conversation Intelligence seed, not a new seed or controller', () => {
  const seed = buildConversationalIntelligenceSeedV1();
  assert.equal(seed.issueRef, '#2798');
  assert.equal(HIGH_LEVEL_FLYWHEEL_SEEDS_V1.filter((item) => item.seedId === SEED_ID).length, 1);
  const gardenSeed = HIGH_LEVEL_FLYWHEEL_SEEDS_V1.find((item) => item.seedId === SEED_ID);
  assert.deepEqual(gardenSeed.linkedGoalIssueRefs, ['#2434', '#2966']);
  assert.deepEqual(seed.linkedImprovementWork.map((work) => work.ref), ['#2434', '#2966', '#1722', '#2965']);
  assert.equal(seed.authority.mergeAllowedBySeed, false);
  assert.equal(seed.authority.runtimeMutationAllowedBySeed, false);
  assert.ok(seed.continuousExperienceChecks.includes('ios-touch-scroll-and-composer'));
});

test('landed source contract is visible in canopy projection without claiming live growth', () => {
  const view = deriveFlywheelWorkspaceView({
    schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1',
    state: 'unavailable', records: {},
  });
  const seed = view.outcomeSeeds.find((item) => item.missionId === SEED_ID);
  assert.ok(seed);
  assert.equal(seed.planted, false);
  assert.equal(seed.sourceTruth, 'UNKNOWN');
  assert.equal(seed.linkedImprovementWork[0].title, 'Durable conversation memory');
});

test('real #2434 iPad memory failure becomes a dedupable #2798 seed-to-goal pressure', () => {
  const feed = fixture([event()]);
  const view = deriveFlywheelWorkspaceView(feed, { nowMs: NOW_MS });
  const seed = view.outcomeSeeds.find((item) => item.missionId === SEED_ID);
  assert.equal(seed.planted, true);
  assert.equal(seed.currentGaps.some((gap) => gap.capabilityId === 'stephanos-ai-restart-history'), true);
  const pressures = planSeedGrowthWorkV1(view, feed, NOW_MS);
  const work = pressures.find((entry) => entry.seedId === SEED_ID);
  assert.ok(work);
  assert.equal(work.ownerIssueRef, '#2798');
  assert.equal(work.capabilityGapId, 'stephanos-ai-restart-history');
  assert.equal(work.pressureKey, 'seed-2798:gap:stephanos-ai-restart-history');
  assert.ok(work.evidenceRefs.includes('events/stephanos-ai-restart-history.json'));
  assert.equal(work.existingGoal, null);
  assert.equal(planSeedGrowthWorkV1(view, feed, NOW_MS).find((entry) => entry.seedId === SEED_ID).pressureKey, work.pressureKey);
});

test('live device-parity failure joins the seed; unrelated UI goals are not sucked into conversation memory', () => {
  const parity = event({ issue: '#2966', id: 'stephanos-ai-device-parity' });
  const uiOther = event({ issue: '#1722', id: 'unrelated-sidebar-hover' });
  const feed = fixture([parity, uiOther]);
  const view = deriveFlywheelWorkspaceView(feed, { nowMs: NOW_MS });
  const seed = view.outcomeSeeds.find((item) => item.missionId === SEED_ID);
  assert.equal(seed.currentGaps.some((gap) => gap.capabilityId === 'stephanos-ai-device-parity'), true);
  assert.equal(seed.currentGaps.some((gap) => gap.capabilityId === 'unrelated-sidebar-hover'), false);
  assert.equal(planSeedGrowthWorkV1(view, feed, NOW_MS).find((entry) => entry.seedId === SEED_ID).capabilityGapId, 'stephanos-ai-device-parity');
});

test('no evidence or stale evidence cannot manufacture a new chat experience repair', () => {
  const empty = fixture();
  const emptySeed = deriveFlywheelWorkspaceView(empty, { nowMs: NOW_MS })
    .outcomeSeeds.find((item) => item.missionId === SEED_ID);
  assert.equal(emptySeed.currentGaps.length, 0);

  const stale = fixture([{
    ...event(), timestampUtc: '2026-10-08T11:00:00.000Z',
  }]);
  const view = deriveFlywheelWorkspaceView(stale, { nowMs: NOW_MS });
  assert.equal(
    planSeedGrowthWorkV1(view, stale, NOW_MS).some((entry) => entry.seedId === SEED_ID && entry.capabilityGapId),
    false,
  );
});

test('wrong-source heartbeat cannot admit conversation experience repair even with a relevant current gap', () => {
  const feed = fixture([event()]);
  const original = feed.records.statusRecords[0];
  feed.records.statusRecords = [{
    ...original,
    seedHeartbeat: { ...original.seedHeartbeat, contractSource: 'unbound/source.mjs' },
  }];
  const view = deriveFlywheelWorkspaceView(feed, { nowMs: NOW_MS });
  assert.equal(
    planSeedGrowthWorkV1(view, feed, NOW_MS).some((work) => work.seedId === SEED_ID),
    false,
  );
});
