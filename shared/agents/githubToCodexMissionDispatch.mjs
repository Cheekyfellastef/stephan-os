export const GITHUB_TO_CODEX_DISPATCH_SCHEMA_VERSION = 'github-to-codex-mission-dispatch.v1';

export const GOAL_DISPATCH_COMMANDS = Object.freeze([
  '/goal-dispatch status',
  '/goal-dispatch prepare <issue>',
  '/goal-dispatch active',
  '/goal-dispatch handoff',
  '/goal-dispatch verify-pr <issue-or-pr>',
]);

export const GOAL_DISPATCH_STATES = Object.freeze({
  NOT_READY: 'NOT_READY',
  READY_FOR_DISPATCH: 'READY_FOR_DISPATCH',
  MANUAL_DISPATCH_REQUIRED: 'MANUAL_DISPATCH_REQUIRED',
  DISPATCHED: 'DISPATCHED',
  CODEX_RUNNING_UNKNOWN: 'CODEX_RUNNING_UNKNOWN',
  DRAFT_PR_OPENED: 'DRAFT_PR_OPENED',
  BLOCKED: 'BLOCKED',
  PROOF_REQUIRED: 'PROOF_REQUIRED',
  READY_FOR_REVIEW: 'READY_FOR_REVIEW',
  MERGE_HELD_FOR_OPERATOR_APPROVAL: 'MERGE_HELD_FOR_OPERATOR_APPROVAL',
  MERGED: 'MERGED',
});

export const ACTIVE_BUILD_PACKET_FIELDS = Object.freeze([
  'ACTIVE_BUILD_PACKET',
  'TARGET',
  'SCOPE',
  'GUARDRAILS',
  'REQUIRED_TESTS',
  'REQUIRED_PROOFS',
  'DELIVERABLE',
  'NO_MERGE_WITHOUT_EXACT_HEAD_OPERATOR_APPROVAL',
]);

