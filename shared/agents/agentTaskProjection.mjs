import { adjudicateAgentTaskLayer } from './agentTaskAdjudicator.mjs';

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
  const connectionState = String(connection.connectionState || adapterSummary.adapterConnectionState || 'unknown').trim() || 'unknown';
  return {
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
    connectionExecution: 'disabled',
    safeToUse: policySummary.openClawSafeToUse === true,
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
}
