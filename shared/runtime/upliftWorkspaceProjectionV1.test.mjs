import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveAgentsWorkspaceView, deriveFlywheelWorkspaceView } from './upliftWorkspaceProjectionV1.mjs';

function feed() {
  return {
    schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1',
    state: 'ready',
    exactNextAction: 'Replay the failed controller capability after repair.',
    records: {
      statusRecords: [
        { participantId: 'sovereign-commander', timestampUtc: '2026-10-02T20:00:00.000Z', status: 'CURRENT', missionId: 'm1', proofRefs: ['proof/sc-current'] },
      ],
      capabilityRecords: [],
      proofRecords: [],
      receiptRecords: [
        { kind: 'execution-receipt', participantId: 'builder-1', timestampUtc: '2026-10-02T20:05:00.000Z', state: 'stalled', missionId: 'm2', proofRefs: ['receipts/stall'] },
      ],
      eventRecords: [
        {
          kind: 'learning-event',
          participantId: 'builder-1',
          timestampUtc: '2026-10-02T20:06:00.000Z',
          eventKind: 'capability-gap',
          summary: 'Missing guarded runtime inspection route.',
          proofRefs: ['proof/gap'],
          closedLoopLearning: {
            learningEligibleCapabilityFailure: true,
            telemetry: { retryReady: false },
          },
        },
      ],
      lessonRecords: [
        { kind: 'lesson', participantId: 'stephanos', timestampUtc: '2026-10-02T20:07:00.000Z', summary: 'Reuse canonical receipts before claiming execution.' },
      ],
    },
  };
}

test('Flywheel workspace derives evidence-backed uplift and history from Shared Workspace records', () => {
  const view = deriveFlywheelWorkspaceView(feed());
  assert.equal(view.valid, true);
  assert.equal(view.sourceTruth, 'CURRENT');
  assert.equal(view.stats.observedAgents >= 2, true);
  assert.equal(view.stats.agentsNeedingUplift >= 1, true);
  assert.equal(view.stats.actionableLearningEvents, 1);
  assert.equal(view.timeline[0].type, 'LESSON');
  const builder = view.participants.find((entry) => entry.participantId === 'builder-1');
  assert.ok(builder);
  assert.equal(builder.capabilityGapCount, 1);
  assert.equal(builder.upliftNeedCount > 0, true);
});


test('Flywheel keeps the source-proven Starfield seed contract visible when live feed is unavailable', () => {
  const view = deriveFlywheelWorkspaceView({
    schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1',
    state: 'unavailable',
    records: {},
  });
  assert.equal(view.valid, false);
  assert.equal(view.outcomeSeedGrowth.declared, true);
  assert.equal(view.outcomeSeedGrowth.contractTruth, 'SOURCE_PROVEN');
  assert.equal(view.outcomeSeedGrowth.planted, false);
  assert.equal(view.outcomeSeedGrowth.stage, 'AWAITING_LIVE_PROOF');
  assert.match(view.outcomeSeedGrowth.northStar, /best VR experience achievable on the Battle Bridge/i);
  assert.deepEqual(view.outcomeSeedGrowth.preservedRoutes, ['mutar-openxr', 'vorpx']);
  assert.equal(view.outcomeSeedGrowth.operatingLoop[0], 'OBSERVE');
  assert.equal(view.outcomeSeedGrowth.operatingLoop.at(-1), 'REPEAT');
  assert.equal(view.outcomeSeedGrowth.sourceTruth, 'UNKNOWN');
});

test('Flywheel timeline distinguishes the 18 visible records from full learning history and carries canonical freshness', () => {
  const payload = feed();
  payload.projection = {
    sourceFreshness: {
      truth: 'STALE',
      ageMs: 7_200_000,
      observedAtUtc: '2026-10-02T18:00:00.000Z',
      staleAfterMs: 3_600_000,
      exactNextAction: 'Refresh the stale Shared Workspace record.',
    },
  };
  payload.state = 'stale';
  payload.records.eventRecords = Array.from({ length: 20 }, (_, index) => ({
    kind: 'learning-event',
    eventKind: 'learning-event',
    participantId: 'builder-1',
    timestampUtc: new Date(Date.parse('2026-10-02T20:30:00.000Z') + index * 1000).toISOString(),
    summary: `Learning event ${index + 1}`,
  }));

  const view = deriveFlywheelWorkspaceView(payload);
  assert.equal(view.timeline.length, 18);
  assert.equal(view.stats.timelineEvents, 18);
  assert.equal(view.stats.learningRecordsTotal, 22);
  assert.equal(view.stats.actionableLearningEvents, 0);
  assert.equal(view.sourceTruth, 'STALE');
  assert.equal(view.sourceFreshness.ageMs, 7_200_000);
  assert.equal(view.sourceFreshness.staleAfterMs, 3_600_000);
  assert.equal(view.sourceFreshness.observedAtUtc, '2026-10-02T18:00:00.000Z');
});

