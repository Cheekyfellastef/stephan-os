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
  memory: { x: 500, y: 462, label: 'Memory' },
  operator: { x: 500, y: 620, label: 'Operator' },
});

const NODE_PORTS = Object.freeze({
  execution: {
    south: { x: 0, y: 42 },
  },
  localSurface: {
    eastUpper: { x: 42, y: -16 },
    eastLower: { x: 42, y: 16 },
  },
  hostedSurface: {
    eastUpper: { x: 42, y: -16 },
    eastLower: { x: 42, y: 16 },
  },
  backend: {
    westUpper: { x: -42, y: -16 },
    westLower: { x: -42, y: 20 },
    east: { x: 42, y: 0 },
    north: { x: 0, y: -42 },
    south: { x: 0, y: 42 },
  },
  aiProviders: {
    west: { x: -42, y: 0 },
  },
  memory: {
    north: { x: 0, y: -42 },
  },
  operator: {
    northWest: { x: -30, y: -22 },
    northEast: { x: 30, y: -22 },
  },
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

export const TRACE_MAP = Object.freeze({
  'operator-localSurface': {
    fromPort: 'northWest',
    toPort: 'eastUpper',
    flow: 'forward',
    via: [
      { x: 470, y: 544 },
      { x: 356, y: 544 },
      { x: 356, y: 214 },
    ],
    breakPoint: { x: 356, y: 458 },
  },
  'operator-hostedSurface': {
    fromPort: 'northEast',
    toPort: 'eastLower',
    flow: 'forward',
    via: [
      { x: 530, y: 574 },
      { x: 384, y: 574 },
      { x: 384, y: 396 },
    ],
    breakPoint: { x: 384, y: 518 },
  },
  'localSurface-backend': {
    fromPort: 'eastUpper',
    toPort: 'westUpper',
    flow: 'forward',
    via: [
      { x: 320, y: 214 },
      { x: 320, y: 258 },
      { x: 458, y: 258 },
    ],
    breakPoint: { x: 392, y: 258 },
  },
  'hostedSurface-backend': {
    fromPort: 'eastLower',
    toPort: 'westLower',
    flow: 'forward',
    via: [
      { x: 346, y: 396 },
      { x: 346, y: 348 },
      { x: 458, y: 348 },
    ],
    breakPoint: { x: 414, y: 348 },
  },
  'backend-aiProviders': {
    fromPort: 'east',
    toPort: 'west',
    flow: 'forward',
    via: [
      { x: 612, y: 305 },
      { x: 612, y: 230 },
    ],
    breakPoint: { x: 612, y: 258 },
  },
  'backend-memory': {
    fromPort: 'south',
    toPort: 'north',
    flow: 'forward',
    via: [
      { x: 500, y: 388 },
    ],
    breakPoint: { x: 500, y: 402 },
  },
  'backend-execution': {
    fromPort: 'north',
    toPort: 'south',
    flow: 'reverse',
    via: [
      { x: 500, y: 210 },
    ],
    breakPoint: { x: 500, y: 170 },
  },
});

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
    nodeStates.backend = routeTruthView.fallbackActive ? 'degraded' : 'active';
  }

  if (nodeStates.aiProviders === 'alive' && routeTruthView.executedProvider !== 'unknown') {
    nodeStates.aiProviders = 'active';
  }

  if (nodeStates.memory === 'alive' && (workingMemory?.recentCommands?.length || 0) > 0) {
    nodeStates.memory = 'active';
  }

  return { nodeStates, activeSurface };
}

function deriveConnectionState({ connection, nodeStates, activeSurface, fallbackActive, routeUsableState, uiReachableState }) {
  const fromState = nodeStates[connection.from] || 'unknown';
  const toState = nodeStates[connection.to] || 'unknown';
  const hasDead = fromState === 'dead' || toState === 'dead';
  if (hasDead) return 'broken';

  if (routeUsableState === 'no' || uiReachableState === 'no') {
    if (
      connection.id === 'localSurface-backend'
      || connection.id === 'hostedSurface-backend'
      || connection.id.startsWith('operator-')
    ) {
      return 'broken';
    }
  }

  if (fallbackActive && (connection.id === 'localSurface-backend' || connection.id === 'hostedSurface-backend')) {
    return connection.to === activeSurface || connection.from === activeSurface ? 'active' : 'degraded';
  }

  const isActivePath =
    (activeSurface === 'localSurface' && ['operator-localSurface', 'localSurface-backend'].includes(connection.id))
    || (activeSurface === 'hostedSurface' && ['operator-hostedSurface', 'hostedSurface-backend'].includes(connection.id))
    || ['backend-aiProviders', 'backend-memory', 'backend-execution'].includes(connection.id);

  if (isActivePath && fromState !== 'unknown' && toState !== 'unknown') return 'active';

  if (fromState === 'degraded' || toState === 'degraded') return 'degraded';
  if (fromState === 'unknown' || toState === 'unknown') return 'unknown';
  return 'alive';
}

