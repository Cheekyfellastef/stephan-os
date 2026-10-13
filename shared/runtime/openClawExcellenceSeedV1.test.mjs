import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPENCLAW_EXCELLENCE_ISSUE,
  OPENCLAW_EXCELLENCE_MISSION_ID,
  buildOpenClawExcellenceSeedV1,
} from './openClawExcellenceSeedV1.mjs';
import { HIGH_LEVEL_FLYWHEEL_SEEDS_V1 } from '../project/seedGardenProjectionV1.mjs';
import { buildHighLevelFlywheelSeedHeartbeatV1 } from '../agents/starfieldVrOutcomeOwnershipSeedV1.mjs';
import { deriveFlywheelWorkspaceView } from './upliftWorkspaceProjectionV1.mjs';
import { planSeedGrowthWorkV1 } from './seedGrowthWorkV1.mjs';

const NOW_MS = Date.parse('2026-10-13T14:40:00.000Z');
const canonical = HIGH_LEVEL_FLYWHEEL_SEEDS_V1.find((seed) => seed.seedId === OPENCLAW_EXCELLENCE_MISSION_ID);
const feed = (records = {}) => ({
  schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1',
  state: 'ready',
  errors: [],
  records: {
    goalRecords: [], eventRecords: [], statusRecords: [], proofRecords: [],
    receiptRecords: [], lessonRecords: [], capabilityRecords: [], ...records,
  },
});
const view = (payload) => deriveFlywheelWorkspaceView(payload, { nowMs: NOW_MS });
const pressure = (payload) => planSeedGrowthWorkV1(view(payload), payload, NOW_MS);
const heartbeat = (timestampUtc = '2026-10-13T14:35:00.000Z') =>
  buildHighLevelFlywheelSeedHeartbeatV1(canonical, { timestampUtc });
const event = (rung, agentId = 'openclaw-local') => ({
  kind: 'stephanos.shared_workspace.event',
  eventId: 'openclaw-excellence-' + rung + '-' + agentId,
  missionId: OPENCLAW_EXCELLENCE_MISSION_ID,
  relatedIssue: OPENCLAW_EXCELLENCE_ISSUE,
  participantId: agentId,
  timestampUtc: '2026-10-13T14:38:00.000Z',
  status: 'PASS',
  proofRefs: ['proof/openclaw-' + rung + '-' + agentId],
  openClawExcellenceEvidence: {
    schemaVersion: 'stephanos.openclaw-excellence-rung-proof.v1',
    rung,
    agentId,
  },
});

test('one persistent seed owns two separate OpenClaw agent scopes without granting authority', () => {
  const seed = buildOpenClawExcellenceSeedV1();
  assert.equal(HIGH_LEVEL_FLYWHEEL_SEEDS_V1.filter((item) =>
    item.seedId === OPENCLAW_EXCELLENCE_MISSION_ID).length, 1);
  assert.equal(canonical.issue, '#3094');
  assert.equal(canonical.source, 'shared/runtime/openClawExcellenceSeedV1.mjs');
  assert.equal(seed.growthRungs.length, 8);
  assert.deepEqual(seed.agentIdentities.map((item) => item.runtimeAgentId),
    ['stephanos-scout-coder', 'openclaw-standalone']);
  assert.equal(seed.authority.mergeAllowedBySeed, false);
  assert.equal(seed.authority.runtimeMutationAllowedBySeed, false);
  assert.equal(seed.authority.crossAgentSkillActivationAllowedBySeed, false);
  assert.equal(seed.growthContract.requireTenQuestionExamAndAdversarialTests, true);
  assert.ok(seed.existingOwnerIssueRefs.includes('#1898'));
});

test('declaration alone cannot plant the Seed Canopy or dispatch any work', () => {
  const payload = feed();
  const seed = view(payload).openClawExcellenceSeedGrowth;
  assert.equal(seed.declared, true);
  assert.equal(seed.planted, false);
  assert.equal(seed.currentRung, 'AWAITING_LIVE_PROOF');
  assert.equal(seed.sourceTruth, 'UNKNOWN');
  assert.equal(view(payload).outcomeSeeds.filter((item) =>
    item.missionId === OPENCLAW_EXCELLENCE_MISSION_ID).length, 1);
  assert.deepEqual(pressure(payload), []);
});

