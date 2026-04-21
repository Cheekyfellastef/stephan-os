import { deriveContinuityLoopSnapshot } from './continuityLoopSnapshot.js';

export const COCKPIT_VIEWBOX = '0 0 1000 700';

export const NODE_LAYOUT = Object.freeze({
  execution: { x: 500, y: 80, label: 'Execution node' },
  localSurface: { x: 210, y: 230, label: 'Local surface' },
  hostedSurface: { x: 210, y: 380, label: 'Hosted surface' },
  backend: { x: 500, y: 305, label: 'Backend' },
  aiProviders: { x: 790, y: 230, label: 'AI provider cluster' },
  memory: { x: 500, y: 462.5, label: 'Memory' },
  operator: { x: 500, y: 620, label: 'Operator' },
});

export const CONNECTIONS = Object.freeze([
  { id: 'operator-localSurface', from: 'operator', to: 'localSurface', label: 'Operator → Local surface' },
  { id: 'operator-hostedSurface', from: 'operator', to: 'hostedSurface', label: 'Operator → Hosted surface' },
  { id: 'localSurface-backend', from: 'localSurface', to: 'backend', label: 'Local surface ↔ Backend' },
  { id: 'hostedSurface-backend', from: 'hostedSurface', to: 'backend', label: 'Hosted surface ↔ Backend' },
  { id: 'backend-aiProviders', from: 'backend', to: 'aiProviders', label: 'Backend ↔ AI providers' },
  { id: 'backend-memory', from: 'backend', to: 'memory', label: 'Backend ↔ Memory' },
  { id: 'backend-execution', from: 'backend', to: 'execution', label: 'Backend ↔ Tile execution node' },
]);

function toStateFromBoolean(value) {
  if (value === true) return 'alive';
  if (value === false) return 'dead';
  return 'unknown';
}

function providerHealthStateToState(value) {
  const state = String(value || '').trim().toLowerCase();
  if (!state) return 'unknown';
  if (['healthy', 'ready', 'ok', 'online'].includes(state)) return 'alive';
  if (['degraded', 'warning', 'partial'].includes(state)) return 'degraded';
  if (['offline', 'down', 'failed', 'unreachable', 'unhealthy'].includes(state)) return 'dead';
  return 'unknown';
}

export function isExecutionActive(runtimeStatus, continuitySnapshot, finalAgentView = null) {
  const executionTruth = String(runtimeStatus?.executionTruth || '').trim().toLowerCase();
  const executionStatus = String(runtimeStatus?.executionStatus || '').trim().toLowerCase();
  const appLaunchState = String(runtimeStatus?.appLaunchState || '').trim().toLowerCase();
  const activeSignals = new Set(['active', 'busy', 'running', 'streaming', 'executing', 'in-progress']);
  if (activeSignals.has(executionTruth) || activeSignals.has(executionStatus)) {
    return true;
  }

  return appLaunchState === 'ready'
    && (continuitySnapshot?.recentActivityActive === true || Boolean(finalAgentView?.actingAgentId));
}

