export function buildExecutionTruth({ proposal = null, approvalGranted = false, simulateOnly = true } = {}) {
  const steps = Array.isArray(proposal?.steps) ? proposal.steps : [];
  const hasWriteOrMutation = steps.some((step) => ['write', 'memory', 'tile'].includes(step.stepType));
  const executionEligible = steps.length > 0 && !hasWriteOrMutation;

  if (steps.length === 0) {
    return {
      executionEligible: false,
      executionStarted: false,
      executionCompleted: false,
      executionBlockedReason: 'No proposal steps available.',
      executionResultSummary: 'No execution attempted.',
    };
  }

  if (hasWriteOrMutation && !approvalGranted) {
    return {
      executionEligible: false,
      executionStarted: false,
      executionCompleted: false,
      executionBlockedReason: 'Write or mutation steps require explicit approval.',
      executionResultSummary: 'Execution blocked by approval gate.',
    };
  }

  if (!executionEligible && !approvalGranted) {
    return {
      executionEligible,
      executionStarted: false,
      executionCompleted: false,
      executionBlockedReason: 'Proposal contains non-auto-executable steps.',
      executionResultSummary: 'Execution not started.',
    };
  }

  return {
    executionEligible: true,
    executionStarted: true,
    executionCompleted: true,
    executionBlockedReason: null,
    executionResultSummary: simulateOnly
      ? `Simulated execution for ${steps.length} safe step(s); no mutations performed.`
      : `Executed ${steps.length} eligible step(s).`,
  };
}
