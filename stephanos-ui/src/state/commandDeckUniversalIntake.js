import { deriveEvidenceReturnIntakeProjection } from './evidenceReturnIntakeModel.js';

const ECHO_LIMIT = 360;
export const COMMAND_DECK_PROOF_ORDER = ['mission-console-bridge','build-proof','verify-proof','browser-proof-checklist','pr-evidence','source-pack-output'];
const PROOF_KINDS = new Set(COMMAND_DECK_PROOF_ORDER.filter((item) => item !== 'mission-console-bridge'));

function textOf(value) { return String(value ?? '').trim(); }
function boundedEcho(text) { const value = textOf(text); return value.length > ECHO_LIMIT ? `${value.slice(0, ECHO_LIMIT)}…` : value; }
function uniq(items) { return Array.from(new Set(items.filter(Boolean))); }
export function orderProofItems(items = []) {
  const values = uniq((Array.isArray(items) ? items : String(items || '').split('|')).map(textOf).filter((item) => item && item !== 'none'));
  const known = COMMAND_DECK_PROOF_ORDER.filter((item) => values.includes(item));
  const extra = values.filter((item) => !COMMAND_DECK_PROOF_ORDER.includes(item)).sort();
  return [...known, ...extra];
}
export function mergeProofSession({ previousAccepted = [], previousRejected = [], latestAccepted = [], latestRejected = [] } = {}) {
  const accepted = orderProofItems([...orderProofItems(previousAccepted), ...orderProofItems(latestAccepted)]);
  const acceptedSet = new Set(accepted);
  const rejected = orderProofItems([...orderProofItems(previousRejected), ...orderProofItems(latestRejected)])
    .filter((item) => !acceptedSet.has(item));
  return { acceptedProofItems: accepted, rejectedProofItems: rejected };
}
function hasSuccess(text) { return /\b(pass(?:ed)?|success(?:ful(?:ly)?)?|completed successfully|exit code 0|code 0|green|clean|ok)\b/i.test(text); }
function hasFailure(text) { return /\b(fail(?:ed|ure)?|error|exit code [1-9]|exited with code [1-9]|red console|blocked|timeout)\b/i.test(text.replace(/no red console errors?/ig, 'console-clean').replace(/no errors?/ig, 'clean')); }
function detectOperatorProofConciergeDiagnostic(inputText = '') {
  const text = textOf(inputText);
  if (!text) return false;
  return /proof-state diagnostic packet\./i.test(text)
    || /contradiction detected:/i.test(text)
    || /operator diagnostic checklist:/i.test(text)
    || /merge is hold but missing proof is none/i.test(text)
    || /packet kind\s*[:=]\s*proof-state-diagnostic/i.test(text)
    || /packetKind\s*[:=]\s*proof-state-diagnostic/i.test(text);
}
function splitProofItems(value) {
  return (Array.isArray(value) ? value : String(value || '').split(/[|,]/)).map(textOf).filter((item) => item && item !== 'none');
}
function mergeSafetyIsHold(value) {
  const lower = textOf(value).toLowerCase();
  return lower.includes('hold') || lower === 'no' || lower.includes('no /');
}
function currentProofState(evidenceContext = {}) {
  const reconciliation = evidenceContext.missionProofReconciliation || {};
  const accepted = orderProofItems(splitProofItems(reconciliation.acceptedItems || reconciliation.acceptedProof || evidenceContext.cumulativeAcceptedProofItems || evidenceContext.acceptedProofItems));
  const remaining = orderProofItems(splitProofItems(reconciliation.remainingMissingItems || reconciliation.missingProof || evidenceContext.missionEvidenceContextSummary?.missingProofSummary || evidenceContext.missionEvidenceLedgerProjection?.missingProofSummary));
  const next = COMMAND_DECK_PROOF_ORDER.find((item) => item !== 'mission-console-bridge' && remaining.includes(item)) || remaining[0] || 'none';
  const mergeSafety = textOf(evidenceContext.mergeSafety || reconciliation.mergeSafety || evidenceContext.missionEvidenceLedgerProjection?.mergeSafety || 'no / hold');
  const activeContradiction = mergeSafetyIsHold(mergeSafety) && remaining.length === 0 && next === 'none';
  return { accepted: accepted.length ? accepted : ['mission-console-bridge'], remaining, next, mergeSafety, activeContradiction };
}
export function buildProofStateDiagnosticResponse({ text = '', evidenceContext = {} } = {}) {
  const state = currentProofState(evidenceContext);
  const missing = state.remaining.join('|') || 'none';
  const accepted = state.accepted.join('|') || 'none';
  const stale = /contradiction detected:/i.test(text) && !state.activeContradiction;
  const lines = [
    'Stephanos reviewed the proof-state diagnostic packet.',
    '',
    'Current canonical proof state:',
    `- Accepted proof: ${accepted}`,
    `- Missing proof: ${missing}`,
    `- Merge safety: ${state.mergeSafety || 'no / hold'}`,
    '- OpenClaw mutation: locked',
    '- Codex auto-dispatch: disabled',
    '',
    'Interpretation:',
  ];
  if (state.activeContradiction) {
    lines.push('An active contradiction exists: merge safety is hold, missing proof is none, and no next proof exists. This needs a repair/diagnostic Codex packet before merge readiness can move. Merge remains hold.');
    lines.push('', 'Copyable repair prompt:', '/repair Reconcile Operator Proof Concierge proof-state contradiction: merge is hold, missing proof is none, and no next proof exists. Preserve proof safety, keep OpenClaw locked, keep Codex auto-dispatch disabled, and do not mark merge ready.');
  } else {
    lines.push(stale ? 'The diagnostic packet described a contradiction, but current canonical proof state is not contradictory.' : 'There is no active contradiction now.');
    lines.push(`The live canonical proof state says the next missing item is ${state.next}.`);
  }
  lines.push('', 'Safety:', 'No commands were run, no proof was fabricated, Codex was not dispatched, OpenClaw remained locked, and merge readiness remains hold.', '', `Next operator action: ${state.activeContradiction ? 'Copy the repair prompt above into Command Deck for a bounded repair request.' : `Use Operator Proof Concierge to copy the ${state.next} packet, paste it here, and press Execute.`}`);
  return {
    detected: true, kind: 'proof-state-diagnostic/operator-proof-concierge', routedTo: 'proof-state-review', responseGenerated: true, activeContradiction: state.activeContradiction ? 'yes' : 'no', nextAction: state.activeContradiction ? 'Copy repair prompt for bounded diagnostic repair.' : `Copy ${state.next} packet from Operator Proof Concierge.`, mutatedProofState: 'no', assistantResponse: lines.join('\n'), currentProofState: state,
  };
}

