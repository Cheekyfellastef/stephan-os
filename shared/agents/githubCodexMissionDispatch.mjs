import { createHash } from 'node:crypto';
import { createSharedWorkspaceMessage } from './sharedAgentWorkspace.mjs';

export const GITHUB_CODEX_MISSION_DISPATCH_SCHEMA_VERSION = 'github-codex-mission-dispatch.v1';
export const GITHUB_CODEX_MISSION_DISPATCH_KIND = 'stephanos.github_codex.mission_dispatch';

export const GITHUB_CODEX_MISSION_DISPATCH_STATUS = Object.freeze({
  READY: 'READY',
  WAITING_FOR_OPERATOR_APPROVAL: 'WAITING_FOR_OPERATOR_APPROVAL',
  BLOCKED_WITH_EXACT_UNBLOCK_ACTION: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
});

export const GITHUB_CODEX_MISSION_DISPATCH_GUARDRAILS = Object.freeze({
  localPatchOnly: true,
  originReadsAllowed: false,
  pushAllowed: false,
  pullRequestClaimAllowed: false,
  arbitraryShellAllowed: false,
  secretOutputAllowed: false,
  sourceTreeQueueWritesAllowed: false,
  requiresExactFiles: true,
  requiresProofCommands: true,
});

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:#/-]{0,160}$/i;
const SAFE_GOAL_PATTERN = /^#?[0-9][0-9._:#/-]{0,80}$/i;
const SAFE_FILE_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,220}$/i;
const SAFE_BRANCH_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,180}$/i;
const FORBIDDEN_TEXT_PATTERN = /token|secret|password|credential|private key|\.env|origin\b|git\s+push|pull request exists/i;
const SAFE_TEST_COMMAND_PATTERN = /^(node|npm|pnpm|yarn)\b(?!.*\b(origin|push|pull|reset\s+--hard|merge)\b)/i;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function unique(value) {
  return [...new Set(list(value))];
}

function safeIdentifier(value, fallback) {
  const candidate = text(value, fallback);
  return SAFE_ID_PATTERN.test(candidate) && !FORBIDDEN_TEXT_PATTERN.test(candidate) ? candidate : fallback;
}

function safeGoalId(value, fallback) {
  const candidate = text(value, fallback);
  return SAFE_GOAL_PATTERN.test(candidate) && !FORBIDDEN_TEXT_PATTERN.test(candidate) ? candidate : fallback;
}

function safeBranch(value) {
  const branch = text(value, 'hardbuild/1291-1371-supervisor-dispatch').replace(/\\/g, '/');
  return SAFE_BRANCH_PATTERN.test(branch) && !branch.includes('..') && !FORBIDDEN_TEXT_PATTERN.test(branch)
    ? branch
    : 'hardbuild/1291-1371-supervisor-dispatch';
}

function safeFiles(value) {
  return unique(value)
    .filter((file) => SAFE_FILE_PATTERN.test(file) && !file.includes('..') && !FORBIDDEN_TEXT_PATTERN.test(file))
    .slice(0, 20);
}

function safeTestCommands(value) {
  return unique(value)
    .filter((command) => SAFE_TEST_COMMAND_PATTERN.test(command) && !FORBIDDEN_TEXT_PATTERN.test(command))
    .slice(0, 20);
}

function safeSummary(value) {
  return text(value, 'Local #1291/#1371 supervisor dispatch patch.').replace(/\s+/g, ' ').slice(0, 500);
}

function stableDispatchId(input) {
  const seed = `${text(input.goalId)}\n${text(input.branch)}\n${list(input.filesChanged).join('\n')}\n${safeSummary(input.summary)}`;
  return `github-codex-dispatch-${createHash('sha256').update(seed).digest('hex').slice(0, 20)}`;
}

function exactUnblockAction({ filesChanged, testsToRun, operatorApproved, localPatchOnly }) {
  if (!localPatchOnly) return 'Use the local #1291/#1371 patch only; do not read origin or push.';
  if (!filesChanged.length) return 'Provide the exact local source files changed by the #1291/#1371 patch.';
  if (!testsToRun.length) return 'Provide at least one safe local proof command for the #1291/#1371 patch.';
  if (operatorApproved === false) return 'Collect exact operator approval before dispatching the local #1291/#1371 mission patch.';
  return '';
}

export function buildGithubCodexMissionDispatchContract() {
  return Object.freeze({
    schemaVersion: GITHUB_CODEX_MISSION_DISPATCH_SCHEMA_VERSION,
    contractKind: 'stephanos.github_codex.mission_dispatch.contract',
    statuses: Object.values(GITHUB_CODEX_MISSION_DISPATCH_STATUS),
    requiredFields: [
      'schemaVersion',
      'kind',
      'dispatchId',
      'goalIds',
      'branch',
      'summary',
      'filesChanged',
      'testsToRun',
      'status',
      'guardrails',
      'exactUnblockAction',
      'sharedWorkspaceMessage',
    ],
    guardrails: { ...GITHUB_CODEX_MISSION_DISPATCH_GUARDRAILS },
    finalVerdict: 'GITHUB_CODEX_MISSION_DISPATCH_CONTRACT_READY',
  });
}

