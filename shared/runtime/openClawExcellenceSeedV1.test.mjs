import test from 'node:test';
import { readFileSync } from 'node:fs';
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
  // Both agents can claim PASS, but these are not verified exams or approvals.
  assert.equal(view(payload).openClawExcellenceSeedGrowth.rungProofCount, 1);
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

test('an OpenClaw Local publisher cannot spoof Standalone inventory or skill proofs', () => {
  const rung = buildOpenClawExcellenceSeedV1().growthRungs[0];
  const payload = feed({ statusRecords: [heartbeat()] });
  payload.records.eventRecords = [
    event(rung, 'openclaw-local'),
    {
      ...event(rung, 'openclaw-standalone'),
      participantId: 'openclaw-local',
    },
  ];
  assert.equal(view(payload).openClawExcellenceSeedGrowth.rungProofCount, 0);
  assert.equal(view(payload).openClawExcellenceSeedGrowth.nextGrowthRung, rung);
});

test('Codex task-class parity requires two independent agent matrices of matched and reviewed receipts', () => {
  const seed = buildOpenClawExcellenceSeedV1();
  const rung = 'PROVE_END_TO_END_TASK_PARITY';
  const payload = feed({ statusRecords: [heartbeat()] });
  payload.records.eventRecords = [event(rung, 'openclaw-local'), event(rung, 'openclaw-standalone')];
  assert.equal(view(payload).openClawExcellenceSeedGrowth.rungProofCount, 0);
  const benchmark = (agent, taskClass) => ({
    ...event(rung, agent),
    eventId: 'codex-parity-' + agent + '-' + taskClass,
    proofRefs: ['proof/codex-' + agent + '-' + taskClass, 'proof/openclaw-' + agent + '-' + taskClass],
    openClawExcellenceEvidence: {
      schemaVersion: 'stephanos.openclaw-excellence-rung-proof.v1',
      rung,
      agentId: agent,
      benchmark: {
        schemaVersion: 'stephanos.openclaw-codex-comparative-task.v1',
        taskClass,
        taskFingerprint: 'same-inputs:' + agent + ':' + taskClass,
        sameTaskInputs: true,
        codexSuccessful: true,
        openClawSuccessful: true,
        independentReviewPassed: true,
        codexProofRef: 'proof/codex-' + agent + '-' + taskClass,
        openClawProofRef: 'proof/openclaw-' + agent + '-' + taskClass,
      },
    },
  });
  const fullMatrix = seed.agentIdentities.flatMap((agent) =>
    seed.taskClasses.map((taskClass) => benchmark(agent.participantId, taskClass)));
  payload.records.eventRecords = fullMatrix.slice(0, -1);
  assert.equal(view(payload).openClawExcellenceSeedGrowth.rungProofCount, 0);
  payload.records.eventRecords = fullMatrix;
  // A complete matrix of self-authored booleans and arbitrary refs is not an
  // independent Codex comparison, even if every declared task class passes.
  assert.equal(view(payload).openClawExcellenceSeedGrowth.rungProofCount, 0);
  payload.records.eventRecords = fullMatrix.map((entry, i) => i === 0
    ? {
      ...entry,
      openClawExcellenceEvidence: {
        ...entry.openClawExcellenceEvidence,
        benchmark: { ...entry.openClawExcellenceEvidence.benchmark, independentReviewPassed: false },
      },
    }
    : entry);
  assert.equal(view(payload).openClawExcellenceSeedGrowth.rungProofCount, 0);
});

