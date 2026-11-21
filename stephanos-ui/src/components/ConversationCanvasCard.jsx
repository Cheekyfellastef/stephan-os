const CANVAS_SCHEMA = 'stephanos.ui-agent.conversation-canvas-presenter.v1';
const CANVAS_STATES = new Set(['LOADING', 'PARTIAL', 'READY', 'ERROR', 'OFFLINE']);
const CANVAS_SURFACES = new Set(['desktop-browser', 'ipad', 'iphone']);
const SURFACE_LAYOUTS = Object.freeze({
  'desktop-browser': 'TWO_COLUMN_WITH_DETAIL_RAIL',
  ipad: 'TOUCH_STACK_WITH_DETAIL_DRAWER',
  iphone: 'SINGLE_COLUMN_PROGRESSIVE',
});
const ZERO_AUTHORITY_KEYS = Object.freeze([
  'sourceMutationAllowed',
  'commandExecutionAllowed',
  'approvalAuthorityAdded',
  'mergeAllowed',
  'deploymentAllowed',
  'runtimeMutationAllowed',
  'providerSelectionAuthorityAdded',
  'privateUiTruthAllowed',
  'presenterMayExecuteActions',
  'presenterMayHideEvidence',
]);

function safeArray(value, limit = 64) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function safeText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function authorityIsZero(authority) {
  return Boolean(
    authority
      && typeof authority === 'object'
      && !Array.isArray(authority)
      && ZERO_AUTHORITY_KEYS.every((key) => authority[key] === false),
  );
}

function modesAreInert(modes) {
  if (!Array.isArray(modes)) return false;
  return modes.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.executable !== false) return false;
    return entry.mode !== 'IMPROVE_STEPHANOS' || entry.constructionExecutionOwnedHere === false;
  });
}

function actionSectionsAreInert(sections) {
  if (!Array.isArray(sections)) return false;
  for (const section of sections) {
    if (!section || typeof section !== 'object' || Array.isArray(section)) return false;
    if (section.kind !== 'RECOMMENDED_ACTION') continue;
    if (!Array.isArray(section.items)) return false;
    for (const item of section.items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      if (Object.hasOwn(item, 'interactiveApprovalAllowed')) {
        if (item.interactiveApprovalAllowed !== false) return false;
      } else if (item.executable !== false) {
        return false;
      }
    }
  }
  return true;
}

export function isConversationCanvasViewV1(view) {
  const surface = safeText(view?.surface);
  const state = safeText(view?.state).toUpperCase();
  const touchSurface = surface === 'ipad' || surface === 'iphone';
  const reducedMotion = view?.accessibility?.reducedMotion === true;
  return Boolean(
    view
      && typeof view === 'object'
      && !Array.isArray(view)
      && view.schemaVersion === CANVAS_SCHEMA
      && view.valid === true
      && CANVAS_STATES.has(state)
      && CANVAS_SURFACES.has(surface)
      && safeText(view.layoutProfile?.layout) === SURFACE_LAYOUTS[surface]
      && authorityIsZero(view.authority)
      && view.stateBanner?.colorOnlyStatusAllowed === false
      && view.accessibility?.colorOnlyStatusAllowed === false
      && view.accessibility?.evidenceKeyboardReachable === true
      && (!touchSurface || view.accessibility?.touchTargetsLarge === true)
      && (!reducedMotion || view.accessibility?.animationAllowed === false)
      && modesAreInert(view.experienceModes)
      && actionSectionsAreInert(view.sections),
  );
}

function EvidenceRefs({ refs }) {
  const items = safeArray(refs, 32).map((ref) => safeText(ref)).filter(Boolean);
  if (!items.length) return null;
  return (
    <ul className="compact-list" aria-label="Evidence references">
      {items.map((ref) => <li key={ref}><code>{ref}</code></li>)}
    </ul>
  );
}

