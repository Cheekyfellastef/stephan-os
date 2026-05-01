function asText(value = '', fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export const OPENCLAW_ALLOWED_TRIAL_ACTIONS = [
  'report_identity',
  'report_declared_capabilities',
  'report_safety_posture',
  'report_required_permissions',
];

export const OPENCLAW_FORBIDDEN_TRIAL_ACTIONS = [
  'execute_command',
  'edit_file',
  'control_browser',
  'write_git',
  'mutate_system',
];

export function evaluateReadonlyValidationTruth({
  operatorSurface = {},
  validationStatus: explicitValidationStatus,
  healthState: explicitHealthState,
  handshakeState: explicitHandshakeState,
  protocolCompatible: explicitProtocolCompatible,
  readonlyAssurance: explicitReadonlyAssurance,
  executionDisabled: explicitExecutionDisabled,
} = {}) {
  const validationStatus = String(explicitValidationStatus ?? operatorSurface.openClawHealthValidationStatus ?? '').trim();
  const validationSucceeded = ['succeeded', 'passed'].includes(validationStatus);
  const healthState = String(explicitHealthState ?? operatorSurface.openClawHealthState ?? '').trim();
  const handshakeState = String(explicitHandshakeState ?? operatorSurface.openClawHandshakeState ?? '').trim();
  const healthPassing = healthState === 'passing';
  const handshakeCompatible = handshakeState === 'compatible';
  const protocolCompatible = explicitProtocolCompatible === true
    || operatorSurface.openClawProtocolCompatible === true
    || (validationSucceeded && handshakeCompatible);
  const readonlyAssurance = explicitReadonlyAssurance ?? operatorSurface.openClawReadonlyAssurance ?? {};
  const readonlyAsserted = readonlyAssurance?.readonlyOnly === true;
  const executionDisabled = explicitExecutionDisabled !== undefined
    ? explicitExecutionDisabled === true
    : operatorSurface.openClawExecutionAllowed !== true;
  const adapterValidated = validationSucceeded
    && healthPassing
    && handshakeCompatible
    && protocolCompatible
    && readonlyAsserted
    && executionDisabled;
  return {
    validationStatus,
    healthState,
    handshakeState,
    validationSucceeded,
    healthPassing,
    handshakeCompatible,
    protocolCompatible,
    readonlyAsserted,
    executionDisabled,
    adapterValidated,
  };
}

export function buildOpenClawCapabilityTrialState({ operatorSurface = {} } = {}) {
  const readonlyTruth = evaluateReadonlyValidationTruth({ operatorSurface });
  const adapterValidated = readonlyTruth.adapterValidated;
  const trialStatus = adapterValidated ? 'ready' : 'not_started';
  const nextAction = adapterValidated
    ? 'Run readonly capability trial.'
    : 'Validate readonly adapter first.';

  return {
    trialStatus,
    adapterValidated,
    executionAllowed: false,
    capabilityMode: 'readonly_observation',
    allowedTrialActions: [...OPENCLAW_ALLOWED_TRIAL_ACTIONS],
    forbiddenTrialActions: [...OPENCLAW_FORBIDDEN_TRIAL_ACTIONS],
    operatorApprovalRequired: true,
    nextAction,
    evidence: [
      `openclaw-readonly-adapter:${adapterValidated ? 'validated' : 'pending'}`,
      `openclaw-capability-trial:${adapterValidated ? 'ready' : 'blocked'}`,
      'openclaw-execution:disabled',
      'openclaw-operator-approval:required',
    ],
  };
}

export function buildOpenClawCapabilityReport({ operatorSurface = {} } = {}) {
  const readonlyTruth = evaluateReadonlyValidationTruth({ operatorSurface });
  return {
    reportStatus: readonlyTruth.adapterValidated ? 'ready' : 'awaiting_readonly_validation',
    reportSummary: readonlyTruth.adapterValidated
      ? 'Readonly capability report is available for operator review.'
      : 'Readonly capability report is waiting for adapter validation.',
    adapterIdentity: asText(operatorSurface.openClawAdapterIdentity, 'missing'),
    healthState: asText(operatorSurface.openClawHealthState, 'not_run'),
    handshakeState: asText(operatorSurface.openClawHandshakeState, 'not_run'),
    protocolCompatibility: readonlyTruth.protocolCompatible ? 'compatible' : 'not_compatible',
    readonlyAssurance: readonlyTruth.readonlyAsserted ? 'asserted' : 'not_asserted',
    executionAllowed: false,
    declaredSafeCapabilities: ['health_check', 'handshake_check', 'identity_report', 'safety_posture_report'],
    blockedCapabilities: ['command_execution', 'file_mutation', 'browser_control', 'git_write', 'autonomous_action'],
    suggestedNextStage: 'Operator-reviewed proposal generation only.',
  };
}