test('missing evidence stays UNKNOWN rather than inventing live agent quality', () => {
  const view = deriveAgentsWorkspaceView({
    payload: { schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1', state: 'unavailable', records: {} },
    finalAgentView: {
      visibleAgents: [{ agentId: 'new-agent', displayName: 'New Agent', kind: 'specialist', state: 'idle' }],
    },
  });
  assert.equal(view.agents[0].sharedWorkspaceTruth, 'UNKNOWN');
  assert.equal(view.agents[0].proofCount, 0);
  assert.deepEqual(view.agents[0].dimensions, []);
});

test('Agents workspace fuses runtime fleet identity with Shared Workspace uplift evidence', () => {
  const view = deriveAgentsWorkspaceView({
    payload: feed(),
    finalAgentView: {
      actingAgentId: 'sovereign-commander',
      visibleAgents: [
        { agentId: 'sovereign-commander', displayName: 'Sovereign Commander', kind: 'executor', state: 'acting', enabled: true, eligible: true, acting: true, capabilities: ['inspect-runtime'] },
        { agentId: 'builder-1', displayName: 'Builder 1', kind: 'builder', state: 'blocked', enabled: true, eligible: true, acting: false },
      ],
    },
  });
  assert.equal(view.valid, true);
  assert.equal(view.stats.runtimeVisibleAgents, 2);
  assert.equal(view.stats.actingAgents, 1);
  const commander = view.agents.find((entry) => entry.agentId === 'sovereign-commander');
  assert.equal(commander.sharedWorkspaceTruth, 'CURRENT');
  assert.equal(commander.proofCount, 1);
  const builder = view.agents.find((entry) => entry.agentId === 'builder-1');
  assert.equal(builder.capabilityGapCount, 1);
});


test('Starfield VR Outcome Ownership seed growth is derived from Shared Workspace evidence', () => {
  const base = feed();
  const payload = {
    ...base,
    records: {
      ...base.records,
      goalRecords: [
        {
          goalId: 'starfield-vr-outcome-ownership',
          participantId: 'flywheel',
          timestampUtc: '2026-10-02T20:08:00.000Z',
          status: 'bootstrap-active',
          outcomeOwnershipSeed: {
            schemaVersion: 'stephanos.starfield-vr-outcome-ownership-seed.v1',
            missionId: 'starfield-vr-outcome-ownership',
            northStar: 'Continuously improve Starfield VR.',
          },
        },
      ],
      eventRecords: [
        ...base.records.eventRecords,
        {
          eventId: 'starfield-vr-outcome-seed-planted',
          participantId: 'flywheel',
          timestampUtc: '2026-10-02T20:08:00.000Z',
          eventKind: 'outcome-ownership-seed',
          summary: 'Starfield VR seed planted.',
          outcomeOwnershipSeed: {
            missionId: 'starfield-vr-outcome-ownership',
            nextBestAction: 'Capture real Starfield VR evidence.',
          },
        },
        {
          eventId: 'vr-playtest-1',
          participantId: 'vr-playtest-bridge',
          timestampUtc: '2026-10-02T20:09:00.000Z',
          eventKind: 'vr-playtest-evidence',
          summary: 'Starfield operator headset playtest experiment captured.',
          vrEvidence: { game: 'Starfield', route: 'MutaR / OpenXR' },
        },
        {
          eventId: 'starfield-gap-1',
          participantId: 'sovereign-commander',
          timestampUtc: '2026-10-02T20:10:00.000Z',
          eventKind: 'capability-gap',
          summary: 'Starfield VR needs guarded frame-pacing inspection.',
          closedLoopLearning: {
            capabilityId: 'starfield-vr-frame-pacing-inspection',
            teacherId: 'sovereign-commander',
            state: 'PROOF_REQUIRED',
            learningEligibleCapabilityFailure: true,
            telemetry: { retryReady: false },
          },
        },
      ],
      lessonRecords: [
        ...base.records.lessonRecords,
        {
          lessonId: 'starfield-vr-aer-method',
          participantId: 'stephanos',
          timestampUtc: '2026-10-02T20:11:00.000Z',
          summary: 'Starfield VR AER motion evidence must be headset-proven.',
          engineeringRecord: { applicableDomains: ['starfield/vr', 'vr/aer'] },
        },
        {
          lessonId: 'generic-vr-aer-method',
          participantId: 'stephanos',
          timestampUtc: '2026-10-02T20:12:00.000Z',
          summary: 'Reusable AER pacing method.',
          sourceEventIds: ['vr-playtest-1'],
          engineeringRecord: { applicableDomains: ['vr/aer'] },
        },
      ],
    },
  };

  const view = deriveFlywheelWorkspaceView(payload);
  assert.equal(view.outcomeSeedGrowth.planted, true);
  assert.equal(view.outcomeSeedGrowth.stage, 'CAPABILITY_FORMING');
  assert.equal(view.outcomeSeedGrowth.playtestEvidenceCount, 1);
  assert.equal(view.outcomeSeedGrowth.experimentCount, 1);
  assert.equal(view.outcomeSeedGrowth.operatorObservationCount, 1);
  assert.equal(view.outcomeSeedGrowth.capabilityGapCount, 1);
  assert.equal(view.outcomeSeedGrowth.teachingLoopCount, 1);
  assert.equal(view.outcomeSeedGrowth.retryReadyCount, 0);
  assert.equal(view.outcomeSeedGrowth.retainedLessonCount, 1);
  assert.equal(view.outcomeSeedGrowth.promotedVrLessonCount, 1);
  assert.equal(view.outcomeSeedGrowth.currentGaps[0].capabilityId, 'starfield-vr-frame-pacing-inspection');
  assert.match(view.outcomeSeedGrowth.nextBestAction, /Close the next evidenced capability gap/);
});


test('Flywheel keeps the whole-system capability closure seed visible and truthful', () => {
  const unavailable = deriveFlywheelWorkspaceView({
    schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1',
    state: 'unavailable',
    records: {},
  });
  assert.equal(unavailable.wholeSystemSeedGrowth.declared, true);
  assert.equal(unavailable.wholeSystemSeedGrowth.contractTruth, 'SOURCE_PROVEN');
  assert.equal(unavailable.wholeSystemSeedGrowth.planted, false);
  assert.equal(unavailable.wholeSystemSeedGrowth.missionId, 'stephanos-whole-system-capability-closure');
  assert.equal(unavailable.wholeSystemSeedGrowth.issueRef, '#2670');
  assert.equal(unavailable.wholeSystemSeedGrowth.persistent, true);
  assert.equal(unavailable.outcomeSeeds.length, 2);
  assert.match(unavailable.wholeSystemSeedGrowth.nextBestAction, /Publish the #2670 mission heartbeat/i);

  const payload = feed();
  payload.records.eventRecords.push({
    eventId: 'whole-system-gap-1',
    missionId: 'stephanos-whole-system-capability-closure',
    participantId: 'flywheel',
    timestampUtc: '2026-10-03T12:30:00.000Z',
    eventKind: 'capability-gap',
    status: 'OPEN',
    summary: 'A material Stephanos capability gap is evidenced.',
    proofRefs: ['proof/whole-system-gap-1'],
  });
  const live = deriveFlywheelWorkspaceView(payload);
  assert.equal(live.wholeSystemSeedGrowth.planted, true);
  assert.equal(live.wholeSystemSeedGrowth.healthState, 'MATERIAL_GAPS_PRESENT');
  assert.equal(live.wholeSystemSeedGrowth.knownMaterialGapCount, 1);
  assert.equal(live.wholeSystemSeedGrowth.proofCount >= 1, true);
  assert.match(live.wholeSystemSeedGrowth.nextBestAction, /Close the next evidenced whole-system gap/i);
});


test('matching recovery clears current uplift without erasing historical gap evidence', () => {
  const payload = feed();
  payload.records.receiptRecords = [];
  payload.records.eventRecords = [
    {
      eventId: 'gap-history-1',
      participantId: 'vr-agent',
      timestampUtc: '2026-10-04T10:00:00.000Z',
      eventKind: 'capability-gap',
      capabilityId: 'temporal-stereo-proof',
      state: 'OPEN',
      summary: 'VR agent lacks temporal stereo proof.',
      proofRefs: ['proof/gap-open'],
      closedLoopLearning: {
        capabilityId: 'temporal-stereo-proof',
        learningEligibleCapabilityFailure: true,
        telemetry: { retryReady: false },
      },
    },
    {
      eventId: 'gap-history-2',
      participantId: 'vr-agent',
      timestampUtc: '2026-10-04T10:05:00.000Z',
      eventKind: 'capability-recovery',
      capabilityId: 'temporal-stereo-proof',
      state: 'RECOVERED',
      summary: 'Temporal stereo proof replay passed.',
      proofRefs: ['proof/gap-recovered'],
      closedLoopLearning: {
        capabilityId: 'temporal-stereo-proof',
        telemetry: { retryReady: true },
      },
    },
  ];
  payload.records.lessonRecords = [];

  const view = deriveAgentsWorkspaceView({ payload, finalAgentView: { visibleAgents: [] } });
  const agent = view.agents.find((entry) => entry.agentId === 'vr-agent');
  assert.ok(agent);
  assert.equal(agent.capabilityGapCount, 0);
  assert.equal(agent.historicalGapCount, 1);
  assert.equal(agent.resolvedGapCount, 1);
  assert.equal(agent.currentGaps.length, 0);
  assert.equal(view.stats.agentsNeedingUplift, 0);
  assert.equal(view.stats.resolvedHistoricalGaps, 1);
});

test('unrelated success cannot falsely close a different current uplift gap', () => {
  const payload = feed();
  payload.records.receiptRecords = [];
  payload.records.eventRecords = [
    {
      eventId: 'gap-unrelated-1',
      participantId: 'vr-agent',
      timestampUtc: '2026-10-04T10:00:00.000Z',
      eventKind: 'capability-gap',
      capabilityId: 'openxr-spatial-container-runtime-proof',
      state: 'OPEN',
      summary: 'Runtime proof for spatial containers is missing.',
      closedLoopLearning: {
        capabilityId: 'openxr-spatial-container-runtime-proof',
        learningEligibleCapabilityFailure: true,
        telemetry: { retryReady: false },
      },
    },
    {
      eventId: 'unrelated-success',
      participantId: 'vr-agent',
      timestampUtc: '2026-10-04T10:06:00.000Z',
      eventKind: 'capability-recovery',
      capabilityId: 'controller-input-proof',
      state: 'RECOVERED',
      summary: 'Controller input proof passed.',
      proofRefs: ['proof/controller-input'],
    },
  ];
  payload.records.lessonRecords = [];

  const view = deriveAgentsWorkspaceView({ payload, finalAgentView: { visibleAgents: [] } });
  const agent = view.agents.find((entry) => entry.agentId === 'vr-agent');
  assert.equal(agent.capabilityGapCount, 1);
  assert.equal(agent.currentGaps[0].capabilityId, 'openxr-spatial-container-runtime-proof');
  assert.equal(agent.upliftState, 'NEEDS_UPLIFT');
  assert.equal(view.stats.agentsNeedingUplift, 1);
});

test('later matching execution receipt supersedes historical failure for current scorecard', () => {
  const payload = feed();
  payload.records.eventRecords = [];
  payload.records.lessonRecords = [];
  payload.records.receiptRecords = [
    {
      kind: 'execution-receipt',
      participantId: 'builder-2',
      missionId: 'repair-same-task',
      timestampUtc: '2026-10-04T10:00:00.000Z',
      state: 'failed',
      proofRefs: ['proof/failure'],
    },
    {
      kind: 'execution-receipt',
      participantId: 'builder-2',
      missionId: 'repair-same-task',
      timestampUtc: '2026-10-04T10:10:00.000Z',
      state: 'completed',
      phase: 'retry-success',
      proofRefs: ['proof/recovery'],
    },
  ];

  const view = deriveAgentsWorkspaceView({ payload, finalAgentView: { visibleAgents: [] } });
  const agent = view.agents.find((entry) => entry.agentId === 'builder-2');
  const execution = agent.dimensions.find((entry) => entry.id === 'execution-reliability');
  assert.equal(execution.status, 'EVIDENCED');
  assert.equal(agent.upliftNeedCount, 0);
});

test('Agents workspace exposes a prioritized Flywheel uplift queue and growth frontier fields', () => {
  const view = deriveAgentsWorkspaceView({
    payload: feed(),
    finalAgentView: {
      visibleAgents: [
        { agentId: 'builder-1', displayName: 'Builder 1', kind: 'builder', state: 'blocked', enabled: true, eligible: true, acting: false, capabilities: ['build', 'test'] },
      ],
    },
  });
  assert.equal(view.upliftQueue.length >= 1, true);
  const builder = view.upliftQueue.find((entry) => entry.agentId === 'builder-1');
  assert.ok(builder);
  assert.equal(['CRITICAL', 'HIGH', 'MEDIUM'].includes(builder.upliftPriority), true);
  assert.equal(Array.isArray(builder.dimensionsNeedingUplift), true);
  assert.equal(Array.isArray(builder.evidencedDimensions), true);
  assert.equal(Array.isArray(builder.unknownDimensions), true);
  assert.match(builder.nextUpliftAction, /existing owner|canonical owner|prove|calibration/i);
  assert.equal(view.stats.currentGapSignals >= 1, true);
});