test('fresh exact source, mission and issue bound heartbeat releases one pressure, not installation proof', () => {
  const payload = feed({ statusRecords: [heartbeat()] });
  const seed = view(payload).openClawExcellenceSeedGrowth;
  assert.equal(seed.planted, true);
  assert.equal(seed.sourceTruth, 'CURRENT');
  assert.equal(seed.proofCount, 0);
  assert.equal(seed.nextGrowthRung, 'INVENTORY_BOTH_AGENTS');
  const work = pressure(payload).filter((item) => item.seedId === OPENCLAW_EXCELLENCE_MISSION_ID);
  assert.equal(work.length, 1);
  assert.equal(work[0].ownerIssueRef, '#3094');
  assert.equal(work[0].pressureKey, 'seed-3094:rung:inventory_both_agents');
  assert.equal(work[0].contractSource, 'shared/runtime/openClawExcellenceSeedV1.mjs');
  assert.equal(seed.rungProofCount, 0);
});

test('stale or mismatched heartbeat cannot plant or enqueue growth', () => {
  for (const broken of [
    { ...heartbeat(), relatedIssue: '#1657' },
    { ...heartbeat(), seedHeartbeat: { ...heartbeat().seedHeartbeat, missionId: 'other' } },
    { ...heartbeat(), seedHeartbeat: { ...heartbeat().seedHeartbeat, contractSource: 'wrong/path.mjs' } },
    heartbeat('2026-10-13T12:35:00.000Z'),
    heartbeat('2026-10-13T15:35:00.000Z'),
  ]) {
    const payload = feed({ statusRecords: [broken] });
    assert.equal(view(payload).openClawExcellenceSeedGrowth.planted, false);
    assert.deepEqual(pressure(payload), []);
  }
});

test('inventory and skill qualification require separate proof for Local and Standalone', () => {
  const rungs = buildOpenClawExcellenceSeedV1().growthRungs;
  const payload = feed({ statusRecords: [heartbeat()] });
  payload.records.eventRecords = [event(rungs[0])];
  assert.equal(view(payload).openClawExcellenceSeedGrowth.nextGrowthRung, rungs[0]);
  assert.equal(view(payload).openClawExcellenceSeedGrowth.rungProofCount, 0);
  payload.records.eventRecords.push(event(rungs[0], 'openclaw-standalone'));
  assert.equal(view(payload).openClawExcellenceSeedGrowth.nextGrowthRung, rungs[1]);
  assert.equal(pressure(payload).filter((item) =>
    item.seedId === OPENCLAW_EXCELLENCE_MISSION_ID)[0].pressureKey,
  'seed-3094:rung:verify_upstream_release_and_skill_safety');
  payload.records.eventRecords.push(event(rungs[4]));
  assert.equal(view(payload).openClawExcellenceSeedGrowth.rungProofCount, 1);
  payload.records.eventRecords.push(event(rungs[4], 'openclaw-standalone'));
  assert.equal(view(payload).openClawExcellenceSeedGrowth.rungProofCount, 2);
});

test('mere prose, no receipt or wrong proof identity never counts toward agent parity', () => {
  const rung = buildOpenClawExcellenceSeedV1().growthRungs[0];
  const payload = feed({ statusRecords: [heartbeat()] });
  const valid = event(rung);
  payload.records.eventRecords = [
    { ...valid, eventId: 'empty-proof', proofRefs: [] },
    { ...valid, eventId: 'wrong-issue', relatedIssue: '#1657' },
    { ...valid, eventId: 'wrong-mission', missionId: 'other' },
    { ...valid, eventId: 'prose-only', openClawExcellenceEvidence: null },
  ];
  assert.equal(view(payload).openClawExcellenceSeedGrowth.rungProofCount, 0);
  assert.equal(view(payload).openClawExcellenceSeedGrowth.nextGrowthRung, rung);
});
