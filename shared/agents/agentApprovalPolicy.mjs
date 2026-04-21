const APPROVAL_CLASSES = Object.freeze({
  INFORMATIONAL: 'informational-only',
  INTERNAL_LOW_RISK: 'internal-low-risk-system-work',
  APPROVAL_REQUIRED: 'approval-required-action',
  FORBIDDEN: 'forbidden-policy-blocked-action',
});

function asText(value = '') {
  return String(value ?? '').trim();
}

export function classifyTaskApproval({ task = {}, context = {} } = {}) {
  const status = asText(task.status).toLowerCase();
  if (status === 'canceled') {
    return { classification: APPROVAL_CLASSES.INFORMATIONAL, approvalState: 'not-required', reason: 'Canceled task is informational only.' };
  }

  if (task.policyBlocked === true || asText(task.policyViolationCode)) {
    return {
      classification: APPROVAL_CLASSES.FORBIDDEN,
      approvalState: 'blocked-by-policy',
      reason: asText(task.policyBlockedReason, 'Blocked by policy guardrail.'),
    };
  }

  if (task.requiresApproval === true) {
    return {
      classification: APPROVAL_CLASSES.APPROVAL_REQUIRED,
      approvalState: asText(task.approvalState, 'pending') || 'pending',
      reason: asText(task.approvalReason, 'Meaningful action requires explicit operator approval.'),
    };
  }

  const sessionKind = asText(context.sessionKind || context.runtimeSessionKind).toLowerCase();
  const internalOnly = task.internalOnly === true;
  if (internalOnly && ['local-dev', 'local-network'].includes(sessionKind)) {
    return {
      classification: APPROVAL_CLASSES.INTERNAL_LOW_RISK,
      approvalState: 'not-required',
      reason: 'Internal low-risk action allowed by policy for local authority session.',
    };
  }

  return {
    classification: APPROVAL_CLASSES.INFORMATIONAL,
    approvalState: 'not-required',
    reason: 'Task is informational or non-executing.',
  };
}

export function buildApprovalQueue({ missionModel = {}, context = {} } = {}) {
  const tasks = Array.isArray(missionModel.tasks) ? missionModel.tasks : [];
  return tasks
    .map((task) => {
      const verdict = classifyTaskApproval({ task, context });
      return {
        taskId: task.taskId,
        goalId: task.parentGoalId,
        assignedAgentId: task.assignedAgentId,
        title: task.title,
        classification: verdict.classification,
        approvalState: verdict.approvalState,
        reason: verdict.reason,
      };
    })
    .filter((entry) => entry.classification !== APPROVAL_CLASSES.INFORMATIONAL || entry.approvalState !== 'not-required');
}

export { APPROVAL_CLASSES };
