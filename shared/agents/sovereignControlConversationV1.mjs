import { projectSovereignControlSystemStatusV1, sovereignControlSystemDiagnosticCodeV1 } from './sovereignControlSystemStatusV1.mjs';
import { controlTowerObservationBlockerV1, controlTowerBuildObservationUnresolvedV1 } from './controlTowerRequestObservationV1.mjs';

export const SOVEREIGN_CONTROL_CONVERSATION_SCHEMA = 'stephanos.sovereign-control-conversation.v1';
export const CONTROL_TOWER_WORKFLOW_URL = 'https://github.com/Cheekyfellastef/stephan-os/actions/workflows/stephanos-control-tower-build.yml';
const TARGETS = new Set(['sovereign-commander', 'control-tower']);
const SHA = /^[a-f0-9]{40}$/;
const REQUEST = /^control-tower-build-([1-9][0-9]{0,15})-1$/;
const CODE = /^[A-Z][A-Z0-9_:-]{0,159}$/;
const STATES = new Set(['WAITING', 'HELD', 'REPLAY_HELD', 'UNKNOWN', 'RESERVED', 'WAKE_BLOCKED', 'WAKE_COMPLETED', 'OBSERVATION_COMPLETED', 'OBSERVATION_BLOCKED', 'UNPROVEN']);
const GUARDIAN_STATES = new Set(['WORKING', 'WAITING', 'HELD', 'DISABLED', 'NO_NEXT_CYCLE', 'UNKNOWN']);
const INTENTS = new Set(['STATUS', 'CAPABILITIES', 'OBSERVE_CONTROL_SYSTEM', 'BUILD_NEXT_ELIGIBLE_GOAL', 'UNSUPPORTED_OPERATION', 'INPUT_TOO_LONG']);
const HEALTH_CODES = new Set(['COMMANDER_HEALTH_UNVERIFIED', 'COMMANDER_HEALTH_IDENTITY_MISMATCH',
  'COMMANDER_HEALTH_TIMESTAMP_NOT_CURRENT', 'COMMANDER_HEALTH_NOT_READY', 'COMMANDER_HEALTH_HTTP_NOT_READY',
  'COMMANDER_HEALTH_RESPONSE_TOO_LARGE', 'COMMANDER_HEALTH_UNREACHABLE']);
