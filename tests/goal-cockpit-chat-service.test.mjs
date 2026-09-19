import test from 'node:test';
import assert from 'node:assert/strict';
import { readGoalCockpitChatProjection } from '../stephanos-server/services/goalCockpitChatService.js';

const NOW = new Date('2026-07-30T12:00:00.000Z');

function currentLiveProjection(cards = []) {
  return {
    schemaVersion: 'stephanos.live-goal-projection.v1',
    generatedAt: NOW.toISOString(),
    sourceTruth: 'live',
    dashboardGoals: {
      sourceTruth: 'LIVE READ-ONLY GITHUB',
      freshnessVerdict: 'CURRENT_AT_REQUEST',
      observedAt: NOW.toISOString(),
      cards,
    },
    currentAgentStates: {},
    proofTruth: { github: 'adapter-provided', local: 'unknown', browser: 'unknown' },
    blockers: [],
    staleWarnings: [],
    nextOperatorAction: 'Inspect current proof.',
    commandExecutionAllowed: false,
    mergeAllowed: false,
    codexDispatchAllowed: false,
  };
}

function currentWorkspaceFeed() {
  return {
    state: 'ready',
    reason: 'WORKSPACE_RECORDS_CURRENT_OR_UNKNOWN_BY_GOAL',
    workspaceRoot: 'C:\\Users\\Stephan\\private-shared-agent-workspace',
    safeWorkspaceRoot: 'Shared Agent Workspace',
    records: {
      goalRecords: [],
      statusRecords: [],
      proofRecords: [],
      capabilityRecords: [],
      eventRecords: [],
    },
    projection: {
      sourceTruth: 'CURRENT',
      goals: [],
      captainsBridge: {
        activeLane: null,
        currentPr: null,
        branch: 'UNKNOWN',
        exactHead: 'UNKNOWN',
        latestProof: 'UNKNOWN',
      },
      operatorAttention: { approvals: [], blockers: [], exactNextAction: 'Inspect current proof.' },
    },
  };
}

test('cockpit service composes the two canonical read-only readers exactly once', async () => {
  const calls = [];
  const projection = await readGoalCockpitChatProjection({
    now: NOW,
    liveGoalReader: async () => {
      calls.push('live');
      return currentLiveProjection();
    },
    sharedWorkspaceReader: async () => {
      calls.push('workspace');
      return currentWorkspaceFeed();
    },
  });

  assert.deepEqual(calls.sort(), ['live', 'workspace']);
  assert.equal(projection.guardrails.readOnly, true);
  assert.equal(projection.guardrails.commandExecutionAllowed, false);
  assert.equal(projection.guardrails.repoMutationAllowed, false);
  assert.equal(projection.guardrails.mergeAllowed, false);
  assert.deepEqual(projection.goals, []);
  assert.doesNotMatch(JSON.stringify(projection), /private-shared-agent-workspace/i);
});

test('cockpit service degrades a failed source to UNKNOWN instead of failing or claiming CURRENT', async () => {
  const projection = await readGoalCockpitChatProjection({
    now: NOW,
    liveGoalReader: async () => {
      throw new Error('LIVE_READER_OFFLINE');
    },
    sharedWorkspaceReader: async () => currentWorkspaceFeed(),
  });

  assert.equal(projection.truth, 'UNKNOWN');
  assert.ok(projection.systems.some((system) => system.truth === 'UNKNOWN'));
  assert.match(JSON.stringify(projection), /Live goal projection read failed/);
  assert.equal(projection.goals.length, 0);
});
