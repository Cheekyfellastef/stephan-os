import { useMemo, useState } from 'react';
import { COPY_STATE, useClipboardButtonState } from '../hooks/useClipboardButtonState';
import { writeTextToClipboard } from '../utils/clipboardCopy';
import CollapsiblePanel from './CollapsiblePanel';

function formatList(list = []) {
  return Array.isArray(list) && list.length > 0 ? list.join(', ') : 'none';
}

function formatTruth(value, fallback = 'unknown') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  const text = String(value).trim();
  return text.length > 0 ? text : fallback;
}

function formatReportedList(value, fallback = 'not reported') {
  return Array.isArray(value) && value.length > 0 ? value.join(', ') : fallback;
}

export default function AgentsTile({
  finalAgentView,
  onSelectAgent,
  selectedAgentId,
  isOpen = true,
  onToggle = () => {},
  debugVisibility = false,
  openClawIntegration = null,
  agentTaskProjection = null,
} = {}) {
  const { copyState, setCopyState } = useClipboardButtonState();
  const view = finalAgentView || {};
  const visibleAgents = Array.isArray(view.visibleAgents) ? view.visibleAgents : [];
  const selected = visibleAgents.find((entry) => entry.agentId === selectedAgentId) || visibleAgents[0] || null;

  const missionView = view.finalMissionOrchestrationView || {};
  const approvalView = view.finalApprovalQueueView || {};
  const resumeView = view.finalResumeView || {};
  const memoryCapability = view.memoryCapability || {};

  const openClaw = openClawIntegration && typeof openClawIntegration === 'object' ? openClawIntegration : null;

  const agentTask = agentTaskProjection && typeof agentTaskProjection === 'object'
    ? agentTaskProjection
    : null;
  const operatorTask = agentTask?.operatorSurface || null;
  const selectedGates = selected?.adjudicationGates && typeof selected.adjudicationGates === 'object'
    ? selected.adjudicationGates
    : {};
  const gateRows = [
    ['surface gate', selectedGates.surfaceGate],
    ['session gate', selectedGates.sessionGate],
    ['dependency gate', selectedGates.dependencyGate],
    ['autonomy gate', selectedGates.autonomyGate],
    ['operator enable gate', selectedGates.operatorEnableGate],
    ['master toggle gate', selectedGates.masterToggleGate],
    ['safe mode gate', selectedGates.safeModeGate],
    ['task/intent gate', selectedGates.taskIntentGate],
    ['provider/route gate', selectedGates.providerRouteGate],
  ];
  const selectedSummary = selected
    ? `${formatTruth(selected.displayName, 'Agent')} is ${selected.eligible === true ? 'eligible' : 'not eligible'} and ${selected.enabled === true ? 'enabled' : 'disabled'}, but ${formatTruth(selected.stateReason, 'state reason not reported')}`
    : 'No selected agent.';
  const codexPacketText = useMemo(
    () => (typeof operatorTask?.codexHandoffPacketText === 'string' ? operatorTask.codexHandoffPacketText : ''),
    [operatorTask?.codexHandoffPacketText],
  );
  const [manualReturnDraft, setManualReturnDraft] = useState('');

  async function handleCopyCodexPacket() {
    if (!codexPacketText) {
      setCopyState(COPY_STATE.FAILURE);
      return;
    }
    const result = await writeTextToClipboard(codexPacketText);
    setCopyState(result.ok ? COPY_STATE.SUCCESS : COPY_STATE.FAILURE);
  }

  return (
    <CollapsiblePanel
      panelId="agentsPanel"
      title="Agents Tile"
      description="Canonical fleet projection from runtime agent truth."
      className="agents-tile"
      isOpen={isOpen}
      onToggle={onToggle}
    >
      <p className="muted">{view.operatorSummary || 'No agent projection available.'}</p>
      <div className="agents-fleet-strip" role="list" aria-label="Agent fleet strip">
        {visibleAgents.map((agent) => (
          <button
            type="button"
            key={agent.agentId}
            className={`agent-pill ${agent.pulseToken} ${agent.agentId === view.actingAgentId ? 'acting' : ''} ${agent.agentId === selected?.agentId ? 'selected' : ''}`}
            onClick={() => onSelectAgent?.(agent.agentId)}
          >
            <strong>{agent.displayName}</strong>
            <span>{agent.state}</span>
            <small>{agent.stateReason}</small>
          </button>
        ))}
      </div>


      {operatorTask ? (
        <section className="agents-region">
          <h4>Agent Task Layer v1</h4>
          <ul>
            <li><strong>Layer status:</strong> {operatorTask.layerStatus}</li>
            <li><strong>Active task:</strong> {operatorTask.activeTaskTitle}</li>
            <li><strong>Lifecycle:</strong> {operatorTask.lifecycleState}</li>
            <li><strong>Recommended agent:</strong> {operatorTask.recommendedAgent}</li>
            <li><strong>Codex readiness:</strong> {operatorTask.codexReadiness}</li>
            <li><strong>OpenClaw readiness:</strong> {operatorTask.openClawReadiness}</li>
            <li><strong>OpenClaw integration mode:</strong> {operatorTask.openClawIntegrationMode || 'policy_only'}</li>
            <li><strong>OpenClaw safe-to-use:</strong> {operatorTask.openClawSafeToUse ? 'yes' : 'no'}</li>
            <li><strong>OpenClaw execution allowed:</strong> {operatorTask.openClawExecutionAllowed ? 'yes' : 'no'}</li>
            <li><strong>OpenClaw direct automation disabled:</strong> {operatorTask.openClawDirectAutomationDisabled ? 'yes' : 'no'}</li>
            <li><strong>OpenClaw kill switch:</strong> {operatorTask.openClawKillSwitchState || 'missing'}</li>
            <li><strong>OpenClaw kill-switch mode:</strong> {operatorTask.openClawKillSwitchMode || 'unavailable'}</li>
            <li><strong>OpenClaw pause/cutoff:</strong> {operatorTask.openClawKillSwitchEngaged ? 'engaged (paused)' : 'not engaged'}</li>
            <li><strong>OpenClaw highest priority blocker:</strong> {operatorTask.openClawHighestPriorityBlocker || 'none'}</li>
            <li><strong>OpenClaw next action:</strong> {operatorTask.openClawNextAction || 'not reported'}</li>
            <li><strong>OpenClaw adapter mode:</strong> {operatorTask.openClawAdapterMode || 'design_only'}</li>
            <li><strong>OpenClaw adapter readiness:</strong> {operatorTask.openClawAdapterReadiness || 'needs_contract'}</li>
            <li><strong>OpenClaw adapter connection mode:</strong> {operatorTask.openClawAdapterConnectionMode || 'readiness_only'}</li>
            <li><strong>OpenClaw adapter connection state:</strong> {operatorTask.openClawAdapterConnectionState || 'not_connected'}</li>
            <li><strong>OpenClaw adapter endpoint configured:</strong> {operatorTask.openClawAdapterEndpointConfigured ? 'yes' : 'no'}</li>
            <li><strong>OpenClaw adapter endpoint label:</strong> {operatorTask.openClawAdapterEndpointLabel || 'none'}</li>
            <li><strong>OpenClaw adapter endpoint scope:</strong> {operatorTask.openClawAdapterEndpointScope || 'none'}</li>
            <li><strong>OpenClaw adapter endpoint mode:</strong> {operatorTask.openClawAdapterEndpointMode || 'model_only'}</li>
            <li><strong>OpenClaw adapter config persistence:</strong> {operatorTask.openClawAdapterConfigPersistenceMode || 'session_only'}</li>
            <li><strong>OpenClaw adapter expected protocol:</strong> {operatorTask.openClawAdapterExpectedProtocolVersion || 'unknown'}</li>
            <li><strong>OpenClaw adapter allowed probes:</strong> {operatorTask.openClawAdapterAllowedProbeTypes || 'none'}</li>
            <li><strong>OpenClaw adapter config ready:</strong> {operatorTask.openClawAdapterConnectionConfigReady ? 'yes' : 'no'}</li>
            <li><strong>OpenClaw adapter config next action:</strong> {operatorTask.openClawAdapterConnectionConfigNextAction || 'not reported'}</li>
            <li><strong>OpenClaw adapter config blocker:</strong> {operatorTask.openClawAdapterConnectionConfigBlockers?.[0] || 'none'}</li>
            <li><strong>OpenClaw adapter config warning:</strong> {operatorTask.openClawAdapterConnectionConfigWarnings?.[0] || 'none'}</li>
            <li><strong>OpenClaw adapter health check:</strong> {operatorTask.openClawAdapterHealthCheckState || 'not_run'}</li>
            <li><strong>OpenClaw adapter handshake:</strong> {operatorTask.openClawAdapterHandshakeState || 'not_run'}</li>
            <li><strong>OpenClaw adapter connection ready:</strong> {operatorTask.openClawAdapterConnectionReady ? 'yes' : 'no'}</li>
            <li><strong>OpenClaw adapter connection execution allowed:</strong> {operatorTask.openClawAdapterConnectionExecutionAllowed ? 'yes' : 'no'}</li>
            <li><strong>OpenClaw adapter connection next action:</strong> {operatorTask.openClawAdapterConnectionNextAction || 'not reported'}</li>
            <li><strong>OpenClaw adapter connection top blocker:</strong> {operatorTask.openClawAdapterConnectionHighestPriorityBlocker || 'none'}</li>
            <li><strong>OpenClaw adapter execution mode:</strong> {operatorTask.openClawAdapterExecutionMode || 'disabled'}</li>
            <li><strong>OpenClaw adapter can execute:</strong> {operatorTask.openClawAdapterCanExecute ? 'yes' : 'no'}</li>
            <li><strong>OpenClaw adapter safe to connect:</strong> {operatorTask.openClawAdapterSafeToConnect ? 'yes' : 'no'}</li>
            <li><strong>OpenClaw adapter stub mode:</strong> {operatorTask.openClawAdapterStubMode || 'unknown'}</li>
            <li><strong>OpenClaw adapter stub status:</strong> {operatorTask.openClawAdapterStubStatus || 'unknown'}</li>
            <li><strong>OpenClaw adapter stub health:</strong> {operatorTask.openClawAdapterStubHealth || 'unknown'}</li>
            <li><strong>OpenClaw adapter stub connection:</strong> {operatorTask.openClawAdapterStubConnectionState || 'unknown'}</li>
            <li><strong>OpenClaw adapter stub can execute:</strong> {operatorTask.openClawAdapterStubCanExecute ? 'yes' : 'no'}</li>
            <li><strong>OpenClaw adapter stub next action:</strong> {operatorTask.openClawAdapterStubNextAction || 'not reported'}</li>
            <li><strong>OpenClaw adapter stub top blocker:</strong> {operatorTask.openClawAdapterStubHighestPriorityBlocker || 'none'}</li>
            <li><strong>OpenClaw adapter stub warnings:</strong> {formatReportedList(operatorTask.openClawAdapterStubWarnings, 'none')}</li>
            <li><strong>OpenClaw adapter top blocker:</strong> {operatorTask.openClawAdapterHighestPriorityBlocker || 'none'}</li>
            <li><strong>OpenClaw adapter next action:</strong> {operatorTask.openClawAdapterNextAction || 'not reported'}</li>
            <li><strong>OpenClaw adapter capabilities:</strong> {formatReportedList(Object.entries(operatorTask.openClawAdapterCapabilities || {}).filter(([, enabled]) => enabled === true).map(([key]) => key), 'none')}</li>
            <li><strong>OpenClaw adapter required approvals:</strong> {formatReportedList(operatorTask.openClawAdapterRequiredApprovals)}</li>
            <li><strong>OpenClaw adapter evidence contract:</strong> {formatReportedList(operatorTask.openClawAdapterEvidenceContract)}</li>
            <li><strong>Approval gates pending:</strong> {formatReportedList(operatorTask.approvalPending)}</li>
            <li><strong>Handoff readiness:</strong> {operatorTask.handoffReady ? 'ready' : 'blocked'} ({operatorTask.handoffMode})</li>
            <li><strong>Codex handoff readiness:</strong> {operatorTask.codexHandoffPacketReady ? 'ready' : 'blocked'}</li>
            <li><strong>Handoff mode:</strong> {operatorTask.codexHandoffPacketMode || 'manual_prompt'}</li>
            <li><strong>Verification:</strong> {operatorTask.verificationStatus}</li>
            <li><strong>Verification return status:</strong> {operatorTask.verificationReturnStatus || 'none'}</li>
            <li><strong>Return source:</strong> {operatorTask.returnSource || 'unknown'}</li>
            <li><strong>Verification decision:</strong> {operatorTask.verificationDecision || 'not_ready'}</li>
            <li><strong>Merge readiness:</strong> {operatorTask.mergeReadiness || 'not_ready'}</li>
            <li><strong>Verification return ready:</strong> {operatorTask.verificationReturnReady ? 'yes' : 'no'}</li>
            <li><strong>Verification return next action:</strong> {operatorTask.verificationReturnNextAction || 'not reported'}</li>
            <li><strong>Next best agent action:</strong> {operatorTask.nextAction?.title || 'none'}</li>
            <li><strong>Action reason:</strong> {operatorTask.nextAction?.reason || 'not reported'}</li>
            <li><strong>Blocks:</strong> {formatReportedList(operatorTask.nextAction?.blocks)}</li>
            <li><strong>Required checks:</strong> {formatReportedList(operatorTask.codexHandoffPacketRequiredChecks)}</li>
            <li><strong>Returned checks run:</strong> {formatReportedList(operatorTask.returnedChecksRun)}</li>
            <li><strong>Checks missing:</strong> {formatReportedList(operatorTask.missingRequiredChecks, 'none')}</li>
            <li><strong>Returned files changed:</strong> {formatReportedList(operatorTask.returnedFilesChanged)}</li>
            <li><strong>Next action:</strong> {operatorTask.codexHandoffNextAction || 'Complete task scope first'}</li>
          </ul>
          <p className="muted"><strong>Manual return mode:</strong> Verification Return State v1 is manual-return only. Direct Codex automation and auto-merge are intentionally not enabled.</p>
          <p className="muted"><strong>OpenClaw readiness notice:</strong> endpoint configuration only, no live automation (session-only / no secrets stored unless durable non-secret path is explicitly configured).</p>
          <div className="agents-tile-copy-actions">
            <button
              type="button"
              className={`status-panel-copy-button ${copyState}`}
              onClick={handleCopyCodexPacket}
              disabled={!codexPacketText}
            >
              Copy Codex Packet
            </button>
            <span role="status" aria-live="polite">
              {copyState === COPY_STATE.SUCCESS ? 'Codex packet copied.' : null}
              {copyState === COPY_STATE.FAILURE ? 'Copy Codex Packet failed.' : null}
            </span>
          </div>
          {operatorTask.codexHandoffPacketSummary ? <p><strong>Codex packet:</strong> {operatorTask.codexHandoffPacketSummary}</p> : null}
          {operatorTask.codexHandoffPacketBlockers?.length > 0 ? <p><strong>Current blockers:</strong> {operatorTask.codexHandoffPacketBlockers.join(' · ')}</p> : null}
          {codexPacketText ? (
            <details>
              <summary>Compact packet preview</summary>
              <pre>{codexPacketText.split('\n').slice(0, 18).join('\n')}</pre>
            </details>
          ) : null}
          {operatorTask.handoffPacketSummary ? <p><strong>Handoff packet summary:</strong> {operatorTask.handoffPacketSummary}</p> : null}
          {operatorTask.returnedSummary ? <p><strong>Returned summary:</strong> {operatorTask.returnedSummary}</p> : null}
          {operatorTask.verificationReturnBlockers?.length > 0 ? <p><strong>Verification blockers:</strong> {operatorTask.verificationReturnBlockers.join(' · ')}</p> : null}
          {operatorTask.verificationReturnWarnings?.length > 0 ? <p><strong>Verification warnings:</strong> {operatorTask.verificationReturnWarnings.join(' · ')}</p> : null}
          {operatorTask.blockers?.length > 0 ? <p><strong>Blockers:</strong> {operatorTask.blockers.join(' · ')}</p> : null}
          {operatorTask.warnings?.length > 0 ? <p><strong>Warnings:</strong> {operatorTask.warnings.join(' · ')}</p> : null}
          <details>
            <summary>Manual verification return paste (non-persistent v1 placeholder)</summary>
            <label className="paneFieldGroup" htmlFor="agent-verification-return-draft">
              Paste Codex/manual return text for operator review (local component state only)
            </label>
            <textarea
              id="agent-verification-return-draft"
              className="paneControl"
              rows={8}
              value={manualReturnDraft}
              onChange={(event) => setManualReturnDraft(event.target.value)}
              placeholder="Paste manual return summary/checks/blockers here. This placeholder is not persisted."
            />
            <p className="muted">Draft length: {manualReturnDraft.trim().length} characters. Not stored in canonical task truth.</p>
          </details>
        </section>
      ) : null}

      <section className="agents-region">
        <h4>Active Handoff Chain</h4>
        <p>{(view.visibleHandoffChain || []).join(' → ') || 'No active handoff chain.'}</p>
      </section>

      <section className="agents-region">
        <h4>Active Goals</h4>
        <ul>
          {(missionView.activeGoals || []).slice(0, 8).map((goal) => (
            <li key={goal.goalId}><strong>{goal.title}</strong> · {goal.status}</li>
          ))}
        </ul>
      </section>

      <section className="agents-region">
        <h4>Pending Approvals</h4>
        <p>Pending {approvalView.pendingCount || 0} · Denied {approvalView.deniedCount || 0} · Policy Blocked {approvalView.blockedByPolicyCount || 0}</p>
      </section>

      <section className="agents-region">
        <h4>Resumable Work</h4>
        <p>{resumeView.operatorResumeSummary || 'No resumable items.'}</p>
      </section>

      <section className="agents-region">
        <h4>Memory Capability</h4>
        <ul>
          <li><strong>State:</strong> {memoryCapability.state || 'unavailable'}</li>
          <li><strong>Ready:</strong> {memoryCapability.ready === true ? 'yes' : 'no'}</li>
          <li><strong>Canonical shared backend:</strong> {memoryCapability.canonical === true ? 'yes' : 'no'}</li>
          <li><strong>Reason:</strong> {memoryCapability.reason || 'Memory capability state unavailable.'}</li>
        </ul>
      </section>

      {selected ? (
        <section className="agents-region">
          <h4>Agent Detail</h4>
          <p><strong>Operator Summary:</strong> {selectedSummary}</p>
          <ul>
            <li><strong>Agent ID:</strong> {formatTruth(selected.agentId, 'not reported')}</li>
            <li><strong>Display Name:</strong> {formatTruth(selected.displayName, 'not reported')}</li>
            <li><strong>Role:</strong> {selected.kind}</li>
            <li><strong>Description:</strong> {selected.description}</li>
            <li><strong>State:</strong> {selected.state} · {selected.stateReason}</li>
            <li><strong>Enabled:</strong> {formatTruth(selected.enabled, 'not reported')}</li>
            <li><strong>Eligible:</strong> {formatTruth(selected.eligible, 'not reported')}</li>
            <li><strong>Ready:</strong> {formatTruth(selected.ready, 'not reported')}</li>
            <li><strong>Active:</strong> {formatTruth(selected.active, 'not reported')}</li>
            <li><strong>Acting:</strong> {formatTruth(selected.acting, 'not reported')}</li>
            <li><strong>Capabilities:</strong> {formatList(selected.capabilities)}</li>
            <li><strong>Dependencies:</strong> {formatReportedList(selected.dependencies)}</li>
            <li><strong>Autonomy:</strong> {formatTruth(selected.autonomyLevel, 'not reported')}</li>
            <li><strong>Allowed surfaces:</strong> {formatReportedList(selected.allowedSurfaces)}</li>
            <li><strong>Allowed sessions:</strong> {formatReportedList(selected.allowedSessionKinds)}</li>
            <li><strong>Current task:</strong> {selected.currentTaskSummary || 'none'}</li>
            <li><strong>Owned tasks:</strong> {(selected.ownedTaskIds || []).length}</li>
            <li><strong>Delegated tasks:</strong> {(selected.delegatedTaskIds || []).length}</li>
            <li><strong>Pending approvals:</strong> {selected.pendingApprovalCount || 0}</li>
            <li><strong>Blocked queue:</strong> {selected.blockedTaskCount || 0}</li>
            <li><strong>Resumable queue:</strong> {selected.resumableTaskCount || 0}</li>
            <li><strong>Last action:</strong> {selected.actionAgeLabel}</li>
            <li><strong>Last success:</strong> {selected.successAgeLabel}</li>
            <li><strong>Last failure:</strong> {selected.failureAgeLabel}</li>
            <li><strong>Blockers:</strong> {formatReportedList(selected.blockers)}</li>
            <li><strong>State reason:</strong> {formatTruth(selected.stateReason, 'not reported')}</li>
          </ul>
        </section>
      ) : null}

      {selected ? (
        <section className="agents-region">
          <h4>Adjudication Gates</h4>
          <ul>
            {gateRows.map(([label, gate]) => (
              <li key={label}>
                <strong>{label}:</strong> {gate?.passed === true ? 'pass' : gate?.passed === false ? 'block' : 'unknown'} · {formatTruth(gate?.reason, 'not reported')}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {openClaw ? (
        <>
          <section className="agents-region">
            <h4>OpenClaw Governed Presence</h4>
            <ul>
              <li><strong>Agent Name:</strong> {openClaw.agentName}</li>
              <li><strong>Role:</strong> {openClaw.role}</li>
              <li><strong>Mode:</strong> {openClaw.mode}</li>
              <li><strong>Authority:</strong> {openClaw.authority}</li>
              <li><strong>Approval Required:</strong> {openClaw.approvalRequired}</li>
              <li><strong>Workspace Path / Repo Scope:</strong> {openClaw.workspacePath} · {openClaw.repoScope}</li>
              <li><strong>Sandbox Status:</strong> {openClaw.sandboxStatus}</li>
              <li><strong>Skill Policy / Allowlist Status:</strong> {openClaw.skillPolicyStatus}</li>
              <li><strong>Plugin Trust Posture:</strong> {openClaw.pluginTrustPosture}</li>
              <li><strong>Session State:</strong> {openClaw.sessionState}</li>
              <li><strong>Current Activity:</strong> {openClaw.currentActivity}</li>
              <li><strong>Last Scan Type:</strong> {openClaw.lastScanType}</li>
              <li><strong>Last Inspection Scope:</strong> {formatList(openClaw.lastInspectionScope)}</li>
              <li><strong>Last Proposed Prompt:</strong> {openClaw.lastProposedPrompt}</li>
              <li><strong>Blocked Capabilities:</strong> {formatList(openClaw.blockedCapabilities)}</li>
              <li><strong>Zero-Cost Guardrails Status:</strong> {openClaw.zeroCostGuardrailsStatus}</li>
            </ul>
            {openClaw.warnings?.length > 0 ? (
              <div className="mission-dashboard__banner mission-dashboard__banner--warning">
                <strong>Unsafe trust posture detected:</strong>
                <span>{openClaw.warnings.join(' | ')}</span>
              </div>
            ) : null}
          </section>

          <section className="agents-region">
            <h4>OpenClaw Integration Topology</h4>
            <p>{(openClaw.topology || []).map((entry) => entry.label).join(' -> ')}</p>
            <ul>
              {(openClaw.topology || []).map((entry) => (
                <li key={entry.id}><strong>{entry.label}:</strong> {entry.policyNote}</li>
              ))}
            </ul>
          </section>
        </>
      ) : null}

      <section className="agents-region">
        <h4>Event Stream</h4>
        <ul className="agents-event-stream">
          {(view.recentTransitions || []).slice(0, 10).map((event, index) => (
            <li key={`${event.agentId}-${event.at}-${index}`}>
              <strong>{event.displayName}</strong> · {event.type} · {event.reason || event.state} {event.at ? `(${event.at})` : ''}
            </li>
          ))}
        </ul>
      </section>

      {debugVisibility ? (
        <section className="agents-region">
          <h4>Suppression Reasons</h4>
          <ul>
            {(view.suppressionReasons || []).map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </section>
      ) : null}
    </CollapsiblePanel>
  );
}
