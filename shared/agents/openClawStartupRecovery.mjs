export const OPENCLAW_STARTUP_SAFETY_LOCKS = Object.freeze({
  openClawMutation: 'locked',
  codexAutoDispatch: 'disabled',
  mergeSafety: 'no / hold',
  autoPush: 'disabled',
  paidApis: 'disabled',
  persistentMemoryWrites: 'disabled',
});

export const DEFAULT_OPENCLAW_SERVICE_NAME = 'OpenClaw';
export const DEFAULT_OPENCLAW_ENDPOINTS = ['http://127.0.0.1:8790/health', 'http://127.0.0.1:8790/status'];

function includesOpenClaw(value = '') { return /openclaw/i.test(String(value || '')); }

export function createOpenClawStartupRecoveryPacket({
  reason = 'unknown', processState = 'unknown', serviceState = 'unknown', endpointStatus = 'unknown',
  connectionVerdict = 'unknown', identityVerified = false, portOwnerVerified = false,
  recommendedRestartAction = 'Do not restart automatically. Inspect OpenClaw service identity and local gateway ownership.',
  restartEligible = false, details = {},
} = {}) {
  return {
    packetType: 'openclaw-startup-connect-recovery-v1',
    ignitionStatus: restartEligible ? 'HELD_FOR_DESKTOP_APPROVAL' : 'BLOCKED',
    reason,
    detectedProcessState: processState,
    detectedServiceState: serviceState,
    localEndpointStatus: endpointStatus,
    connectionVerdict,
    endpointIdentityVerified: identityVerified,
    portOwnerVerified,
    recommendedRestartAction,
    desktopApproval: restartEligible ? { buttonLabel: 'Restart OpenClaw service', approvalCommand: 'npm run stephanos:ignite -- --approve-openclaw-service-restart' } : null,
    safetyLocks: { ...OPENCLAW_STARTUP_SAFETY_LOCKS },
    forbiddenActions: ['no OpenClaw task execution', 'no OpenClaw mutation command', 'no Codex dispatch', 'no merge readiness change', 'no auto-push'],
    details,
  };
}

export function classifyOpenClawReadiness({ process = {}, service = {}, endpoint = {}, portOwner = {} } = {}) {
  const processRunning = process.running === true || service.running === true;
  const processKnown = includesOpenClaw(process.name) || includesOpenClaw(process.commandLine) || includesOpenClaw(service.name) || includesOpenClaw(service.displayName);
  const ownerKnown = portOwner.verified === true || portOwner.present !== true || includesOpenClaw(portOwner.name) || includesOpenClaw(portOwner.commandLine);
  const endpointReachable = endpoint.reachable === true;
  const identityVerified = endpoint.identityVerified === true || includesOpenClaw(endpoint.identity) || includesOpenClaw(endpoint.body);
  const connected = endpoint.connectionStatus === 'healthy' || endpoint.connected === true || endpoint.health === 'healthy';

  if (!processRunning) return { state: 'not-running', healthy: false, safeRestartEligible: false, blockReason: 'openclaw-not-running' };
  if (!processKnown) return { state: 'unknown-owner-unsafe', healthy: false, safeRestartEligible: false, blockReason: 'process-service-identity-unknown' };
  if (!ownerKnown) return { state: 'unknown-owner-unsafe', healthy: false, safeRestartEligible: false, blockReason: 'port-owner-not-clearly-openclaw' };
  if (endpointReachable && !identityVerified) return { state: 'unknown-owner-unsafe', healthy: false, safeRestartEligible: false, blockReason: 'endpoint-identity-not-verified' };
  if (endpointReachable && identityVerified && connected) return { state: 'connected-healthy', healthy: true, safeRestartEligible: false, blockReason: '' };
  return { state: 'running-not-connected', healthy: false, safeRestartEligible: true, blockReason: 'openclaw-running-but-not-connected' };
}

export function buildOpenClawStartupRecoveryPacket(readiness = {}) {
  const classification = classifyOpenClawReadiness(readiness);
  const processState = readiness.process?.running || readiness.service?.running ? 'running' : 'not-running';
  const serviceState = readiness.service?.state || (readiness.service?.running ? 'running' : 'unknown');
  const endpointStatus = readiness.endpoint?.reachable ? 'reachable' : (readiness.endpoint?.status || 'unreachable-or-unknown');
  if (classification.healthy) return null;
  return createOpenClawStartupRecoveryPacket({
    reason: classification.blockReason,
    processState,
    serviceState,
    endpointStatus,
    connectionVerdict: classification.state,
    identityVerified: readiness.endpoint?.identityVerified === true || includesOpenClaw(readiness.endpoint?.identity) || includesOpenClaw(readiness.endpoint?.body),
    portOwnerVerified: readiness.portOwner?.verified === true || readiness.portOwner?.present !== true || includesOpenClaw(readiness.portOwner?.name) || includesOpenClaw(readiness.portOwner?.commandLine),
    recommendedRestartAction: classification.safeRestartEligible
      ? 'OpenClaw appears to have started on power-up but failed readiness. After desktop approval, restart only the known local OpenClaw service/process, wait briefly, and re-check readiness.'
      : 'Stop ignition. Do not restart until OpenClaw process/service identity and endpoint ownership are verified.',
    restartEligible: classification.safeRestartEligible,
    details: readiness,
  });
}
