export const EXECUTION_SURFACE_ROUTING_POLICY_V1_SCHEMA = 'stephanos.execution-surface-routing-policy.v1';

export const EXECUTION_SURFACE_ROUTE = Object.freeze({
  CHATGPT_GITHUB_FIRST: 'CHATGPT_GITHUB_FIRST',
  CHATGPT_WORK_GITHUB: 'CHATGPT_WORK_GITHUB',
  OPENCLAW_LOCAL_BATTLE_BRIDGE: 'OPENCLAW_LOCAL_BATTLE_BRIDGE',
  REMOTE_CODEX_BATTLE_BRIDGE: 'REMOTE_CODEX_BATTLE_BRIDGE',
  MIXED_WORK_AND_LOCAL: 'MIXED_WORK_AND_LOCAL',
  NONE: 'NONE',
});

export const EXECUTION_SURFACE_BLOCKER = Object.freeze({
  ROUTE_CAPABILITY_MISMATCH: 'BLOCKED_ROUTE_CAPABILITY_MISMATCH',
  BATTLE_BRIDGE_NOT_ATTACHED: 'BATTLE_BRIDGE_EXECUTION_SURFACE_NOT_ATTACHED',
  LOCAL_SUBTASK_PENDING: 'LOCAL_EXECUTION_SUBTASK_PENDING',
});

const WINDOWS_RUNTIME_PATTERN = /(?:\bbattle bridge\b|\bwindows\b|\bpowershell\b|\bscheduled task\b|\btask scheduler\b|\bwatchdog\b|\blocalhost\b|127\.0\.0\.1|\b4173\b|\b8787\b|\b18789\b|\bservice control\b|\bregistry\b|\bcanonical checkout\b|\blocal runtime\b|\bserved runtime\b|\bexact runtime head\b)/i;
const REPOSITORY_WORK_PATTERN = /(?:\bsource(?:\s+(?:change|repair|work))?\b|\brepository\b|\brepo\b|\bcode\b|\bpull request\b|\bopen\s+(?:a\s+)?pr\b|\bbranch\b|\bcommit\b|\bimplement(?:ation)?\b|\brefactor\b|\bpatch\b|\bmodify\b|\bedit\b)/i;
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

function normalizeWindowsSurface(source = {}, defaults = {}) {
  const platform = text(source.platform || source.os || source.executionEnvironment).toLowerCase();
  const surfaceReceipt = text(source.surfaceReceipt || source.handshakeReceipt || source.capabilityReceipt || source.receiptId);
  return Object.freeze({
    surfaceId: text(source.surfaceId || source.integrationId, defaults.surfaceId || 'battle-bridge-windows'),
    surfaceClass: text(defaults.surfaceClass, 'BATTLE_BRIDGE_WINDOWS'),
    attached: source.attached === true || source.sessionAttached === true || source.connected === true,
    platform,
    isWindows: platform === 'win32' || platform === 'windows' || platform.startsWith('windows-'),
    canLocalWindowsProof: source.canLocalWindowsProof === true || source.can_local_windows_proof === true || source.localWindowsProofReady === true,
    heartbeatFresh: source.heartbeatFresh === true || source.freshHeartbeat === true,
    surfaceReceipt,
  });
}

function normalizeRemoteCodexBattleBridge(surfaces = {}) {
  const source = surfaces.remoteCodexBattleBridge
    || surfaces.battleBridgeWindows
    || surfaces.localWindowsProof
    || surfaces;
  return normalizeWindowsSurface(source, {
    surfaceId: 'remote-codex-battle-bridge',
    surfaceClass: 'REMOTE_CODEX_BATTLE_BRIDGE',
  });
}

function normalizeOpenClawLocal(surfaces = {}) {
  const source = surfaces.openClawLocal
    || surfaces.openclawLocal
    || surfaces.openClawBattleBridge
    || surfaces.openclawBattleBridge
    || {};
  return normalizeWindowsSurface(source, {
    surfaceId: 'openclaw-local-battle-bridge',
    surfaceClass: 'OPENCLAW_LOCAL_BATTLE_BRIDGE',
  });
}

