import { useCallback, useEffect, useRef, useState } from 'react';
import CollapsiblePanel from './CollapsiblePanel';
import { fetchMissionOperations } from '../state/missionOperationsClient';
import { buildConciergeRoadmap } from '../../../shared/agents/battleBridgeBuildConciergeV2.mjs';
import './MissionOperationsPanel.css';

const REFRESH_INTERVAL_MS = 5000;
const UPDATE_STATUS_TRUTH_STATES = ['UPDATE_AVAILABLE', 'PULL_REQUIRED', 'REBUILD_REQUIRED', 'AUTO_UPDATE_NOT_ENABLED'];

function displayTime(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : 'not reported';
}

function displayElapsed(seconds) {
  if (!Number.isFinite(seconds)) return 'unknown';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function EvidenceList({ title, items, emptyText, renderItem }) {
  return (
    <section className="mission-operations-evidence-group">
      <h4>{title}</h4>
      {items.length ? (
        <ul className="mission-operations-evidence-list">
          {items.map((item, index) => (
            <li key={item.id || item.receiptId || item.approvalId || item.agentId || `${title}-${index}`}>
              {renderItem(item)}
            </li>
          ))}
        </ul>
      ) : <div className="muted">{emptyText}</div>}
    </section>
  );
}

function ExecutionEngineV9Surface({ engine = {} }) {
  if (!engine || !engine.schemaVersion) return null;
  const candidates = Array.isArray(engine.enrichedCandidates) ? engine.enrichedCandidates : [];
  const packets = Array.isArray(engine.dispatchPackets) ? engine.dispatchPackets : [];
  return (
    <div className="mission-operations-evidence-group" aria-label="Build Concierge V9 execution engine status">
      <strong>V9 Live Goal Execution Engine:</strong> {engine.status || 'unknown'} · watched {engine.watchedGoalCount ?? 0} · classified {engine.classifiedGoalCount ?? 0} · enriched {engine.enrichedCandidateCount ?? 0} · dispatch ready {engine.dispatchReadyCount ?? 0} · manual dispatch {engine.manualDispatchRequiredCount ?? 0}
      <div><strong>V9 active execution lane:</strong> {engine.activeExecutionLane || 'none'}</div>
      <ul className="mission-operations-evidence-list">
        {candidates.map((candidate) => (
          <li key={candidate.candidateId}>
            <strong>{candidate.candidateId}</strong> · {candidate.classification || 'unknown'} · {candidate.suggestedLane || 'unknown'} · {candidate.dispatchReadiness || 'blocked_or_unknown'}
            <div>Proof families: {(candidate.requiredProofFamilies || []).join(', ') || 'unknown'}</div>
            <div>Allowlisted commands: {(candidate.declaredAllowlistedProofCommands || []).join(' · ') || 'none'}</div>
            {candidate.blockerReasons?.length ? <div>Blockers: {candidate.blockerReasons.join(' | ')}</div> : null}
          </li>
        ))}
      </ul>
      {packets.length ? <div><strong>Copyable Codex mission packets:</strong>{packets.map((packet) => <pre key={packet.candidateId}>{packet.packet}</pre>)}</div> : null}
      <div><strong>V9 next operator action:</strong> {engine.nextOperatorAction || 'unknown'}</div>
      <div><strong>V9 final verdict:</strong> {engine.finalVerdict || 'unknown'}</div>
    </div>
  );
}

export function LiveGoalProjectionSummary({ projection = {} }) {
  if (!projection || !projection.schemaVersion) return null;
  const agents = projection.currentAgentStates || {};
  const activeLane = Array.isArray(projection.activeProofLane) ? projection.activeProofLane : [];
  const engine = projection.executionEngine || projection.buildConciergeStatus?.executionEngine || {};
  const githubTelemetry = projection.githubTelemetry || {};
  const notificationCounts = githubTelemetry.notificationCounts || {};
  const workflowCounts = githubTelemetry.workflowCounts || {};
  const sourceBadge = projection.sourceTruth === 'live' ? 'LIVE' : projection.sourceTruth === 'mixed' ? 'MIXED' : projection.sourceTruth === 'static-fallback' ? 'STATIC_FALLBACK' : 'UNKNOWN';
  return (
    <section className="mission-operations-build-concierge" aria-label="Mission Control live projection" data-testid="mission-control-live-projection">
      <h4>Mission Control Live Projection <span>{sourceBadge}</span></h4>
      <dl className="mission-operations-grid">
        <div><dt>Operator state</dt><dd>{agents.operator?.state || 'unknown'}</dd></div>
        <div><dt>Stephanos state</dt><dd>{agents.stephanos?.state || 'unknown'}</dd></div>
        <div><dt>Codex state</dt><dd>{agents.codex?.state || 'unknown'}</dd></div>
        <div><dt>OpenClaw state</dt><dd>{agents.openclaw?.state || 'unknown'}</dd></div>
        <div><dt>GitHub state</dt><dd>{agents.github?.state || 'unknown'}</dd></div>
        <div><dt>Battle Bridge state</dt><dd>{agents.battleBridge?.state || 'unknown'}</dd></div>
        <div><dt>Active proof lane</dt><dd>{activeLane.map((candidate) => candidate.candidateId || candidate.title || 'unknown').join(', ') || 'none'}</dd></div>
        <div><dt>Queued goals</dt><dd>{projection.queuedGoalCount ?? 'unknown'}</dd></div>
        <div><dt>Blocked goals</dt><dd>{projection.blockedGoalCount ?? 'unknown'}</dd></div>
        <div><dt>Completed goals</dt><dd>{projection.completedGoalCount ?? 'unknown'}</dd></div>
        <div><dt>GeneratedAt age</dt><dd>{projection.heartbeat?.generatedAtAgeSeconds ?? projection.generatedAtAgeSeconds ?? 'unknown'}s</dd></div>
        <div><dt>Backend live</dt><dd>{projection.heartbeat?.backendLive === true ? 'true' : 'unknown'}</dd></div>
        <div><dt>Projection source</dt><dd>{projection.heartbeat?.projectionSource || projection.projectionSource || 'unknown'}</dd></div>
        <div><dt>Watched goals</dt><dd>{projection.heartbeat?.watchedGoals ?? engine.watchedGoalCount ?? 'unknown'}</dd></div>
        <div><dt>Classified goals</dt><dd>{projection.heartbeat?.classifiedGoals ?? engine.classifiedGoalCount ?? 'unknown'}</dd></div>
        <div><dt>Manual dispatch required</dt><dd>{projection.heartbeat?.manualDispatchRequired ?? engine.manualDispatchRequiredCount ?? 'unknown'}</dd></div>
        <div><dt>Imported goals</dt><dd>{projection.importedGoals?.verificationState || 'unknown'}</dd></div>
        <div><dt>Stale/unknown warnings</dt><dd>{(projection.heartbeat?.staleUnknownWarnings || projection.staleWarnings || []).join(' | ') || 'none'}</dd></div>
        <div><dt>GitHub adapter</dt><dd>{githubTelemetry.status || 'adapter_unavailable'}</dd></div>
        <div><dt>GitHub notifications</dt><dd>{Object.entries(notificationCounts).map(([key, value]) => `${key}:${value}`).join(' | ') || 'none'}</dd></div>
        <div><dt>Open PRs</dt><dd>{githubTelemetry.pullRequestCount ?? (githubTelemetry.pullRequests || []).length ?? 'unknown'}</dd></div>
        <div><dt>Workflows</dt><dd>{Object.entries(workflowCounts).map(([key, value]) => `${key}:${value}`).join(' | ') || 'none'}</dd></div>
        <div><dt>V9 execution engine</dt><dd>{engine.status || 'unknown'} · classified {engine.classifiedGoalCount ?? 0} · manual dispatch {engine.manualDispatchRequiredCount ?? 0}</dd></div>
      </dl>
      <ExecutionEngineV9Surface engine={engine} />
      <p className="mission-operations-next-action"><strong>Next operator action:</strong> {projection.nextOperatorAction || 'unknown'}</p>
    </section>
  );
}

export function BuildConciergeSurface({ concierge = {} }) {
  const candidate = concierge.selectedCandidate || {};
  const proofPacketSummary = concierge.proofPacketSummary || {};
  const exactHeadApproval = concierge.exactHeadApproval || {};
  const approvalDecision = concierge.approvalDecision || {};
  const proofCommands = Array.isArray(candidate.proofCommands) ? candidate.proofCommands : [];
  const blockers = Array.isArray(concierge.blockers) ? concierge.blockers : [];
  const roadmap = concierge.roadmap || buildConciergeRoadmap();
  const browserProofPacket = concierge.browserProofPacket || proofPacketSummary.browserProofPacket || {};
  const consoleErrors = Array.isArray(browserProofPacket.consoleErrors) ? browserProofPacket.consoleErrors : [];
  const caveats = Array.isArray(browserProofPacket.caveats) ? browserProofPacket.caveats : [];
  const roadmapPhases = Array.isArray(roadmap.phases) ? roadmap.phases : [];
  const postMergeSync = concierge.postMergeSync || {};
  const pullMain = postMergeSync.pullMain || {};
  const restartRefresh = postMergeSync.restartRefresh || {};
  const backendFreshnessProof = postMergeSync.backendFreshnessProof || {};
  const refreshState = postMergeSync.refreshState || {};
  const queue = concierge.queue || {};
  const antiStall = concierge.antiStallMergeLane || {};
  const liveAdapter = concierge.liveAdapter || {};
  const executionEngine = concierge.executionEngine || concierge.liveGoalProjection?.executionEngine || concierge.liveGoalProjection?.buildConciergeStatus?.executionEngine || {};
  const queuedCandidates = Array.isArray(queue.queuedCandidates) ? queue.queuedCandidates : [];
  const activeProofLane = Array.isArray(queue.activeProofLane) ? queue.activeProofLane : [];
  return (
    <>
      <LiveGoalProjectionSummary projection={concierge.liveGoalProjection || {}} />
      <section className="mission-operations-build-concierge" aria-label="Build Concierge panel" data-testid="build-concierge-panel">
      <h4>Build Concierge</h4>
      <dl className="mission-operations-grid">
        <div><dt>Selected PR/goal candidate</dt><dd>{candidate.prNumber ? `#${candidate.prNumber} ${candidate.title || ''}` : 'unknown'}</dd></div>
        <div><dt>Candidate head</dt><dd>{candidate.headSha || 'unknown'}</dd></div>
        <div><dt>Proof readiness</dt><dd>{concierge.proofReadiness || (concierge.canStartProof ? 'ready' : 'blocked_or_unknown')}</dd></div>
        <div><dt>Dirty-tree status</dt><dd>{concierge.dirtyTreeStatus || 'unknown'}</dd></div>
        <div><dt>Exact-head approval</dt><dd>{exactHeadApproval.status || 'unknown'}</dd></div>
        <div><dt>Approval token</dt><dd><code>{approvalDecision.approvalToken || exactHeadApproval.token || candidate.requiredApprovalToken || 'unknown'}</code></dd></div>
        <div><dt>V6 approval surface</dt><dd>{approvalDecision.approvalStatus || 'awaiting_operator_token'} / {approvalDecision.rejectionStatus || 'not_rejected'}</dd></div>
        <div><dt>V6 UI merge claim</dt><dd>{approvalDecision.uiMergeClaim === true ? 'invalid_merge_claim' : 'no UI merge claim'}</dd></div>
        <div><dt>Proof packet</dt><dd>{proofPacketSummary.status || 'not_started'} · commands {proofPacketSummary.passedCommandCount ?? 0}/{proofPacketSummary.commandCount ?? proofCommands.length}</dd></div>
        <div><dt>V4 browser proof</dt><dd>{browserProofPacket.browserProofStatus || proofPacketSummary.browserProof || concierge.browserProof || 'unknown'}</dd></div>
        <div><dt>V4 screenshot</dt><dd>{browserProofPacket.screenshotPath || browserProofPacket.screenshotUnavailableReason || 'unknown'}</dd></div>
        <div><dt>V4 checklist</dt><dd>{browserProofPacket.checklistStatus || 'unknown'}</dd></div>
        <div><dt>Merge hold state</dt><dd>{concierge.mergeHoldState || 'HELD_UNKNOWN'}</dd></div>
        <div><dt>V7 post-merge sync</dt><dd>{postMergeSync.status || roadmapPhases.find((phase) => phase.version === 'V7')?.status || 'unknown'} · merge receipt {postMergeSync.mergeReceiptObserved === true ? 'observed' : 'required'}</dd></div>
        <div><dt>V7 pull main</dt><dd>{pullMain.status || 'unknown'}</dd></div>
        <div><dt>V7 restart/refresh</dt><dd>{restartRefresh.status || 'unknown'} · PC restart {restartRefresh.pcRestartAllowed === true ? 'allowed' : 'prohibited'}</dd></div>
        <div><dt>V7 backend freshness proof</dt><dd>{backendFreshnessProof.status || 'unknown'}</dd></div>
        <div><dt>V7 surface refresh</dt><dd>Mission Operations {refreshState.missionOperations || 'unknown'} · Goal Dashboard {refreshState.goalDashboard || 'unknown'}</dd></div>
        <div><dt>V8 queue</dt><dd>{queue.status || roadmapPhases.find((phase) => phase.version === 'V8')?.status || 'unknown'} · queued {queuedCandidates.length} · active {activeProofLane.length}</dd></div>
        <div><dt>V8 one-active-lane guardrail</dt><dd>{queue.oneActiveLaneGuardrail || 'unknown'}</dd></div>
        <div><dt>V8 next safe candidate</dt><dd>{queue.nextSafeCandidate?.candidateId || 'unknown'}</dd></div>
        <div><dt>V8 anti-stall fallback truth</dt><dd>{antiStall.cliMergeFallbackAllowed === true ? 'manual CLI fallback allowed' : 'manual CLI fallback blocked_or_unknown'}</dd></div>
        <div><dt>V8 connector merge</dt><dd>{antiStall.connectorMergeAttempted === true ? 'attempted' : 'not_attempted'} · {antiStall.connectorMergeBlockedReason || 'unknown'}</dd></div>
        <div><dt>Live goal-create adapter</dt><dd>{liveAdapter.status || (liveAdapter.available === true ? 'available' : 'blocked_unavailable')} · {liveAdapter.route || '/api/build-concierge/goals'}</dd></div>
        <div><dt>V9 execution engine</dt><dd>{executionEngine.status || 'unknown'} · watched {executionEngine.watchedGoalCount ?? 0} · classified {executionEngine.classifiedGoalCount ?? 0}</dd></div>
      </dl>
      <ExecutionEngineV9Surface engine={executionEngine} />
      {liveAdapter.available === false || liveAdapter.status === 'blocked_unavailable' ? <p className="mission-operations-next-action"><strong>Build Concierge live adapter blocker:</strong> {liveAdapter.blockerText || 'Build Concierge live adapter unavailable: backend route /api/build-concierge/goals has not returned availability proof; create goals manually and keep queue truth unknown until a durable receipt exists.'}</p> : null}
      <p className="mission-operations-next-action"><strong>Next operator action:</strong> {postMergeSync.nextOperatorAction || approvalDecision.nextOperatorAction || concierge.nextOperatorAction || 'Refresh Build Concierge truth before acting.'}</p>
      {proofCommands.length ? (
        <div><strong>Declared proof commands:</strong><ul className="mission-operations-evidence-list">{proofCommands.map((command) => <li key={command}><code>{command}</code></li>)}</ul></div>
      ) : <p className="muted">Declared proof commands are unknown.</p>}
      {(browserProofPacket.proofUnavailableBlocker || consoleErrors.length || caveats.length) ? (
        <div className="mission-operations-evidence-group" aria-label="Build Concierge V4 browser proof truth">
          <strong>V4 browser-proof blocker:</strong> {browserProofPacket.proofUnavailableBlocker || 'none'}
          {consoleErrors.length ? <div><strong>Console errors:</strong> {consoleErrors.join(' | ')}</div> : null}
          {caveats.length ? <div><strong>Caveats:</strong> {caveats.join(' | ')}</div> : null}
        </div>
      ) : null}
      {queuedCandidates.length ? (
        <div className="mission-operations-evidence-group" aria-label="Build Concierge V8 queue truth">
          <strong>V8 queue state:</strong> one active proof lane unless explicitly isolated.
          <ul className="mission-operations-evidence-list">{queuedCandidates.map((item) => <li key={item.candidateId}><strong>{item.candidateId}</strong> rank {item.queueRank} · {item.safeToProof ? 'safe_to_proof' : 'blocked_or_rejected'} · {item.rejectionReasons?.join(' | ') || item.blockers?.join(' | ') || 'no rejection reason'}</li>)}</ul>
          {antiStall.exactCliMergeCommand ? <div><strong>Operator manual CLI fallback command:</strong> <code>{antiStall.exactCliMergeCommand}</code></div> : null}
        </div>
      ) : null}
      {roadmapPhases.length ? (
        <div className="mission-operations-evidence-group" aria-label="Build Concierge roadmap">
          <strong>Roadmap:</strong> {roadmap.activePhase?.version || 'unknown'} · {roadmap.activePhase?.title || 'unknown'}
          <ul className="mission-operations-evidence-list">
            {roadmapPhases.map((phase) => <li key={phase.version}><strong>{phase.version}</strong> {phase.title} - {phase.status}</li>)}
          </ul>
          {Array.isArray(roadmap.successMarkers) && roadmap.successMarkers.length ? <code>{roadmap.successMarkers.join(' · ')}</code> : null}
        </div>
      ) : null}
      {approvalDecision.rejectionReceipt ? <div className="mission-operations-alert mission-operations-alert--blocked"><strong>V6 rejection receipt:</strong> {approvalDecision.rejectionReceipt.status} · {approvalDecision.rejectionReceipt.reason}</div> : null}
      {blockers.length ? <div className="mission-operations-alert mission-operations-alert--blocked"><strong>Concierge blockers:</strong> {blockers.join(' | ')}</div> : null}
      </section>
    </>
  );
}

export function MissionSummary({ mission }) {
  const checkSummary = `${mission.pullRequest.passingCheckCount}/${mission.pullRequest.requiredCheckCount}`;
  const supportingAgents = mission.agent.supportingAgents || [];
  const changedFiles = mission.git.changedFiles || [];
  const checks = mission.pullRequest.checks || [];
  const approvals = mission.approvals || [];
  const receipts = mission.receipts || [];
  const goalDashboardStatusProjection = mission.goalDashboardStatusProjection || {};
  const goalDashboardGoals = goalDashboardStatusProjection.goals || [];

  return (
    <article className="mission-operations-item" data-testid="mission-operations-item" data-mission-state={mission.mission.state}>
      <header className="mission-operations-item__header">
        <div>
          <strong>{mission.mission.title}</strong>
          <div className="muted">{mission.mission.missionId}</div>
          {mission.mission.intendedOutcome ? (
            <div className="mission-operations-outcome">
              <strong>Intended outcome:</strong> {mission.mission.intendedOutcome}
            </div>
          ) : null}
        </div>
        <span className={`status-badge status-badge--${mission.mission.state.toLowerCase()}`}>
          {mission.mission.state}
        </span>
      </header>

      <dl className="mission-operations-grid">
        <div><dt>Phase</dt><dd>{mission.mission.currentPhase}</dd></div>
        <div><dt>Active agent</dt><dd>{mission.agent.activeAgentLabel} ({mission.agent.role}, {mission.agent.status})</dd></div>
        <div><dt>Branch</dt><dd>{mission.git.branch || 'not created'}</dd></div>
        <div><dt>Base branch</dt><dd>{mission.git.baseBranch || 'not reported'}</dd></div>
        <div><dt>Head SHA</dt><dd>{mission.git.headSha || 'not reported'}</dd></div>
        <div><dt>Worktree</dt><dd>{mission.git.worktreePath || 'not reported'}</dd></div>
        <div><dt>Changed files</dt><dd>{changedFiles.length}</dd></div>
        <div><dt>Git clean</dt><dd>{mission.git.clean ? 'yes' : 'not proven'}</dd></div>
        <div><dt>Pull request</dt><dd>{mission.pullRequest.number ? `#${mission.pullRequest.number}` : 'not opened'}</dd></div>
        <div><dt>PR state</dt><dd>{mission.pullRequest.state || 'not reported'}</dd></div>
        <div><dt>Mergeable</dt><dd>{mission.pullRequest.mergeable ? 'yes' : 'not proven'}</dd></div>
        <div><dt>Checks</dt><dd>{checkSummary}</dd></div>
        <div><dt>Started</dt><dd>{displayTime(mission.mission.startedAt)}</dd></div>
        <div><dt>Updated</dt><dd>{displayTime(mission.mission.updatedAt)}</dd></div>
        <div><dt>Elapsed</dt><dd>{displayElapsed(mission.mission.elapsedSeconds)}</dd></div>
        <div><dt>Receipts</dt><dd>{receipts.length}</dd></div>
        <div><dt>Goal status</dt><dd>{goalDashboardStatusProjection.refreshTruth || 'MANUAL_REFRESH_REQUIRED'}</dd></div>
      </dl>

      {mission.pullRequest.url ? (
        <a className="mission-operations-pr-link" href={mission.pullRequest.url} target="_blank" rel="noreferrer">
          Open pull request #{mission.pullRequest.number || ''}
        </a>
      ) : null}

      <div className="mission-operations-next-action">
        <strong>Next action:</strong> {mission.mission.nextAction}
      </div>

      <div className="mission-operations-evidence-grid">
        <EvidenceList
          title="Supporting agents"
          items={supportingAgents}
          emptyText="No supporting agent is reported."
          renderItem={(agent) => <><strong>{agent.label}</strong> - {agent.role} / {agent.status}</>}
        />
        <EvidenceList
          title="Changed files"
          items={changedFiles.map((path) => ({ id: path, path }))}
          emptyText="No changed files are reported."
          renderItem={(item) => <code>{item.path}</code>}
        />
        <EvidenceList
          title="Required checks"
          items={checks}
          emptyText="No check receipts are reported."
          renderItem={(check) => (
            <>
              <strong>{check.name}</strong> - {check.status}
              {check.completedAt ? ` / completed ${displayTime(check.completedAt)}` : ''}
            </>
          )}
        />
        <EvidenceList
          title="Approvals"
          items={approvals}
          emptyText="No operator approval is currently reported."
          renderItem={(approval) => (
            <>
              <strong>{approval.kind}</strong> - {approval.status}
              {approval.requiredToken ? <><br /><code>{approval.requiredToken}</code></> : null}
              {approval.decidedAt ? ` / decided ${displayTime(approval.decidedAt)}` : ''}
            </>
          )}
        />
        <EvidenceList
          title="Goal Dashboard status"
          items={goalDashboardGoals}
          emptyText="Static Goal Dashboard seed is unavailable; manual refresh is required."
          renderItem={(goal) => (
            <>
              <strong>{goal.issue}</strong> - {goal.status} / {goal.currentOwner} to {goal.nextOwner}
              <br /><span>{goal.milestone}</span>
              <br /><span>{goal.nextAction}</span>
            </>
          )}
        />
        <EvidenceList
          title="Evidence receipts"
          items={receipts}
          emptyText="No deterministic evidence receipt is reported."
          renderItem={(receipt) => (
            <>
              <strong>{receipt.receiptType}</strong> - {receipt.status} / {receipt.source}
              {receipt.sha256 ? <><br /><code>{receipt.sha256}</code></> : null}
              {receipt.path ? <><br /><span>{receipt.path}</span></> : null}
              {receipt.createdAt ? <><br /><span>{displayTime(receipt.createdAt)}</span></> : null}
            </>
          )}
        />
      </div>

      {approvals.some((approval) => approval.status === 'pending') ? (
        <div className="mission-operations-alert mission-operations-alert--approval">
          <strong>Approval required:</strong>{' '}
          {approvals.filter((approval) => approval.status === 'pending')
            .map((approval) => approval.requiredToken || approval.approvalId).join(', ')}
        </div>
      ) : null}

      {mission.blockers.length ? (
        <div className="mission-operations-alert mission-operations-alert--blocked">
          <strong>Blockers:</strong> {mission.blockers.join(' | ')}
        </div>
      ) : null}

      {mission.warnings.length ? (
        <div className="mission-operations-alert mission-operations-alert--warning">
          <strong>Evidence warnings:</strong> {mission.warnings.join(' | ')}</div>
      ) : null}
    </article>
  );
}

export default function MissionOperationsPanel({ isOpen, onToggle, missionId = '' }) {
  const [feed, setFeed] = useState({ status: 'loading', missions: [], errors: [], generatedAt: '' });
  const [loading, setLoading] = useState(false);
  const [transportError, setTransportError] = useState('');
  const requestSequenceRef = useRef(0);
  const requestControllerRef = useRef(null);

  const refresh = useCallback(async () => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    setLoading(true);
    setTransportError('');
    try {
      const nextFeed = await fetchMissionOperations({ missionId, signal: controller.signal });
      if (requestSequenceRef.current === sequence) setFeed(nextFeed);
    } catch (error) {
      if (error?.name !== 'AbortError' && requestSequenceRef.current === sequence) {
        setTransportError(error?.message || 'Mission Operations refresh failed.');
      }
    } finally {
      if (requestSequenceRef.current === sequence) setLoading(false);
    }
  }, [missionId]);

  useEffect(() => {
    if (!isOpen) return undefined;
    refresh();
    const intervalId = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
      requestControllerRef.current?.abort();
    };
  }, [isOpen, refresh]);

  const actions = (
    <button
      type="button"
      className="icon-button"
      onClick={refresh}
      disabled={loading}
      title="Refresh Mission Operations"
      aria-label="Refresh Mission Operations"
      data-no-drag="true"
    >
      {loading ? '...' : 'Refresh'}
    </button>
  );

  return (
    <CollapsiblePanel
      panelId="missionConsoleMissionOperationsPanel"
      title="Mission Operations"
      description="Live mission, agent, Git, PR, update, approval, blocker, and evidence receipt truth."
      isOpen={isOpen}
      onToggle={onToggle}
      actions={actions}
      className="mission-operations-panel"
      testIdBase="mission-operations-panel"
    >
      <div className="mission-operations-status" data-testid="mission-operations-status" data-feed-status={feed.status}>
        <span><strong>Feed:</strong> {feed.status}</span>
        <span><strong>Source:</strong> {feed.source || 'none'}</span>
        <span><strong>Last refresh:</strong> {displayTime(feed.generatedAt)}</span>
      </div>

      <LiveGoalProjectionSummary projection={feed.liveGoalProjection || {}} />
      <BuildConciergeSurface concierge={feed.buildConcierge || {}} />

      {feed.updateStatus ? (
        <div className="mission-operations-update-status" data-testid="mission-operations-update-status" data-update-status={feed.updateStatus.status}>
          <strong>Workspace update:</strong> {feed.updateStatus.status}
          <span>Local SHA: {feed.updateStatus.localSha || 'unknown'}</span>
          <span>Main SHA: {feed.updateStatus.mainSha || 'unknown'}</span>
          <span>Manual refresh required: {feed.updateStatus.manualRefreshRequired ? 'yes' : 'no'}</span>
          <span>Auto-pull attempted: {feed.updateStatus.autoPullAttempted ? 'yes' : 'no'}</span>
          <span>UI refresh after build: {feed.updateStatus.uiRefreshAfterBuild || 'manual-browser-refresh-required'}</span>
          <span>Next operator action: {feed.updateStatus.nextOperatorAction || 'Refresh update status before acting.'}</span>
        </div>
      ) : null}

      {transportError ? (
        <div className="mission-operations-alert mission-operations-alert--blocked" role="alert">
          <strong>Refresh failed:</strong> {transportError}
        </div>
      ) : null}

      {feed.errors?.length ? (
        <div className="mission-operations-alert mission-operations-alert--warning">
          <strong>Receipt errors:</strong> {feed.errors.map((error) => error.error || error).join(' | ')}
        </div>
      ) : null}

      {feed.missions?.length ? (
        <div className="mission-operations-list">
          {feed.missions.map((mission) => <MissionSummary key={mission.mission.missionId} mission={mission} />)}
        </div>
      ) : (
        <div className="empty-state" data-testid="mission-operations-empty">
          {feed.recommendedNextAction || 'No deterministic mission receipts are available yet.'}
        </div>
      )}
    </CollapsiblePanel>
  );
}
