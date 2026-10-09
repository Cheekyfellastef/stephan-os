import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveAgentsWorkspaceView, deriveFlywheelWorkspaceView } from './upliftWorkspaceProjectionV1.mjs';

function feed() {
  return {
    schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1',
    state: 'ready',
    exactNextAction: 'Replay the failed controller capability after repair.',
    brainState: {
      schemaVersion: 'stephanos.shared-workspace.brain-state.v1',
      state: 'CURRENT',
      reason: 'BRAIN_STATE_CURRENT',
      activeBrain: 'qwen3.5:27b',
      provider: 'ollama',
      reasoningMode: 'deep',
      escalationActive: true,
      fallbackUsed: false,
      loadMode: 'balanced',
      record: {
        summary: 'Stephanos brain state: qwen3.5:27b via ollama; reasoning=deep; escalation=active.',
        proofRefs: ['proof/brain-state-current'],
      },
    },
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
  assert.equal(view.brainBay.state, 'CURRENT');
  assert.equal(view.brainBay.model, 'qwen3.5:27b');
  assert.equal(view.brainBay.provider, 'ollama');
  assert.equal(view.brainBay.mode, 'deep');
  assert.equal(view.brainBay.source, 'canonical-brain-state');
  assert.deepEqual(view.brainBay.proofRefs, ['proof/brain-state-current']);
  assert.equal(view.timeline[0].type, 'LESSON');
  const builder = view.participants.find((entry) => entry.participantId === 'builder-1');
  assert.ok(builder);
  assert.equal(builder.capabilityGapCount, 1);
  assert.equal(builder.upliftNeedCount > 0, true);
});


test('passing logical controller pulse named Capability Gap Intake is not a current capability failure', () => {
  const payload = feed();
  payload.records.eventRecords = [];
  payload.records.receiptRecords = [];
  payload.records.statusRecords = [{
    kind: 'stephanos.shared_workspace.status',
    participantId: 'monitor-multiplexer',
    statusId: 'monitor-logical-goal-1721',
    timestampUtc: '2026-10-08T04:10:47.461Z',
    status: 'PASS',
    summary: 'Logical controller logical-goal-1721 pulse due: Goal: Ambient Question-to-Goal Capability Gap Intake V1',
    proofRefs: ['proof/logical-goal-1721'],
  }];
  payload.records.proofRecords = [{
    kind: 'stephanos.shared_workspace.proof',
    participantId: 'monitor-multiplexer',
    proofId: 'monitor-logical-goal-1721',
    timestampUtc: '2026-10-08T04:10:47.461Z',
    status: 'PASS',
    summary: 'Logical controller logical-goal-1721 pulse due: Goal: Ambient Question-to-Goal Capability Gap Intake V1',
    proofRefs: ['proof/logical-goal-1721'],
  }];
  const view = deriveFlywheelWorkspaceView(payload);
  const agent = view.participants.find((participant) => participant.participantId === 'monitor-multiplexer');
  assert.ok(agent);
  assert.equal(agent.capabilityGapCount, 0);
  assert.equal(agent.currentGaps.length, 0);
  assert.equal(view.stats.agentsNeedingUplift, 0);
});

