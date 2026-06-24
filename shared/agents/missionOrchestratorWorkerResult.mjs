const SHA40_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function receipt(action, execution) {
  const hash = text(execution.commandOutputHash).toLowerCase();
  if (!SHA256_PATTERN.test(hash)) throw new Error('Worker execution requires an exact lowercase command output hash.');
  return {
    receiptId: `worker-${action.actionId}`.slice(0, 128),
    requirement: action.receiptRequirement,
    source: 'openclaw-standalone-worker',
    evidenceType: 'signed-operation',
    verified: execution.success === true,
    commandOutputHash: hash,
    createdAt: text(execution.completedAt),
  };
}

function checkList(value) {
  return Array.isArray(value) ? value.map((check, index) => ({
    id: text(check.id || check.name, `check-${index + 1}`),
    name: text(check.name || check.id, `Check ${index + 1}`),
    status: text(check.status || check.state, 'unknown').toLowerCase(),
    required: check.required !== false,
    url: text(check.url),
    completedAt: text(check.completedAt),
  })) : [];
}

export function buildMissionEventFromWorkerResult(action, execution = {}, inspection = {}) {
  if (action?.actionKind !== 'signed-openclaw-operation') throw new Error('Worker action is not a signed OpenClaw operation.');
  if (execution.success !== true) {
    return {
      eventId: `blocked-${action.actionId}`.slice(0, 128),
      eventType: 'MISSION_BLOCKED',
      reason: text(execution.error, `Signed OpenClaw ${action.operation} operation failed.`),
      summary: `Signed OpenClaw ${action.operation} operation failed.`,
    };
  }
  const deterministicReceipt = receipt(action, execution);
  const eventId = `worker-${action.actionId}`.slice(0, 128);
  if (action.operation === 'create-worktree') {
    if (!text(inspection.worktreePath) || inspection.clean !== true) throw new Error('Worktree result requires a concrete clean worktree path.');
    return { eventId, eventType: 'WORKTREE_READY', worktreePath: text(inspection.worktreePath), clean: true, receipt: deterministicReceipt, summary: 'Signed OpenClaw worktree creation completed.' };
  }
  if (action.operation === 'commit') {
    const commitSha = text(inspection.commitSha).toLowerCase();
    if (!SHA40_PATTERN.test(commitSha) || inspection.clean !== true) throw new Error('Commit result requires an exact lowercase commit SHA and clean worktree.');
    return { eventId, eventType: 'GIT_OPERATION_COMPLETED', operation: 'commit', commitSha, clean: true, receipt: deterministicReceipt, summary: 'Signed OpenClaw commit completed.' };
  }
  if (action.operation === 'push') {
    return { eventId, eventType: 'GIT_OPERATION_COMPLETED', operation: 'push', success: true, receipt: deterministicReceipt, summary: 'Signed OpenClaw push completed.' };
  }
  if (action.operation === 'open-pr') {
    const prNumber = Number.parseInt(inspection.prNumber, 10);
    const headSha = text(inspection.headSha).toLowerCase();
    if (!Number.isInteger(prNumber) || prNumber < 1 || !SHA40_PATTERN.test(headSha) || !text(inspection.prUrl)) throw new Error('Pull request result identity is incomplete.');
    return { eventId, eventType: 'PULL_REQUEST_OPENED', prNumber, prUrl: text(inspection.prUrl), headSha, mergeable: inspection.mergeable === true, receipt: deterministicReceipt, summary: 'Signed OpenClaw pull request creation completed.' };
  }
  if (action.operation === 'check-pr') {
    const prNumber = Number.parseInt(inspection.prNumber, 10);
    const headSha = text(inspection.headSha).toLowerCase();
    const checks = checkList(inspection.checks);
    if (!Number.isInteger(prNumber) || prNumber < 1 || !SHA40_PATTERN.test(headSha) || !checks.length) throw new Error('Pull request check result is incomplete.');
    return { eventId, eventType: 'PULL_REQUEST_CHECKS_UPDATED', prNumber, headSha, prState: text(inspection.prState, 'open'), mergeable: inspection.mergeable === true, checks, receipt: deterministicReceipt, summary: 'Signed OpenClaw pull request checks inspected.' };
  }
  if (action.operation === 'merge-pr') {
    const mergeCommitSha = text(inspection.mergeCommitSha).toLowerCase();
    if (!SHA40_PATTERN.test(mergeCommitSha) || inspection.prState !== 'merged') throw new Error('Merge result requires an exact merge commit SHA and merged state.');
    return { eventId, eventType: 'PULL_REQUEST_MERGED', mergeCommitSha, receipt: deterministicReceipt, summary: 'Approved signed OpenClaw squash merge completed.' };
  }
  throw new Error(`Unsupported signed worker operation: ${text(action.operation, 'unknown')}`);
}
