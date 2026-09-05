const MAX_REPAIR_ROUNDS = 3;
const SHA40_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MISSION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_BRANCH_PATTERN = /^(?:codex|openclaw|orchestrator)\/[a-z0-9][a-z0-9._/-]{2,127}$/;
const FORBIDDEN_PATH_PATTERN = /(^|\/)(apps\/stephanos\/dist|stephanos-server\/data|runtime|runtime-data|root-data|root data|data|tmp|\.git|node_modules)(\/|$)|(^|\/)\.env(\.|$)|\.(pem|pfx|key)$/i;
const RECEIPT_PATH_PATTERN = /^(?:proof|proofs|receipts|evidence\/receipts)\//;

export const MISSION_ORCHESTRATOR_SCHEMA_VERSION = 'stephanos.mission-orchestrator.v1';
export const MISSION_ORCHESTRATOR_EVENT_SCHEMA_VERSION = 'stephanos.mission-orchestrator-event.v1';
export const MISSION_ORCHESTRATOR_MAX_REPAIR_ROUNDS = MAX_REPAIR_ROUNDS;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function unique(values) {
  return [...new Set(values)];
}

function normalizePath(value) {
  return text(value).replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function isUnsafePath(value) {
  const path = normalizePath(value);
  return !path
    || path.startsWith('/')
    || /^[a-z]:\//i.test(path)
    || path.split('/').includes('..')
    || FORBIDDEN_PATH_PATTERN.test(path)
    || /secret|token/i.test(path);
}

function iso(value, fallback = '') {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function nowIso(options = {}) {
  return options.now instanceof Date ? options.now.toISOString() : new Date().toISOString();
}

function clone(value) {
  return structuredClone(value);
}

function missionKind(input = {}) {
  const explicit = text(input.missionKind).toLowerCase();
  if (['implementation', 'live-runtime-investigation', 'github-operation'].includes(explicit)) return explicit;
  const intent = `${text(input.operatorIntent)} ${text(input.intendedOutcome)}`.toLowerCase();
  if (/browser|runtime|live.*inspect|screenshot|investigat/.test(intent) && !/implement|edit|write|build|fix/.test(intent)) {
    return 'live-runtime-investigation';
  }
  if (/implement|edit|write|build|fix|repair|code|patch/.test(intent)) return 'implementation';
  if (/pull request|github|merge|branch|worktree|check/.test(intent)) return 'github-operation';
  return 'unknown';
}

function exactMergeApproval(prNumber, headSha) {
  return `APPROVE_OPENCLAW_SQUASH_MERGE:${prNumber}:${headSha}`;
}

function validReceipt(receipt = {}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return false;
  if (!text(receipt.requirement) || !text(receipt.source) || !text(receipt.evidenceType) || receipt.verified !== true) return false;
  if (SHA256_PATTERN.test(text(receipt.sha256))) return true;
  if (SHA256_PATTERN.test(text(receipt.commandOutputHash))) return true;
  if (Number.isInteger(receipt.exitCode) && receipt.exitCode === 0) return true;
  const path = normalizePath(receipt.receiptPath);
  return Boolean(path) && RECEIPT_PATH_PATTERN.test(path) && !isUnsafePath(path);
}

function sanitizeReceipt(receipt = {}) {
  if (!validReceipt(receipt)) return null;
  const sanitized = {
    receiptId: text(receipt.receiptId || receipt.id, `receipt-${text(receipt.requirement).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`),
    requirement: text(receipt.requirement),
    source: text(receipt.source),
    evidenceType: text(receipt.evidenceType),
    verified: true,
    createdAt: iso(receipt.createdAt),
  };
  if (SHA256_PATTERN.test(text(receipt.sha256))) sanitized.sha256 = text(receipt.sha256);
  if (SHA256_PATTERN.test(text(receipt.commandOutputHash))) sanitized.commandOutputHash = text(receipt.commandOutputHash);
  if (Number.isInteger(receipt.exitCode) && receipt.exitCode === 0) sanitized.exitCode = 0;
  if (RECEIPT_PATH_PATTERN.test(normalizePath(receipt.receiptPath))) sanitized.receiptPath = normalizePath(receipt.receiptPath);
  return sanitized;
}

function normalizedRequirement(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function evidenceSatisfied(state) {
  return state.requiredEvidence.every((requirement) => state.evidenceReceipts.some(
    (receipt) => normalizedRequirement(receipt.requirement) === normalizedRequirement(requirement),
  ));
}

function checksPassing(checks = []) {
  const required = checks.filter((check) => check.required !== false);
  return required.length > 0 && required.every((check) => ['success', 'neutral', 'skipped'].includes(text(check.status).toLowerCase()));
}

function checksFailing(checks = []) {
  return checks.some((check) => check.required !== false && ['failure', 'failed', 'cancelled', 'timed_out', 'action_required'].includes(text(check.status).toLowerCase()));
}

function deploymentComplete(deployment = {}) {
  return ['sync', 'build', 'verify', 'restart'].every((step) => deployment[step]?.status === 'success');
}

function activeAgentForPhase(state) {
  const phase = state.currentPhase;
  if (['CREATE_WORKTREE', 'GITHUB_COMMIT', 'GITHUB_PUSH', 'OPEN_PULL_REQUEST', 'CHECK_PULL_REQUEST', 'MERGE_PULL_REQUEST', 'LOCAL_DEPLOYMENT'].includes(phase)) {
    return { agentId: 'openclaw-standalone', label: 'OpenClaw Standalone', role: 'signed-executor', status: 'ready' };
  }
  if (phase === 'AGENT_IMPLEMENTATION') {
    const adapter = text(state.dispatch?.adapter, 'codex');
    return { agentId: adapter, label: adapter, role: 'source-writer', status: state.dispatch?.status === 'running' ? 'running' : 'ready' };
  }
  if (phase === 'LIVE_RUNTIME_INVESTIGATION') return { agentId: 'openclaw-standalone', label: 'OpenClaw Standalone', role: 'read-only-inspector', status: 'ready' };
  if (phase === 'VERIFYING') return { agentId: 'verification-judge', label: 'Verification Judge', role: 'evidence-judge', status: 'ready' };
  return { agentId: 'none', label: 'None', role: 'none', status: 'idle' };
}

function derivePhase(state) {
  if (state.cancelled) return 'CANCELLED';
  if (state.blockers.length) return 'BLOCKED';
  if (state.missionKind === 'live-runtime-investigation') {
    if (!state.dispatch.startedAt) return 'LIVE_RUNTIME_INVESTIGATION';
    if (state.dispatch.status === 'running') return 'LIVE_RUNTIME_INVESTIGATION';
    return evidenceSatisfied(state) ? 'COMPLETE' : 'VERIFYING';
  }
  if (!state.git.worktreeReady) return 'CREATE_WORKTREE';
  if (!state.dispatch.startedAt || state.dispatch.status === 'running') return 'AGENT_IMPLEMENTATION';
  if (state.dispatch.status !== 'complete') return 'BLOCKED';
  if (!evidenceSatisfied(state)) return 'VERIFYING';
  if (!state.git.commitSha) return 'GITHUB_COMMIT';
  if (!state.git.pushed) return 'GITHUB_PUSH';
  if (!state.pullRequest.number) return 'OPEN_PULL_REQUEST';
  if (checksFailing(state.pullRequest.checks)) {
    return state.repair.currentRound >= MAX_REPAIR_ROUNDS ? 'BLOCKED' : 'REPAIR_REQUIRED';
  }
  if (!checksPassing(state.pullRequest.checks)) return 'CHECK_PULL_REQUEST';
  if (state.approval.status !== 'approved') return 'AWAITING_OPERATOR_APPROVAL';
  if (!state.pullRequest.merged) return 'MERGE_PULL_REQUEST';
  if (!deploymentComplete(state.deployment)) return 'LOCAL_DEPLOYMENT';
  return 'COMPLETE';
}

function nextActionForPhase(state) {
  const actions = {
    CREATE_WORKTREE: { type: 'OPENCLAW_SIGNED_OPERATION', operation: 'create-worktree', owner: 'OpenClaw', approvalRequired: false },
    AGENT_IMPLEMENTATION: { type: 'DISPATCH_AGENT', adapter: text(state.dispatch?.adapter, 'codex'), owner: text(state.dispatch?.adapter, 'codex'), approvalRequired: false },
    LIVE_RUNTIME_INVESTIGATION: { type: 'DISPATCH_AGENT', adapter: 'openclaw-readonly', owner: 'OpenClaw', approvalRequired: false },
    VERIFYING: { type: 'COLLECT_AND_JUDGE_EVIDENCE', owner: 'Verification Judge', approvalRequired: false },
    GITHUB_COMMIT: { type: 'OPENCLAW_SIGNED_OPERATION', operation: 'commit', owner: 'OpenClaw', approvalRequired: false },
    GITHUB_PUSH: { type: 'OPENCLAW_SIGNED_OPERATION', operation: 'push', owner: 'OpenClaw', approvalRequired: false },
    OPEN_PULL_REQUEST: { type: 'OPENCLAW_SIGNED_OPERATION', operation: 'open-pr', owner: 'OpenClaw', approvalRequired: false },
    CHECK_PULL_REQUEST: { type: 'OPENCLAW_SIGNED_OPERATION', operation: 'check-pr', owner: 'OpenClaw', approvalRequired: false },
    REPAIR_REQUIRED: { type: 'DISPATCH_REPAIR', adapter: text(state.dispatch?.adapter, 'codex'), owner: text(state.dispatch?.adapter, 'codex'), approvalRequired: false },
    AWAITING_OPERATOR_APPROVAL: { type: 'REQUEST_OPERATOR_APPROVAL', owner: 'Operator', approvalRequired: true, requiredToken: state.approval.requiredToken },
    MERGE_PULL_REQUEST: { type: 'OPENCLAW_SIGNED_OPERATION', operation: 'merge-pr', owner: 'OpenClaw', approvalRequired: true },
    LOCAL_DEPLOYMENT: { type: 'OPENCLAW_LOCAL_DEPLOYMENT', operation: 'sync-build-verify-restart', owner: 'OpenClaw', approvalRequired: false },
    COMPLETE: { type: 'NONE', owner: 'none', approvalRequired: false },
    BLOCKED: { type: 'STOP_AND_REPORT_BLOCKERS', owner: 'Operator', approvalRequired: true },
    CANCELLED: { type: 'NONE', owner: 'none', approvalRequired: false },
  };
  return actions[state.currentPhase] || actions.BLOCKED;
}

function refreshDerivedState(state, timestamp) {
  state.currentPhase = derivePhase(state);
  if (state.currentPhase === 'BLOCKED' && state.repair.currentRound >= MAX_REPAIR_ROUNDS && !state.blockers.includes('Maximum repair rounds reached.')) {
    state.blockers.push('Maximum repair rounds reached.');
  }
  state.activeAgent = activeAgentForPhase(state);
  state.activeWriter = ['AGENT_IMPLEMENTATION', 'REPAIR_REQUIRED'].includes(state.currentPhase)
    ? (text(state.dispatch?.adapter, 'codex') === 'codex' ? 'Codex' : text(state.dispatch?.adapter, 'codex'))
    : 'none';
  state.nextAction = nextActionForPhase(state);
  state.updatedAt = timestamp;
  state.finalVerdict = state.currentPhase === 'COMPLETE' ? 'MISSION_ORCHESTRATOR_COMPLETE' : state.currentPhase;
  state.operatorActionRequired = ['AWAITING_OPERATOR_APPROVAL', 'BLOCKED'].includes(state.currentPhase);
  return state;
}

function block(state, reason, timestamp) {
  if (reason && !state.blockers.includes(reason)) state.blockers.push(reason);
  return refreshDerivedState(state, timestamp);
}

export function createMissionOrchestratorState(input = {}, options = {}) {
  const timestamp = nowIso(options);
  const resolvedMissionKind = missionKind(input);
  const missionId = text(input.missionId).toLowerCase();
  const allowedFiles = unique(list(input.allowedFiles).map(normalizePath));
  const blockers = [];
  if (!MISSION_ID_PATTERN.test(missionId)) blockers.push('Mission id is missing or invalid.');
  if (!text(input.operatorIntent)) blockers.push('Operator intent is required.');
  if (!text(input.intendedOutcome)) blockers.push('Intended outcome is required.');
  if (!REPOSITORY_PATTERN.test(text(input.repository))) blockers.push('Repository must use owner/name form.');
  if (resolvedMissionKind === 'unknown') blockers.push('Mission kind could not be resolved safely.');
  if (resolvedMissionKind === 'implementation' && !allowedFiles.length) blockers.push('Implementation requires explicit allowed files.');
  const unsafeFiles = allowedFiles.filter(isUnsafePath);
  if (unsafeFiles.length) blockers.push(`Allowed files contain forbidden paths: ${unsafeFiles.join(', ')}`);
  if (!list(input.requiredEvidence).length) blockers.push('Required evidence must be declared before dispatch.');
  if (!list(input.requiredTests).length && resolvedMissionKind === 'implementation') blockers.push('Implementation requires explicit tests.');

  const branch = text(input.branch || `orchestrator/${missionId}`);
  if (!SAFE_BRANCH_PATTERN.test(branch)) blockers.push('Mission branch is missing or outside the approved agent branch families.');
  const state = {
    schemaVersion: MISSION_ORCHESTRATOR_SCHEMA_VERSION,
    missionId,
    title: text(input.title, text(input.intendedOutcome, 'Untitled mission')),
    operatorIntent: text(input.operatorIntent),
    intendedOutcome: text(input.intendedOutcome),
    missionKind: resolvedMissionKind,
    createdAt: timestamp,
    updatedAt: timestamp,
    currentPhase: 'INTAKE',
    finalVerdict: 'INTAKE',
    revision: 0,
    repository: text(input.repository),
    repositoryRoot: text(input.repositoryRoot),
    baseBranch: text(input.baseBranch, 'main'),
    allowedFiles: allowedFiles.filter((path) => !isUnsafePath(path)),
    requiredEvidence: unique(list(input.requiredEvidence).map(text)),
    requiredTests: unique(list(input.requiredTests).map(text)),
    browserProofRequired: input.browserProofRequired === true,
    activeAgent: { agentId: 'none', label: 'None', role: 'none', status: 'idle' },
    supportingAgents: resolvedMissionKind === 'live-runtime-investigation'
      ? [{ agentId: 'codex', label: 'Codex', role: 'reviewer', status: 'waiting' }]
      : [{ agentId: 'openclaw-standalone', label: 'OpenClaw Standalone', role: 'github-executor-and-verifier', status: 'waiting' }],
    activeWriter: 'none',
    simultaneousWritersAllowed: false,
    dispatch: { adapter: resolvedMissionKind === 'live-runtime-investigation' ? 'openclaw-readonly' : 'codex', status: 'pending', actionId: '', workerId: '', startedAt: '', completedAt: '', resultId: '' },
    git: { branch, baseBranch: text(input.baseBranch, 'main'), worktreePath: text(input.worktreePath), worktreeReady: false, changedFiles: [], commitSha: '', pushed: false, clean: false },
    pullRequest: { number: null, url: '', headSha: '', state: 'none', mergeable: false, checks: [], merged: false, mergeCommitSha: '' },
    repair: { currentRound: 0, maximumRounds: MAX_REPAIR_ROUNDS, history: [] },
    approval: { status: 'not-requested', requiredToken: '', suppliedTokenHash: '', requestedAt: '', decidedAt: '' },
    evidenceReceipts: [],
    rejectedEvidenceCount: 0,
    deployment: { sync: { status: 'pending' }, build: { status: 'pending' }, verify: { status: 'pending' }, restart: { status: 'pending' } },
    blockers,
    warnings: [],
    timeline: [{ eventType: 'MISSION_CREATED', timestamp, summary: 'Mission intake state created.' }],
    nextAction: { type: 'STOP_AND_REPORT_BLOCKERS', owner: 'Operator', approvalRequired: true },
    operatorActionRequired: blockers.length > 0,
    cancelled: false,
  };
  return refreshDerivedState(state, timestamp);
}

function appendReceipt(state, receipt) {
  const sanitized = sanitizeReceipt(receipt);
  if (!sanitized) {
    state.rejectedEvidenceCount += 1;
    return false;
  }
  const index = state.evidenceReceipts.findIndex((item) => item.receiptId === sanitized.receiptId);
  if (index >= 0) state.evidenceReceipts[index] = sanitized;
  else state.evidenceReceipts.push(sanitized);
  return true;
}

function normalizeChecks(checks) {
  return list(checks).map((check, index) => ({
    id: text(check.id || check.name, `check-${index + 1}`),
    name: text(check.name || check.id, `Check ${index + 1}`),
    status: text(check.status || check.state, 'unknown').toLowerCase(),
    required: check.required !== false,
    url: text(check.url),
    completedAt: iso(check.completedAt),
  }));
}

export function applyMissionOrchestratorEvent(currentState, event = {}, options = {}) {
  const timestamp = iso(event.timestamp, nowIso(options));
  const state = clone(currentState);
  if (state.schemaVersion !== MISSION_ORCHESTRATOR_SCHEMA_VERSION) return block(state, 'Mission orchestrator state schema is unsupported.', timestamp);
  if (event.schemaVersion && event.schemaVersion !== MISSION_ORCHESTRATOR_EVENT_SCHEMA_VERSION) return block(state, 'Mission orchestrator event schema is unsupported.', timestamp);
  if (text(event.missionId, state.missionId) !== state.missionId) return block(state, 'Event mission id does not match.', timestamp);
  if (['COMPLETE', 'CANCELLED'].includes(state.currentPhase)) return block(state, 'Terminal mission state cannot accept further events.', timestamp);

  const eventType = text(event.eventType).toUpperCase();
  state.revision += 1;
  state.timeline.push({ eventType, timestamp, summary: text(event.summary, eventType) });

  if (eventType === 'WORKTREE_READY') {
    if (state.currentPhase !== 'CREATE_WORKTREE') return block(state, 'Worktree receipt arrived out of sequence.', timestamp);
    if (!appendReceipt(state, event.receipt)) return block(state, 'Worktree creation requires a valid deterministic receipt.', timestamp);
    state.git.worktreeReady = true;
    state.git.worktreePath = text(event.worktreePath, state.git.worktreePath);
    state.git.clean = event.clean === true;
  } else if (eventType === 'AGENT_DISPATCHED') {
    const adapter = text(
      event.adapter,
      text(event.agentId).toLowerCase() === 'openclaw-standalone' ? 'openclaw-readonly' : text(event.agentId),
    ).toLowerCase();
    const allowedAdapters = state.missionKind === 'live-runtime-investigation'
      ? new Set(['openclaw-readonly'])
      : new Set(['codex', 'openclaw-local', 'chatgpt-github', 'foundry-forge']);
    const eventAgent = text(event.agentId).toLowerCase();
    const agentMatches = eventAgent === adapter
      || (eventAgent === 'openclaw-standalone' && adapter === 'openclaw-readonly');
    if (!allowedAdapters.has(adapter) || !agentMatches) {
      return block(state, 'Dispatched agent does not match a registered deterministic adapter.', timestamp);
    }
    if (state.dispatch.status === 'running') return block(state, 'A mission agent is already running.', timestamp);
    const dispatchedActionId = text(event.actionId).toLowerCase();
    const dispatchedWorkerId = text(event.workerId);
    if (!dispatchedActionId || !dispatchedWorkerId) {
      return block(state, 'Agent dispatch requires exact action and worker identity.', timestamp);
    }
    state.dispatch = { ...state.dispatch, adapter, status: 'running', actionId: dispatchedActionId, workerId: dispatchedWorkerId, startedAt: timestamp, completedAt: '', resultId: '' };
  } else if (eventType === 'AGENT_DISPATCH_BINDING_RECONCILED') {
    const actionId = text(event.actionId).toLowerCase();
    const workerId = text(event.workerId);
    const adapter = text(event.adapter).toLowerCase();
    if (state.dispatch.status !== 'running') return block(state, 'Dispatch binding reconciliation requires one running agent.', timestamp);
    if (state.dispatch.actionId || state.dispatch.workerId) return block(state, 'Dispatch binding is already present and cannot be replaced.', timestamp);
    if (!actionId || !workerId || adapter !== state.dispatch.adapter) {
      return block(state, 'Dispatch binding reconciliation identity is incomplete or mismatched.', timestamp);
    }
    state.dispatch.actionId = actionId;
    state.dispatch.workerId = workerId;
  } else if (eventType === 'AGENT_RESULT_RECEIVED') {
    if (state.dispatch.status !== 'running') return block(state, 'Agent result arrived without an active dispatch.', timestamp);
    if (
      text(event.actionId).toLowerCase() !== state.dispatch.actionId
      || text(event.workerId) !== state.dispatch.workerId
    ) {
      return block(state, 'Agent result does not match the active action and worker.', timestamp);
    }
    if (event.success !== true) {
      state.dispatch.status = 'failed';
      return block(state, text(event.error, 'Agent execution failed.'), timestamp);
    }
    if (!appendReceipt(state, event.receipt)) return block(state, 'Agent completion requires a valid deterministic receipt.', timestamp);
    state.dispatch.status = 'complete';
    state.dispatch.completedAt = timestamp;
    state.dispatch.resultId = text(event.resultId);
    state.git.changedFiles = unique(list(event.changedFiles).map(normalizePath));
    const unsafeChanges = state.git.changedFiles.filter((path) => isUnsafePath(path) || !state.allowedFiles.some((scope) => {
      if (scope === path) return true;
      return scope.endsWith('/**') && (path === scope.slice(0, -3) || path.startsWith(`${scope.slice(0, -3)}/`));
    }));
    if (unsafeChanges.length) return block(state, `Agent result exceeded approved source scope: ${unsafeChanges.join(', ')}`, timestamp);
  } else if (eventType === 'EVIDENCE_RECORDED') {
    for (const receipt of list(event.receipts)) appendReceipt(state, receipt);
  } else if (eventType === 'GIT_OPERATION_COMPLETED') {
    if (!appendReceipt(state, event.receipt)) return block(state, 'Git operation requires a valid signed-operation receipt.', timestamp);
    const operation = text(event.operation).toLowerCase();
    if (operation === 'commit') {
      if (!SHA40_PATTERN.test(text(event.commitSha))) return block(state, 'Commit receipt requires an exact lowercase commit SHA.', timestamp);
      state.git.commitSha = text(event.commitSha);
      state.git.clean = event.clean === true;
    } else if (operation === 'push') {
      state.git.pushed = event.success === true;
    } else {
      return block(state, 'Unsupported Git operation completion event.', timestamp);
    }
  } else if (eventType === 'PULL_REQUEST_OPENED') {
    if (!appendReceipt(state, event.receipt)) return block(state, 'Pull request creation requires a valid receipt.', timestamp);
    const number = Number.parseInt(event.prNumber, 10);
    if (!Number.isInteger(number) || number < 1 || !SHA40_PATTERN.test(text(event.headSha))) return block(state, 'Pull request identity is incomplete.', timestamp);
    state.pullRequest = { ...state.pullRequest, number, url: text(event.prUrl), headSha: text(event.headSha), state: 'open', mergeable: event.mergeable === true };
    state.approval = { ...state.approval, status: 'pending', requiredToken: exactMergeApproval(number, text(event.headSha)), requestedAt: timestamp };
  } else if (eventType === 'PULL_REQUEST_CHECKS_UPDATED') {
    if (Number.parseInt(event.prNumber, 10) !== state.pullRequest.number || text(event.headSha) !== state.pullRequest.headSha) {
      return block(state, 'Pull request check receipt is stale or belongs to another head.', timestamp);
    }
    state.pullRequest.checks = normalizeChecks(event.checks);
    state.pullRequest.mergeable = event.mergeable === true;
    state.pullRequest.state = text(event.prState, state.pullRequest.state);
    if (event.receipt) appendReceipt(state, event.receipt);
  } else if (eventType === 'REPAIR_STARTED') {
    if (state.currentPhase !== 'REPAIR_REQUIRED') return block(state, 'Repair can start only after required check failure.', timestamp);
    if (state.repair.currentRound >= MAX_REPAIR_ROUNDS) return block(state, 'Maximum repair rounds reached.', timestamp);
    state.repair.currentRound += 1;
    state.repair.history.push({ round: state.repair.currentRound, startedAt: timestamp, failedChecks: state.pullRequest.checks.filter((check) => !['success', 'neutral', 'skipped'].includes(check.status)).map((check) => check.name) });
    state.dispatch = { ...state.dispatch, status: 'pending', actionId: '', workerId: '', startedAt: '', completedAt: '', resultId: '' };
    state.git.commitSha = '';
    state.git.pushed = false;
    state.pullRequest.checks = [];
    state.approval = { status: 'not-requested', requiredToken: '', suppliedTokenHash: '', requestedAt: '', decidedAt: '' };
  } else if (eventType === 'OPERATOR_APPROVAL_RECORDED') {
    if (state.currentPhase !== 'AWAITING_OPERATOR_APPROVAL') return block(state, 'Approval was supplied outside the approval phase.', timestamp);
    if (text(event.approvalToken) !== state.approval.requiredToken) return block(state, 'Approval token does not match the exact pull request head.', timestamp);
    if (!checksPassing(state.pullRequest.checks) || state.pullRequest.mergeable !== true || !evidenceSatisfied(state)) {
      return block(state, 'Approval cannot advance without passing checks, mergeability, and complete evidence.', timestamp);
    }
    state.approval.status = 'approved';
    state.approval.decidedAt = timestamp;
    state.approval.suppliedTokenHash = SHA256_PATTERN.test(text(event.approvalTokenHash)) ? text(event.approvalTokenHash) : '';
  } else if (eventType === 'PULL_REQUEST_MERGED') {
    if (state.currentPhase !== 'MERGE_PULL_REQUEST' || state.approval.status !== 'approved') return block(state, 'Merge receipt arrived without exact approved merge authority.', timestamp);
    if (!appendReceipt(state, event.receipt)) return block(state, 'Merge requires a valid deterministic receipt.', timestamp);
    if (!SHA40_PATTERN.test(text(event.mergeCommitSha))) return block(state, 'Merge receipt requires an exact lowercase merge commit SHA.', timestamp);
    state.pullRequest.merged = true;
    state.pullRequest.state = 'merged';
    state.pullRequest.mergeCommitSha = text(event.mergeCommitSha);
  } else if (eventType === 'LOCAL_DEPLOYMENT_STEP_RECORDED') {
    if (!state.pullRequest.merged) return block(state, 'Local deployment cannot start before merge.', timestamp);
    const step = text(event.step).toLowerCase();
    if (!['sync', 'build', 'verify', 'restart'].includes(step)) return block(state, 'Local deployment step is unsupported.', timestamp);
    if (!appendReceipt(state, event.receipt)) return block(state, 'Local deployment step requires a valid deterministic receipt.', timestamp);
    state.deployment[step] = { status: event.success === true ? 'success' : 'failed', completedAt: timestamp, commitSha: text(event.commitSha) };
    if (event.success !== true) return block(state, `Local deployment ${step} failed.`, timestamp);
  } else if (eventType === 'MISSION_CANCELLED') {
    state.cancelled = true;
  } else if (eventType === 'MISSION_BLOCKED') {
    return block(state, text(event.reason, 'Mission was blocked by an external authority.'), timestamp);
  } else {
    return block(state, 'Unsupported mission orchestrator event.', timestamp);
  }

  return refreshDerivedState(state, timestamp);
}

export function buildMissionOperationsSnapshot(state, options = {}) {
  const timestamp = nowIso(options);
  return {
    schemaVersion: 'stephanos.mission-operations-snapshot.v1',
    source: 'stephanos-mission-orchestrator',
    missionId: state.missionId,
    title: state.title,
    intendedOutcome: state.intendedOutcome,
    state: state.currentPhase === 'COMPLETE' ? 'COMPLETE' : state.currentPhase === 'BLOCKED' ? 'BLOCKED' : state.currentPhase === 'AWAITING_OPERATOR_APPROVAL' ? 'AWAITING_APPROVAL' : 'RUNNING',
    finalVerdict: state.finalVerdict,
    startedAt: state.createdAt,
    updatedAt: state.updatedAt || timestamp,
    currentPhase: state.currentPhase,
    nextAction: state.nextAction.type,
    activeAgent: state.activeAgent,
    supportingAgents: state.supportingAgents,
    github: {
      repository: state.repository,
      branch: state.git.branch,
      baseBranch: state.git.baseBranch,
      headSha: state.pullRequest.headSha || state.git.commitSha,
      worktreePath: state.git.worktreePath,
      changedFiles: state.git.changedFiles,
      clean: state.git.clean,
      prNumber: state.pullRequest.number,
      prUrl: state.pullRequest.url,
      prState: state.pullRequest.state,
      mergeable: state.pullRequest.mergeable,
      checks: state.pullRequest.checks,
    },
    approvals: state.approval.status === 'not-requested' ? [] : [{
      approvalId: `merge-${state.pullRequest.number || 'pending'}`,
      kind: 'squash-merge',
      status: state.approval.status,
      requiredToken: state.approval.requiredToken,
      requestedAt: state.approval.requestedAt,
      decidedAt: state.approval.decidedAt,
    }],
    receipts: state.evidenceReceipts.map((receipt) => ({
      receiptId: receipt.receiptId,
      receiptType: receipt.evidenceType,
      source: receipt.source,
      status: receipt.verified ? 'PASS' : 'BLOCKED',
      sha256: receipt.sha256 || receipt.commandOutputHash || '',
      receiptPath: receipt.receiptPath || '',
      createdAt: receipt.createdAt,
    })),
    blockers: state.blockers,
    warnings: [
      ...state.warnings,
      `Repair round ${state.repair.currentRound}/${state.repair.maximumRounds}`,
      `Deployment sync/build/verify/restart: ${['sync', 'build', 'verify', 'restart'].map((step) => state.deployment[step].status).join('/')}`,
    ],
    repair: state.repair,
    deployment: state.deployment,
  };
}