export function deriveNodeStates({ runtimeStatus, routeTruthView, apiStatus, providerHealth, workingMemory, projectMemory, continuitySnapshot, continuityRetrievalActive = false, finalAgentView = null }) {
  const runtimeTruth = runtimeStatus.runtimeTruth ?? {};
  const reachability = runtimeTruth.reachabilityTruth ?? {};
  const providerTruth = runtimeTruth.provider ?? {};
  const routeKind = String(routeTruthView.routeKind || '').toLowerCase();
  const routeUsable = String(routeTruthView.routeUsableState || '').toLowerCase();
  const launchState = String(routeTruthView.effectiveLaunchState || runtimeStatus.appLaunchState || '').toLowerCase();

  const localSurfaceBase = toStateFromBoolean(runtimeStatus.localAvailable ?? reachability.localAvailable);
  const hostedSurfaceBase = toStateFromBoolean(runtimeStatus.cloudAvailable ?? reachability.cloudAvailable);
  const backendBase = toStateFromBoolean(
    routeTruthView.backendReachableState === 'yes'
      ? true
      : routeTruthView.backendReachableState === 'no'
        ? false
        : apiStatus.backendReachable,
  );

  const providerClusterBase = providerHealthStateToState(
    providerTruth.providerHealthState || routeTruthView.providerHealthState || providerHealth?.state,
  );

  const memoryHasSignal = continuitySnapshot.sharedMemorySource !== 'unavailable'
    || Boolean(
      workingMemory?.currentTask
      || workingMemory?.activeFocusLabel
      || workingMemory?.missionNote
      || projectMemory?.currentMilestone,
    );

  const executionActive = isExecutionActive(runtimeStatus, continuitySnapshot, finalAgentView);

  const nodeStates = {
    operator: launchState === 'pending' ? 'unknown' : 'alive',
    localSurface: localSurfaceBase,
    hostedSurface: hostedSurfaceBase,
    backend: backendBase,
    aiProviders: providerClusterBase,
    memory: memoryHasSignal ? 'alive' : 'unknown',
    execution: launchState === 'pending' ? 'unknown' : 'alive',
  };

  if (routeTruthView.fallbackActive) {
    nodeStates.execution = 'degraded';
  }

  if (providerTruth.executableProvider && providerTruth.executableProvider === 'mock') {
    nodeStates.aiProviders = nodeStates.aiProviders === 'dead' ? 'dead' : 'degraded';
  }

  const selectedSurface = routeKind.includes('cloud')
    ? 'hostedSurface'
    : routeKind === 'unavailable'
      ? null
      : 'localSurface';
  const inactiveSurface = selectedSurface === 'localSurface' ? 'hostedSurface' : 'localSurface';

  if (nodeStates[inactiveSurface] !== 'dead' && nodeStates[inactiveSurface] !== 'unknown') {
    nodeStates[inactiveSurface] = 'inactive';
  }

  if (selectedSurface && nodeStates[selectedSurface] !== 'dead') {
    nodeStates[selectedSurface] = routeUsable === 'no' ? 'degraded' : 'alive';
  }

  if (nodeStates.backend !== 'dead') {
    nodeStates.backend = routeTruthView.fallbackActive ? 'degraded' : (executionActive ? 'active' : 'alive');
  }

  if (executionActive && nodeStates.aiProviders === 'alive' && routeTruthView.executedProvider !== 'unknown') {
    nodeStates.aiProviders = 'active';
  }

  if (routeTruthView.providerMismatch) {
    if (nodeStates.aiProviders !== 'dead') {
      nodeStates.aiProviders = 'degraded';
    }
  }

  if (routeTruthView.truthInconsistent) {
    if (selectedSurface && nodeStates[selectedSurface] !== 'dead') {
      nodeStates[selectedSurface] = 'inconsistent';
    }
  }

  if (continuitySnapshot.recentActivityActive) {
    nodeStates.memory = nodeStates.memory === 'dead' ? 'dead' : 'active';
  } else if (continuityRetrievalActive) {
    nodeStates.memory = nodeStates.memory === 'dead' ? 'dead' : 'active';
  } else if (continuitySnapshot.continuityLoopState === 'degraded') {
    nodeStates.memory = nodeStates.memory === 'dead' ? 'dead' : 'degraded';
  }

  return { nodeStates, activeSurface: selectedSurface, executionActive };
}

