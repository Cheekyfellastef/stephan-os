import { useEffect, useMemo, useState } from 'react';
import CollapsiblePanel from './CollapsiblePanel';
import ConversationLearningJourney from './ConversationLearningJourney.jsx';
import { requestStephanosBackend } from '../../../shared/runtime/backendClient.mjs';
import { SEED_SKILL_CANDIDATES } from '../../../shared/skill-forge/seedSkillCandidates.mjs';
import { buildSkillReviewHandoff, filterSkillCandidates, getSkillPermissionLabel, getSkillRiskLabel, getSkillStatusLabel } from '../../../shared/skill-forge/skillForgeSchema.mjs';
import { buildSkillTransferAssessmentV1, deriveSkillGrowthObservatoryV1, SKILL_TRANSFER_ACTORS } from '../../../shared/skill-forge/skillGrowthProjectionV1.mjs';
import './SkillForgeObservatory.css';

const FILTERS = ['all', 'awaiting-review', 'draft', 'approved-inactive', 'active', 'paused', 'rejected', 'low-risk', 'high-risk', 'read-only', 'needs-approval', 'openclaw-related', 'memory-related', 'troubleshooting', 'codex-handoff'];
const FLOW = [
  ['DISCOVER', 'Capability identified'], ['DESIGN', 'Conjure the recipe'], ['TEACH', 'Retain method'],
  ['EXAM', 'Ten-question qualification'], ['PROVE', 'Deterministic + runtime proof'],
  ['REVIEW', 'Approval boundary'], ['SHARE', 'Target-specific qualification'], ['ACTIVE', 'Proven installed capability'],
];
function sourceTone(truth) { return truth === 'REPORTED' ? 'reported' : truth === 'STALE' ? 'stale' : 'unknown'; }
function displayTime(value) {
  if (!value || value === 'UNKNOWN') return 'Unreported';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unreported' : date.toLocaleString();
}
function isHostedBrowserSurface() {
  if (typeof window === 'undefined' || !window.location) return false;
  const host = String(window.location.hostname || '').toLowerCase();
  return window.location.protocol === 'https:' && !['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host);
}
function SkillForgeObservatory({ runtimeStatusModel }) {
  const [feed, setFeed] = useState(null);
  const [refreshState, setRefreshState] = useState('CONNECTING');
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(SEED_SKILL_CANDIDATES[0]?.id || '');
  const [copyState, setCopyState] = useState('');
  const [targetId, setTargetId] = useState('sovereign-commander');
  const [selectedLearningId, setSelectedLearningId] = useState('');
  const bridge = runtimeStatusModel?.runtimeContext?.bridgeTransportTruth || {};
  const hostedTarget = String(bridge.bridgeHostedExecutionBridgeUrl || bridge.bridgeHostedExecutionTarget || '').trim();
  const localTarget = String(bridge.bridgeOperatorTransportUrl || runtimeStatusModel?.runtimeContext?.homeNodeBridge?.backendUrl || '').trim();
  const runtimeContext = useMemo(() => ({
    frontendOrigin: typeof window !== 'undefined' ? window.location?.origin || '' : '',
    baseUrl: isHostedBrowserSurface() && hostedTarget ? hostedTarget : '',
    hostedExecutionBridgeUrl: hostedTarget,
    bridgeUrl: localTarget,
    homeNodeBridge: runtimeStatusModel?.runtimeContext?.homeNodeBridge || null,
  }), [hostedTarget, localTarget, runtimeStatusModel?.runtimeContext?.homeNodeBridge]);
  useEffect(() => {
    let cancelled = false;
    let timer = null;
    async function refresh() {
      try {
        const response = await requestStephanosBackend({
          path: '/api/shared-workspace/dashboard-feed?scope=full-history',
          runtimeContext, timeoutMs: 10000,
        });
        if (!cancelled) {
          setFeed(response.json || null);
          setRefreshState(response.json ? 'RECEIVED' : 'NO_RESPONSE');
        }
      } catch (_error) {
        if (!cancelled) { setFeed(null); setRefreshState('OFFLINE'); }
      } finally {
        if (!cancelled && typeof window !== 'undefined') timer = window.setTimeout(refresh, 30000);
      }
    }
    void refresh();
    return () => { cancelled = true; if (timer != null && typeof window !== 'undefined') window.clearTimeout(timer); };
  }, [runtimeContext]);

  const view = useMemo(() => deriveSkillGrowthObservatoryV1({
    payload: feed || {}, seedSkills: SEED_SKILL_CANDIDATES, runtimeStatusModel,
  }), [feed, runtimeStatusModel]);
  const filtered = useMemo(() => filterSkillCandidates(view.skillCandidates, filter), [view, filter]);
  const selected = filtered.find(skill => skill.id === selectedId) || filtered[0] || null;
  const selectedLearning = view.learningEvents.find(event => event.id === selectedLearningId) || view.learningEvents[0] || null;
  const source = selectedLearning?.teacher || 'openclaw-local';
  const target = source !== targetId ? targetId : (SKILL_TRANSFER_ACTORS.find(actor => actor.id !== source)?.id || 'UNKNOWN');
  const learningPayload = (feed?.records?.eventRecords || []).find(record => (record.eventId || record.closedLoopLearning?.eventId) === selectedLearning?.id)?.closedLoopLearning;
  const transfer = buildSkillTransferAssessmentV1({ learning: learningPayload, sourceActor: source, targetActor: target });
  const conversationUplift = feed?.conversationUplift || { state: 'unavailable', turnCount: 0, candidates: [] };
  const upgrade = runtimeStatusModel?.realityUpgradeOrchestrator || {};
  const capabilityGaps = Array.isArray(upgrade.capabilityGaps) ? upgrade.capabilityGaps : [];

  async function copyReview(skill) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard-unavailable');
      await navigator.clipboard.writeText(buildSkillReviewHandoff(skill));
      setCopyState(skill.id);
    } catch { setCopyState('FAILED'); }
  }

  return (
    <section className="skill-observatory uplift-workspace" data-testid="skill-forge-observatory">
      <header className="skill-observatory__hero">
        <div>
          <span className="skill-kicker">STEPHANOS · SKILL FORGE · CAPABILITY EVOLUTION</span>
          <h2>Capability Genesis Observatory</h2>
          <p>From the first missing skill to proven knowledge shared across the fleet. Every rung has evidence, ownership and a gate.</p>
        </div>
        <div className={'skill-source-pill ' + sourceTone(view.sourceTruth)}>
          <small>SHARED WORKSPACE TRUTH</small>
          <strong>{view.sourceTruth}</strong>
          <span>{refreshState}</span>
        </div>
      </header>
      <div className="skill-metrics">
        <article><span>Seed proposals</span><strong>{view.summary.proposals}</strong><small>Not installed skills</small></article>
        <article><span>Learning events</span><strong>{view.summary.witnessedLearning}</strong><small>Typed events in history</small></article>
        <article><span>Lessons qualified</span><strong>{view.summary.verifiedLessons}</strong><small>Passed exam + proof</small></article>
        <article><span>Published skill records</span><strong>{view.summary.publishedSkillRecords}</strong><small>Verified provenance schema</small></article>
        <article><span>Active recipients</span><strong>{view.summary.provenActiveTargets}</strong><small>Exact target runtime receipts</small></article>
      </div>
      <ConversationLearningJourney
        placement="skill-forge"
        uplift={conversationUplift}
        feedState={refreshState === 'RECEIVED' ? 'reachable' : 'unavailable'}
      />
      <div className="skill-lab-layout">
        <section className="skill-panel skill-process-panel">
          <div className="skill-section-head"><div><span className="skill-kicker">THE GROWTH ENGINE</span><h3>Capability construction line</h3></div><span>8 qualification stages</span></div>
          <div className="skill-process">
            {FLOW.map(([stage, label], index) => <div key={stage} className="skill-process-step">
              <div className="skill-process-node"><strong>{String(index + 1).padStart(2, '0')}</strong><span>{stage}</span></div>
              <div><b>{label}</b><small>{view.stages.find(item => item.id === stage)?.count || 0} evidenced at this stage</small></div>
            </div>)}
          </div>
          <p className="skill-truth-note">A proposal is not a built skill. A qualified lesson is not an installed tool. No stage implicitly grants execution, network, Git or whole-PC authority.</p>
        </section>
        <section className="skill-panel skill-network-panel">
          <div className="skill-section-head"><div><span className="skill-kicker">CROSS-AGENT KNOWLEDGE FABRIC</span><h3>Who can teach whom?</h3></div><span>4 trust identities</span></div>
          <div className="skill-agent-list">
            {view.observedActors.map((actor, index) => <article key={actor.id} className="skill-agent-card">
              <div className="skill-agent-symbol">{index === 0 ? '◈' : index === 1 ? '◇' : index === 2 ? '♛' : '▣'}</div>
              <div><strong>{actor.label}</strong><small>{actor.scope}</small><span>Runtime proof: {actor.runtime} · {actor.learningCount} learning event(s)</span></div>
              <div className="skill-agent-count"><b>{actor.skillCount}</b><small>recorded</small></div>
            </article>)}
          </div>
          <p className="skill-truth-note">Knowledge may travel from Local to Stephanos, Sovereign Commander and Standalone. Each recipient needs a fresh proof, scope review and its own approval; privileges never travel with the lesson.</p>
        </section>
      </div>
      <section className="skill-panel" data-testid="skill-forge-gate-repair-handoff">
        <div className="skill-section-head">
          <div><span className="skill-kicker">SIGNED GOAL OBSERVATORY → CAPABILITY TRIAGE</span><h3>Failed gates and repair handoffs</h3></div>
          <span>{view.gateRepair.summary.failedGateCount} evidenced failure(s) · {view.gateRepair.summary.skillReviewDraftCount} skill-review draft(s)</span>
        </div>
        <p>Trust: {view.gateRepair.sourceTruth}. Gate failures become owner-specific review handoffs, not automatically installed tools. Only explicit missing-capability evidence enters the Skill Forge blueprint vault.</p>
        {view.gateRepair.requests.length ? <div className="skill-agent-list">
          {view.gateRepair.requests.map(request => <article className="skill-agent-card" key={request.gateId}>
            <div className="skill-agent-symbol">{request.gateId}</div>
            <div><strong>{request.title}</strong><small>{request.blocker} · {request.owner}</small><span>{request.nextAction}</span></div>
            <div className="skill-agent-count"><small>{request.route.replaceAll('_', ' ')}</small></div>
          </article>)}
        </div> : <p className="skill-empty">No fresh, verified failed-gate handoffs in this feed. UNKNOWN is not PASS; refresh signed Observatory proof.</p>}
        <p className="skill-truth-note">Original custody, independent Windows witnesses and operator approvals can never be satisfied by installing a skill. No admission, mutation, execution or protected merge authority is granted here.</p>
      </section>
      <section className="skill-panel" data-testid="skill-forge-external-intake">
        <div className="skill-section-head">
          <div><span className="skill-kicker">SOVEREIGN SKILL FOUNDRY · EXTERNAL INTAKE</span><h3>Ready-made skill review</h3></div>
          <span>{view.skillCandidates.filter(skill => skill.provenance === 'EXTERNAL_DRAFT_NOT_INSTALLED').length} external review draft(s)</span>
        </div>
        <p>Pre-existing SKILL.md packages from OpenAI, Anthropic, GitHub or ClawHub can be staged with the offline intake tool. Only typed packets already recorded in Shared Workspace appear here. Source links, licenses and publisher claims still require independent verification.</p>
        <p className="skill-truth-note">Intake is review-only. No marketplace install, executable shell, automatic approval, new authority, global OpenClaw propagation or Battle Bridge activation is enabled. OpenClaw Local is the only initial candidate recipient.</p>
      </section>
      <section className="skill-panel">
        <div className="skill-section-head"><div><span className="skill-kicker">CANDIDATE LIBRARY</span><h3>Skill blueprint vault</h3></div><span>{filtered.length} of {view.skillCandidates.length} seeds</span></div>
        <div className="skill-filters" aria-label="Filter skill candidates">
          {FILTERS.map(value => <button type="button" key={value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>{value.replaceAll('-', ' ')}</button>)}
        </div>
        <div className="skill-blueprint-layout">
          <div className="skill-blueprint-list">
            {filtered.map(skill => <button key={skill.id} type="button" className={'skill-blueprint-card ' + (selected?.id === skill.id ? 'selected' : '')} onClick={() => setSelectedId(skill.id)}>
              <strong>{skill.name}</strong><small>{skill.plainEnglishSummary}</small><span>{getSkillStatusLabel(skill.status)} · {getSkillRiskLabel(skill.riskLevel)}</span>
            </button>)}
            {!filtered.length && <p>No candidates match this filter. No skills have been deleted.</p>}
          </div>
          <div className="skill-blueprint-detail">
            {selected ? <>
              <span className="skill-kicker">BLUEPRINT · {selected.provenance}</span>
              <h4>{selected.name}</h4>
              <p>{selected.plainEnglishSummary}</p>
              <dl>
                <div><dt>Why this exists</dt><dd>{selected.whySuggested}</dd></div>
                <div><dt>Permissions</dt><dd>{getSkillPermissionLabel(selected.permissionLevel)}</dd></div>
                <div><dt>Allowed</dt><dd>{selected.allowedTouches?.join('; ') || 'Not declared'}</dd></div>
                <div><dt>Forbidden</dt><dd>{selected.forbiddenTouches?.join('; ') || 'Not declared'}</dd></div>
                <div><dt>Recovery</dt><dd>{selected.rollbackPath || 'Not declared'}</dd></div>
              </dl>
              <button type="button" className="skill-primary-action" onClick={() => copyReview(selected)}>
                {copyState === selected.id ? 'Review packet copied' : copyState === 'FAILED' ? 'Clipboard unavailable · retry' : 'Copy review packet'}
              </button>
              <p className="skill-truth-note">Review packets are proposals only. No local-only approval button changes canonical authority.</p>
            </> : <p>Select a blueprint for its scope, risk and review packet.</p>}
          </div>
        </div>
      </section>
      <div className="skill-lab-layout">
        <section className="skill-panel">
          <div className="skill-section-head"><div><span className="skill-kicker">LEARNING EVIDENCE</span><h3>Proof timeline</h3></div><span>{view.learningEvents.length} recorded</span></div>
          <div className="skill-timeline">
            {view.timeline.length ? view.timeline.map(event => <button className={'skill-timeline-row ' + (event.id === selectedLearning?.id ? 'selected' : '')} type="button" onClick={() => setSelectedLearningId(event.id)} key={event.id}>
              <span className={'skill-stage-tag ' + (event.verified ? 'passed' : '')}>{event.stage}</span>
              <strong>{event.capability}</strong><small>{event.teacher} · {displayTime(event.timestampUtc)}</small>
            </button>) : <p className="skill-empty">No typed closed-loop capability events in the accessible history. Existing Flywheel events are not silently relabelled as skills.</p>}
          </div>
        </section>
        <section className="skill-panel">
          <div className="skill-section-head"><div><span className="skill-kicker">TRANSFER CLEARANCE</span><h3>Cross-agent qualification gate</h3></div><span>Read-only assessment</span></div>
          <label className="skill-transfer-label" htmlFor="skill-target-choice">Proposed destination</label>
          <select id="skill-target-choice" value={target} onChange={event => setTargetId(event.target.value)}>
            {SKILL_TRANSFER_ACTORS.filter(actor => actor.id !== source).map(actor => <option key={actor.id} value={actor.id}>{actor.label}</option>)}
          </select>
          <p><strong>{source}</strong> → <strong>{target}</strong></p>
          <div className="skill-transfer-checks">
            {Object.entries(transfer.checks).map(([name, passed]) => <div key={name}><span className={passed ? 'check-ok' : 'check-missing'}>{passed ? '✓' : '○'}</span>{name.replace(/([A-Z])/g, ' $1')}</div>)}
          </div>
          <p className="skill-truth-note">{transfer.verdict}. The existing approved execution route is required even if all checks eventually pass.</p>
        </section>
      </div>
      <section className="skill-panel" data-testid="skill-reality-upgrade-signals">
        <div className="skill-section-head"><div><span className="skill-kicker">CAPABILITY RADAR → REALITY UPGRADES</span><h3>Other detected capability gaps</h3></div><span>{capabilityGaps.length} reported</span></div>
        {capabilityGaps.length ? <div className="skill-agent-list">
          {capabilityGaps.map((gap, index) => <article className="skill-agent-card" key={index}>
            <div className="skill-agent-symbol">+</div>
            <div><strong>{typeof gap === 'string' ? gap : String(gap?.title || gap?.summary || 'Capability gap')}</strong><small>Proposed from reality upgrade intent: {String(upgrade.upgradeIntent || 'operator request')}</small></div>
            <div className="skill-agent-count"><small>Not yet a skill</small></div>
          </article>)}
        </div> : <p className="skill-empty">No additional Reality Upgrade signals are currently published.</p>}
      </section>
      <section className="skill-panel skill-reality-bar" role="status">
        <strong>Reality check</strong><span>{view.reason}</span><small>Next: {view.nextAction}</small>
        <small>Feed: {view.source} · Local bridge: {view.backendRoute}</small>
      </section>
    </section>
  );
}
export default function SkillForgeTile({ uiLayout = {}, togglePanel = () => {}, runtimeStatusModel = null, forcePanelOpen = false }) {
  const isOpen = forcePanelOpen || uiLayout.skillForgePanel !== false;
  return <CollapsiblePanel panelId="skillForgePanel" title="Skill Forge" description="Evidence-backed capability development, learning and transfer observatory." isOpen={isOpen} onToggle={forcePanelOpen ? () => {} : () => togglePanel('skillForgePanel')} className={'pane-span-2 skill-forge-pane' + (forcePanelOpen ? ' skill-forge-pane--workspace' : '')}>
    {isOpen && <SkillForgeObservatory runtimeStatusModel={runtimeStatusModel} />}
  </CollapsiblePanel>;
}
