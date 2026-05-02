import { adjudicateAgentTaskLayer } from './agentTaskAdjudicator.mjs';
import { buildOpenClawCapabilityReport, buildOpenClawCapabilityTrialState, evaluateReadonlyValidationTruth } from './openClawCapabilityTrial.mjs';
import { buildOpenClawOversightProposal } from './openClawOversightProposal.mjs';
import { buildOpenClawPermissionEnvelope } from './openClawPermissionEnvelope.mjs';
import { buildOpenClawPermissionDiff } from './openClawPermissionDiff.mjs';
import { buildOpenClawApprovalGate } from './openClawApprovalGate.mjs';
import { createOpenClawAuditPreviewEvent } from './openClawAuditLedger.mjs';
import { buildOpenClawRollbackPlan } from './openClawRollbackPlan.mjs';
import { buildOpenClawProposalPacket } from './openClawProposalPacket.mjs';
import { buildOpenClawProposalEvidenceProjection } from './openClawProposalEvidence.mjs';
import { buildOpenClawProposalReviewQueue } from './openClawProposalReviewQueue.mjs';
import { buildOpenClawOperatorReviewQueue } from './openClawOperatorReviewQueue.mjs';
import { buildOpenClawOperatorReviewHandoff } from './openClawOperatorReviewHandoff.mjs';
import { buildOpenClawCodexProposalExport } from './openClawCodexProposalExport.mjs';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toChip(value = '', fallback = 'unknown') {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : fallback;
}

function mapLayerStatusToDashboardStatus(layerStatus = '', lifecycleState = '', { hasCanonicalEvidence = false } = {}) {
  const normalizedLayer = String(layerStatus || '').trim().toLowerCase();
  const normalizedLifecycle = String(lifecycleState || '').trim().toLowerCase();
  if (['blocked', 'failed', 'cancelled'].includes(normalizedLifecycle) || normalizedLayer === 'blocked') return 'blocked';
  if (['complete', 'verified'].includes(normalizedLifecycle)) return 'ready';
  if (normalizedLifecycle === 'draft') return hasCanonicalEvidence ? 'started' : 'not_started';
  if (['in_progress', 'sent_to_agent'].includes(normalizedLifecycle) || normalizedLayer === 'in_progress') return 'started';
  if (normalizedLayer === 'ready') return 'ready';
  if (normalizedLayer === 'preparing' && hasCanonicalEvidence) return 'started';
  if (normalizedLifecycle) return 'partial';
  return 'unknown';
}

function mapCodexReadiness(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'ready') return 'ready';
  if (normalized === 'manual_handoff_only') return 'manual_handoff_only';
  if (normalized === 'needs_adapter') return 'manual_handoff_only';
  if (['blocked', 'needs_approval'].includes(normalized)) return 'blocked';
  if (normalized === 'unavailable') return 'unavailable';
  return 'unknown';
}

function mapVerificationStatus(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'passed') return 'ready';
  if (normalized === 'not_started') return 'not_started';
  if (['running', 'started'].includes(normalized)) return 'started';
  if (normalized === 'partial') return 'partial';
  if (['blocked', 'failed', 'cancelled'].includes(normalized)) return 'blocked';
  return 'unknown';
}

function mapVerificationReturnStatus(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'verified') return 'ready';
  if (normalized === 'waiting_for_return' || normalized === 'none') return 'not_started';
  if (normalized === 'verifying') return 'started';
  if (normalized === 'verification_required' || normalized === 'incomplete' || normalized === 'received') return 'partial';
  if (normalized === 'blocked' || normalized === 'failed') return 'blocked';
  return 'unknown';
}



function buildOpenClawStageEvidence({ policySummary = {}, adapterSummary = {}, adapterStub = {} } = {}) {
  const policyMode = String(policySummary.integrationMode || 'policy_only').trim() || 'policy_only';
  const killSwitchState = String(policySummary.killSwitchState || 'missing').trim() || 'missing';
  const adapterMode = String(adapterSummary.adapterMode || 'unknown').trim() || 'unknown';
  const adapterReadiness = String(adapterSummary.adapterReadiness || 'unknown').trim() || 'unknown';
  const stubStatus = String(adapterStub.stubStatus || 'unknown').trim() || 'unknown';
  const connection = adapterSummary.adapterConnection || {};
  const connectionConfig = connection.connectionConfig || {};
  const healthHandshake = connection.healthHandshake || {};
  const protocol = healthHandshake.protocol || {};
  const readonlyAssurance = healthHandshake.readonlyAssurance || {};
  const connectionState = String(connection.connectionState || adapterSummary.adapterConnectionState || 'unknown').trim() || 'unknown';
  const result = {
    policyPresent: policyMode !== 'unavailable',
    policyMode,
    killSwitchRepresented: killSwitchState !== 'missing',
    killSwitchState,
    adapterContractPresent: ['contract_defined', 'local_stub', 'connected'].includes(adapterReadiness)
      || ['contract_defined', 'local_stub', 'connected'].includes(adapterMode),
    adapterMode,
    adapterReadiness,
    stubPresent: ['health_check_only', 'simulated_ready', 'present_disabled'].includes(stubStatus),
    stubStatus,
    stubHealth: String(adapterStub.stubHealth || 'unknown').trim() || 'unknown',
    connectionState,
    executionAllowed: policySummary.openClawExecutionAllowed === true,
    connectionMode: String(connection.connectionMode || 'unknown').trim() || 'unknown',
    connectionHealth: String(connection.healthCheckState || 'not_run').trim() || 'not_run',
    connectionHandshake: String(connection.handshakeState || 'not_run').trim() || 'not_run',
    'openclaw-endpoint': connection.endpointConfigured === true ? 'configured' : 'missing',
    'openclaw-endpoint-scope': String(connection.endpointScope || connectionConfig.endpointScope || 'none').trim() || 'none',
    'openclaw-health': String(healthHandshake.healthState || connection.healthCheckState || 'not_run').trim() || 'not_run',
    'openclaw-handshake': String(healthHandshake.handshakeState || connection.handshakeState || 'not_run').trim() || 'not_run',
    'openclaw-validation-endpoint': healthHandshake.readonlyValidationEndpoint?.available === true ? 'available' : 'missing',
    'openclaw-validation': String(healthHandshake.validationStatus || healthHandshake.validation?.validationStatus || 'idle').trim() || 'idle',
    'openclaw-protocol': protocol.compatible === true ? 'compatible' : `mismatch:${String(protocol.mismatchReason || 'unknown').trim() || 'unknown'}`,
    'openclaw-identity': String((healthHandshake.adapterIdentity || {}).id || connection.adapterIdentity || 'missing').trim() || 'missing',
    'openclaw-readonly': readonlyAssurance.readonlyOnly === true ? 'asserted' : 'not_asserted',
    'openclaw-execution': 'disabled',
    connectionExecution: 'disabled',
    safeToUse: policySummary.openClawSafeToUse === true,
  };
  return result;
}

