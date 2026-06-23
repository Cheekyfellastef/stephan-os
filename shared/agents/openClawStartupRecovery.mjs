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
function isVerifiedOpenClawService(service = {}) {
  return service.exists === true && service.verified === true && service.name === DEFAULT_OPENCLAW_SERVICE_NAME;
}
function isReadonlyAdapterProcess(process = {}) {
  return /node(?:\.exe)?$/i.test(String(process.name || '').trim()) && /scripts[\\/]openclaw-readonly-adapter-stub\.mjs/i.test(String(process.commandLine || ''));
}
function isPortOwnerVerified(portOwner = {}) {
  return portOwner.present === true && portOwner.verified === true;
}

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
  const serviceVerified = isVerifiedOpenClawService(service);
  const serviceRunning = serviceVerified && service.running === true;
  const adapterOnly = isReadonlyAdapterProcess(process) && !serviceVerified;
  const endpointReachable = endpoint.reachable === true;
  const identityVerified = endpoint.identityVerified === true || includesOpenClaw(endpoint.identity) || includesOpenClaw(endpoint.body);
  const portOwnerVerified = isPortOwnerVerified(portOwner);
  const connected = endpoint.connectionStatus === 'healthy' || endpoint.connected === true || endpoint.health === 'healthy';

  if (adapterOnly) return { state: 'openclaw-adapter-only', healthy: false, safeRestartEligible: false, blockReason: 'openclaw-adapter-only' };
  if (service.exists === false || service.running === false) return { state: 'openclaw-service-missing', healthy: false, safeRestartEligible: false, blockReason: 'openclaw-service-missing' };
  if (!serviceVerified) return { state: 'openclaw-unknown-owner', healthy: false, safeRestartEligible: false, blockReason: 'openclaw-service-identity-not-verified' };
  if (!serviceRunning) return { state: 'openclaw-service-missing', healthy: false, safeRestartEligible: false, blockReason: 'openclaw-service-not-running' };
  if (!portOwnerVerified) return { state: 'openclaw-unknown-owner', healthy: false, safeRestartEligible: false, blockReason: 'port-owner-not-clearly-openclaw' };
  if (endpointReachable && !identityVerified) return { state: 'openclaw-unknown-owner', healthy: false, safeRestartEligible: false, blockReason: 'endpoint-identity-not-verified' };
  if (endpointReachable && identityVerified && connected) return { state: 'openclaw-service-running-connected', healthy: true, safeRestartEligible: false, blockReason: '' };
  return { state: 'openclaw-service-running-not-connected', healthy: false, safeRestartEligible: true, blockReason: 'openclaw-service-running-not-connected' };
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
    portOwnerVerified: isPortOwnerVerified(readiness.portOwner),
    recommendedRestartAction: classification.state === 'openclaw-adapter-only'
      ? 'OpenClaw Windows service was not found; only the readonly adapter is running. Start/restart OpenClaw Standalone manually or configure the service identity.'
      : classification.safeRestartEligible
        ? 'OpenClaw verified Windows service is running but not connected. After desktop approval, restart exactly the verified OpenClaw service, wait briefly, and re-check readiness.'
        : 'Stop ignition. Do not restart until OpenClaw Windows service identity and endpoint ownership are verified.',
    restartEligible: classification.safeRestartEligible,
    details: readiness,
  });
}
