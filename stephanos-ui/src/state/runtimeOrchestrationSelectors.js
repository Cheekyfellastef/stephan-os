import { deriveMissionResumability } from './missionLineage.js';
function asText(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function asList(value, limit = 4) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? asText(entry) : asText(entry?.summary || entry?.title || entry?.reason)))
    .filter(Boolean)
    .slice(0, limit);
}

function isKnownValue(value) {
  const normalized = asText(value).toLowerCase();
  return normalized.length > 0 && !['unknown', 'none', 'n/a', 'unavailable', 'pending'].includes(normalized);
}

function explainBuildAssistState(state, context = {}) {
  const nextAction = asText(context.nextRecommendedAction, 'Wait for explicit operator guidance.');
  const blockedReason = asText(context.blockageExplanation, 'No explicit blocker recorded.');
  const map = {
    unavailable: 'Build assistance is unavailable from current mission truth.',
    'analysis-ready': 'Build assistance can analyze and suggest a bounded patch plan.',
    'codex-handoff-ready': 'Build assistance can prepare a Codex handoff package for operator review.',
    'approval-required': 'Build assistance has a viable plan, but explicit approval is required before execution state can advance.',
    'execution-ready': 'Mission is execution-ready and waiting for explicit start.',
    'in-progress': 'Mission execution is marked in progress; keep operator-visible updates explicit.',
    completed: 'Mission is marked completed. Capture outcomes and next continuity step.',
    failed: 'Mission is marked failed. Preserve failure truth and avoid fake recovery claims.',
    blocked: `Mission is blocked: ${blockedReason}`,
    'rollback-recommended': 'Mission outcome indicates rollback is recommended before new execution attempts.',
    'awaiting-validation': 'Codex handoff was applied by operator confirmation; validation outcome is now required.',
  };
  return map[state] || `Build assistance state is ${state}. Next action: ${nextAction}`;
}