function normalizeWorkSurface(surfaces = {}) {
  const source = surfaces.chatgptWork || surfaces.work || {};
  return Object.freeze({
    surfaceId: text(source.surfaceId || source.integrationId, 'chatgpt-work'),
    available: source.available === true || source.connected === true || source.attached === true,
    canRepositoryWork: source.canRepositoryWork === true
      || source.canRepoWork === true
      || source.canWriteRepo === true
      || source.can_write_repo === true,
    capabilityReceipt: text(source.capabilityReceipt || source.receiptId || source.surfaceReceipt),
  });
}

function windowsHandshakeValid(surface) {
  return surface.attached
    && surface.isWindows
    && surface.canLocalWindowsProof
    && surface.heartbeatFresh
    && Boolean(surface.surfaceReceipt);
}

function sourceRouteFor(surfaces = {}) {
  const work = normalizeWorkSurface(surfaces);
  const workReady = work.available && work.canRepositoryWork;
  return Object.freeze({
    selectedRoute: workReady
      ? EXECUTION_SURFACE_ROUTE.CHATGPT_WORK_GITHUB
      : EXECUTION_SURFACE_ROUTE.CHATGPT_GITHUB_FIRST,
    routeReady: true,
    work,
  });
}

function localRouteFor(surfaces = {}) {
  const openClaw = normalizeOpenClawLocal(surfaces);
  const remoteCodex = normalizeRemoteCodexBattleBridge(surfaces);
  if (windowsHandshakeValid(openClaw)) {
    return Object.freeze({
      selectedRoute: EXECUTION_SURFACE_ROUTE.OPENCLAW_LOCAL_BATTLE_BRIDGE,
      routeReady: true,
      surface: openClaw,
      openClaw,
      remoteCodex,
      blocker: '',
    });
  }
  if (windowsHandshakeValid(remoteCodex)) {
    return Object.freeze({
      selectedRoute: EXECUTION_SURFACE_ROUTE.REMOTE_CODEX_BATTLE_BRIDGE,
      routeReady: true,
      surface: remoteCodex,
      openClaw,
      remoteCodex,
      blocker: '',
    });
  }
  const anyAttached = openClaw.attached || remoteCodex.attached;
  return Object.freeze({
    selectedRoute: EXECUTION_SURFACE_ROUTE.NONE,
    routeReady: false,
    surface: null,
    openClaw,
    remoteCodex,
    blocker: anyAttached
      ? EXECUTION_SURFACE_BLOCKER.ROUTE_CAPABILITY_MISMATCH
      : EXECUTION_SURFACE_BLOCKER.BATTLE_BRIDGE_NOT_ATTACHED,
  });
}

export function classifyExecutionSurfaceRequirement(input = {}) {
  const goal = goalFromInput(input);
  const requiredCapabilities = list(goal.requiredCapabilities);
  const haystack = [
    goal.title,
    goal.intent,
    goal.task,
    goal.description,
    goal.summary,
    ...requiredCapabilities,
    ...list(goal.requiredProofFamilies),
    ...list(goal.requestedProofCommands),
  ].filter(Boolean).join('\n');
  const requiresLocalWindowsProof = WINDOWS_RUNTIME_PATTERN.test(haystack)
    || requiredCapabilities.some((capability) => text(capability).toLowerCase() === 'can_local_windows_proof');
  const requiresRepositoryWork = REPOSITORY_WORK_PATTERN.test(haystack)
    || requiredCapabilities.some((capability) => text(capability).toLowerCase() === 'can_write_repo');
  return Object.freeze({
    requiresLocalWindowsProof,
    requiresRepositoryWork,
    isMixedMission: requiresLocalWindowsProof && requiresRepositoryWork,
    requiredCapability: requiresLocalWindowsProof && !requiresRepositoryWork
      ? 'can_local_windows_proof'
      : requiresRepositoryWork && !requiresLocalWindowsProof
        ? 'can_write_repo'
        : requiresLocalWindowsProof && requiresRepositoryWork
          ? 'can_write_repo+can_local_windows_proof'
          : 'can_write_repo',
    cloudCodexMentionRequested: CLOUD_CODEX_PATTERN.test(haystack),
    evidenceTermsMatched: Object.freeze({
      repository: requiresRepositoryWork ? haystack.match(REPOSITORY_WORK_PATTERN)?.[0] || 'source-work' : '',
      localWindows: requiresLocalWindowsProof ? haystack.match(WINDOWS_RUNTIME_PATTERN)?.[0] || 'windows-runtime' : '',
    }),
  });
}

