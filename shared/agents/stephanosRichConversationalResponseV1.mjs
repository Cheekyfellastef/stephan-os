import { createHash } from 'node:crypto';

export const STEPHANOS_RICH_CONVERSATIONAL_RESPONSE_SCHEMA_VERSION = 'stephanos.rich-conversational-response.v1';

export const STEPHANOS_RICH_CONVERSATIONAL_RESPONSE_FIELDS = Object.freeze([
  'directAnswer',
  'epistemicClaims',
  'evidenceRefs',
  'goalsMissions',
  'agentProviderContributions',
  'unknowns',
  'options',
  'recommendedAction',
  'approvalState',
  'visualisationCandidates',
  'continuity',
]);

const MAX_TEXT = 24_000;
const SAFE_REF = /^[a-z0-9#][a-z0-9._:/#-]{0,255}$/i;
const SECRET_SHAPED_TEXT = /(?:BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY|xox[baprs]-|gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{20,}|(?:password|credential|api[_-]?key|private[_-]?key)\s*[:=])/i;
const ALLOWED_STRUCTURED_KEYS = new Set(['goalsMissions', 'agentProviderContributions', 'unknowns', 'options', 'recommendedAction', 'approvalState', 'visualisationCandidates']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function digest(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function safeText(value, maximum = MAX_TEXT) {
  const candidate = text(value);
  return candidate && candidate.length <= maximum && !SECRET_SHAPED_TEXT.test(candidate) ? candidate : '';
}

function uniqueStrings(value, limit = 32) {
  if (!Array.isArray(value)) return Object.freeze([]);
  const output = [];
  for (const item of value.slice(0, limit)) {
    const candidate = safeText(item, 512);
    if (candidate) output.push(candidate);
  }
  return Object.freeze([...new Set(output)]);
}

function safeRefs(value, limit = 64) {
  return Object.freeze(uniqueStrings(value, limit).filter((item) => SAFE_REF.test(item)));
}

function authorityBoundary() {
  return Object.freeze({
    sourceMutationAllowed: false,
    commandExecutionAllowed: false,
    approvalAuthorityAdded: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    providerSelectionAuthorityAdded: false,
    privateUiTruthAllowed: false,
  });
}

function visualisationCandidates(questionClass) {
  const byClass = Object.freeze({
    CURRENT_PROGRAMME_TRUTH: ['GOAL_STATUS_STACK', 'TIMELINE'],
    ARCHITECTURE_AND_RELATIONSHIPS: ['SYSTEM_MAP', 'PROVIDER_AGENT_MESH'],
    MEMORY_AND_CONTINUITY: ['CONTINUITY_TIMELINE', 'MEMORY_EVIDENCE_STACK'],
    AGENT_AND_TOOL_CAPABILITIES: ['PROVIDER_AGENT_MESH', 'CAPABILITY_MATRIX'],
    BLOCKERS_AND_PROOF: ['PROOF_STACK', 'BLOCKER_TIMELINE'],
    WHY_A_DECISION_WAS_MADE: ['DECISION_EVIDENCE_STACK'],
    WHAT_CHANGED_RECENTLY: ['TIMELINE', 'PROOF_STACK'],
    NEXT_BEST_ACTION: ['ACTION_CARD', 'APPROVAL_CARD'],
    CROSS_DOMAIN_CONNECTION: ['SYSTEM_MAP', 'SPATIAL_RESEARCH_MAP'],
    SELF_KNOWLEDGE_AND_UNKNOWNS: ['UNKNOWN_EVIDENCE_STACK', 'ACTION_CARD'],
  });
  return Object.freeze([...(byClass[text(questionClass)] || ['EVIDENCE_STACK'])]);
}

function boundedObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  return value;
}

function safeGoalsMissions(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  const output = [];
  for (const item of value.slice(0, 24)) {
    const record = boundedObject(item);
    if (!record) continue;
    const ref = safeText(record.ref, 256);
    const label = safeText(record.label, 512);
    const state = safeText(record.state, 128) || 'UNKNOWN';
    const evidenceRefs = safeRefs(record.evidenceRefs, 16);
    if (!ref || !SAFE_REF.test(ref)) continue;
    output.push(Object.freeze({ ref, label, state, evidenceRefs }));
  }
  return Object.freeze(output);
}

function safeContributions(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  const output = [];
  for (const item of value.slice(0, 24)) {
    const record = boundedObject(item);
    if (!record) continue;
    const contributorId = safeText(record.contributorId, 256);
    const contributionType = safeText(record.contributionType, 128) || 'EVIDENCE_SOURCE';
    const summary = safeText(record.summary, 1000);
    const evidenceRefs = safeRefs(record.evidenceRefs, 16);
    if (!contributorId || !SAFE_REF.test(contributorId)) continue;
    output.push(Object.freeze({ contributorId, contributionType, summary, evidenceRefs }));
  }
  return Object.freeze(output);
}

function safeOptions(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  const output = [];
  for (const item of value.slice(0, 12)) {
    const record = boundedObject(item);
    if (!record) continue;
    const optionId = safeText(record.optionId, 128);
    const label = safeText(record.label, 512);
    const tradeoff = safeText(record.tradeoff, 1200);
    const evidenceRefs = safeRefs(record.evidenceRefs, 16);
    if (!optionId || !SAFE_REF.test(optionId) || !label) continue;
    output.push(Object.freeze({ optionId, label, tradeoff, evidenceRefs }));
  }
  return Object.freeze(output);
}

function safeRecommendedAction(value) {
  const record = boundedObject(value);
  if (!record) return Object.freeze({ state: 'UNKNOWN', actionId: '', label: '', rationale: '', requiresApproval: 'UNKNOWN', evidenceRefs: Object.freeze([]) });
  const actionId = safeText(record.actionId, 128);
  const label = safeText(record.label, 1000);
  const rationale = safeText(record.rationale, 2000);
  const requiresApproval = ['YES', 'NO', 'UNKNOWN'].includes(text(record.requiresApproval).toUpperCase())
    ? text(record.requiresApproval).toUpperCase()
    : 'UNKNOWN';
  const evidenceRefs = safeRefs(record.evidenceRefs, 16);
  return Object.freeze({ state: label ? 'AVAILABLE' : 'UNKNOWN', actionId: SAFE_REF.test(actionId) ? actionId : '', label, rationale, requiresApproval, evidenceRefs });
}

function safeApprovalState(value) {
  const record = boundedObject(value);
  const state = record ? safeText(record.state, 128).toUpperCase() : '';
  const allowed = new Set(['NOT_REQUESTED', 'NOT_REQUIRED', 'REQUIRED', 'PENDING', 'APPROVED', 'REJECTED', 'UNKNOWN']);
  return Object.freeze({
    state: allowed.has(state) ? state : 'UNKNOWN',
    approvalRef: record && SAFE_REF.test(safeText(record.approvalRef, 256)) ? safeText(record.approvalRef, 256) : '',
    evidenceRefs: record ? safeRefs(record.evidenceRefs, 16) : Object.freeze([]),
    authorityAdded: false,
  });
}

function invalid(errors) {
  return Object.freeze({
    schemaVersion: STEPHANOS_RICH_CONVERSATIONAL_RESPONSE_SCHEMA_VERSION,
    valid: false,
    responseId: null,
    directAnswer: '',
    epistemicClaims: Object.freeze([]),
    evidenceRefs: Object.freeze([]),
    goalsMissions: Object.freeze([]),
    agentProviderContributions: Object.freeze([]),
    unknowns: Object.freeze([]),
    options: Object.freeze([]),
    recommendedAction: safeRecommendedAction(null),
    approvalState: safeApprovalState(null),
    visualisationCandidates: Object.freeze([]),
    continuity: null,
    authority: authorityBoundary(),
    errors: Object.freeze([...new Set(errors)]),
  });
}

export function buildStephanosRichConversationalResponseV1(input = {}) {
  try {
    const packet = boundedObject(input);
    if (!packet) return invalid(['input-must-be-data-only-object']);
    const question = boundedObject(packet.question);
    const answer = boundedObject(packet.answer);
    if (!question || !answer) return invalid(['question-and-answer-required']);
    const directAnswer = safeText(answer.answerText);
    if (!directAnswer) return invalid(['direct-answer-invalid']);
    const questionId = safeText(question.questionId, 128);
    const roundId = safeText(question.roundId, 128);
    if (!SAFE_REF.test(questionId) || !SAFE_REF.test(roundId)) return invalid(['continuity-identity-invalid']);
    const evidenceRefs = safeRefs(answer.evidenceRefs, 64);
    const epistemicState = safeText(answer.epistemicState, 128) || 'UNKNOWN';
    const verdict = safeText(answer.answerVerdict, 128) || 'ANSWERED_PARTIAL';
    const claim = Object.freeze({
      claimId: `claim-${digest(`${roundId}:${questionId}:${directAnswer}`).slice(0, 20)}`,
      text: directAnswer,
      epistemicState,
      evidenceRefs,
    });
    const structured = packet.structured === undefined ? Object.create(null) : boundedObject(packet.structured);
    if (!structured) return invalid(['structured-extension-must-be-data-only-object']);
    for (const key of Object.keys(structured)) if (!ALLOWED_STRUCTURED_KEYS.has(key)) return invalid([`structured-extension-unknown-field:${key}`]);

    const sources = uniqueStrings(answer.sourcesConsulted, 24);
    const derivedContributions = sources.map((source) => Object.freeze({
      contributorId: SAFE_REF.test(source) ? source : `evidence-source:${digest(source).slice(0, 16)}`,
      contributionType: 'EVIDENCE_SOURCE',
      summary: '',
      evidenceRefs,
    }));
    const suppliedContributions = safeContributions(structured.agentProviderContributions);
    const unknowns = [...uniqueStrings(structured.unknowns, 32)];
    const cannotAnswerReason = safeText(answer.cannotAnswerReason, 2000);
    if (cannotAnswerReason) unknowns.push(cannotAnswerReason);
    if (verdict === 'ANSWERED_PARTIAL' && unknowns.length === 0) unknowns.push('Some answer elements are not independently grounded by the current evidence set.');

    const candidateOverride = uniqueStrings(structured.visualisationCandidates, 16);
    const candidates = candidateOverride.length > 0 ? candidateOverride : visualisationCandidates(question.questionClass);
    const core = Object.freeze({
      schemaVersion: STEPHANOS_RICH_CONVERSATIONAL_RESPONSE_SCHEMA_VERSION,
      directAnswer,
      epistemicClaims: Object.freeze([claim]),
      evidenceRefs,
      goalsMissions: safeGoalsMissions(structured.goalsMissions),
      agentProviderContributions: suppliedContributions.length > 0 ? suppliedContributions : Object.freeze(derivedContributions),
      unknowns: Object.freeze([...new Set(unknowns)]),
      options: safeOptions(structured.options),
      recommendedAction: safeRecommendedAction(structured.recommendedAction),
      approvalState: safeApprovalState(structured.approvalState),
      visualisationCandidates: Object.freeze([...new Set(candidates)]),
      continuity: Object.freeze({ roundId, questionId }),
      authority: authorityBoundary(),
    });
    return Object.freeze({
      ...core,
      valid: true,
      responseId: `rich-response-${digest(JSON.stringify(core)).slice(0, 24)}`,
      errors: Object.freeze([]),
    });
  } catch {
    return invalid(['rich-response-build-failed-closed']);
  }
}
