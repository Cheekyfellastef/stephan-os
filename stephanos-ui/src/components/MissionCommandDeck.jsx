import CollapsiblePanel from './CollapsiblePanel';

function statusTone(value = '') {
  const normalized = String(value).toLowerCase();
  if (/(ready|pass|live|online|healthy|nominal|verified)/.test(normalized)) return 'ok';
  if (/(block|fail|error|down|reject)/.test(normalized)) return 'bad';
  if (/(pending|partial|approval|hold|warning|gated)/.test(normalized)) return 'warn';
  if (/(codex|provider|agent|openai|qwen)/.test(normalized)) return 'agent';
  return 'info';
}

function Chip({ label, value }) {
  return <div className={`mission-deck-chip mission-deck-chip-${statusTone(value)}`}><span>{label}</span><strong>{value || 'unknown'}</strong></div>;
}

function Metric({ label, value }) {
  return <div className="mission-deck-metric"><span>{label}</span><strong>{value || 'unknown'}</strong></div>;
}

export default function MissionCommandDeck(props) {
  const {
    missionRoutingReadiness,
    agentAssignmentMatrix,
    codexPrRepairContract,
    missionCommandPacket,
    supportSnapshot,
    missionEvidenceLedger,
    memoryLibrarian,
    operatorDecisionConsole,
    openClawDelegation,
    verificationJudge,
    finalRouteTruth,
    runtimeStatusModel,
    compactVerificationSummary,
    uiLayout = {},
    togglePanel = () => {},
  } = props;

  const decisions = (operatorDecisionConsole?.decisions || []).slice(0, 5);
  const activity = (missionEvidenceLedger?.entries || []).slice(0, 8);
  const activitySummary = activity.length > 0
    ? `${activity.length} recent evidence event${activity.length === 1 ? '' : 's'} · latest ${activity[0]?.eventType || activity[0]?.label || activity[0]?.event || 'activity'}`
    : 'No recent activity';
  const readinessScore = Math.max(0, Math.min(100, missionRoutingReadiness?.readinessScore ?? missionRoutingReadiness?.readinessPercent ?? 0));
  const matrixRows = ['Codex', 'OpenClaw', 'Verification Judge', 'Memory Librarian', 'Task Finisher', 'Operator'];
  const assignments = (agentAssignmentMatrix?.assignments || []);
  const actionButtons = ['Retry Checks', 'Repair PR', 'Recreate PR', 'Hold'];
  const fallbackDecisions = [
    { decisionId: 'retry', title: 'Retry', reason: 'Re-run checks with current branch state.', riskLevel: 'low', approvalRequired: false },
    { decisionId: 'recreate', title: 'Recreate PR', reason: 'Open a fresh PR after controlled repair.', riskLevel: 'medium', approvalRequired: true },
    { decisionId: 'hold', title: 'Hold', reason: 'Pause execution while collecting evidence.', riskLevel: 'low', approvalRequired: true },
  ];

  return (
    <section className="mission-command-deck mission-command-deck-canvas" aria-label="Mission Command Deck">
      <div className="mission-command-deck-grid">
        <header className="mission-deck-header mission-deck-grid-status-strip">
          <h3>Stephanos · Mission Console / Command Deck</h3>
          <p>Scan-first operator surface for routing, readiness, decisions, and evidence.</p>
          <div className="mission-deck-strip">
            <Chip label="Route Truth" value={finalRouteTruth?.routeUsableState || 'unavailable'} />
            <Chip label="Launch State" value={runtimeStatusModel?.launchState || 'pending'} />
            <Chip label="Active Provider" value={finalRouteTruth?.selectedProvider || finalRouteTruth?.provider || 'unknown'} />
            <Chip label="OpenClaw" value={compactVerificationSummary?.openClawReadiness || 'parked'} />
            <Chip label="Codex PR Repair" value={codexPrRepairContract?.contractStatus || 'pending'} />
            <Chip label="Memory" value={memoryLibrarian?.counts?.pending > 0 ? 'approval required' : 'healthy'} />
            <Chip label="Verification" value={verificationJudge?.readinessLevel || 'pending'} />
            <Chip label="System Watcher" value={supportSnapshot?.watcherStatus || 'nominal'} />
          </div>
        </header>

        <article className="mission-deck-card mission-deck-grid-readiness-hero" aria-label="Mission Routing / Delegation Readiness">
          <h4>Mission Routing / Delegation Readiness</h4>
          <div className="mission-deck-hero-layout">
            <div className="ring" role="img" aria-label="readiness ring">{readinessScore}%</div>
            <div className="mission-deck-hero-grid">
              <Metric label="route status" value={missionRoutingReadiness?.routeStatus || 'draft'} />
              <Metric label="recommended route" value={missionRoutingReadiness?.recommendedRoute || 'operator decision'} />
              <Metric label="readiness level" value={missionRoutingReadiness?.readinessLevel || 'approval-gated'} />
              <Metric label="blockers" value={(missionRoutingReadiness?.blockers || []).length || 0} />
              <Metric label="warnings" value={(missionRoutingReadiness?.warnings || []).length || 0} />
              <Metric label="next action" value={missionRoutingReadiness?.nextAction || 'pending'} />
            </div>
          </div>
        </article>

        <article className="mission-deck-card mission-deck-grid-agent-assignment" aria-label="Agent Assignment Matrix">
          <h4>Agent Assignment Matrix</h4>
          <div className="mission-deck-assignment-rows" role="list" aria-label="Agent Assignment card rows">{matrixRows.map((role) => {
            const row = assignments.find((item) => (item.role || item.roleId || '').toLowerCase() === role.toLowerCase()) || {};
            return <section key={role} className="mission-deck-assignment-row" role="listitem"><h5>{role}</h5><div className="mission-deck-assignment-grid"><div><span className="matrix-label">authority</span><span className={`status-chip status-${statusTone(row.authorityLevel || 'unknown')}`}>{row.authorityLevel || 'unknown'}</span></div><div><span className="matrix-label">allowed</span><p>{(row.allowedActions || []).join(' · ') || 'none'}</p></div><div><span className="matrix-label">blocked</span><p>{(row.blockedActions || []).join(' · ') || 'none'}</p></div><div><span className="matrix-label">status / next action</span><p>{row.nextAction || row.status || 'pending'}</p></div></div></section>;
          })}</div>
        </article>

        <article className="mission-deck-card mission-deck-grid-pr-repair">
          <h4>Codex PR Repair Contract</h4>
          <p><strong>Approval Required</strong> · preview-only controls · no default manual code surgery.</p>
          <div className="mission-deck-metrics">
            <Metric label="target PR" value={codexPrRepairContract?.targetPr || 'unavailable'} />
            <Metric label="failed check evidence" value={codexPrRepairContract?.failedCheckEvidence || 'pending'} />
            <Metric label="branch" value={codexPrRepairContract?.branch || 'unknown'} />
            <Metric label="head changed" value={codexPrRepairContract?.headChanged || 'unknown'} />
            <Metric label="remote checks" value={codexPrRepairContract?.remoteChecks || 'pending'} />
            <Metric label="pushability" value={codexPrRepairContract?.pushability || 'approval required'} />
            <Metric label="repair completeness" value={codexPrRepairContract?.repairCompleteness || 'pending'} />
            <Metric label="next action" value={codexPrRepairContract?.nextAction || 'operator decision required'} />
          </div>
          <div className="mission-deck-actions">{actionButtons.map((label) => <button key={label} type="button" className="mission-deck-preview-button" disabled aria-disabled="true" aria-label={`${label} preview-only control`}>{label} (Preview)</button>)}</div>
        </article>

        <article className="mission-deck-card mission-deck-grid-operator-decision">
          <h4>Operator Decision Console</h4>
          <div className="mission-deck-decisions">{(decisions.length ? decisions : fallbackDecisions).map((decision) => <button key={decision.decisionId || decision.title} type="button" className={`decision-card decision-${statusTone(decision.riskLevel || decision.recommendedAction)}`} disabled aria-disabled="true" aria-label={`${decision.title || 'Operator decision'} preview-only control`}><span className="decision-icon" aria-hidden="true">{(decision.title || 'D').slice(0, 1)}</span><strong>{decision.title}</strong><p>{decision.reason || 'No summary provided.'}</p><small>{decision.approvalRequired ? 'requires approval' : 'allowed'} · preview-only</small></button>)}</div>
          <p className="mission-deck-footnote">Operator chooses the path — no default manual code surgery.</p>
        </article>

        <article className="mission-deck-card"><h4>Mission Command Packet</h4><div className="mission-deck-metrics"><Metric label="mission id" value={missionCommandPacket?.missionId || 'unknown'} /><Metric label="lead role" value={missionCommandPacket?.leadRole || 'operator'} /><Metric label="risk level" value={missionCommandPacket?.riskLevel || 'unknown'} /><Metric label="delegation state" value={missionCommandPacket?.delegationState || 'pending'} /><Metric label="operator approval state" value={missionCommandPacket?.operatorApprovalState || 'required'} /></div></article>
        <article className="mission-deck-card"><h4>Support Snapshot / Runtime Truth</h4><div className="mission-deck-metrics"><Metric label="source truth" value={supportSnapshot?.sourceTruth || 'unknown'} /><Metric label="dist parity" value={supportSnapshot?.distParity || 'unknown'} /><Metric label="runtime marker" value={runtimeStatusModel?.runtimeMarker || 'unavailable'} /><Metric label="build fingerprint" value={runtimeStatusModel?.buildFingerprint || 'unavailable'} /><Metric label="route/provider truth" value={`${finalRouteTruth?.routeKind || 'unknown'} / ${finalRouteTruth?.provider || 'unknown'}`} /><Metric label="last verify" value={supportSnapshot?.lastVerify || 'pending'} /></div></article>
        <CollapsiblePanel
          as="article"
          panelId="missionConsoleMissionCommandDeckActivityPanel"
          title="Activity Feed"
          titleAs="h4"
          description={activitySummary}
          className="mission-deck-card mission-deck-grid-activity-feed mission-deck-compact-feed-panel"
          isOpen={uiLayout.missionConsoleMissionCommandDeckActivityPanel !== false}
          onToggle={() => togglePanel('missionConsoleMissionCommandDeckActivityPanel')}
        >
          <ul className="mission-deck-feed mission-deck-feed--compact" aria-label="Mission command activity feed rows">
            {activity.map((entry, index) => (
              <li key={`${entry.entryId || entry.id || 'entry'}-${index}`} className="compact-feed-row">
                <time>{entry.timestamp || entry.time || 'pending'}</time>
                <span className={`status-chip status-${statusTone(entry.status || entry.eventType || entry.label || entry.event)}`}>{entry.status || entry.eventType || entry.type || 'event'}</span>
                <p>{entry.summary || entry.label || entry.event || 'pending evidence'}</p>
              </li>
            ))}
            {activity.length === 0 ? <li className="compact-feed-row compact-feed-row--empty"><time>idle</time><span className="status-chip status-info">empty</span><p>No recent activity</p></li> : null}
          </ul>
        </CollapsiblePanel>
        <div className="mission-deck-secondary-grid" aria-label="Mission Command secondary cards"><article className="mission-deck-card mission-deck-secondary-card"><h4>Memory Librarian</h4><p>Pending: {memoryLibrarian?.counts?.pending ?? 'unknown'} · durable memory review remains operator-governed.</p></article>
        <article className="mission-deck-card mission-deck-secondary-card"><h4>Guardrail State</h4><p>OpenClaw authority: {openClawDelegation?.authorityLevel || 'unknown'} · approval gates: {openClawDelegation?.requiredOperatorApproval ? 'required' : 'not declared'} · verification: {verificationJudge?.judgment || 'pending'}.</p></article></div>
      </div>
    </section>
  );
}