function deriveCommandReadiness({
  missionPhase = 'proposed',
  missionBlocked = false,
  codexHandoffReadiness = 'unavailable',
  buildAssistanceReadiness = {},
  approvalReadiness = 'not-required',
  codexExecutionState = 'not-generated',
} = {}) {
  const awaitingApproval = missionPhase === 'proposed' || missionPhase === 'awaiting-approval';
  const executionReady = missionPhase === 'accepted' || missionPhase === 'execution-ready';
  const inProgress = missionPhase === 'in-progress';
  const rollbackEligible = missionPhase === 'failed' || missionPhase === 'completed' || missionPhase === 'rollback-recommended';

  return {
    'accept-mission': {
      allowed: awaitingApproval,
      reason: awaitingApproval ? '' : 'action-not-allowed-in-current-state',
      message: awaitingApproval ? 'Mission can be accepted.' : 'Accept is only available while mission is awaiting approval.',
      approvalRequired: approvalReadiness === 'awaiting-approval',
    },
    'defer-mission': {
      allowed: awaitingApproval,
      reason: awaitingApproval ? '' : 'action-not-allowed-in-current-state',
      message: awaitingApproval ? 'Mission can be deferred.' : 'Defer is only available while mission is awaiting approval.',
      approvalRequired: approvalReadiness === 'awaiting-approval',
    },
    'reject-mission': {
      allowed: awaitingApproval,
      reason: awaitingApproval ? '' : 'action-not-allowed-in-current-state',
      message: awaitingApproval ? 'Mission can be rejected.' : 'Reject is only available while mission is awaiting approval.',
      approvalRequired: approvalReadiness === 'awaiting-approval',
    },
    'start-mission': {
      allowed: executionReady && missionBlocked !== true,
      reason: executionReady ? (missionBlocked ? 'mission-blocked' : '') : 'action-not-allowed-in-current-state',
      message: executionReady
        ? (missionBlocked ? 'Start is blocked until mission blockers are resolved.' : 'Mission can be started.')
        : 'Start is only available when lifecycle is accepted/execution-ready.',
      approvalRequired: buildAssistanceReadiness?.approvalRequired === true,
    },
    'complete-mission': {
      allowed: inProgress,
      reason: inProgress ? '' : 'action-not-allowed-in-current-state',
      message: inProgress ? 'Mission can be completed.' : 'Complete is only available while mission is in-progress.',
      approvalRequired: false,
    },
    'fail-mission': {
      allowed: inProgress,
      reason: inProgress ? '' : 'action-not-allowed-in-current-state',
      message: inProgress ? 'Mission can be failed.' : 'Fail is only available while mission is in-progress.',
      approvalRequired: false,
    },
    'rollback-mission': {
      allowed: rollbackEligible,
      reason: rollbackEligible ? '' : 'action-not-allowed-in-current-state',
      message: rollbackEligible ? 'Mission can be rolled back.' : 'Rollback is only available after failed/completed outcomes.',
      approvalRequired: false,
    },
    'prepare-codex-handoff': {
      allowed: codexHandoffReadiness === 'ready',
      reason: codexHandoffReadiness === 'ready' ? '' : 'codex-handoff-not-ready',
      message: codexHandoffReadiness === 'ready'
        ? 'Codex handoff can be prepared.'
        : 'Codex handoff is unavailable until approval and readiness truth are satisfied.',
      approvalRequired: false,
    },
    'mark-handoff-applied': {
      allowed: ['generated', 'handed-off'].includes(codexExecutionState),
      reason: ['generated', 'handed-off'].includes(codexExecutionState) ? '' : 'handoff-not-generated-or-handed-off',
      message: ['generated', 'handed-off'].includes(codexExecutionState)
        ? 'Operator can confirm handoff applied.'
        : 'Handoff must be generated/handed-off before apply confirmation.',
      approvalRequired: false,
    },
    'mark-handoff-failed': {
      allowed: ['generated', 'handed-off', 'applied'].includes(codexExecutionState),
      reason: ['generated', 'handed-off', 'applied'].includes(codexExecutionState) ? '' : 'handoff-failure-not-allowed',
      message: ['generated', 'handed-off', 'applied'].includes(codexExecutionState)
        ? 'Operator can mark handoff failed.'
        : 'No active handoff state supports failure marking.',
      approvalRequired: false,
    },
    'mark-handoff-rolled-back': {
      allowed: ['failed', 'rollback-recommended'].includes(missionPhase) || codexExecutionState === 'failed',
      reason: ['failed', 'rollback-recommended'].includes(missionPhase) || codexExecutionState === 'failed' ? '' : 'rollback-not-allowed',
      message: ['failed', 'rollback-recommended'].includes(missionPhase) || codexExecutionState === 'failed'
        ? 'Operator can mark the handoff rolled back.'
        : 'Rollback marking is available after failure/rollback recommendation only.',
      approvalRequired: false,
    },
    'confirm-validation-passed': {
      allowed: codexExecutionState === 'applied',
      reason: codexExecutionState === 'applied' ? '' : 'handoff-not-applied',
      message: codexExecutionState === 'applied'
        ? 'Operator can confirm validation passed.'
        : 'Validation pass can be confirmed only after apply confirmation.',
      approvalRequired: false,
    },
    'confirm-validation-failed': {
      allowed: codexExecutionState === 'applied',
      reason: codexExecutionState === 'applied' ? '' : 'handoff-not-applied',
      message: codexExecutionState === 'applied'
        ? 'Operator can confirm validation failed.'
        : 'Validation fail can be confirmed only after apply confirmation.',
      approvalRequired: false,
    },
    'resume-mission': {
      allowed: true,
      reason: '',
      message: 'Resume guidance can be requested at any time from persisted mission lineage truth.',
      approvalRequired: false,
    },
  };
}