export function buildExecutionSurfaceRouteV1({ goal = {}, surfaces = {} } = {}) {
  const requirement = classifyExecutionSurfaceRequirement(goal);
  const sourceRoute = sourceRouteFor(surfaces);
  const localRoute = localRouteFor(surfaces);
  const forbiddenRoutes = requirement.requiresLocalWindowsProof
    ? Object.freeze(['GITHUB_CODEX_MENTION', 'DEFAULT_LINUX_CODEX_WORKSPACE'])
    : Object.freeze([]);

  if (requirement.isMixedMission) {
    if (localRoute.routeReady) {
      return Object.freeze({
        schemaVersion: EXECUTION_SURFACE_ROUTING_POLICY_V1_SCHEMA,
        requirement,
        selectedRoute: EXECUTION_SURFACE_ROUTE.MIXED_WORK_AND_LOCAL,
        selectedRoutes: Object.freeze([sourceRoute.selectedRoute, localRoute.selectedRoute]),
        sourceRoute: sourceRoute.selectedRoute,
        localRoute: localRoute.selectedRoute,
        routeReady: true,
        missionReady: true,
        sourceSubtaskReady: true,
        localSubtaskReady: true,
        partialProgressAllowed: true,
        dispatchAllowed: true,
        cloudFallbackAllowed: false,
        forbiddenRoutes,
        work: sourceRoute.work,
        battleBridge: localRoute.surface,
        localSurfaces: Object.freeze({ openClaw: localRoute.openClaw, remoteCodex: localRoute.remoteCodex }),
        blocker: '',
        exactNextAction: `Continue repository work through ${sourceRoute.selectedRoute}; route only the Windows/runtime subtask through ${localRoute.selectedRoute}. Preserve one mission identity and reconcile both receipts before completion.`,
        finalVerdict: 'EXECUTION_SURFACE_MIXED_ROUTE_READY',
      });
    }

    return Object.freeze({
      schemaVersion: EXECUTION_SURFACE_ROUTING_POLICY_V1_SCHEMA,
      requirement,
      selectedRoute: sourceRoute.selectedRoute,
      selectedRoutes: Object.freeze([sourceRoute.selectedRoute]),
      sourceRoute: sourceRoute.selectedRoute,
      localRoute: EXECUTION_SURFACE_ROUTE.NONE,
      routeReady: true,
      missionReady: false,
      sourceSubtaskReady: true,
      localSubtaskReady: false,
      partialProgressAllowed: true,
      dispatchAllowed: false,
      cloudFallbackAllowed: false,
      forbiddenRoutes,
      work: sourceRoute.work,
      battleBridge: null,
      localSurfaces: Object.freeze({ openClaw: localRoute.openClaw, remoteCodex: localRoute.remoteCodex }),
      blocker: EXECUTION_SURFACE_BLOCKER.LOCAL_SUBTASK_PENDING,
      localBlocker: localRoute.blocker,
      exactNextAction: `Continue the repository/source phase through ${sourceRoute.selectedRoute}. Keep the Windows/runtime phase pending and recover an authorised OpenClaw Local or Remote Codex Battle Bridge handshake in parallel; do not report the whole mission as unable to proceed and do not substitute plain GitHub @codex.`,
      finalVerdict: 'EXECUTION_SURFACE_PARTIAL_ROUTE_READY',
    });
  }

  if (requirement.requiresLocalWindowsProof) {
    if (!localRoute.routeReady) {
      return Object.freeze({
        schemaVersion: EXECUTION_SURFACE_ROUTING_POLICY_V1_SCHEMA,
        requirement,
        selectedRoute: EXECUTION_SURFACE_ROUTE.NONE,
        selectedRoutes: Object.freeze([]),
        sourceRoute: EXECUTION_SURFACE_ROUTE.NONE,
        localRoute: EXECUTION_SURFACE_ROUTE.NONE,
        routeReady: false,
        missionReady: false,
        sourceSubtaskReady: false,
        localSubtaskReady: false,
        partialProgressAllowed: false,
        dispatchAllowed: false,
        cloudFallbackAllowed: false,
        forbiddenRoutes,
        work: sourceRoute.work,
        battleBridge: null,
        localSurfaces: Object.freeze({ openClaw: localRoute.openClaw, remoteCodex: localRoute.remoteCodex }),
        blocker: localRoute.blocker,
        exactNextAction: 'Attach a verified OpenClaw Local or Remote Codex Battle Bridge Windows surface and publish a fresh capability handshake before dispatch. Do not use a plain GitHub @codex mention.',
        finalVerdict: localRoute.blocker,
      });
    }

    return Object.freeze({
      schemaVersion: EXECUTION_SURFACE_ROUTING_POLICY_V1_SCHEMA,
      requirement,
      selectedRoute: localRoute.selectedRoute,
      selectedRoutes: Object.freeze([localRoute.selectedRoute]),
      sourceRoute: EXECUTION_SURFACE_ROUTE.NONE,
      localRoute: localRoute.selectedRoute,
      routeReady: true,
      missionReady: true,
      sourceSubtaskReady: false,
      localSubtaskReady: true,
      partialProgressAllowed: false,
      dispatchAllowed: true,
      cloudFallbackAllowed: false,
      forbiddenRoutes,
      work: sourceRoute.work,
      battleBridge: localRoute.surface,
      localSurfaces: Object.freeze({ openClaw: localRoute.openClaw, remoteCodex: localRoute.remoteCodex }),
      blocker: '',
      exactNextAction: `Dispatch exactly one bounded local task through ${localRoute.selectedRoute} and require a real task receipt plus heartbeat.`,
      finalVerdict: 'EXECUTION_SURFACE_ROUTE_READY',
    });
  }

  return Object.freeze({
    schemaVersion: EXECUTION_SURFACE_ROUTING_POLICY_V1_SCHEMA,
    requirement,
    selectedRoute: sourceRoute.selectedRoute,
    selectedRoutes: Object.freeze([sourceRoute.selectedRoute]),
    sourceRoute: sourceRoute.selectedRoute,
    localRoute: EXECUTION_SURFACE_ROUTE.NONE,
    routeReady: true,
    missionReady: true,
    sourceSubtaskReady: true,
    localSubtaskReady: false,
    partialProgressAllowed: false,
    dispatchAllowed: false,
    cloudFallbackAllowed: false,
    forbiddenRoutes,
    work: sourceRoute.work,
    battleBridge: null,
    localSurfaces: Object.freeze({ openClaw: localRoute.openClaw, remoteCodex: localRoute.remoteCodex }),
    blocker: '',
    exactNextAction: sourceRoute.selectedRoute === EXECUTION_SURFACE_ROUTE.CHATGPT_WORK_GITHUB
      ? 'Use ChatGPT Work plus GitHub for repository work. Keep local Windows execution as a separate subtask only when the mission actually requires it.'
      : 'Use ChatGPT plus GitHub for source work; preserve local Windows execution capacity for tasks that genuinely require the Battle Bridge.',
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
