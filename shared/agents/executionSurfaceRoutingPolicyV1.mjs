export const EXECUTION_SURFACE_ROUTING_POLICY_V1_SCHEMA = 'stephanos.execution-surface-routing-policy.v1';

export const EXECUTION_SURFACE_ROUTE = Object.freeze({
  CHATGPT_GITHUB_FIRST: 'CHATGPT_GITHUB_FIRST',
  REMOTE_CODEX_BATTLE_BRIDGE: 'REMOTE_CODEX_BATTLE_BRIDGE',
  NONE: 'NONE',
});

export const EXECUTION_SURFACE_BLOCKER = Object.freeze({
  ROUTE_CAPABILITY_MISMATCH: 'BLOCKED_ROUTE_CAPABILITY_MISMATCH',
  BATTLE_BRIDGE_NOT_ATTACHED: 'BATTLE_BRIDGE_EXECUTION_SURFACE_NOT_ATTACHED',
});

const WINDOWS_RUNTIME_PATTERN = /(?:\bbattle bridge\b|\bwindows\b|\bpowershell\b|\bscheduled task\b|\btask scheduler\b|\bwatchdog\b|\blocalhost\b|127\.0\.0\.1|\b4173\b|\b8787\b|\b18789\b|\bservice control\b|\bregistry\b|\bcanonical checkout\b|\blocal runtime\b|\bserved runtime\b|\bexact runtime head\b)/i;
const CLOUD_CODEX_PATTERN = /(?:github\s+@codex|plain\s+@codex|default\s+linux|cloud\s+codex|linux\s+workspace)/i;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function goalFromInput(input = {}) {
  return input.goal && typeof input.goal === 'object' ? input.goal : input;
}

function normalizeSurface(input = {}) {
  const source = input.remoteCodexBattleBridge || input.battleBridgeWindows || input.localWindowsProof || input;
  const platform = text(source.platform || source.os || source.executionEnvironment).toLowerCase();
  const surfaceReceipt = text(source.surfaceReceipt || source.handshakeReceipt || source.capabilityReceipt || source.receiptId);
  return Object.freeze({
    surfaceId: text(source.surfaceId || source.integrationId, 'remote-codex-battle-bridge'),
    attached: source.attached === true || source.sessionAttached === true || source.connected === true,
    platform,
    isWindows: platform === 'win32' || platform === 'windows' || platform.startsWith('windows-'),
    canLocalWindowsProof: source.canLocalWindowsProof === true || source.can_local_windows_proof === true || source.localWindowsProofReady === true,
    heartbeatFresh: source.heartbeatFresh === true || source.freshHeartbeat === true,
    surfaceReceipt,
  });
}

export function classifyExecutionSurfaceRequirement(input = {}) {
  const goal = goalFromInput(input);
  const haystack = [
    goal.title,
    goal.intent,
    goal.task,
    goal.description,
    goal.summary,
    ...list(goal.requiredCapabilities),
    ...list(goal.requiredProofFamilies),
    ...list(goal.requestedProofCommands),
  ].filter(Boolean).join('\n');
  const requiresLocalWindowsProof = WINDOWS_RUNTIME_PATTERN.test(haystack);
  return Object.freeze({
    requiresLocalWindowsProof,
    requiredCapability: requiresLocalWindowsProof ? 'can_local_windows_proof' : 'can_write_repo',
    cloudCodexMentionRequested: CLOUD_CODEX_PATTERN.test(haystack),
    evidenceTermsMatched: requiresLocalWindowsProof ? haystack.match(WINDOWS_RUNTIME_PATTERN)?.[0] || 'windows-runtime' : 'source-work',
  });
}

export function buildExecutionSurfaceRouteV1({ goal = {}, surfaces = {} } = {}) {
  const requirement = classifyExecutionSurfaceRequirement(goal);
  const battleBridge = normalizeSurface(surfaces);
  const handshakeValid = battleBridge.attached
    && battleBridge.isWindows
    && battleBridge.canLocalWindowsProof
    && battleBridge.heartbeatFresh
    && Boolean(battleBridge.surfaceReceipt);

  if (requirement.requiresLocalWindowsProof && !handshakeValid) {
    const blocker = !battleBridge.attached
      ? EXECUTION_SURFACE_BLOCKER.BATTLE_BRIDGE_NOT_ATTACHED
      : EXECUTION_SURFACE_BLOCKER.ROUTE_CAPABILITY_MISMATCH;
    return Object.freeze({
      schemaVersion: EXECUTION_SURFACE_ROUTING_POLICY_V1_SCHEMA,
      requirement,
      selectedRoute: EXECUTION_SURFACE_ROUTE.NONE,
      routeReady: false,
      dispatchAllowed: false,
      cloudFallbackAllowed: false,
      forbiddenRoutes: Object.freeze(['GITHUB_CODEX_MENTION', 'DEFAULT_LINUX_CODEX_WORKSPACE']),
      battleBridge,
      blocker,
      exactNextAction: 'Attach a verified Remote Codex Battle Bridge Windows surface and publish a fresh capability handshake before dispatch. Do not use a plain GitHub @codex mention.',
      finalVerdict: blocker,
    });
  }

  if (requirement.requiresLocalWindowsProof) {
    return Object.freeze({
      schemaVersion: EXECUTION_SURFACE_ROUTING_POLICY_V1_SCHEMA,
      requirement,
      selectedRoute: EXECUTION_SURFACE_ROUTE.REMOTE_CODEX_BATTLE_BRIDGE,
      routeReady: true,
      dispatchAllowed: true,
      cloudFallbackAllowed: false,
      forbiddenRoutes: Object.freeze(['GITHUB_CODEX_MENTION', 'DEFAULT_LINUX_CODEX_WORKSPACE']),
      battleBridge,
      blocker: '',
      exactNextAction: 'Dispatch exactly one bounded task through the verified Remote Codex Battle Bridge surface and require a real task receipt plus heartbeat.',
      finalVerdict: 'EXECUTION_SURFACE_ROUTE_READY',
    });
  }

  return Object.freeze({
    schemaVersion: EXECUTION_SURFACE_ROUTING_POLICY_V1_SCHEMA,
    requirement,
    selectedRoute: EXECUTION_SURFACE_ROUTE.CHATGPT_GITHUB_FIRST,
    routeReady: true,
    dispatchAllowed: false,
    cloudFallbackAllowed: false,
    forbiddenRoutes: Object.freeze([]),
    battleBridge,
    blocker: '',
    exactNextAction: 'Use ChatGPT plus GitHub for source work; preserve Remote Codex meter for tasks that genuinely require the Battle Bridge.',
    finalVerdict: 'EXECUTION_SURFACE_ROUTE_READY',
  });
}

export function assertExecutionSurfaceRouteV1(input = {}) {
  const route = buildExecutionSurfaceRouteV1(input);
  if (!route.routeReady) {
    const error = new Error(route.blocker);
    error.code = route.blocker;
    error.route = route;
    throw error;
  }
  return route;
}