test('fabricated ten-question, adversarial-test, operator-approval and reviewer flags never self-qualify skills', () => {
  const rung = 'QUALIFY_AGENT_SPECIFIC_SKILLS';
  const payload = feed({ statusRecords: [heartbeat()] });
  payload.records.eventRecords = ['openclaw-local', 'openclaw-standalone'].map((agentId) => ({
    ...event(rung, agentId),
    proofRefs: ['proof/arbitrary-agent-test-' + agentId, 'approval/not-verified-' + agentId],
    openClawExcellenceEvidence: {
      ...event(rung, agentId).openClawExcellenceEvidence,
      tenQuestionExamPassed: true,
      adversarialTestsPassed: true,
      operatorApprovalGranted: true,
      independentReviewPassed: true,
      reviewerId: 'self-declared-independent-reviewer',
    },
  }));
  const seed = view(payload).openClawExcellenceSeedGrowth;
  assert.equal(seed.rungProofCount, 0);
  assert.equal(seed.proofCount, 0);
  assert.equal(seed.pressureState, 'ACTIVE');
});

test('agent-authored complete benchmark matrix cannot forge reviewer independence', () => {
  const contract = buildOpenClawExcellenceSeedV1();
  const payload = feed({ statusRecords: [heartbeat()] });
  payload.records.eventRecords = contract.agentIdentities.flatMap(({ participantId: agentId }) =>
    contract.taskClasses.map((taskClass) => ({
      ...event('PROVE_END_TO_END_TASK_PARITY', agentId),
      eventId: 'self-reviewed-' + agentId + '-' + taskClass,
      proofRefs: ['proof/codex-' + taskClass, 'proof/openclaw-' + taskClass],
      openClawExcellenceEvidence: {
        schemaVersion: 'stephanos.openclaw-excellence-rung-proof.v1',
        rung: 'PROVE_END_TO_END_TASK_PARITY',
        agentId,
        benchmark: {
          schemaVersion: 'stephanos.openclaw-codex-comparative-task.v1',
          taskClass,
          taskFingerprint: 'same-inputs-' + taskClass,
          sameTaskInputs: true,
          codexSuccessful: true,
          openClawSuccessful: true,
          independentReviewPassed: true,
          reviewerId: 'claimed-reviewer',
          codexProofRef: 'proof/codex-' + taskClass,
          openClawProofRef: 'proof/openclaw-' + taskClass,
        },
      },
    })));
  assert.equal(view(payload).openClawExcellenceSeedGrowth.rungProofCount, 0);
  assert.equal(view(payload).openClawExcellenceSeedGrowth.proofCount, 0);
});

test('only source-admitted observational records count as OpenClaw proof', () => {
  const payload = feed({ statusRecords: [heartbeat()] });
  payload.records.eventRecords = [
    event('INVENTORY_BOTH_AGENTS'),
    event('INVENTORY_BOTH_AGENTS', 'openclaw-standalone'),
    event('QUALIFY_AGENT_SPECIFIC_SKILLS'),
    event('PROVE_END_TO_END_TASK_PARITY', 'openclaw-standalone'),
    event('INVENTORY_BOTH_AGENTS', 'intruder'),
    { ...event('INVENTORY_BOTH_AGENTS', 'openclaw-standalone'),
      participantId: 'openclaw-local', eventId: 'spoofed-standalone-inventory' },
    { ...event('INVENTORY_BOTH_AGENTS'), eventId: 'unsigned-prose',
      openClawExcellenceEvidence: null },
  ];
  const seed = view(payload).openClawExcellenceSeedGrowth;
  assert.equal(seed.rungProofCount, 1);
  assert.equal(seed.proofCount, 2);
});

test('one replayed proof ref cannot satisfy both OpenClaw agent inventories', () => {
  const payload = feed({ statusRecords: [heartbeat()] });
  const local = event('INVENTORY_BOTH_AGENTS', 'openclaw-local');
  const standalone = {
    ...event('INVENTORY_BOTH_AGENTS', 'openclaw-standalone'),
    proofRefs: [...local.proofRefs],
  };
  payload.records.eventRecords = [local, standalone];
  const seed = view(payload).openClawExcellenceSeedGrowth;
  assert.equal(seed.rungProofCount, 0, 'two agents require independently identifiable receipts');
  assert.equal(seed.proofCount, 1, 'replayed proof refs cannot inflate proof telemetry');
  assert.equal(seed.nextGrowthRung, 'INVENTORY_BOTH_AGENTS');
  assert.equal(pressure(payload).filter((item) =>
    item.seedId === OPENCLAW_EXCELLENCE_MISSION_ID)[0].pressureKey,
  'seed-3094:rung:inventory_both_agents');
});

