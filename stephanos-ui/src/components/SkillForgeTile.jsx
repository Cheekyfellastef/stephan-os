import { useEffect, useMemo, useState } from 'react';
import CollapsiblePanel from './CollapsiblePanel';
import { SEED_SKILL_CANDIDATES } from '../../../shared/skill-forge/seedSkillCandidates.mjs';
import { requestStephanosBackend } from '../../../shared/runtime/backendClient.mjs';
import { projectSovereignSkillGrowth } from '../../../shared/skill-forge/sovereignSkillGrowthProjection.mjs';
import { buildSkillReviewHandoff, filterSkillCandidates, getSkillPermissionLabel, getSkillRiskLabel, getSkillStatusLabel } from '../../../shared/skill-forge/skillForgeSchema.mjs';

const FILTERS = ['all','awaiting-review','draft','approved-inactive','active','paused','rejected','low-risk','high-risk','read-only','needs-approval','openclaw-related','memory-related','troubleshooting','codex-handoff'];

export default function SkillForgeTile({ uiLayout, togglePanel, runtimeStatusModel = null }) {
  const [filter, setFilter] = useState('all');
  const [selectedSkillId, setSelectedSkillId] = useState(SEED_SKILL_CANDIDATES[0]?.id || '');
  const [decisionState, setDecisionState] = useState({});
  const [copyState, setCopyState] = useState('');
  const [sovereignFeed, setSovereignFeed] = useState(null);
  const runtimeContext = useMemo(() => ({
    frontendOrigin: typeof window === 'undefined' ? '' : window.location?.origin || '',
    bridgeUrl: runtimeStatusModel?.runtimeContext?.homeNodeBridge?.backendUrl || '',
    homeNodeBridge: runtimeStatusModel?.runtimeContext?.homeNodeBridge || null,
  }), [runtimeStatusModel?.runtimeContext?.homeNodeBridge]);
  useEffect(() => {
    if (uiLayout.skillForgePanel === false) return undefined;
    let cancelled = false;
    let timer;
    const refresh = async () => {
      try {
        const result = await requestStephanosBackend({
          path: '/api/shared-workspace/dashboard-feed',
          runtimeContext,
          timeoutMs: 10000,
        });
        if (!cancelled) setSovereignFeed(result.json || null);
      } catch {
        if (!cancelled) setSovereignFeed(null);
      } finally {
        if (!cancelled && typeof window !== 'undefined') {
          timer = window.setTimeout(refresh, 30000);
        }
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      if (timer !== undefined && typeof window !== 'undefined') window.clearTimeout(timer);
    };
  }, [runtimeContext, uiLayout.skillForgePanel]);
  const sovereignGrowth = useMemo(
    () => projectSovereignSkillGrowth(sovereignFeed),
    [sovereignFeed],
  );


  const skills = useMemo(() => SEED_SKILL_CANDIDATES.map((skill) => ({ ...skill, status: decisionState[skill.id] || skill.status })), [decisionState]);
  const filtered = useMemo(() => filterSkillCandidates(skills, filter), [skills, filter]);
  const selected = filtered.find((skill) => skill.id === selectedSkillId) || filtered[0] || null;
  const summary = useMemo(() => ({ total: skills.length, awaiting: skills.filter((s) => s.status === 'AWAITING_REVIEW').length, approved: skills.filter((s) => s.status === 'APPROVED_INACTIVE').length, active: skills.filter((s) => s.status === 'ACTIVE').length, paused: skills.filter((s) => s.status === 'PAUSED').length, rejected: skills.filter((s) => ['REJECTED','ARCHIVED'].includes(s.status)).length, highRisk: skills.filter((s) => ['HIGH','BLOCKED'].includes(s.riskLevel)).length }), [skills]);
  const orchestrator = runtimeStatusModel?.realityUpgradeOrchestrator || {};
  const upgradeCandidates = (orchestrator.capabilityGaps || []).map((gap, idx) => ({ id: `upgrade-gap-${idx}`, title: gap, why: `Needed to fulfill upgrade intent: ${orchestrator.upgradeIntent || 'operator intent'}.` }));
  const copyHandoff = async (skill) => { await navigator.clipboard?.writeText(buildSkillReviewHandoff(skill)); setCopyState(skill.id); };

  return <CollapsiblePanel panelId="skillForgePanel" title="Skill Forge" description="Transparent Growth, Not Secret Power. Read-only proposal surface for reusable Stephanos skills." isOpen={uiLayout.skillForgePanel !== false} onToggle={() => togglePanel('skillForgePanel')} className="pane-span-2">
    <section className="capability-radar-banner">Skill Forge can suggest new powers. It cannot secretly activate them.</section>
    <section className="capability-radar-summary-grid">{Object.entries(summary).map(([k,v]) => <article key={k}><strong>{v}</strong><span>{k}</span></article>)}</section>
    <p><strong>Doctrine:</strong> Transparent Growth, Not Secret Power. Stephanos may propose new skills, but it cannot secretly activate them or grant itself permissions.</p>
    <p><strong>Plain-English:</strong> Skills are reusable playbooks. In this phase, the forge only proposes and explains skills. It does not execute them.</p>
    <section className="capability-radar-filters">{FILTERS.map((entry) => <button key={entry} type="button" className={filter===entry ? 'active' : ''} onClick={() => setFilter(entry)}>{entry}</button>)}</section>
    <div className="capability-radar-cards">{filtered.map((skill) => <article key={skill.id} className="capability-radar-card"><h5>{skill.name}</h5><p>{skill.plainEnglishSummary}</p><ul><li><strong>Status:</strong> {getSkillStatusLabel(skill.status)}</li><li><strong>Risk:</strong> {getSkillRiskLabel(skill.riskLevel)}</li><li><strong>Permission:</strong> {getSkillPermissionLabel(skill.permissionLevel)}</li><li><strong>Why suggested:</strong> {skill.whySuggested}</li><li><strong>Can touch:</strong> {skill.allowedTouches?.join(' ')}</li><li><strong>Cannot touch:</strong> {skill.forbiddenTouches?.join(' ')}</li><li><strong>Rollback:</strong> {skill.rollbackPath}</li></ul><div><button type="button" onClick={() => setSelectedSkillId(skill.id)}>Open detail</button><button type="button" onClick={() => setDecisionState((prev) => ({ ...prev, [skill.id]: 'APPROVED_INACTIVE' }))}>Approve as inactive</button><button type="button" onClick={() => setDecisionState((prev) => ({ ...prev, [skill.id]: 'PAUSED' }))}>Pause</button><button type="button" onClick={() => setDecisionState((prev) => ({ ...prev, [skill.id]: 'REJECTED' }))}>Reject</button><button type="button" onClick={() => setDecisionState((prev) => ({ ...prev, [skill.id]: 'ARCHIVED' }))}>Archive</button><button type="button" onClick={() => copyHandoff(skill)}>{copyState===skill.id?'Handoff Copied':'Copy Skill Review Handoff'}</button></div></article>)}</div>
    {selected ? <section><h4>Operator Translation</h4><p><strong>What is this?</strong> {selected.plainEnglishSummary}</p><p><strong>Why should I care?</strong> {selected.whySuggested}</p><p><strong>What button would I press?</strong> Use Approve as inactive, Pause, Reject, or Archive.</p><p><strong>What happens if I press it?</strong> Phase 1 only updates local UI state.</p><p><strong>What can go wrong?</strong> Misclassification or over-trust in a draft skill.</p><p><strong>How do I undo it?</strong> Change decision state or archive the candidate.</p></section> : null}
    <section aria-label="Sovereign Skill Conjurer proposals">
      <h4>Sovereign capability growth</h4>
      <p><strong>Source:</strong> {sovereignGrowth.state} | <strong>Origin:</strong> canonical Shared Workspace #2573 | <strong>Observed:</strong> {sovereignGrowth.capturedAtUtc || 'not yet published'}</p>
      <p><strong>Draft skills:</strong> {sovereignGrowth.totalDraftCount} | <strong>Native gaps:</strong> {sovereignGrowth.nativeGapCount} | <strong>Remote parity gaps:</strong> {sovereignGrowth.remoteGapCount} | <strong>Native source:</strong> {sovereignGrowth.sourceHealth}</p>
      {sovereignGrowth.state !== 'CURRENT' ? <p><strong>Attention:</strong> {sovereignGrowth.reason}. No claim of live skill activation is possible without current verified status.</p> : null}
      {sovereignGrowth.draftsTruncated ? <p>Only the first bounded skill packets are displayed. Remaining gap identities are retained in the canonical compiler.</p> : null}
      <div className="capability-radar-cards">
        {sovereignGrowth.drafts.map((skill) => <article key={skill.id} className="capability-radar-card">
          <h5>{skill.name}</h5>
          <p>{skill.summary}</p>
          <ul>
            <li><strong>Origin:</strong> {skill.origin === 'SOVEREIGN_SELF_DISCOVERY' ? 'Sovereign's own learning event' : 'Remote Commander parity'}</li>
            <li><strong>Review:</strong> {skill.status}, not activated</li>
            <li><strong>Risk:</strong> {getSkillRiskLabel(skill.riskLevel)}</li>
            <li><strong>Permission:</strong> {getSkillPermissionLabel(skill.permissionLevel)}</li>
            <li><strong>Steps:</strong> {skill.proposedSteps} guarded proposal stages</li>
          </ul>
          <p>{skill.reason}</p>
        </article>)}
      </div>
      {sovereignGrowth.drafts.length === 0 ? <p>No validated Sovereign skill drafts available from the current feed. This is not proof that all capabilities are complete.</p> : null}
      <p><strong>Boundary:</strong> Read-only visibility, no auto-build, no skill activation, no self-approval. Source and owner: <a href="https://github.com/Cheekyfellastef/stephan-os/issues/2573" target="_blank" rel="noreferrer">Goal #2573</a>.</p>
    </section>
    <section><h4>Learning Ledger</h4><p>Every growth event leaves a footprint.</p><ul>{skills.map((skill) => <li key={skill.id}>{skill.name}: {getSkillStatusLabel(skill.status)}</li>)}</ul></section>
    <section><h4>Reality Upgrade candidates</h4><ul>{upgradeCandidates.length ? upgradeCandidates.map((entry) => <li key={entry.id}><strong>{entry.title}</strong>: {entry.why}</li>) : <li>No upgrade candidates yet.</li>}</ul></section>
    <section><p><strong>Safety rail:</strong> No skill can execute shell commands, modify files, use credentials, access accounts, call paid APIs, or change GitHub unless explicitly approved through future operator controls.</p></section>
  </CollapsiblePanel>;
}
