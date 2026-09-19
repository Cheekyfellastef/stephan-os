import {
  CODEX_DISPATCH_QUEUE_KIND,
  CODEX_DISPATCH_QUEUE_SCHEMA_VERSION,
  validateCodexQueueRecord,
} from './codexDispatchQueue.mjs';

export const PROVIDER_NEUTRAL_TASK_ENVELOPE_SCHEMA_VERSION = 'stephanos.provider-neutral-task-envelope.v1';
export const PROVIDER_NEUTRAL_TASK_ENVELOPE_KIND = 'stephanos.provider-neutral.execution.task';
export const PROVIDER_NEUTRAL_RESULT_ENVELOPE_SCHEMA_VERSION = 'stephanos.provider-neutral-result-envelope.v1';
export const PROVIDER_NEUTRAL_RESULT_ENVELOPE_KIND = 'stephanos.provider-neutral.execution.result';
export const PROVIDER_NEUTRAL_EXECUTION_ADAPTER_CONTRACT_VERSION = 'stephanos.provider-neutral-execution-adapter.v1';
export const PROVIDER_NEUTRAL_REFILL_PLAN_SCHEMA_VERSION = 'stephanos.continuous-capacity-refill-plan.v1';

export const PROVIDER_NEUTRAL_EXECUTION_ADAPTERS_V1 = Object.freeze([
  'legacy-codex',
  'github-first',
  'forge',
  'openclaw',
]);

export const PROVIDER_NEUTRAL_REFILL_TRIGGERS_V1 = Object.freeze([
  'TASK_COMPLETE',
  'TASK_BLOCKED_AND_LEASE_RELEASED',
  'TASK_CANCELLED_AND_LEASE_RELEASED',
  'PROVIDER_CAPACITY_BECAME_AVAILABLE',
  'LANE_CAPACITY_RELEASED',
  'QUALIFIED_PROVIDER_ADDED_OR_RESTORED',
]);

export const PROVIDER_NEUTRAL_HARD_DENIALS_V1 = Object.freeze([
  'arbitrary-shell',
  'credential-access',
  'destructive-git',
  'direct-main-write',
  'force-push',
  'merge',
  'deployment',
  'pc-restart',
  'spending',
]);

const SHA40 = /^[0-9a-f]{40}$/;
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,180}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:#-]{0,160}$/;
const SAFE_OPERATION = /^[a-z][a-z0-9._:-]{0,80}$/;
const SAFE_PROOF_REF = /^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,80}|(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9._/-]{1,220})$/;
const SAFE_COMMAND_PATH_TOKEN = /^[A-Za-z0-9_.@/-]+$/;
const FORBIDDEN_SENSITIVE_TEXT = /(?:token|secret|password|private[ _-]?key|\.env|session)/i;
const RESULT_VERDICTS = new Set(['complete', 'blocked', 'failed', 'cancelled', 'partial']);
const TASK_ENVELOPE_KEYS = new Set([
  'schemaVersion', 'kind', 'adapterContractVersion', 'missionId', 'goalId', 'taskId', 'taskClass',
  'correlationId', 'repository', 'branch', 'exactBase', 'exactHeadIfReadOnly', 'expectedStartingHeadIfMutable',
  'allowedPaths', 'allowedOperations', 'allowedCommandsOrTestIds', 'forbiddenOperations', 'timeoutAndRetryBudget',
  'resourceLeaseIds', 'requiredTests', 'requiredArtifacts', 'requiredEvidence', 'completionContract',
  'operatorApprovalState', 'portableCheckpointRef', 'createdAtUtc', 'expiresAtUtc', 'sourceAdapter',
]);
const RESULT_ENVELOPE_KEYS = new Set([
  'schemaVersion', 'kind', 'adapterContractVersion', 'provider', 'providerInstance', 'providerVersion', 'taskClass',
  'missionId', 'goalId', 'taskId', 'correlationId', 'exactInputIdentity', 'exactOutputIdentity', 'authorityUsed',
  'commandsOrTestIdsExecuted', 'changedPaths', 'artifacts', 'proofRefs', 'portableCheckpointRef', 'startedAtUtc',
  'completedAtUtc', 'verdict', 'blockers', 'retryState', 'leaseDisposition',
]);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item)).filter(Boolean))];
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expectedKeys) {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.size && keys.every((key) => expectedKeys.has(key));
}

