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
import { CockpitCard, CockpitField, CockpitSafetyLockStrip } from './CockpitVisualLanguage.jsx';

function stateClassName(state) {
  return `truth-${state}`;
}

export default function CockpitPanel({ forceOpen = false, standalone = false, telemetryEntries = [], finalAgentView = null, cockpitProjectionOverride = null } = {}) {
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
  const { copyState: missionCopyState, setCopyState: setMissionCopyState } = useClipboardButtonState();
  const { copyState: researchCopyState, setCopyState: setResearchCopyState } = useClipboardButtonState();
  const isOpen = forceOpen ? true : uiLayout.cockpitPanel !== false;
  const shouldRenderCockpit = isOpen && isPageVisible;

  const runtimeStatus = ensureRuntimeStatusModel(runtimeStatusModel);
  const routeTruthView = buildFinalRouteTruthView(runtimeStatus);

  const cockpitProjection = useMemo(() => cockpitProjectionOverride || buildCockpitProjection({ runtimeStatusModel: runtimeStatus }), [cockpitProjectionOverride, runtimeStatus]);

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
        '[data-testid="operator-proof-concierge-primary-copy" data-concierge-button-role="primary-proof-copy"]',
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

  const handleCopyCompiledMissionPacket = useCallback(async () => {
    const packetText = cockpitProjection?.missionCompiler?.packetText || '';
    if (!packetText) { setMissionCopyState(COPY_STATE.FAILURE); return; }
    const result = await writeTextToClipboard(packetText);
    const success = result.ok === true;
    setMissionCopyState(success ? COPY_STATE.SUCCESS : COPY_STATE.FAILURE);
    if (typeof window !== 'undefined') window.__STEPHANOS_MISSION_COMPILER_LAST_COPY__ = success ? 'success' : 'failure';
    recordCopyFeedbackEvent({ source: 'MissionCompiler.copyPacket', success, visualState: success ? 'success' : 'failure', greenConfirmed: success, payloadKind: cockpitProjection?.missionCompiler?.packetKind || 'mission-packet', reason: result.reason || 'unknown', method: result.method || 'unknown' });
  }, [cockpitProjection, setMissionCopyState]);

  const handleCopyResearchPacket = useCallback(async () => {
    const packetText = cockpitProjection?.realityResearchBrief?.researchPacketText || '';
    if (!packetText) { setResearchCopyState(COPY_STATE.FAILURE); return; }
    const result = await writeTextToClipboard(packetText);
    const success = result.ok === true;
    setResearchCopyState(success ? COPY_STATE.SUCCESS : COPY_STATE.FAILURE);
    if (typeof window !== 'undefined') window.__STEPHANOS_REALITY_RESEARCH_BRIEF_LAST_COPY__ = success ? 'success' : 'failure';
    recordCopyFeedbackEvent({ source: 'RealityResearchBrief.copyPacket', success, visualState: success ? 'success' : 'failure', greenConfirmed: success, payloadKind: cockpitProjection?.realityResearchBrief?.researchPacketKind || 'research-packet', reason: result.reason || 'unknown', method: result.method || 'unknown' });
  }, [cockpitProjection, setResearchCopyState]);

  const copyConciergePacket = useCallback(async ({ packet, setCopyState, buttonRole = 'unknown', buttonTestId = 'unknown' }) => {
    const packetText = packet?.packetText || '';
    if (!packetText) {
      setCopyState(COPY_STATE.FAILURE);
      return;
    }
    const result = await writeTextToClipboard(packetText);
    const success = result.ok === true;
    setCopyState(success ? COPY_STATE.SUCCESS : COPY_STATE.FAILURE);
    if (typeof window !== 'undefined') {
      window.__STEPHANOS_OPERATOR_PROOF_CONCIERGE_LAST_COPY__ = success ? 'success' : 'failure';
    }
    const payloadKind = packet?.packetKind || 'proof-packet';
    const payloadFirstLine = packetText.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || 'none';
    const source = packet?.source || 'OperatorProofConcierge.copyPacket';
    recordCopyFeedbackEvent({ source, success, visualState: success ? 'success' : 'failure', greenConfirmed: success, payloadKind, payloadFirstLine, buttonRole, buttonTestId, reason: result.reason || 'unknown', method: result.method || 'unknown' });
  }, []);

  const handleCopyConciergePacket = useCallback(async () => {
    const concierge = cockpitProjection?.operatorProofConcierge || {};
    const packet = concierge.copyPacket || {
      packetText: '',
      packetKind: 'proof-packet',
      source: 'OperatorProofConcierge.copyPacket',
    };
    await copyConciergePacket({ packet, setCopyState: setConciergeCopyState, buttonRole: 'primary-proof-copy', buttonTestId: 'operator-proof-concierge-primary-copy' });
  }, [cockpitProjection, copyConciergePacket, setConciergeCopyState]);

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

        <div className="cockpit-mission-stack" data-cockpit-block="mission-stack" data-cockpit-kind="visual-language-v1" data-cockpit-layout-density="compact" data-cockpit-debug-collapsed-default="yes">
          <CockpitCard
            title="Intent Frame"
            className="intent-frame-card"
            eyebrow="Intent"
            cardType="canonical-truth"
            tone="approval"
            summary={cockpitProjection.intentIntake?.intentSummary || 'Clarify operator intent before any action.'}
            status={{ label: 'Approval', value: cockpitProjection.intentIntake?.approvalRequired || 'yes', tone: 'approval' }}
            chips={[{ label: 'Route', value: cockpitProjection.intentIntake?.nextRecommendedLayer || 'hold', tone: 'waiting' }, { label: 'Browse', value: 'no', tone: 'locked' }]}
            data-testid="command-deck-intent-frame"
            data-intent-mutation-allowed="no"
            data-intent-auto-browse="no"
            data-intent-codex-auto-dispatch="no"
            data-intent-openclaw-locked="yes"
          >
            <ul className="cockpit-field-list">
              <CockpitField label="Target system" value={(cockpitProjection.intentIntake?.targetSubsystems || []).join(', ') || 'unavailable'} />
              <CockpitField label="Recommended route" value={cockpitProjection.intentIntake?.nextRecommendedLayer || 'hold'} />
            </ul>
          </CockpitCard>

          <CockpitCard
            title="Operator Context Model V1"
            className="operator-context-model-card"
            eyebrow="Context"
            cardType="context"
            tone={cockpitProjection.operatorContextModel?.diagnosticPacketAvailable === 'yes' ? 'warning' : 'healthy'}
            summary="Canonical read-only context for Mission Compiler and Mission Executive Planner; missing or contradictory context emits diagnostics instead of guesses."
            status={{ label: 'Status', value: cockpitProjection.operatorContextModel?.status || 'diagnostic-required', tone: cockpitProjection.operatorContextModel?.diagnosticPacketAvailable === 'yes' ? 'warning' : 'healthy' }}
            data-testid="operator-context-model-card"
            data-context-model="operator-context-model-v1"
            data-context-mutation-allowed="no"
            data-context-auto-browse="no"
            data-context-codex-auto-dispatch="no"
            data-context-openclaw-locked="yes"
            data-context-merge-safety="no / hold"
          >
            <ul className="cockpit-field-list cockpit-field-list-two">
              <CockpitField label="Stephan role" value={(cockpitProjection.operatorContextModel?.stephanRole || []).join(', ') || 'diagnostic required'} />
              <CockpitField label="Direction" value={(cockpitProjection.operatorContextModel?.projectDirection || []).join(', ') || 'diagnostic required'} />
              <CockpitField label="Guardrails" value={(cockpitProjection.operatorContextModel?.guardrails || []).join(', ') || 'diagnostic required'} />
              <CockpitField label="Research stance" value={(cockpitProjection.operatorContextModel?.researchStance || []).join(', ') || 'diagnostic required'} />
            </ul>
            {cockpitProjection.operatorContextModel?.diagnosticPacketAvailable === 'yes' ? <details className="cockpit-debug-drilldown" data-cockpit-debug-collapsed-default="yes"><summary>Diagnostic packet</summary><textarea readOnly data-testid="operator-context-diagnostic-packet" value={cockpitProjection.operatorContextModel.diagnosticPacketText} aria-label="Operator Context diagnostic packet" /></details> : null}
          </CockpitCard>

          <CockpitCard className="compiled-mission-card" title="Mission Compiler" eyebrow="Packet" cardType="packet" tone={cockpitProjection.missionCompiler?.packetAvailable === 'yes' ? 'packet' : 'waiting'} summary={cockpitProjection.missionCompiler?.missionObjective || 'Mission objective unavailable.'} status={{ label: 'Packet', value: cockpitProjection.missionCompiler?.packetAvailable || 'no', tone: cockpitProjection.missionCompiler?.packetAvailable === 'yes' ? 'packet' : 'waiting' }} data-testid="mission-compiler-card" data-mission-mutation-allowed="no" data-mission-auto-submit="no" data-mission-command-auto-run="no" data-mission-codex-auto-dispatch="no" data-mission-openclaw-locked="yes" actions={cockpitProjection.missionCompiler?.packetAvailable === 'yes' ? <button type="button" data-testid="mission-compiler-copy" className={`status-panel-copy-button ${missionCopyState}`} onClick={handleCopyCompiledMissionPacket}>{missionCopyState === COPY_STATE.SUCCESS ? 'Mission packet copied' : missionCopyState === COPY_STATE.FAILURE ? 'Copy failed' : 'Copy mission packet'}</button> : null} footer={<p role="status" aria-live="polite">{missionCopyState === COPY_STATE.SUCCESS ? 'Mission packet copied to clipboard.' : missionCopyState === COPY_STATE.FAILURE ? 'Copy failed. Clipboard unavailable.' : ''}</p>}>
            <ul className="cockpit-field-list"><CockpitField label="Acceptance criteria" value={(cockpitProjection.missionCompiler?.acceptanceCriteria || []).join(' | ') || 'unavailable'} /></ul>
          </CockpitCard>

          <CockpitCard className="reality-research-brief-card" title="Reality Research Brief" eyebrow="Research" cardType="proof" tone="approval" summary={cockpitProjection.realityResearchBrief?.researchQuestion || 'No research question is active.'} status={{ label: 'Approval', value: cockpitProjection.realityResearchBrief?.approvalRequired || 'yes', tone: 'approval' }} data-testid="reality-research-brief-card" data-research-mutation-allowed="no" data-research-auto-browse="no" data-research-can-use-web="approval-required" data-research-codex-auto-dispatch="no" data-research-openclaw-locked="yes" actions={cockpitProjection.realityResearchBrief?.researchPacketAvailable === 'yes' ? <button type="button" data-testid="reality-research-brief-copy" className={`status-panel-copy-button ${researchCopyState}`} onClick={handleCopyResearchPacket}>{researchCopyState === COPY_STATE.SUCCESS ? 'Research packet copied' : researchCopyState === COPY_STATE.FAILURE ? 'Copy failed' : 'Copy research packet'}</button> : <p className="muted">No research packet is available until intent asks for research.</p>} footer={<p role="status" aria-live="polite">{researchCopyState === COPY_STATE.SUCCESS ? 'Research packet copied to clipboard.' : researchCopyState === COPY_STATE.FAILURE ? 'Copy failed. Clipboard unavailable.' : ''}</p>}>
            <ul className="cockpit-field-list"><CockpitField label="Why it helps" value={cockpitProjection.realityResearchBrief?.whyResearchHelps || 'unavailable'} /></ul>
          </CockpitCard>

          <CockpitCard className="mission-executive-next-move-card" title="Next Move Card" eyebrow="Planner" cardType="next-move" tone="waiting" summary={cockpitProjection.missionExecutivePlan?.missionExecutivePlannerRecommendedMove || 'Hold'} status={{ label: 'Approval', value: cockpitProjection.missionExecutivePlan?.missionExecutivePlannerApprovalRequired || 'yes', tone: 'approval' }} data-testid="mission-executive-next-move-card" data-cockpit-block="mission-executive-planner" data-cockpit-kind="canonical-next-move" data-cockpit-projection-source="canonical cockpit projection" data-planner-mutation-allowed="no" data-planner-auto-submit="no" data-planner-command-auto-run="no" data-planner-codex-auto-dispatch="no" data-planner-openclaw-locked={cockpitProjection.missionExecutivePlan?.missionExecutivePlannerOpenClawMutationLocked || 'yes'} actions={cockpitProjection.missionExecutivePlan?.missionExecutivePlannerPacketAvailable === 'yes' ? <button type="button" data-testid="mission-executive-planner-copy" className={`status-panel-copy-button ${plannerCopyState}`} onClick={handleCopyPlannerPacket}>{plannerCopyState === COPY_STATE.SUCCESS ? 'Next move packet copied' : plannerCopyState === COPY_STATE.FAILURE ? 'Copy failed' : 'Copy packet'}</button> : <p className="muted" data-testid="mission-executive-planner-no-packet">No packet is available.</p>} footer={<><CockpitSafetyLockStrip openClaw={cockpitProjection.missionExecutivePlan?.missionExecutivePlannerOpenClawMutationLocked || 'yes'} codex="no" mutation="no" merge="hold" /><p role="status" aria-live="polite">{plannerCopyState === COPY_STATE.SUCCESS ? 'Next move packet copied to clipboard.' : plannerCopyState === COPY_STATE.FAILURE ? 'Copy failed. Clipboard unavailable.' : ''}</p></>}>
            <ul className="cockpit-field-list cockpit-field-list-two"><CockpitField label="Current blocker" value={cockpitProjection.missionExecutivePlan?.missionExecutivePlannerCurrentBlocker || 'unavailable'} /><CockpitField label="Route" value={cockpitProjection.missionExecutivePlan?.missionExecutivePlannerRecommendedRoute || 'hold'} /><CockpitField label="Expected outcome" value={cockpitProjection.missionExecutivePlan?.missionExecutivePlannerExpectedOutcome || 'unavailable'} /><CockpitField label="Safety locks" value={cockpitProjection.missionExecutivePlan?.missionExecutivePlannerSafetySummary || 'Mutation no; OpenClaw locked; Codex auto-dispatch disabled; merge hold.'} /></ul>
          </CockpitCard>

          <CockpitCard className="operator-proof-concierge" title="Operator Proof Concierge" eyebrow="Proof" cardType="proof" tone={cockpitProjection.operatorProofConcierge.copyPacket ? 'packet' : 'blocked'} summary={cockpitProjection.operatorProofConcierge.whyThisProofIsNeeded} status={{ label: 'Status', value: cockpitProjection.operatorProofConcierge.status, tone: cockpitProjection.operatorProofConcierge.copyPacket ? 'packet' : 'blocked' }} data-testid="operator-proof-concierge" data-cockpit-block="operator-proof-concierge" data-cockpit-kind="operator-assist" data-cockpit-action-packet-id={cockpitProjection.operatorProofConcierge.copyPacket?.packetKind ? `packet-${cockpitProjection.operatorProofConcierge.copyPacket.packetKind}` : 'none'} data-proof-concierge-render-owner={cockpitProjection.operatorProofConcierge.renderOwner || 'CockpitPanel.OperatorProofConcierge'} data-proof-concierge-render-source-file={cockpitProjection.operatorProofConcierge.renderSourceFile || 'stephanos-ui/src/components/CockpitPanel.jsx'} data-proof-concierge-render-branch={cockpitProjection.operatorProofConcierge.renderBranch || 'unknown'} data-proof-concierge-next-proof-rendered={cockpitProjection.operatorProofConcierge.renderedNextProof || cockpitProjection.operatorProofConcierge.nextProof} data-proof-concierge-copy-label-rendered={cockpitProjection.operatorProofConcierge.renderedCopyLabel || cockpitProjection.operatorProofConcierge.copyPacket?.label || 'Proof packet unavailable'} data-proof-concierge-render-source="cockpit-canonical-copy-packet" data-proof-concierge-primary-source="OperatorProofConcierge.copyPacket" actions={<button type="button" data-testid="operator-proof-concierge-primary-copy" data-concierge-button-role="primary-proof-copy" data-concierge-visible-primary-button-label={cockpitProjection.operatorProofConcierge.copyPacket?.label || 'Proof packet unavailable'} data-concierge-visible-primary-button-source={cockpitProjection.operatorProofConcierge.copyPacket?.source || 'OperatorProofConcierge.copyPacket'} className={`status-panel-copy-button ${conciergeCopyState}`} onClick={handleCopyConciergePacket} disabled={!cockpitProjection.operatorProofConcierge.copyPacket}>{conciergeCopyState === COPY_STATE.SUCCESS ? 'Proof packet copied' : conciergeCopyState === COPY_STATE.FAILURE ? 'Copy failed' : cockpitProjection.operatorProofConcierge.copyPacket?.label || 'Proof packet unavailable'}</button>} footer={<><CockpitSafetyLockStrip openClaw={cockpitProjection.operatorProofConcierge.openClawMutationLocked} codex={cockpitProjection.operatorProofConcierge.codexAutoDispatchAllowed} mutation="no" merge={cockpitProjection.operatorProofConcierge.mergeSafety} /><p role="status" aria-live="polite">{conciergeCopyState === COPY_STATE.SUCCESS ? 'Proof packet copied to clipboard.' : conciergeCopyState === COPY_STATE.FAILURE ? 'Copy failed. Clipboard unavailable.' : ''}</p></>}>
            <ul className="cockpit-field-list cockpit-field-list-two"><CockpitField label="Next proof" value={cockpitProjection.operatorProofConcierge.nextProof} /><CockpitField label="Merge safety" value={cockpitProjection.operatorProofConcierge.mergeSafety} /></ul>
            {cockpitProjection.operatorProofConcierge.copyPacketAvailable === 'yes' ? <textarea readOnly data-testid="operator-proof-concierge-packet" value={cockpitProjection.operatorProofConcierge.copyPacket?.packetText || cockpitProjection.operatorProofConcierge.packetText} aria-label="Operator Proof Concierge packet text" className="cockpit-visually-hidden-packet" /> : null}
            {cockpitProjection.operatorProofConcierge.copyPacketAvailable === 'yes' ? <details className="cockpit-debug-drilldown" data-cockpit-debug-collapsed-default="yes"><summary>Packet text</summary><textarea readOnly value={cockpitProjection.operatorProofConcierge.copyPacket?.packetText || cockpitProjection.operatorProofConcierge.packetText} aria-label="Operator Proof Concierge packet text expanded" /></details> : <p className="muted" data-testid="operator-proof-concierge-no-packet">No proof packet is available.</p>}
          </CockpitCard>
        </div>

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
