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

export default function MissionCommandDeck({
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
}) {
  const decisions = (operatorDecisionConsole?.decisions || []).slice(0, 5);
  const activity = (missionEvidenceLedger?.entries || []).slice(0, 8);
  const readinessScore = missionRoutingReadiness?.readinessScore ?? missionRoutingReadiness?.readinessPercent ?? 0;
  return (
    <section className="mission-command-deck" aria-label="Mission Command Deck">
      <aside className="mission-deck-rail"><h4>Command Deck</h4><ul>{['Command Deck','Routing','Agents','Decisions','Evidence','Memory','Codex PR','Verification','Guardrails','Skill Forge','Settings'].map((item) => <li key={item} className={item === 'Command Deck' ? 'active' : ''}>{item}</li>)}</ul></aside>
      <div className="mission-deck-main">
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

        <article className="mission-deck-card mission-deck-hero"><h4>Mission Routing / Delegation Readiness</h4><div className="ring">{readinessScore}%</div><ul><li>route status: {missionRoutingReadiness?.routeStatus || 'draft'}</li><li>recommended route: {missionRoutingReadiness?.recommendedRoute || 'operator decision'}</li><li>readiness level: {missionRoutingReadiness?.readinessLevel || 'approval-gated'}</li><li>blockers: {(missionRoutingReadiness?.blockers || []).join(' | ') || 'none'}</li><li>warnings: {(missionRoutingReadiness?.warnings || []).join(' | ') || 'none'}</li><li>next action: {missionRoutingReadiness?.nextAction || 'pending'}</li></ul></article>

        <article className="mission-deck-card"><h4>Agent Assignment Matrix</h4><table><thead><tr><th>role</th><th>authority</th><th>allowed actions</th><th>blocked actions</th><th>status / next action</th></tr></thead><tbody>{(agentAssignmentMatrix?.assignments || []).slice(0, 6).map((row) => <tr key={row.roleId || row.role}><td>{row.role || row.roleId}</td><td>{row.authorityLevel || 'unknown'}</td><td>{(row.allowedActions || []).join(', ') || 'none'}</td><td>{(row.blockedActions || []).join(', ') || 'none'}</td><td>{row.nextAction || row.status || 'pending'}</td></tr>)}</tbody></table></article>

        <article className="mission-deck-card"><h4>Codex PR Repair Contract</h4><p><strong>Approval Required</strong> · Operator approval needed to proceed · No default manual code surgery</p><ul><li>target PR: {codexPrRepairContract?.targetPr || 'unavailable'}</li><li>failed check evidence: {codexPrRepairContract?.failedCheckEvidence || 'pending'}</li><li>branch: {codexPrRepairContract?.branch || 'unknown'}</li><li>repair completeness: {codexPrRepairContract?.repairCompleteness || 'pending'}</li><li>next action: {codexPrRepairContract?.nextAction || 'operator decision required'}</li></ul><div className="mission-deck-actions">{['Retry Checks','Repair PR','Recreate PR','Hold'].map((a)=><button key={a} type="button">{a}</button>)}</div></article>

        <article className="mission-deck-card"><h4>Operator Decision Console</h4><div className="mission-deck-decisions">{decisions.map((decision) => <div key={decision.decisionId} className={`decision-card decision-${statusTone(decision.riskLevel || decision.recommendedAction)}`}><strong>{decision.title}</strong><p>{decision.reason || 'No summary provided.'}</p><small>{decision.sourceSystem || 'source unknown'} · {decision.approvalRequired ? 'requires approval' : 'allowed'}</small></div>)}</div></article>

        <article className="mission-deck-card"><h4>Mission Command Packet</h4><ul><li>mission id: {missionCommandPacket?.missionId || 'unknown'}</li><li>lead role: {missionCommandPacket?.leadRole || 'operator'}</li><li>risk level: {missionCommandPacket?.riskLevel || 'unknown'}</li><li>delegation state: {missionCommandPacket?.delegationState || 'pending'}</li><li>operator approval state: {missionCommandPacket?.operatorApprovalState || 'required'}</li></ul></article>

        <article className="mission-deck-card"><h4>Support Snapshot / Runtime Truth</h4><ul><li>source truth: {supportSnapshot?.sourceTruth || 'unknown'}</li><li>dist parity: {supportSnapshot?.distParity || 'unknown'}</li><li>runtime marker: {runtimeStatusModel?.runtimeMarker || 'unavailable'}</li><li>build fingerprint: {runtimeStatusModel?.buildFingerprint || 'unavailable'}</li><li>route/provider truth: {finalRouteTruth?.routeKind || 'unknown'} / {finalRouteTruth?.provider || 'unknown'}</li><li>last verify: {supportSnapshot?.lastVerify || 'pending'}</li></ul></article>

        <article className="mission-deck-card"><h4>Activity Feed</h4><ul>{activity.map((entry, index) => <li key={`${entry.id || 'entry'}-${index}`}>{entry.label || entry.event || 'pending evidence'}</li>)}{activity.length === 0 ? <li>No mission activity feed available yet.</li> : null}</ul></article>

        <article className="mission-deck-card"><h4>Secondary Systems</h4><ul><li>Skill Forge: active skills / code repair / context engineering / test generation / repo navigation</li><li>Capability Radar: code repair / reasoning / testing / planning / context</li><li>Memory Librarian: pending {memoryLibrarian?.counts?.pending ?? 'unknown'} / approved durable memory only</li><li>OpenClaw Policy State: authority {openClawDelegation?.authorityLevel || 'unknown'} / approval gates {openClawDelegation?.requiredOperatorApproval ? 'required' : 'not declared'}</li><li>Verification Judge: {verificationJudge?.judgment || 'pending'} / warnings {(verificationJudge?.warnings || []).length}</li></ul></article>
      </div>
    </section>
  );
}