const TOPIC = /\b(?:sovereign commander|control tower|control-tower|sovereign(?=\s*[:,!?]|\s+(?:status|health|repair|fix|restore|resume|build|inspect|observe|diagnos\w*|help|meter|quota)\b))\b/i;
const OPERATIONAL = /\b(?:status|health|working|running|awake|blocked|stopped|progress|latest|receipt|result|history|why|repair|fix|restore|resume|build|start|observe|inspect|diagnos\w*|check|capabilit\w*|help|what can|talk|meter|quota|model)\b/i;
const UNSUPPORTED = /\b(?:powershell|cmd\.exe|arbitrary shell|run shell|force[- ]?kill|force[- ]?push|reboot|shutdown|shut down|delete all|disable (?:custody|guard|approval)|bypass (?:custody|guard|approval)|install (?:a |the )?(?:driver|runtime|helper))\b/i;
const EXPLANATORY = /\b(?:explain|describe|how does|how do|how would|what can|what is|what are|can you talk|can we talk|do not|don't|never)\b/i;
const STATUS_QUESTION = /\b(?:status|health|working|running|awake|blocked|stopped|progress|latest|receipt|result|history|why|when|last|previous)\b/i;
const REPAIR_REQUEST = /^(?:(?:please|can you|could you|would you|will you|help me|prepare|request|run)\s+)*(?:repair|fix|restore|resume|build|start building|keep building)\b/i;
const OBSERVE_REQUEST = /^(?:(?:please|can you|could you|would you|will you|prepare|request|run)\s+)*(?:inspect|diagnos\w*|observe|(?:a )?check|check (?:the )?(?:native|control|system))\b/i;

const text = (value, max = 160) => typeof value === 'string' && value.length <= max ? value.trim() : '';
const code = value => typeof value === 'string' && CODE.test(value) ? value : '';
const timestamp = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '';
const bool = value => typeof value === 'boolean' ? value : null;
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000 ? value : null;
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

// Intent selects an observation or an inert handoff, never execution authority.
// A sidebar target is presentation context and is not an authenticated principal.
export function classifySovereignControlConversationV1(input = {}) {
  const requestedTargetId = text(input.requestedTargetId, 64).toLowerCase() || 'everyone';
  const direct = TARGETS.has(requestedTargetId);
  const prefix = typeof input.prompt === 'string' ? input.prompt.slice(0, 6000).trim() : '';
  const slash = /^\/(?:sovereign|control-tower|controltower)(?:\s|$)/i.test(prefix);
  const addressed = direct || slash || (requestedTargetId === 'everyone' && TOPIC.test(prefix) && OPERATIONAL.test(prefix));
  // A pasted diagnostic must never fall through into a metered model merely
  // because its body exceeds this bounded control grammar.
  if (addressed && typeof input.prompt === 'string' && input.prompt.length > 6000)
    return freeze({ applies: true, requestedTargetId, intent: 'INPUT_TOO_LONG' });
  const prompt = text(input.prompt, 6000);
  // Preserve the existing exact /sovereign health-tool acceptance contract.
  if (!prompt || /^\/sovereign\s*$/i.test(prompt)) return freeze({ applies: false, requestedTargetId, intent: null });
  const applies = addressed;
  if (!applies) return freeze({ applies: false, requestedTargetId, intent: null });
  const command = prompt.replace(/^\/(?:sovereign|control-tower|controltower)\s*/i, '')
    .replace(/^(?:(?:hey|hi)\s+)?(?:sovereign(?: commander)?|control[ -]tower)\s*[:,]?\s*/i, '').trim();
  let intent = 'CAPABILITIES';
  if (UNSUPPORTED.test(prompt)) intent = 'UNSUPPORTED_OPERATION';
  else if (STATUS_QUESTION.test(prompt)) intent = 'STATUS';
  else if (!EXPLANATORY.test(prompt) && REPAIR_REQUEST.test(command)) intent = 'BUILD_NEXT_ELIGIBLE_GOAL';
  else if (!EXPLANATORY.test(prompt) && OBSERVE_REQUEST.test(command)) intent = 'OBSERVE_CONTROL_SYSTEM';
  return freeze({ applies: true, requestedTargetId, intent });
}

function compactCommander(value, nowMs) {
  const at = timestamp(value?.observedAtUtc);
  const current = at && Date.parse(at) <= nowMs + 5000 && nowMs - Date.parse(at) <= 60000;
  const observed = value?.schemaVersion === 'stephanos.ai-sovereign-commander-health.v1'
    && value.available === true && value.readOnly === true && value.localLoopbackOnly === true
    && value.commanderMcpAccessGranted === false && value.sourceMutationAllowed === false
    && current && typeof value.healthy === 'boolean';
  const g = observed && value.guardian && typeof value.guardian === 'object' ? value.guardian : null;
  return {
    observed: Boolean(observed), reachable: observed ? true : null, healthy: observed ? value.healthy : null,
    observedAtUtc: observed ? at : '',
    blocker: observed && value.blocker === '' ? '' : HEALTH_CODES.has(value?.blocker) ? value.blocker : 'COMMANDER_HEALTH_UNVERIFIED',
    guardian: g ? {
      state: GUARDIAN_STATES.has(g.operationalState) ? g.operationalState : 'UNKNOWN',
      enabled: bool(g.enabled), running: bool(g.running), scheduled: bool(g.scheduled),
      maintenanceInFlight: bool(g.maintenanceInFlight), custodyHeld: bool(g.custodyHeld), timeoutCustodyHeld: bool(g.timeoutCustodyHeld),
      cycleCount: count(g.cycleCount), lastBlocker: sovereignControlSystemDiagnosticCodeV1(g.lastBlocker),
      lastCompletedAtUtc: timestamp(g.lastCompletedAtUtc), lastOk: bool(g.lastOk),
      lastSourceHead: typeof g.lastSourceHead === 'string' && SHA.test(g.lastSourceHead) ? g.lastSourceHead : '',
    } : null,
  };
}

function compactRequest(value, outcomeUnresolved = null) {
  const requestId = text(value?.requestId, 80);
  const matched = REQUEST.exec(requestId);
  if (!matched || !Number.isSafeInteger(value?.runId) || value.runId !== Number(matched[1])
    || !STATES.has(value?.state)) return null;
  return {
    requestId, runId: value.runId, state: value.state, blocker: value.blocker === '' ? '' : controlTowerObservationBlockerV1(value.blocker),
    operation: ['OBSERVE_CONTROL_SYSTEM', 'BUILD_NEXT_ELIGIBLE_GOAL'].includes(value.operation) ? value.operation : '',
    observedAtUtc: timestamp(value.observedAtUtc), acceptedAtUtc: timestamp(value.acceptedAtUtc),
    sourceHead: typeof value.sourceHead === 'string' && SHA.test(value.sourceHead) ? value.sourceHead : '',
    historical: value.historical === true, diagnosticOnly: true,
    exactHeadMatch: value.exactHeadMatch === true,
    evidenceState: code(value.evidenceState),
    ledgerPhase: ['RESERVED', 'TERMINAL', 'RETIRED'].includes(value.ledgerPhase) ? value.ledgerPhase : '',
    terminalState: ['DONE', 'BLOCKED'].includes(value.terminalState) ? value.terminalState : '',
    detailState: ['OBSERVED', 'LEGACY_DETAIL_UNAVAILABLE', 'INVALID'].includes(value.detailState) ? value.detailState : '',
    outcomeUnresolved,
  };
}

function compactTower(value, nowMs) {
  const valid = value?.schemaVersion === 'stephanos.control-tower-build-beacon-facts.v1'
    && value.sourceMutationAllowed === false && value.mergeAuthority === false && value.leaseSeizureAllowed === false;
  const observed = valid && value.observed === true;
  const latestBuild = valid && value.latestBuildRequestObservation?.historical === true
    && value.latestBuildRequestObservation?.diagnosticOnly === true
    ? compactRequest(value.latestBuildRequestObservation,
        controlTowerBuildObservationUnresolvedV1(value.latestBuildRequestObservation, { nowMs })) : null;
  const latest = valid && value.latestRequestObservation?.historical === true
    && value.latestRequestObservation?.diagnosticOnly === true
    ? latestBuild?.requestId === value.latestRequestObservation.requestId
      ? latestBuild : compactRequest(value.latestRequestObservation) : null;
  const latestControl = valid && value.latestControlSystemObservation?.historical === true
    && value.latestControlSystemObservation?.diagnosticOnly === true ? compactRequest(value.latestControlSystemObservation) : null;
  const current = observed ? compactRequest(value) : null;
  return {
    observed, state: valid && STATES.has(value.state) ? value.state : 'UNPROVEN',
    blocker: valid ? value.blocker === '' ? '' : controlTowerObservationBlockerV1(value.blocker) : 'CONTROL_TOWER_BUILD_RECEIPT_UNPROVEN',
    observedAtUtc: observed ? timestamp(value.observedAtUtc) : '', exactHeadMatch: observed && value.exactHeadMatch === true,
    currentRequest: current, latestRequestObservation: latest,
    latestBuildRequestObservation: latestBuild, latestControlSystemObservation: latestControl,
    controlSystemStatus: valid && value.controlSystemStatus
      ? projectSovereignControlSystemStatusV1(value.controlSystemStatus) : null,
  };
}

function guardianSentence(commander) {
  if (!commander.observed) return 'Commander health is unverified' + (commander.blocker ? ' (' + commander.blocker + ')' : '') + '.';
  if (!commander.healthy) return 'Commander is reachable but reports degraded service health.';
  const descriptions = {
    WORKING: 'its existing owner reports work in progress',
    WAITING: 'its repair loop has a next cycle scheduled',
    HELD: 'its repair loop is held',
    DISABLED: 'its continuous repair loop is disabled',
    NO_NEXT_CYCLE: 'its repair loop is enabled but has no next cycle scheduled',
    UNKNOWN: 'its repair-loop state is unverified',
  };
  const g = commander.guardian;
  let sentence = 'Commander is reachable; ' + (g ? descriptions[g.state] : 'its repair-loop state is unverified') + '.';
  if (g?.cycleCount !== null && g?.cycleCount !== undefined) sentence += ' Observed cycles: ' + g.cycleCount + '.';
  if (g?.lastBlocker) sentence += ' Last reported blocker: ' + g.lastBlocker + '.';
  return sentence;
}

function towerSentence(tower) {
  const latest = tower.latestRequestObservation || tower.currentRequest;
  const sentences = [];
  if (!tower.observed) sentences.push('Current Control Tower polling is unverified' + (tower.blocker ? ' (' + tower.blocker + ')' : '') + '.');
  else sentences.push('Current Control Tower polling reports ' + tower.state + (tower.blocker ? ' (' + tower.blocker + ')' : '') + '.');
  if (latest) {
    sentences.push((latest.historical ? 'Retained request ' : 'Observed request ') + latest.requestId + ' reports ' + latest.state
      + (latest.blocker ? ' (' + latest.blocker + ')' : '') + (latest.observedAtUtc ? ' at ' + latest.observedAtUtc : '') + '.');
    if (latest.sourceHead) sentences.push('Request source: ' + latest.sourceHead + '.');
    if (!latest.exactHeadMatch) sentences.push('Its source is historical or unverified against this backend.');
    if (latest.outcomeUnresolved === false && latest.detailState === 'LEGACY_DETAIL_UNAVAILABLE')
      sentences.push('Its original ledger is terminal (' + latest.terminalState + '); detailed original time, source and native outcome evidence are unavailable.');
    else if (latest.state === 'RESERVED' || latest.state === 'UNKNOWN')
      sentences.push(latest.operation === 'OBSERVE_CONTROL_SYSTEM'
        ? 'That diagnostic request has no proven terminal outcome.'
        : 'That request has no proven terminal outcome. Keep its identity and do not repeat the build request.');
    if (latest.state === 'WAKE_COMPLETED') sentences.push('The guarded wake completed; a material goal build still requires its own worker and completion receipts.');
  }
  const build = tower.latestBuildRequestObservation;
  if (build && build.requestId !== latest?.requestId && build.outcomeUnresolved === true)
    sentences.push('Earlier build request ' + build.requestId + ' still reports ' + build.state
      + (build.observedAtUtc ? ' at ' + build.observedAtUtc : '')
      + '. A newer inspection does not resolve that build; keep its identity and do not repeat it.');
  const diagnostic = tower.controlSystemStatus;
  if (diagnostic?.schemaVersion === 'stephanos.sovereign-control-system-status.v1') {
    if (diagnostic.blocker) sentences.push('Native observation: ' + code(diagnostic.blocker) + '.');
    if (diagnostic.nativeRuntime?.reason) sentences.push('Runtime qualification observation: ' + code(diagnostic.nativeRuntime.reason) + '.');
    if (diagnostic.observedAtUtc) sentences.push('Native observation time: ' + timestamp(diagnostic.observedAtUtc) + '.');
  }
  return sentences.join(' ');
}

function actionHandoff(intent, handoffId, at, commander, tower) {
  if (!['OBSERVE_CONTROL_SYSTEM', 'BUILD_NEXT_ELIGIBLE_GOAL'].includes(intent)
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(handoffId || '')) return null;
  const last = tower.latestBuildRequestObservation || tower.latestRequestObservation || tower.currentRequest;
  let blocked = '';
  if (intent === 'BUILD_NEXT_ELIGIBLE_GOAL') {
    if (tower.latestBuildRequestObservation?.outcomeUnresolved === true
      || (!tower.latestBuildRequestObservation && last?.operation !== 'OBSERVE_CONTROL_SYSTEM'
        && ['RESERVED', 'UNKNOWN'].includes(last?.state))) blocked = 'CONTROL_TOWER_REQUEST_OUTCOME_UNPROVEN';
    else if (commander.guardian?.running === true || commander.guardian?.maintenanceInFlight === true) blocked = 'SOVEREIGN_MAINTENANCE_OWNER_BUSY';
  }
  return {
    handoffId, state: 'NOT_SUBMITTED', operation: intent,
    workflowUrl: CONTROL_TOWER_WORKFLOW_URL, workflowRef: 'main', workflowInputs: { operation: intent },
    createdAtUtc: at, expiresAtUtc: new Date(Date.parse(at) + 600000).toISOString(),
    submissionBlockedReason: blocked, originalRequestId: blocked && last ? last.requestId : '',
    singleAuthenticatedRunRequired: true, reusableAuthority: false,
    authenticatedOwnerSubmissionRequired: true, requestSubmitted: false, executionAuthority: false,
    externalService: 'GITHUB_ACTIONS', externalQuotaApplies: true,
  };
}

export function buildSovereignControlConversationV1(input = {}) {
  const classification = input.classification;
  if (classification?.applies !== true || !INTENTS.has(classification.intent)) return null;
  const at = timestamp(input.observedAtUtc);
  if (!at) return null;
  const commander = compactCommander(input.commander, Date.parse(at));
  const tower = compactTower(input.controlTower, Date.parse(at));
  const handoff = actionHandoff(classification.intent, input.handoffId, at, commander, tower);
  const paragraphs = ['Sovereign control status', guardianSentence(commander), towerSentence(tower)];
  if (classification.intent === 'CAPABILITIES') paragraphs.push(
    'You can ask me for control status, why a request is held, a native control-system inspection, or the existing guarded goal-building repair. These control replies use live bounded observations and do not need a model.',
    'For an action, I prepare the exact existing Control Tower workflow handoff. The authenticated owner and existing execution guards decide whether it can run.');
  if (classification.intent === 'UNSUPPORTED_OPERATION') paragraphs.push(
    'That operation is outside this conversational control surface. I can inspect control status and prepare the existing fixed observation or goal-building request; this chat cannot issue shell commands, install a runtime, release custody or restart the computer.');
  if (classification.intent === 'INPUT_TOO_LONG') paragraphs.push(
    'This control message exceeds the 6,000-character limit. Ask a short status or inspection question; the existing Control Tower observation supplies the bounded native diagnostic. No pasted diagnostic was sent to a model.');
  if (handoff) paragraphs.push(handoff.submissionBlockedReason
    ? 'No action has been submitted. The existing request or maintenance operation must be reconciled first (' + handoff.submissionBlockedReason + ').'
    : 'No action has been submitted. Open the existing Control Tower workflow on main and select ' + handoff.operation + '. It creates one authenticated request; its native receipt determines the outcome.');
  if (handoff) paragraphs.push(CONTROL_TOWER_WORKFLOW_URL);
  paragraphs.push('This is a fact-backed control-service reply. No independent agent or language model was invoked, and no native action was executed by this chat.');
  return freeze({
    schemaVersion: SOVEREIGN_CONTROL_CONVERSATION_SCHEMA, observedAtUtc: at,
    intent: classification.intent, requestedTargetId: classification.requestedTargetId,
    responseSource: 'CANONICAL_CONTROL_OBSERVATIONS', responder: { id: 'stephanos', label: 'Stephanos control' },
    outputText: paragraphs.join('\n\n'), commander, controlTower: tower, handoff,
    readOnly: true, modelInvoked: false, externalModelInvoked: false,
    directParticipantDispatchProven: false, nativeActionSubmitted: false,
    sourceMutationAllowed: false, mergeAuthority: false, leaseSeizureAllowed: false, arbitraryShellAllowed: false,
  });
}
