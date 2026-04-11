import { applyMissionPacketAction, deriveMissionPacketActionState, normalizeMissionPacketTruth, normalizeMissionPacketWorkflow } from './missionPacketWorkflow.js';

function asText(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

const COMMAND_ALIASES = Object.freeze({
  'accept mission': 'accept-mission',
  'defer mission': 'defer-mission',
  'reject mission': 'reject-mission',
  'start mission': 'start-mission',
  'complete mission': 'complete-mission',
  'fail mission': 'fail-mission',
  'rollback mission': 'rollback-mission',
  'prepare codex handoff': 'prepare-codex-handoff',
  'mark handoff as applied': 'mark-handoff-applied',
  'mark handoff as failed': 'mark-handoff-failed',
  'mark handoff as rolled back': 'mark-handoff-rolled-back',
  'validation passed': 'confirm-validation-passed',
  'validation failed': 'confirm-validation-failed',
  'what can the ai do right now?': 'what-can-ai-do',
  'what can the ai do right now': 'what-can-ai-do',
  'why is this blocked?': 'why-blocked',
  'why is this blocked': 'why-blocked',
});

const INTENT_TO_WORKFLOW_ACTION = Object.freeze({
  'accept-mission': 'accept',
  'defer-mission': 'defer',
  'reject-mission': 'reject',
  'start-mission': 'start',
  'complete-mission': 'complete',
  'fail-mission': 'fail',
  'rollback-mission': 'rollback',
  'prepare-codex-handoff': 'prepare-codex-handoff',
  'mark-handoff-applied': 'mark-handoff-applied',
  'mark-handoff-failed': 'mark-handoff-failed',
  'mark-handoff-rolled-back': 'mark-handoff-rolled-back',
  'confirm-validation-passed': 'confirm-validation-passed',
  'confirm-validation-failed': 'confirm-validation-failed',
});

export function normalizeOperatorLifecycleIntent(input = '') {
  const normalized = asText(input).toLowerCase();
  return COMMAND_ALIASES[normalized] || 'unsupported';
}

function buildEnvelope({
  commandType,
  packetTruth,
  selectors,
  actionRequested,
  actionAllowed = false,
  actionApplied = false,
  blockageReason = '',
  nextRecommendedAction = '',
  operatorMessage = '',
  truthWarnings = [],
  approvalRequired = false,
  workflowAction = '',
  workflow = null,
  status = 'rejected-due-to-truth-constraints',
} = {}) {
  return {
    commandType,
    targetMissionId: asText(packetTruth?.moveId),
    packetKey: asText(selectors?.currentMissionState?.packetKey),
    actionRequested,
    actionAllowed,
    actionApplied,
    resultingLifecycleState: asText(selectors?.currentMissionState?.missionPhase, 'unknown'),
    resultingBuildAssistanceState: asText(selectors?.buildAssistanceReadiness?.state, 'unavailable'),
    blockageReason: asText(blockageReason, ''),
    nextRecommendedAction: asText(nextRecommendedAction || selectors?.nextRecommendedAction, 'Await explicit operator guidance.'),
    operatorMessage: asText(operatorMessage, 'No operator feedback available.'),
    truthWarnings: Array.isArray(truthWarnings) ? truthWarnings.filter(Boolean).slice(0, 4) : [],
    approvalRequired: approvalRequired === true,
    workflowAction: asText(workflowAction),
    workflow,
    status,
  };
}

export function adjudicateOperatorLifecycleIntent({
  commandText = '',
  intentKey = '',
  selectors = {},
  missionPacketWorkflow = {},
  packetTruth = {},
  now = new Date().toISOString(),
} = {}) {
  const resolvedIntent = intentKey || normalizeOperatorLifecycleIntent(commandText);
  const normalizedPacketTruth = normalizeMissionPacketTruth(packetTruth);
  const normalizedWorkflow = normalizeMissionPacketWorkflow(missionPacketWorkflow);
  const actionState = deriveMissionPacketActionState(normalizedWorkflow, normalizedPacketTruth);
  const commandReadiness = selectors?.commandReadiness || {};
  const missionTitle = asText(selectors?.currentMissionState?.missionTitle, 'not yet established');
  const hasActiveMission = normalizedPacketTruth.active || Boolean(normalizedPacketTruth.moveId) || missionTitle !== 'not yet established';

  if (resolvedIntent === 'unsupported') {
    return buildEnvelope({
      commandType: 'mission-lifecycle',
      packetTruth: normalizedPacketTruth,
      selectors,
      actionRequested: 'unsupported',
      blockageReason: 'unsupported-command',
      operatorMessage: 'Unsupported operator lifecycle command.',
      status: 'unsupported-command',
    });
  }

  if (resolvedIntent === 'what-can-ai-do') {
    const state = asText(selectors?.buildAssistanceReadiness?.state, 'unavailable');
    return buildEnvelope({
      commandType: 'mission-guidance',
      packetTruth: normalizedPacketTruth,
      selectors,
      actionRequested: resolvedIntent,
      actionAllowed: true,
      actionApplied: false,
      operatorMessage: `AI assistance ${state}: ${asText(selectors?.buildAssistanceReadiness?.explanation, 'Build assistance is unavailable until mission truth is established.')}`,
      status: 'action-completed',
    });
  }

  if (resolvedIntent === 'why-blocked') {
    const blocked = selectors?.missionBlocked === true;
    return buildEnvelope({
      commandType: 'mission-guidance',
      packetTruth: normalizedPacketTruth,
      selectors,
      actionRequested: resolvedIntent,
      actionAllowed: true,
      actionApplied: false,
      blockageReason: blocked ? asText(selectors?.blockageExplanation, 'Blockage reason unavailable.') : '',
      operatorMessage: blocked
        ? `Blocked: ${asText(selectors?.blockageExplanation, 'blockage reason unavailable')}`
        : 'Mission is not currently blocked or no blocked mission was recorded.',
      status: 'action-completed',
    });
  }

  if (!hasActiveMission) {
    return buildEnvelope({
      commandType: 'mission-lifecycle',
      packetTruth: normalizedPacketTruth,
      selectors,
      actionRequested: resolvedIntent,
      blockageReason: 'no-active-mission-context',
      operatorMessage: 'No active mission context is available for lifecycle transitions.',
      approvalRequired: selectors?.buildAssistanceReadiness?.approvalRequired === true,
      status: 'no-active-mission-context',
    });
  }

  const readiness = commandReadiness[resolvedIntent] || { allowed: false, reason: 'action-not-allowed-in-current-state' };
  const workflowAction = INTENT_TO_WORKFLOW_ACTION[resolvedIntent] || '';

  if (!workflowAction) {
    return buildEnvelope({
      commandType: 'mission-lifecycle',
      packetTruth: normalizedPacketTruth,
      selectors,
      actionRequested: resolvedIntent,
      blockageReason: 'unsupported-command',
      operatorMessage: 'Unsupported lifecycle action.',
      status: 'unsupported-command',
    });
  }

  if (readiness.approvalRequired === true && readiness.allowed !== true) {
    return buildEnvelope({
      commandType: 'mission-lifecycle',
      packetTruth: normalizedPacketTruth,
      selectors,
      actionRequested: resolvedIntent,
      actionAllowed: false,
      actionApplied: false,
      blockageReason: asText(readiness.reason, 'approval-required'),
      operatorMessage: asText(readiness.message, 'Action is blocked pending explicit approval.'),
      approvalRequired: true,
      status: 'action-allowed-but-approval-required',
    });
  }

  if (readiness.allowed !== true) {
    return buildEnvelope({
      commandType: 'mission-lifecycle',
      packetTruth: normalizedPacketTruth,
      selectors,
      actionRequested: resolvedIntent,
      actionAllowed: false,
      actionApplied: false,
      blockageReason: asText(readiness.reason, 'action-not-allowed-in-current-state'),
      operatorMessage: asText(readiness.message, 'Action is not allowed in the current mission lifecycle state.'),
      approvalRequired: selectors?.buildAssistanceReadiness?.approvalRequired === true,
      status: 'action-not-allowed-in-current-state',
    });
  }

  const nextWorkflow = applyMissionPacketAction(normalizedWorkflow, {
    action: workflowAction,
    packetTruth: normalizedPacketTruth,
    now,
  });

  const before = JSON.stringify(normalizedWorkflow);
  const after = JSON.stringify(nextWorkflow);
  const actionApplied = before !== after || workflowAction === 'prepare-codex-handoff';
  const gateAfter = deriveMissionPacketActionState(nextWorkflow, normalizedPacketTruth);

  return buildEnvelope({
    commandType: 'mission-lifecycle',
    packetTruth: normalizedPacketTruth,
    selectors: {
      ...selectors,
      currentMissionState: {
        ...(selectors?.currentMissionState || {}),
        missionPhase: gateAfter.lifecycleStatus,
      },
      buildAssistanceReadiness: {
        ...(selectors?.buildAssistanceReadiness || {}),
      },
    },
    actionRequested: resolvedIntent,
    actionAllowed: true,
    actionApplied,
    blockageReason: actionApplied ? '' : 'action-rejected-due-to-truth-constraints',
    operatorMessage: actionApplied
      ? `Mission ${workflowAction} applied: lifecycle=${gateAfter.lifecycleStatus}, handoff=${gateAfter.codexHandoffStatus}, validation=${gateAfter.validationStatus}.`
      : 'Lifecycle action was not applied due to truth constraints.',
    approvalRequired: selectors?.buildAssistanceReadiness?.approvalRequired === true,
    workflowAction,
    workflow: nextWorkflow,
    status: actionApplied ? 'action-completed' : 'action-rejected-due-to-truth-constraints',
  });
}
