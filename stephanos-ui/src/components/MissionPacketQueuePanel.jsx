import { useMemo, useState } from 'react';
import CollapsiblePanel from './CollapsiblePanel';
import { useAIStore } from '../state/aiStore';
import { writeTextToClipboard } from '../utils/clipboardCopy';
import {
  deriveMissionPacketActionState,
  normalizeMissionPacketTruth,
} from '../state/missionPacketWorkflow';
import { buildCanonicalMissionPacket } from '../state/runtimeOrchestrationTruth';

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

  const handleAction = (action) => {
    applyMissionPacketWorkflowAction(action, packetTruth, new Date().toISOString());
    setNotice(`Mission packet ${action} applied.`);
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
        <li>Recommended Next Action: {canonicalMissionPacket.recommendedNextAction}</li>
      </ul>
      <div className="status-panel-copy-actions" data-no-drag>
        <button type="button" disabled={!actionState.canAccept} onClick={() => handleAction('accept')}>Accept packet</button>
        <button type="button" disabled={!actionState.canReject} onClick={() => handleAction('reject')}>Reject packet</button>
        <button type="button" disabled={!actionState.canDefer} onClick={() => handleAction('defer')}>Defer packet</button>
        <button type="button" disabled={!actionState.canStart} onClick={() => handleAction('start')}>Mark in progress</button>
        <button type="button" disabled={!actionState.canComplete} onClick={() => handleAction('complete')}>Mark completed</button>
        <button type="button" disabled={!actionState.canFail} onClick={() => handleAction('fail')}>Mark failed</button>
        <button type="button" disabled={!actionState.canRollback} onClick={() => handleAction('rollback')}>Mark rolled back</button>
        <button type="button" disabled={!actionState.canCopyCodexHandoff} onClick={handleCopyCodex}>Copy Codex handoff</button>
        <button type="button" disabled={!actionState.canPromote} onClick={() => handleAction('promote')}>Promote to roadmap/proposal queue</button>
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
