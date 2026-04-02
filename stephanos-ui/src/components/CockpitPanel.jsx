import { useMemo, useState } from 'react';
import { useAIStore } from '../state/aiStore';
import { ensureRuntimeStatusModel } from '../state/runtimeStatusDefaults';
import { buildFinalRouteTruthView } from '../state/finalRouteTruthView';
import CollapsiblePanel from './CollapsiblePanel';

const COCKPIT_VIEWBOX = '0 0 1000 700';

const NODE_LAYOUT = Object.freeze({
  execution: { x: 500, y: 80, label: 'Execution node' },
  localSurface: { x: 210, y: 230, label: 'Local surface' },
  hostedSurface: { x: 210, y: 380, label: 'Hosted surface' },
  backend: { x: 500, y: 305, label: 'Backend' },
  aiProviders: { x: 790, y: 230, label: 'AI provider cluster' },
  memory: { x: 500, y: 515, label: 'Memory' },
  operator: { x: 500, y: 620, label: 'Operator' },
});

const CONNECTIONS = Object.freeze([
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

function statusToneToState(value) {
  const tone = String(value || '').trim().toLowerCase();
  if (!tone) return 'unknown';
  if (tone === 'ready' || tone === 'healthy') return 'alive';
  if (tone === 'degraded' || tone === 'warning') return 'degraded';
  if (tone === 'unavailable' || tone === 'offline') return 'dead';
  return 'unknown';
}

function providerHealthStateToState(value) {
  const state = String(value || '').trim().toLowerCase();
  if (!state) return 'unknown';
  if (['healthy', 'ready', 'ok', 'online'].includes(state)) return 'alive';
  if (['degraded', 'warning', 'partial'].includes(state)) return 'degraded';
  if (['offline', 'down', 'failed', 'unreachable'].includes(state)) return 'dead';
  return 'unknown';
}

function isExecutionActive(runtimeStatus) {
  const executionTruth = String(runtimeStatus?.executionTruth || '').trim().toLowerCase();
  const executionStatus = String(runtimeStatus?.executionStatus || '').trim().toLowerCase();
  const activeSignals = new Set(['active', 'busy', 'running', 'streaming', 'executing', 'in-progress']);
  if (activeSignals.has(executionTruth) || activeSignals.has(executionStatus)) {
    return true;
  }
  return false;
}

function deriveNodeStates({ runtimeStatus, routeTruthView, apiStatus, providerHealth, workingMemory, projectMemory }) {
  const runtimeTruth = runtimeStatus.runtimeTruth ?? {};
  const reachability = runtimeTruth.reachabilityTruth ?? {};
  const providerTruth = runtimeTruth.provider ?? {};
  const routeKind = String(routeTruthView.routeKind || '').toLowerCase();
  const launchState = String(runtimeStatus.appLaunchState || '').toLowerCase();

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

  const memoryHasSignal = Boolean(
    workingMemory?.currentTask
      || workingMemory?.activeFocusLabel
      || workingMemory?.missionNote
      || projectMemory?.currentMilestone,
  );

  const executionActive = isExecutionActive(runtimeStatus);

  const nodeStates = {
    operator: launchState === 'pending' ? 'unknown' : 'alive',
    localSurface: localSurfaceBase,
    hostedSurface: hostedSurfaceBase,
    backend: backendBase,
    aiProviders: providerClusterBase,
    memory: memoryHasSignal ? 'alive' : 'unknown',
    execution: launchState === 'pending' ? 'unknown' : 'alive',
  };

  if (runtimeStatus.appLaunchState === 'pending') {
    nodeStates.execution = 'unknown';
  }

  if (routeTruthView.fallbackActive) {
    nodeStates.execution = 'degraded';
  }

  if (providerTruth.executableProvider && providerTruth.executableProvider === 'mock') {
    nodeStates.aiProviders = nodeStates.aiProviders === 'dead' ? 'dead' : 'degraded';
  }

  const activeSurface = routeKind.includes('cloud') ? 'hostedSurface' : 'localSurface';
  if (nodeStates[activeSurface] !== 'dead') {
    nodeStates[activeSurface] = 'active';
  }

  if (nodeStates.backend !== 'dead') {
    nodeStates.backend = routeTruthView.fallbackActive ? 'degraded' : (executionActive ? 'active' : 'alive');
  }

  if (executionActive && nodeStates.aiProviders === 'alive' && routeTruthView.executedProvider !== 'unknown') {
    nodeStates.aiProviders = 'active';
  }

  if (nodeStates.memory === 'alive' && (workingMemory?.recentCommands?.length || 0) > 0) {
    nodeStates.memory = 'active';
  }

  return { nodeStates, activeSurface, executionActive };
}

function deriveConnectionState({
  connection,
  nodeStates,
  activeSurface,
  fallbackActive,
  routeUsableState,
  routeReachableState,
  uiReachableState,
  executionActive,
}) {
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
      connection.id === 'localSurface-backend'
      || connection.id === 'hostedSurface-backend'
      || connection.id.startsWith('operator-')
    ) {
      return routeReachableState === 'no' ? 'broken' : 'degraded';
    }
  }

  if (fallbackActive && (connection.id === 'localSurface-backend' || connection.id === 'hostedSurface-backend')) {
    return connection.to === activeSurface || connection.from === activeSurface ? 'active' : 'degraded';
  }

  const isActivePath =
    (activeSurface === 'localSurface' && ['operator-localSurface', 'localSurface-backend'].includes(connection.id))
    || (activeSurface === 'hostedSurface' && ['operator-hostedSurface', 'hostedSurface-backend'].includes(connection.id))
    || (connection.id === 'backend-memory' && nodeStates.memory === 'active')
    || ((connection.id === 'backend-aiProviders' || connection.id === 'backend-execution') && executionActive === true);

  if (isActivePath && fromState !== 'unknown' && toState !== 'unknown') return 'active';

  if (fromState === 'degraded' || toState === 'degraded') return 'degraded';
  if (fromState === 'unknown' || toState === 'unknown') return 'unknown';
  return 'alive';
}

