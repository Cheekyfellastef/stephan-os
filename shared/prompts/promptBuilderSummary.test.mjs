import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPromptBuilderSummary } from './promptBuilderSummary.mjs';

test('prompt builder summary defaults to not_started when no context is available', () => {
  const summary = buildPromptBuilderSummary({
    promptBuilderAvailable: true,
    promptText: '',
    telemetryEntries: [],
    actionHints: [],
    finalRouteTruth: null,
    orchestrationTruth: null,
  });

  assert.equal(summary.systemId, 'prompt-builder');
  assert.equal(summary.status, 'not_started');
  assert.equal(summary.supportsTelemetryContext, false);
  assert.match(summary.nextActions.join(' '), /telemetry context/i);
});

test('prompt builder summary detects capabilities and codex-handoff support', () => {
  const summary = buildPromptBuilderSummary({
    promptBuilderAvailable: true,
    promptText: '## REQUEST\nImplement safely',
    telemetryEntries: [{ id: 'evt-1' }],
    actionHints: [{ severity: 'info', text: 'review route truth' }],
    finalRouteTruth: { routeKind: 'cloud' },
    orchestrationTruth: { canonicalMissionPacket: { missionId: 'packet-1' } },
    copySupported: true,
    codexHandoffReady: true,
  });

  assert.equal(summary.status, 'ready');
  assert.equal(summary.supportsAgentTaskContext, true);
  assert.equal(summary.supportsCodexHandoff, true);
  assert.equal(summary.blockers.length, 0);
});

test('prompt builder summary binds explicit context projections', () => {
  const summary = buildPromptBuilderSummary({
    promptBuilderAvailable: true,
    promptText: '## REQUEST\nBind contexts',
    telemetryEntries: [],
    actionHints: [],
    finalRouteTruth: null,
    orchestrationTruth: null,
    contextBindings: {
      agentTaskContextAvailable: true,
      telemetryContextAvailable: true,
      runtimeTruthContextAvailable: true,
      codexHandoffContextAvailable: true,
      actionHintsAvailable: true,
      constraintsAvailable: true,
    },
    copySupported: true,
  });

  assert.equal(summary.status, 'ready');
  assert.equal(summary.supportsAgentTaskContext, true);
  assert.equal(summary.supportsTelemetryContext, true);
  assert.equal(summary.supportsRuntimeTruthContext, true);
  assert.equal(summary.supportsCodexHandoff, true);
  assert.equal(summary.nextActions[0].toLowerCase().includes('bind'), false);
});
