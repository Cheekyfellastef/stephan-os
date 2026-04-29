import { useMemo, useState } from 'react';
import CollapsiblePanel from './CollapsiblePanel';
import { CAPABILITY_RADAR_SOURCES } from '../../../shared/capability-radar/capabilitySources.mjs';
import { CAPABILITY_RADAR_CANDIDATES } from '../../../shared/capability-radar/capabilityCandidates.mjs';
import { buildCapabilityHandoff, scoreCapabilityCandidate } from '../../../shared/capability-radar/capabilityScoring.mjs';

const FILTERS = ['all', 'high-fit', 'zero-cost', 'local-first', 'needs-review', 'risk-flagged', 'agent-related', 'memory-rag', 'openclaw-related', 'vr-xr-related'];

export default function CapabilityRadarTile({ uiLayout, togglePanel }) {
  const [filter, setFilter] = useState('all');
  const [copiedId, setCopiedId] = useState('');
  const scored = useMemo(() => CAPABILITY_RADAR_CANDIDATES.map((candidate) => ({ ...candidate, scoreSummary: scoreCapabilityCandidate(candidate) })), []);
  const filtered = useMemo(() => scored.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'high-fit') return item.scoreSummary.score >= 75;
    if (filter === 'zero-cost') return item.costPosture === 'zero-cost';
    if (filter === 'local-first') return item.localFirst;
    if (filter === 'needs-review') return ['REVIEW', 'WATCH'].includes(item.scoreSummary.status);
    if (filter === 'risk-flagged') return String(item.riskLevel).includes('high') || item.securityPosture === 'risk-flagged';
    return (item.tags || []).includes(filter);
  }), [filter, scored]);

  const summary = useMemo(() => ({
    sourceCount: CAPABILITY_RADAR_SOURCES.length,
    candidateCount: scored.length,
    highFit: scored.filter((item) => item.scoreSummary.score >= 75).length,
    riskFlagged: scored.filter((item) => String(item.riskLevel).includes('high')).length,
    zeroCost: scored.filter((item) => item.costPosture === 'zero-cost').length,
  }), [scored]);

  function copyHandoff(candidate) {
    const text = buildCapabilityHandoff(candidate, candidate.scoreSummary);
    navigator.clipboard?.writeText(text);
    setCopiedId(candidate.id);
  }

  return <CollapsiblePanel panelId="capabilityRadarPanel" title="Capability Radar" description="Read-only discovery radar for free/open-source capabilities Stephanos could adopt later." isOpen={uiLayout.capabilityRadarPanel !== false} onToggle={() => togglePanel('capabilityRadarPanel')} className="pane-span-2">
    <section className="capability-radar-banner">Read-only discovery. No installs, clones, shell commands, credential access, repo mutation, or external actions occur from this tile.</section>
    <section className="capability-radar-summary-grid">{Object.entries(summary).map(([key, value]) => <article key={key}><strong>{value}</strong><span>{key}</span></article>)}</section>
    <section className="capability-radar-filters">{FILTERS.map((entry) => <button key={entry} type="button" className={filter === entry ? 'active' : ''} onClick={() => setFilter(entry)}>{entry}</button>)}</section>
    <section>
      <h4>Source Watchlist (Static seed mode)</h4>
      <ul className="capability-radar-watchlist">{CAPABILITY_RADAR_SOURCES.map((source) => <li key={source.id}><span>{source.name}</span><a href={source.url} target="_blank" rel="noreferrer">{source.ecosystem}</a></li>)}</ul>
    </section>
    <section>
      <h4>Candidates</h4>
      {filtered.length === 0 ? <p>No candidates match this filter yet.</p> : <div className="capability-radar-cards">{filtered.map((item) => <article key={item.id} className="capability-radar-card"><h5>{item.name}</h5><p>{item.why}</p><ul><li><strong>Category:</strong> {item.category}</li><li><strong>Source:</strong> {item.source}</li><li><strong>Cost posture:</strong> {item.costPosture}</li><li><strong>Local-first:</strong> {item.localFirst ? 'Yes' : 'No'}</li><li><strong>Integration difficulty:</strong> {item.integrationDifficulty}</li><li><strong>Risk level:</strong> {item.riskLevel}</li><li><strong>Suggested next action:</strong> {item.suggestedNextAction}</li><li><strong>Stephanos Fit Score:</strong> {item.scoreSummary.score} ({item.scoreSummary.status})</li></ul><button type="button" onClick={() => copyHandoff(item)}>{copiedId === item.id ? 'Handoff Copied' : 'Copy Codex Handoff'}</button></article>)}</div>}
    </section>
  </CollapsiblePanel>;
}