function stateClassName(state) {
  return `truth-${state}`;
}

export function buildOrthogonalTrace(points = []) {
  if (!Array.isArray(points) || points.length === 0) return '';
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;

  const commands = [`M${points[0].x},${points[0].y}`];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];

    if (!next) {
      commands.push(`L${current.x},${current.y}`);
      continue;
    }

    const incomingDx = current.x - previous.x;
    const incomingDy = current.y - previous.y;
    const outgoingDx = next.x - current.x;
    const outgoingDy = next.y - current.y;

    const incomingSpan = Math.hypot(incomingDx, incomingDy);
    const outgoingSpan = Math.hypot(outgoingDx, outgoingDy);
    const cornerRadius = Math.min(22, incomingSpan / 2, outgoingSpan / 2);

    const entry = {
      x: current.x - Math.sign(incomingDx) * cornerRadius,
      y: current.y - Math.sign(incomingDy) * cornerRadius,
    };
    const exit = {
      x: current.x + Math.sign(outgoingDx) * cornerRadius,
      y: current.y + Math.sign(outgoingDy) * cornerRadius,
    };

    commands.push(`L${entry.x},${entry.y}`);
    commands.push(`Q${current.x},${current.y} ${exit.x},${exit.y}`);
  }

  return commands.join(' ');
}

export function getNodePortPoint(nodeId, portId) {
  const node = NODE_LAYOUT[nodeId];
  const port = NODE_PORTS[nodeId]?.[portId];
  if (!node || !port) return null;
  return { x: node.x + port.x, y: node.y + port.y };
}

export function buildConnectionPath(connection) {
  const route = TRACE_MAP[connection.id];
  if (!route) return '';

  const start = getNodePortPoint(connection.from, route.fromPort);
  const end = getNodePortPoint(connection.to, route.toPort);
  if (!start || !end) return '';

  return buildOrthogonalTrace([start, ...route.via, end]);
}

function normalizeSegmentOrientation(segment) {
  if (segment.x1 < segment.x2 || segment.y1 < segment.y2) {
    return segment;
  }
  if (segment.x1 === segment.x2 && segment.y1 === segment.y2) {
    return segment;
  }
  return {
    ...segment,
    x1: segment.x2,
    y1: segment.y2,
    x2: segment.x1,
    y2: segment.y1,
  };
}

function segmentsOverlap(a, b) {
  if (a.orientation !== b.orientation) return false;
  if (a.orientation === 'vertical') {
    if (a.x1 !== b.x1) return false;
    const aMin = Math.min(a.y1, a.y2);
    const aMax = Math.max(a.y1, a.y2);
    const bMin = Math.min(b.y1, b.y2);
    const bMax = Math.max(b.y1, b.y2);
    return Math.max(aMin, bMin) < Math.min(aMax, bMax);
  }
  if (a.y1 !== b.y1) return false;
  const aMin = Math.min(a.x1, a.x2);
  const aMax = Math.max(a.x1, a.x2);
  const bMin = Math.min(b.x1, b.x2);
  const bMax = Math.max(b.x1, b.x2);
  return Math.max(aMin, bMin) < Math.min(aMax, bMax);
}

function segmentsCross(a, b) {
  if (a.orientation === b.orientation) return false;
  const vertical = a.orientation === 'vertical' ? a : b;
  const horizontal = a.orientation === 'horizontal' ? a : b;
  const vx = vertical.x1;
  const hy = horizontal.y1;
  const verticalMin = Math.min(vertical.y1, vertical.y2);
  const verticalMax = Math.max(vertical.y1, vertical.y2);
  const horizontalMin = Math.min(horizontal.x1, horizontal.x2);
  const horizontalMax = Math.max(horizontal.x1, horizontal.x2);
  return vx > horizontalMin && vx < horizontalMax && hy > verticalMin && hy < verticalMax;
}

