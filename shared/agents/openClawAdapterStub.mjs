function asText(value = '', fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function asBoolean(value, fallback = false) {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
}

function asList(value) {
  return Array.isArray(value)
    ? value.map((entry) => asText(entry)).filter(Boolean)
    : [];
}

function normalizeStubMode(value = '') {
  const normalized = asText(value, 'design_only').toLowerCase();
  if (['unavailable', 'design_only', 'local_stub', 'simulated', 'disabled', 'unknown'].includes(normalized)) {
    return normalized;
  }
  if (normalized === 'contract_defined') return 'design_only';
  return 'unknown';
}

function normalizeStubStatus(value = '') {
  const normalized = asText(value, '').toLowerCase();
  if (['not_present', 'present_disabled', 'simulated_ready', 'health_check_only', 'blocked', 'unknown'].includes(normalized)) {
    return normalized;
  }
  return '';
}

function normalizeConnectionState(value = '') {
  const normalized = asText(value, 'not_connected').toLowerCase();
  if (['not_connected', 'simulated', 'local_only', 'blocked', 'unknown'].includes(normalized)) {
    return normalized;
  }
  if (normalized === 'connected') return 'local_only';
  return 'unknown';
}

function normalizeExecutionCapability(value = '') {
  const normalized = asText(value, 'none').toLowerCase();
  if (['none', 'dry_run_only', 'disabled'].includes(normalized)) {
    return normalized;
  }
  return 'none';
}

function normalizeHealth(value = '') {
  const normalized = asText(value, 'unknown').toLowerCase();
  if (['unknown', 'healthy', 'degraded', 'blocked', 'unavailable'].includes(normalized)) {
    return normalized;
  }
  return 'unknown';
}

function pickDefaultStatus(mode = 'design_only') {
  if (mode === 'unavailable') return 'not_present';
  if (mode === 'design_only') return 'not_present';
  if (mode === 'disabled') return 'present_disabled';
  if (mode === 'simulated') return 'simulated_ready';
  if (mode === 'local_stub') return 'health_check_only';
  return 'unknown';
}

function pickDefaultConnection(mode = 'design_only', status = 'unknown') {
  if (status === 'blocked') return 'blocked';
  if (mode === 'simulated') return 'simulated';
  if (mode === 'local_stub') return 'local_only';
  return 'not_connected';
}

function pickDefaultHealth(mode = 'design_only', status = 'unknown') {
  if (mode === 'unavailable') return 'unavailable';
  if (status === 'blocked') return 'blocked';
  if (status === 'simulated_ready' || status === 'health_check_only') return 'healthy';
  return 'unknown';
}

export function adjudicateOpenClawAdapterStub(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const stubMode = normalizeStubMode(source.stubMode || source.mode || source.adapterStubMode);
  const requestedStatus = normalizeStubStatus(source.stubStatus || source.status || source.adapterStubStatus);
  const requestedConnectionState = normalizeConnectionState(source.stubConnectionState || source.connectionState || source.adapterStubConnectionState);
  const requestedExecutionCapability = normalizeExecutionCapability(source.stubExecutionCapability || source.executionCapability || source.adapterStubExecutionCapability);
  const requestedHealth = normalizeHealth(source.stubHealth || source.health || source.adapterStubHealth);

  const stubStatus = requestedStatus || pickDefaultStatus(stubMode);
  const stubConnectionState = requestedConnectionState || pickDefaultConnection(stubMode, stubStatus);
  const stubExecutionCapability = requestedExecutionCapability;
  const stubHealth = requestedHealth || pickDefaultHealth(stubMode, stubStatus);
  const stubBlockers = asList(source.stubBlockers || source.blockers);
  const stubWarnings = asList(source.stubWarnings || source.warnings);
  const manualEvidence = asList(source.stubEvidence || source.evidence);

  const blockedByStatus = stubStatus === 'blocked' || stubConnectionState === 'blocked' || stubHealth === 'blocked';
  const disabledByMode = stubMode === 'disabled' || stubMode === 'unavailable';
  const healthInspectOnly = stubStatus === 'health_check_only' || stubMode === 'local_stub';
  const simulatedInspectOnly = stubStatus === 'simulated_ready' || stubMode === 'simulated';

  const stubCanExecute = false;
  const stubCanInspectOnly = (healthInspectOnly || simulatedInspectOnly) && !disabledByMode && !blockedByStatus;

  let stubNextAction = asText(source.stubNextAction || source.nextAction);
  if (!stubNextAction) {
    if (stubMode === 'design_only' || stubStatus === 'not_present') {
      stubNextAction = 'Create OpenClaw local adapter stub.';
    } else if (stubStatus === 'present_disabled' || stubMode === 'disabled') {
      stubNextAction = 'Enable health/status-only local adapter stub evidence.';
    } else if (blockedByStatus || stubBlockers.length > 0) {
      stubNextAction = 'Resolve adapter-stub blocker before connection readiness review.';
    } else {
      stubNextAction = 'Advance to adapter connection readiness and approval gate planning.';
    }
  }

  const stubEvidence = [
    ...manualEvidence,
    `stub-mode:${stubMode}`,
    `stub-status:${stubStatus}`,
    `stub-connection:${stubConnectionState}`,
    `stub-health:${stubHealth}`,
    `stub-execution-capability:${stubExecutionCapability}`,
    `stub-can-execute:${stubCanExecute ? 'yes' : 'no'}`,
    `stub-inspect-only:${stubCanInspectOnly ? 'yes' : 'no'}`,
    ...stubBlockers.map((entry) => `blocker:${entry}`),
    ...stubWarnings.map((entry) => `warning:${entry}`),
  ];

  return {
    stubMode,
    stubStatus,
    stubConnectionState,
    stubExecutionCapability,
    stubHealth,
    stubCanExecute,
    stubCanInspectOnly,
    stubNextAction,
    stubBlockers,
    stubWarnings,
    stubEvidence,
    stubPresent: ['local_stub', 'simulated', 'disabled'].includes(stubMode) || ['present_disabled', 'simulated_ready', 'health_check_only'].includes(stubStatus),
  };
}