export function createGithubCodexMissionDispatch(input = {}) {
  const goalIds = unique(input.goalIds || input.issues || ['#1291', '#1371']).map((goal) => safeGoalId(goal, '#1291'));
  const branch = safeBranch(input.branch);
  const filesChanged = safeFiles(input.filesChanged || input.files || []);
  const testsToRun = safeTestCommands(input.testsToRun || input.proofCommands || []);
  const localPatchOnly = input.localPatchOnly !== false;
  const operatorApproved = input.requiresOperatorApproval === true ? input.operatorApproved === true : true;
  const unblock = exactUnblockAction({ filesChanged, testsToRun, operatorApproved, localPatchOnly });
  const status = unblock
    ? operatorApproved === false
      ? GITHUB_CODEX_MISSION_DISPATCH_STATUS.WAITING_FOR_OPERATOR_APPROVAL
      : GITHUB_CODEX_MISSION_DISPATCH_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION
    : GITHUB_CODEX_MISSION_DISPATCH_STATUS.READY;
  const dispatchId = safeIdentifier(input.dispatchId, stableDispatchId({ ...input, branch, filesChanged }));
  const summary = safeSummary(input.summary);

  return Object.freeze({
    schemaVersion: GITHUB_CODEX_MISSION_DISPATCH_SCHEMA_VERSION,
    kind: GITHUB_CODEX_MISSION_DISPATCH_KIND,
    dispatchId,
    goalIds: Object.freeze(goalIds),
    branch,
    summary,
    filesChanged: Object.freeze(filesChanged),
    testsToRun: Object.freeze(testsToRun),
    status,
    guardrails: Object.freeze({ ...GITHUB_CODEX_MISSION_DISPATCH_GUARDRAILS }),
    exactUnblockAction: unblock,
    sharedWorkspaceMessage: createSharedWorkspaceMessage({
      messageId: dispatchId,
      sender: 'codex',
      recipient: 'operator',
      channel: 'github-codex-mission-dispatch',
      kind: status === GITHUB_CODEX_MISSION_DISPATCH_STATUS.READY ? 'codex-mission-dispatch-ready' : 'operator-action-required',
      severity: status === GITHUB_CODEX_MISSION_DISPATCH_STATUS.READY ? 'info' : 'warning',
      correlationId: goalIds.join('+'),
      relatedGoal: goalIds.join('+'),
      summary: status === GITHUB_CODEX_MISSION_DISPATCH_STATUS.READY ? summary : unblock,
      status,
      proofRefs: testsToRun.map((command) => `proof/${dispatchId}/${createHash('sha1').update(command).digest('hex').slice(0, 10)}.json`),
      requiresOperator: status !== GITHUB_CODEX_MISSION_DISPATCH_STATUS.READY,
    }),
    finalVerdict: status === GITHUB_CODEX_MISSION_DISPATCH_STATUS.READY
      ? 'GITHUB_CODEX_MISSION_DISPATCH_READY'
      : 'GITHUB_CODEX_MISSION_DISPATCH_BLOCKED',
  });
}

export function validateGithubCodexMissionDispatch(dispatch = {}) {
  const errors = [];
  const contract = buildGithubCodexMissionDispatchContract();
  for (const field of contract.requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(dispatch, field)) errors.push(`missing-${field}`);
  }
  if (dispatch.schemaVersion !== GITHUB_CODEX_MISSION_DISPATCH_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (dispatch.kind !== GITHUB_CODEX_MISSION_DISPATCH_KIND) errors.push('invalid-kind');
  if (!SAFE_ID_PATTERN.test(text(dispatch.dispatchId)) || FORBIDDEN_TEXT_PATTERN.test(text(dispatch.dispatchId))) errors.push('invalid-dispatch-id');
  if (!SAFE_BRANCH_PATTERN.test(text(dispatch.branch)) || text(dispatch.branch).includes('..') || FORBIDDEN_TEXT_PATTERN.test(text(dispatch.branch))) errors.push('invalid-branch');
  if (!Array.isArray(dispatch.filesChanged) || dispatch.filesChanged.length === 0) errors.push('missing-files-changed');
  if (!Array.isArray(dispatch.testsToRun) || dispatch.testsToRun.length === 0) errors.push('missing-tests-to-run');
  for (const file of list(dispatch.filesChanged)) {
    if (!SAFE_FILE_PATTERN.test(file) || file.includes('..') || FORBIDDEN_TEXT_PATTERN.test(file)) errors.push('unsafe-file');
  }
  for (const command of list(dispatch.testsToRun)) {
    if (!SAFE_TEST_COMMAND_PATTERN.test(command) || FORBIDDEN_TEXT_PATTERN.test(command)) errors.push('unsafe-test-command');
  }
  if (dispatch.guardrails?.localPatchOnly !== true) errors.push('local-patch-only-not-enforced');
  if (dispatch.guardrails?.originReadsAllowed !== false) errors.push('origin-read-not-blocked');
  if (dispatch.guardrails?.pushAllowed !== false) errors.push('push-not-blocked');
  if (!Object.values(GITHUB_CODEX_MISSION_DISPATCH_STATUS).includes(dispatch.status)) errors.push('invalid-status');
  return Object.freeze({
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length ? 'GITHUB_CODEX_MISSION_DISPATCH_INVALID' : 'GITHUB_CODEX_MISSION_DISPATCH_VALID',
  });
}

export const createGithubCodexDispatch = createGithubCodexMissionDispatch;
export const validateGithubCodexDispatch = validateGithubCodexMissionDispatch;
