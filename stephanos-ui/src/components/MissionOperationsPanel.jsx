import { useCallback, useEffect, useRef, useState } from 'react';
import CollapsiblePanel from './CollapsiblePanel';
import { fetchMissionOperations } from '../state/missionOperationsClient';

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

function MissionSummary({ mission }) {
  const checkSummary = `${mission.pullRequest.passingCheckCount}/${mission.pullRequest.requiredCheckCount}`;
  return (
    <article className="mission-operations-item" data-testid="mission-operations-item" data-mission-state={mission.mission.state}>
      <header className="mission-operations-item__header">
        <div>
          <strong>{mission.mission.title}</strong>
          <div className="muted">{mission.mission.missionId}</div>
        </div>
        <span className={`status-badge status-badge--${mission.mission.state.toLowerCase()}`}>
          {mission.mission.state}
        </span>
      </header>

      <dl className="mission-operations-grid">
        <div><dt>Phase</dt><dd>{mission.mission.currentPhase}</dd></div>
        <div><dt>Active agent</dt><dd>{mission.agent.activeAgentLabel} ({mission.agent.role})</dd></div>
        <div><dt>Branch</dt><dd>{mission.git.branch || 'not created'}</dd></div>
        <div><dt>Pull request</dt><dd>{mission.pullRequest.number ? `#${mission.pullRequest.number}` : 'not opened'}</dd></div>
        <div><dt>Checks</dt><dd>{checkSummary}</dd></div>
        <div><dt>Elapsed</dt><dd>{displayElapsed(mission.mission.elapsedSeconds)}</dd></div>
        <div><dt>Updated</dt><dd>{displayTime(mission.mission.updatedAt)}</dd></div>
        <div><dt>Receipts</dt><dd>{mission.receipts.length}</dd></div>
      </dl>

      <div className="mission-operations-next-action">
        <strong>Next action:</strong> {mission.mission.nextAction}
      </div>

      {mission.approvals.length ? (
        <div className="mission-operations-alert mission-operations-alert--approval">
          <strong>Approval required:</strong>{' '}
          {mission.approvals.map((approval) => approval.requiredToken || approval.approvalId).join(', ')}
        </div>
      ) : null}

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
