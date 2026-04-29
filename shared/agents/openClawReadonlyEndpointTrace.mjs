function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function asBool(value) {
  return value === true;
}

function firstMissingHop(hops = []) {
  const missing = hops.find((entry) => entry.available !== true);
  return missing ? missing.id : 'none';
}

function deriveFirstMissingHop(trace) {
  const canonicalAvailable = trace.projectionOutputAvailable || trace.stageEvidenceValue === 'available';
  if (canonicalAvailable && trace.dashboardSummaryAvailable !== true) {
    return 'dashboardSummary';
  }
  if (canonicalAvailable && trace.progressNormalizedAvailable !== true) {
    return 'progressNormalized';
  }
  return firstMissingHop([
    { id: 'appState', available: trace.appStateAvailable },
    { id: 'projectionInput', available: trace.projectionInputAvailable },
    { id: 'healthHandshakeOutput', available: trace.healthHandshakeOutputAvailable },
    { id: 'projectionOutput', available: trace.projectionOutputAvailable },
    { id: 'dashboardSummary', available: trace.dashboardSummaryAvailable },
    { id: 'progressNormalized', available: trace.progressNormalizedAvailable },
    { id: 'stageEvidence', available: trace.stageEvidenceValue === 'available' },
    { id: 'nextBestActionEvidence', available: /openclaw-validation-endpoint:available/.test(trace.nextBestActionEvidenceValue) },
  ]);
}

export function buildOpenClawReadonlyEndpointTrace({
  appState = {},
  projectionInput = {},
  healthHandshakeOutput = {},
  projectionOutput = {},
  dashboardSummary = {},
  progressNormalized = {},
  stageEvidence = {},
  nextBestActionsEvidence = [],
} = {}) {
  const appEndpoint = asObject(asObject(appState).readonlyValidationEndpoint);
  const projectionInputHandshake = asObject(asObject(asObject(asObject(projectionInput).openClawAdapter).adapterConnection).healthHandshake);
  const handshakeEndpoint = asObject(asObject(healthHandshakeOutput).readonlyValidationEndpoint);
  const stage = asObject(stageEvidence);
  const nextEvidence = Array.isArray(nextBestActionsEvidence)
    ? nextBestActionsEvidence.find((entry) => typeof entry === 'string' && entry.startsWith('openclaw-validation-endpoint:')) || ''
    : '';

  const trace = {
    appStateAvailable: asBool(appEndpoint.available),
    projectionInputAvailable: asBool(asObject(projectionInputHandshake.readonlyValidationEndpoint).available)
      || asBool(projectionInputHandshake.openClawReadonlyValidationEndpointAvailable),
    healthHandshakeOutputAvailable: asBool(handshakeEndpoint.available),
    projectionOutputAvailable: asBool(projectionOutput.openClawReadonlyValidationEndpointAvailable),
    dashboardSummaryAvailable: asBool(dashboardSummary.openClawReadonlyValidationEndpointAvailable),
    progressNormalizedAvailable: asBool(progressNormalized.openClawReadonlyValidationEndpointAvailable),
    stageEvidenceValue: String(stage['openclaw-validation-endpoint'] || ''),
    nextBestActionEvidenceValue: String(nextEvidence || ''),
    expectedPath: '/api/openclaw/health-handshake/validate-readonly',
    actualPath: String(
      appEndpoint.path
      || projectionInputHandshake.readonlyValidationEndpoint?.path
      || handshakeEndpoint.path
      || projectionOutput.openClawReadonlyValidationEndpointPath
      || dashboardSummary.openClawReadonlyValidationEndpointPath
      || progressNormalized.openClawReadonlyValidationEndpointPath
      || '',
    ),
    mode: String(
      appEndpoint.mode
      || projectionInputHandshake.readonlyValidationEndpoint?.mode
      || handshakeEndpoint.mode
      || projectionOutput.openClawReadonlyValidationEndpointMode
      || dashboardSummary.openClawReadonlyValidationEndpointMode
      || progressNormalized.openClawReadonlyValidationEndpointMode
      || 'missing',
    ),
    canExecute: asBool(appEndpoint.canExecute)
      || asBool(projectionInputHandshake.readonlyValidationEndpoint?.canExecute)
      || asBool(handshakeEndpoint.canExecute)
      || asBool(projectionOutput.openClawReadonlyValidationEndpointCanExecute)
      || asBool(dashboardSummary.openClawReadonlyValidationEndpointCanExecute)
      || asBool(progressNormalized.openClawReadonlyValidationEndpointCanExecute),
  };

  trace.firstMissingHop = deriveFirstMissingHop(trace);

  return trace;
}
