import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMissionWorkerAction } from './missionOrchestratorWorker.mjs';

const NOW = new Date('2026-09-02T17:30:00.000Z');

function mission(overrides = {}) {
  return {
    missionId: 'provider-independent-worker-test',
    revision: 1,
    currentPhase: 'AGENT_IMPLEMENTATION',
    title: 'Provider independent worker test',
    repository: 'Cheekyfellastef/stephan-os',
    operatorIntent: 'Keep building when OpenAI is unavailable.',
    intendedOutcome: 'Use a proven non-OpenAI builder route.',
    allowedFiles: ['shared/agents/example.mjs'],
    requiredTests: ['focused-test'],
    requiredEvidence: ['receipts/provider-independent-proof.json'],
    dispatch: { adapter: 'codex', status: 'pending' },
    ...overrides,
  };
}

function healthyCodexStatus() {
  return {
    schemaVersion: 'shared-agent-workspace-record.v1',
    statusId: 'codex-capacity-current',
    truthState: 'CURRENT',
    meterTruthUsable: true,
    observedAtUtc: '2026-09-02T17:29:00.000Z',
    remainingPercent: 90,
    availability: 'AVAILABLE',
    confidence: 'high',
    naturalResetAtUtc: '',
  };
}

test('Mission Worker no longer silently defaults to Codex when capacity-routing truth is unavailable', () => {
  const action = buildMissionWorkerAction(mission(), { now: NOW });
  assert.equal(action.executable, false);
  assert.equal(action.finalVerdict, 'BLOCKED');
  assert.ok(action.blockers.includes('provider-independent-capacity-routing-unavailable'));
});

test('explicit OpenAI blackout blocks Codex even when Codex otherwise reports healthy', () => {
  const action = buildMissionWorkerAction(mission(), {
    now: NOW,
    capacityRouting: {
      nowUtc: NOW.toISOString(),
      codexStatus: healthyCodexStatus(),
      githubLaneReceipt: null,
      forgeLaneReceipt: null,
      forgeSidecar: null,
      openAiBlackout: true,
    },
  });
  assert.equal(action.executable, false);
  assert.equal(action.finalVerdict, 'BLOCKED');
  assert.ok(action.blockers.includes('openai-blackout-non-openai-capacity-unavailable'));
});

test('OpenAI remains optional overflow when blackout is off and no non-OpenAI route is proven', () => {
  const action = buildMissionWorkerAction(mission(), {
    now: NOW,
    capacityRouting: {
      nowUtc: NOW.toISOString(),
      codexStatus: healthyCodexStatus(),
      githubLaneReceipt: null,
      forgeLaneReceipt: null,
      forgeSidecar: null,
    },
  });
  assert.equal(action.executable, true);
  assert.equal(action.adapter, 'codex');
  assert.equal(action.capacityRoute, 'CODEX');
  assert.equal(action.finalVerdict, 'READY_TO_DISPATCH_CODEX');
});
