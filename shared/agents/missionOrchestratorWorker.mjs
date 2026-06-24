import { createHash } from 'node:crypto';
import { issueOpenClawGitHubAuthorization } from './openClawGitHubAuthorization.mjs';
import { buildOpenClawGitHubOperation } from './openClawGitHubOperator.mjs';

const OPENCLAW_BRANCH_PATTERN = /^openclaw\/[a-z0-9][a-z0-9._/-]{2,127}$/;
const SHA40_PATTERN = /^[a-f0-9]{40}$/;
const SIGNED_OPERATION_PHASES = new Map([
  ['CREATE_WORKTREE', 'create-worktree'],
  ['GITHUB_COMMIT', 'commit'],
  ['GITHUB_PUSH', 'push'],
  ['OPEN_PULL_REQUEST', 'open-pr'],
  ['MERGE_PULL_REQUEST', 'merge-pr'],
]);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function nowIso(options = {}) {
  return options.now instanceof Date ? options.now.toISOString() : new Date().toISOString();
}

function expiresAt(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const lifetimeMs = Number.isInteger(options.authorizationLifetimeMs) ? options.authorizationLifetimeMs : 10 * 60 * 1000;
  return new Date(now.getTime() + Math.min(Math.max(lifetimeMs, 60_000), 24 * 60 * 60 * 1000)).toISOString();
}

function actionId(state, kind) {
  const seed = `${state.missionId}:${state.revision}:${state.currentPhase}:${kind}`;
  return `${state.missionId}-r${state.revision}-${createHash('sha256').update(seed).digest('hex').slice(0, 12)}`;
}

function receiptRequirement(operation) {
  const requirements = {
    'create-worktree': 'isolated worktree', commit: 'signed git commit', push: 'signed git push',
    'open-pr': 'pull request creation', 'check-pr': 'pull request checks', 'merge-pr': 'approved squash merge',
  };
  return requirements[operation] || `signed ${operation}`;
}

function operationClaims(state, operation, options = {}) {
  const claims = {
    authorizationId: actionId(state, operation), missionId: state.missionId, operation,
    repository: state.repository,
    repositoryRoot: operation === 'create-worktree' ? text(state.repositoryRoot) : text(state.git?.worktreePath),
    defaultBranch: state.baseBranch || 'main', baseBranch: state.git?.baseBranch || state.baseBranch || 'main',
    branch: state.git?.branch || '', worktreePath: state.git?.worktreePath || '',
    allowedFiles: state.allowedFiles || [], changedFiles: state.git?.changedFiles || [], singleUse: true,
    issuedAt: nowIso(options), expiresAt: expiresAt(options),
  };
  if (operation === 'commit') claims.commitMessage = text(options.commitMessage, `Complete ${state.title || state.missionId}`);
  if (operation === 'open-pr') {
    claims.title = text(options.pullRequestTitle, state.title || state.intendedOutcome);
    claims.body = text(options.pullRequestBody, `Mission: ${state.missionId}\n\n${state.intendedOutcome}`);
  }
  if (operation === 'merge-pr') {
    claims.prNumber = state.pullRequest?.number;
    claims.expectedHeadSha = state.pullRequest?.headSha || '';
  }
  return claims;
}

function blocked(state, reason) {
  return { schemaVersion: 'stephanos.mission-worker-action.v1', actionId: actionId(state, 'blocked'), missionId: state.missionId, actionKind: 'blocked', executable: false, blockers: [reason], finalVerdict: 'BLOCKED' };
}

