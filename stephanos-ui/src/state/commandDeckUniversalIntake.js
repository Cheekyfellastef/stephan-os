import { deriveEvidenceReturnIntakeProjection } from './evidenceReturnIntakeModel.js';

const ECHO_LIMIT = 360;
export const COMMAND_DECK_PROOF_ORDER = ['mission-console-bridge','build-proof','verify-proof','browser-proof-checklist','pr-evidence','source-pack-output'];
const PROOF_KINDS = new Set(COMMAND_DECK_PROOF_ORDER.filter((item) => item !== 'mission-console-bridge'));

const REPAIR_PROMPT = '/repair Reconcile Operator Proof Concierge proof-state contradiction: merge is hold, missing proof is none, and no next proof exists. Preserve proof safety, keep OpenClaw locked, keep Codex auto-dispatch disabled, and do not mark merge ready.';

function safetySummary() {
  return 'No commands were run, no proof was fabricated, Codex was not dispatched, OpenClaw remained locked, and merge readiness remains hold.';
}

export function buildMissionExecutiveVoice({ kind = 'proof-next-action', proofState = {}, evidenceProjection = null, acceptedProofItems = [], rejectedProofItems = [], cumulativeAcceptedProofItems = [] } = {}) {
  const accepted = orderProofItems(proofState.accepted || cumulativeAcceptedProofItems || acceptedProofItems);
  const remaining = orderProofItems(proofState.remaining || evidenceProjection?.remainingMissingProofItems || []);
  const next = proofState.next || remaining[0] || 'none';
  const lines = [];
  let nextMove = 'Review classified intake and take the next approved operator action.';
  if (kind === 'diagnostic-active-contradiction') {
    nextMove = 'Send a bounded Codex repair to reconcile Mission Proof Remaining Missing Items, Operator Cockpit Missing Proof, PR evidence, and source-pack-output.';
    lines.push('I reviewed the proof-state diagnostic packet.', '', 'The proof engine and merge gate disagree: merge is held, but no missing proof is listed. I am keeping merge locked.', '', 'Why it matters:', 'Until that state is reconciled, I cannot honestly choose the next proof packet or advance merge readiness.', '', 'Best next move:', nextMove, '', 'Prepared repair request:', REPAIR_PROMPT, '', 'Safety:', safetySummary());
  } else if (kind === 'diagnostic-stale') {
    nextMove = `Use Operator Proof Concierge to copy the ${next} packet, paste it here, and Execute.`;
    lines.push('I reviewed the proof-state diagnostic packet.', '', `The packet described a contradiction, but the live canonical state has a valid next move: ${next} is missing.`, '', 'Best next move:', nextMove, '', 'Prepared packet is available in Operator Proof Concierge.', '', 'Safety:', safetySummary());
  } else if (kind === 'proof-accepted') {
    const latest = orderProofItems(acceptedProofItems)[0] || 'proof';
    nextMove = next && next !== 'none' ? `Use Operator Proof Concierge to copy the ${next} packet.` : 'Review merge readiness only after canonical gates say ready.';
    lines.push(`I accepted ${latest} and kept merge locked.`, '', 'Mission progress:', `Accepted proof is now ${accepted.join('|') || latest}.`, `Next missing proof is ${next}.`, '', 'Best next move:', nextMove, '', 'Safety:', safetySummary());
  } else if (kind === 'proof-rejected') {
    const latest = orderProofItems(rejectedProofItems)[0] || evidenceProjection?.relatedEvidenceType || 'proof';
    const reason = evidenceProjection?.warnings?.[0] || evidenceProjection?.browserProofRejectionReason || 'the pasted return did not satisfy a canonical proof marker';
    nextMove = latest === 'browser-proof-checklist' ? 'Use the browser-proof checklist from Operator Proof Concierge and include the observed pass/fail details.' : `Use Operator Proof Concierge to copy the ${next} packet with explicit pass/fail details.`;
    lines.push(`I could not accept ${latest} because ${reason}.`, '', 'What stayed safe:', 'Previously accepted proof remains intact. Merge remains held. OpenClaw remains locked.', '', 'Best next move:', nextMove, '', 'Safety:', safetySummary());
  } else {
    nextMove = next && next !== 'none' ? `Use Operator Proof Concierge to copy the ${next} packet.` : 'Review canonical proof state before advancing merge readiness.';
    lines.push('I reviewed the Command Deck intake.', '', `Best next move: ${nextMove}`, '', 'Safety:', safetySummary());
  }
  return { available: true, responseGenerated: true, kind, nextMove, safetySummaryPresent: true, usesCanonicalState: true, mutationAllowed: false, text: lines.join('\n') };
}

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
function hasSuccess(text) { return /\b(pass(?:ed)?|success(?:ful(?:ly)?)?|completed successfully|completed manually|observed|exit code 0|code 0|green|clean|ok)\b/i.test(text); }
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
function canonicalAcceptedProofItems(evidenceContext = {}) {
  const reconciliation = evidenceContext.missionProofReconciliation || {};
  return orderProofItems(splitProofItems(reconciliation.acceptedItems || reconciliation.acceptedProof));
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
  const stale = /contradiction detected:/i.test(text) && !state.activeContradiction;
  const executiveVoice = buildMissionExecutiveVoice({ kind: state.activeContradiction ? 'diagnostic-active-contradiction' : 'diagnostic-stale', proofState: state });
  return {
    detected: true,
    kind: 'proof-state-diagnostic/operator-proof-concierge',
    routedTo: 'proof-state-review',
    responseGenerated: true,
    activeContradiction: state.activeContradiction ? 'yes' : 'no',
    nextAction: executiveVoice.nextMove,
    mutatedProofState: 'no',
    assistantResponse: executiveVoice.text,
    currentProofState: state,
    staleDiagnostic: stale ? 'yes' : 'no',
    debugPayload: {
      acceptedProof: state.accepted.join('|') || 'none',
      missingProof: state.remaining.join('|') || 'none',
      nextProof: state.next,
      mergeSafety: state.mergeSafety || 'no / hold',
      openClawMutationLocked: 'yes',
      codexAutoDispatchAllowed: 'no',
      mutationAllowed: 'no',
    },
    executiveVoice,
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
  if (/packet kind\s*[:=]\s*build-proof|proof item\s*[:=]\s*build-proof|npm run\s+stephanos:build|stephanos:build|\bbuild\b/i.test(text) && (hasSuccess(text) || hasFailure(text))) kinds.push('build-proof');
  if (/packet kind\s*[:=]\s*verify-proof|proof item\s*[:=]\s*verify-proof|npm run\s+stephanos:verify|stephanos:verify|\bverify\b/i.test(text) && (hasSuccess(text) || hasFailure(text))) kinds.push('verify-proof');
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
    previousAccepted: [
      ...canonicalAcceptedProofItems(evidenceContext),
      ...orderProofItems(evidenceContext.cumulativeAcceptedProofItems || evidenceContext.acceptedProofItems || []),
    ],
    previousRejected: evidenceContext.cumulativeRejectedProofItems || evidenceContext.rejectedProofItems || [],
    latestAccepted: evidenceReturnIntakeProjection?.acceptedProofItems || [],
    latestRejected: evidenceReturnIntakeProjection?.rejectedProofItems || [],
  });
  const executiveVoice = diagnosticProjection?.executiveVoice || (evidenceReturnIntakeProjection ? buildMissionExecutiveVoice({
    kind: (evidenceReturnIntakeProjection.acceptedProofItems || []).length ? 'proof-accepted' : ((evidenceReturnIntakeProjection.rejectedProofItems || []).length ? 'proof-rejected' : 'proof-next-action'),
    proofState: currentProofState({ ...evidenceContext, missionProofReconciliation: { ...(evidenceContext.missionProofReconciliation || {}), acceptedItems: cumulative.acceptedProofItems, remainingMissingItems: evidenceReturnIntakeProjection.remainingMissingProofItems || [] } }),
    evidenceProjection: evidenceReturnIntakeProjection,
    acceptedProofItems: evidenceReturnIntakeProjection.acceptedProofItems || [],
    rejectedProofItems: evidenceReturnIntakeProjection.rejectedProofItems || [],
    cumulativeAcceptedProofItems: cumulative.acceptedProofItems,
  }) : null);
  return {
    ...classification,
    routedTo: uniq(routedTo),
    acceptedProofItems: evidenceReturnIntakeProjection?.acceptedProofItems || [],
    rejectedProofItems: evidenceReturnIntakeProjection?.rejectedProofItems || [],
    cumulativeAcceptedProofItems: cumulative.acceptedProofItems,
    cumulativeRejectedProofItems: cumulative.rejectedProofItems,
    nextAction: executiveVoice?.nextMove || diagnosticProjection?.nextAction || evidenceReturnIntakeProjection?.recommendedNextAction || (classification.kinds.includes('direct-chat') ? 'Answer operator normally.' : 'Review classified intake and take the next approved operator action.'),
    evidenceReturnIntakeProjection,
    diagnosticProjection,
    executiveVoice,
    mergeReadinessChanged: 'no',
    mutationAllowed: false,
    codexAutoDispatchAllowed: false,
    openClawMutationLocked: true,
  };
}