test('replayed event identity cannot count as two independent OpenClaw inventory observations', () => {
  const payload = feed({ statusRecords: [heartbeat()] });
  const local = event('INVENTORY_BOTH_AGENTS', 'openclaw-local');
  const standalone = {
    ...event('INVENTORY_BOTH_AGENTS', 'openclaw-standalone'),
    eventId: local.eventId,
    proofRefs: ['proof/standalone-different-ref-same-event'],
  };
  payload.records.eventRecords = [local, standalone];
  let seed = view(payload).openClawExcellenceSeedGrowth;
  assert.equal(seed.rungProofCount, 0, 'one event cannot witness both agent inventories');
  assert.equal(seed.proofCount, 1, 'distinct proof refs do not rehabilitate a replayed event ID');
  assert.equal(seed.nextGrowthRung, 'INVENTORY_BOTH_AGENTS');

  payload.records.eventRecords = [
    local,
    { ...local, proofRefs: ['proof/local-different-ref-same-event'] },
  ];
  seed = view(payload).openClawExcellenceSeedGrowth;
  assert.equal(seed.proofCount, 1, 'same-agent event replay must not inflate proof telemetry');
});

test('self-attested endurance and continuous uplift never become trusted rung or proof telemetry', () => {
  for (const rung of ['PROVE_SOVEREIGN_ENDURANCE', 'CONTINUOUS_UPLIFT_AND_RETEST']) {
    const payload = feed({ statusRecords: [heartbeat()] });
    payload.records.eventRecords = [
      event(rung, 'openclaw-local'),
      event(rung, 'openclaw-standalone'),
    ];
    const seed = view(payload).openClawExcellenceSeedGrowth;
    assert.equal(seed.rungProofCount, 0, rung + ' must require trusted independent admission');
    assert.equal(seed.proofCount, 0, rung + ' must not inflate displayed proof');
    assert.equal(seed.nextGrowthRung, 'INVENTORY_BOTH_AGENTS');
  }
});

test('stale feed or stale source freshness cannot plant a fresh seed or show current/dispatch work', () => {
  for (const payload of [
    { ...feed({ statusRecords: [heartbeat(), event('INVENTORY_BOTH_AGENTS')] }), state: 'stale' },
    { ...feed({ statusRecords: [heartbeat()] }), projection: { sourceFreshness: { truth: 'STALE' } } },
    { ...feed({ statusRecords: [heartbeat()] }), errors: ['BACKEND_FEED_INVALID'] },
  ]) {
    const seed = view(payload).openClawExcellenceSeedGrowth;
    assert.equal(seed.planted, false);
    assert.notEqual(seed.sourceTruth, 'CURRENT');
    assert.equal(seed.pressureState, 'UNKNOWN');
    assert.equal(seed.rungProofCount, null);
    assert.deepEqual(pressure(payload), []);
  }
});


