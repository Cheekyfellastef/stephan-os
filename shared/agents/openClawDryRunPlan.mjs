function asArray(v){return Array.isArray(v)?v.filter(Boolean):[];}

export function buildOpenClawDryRunPlan({ packetId='none', implementationPlan={} } = {}) {
  const blocked = implementationPlan?.planStatus === 'blocked_by_risk';
  const ready = implementationPlan?.planStatus === 'ready_for_operator_review';
  return {
    dryRunId: `openclaw-dryrun-${packetId}`,
    packetId,
    sourcePlanId: implementationPlan?.planId || 'none',
    dryRunStatus: blocked ? 'blocked_by_risk' : ready ? 'ready_for_review' : 'unavailable',
    dryRunMode: 'preview_only',
    simulatedSteps: ready ? ['Inspect proposed files', 'Prepare patch plan', 'Prepare test/build request list', 'Prepare operator approval checklist'] : [],
    filesThatWouldBeInspected: asArray(implementationPlan?.proposedFilesToInspect),
    filesThatWouldBeChanged: asArray(implementationPlan?.proposedFilesToChange),
    commandsThatWouldBeRequested: asArray(implementationPlan?.proposedBuildChecks),
    testsThatWouldBeRun: asArray(implementationPlan?.proposedTests),
    approvalsRequiredBeforeAnyStep: ['operator_review', 'future_controlled_execution_design'],
    blockedSteps: blocked ? ['All execution-like steps are blocked by risk and policy in this stage.'] : [],
    rollbackPreview: asArray(implementationPlan?.rollbackPlan),
    auditPreview: ['preview_only:no_commands_run', 'preview_only:no_file_edits'],
    executionAllowed: false,
    actionExecutionEligible: false,
    operatorApprovalRequired: true,
    nextAction: ready ? 'Review dry-run preview with operator.' : 'Finalize implementation planning packet first.',
  };
}