function SectionItem({ item, kind, index }) {
  if (typeof item === 'string') return <li>{item}</li>;
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;

  if (kind === 'EVIDENCE_DISCLOSURE') {
    if (safeText(item.evidenceRef)) return <li><code>{safeText(item.evidenceRef)}</code></li>;
    return (
      <li>
        <strong>{safeText(item.epistemicState, 'Evidence claim')}</strong>
        {safeText(item.text) ? <p>{safeText(item.text)}</p> : null}
        <EvidenceRefs refs={item.evidenceRefs} />
      </li>
    );
  }

  if (kind === 'GOAL_MISSION') {
    return (
      <li>
        <strong>{safeText(item.label, safeText(item.ref, 'Goal or mission'))}</strong>
        <span> · {safeText(item.state, 'UNKNOWN')}</span>
        {safeText(item.ref) ? <p><code>{safeText(item.ref)}</code></p> : null}
        <EvidenceRefs refs={item.evidenceRefs} />
      </li>
    );
  }

  if (kind === 'PROVIDER_AGENT_CONTRIBUTION') {
    return (
      <li>
        <strong>{safeText(item.contributorId, 'Contributor')}</strong>
        <span> · {safeText(item.contributionType, 'EVIDENCE_SOURCE')}</span>
        {safeText(item.summary) ? <p>{safeText(item.summary)}</p> : null}
        <EvidenceRefs refs={item.evidenceRefs} />
      </li>
    );
  }

  if (kind === 'OPTION') {
    return (
      <li>
        <strong>{safeText(item.label, `Option ${index + 1}`)}</strong>
        {safeText(item.tradeoff) ? <p>{safeText(item.tradeoff)}</p> : null}
        <EvidenceRefs refs={item.evidenceRefs} />
      </li>
    );
  }

  if (kind === 'RECOMMENDED_ACTION') {
    const approvalCard = Object.hasOwn(item, 'interactiveApprovalAllowed');
    if (approvalCard) {
      return (
        <li data-approval-interactive="false" aria-disabled="true">
          <strong>Approval status: {safeText(item.state, 'UNKNOWN')}</strong>
          {safeText(item.approvalRef) ? <p><code>{safeText(item.approvalRef)}</code></p> : null}
          <EvidenceRefs refs={item.evidenceRefs} />
        </li>
      );
    }
    return (
      <li data-action-executable="false" aria-disabled="true">
        <strong>{safeText(item.label, 'No executable action')}</strong>
        {safeText(item.rationale) ? <p>{safeText(item.rationale)}</p> : null}
        <p>Approval required: {safeText(item.requiresApproval, 'UNKNOWN')} · Presentation only</p>
        <EvidenceRefs refs={item.evidenceRefs} />
      </li>
    );
  }

  return <li><code>{safeText(item.label || item.ref || item.contributorId || item.optionId, 'Structured detail')}</code></li>;
}

function ExperienceMode({ entry }) {
  const mode = safeText(entry?.mode, 'CONVERSATION');
  const label = {
    RESEARCH_EXPEDITION: 'Research Expedition',
    IMPROVE_STEPHANOS: 'Improve Stephanos',
    SYSTEMS_EXPERT_MAP: 'Systems Expert Map',
  }[mode] || mode.replaceAll('_', ' ');
  return (
    <span
      className="status-chip"
      data-conversation-canvas-mode={mode}
      data-executable="false"
      aria-label={`${label}. Presentation only.`}
    >
      {label}
    </span>
  );
}