export function classifyCommandDeckUniversalIntake(inputText = '') {
  const text = textOf(inputText);
  if (!text) return { status: 'idle', kinds: ['unknown/noise'], lastKind: 'unknown/noise', confidence: 'low', echo: '', echoLength: 0 };
  const lower = text.toLowerCase();
  const kinds = [];

  if (detectOperatorProofConciergeDiagnostic(text)) {
    return { status: 'classified', kinds: ['operator-proof-concierge-diagnostic', 'proof-state-review', 'operator-guidance', 'operator-hold'], lastKind: 'operator-proof-concierge-diagnostic', confidence: 'high', echo: boundedEcho(text), echoLength: text.length };
  }

  if (/^\s*\/(mission|intent|repair|approve|hold)\b/i.test(text)) {
    if (/^\s*\/(mission|intent)\b/i.test(text)) kinds.push('operator-intent');
    if (/^\s*\/repair\b/i.test(text)) kinds.push('repair-request');
    if (/^\s*\/approve\b/i.test(text)) kinds.push('operator-approval');
    if (/^\s*\/hold\b/i.test(text)) kinds.push('operator-hold');
  }

  if (/codex|changed files|summary|testing|git status|npm run|node --test|implementation/i.test(text) && /(summary|testing|changed files|npm run|node --test|build|verify|proof)/i.test(text)) kinds.push('codex-result');
  if (/local ai|read-only review|local model|ollama review/i.test(text)) kinds.push('local-ai-result');
  if (/openclaw|source[_ -]?pack|stephanos_handoff_packet|useful_facts/i.test(text)) kinds.push(/openclaw/i.test(text) ? 'openclaw-result' : 'source-pack-output');
  if (/npm run\s+stephanos:build|stephanos:build|\bbuild\b/i.test(text) && (hasSuccess(text) || hasFailure(text))) kinds.push('build-proof');
  if (/npm run\s+stephanos:verify|stephanos:verify|\bverify\b/i.test(text) && (hasSuccess(text) || hasFailure(text))) kinds.push('verify-proof');
  if (/browser proof|browser checklist|browser-proof-checklist|ui reality|command deck visible|console errors?|red console/i.test(text)) kinds.push('browser-proof-checklist');
  if (/pr evidence|pull request|\bpr\s*#?\d+|github\.com\/[^\s]+\/pull\/\d+|commit\s+[a-f0-9]{7,40}|checks?:\s*(pass|success|green|fail)/i.test(text)) kinds.push('pr-evidence');
  if (/source[_ -]?pack|source pack|source-bounded|source bounded|stephanos_handoff_packet|useful_facts|useful facts/i.test(text)) kinds.push('source-pack-output');

  if (/\b(approve|approved|approval granted|go ahead|ship it)\b/i.test(text)) kinds.push('operator-approval');
  if (/\b(hold|do not merge|don't merge|stop|pause|not approved)\b/i.test(text)) kinds.push('operator-hold');
  if (/\b(repair|fix|regression|broken|failing)\b/i.test(text) && !kinds.some((k) => PROOF_KINDS.has(k))) kinds.push('repair-request');
  if (/\b(mission|goal|intent|objective|build a|implement|desired operator behavior)\b/i.test(text) && !kinds.some((k) => PROOF_KINDS.has(k)) && !kinds.includes('codex-result')) kinds.push('operator-intent');

  const finalKinds = uniq(kinds.length ? kinds : (/[?]$|^(what|why|how|can|should|is|are)\b/i.test(text) ? ['direct-chat'] : ['direct-chat']));
  const proofKindCount = finalKinds.filter((k) => PROOF_KINDS.has(k)).length;
  return { status: 'classified', kinds: finalKinds, lastKind: finalKinds[0] || 'unknown/noise', confidence: proofKindCount || finalKinds.includes('operator-intent') ? 'high' : 'medium', echo: boundedEcho(text), echoLength: text.length };
}

export function routeCommandDeckUniversalIntake({ text = '', evidenceContext = {} } = {}) {
  const classification = classifyCommandDeckUniversalIntake(text);
  const diagnosticProjection = classification.kinds.includes('operator-proof-concierge-diagnostic') ? buildProofStateDiagnosticResponse({ text, evidenceContext }) : null;
  const proofKinds = diagnosticProjection ? [] : classification.kinds.filter((kind) => PROOF_KINDS.has(kind));
  const routedTo = [];
  let evidenceReturnIntakeProjection = null;
  if (proofKinds.length || classification.kinds.includes('codex-result')) {
    routedTo.push('evidence-return-intake', 'evidence-intake-automation');
    evidenceReturnIntakeProjection = deriveEvidenceReturnIntakeProjection({ ...evidenceContext, operatorPastedIntakeText: text });
  }
  if (classification.kinds.includes('operator-intent') || classification.kinds.includes('repair-request')) routedTo.push('mission-intent-draft');
  if (classification.kinds.includes('source-pack-output')) routedTo.push('packet-bay-source-pack-intake');
  if (diagnosticProjection) routedTo.push('proof-state-review');
  if (classification.kinds.includes('operator-approval') || classification.kinds.includes('operator-hold')) routedTo.push('operator-decision-queue');
  if (!routedTo.length) routedTo.push('assistant-direct-chat');
  const cumulative = mergeProofSession({
    previousAccepted: evidenceContext.cumulativeAcceptedProofItems || evidenceContext.acceptedProofItems || [],
    previousRejected: evidenceContext.cumulativeRejectedProofItems || evidenceContext.rejectedProofItems || [],
    latestAccepted: evidenceReturnIntakeProjection?.acceptedProofItems || [],
    latestRejected: evidenceReturnIntakeProjection?.rejectedProofItems || [],
  });
  return {
    ...classification,
    routedTo: uniq(routedTo),
    acceptedProofItems: evidenceReturnIntakeProjection?.acceptedProofItems || [],
    rejectedProofItems: evidenceReturnIntakeProjection?.rejectedProofItems || [],
    cumulativeAcceptedProofItems: cumulative.acceptedProofItems,
    cumulativeRejectedProofItems: cumulative.rejectedProofItems,
    nextAction: diagnosticProjection?.nextAction || evidenceReturnIntakeProjection?.recommendedNextAction || (classification.kinds.includes('direct-chat') ? 'Answer operator normally.' : 'Review classified intake and take the next approved operator action.'),
    evidenceReturnIntakeProjection,
    diagnosticProjection,
    mergeReadinessChanged: 'no',
    mutationAllowed: false,
    codexAutoDispatchAllowed: false,
    openClawMutationLocked: true,
  };
}
