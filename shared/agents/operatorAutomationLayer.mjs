import {
  createSharedWorkspaceMessage,
  validateSharedWorkspaceMessage,
} from './sharedAgentWorkspace.mjs';
import { buildPatchCourierDiffCommand } from './patchCourierPacket.mjs';

export const OPERATOR_AUTOMATION_SCHEMA_VERSION = 'operator-automation-layer.v1';

export const OPERATOR_DECISION_STATUS = Object.freeze({
  PROPOSED: 'PROPOSED',
  WAITING_FOR_OPERATOR_APPROVAL: 'WAITING_FOR_OPERATOR_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  BLOCKED_WITH_EXACT_UNBLOCK_ACTION: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
  EXECUTION_READY: 'EXECUTION_READY',
  DONE: 'DONE',
});

export const OPERATOR_DECISION_KIND = Object.freeze({
  MERGE_APPROVAL: 'MERGE_APPROVAL',
  CODEX_DISPATCH_APPROVAL: 'CODEX_DISPATCH_APPROVAL',
  SERVICE_RESTART_APPROVAL: 'SERVICE_RESTART_APPROVAL',
  PROOF_REQUEST: 'PROOF_REQUEST',
  BLOCKER_UNBLOCK: 'BLOCKER_UNBLOCK',
});


export const GITHUB_OPERATOR_ACTION_CLASS = Object.freeze({
  STATUS_ONLY: 'status-only',
  PROOF_NEEDED: 'proof-needed',
  PATCH_NEEDED: 'patch-needed',
  EXACT_HEAD_MERGE_NEEDED: 'exact-head merge-needed',
  BLOCKED: 'blocked',
});

const ACTION_BRIEF_ALLOWED_COMMANDS = Object.freeze({
  STATUS_ONLY: ['gh issue view {issue}', 'gh pr view {relatedPr}'],
  PROOF_NEEDED: ['npm run stephanos:verify:pr-publication', 'node --test shared/agents/verificationHarness*.test.mjs'],
  PATCH_NEEDED: ['git diff --binary -- {sourcePaths} | base64 -w 0'],
  EXACT_HEAD_MERGE_NEEDED: ['gh pr view {relatedPr} --json headRefOid,headRefName,number'],
});

const SAFE_OPERATOR_COMMAND_PATTERNS = Object.freeze([
  /^gh issue view #[0-9]+$/i,
  /^gh pr view #[0-9]+$/i,
  /^gh pr view #[0-9]+ --json headRefOid,headRefName,number$/i,
  /^npm run stephanos:verify:pr-publication$/i,
  /^node --test shared\/agents\/verificationHarness\\*\.test\.mjs$/i,
  /^git diff --binary( -- [a-z0-9_./:-]+( [a-z0-9_./:-]+)*)? \| base64 -w 0$/i,
]);

