import { useMemo, useState } from 'react';
import './SharedWorkspaceProofIndex.css';

const STAGES = [
  'ALL', 'SOURCE_EDIT', 'TEST', 'CI', 'INDEPENDENT_REVIEW',
  'PROTECTED_MERGE', 'INSTALLED', 'SERVED', 'OS_PICKUP',
];
const truncate = (value, length = 12) => value ? String(value).slice(0, length) : 'not bound';
const display = (value) => String(value || 'UNKNOWN').replaceAll('_', ' ');
const safeSourceLink = (value) => typeof value === 'string' && /^https:\/\/github\.com\/Cheekyfellastef\/stephan-os\/(?:(?:pull|issues)\/[1-9]\d{0,9}(?:\/commits\/[a-f0-9]{40})?|commit\/[a-f0-9]{40}|actions\/runs\/[1-9]\d{0,15}(?:\/artifacts\/[1-9]\d{0,15})?)$/.test(value) ? value : '';

/** Compact operator and agent-facing projection of *claims*, never authority. */
export default function SharedWorkspaceProofIndex({ feed }) {
  const [goalFilter, setGoalFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('ALL');
  // Never import the Node-only workspace validator into the browser.
  // This display filters the SAME already-validated, bounded backend proofIndex.
  const result = useMemo(() => {
    const source = feed?.proofIndex;
    const available = ['ready', 'stale'].includes(feed?.state)
      && source?.schemaVersion === 'stephanos.shared-workspace-proof-index.v1'
      && source?.readOnly === true && source?.sourceAvailable === true
      && Array.isArray(source.entries);
    const requested = goalFilter.trim();
    const validGoal = !requested || /^#?[1-9]\d{0,6}$/.test(requested);
    const goal = requested ? Number(requested.replace(/^#/, '')) : null;
    const entries = available && validGoal
      ? source.entries.filter((entry) => goal === null || entry.goal === goal) : [];
    const state = !validGoal ? 'INVALID_FILTER' : !available
      ? 'INACCESSIBLE' : feed.state === 'stale' ? 'STALE' : 'READY';
    const blocker = !validGoal ? 'PROOF_INDEX_FILTER_INVALID'
      : !available ? 'WORKSPACE_FEED_UNAVAILABLE'
      : entries.length ? 'EXTERNAL_PROOF_VERIFICATION_NOT_COMMISSIONED'
      : 'NO_SCOPED_WORKSPACE_PROOF_RECORDS';
    return {
      state, entries, total: goal === null ? source?.totalValidRecords || entries.length : entries.length,
      truncated: Number(source?.omittedCount || 0) > 0,
      blockers: [blocker],
    };
  }, [feed, goalFilter]);
  const entries = useMemo(() => result.entries.filter((entry) =>
    stageFilter === 'ALL' || entry.stage === stageFilter).slice(0, 8), [result.entries, stageFilter]);
  const firstMissingGate = entries[0]?.nextGate || result.blockers?.[0] || 'NO_CURRENT_PROOF';

  return (
    <section className="agents-region shared-proof-index" aria-label="Shared Workspace Proof Index" data-testid="shared-workspace-proof-index">
      <div className="shared-proof-index__heading">
        <div>
          <h4>Shared Workspace · Proof Index</h4>
          <p>Same evidence view for Stephanos, ChatGPT, Sovereign and the operator. A record is a claim until its original authority is checked.</p>
        </div>
        <span className="shared-proof-index__state" data-proof-state={result.state}>{display(result.state)}</span>
      </div>
      <div className="shared-proof-index__instrument-row" aria-label="Shared proof summary">
        <span><strong>{result.total}</strong> scoped records</span>
        <span><strong>{result.entries.filter((x) => x.state === 'UNVERIFIED').length}</strong> unverified</span>
        <span><strong>{result.entries.filter((x) => x.state === 'FAILED' || x.state === 'SUPERSEDED').length}</strong> failures or superseded</span>
      </div>
      <p className="shared-proof-index__next"><strong>First missing proof:</strong> {display(firstMissingGate)}</p>
      <div className="shared-proof-index__filters">
        <label htmlFor="shared-proof-goal">Goal / issue</label>
        <input id="shared-proof-goal" type="search" inputMode="numeric" value={goalFilter}
          maxLength={20} placeholder="All goals or #1290" onChange={(event) => setGoalFilter(event.target.value)} />
        <label htmlFor="shared-proof-stage">Stage</label>
        <select id="shared-proof-stage" value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}>
          {STAGES.map((stage) => <option key={stage} value={stage}>{display(stage)}</option>)}
        </select>
      </div>
      {entries.length ? (
        <ol className="shared-proof-index__entries">
          {entries.map((item, index) => (
            <li key={[item.kind, item.proofId, item.sourceHead, item.runAttempt, index].join(':')}>
              <div className="shared-proof-index__entry-heading">
                <strong>{item.goal ? '#' + item.goal : 'Unbound goal'}{item.prNumber ? ' · PR #' + item.prNumber : ''}</strong>
                <span data-proof-state={item.state}>{display(item.state)}</span>
              </div>
              {item.goalTitle ? <p>{item.goalTitle}</p> : null}
              <p><strong>{display(item.stage)}</strong> · reported {display(item.reportedResult)} · {item.participant}</p>
              <p>Head <code title={item.sourceHead || 'No source-head binding'}>{truncate(item.sourceHead)}</code> · Age {item.observedAgeSeconds}s</p>
              <p className="shared-proof-index__next">Needed: {display(item.nextGate)}</p>
              {safeSourceLink(item.sourceLink) ? (
                <a href={safeSourceLink(item.sourceLink)} target="_blank" rel="noopener noreferrer" title="Open original GitHub record; its independent status is not verified by this index">
                  View original GitHub record (unverified)
                </a>
              ) : <span className="shared-proof-index__empty-link">No safe external proof link supplied</span>}
            </li>
          ))}
        </ol>
      ) : <p role="status" className="shared-proof-index__empty">No scoped proof metadata is available. Missing evidence is UNKNOWN, not green.</p>}
      {result.truncated || result.total > entries.length ? <p className="muted">Showing a bounded latest-proof window; filters apply to visible records only. The canonical ledger is unchanged.</p> : null}
      <p className="shared-proof-index__safety">Read-only evidence discovery. No review, signer, source-lease or protected merge authority is granted.</p>
    </section>
  );
}
