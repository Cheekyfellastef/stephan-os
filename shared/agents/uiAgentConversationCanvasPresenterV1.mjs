import { createHash } from 'node:crypto';

export const UI_AGENT_CONVERSATION_CANVAS_PRESENTER_SCHEMA_VERSION = 'stephanos.ui-agent.conversation-canvas-presenter.v1';
export const UI_AGENT_CONVERSATION_CANVAS_CONTRACT_SCHEMA_VERSION = 'stephanos.ui-agent.conversation-canvas-contract.v1';
export const UI_AGENT_CONVERSATION_CANVAS_RICH_RESPONSE_SCHEMA_VERSION = 'stephanos.rich-conversational-response.v1';

export const UI_AGENT_CONVERSATION_CANVAS_SURFACE_PROFILES = Object.freeze({
  'desktop-browser': Object.freeze({ layout: 'TWO_COLUMN_WITH_DETAIL_RAIL', density: 'COMPACT', touchTarget: 'STANDARD', sectionNavigation: 'STICKY' }),
  ipad: Object.freeze({ layout: 'TOUCH_STACK_WITH_DETAIL_DRAWER', density: 'COMPACT_TOUCH', touchTarget: 'LARGE', sectionNavigation: 'STICKY' }),
  iphone: Object.freeze({ layout: 'SINGLE_COLUMN_PROGRESSIVE', density: 'MOBILE_COMPACT', touchTarget: 'LARGE', sectionNavigation: 'INLINE' }),
});

const ALLOWED_STATES = new Set(['LOADING', 'PARTIAL', 'READY', 'ERROR', 'OFFLINE']);
const MAX_TEXT = 24_000;
const MAX_ITEMS = 32;
const SECRET_SHAPED_TEXT = /(?:BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY|xox[baprs]-|gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{20,}|(?:password|credential|api[_-]?key|private[_-]?key)\s*[:=])/i;

function text(value, maximum = MAX_TEXT) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return candidate && candidate.length <= maximum && !SECRET_SHAPED_TEXT.test(candidate) ? candidate : '';
}

function dataObject(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    return value;
  } catch {
    return null;
  }
}

function dataArray(value, limit = MAX_ITEMS) {
  if (!Array.isArray(value) || value.length > limit) return null;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) return null;
    return value;
  } catch {
    return null;
  }
}

function uniqueStrings(value, limit = MAX_ITEMS) {
  const array = dataArray(value, limit);
  if (!array) return Object.freeze([]);
  const out = [];
  for (const item of array) {
    const candidate = text(item, 512);
    if (candidate) out.push(candidate);
  }
  return Object.freeze([...new Set(out)]);
}