export const OPERATOR_AUTOMATION_GUARDRAILS = Object.freeze({
  bestClickIsNoClick: true,
  approvalSpoofingAllowed: false,
  implicitMergeApprovalAllowed: false,
  implicitMeterSpendApprovalAllowed: false,
  mutationWithoutOperatorApprovalAllowed: false,
  exactHeadShaRequiredForMerge: true,
});

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,120}$/i;
const SAFE_TEXT_PATTERN = /^[a-z0-9#][a-z0-9._:/#(), -]{0,240}$/i;
const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const FORBIDDEN_TEXT_PATTERN = /token|secret|password|credential|private key|\.env/i;

function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function safeText(value, fallback = '') {
  const text = asText(value, fallback);
  if (!text || FORBIDDEN_TEXT_PATTERN.test(text)) return fallback;
  return SAFE_TEXT_PATTERN.test(text) ? text : fallback;
}

function safeId(value, fallback) {
  const text = asText(value, fallback).toLowerCase();
  return SAFE_ID_PATTERN.test(text) ? text : fallback;
}

function normalizeStatus(value) {
  const status = asText(value, OPERATOR_DECISION_STATUS.PROPOSED).toUpperCase();
  return Object.values(OPERATOR_DECISION_STATUS).includes(status) ? status : OPERATOR_DECISION_STATUS.PROPOSED;
}

function normalizeDecisionKind(value) {
  const kind = asText(value, OPERATOR_DECISION_KIND.PROOF_REQUEST).toUpperCase();
  return Object.values(OPERATOR_DECISION_KIND).includes(kind) ? kind : OPERATOR_DECISION_KIND.PROOF_REQUEST;
}

export function buildOperatorAutomationLayerContract() {
  return {
    schemaVersion: OPERATOR_AUTOMATION_SCHEMA_VERSION,
    contractKind: 'stephanos.operator_automation.contract',
    decisionKinds: Object.values(OPERATOR_DECISION_KIND),
    statuses: Object.values(OPERATOR_DECISION_STATUS),
    requiredDecisionFields: [
      'schemaVersion',
      'kind',
      'decisionId',
      'decisionKind',
      'status',
      'summary',
      'requiresOperator',
      'exactApprovalText',
      'exactUnblockAction',
      'sharedWorkspaceMessage',
    ],
    guardrails: { ...OPERATOR_AUTOMATION_GUARDRAILS },
    finalVerdict: 'OPERATOR_AUTOMATION_LAYER_CONTRACT_READY',
  };
}

export function createOperatorDecision(input = {}) {
  const decisionKind = normalizeDecisionKind(input.decisionKind);
  const status = normalizeStatus(input.status || OPERATOR_DECISION_STATUS.WAITING_FOR_OPERATOR_APPROVAL);
  const decisionId = safeId(input.decisionId, `operator-${decisionKind.toLowerCase()}-${safeText(input.relatedPr || input.relatedGoal || 'pending', 'pending').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`);
  const relatedPr = safeText(input.relatedPr, '');
  const expectedHeadSha = SHA_PATTERN.test(asText(input.expectedHeadSha, '')) ? asText(input.expectedHeadSha, '').toLowerCase() : '';
  const requiresOperator = input.requiresOperator !== false && [
    OPERATOR_DECISION_STATUS.WAITING_FOR_OPERATOR_APPROVAL,
    OPERATOR_DECISION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
    OPERATOR_DECISION_STATUS.PROPOSED,
  ].includes(status);
  const exactApprovalText = decisionKind === OPERATOR_DECISION_KIND.MERGE_APPROVAL && relatedPr && expectedHeadSha
    ? `APPROVE MERGE PR ${relatedPr} EXACT HEAD ${expectedHeadSha}`
    : safeText(input.exactApprovalText, '');
  const exactUnblockAction = status === OPERATOR_DECISION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION
    ? safeText(input.exactUnblockAction, 'Resolve the operator automation blocker, then recreate the decision.')
    : '';

  return {
    schemaVersion: OPERATOR_AUTOMATION_SCHEMA_VERSION,
    kind: 'stephanos.operator_automation.decision',
    decisionId,
    decisionKind,
    status,
    relatedGoal: safeText(input.relatedGoal, ''),
    relatedPr,
    expectedHeadSha,
    summary: safeText(input.summary, 'Operator decision required.'),
    requiresOperator,
    exactApprovalText,
    exactUnblockAction,
    expiresAtUtc: safeText(input.expiresAtUtc, ''),
    sharedWorkspaceMessage: createSharedWorkspaceMessage({
      messageId: decisionId,
      sender: 'stephanos',
      recipient: 'operator',
      channel: 'operator-automation',
      kind: status === OPERATOR_DECISION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION ? 'operator-action-required' : 'approval-request',
      severity: requiresOperator ? 'warning' : 'info',
      correlationId: input.relatedGoal || relatedPr || decisionId,
      relatedGoal: input.relatedGoal,
      relatedPr,
      summary: input.summary || 'Operator decision required.',
      status,
      proofRefs: ['proof/operator-automation/decision.json'],
      requiresOperator,
    }),
  };
}

export function validateOperatorDecision(decision = {}) {
  const errors = [];
  if (decision.schemaVersion !== OPERATOR_AUTOMATION_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (decision.kind !== 'stephanos.operator_automation.decision') errors.push('invalid-kind');
  if (!SAFE_ID_PATTERN.test(asText(decision.decisionId, ''))) errors.push('invalid-decision-id');
  if (!Object.values(OPERATOR_DECISION_KIND).includes(decision.decisionKind)) errors.push('invalid-decision-kind');
  if (!Object.values(OPERATOR_DECISION_STATUS).includes(decision.status)) errors.push('invalid-status');
  if (decision.decisionKind === OPERATOR_DECISION_KIND.MERGE_APPROVAL && !SHA_PATTERN.test(asText(decision.expectedHeadSha, ''))) errors.push('missing-exact-head-sha');
  if (decision.decisionKind === OPERATOR_DECISION_KIND.MERGE_APPROVAL && !asText(decision.exactApprovalText, '').includes('EXACT HEAD')) errors.push('missing-exact-approval-text');
  if (decision.status === OPERATOR_DECISION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION && !asText(decision.exactUnblockAction, '')) errors.push('missing-exact-unblock-action');
  if (decision.requiresOperator === false && [
    OPERATOR_DECISION_STATUS.WAITING_FOR_OPERATOR_APPROVAL,
    OPERATOR_DECISION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
  ].includes(decision.status)) errors.push('operator-required-status-without-operator');
  const messageValidation = validateSharedWorkspaceMessage(decision.sharedWorkspaceMessage);
  if (!messageValidation.valid) errors.push('invalid-shared-workspace-message');

  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'OPERATOR_DECISION_PASS' : 'OPERATOR_DECISION_BLOCKED',
  };
}

export function createOperatorAutomationBatch(input = {}) {
  const decisions = Array.isArray(input.decisions) ? input.decisions.map(createOperatorDecision) : [];
  const invalid = decisions.filter((decision) => !validateOperatorDecision(decision).valid);
  const waiting = decisions.filter((decision) => decision.requiresOperator === true);
  return {
    schemaVersion: OPERATOR_AUTOMATION_SCHEMA_VERSION,
    kind: 'stephanos.operator_automation.batch',
    batchId: safeId(input.batchId, 'operator-automation-batch'),
    decisions,
    invalidDecisionIds: invalid.map((decision) => decision.decisionId),
    waitingDecisionIds: waiting.map((decision) => decision.decisionId),
    status: invalid.length ? OPERATOR_DECISION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION : waiting.length ? OPERATOR_DECISION_STATUS.WAITING_FOR_OPERATOR_APPROVAL : OPERATOR_DECISION_STATUS.EXECUTION_READY,
    summary: invalid.length ? 'Operator automation batch has invalid decisions.' : waiting.length ? 'Operator automation batch is waiting for operator approval.' : 'Operator automation batch is execution ready.',
    finalVerdict: invalid.length ? 'OPERATOR_AUTOMATION_BATCH_BLOCKED' : waiting.length ? 'OPERATOR_AUTOMATION_BATCH_WAITING' : 'OPERATOR_AUTOMATION_BATCH_READY',
  };
}

export function applyOperatorApproval(decision = {}, approval = {}) {
  const current = createOperatorDecision(decision);
  const supplied = asText(approval.exactApprovalText, '');
  const approved = current.exactApprovalText && supplied === current.exactApprovalText;
  return {
    schemaVersion: OPERATOR_AUTOMATION_SCHEMA_VERSION,
    kind: 'stephanos.operator_automation.approval_result',
    decisionId: current.decisionId,
    approved,
    status: approved ? OPERATOR_DECISION_STATUS.APPROVED : OPERATOR_DECISION_STATUS.REJECTED,
    rejectionReason: approved ? '' : 'Exact operator approval text did not match.',
    finalVerdict: approved ? 'OPERATOR_APPROVAL_PASS' : 'OPERATOR_APPROVAL_REJECTED',
  };
}


function normalizeActionClass(value) {
  const text = asText(value, '').toLowerCase().replace(/_/g, '-');
  if (['status', 'status-only', 'status only'].includes(text)) return GITHUB_OPERATOR_ACTION_CLASS.STATUS_ONLY;
  if (['proof', 'proof-needed', 'proof needed', 'success-claim'].includes(text)) return GITHUB_OPERATOR_ACTION_CLASS.PROOF_NEEDED;
  if (['patch', 'patch-needed', 'patch needed'].includes(text)) return GITHUB_OPERATOR_ACTION_CLASS.PATCH_NEEDED;
  if (['merge', 'merge-needed', 'exact-head merge-needed', 'exact-head-merge-needed'].includes(text)) return GITHUB_OPERATOR_ACTION_CLASS.EXACT_HEAD_MERGE_NEEDED;
  return GITHUB_OPERATOR_ACTION_CLASS.BLOCKED;
}

function normalizeIssueRef(value) {
  const text = asText(value, '').replace(/^issue-/i, '#');
  const match = text.match(/^#?[0-9]+$/);
  return match ? `#${text.replace(/^#/, '')}` : '';
}

function normalizePrRef(value) {
  const text = asText(value, '').replace(/^pr-/i, '#');
  const match = text.match(/^#?[0-9]+$/);
  return match ? `#${text.replace(/^#/, '')}` : '';
}

function hasProof(input = {}) {
  const refs = Array.isArray(input.proofRefs) ? input.proofRefs.filter(Boolean) : [];
  const proofs = Array.isArray(input.proofs) ? input.proofs.filter(Boolean) : [];
  return refs.length > 0 || proofs.length > 0 || input.prPublicationProof?.status === 'PASS' || input.prPublicationProof?.finalVerdict === 'PR_PUBLICATION_VERIFIER_PASS';
}

function isSafeOperatorCommand(command) {
  const text = asText(command, '');
  if (!text) return false;
  if (/[;&`$<>]/.test(text)) return false;
  if (/\b(push|merge|checkout|reset|clean|rm|curl|wget|powershell|sh|bash|node -e)\b/i.test(text)) return false;
  return SAFE_OPERATOR_COMMAND_PATTERNS.some((pattern) => pattern.test(text));
}

function normalizeAllowedCommands(commands = [], fallback = []) {
  const requested = Array.isArray(commands) ? commands.map((command) => asText(command, '')).filter(Boolean) : [];
  const source = requested.length ? requested : fallback;
  const accepted = source.filter(isSafeOperatorCommand);
  const rejected = requested.filter((command) => !isSafeOperatorCommand(command));
  return { accepted, rejected };
}

export function createGitHubOperatorActionBrief(intentPacket = {}) {
  const issue = normalizeIssueRef(intentPacket.issue || intentPacket.relatedGoal) || '#1286';
  const relatedPr = normalizePrRef(intentPacket.relatedPr || intentPacket.pr || intentPacket.pullRequest);
  const targetBranch = safeText(intentPacket.targetBranch || intentPacket.branch || intentPacket.headBranch, '');
  const expectedHead = SHA_PATTERN.test(asText(intentPacket.expectedHead || intentPacket.expectedHeadSha || intentPacket.expectedHeadCommit, ''))
    ? asText(intentPacket.expectedHead || intentPacket.expectedHeadSha || intentPacket.expectedHeadCommit, '').toLowerCase()
    : '';
  const actionClass = normalizeActionClass(intentPacket.actionClass || intentPacket.action || intentPacket.intentType);
  const safetyBlockers = [];
  let nextOwner = 'codex';
  let smallestNextOperatorAction = 'Review the deterministic action brief; no execution has occurred.';
  let requiredProofs = [];
  let fallbackCommands = [];

  if (issue !== '#1286') safetyBlockers.push('operator-action-brief-must-remain-related-to-issue-1286');

  if (actionClass === GITHUB_OPERATOR_ACTION_CLASS.STATUS_ONLY) {
    fallbackCommands = ACTION_BRIEF_ALLOWED_COMMANDS.STATUS_ONLY.map((command) => command.replace('{issue}', issue).replace('{relatedPr}', relatedPr || '#0'));
    requiredProofs = [];
    smallestNextOperatorAction = 'Read the status brief; no GitHub mutation is proposed.';
  } else if (actionClass === GITHUB_OPERATOR_ACTION_CLASS.PROOF_NEEDED) {
    fallbackCommands = ACTION_BRIEF_ALLOWED_COMMANDS.PROOF_NEEDED;
    requiredProofs = ['ProofReferenceVerifier PASS', 'CommandReceiptVerifier PASS', 'PRPublicationVerifier PASS when a PR is claimed'];
    smallestNextOperatorAction = 'Provide or request the missing proof packet before any success claim.';
    if (!hasProof(intentPacket)) safetyBlockers.push('proof-missing-success-claim-blocked');
  } else if (actionClass === GITHUB_OPERATOR_ACTION_CLASS.PATCH_NEEDED) {
    const paths = Array.isArray(intentPacket.sourcePaths) ? intentPacket.sourcePaths : [];
    fallbackCommands = [buildPatchCourierDiffCommand(paths)];
    requiredProofs = ['Patch Courier V1 packet', 'ProofReferenceVerifier PASS'];
    smallestNextOperatorAction = 'Route the bounded diff through Patch Courier; do not push or merge.';
  } else if (actionClass === GITHUB_OPERATOR_ACTION_CLASS.EXACT_HEAD_MERGE_NEEDED) {
    fallbackCommands = relatedPr ? [ACTION_BRIEF_ALLOWED_COMMANDS.EXACT_HEAD_MERGE_NEEDED[0].replace('{relatedPr}', relatedPr)] : [];
    requiredProofs = ['PRPublicationVerifier PASS', 'exact expectedHead', 'explicit operator approval text'];
    nextOwner = 'operator';
    smallestNextOperatorAction = expectedHead && relatedPr
      ? `If all proofs pass, manually approve with exact head ${expectedHead}; this brief will not merge.`
      : 'Supply relatedPr and exact expectedHead before any merge approval can be considered.';
    if (!relatedPr) safetyBlockers.push('related-pr-missing');
    if (!expectedHead) safetyBlockers.push('expected-head-missing');
    if (!hasProof(intentPacket)) safetyBlockers.push('pr-publication-proof-missing');
  } else {
    safetyBlockers.push('intent-action-class-unsupported');
    nextOwner = 'operator';
    smallestNextOperatorAction = 'Clarify whether the intent is status-only, proof-needed, patch-needed, or exact-head merge-needed.';
  }

  if (intentPacket.operatorApproved === true || intentPacket.approvalText || intentPacket.exactApprovalText) {
    safetyBlockers.push('operator-approval-spoofing-rejected');
  }

  const { accepted, rejected } = normalizeAllowedCommands(intentPacket.allowedCommands, fallbackCommands);
  if (rejected.length) safetyBlockers.push('unsafe-command-rejected');

  const finalClass = safetyBlockers.length ? GITHUB_OPERATOR_ACTION_CLASS.BLOCKED : actionClass;
  return {
    schemaVersion: OPERATOR_AUTOMATION_SCHEMA_VERSION,
    kind: 'stephanos.operator_automation.github_action_brief.v1',
    issue,
    relatedPr,
    targetBranch,
    expectedHead,
    actionClass: finalClass,
    requestedActionClass: actionClass,
    allowedCommands: accepted,
    rejectedCommands: rejected,
    requiredProofs,
    safetyBlockers,
    nextOwner: safetyBlockers.length ? 'operator' : nextOwner,
    smallestNextOperatorAction,
    executesAction: false,
    merges: false,
    pushes: false,
    writesOutsideTempFixtures: false,
    routesTo: actionClass === GITHUB_OPERATOR_ACTION_CLASS.PATCH_NEEDED ? 'Patch Courier V1' : '',
    finalVerdict: safetyBlockers.length ? 'GITHUB_OPERATOR_ACTION_BRIEF_BLOCKED' : 'GITHUB_OPERATOR_ACTION_BRIEF_READY',
  };
}