const FORBIDDEN_DETAIL_PATTERN = /token|secret|password|credential|private key|\.env/i;
const SAFE_TEXT_PATTERN = /^[a-z0-9#][a-z0-9._:/#(),<>'"\[\]\n -]{0,5000}$/i;
const SAFE_ID_PATTERN = /^[a-z0-9#][a-z0-9._:/#-]{0,120}$/i;

function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function safeText(value, fallback = '') {
  const text = asText(value, fallback);
  if (!text || FORBIDDEN_DETAIL_PATTERN.test(text)) return fallback;
  return text.length <= 5000 ? text : fallback;
}

function safeId(value, fallback = '#1371') {
  const text = asText(value, fallback);
  return SAFE_ID_PATTERN.test(text) ? text : fallback;
}

function normalizeLines(value) {
  return safeText(value, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function readPacketField(lines, field) {
  const index = lines.findIndex((line) => line === field || line.startsWith(`${field}:`));
  if (index === -1) return '';
  const inline = lines[index].startsWith(`${field}:`) ? lines[index].slice(field.length + 1).trim() : '';
  const collected = inline ? [inline] : [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (ACTIVE_BUILD_PACKET_FIELDS.some((candidate) => lines[cursor] === candidate || lines[cursor].startsWith(`${candidate}:`))) break;
    collected.push(lines[cursor]);
  }
  return collected.join('\n').trim();
}

export function buildGithubToCodexMissionDispatchContract() {
  return {
    schemaVersion: GITHUB_TO_CODEX_DISPATCH_SCHEMA_VERSION,
    contractKind: 'stephanos.github_to_codex_mission_dispatch.contract',
    commands: [...GOAL_DISPATCH_COMMANDS],
    requiredPacketFields: [...ACTIVE_BUILD_PACKET_FIELDS],
    dispatchStates: Object.values(GOAL_DISPATCH_STATES),
    guardrails: {
      arbitraryShellAllowed: false,
      arbitraryPowerShellAllowed: false,
      directMergeAllowed: false,
      autoApprovalAllowed: false,
      operatorApprovalSpoofingAllowed: false,
      fakeCodexRunClaimsAllowed: false,
      fakeGithubLiveStateClaimsAllowed: false,
      secretOutputAllowed: false,
      environmentDumpAllowed: false,
      sourceMutationFromPrepareAllowed: false,
      exactHeadMergeApprovalRequired: true,
    },
    finalVerdict: 'GITHUB_TO_CODEX_MISSION_DISPATCH_CONTRACT_READY',
  };
}

export function parseActiveBuildPacket(input = {}) {
  const issueNumber = safeId(input.issueNumber, '#1371');
  const body = safeText(input.body, '');
  const lines = normalizeLines(body);
  const presentFields = ACTIVE_BUILD_PACKET_FIELDS.filter((field) => lines.some((line) => line === field || line.startsWith(`${field}:`)));
  const missingFields = ACTIVE_BUILD_PACKET_FIELDS.filter((field) => !presentFields.includes(field));
  const fields = Object.fromEntries(ACTIVE_BUILD_PACKET_FIELDS.map((field) => [field, readPacketField(lines, field)]));
  const accepted = missingFields.length === 0 && fields.TARGET !== '' && fields.SCOPE !== '' && fields.DELIVERABLE !== '';

  return {
    schemaVersion: GITHUB_TO_CODEX_DISPATCH_SCHEMA_VERSION,
    kind: 'stephanos.github_to_codex.active_build_packet',
    issueNumber,
    accepted,
    presentFields,
    missingFields,
    fields,
    rejectionReason: accepted ? '' : 'Issue lacks a complete ACTIVE_BUILD_PACKET with target, scope, guardrails, tests, proofs, deliverable, and exact-head approval boundary.',
    finalVerdict: accepted ? 'ACTIVE_BUILD_PACKET_ACCEPTED' : 'ACTIVE_BUILD_PACKET_REJECTED',
  };
}

export function createCodexMissionDispatchPacket(input = {}) {
  const packet = input.packet?.kind === 'stephanos.github_to_codex.active_build_packet'
    ? input.packet
    : parseActiveBuildPacket(input);
  const directCodexDispatchAvailable = input.directCodexDispatchAvailable === true;
  const draftPr = safeText(input.draftPr, '');
  const proofRequired = input.proofRequired === true;
  const mergeApprovedExactHead = input.mergeApprovedExactHead === true;

  let dispatchState = GOAL_DISPATCH_STATES.NOT_READY;
  if (!packet.accepted) dispatchState = GOAL_DISPATCH_STATES.NOT_READY;
  else if (draftPr && !mergeApprovedExactHead) dispatchState = GOAL_DISPATCH_STATES.MERGE_HELD_FOR_OPERATOR_APPROVAL;
  else if (proofRequired) dispatchState = GOAL_DISPATCH_STATES.PROOF_REQUIRED;
  else if (directCodexDispatchAvailable) dispatchState = GOAL_DISPATCH_STATES.READY_FOR_DISPATCH;
  else dispatchState = GOAL_DISPATCH_STATES.MANUAL_DISPATCH_REQUIRED;

  const missionPacket = packet.accepted ? [
    'CODEX_MISSION_PACKET',
    `TARGET: ${packet.fields.TARGET}`,
    `SOURCE_ISSUE: ${packet.issueNumber}`,
    `SCOPE: ${packet.fields.SCOPE}`,
    `GUARDRAILS: ${packet.fields.GUARDRAILS}`,
    `REQUIRED_TESTS: ${packet.fields.REQUIRED_TESTS}`,
    `REQUIRED_PROOFS: ${packet.fields.REQUIRED_PROOFS}`,
    `DELIVERABLE: ${packet.fields.DELIVERABLE}`,
    'NO_MERGE_WITHOUT_EXACT_HEAD_OPERATOR_APPROVAL',
  ].join('\n') : '';

  return {
    schemaVersion: GITHUB_TO_CODEX_DISPATCH_SCHEMA_VERSION,
    kind: 'stephanos.github_to_codex.mission_dispatch_packet',
    issueNumber: packet.issueNumber,
    dispatchState,
    packetAccepted: packet.accepted,
    directCodexDispatchAvailable,
    manualDispatchRequired: packet.accepted && !directCodexDispatchAvailable,
    codexMissionPacketGenerated: packet.accepted,
    codexMissionPacket: missionPacket,
    blocker: packet.accepted && !directCodexDispatchAvailable
      ? 'Direct Codex dispatch tool is not available or not proven; operator must copy the canonical mission packet.'
      : packet.rejectionReason,
    fakeCodexRunClaim: false,
    fakeGithubLiveStateClaim: false,
    mergeApprovalHeld: !mergeApprovedExactHead,
    finalVerdict: packet.accepted ? 'CODEX_MISSION_PACKET_READY' : 'CODEX_MISSION_PACKET_BLOCKED',
  };
}

export function verifyGoalDispatchAcceptance(input = {}) {
  const dispatch = createCodexMissionDispatchPacket(input);
  return {
    schemaVersion: GITHUB_TO_CODEX_DISPATCH_SCHEMA_VERSION,
    kind: 'stephanos.github_to_codex.acceptance_proof',
    ISSUE_WITH_ACTIVE_BUILD_PACKET: dispatch.packetAccepted ? 'ACCEPTED' : 'REJECTED',
    CODEX_MISSION_PACKET_GENERATED: dispatch.codexMissionPacketGenerated,
    MANUAL_DISPATCH_REQUIRED_EXPLICIT: dispatch.manualDispatchRequired === true && dispatch.dispatchState === GOAL_DISPATCH_STATES.MANUAL_DISPATCH_REQUIRED,
    NO_FAKE_CODEX_RUN_CLAIM: dispatch.fakeCodexRunClaim === false,
    MERGE_APPROVAL_HELD: dispatch.mergeApprovalHeld === true,
    finalVerdict: dispatch.packetAccepted && dispatch.codexMissionPacketGenerated && !dispatch.fakeCodexRunClaim && dispatch.mergeApprovalHeld
      ? 'GITHUB_TO_CODEX_MISSION_DISPATCH_V1_PASS'
      : 'GITHUB_TO_CODEX_MISSION_DISPATCH_V1_BLOCKED',
  };
}
