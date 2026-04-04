import { useEffect, useMemo, useState } from 'react';
import { useAIStore } from '../state/aiStore';
import { ensureRuntimeStatusModel } from '../state/runtimeStatusDefaults';
import { buildFinalRouteTruthView } from '../state/finalRouteTruthView';
import { buildCockpitModel, CONNECTIONS, COCKPIT_VIEWBOX, NODE_LAYOUT } from '../state/cockpitTruthModel.js';
import { RECENT_ACTIVITY_WINDOW_MS } from '../state/continuityLoopSnapshot.js';
import CollapsiblePanel from './CollapsiblePanel';

function stateClassName(state) {
  return `truth-${state}`;
}

export default function CockpitPanel({ forceOpen = false, standalone = false, telemetryEntries = [] } = {}) {
  const {
    runtimeStatusModel,
    apiStatus,
    providerHealth,
    workingMemory,
    projectMemory,
    uiLayout,
    togglePanel,
    commandHistory,
  } = useAIStore();
  const [detailId, setDetailId] = useState('backend');
  const [isPageVisible, setIsPageVisible] = useState(() => (typeof document === 'undefined' ? true : document.visibilityState === 'visible'));
  const [activityExpiryTick, setActivityExpiryTick] = useState(0);
  const isOpen = forceOpen ? true : uiLayout.cockpitPanel !== false;
  const shouldRenderCockpit = isOpen && isPageVisible;

  const runtimeStatus = ensureRuntimeStatusModel(runtimeStatusModel);
  const routeTruthView = buildFinalRouteTruthView(runtimeStatus);

  const cockpitModel = useMemo(() => {
    if (!shouldRenderCockpit) {
      return null;
    }
    return buildCockpitModel({
      runtimeStatus,
      routeTruthView,
      apiStatus: apiStatus || {},
      providerHealth: providerHealth?.[routeTruthView.selectedProvider] || providerHealth?.[routeTruthView.executedProvider] || {},
      workingMemory,
      projectMemory,
      commandHistory,
      telemetryEntries,
    });
  }, [shouldRenderCockpit, runtimeStatus, routeTruthView, apiStatus, providerHealth, workingMemory, projectMemory, commandHistory, telemetryEntries, activityExpiryTick]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const handleVisibilityChange = () => {
      setIsPageVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!shouldRenderCockpit || !cockpitModel?.continuitySnapshot?.lastContinuityEventAt) {
      return undefined;
    }

    const lastEventAt = Date.parse(cockpitModel.continuitySnapshot.lastContinuityEventAt);
    if (!Number.isFinite(lastEventAt)) {
      return undefined;
    }
    const expiresInMs = (lastEventAt + RECENT_ACTIVITY_WINDOW_MS + 50) - Date.now();
    if (expiresInMs <= 0) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setActivityExpiryTick((value) => value + 1);
    }, expiresInMs);
    return () => window.clearTimeout(timeoutId);
  }, [shouldRenderCockpit, cockpitModel?.continuitySnapshot?.lastContinuityEventAt]);

  const detail = useMemo(() => {
    if (!cockpitModel) {
      return { title: 'Cockpit detail', state: 'unknown', facts: ['Cockpit is paused while hidden.'] };
    }
    const node = NODE_LAYOUT[detailId];
    if (node) {
      return {
        title: node.label,
        state: cockpitModel.nodeStates[detailId] || 'unknown',
        facts: [
          `Launch state: ${routeTruthView.effectiveLaunchState || runtimeStatus.appLaunchState}`,
          `Route kind: ${routeTruthView.routeKind}`,
          `Fallback active: ${routeTruthView.fallbackActive ? 'yes' : 'no'}`,
          `Continuity loop: ${cockpitModel.continuitySnapshot.continuityLoopState}`,
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
          `Continuity activity: ${cockpitModel.continuitySnapshot.recentActivityActive ? 'recent-active' : 'idle'}`,
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
      {!shouldRenderCockpit ? <p className="muted">Cockpit rendering pauses when the panel or page is hidden.</p> : null}
      {shouldRenderCockpit ? (
        <div className="cockpit-shell">
        <svg className="cockpit-grid" viewBox={COCKPIT_VIEWBOX} role="img" aria-label="Stephanos routing truth cockpit">
          {CONNECTIONS.map((connection) => {
            const from = NODE_LAYOUT[connection.from];
            const to = NODE_LAYOUT[connection.to];
            const state = cockpitModel.connectionStates[connection.id] || 'unknown';

            return (
              <g
                key={connection.id}
                className={`cockpit-connection ${stateClassName(state)} ${cockpitModel.animatedConnectionIds.includes(connection.id) ? 'cockpit-trace-animated' : ''} ${detailId === connection.id ? 'selected' : ''}`}
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
                className={`cockpit-node ${stateClassName(state)} ${cockpitModel.animatedNodeIds.includes(nodeId) ? 'cockpit-trace-animated' : ''} ${detailId === nodeId ? 'selected' : ''}`}
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
      ) : null}
    </CollapsiblePanel>
  );
}