test('typed capability failures remain visible despite successful record text nearby', () => {
  const payload = feed();
  payload.records.eventRecords = [];
  payload.records.receiptRecords = [];
  payload.records.statusRecords = [{
    kind: 'stephanos.shared_workspace.status',
    participantId: 'mission-orchestrator',
    timestampUtc: '2026-10-08T04:11:00.000Z',
    status: 'BLOCKED',
    summary: 'Post-sync runtime refresh BLOCKED_UNCLASSIFIED_RUNTIME_PATH',
    proofRefs: ['proof/runtime-refresh-blocked'],
  }];
  const view = deriveFlywheelWorkspaceView(payload);
  const agent = view.participants.find((participant) => participant.participantId === 'mission-orchestrator');
  assert.equal(agent.capabilityGapCount, 1);
  assert.equal(agent.currentGaps[0].summary, 'Post-sync runtime refresh BLOCKED_UNCLASSIFIED_RUNTIME_PATH');
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
      statusRecords: [
        ...base.records.statusRecords,
        {
          schemaVersion: 'shared-agent-workspace-record.v1',
          kind: 'stephanos.shared_workspace.status',
          statusId: 'starfield-vr-outcome-ownership',
          missionId: 'starfield-vr-outcome-ownership',
          participantId: 'flywheel',
          timestampUtc: '2026-10-02T20:08:00.000Z',
          status: 'BOOTSTRAP_ACTIVE',
          outcomeOwnershipSeed: {
            schemaVersion: 'stephanos.starfield-vr-outcome-ownership-seed.v1',
            missionId: 'starfield-vr-outcome-ownership',
            northStar: 'Continuously improve Starfield VR.',
          },
        },
      ],
      goalRecords: [],
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
  assert.equal(view.outcomeSeedGrowth.sourceTruth, 'CURRENT');
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
  assert.equal(unavailable.outcomeSeeds.length, 7);
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


test('Flywheel exposes Stephanos Runs the Project as a persistent evidence-backed seed', () => {
  const unavailable = deriveFlywheelWorkspaceView({
    schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1',
    state: 'unavailable',
    records: {},
  });
  assert.equal(unavailable.autonomousProjectSeedGrowth.declared, true);
  assert.equal(unavailable.autonomousProjectSeedGrowth.contractTruth, 'SOURCE_PROVEN');
  assert.equal(unavailable.autonomousProjectSeedGrowth.planted, false);
  assert.equal(unavailable.autonomousProjectSeedGrowth.missionId, 'stephanos-runs-the-project');
  assert.equal(unavailable.autonomousProjectSeedGrowth.issueRef, '#2796');
  assert.equal(unavailable.autonomousProjectSeedGrowth.currentRung, 'AWAITING_LIVE_PROOF');
  assert.equal(unavailable.autonomousProjectSeedGrowth.autonomyVerdict, 'NOT_PROVED_YET');
  assert.match(unavailable.autonomousProjectSeedGrowth.northStar, /without routine operator or ChatGPT pokes/);

  const payload = feed();
  payload.records.eventRecords.push(
    {
      eventId: 'autonomy-choice-1',
      missionId: 'stephanos-runs-the-project',
      participantId: 'stephanos',
      timestampUtc: '2026-10-06T08:00:00.000Z',
      eventKind: 'foreman-goal-selection',
      status: 'CURRENT',
      summary: 'Stephanos Foreman chose the next valuable rung from canonical project truth.',
      proofRefs: ['proof/autonomy-choice-1'],
      autonomyProvenance: {
        schemaVersion: 'stephanos.autonomy-provenance.v1',
        missionId: 'stephanos-runs-the-project',
        initiatorId: 'stephanos-foreman',
        triggerClass: 'autonomous-loop',
        operatorInitiated: false,
        chatgptInitiated: false,
        manualPoke: false,
      },
    },
    {
      eventId: 'autonomy-pickup-1',
      missionId: 'stephanos-runs-the-project',
      participantId: 'scheduler',
      timestampUtc: '2026-10-06T08:01:00.000Z',
      eventKind: 'worker-pickup-proof',
      status: 'CURRENT',
      summary: 'Delegated work received a real worker claim under pickup pressure.',
      proofRefs: ['proof/autonomy-pickup-1'],
      autonomyProvenance: {
        schemaVersion: 'stephanos.autonomy-provenance.v1',
        missionId: 'stephanos-runs-the-project',
        initiatorId: 'stephanos-foreman',
        triggerClass: 'autonomous-loop',
        operatorInitiated: false,
        chatgptInitiated: false,
        manualPoke: false,
      },
    },
    {
      eventId: 'autonomy-complete-1',
      missionId: 'stephanos-runs-the-project',
      participantId: 'builder',
      timestampUtc: '2026-10-06T08:02:00.000Z',
      eventKind: 'build-completed',
      status: 'CURRENT',
      summary: 'Owned work completed and was verified.',
      proofRefs: ['proof/autonomy-complete-1'],
      autonomyProvenance: {
        schemaVersion: 'stephanos.autonomy-provenance.v1',
        missionId: 'stephanos-runs-the-project',
        initiatorId: 'stephanos-foreman',
        triggerClass: 'autonomous-loop',
        operatorInitiated: false,
        chatgptInitiated: false,
        manualPoke: false,
      },
    },
    {
      eventId: 'autonomy-replan-1',
      missionId: 'stephanos-runs-the-project',
      participantId: 'stephanos',
      timestampUtc: '2026-10-06T08:03:00.000Z',
      eventKind: 'foreman-next-rung',
      status: 'CURRENT',
      summary: 'Foreman replanned into the next rung without waiting for a manual poke.',
      proofRefs: ['proof/autonomy-replan-1'],
      autonomyProvenance: {
        schemaVersion: 'stephanos.autonomy-provenance.v1',
        missionId: 'stephanos-runs-the-project',
        initiatorId: 'stephanos-foreman',
        triggerClass: 'autonomous-loop',
        operatorInitiated: false,
        chatgptInitiated: false,
        manualPoke: false,
      },
    },
    {
      eventId: 'autonomy-cycle-1',
      missionId: 'stephanos-runs-the-project',
      participantId: 'stephanos',
      timestampUtc: '2026-10-06T08:04:00.000Z',
      eventKind: 'foreman-autonomous-cycle',
      status: 'CURRENT',
      summary: 'Unprompted Foreman cycle selected, dispatched, completed, proved and replanned.',
      proofRefs: ['proof/autonomy-cycle-1'],
      autonomyProvenance: {
        schemaVersion: 'stephanos.autonomy-provenance.v1',
        missionId: 'stephanos-runs-the-project',
        initiatorId: 'stephanos-foreman',
        triggerClass: 'autonomous-loop',
        operatorInitiated: false,
        chatgptInitiated: false,
        manualPoke: false,
      },
    },
    {
      eventId: 'autonomy-cycle-2',
      missionId: 'stephanos-runs-the-project',
      participantId: 'stephanos',
      timestampUtc: '2026-10-06T08:05:00.000Z',
      eventKind: 'foreman-autonomous-cycle',
      status: 'CURRENT',
      summary: 'Second unprompted Foreman cycle selected, dispatched, completed, proved and replanned.',
      proofRefs: ['proof/autonomy-cycle-2'],
      autonomyProvenance: {
        schemaVersion: 'stephanos.autonomy-provenance.v1',
        missionId: 'stephanos-runs-the-project',
        initiatorId: 'stephanos-foreman',
        triggerClass: 'autonomous-loop',
        operatorInitiated: false,
        chatgptInitiated: false,
        manualPoke: false,
      },
    },
  );

  const live = deriveFlywheelWorkspaceView(payload);
  assert.equal(live.autonomousProjectSeedGrowth.planted, true);
  assert.equal(live.autonomousProjectSeedGrowth.currentRungIndex >= 5, true);
  assert.equal(live.autonomousProjectSeedGrowth.pickupProofCount >= 1, true);
  assert.equal(live.autonomousProjectSeedGrowth.completionProofCount >= 1, true);
  assert.equal(live.autonomousProjectSeedGrowth.replanCount >= 1, true);
  assert.equal(live.autonomousProjectSeedGrowth.autonomyVerdict, 'YES');
  assert.equal(live.autonomousProjectSeedGrowth.provedAutonomousCycleCount, 2);
  assert.equal(live.outcomeSeeds.length, 6);
  assert.match(live.autonomousProjectSeedGrowth.nextBestAction, /Repeat|ratchet/i);
});


test('Flywheel exposes Teach Sovereign Commander Everything Remote Desktop Commander Can Do Safely as a persistent seed', () => {
  const unavailable = deriveFlywheelWorkspaceView({
    schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1',
    state: 'unavailable',
    records: {},
  });
  assert.equal(unavailable.sovereignCommanderParitySeedGrowth.declared, true);
  assert.equal(unavailable.sovereignCommanderParitySeedGrowth.contractTruth, 'SOURCE_PROVEN');
  assert.equal(unavailable.sovereignCommanderParitySeedGrowth.planted, false);
  assert.equal(unavailable.sovereignCommanderParitySeedGrowth.missionId, 'sovereign-commander-safe-parity');
  assert.equal(unavailable.sovereignCommanderParitySeedGrowth.issueRef, '#2519');
  assert.equal(unavailable.sovereignCommanderParitySeedGrowth.currentRung, 'AWAITING_LIVE_PROOF');
  assert.match(unavailable.sovereignCommanderParitySeedGrowth.northStar, /everything that Remote Desktop Commander can do safely/i);

  const heartbeatOnlyPayload = feed();
  heartbeatOnlyPayload.records.statusRecords.push({
    statusId: 'sovereign-commander-safe-parity',
    missionId: 'sovereign-commander-safe-parity',
    relatedIssue: '#2519',
    participantId: 'flywheel',
    timestampUtc: '2026-10-07T18:39:00.000Z',
    status: 'SEED_ACTIVE',
    title: 'Teach Sovereign Commander Everything Remote Desktop Commander Can Do Safely',
    summary: 'Teach Sovereign Commander Everything Remote Desktop Commander Can Do Safely persistent seed heartbeat is active.',
    proofRefs: ['proof/source-seed-contract'],
    seedHeartbeat: {
      schemaVersion: 'stephanos.high-level-flywheel-seed-heartbeat.v1',
      missionId: 'sovereign-commander-safe-parity',
      issueRef: '#2519',
    },
  });
  const heartbeatOnly = deriveFlywheelWorkspaceView(heartbeatOnlyPayload);
  assert.equal(heartbeatOnly.sovereignCommanderParitySeedGrowth.planted, true);
  assert.equal(heartbeatOnly.sovereignCommanderParitySeedGrowth.remoteObservationCount, 0);
  assert.equal(heartbeatOnly.sovereignCommanderParitySeedGrowth.parityGapSignalCount, 0);
  assert.equal(heartbeatOnly.sovereignCommanderParitySeedGrowth.currentRung, 'SEE_REMOTE_CAPABILITY');
  assert.equal(heartbeatOnly.sovereignCommanderParitySeedGrowth.pressureState, 'ACTIVE');
  assert.match(heartbeatOnly.sovereignCommanderParitySeedGrowth.nextBestAction, /Capture the next useful Remote Desktop Commander operation/i);

  const payload = feed();
  payload.records.eventRecords.push(
    {
      eventId: 'commander-parity-observe-1',
      missionId: 'sovereign-commander-safe-parity',
      relatedIssue: '#2519',
      participantId: 'flywheel',
      timestampUtc: '2026-10-07T18:40:00.000Z',
      eventKind: 'remote-commander-capability-observed',
      status: 'CURRENT',
      summary: 'Remote Desktop Commander file edit observed as a Sovereign Commander parity teaching event.',
      proofRefs: ['proof/commander-parity-observe-1'],
    },
    {
      eventId: 'commander-parity-gap-1',
      missionId: 'sovereign-commander-safe-parity',
      relatedIssue: '#2519',
      participantId: 'flywheel',
      timestampUtc: '2026-10-07T18:41:00.000Z',
      eventKind: 'capability-gap',
      status: 'CURRENT',
      capabilityId: 'guarded-text-edit',
      summary: 'Sovereign Commander missing parity for guarded text edit; capability debt recorded.',
      proofRefs: ['proof/commander-parity-gap-1'],
    },
    {
      eventId: 'commander-parity-safe-1',
      missionId: 'sovereign-commander-safe-parity',
      participantId: 'sovereign-commander',
      timestampUtc: '2026-10-07T18:42:00.000Z',
      eventKind: 'safety-classification',
      status: 'CURRENT',
      summary: 'Guarded text edit classified as bounded and protected by approval guardrails.',
      proofRefs: ['proof/commander-parity-safe-1'],
    },
    {
      eventId: 'commander-parity-build-1',
      missionId: 'sovereign-commander-safe-parity',
      participantId: 'sovereign-commander',
      timestampUtc: '2026-10-07T18:43:00.000Z',
      eventKind: 'native-capability-implemented',
      status: 'CURRENT',
      summary: 'Sovereign Commander native capability implemented for bounded guarded text edit.',
      proofRefs: ['proof/commander-parity-build-1'],
    },
    {
      eventId: 'commander-parity-proof-1',
      missionId: 'sovereign-commander-safe-parity',
      participantId: 'sovereign-commander',
      timestampUtc: '2026-10-07T18:44:00.000Z',
      eventKind: 'parity-proof',
      status: 'CURRENT',
      state: 'VERIFIED',
      resolvedGapId: 'guarded-text-edit',
      summary: 'Representative task replay proved equivalent safe parity through Sovereign Commander.',
      proofRefs: ['proof/commander-parity-proof-1'],
    },
    {
      eventId: 'commander-parity-route-1',
      missionId: 'sovereign-commander-safe-parity',
      participantId: 'router',
      timestampUtc: '2026-10-07T18:45:00.000Z',
      eventKind: 'sovereign-routing-qualified',
      status: 'CURRENT',
      summary: 'Qualified capability routed through Sovereign Commander and preferred for ordinary work.',
      proofRefs: ['proof/commander-parity-route-1'],
    },
    {
      eventId: 'commander-parity-audit-1',
      missionId: 'sovereign-commander-safe-parity',
      participantId: 'flywheel',
      timestampUtc: '2026-10-07T18:46:00.000Z',
      eventKind: 'continuous-parity-audit',
      status: 'CURRENT',
      summary: 'Continuous parity audit compared recent Remote Commander capabilities with qualified Sovereign Commander capabilities.',
      proofRefs: ['proof/commander-parity-audit-1'],
    },
  );

  const live = deriveFlywheelWorkspaceView(payload);
  assert.equal(live.sovereignCommanderParitySeedGrowth.planted, true);
  assert.equal(live.sovereignCommanderParitySeedGrowth.currentRung, 'CONTINUOUS_AUDIT');
  assert.equal(live.sovereignCommanderParitySeedGrowth.remoteObservationCount >= 1, true);
  assert.equal(live.sovereignCommanderParitySeedGrowth.safetyClassificationProofCount >= 1, true);
  assert.equal(live.sovereignCommanderParitySeedGrowth.nativeImplementationProofCount >= 1, true);
  assert.equal(live.sovereignCommanderParitySeedGrowth.parityProofCount >= 1, true);
  assert.equal(live.sovereignCommanderParitySeedGrowth.sovereignRoutingProofCount >= 1, true);
  assert.equal(live.sovereignCommanderParitySeedGrowth.auditProofCount >= 1, true);
  assert.equal(live.sovereignCommanderParitySeedGrowth.currentGaps.length, 0);
  assert.match(live.sovereignCommanderParitySeedGrowth.nextBestAction, /Keep auditing Remote Commander capability use/i);
});


test('operator and ChatGPT-pushed work improves project proof but earns zero Foreman autonomy credit', () => {
  const payload = feed();
  payload.records.eventRecords = [
    {
      eventId: 'manual-choice-1',
      missionId: 'stephanos-runs-the-project',
      participantId: 'stephanos',
      requestedBy: 'operator',
      timestampUtc: '2026-10-06T08:30:00.000Z',
      eventKind: 'foreman-goal-selection',
      status: 'CURRENT',
      summary: 'Foreman selected work after an operator poke.',
      proofRefs: ['proof/manual-choice-1'],
      autonomyProvenance: {
        schemaVersion: 'stephanos.autonomy-provenance.v1',
        missionId: 'stephanos-runs-the-project',
        initiatorId: 'stephanos-foreman',
        triggerClass: 'operator-prompt',
        operatorInitiated: true,
        chatgptInitiated: false,
        manualPoke: true,
      },
    },
    {
      eventId: 'chatgpt-cycle-1',
      missionId: 'stephanos-runs-the-project',
      participantId: 'stephanos',
      requestedBy: 'chatgpt-bridge',
      timestampUtc: '2026-10-06T08:31:00.000Z',
      eventKind: 'foreman-autonomous-cycle',
      status: 'CURRENT',
      summary: 'A cycle completed after ChatGPT pushed the work through.',
      proofRefs: ['proof/chatgpt-cycle-1'],
      autonomyProvenance: {
        schemaVersion: 'stephanos.autonomy-provenance.v1',
        missionId: 'stephanos-runs-the-project',
        initiatorId: 'stephanos-foreman',
        triggerClass: 'chatgpt-prompt',
        operatorInitiated: false,
        chatgptInitiated: true,
        manualPoke: true,
      },
    },
  ];
  payload.records.receiptRecords = [];
  payload.records.lessonRecords = [];
  payload.records.proofRecords = [];

  const view = deriveFlywheelWorkspaceView(payload);
  assert.equal(view.autonomousProjectSeedGrowth.projectActivityProofCount, 2);
  assert.equal(view.autonomousProjectSeedGrowth.autonomyEligibleProofCount, 0);
  assert.equal(view.autonomousProjectSeedGrowth.autonomyExcludedProofCount, 2);
  assert.equal(view.autonomousProjectSeedGrowth.explicitlyAssistedProofCount, 2);
  assert.equal(view.autonomousProjectSeedGrowth.decisionCount, 0);
  assert.equal(view.autonomousProjectSeedGrowth.provedAutonomousCycleCount, 0);
  assert.equal(view.autonomousProjectSeedGrowth.autonomyVerdict, 'NOT_PROVED_YET');
  assert.equal(view.autonomousProjectSeedGrowth.currentRungIndex, 0);
});

test('missing autonomy provenance never earns autonomous credit by inference', () => {
  const payload = feed();
  payload.records.eventRecords = [{
    eventId: 'unattributed-cycle-1',
    missionId: 'stephanos-runs-the-project',
    participantId: 'stephanos',
    timestampUtc: '2026-10-06T08:32:00.000Z',
    eventKind: 'foreman-autonomous-cycle',
    status: 'CURRENT',
    summary: 'Cycle claims to be autonomous but carries no provenance contract.',
    proofRefs: ['proof/unattributed-cycle-1'],
  }];
  payload.records.receiptRecords = [];
  payload.records.lessonRecords = [];
  payload.records.proofRecords = [];

  const view = deriveFlywheelWorkspaceView(payload);
  assert.equal(view.autonomousProjectSeedGrowth.projectActivityProofCount, 1);
  assert.equal(view.autonomousProjectSeedGrowth.autonomyEligibleProofCount, 0);
  assert.equal(view.autonomousProjectSeedGrowth.unattributedProofCount, 1);
  assert.equal(view.autonomousProjectSeedGrowth.provedAutonomousCycleCount, 0);
  assert.equal(view.autonomousProjectSeedGrowth.autonomyVerdict, 'NOT_PROVED_YET');
});


test('Foreman autonomy verdict says NO only for a current explicit autonomy blocker', () => {
  const payload = feed();
  payload.records.eventRecords = [{
    eventId: 'autonomy-blocked-1',
    missionId: 'stephanos-runs-the-project',
    participantId: 'stephanos',
    timestampUtc: '2026-10-06T08:10:00.000Z',
    eventKind: 'foreman-build-state',
    status: 'BLOCKED',
    summary: 'Foreman autonomous build is blocked because no worker can claim the dispatched lane.',
    proofRefs: ['proof/autonomy-blocked-1'],
  }];
  payload.records.receiptRecords = [];
  payload.records.lessonRecords = [];
  payload.records.proofRecords = [];

  const view = deriveFlywheelWorkspaceView(payload);
  assert.equal(view.autonomousProjectSeedGrowth.autonomyVerdict, 'NO');
  assert.match(view.autonomousProjectSeedGrowth.autonomyVerdictBasis, /no worker can claim/i);
});

test('explicit canonical operator observation can truthfully hold Foreman autonomy at NO', () => {
  const payload = feed();
  payload.records.eventRecords = [{
    eventId: 'operator-autonomy-no-1',
    missionId: 'stephanos-runs-the-project',
    participantId: 'stephan',
    participantRole: 'operator',
    timestampUtc: '2026-10-06T09:45:00.000Z',
    eventKind: 'operator-autonomy-observation',
    status: 'CURRENT',
    summary: 'From the live project it looks like a massive no; Stephanos still needs manual pokes to build.',
    operatorAutonomyObservation: {
      schemaVersion: 'stephanos.operator-autonomy-observation.v1',
      missionId: 'stephanos-runs-the-project',
      observerRole: 'operator',
      verdict: 'NO',
    },
  }];
  payload.records.receiptRecords = [];
  payload.records.lessonRecords = [];
  payload.records.proofRecords = [];

  const view = deriveFlywheelWorkspaceView(payload);
  assert.equal(view.autonomousProjectSeedGrowth.autonomyVerdict, 'NO');
  assert.equal(view.autonomousProjectSeedGrowth.operatorAutonomyObservationCount, 1);
  assert.match(view.autonomousProjectSeedGrowth.autonomyVerdictBasis, /Operator observes Stephanos is not building autonomously/i);
  assert.match(view.autonomousProjectSeedGrowth.nextBestAction, /operator-visible autonomy failure/i);
});

test('generic operator conversation text cannot accidentally force the Foreman seed to NO', () => {
  const payload = feed();
  payload.records.eventRecords = [{
    eventId: 'operator-chat-1',
    missionId: 'stephanos-runs-the-project',
    participantId: 'stephan',
    participantRole: 'operator',
    timestampUtc: '2026-10-06T09:46:00.000Z',
    eventKind: 'conversation-turn',
    status: 'CURRENT',
    summary: 'It looks like a massive no from here.',
  }];
  payload.records.receiptRecords = [];
  payload.records.lessonRecords = [];
  payload.records.proofRecords = [];

  const view = deriveFlywheelWorkspaceView(payload);
  assert.equal(view.autonomousProjectSeedGrowth.autonomyVerdict, 'NOT_PROVED_YET');
  assert.equal(view.autonomousProjectSeedGrowth.operatorAutonomyObservationCount, 0);
});


test('Foreman autonomy verdict stays NOT_PROVED_YET after only one proved unprompted cycle', () => {
  const payload = feed();
  payload.records.eventRecords = [{
    eventId: 'autonomy-cycle-only-1',
    missionId: 'stephanos-runs-the-project',
    participantId: 'stephanos',
    timestampUtc: '2026-10-06T08:20:00.000Z',
    eventKind: 'foreman-autonomous-cycle',
    status: 'CURRENT',
    summary: 'One unprompted Foreman cycle completed and replanned.',
    proofRefs: ['proof/autonomy-cycle-only-1'],
    autonomyProvenance: {
      schemaVersion: 'stephanos.autonomy-provenance.v1',
      missionId: 'stephanos-runs-the-project',
      initiatorId: 'stephanos-foreman',
      triggerClass: 'autonomous-loop',
      operatorInitiated: false,
      chatgptInitiated: false,
      manualPoke: false,
    },
  }];
  payload.records.receiptRecords = [];
  payload.records.lessonRecords = [];
  payload.records.proofRecords = [];

  const view = deriveFlywheelWorkspaceView(payload);
  assert.equal(view.autonomousProjectSeedGrowth.autonomyVerdict, 'NOT_PROVED_YET');
  assert.equal(view.autonomousProjectSeedGrowth.provedAutonomousCycleCount, 1);
});


test('Flywheel exposes conversational intelligence as a persistent evidence-backed seed', () => {
  const unavailable = deriveFlywheelWorkspaceView({
    schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1',
    state: 'unavailable',
    records: {},
  });
  assert.equal(unavailable.conversationalIntelligenceSeedGrowth.declared, true);
  assert.equal(unavailable.conversationalIntelligenceSeedGrowth.contractTruth, 'SOURCE_PROVEN');
  assert.equal(unavailable.conversationalIntelligenceSeedGrowth.planted, false);
  assert.equal(unavailable.conversationalIntelligenceSeedGrowth.missionId, 'stephanos-flywheel-conversational-intelligence');
  assert.equal(unavailable.conversationalIntelligenceSeedGrowth.issueRef, '#2798');
  assert.equal(unavailable.conversationalIntelligenceSeedGrowth.currentRung, 'AWAITING_LIVE_PROOF');
  assert.match(unavailable.conversationalIntelligenceSeedGrowth.northStar, /coherent, context-rich, grounded, insightful/);

  const payload = feed();
  payload.records.eventRecords.push(
    {
      eventId: 'conversation-intent-1',
      missionId: 'stephanos-flywheel-conversational-intelligence',
      participantId: 'stephanos',
      timestampUtc: '2026-10-06T09:09:00.000Z',
      eventKind: 'conversation-turn',
      status: 'CURRENT',
      summary: 'Stephanos bound the operator question to the active shared conversation intent.',
      proofRefs: ['proof/conversation-intent-1'],
    },
    {
      eventId: 'conversation-context-1',
      missionId: 'stephanos-flywheel-conversational-intelligence',
      participantId: 'stephanos',
      timestampUtc: '2026-10-06T09:10:00.000Z',
      eventKind: 'conversation-continuity-proof',
      status: 'CURRENT',
      summary: 'Shared conversation retained relevant context from the previous turn.',
      proofRefs: ['proof/conversation-context-1'],
    },
    {
      eventId: 'conversation-grounding-1',
      missionId: 'stephanos-flywheel-conversational-intelligence',
      participantId: 'stephanos',
      timestampUtc: '2026-10-06T09:11:00.000Z',
      eventKind: 'project-intelligence-grounding',
      status: 'CURRENT',
      summary: 'Project Intelligence grounded the response in canonical Shared Workspace goal truth.',
      proofRefs: ['proof/conversation-grounding-1'],
    },
    {
      eventId: 'conversation-brain-1',
      missionId: 'stephanos-flywheel-conversational-intelligence',
      participantId: 'flywheel',
      timestampUtc: '2026-10-06T09:12:00.000Z',
      eventKind: 'brain-routing-receipt',
      status: 'CURRENT',
      summary: 'Brain router escalated deep reasoning under uplift pressure.',
      model: 'qwen3.5:27b',
      reasoningMode: 'deep',
      proofRefs: ['proof/conversation-brain-1'],
    },
    {
      eventId: 'conversation-coherence-1',
      missionId: 'stephanos-flywheel-conversational-intelligence',
      participantId: 'stephanos',
      timestampUtc: '2026-10-06T09:13:00.000Z',
      eventKind: 'conversation-quality-evaluation',
      status: 'CURRENT',
      summary: 'Conversation coherence evaluation passed and lesson was retained for the next conversation.',
      proofRefs: ['proof/conversation-coherence-1'],
    },
  );

  const live = deriveFlywheelWorkspaceView(payload);
  assert.equal(live.conversationalIntelligenceSeedGrowth.planted, true);
  assert.equal(live.conversationalIntelligenceSeedGrowth.currentRungIndex >= 6, true);
  assert.equal(live.conversationalIntelligenceSeedGrowth.contextSignalCount >= 1, true);
  assert.equal(live.conversationalIntelligenceSeedGrowth.groundingSignalCount >= 1, true);
  assert.equal(live.conversationalIntelligenceSeedGrowth.brainSignalCount >= 1, true);
  assert.equal(live.conversationalIntelligenceSeedGrowth.coherenceSignalCount >= 1, true);
  assert.equal(live.outcomeSeeds.length, 6);
  assert.match(live.conversationalIntelligenceSeedGrowth.nextBestAction, /next conversation|ratcheting|retained lessons/i);
});


test('unrelated ChatGPT/provider records cannot falsely plant conversational intelligence', () => {
  const payload = feed();
  payload.records.eventRecords = [{
    eventId: 'provider-capacity-1',
    participantId: 'runtime-router',
    timestampUtc: '2026-10-06T09:20:00.000Z',
    eventKind: 'provider-capacity',
    status: 'CURRENT',
    summary: 'ChatGPT provider capacity changed while qwen model remained available.',
    model: 'qwen3.5:27b',
    provider: 'openai',
    proofRefs: ['proof/provider-capacity-1'],
  }];
  payload.records.receiptRecords = [];
  payload.records.lessonRecords = [];
  payload.records.proofRecords = [];
  payload.records.goalRecords = [];

  const view = deriveFlywheelWorkspaceView(payload);
  assert.equal(view.conversationalIntelligenceSeedGrowth.planted, false);
  assert.equal(view.conversationalIntelligenceSeedGrowth.currentRung, 'AWAITING_LIVE_PROOF');
  assert.equal(view.conversationalIntelligenceSeedGrowth.proofCount, null);
});

test('conversational intelligence cannot skip earlier rungs on proofless later-stage keywords', () => {
  const payload = feed();
  payload.records.eventRecords = [{
    eventId: 'conversation-quality-queued',
    missionId: 'stephanos-flywheel-conversational-intelligence',
    participantId: 'flywheel',
    timestampUtc: '2026-10-06T09:21:00.000Z',
    eventKind: 'conversation-quality-evaluation',
    status: 'CURRENT',
    summary: 'Conversation quality evaluation queued for deep reasoning, coherence and retained learning.',
  }];
  payload.records.receiptRecords = [];
  payload.records.lessonRecords = [];
  payload.records.proofRecords = [];
  payload.records.goalRecords = [];

  const view = deriveFlywheelWorkspaceView(payload);
  assert.equal(view.conversationalIntelligenceSeedGrowth.planted, true);
  assert.equal(view.conversationalIntelligenceSeedGrowth.currentRungIndex, 0);
  assert.equal(view.conversationalIntelligenceSeedGrowth.currentRung, 'HEAR_INTENT');
  assert.equal(view.conversationalIntelligenceSeedGrowth.proofCount, 0);
  assert.match(view.conversationalIntelligenceSeedGrowth.nextBestAction, /hears and binds the operator intent/i);
});

test('conversational intelligence requires proved prior rungs before later proof advances growth', () => {
  const payload = feed();
  payload.records.eventRecords = [{
    eventId: 'conversation-coherence-only',
    missionId: 'stephanos-flywheel-conversational-intelligence',
    participantId: 'stephanos',
    timestampUtc: '2026-10-06T09:22:00.000Z',
    eventKind: 'conversation-quality-evaluation',
    status: 'CURRENT',
    summary: 'Conversation coherence and learning evaluation passed with deep reasoning.',
    proofRefs: ['proof/conversation-coherence-only'],
  }];
  payload.records.receiptRecords = [];
  payload.records.lessonRecords = [];
  payload.records.proofRecords = [];
  payload.records.goalRecords = [];

  const view = deriveFlywheelWorkspaceView(payload);
  assert.equal(view.conversationalIntelligenceSeedGrowth.planted, true);
  assert.equal(view.conversationalIntelligenceSeedGrowth.currentRungIndex, 0);
  assert.equal(view.conversationalIntelligenceSeedGrowth.contextSignalCount, 0);
  assert.equal(view.conversationalIntelligenceSeedGrowth.groundingSignalCount, 0);
  assert.equal(view.conversationalIntelligenceSeedGrowth.brainSignalCount, 0);
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


test('selected agent timeline survives newer fleet-wide evidence noise', () => {
  const payload = feed();
  payload.records.eventRecords = [
    {
      kind: 'learning-event',
      participantId: 'quiet-specialist',
      timestampUtc: '2026-10-02T19:00:00.000Z',
      eventKind: 'method-improvement',
      summary: 'Quiet specialist retained an important older method.',
      proofRefs: ['proof/quiet-specialist'],
    },
    ...Array.from({ length: 24 }, (_, index) => ({
      kind: 'learning-event',
      participantId: 'noisy-agent',
      timestampUtc: new Date(Date.parse('2026-10-02T20:30:00.000Z') + index * 1000).toISOString(),
      eventKind: 'method-improvement',
      summary: `Noisy fleet event ${index + 1}`,
    })),
  ];
  payload.records.receiptRecords = [];
  payload.records.lessonRecords = [];

  const view = deriveAgentsWorkspaceView({ payload, finalAgentView: { visibleAgents: [] } });
  const quiet = view.agents.find((entry) => entry.agentId === 'quiet-specialist');
  assert.ok(quiet);
  assert.equal(quiet.evidenceTimeline.length, 1);
  assert.equal(quiet.evidenceTimeline[0].summary, 'Quiet specialist retained an important older method.');
  assert.equal(view.timeline.some((entry) => entry.participantId === 'quiet-specialist'), false);
});


test('retry-ready recovery record resolves rather than recreates the same uplift gap', () => {
  const payload = feed();
  payload.records.receiptRecords = [];
  payload.records.lessonRecords = [];
  payload.records.eventRecords = [
    {
      eventId: 'retry-gap',
      kind: 'learning-event',
      participantId: 'vr-agent',
      timestampUtc: '2026-10-04T11:00:00.000Z',
      eventKind: 'capability-gap',
      summary: 'Spatial container runtime proof is missing.',
      proofRefs: ['proof/retry-gap'],
      closedLoopLearning: {
        capabilityId: 'spatial-container-runtime-proof',
        learningEligibleCapabilityFailure: true,
        telemetry: { retryReady: false },
      },
    },
    {
      eventId: 'retry-recovery',
      kind: 'learning-event',
      participantId: 'vr-agent',
      timestampUtc: '2026-10-04T11:05:00.000Z',
      eventKind: 'capability-recovery',
      summary: 'Spatial container runtime proof replay is ready.',
      proofRefs: ['proof/retry-recovery'],
      closedLoopLearning: {
        capabilityId: 'spatial-container-runtime-proof',
        learningEligibleCapabilityFailure: true,
        telemetry: { retryReady: true },
      },
    },
  ];

  const view = deriveAgentsWorkspaceView({ payload, finalAgentView: { visibleAgents: [] } });
  const agent = view.agents.find((entry) => entry.agentId === 'vr-agent');
  assert.ok(agent);
  assert.equal(agent.capabilityGapCount, 0);
  assert.equal(agent.resolvedGapCount, 1);
  assert.equal(agent.upliftState === 'NEEDS_UPLIFT', false);
});


test('legacy learningCandidate capability identity clears on matching recovery', () => {
  const payload = feed();
  payload.records.receiptRecords = [];
  payload.records.lessonRecords = [];
  payload.records.eventRecords = [
    {
      eventId: 'legacy-candidate-gap',
      kind: 'learning-event',
      participantId: 'legacy-agent',
      timestampUtc: '2026-10-04T11:20:00.000Z',
      eventKind: 'learning-gap',
      summary: 'Legacy candidate capability needs repair.',
      learningCandidate: {
        capabilityId: 'legacy-runtime-proof',
        requiresExistingGoalSearch: true,
      },
    },
    {
      eventId: 'legacy-candidate-recovery',
      kind: 'learning-event',
      participantId: 'legacy-agent',
      timestampUtc: '2026-10-04T11:25:00.000Z',
      eventKind: 'capability-recovery',
      state: 'RECOVERED',
      summary: 'Legacy candidate capability recovered.',
      learningCandidate: {
        capabilityId: 'legacy-runtime-proof',
        requiresExistingGoalSearch: false,
        testAndProofRefs: ['proof/legacy-runtime-proof'],
      },
    },
  ];

  const view = deriveAgentsWorkspaceView({ payload, finalAgentView: { visibleAgents: [] } });
  const agent = view.agents.find((entry) => entry.agentId === 'legacy-agent');
  assert.ok(agent);
  assert.equal(agent.capabilityGapCount, 0);
  assert.equal(agent.resolvedGapCount, 1);
  assert.equal(agent.resolvedGaps[0].capabilityId, 'legacy-runtime-proof');
});

test('resolved gap projects canonical nested recovery proof references', () => {
  const payload = feed();
  payload.records.receiptRecords = [];
  payload.records.lessonRecords = [];
  payload.records.eventRecords = [
    {
      eventId: 'nested-proof-gap',
      kind: 'learning-event',
      participantId: 'proof-agent',
      timestampUtc: '2026-10-04T11:30:00.000Z',
      eventKind: 'capability-gap',
      summary: 'Proof route missing.',
      closedLoopLearning: {
        capabilityId: 'nested-proof-capability',
        learningEligibleCapabilityFailure: true,
        telemetry: { retryReady: false },
      },
    },
    {
      eventId: 'nested-proof-recovery',
      kind: 'learning-event',
      participantId: 'proof-agent',
      timestampUtc: '2026-10-04T11:35:00.000Z',
      eventKind: 'capability-recovery',
      summary: 'Proof route recovered.',
      closedLoopLearning: {
        capabilityId: 'nested-proof-capability',
        learningEligibleCapabilityFailure: true,
        telemetry: { retryReady: true },
        verification: {
          proofRefs: ['proof/closed-loop-verification'],
        },
      },
      learningCandidate: {
        capabilityId: 'nested-proof-capability',
        requiresExistingGoalSearch: false,
        testAndProofRefs: ['proof/learning-candidate'],
      },
    },
  ];

  const view = deriveAgentsWorkspaceView({ payload, finalAgentView: { visibleAgents: [] } });
  const agent = view.agents.find((entry) => entry.agentId === 'proof-agent');
  assert.ok(agent);
  assert.equal(agent.resolvedGapCount, 1);
  assert.deepEqual(
    [...agent.resolvedGaps[0].resolvedByProofRefs].sort(),
    ['proof/closed-loop-verification', 'proof/learning-candidate'].sort(),
  );
});


test('incomplete and failed recovery records cannot clear a current uplift gap', () => {
  const payload = feed();
  payload.records.receiptRecords = [];
  payload.records.lessonRecords = [];
  payload.records.eventRecords = [
    {
      eventId: 'negative-recovery-gap',
      kind: 'learning-event',
      participantId: 'vr-agent',
      timestampUtc: '2026-10-04T12:00:00.000Z',
      eventKind: 'capability-gap',
      summary: 'Temporal proof remains unresolved.',
      proofRefs: ['proof/gap'],
      closedLoopLearning: {
        capabilityId: 'temporal-proof',
        learningEligibleCapabilityFailure: true,
        telemetry: { retryReady: false },
      },
    },
    {
      eventId: 'negative-recovery-incomplete',
      kind: 'learning-event',
      participantId: 'vr-agent',
      timestampUtc: '2026-10-04T12:05:00.000Z',
      eventKind: 'capability-recovery',
      status: 'INCOMPLETE',
      summary: 'Recovery attempt incomplete.',
      proofRefs: ['proof/incomplete-attempt'],
      closedLoopLearning: {
        capabilityId: 'temporal-proof',
        learningEligibleCapabilityFailure: true,
        telemetry: { retryReady: false },
      },
    },
    {
      eventId: 'negative-recovery-failed',
      kind: 'learning-event',
      participantId: 'vr-agent',
      timestampUtc: '2026-10-04T12:06:00.000Z',
      eventKind: 'capability-recovery-failed',
      status: 'FAILED',
      summary: 'Recovery attempt failed.',
      proofRefs: ['proof/failed-attempt'],
      closedLoopLearning: {
        capabilityId: 'temporal-proof',
        learningEligibleCapabilityFailure: true,
        telemetry: { retryReady: false },
      },
    },
  ];

  const view = deriveAgentsWorkspaceView({ payload, finalAgentView: { visibleAgents: [] } });
  const agent = view.agents.find((entry) => entry.agentId === 'vr-agent');
  assert.ok(agent);
  assert.equal(agent.capabilityGapCount >= 1, true);
  assert.equal(agent.resolvedGapCount, 0);
  assert.equal(agent.upliftState, 'NEEDS_UPLIFT');
});

test('conflicting final failure cannot clear a current uplift gap', () => {
  const payload = feed();
  payload.records.receiptRecords = [];
  payload.records.lessonRecords = [];
  payload.records.eventRecords = [
    {
      eventId: 'conflict-gap',
      kind: 'learning-event',
      participantId: 'vr-agent',
      timestampUtc: '2026-10-04T13:00:00.000Z',
      eventKind: 'capability-gap',
      state: 'OPEN',
      summary: 'Temporal proof remains unresolved.',
      proofRefs: ['proof/conflict-gap'],
      closedLoopLearning: {
        capabilityId: 'temporal-proof-conflict',
        learningEligibleCapabilityFailure: true,
        telemetry: { retryReady: false },
      },
    },
    {
      eventId: 'conflict-recovery',
      kind: 'learning-event',
      participantId: 'vr-agent',
      timestampUtc: '2026-10-04T13:05:00.000Z',
      eventKind: 'capability-recovery',
      status: 'COMPLETE',
      finalVerdict: 'FAILED',
      summary: 'Attempt completed but final verification failed.',
      proofRefs: ['proof/conflict-attempt'],
      closedLoopLearning: {
        capabilityId: 'temporal-proof-conflict',
        telemetry: { retryReady: false },
      },
    },
  ];

  const view = deriveAgentsWorkspaceView({ payload, finalAgentView: { visibleAgents: [] } });
  const agent = view.agents.find((entry) => entry.agentId === 'vr-agent');
  assert.ok(agent);
  assert.equal(agent.capabilityGapCount, 1);
  assert.equal(agent.resolvedGapCount, 0);
  assert.equal(agent.upliftState, 'NEEDS_UPLIFT');
});


test('Flywheel Brain Bay falls back to historical brain evidence when canonical brain state is absent', () => {
  const payload = feed();
  delete payload.brainState;
  payload.records.receiptRecords.push({
    kind: 'brain-routing-receipt',
    participantId: 'stephanos',
    timestampUtc: '2026-10-02T20:08:00.000Z',
    status: 'CURRENT',
    model: 'qwen:14b',
    provider: 'ollama',
    reasoningMode: 'standard',
    summary: 'Historical brain routing receipt.',
    proofRefs: ['proof/historical-brain'],
  });
  const view = deriveFlywheelWorkspaceView(payload);
  assert.equal(view.brainBay.model, 'qwen:14b');
  assert.equal(view.brainBay.source, 'shared-workspace-history-fallback');
});


test('Flywheel exposes workspace integrity provenance as a persistent evidence-backed seed', () => {
  const unavailable = deriveFlywheelWorkspaceView({
    schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1',
    state: 'unavailable',
    records: {},
  });
  assert.equal(unavailable.workspaceIntegritySeedGrowth.declared, true);
  assert.equal(unavailable.workspaceIntegritySeedGrowth.contractTruth, 'SOURCE_PROVEN');
  assert.equal(unavailable.workspaceIntegritySeedGrowth.planted, false);
  assert.equal(unavailable.workspaceIntegritySeedGrowth.missionId, 'workspace-integrity-provenance');
  assert.equal(unavailable.workspaceIntegritySeedGrowth.issueRef, '#2898');
  assert.equal(unavailable.workspaceIntegritySeedGrowth.currentRung, 'AWAITING_LIVE_PROOF');

  const payload = feed();
  payload.records.statusRecords.push({
    statusId: 'workspace-integrity-provenance',
    missionId: 'workspace-integrity-provenance',
    relatedIssue: '#2898',
    participantId: 'flywheel',
    timestampUtc: '2026-10-07T20:10:00.000Z',
    status: 'SEED_ACTIVE',
    title: 'Every Workspace, Card and Visualiser Has Verified End-to-End Provenance',
    summary: 'Workspace integrity provenance persistent seed heartbeat is active.',
    proofRefs: ['proof/workspace-integrity-seed-source'],
    seedHeartbeat: {
      schemaVersion: 'stephanos.high-level-flywheel-seed-heartbeat.v1',
      missionId: 'workspace-integrity-provenance',
      issueRef: '#2898',
    },
  });
  const signals = [
    ['workspace-integrity-inventory', 'Component inventory and workspace discovery published for all visible cards and visualisers.'],
    ['workspace-integrity-identities', 'Stable workspace id and component id assigned with unique identity proof.'],
    ['workspace-integrity-binding', 'Canonical source binding provenance published for each component.'],
    ['workspace-integrity-contract', 'Schema version and unit contract proven for every canonical binding.'],
    ['workspace-integrity-hydration', 'End-to-end hydration proven from source through transport to consumer.'],
    ['workspace-integrity-reconciliation', 'Source-render reconciliation proved rendered value equals canonical value.'],
    ['workspace-integrity-synthetic', 'Synthetic end-to-end probe and synthetic proof current for every binding.'],
    ['workspace-integrity-orphans', 'Orphan audit complete: zero orphan consumers and no unconsumed source remains.'],
    ['workspace-integrity-continuous', 'Continuous integrity audit and regression monitoring is active.'],
  ];
  signals.forEach(([eventId, summary], index) => payload.records.eventRecords.push({
    eventId,
    missionId: 'workspace-integrity-provenance',
    relatedIssue: '#2898',
    participantId: 'flywheel',
    timestampUtc: `2026-10-07T20:${11 + index}:00.000Z`,
    eventKind: eventId,
    status: 'CURRENT',
    summary,
    proofRefs: [`proof/${eventId}`],
  }));

  const live = deriveFlywheelWorkspaceView(payload);
  assert.equal(live.workspaceIntegritySeedGrowth.planted, true);
  assert.equal(live.workspaceIntegritySeedGrowth.currentRung, 'CONTINUOUSLY_VERIFIED');
  assert.equal(live.workspaceIntegritySeedGrowth.inventoryProofCount >= 1, true);
  assert.equal(live.workspaceIntegritySeedGrowth.canonicalBindingProofCount >= 1, true);
  assert.equal(live.workspaceIntegritySeedGrowth.hydrationProofCount >= 1, true);
  assert.equal(live.workspaceIntegritySeedGrowth.reconciliationProofCount >= 1, true);
  assert.equal(live.workspaceIntegritySeedGrowth.syntheticProofCount >= 1, true);
  assert.equal(live.workspaceIntegritySeedGrowth.orphanAuditProofCount >= 1, true);
  assert.equal(live.workspaceIntegritySeedGrowth.continuousAuditProofCount >= 1, true);
  assert.equal(live.workspaceIntegritySeedGrowth.pressureState, 'CURRENT');
  assert.equal(live.outcomeSeeds.length, 6);
});
