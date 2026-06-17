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
  const latestAcceptedSet = new Set(orderProofItems(latestAccepted));
  const rejected = orderProofItems([...orderProofItems(previousRejected), ...orderProofItems(latestRejected)])
    .filter((item) => !latestAcceptedSet.has(item));
  return { acceptedProofItems: accepted, rejectedProofItems: rejected };
}
function hasSuccess(text) { return /\b(pass(?:ed)?|success(?:ful(?:ly)?)?|completed successfully|exit code 0|code 0|green|clean|ok)\b/i.test(text); }
function hasFailure(text) { return /\b(fail(?:ed|ure)?|error|exit code [1-9]|exited with code [1-9]|red console|blocked|timeout)\b/i.test(text.replace(/no red console errors?/ig, 'console-clean').replace(/no errors?/ig, 'clean')); }

export function classifyCommandDeckUniversalIntake(inputText = '') {
  const text = textOf(inputText);
  if (!text) return { status: 'idle', kinds: ['unknown/noise'], lastKind: 'unknown/noise', confidence: 'low', echo: '', echoLength: 0 };
  const lower = text.toLowerCase();
  const kinds = [];

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
  const proofKinds = classification.kinds.filter((kind) => PROOF_KINDS.has(kind));
  const routedTo = [];
  let evidenceReturnIntakeProjection = null;
  if (proofKinds.length || classification.kinds.includes('codex-result')) {
    routedTo.push('evidence-return-intake', 'evidence-intake-automation');
    evidenceReturnIntakeProjection = deriveEvidenceReturnIntakeProjection({ ...evidenceContext, operatorPastedIntakeText: text });
  }
  if (classification.kinds.includes('operator-intent') || classification.kinds.includes('repair-request')) routedTo.push('mission-intent-draft');
  if (classification.kinds.includes('source-pack-output')) routedTo.push('packet-bay-source-pack-intake');
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
    nextAction: evidenceReturnIntakeProjection?.recommendedNextAction || (classification.kinds.includes('direct-chat') ? 'Answer operator normally.' : 'Review classified intake and take the next approved operator action.'),
    evidenceReturnIntakeProjection,
    mergeReadinessChanged: 'no',
    mutationAllowed: false,
    codexAutoDispatchAllowed: false,
    openClawMutationLocked: true,
  };
}
