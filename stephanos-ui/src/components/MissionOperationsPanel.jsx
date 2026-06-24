import { useCallback, useEffect, useRef, useState } from 'react';
import CollapsiblePanel from './CollapsiblePanel';
import { MissionActionControls, MissionIntakeForm } from './MissionOperationsControls';
import { fetchMissionOperations } from '../state/missionOperationsClient';
import './MissionOperationsPanel.css';

const REFRESH_INTERVAL_MS = 5000;

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

export function MissionSummary({ mission, onChanged }) {
  const supportingAgents = mission.agent.supportingAgents || [];
  const changedFiles = mission.git.changedFiles || [];
  const checks = mission.pullRequest.checks || [];
  const approvals = mission.approvals || [];
  const receipts = mission.receipts || [];
  const pendingApproval = approvals.some((approval) => approval.status === 'pending');
  const repair = mission.repair || { currentRound: 0, maximumRounds: 3 };
  const deployment = mission.deployment || {};
  const deploymentSummary = ['sync', 'build', 'verify', 'restart']
    .map((step) => `${step}:${deployment[step]?.status || 'pending'}`)
    .join(' / ');

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
        <div><dt>Checks</dt><dd>{mission.pullRequest.passingCheckCount}/{mission.pullRequest.requiredCheckCount}</dd></div>
        <div><dt>Repair round</dt><dd>{repair.currentRound}/{repair.maximumRounds}</dd></div>
        <div><dt>Deployment</dt><dd>{deploymentSummary}</dd></div>
        <div><dt>Started</dt><dd>{displayTime(mission.mission.startedAt)}</dd></div>
        <div><dt>Updated</dt><dd>{displayTime(mission.mission.updatedAt)}</dd></div>
        <div><dt>Elapsed</dt><dd>{displayElapsed(mission.mission.elapsedSeconds)}</dd></div>
        <div><dt>Receipts</dt><dd>{receipts.length}</dd></div>
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
              {approval.decidedAt ? ` / decided ${displayTime(approval.decidedAt)}` : ''}
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

      {pendingApproval ? (
        <div className="mission-operations-alert mission-operations-alert--approval">
          <strong>Approval required:</strong> submit the private exact head-bound token below.
        </div>
      ) : null}

      <MissionActionControls mission={mission} onChanged={onChanged} />

      {mission.blockers.length ? (
        <div className="mission-operations-alert mission-operations-alert--blocked">
          <strong>Blockers:</strong> {mission.blockers.join(' | ')}
        </div>
      ) : null}

      {mission.warnings.length ? (
        <div className="mission-operations-alert mission-operations-alert--warning">
          <strong>Evidence warnings:</strong> {mission.warnings.join(' | ')}
        </div>
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
      description="Live mission, agent, Git, PR, approval, blocker, and evidence receipt truth."
      isOpen={isOpen}
      onToggle={onToggle}
      actions={actions}
      className="mission-operations-panel"
      testIdBase="mission-operations-panel"
    >
      <MissionIntakeForm onChanged={refresh} />

      <div className="mission-operations-status" data-testid="mission-operations-status" data-feed-status={feed.status}>
        <span><strong>Feed:</strong> {feed.status}</span>
        <span><strong>Source:</strong> {feed.source || 'none'}</span>
        <span><strong>Last refresh:</strong> {displayTime(feed.generatedAt)}</span>
      </div>

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
          {feed.missions.map((mission) => (
            <MissionSummary key={mission.mission.missionId} mission={mission} onChanged={refresh} />
          ))}
        </div>
      ) : (
        <div className="empty-state" data-testid="mission-operations-empty">
          {feed.recommendedNextAction || 'No deterministic mission receipts are available yet.'}
        </div>
      )}
    </CollapsiblePanel>
  );
}
