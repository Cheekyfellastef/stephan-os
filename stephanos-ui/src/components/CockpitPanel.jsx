import { useEffect, useMemo, useState } from 'react';
import { useAIStore } from '../state/aiStore';
import { ensureRuntimeStatusModel } from '../state/runtimeStatusDefaults';
import { buildFinalRouteTruthView } from '../state/finalRouteTruthView';
import { buildCockpitModel, CONNECTIONS, COCKPIT_VIEWBOX, NODE_LAYOUT } from '../state/cockpitTruthModel.js';
import { buildCockpitProjection } from '../state/cockpitProjection.js';
import CockpitDetailView from './CockpitDetailView.jsx';
import { RECENT_ACTIVITY_WINDOW_MS } from '../state/continuityLoopSnapshot.js';
import CollapsiblePanel from './CollapsiblePanel';

function stateClassName(state) {
  return `truth-${state}`;
}

export default function CockpitPanel({ forceOpen = false, standalone = false, telemetryEntries = [], finalAgentView = null } = {}) {
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

  const cockpitProjection = useMemo(() => buildCockpitProjection({ runtimeStatusModel: runtimeStatus }), [runtimeStatus]);

  const cockpitModel = useMemo(() => {
    if (!shouldRenderCockpit) {
      return null;
    }
    return buildCockpitModel({
      runtimeStatus,
      routeTruthView,
      finalAgentView,
      apiStatus: apiStatus || {},
      providerHealth: providerHealth?.[routeTruthView.selectedProvider] || providerHealth?.[routeTruthView.executedProvider] || {},
      workingMemory,
      projectMemory,
      commandHistory,
      telemetryEntries,
    });
  }, [shouldRenderCockpit, runtimeStatus, routeTruthView, finalAgentView, apiStatus, providerHealth, workingMemory, projectMemory, commandHistory, telemetryEntries, activityExpiryTick]);

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
          `Acting agent: ${finalAgentView?.actingAgentId || 'none'}`,
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
          `Agent fleet: ${Array.isArray(finalAgentView?.activeAgentIds) ? finalAgentView.activeAgentIds.join(', ') || 'idle' : 'idle'}`,
        ],
      };
    }

    return { title: 'Cockpit detail', state: 'unknown', facts: ['No detail selected'] };
  }, [detailId, cockpitModel, finalAgentView, runtimeStatus.appLaunchState, routeTruthView]);

  const routeCockpitPrimaryAction = (projectionForAction = {}) => {
    const action = {
      clicked: 'yes',
      label: projectionForAction.cockpitPrimaryActionLabel || 'unknown',
      kind: projectionForAction.cockpitPrimaryActionKind || 'unknown',
      targetPaneId: projectionForAction.cockpitPrimaryActionTargetPaneId || 'unknown',
      targetPacketId: projectionForAction.cockpitPrimaryActionTargetPacketId || 'none',
      targetResolved: 'no',
      targetFound: 'no',
      focusApplied: 'no',
      highlightApplied: 'no',
      mutationAttempted: 'no',
      result: 'pending',
      failureReason: 'none',
      source: projectionForAction.cockpitActionSource || 'canonical cockpit projection',
    };
    if (typeof document === 'undefined') {
      action.failureReason = 'document-unavailable';
      action.result = 'failed';
      globalThis.window && (globalThis.window.__STEPHANOS_COCKPIT_LAST_ACTION__ = action);
      return;
    }
    const panelId = action.targetPaneId === 'missionConsolePanel' ? 'missionConsolePanel' : 'commandDeck';
    setPanelState?.(panelId, true, 'cockpit-action-routing-v1');
    const selectorsByKind = {
      'focus-proof-intake': ['[data-testid="command-deck-input"]', '[data-testid="command-deck-composer"]', '[data-testid="command-deck-root"]'],
      'focus-browser-proof': ['[data-testid*="browser-proof"]', '[data-testid*="builder-workbench"]', '[data-panel-id="missionConsolePanel"]'],
      'focus-pr-evidence': ['[data-testid*="pr-evidence"]', '[data-panel-id="missionConsolePanel"]'],
      'focus-source-pack': ['[data-testid="builder-workbench-openclaw-source-pack-output"]', '[data-testid="builder-workbench-openclaw-source-pack-text"]', '[data-panel-id="missionConsolePanel"]'],
      'focus-packet-bay': ['[data-panel-id="missionConsolePanel"]'],
    };
    const selectors = selectorsByKind[action.kind] || [`[data-panel-id="${panelId}"]`];
    const applyFocus = () => {
      const target = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
      action.targetResolved = 'yes';
      action.targetFound = target ? 'yes' : 'no';
      if (target) {
        target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        target.focus?.({ preventScroll: true });
        target.setAttribute?.('data-cockpit-action-highlight', 'yes');
        window.setTimeout?.(() => target.removeAttribute?.('data-cockpit-action-highlight'), 1600);
        action.focusApplied = 'yes';
        action.highlightApplied = 'yes';
        action.result = 'focused';
      } else {
        action.result = 'failed';
        action.failureReason = 'target-not-found';
      }
      window.__STEPHANOS_COCKPIT_LAST_ACTION__ = action;
    };
    window.setTimeout(applyFocus, 0);
  };

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
        <CockpitDetailView projection={cockpitProjection} onPrimaryAction={routeCockpitPrimaryAction} />
        <section className="cockpit-route-topology" data-cockpit-block="route-topology" data-cockpit-kind="routing" data-cockpit-surface="expanded-pane" data-cockpit-projection-source="canonical cockpit projection" data-cockpit-render-signature={cockpitProjection ? cockpitProjection.currentStatus : 'unknown'} aria-label="Route Topology"><h3>Route Topology</h3><p className="muted">Routing flow only; mission proof and merge truth remain bound to the canonical cockpit projection above.</p><svg className="cockpit-grid" viewBox={COCKPIT_VIEWBOX} role="img" aria-label="Stephanos route topology">
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

        </section>
        <section className={`cockpit-detail ${stateClassName(detail.state)}`} data-cockpit-block="detail-text" aria-live="polite">
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
