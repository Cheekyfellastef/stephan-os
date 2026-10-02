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
      capabilityRecords: [
        { kind: 'uplift-candidate', participantId: 'builder-1', timestampUtc: '2026-10-02T20:06:30.000Z', summary: 'Replay guarded runtime inspection after repair.', status: 'PENDING' },
      ],
      proofRecords: [
        { kind: 'proof', participantId: 'builder-1', timestampUtc: '2026-10-02T20:08:00.000Z', summary: 'Focused replay proof captured.', status: 'PASS', proofRefs: ['proof/replay-pass'] },
      ],
      receiptRecords: [
        { kind: 'execution-receipt', participantId: 'builder-1', timestampUtc: '2026-10-02T20:05:00.000Z', state: 'stalled', missionId: 'm2', proofRefs: ['receipts/stall'] },
      ],
      eventRecords: [
        { kind: 'learning-event', participantId: 'builder-1', timestampUtc: '2026-10-02T20:06:00.000Z', eventKind: 'capability-gap', summary: 'Missing guarded runtime inspection route.', proofRefs: ['proof/gap'] },
      ],
      lessonRecords: [
        { kind: 'lesson', participantId: 'stephanos', timestampUtc: '2026-10-02T20:07:00.000Z', summary: 'Reuse canonical receipts before claiming execution.' },
        { kind: 'lesson', participantId: 'builder-1', timestampUtc: '2026-10-02T20:07:30.000Z', summary: 'Operator intervention required before replay approval.' },
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
  assert.equal(view.timeline.length > 0, true);
  assert.equal(view.capabilityGaps.length >= 1, true);
  assert.equal(view.experiments.length >= 1, true);
  assert.equal(view.receipts.length >= 1, true);
  assert.equal(view.proofs.length >= 1, true);
  assert.equal(view.operatorInterventions.length >= 1, true);
  assert.equal(view.sourceMesh.recordCount > 0, true);
  const builder = view.participants.find((entry) => entry.participantId === 'builder-1');
  assert.ok(builder);
  assert.equal(builder.capabilityGapCount, 1);
  assert.equal(builder.upliftNeedCount > 0, true);
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


test('Flywheel workspace remains structurally present when feed is unavailable', () => {
  const view = deriveFlywheelWorkspaceView({
    schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1',
    state: 'unavailable',
    exactNextAction: 'Restore canonical feed.',
    records: {},
  });
  assert.equal(view.valid, false);
  assert.equal(view.sourceTruth, 'UNKNOWN');
  assert.deepEqual(view.participants, []);
  assert.deepEqual(view.capabilityGaps, []);
  assert.deepEqual(view.experiments, []);
  assert.deepEqual(view.receipts, []);
  assert.deepEqual(view.proofs, []);
  assert.equal(view.sourceMesh.recordCount, 0);
  assert.equal(view.exactNextAction, 'Restore canonical feed.');
});


test('negated completion states never project as CURRENT', () => {
  const payload = feed();
  payload.records.statusRecords.push(
    { participantId: 'negated-proof-agent', timestampUtc: '2026-10-02T20:09:00.000Z', status: 'CONFIGURATION_NOT_PROVED' },
    { participantId: 'incomplete-agent', timestampUtc: '2026-10-02T20:10:00.000Z', status: 'EVIDENCE_INCOMPLETE' },
  );
  const view = deriveFlywheelWorkspaceView(payload);
  assert.equal(view.participants.find((entry) => entry.participantId === 'negated-proof-agent')?.truth, 'CONFLICTING');
  assert.equal(view.participants.find((entry) => entry.participantId === 'incomplete-agent')?.truth, 'CONFLICTING');
});

test('Flywheel headline totals count full history while display collections stay bounded', () => {
  const payload = feed();
  payload.records.lessonRecords = Array.from({ length: 17 }, (_, index) => ({
    kind: 'lesson',
    participantId: 'stephanos',
    timestampUtc: `2026-10-02T20:${String(index).padStart(2, '0')}:00.000Z`,
    summary: `Lesson ${index + 1}`,
  }));
  const view = deriveFlywheelWorkspaceView(payload);
  assert.equal(view.stats.lessons, 17);
  assert.equal(view.sourceMesh.lessonRecords, 17);
  assert.equal(view.lessons.length, 12);
});
