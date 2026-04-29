import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawReadonlyEndpointTrace } from './openClawReadonlyEndpointTrace.mjs';

function fullTraceInput() {
  return {
    appState: { readonlyValidationEndpoint: { available: true, path: '/api/openclaw/health-handshake/validate-readonly', mode: 'local_readonly_probe', canExecute: false } },
    projectionInput: { openClawAdapter: { adapterConnection: { healthHandshake: { readonlyValidationEndpoint: { available: true } } } } },
    healthHandshakeOutput: { readonlyValidationEndpoint: { available: true, path: '/api/openclaw/health-handshake/validate-readonly', mode: 'local_readonly_probe', canExecute: false } },
    projectionOutput: { openClawReadonlyValidationEndpointAvailable: true, openClawReadonlyValidationEndpointPath: '/api/openclaw/health-handshake/validate-readonly', openClawReadonlyValidationEndpointMode: 'local_readonly_probe', openClawReadonlyValidationEndpointCanExecute: false },
    dashboardSummary: { openClawReadonlyValidationEndpointAvailable: true, openClawReadonlyValidationEndpointPath: '/api/openclaw/health-handshake/validate-readonly', openClawReadonlyValidationEndpointMode: 'local_readonly_probe', openClawReadonlyValidationEndpointCanExecute: false },
    progressNormalized: { openClawReadonlyValidationEndpointAvailable: true, openClawReadonlyValidationEndpointPath: '/api/openclaw/health-handshake/validate-readonly', openClawReadonlyValidationEndpointMode: 'local_readonly_probe', openClawReadonlyValidationEndpointCanExecute: false },
    stageEvidence: { 'openclaw-validation-endpoint': 'available' },
    nextBestActionsEvidence: ['openclaw-validation-endpoint:available'],
  };
}

test('trace reports none when all hops are available and execution remains gated', () => {
  const trace = buildOpenClawReadonlyEndpointTrace(fullTraceInput());
  assert.equal(trace.firstMissingHop, 'none');
  assert.equal(trace.stageEvidenceValue, 'available');
  assert.equal(trace.nextBestActionEvidenceValue, 'openclaw-validation-endpoint:available');
  assert.equal(trace.canExecute, false);
});

test('trace identifies first missing hop progressively', () => {
  const phases = ['appState', 'projectionInput', 'healthHandshakeOutput', 'projectionOutput', 'dashboardSummary', 'progressNormalized', 'stageEvidence', 'nextBestActionEvidence'];
  for (const phase of phases) {
    const input = fullTraceInput();
    if (phase === 'appState') input.appState.readonlyValidationEndpoint.available = false;
    if (phase === 'projectionInput') input.projectionInput.openClawAdapter.adapterConnection.healthHandshake.readonlyValidationEndpoint.available = false;
    if (phase === 'healthHandshakeOutput') input.healthHandshakeOutput.readonlyValidationEndpoint.available = false;
    if (phase === 'projectionOutput') input.projectionOutput.openClawReadonlyValidationEndpointAvailable = false;
    if (phase === 'dashboardSummary') input.dashboardSummary.openClawReadonlyValidationEndpointAvailable = false;
    if (phase === 'progressNormalized') input.progressNormalized.openClawReadonlyValidationEndpointAvailable = false;
    if (phase === 'stageEvidence') input.stageEvidence['openclaw-validation-endpoint'] = 'missing';
    if (phase === 'nextBestActionEvidence') input.nextBestActionsEvidence = ['openclaw-validation-endpoint:missing'];
    const trace = buildOpenClawReadonlyEndpointTrace(input);
    assert.equal(trace.firstMissingHop, phase);
  }
});

test('trace prioritizes dashboard summary/progress hops when canonical projection or stage evidence is already available', () => {
  const input = fullTraceInput();
  input.appState.readonlyValidationEndpoint.available = false;
  input.projectionInput.openClawAdapter.adapterConnection.healthHandshake.readonlyValidationEndpoint.available = false;
  input.healthHandshakeOutput.readonlyValidationEndpoint.available = false;
  input.dashboardSummary.openClawReadonlyValidationEndpointAvailable = false;
  const trace = buildOpenClawReadonlyEndpointTrace(input);
  assert.equal(trace.projectionOutputAvailable, true);
  assert.equal(trace.stageEvidenceValue, 'available');
  assert.equal(trace.firstMissingHop, 'dashboardSummary');

  input.dashboardSummary.openClawReadonlyValidationEndpointAvailable = true;
  input.progressNormalized.openClawReadonlyValidationEndpointAvailable = false;
  const progressTrace = buildOpenClawReadonlyEndpointTrace(input);
  assert.equal(progressTrace.firstMissingHop, 'progressNormalized');
});