test('future-dated OpenClaw proof cannot advance seed rungs or inflate proof totals', () => {
  const inventory = 'INVENTORY_BOTH_AGENTS';
  const future = '2026-10-14T14:38:00.000Z';
  const payload = feed({ statusRecords: [heartbeat()] });
  payload.records.eventRecords = [
    event(inventory, 'openclaw-local'),
    { ...event(inventory, 'openclaw-standalone'), timestampUtc: future },
  ];
  let seed = view(payload).openClawExcellenceSeedGrowth;
  assert.equal(seed.planted, true);
  assert.equal(seed.nextGrowthRung, inventory);
  assert.equal(seed.rungProofCount, 0);
  assert.equal(seed.proofCount, 1);
  assert.equal(seed.latestEvidenceAt, '2026-10-13T14:38:00.000Z');

  // A forged future observation cannot become the latest proof or redirect
  // work pressure even when the enclosing feed and heartbeat are current.
  payload.records.eventRecords = [
    { ...event(inventory, 'openclaw-local'), timestampUtc: future },
    { ...event(inventory, 'openclaw-standalone'), timestampUtc: future },
  ];
  seed = view(payload).openClawExcellenceSeedGrowth;
  assert.equal(seed.nextGrowthRung, inventory);
  assert.equal(seed.rungProofCount, 0);
  assert.equal(seed.proofCount, 0);
  assert.equal(seed.latestEvidenceAt, '2026-10-13T14:35:00.000Z');
  const work = pressure(payload).filter((item) => item.seedId === OPENCLAW_EXCELLENCE_MISSION_ID);
  assert.equal(work.length, 1);
  assert.equal(work[0].pressureKey, 'seed-3094:rung:inventory_both_agents');
});

test('rejected or impersonated agent claims cannot refresh the last admitted evidence time', () => {
  const payload = feed({ statusRecords: [heartbeat()] });
  payload.records.eventRecords = [
    { ...event('QUALIFY_AGENT_SPECIFIC_SKILLS', 'openclaw-local'),
      timestampUtc: '2026-10-13T14:39:00.000Z' },
    { ...event('PROVE_END_TO_END_TASK_PARITY', 'openclaw-standalone'),
      timestampUtc: '2026-10-13T14:39:30.000Z' },
    { ...event('INVENTORY_BOTH_AGENTS', 'openclaw-local'),
      eventId: 'impersonated-inventory', participantId: 'openclaw-standalone',
      timestampUtc: '2026-10-13T14:39:45.000Z' },
  ];
  let seed = view(payload).openClawExcellenceSeedGrowth;
  assert.equal(seed.proofCount, 0);
  assert.equal(seed.rungProofCount, 0);
  assert.equal(seed.latestEvidenceAt, '2026-10-13T14:35:00.000Z');
  payload.records.eventRecords.push({
    ...event('INVENTORY_BOTH_AGENTS', 'openclaw-local'),
    timestampUtc: '2026-10-13T14:38:00.000Z',
  });
  seed = view(payload).openClawExcellenceSeedGrowth;
  assert.equal(seed.proofCount, 1);
  assert.equal(seed.latestEvidenceAt, '2026-10-13T14:38:00.000Z');
});


test('stale agent evidence cannot advance a newly refreshed OpenClaw seed heartbeat', () => {
  const inventory = 'INVENTORY_BOTH_AGENTS';
  const payload = feed({ statusRecords: [heartbeat()] });
  payload.records.eventRecords = [
    { ...event(inventory, 'openclaw-local'), timestampUtc: '2026-10-13T12:38:00.000Z' },
    { ...event(inventory, 'openclaw-standalone'), timestampUtc: '2026-10-13T12:39:00.000Z' },
  ];
  const stale = view(payload).openClawExcellenceSeedGrowth;
  assert.equal(stale.planted, true);
  assert.equal(stale.rungProofCount, 0);
  assert.equal(stale.proofCount, 0);
  assert.equal(stale.nextGrowthRung, inventory);
  assert.equal(stale.latestEvidenceAt, '2026-10-13T14:35:00.000Z');
  payload.records.eventRecords.push(event(inventory, 'openclaw-local'));
  const partial = view(payload).openClawExcellenceSeedGrowth;
  assert.equal(partial.rungProofCount, 0);
  assert.equal(partial.proofCount, 1);
  payload.records.eventRecords.push(event(inventory, 'openclaw-standalone'));
  const fresh = view(payload).openClawExcellenceSeedGrowth;
  assert.equal(fresh.rungProofCount, 1);
  assert.equal(fresh.proofCount, 2);
  assert.equal(fresh.nextGrowthRung, 'VERIFY_UPSTREAM_RELEASE_AND_SKILL_SAFETY');
});


