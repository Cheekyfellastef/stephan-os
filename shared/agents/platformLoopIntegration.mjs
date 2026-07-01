import { aggregateBattleBridgeSupervisorProbes } from './battleBridgeSupervisor.mjs';
import { aggregateIgnitionStatusRoutes } from './ignitionConciergeStatusRouting.mjs';
import { createCodexDispatchDecision } from './automatedCodexDispatcher.mjs';
import { createCodexQueueItem, validateCodexQueueItem } from './codexDispatchQueue.mjs';
import { createOperatorAutomationBatch } from './operatorAutomationLayer.mjs';
import { evaluatePlatformStatusProofFlow } from './platformStatusProofFlow.mjs';
import { createOpenClawFallbackRequest } from './openClawResilience.mjs';
import { createStephanosCommandResponse } from './stephanosCommandResponse.mjs';
import { createSharedWorkspaceMessage } from './sharedAgentWorkspace.mjs';
import { createVerifierResult, VERIFICATION_STATUS } from './verificationHarness.mjs';

export const PLATFORM_LOOP_INTEGRATION_SCHEMA_VERSION = 'platform-loop-integration.v1';

export const PLATFORM_LOOP_STATUS = Object.freeze({
  BUILDING: 'BUILDING',
  WAITING_FOR_PROOF: 'WAITING_FOR_PROOF',
  WAITING_FOR_OPERATOR_APPROVAL: 'WAITING_FOR_OPERATOR_APPROVAL',
  BLOCKED_WITH_EXACT_UNBLOCK_ACTION: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
  DONE: 'DONE',
});

const SAFE_TEXT_PATTERN = /^[a-z0-9#][a-z0-9._:/#(), -]{0,300}$/i;

function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asText(item, '')).filter(Boolean);
}

function safeText(value, fallback = '') {
  const text = asText(value, fallback);
  return text && SAFE_TEXT_PATTERN.test(text) ? text : fallback;
}

function firstNonEmpty(...values) {
  return values.find((value) => asText(value, '')) || '';
}

function inputQueueComplete(dispatcherDecision, proofPassed) {
  return proofPassed && dispatcherDecision.record?.status === 'succeeded';
}

function decidePlatformLoopStatus({ supervisor, ignition, queueValidation, dispatcherDecision, operatorBatch, proofPassed }) {
  if (supervisor.finalVerdict !== 'BATTLE_BRIDGE_SUPERVISOR_PASS') return PLATFORM_LOOP_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION;
  if (ignition.finalVerdict !== 'IGNITION_CONCIERGE_STATUS_ROUTING_PASS') return PLATFORM_LOOP_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION;
  if (!queueValidation.valid) return PLATFORM_LOOP_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION;
  if (operatorBatch.status === 'WAITING_FOR_OPERATOR_APPROVAL') return PLATFORM_LOOP_STATUS.WAITING_FOR_OPERATOR_APPROVAL;
  if (dispatcherDecision.canonicalDecision === 'DISPATCHED' && inputQueueComplete(dispatcherDecision, proofPassed)) return PLATFORM_LOOP_STATUS.DONE;
  if (dispatcherDecision.decision === 'BLOCKED_BY_OPERATOR_APPROVAL') return PLATFORM_LOOP_STATUS.WAITING_FOR_OPERATOR_APPROVAL;
  if (dispatcherDecision.decision === 'BLOCKED_BY_INVALID_QUEUE_ITEM' || dispatcherDecision.decision === 'BLOCKED_BY_MISSING_INTEGRATION') return PLATFORM_LOOP_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION;
  if (inputQueueComplete(dispatcherDecision, proofPassed)) return PLATFORM_LOOP_STATUS.DONE;
  if (!proofPassed) return PLATFORM_LOOP_STATUS.BUILDING;
  if (dispatcherDecision.decision === 'DISPATCH_READY_ITEM' || dispatcherDecision.decision === 'DISPATCHED') return PLATFORM_LOOP_STATUS.BUILDING;
  return PLATFORM_LOOP_STATUS.WAITING_FOR_PROOF;
}