function stateClassName(state) {
  return `truth-${state}`;
}

export default function CockpitPanel({ forceOpen = false, standalone = false } = {}) {
  const {
    runtimeStatusModel,
    apiStatus,
    providerHealth,
    workingMemory,
    projectMemory,
    uiLayout,
    togglePanel,
  } = useAIStore();
  const [detailId, setDetailId] = useState('backend');
  const isOpen = forceOpen ? true : uiLayout.cockpitPanel !== false;

  const runtimeStatus = ensureRuntimeStatusModel(runtimeStatusModel);
  const routeTruthView = buildFinalRouteTruthView(runtimeStatus);

  const cockpitModel = useMemo(() => {
    const { nodeStates, activeSurface, executionActive } = deriveNodeStates({
      runtimeStatus,
      routeTruthView,
      apiStatus: apiStatus || {},
      providerHealth: providerHealth?.[routeTruthView.selectedProvider] || providerHealth?.[routeTruthView.executedProvider] || {},
      workingMemory,
      projectMemory,
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
        }),
      ]),
    );

    return { nodeStates, connectionStates, activeSurface };
  }, [runtimeStatus, routeTruthView, apiStatus, providerHealth, workingMemory, projectMemory]);

  const detail = useMemo(() => {
    const node = NODE_LAYOUT[detailId];
    if (node) {
      return {
        title: node.label,
        state: cockpitModel.nodeStates[detailId] || 'unknown',
        facts: [
          `Launch state: ${runtimeStatus.appLaunchState}`,
          `Route kind: ${routeTruthView.routeKind}`,
          `Fallback active: ${routeTruthView.fallbackActive ? 'yes' : 'no'}`,
        ],
      };
    }

    const connection = CONNECTIONS.find((entry) => entry.id === detailId);
    if (connection) {
      return {
        title: connection.label,
        state: cockpitModel.connectionStates[detailId] || 'unknown',
        facts: [
          `From: ${NODE_LAYOUT[connection.from].label}`,
          `To: ${NODE_LAYOUT[connection.to].label}`,
          `Route usable: ${routeTruthView.routeUsableState}`,
        ],
      };
    }

    return { title: 'Cockpit detail', state: 'unknown', facts: ['No detail selected'] };
  }, [detailId, cockpitModel, runtimeStatus.appLaunchState, routeTruthView]);

  return (
    <CollapsiblePanel
      as="aside"
      panelId="cockpitPanel"
      title="Cockpit"
      description="Read-only routing truth cockpit. Light and flow represent live runtime truth only."
      className={`cockpit-panel ${standalone ? 'cockpit-panel-standalone' : ''}`}
      isOpen={isOpen}
      onToggle={forceOpen ? () => {} : () => togglePanel('cockpitPanel')}
    >
      <div className="cockpit-shell">
        <svg className="cockpit-grid" viewBox={COCKPIT_VIEWBOX} role="img" aria-label="Stephanos routing truth cockpit">
          {CONNECTIONS.map((connection) => {
            const from = NODE_LAYOUT[connection.from];
            const to = NODE_LAYOUT[connection.to];
            const state = cockpitModel.connectionStates[connection.id] || 'unknown';

            return (
              <g
                key={connection.id}
                className={`cockpit-connection ${stateClassName(state)} ${detailId === connection.id ? 'selected' : ''}`}
                onClick={() => setDetailId(connection.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setDetailId(connection.id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="wire-base" />
                <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="wire-energy" />
              </g>
            );
          })}

          {Object.entries(NODE_LAYOUT).map(([nodeId, node]) => {
            const state = cockpitModel.nodeStates[nodeId] || 'unknown';
            return (
              <g
                key={nodeId}
                className={`cockpit-node ${stateClassName(state)} ${detailId === nodeId ? 'selected' : ''}`}
                transform={`translate(${node.x}, ${node.y})`}
                onClick={() => setDetailId(nodeId)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setDetailId(nodeId);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <circle r="42" className="node-ring" />
                <circle r="25" className="node-core" />
                <text y="66" textAnchor="middle" className="node-label">{node.label}</text>
              </g>
            );
          })}
        </svg>

        <section className={`cockpit-detail ${stateClassName(detail.state)}`} aria-live="polite">
          <h3>{detail.title}</h3>
          <p>State: <strong>{detail.state}</strong></p>
          <ul>
            {detail.facts.map((fact) => <li key={fact}>{fact}</li>)}
          </ul>
        </section>
      </div>
    </CollapsiblePanel>
  );
}

export { deriveConnectionState, deriveNodeStates, isExecutionActive };