export function buildMissionWorkerAction(state, options = {}) {
  if (!state || typeof state !== 'object') return blocked({ missionId: 'invalid', revision: 0, currentPhase: 'BLOCKED' }, 'Mission state is required.');
  if (['COMPLETE', 'CANCELLED', 'BLOCKED', 'AWAITING_OPERATOR_APPROVAL'].includes(state.currentPhase)) {
    return { schemaVersion: 'stephanos.mission-worker-action.v1', actionId: actionId(state, 'wait'), missionId: state.missionId, actionKind: 'wait', executable: false, reason: state.currentPhase, finalVerdict: 'NO_ACTION_REQUIRED' };
  }

  if (state.currentPhase === 'CHECK_PULL_REQUEST') {
    if (!Number.isInteger(state.pullRequest?.number) || !SHA40_PATTERN.test(text(state.pullRequest?.headSha))) return blocked(state, 'Pull request inspection requires an exact pull request number and lowercase head SHA.');
    return {
      schemaVersion: 'stephanos.mission-worker-action.v1', actionId: actionId(state, 'check-pr'), missionId: state.missionId,
      actionKind: 'github-inspection', adapter: 'openclaw-github-readonly', operation: 'check-pr', owner: 'openclaw-standalone', activeWriter: 'none',
      repository: state.repository, repositoryRoot: state.git?.worktreePath || state.repositoryRoot, prNumber: state.pullRequest.number,
      expectedHeadSha: state.pullRequest.headSha, receiptRequirement: receiptRequirement('check-pr'), executable: true, blockers: [], finalVerdict: 'READY_TO_INSPECT_PULL_REQUEST',
    };
  }

  if (SIGNED_OPERATION_PHASES.has(state.currentPhase)) {
    const operation = SIGNED_OPERATION_PHASES.get(state.currentPhase);
    if (!OPENCLAW_BRANCH_PATTERN.test(text(state.git?.branch))) return blocked(state, 'Signed OpenClaw mutations require an openclaw/* mission branch.');
    if (operation !== 'create-worktree' && !text(state.git?.worktreePath)) return blocked(state, 'Signed GitHub operation requires an isolated worktree path.');
    if (operation === 'merge-pr' && (!Number.isInteger(state.pullRequest?.number) || !SHA40_PATTERN.test(text(state.pullRequest?.headSha)))) return blocked(state, 'Merge operation requires an exact pull request number and lowercase head SHA.');
    const claims = operationClaims(state, operation, options);
    const preview = buildOpenClawGitHubOperation(claims);
    const allowedPreviewBlockers = operation === 'merge-pr' ? new Set(['Pull request head SHA changed or could not be verified.', 'Pull request must be mergeable.', 'Every required check must report success.', 'Exact operator squash-merge approval token is required.']) : new Set();
    const blockers = preview.blockers.filter((reason) => !allowedPreviewBlockers.has(reason));
    if (blockers.length) return blocked(state, blockers.join(' '));
    return {
      schemaVersion: 'stephanos.mission-worker-action.v1', actionId: claims.authorizationId, missionId: state.missionId,
      actionKind: 'signed-openclaw-operation', operation, owner: 'openclaw-standalone', activeWriter: 'none',
      receiptRequirement: receiptRequirement(operation), claims, approvalToken: operation === 'merge-pr' ? state.approval?.requiredToken || '' : '',
      executable: true, blockers: [], finalVerdict: 'READY_TO_ISSUE_AUTHORIZATION',
    };
  }

  if (['AGENT_IMPLEMENTATION', 'REPAIR_REQUIRED'].includes(state.currentPhase)) {
    return { schemaVersion: 'stephanos.mission-worker-action.v1', actionId: actionId(state, 'codex'), missionId: state.missionId, actionKind: 'agent-handoff', adapter: 'codex', owner: 'codex', activeWriter: 'Codex', worktreePath: state.git?.worktreePath || '', allowedFiles: state.allowedFiles || [], requiredTests: state.requiredTests || [], requiredEvidence: state.requiredEvidence || [], repairRound: state.repair?.currentRound || 0, executable: true, blockers: [], finalVerdict: 'READY_TO_DISPATCH_CODEX' };
  }
  if (state.currentPhase === 'LIVE_RUNTIME_INVESTIGATION') {
    return { schemaVersion: 'stephanos.mission-worker-action.v1', actionId: actionId(state, 'openclaw-readonly'), missionId: state.missionId, actionKind: 'agent-handoff', adapter: 'openclaw-readonly', owner: 'openclaw-standalone', activeWriter: 'none', requiredEvidence: state.requiredEvidence || [], browserProofRequired: state.browserProofRequired === true, executable: true, blockers: [], finalVerdict: 'READY_TO_DISPATCH_OPENCLAW_READONLY' };
  }
  if (state.currentPhase === 'VERIFYING') {
    return { schemaVersion: 'stephanos.mission-worker-action.v1', actionId: actionId(state, 'verification'), missionId: state.missionId, actionKind: 'evidence-judgment', owner: 'verification-judge', activeWriter: 'none', requiredEvidence: state.requiredEvidence || [], receipts: state.evidenceReceipts || [], executable: true, blockers: [], finalVerdict: 'READY_TO_JUDGE_EVIDENCE' };
  }
  if (state.currentPhase === 'LOCAL_DEPLOYMENT') {
    return { schemaVersion: 'stephanos.mission-worker-action.v1', actionId: actionId(state, 'local-deployment'), missionId: state.missionId, actionKind: 'local-deployment', owner: 'openclaw-standalone', activeWriter: 'none', mergeCommitSha: state.pullRequest?.mergeCommitSha || '', steps: ['sync', 'build', 'verify', 'restart'].filter((step) => state.deployment?.[step]?.status !== 'success'), executable: true, blockers: [], finalVerdict: 'READY_FOR_LOCAL_DEPLOYMENT' };
  }
  return blocked(state, `Unsupported mission phase: ${text(state.currentPhase, 'unknown')}`);
}

export function issueMissionWorkerAuthorization(action, privateKeyPem, options = {}) {
  if (action?.actionKind !== 'signed-openclaw-operation' || action.executable !== true) return { finalVerdict: 'BLOCKED', blockers: ['Worker action is not an executable signed OpenClaw operation.'] };
  const authorization = issueOpenClawGitHubAuthorization(action.claims, privateKeyPem, options);
  if (authorization.finalVerdict !== 'STEPHANOS_AUTHORIZATION_ISSUED') return authorization;
  return { schemaVersion: 'stephanos.mission-worker-request.v1', actionId: action.actionId, missionId: action.missionId, operation: action.operation, authorization, approvalToken: action.approvalToken || '', receiptRequirement: action.receiptRequirement, finalVerdict: 'MISSION_WORKER_REQUEST_ISSUED' };
}
