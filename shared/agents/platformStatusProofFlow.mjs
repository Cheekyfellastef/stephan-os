import { aggregateBattleBridgeSupervisorProbes } from './battleBridgeSupervisor.mjs';
import { createCodexQueueRecord } from './codexDispatchQueue.mjs';
import {
  BLOCKED_BY_MISSING_INTEGRATION,
  assessCodexIntegration,
  createDispatcherDashboard,
  dispatchQueuedCodexJob,
} from './automatedCodexDispatcher.mjs';

export const PLATFORM_STATUS_PROOF_FLOW_SCHEMA_VERSION = 'platform-status-proof-flow.v1';
export const MANUAL_DISPATCH_REQUIRED = 'MANUAL_DISPATCH_REQUIRED';
export const EXACT_HEAD_MERGE_HOLD = 'EXACT_HEAD_MERGE_HOLD';

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function issueNumber(value) {
  const parsed = Number.parseInt(String(value).replace(/^#/, ''), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function createGoalQueueRecord(goal = {}, now = 'pending') {
  return createCodexQueueRecord({
    issueNumber: issueNumber(goal.issue),
    branch: goal.branch || `codex/issue-${issueNumber(goal.issue)}-dispatch`,
    prompt: goal.prompt || goal.nextAction || goal.title || `Continue active goal ${goal.issue}.`,
    requestedProofCommands: goal.requestedProofCommands || ['node --test shared/agents/platformStatusProofFlow.test.mjs'],
    createdAt: goal.createdAt || now,
    approvalRequirements: {
      requiresOperatorApprovalBeforeDispatch: goal.requiresOperatorApprovalBeforeDispatch === true,
      requiresOperatorApprovalBeforeMerge: true,
      approvalReceipt: goal.dispatchApprovalReceipt || '',
    },
  });
}

export function buildPlatformStatusProofFlow(input = {}) {
  const now = text(input.now, 'pending');
  const supervisor = aggregateBattleBridgeSupervisorProbes({ probes: input.supervisorProbes || [] });
  const integration = assessCodexIntegration(input.codexIntegration || {});
  const goals = Array.isArray(input.goals) ? input.goals : [];
  const activeGoals = goals.map((goal) => {
    const queueRecord = createGoalQueueRecord(goal, now);
    const dispatch = dispatchQueuedCodexJob({
      queueRecord,
      integration: input.codexIntegration || {},
      now,
    });
    const directDispatchAvailable = integration.supported === true;
    const missingIntegrationBlocker = directDispatchAvailable ? '' : BLOCKED_BY_MISSING_INTEGRATION;
    const manualDispatchRequired = directDispatchAvailable ? false : true;
    const exactHeadMergeHold = goal.exactHeadMergeApproved === true ? false : true;

    return Object.freeze({
      issue: `#${queueRecord.issueNumber}`,
      title: text(goal.title, `Goal #${queueRecord.issueNumber}`),
      supervisorVerdict: supervisor.finalVerdict,
      supervisorStatus: supervisor.status,
      codexDispatchReadiness: directDispatchAvailable ? 'DIRECT_CODEX_DISPATCH_READY' : MANUAL_DISPATCH_REQUIRED,
      dispatchDecision: dispatch.decision,
      queueStatus: dispatch.record?.status || queueRecord.status,
      missingIntegrationBlocker,
      missingCapabilities: integration.missingCapabilities,
      manualDispatchRequired,
      exactHeadMergeHold,
      mergeHoldReason: exactHeadMergeHold ? EXACT_HEAD_MERGE_HOLD : '',
      nextProof: manualDispatchRequired
        ? 'manual-codex-dispatch-receipt'
        : exactHeadMergeHold
          ? 'exact-head-merge-approval'
          : 'codex-dispatch-proof',
      proofRefs: [`shared-workspace/proof/issue-${queueRecord.issueNumber}-platform-status.json`],
      finalVerdict: manualDispatchRequired
        ? MANUAL_DISPATCH_REQUIRED
        : exactHeadMergeHold
          ? EXACT_HEAD_MERGE_HOLD
          : 'PLATFORM_STATUS_PROOF_READY',
    });
  });

  return Object.freeze({
    schemaVersion: PLATFORM_STATUS_PROOF_FLOW_SCHEMA_VERSION,
    kind: 'stephanos.platform.status_proof_flow',
    generatedAtUtc: now,
    supervisor,
    codexIntegration: integration,
    codexDispatcherDashboard: createDispatcherDashboard({ queueRecords: activeGoals.map((goal) => ({
      issueNumber: issueNumber(goal.issue),
      branch: `codex/issue-${issueNumber(goal.issue)}-dispatch`,
      prompt: goal.title,
      requestedProofCommands: ['node --test shared/agents/platformStatusProofFlow.test.mjs'],
    })) }),
    activeGoals,
    statusRoute: 'shared-workspace/status/platform-status-proof-flow.json',
    proofRoute: 'shared-workspace/proof/platform-status-proof-flow.json',
    finalVerdict: activeGoals.some((goal) => goal.manualDispatchRequired) ? MANUAL_DISPATCH_REQUIRED : 'PLATFORM_STATUS_PROOF_FLOW_READY',
  });
}
