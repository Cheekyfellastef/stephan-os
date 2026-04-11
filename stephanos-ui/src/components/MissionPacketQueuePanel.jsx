import { useMemo, useState } from 'react';
import CollapsiblePanel from './CollapsiblePanel';
import { useAIStore } from '../state/aiStore';
import { writeTextToClipboard } from '../utils/clipboardCopy';
import {
  deriveMissionPacketActionState,
  normalizeMissionPacketTruth,
} from '../state/missionPacketWorkflow';
import { buildCanonicalMissionPacket } from '../state/runtimeOrchestrationTruth';
import { deriveRuntimeOrchestrationSelectors } from '../state/runtimeOrchestrationSelectors.js';
import { adjudicateOperatorLifecycleIntent } from '../state/operatorCommandIntents.js';
import { buildOperatorGuidanceProjection } from '../state/operatorGuidanceRendering.js';
import { buildOperatorReplyPayload } from '../state/operatorReplyAdapter.js';

function formatList(values = []) {
  if (!Array.isArray(values) || values.length === 0) {
    return 'n/a';
  }
  return values.join(' · ');
}

export default function MissionPacketQueuePanel() {
  const [notice, setNotice] = useState('');
  const {
    uiLayout,
    togglePanel,
    lastExecutionMetadata,
    missionPacketWorkflow,
    applyMissionPacketWorkflowAction,
  } = useAIStore();

  const packetTruth = useMemo(
    () => normalizeMissionPacketTruth(lastExecutionMetadata || {}),
    [lastExecutionMetadata],
  );
  const actionState = useMemo(
    () => deriveMissionPacketActionState(missionPacketWorkflow, packetTruth),
    [missionPacketWorkflow, packetTruth],
  );
  const canonicalMissionPacket = useMemo(
    () => buildCanonicalMissionPacket({ missionPacketTruth: packetTruth, missionPacketWorkflow }),
    [missionPacketWorkflow, packetTruth],
  );
  const orchestrationSelectors = useMemo(() => deriveRuntimeOrchestrationSelectors({
    canonicalMissionPacket,
    missionPacketWorkflow,
  }), [canonicalMissionPacket, missionPacketWorkflow]);
  const operatorGuidance = useMemo(() => buildOperatorGuidanceProjection({
    orchestrationTruth: { selectors: orchestrationSelectors },
  }), [orchestrationSelectors]);

  const handleAction = (intentKey) => {
    const envelope = adjudicateOperatorLifecycleIntent({
      intentKey,
      selectors: orchestrationSelectors,
      missionPacketWorkflow,
      packetTruth,
      now: new Date().toISOString(),
    });
    if (envelope.workflowAction && envelope.actionApplied === true) {
      applyMissionPacketWorkflowAction(envelope.workflowAction, packetTruth, new Date().toISOString());
    }
    const reply = buildOperatorReplyPayload({
      promptKey: intentKey,
      orchestrationTruth: { selectors: orchestrationSelectors },
      latestResponseEnvelope: envelope,
    });
    setNotice(reply.text || envelope.operatorMessage);
  };

  const handleCopyCodex = async () => {
    const result = await writeTextToClipboard(packetTruth.codexHandoffPayload || '');
    if (result.ok) {
      applyMissionPacketWorkflowAction('copy-codex-handoff', packetTruth, new Date().toISOString());
      setNotice('Codex handoff copied.');
    } else {
      setNotice(`Codex handoff copy failed (${result.reason || 'unknown'}).`);
    }
  };

  const latestActivity = missionPacketWorkflow?.activity?.slice(0, 4) || [];

  return (
    <CollapsiblePanel
      as="aside"
      panelId="missionPacketQueuePanel"
      title="Mission Packet / Build Queue"
      description="Operator workflow for deterministic mission packet review, approval gating, and queue promotion."
      className="mission-packet-queue-panel"
      isOpen={uiLayout?.missionPacketQueuePanel !== false}
      onToggle={() => togglePanel('missionPacketQueuePanel')}
    >
      {notice ? <p className="muted">{notice}</p> : null}
      <ul className="compact-list">
        <li>Recommended Move: {packetTruth.moveTitle || 'n/a'} ({packetTruth.moveId || 'n/a'})</li>
        <li>Rationale: {packetTruth.rationale || 'n/a'}</li>
        <li>Confidence: {packetTruth.confidence}</li>
        <li>Dependencies: {formatList(packetTruth.dependencies)}</li>
        <li>Blockers: {formatList(packetTruth.blockers)}</li>
        <li>Evidence: {formatList(packetTruth.evidence)}</li>
        <li>Codex Handoff: {packetTruth.codexHandoffAvailable ? 'available' : 'unavailable'}</li>
        <li>Proposal Truth Warnings: {formatList(packetTruth.warnings)}</li>
        <li>Approval Required: {String(packetTruth.approvalRequired)}</li>
        <li>Execution Eligible: {String(actionState.executionEligible)}</li>
        <li>Current Decision: {actionState.decision}</li>
        <li>Lifecycle State: {actionState.lifecycleStatus}</li>
        <li>Recommended Next Action: {operatorGuidance.nextStepSummary}</li>
        <li>Blockage: {operatorGuidance.missionLifecycleSummary.blockageReason || 'none'}</li>
        <li>Build Assistance: {operatorGuidance.buildAssistanceSummary.state || 'unavailable'}</li>
        <li>Available Now: {operatorGuidance.availableNow.map((entry) => entry.command).join(' · ') || 'none'}</li>
        <li>Blocked Because: {operatorGuidance.blockedSummary.join(' · ') || 'none'}</li>
      </ul>
      <div className="status-panel-copy-actions" data-no-drag>
        <button type="button" disabled={orchestrationSelectors?.commandReadiness?.['accept-mission']?.allowed !== true || !actionState.canAccept} onClick={() => handleAction('accept-mission')}>Accept packet</button>
        <button type="button" disabled={orchestrationSelectors?.commandReadiness?.['reject-mission']?.allowed !== true || !actionState.canReject} onClick={() => handleAction('reject-mission')}>Reject packet</button>
        <button type="button" disabled={orchestrationSelectors?.commandReadiness?.['defer-mission']?.allowed !== true || !actionState.canDefer} onClick={() => handleAction('defer-mission')}>Defer packet</button>
        <button type="button" disabled={orchestrationSelectors?.commandReadiness?.['start-mission']?.allowed !== true || !actionState.canStart} onClick={() => handleAction('start-mission')}>Mark in progress</button>
        <button type="button" disabled={orchestrationSelectors?.commandReadiness?.['complete-mission']?.allowed !== true || !actionState.canComplete} onClick={() => handleAction('complete-mission')}>Mark completed</button>
        <button type="button" disabled={orchestrationSelectors?.commandReadiness?.['fail-mission']?.allowed !== true || !actionState.canFail} onClick={() => handleAction('fail-mission')}>Mark failed</button>
        <button type="button" disabled={orchestrationSelectors?.commandReadiness?.['rollback-mission']?.allowed !== true || !actionState.canRollback} onClick={() => handleAction('rollback-mission')}>Mark rolled back</button>
        <button type="button" disabled={orchestrationSelectors?.commandReadiness?.['prepare-codex-handoff']?.allowed !== true || !actionState.canCopyCodexHandoff} onClick={() => handleAction('prepare-codex-handoff')}>Prepare Codex handoff</button>
        <button type="button" disabled={!actionState.canCopyCodexHandoff} onClick={handleCopyCodex}>Copy Codex handoff</button>
        <button type="button" disabled={!actionState.canPromote} onClick={() => applyMissionPacketWorkflowAction('promote', packetTruth, new Date().toISOString())}>Promote to roadmap/proposal queue</button>
      </div>
      <p className="muted">
        Queue status: proposal {missionPacketWorkflow?.proposalQueue?.length || 0} · roadmap {missionPacketWorkflow?.roadmapQueue?.length || 0}
      </p>
      <ul className="compact-list">
        {latestActivity.map((event) => <li key={event.id}>{event.type} · {event.summary}</li>)}
        {latestActivity.length === 0 ? <li className="muted">No mission packet operator activity yet.</li> : null}
      </ul>
    </CollapsiblePanel>
  );
}