export function deriveConnectionState({
  connection,
  nodeStates,
  activeSurface,
  fallbackActive,
  routeUsableState,
  routeReachableState,
  uiReachableState,
  executionActive,
  continuitySnapshot,
}) {
  const selectedOperatorLink = activeSurface === 'hostedSurface' ? 'operator-hostedSurface' : 'operator-localSurface';
  const selectedSurfaceBackendLink = activeSurface === 'hostedSurface' ? 'hostedSurface-backend' : 'localSurface-backend';
  const fromState = nodeStates[connection.from] || 'unknown';
  const toState = nodeStates[connection.to] || 'unknown';
  const hasDead = fromState === 'dead' || toState === 'dead';
  if (hasDead) return 'broken';

  if (routeReachableState === 'no' || uiReachableState === 'no') {
    if (
      connection.id === 'localSurface-backend'
      || connection.id === 'hostedSurface-backend'
      || connection.id.startsWith('operator-')
    ) {
      return 'broken';
    }
  }

  if (routeUsableState === 'no') {
    if (
      connection.id === selectedSurfaceBackendLink
      || connection.id === selectedOperatorLink
    ) {
      return routeReachableState === 'no' ? 'broken' : 'degraded';
    }
  }

  if ((fromState === 'inactive' || toState === 'inactive') && connection.id.startsWith('operator-')) {
    return 'inactive';
  }

  if (fallbackActive && (connection.id === 'localSurface-backend' || connection.id === 'hostedSurface-backend')) {
    return connection.to === activeSurface || connection.from === activeSurface ? 'active' : 'degraded';
  }

  const isContinuityActivityLink = connection.id === 'backend-memory' && continuitySnapshot.recentActivityActive;
  const isExecutionActivityLink = connection.id === 'backend-execution' && executionActive === true;
  const isActivePath =
    isContinuityActivityLink
    || ((connection.id === 'backend-aiProviders') && executionActive === true)
    || isExecutionActivityLink;

  if (isActivePath && fromState !== 'unknown' && toState !== 'unknown') return 'active';

  if (connection.id === 'backend-memory' && continuitySnapshot.continuityLoopState === 'degraded') {
    return 'degraded';
  }

  if (fromState === 'inconsistent' || toState === 'inconsistent') return 'inconsistent';
  if (fromState === 'degraded' || toState === 'degraded') return 'degraded';
  if (fromState === 'inactive' || toState === 'inactive') return 'inactive';
  if (fromState === 'unknown' || toState === 'unknown') return 'unknown';
  return 'alive';
}

export function buildCockpitModel({ runtimeStatus, routeTruthView, finalAgentView = null, apiStatus = {}, providerHealth = {}, workingMemory, projectMemory, commandHistory = [], telemetryEntries = [] }) {
  const continuitySnapshot = deriveContinuityLoopSnapshot({ runtimeStatus, commandHistory, telemetryEntries });
  const latestCommand = Array.isArray(commandHistory) && commandHistory.length > 0 ? commandHistory[commandHistory.length - 1] : null;
  const continuityRetrievalActive = String(latestCommand?.continuity_mode || '').trim().toLowerCase() === 'retrieval-active';
  const { nodeStates, activeSurface, executionActive } = deriveNodeStates({
    runtimeStatus,
    routeTruthView,
    apiStatus,
    providerHealth,
    workingMemory,
    projectMemory,
    continuitySnapshot,
    continuityRetrievalActive,
    finalAgentView,
  });

  const connectionStates = Object.fromEntries(
    CONNECTIONS.map((connection) => [
      connection.id,
      deriveConnectionState({
        connection,
        nodeStates,
        activeSurface,
        fallbackActive: routeTruthView.fallbackActive === true,
        routeUsableState: routeTruthView.routeUsableState,
        routeReachableState: routeTruthView.selectedRouteReachableState,
        uiReachableState: routeTruthView.uiReachableState,
        executionActive,
        continuitySnapshot,
      }),
    ]),
  );

  const animatedConnectionIds = CONNECTIONS
    .filter((connection) => {
      if (connection.id === 'backend-memory') {
        return continuitySnapshot.recentActivityActive === true;
      }
      if (connection.id === 'backend-execution' || connection.id === 'backend-aiProviders') {
        return executionActive === true;
      }
      return false;
    })
    .map((connection) => connection.id);
  const animatedNodeIds = [
    continuitySnapshot.recentActivityActive === true || continuityRetrievalActive ? 'memory' : null,
    executionActive === true ? 'execution' : null,
    executionActive === true ? 'aiProviders' : null,
  ].filter(Boolean);

  return { nodeStates, connectionStates, activeSurface, continuitySnapshot, animatedConnectionIds, animatedNodeIds };
}