export function buildPlatformLoopIntegrationContract() {
  return {
    schemaVersion: PLATFORM_LOOP_INTEGRATION_SCHEMA_VERSION,
    contractKind: 'stephanos.platform_loop.integration.contract',
    lifecycle: Object.values(PLATFORM_LOOP_STATUS),
    requiredSnapshotFields: [
      'schemaVersion',
      'kind',
      'goalId',
      'status',
      'supervisor',
      'ignition',
      'queueItem',
      'dispatcherDecision',
      'operatorBatch',
      'openClawFallback',
      'verifierResult',
      'stephanosResponse',
      'sharedWorkspaceMessage',
      'platformStatusProof',
      'manualDispatchRequired',
      'exactHeadMergeHold',
      'liveProofClaims',
      'nextAction',
    ],
    finalVerdict: 'PLATFORM_LOOP_INTEGRATION_CONTRACT_READY',
  };
}

export function createPlatformLoopSnapshot(input = {}) {
  const goalId = safeText(input.goalId, '#1306');
  const supervisor = aggregateBattleBridgeSupervisorProbes({ probes: input.serviceProbes || [] });
  const ignition = aggregateIgnitionStatusRoutes({ routes: input.ignitionRoutes || [] });
  const proofPassed = input.proofPassed === true;
  const queueItem = createCodexQueueItem({
    issueNumber: Number.parseInt(goalId.replace(/[^0-9]/g, ''), 10) || 1306,
    branch: input.branch || 'codex/platform-loop-integration',
    prompt: input.queueSummary || 'Platform loop integration work item.',
    requestedProofCommands: input.requiredTests || ['node --test shared/agents/platformLoopIntegration.test.mjs'],
    status: input.queueStatus || 'queued',
    resultMetadata: input.queueStatus === 'succeeded' ? { proofPassed: true } : undefined,
  });
  const queueValidation = validateCodexQueueItem(queueItem);
  const rawDispatcherDecision = createCodexDispatchDecision({
    queueRecord: queueItem,
    integration: input.integration || {
      capabilities: { launchCodexJob: true, returnDispatchReceipt: true, returnProofMetadata: true },
      dispatch: (record) => ({ receiptId: `${record.jobId}-dispatch-receipt`, accepted: true }),
    },
    now: input.now || 'pending',
    proofMetadata: proofPassed ? { proofPassed: true } : null,
  });
  const dispatcherDecision = rawDispatcherDecision.decision === 'DISPATCHED'
    ? { ...rawDispatcherDecision, decision: 'DISPATCH_READY_ITEM', canonicalDecision: rawDispatcherDecision.decision }
    : rawDispatcherDecision;
  const operatorBatch = createOperatorAutomationBatch({
    batchId: 'platform-loop-operator-batch',
    decisions: input.operatorDecisions || [],
  });
  const openClawFallback = createOpenClawFallbackRequest({
    fallbackKind: input.openClawFallbackKind || 'SCOUT',
    relatedGoal: goalId,
    summary: input.openClawSummary || 'OpenClaw is available as read-only fallback.',
    allowedReadPaths: input.openClawReadPaths || ['shared/agents/platformLoopIntegration.mjs'],
    requiredEvidence: input.openClawRequiredEvidence || ['grounded fallback evidence if used'],
  });
  const verifierResult = createVerifierResult({
    checkId: 'platform-loop-integration',
    verifierType: 'RuntimeVerifier',
    status: proofPassed ? VERIFICATION_STATUS.PASS : VERIFICATION_STATUS.FAIL,
    target: goalId,
    evidence: input.evidence || [],
    reason: proofPassed ? '' : 'Platform loop integration proof is not complete.',
    proofRefs: ['proof/platform-loop-integration.json'],
  });
  const platformStatusProof = evaluatePlatformStatusProofFlow({
    claimId: input.platformProofClaimId || `${goalId}-platform-status-proof`,
    status: input.platformProofStatus || 'requested',
    surface: input.platformProofSurface || 'mission-operations',
    summary: input.platformProofSummary || 'Canonical platform status proof must be visible without inventing live health.',
    supportSnapshotRefs: input.supportSnapshotRefs || [],
    uiRealityRefs: input.uiRealityRefs || [],
    commandProofRefs: input.commandProofRefs || input.platformProofRefs || [],
    collectedAt: input.platformProofCollectedAt || '',
  });
  const manualDispatchRequired = input.manualDispatchRequired === true || dispatcherDecision.decision === 'BLOCKED_BY_MISSING_INTEGRATION';
  const exactHeadMergeHold = Object.freeze({
    required: true,
    state: 'HOLD_FOR_EXACT_HEAD_APPROVAL',
    mergeAllowed: false,
    summary: 'Merge remains held until operator approval names the exact PR head SHA.',
  });
  const liveProofClaims = Object.freeze({
    github: 'not-live-in-browser',
    windows: 'not-proven',
    browser: platformStatusProof.claim.uiRealityRefs.length ? 'proof-ref-provided' : 'not-proven',
  });
  const status = decidePlatformLoopStatus({ supervisor, ignition, queueValidation, dispatcherDecision, operatorBatch, proofPassed });
  const blocker = firstNonEmpty(
    supervisor.exactUnblockAction,
    ignition.summary && ignition.finalVerdict !== 'IGNITION_CONCIERGE_STATUS_ROUTING_PASS' ? ignition.summary : '',
    queueValidation.errors?.join(', '),
    proofPassed ? '' : 'Run focused platform loop proof.'
  );
  const nextAction = status === PLATFORM_LOOP_STATUS.DONE
    ? 'Close the integration loop goal or advance to runtime orchestrator.'
    : status === PLATFORM_LOOP_STATUS.WAITING_FOR_OPERATOR_APPROVAL
      ? 'Collect exact operator approval for the pending platform loop decision.'
      : status === PLATFORM_LOOP_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION
        ? safeText(input.nextAction, blocker || 'Resolve the platform loop blocker.')
        : safeText(input.nextAction, 'Run platform loop proof and publish the snapshot to shared workspace.');

  const stephanosResponse = createStephanosCommandResponse({
    activeGoal: goalId,
    status,
    missionState: [
      `Supervisor: ${supervisor.finalVerdict}`,
      `Ignition: ${ignition.finalVerdict}`,
      `Dispatcher: ${dispatcherDecision.decision}`,
      `PlatformProof: ${platformStatusProof.status}`,
      `ExactHeadMerge: ${exactHeadMergeHold.state}`,
      `ManualDispatchRequired: ${manualDispatchRequired ? 'yes' : 'no'}`,
    ],
    proofState: [verifierResult.status],
    blockerState: status === PLATFORM_LOOP_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION ? [blocker || nextAction] : [],
    nextAction,
    operatorHandoff: status === PLATFORM_LOOP_STATUS.WAITING_FOR_OPERATOR_APPROVAL ? 'Approve the exact pending operator decision.' : '',
    conciseReply: `${goalId} platform loop is ${status}.`,
  });
  const sharedWorkspaceMessage = createSharedWorkspaceMessage({
    messageId: 'platform-loop-integration-snapshot',
    sender: 'stephanos',
    recipient: 'operator',
    channel: 'platform-loop-integration',
    kind: status === PLATFORM_LOOP_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION ? 'blocked-reason' : 'status',
    severity: status === PLATFORM_LOOP_STATUS.DONE ? 'info' : 'warning',
    correlationId: goalId,
    relatedGoal: goalId,
    summary: stephanosResponse.conciseReply,
    status,
    proofRefs: ['proof/platform-loop-integration.json'],
    requiresOperator: status !== PLATFORM_LOOP_STATUS.DONE,
  });

  return {
    schemaVersion: PLATFORM_LOOP_INTEGRATION_SCHEMA_VERSION,
    kind: 'stephanos.platform_loop.integration.snapshot',
    goalId,
    status,
    supervisor,
    ignition,
    queueItem,
    queueValidation,
    dispatcherDecision,
    operatorBatch,
    openClawFallback,
    verifierResult,
    stephanosResponse,
    sharedWorkspaceMessage,
    platformStatusProof,
    manualDispatchRequired,
    exactHeadMergeHold,
    liveProofClaims,
    nextAction,
    finalVerdict: status === PLATFORM_LOOP_STATUS.DONE ? 'PLATFORM_LOOP_INTEGRATION_PASS' : 'PLATFORM_LOOP_INTEGRATION_ACTIVE',
  };
}