test('newest valid OpenClaw heartbeat wins regardless of record order or invalid newer pulses', () => {
  const earlier = heartbeat('2026-10-13T14:05:00.000Z');
  const latest = heartbeat('2026-10-13T14:36:00.000Z');
  const spoofed = { ...heartbeat('2026-10-13T14:39:00.000Z'), relatedIssue: '#1657' };
  for (const statusRecords of [
    [earlier, latest, spoofed],
    [spoofed, latest, earlier],
  ]) {
    const seed = view(feed({ statusRecords })).openClawExcellenceSeedGrowth;
    assert.equal(seed.planted, true);
    assert.equal(seed.sourceTruth, 'CURRENT');
    assert.equal(seed.latestEvidenceAt, '2026-10-13T14:36:00.000Z');
    assert.equal(seed.proofCount, 0);
    assert.equal(seed.nextGrowthRung, 'INVENTORY_BOTH_AGENTS');
  }
});


test('OpenClaw gap pressure rejects records cross-bound to another mission or issue', () => {
  const payload = feed({ statusRecords: [heartbeat()] });
  const gap = {
    ...event('INVENTORY_BOTH_AGENTS'),
    eventId: 'agent-inventory-gap',
    status: 'BLOCKED',
    reason: 'missing capability: agent skill inventory',
    gapId: 'openclaw-agent-inventory-gap',
    capabilityId: 'openclaw-agent-inventory',
  };
  payload.records.eventRecords = [
    { ...gap, eventId: 'foreign-mission-gap', missionId: 'unrelated-mission' },
    { ...gap, eventId: 'foreign-issue-gap', relatedIssue: '#1657' },
  ];
  const rejected = view(payload).openClawExcellenceSeedGrowth;
  assert.equal(rejected.planted, true);
  assert.deepEqual(rejected.currentGaps, []);
  assert.equal(rejected.nextGrowthRung, 'INVENTORY_BOTH_AGENTS');
  assert.equal(rejected.pressureState, 'ACTIVE');
  payload.records.eventRecords.push(gap);
  const admitted = view(payload).openClawExcellenceSeedGrowth;
  assert.equal(admitted.currentGaps.length, 1);
  assert.equal(admitted.currentGaps[0].capabilityId, 'openclaw-agent-inventory');
  assert.match(admitted.nextBestAction, /missing capability: agent skill inventory/);
});

test('skill provenance packet cannot silently drop recipient separation or install proof gates', () => {
  // A documentation contract is not a skill installation or runtime witness.
  const packet = readFileSync(new URL('../../docs/architecture/openclaw-agent-skill-provenance-v1.md', import.meta.url), 'utf8');
  for (const principal of ['stephanos-scout-coder', 'openclaw-standalone']) {
    assert.ok(packet.includes('`' + principal + '`'), 'both original principals must remain explicit');
  }
  assert.match(packet, /approval for one recipient never authorizes the other/i);
  assert.match(packet, /Ten-question trust exam/);
  assert.match(packet, /independent exact-head qualified specialist review/);
  assert.match(packet, /Live post-install observation from the intended principal and machine/);
  assert.match(packet, /This does not establish Codex parity/);
  assert.match(packet, /never infer a physical pickup from GitHub CI/);
  const matrix = packet.split('## Negative acceptance matrix (mandatory fail-closed)')[1];
  assert.ok(matrix, 'mandatory negative acceptance matrix missing');
  for (const required of [
    'Upstream skill URL without pinned revision',
    'Skill manifest addressed to Local but proposed for Standalone',
    'Self-authored reviewer PASS or CI-only approval',
    'Correct source SHA but missing installed runtime principal',
    'Gaming active or GPU/CPU/model process-tree eviction unproven',
    'Unknown Windows writer/descendant/relaunch custody',
  ]) {
    assert.ok(matrix.includes(required), 'missing negative provenance case: ' + required);
  }
});
