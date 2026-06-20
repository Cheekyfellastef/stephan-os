import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAIStore } from '../state/aiStore';
import { ensureRuntimeStatusModel } from '../state/runtimeStatusDefaults';
import { buildFinalRouteTruthView } from '../state/finalRouteTruthView';
import { buildCockpitModel, CONNECTIONS, COCKPIT_VIEWBOX, NODE_LAYOUT } from '../state/cockpitTruthModel.js';
import { buildCockpitProjection } from '../state/cockpitProjection.js';
import { COPY_STATE, useClipboardButtonState } from '../hooks/useClipboardButtonState';
import { writeTextToClipboard } from '../utils/clipboardCopy';
import { recordCopyFeedbackEvent } from '../utils/copyFeedbackRecorder';
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
    setPanelState,
    commandHistory,
  } = useAIStore();
  const [detailId, setDetailId] = useState('backend');
  const [isPageVisible, setIsPageVisible] = useState(() => (typeof document === 'undefined' ? true : document.visibilityState === 'visible'));
  const [activityExpiryTick, setActivityExpiryTick] = useState(0);
  const { copyState: conciergeCopyState, setCopyState: setConciergeCopyState } = useClipboardButtonState();
  const { copyState: plannerCopyState, setCopyState: setPlannerCopyState } = useClipboardButtonState();
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

  const resolveCockpitActionTarget = useCallback((action) => {
    const targetPaneId = action.targetPaneId === 'missionConsolePanel' || action.targetPaneId === 'aiCoreMissionConsolePanel'
      ? 'aiCoreMissionConsolePanel'
      : action.targetPaneId === 'missionPacketQueuePanel'
        ? 'missionPacketQueuePanel'
        : 'commandDeck';
    const selectorsByKind = {
      'focus-concierge-packet': [
        '[data-testid="operator-proof-concierge-copy"]',
        '[data-cockpit-action-packet-id="packet-browser-proof-checklist"]',
        '[data-cockpit-action-packet-id="packet-pr-evidence"]',
        '[data-cockpit-action-packet-id="packet-source-pack-output"]',
        '[data-testid="operator-proof-concierge"]',
      ],
      'focus-proof-intake': [
        '[data-panel-id="commandDeck"] [data-testid="command-deck-input"]',
        '[data-testid="command-deck-input"]',
        '[data-panel-id="commandDeck"] [data-testid="command-deck-composer"]',
        '[data-testid="command-deck-composer"]',
        '[data-panel-id="commandDeck"] [data-testid="command-deck-root"]',
        '[data-panel-id="commandDeck"]',
      ],
      'focus-browser-proof': [
        '[data-testid*="browser-proof"]',
        '[data-cockpit-action-packet-id="packet-browser-proof-checklist"]',
        '[data-panel-id="aiCoreMissionConsolePanel"]',
        '[data-panel-id="missionConsolePanel"]',
      ],
      'focus-pr-evidence': [
        '[data-testid*="pr-evidence"]',
        '[data-cockpit-action-packet-id="packet-pr-evidence"]',
        '[data-panel-id="missionPacketQueuePanel"]',
        '[data-panel-id="aiCoreMissionConsolePanel"]',
      ],
      'focus-source-pack': [
        '[data-testid="builder-workbench-openclaw-source-pack-output"]',
        '[data-testid="builder-workbench-openclaw-source-pack-text"]',
        '[data-cockpit-action-packet-id="packet-source-pack-output"]',
        '[data-panel-id="aiCoreMissionConsolePanel"]',
      ],
      'focus-packet-bay': [
        '[data-panel-id="missionPacketQueuePanel"]',
        '[data-testid*="packet-bay"]',
        '[data-panel-id="aiCoreMissionConsolePanel"]',
      ],
    };
    const selectors = selectorsByKind[action.kind] || [];
    return {
      targetPaneId,
      targetSelector: selectors[0] || `[data-panel-id="${targetPaneId}"]`,
      selectors: selectors.length ? selectors : [`[data-panel-id="${targetPaneId}"]`],
      unsupported: !selectorsByKind[action.kind],
    };
  }, []);

  const routeCockpitPrimaryAction = useCallback((projectionForAction = {}, sourceButton = 'primary') => {
    const clickedAt = new Date().toISOString();
    const action = {
      clicked: 'yes',
      clickedAt,
      sourceButton,
      handlerInvoked: 'yes',
      handlerOwner: 'CockpitPanel.routeCockpitPrimaryAction',
      label: projectionForAction.cockpitPrimaryActionLabel || 'unknown',
      kind: projectionForAction.cockpitPrimaryActionKind || 'unknown',
      targetPaneId: projectionForAction.cockpitPrimaryActionTargetPaneId || 'unknown',
      targetPacketId: projectionForAction.cockpitPrimaryActionTargetPacketId || 'none',
      targetSelector: 'unresolved',
      targetResolved: 'no',
      targetFound: 'no',
      focusApplied: 'no',
      scrollApplied: 'no',
      highlightApplied: 'no',
      mutationAttempted: 'no',
      result: 'pending',
      failureReason: 'none',
      source: projectionForAction.cockpitActionSource || 'canonical cockpit projection',
      renderedTextUsedForRouting: 'no',
    };
    const publish = (patch = {}) => {
      const next = { ...action, ...patch, mutationAttempted: 'no' };
      if (typeof window !== 'undefined') window.__STEPHANOS_COCKPIT_LAST_ACTION__ = next;
      return next;
    };
    publish();
    if (projectionForAction.cockpitActionStatus !== 'available') {
      publish({ result: 'failed', failureReason: 'action-disabled' });
      return;
    }
    if (typeof document === 'undefined') {
      publish({ result: 'failed', failureReason: 'document-unavailable' });
      return;
    }
    const resolved = resolveCockpitActionTarget(action);
    action.targetPaneId = resolved.targetPaneId;
    action.targetSelector = resolved.targetSelector;
    action.targetResolved = resolved.unsupported ? 'no' : 'yes';
    if (resolved.unsupported) {
      publish({ targetPaneId: resolved.targetPaneId, targetSelector: resolved.targetSelector, result: 'failed', failureReason: 'unsupported-action-kind' });
      return;
    }
    if (typeof setPanelState !== 'function') {
      publish({ targetResolved: 'yes', result: 'failed', failureReason: 'pane-open-failed' });
      return;
    }
    setPanelState(resolved.targetPaneId, true, 'cockpit-action-routing-v1');
    window.setTimeout(() => {
      const pane = document.querySelector(`[data-panel-id="${resolved.targetPaneId}"]`);
      if (!pane) {
        publish({ targetResolved: 'yes', targetFound: 'no', result: 'failed', failureReason: 'target-pane-not-found' });
        return;
      }
      const target = resolved.selectors.map((selector) => document.querySelector(selector)).find(Boolean);
      if (!target) {
        publish({ targetResolved: 'yes', targetFound: 'no', result: 'failed', failureReason: 'target-field-not-found' });
        return;
      }
      try {
        target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        action.scrollApplied = 'yes';
      } catch {
        action.scrollApplied = 'no';
      }
      try {
        if (typeof target.focus === 'function') {
          target.focus({ preventScroll: true });
          action.focusApplied = document.activeElement === target || target.matches?.(':focus') ? 'yes' : 'yes';
        }
      } catch {
        action.focusApplied = 'no';
      }
      try {
        target.setAttribute?.('data-cockpit-action-highlight', 'yes');
        pane.setAttribute?.('data-cockpit-action-highlight', 'yes');
        window.setTimeout?.(() => {
          target.removeAttribute?.('data-cockpit-action-highlight');
          pane.removeAttribute?.('data-cockpit-action-highlight');
        }, 2200);
        action.highlightApplied = 'yes';
      } catch {
        action.highlightApplied = 'no';
      }
      publish({
        targetResolved: 'yes',
        targetFound: 'yes',
        focusApplied: action.focusApplied,
        scrollApplied: action.scrollApplied,
        highlightApplied: action.highlightApplied,
        result: action.focusApplied === 'yes' ? 'focused' : 'highlighted',
        failureReason: 'none',
      });
    }, 80);
  }, [resolveCockpitActionTarget, setPanelState]);


  const handleCopyPlannerPacket = useCallback(async () => {
    const packetText = cockpitProjection?.missionExecutivePlan?.missionExecutivePlannerPacketText || '';
    if (!packetText) {
      setPlannerCopyState(COPY_STATE.FAILURE);
      return;
    }
    const result = await writeTextToClipboard(packetText);
    const success = result.ok === true;
    setPlannerCopyState(success ? COPY_STATE.SUCCESS : COPY_STATE.FAILURE);
    if (typeof window !== 'undefined') {
      window.__STEPHANOS_MISSION_EXECUTIVE_PLANNER_LAST_COPY__ = success ? 'success' : 'failure';
    }
    recordCopyFeedbackEvent({ source: 'MissionExecutivePlanner.copyPacket', success, visualState: success ? 'success' : 'failure', greenConfirmed: success, payloadKind: cockpitProjection?.missionExecutivePlan?.missionExecutivePlannerPacketKind || 'planner-packet', reason: result.reason || 'unknown', method: result.method || 'unknown' });
  }, [cockpitProjection, setPlannerCopyState]);

  const handleCopyConciergePacket = useCallback(async () => {
    const packetText = cockpitProjection?.operatorProofConcierge?.packetText || '';
    if (!packetText) {
      setConciergeCopyState(COPY_STATE.FAILURE);
      return;
    }
    const result = await writeTextToClipboard(packetText);
    const success = result.ok === true;
    setConciergeCopyState(success ? COPY_STATE.SUCCESS : COPY_STATE.FAILURE);
    if (typeof window !== 'undefined') {
      window.__STEPHANOS_OPERATOR_PROOF_CONCIERGE_LAST_COPY__ = success ? 'success' : 'failure';
    }
    recordCopyFeedbackEvent({ source: 'OperatorProofConcierge.copyPacket', success, visualState: success ? 'success' : 'failure', greenConfirmed: success, payloadKind: cockpitProjection?.operatorProofConcierge?.packetKind || 'proof-packet', reason: result.reason || 'unknown', method: result.method || 'unknown' });
  }, [cockpitProjection, setConciergeCopyState]);

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

        <section className="mission-executive-next-move-card" data-testid="mission-executive-next-move-card" data-cockpit-block="mission-executive-planner" data-cockpit-kind="canonical-next-move" data-cockpit-projection-source="canonical cockpit projection" data-planner-mutation-allowed="no" data-planner-auto-submit="no" data-planner-command-auto-run="no" data-planner-codex-auto-dispatch="no" data-planner-openclaw-locked={cockpitProjection.missionExecutivePlan?.missionExecutivePlannerOpenClawMutationLocked || 'yes'}>
          <h3>Next Move Card</h3>
          <p className="muted">Mission Executive Planner V1 derives this live plan from canonical mission proof, cockpit, concierge, merge safety, OpenClaw, and Codex dispatch truth. It copies only; it never submits, runs commands, dispatches Codex, or unlocks OpenClaw.</p>
          <ul>
            <li><strong>Current blocker:</strong> {cockpitProjection.missionExecutivePlan?.missionExecutivePlannerCurrentBlocker || 'unavailable'}</li>
            <li><strong>Why it matters:</strong> {cockpitProjection.missionExecutivePlan?.missionExecutivePlannerWhyItMatters || 'unavailable'}</li>
            <li><strong>Recommended move:</strong> {cockpitProjection.missionExecutivePlan?.missionExecutivePlannerRecommendedMove || 'Hold'}</li>
            <li><strong>Route:</strong> {cockpitProjection.missionExecutivePlan?.missionExecutivePlannerRecommendedRoute || 'hold'}</li>
            <li><strong>Approval required:</strong> {cockpitProjection.missionExecutivePlan?.missionExecutivePlannerApprovalRequired || 'yes'}</li>
            <li><strong>Expected outcome:</strong> {cockpitProjection.missionExecutivePlan?.missionExecutivePlannerExpectedOutcome || 'unavailable'}</li>
            <li><strong>Safety locks:</strong> {cockpitProjection.missionExecutivePlan?.missionExecutivePlannerSafetySummary || 'Mutation no; OpenClaw locked; Codex auto-dispatch disabled; merge hold.'}</li>
          </ul>
          {cockpitProjection.missionExecutivePlan?.missionExecutivePlannerPacketAvailable === 'yes' ? <button type="button" data-testid="mission-executive-planner-copy" className={`status-panel-copy-button ${plannerCopyState}`} onClick={handleCopyPlannerPacket}>{plannerCopyState === COPY_STATE.SUCCESS ? 'Next move packet copied' : plannerCopyState === COPY_STATE.FAILURE ? 'Copy failed' : 'Copy packet'}</button> : <p className="muted" data-testid="mission-executive-planner-no-packet">No packet is available.</p>}
          <p role="status" aria-live="polite">{plannerCopyState === COPY_STATE.SUCCESS ? 'Next move packet copied to clipboard.' : plannerCopyState === COPY_STATE.FAILURE ? 'Copy failed. Clipboard unavailable.' : ''}</p>
        </section>

        <section className="operator-proof-concierge" data-testid="operator-proof-concierge" data-cockpit-block="operator-proof-concierge" data-cockpit-kind="operator-assist" data-cockpit-action-packet-id={cockpitProjection.operatorProofConcierge.packetKind === 'none' ? 'none' : `packet-${cockpitProjection.operatorProofConcierge.packetKind}`}>
          <h3>Operator Proof Concierge</h3>
          <p className="muted">Prepares the next exact proof packet from canonical Mission Proof Reconciliation. It copies only; it never submits, runs commands, dispatches Codex, or unlocks OpenClaw.</p>
          <ul>
            <li><strong>Status:</strong> {cockpitProjection.operatorProofConcierge.status}</li>
            <li><strong>Next proof:</strong> {cockpitProjection.operatorProofConcierge.nextProof}</li>
            <li><strong>Why:</strong> {cockpitProjection.operatorProofConcierge.whyThisProofIsNeeded}</li>
            <li><strong>Merge safety:</strong> {cockpitProjection.operatorProofConcierge.mergeSafety}</li>
            <li><strong>OpenClaw mutation locked:</strong> {cockpitProjection.operatorProofConcierge.openClawMutationLocked}</li>
            <li><strong>Codex auto-dispatch allowed:</strong> {cockpitProjection.operatorProofConcierge.codexAutoDispatchAllowed}</li>
          </ul>
          {cockpitProjection.operatorProofConcierge.copyPacketAvailable === 'yes' ? <textarea readOnly data-testid="operator-proof-concierge-packet" value={cockpitProjection.operatorProofConcierge.packetText} aria-label="Operator Proof Concierge packet text" /> : <p className="muted" data-testid="operator-proof-concierge-no-packet">No proof packet is available.</p>}
          <button type="button" data-testid="operator-proof-concierge-copy" className={`status-panel-copy-button ${conciergeCopyState}`} onClick={handleCopyConciergePacket} disabled={cockpitProjection.operatorProofConcierge.copyPacketAvailable !== 'yes'}>
            {conciergeCopyState === COPY_STATE.SUCCESS ? 'Proof packet copied' : conciergeCopyState === COPY_STATE.FAILURE ? 'Copy failed' : cockpitProjection.operatorProofConcierge.nextActionLabel}
          </button>
          <p role="status" aria-live="polite">{conciergeCopyState === COPY_STATE.SUCCESS ? 'Proof packet copied to clipboard.' : conciergeCopyState === COPY_STATE.FAILURE ? 'Copy failed. Clipboard unavailable.' : ''}</p>
        </section>

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