function isSafeId(value) {
  const normalized = text(value);
  return SAFE_ID.test(normalized) && !FORBIDDEN_SENSITIVE_TEXT.test(normalized);
}

function isSafeBranch(value) {
  const normalized = text(value).replace(/\\/g, '/');
  return SAFE_BRANCH.test(normalized)
    && !normalized.includes('..')
    && !FORBIDDEN_SENSITIVE_TEXT.test(normalized);
}

function isSafePath(value) {
  const normalized = text(value).replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.startsWith('//') || /^[a-z]:\//i.test(normalized)) return false;
  if (normalized.split('/').some((part) => part === '..' || part === '.git')) return false;
  return !FORBIDDEN_SENSITIVE_TEXT.test(normalized);
}

function isBoundedText(value, max = 1000) {
  const normalized = text(value);
  return normalized.length > 0
    && normalized.length <= max
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(normalized);
}

function isSafeNodePathToken(value) {
  const normalized = text(value);
  return SAFE_COMMAND_PATH_TOKEN.test(normalized)
    && !normalized.startsWith('/')
    && !normalized.startsWith('-')
    && !normalized.includes('..')
    && /\.(?:mjs|cjs|js)$/.test(normalized)
    && !FORBIDDEN_SENSITIVE_TEXT.test(normalized);
}