export default function ConversationCanvasCard({ view }) {
  if (!isConversationCanvasViewV1(view)) return null;

  const surface = safeText(view.surface);
  const state = safeText(view.state).toUpperCase();
  const summary = safeText(view.summary?.text);
  const sections = safeArray(view.sections, 16);
  const modes = safeArray(view.experienceModes, 8);
  const touchSurface = surface === 'ipad' || surface === 'iphone';
  const desktop = surface === 'desktop-browser';
  const reducedMotion = view.accessibility?.reducedMotion === true;
  const continuity = view.summary?.continuity && typeof view.summary.continuity === 'object'
    ? view.summary.continuity
    : null;

  const shellStyle = {
    border: '1px solid rgba(130, 195, 255, 0.32)',
    borderRadius: '12px',
    padding: touchSurface ? '1rem' : '0.9rem',
    background: 'linear-gradient(180deg, rgba(10, 25, 43, 0.78), rgba(4, 12, 24, 0.86))',
  };
  const sectionGridStyle = {
    display: 'grid',
    gridTemplateColumns: desktop ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)',
    gap: '0.65rem',
    marginTop: '0.75rem',
  };
  const detailsStyle = {
    minWidth: 0,
    border: '1px solid rgba(130, 195, 255, 0.18)',
    borderRadius: '10px',
    padding: '0.65rem 0.75rem',
    background: 'rgba(3, 12, 24, 0.5)',
  };
  const summaryStyle = {
    cursor: 'pointer',
    minHeight: touchSurface ? '44px' : 'auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.75rem',
  };

  return (
    <article
      className="conversation-canvas-card"
      data-testid="conversation-canvas-card"
      data-canvas-surface={surface}
      data-canvas-layout={safeText(view.layoutProfile?.layout, 'UNKNOWN')}
      data-canvas-state={state}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-action-authority="none"
      style={shellStyle}
    >
      <header>
        <div className={`api-banner ${state === 'READY' ? 'ready' : 'degraded'}`} role="status" aria-live="polite">
          <strong>Stephanos · {state}</strong>
          <span>{safeText(view.stateBanner?.label, 'Conversation state available.')}</span>
          {safeText(view.stateBanner?.detail) ? <span>{safeText(view.stateBanner.detail)}</span> : null}
        </div>
        {summary ? (
          <div data-testid="conversation-canvas-summary" style={{ marginTop: '0.75rem' }}>
            <strong>Answer</strong>
            <p className="assistant-answer-text" data-no-drag>{summary}</p>
          </div>
        ) : null}
        {continuity ? (
          <p className="muted" data-testid="conversation-canvas-continuity">
            Conversation: {safeText(continuity.roundId, 'unknown')} · Question: {safeText(continuity.questionId, 'unknown')}
          </p>
        ) : null}
        {modes.length ? (
          <div aria-label="Conversation experience modes" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {modes.map((entry, index) => <ExperienceMode key={`${safeText(entry?.mode, 'mode')}-${index}`} entry={entry} />)}
          </div>
        ) : null}
      </header>

      {sections.length ? (
        <div style={sectionGridStyle} data-testid="conversation-canvas-sections">
          {sections.map((section, sectionIndex) => {
            const id = safeText(section?.id, `section-${sectionIndex}`);
            const title = safeText(section?.title, 'Details');
            const kind = safeText(section?.kind, 'DETAIL');
            const items = safeArray(section?.items, 64);
            return (
              <details
                key={id}
                open={section?.expanded === true}
                data-canvas-section={id}
                data-section-kind={kind}
                style={detailsStyle}
              >
                <summary style={summaryStyle} aria-label={safeText(section?.ariaLabel, title)}>
                  <span>{title}</span>
                  <span className="muted">{Number.isFinite(section?.itemCount) ? section.itemCount : items.length}</span>
                </summary>
                {safeText(section?.summary) ? <p className="muted">{safeText(section.summary)}</p> : null}
                {items.length ? (
                  <ul className="compact-list">
                    {items.map((item, itemIndex) => (
                      <SectionItem key={`${id}-${itemIndex}`} item={item} kind={kind} index={itemIndex} />
                    ))}
                  </ul>
                ) : null}
              </details>
            );
          })}
        </div>
      ) : null}

      <footer className="muted" style={{ marginTop: '0.75rem' }}>
        Evidence and actions remain bounded by Stephanos truth and authority. This view cannot execute, approve, merge, deploy, select providers, or mutate runtime state.
      </footer>
    </article>
  );
}