function cloneRefs(value) {
  return uniqueStrings(value, 64);
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function authorityBoundary() {
  return Object.freeze({
    sourceMutationAllowed: false,
    commandExecutionAllowed: false,
    approvalAuthorityAdded: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    providerSelectionAuthorityAdded: false,
    privateUiTruthAllowed: false,
    presenterMayExecuteActions: false,
    presenterMayHideEvidence: false,
  });
}

function invalid(errors) {
  return Object.freeze({
    schemaVersion: UI_AGENT_CONVERSATION_CANVAS_PRESENTER_SCHEMA_VERSION,
    valid: false,
    state: 'SAFE_HOLD',
    viewId: null,
    surface: null,
    layoutProfile: null,
    stateBanner: null,
    summary: null,
    sections: Object.freeze([]),
    sectionNavigation: Object.freeze([]),
    experienceModes: Object.freeze([]),
    accessibility: Object.freeze({ reducedMotion: true, colorOnlyStatusAllowed: false, evidenceKeyboardReachable: true }),
    authority: authorityBoundary(),
    errors: Object.freeze([...new Set(errors)]),
  });
}

function cloneClaims(value) {
  const array = dataArray(value);
  if (!array) return Object.freeze([]);
  const out = [];
  for (const item of array) {
    const record = dataObject(item);
    if (!record) continue;
    const claimId = text(record.claimId, 256);
    const claimText = text(record.text, 4000);
    const epistemicState = text(record.epistemicState, 128) || 'UNKNOWN';
    if (!claimId || !claimText) continue;
    out.push(Object.freeze({ claimId, text: claimText, epistemicState, evidenceRefs: cloneRefs(record.evidenceRefs) }));
  }
  return Object.freeze(out);
}

function cloneGoals(value) {
  const array = dataArray(value);
  if (!array) return Object.freeze([]);
  const out = [];
  for (const item of array) {
    const record = dataObject(item);
    if (!record) continue;
    const ref = text(record.ref, 256);
    if (!ref) continue;
    out.push(Object.freeze({ ref, label: text(record.label, 1000), state: text(record.state, 128) || 'UNKNOWN', evidenceRefs: cloneRefs(record.evidenceRefs) }));
  }
  return Object.freeze(out);
}

function cloneContributions(value) {
  const array = dataArray(value);
  if (!array) return Object.freeze([]);
  const out = [];
  for (const item of array) {
    const record = dataObject(item);
    if (!record) continue;
    const contributorId = text(record.contributorId, 256);
    if (!contributorId) continue;
    out.push(Object.freeze({ contributorId, contributionType: text(record.contributionType, 128) || 'EVIDENCE_SOURCE', summary: text(record.summary, 1600), evidenceRefs: cloneRefs(record.evidenceRefs) }));
  }
  return Object.freeze(out);
}

function cloneOptions(value) {
  const array = dataArray(value, 12);
  if (!array) return Object.freeze([]);
  const out = [];
  for (const item of array) {
    const record = dataObject(item);
    if (!record) continue;
    const optionId = text(record.optionId, 256);
    const label = text(record.label, 1000);
    if (!optionId || !label) continue;
    out.push(Object.freeze({ optionId, label, tradeoff: text(record.tradeoff, 2000), evidenceRefs: cloneRefs(record.evidenceRefs) }));
  }
  return Object.freeze(out);
}

function cloneRecommendedAction(value) {
  const record = dataObject(value);
  if (!record) return Object.freeze({ state: 'UNKNOWN', actionId: '', label: '', rationale: '', requiresApproval: 'UNKNOWN', evidenceRefs: Object.freeze([]), executable: false });
  return Object.freeze({
    state: text(record.state, 128) || 'UNKNOWN',
    actionId: text(record.actionId, 256),
    label: text(record.label, 1000),
    rationale: text(record.rationale, 2000),
    requiresApproval: ['YES', 'NO', 'UNKNOWN'].includes(text(record.requiresApproval, 32).toUpperCase()) ? text(record.requiresApproval, 32).toUpperCase() : 'UNKNOWN',
    evidenceRefs: cloneRefs(record.evidenceRefs),
    executable: false,
  });
}

function cloneApprovalState(value) {
  const record = dataObject(value);
  if (!record) return Object.freeze({ state: 'UNKNOWN', approvalRef: '', evidenceRefs: Object.freeze([]), interactiveApprovalAllowed: false });
  return Object.freeze({
    state: text(record.state, 128) || 'UNKNOWN',
    approvalRef: text(record.approvalRef, 256),
    evidenceRefs: cloneRefs(record.evidenceRefs),
    interactiveApprovalAllowed: false,
  });
}

function makeSection({ id, title, kind, summary, items = [], expanded = false, priority = 'SECONDARY' }) {
  const safeItems = Array.isArray(items) ? Object.freeze([...items]) : Object.freeze([]);
  return Object.freeze({
    id,
    title,
    kind,
    summary: text(summary, 1600),
    itemCount: safeItems.length,
    expanded: Boolean(expanded),
    items: safeItems,
    priority,
    ariaLabel: `${title}. ${safeItems.length} item${safeItems.length === 1 ? '' : 's'}. ${expanded ? 'Expanded' : 'Collapsed'}.`,
  });
}

function stateBanner(state, statusMessage) {
  const copy = Object.freeze({
    LOADING: 'Stephanos is assembling the answer and evidence.',
    PARTIAL: 'The answer is available but some evidence or detail is still incomplete.',
    READY: 'Answer and available evidence are ready.',
    ERROR: 'The conversation result could not be completed safely.',
    OFFLINE: 'Live conversation evidence is unavailable. Previously admitted truth must remain clearly distinguished.',
  });
  return Object.freeze({ state, label: copy[state], detail: text(statusMessage, 1000), colorOnlyStatusAllowed: false });
}

function detectExperienceModes(response, contributions, visualisationCandidates) {
  const modes = [];
  const candidates = new Set(visualisationCandidates.map((item) => item.toUpperCase()));
  const researchContribution = contributions.some((entry) => entry.contributionType.toUpperCase().includes('RESEARCH'));
  if (researchContribution || candidates.has('RESEARCH_EXPEDITION') || candidates.has('SPATIAL_RESEARCH_MAP')) {
    modes.push(Object.freeze({ mode: 'RESEARCH_EXPEDITION', presentation: 'SUMMARY_ROUTE_EVIDENCE_CONFLICTS', rawAgentTranscriptDefaultVisible: false, executable: false }));
  }
  const actionId = response ? text(response.recommendedAction?.actionId, 256).toLowerCase() : '';
  if (candidates.has('IMPROVE_STEPHANOS') || actionId.startsWith('improve:') || actionId.startsWith('improve-')) {
    modes.push(Object.freeze({ mode: 'IMPROVE_STEPHANOS', presentation: 'GAP_EVIDENCE_OWNER_OPTIONS_RISK_AUTHORITY_PROGRESS_PROOF', constructionExecutionOwnedHere: false, executable: false }));
  }
  if (candidates.has('SYSTEM_MAP') || candidates.has('PROVIDER_AGENT_MESH')) {
    modes.push(Object.freeze({ mode: 'SYSTEMS_EXPERT_MAP', presentation: 'ARCHITECTURE_PROVIDER_ROUTE_PROOF', executable: false }));
  }
  return Object.freeze(modes);
}

function buildReadySections(response, expandedSet) {
  const claims = cloneClaims(response.epistemicClaims);
  const evidenceRefs = cloneRefs(response.evidenceRefs);
  const goals = cloneGoals(response.goalsMissions);
  const contributions = cloneContributions(response.agentProviderContributions);
  const unknowns = uniqueStrings(response.unknowns, 32);
  const options = cloneOptions(response.options);
  const recommendedAction = cloneRecommendedAction(response.recommendedAction);
  const approvalState = cloneApprovalState(response.approvalState);
  const visualisationCandidates = uniqueStrings(response.visualisationCandidates, 16);

  const sections = [
    makeSection({ id: 'evidence', title: 'Evidence and confidence', kind: 'EVIDENCE_DISCLOSURE', summary: `${claims.length} claim${claims.length === 1 ? '' : 's'}, ${evidenceRefs.length} evidence reference${evidenceRefs.length === 1 ? '' : 's'}.`, items: [...claims, ...evidenceRefs.map((ref) => Object.freeze({ evidenceRef: ref }))], expanded: expandedSet.has('evidence') }),
    makeSection({ id: 'goals', title: 'Goals and missions', kind: 'GOAL_MISSION', summary: goals.length ? `${goals.length} related goal or mission records.` : 'No related goals were supplied in this answer.', items: goals, expanded: expandedSet.has('goals') }),
    makeSection({ id: 'contributors', title: 'Agents and providers', kind: 'PROVIDER_AGENT_CONTRIBUTION', summary: contributions.length ? `${contributions.length} evidence contribution records.` : 'No provider or agent contribution record was supplied.', items: contributions, expanded: expandedSet.has('contributors') }),
    makeSection({ id: 'unknowns', title: 'Unknowns and gaps', kind: 'UNKNOWN', summary: unknowns.length ? `${unknowns.length} unresolved item${unknowns.length === 1 ? '' : 's'}.` : 'No explicit unknowns were supplied.', items: unknowns, expanded: expandedSet.has('unknowns'), priority: unknowns.length ? 'PRIMARY' : 'SECONDARY' }),
    makeSection({ id: 'options', title: 'Options', kind: 'OPTION', summary: options.length ? `${options.length} bounded option${options.length === 1 ? '' : 's'} available for comparison.` : 'No alternatives were supplied.', items: options, expanded: expandedSet.has('options') }),
    makeSection({ id: 'action', title: 'Recommended action and approval', kind: 'RECOMMENDED_ACTION', summary: recommendedAction.label || 'No recommended action is currently established.', items: [recommendedAction, approvalState], expanded: expandedSet.has('action'), priority: recommendedAction.label ? 'PRIMARY' : 'SECONDARY' }),
    makeSection({ id: 'visuals', title: 'Useful views', kind: 'VISUALISATION', summary: visualisationCandidates.length ? `${visualisationCandidates.length} evidence-preserving view candidate${visualisationCandidates.length === 1 ? '' : 's'}.` : 'No additional visual view is required.', items: visualisationCandidates, expanded: expandedSet.has('visuals') }),
  ];

  return Object.freeze({ sections: Object.freeze(sections), contributions, visualisationCandidates });
}

export function buildUiAgentConversationCanvasPresenterV1(input = {}) {
  try {
    const packet = dataObject(input);
    const contract = dataObject(packet?.canvasContract);
    if (!packet || !contract) return invalid(['canvas-contract-required']);
    if (contract.schemaVersion !== UI_AGENT_CONVERSATION_CANVAS_CONTRACT_SCHEMA_VERSION || contract.valid !== true || contract.state !== 'CONVERSATION_CANVAS_CONTRACT_READY_FOR_BOUNDED_IMPLEMENTATION') {
      return invalid(['canvas-contract-not-ready']);
    }

    const surface = text(packet.surface, 64) || 'desktop-browser';
    const layoutProfile = UI_AGENT_CONVERSATION_CANVAS_SURFACE_PROFILES[surface];
    if (!layoutProfile) return invalid(['unsupported-surface']);

    const state = text(packet.state, 32).toUpperCase() || 'READY';
    if (!ALLOWED_STATES.has(state)) return invalid(['unsupported-state']);
    const expandedSet = new Set(uniqueStrings(packet.expandedSections, 16));
    const response = dataObject(packet.richResponse);
    if (['READY', 'PARTIAL'].includes(state)) {
      if (!response || response.schemaVersion !== UI_AGENT_CONVERSATION_CANVAS_RICH_RESPONSE_SCHEMA_VERSION || response.valid !== true) return invalid(['valid-rich-response-required']);
    }

    const directAnswer = response ? text(response.directAnswer) : '';
    if (response && !directAnswer) return invalid(['direct-answer-required']);
    const continuity = response ? dataObject(response.continuity) : null;
    const roundId = continuity ? text(continuity.roundId, 256) : '';
    const questionId = continuity ? text(continuity.questionId, 256) : '';
    if (response && (!roundId || !questionId)) return invalid(['continuity-required']);

    const ready = response ? buildReadySections(response, expandedSet) : Object.freeze({ sections: Object.freeze([]), contributions: Object.freeze([]), visualisationCandidates: Object.freeze([]) });
    const summary = Object.freeze({
      kind: 'DIRECT_ANSWER',
      text: directAnswer,
      continuity: response ? Object.freeze({ roundId, questionId, responseId: text(response.responseId, 256) }) : null,
      visibleByDefault: true,
      ariaLabel: directAnswer ? 'Stephanos direct answer' : 'Stephanos conversation status',
    });
    const experienceModes = response ? detectExperienceModes(response, ready.contributions, ready.visualisationCandidates) : Object.freeze([]);
    const reducedMotion = packet.prefersReducedMotion === true;
    const core = Object.freeze({
      schemaVersion: UI_AGENT_CONVERSATION_CANVAS_PRESENTER_SCHEMA_VERSION,
      state,
      surface,
      layoutProfile,
      stateBanner: stateBanner(state, packet.statusMessage),
      summary,
      sections: ready.sections,
      sectionNavigation: Object.freeze(ready.sections.map((section) => Object.freeze({ sectionId: section.id, label: section.title, priority: section.priority }))),
      experienceModes,
      progressiveDisclosure: Object.freeze({ summaryAlwaysVisible: true, evidenceCollapsedByDefault: !expandedSet.has('evidence'), rawAgentTranscriptDefaultVisible: false, phoneUsesSingleColumn: surface === 'iphone', ipadTouchFirst: surface === 'ipad' }),
      accessibility: Object.freeze({ reducedMotion, animationAllowed: !reducedMotion, colorOnlyStatusAllowed: false, evidenceKeyboardReachable: true, touchTargetsLarge: layoutProfile.touchTarget === 'LARGE' }),
      authority: authorityBoundary(),
    });

    return Object.freeze({
      ...core,
      valid: true,
      viewId: `conversation-canvas-view-${digest(core).slice(0, 24)}`,
      errors: Object.freeze([]),
    });
  } catch {
    return invalid(['conversation-canvas-presenter-failed-closed']);
  }
}