function isSafeLegacyCommand(value) {
  const normalized = text(value);
  if (!isBoundedText(normalized, 500) || FORBIDDEN_SENSITIVE_TEXT.test(normalized)) return false;
  if (/[\r\n;&|<>`$()\\]/.test(normalized)) return false;
  const tokens = normalized.split(/\s+/);
  const executable = tokens.shift()?.toLowerCase();
  if (executable === 'git') {
    return tokens.length === 2 && tokens[0] === 'diff' && tokens[1] === '--check';
  }
  if (executable === 'npm') {
    return tokens.length === 1 && tokens[0] === 'test';
  }
  if (executable === 'node') {
    if (tokens[0] === '--check') return tokens.length === 2 && isSafeNodePathToken(tokens[1]);
    if (tokens[0] === '--test') return tokens.length >= 2 && tokens.slice(1).every((item) => isSafeNodePathToken(item));
  }
  return false;
}

function isSafeCommandOrTestId(value) {
  const normalized = text(value);
  if (!isBoundedText(normalized, 500) || FORBIDDEN_SENSITIVE_TEXT.test(normalized)) return false;
  if (!/\s/.test(normalized)) return SAFE_ID.test(normalized);
  return isSafeLegacyCommand(normalized);
}

function isSafeProofRef(value) {
  const normalized = text(value).replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.startsWith('//') || /^[a-z]:\//i.test(normalized)) return false;
  if (normalized.split('/').some((part) => part === '..')) return false;
  return SAFE_PROOF_REF.test(normalized) && !FORBIDDEN_SENSITIVE_TEXT.test(normalized);
}

function exactSha(value) {
  const normalized = text(value).toLowerCase();
  return SHA40.test(normalized) ? normalized : '';
}

function normalizedApprovalState(value = {}) {
  return Object.freeze({
    requiresOperatorApprovalBeforeDispatch: value?.requiresOperatorApprovalBeforeDispatch === true,
    dispatchApprovalPresent: value?.dispatchApprovalPresent === true,
    requiresExactHeadApproval: value?.requiresExactHeadApproval !== false,
    requiresOperatorApprovalBeforeMerge: value?.requiresOperatorApprovalBeforeMerge !== false,
    mergeApprovalPresent: value?.mergeApprovalPresent === true,
  });
}

function normalizedRetryBudget(value = {}) {
  const timeoutMs = Number.parseInt(value?.timeoutMs, 10);
  const maxAttempts = Number.parseInt(value?.maxAttempts, 10);
  return Object.freeze({
    timeoutMs: Number.isSafeInteger(timeoutMs) && timeoutMs >= 1_000 && timeoutMs <= 86_400_000 ? timeoutMs : 300_000,
    maxAttempts: Number.isSafeInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 10 ? maxAttempts : 1,
  });
}

function approvalBlocksDispatch(task) {
  return task?.operatorApprovalState?.requiresOperatorApprovalBeforeDispatch === true
    && task.operatorApprovalState.dispatchApprovalPresent !== true;
}

function sourceScopeKey(task) {
  return JSON.stringify([
    task.repository,
    task.branch,
    task.expectedStartingHeadIfMutable || task.exactHeadIfReadOnly,
    [...task.allowedPaths].sort(),
  ]);
}

export function createProviderNeutralTaskEnvelope(input = {}) {
  const hardDenials = new Set([
    ...PROVIDER_NEUTRAL_HARD_DENIALS_V1,
    ...uniqueStrings(input.forbiddenOperations).map((item) => item.toLowerCase()),
  ]);
  return Object.freeze({
    schemaVersion: PROVIDER_NEUTRAL_TASK_ENVELOPE_SCHEMA_VERSION,
    kind: PROVIDER_NEUTRAL_TASK_ENVELOPE_KIND,
    adapterContractVersion: PROVIDER_NEUTRAL_EXECUTION_ADAPTER_CONTRACT_VERSION,
    missionId: text(input.missionId),
    goalId: text(input.goalId),
    taskId: text(input.taskId),
    taskClass: text(input.taskClass).toLowerCase(),
    correlationId: text(input.correlationId),
    repository: text(input.repository),
    branch: text(input.branch).replace(/\\/g, '/'),
    exactBase: exactSha(input.exactBase),
    exactHeadIfReadOnly: exactSha(input.exactHeadIfReadOnly),
    expectedStartingHeadIfMutable: exactSha(input.expectedStartingHeadIfMutable),
    allowedPaths: Object.freeze(uniqueStrings(input.allowedPaths).map((item) => item.replace(/\\/g, '/'))),
    allowedOperations: Object.freeze(uniqueStrings(input.allowedOperations).map((item) => item.toLowerCase())),
    allowedCommandsOrTestIds: Object.freeze(uniqueStrings(input.allowedCommandsOrTestIds)),
    forbiddenOperations: Object.freeze([...hardDenials].sort()),
    timeoutAndRetryBudget: normalizedRetryBudget(input.timeoutAndRetryBudget),
    resourceLeaseIds: Object.freeze(uniqueStrings(input.resourceLeaseIds)),
    requiredTests: Object.freeze(uniqueStrings(input.requiredTests)),
    requiredArtifacts: Object.freeze(uniqueStrings(input.requiredArtifacts).map((item) => item.replace(/\\/g, '/'))),
    requiredEvidence: Object.freeze(uniqueStrings(input.requiredEvidence).map((item) => item.replace(/\\/g, '/'))),
    completionContract: text(input.completionContract),
    operatorApprovalState: normalizedApprovalState(input.operatorApprovalState),
    portableCheckpointRef: text(input.portableCheckpointRef).replace(/\\/g, '/'),
    createdAtUtc: text(input.createdAtUtc),
    expiresAtUtc: text(input.expiresAtUtc),
    sourceAdapter: text(input.sourceAdapter).toLowerCase(),
  });
}

export function validateProviderNeutralTaskEnvelope(task) {
  const errors = [];
  if (!isPlainObject(task)) return Object.freeze({ valid: false, errors: Object.freeze(['task-not-object']), finalVerdict: 'PROVIDER_NEUTRAL_TASK_ENVELOPE_BLOCKED' });
  if (!hasExactKeys(task, TASK_ENVELOPE_KEYS)) errors.push('task-envelope-fields-invalid');
  if (task.schemaVersion !== PROVIDER_NEUTRAL_TASK_ENVELOPE_SCHEMA_VERSION) errors.push('schema-version-invalid');
  if (task.kind !== PROVIDER_NEUTRAL_TASK_ENVELOPE_KIND) errors.push('kind-invalid');
  if (task.adapterContractVersion !== PROVIDER_NEUTRAL_EXECUTION_ADAPTER_CONTRACT_VERSION) errors.push('adapter-contract-version-invalid');
  for (const [field, value] of [['missionId', task.missionId], ['goalId', task.goalId], ['taskId', task.taskId], ['taskClass', task.taskClass], ['correlationId', task.correlationId]]) {
    if (!isSafeId(value)) errors.push(`${field}-invalid`);
  }
  if (!SAFE_REPOSITORY.test(text(task.repository)) || FORBIDDEN_SENSITIVE_TEXT.test(text(task.repository))) errors.push('repository-invalid');
  if (!isSafeBranch(task.branch)) errors.push('branch-invalid');
  if (!exactSha(task.exactBase)) errors.push('exact-base-invalid');
  const readOnlyHead = exactSha(task.exactHeadIfReadOnly);
  const mutableHead = exactSha(task.expectedStartingHeadIfMutable);
  if (Boolean(readOnlyHead) === Boolean(mutableHead)) errors.push('exactly-one-source-head-mode-required');
  if (!Array.isArray(task.allowedPaths) || task.allowedPaths.some((item) => !isSafePath(item))) errors.push('allowed-paths-invalid');
  if (!Array.isArray(task.allowedOperations) || task.allowedOperations.some((item) => !SAFE_OPERATION.test(text(item)))) errors.push('allowed-operations-invalid');
  if (task.allowedOperations.some((item) => PROVIDER_NEUTRAL_HARD_DENIALS_V1.includes(text(item).toLowerCase()))) errors.push('authority-widening-operation');
  if (!Array.isArray(task.forbiddenOperations) || PROVIDER_NEUTRAL_HARD_DENIALS_V1.some((item) => !task.forbiddenOperations.includes(item))) errors.push('hard-denials-missing');
  if (!Array.isArray(task.allowedCommandsOrTestIds) || task.allowedCommandsOrTestIds.some((item) => !isSafeCommandOrTestId(item))) errors.push('allowed-command-or-test-id-invalid');
  if (!isPlainObject(task.timeoutAndRetryBudget)
    || !Number.isSafeInteger(task.timeoutAndRetryBudget.timeoutMs)
    || task.timeoutAndRetryBudget.timeoutMs < 1_000
    || task.timeoutAndRetryBudget.timeoutMs > 86_400_000
    || !Number.isSafeInteger(task.timeoutAndRetryBudget.maxAttempts)
    || task.timeoutAndRetryBudget.maxAttempts < 1
    || task.timeoutAndRetryBudget.maxAttempts > 10) errors.push('timeout-retry-budget-invalid');
  if (!Array.isArray(task.resourceLeaseIds) || task.resourceLeaseIds.length === 0 || task.resourceLeaseIds.some((item) => !isSafeId(item))) errors.push('resource-lease-ids-invalid');
  if (!Array.isArray(task.requiredTests) || task.requiredTests.some((item) => !isSafeCommandOrTestId(item))) errors.push('required-tests-invalid');
  if (!Array.isArray(task.requiredArtifacts) || task.requiredArtifacts.some((item) => !isSafePath(item))) errors.push('required-artifacts-invalid');
  if (!Array.isArray(task.requiredEvidence) || task.requiredEvidence.some((item) => !isSafeProofRef(item))) errors.push('required-evidence-invalid');
  if (!isBoundedText(task.completionContract, 1000)) errors.push('completion-contract-invalid');
  if (!isPlainObject(task.operatorApprovalState)) errors.push('operator-approval-state-invalid');
  if (task.operatorApprovalState?.requiresExactHeadApproval !== true) errors.push('exact-head-approval-required');
  if (task.operatorApprovalState?.mergeApprovalPresent === true) errors.push('merge-approval-must-not-be-carried-by-task-envelope');
  if (task.portableCheckpointRef && !isSafeProofRef(task.portableCheckpointRef)) errors.push('portable-checkpoint-ref-invalid');
  if (!Number.isFinite(Date.parse(task.createdAtUtc))) errors.push('created-at-invalid');
  if (!Number.isFinite(Date.parse(task.expiresAtUtc)) || Date.parse(task.expiresAtUtc) <= Date.parse(task.createdAtUtc)) errors.push('expires-at-invalid');
  if (!PROVIDER_NEUTRAL_EXECUTION_ADAPTERS_V1.includes(task.sourceAdapter)) errors.push('source-adapter-invalid');
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    finalVerdict: errors.length === 0 ? 'PROVIDER_NEUTRAL_TASK_ENVELOPE_PASS' : 'PROVIDER_NEUTRAL_TASK_ENVELOPE_BLOCKED',
  });
}

export function adaptLegacyCodexQueueRecordV1(record, context = {}) {
  const queueValidation = validateCodexQueueRecord(record);
  if (!queueValidation.valid) {
    return Object.freeze({ ok: false, blocker: 'LEGACY_CODEX_QUEUE_RECORD_INVALID', errors: queueValidation.errors || [] });
  }
  if (record.schemaVersion !== CODEX_DISPATCH_QUEUE_SCHEMA_VERSION || record.kind !== CODEX_DISPATCH_QUEUE_KIND) {
    return Object.freeze({ ok: false, blocker: 'LEGACY_CODEX_QUEUE_SCHEMA_UNSUPPORTED', errors: [] });
  }
  if (context.branch && text(context.branch) !== record.branch) {
    return Object.freeze({ ok: false, blocker: 'LEGACY_CODEX_QUEUE_BRANCH_MISMATCH', errors: [] });
  }
  const proof = record.exactHeadProof;
  if (!proof || !exactSha(proof.expectedHead) || !SAFE_REPOSITORY.test(text(proof.repository))) {
    return Object.freeze({ ok: false, blocker: 'LEGACY_CODEX_QUEUE_EXACT_SOURCE_UNPROVEN', errors: [] });
  }
  if (context.repository && text(context.repository) !== proof.repository) {
    return Object.freeze({ ok: false, blocker: 'LEGACY_CODEX_QUEUE_REPOSITORY_MISMATCH', errors: [] });
  }
  const envelope = createProviderNeutralTaskEnvelope({
    missionId: context.missionId,
    goalId: context.goalId || `goal-${record.issueNumber}`,
    taskId: record.jobId,
    taskClass: context.taskClass,
    correlationId: context.correlationId || `issue-${record.issueNumber}`,
    repository: proof.repository,
    branch: record.branch,
    exactBase: context.exactBase,
    exactHeadIfReadOnly: context.readOnly === true ? proof.expectedHead : '',
    expectedStartingHeadIfMutable: context.readOnly === true ? '' : context.expectedStartingHeadIfMutable,
    allowedPaths: context.allowedPaths,
    allowedOperations: context.allowedOperations,
    allowedCommandsOrTestIds: record.requestedProofCommands,
    forbiddenOperations: context.forbiddenOperations,
    timeoutAndRetryBudget: context.timeoutAndRetryBudget,
    resourceLeaseIds: context.resourceLeaseIds,
    requiredTests: record.requestedProofCommands,
    requiredArtifacts: context.requiredArtifacts,
    requiredEvidence: record.proofRequirements?.refs,
    completionContract: context.completionContract,
    operatorApprovalState: {
      requiresOperatorApprovalBeforeDispatch: record.approvalRequirements?.requiresOperatorApprovalBeforeDispatch === true,
      dispatchApprovalPresent: Boolean(record.approvalRequirements?.approvalReceipt),
      requiresExactHeadApproval: record.approvalRequirements?.requiresExactHeadApproval !== false,
      requiresOperatorApprovalBeforeMerge: record.approvalRequirements?.requiresOperatorApprovalBeforeMerge !== false,
      mergeApprovalPresent: false,
    },
    portableCheckpointRef: context.portableCheckpointRef,
    createdAtUtc: context.createdAtUtc || record.createdAt,
    expiresAtUtc: context.expiresAtUtc,
    sourceAdapter: 'legacy-codex',
  });
  const validation = validateProviderNeutralTaskEnvelope(envelope);
  if (!validation.valid) {
    return Object.freeze({ ok: false, blocker: 'LEGACY_CODEX_QUEUE_ADAPTATION_BLOCKED', errors: validation.errors, envelope: null });
  }
  return Object.freeze({
    ok: true,
    blocker: '',
    envelope,
    legacyIdentity: Object.freeze({
      schemaVersion: record.schemaVersion,
      kind: record.kind,
      jobId: record.jobId,
      status: record.status,
    }),
    authority: Object.freeze({
      sourceMutationAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      runtimeMutationAllowed: false,
      credentialAccessAllowed: false,
      spendingAllowed: false,
    }),
    finalVerdict: 'LEGACY_CODEX_QUEUE_ADAPTED_TO_PROVIDER_NEUTRAL_TASK_V1',
  });
}

export function createProviderNeutralResultEnvelope(input = {}) {
  return Object.freeze({
    schemaVersion: PROVIDER_NEUTRAL_RESULT_ENVELOPE_SCHEMA_VERSION,
    kind: PROVIDER_NEUTRAL_RESULT_ENVELOPE_KIND,
    adapterContractVersion: PROVIDER_NEUTRAL_EXECUTION_ADAPTER_CONTRACT_VERSION,
    provider: text(input.provider).toLowerCase(),
    providerInstance: text(input.providerInstance),
    providerVersion: text(input.providerVersion),
    taskClass: text(input.taskClass).toLowerCase(),
    missionId: text(input.missionId),
    goalId: text(input.goalId),
    taskId: text(input.taskId),
    correlationId: text(input.correlationId),
    exactInputIdentity: exactSha(input.exactInputIdentity),
    exactOutputIdentity: exactSha(input.exactOutputIdentity),
    authorityUsed: Object.freeze(uniqueStrings(input.authorityUsed).map((item) => item.toLowerCase())),
    commandsOrTestIdsExecuted: Object.freeze(uniqueStrings(input.commandsOrTestIdsExecuted)),
    changedPaths: Object.freeze(uniqueStrings(input.changedPaths).map((item) => item.replace(/\\/g, '/'))),
    artifacts: Object.freeze(uniqueStrings(input.artifacts).map((item) => item.replace(/\\/g, '/'))),
    proofRefs: Object.freeze(uniqueStrings(input.proofRefs).map((item) => item.replace(/\\/g, '/'))),
    portableCheckpointRef: text(input.portableCheckpointRef).replace(/\\/g, '/'),
    startedAtUtc: text(input.startedAtUtc),
    completedAtUtc: text(input.completedAtUtc),
    verdict: text(input.verdict).toLowerCase(),
    blockers: Object.freeze(uniqueStrings(input.blockers)),
    retryState: text(input.retryState).toLowerCase(),
    leaseDisposition: text(input.leaseDisposition).toLowerCase(),
  });
}

export function validateProviderNeutralResultEnvelope(result, task) {
  const errors = [];
  const taskValidation = validateProviderNeutralTaskEnvelope(task);
  if (!taskValidation.valid) errors.push('task-envelope-invalid');
  if (!isPlainObject(result)) return Object.freeze({ valid: false, errors: Object.freeze(['result-not-object']), finalVerdict: 'PROVIDER_NEUTRAL_RESULT_ENVELOPE_BLOCKED' });
  if (!hasExactKeys(result, RESULT_ENVELOPE_KEYS)) errors.push('result-envelope-fields-invalid');
  if (result.schemaVersion !== PROVIDER_NEUTRAL_RESULT_ENVELOPE_SCHEMA_VERSION) errors.push('schema-version-invalid');
  if (result.kind !== PROVIDER_NEUTRAL_RESULT_ENVELOPE_KIND) errors.push('kind-invalid');
  if (result.adapterContractVersion !== PROVIDER_NEUTRAL_EXECUTION_ADAPTER_CONTRACT_VERSION) errors.push('adapter-contract-version-invalid');
  if (!PROVIDER_NEUTRAL_EXECUTION_ADAPTERS_V1.includes(result.provider)) errors.push('provider-invalid');
  for (const [field, value] of [['providerInstance', result.providerInstance], ['providerVersion', result.providerVersion], ['taskClass', result.taskClass], ['missionId', result.missionId], ['goalId', result.goalId], ['taskId', result.taskId], ['correlationId', result.correlationId]]) {
    if (!isSafeId(value)) errors.push(`${field}-invalid`);
  }
  if (taskValidation.valid) {
    for (const field of ['taskClass', 'missionId', 'goalId', 'taskId', 'correlationId']) {
      if (result[field] !== task[field]) errors.push(`${field}-mismatch`);
    }
    const expectedInput = task.exactHeadIfReadOnly || task.expectedStartingHeadIfMutable;
    if (result.exactInputIdentity !== expectedInput) errors.push('exact-input-identity-mismatch');
    if (task.exactHeadIfReadOnly && result.exactOutputIdentity !== expectedInput) errors.push('read-only-output-identity-mismatch');
    if (task.exactHeadIfReadOnly && result.changedPaths.length > 0) errors.push('read-only-task-changed-paths');
    if (result.authorityUsed.some((item) => !task.allowedOperations.includes(item))) errors.push('authority-used-outside-task');
    if (result.commandsOrTestIdsExecuted.some((item) => !task.allowedCommandsOrTestIds.includes(item))) errors.push('command-or-test-outside-task');
    if (result.changedPaths.some((item) => !task.allowedPaths.includes(item))) errors.push('changed-path-outside-task');
  }
  if (!result.exactOutputIdentity || !exactSha(result.exactOutputIdentity)) errors.push('exact-output-identity-invalid');
  if (!Array.isArray(result.authorityUsed) || result.authorityUsed.some((item) => !SAFE_OPERATION.test(text(item)) || PROVIDER_NEUTRAL_HARD_DENIALS_V1.includes(item))) errors.push('authority-used-invalid');
  if (!Array.isArray(result.commandsOrTestIdsExecuted) || result.commandsOrTestIdsExecuted.some((item) => !isSafeCommandOrTestId(item))) errors.push('commands-or-tests-invalid');
  if (!Array.isArray(result.changedPaths) || result.changedPaths.some((item) => !isSafePath(item))) errors.push('changed-paths-invalid');
  if (!Array.isArray(result.artifacts) || result.artifacts.some((item) => !isSafePath(item))) errors.push('artifacts-invalid');
  if (!Array.isArray(result.proofRefs) || result.proofRefs.some((item) => !isSafeProofRef(item))) errors.push('proof-refs-invalid');
  if (result.portableCheckpointRef && !isSafeProofRef(result.portableCheckpointRef)) errors.push('portable-checkpoint-ref-invalid');
  if (!Number.isFinite(Date.parse(result.startedAtUtc)) || !Number.isFinite(Date.parse(result.completedAtUtc)) || Date.parse(result.completedAtUtc) < Date.parse(result.startedAtUtc)) errors.push('result-time-invalid');
  if (!RESULT_VERDICTS.has(result.verdict)) errors.push('verdict-invalid');
  if (!Array.isArray(result.blockers) || result.blockers.some((item) => !isBoundedText(item, 240))) errors.push('blockers-invalid');
  if (!['none', 'retryable', 'exhausted', 'handoff-ready'].includes(result.retryState)) errors.push('retry-state-invalid');
  if (!['held', 'released', 'not-applicable'].includes(result.leaseDisposition)) errors.push('lease-disposition-invalid');
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    finalVerdict: errors.length === 0 ? 'PROVIDER_NEUTRAL_RESULT_ENVELOPE_PASS' : 'PROVIDER_NEUTRAL_RESULT_ENVELOPE_BLOCKED',
  });
}

export function planContinuousCapacityRefillV1(input = {}) {
  const releaseEvent = input.releaseEvent || {};
  const trigger = text(releaseEvent.trigger).toUpperCase();
  const eventId = text(releaseEvent.eventId);
  const correlationId = text(releaseEvent.correlationId);
  const seenEventKeys = new Set(uniqueStrings(input.seenEventKeys));
  const releaseSlots = Number.parseInt(releaseEvent.releasedSlots, 10);
  const boundedSlots = Number.isSafeInteger(releaseSlots) && releaseSlots >= 1 && releaseSlots <= 5 ? releaseSlots : 1;
  const eventKey = `${trigger}:${eventId}:${correlationId}`;
  const zeroAuthority = Object.freeze({
    dispatchAllowed: false,
    sourceMutationAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    credentialAccessAllowed: false,
    spendingAllowed: false,
  });
  const base = {
    schemaVersion: PROVIDER_NEUTRAL_REFILL_PLAN_SCHEMA_VERSION,
    eventKey,
    trigger,
    evaluated: false,
    refillRequests: Object.freeze([]),
    heldTasks: Object.freeze([]),
    authority: zeroAuthority,
  };
  if (!PROVIDER_NEUTRAL_REFILL_TRIGGERS_V1.includes(trigger) || !isSafeId(eventId) || !isSafeId(correlationId)) {
    return Object.freeze({ ...base, blocker: 'REFILL_RELEASE_EVENT_INVALID', finalVerdict: 'CONTINUOUS_CAPACITY_REFILL_BLOCKED' });
  }
  if (seenEventKeys.has(eventKey)) {
    return Object.freeze({ ...base, evaluated: true, blocker: '', finalVerdict: 'CONTINUOUS_CAPACITY_REFILL_ALREADY_EVALUATED' });
  }
  const candidates = Array.isArray(input.schedulerDecision?.selectedTasks) ? input.schedulerDecision.selectedTasks : [];
  const activeLeaseIds = new Set(uniqueStrings(input.activeLeaseIds));
  const selectedLeaseIds = new Set();
  const selectedScopes = new Set();
  const selected = [];
  const held = [];
  for (const task of candidates) {
    const validation = validateProviderNeutralTaskEnvelope(task);
    if (!validation.valid) {
      held.push(Object.freeze({ taskId: text(task?.taskId), reason: 'TASK_ENVELOPE_INVALID' }));
      continue;
    }
    if (approvalBlocksDispatch(task)) {
      held.push(Object.freeze({ taskId: task.taskId, reason: 'OPERATOR_APPROVAL_REQUIRED' }));
      continue;
    }
    if (task.resourceLeaseIds.some((leaseId) => activeLeaseIds.has(leaseId))) {
      held.push(Object.freeze({ taskId: task.taskId, reason: 'RESOURCE_LEASE_ACTIVE' }));
      continue;
    }
    if (task.resourceLeaseIds.some((leaseId) => selectedLeaseIds.has(leaseId))) {
      held.push(Object.freeze({ taskId: task.taskId, reason: 'RESOURCE_LEASE_DUPLICATE' }));
      continue;
    }
    const scope = sourceScopeKey(task);
    if (selectedScopes.has(scope)) {
      held.push(Object.freeze({ taskId: task.taskId, reason: 'RESOURCE_SCOPE_DUPLICATE' }));
      continue;
    }
    selectedScopes.add(scope);
    for (const leaseId of task.resourceLeaseIds) selectedLeaseIds.add(leaseId);
    selected.push(Object.freeze({
      missionId: task.missionId,
      goalId: task.goalId,
      taskId: task.taskId,
      correlationId: task.correlationId,
      taskClass: task.taskClass,
      sourceAdapter: task.sourceAdapter,
      resourceLeaseIds: task.resourceLeaseIds,
      taskEnvelope: task,
    }));
    if (selected.length >= boundedSlots) break;
  }
  if (selected.length === 0) {
    return Object.freeze({
      ...base,
      evaluated: true,
      blocker: '',
      heldTasks: Object.freeze(held),
      finalVerdict: candidates.length === 0 ? 'CONTINUOUS_CAPACITY_REFILL_IDLE_NO_ELIGIBLE_WORK' : 'CONTINUOUS_CAPACITY_REFILL_HELD',
    });
  }
  return Object.freeze({
    ...base,
    evaluated: true,
    blocker: '',
    refillRequests: Object.freeze(selected),
    heldTasks: Object.freeze(held),
    finalVerdict: 'CONTINUOUS_CAPACITY_REFILL_READY',
  });
}