export function validateTraceMapNoShorts(connections = CONNECTIONS) {
  const allSegments = [];

  connections.forEach((connection) => {
    const route = TRACE_MAP[connection.id];
    if (!route) return;
    const start = getNodePortPoint(connection.from, route.fromPort);
    const end = getNodePortPoint(connection.to, route.toPort);
    if (!start || !end) return;
    const points = [start, ...route.via, end];
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      if (previous.x !== current.x && previous.y !== current.y) {
        continue;
      }
      const orientation = previous.x === current.x ? 'vertical' : 'horizontal';
      allSegments.push(normalizeSegmentOrientation({
        connectionId: connection.id,
        orientation,
        x1: previous.x,
        y1: previous.y,
        x2: current.x,
        y2: current.y,
      }));
    }
  });

  const shorts = [];
  for (let index = 0; index < allSegments.length; index += 1) {
    for (let peerIndex = index + 1; peerIndex < allSegments.length; peerIndex += 1) {
      const a = allSegments[index];
      const b = allSegments[peerIndex];
      if (a.connectionId === b.connectionId) continue;
      if (segmentsOverlap(a, b) || segmentsCross(a, b)) {
        shorts.push({ a: a.connectionId, b: b.connectionId });
      }
    }
  }

  return shorts;
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
    if (import.meta.env?.DEV) {
      const shorts = validateTraceMapNoShorts(CONNECTIONS);
      if (shorts.length > 0) {
        console.warn('[Cockpit] trace short detected in explicit map', shorts);
      }
    }

    const { nodeStates, activeSurface } = deriveNodeStates({
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
          uiReachableState: routeTruthView.uiReachableState,
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
            const state = cockpitModel.connectionStates[connection.id] || 'unknown';
            const routedPath = buildConnectionPath(connection);
            const trace = TRACE_MAP[connection.id];

            return (
              <g
                key={connection.id}
                className={`cockpit-connection ${stateClassName(state)} ${trace?.flow === 'reverse' ? 'flow-reverse' : 'flow-forward'} ${detailId === connection.id ? 'selected' : ''}`}
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
                <path d={routedPath} className="wire-halo" />
                <path d={routedPath} className="wire-base" />
                <path d={routedPath} className="wire-state" />
                <path d={routedPath} className="wire-energy" />
                <path d={routedPath} className="wire-energy-secondary" />
                <circle className="wire-pulse wire-pulse-primary" r="4.2" aria-hidden="true">
                  <animateMotion
                    dur={state === 'active' ? '1.1s' : state === 'degraded' ? '2.1s' : '3.4s'}
                    repeatCount="indefinite"
                    keyPoints={trace?.flow === 'reverse' ? '1;0' : '0;1'}
                    keyTimes="0;1"
                    calcMode="linear"
                    path={routedPath}
                  />
                </circle>
                <circle className="wire-pulse wire-pulse-secondary" r="2.8" aria-hidden="true">
                  <animateMotion
                    dur={state === 'active' ? '1.5s' : state === 'degraded' ? '2.8s' : '4.4s'}
                    repeatCount="indefinite"
                    begin="-0.45s"
                    keyPoints={trace?.flow === 'reverse' ? '1;0' : '0;1'}
                    keyTimes="0;1"
                    calcMode="linear"
                    path={routedPath}
                  />
                </circle>
                {state === 'broken' && trace?.breakPoint ? (
                  <g className="wire-break-marker">
                    <circle cx={trace.breakPoint.x} cy={trace.breakPoint.y} r="8.5" />
                    <line
                      x1={trace.breakPoint.x - 5}
                      y1={trace.breakPoint.y - 5}
                      x2={trace.breakPoint.x + 5}
                      y2={trace.breakPoint.y + 5}
                    />
                    <line
                      x1={trace.breakPoint.x + 5}
                      y1={trace.breakPoint.y - 5}
                      x2={trace.breakPoint.x - 5}
                      y2={trace.breakPoint.y + 5}
                    />
                  </g>
                ) : null}
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
                {Object.entries(NODE_PORTS[nodeId] || {}).map(([portId, port]) => (
                  <circle
                    key={portId}
                    cx={port.x}
                    cy={port.y}
                    r="4.2"
                    className="node-port"
                  />
                ))}
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
