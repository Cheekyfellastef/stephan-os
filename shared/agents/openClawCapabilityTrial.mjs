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

export function buildOpenClawCapabilityTrialState({ operatorSurface = {} } = {}) {
  const validationSucceeded = ['succeeded', 'passed'].includes(String(operatorSurface.openClawHealthValidationStatus || '').trim());
  const healthPassing = operatorSurface.openClawHealthState === 'passing';
  const handshakeCompatible = operatorSurface.openClawHandshakeState === 'compatible';
  const protocolCompatible = operatorSurface.openClawProtocolCompatible === true || (validationSucceeded && handshakeCompatible);
  const readonlyAsserted = operatorSurface.openClawReadonlyAssurance?.readonlyOnly === true;
  const adapterValidated = validationSucceeded
    && healthPassing
    && handshakeCompatible
    && protocolCompatible
    && readonlyAsserted;
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
  return {
    adapterIdentity: asText(operatorSurface.openClawAdapterIdentity, 'missing'),
    healthState: asText(operatorSurface.openClawHealthState, 'not_run'),
    handshakeState: asText(operatorSurface.openClawHandshakeState, 'not_run'),
    protocolCompatibility: operatorSurface.openClawProtocolCompatible === true ? 'compatible' : 'not_compatible',
    readonlyAssurance: operatorSurface.openClawReadonlyAssurance?.readonlyOnly === true ? 'asserted' : 'not_asserted',
    executionAllowed: false,
    declaredSafeCapabilities: ['health_check', 'handshake_check', 'identity_report', 'safety_posture_report'],
    blockedCapabilities: ['command_execution', 'file_mutation', 'browser_control', 'git_write', 'autonomous_action'],
    suggestedNextStage: 'Operator-reviewed proposal generation only.',
  };
}
