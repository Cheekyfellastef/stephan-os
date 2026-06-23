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

function isStandaloneGatewayProcess(process = {}) {
  const commandLine = String(process.commandLine || process.CommandLine || '');
  return /node(?:\.exe)?/i.test(String(process.name || process.Name || commandLine || ''))
    && /openclaw\.mjs/i.test(commandLine)
    && /\bgateway\s+run\b/i.test(commandLine);
}

export function findVerifiedOpenClawStandaloneGatewayCandidate(discovery = {}) {
  const processes = asArray(discovery.candidateProcesses);
  const ports = asArray(discovery.candidatePorts);
  for (const processEntry of processes) {
    if (!isStandaloneGatewayProcess(processEntry)) continue;
    const pid = Number(processEntry.pid || processEntry.ProcessId || processEntry.processId || 0);
    const port = ports.find((candidatePort) => {
      const owner = Number(candidatePort.owningProcess || candidatePort.OwningProcess || 0);
      const localAddress = String(candidatePort.localAddress || candidatePort.LocalAddress || '');
      const localPort = Number(candidatePort.localPort || candidatePort.LocalPort || 0);
      return pid > 0
        && owner === pid
        && localPort > 0
        && /^(127\.0\.0\.1|localhost|::1|0\.0\.0\.0|\*)$/i.test(localAddress || '127.0.0.1');
    });
    if (port) {
      return {
        verified: true,
        identity: 'standalone-gateway-candidate',
        pid,
        process: processEntry,
        port,
        candidatePort: Number(port.localPort || port.LocalPort),
      };
    }
  }
  return null;
}


function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return [value];
  return [];
}

function isReadonlyAdapterCandidate(candidate = {}) {
  return /scripts[\\/]openclaw-readonly-adapter-stub\.mjs/i.test(String(candidate.commandLine || candidate.CommandLine || ''));
}

export function createOpenClawStandaloneDiscoveryPacket({
  candidateServices = [], candidateProcesses = [], candidatePorts = [], configuredLaunchTargets = [],
} = {}) {
  const services = asArray(candidateServices);
  const processes = asArray(candidateProcesses).filter((candidate) => !isReadonlyAdapterCandidate(candidate));
  const ports = asArray(candidatePorts);
  const launchTargets = asArray(configuredLaunchTargets);
  const adapterOnly = services.length === 0 && processes.length === 0 && ports.length === 0 && launchTargets.length === 0 ? 'yes' : 'no';
  const verifiedStandaloneIdentity = 'no';
  const verifiedRestartTarget = 'none';
  const recommendedOperatorAction = adapterOnly === 'yes'
    ? 'Only the readonly adapter is proven. Start OpenClaw Standalone manually or configure its service/path identity; do not restart from Ignite.'
    : 'Review OpenClaw Standalone candidates and add explicit identity rules before any restart target can be approved.';
  return {
    packetType: 'openclaw-standalone-discovery-v1',
    discoveryMode: 'read-only',
    adapterOnly,
    candidateServices: services,
    candidateProcesses: processes,
    candidatePorts: ports,
    configuredLaunchTargets: launchTargets,
    verifiedStandaloneIdentity,
    verifiedRestartTarget,
    recommendedOperatorAction,
    safetyLocks: { ...OPENCLAW_STARTUP_SAFETY_LOCKS },
    forbiddenActions: ['no restart', 'no restart approval button', 'no OpenClaw task execution', 'no OpenClaw mutation command', 'no Codex dispatch', 'no merge readiness change'],
  };
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

export function classifyOpenClawReadiness({ process = {}, service = {}, endpoint = {}, portOwner = {}, standaloneGatewayCandidate = null } = {}) {
  const serviceVerified = isVerifiedOpenClawService(service);
  const serviceRunning = serviceVerified && service.running === true;
  const adapterOnly = isReadonlyAdapterProcess(process) && !serviceVerified;
  const endpointReachable = endpoint.reachable === true;
  const identityVerified = endpoint.identityVerified === true || includesOpenClaw(endpoint.identity) || includesOpenClaw(endpoint.body);
  const portOwnerVerified = isPortOwnerVerified(portOwner);
  const connected = endpoint.connectionStatus === 'healthy' || endpoint.connected === true || endpoint.health === 'healthy';
  const gatewayCandidateVerified = standaloneGatewayCandidate?.verified === true;

  if (gatewayCandidateVerified && endpointReachable && identityVerified) return { state: 'openclaw-standalone-gateway', healthy: connected || endpointReachable, safeRestartEligible: false, blockReason: '', safeRestartTarget: 'none', restartCommandAllowed: false };
  if (gatewayCandidateVerified) return { state: 'openclaw-standalone-gateway-candidate', healthy: false, safeRestartEligible: false, blockReason: endpointReachable ? 'standalone-gateway-identity-unclear' : 'standalone-gateway-health-unreachable', safeRestartTarget: 'none', restartCommandAllowed: false };

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
    recommendedRestartAction: classification.state === 'openclaw-standalone-gateway-candidate'
      ? 'OpenClaw Standalone gateway candidate has a verified process-owned localhost port, but readiness cannot verify endpoint identity yet. Keep restart and mutation unavailable; inspect the discovery packet and strengthen identity rules.'
      : classification.state === 'openclaw-adapter-only'
        ? 'OpenClaw Windows service was not found; only the readonly adapter is running. Start/restart OpenClaw Standalone manually or configure the service identity.'
        : classification.safeRestartEligible
        ? 'OpenClaw verified Windows service is running but not connected. After desktop approval, restart exactly the verified OpenClaw service, wait briefly, and re-check readiness.'
        : 'Stop ignition. Do not restart until OpenClaw Windows service identity and endpoint ownership are verified.',
    restartEligible: classification.safeRestartEligible && classification.restartCommandAllowed !== false,
    details: readiness,
  });
}
