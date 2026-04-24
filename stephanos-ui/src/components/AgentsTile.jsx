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
} = {}) {
  const view = finalAgentView || {};
  const visibleAgents = Array.isArray(view.visibleAgents) ? view.visibleAgents : [];
  const selected = visibleAgents.find((entry) => entry.agentId === selectedAgentId) || visibleAgents[0] || null;

  const missionView = view.finalMissionOrchestrationView || {};
  const approvalView = view.finalApprovalQueueView || {};
  const resumeView = view.finalResumeView || {};
  const memoryCapability = view.memoryCapability || {};

  const openClaw = openClawIntegration && typeof openClawIntegration === 'object' ? openClawIntegration : null;
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