export function deriveRuntimeOrchestrationSelectors({
  canonicalMemoryContext = {},
  canonicalCurrentIntent = {},
  canonicalMissionPacket = {},
  missionPacketWorkflow = {},
  missionLineage = {},
  finalRouteTruth = null,
} = {}) {
  const intent = canonicalCurrentIntent?.operatorIntent || {};
  const packet = canonicalMissionPacket || {};
  const memory = canonicalMemoryContext || {};
  const execution = canonicalCurrentIntent?.executionState || {};
  const continuityLoopState = asText(memory?.activeMissionContinuity?.continuityLoopState, 'unknown');
  const continuitySparse = memory?.sparseData === true;

  const continuityStrength = continuitySparse
    ? 'sparse'
    : (continuityLoopState === 'live' || continuityLoopState === 'active')
      ? 'strong'
      : continuityLoopState === 'degraded'
        ? 'degraded'
        : 'unknown';

  const workflowDecision = Array.isArray(missionPacketWorkflow?.decisions)
    ? missionPacketWorkflow.decisions[0]
    : null;
  const codexHandoff = canonicalMissionPacket?.codexExecution && typeof canonicalMissionPacket.codexExecution === 'object'
    ? canonicalMissionPacket.codexExecution
    : {};

  const missionPhase = asText(packet?.currentPhase, 'proposed');
  const blockedItems = asList(packet?.blockers, 6);
  const blockedByRoute = finalRouteTruth?.backendReachable === false;
  const blockedByIntent = asText(intent?.source) === 'unknown';
  const blockedBySparseIntent = asText(intent?.source) === 'inferred' && continuityStrength === 'sparse';
  const blockedByApproval = missionPhase === 'awaiting-approval' || missionPhase === 'proposed';
  const missionBlocked = missionPhase === 'failed'
    || blockedItems.length > 0
    || blockedByRoute
    || blockedBySparseIntent
    || blockedByIntent;

  const blockageExplanation = missionPhase === 'failed'
    ? 'Mission packet lifecycle is failed and requires explicit triage.'
    : blockedItems[0]
      || (blockedByRoute ? 'Backend route is unreachable from the current runtime session.' : '')
      || (blockedBySparseIntent ? 'Intent is inferred while continuity is sparse; explicit operator objective is required.' : '')
      || (blockedByIntent ? 'Current intent is unknown; mission cannot safely advance.' : '')
      || '';

  const approvalReadiness = blockedByApproval
    ? 'awaiting-approval'
    : (missionPhase === 'accepted' || missionPhase === 'execution-ready')
      ? 'approval-satisfied'
      : 'not-required';

  const codexExecutionState = asText(codexHandoff?.status, 'not-generated');
  const codexHandoffReadiness = codexExecutionState === 'generated'
    ? 'generated'
    : codexExecutionState === 'handed-off'
      ? 'waiting-for-operator-apply'
      : codexExecutionState === 'applied'
        ? 'awaiting-validation'
        : codexExecutionState === 'validated'
          ? 'validated'
          : codexExecutionState === 'failed'
            ? 'failed'
            : codexExecutionState === 'rolled-back'
              ? 'rolled-back'
              : asText(packet?.approvalExecutionStatus?.accepted) === 'yes'
    ? 'ready'
    : blockedByApproval
      ? 'awaiting-approval'
      : missionBlocked
        ? 'blocked'
        : 'unavailable';

  const executionState = asText(execution?.status, 'not-executing');
  const buildAssistanceReadiness = codexExecutionState === 'applied'
    ? 'awaiting-validation'
    : missionPhase === 'rolled-back'
    ? 'rollback-recommended'
    : missionPhase === 'completed'
      ? 'completed'
      : missionPhase === 'failed'
        ? 'failed'
        : missionPhase === 'in-progress'
          ? 'in-progress'
          : missionBlocked
            ? 'blocked'
            : blockedByApproval
              ? (asText(packet?.approvalExecutionStatus?.accepted) === 'yes' ? 'approval-required' : 'analysis-ready')
              : asText(packet?.approvalExecutionStatus?.accepted) === 'yes'
                ? (executionState === 'not-executing' ? 'execution-ready' : executionState)
                : 'codex-handoff-ready';

  const nextRecommendedAction = codexExecutionState === 'generated'
    ? 'Codex handoff generated. Hand off externally, then confirm when applied.'
    : codexExecutionState === 'handed-off'
      ? 'Waiting for operator to apply the handoff externally.'
      : codexExecutionState === 'applied'
        ? 'Handoff applied, awaiting validation via stephanos:build and stephanos:verify.'
        : codexExecutionState === 'validated'
          ? 'Validation passed, mission complete.'
          : codexExecutionState === 'failed'
            ? 'Validation failed, rollback recommended.'
            : codexExecutionState === 'rolled-back'
              ? 'Handoff rolled back. Confirm next recovery mission.'
              : missionBlocked
    ? `Resolve blockage: ${asText(blockageExplanation, 'confirm operator objective and route truth')}`
    : blockedByApproval
      ? 'Review mission packet and choose accept/reject/defer explicitly.'
      : codexHandoffReadiness === 'ready'
        ? 'Prepare Codex handoff payload and request explicit start approval.'
        : asText(packet?.recommendedNextAction, 'Advance mission with explicit operator control.');


  const missionResumability = deriveMissionResumability(missionLineage, {
    preferredMissionId: asText(packet?.packetKey),
  });
  const sessionKind = asText(finalRouteTruth?.sessionKind, 'local-dev');
  const hostedSession = sessionKind === 'hosted-web' || sessionKind === 'hosted' || sessionKind === 'hosted_web';
  const localAuthorityAvailable = hostedSession === false && finalRouteTruth?.backendReachable === true;
  const routeKind = asText(finalRouteTruth?.routeKind, 'unavailable');
  const selectedProvider = asText(finalRouteTruth?.selectedProvider, 'unknown');
  const executableProvider = asText(finalRouteTruth?.executedProvider, 'unknown');
  const hostedCloudPathAvailable = finalRouteTruth?.hostedCloudPathAvailable === true;
  const cloudCognitionAvailable = hostedCloudPathAvailable
    || (routeKind === 'cloud' && (finalRouteTruth?.routeUsable !== false || isKnownValue(executableProvider) || isKnownValue(selectedProvider)));
  const hostedSafePlanningAvailable = true;
  const intentCaptureAvailable = true;
  const researchRouteAvailable = finalRouteTruth?.routeUsable !== false && routeKind !== 'unavailable';
  const continuityAvailable = continuityStrength !== 'unknown';
  const executionAvailable = localAuthorityAvailable;
  const routeRecoveryNeeded = localAuthorityAvailable === false;
  const executionDeferred = !executionAvailable;
  const capabilityMode = localAuthorityAvailable
    ? 'full-local-authority'
    : cloudCognitionAvailable
      ? 'hosted-safe-cloud-cognition'
      : hostedSafePlanningAvailable
        ? 'planning-only-degraded'
        : routeRecoveryNeeded
          ? 'recovery-needed'
          : 'execution-deferred';
  const operatorSummary = localAuthorityAvailable
    ? 'Local authority available; execution, planning, and continuity are online.'
    : cloudCognitionAvailable
      ? 'Battle Bridge unavailable; hosted cloud cognition available. Hosted-safe planning and reasoning remain available. Execution deferred pending local authority.'
      : hostedSafePlanningAvailable
        ? 'Route recovery needed for local authority, but hosted orchestration can continue.'
        : 'Recovery needed. Capture intent and continuity while route truth is restored.';

  const capabilityPosture = {
    mode: capabilityMode,
    localAuthorityAvailable,
    hostedSafePlanningAvailable,
    cloudCognitionAvailable,
    executionAvailable,
    executionDeferred,
    routeRecoveryNeeded,
    intentCaptureAvailable,
    researchAvailable: Boolean(researchRouteAvailable),
    continuityResumeAvailable: continuityAvailable,
    deferredDomains: executionDeferred ? ['local-execution'] : [],
    operatorSummary,
  };

  const missionConsoleMode = {
    posture: localAuthorityAvailable ? 'battle-bridge-mode' : hostedSession ? 'hosted-safe-orchestration-mode' : 'planning-only-mode',
    localAuthorityAvailable,
    executionDeferredToBattleBridge: executionDeferred,
    hostedSafePlanningAvailable,
    hostedResearchAvailable: Boolean(researchRouteAvailable),
    continuityAvailable,
    reason: localAuthorityAvailable
      ? 'Local authority path is reachable; execution-capable mission actions are available.'
      : cloudCognitionAvailable
        ? 'Hosted-safe cloud cognition remains online; planning and intent capture continue while execution defers to Battle Bridge.'
        : hostedSession
          ? 'Hosted surface detected: planning, decomposition, and continuity remain available while execution defers to Battle Bridge.'
          : 'No confirmed local authority. Planning and resumable prep remain available.',
  };
  const selectedProviderConfigured = !['', 'unknown', 'none', 'n/a'].includes(selectedProvider.toLowerCase());
  const executableProviderAvailable = !['', 'unknown', 'none', 'n/a'].includes(executableProvider.toLowerCase());
  const providerExecutionSummary = selectedProviderConfigured && !executableProviderAvailable
    ? `${selectedProvider} selected, but no executable route exists.`
    : selectedProviderConfigured && executableProviderAvailable
      ? (hostedCloudPathAvailable
        ? `${selectedProvider} selected, backend execution unavailable, hosted cloud path executable as ${finalRouteTruth?.actualProviderPath || executableProvider}.`
        : `${selectedProvider} selected and ${executableProvider} executable.`)
      : 'Provider choice pending explicit configuration.';
  const operatorActionLadder = [
    blockedByIntent ? '1) establish intent / create mission packet' : '1) intent established / mission packet can be refined',
    '2) optionally queue hosted-safe planning tasks',
    blockedByRoute ? '3) retry remembered bridge validation' : '3) route currently reachable; monitor bridge health',
    blockedByRoute ? '4) defer execution to Battle Bridge if route remains unavailable' : '4) execute when operator approval is complete',
  ];
  const commandReadiness = deriveCommandReadiness({
    missionPhase,
    missionBlocked,
    codexHandoffReadiness,
    buildAssistanceReadiness: { state: buildAssistanceReadiness, approvalRequired: blockedByApproval },
    approvalReadiness,
    codexExecutionState,
  });

  return {
    selectorVersion: 'runtime-orchestration-selectors.v1',
    currentMissionState: {
      missionTitle: asText(packet?.missionTitle, 'not yet established'),
      packetKey: asText(packet?.packetKey, ''),
      missionPhase,
      intentLabel: asText(intent?.label, 'unknown'),
      intentSource: asText(intent?.source, 'unknown'),
      executionState,
      inferredIntent: asText(intent?.source) === 'inferred',
      lifecycleDecision: asText(workflowDecision?.decision, 'pending-review'),
      codexHandoffStatus: codexExecutionState,
      validationStatus: asText(codexHandoff?.validationStatus, 'not-run'),
      lastHandoffAction: asText(codexHandoff?.lastOperatorAction, 'none'),
    },
    continuityLoopState: {
      state: continuityLoopState,
      strength: continuityStrength,
      sparse: continuitySparse,
      lastEventAt: asText(memory?.activeMissionContinuity?.lastEventAt, 'not-yet-established'),
    },
    approvalReadiness,
    codexHandoffReadiness,
    codexExecutionState,
    blockageExplanation: asText(blockageExplanation, ''),
    nextRecommendedAction,
    missionBlocked,
    buildAssistanceReadiness: {
      state: buildAssistanceReadiness,
      explanation: explainBuildAssistState(buildAssistanceReadiness, {
        nextRecommendedAction,
        blockageExplanation,
      }),
      approvalRequired: blockedByApproval,
      operatorControlRequired: true,
    },
    commandReadiness,
    operatorFeedbackState: {
      summary: `Mission ${asText(packet?.missionTitle, 'not yet established')} is ${missionPhase}. Intent is ${asText(intent?.source, 'unknown')}.`,
      blocked: missionBlocked,
      blockageExplanation: asText(blockageExplanation, 'No active blocker recorded.'),
      nextRecommendedAction,
      continuityStrength,
    },
    missionResumability,
    capabilityPosture,
    missionConsoleMode,
    providerExecutionSummary,
    operatorActionLadder,
    promptBuilderSnapshot: {
      activeMissionSummary: asText(missionResumability?.missionSummary, 'No active mission.'),
      resumableMissionCount: Number.isFinite(Number(missionResumability?.resumableMissionCount)) ? Number(missionResumability.resumableMissionCount) : 0,
      lastKnownMissionState: asText(missionResumability?.lastStableState?.lifecycleState, 'unknown'),
      nextResumableAction: asText(missionResumability?.nextRecommendedAction, nextRecommendedAction),
    },
  };
}