function buildOpenClawControlPlane({ policySummary = {}, operatorSurface = {}, operatorReviewHandoff = {}, capabilityReport = {}, oversightProposal = {}, proposalPacket = {}, proposalReviewQueue = {} } = {}) {
  const killSwitchEngaged = operatorSurface.openClawKillSwitchEngaged === true;
  const paused = String(operatorSurface.openClawPauseState || 'not_configured') === 'paused';
  const validationAvailable = operatorSurface.openClawReadonlyValidationEndpointAvailable === true;
  const validationStatus = String(operatorSurface.openClawHealthValidationStatus || 'idle');
  const executionAllowed = false;
  const readonlyTruth = evaluateReadonlyValidationTruth({ operatorSurface });
  const reportReady = String(capabilityReport.reportStatus || '').toLowerCase() === 'ready';
  const packetReady = String(proposalPacket.packetStatus || '').toLowerCase() === 'ready_for_operator_review';
  const queueReady = String(proposalReviewQueue.queueStatus || '').toLowerCase() === 'ready_for_operator_review';
  const oversightReady = String(oversightProposal.proposalStatus || '').toLowerCase() === 'ready_for_operator_review';
  const openClawControlMode = killSwitchEngaged
    ? 'disabled'
    : paused
      ? 'paused'
      : (packetReady || queueReady || oversightReady)
        ? 'ready_for_operator_review'
        : validationAvailable
          ? (readonlyTruth.adapterValidated ? 'readonly_validation_complete' : 'readonly_validation')
          : 'readonly_validation';
  const openClawControlNextAction = killSwitchEngaged
    ? 'Kill switch engaged: OpenClaw control plane blocked. Execution remains disabled.'
    : paused
      ? 'Paused: readonly validation is paused. Execution remains disabled.'
      : !readonlyTruth.adapterValidated
        ? (validationAvailable && validationStatus !== 'idle' ? 'Re-run readonly health/handshake validation.' : 'Validate readonly health/handshake.')
        : !reportReady
          ? 'Run readonly capability trial.'
          : (packetReady || queueReady)
            ? 'Submit packet for operator review.'
            : oversightReady
              ? 'Prepare proposal packet for operator review.'
              : (operatorReviewHandoff.nextAction || 'Keep proposal-only review path and collect evidence.');
  return {
    openClawControlMode,
    openClawKillSwitchEngaged: killSwitchEngaged,
    openClawPauseState: paused ? 'paused' : 'resumed',
    openClawExecutionAllowed: executionAllowed,
    openClawReadonlyValidationAvailable: validationAvailable,
    openClawReadonlyValidationStatus: validationStatus,
    openClawControlNextAction,
    openClawControlEvidence: [
      `kill_switch:${killSwitchEngaged ? 'engaged' : 'disengaged'}`,
      `pause_state:${paused ? 'paused' : 'resumed'}`,
      `validation_available:${validationAvailable ? 'yes' : 'no'}`,
      `validation_status:${validationStatus}`,
      'execution:disabled',
    ],
  };
}
export function buildAgentTaskProjection({ model = {}, context = {} } = {}) {
  const adjudicated = adjudicateAgentTaskLayer({ model, context });
  const pendingApprovals = asArray(adjudicated.approval.pending);
  const blockers = asArray(adjudicated.blockers);
  const warnings = asArray(adjudicated.warnings);
  const lifecycleState = adjudicated.model.taskLifecycle.state;
  const hasCanonicalEvidence = true;
  const dashboardStatus = mapLayerStatusToDashboardStatus(adjudicated.layerStatus, lifecycleState, { hasCanonicalEvidence });
  const dashboardCodexReadiness = mapCodexReadiness(adjudicated.codexReadiness);
  const dashboardVerificationStatus = mapVerificationReturnStatus(adjudicated.verificationReturn.verificationReturnStatus)
    || mapVerificationStatus(adjudicated.verification.status);
  const adapter = adjudicated.openClawAdapterSummary || adjudicated.openClawPolicySummary?.openClawAdapter || {};
  const adapterTopBlocker = (Array.isArray(adapter.adapterBlockers) ? adapter.adapterBlockers[0] : '') || '';
  const adapterStub = adapter.adapterStub || {};
  const connection = adapter.adapterConnection || {};
  const connectionConfig = connection.connectionConfig || {};
  const healthHandshake = connection.healthHandshake || {};
  const protocol = healthHandshake.protocol || {};
  const identity = healthHandshake.adapterIdentity || {};
  const readonlyAssurance = healthHandshake.readonlyAssurance || {};
  const adapterStubTopBlocker = (Array.isArray(adapterStub.stubBlockers) ? adapterStub.stubBlockers[0] : '') || '';
  const openClawStageEvidence = buildOpenClawStageEvidence({
    policySummary: adjudicated.openClawPolicySummary || {},
    adapterSummary: adapter || {},
    adapterStub: adapterStub || {},
  });
  const nextAction = {
    title: adjudicated.nextAction.title,
    priority: 1,
    reason: adjudicated.nextAction.reason,
    blocks: asArray(adjudicated.nextAction.blocks),
  };
  const evidence = [
    ...asArray(adjudicated.reasons),
    ...asArray(adjudicated.dependencies),
    ...asArray(adjudicated.sourceSignals),
  ].filter(Boolean);
  const capabilityTrialSeed = {
    openClawHealthValidationStatus: healthHandshake.validationStatus || healthHandshake.validation?.validationStatus || 'idle',
    openClawHealthState: healthHandshake.healthState || connection.healthCheckState || 'not_run',
    openClawHandshakeState: healthHandshake.handshakeState || connection.handshakeState || 'not_run',
    openClawProtocolCompatible: protocol.compatible === true,
    openClawAdapterIdentity: identity.id || connection.adapterIdentity || '',
    openClawReadonlyAssurance: readonlyAssurance,
  };
  const readonlyTruth = evaluateReadonlyValidationTruth({
    validationStatus: capabilityTrialSeed.openClawHealthValidationStatus,
    healthState: capabilityTrialSeed.openClawHealthState,
    handshakeState: capabilityTrialSeed.openClawHandshakeState,
    protocolCompatible: capabilityTrialSeed.openClawProtocolCompatible,
    readonlyAssurance: capabilityTrialSeed.openClawReadonlyAssurance,
    executionDisabled: true,
  });
  const capabilityTrial = buildOpenClawCapabilityTrialState({ operatorSurface: capabilityTrialSeed });
  const capabilityReport = buildOpenClawCapabilityReport({ operatorSurface: capabilityTrialSeed });
  const openClawOversightProposal = buildOpenClawOversightProposal({
    readonlyTruth,
    capabilityTrial,
  });
  const openClawPermissionEnvelope = buildOpenClawPermissionEnvelope({
    readonlyValidated: readonlyTruth.adapterValidated === true,
    evidenceTokens: capabilityReport.evidenceTokens || [],
  });
  const openClawPermissionDiff = buildOpenClawPermissionDiff({
    currentEnvelope: openClawPermissionEnvelope,
    requestedEnvelope: openClawPermissionEnvelope,
  });
  const openClawRollbackPlan = buildOpenClawRollbackPlan();
  const openClawApprovalGate = buildOpenClawApprovalGate({
    readonlyValidated: readonlyTruth.adapterValidated === true,
    capabilityReportReady: capabilityReport.reportStatus === 'ready',
    permissionDiffReady: openClawPermissionDiff.diffStatus === 'preview_ready',
    auditPreviewReady: true,
    rollbackReady: openClawRollbackPlan.rollbackAvailable === true,
    riskPresent: true,
  });
  const openClawAuditLedgerPreview = [
    createOpenClawAuditPreviewEvent({ eventType: 'readonly_validation_observed', evidenceTokens: capabilityReport.evidenceTokens || [], actionRequested: 'readonly_validation' }),
    createOpenClawAuditPreviewEvent({ eventType: 'capability_trial_reported', evidenceTokens: capabilityReport.evidenceTokens || [], actionRequested: 'capability_report' }),
    createOpenClawAuditPreviewEvent({ eventType: 'oversight_proposal_generated', evidenceTokens: openClawOversightProposal.evidenceTokens || [], actionRequested: 'oversight_proposal' }),
    createOpenClawAuditPreviewEvent({ eventType: 'permission_diff_previewed', evidenceTokens: ['diff:preview_only'], actionRequested: 'permission_diff_preview' }),
    createOpenClawAuditPreviewEvent({ eventType: 'approval_gate_evaluated', evidenceTokens: ['gate:operator_review_only'], actionRequested: 'approval_gate' }),
    createOpenClawAuditPreviewEvent({ eventType: 'rollback_plan_previewed', evidenceTokens: ['rollback:preview_only'], actionRequested: 'rollback_plan_preview' }),
  ];

  const openClawProposalEvidence = buildOpenClawProposalEvidenceProjection({ readonlyTruth, capabilityTrial, capabilityReport });
  const openClawProposalPacket = buildOpenClawProposalPacket({
    source: 'agent_task_projection',
    proposalType: 'generate_oversight_plan',
    proposalTitle: 'OpenClaw Oversight + Proposal Packet v1',
    proposalSummary: 'Proposal packet for operator review only. OpenClaw remains non-executing and cannot self-approve.',
    requestedOutcome: 'operator_review_for_future_codex_workflow',
    proposedActions: openClawOversightProposal?.proposedActions || ['generate_oversight_plan'],
    readonlyEvidence: [
      { evidenceType: 'readonly_validation', evidenceStatus: capabilityTrial.adapterValidated ? 'succeeded' : 'awaiting', source: 'openclaw_validation', summary: capabilityTrial.readonlyValidationSummary || 'Readonly validation status pending.' },
      { evidenceType: 'capability_trial', evidenceStatus: capabilityTrial.trialStatus || 'not_started', source: 'openclaw_trial', summary: capabilityTrial.nextAction || 'Capability trial pending.' },
      { evidenceType: 'capability_report', evidenceStatus: capabilityReport.reportStatus === 'ready' ? 'provided' : 'missing', source: 'openclaw_report', summary: capabilityReport.reportSummary || 'Capability report pending.' },
      { evidenceType: 'oversight_proposal', evidenceStatus: 'provided', source: 'openclaw_oversight', summary: openClawOversightProposal.proposalSummary || 'Oversight proposal generated.' },
      { evidenceType: 'permission_boundary', evidenceStatus: 'provided', source: 'openclaw_policy', summary: 'Execution disabled, self-modification disabled, operator approval required.' },
    ],
    readonlyTruth,
    proposalEvidenceStatus: openClawProposalEvidence.status,
  });

  const openClawProposalReviewQueue = buildOpenClawProposalReviewQueue({
    proposalPacket: openClawProposalPacket,
    evidence: openClawProposalEvidence,
    risk: openClawProposalPacket.riskClassification,
    rollback: openClawRollbackPlan,
    approvalRequirements: openClawProposalPacket.approvalRequirements,
  });
  const openClawOperatorReviewQueue = buildOpenClawOperatorReviewQueue({
    openClawProposalPacket,
    openClawProposalEvidence,
    openClawProposalRisk: openClawProposalPacket.riskClassification,
    openClawProposalApprovalRequirements: openClawProposalPacket.approvalRequirements,
    openClawProposalRollback: openClawProposalPacket.rollbackPreview,
    openClawPermissionDiff,
    openClawAuditLedgerPreview,
    openClawOversightProposal,
  });

  const openClawCodexProposalExport = buildOpenClawCodexProposalExport({
    proposalPacket: openClawProposalPacket,
    operatorReviewQueue: openClawOperatorReviewQueue,
    approvalRequirements: openClawProposalPacket.approvalRequirements,
    risk: openClawProposalPacket.riskClassification,
    rollback: openClawProposalPacket.rollbackPreview,
    permissionDiff: openClawPermissionDiff,
    auditPreview: openClawAuditLedgerPreview,
  });

  const openClawOperatorReviewHandoff = buildOpenClawOperatorReviewHandoff({
    readonlyValidated: readonlyTruth.adapterValidated === true,
    capabilityTrial,
    capabilityReport,
    oversightProposal: openClawOversightProposal,
    proposalPacket: openClawProposalPacket,
    proposalReviewQueue: openClawProposalReviewQueue,
    approvalGate: openClawApprovalGate,
    killSwitchEngaged: adjudicated.openClawPolicySummary?.killSwitchState === 'engaged',
    paused: adjudicated.openClawPolicySummary?.killSwitchState === 'engaged',
  });

  const openClawControlPlane = buildOpenClawControlPlane({
    policySummary: adjudicated.openClawPolicySummary || {},
    operatorReviewHandoff: openClawOperatorReviewHandoff,
    capabilityReport,
    oversightProposal: openClawOversightProposal,
    proposalPacket: openClawProposalPacket,
    proposalReviewQueue: openClawProposalReviewQueue,
    operatorSurface: {
      ...capabilityTrialSeed,
      openClawKillSwitchEngaged: adjudicated.openClawPolicySummary?.killSwitchState === 'engaged',
      openClawPauseState: adjudicated.openClawPolicySummary?.killSwitchState === 'engaged' ? 'paused' : 'resumed',
      openClawReadonlyValidationEndpointAvailable: healthHandshake.readonlyValidationEndpoint?.available === true,
    },
  });

  return {
    generatedAt: adjudicated.generatedAt,
    task: adjudicated.model,
    operatorSurface: {
      layerStatus: adjudicated.layerStatus,
      activeTaskTitle: adjudicated.model.taskIdentity.title,
      lifecycleState: adjudicated.model.taskLifecycle.state,
      recommendedAgent: adjudicated.model.agentAssignment.recommendedAgent,
      assignedAgent: adjudicated.model.agentAssignment.assignedAgent,
      codexReadiness: adjudicated.codexReadiness,
      openClawReadiness: adjudicated.openClawReadiness,
      openClawIntegrationMode: adjudicated.openClawPolicySummary?.integrationMode || 'policy_only',
      openClawSafeToUse: adjudicated.openClawPolicySummary?.openClawSafeToUse === true,
      openClawAdapterPresent: adjudicated.openClawPolicySummary?.adapterPresent === true,
      openClawApprovalsComplete: adjudicated.openClawPolicySummary?.approvalsComplete === true,
      openClawKillSwitchState: adjudicated.openClawPolicySummary?.killSwitchState || 'missing',
      openClawKillSwitchMode: adjudicated.openClawPolicySummary?.killSwitchMode || 'unavailable',
      openClawExecutionAllowed: adjudicated.openClawPolicySummary?.openClawExecutionAllowed === true,
      openClawDirectAutomationDisabled: adjudicated.openClawPolicySummary?.integrationMode === 'policy_only',
      openClawKillSwitchEngaged: adjudicated.openClawPolicySummary?.killSwitchState === 'engaged',
      openClawPauseState: adjudicated.openClawPolicySummary?.killSwitchState === 'engaged' ? 'paused' : 'resumed',
      openClawControlMode: openClawControlPlane.openClawControlMode,
      openClawReadonlyValidationAvailable: healthHandshake.readonlyValidationEndpoint?.available === true,
      openClawReadonlyValidationStatus: healthHandshake.validationStatus || healthHandshake.validation?.validationStatus || 'idle',
      openClawControlNextAction: openClawControlPlane.openClawControlNextAction,
      openClawControlEvidence: openClawControlPlane.openClawControlEvidence,
      openClawHighestPriorityBlocker: adjudicated.openClawPolicySummary?.highestPriorityBlocker || '',
      openClawNextAction: adjudicated.openClawPolicySummary?.nextAction || '',
      openClawAdapterMode: adapter.adapterMode || 'unknown',
      openClawAdapterReadiness: adapter.adapterReadiness || 'unknown',
      openClawAdapterConnectionState: adapter.adapterConnectionState || 'unknown',
      openClawAdapterExecutionMode: adapter.adapterExecutionMode || 'disabled',
      openClawAdapterCanExecute: adapter.adapterCanExecute === true,

      openClawAdapterConnectionMode: connection.connectionMode || 'readiness_only',
      openClawAdapterConnectionState: connection.connectionState || adapter.adapterConnectionState || 'not_connected',
      openClawAdapterEndpointConfigured: connection.endpointConfigured === true,
      openClawAdapterEndpointScope: connection.endpointScope || 'none',
      openClawAdapterHealthCheckState: connection.healthCheckState || 'not_run',
      openClawAdapterHandshakeState: connection.handshakeState || 'not_run',
      openClawAdapterConnectionReady: connection.connectionReady === true,
      openClawAdapterConnectionCanExecute: connection.connectionCanExecute === true,
      openClawAdapterConnectionExecutionAllowed: connection.connectionExecutionAllowed === true,
      openClawAdapterConnectionNextAction: connection.connectionNextAction || '',
      openClawAdapterConnectionHighestPriorityBlocker: (Array.isArray(connection.connectionBlockers) ? connection.connectionBlockers[0] : '') || '',
      openClawAdapterConnectionWarnings: asArray(connection.connectionWarnings),
      openClawAdapterConnectionEvidence: asArray(connection.connectionEvidence),
      openClawAdapterEndpointLabel: connection.endpointLabel || connectionConfig.endpointLabel || '',
      openClawAdapterEndpointHost: connection.endpointHost || connectionConfig.endpointHost || '',
      openClawAdapterEndpointPort: connection.endpointPort || connectionConfig.endpointPort || '',
      openClawAdapterEndpointMode: connectionConfig.endpointMode || 'unknown',
      openClawAdapterConfigPersistenceMode: connectionConfig.configPersistenceMode || 'session_only',
      openClawAdapterAllowedProbeTypes: connectionConfig.allowedProbeTypes || 'none',
      openClawAdapterExpectedProtocolVersion: connection.expectedProtocolVersion || connectionConfig.expectedProtocolVersion || protocol.expectedProtocolVersion || '',
      openClawAdapterConnectionConfigReady: connectionConfig.connectionConfigReady === true,
      openClawAdapterConnectionConfigNextAction: connectionConfig.connectionConfigNextAction || '',
      openClawAdapterConnectionConfigBlockers: asArray(connectionConfig.connectionConfigBlockers),
      openClawAdapterConnectionConfigWarnings: asArray(connectionConfig.connectionConfigWarnings),
      openClawHealthTelemetryMode: healthHandshake.healthTelemetryMode || 'unknown',
      openClawReadonlyValidationEndpointAvailable: healthHandshake.readonlyValidationEndpoint?.available === true,
      openClawReadonlyValidationEndpointPath: healthHandshake.readonlyValidationEndpoint?.path || '',
      openClawReadonlyValidationEndpointMode: healthHandshake.readonlyValidationEndpoint?.mode || 'missing',
      openClawReadonlyValidationEndpointCanExecute: healthHandshake.readonlyValidationEndpoint?.canExecute === true,
      openClawHealthValidationStatus: healthHandshake.validationStatus || healthHandshake.validation?.validationStatus || 'idle',
      openClawHealthValidationMode: healthHandshake.validationMode || healthHandshake.validation?.validationMode || 'none',
      openClawHealthValidationSource: healthHandshake.validationSource || healthHandshake.validation?.validationSource || 'unknown',
      openClawHealthValidationNextAction: healthHandshake.validation?.validationNextAction || healthHandshake.healthHandshakeNextAction || '',
      openClawHealthValidationBlockers: asArray(healthHandshake.validation?.validationBlockers),
      openClawHealthValidationWarnings: asArray(healthHandshake.validation?.validationWarnings),
      openClawHealthValidationEvidence: asArray(healthHandshake.validation?.validationEvidence),
      openClawLastHealthCheckAt: healthHandshake.lastHealthCheckAt || '',
      openClawLastHandshakeAt: healthHandshake.lastHandshakeAt || '',
      openClawHealthLatencyMs: healthHandshake.healthLatencyMs ?? null,
      openClawHandshakeLatencyMs: healthHandshake.handshakeLatencyMs ?? null,
      openClawHealthState: healthHandshake.healthState || connection.healthCheckState || 'not_run',
      openClawHandshakeState: healthHandshake.handshakeState || connection.handshakeState || 'not_run',
      openClawAdapterIdentity: identity.id || connection.adapterIdentity || '',
      openClawProtocolVersion: protocol.protocolVersion || connection.protocolVersion || '',
      openClawExpectedProtocolVersion: protocol.expectedProtocolVersion || connection.expectedProtocolVersion || '',
      openClawProtocolCompatible: protocol.compatible === true,
      openClawProtocolMismatchReason: protocol.mismatchReason || '',
      openClawCapabilityDeclaration: healthHandshake.capabilityDeclaration || {},
      openClawReadonlyAssurance: readonlyAssurance,
      openClawHealthHandshakeNextAction: healthHandshake.healthHandshakeNextAction || '',
      openClawHealthHandshakeHighestPriorityBlocker: (asArray(healthHandshake.healthBlockers)[0] || asArray(healthHandshake.handshakeBlockers)[0] || ''),
      openClawHealthHandshakeWarnings: [...asArray(healthHandshake.healthWarnings), ...asArray(healthHandshake.handshakeWarnings)],
      openClawHealthHandshakeEvidence: asArray(healthHandshake.healthHandshakeEvidence),
      openClawAdapterStubMode: adapterStub.stubMode || 'unknown',
      openClawAdapterStubStatus: adapterStub.stubStatus || 'unknown',
      openClawAdapterStubConnectionState: adapterStub.stubConnectionState || 'unknown',
      openClawAdapterStubHealth: adapterStub.stubHealth || 'unknown',
      openClawAdapterStubCanExecute: adapterStub.stubCanExecute === true,
      openClawAdapterStubNextAction: adapterStub.stubNextAction || '',
      openClawAdapterStubHighestPriorityBlocker: adapterStubTopBlocker,
      openClawAdapterStubWarnings: asArray(adapterStub.stubWarnings),
      openClawAdapterStubEvidence: asArray(adapterStub.stubEvidence),
      openClawAdapterSafeToConnect: adapter.adapterSafeToConnect === true,
      openClawAdapterNextAction: adapter.adapterNextAction || '',
      openClawAdapterHighestPriorityBlocker: adapterTopBlocker,
      openClawAdapterWarnings: asArray(adapter.adapterWarnings),
      openClawAdapterCapabilities: adapter.adapterCapabilities || {},
      openClawAdapterRequiredApprovals: asArray(adapter.adapterRequiredApprovals),
      openClawAdapterEvidenceContract: asArray(adapter.adapterEvidenceContract),
      openClawStageEvidence,
      openClawCapabilityTrial: capabilityTrial,
      openClawOperatorReviewHandoff,
      openClawOversightProposal,
      openClawPermissionEnvelope,
      openClawPermissionDiff,
      openClawApprovalGate,
      openClawAuditLedgerPreview,
      openClawRollbackPlan,
      openClawCapabilityReport: capabilityReport,
      openClawProposalPacket,
      openClawProposalEvidence,
      openClawProposalReviewQueue,
      openClawOperatorReviewQueue,
      openClawCodexProposalExport,
      openClawOperatorReviewHandoff,
      openClawProposalEvidenceItems: openClawProposalPacket.readonlyEvidence,
      openClawProposalRisk: openClawProposalPacket.riskClassification,
      openClawProposalApprovalRequirements: openClawProposalPacket.approvalRequirements,
      openClawProposalRollback: openClawProposalPacket.rollbackPreview,
      openClawCapabilityTrialStatus: capabilityTrial.trialStatus,
      openClawCapabilityTrialNextAction: capabilityTrial.nextAction,
      openClawCapabilityTrialExecutionAllowed: false,
      openClawOversightProposalTrustStage: openClawOversightProposal.trustStage,
      handoffReady: adjudicated.handoff.handoffReady,
      handoffMode: adjudicated.handoff.handoffMode,
      handoffPacketSummary: adjudicated.handoff.handoffPacketSummary,
      codexHandoffPacketMode: adjudicated.handoff.packetMode,
      codexHandoffPacketReady: adjudicated.handoff.packetReady,
      codexHandoffPacketSummary: adjudicated.handoff.packetSummary,
      codexHandoffPacketBlockers: asArray(adjudicated.handoff.packetBlockers),
      codexHandoffPacketText: adjudicated.handoff.packetText,
      codexHandoffNextAction: adjudicated.handoff.nextActionLabel,
      codexHandoffPacketRequiredChecks: asArray(adjudicated.verification.checks),
      approvalPending: pendingApprovals,
      verificationStatus: adjudicated.verification.status,
      verificationReturnStatus: adjudicated.verificationReturn.verificationReturnStatus,
      verificationDecision: adjudicated.verificationReturn.verificationDecision,
      mergeReadiness: adjudicated.verificationReturn.mergeReadiness,
      verificationReturnReady: adjudicated.verificationReturn.verificationReturnReady,
      verificationReturnBlockers: asArray(adjudicated.verificationReturn.verificationReturnBlockers),
      verificationReturnWarnings: asArray(adjudicated.verificationReturn.verificationReturnWarnings),
      verificationReturnNextAction: adjudicated.verificationReturn.verificationReturnNextAction,
      returnedSummary: adjudicated.verificationReturn.returnedSummary,
      returnSource: adjudicated.verificationReturn.returnSource,
      returnedFilesChanged: asArray(adjudicated.verificationReturn.returnedFilesChanged),
      returnedChecksRun: asArray(adjudicated.verificationReturn.returnedChecksRun),
      missingRequiredChecks: asArray(adjudicated.verificationReturn.missingRequiredChecks),
      nextAction: adjudicated.nextAction,
      blockers,
      warnings,
    },
    compactSurface: {
      agentTaskLayerStatus: adjudicated.layerStatus,
      nextAgentTaskAction: adjudicated.nextAction.title,
      codexReadiness: adjudicated.codexReadiness,
      openClawReadiness: adjudicated.openClawReadiness,
      openClawIntegrationMode: adjudicated.openClawPolicySummary?.integrationMode || 'policy_only',
      openClawSafeToUse: adjudicated.openClawPolicySummary?.openClawSafeToUse === true,
      openClawAdapterPresent: adjudicated.openClawPolicySummary?.adapterPresent === true,
      openClawApprovalsComplete: adjudicated.openClawPolicySummary?.approvalsComplete === true,
      openClawKillSwitchState: adjudicated.openClawPolicySummary?.killSwitchState || 'missing',
      openClawKillSwitchMode: adjudicated.openClawPolicySummary?.killSwitchMode || 'unavailable',
      openClawExecutionAllowed: adjudicated.openClawPolicySummary?.openClawExecutionAllowed === true,
      openClawHighestPriorityBlocker: adjudicated.openClawPolicySummary?.highestPriorityBlocker || '',
      openClawNextAction: adjudicated.openClawPolicySummary?.nextAction || '',
      openClawAdapterMode: adapter.adapterMode || 'unknown',
      openClawAdapterReadiness: adapter.adapterReadiness || 'unknown',
      openClawAdapterConnectionState: adapter.adapterConnectionState || 'unknown',
      openClawAdapterExecutionMode: adapter.adapterExecutionMode || 'disabled',
      openClawAdapterCanExecute: adapter.adapterCanExecute === true,

      openClawAdapterConnectionMode: connection.connectionMode || 'readiness_only',
      openClawAdapterConnectionState: connection.connectionState || adapter.adapterConnectionState || 'not_connected',
      openClawAdapterEndpointConfigured: connection.endpointConfigured === true,
      openClawAdapterEndpointScope: connection.endpointScope || 'none',
      openClawAdapterHealthCheckState: connection.healthCheckState || 'not_run',
      openClawAdapterHandshakeState: connection.handshakeState || 'not_run',
      openClawAdapterConnectionReady: connection.connectionReady === true,
      openClawAdapterConnectionCanExecute: connection.connectionCanExecute === true,
      openClawAdapterConnectionExecutionAllowed: connection.connectionExecutionAllowed === true,
      openClawAdapterConnectionNextAction: connection.connectionNextAction || '',
      openClawAdapterConnectionHighestPriorityBlocker: (Array.isArray(connection.connectionBlockers) ? connection.connectionBlockers[0] : '') || '',
      openClawAdapterConnectionWarnings: asArray(connection.connectionWarnings),
      openClawAdapterConnectionEvidence: asArray(connection.connectionEvidence),
      openClawAdapterEndpointLabel: connection.endpointLabel || connectionConfig.endpointLabel || '',
      openClawAdapterEndpointHost: connection.endpointHost || connectionConfig.endpointHost || '',
      openClawAdapterEndpointPort: connection.endpointPort || connectionConfig.endpointPort || '',
      openClawAdapterEndpointMode: connectionConfig.endpointMode || 'unknown',
      openClawAdapterConfigPersistenceMode: connectionConfig.configPersistenceMode || 'session_only',
      openClawAdapterAllowedProbeTypes: connectionConfig.allowedProbeTypes || 'none',
      openClawAdapterExpectedProtocolVersion: connection.expectedProtocolVersion || connectionConfig.expectedProtocolVersion || protocol.expectedProtocolVersion || '',
      openClawAdapterConnectionConfigReady: connectionConfig.connectionConfigReady === true,
      openClawAdapterConnectionConfigNextAction: connectionConfig.connectionConfigNextAction || '',
      openClawAdapterConnectionConfigBlockers: asArray(connectionConfig.connectionConfigBlockers),
      openClawAdapterConnectionConfigWarnings: asArray(connectionConfig.connectionConfigWarnings),
      openClawHealthTelemetryMode: healthHandshake.healthTelemetryMode || 'unknown',
      openClawReadonlyValidationEndpointAvailable: healthHandshake.readonlyValidationEndpoint?.available === true,
      openClawReadonlyValidationEndpointPath: healthHandshake.readonlyValidationEndpoint?.path || '',
      openClawReadonlyValidationEndpointMode: healthHandshake.readonlyValidationEndpoint?.mode || 'missing',
      openClawReadonlyValidationEndpointCanExecute: healthHandshake.readonlyValidationEndpoint?.canExecute === true,
      openClawHealthState: healthHandshake.healthState || connection.healthCheckState || 'not_run',
      openClawHandshakeState: healthHandshake.handshakeState || connection.handshakeState || 'not_run',
      openClawAdapterIdentity: identity.id || connection.adapterIdentity || '',
      openClawProtocolVersion: protocol.protocolVersion || connection.protocolVersion || '',
      openClawExpectedProtocolVersion: protocol.expectedProtocolVersion || connection.expectedProtocolVersion || '',
      openClawProtocolCompatible: protocol.compatible === true,
      openClawProtocolMismatchReason: protocol.mismatchReason || '',
      openClawCapabilityDeclaration: healthHandshake.capabilityDeclaration || {},
      openClawReadonlyAssurance: readonlyAssurance,
      openClawHealthHandshakeNextAction: healthHandshake.healthHandshakeNextAction || '',
      openClawHealthHandshakeHighestPriorityBlocker: (asArray(healthHandshake.healthBlockers)[0] || asArray(healthHandshake.handshakeBlockers)[0] || ''),
      openClawHealthHandshakeWarnings: [...asArray(healthHandshake.healthWarnings), ...asArray(healthHandshake.handshakeWarnings)],
      openClawHealthHandshakeEvidence: asArray(healthHandshake.healthHandshakeEvidence),
      openClawAdapterStubMode: adapterStub.stubMode || 'unknown',
      openClawAdapterStubStatus: adapterStub.stubStatus || 'unknown',
      openClawAdapterStubConnectionState: adapterStub.stubConnectionState || 'unknown',
      openClawAdapterStubHealth: adapterStub.stubHealth || 'unknown',
      openClawAdapterStubCanExecute: adapterStub.stubCanExecute === true,
      openClawAdapterStubNextAction: adapterStub.stubNextAction || '',
      openClawAdapterStubHighestPriorityBlocker: adapterStubTopBlocker,
      openClawAdapterStubWarnings: asArray(adapterStub.stubWarnings),
      openClawAdapterStubEvidence: asArray(adapterStub.stubEvidence),
      openClawAdapterSafeToConnect: adapter.adapterSafeToConnect === true,
      openClawAdapterNextAction: adapter.adapterNextAction || '',
      openClawAdapterHighestPriorityBlocker: adapterTopBlocker,
      openClawAdapterWarnings: asArray(adapter.adapterWarnings),
      openClawAdapterCapabilities: adapter.adapterCapabilities || {},
      openClawAdapterRequiredApprovals: asArray(adapter.adapterRequiredApprovals),
      openClawAdapterEvidenceContract: asArray(adapter.adapterEvidenceContract),
      openClawStageEvidence,
      openClawOversightProposal,
      highestPriorityApprovalGate: toChip(adjudicated.approval.highestPriorityGate, 'none'),
    },
    readinessSummary: {
      systemId: 'agent-task-layer',
      label: 'Agent Task Layer',
      status: dashboardStatus,
      phase: lifecycleState || 'unknown',
      blockers,
      warnings,
      nextActions: [nextAction],
      evidence,
      codexReadiness: dashboardCodexReadiness,
      verificationStatus: dashboardVerificationStatus,
      highestPriorityGate: toChip(adjudicated.approval.highestPriorityGate, 'none'),
      agentTaskLayerStatus: adjudicated.layerStatus,
      codexRuntimeReadiness: adjudicated.codexReadiness,
      openClawReadiness: adjudicated.openClawReadiness,
      openClawIntegrationMode: adjudicated.openClawPolicySummary?.integrationMode || 'policy_only',
      openClawSafeToUse: adjudicated.openClawPolicySummary?.openClawSafeToUse === true,
      openClawAdapterPresent: adjudicated.openClawPolicySummary?.adapterPresent === true,
      openClawApprovalsComplete: adjudicated.openClawPolicySummary?.approvalsComplete === true,
      openClawKillSwitchState: adjudicated.openClawPolicySummary?.killSwitchState || 'missing',
      openClawKillSwitchMode: adjudicated.openClawPolicySummary?.killSwitchMode || 'unavailable',
      openClawExecutionAllowed: adjudicated.openClawPolicySummary?.openClawExecutionAllowed === true,
      openClawDirectAutomationDisabled: adjudicated.openClawPolicySummary?.integrationMode === 'policy_only',
      openClawKillSwitchEngaged: adjudicated.openClawPolicySummary?.killSwitchState === 'engaged',
      openClawHighestPriorityBlocker: adjudicated.openClawPolicySummary?.highestPriorityBlocker || '',
      openClawNextAction: adjudicated.openClawPolicySummary?.nextAction || '',
      openClawAdapterMode: adapter.adapterMode || 'unknown',
      openClawAdapterReadiness: adapter.adapterReadiness || 'unknown',
      openClawAdapterConnectionState: adapter.adapterConnectionState || 'unknown',
      openClawAdapterExecutionMode: adapter.adapterExecutionMode || 'disabled',
      openClawAdapterCanExecute: adapter.adapterCanExecute === true,

      openClawAdapterConnectionMode: connection.connectionMode || 'readiness_only',
      openClawAdapterConnectionState: connection.connectionState || adapter.adapterConnectionState || 'not_connected',
      openClawAdapterEndpointConfigured: connection.endpointConfigured === true,
      openClawAdapterEndpointScope: connection.endpointScope || 'none',
      openClawAdapterHealthCheckState: connection.healthCheckState || 'not_run',
      openClawAdapterHandshakeState: connection.handshakeState || 'not_run',
      openClawAdapterConnectionReady: connection.connectionReady === true,
      openClawAdapterConnectionCanExecute: connection.connectionCanExecute === true,
      openClawAdapterConnectionExecutionAllowed: connection.connectionExecutionAllowed === true,
      openClawAdapterConnectionNextAction: connection.connectionNextAction || '',
      openClawAdapterConnectionHighestPriorityBlocker: (Array.isArray(connection.connectionBlockers) ? connection.connectionBlockers[0] : '') || '',
      openClawAdapterConnectionWarnings: asArray(connection.connectionWarnings),
      openClawAdapterConnectionEvidence: asArray(connection.connectionEvidence),
      openClawAdapterStubMode: adapterStub.stubMode || 'unknown',
      openClawAdapterStubStatus: adapterStub.stubStatus || 'unknown',
      openClawAdapterStubConnectionState: adapterStub.stubConnectionState || 'unknown',
      openClawAdapterStubHealth: adapterStub.stubHealth || 'unknown',
      openClawAdapterStubCanExecute: adapterStub.stubCanExecute === true,
      openClawAdapterStubNextAction: adapterStub.stubNextAction || '',
      openClawAdapterStubHighestPriorityBlocker: adapterStubTopBlocker,
      openClawAdapterStubWarnings: asArray(adapterStub.stubWarnings),
      openClawAdapterStubEvidence: asArray(adapterStub.stubEvidence),
      openClawAdapterSafeToConnect: adapter.adapterSafeToConnect === true,
      openClawAdapterNextAction: adapter.adapterNextAction || '',
      openClawAdapterHighestPriorityBlocker: adapterTopBlocker,
      openClawAdapterWarnings: asArray(adapter.adapterWarnings),
      openClawAdapterCapabilities: adapter.adapterCapabilities || {},
      openClawAdapterRequiredApprovals: asArray(adapter.adapterRequiredApprovals),
      openClawAdapterEvidenceContract: asArray(adapter.adapterEvidenceContract),
      openClawStageEvidence,
      openClawOversightProposal,
      nextAgentTaskAction: adjudicated.nextAction.title,
      agentTaskLayerBlockers: blockers,
      readinessScore: adjudicated.readinessScore,
      codexManualHandoffMode: adjudicated.handoff.packetMode,
      codexManualHandoffReady: adjudicated.handoff.packetReady === true,
      codexManualHandoffSummary: adjudicated.handoff.packetSummary,
      verificationReturnStatus: adjudicated.verificationReturn.verificationReturnStatus,
      verificationDecision: adjudicated.verificationReturn.verificationDecision,
      mergeReadiness: adjudicated.verificationReturn.mergeReadiness,
      verificationReturnReady: adjudicated.verificationReturn.verificationReturnReady,
      verificationReturnBlockers: asArray(adjudicated.verificationReturn.verificationReturnBlockers),
      verificationReturnWarnings: asArray(adjudicated.verificationReturn.verificationReturnWarnings),
      verificationReturnNextAction: adjudicated.verificationReturn.verificationReturnNextAction,
      returnedFilesChanged: asArray(adjudicated.verificationReturn.returnedFilesChanged),
      returnedChecksRun: asArray(adjudicated.verificationReturn.returnedChecksRun),
      missingRequiredChecks: asArray(adjudicated.verificationReturn.missingRequiredChecks),
    },
  };
  return result;
}
