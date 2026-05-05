import { useEffect, useMemo, useState } from 'react';
import CollapsiblePanel from './CollapsiblePanel';
import { OPENCLAW_AUTHORITY, OPENCLAW_MODE, OPENCLAW_SCAN_MODES } from './openclaw/openclawTilePolicy.js';
import { buildOpenClawGuardrailSnapshot } from './openclaw/openclawGuardrails.js';
import { buildOpenClawIntegrationSnapshot } from './openclaw/openclawIntegrationAdapter.js';
import { runOpenClawScan } from './openclaw/openclawScanController.js';
import { buildOpenClawCandidatePrompts } from './openclaw/openclawPromptGenerator.js';
import {
  MISSION_CONSOLE_TARGETS,
  evaluateMissionConsoleRequest,
  resolveMissionConsoleTarget,
} from '../state/missionConsoleTargetPolicy.js';
import {
  appendMissionConsoleMessage,
  buildBlockedMissionConsoleResponse,
  createMissionConsoleMessage,
} from '../state/missionConsoleMessageLedger.js';
import { COPY_STATE, useClipboardButtonState } from '../hooks/useClipboardButtonState';
import { writeTextToClipboard } from '../utils/clipboardCopy';
import { createIntentToBuildState, deriveVerificationReturnLessonCandidates, INTENT_TO_BUILD_BOUNDARIES } from '../state/intentToBuildModel.js';
import { createMissionBridgeState, processMissionBridgeIntent, requestMissionBridgeAI } from '../state/missionBridge.js';
import { buildAgentCommandConsoleProjection } from '../../../shared/agents/agentCommandConsole.mjs';
import { buildAgentCommandQueue } from '../../../shared/agents/agentCommandQueue.mjs';
import { buildMissionIntelligenceLayer } from '../../../shared/agents/missionIntelligenceLayer.mjs';

const OPENCLAW_INTENT_OPTIONS = Object.freeze([
  { id: 'run-scan', label: 'Run bounded scan' },
  { id: 'refresh-status', label: 'Summarize inspection scope' },
  { id: 'generate-candidate-prompts', label: 'Generate alternatives / refine prompts' },
]);

export default function MissionConsoleTile({
  uiLayout,
  togglePanel,
  runtimeStatusModel,
  finalRouteTruth,
  finalAgentView,
  branchName = 'unknown',
  onOpenClawIntegrationUpdate = () => {},
  onIntentToBuildUpdate = () => {},
  onMissionBridgeUpdate = () => {},
  submitPrompt = null,
  orchestrationTruth = null,
  agentTaskProjection = null,
}) {
  const { copyState: promptCopyState, setCopyState: setPromptCopyState } = useClipboardButtonState();
  const { copyState: specCopyState, setCopyState: setSpecCopyState } = useClipboardButtonState();
  const [input, setInput] = useState('');
  const [targetId, setTargetId] = useState('stephanos');
  const [selectedAgentId, setSelectedAgentId] = useState('broadcast');
  const [openClawIntentType, setOpenClawIntentType] = useState('run-scan');
  const [proposalCards, setProposalCards] = useState([]);
  const [lastScanReport, setLastScanReport] = useState(null);
  const [intentInput, setIntentInput] = useState({
    rawIntent: '',
    targetArea: 'mission-console',
    riskLevel: 'medium',
    allowedAutomation: [...INTENT_TO_BUILD_BOUNDARIES.autoAllowed],
    verificationCommands: [
      'npm run stephanos:build',
      'npm run stephanos:verify',
      'node --test stephanos-ui/src/state/intentToBuildModel.test.mjs',
      'git status --short',
    ],
    successCriteria: [
      'Operator can generate a bounded mission spec from high-level intent.',
      'Approval-required actions are explicitly labeled.',
      'Codex prompt and verification checklist are copy-ready.',
    ],
  });
  const [intentToBuild, setIntentToBuild] = useState(() => createIntentToBuildState({
    rawIntent: 'Awaiting operator Intent-to-Build input.',
    targetArea: 'mission-console',
  }));
  const [messages, setMessages] = useState(() => [
    createMissionConsoleMessage({
      role: 'assistant',
      responder: 'Stephanos',
      target: 'stephanos',
      content: 'Agent Mission Console (Mission Router) online. Operator authority active. Route and proposal guardrails are enforced.',
      status: 'ready',
    }),
  ]);
  const [missionBridgeState, setMissionBridgeState] = useState(() => createMissionBridgeState());
  const [verificationReturnInput, setVerificationReturnInput] = useState('');
  const compactVerificationSummary = useMemo(() => {
    const summary = agentTaskProjection?.readinessSummary || {};
    const operatorSurface = agentTaskProjection?.operatorSurface || {};
    const pickBoolean = (primary, fallback) => {
      if (primary === true) return true;
      if (primary === false) return false;
      return fallback === true;
    };
    const blockers = Array.isArray(summary.verificationReturnBlockers) ? summary.verificationReturnBlockers : [];
    const warnings = Array.isArray(summary.verificationReturnWarnings) ? summary.verificationReturnWarnings : [];
    const highestPriorityIssue = blockers[0] || warnings[0] || 'none';
    const canonicalNextAction = operatorSurface.openClawOperatorReviewQueue?.nextAction
      || operatorSurface.openClawOperatorReviewWorkflow?.nextAction
      || operatorSurface.openClawCodexProposalExport?.nextAction
      || operatorSurface.openClawHealthValidationNextAction
      || summary.openClawNextAction
      || operatorSurface.openClawNextAction
      || 'not reported';
    return {
      verificationReturnStatus: summary.verificationReturnStatus || operatorSurface.verificationReturnStatus || 'unknown',
      verificationDecision: summary.verificationDecision || operatorSurface.verificationDecision || 'not_ready',
      mergeReadiness: summary.mergeReadiness || operatorSurface.mergeReadiness || 'not_ready',
      verificationReturnNextAction: summary.verificationReturnNextAction || operatorSurface.verificationReturnNextAction || 'not reported',
      highestPriorityIssue,
      manualOnly: (summary.codexManualHandoffMode || operatorSurface.codexHandoffPacketMode || '').toLowerCase() === 'manual_handoff_only',
      openClawReadiness: summary.openClawReadiness || operatorSurface.openClawReadiness || 'unknown',
      openClawIntegrationMode: summary.openClawIntegrationMode || operatorSurface.openClawIntegrationMode || 'policy_only',
      openClawSafeToUse: pickBoolean(summary.openClawSafeToUse, operatorSurface.openClawSafeToUse),
      openClawKillSwitchState: summary.openClawKillSwitchState || operatorSurface.openClawKillSwitchState || 'missing',
      openClawKillSwitchMode: summary.openClawKillSwitchMode || operatorSurface.openClawKillSwitchMode || 'unavailable',
      openClawExecutionAllowed: pickBoolean(summary.openClawExecutionAllowed, operatorSurface.openClawExecutionAllowed),
      openClawHighestPriorityBlocker: summary.openClawHighestPriorityBlocker || operatorSurface.openClawHighestPriorityBlocker || 'none',
      openClawNextAction: canonicalNextAction,
      openClawAdapterMode: summary.openClawAdapterMode || operatorSurface.openClawAdapterMode || 'design_only',
      openClawAdapterReadiness: summary.openClawAdapterReadiness || operatorSurface.openClawAdapterReadiness || 'needs_contract',
      openClawAdapterConnectionState: summary.openClawAdapterConnectionState || operatorSurface.openClawAdapterConnectionState || 'not_configured',
      openClawAdapterExecutionMode: summary.openClawAdapterExecutionMode || operatorSurface.openClawAdapterExecutionMode || 'disabled',
      openClawAdapterCanExecute: pickBoolean(summary.openClawAdapterCanExecute, operatorSurface.openClawAdapterCanExecute),
      openClawAdapterNextAction: canonicalNextAction,
      openClawAdapterStubStatus: summary.openClawAdapterStubStatus || operatorSurface.openClawAdapterStubStatus || 'unknown',
      openClawAdapterStubHealth: summary.openClawAdapterStubHealth || operatorSurface.openClawAdapterStubHealth || 'unknown',
      openClawAdapterStubConnectionState: summary.openClawAdapterStubConnectionState || operatorSurface.openClawAdapterStubConnectionState || 'unknown',
      openClawAdapterStubCanExecute: pickBoolean(summary.openClawAdapterStubCanExecute, operatorSurface.openClawAdapterStubCanExecute),
      openClawAdapterStubNextAction: summary.openClawAdapterStubNextAction || operatorSurface.openClawAdapterStubNextAction || 'not reported',
      realityForgeProofStatus: summary.realityForgeProofStatus || operatorSurface.realityForgeProofStatus || 'checklist_required',
      realityForgeBuildVerified: pickBoolean(summary.realityForgeBuildVerified, operatorSurface.realityForgeBuildVerified),
      realityForgeRuntimeVerified: pickBoolean(summary.realityForgeRuntimeVerified, operatorSurface.realityForgeRuntimeVerified),
      realityForgeOperatorVisibleProofPending: pickBoolean(summary.realityForgeOperatorVisibleProofPending, operatorSurface.realityForgeOperatorVisibleProofPending),
      realityForgeManualVerificationRequired: pickBoolean(summary.realityForgeManualVerificationRequired, operatorSurface.realityForgeManualVerificationRequired),
      realityForgeWorldWorkspaceChecksPending: Array.isArray(summary.realityForgeWorldWorkspaceChecksPending) ? summary.realityForgeWorldWorkspaceChecksPending : (Array.isArray(operatorSurface.realityForgeWorldWorkspaceChecksPending) ? operatorSurface.realityForgeWorldWorkspaceChecksPending : []),
      openClawAdapterConnectionMode: summary.openClawAdapterConnectionMode || operatorSurface.openClawAdapterConnectionMode || 'readiness_only',
      openClawAdapterEndpointConfigured: pickBoolean(summary.openClawAdapterEndpointConfigured, operatorSurface.openClawAdapterEndpointConfigured),
      openClawAdapterEndpointScope: summary.openClawAdapterEndpointScope || operatorSurface.openClawAdapterEndpointScope || 'none',
      openClawAdapterEndpointLabel: summary.openClawAdapterEndpointLabel || operatorSurface.openClawAdapterEndpointLabel || 'none',
      openClawAdapterEndpointHost: summary.openClawAdapterEndpointHost || operatorSurface.openClawAdapterEndpointHost || 'none',
      openClawAdapterEndpointPort: summary.openClawAdapterEndpointPort || operatorSurface.openClawAdapterEndpointPort || 'none',
      openClawAdapterEndpointMode: summary.openClawAdapterEndpointMode || operatorSurface.openClawAdapterEndpointMode || 'model_only',
      openClawAdapterExpectedProtocolVersion: summary.openClawAdapterExpectedProtocolVersion || operatorSurface.openClawAdapterExpectedProtocolVersion || 'unknown',
      openClawAdapterAllowedProbeTypes: summary.openClawAdapterAllowedProbeTypes || operatorSurface.openClawAdapterAllowedProbeTypes || 'none',
      openClawAdapterConnectionConfigReady: pickBoolean(summary.openClawAdapterConnectionConfigReady, operatorSurface.openClawAdapterConnectionConfigReady),
      openClawAdapterConnectionConfigNextAction: summary.openClawAdapterConnectionConfigNextAction || operatorSurface.openClawAdapterConnectionConfigNextAction || 'not reported',
      openClawAdapterConnectionConfigTopBlocker: (summary.openClawAdapterConnectionConfigBlockers || operatorSurface.openClawAdapterConnectionConfigBlockers || [])[0] || 'none',
      openClawAdapterConnectionConfigTopWarning: (summary.openClawAdapterConnectionConfigWarnings || operatorSurface.openClawAdapterConnectionConfigWarnings || [])[0] || 'none',
      openClawAdapterHealthCheckState: summary.openClawHealthState || operatorSurface.openClawHealthState || summary.openClawAdapterHealthCheckState || operatorSurface.openClawAdapterHealthCheckState || 'not_run',
      openClawAdapterHandshakeState: summary.openClawHandshakeState || operatorSurface.openClawHandshakeState || summary.openClawAdapterHandshakeState || operatorSurface.openClawAdapterHandshakeState || 'not_run',
      openClawHealthValidationStatus: operatorSurface.openClawHealthValidationStatus || summary.openClawHealthValidationStatus || 'idle',
      openClawHealthValidationMode: summary.openClawHealthValidationMode || operatorSurface.openClawHealthValidationMode || 'none',
      openClawHealthValidationNextAction: summary.openClawHealthValidationNextAction || operatorSurface.openClawHealthValidationNextAction || 'not reported',
      openClawProtocolCompatible: pickBoolean(operatorSurface.openClawProtocolCompatible, summary.openClawProtocolCompatible),
      openClawReadonlyAsserted: pickBoolean(summary.openClawReadonlyAssurance?.readonlyOnly, operatorSurface.openClawReadonlyAssurance?.readonlyOnly),
      openClawAdapterConnectionReady: pickBoolean(summary.openClawAdapterConnectionReady, operatorSurface.openClawAdapterConnectionReady),
      openClawAdapterConnectionExecutionAllowed: pickBoolean(summary.openClawAdapterConnectionExecutionAllowed, operatorSurface.openClawAdapterConnectionExecutionAllowed),
      openClawAdapterConnectionHighestPriorityBlocker: summary.openClawAdapterConnectionHighestPriorityBlocker || operatorSurface.openClawAdapterConnectionHighestPriorityBlocker || 'none',
      openClawAdapterConnectionNextAction: summary.openClawAdapterConnectionNextAction || operatorSurface.openClawAdapterConnectionNextAction || 'not reported',
      openClawCapabilityTrialStatus: operatorSurface.openClawCapabilityTrial?.trialStatus || 'unknown',
      openClawProposalPacketStatus: operatorSurface.openClawProposalPacket?.packetStatus || 'unknown',
      openClawOperatorReviewQueueStatus: operatorSurface.openClawOperatorReviewQueue?.queueStatus || 'unknown',
      openClawOperatorReviewWorkflowStatus: operatorSurface.openClawOperatorReviewWorkflow?.workflowStatus || 'unknown',
      openClawCodexProposalExportStatus: operatorSurface.openClawCodexProposalExport?.exportStatus || 'unavailable',
      openClawCodexReviewResultStatus: operatorSurface.openClawCodexReviewResult?.resultStatus || 'not_received',
      openClawImplementationPlanStatus: operatorSurface.openClawImplementationPlan?.planStatus || 'not_ready',
      openClawApprovalGateReadinessStatus: operatorSurface.openClawApprovalGateReadiness?.readinessStatus || 'not_ready',
      openClawDryRunPlanStatus: operatorSurface.openClawDryRunPlan?.dryRunStatus || 'unavailable',
      openClawControlledExecutionStatus: operatorSurface.openClawControlledExecutionGate?.controlledExecutionStatus || 'future_gated',
    };
  }, [agentTaskProjection]);


  const verificationReturnAdjudication = useMemo(() => {
    const text = String(verificationReturnInput || '').toLowerCase();
    const missionGoal = intentToBuild?.missionSpec?.missionMemoryCandidate?.suggestedMissionGoal || '';
    const lessonCandidates = deriveVerificationReturnLessonCandidates({
      verificationReturnText: verificationReturnInput,
      missionSpec: intentToBuild?.missionSpec || {},
    });
    const capabilityCandidate = lessonCandidates.find((candidate) => candidate.memoryCandidateType === 'capability_gap') || null;
    const skillUpgradeSuggestion = capabilityCandidate ? `This mission suggests a missing capability: ${capabilityCandidate.summary}` : 'none';
    return {
      matchesMissionGoal: missionGoal && text.includes('mission') ? 'likely' : 'unknown',
      changedFilesKnown: /files changed|changed files|\.js|\.mjs|\.jsx/.test(text) ? 'known' : 'unknown',
      testsClaimedRun: /test|verify|build/.test(text) ? 'claimed' : 'not-claimed',
      blockers: /blocker|fail|error/.test(text) ? 'reported' : 'none-reported',
      mergeReadiness: /merge-ready|ready to merge/.test(text) ? 'candidate-ready' : 'pending-review',
      nextAction: /blocker|fail|error/.test(text) ? 'Request fix + rerun verification.' : 'Review evidence and decide promotion.',
      suggestedLessonCandidate: lessonCandidates[0]?.memoryCandidateType || 'mission_history',
      lessonCandidates,
      lessonCandidatePending: lessonCandidates.length > 0,
      capabilityGapPending: Boolean(capabilityCandidate),
      skillUpgradeSuggestion,
    };
  }, [intentToBuild?.missionSpec, intentToBuild?.missionSpec?.missionMemoryCandidate?.suggestedMissionGoal, verificationReturnInput]);

  const agentCommandConsole = useMemo(() => buildAgentCommandConsoleProjection({
    agentTaskProjection,
    projectProgressNextActions: agentTaskProjection?.readinessSummary?.nextAgentTaskAction ? [agentTaskProjection.readinessSummary.nextAgentTaskAction] : [],
    missionHandoffMilestones: agentTaskProjection?.operatorSurface?.openClawOperatorReviewHandoff?.milestones || [],
    finalRouteTruth,
  }), [agentTaskProjection, finalRouteTruth]);
  const agentCommandQueue = useMemo(() => buildAgentCommandQueue({ agentTaskProjection }), [agentTaskProjection]);

  const missionIntelligence = useMemo(() => buildMissionIntelligenceLayer({
    finalRouteTruth,
    runtimeStatusModel,
    agentTaskProjection,
    missionBridgeState,
    compactVerificationSummary,
    agentCommandConsole,
    agentCommandQueue,
  }), [agentCommandConsole, agentCommandQueue, agentTaskProjection, compactVerificationSummary, finalRouteTruth, missionBridgeState, runtimeStatusModel]);

  const guardrails = useMemo(() => buildOpenClawGuardrailSnapshot(), []);
  const resolvedTarget = resolveMissionConsoleTarget(targetId);
  const sessionMode = resolvedTarget.sessionMode;
  const visibleAgents = Array.isArray(finalAgentView?.visibleAgents) ? finalAgentView.visibleAgents : [];
  const activeAgentIds = Array.isArray(finalAgentView?.activeAgentIds) ? finalAgentView.activeAgentIds : [];
  const currentAgentSummary = finalAgentView?.operatorSummary || 'No active summary from agent network.';
  const actingAgentId = finalAgentView?.actingAgentId || 'none';
  const lastHandoff = finalAgentView?.lastHandoff?.description
    || finalAgentView?.timeline?.find?.((entry) => entry.type === 'handoff')?.summary
    || 'No recent handoff.';

  const openClawIntegration = useMemo(() => buildOpenClawIntegrationSnapshot({
    runtimeStatusModel,
    finalRouteTruth,
    repoPath: '/workspace/stephan-os',
    branchName,
    lastScanType: lastScanReport?.scanType || openClawIntentType,
    lastInspectionScope: lastScanReport?.inspected?.categories || [],
    lastProposedPrompt: proposalCards[0]?.candidatePrompt || 'none',
    sessionState: proposalCards.some((card) => card.approvalStatus === 'approved') ? 'approval-queued' : 'ready-for-review',
    currentActivity: `Agent Mission Console target: ${resolvedTarget.label}`,
  }), [branchName, finalRouteTruth, openClawIntentType, proposalCards, resolvedTarget.label, runtimeStatusModel, lastScanReport]);

  useEffect(() => {
    onOpenClawIntegrationUpdate(openClawIntegration);
  }, [onOpenClawIntegrationUpdate, openClawIntegration]);
  useEffect(() => {
    const missionSpec = intentToBuild?.missionSpec || {};
    onIntentToBuildUpdate({
      latestMissionId: missionSpec.missionId || 'n/a',
      missionStatus: missionSpec.status || 'draft',
      approvalRequired: intentToBuild?.approvalRequired === true ? 'yes' : 'no',
      generatedPromptAvailable: intentToBuild?.generatedPromptAvailable === true ? 'yes' : 'no',
      verificationStatus: intentToBuild?.verificationEvidence?.verificationStatus || 'pending',
      missionMemoryInfluenceCount: String(intentToBuild?.missionSpec?.missionMemoryInfluenceCount || 0),
      missionMemoryInfluenceTypes: (intentToBuild?.missionSpec?.missionMemoryInfluenceTypes || []).join('|') || 'none',
      missionMemoryContextCount: String(intentToBuild?.missionSpec?.missionMemoryContext?.summary?.count || 0),
      missionMemoryInfluenceLevels: (intentToBuild?.missionSpec?.missionMemoryInfluenceLevels || []).join('|') || 'none',
      missionMemoryConflictCount: String(intentToBuild?.missionSpec?.missionMemoryConflicts?.length || 0),
      missionMemoryLessonCandidatePending: verificationReturnAdjudication.lessonCandidatePending ? 'yes' : 'no',
      missionMemoryCapabilityGapPending: verificationReturnAdjudication.capabilityGapPending ? 'yes' : 'no',
      missionMemoryLastAppliedAt: intentToBuild?.missionSpec?.missionMemoryLastAppliedAt || 'n/a',
      openClawDelegationStatus: intentToBuild?.missionSpec?.openClawDelegation?.status || 'inactive',
      openClawDelegationAuthorityLevel: intentToBuild?.missionSpec?.openClawDelegation?.authorityLevel || 'plan_only',
      openClawDelegationMutationAllowed: intentToBuild?.missionSpec?.openClawDelegation?.mutationAllowed ? 'yes' : 'no',
      openClawDelegationSelfAuthorityBlocked: intentToBuild?.missionSpec?.openClawDelegation?.selfAuthorityEscalationAllowed ? 'no' : 'yes',
      openClawDelegationFinishAuthority: intentToBuild?.missionSpec?.openClawDelegation?.finishAuthority || 'plan_only',
      missionFinishAuthorityStatus: intentToBuild?.missionSpec?.finishAuthority?.finishAuthorityStatus || 'not_granted',
      missionFinishAuthorityLevel: intentToBuild?.missionSpec?.finishAuthority?.finishAuthorityLevel || 'none',
      missionRoutineFinishAllowed: intentToBuild?.missionSpec?.finishAuthority?.routineFinishAllowed ? 'yes' : 'no',
      missionMergeAuthorityIncluded: intentToBuild?.missionSpec?.finishAuthority?.mergeAuthorityIncluded ? 'yes' : 'no',
      missionAutoMergeArmed: intentToBuild?.missionSpec?.finishAuthority?.autoMergeArmed || 'unknown',
      missionOperatorApprovalRecorded: intentToBuild?.missionSpec?.finishAuthority?.operatorApprovalRecorded ? 'yes' : 'no',
      missionMerged: intentToBuild?.missionSpec?.finishAuthority?.merged ? 'yes' : 'no',
      missionMergedBy: intentToBuild?.missionSpec?.finishAuthority?.mergedBy || 'unknown',
      missionFinishWarningLevel: intentToBuild?.missionSpec?.finishAuthority?.warningLevel || 'none',
      missionFinishNextAction: intentToBuild?.missionSpec?.finishAuthority?.nextAction || 'Merge is not authorized by this mission.',
      repoArchitectureAffectedSubsystemCount: String(intentToBuild?.missionSpec?.repoArchitectureContext?.affectedSubsystems?.length || 0),
      repoArchitectureAffectedSubsystems: (intentToBuild?.missionSpec?.repoArchitectureContext?.affectedSubsystems || []).join('|') || 'none',
      repoArchitectureLikelyTestCount: String(intentToBuild?.missionSpec?.repoArchitectureContext?.testsLikelyRequired?.length || 0),
      repoArchitectureGeneratedOutputTouched: (intentToBuild?.missionSpec?.repoArchitectureContext?.generatedOutputsLikelyTouched || []).length > 0 ? 'yes' : 'no',
      repoArchitectureSourceTruthWarning: (intentToBuild?.missionSpec?.repoArchitectureContext?.sourceTruthWarnings || [])[1] || 'none',
      repoArchitectureRiskLevel: (intentToBuild?.missionSpec?.repoArchitectureContext?.riskSummary || []).join('|') || 'none',
    });
  }, [intentToBuild, onIntentToBuildUpdate, verificationReturnAdjudication.capabilityGapPending, verificationReturnAdjudication.lessonCandidatePending]);
  useEffect(() => {
    onMissionBridgeUpdate(missionBridgeState);
  }, [missionBridgeState, onMissionBridgeUpdate]);

  function addMessage(message) {
    setMessages((previous) => appendMissionConsoleMessage(previous, message));
  }

  function buildStephanosResponse(content) {
    const normalizedPrompt = String(content || '').trim();
    if (/who am i talking to|who am i speaking to|who are you|what is this console|what can you do here/i.test(normalizedPrompt)) {
      return `You are speaking to Stephanos through the Agent Mission Console. Current route target is ${resolvedTarget.label}. I can route requests to Stephanos, Agents, or bounded OpenClaw analysis. OpenClaw is proposal-only, controlled execution stays future-gated, and execution is disabled.`;
    }
    return `Stephanos received: "${normalizedPrompt}". Mission Console route target is ${resolvedTarget.label}. Governed mode is active and approval remains required for destructive/high-risk actions.`;
  }

  function buildAgentsResponse(content, bridgeResult) {
    const availableAgents = visibleAgents.length > 0 ? visibleAgents.join(', ') : 'Intent Engine, Research Agent, Memory Agent, Execution Agent, Ideas Agent';
    const nextAction = bridgeResult?.nextRecommendedAction || 'Submit explicit operator intent.';
    return `You are routed to Agents → Mission Bridge. Available agents right now: ${availableAgents}. They can analyze, plan, summarize, and prepare handoff packets under operator approval boundaries. They cannot execute destructive/system-mutating actions without explicit approved workflow. Next safe action: ${nextAction}`;
  }

  function buildOpenClawResponse() {
    const validation = compactVerificationSummary.openClawHealthValidationStatus || 'unknown';
    const health = compactVerificationSummary.openClawAdapterHealthCheckState || 'unknown';
    const handshake = compactVerificationSummary.openClawAdapterHandshakeState || 'unknown';
    const trialStatus = compactVerificationSummary.openClawCapabilityTrialStatus || 'unknown';
    const packetStatus = compactVerificationSummary.openClawProposalPacketStatus || 'unknown';
    const reviewQueue = compactVerificationSummary.openClawOperatorReviewQueueStatus || 'unknown';
    const exportStatus = compactVerificationSummary.openClawCodexProposalExportStatus || 'unavailable';
    return `You are routed to OpenClaw → Bounded Analysis. Readonly validation is ${validation}; health is ${health}; handshake is ${handshake}. Current packet state is ${packetStatus} with review queue ${reviewQueue} and Codex export ${exportStatus}. OpenClaw can safely observe, validate readonly status, and produce proposal packets. OpenClaw cannot execute commands, edit files, write Git, control browsers, or run autonomous actions.`;
  }

  function applyMissionBridgeResult(bridgeResult, { includeLedgerMessage = true } = {}) {
    setMissionBridgeState((previous) => ({
      ...bridgeResult,
      events: [...(previous?.events || []), ...(bridgeResult.events || [])].slice(-40),
    }));
    if (!includeLedgerMessage) return;
    addMessage(createMissionConsoleMessage({
      role: 'assistant',
      responder: 'mission-bridge',
      target: 'agents',
      content: `Mission packet ${bridgeResult.missionPacket?.missionId || 'n/a'} generated. State: ${bridgeResult.state}.`,
      status: bridgeResult.pendingApproval ? 'approval-needed' : 'ready',
      approvalNeeded: bridgeResult.pendingApproval,
    }));
  }

  function handleProposalStatusChange(proposalId, status) {
    setProposalCards((previous) => previous.map((entry) => (entry.id === proposalId
      ? { ...entry, approvalStatus: status }
      : entry)));
    addMessage(createMissionConsoleMessage({
      role: 'assistant',
      responder: 'OpenClaw',
      target: 'openclaw',
      content: `Proposal ${proposalId} marked as ${status}. Explicit approval remains required before Codex handoff.`,
      status: status === 'approved' ? 'approval-needed' : 'ready',
      approvalNeeded: status === 'approved',
      linkedProposalId: proposalId,
    }));
  }

  function submitMissionMessage(event) {
    event.preventDefault();
    const content = String(input || '').trim();
    if (!content) {
      return;
    }

    addMessage(createMissionConsoleMessage({
      role: 'operator',
      responder: 'operator',
      target: resolvedTarget.id,
      content,
      status: 'submitted',
    }));

    const request = evaluateMissionConsoleRequest({
      targetId: resolvedTarget.id,
      content,
      openClawIntentType,
    });

    if (request.blocked) {
      addMessage(buildBlockedMissionConsoleResponse({
        target: request.target.id,
        reason: request.reason,
        policy: request.policy,
        actionId: request.actionId,
      }));
      setInput('');
      return;
    }

    if (request.target.id === 'stephanos') {
      addMessage(createMissionConsoleMessage({
        role: 'assistant',
        responder: 'Stephanos',
        target: 'stephanos',
        content: buildStephanosResponse(content),
        status: 'ready',
      }));
      setInput('');
      return;
    }

    if (request.target.id === 'agents') {
      const bridgeResult = processMissionBridgeIntent({
        operatorIntent: content,
        finalRouteTruth,
        finalAgentView,
        missionWorkflow: orchestrationTruth?.missionPacketWorkflow || {},
        backendExecutionContractStatus: finalRouteTruth?.backendExecutionContractStatus,
        providerExecutionGateStatus: finalRouteTruth?.providerExecutionGateStatus,
      });
      applyMissionBridgeResult(bridgeResult);
      addMessage(createMissionConsoleMessage({
        role: 'assistant',
        responder: 'mission-bridge',
        target: 'agents',
        content: buildAgentsResponse(content, bridgeResult),
        status: bridgeResult.pendingApproval ? 'approval-needed' : 'ready',
        approvalNeeded: bridgeResult.pendingApproval,
      }));
      setInput('');
      return;
    }

    if (request.target.id === 'openclaw') {
      if (openClawIntentType === 'run-scan') {
        const report = runOpenClawScan({
          scanType: OPENCLAW_SCAN_MODES[0].id,
          runtimeStatusModel,
          finalRouteTruth,
          repoPath: '/workspace/stephan-os',
          branchName,
        });
        setLastScanReport(report);
        addMessage(createMissionConsoleMessage({
          role: 'assistant',
          responder: 'OpenClaw',
          target: 'openclaw',
          content: `Bounded scan complete. Findings: ${report.findings.length}. Last inspection scope: ${report.inspected.categories.join(', ')}.`,
          status: 'ready',
        }));
      }

      if (openClawIntentType === 'generate-candidate-prompts') {
        const report = lastScanReport || runOpenClawScan({
          scanType: 'candidate-codex-prompt-generation',
          runtimeStatusModel,
          finalRouteTruth,
          repoPath: '/workspace/stephan-os',
          branchName,
        });
        const prompts = buildOpenClawCandidatePrompts(report);
        setLastScanReport(report);
        setProposalCards(prompts);
        addMessage(createMissionConsoleMessage({
          role: 'assistant',
          responder: 'OpenClaw',
          target: 'openclaw',
          content: `Generated ${prompts.length} candidate proposal card(s). Operator approval is required before Codex handoff.`,
          status: 'approval-needed',
          approvalNeeded: true,
        }));
      }

      if (openClawIntentType === 'refresh-status') {
        addMessage(createMissionConsoleMessage({
          role: 'assistant',
          responder: 'OpenClaw',
          target: 'openclaw',
          content: buildOpenClawResponse(),
          status: 'ready',
        }));
      }
    }

    setInput('');
  }

  function handleIntentInputChange(field, value) {
    setIntentInput((previous) => ({ ...previous, [field]: value }));
  }

  const missionMemoryContext = useMemo(() => ({
    memoryCandidates: agentTaskProjection?.memoryCandidates || [],
    draftMissionContext: missionBridgeState?.missionPacket?.missionTitle || '',
    includeDraftMissionContext: Boolean(missionBridgeState?.missionPacket?.missionTitle),
  }), [agentTaskProjection?.memoryCandidates, missionBridgeState?.missionPacket?.missionTitle]);

  function generateIntentToBuildSpec() {
    const next = createIntentToBuildState({
      ...intentInput,
      memoryContext: missionMemoryContext,
    });
    setIntentToBuild(next);
  }

  function submitOperatorIntentToBridge() {
    const bridgeResult = processMissionBridgeIntent({
      operatorIntent: intentInput.rawIntent,
      finalRouteTruth,
      finalAgentView,
      missionWorkflow: orchestrationTruth?.missionPacketWorkflow || {},
      backendExecutionContractStatus: finalRouteTruth?.backendExecutionContractStatus,
      providerExecutionGateStatus: finalRouteTruth?.providerExecutionGateStatus,
    });
    applyMissionBridgeResult(bridgeResult);
  }

  async function requestBridgeAiReasoning() {
    const updated = await requestMissionBridgeAI({
      bridgeState: missionBridgeState,
      prompt: intentInput.rawIntent,
      invokeAi: typeof submitPrompt === 'function'
        ? async (prompt) => submitPrompt(prompt, { orchestrationTruth, submissionSource: 'agent-mission-console', submissionRoute: 'mission-bridge' })
        : null,
    });
    setMissionBridgeState(updated);
    addMessage(createMissionConsoleMessage({
      role: 'assistant',
      responder: 'ai-router',
      target: 'agents',
      content: updated.latestAiResponse || 'AI request routed through backend/provider router.',
      status: 'ready',
    }));
  }

  async function copyToClipboard(text, setCopyState) {
    const result = await writeTextToClipboard(text, { navigatorObject: typeof navigator !== 'undefined' ? navigator : null });
    setCopyState(result.ok ? COPY_STATE.SUCCESS : COPY_STATE.FAILURE);
  }

  return (
    <CollapsiblePanel
      panelId="missionConsolePanel"
      title="Agent Mission Console"
      description="Mission Router workspace for agent mission packets, target routing, and bounded OpenClaw interaction."
      className="pane-span-2 mission-console-workspace"
      isOpen={uiLayout.missionConsolePanel !== false}
      onToggle={() => togglePanel('missionConsolePanel')}
    >
      <section className="mission-console-section">
        <h4>Workspace Header / Command Authority</h4>
        <ul>
          <li><strong>Current Workspace:</strong> Agent Mission Console (Mission Router)</li>
          <li><strong>Operator Authority:</strong> Active</li>
          <li><strong>Runtime Truth Source:</strong> {openClawIntegration.connectedTo.routeTruthSource}</li>
          <li><strong>Route Status Summary:</strong> {finalRouteTruth?.routeUsableState || 'unknown'} / {finalRouteTruth?.routeKind || 'unknown'}</li>
          <li><strong>Current addressed target:</strong> {resolvedTarget.label}</li>
          <li><strong>Zero-Cost Guardrails:</strong> Active</li>
          <li><strong>Approval Mode:</strong> Required for OpenClaw proposals and destructive/high-risk actions</li>
          <li><strong>Current session mode:</strong> {sessionMode}</li>
        </ul>
      </section>

      <section className="mission-console-section">
        <h4>Addressing / Routing Controls</h4>
        <div className="mission-console-target-controls">
          {MISSION_CONSOLE_TARGETS.map((target) => (
            <label key={target.id}>
              <input
                type="radio"
                name="missionConsoleTarget"
                value={target.id}
                checked={targetId === target.id}
                onChange={() => setTargetId(target.id)}
              />
              <strong>{target.label}</strong>
            </label>
          ))}
        </div>
        {targetId === 'agents' ? (
          <label className="paneFieldGroup">
            Selected agent (or broadcast)
            <select className="paneSelect paneControl" value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)}>
              <option value="broadcast">Agent broadcast query</option>
              {visibleAgents.map((agent) => <option key={agent.agentId} value={agent.agentId}>{agent.agentId}</option>)}
            </select>
          </label>
        ) : null}
        {targetId === 'openclaw' ? (
          <label className="paneFieldGroup">
            OpenClaw bounded analysis mode
            <select className="paneSelect paneControl" value={openClawIntentType} onChange={(event) => setOpenClawIntentType(event.target.value)}>
              {OPENCLAW_INTENT_OPTIONS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </select>
          </label>
        ) : null}
        <p><strong>Active routing target before submit:</strong> {resolvedTarget.label}</p>
        <p><strong>Target: Agents → Mission Bridge</strong></p>
        <p><strong>Target: Stephanos → Assistant Router</strong></p>
      </section>

      <section className="mission-console-section">
        <h4>Intent-to-Build Control Loop</h4>
        <label className="paneFieldGroup">
          Raw intent
          <textarea
            className="paneTextarea paneControl"
            rows={3}
            value={intentInput.rawIntent}
            onChange={(event) => handleIntentInputChange('rawIntent', event.target.value)}
            placeholder="Describe the high-level project intent for Stephanos to bound into a mission spec."
          />
        </label>
        <label className="paneFieldGroup">
          Target area
          <input className="paneInput paneControl" value={intentInput.targetArea} onChange={(event) => handleIntentInputChange('targetArea', event.target.value)} />
        </label>
        <label className="paneFieldGroup">
          Risk level
          <select className="paneSelect paneControl" value={intentInput.riskLevel} onChange={(event) => handleIntentInputChange('riskLevel', event.target.value)}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
        <button type="button" onClick={generateIntentToBuildSpec}>Generate Mission Spec</button>
        <div className="mission-console-copy-row">
          <button type="button" onClick={submitOperatorIntentToBridge}>Submit Operator Intent to Mission Bridge</button>
          <button type="button" onClick={requestBridgeAiReasoning}>Request AI via Router</button>
        </div>
        <ul>
          <li><strong>raw intent:</strong> {intentToBuild.missionSpec.rawIntent}</li>
          <li><strong>generated mission spec:</strong> {intentToBuild.missionSpec.missionId}</li>
          <li><strong>allowed actions:</strong> {intentToBuild.missionSpec.approvalBoundary.allowedActions.join(', ')}</li>
          <li><strong>blocked actions requiring approval:</strong> {intentToBuild.missionSpec.approvalBoundary.blockedActions.join(', ')}</li>
          <li><strong>generated Codex prompt:</strong> {intentToBuild.generatedPromptAvailable ? 'available' : 'not generated'}</li>
          <li><strong>intent categories:</strong> {(intentToBuild.missionSpec.intentClassifications || []).join(', ') || 'none'}</li>
          <li><strong>Stephanos suggests remembering this as:</strong> {intentToBuild.missionSpec.missionMemoryCandidate?.memoryCandidateType || 'temporary_note'}</li>
          <li><strong>requires approval before becoming project canon:</strong> {intentToBuild.missionSpec.missionMemoryCandidate?.requiresOperatorApproval ? 'yes' : 'no'}</li>
          <li><strong>suggested durability:</strong> {intentToBuild.missionSpec.missionMemoryCandidate?.suggestedDurability || 'session'}</li>
          <li><strong>possible capability gap:</strong> {intentToBuild.missionSpec.missionMemoryCandidate?.possibleCapabilityGap || 'none-detected'}</li>
          <li><strong>verification checklist:</strong> {intentToBuild.verificationEvidence.checks.map((entry) => entry.command).join(' | ')}</li>
          <li><strong>memory influence count:</strong> {intentToBuild.missionSpec.missionMemoryInfluenceCount || 0}</li>
          <li><strong>memory influence types:</strong> {(intentToBuild.missionSpec.missionMemoryInfluenceTypes || []).join(', ') || 'none'}</li>
          <li><strong>memory influence strength:</strong> {(intentToBuild.missionSpec.missionMemoryInfluenceLevels || []).join(', ') || 'none'}</li>
          <li><strong>memory conflict count:</strong> {intentToBuild.missionSpec.missionMemoryConflicts?.length || 0}</li>
          <li><strong>next best action:</strong> {intentToBuild.missionSpec.nextBestAction || 'n/a'}</li>
          <li><strong>Mission Finish Authority:</strong> {intentToBuild.missionSpec.finishAuthority?.finishAuthorityStatus || 'not_granted'} ({intentToBuild.missionSpec.finishAuthority?.finishAuthorityLevel || 'none'})</li>
          <li><strong>Routine finish allowed:</strong> {intentToBuild.missionSpec.finishAuthority?.routineFinishAllowed ? 'yes' : 'no'}</li>
          <li><strong>Retry/Rebuild allowed:</strong> {(intentToBuild.missionSpec.finishAuthority?.retryChecksAllowed || intentToBuild.missionSpec.finishAuthority?.rebuildDistAllowed) ? 'yes' : 'no'}</li>
          <li><strong>Merge authority:</strong> {intentToBuild.missionSpec.finishAuthority?.mergeAuthorityIncluded ? 'granted' : 'not granted'}</li>
          <li><strong>Auto-merge state:</strong> {intentToBuild.missionSpec.finishAuthority?.autoMergeArmed || 'unknown'}</li>
          <li><strong>Operator Approval Recorded:</strong> {intentToBuild.missionSpec.finishAuthority?.operatorApprovalRecorded ? 'yes' : 'no'}</li>
          <li><strong>Actual Merge State:</strong> {intentToBuild.missionSpec.finishAuthority?.merged ? `merged by ${intentToBuild.missionSpec.finishAuthority?.mergedBy || 'unknown'}` : 'not merged'}</li>
          <li><strong>Finish Warnings:</strong> {(intentToBuild.missionSpec.finishAuthority?.warnings || []).join(' | ') || 'none'}</li>
          <li><strong>Finish Next Action:</strong> {intentToBuild.missionSpec.finishAuthority?.nextAction || 'Merge is not authorized by this mission.'}</li>
          <li><strong>mission bridge mission id:</strong> {missionBridgeState.missionPacket?.missionId || 'n/a'}</li>
          <li><strong>mission bridge target agents:</strong> {missionBridgeState.missionPacket?.agentAssignments?.map((assignment) => assignment.roleId).filter(Boolean).join(', ') || selectedAgentId || 'broadcast'}</li>
          <li><strong>mission bridge approval-needed:</strong> {missionBridgeState.pendingApproval ? 'yes' : 'no'}</li>
          <li><strong>mission bridge current packet state:</strong> {missionBridgeState.missionPacket?.lifecycleState || missionBridgeState.state}</li>
          <li><strong>mission bridge state:</strong> {missionBridgeState.state}</li>
          <li><strong>mission bridge packet generated:</strong> {missionBridgeState.missionPacketGeneratedFromOperatorIntent ? 'yes' : 'no'}</li>
          <li><strong>mission bridge current mission title:</strong> {missionBridgeState.missionPacket?.missionTitle || 'n/a'}</li>
          <li><strong>mission bridge acting agent:</strong> {missionBridgeState.orchestration?.actingAgent || 'none'}</li>
          <li><strong>mission bridge pending approval:</strong> {missionBridgeState.pendingApproval ? 'yes' : 'no'}</li>
          <li><strong>mission bridge latest ai response:</strong> {missionBridgeState.latestAiResponse || 'n/a'}</li>
          <li><strong>mission bridge next action:</strong> {missionBridgeState.nextRecommendedAction}</li>
          <li><strong>mission bridge blockers:</strong> {missionBridgeState.missionPacket?.blockers?.join(' | ') || 'none'}</li>
          <li><strong>mission bridge warnings:</strong> {missionBridgeState.missionPacket?.warnings?.join(' | ') || 'none'}</li>
        </ul>

        <h5>OpenClaw Delegation Preview</h5>
        <ul>
          <li><strong>Delegated Authority Level:</strong> {intentToBuild.missionSpec.openClawDelegation?.authorityLevel || 'plan_only'}</li>
          <li><strong>Finish Authority:</strong> {intentToBuild.missionSpec.openClawDelegation?.finishAuthority || 'plan_only'} (not granted unless explicitly included)</li>
          <li><strong>Allowed OpenClaw Work:</strong> {(intentToBuild.missionSpec.openClawDelegation?.allowedCapabilities || []).join(', ') || 'none'}</li>
          <li><strong>Blocked OpenClaw Work:</strong> {(intentToBuild.missionSpec.openClawDelegation?.blockedCapabilities || []).join(', ') || 'none'}</li>
          <li><strong>what OpenClaw is being asked to do:</strong> {intentToBuild.missionSpec.openClawDelegation?.missionScope || 'n/a'}</li>
          <li><strong>what it may research:</strong> {intentToBuild.missionSpec.openClawDelegation?.researchAllowed ? 'yes' : 'no'}</li>
          <li><strong>what it may inspect:</strong> {intentToBuild.missionSpec.openClawDelegation?.repoInspectionAllowed ? 'yes' : 'no'}</li>
          <li><strong>what it may draft:</strong> {intentToBuild.missionSpec.openClawDelegation?.codexHandoffDraftAllowed ? 'yes' : 'no'}</li>
          <li><strong>whether routine finish steps are allowed:</strong> {['finish_routine_checks', 'merge_authorized'].includes(intentToBuild.missionSpec.openClawDelegation?.finishAuthority) ? 'yes' : 'no'}</li>
          <li><strong>whether merge authority is included:</strong> no (OpenClaw may not merge)</li>
          <li><strong>whether operator approval is required:</strong> {intentToBuild.missionSpec.openClawDelegation?.requiredOperatorApproval ? 'yes' : 'no'}</li>
          <li><strong>Self-Authority Escalation:</strong> blocked</li>
        </ul>

        <h5>Architecture Map / Likely Impact</h5>
        <ul>
          <li><strong>Affected Subsystems:</strong> {(intentToBuild.missionSpec.repoArchitectureContext?.affectedSubsystems || []).join(', ') || 'none'}</li>
          <li><strong>Likely Source Files:</strong> {(intentToBuild.missionSpec.repoArchitectureContext?.sourceFilesLikelyTouched || []).join(', ') || 'none'}</li>
          <li><strong>Likely Tests:</strong> {(intentToBuild.missionSpec.repoArchitectureContext?.testsLikelyRequired || []).join(', ') || 'none'}</li>
          <li><strong>Generated Outputs:</strong> {(intentToBuild.missionSpec.repoArchitectureContext?.generatedOutputsLikelyTouched || []).join(', ') || 'none'}</li>
          <li><strong>Source Truth Warnings:</strong> {(intentToBuild.missionSpec.repoArchitectureContext?.sourceTruthWarnings || []).join(' | ') || 'none'}</li>
          <li><strong>Architecture Risk Notes:</strong> {(intentToBuild.missionSpec.repoArchitectureContext?.riskSummary || []).join(' | ') || 'none'}</li>
        </ul>

        <h5>Memory Context Used</h5>
        <ul>
          {(intentToBuild.missionSpec.missionMemoryInfluence || []).map((entry) => (
            <li key={entry.id}><strong>{entry.type}</strong> [{entry.influenceLevel}; score {entry.relevanceScore}]: {entry.summary}</li>
          ))}
          {(!intentToBuild.missionSpec.missionMemoryInfluence || intentToBuild.missionSpec.missionMemoryInfluence.length === 0) ? <li>none</li> : null}
        </ul>
        <h5>Memory Influence Strength</h5>
        <ul>
          {Object.entries(intentToBuild.missionSpec.missionMemoryContext?.summary?.groupCounts || {}).filter(([, count]) => count > 0).map(([group, count]) => (
            <li key={group}><strong>{group}:</strong> {count}</li>
          ))}
          {(!intentToBuild.missionSpec.missionMemoryContext?.summary?.count) ? <li>none</li> : null}
        </ul>
        <h5>Memory Conflicts / Warnings</h5>
        <ul>
          {(intentToBuild.missionSpec.missionMemoryConflicts || []).map((conflict) => (
            <li key={`${conflict.conflictType}-${conflict.memorySource}`}><strong>{conflict.severity} {conflict.conflictType}:</strong> {conflict.suggestedResolution}</li>
          ))}
          {(!intentToBuild.missionSpec.missionMemoryConflicts || intentToBuild.missionSpec.missionMemoryConflicts.length === 0) ? <li>none</li> : null}
        </ul>
        <h5>Suggested Capability / Skill Upgrade</h5>
        <p>{intentToBuild.missionSpec.missionMemorySkillForgeCandidate?.title || 'none'}</p>
        <p><em>Generated mission proposal, no code changed. OpenClaw remains parked unless explicitly in scope.</em></p>
        <h5>Verification Return Input</h5>
        <textarea className="paneTextarea paneControl" rows={4} value={verificationReturnInput} onChange={(event) => setVerificationReturnInput(event.target.value)} placeholder="Paste Codex return summary for adjudication." />
        <ul>
          <li><strong>matches mission goal:</strong> {verificationReturnAdjudication.matchesMissionGoal}</li>
          <li><strong>changed files known/unknown:</strong> {verificationReturnAdjudication.changedFilesKnown}</li>
          <li><strong>tests claimed/run:</strong> {verificationReturnAdjudication.testsClaimedRun}</li>
          <li><strong>blockers:</strong> {verificationReturnAdjudication.blockers}</li>
          <li><strong>merge readiness:</strong> {verificationReturnAdjudication.mergeReadiness}</li>
          <li><strong>suggested lesson candidate:</strong> {verificationReturnAdjudication.suggestedLessonCandidate}</li>
          <li><strong>next action:</strong> {verificationReturnAdjudication.nextAction}</li>
        </ul>
        <h5>Suggested Lesson From Return</h5>
        <ul>
          {(verificationReturnAdjudication.lessonCandidates || []).map((candidate) => (
            <li key={candidate.id}><strong>{candidate.memoryCandidateType}:</strong> {candidate.summary} <em>Requires approval before durable memory. Generated from verification return.</em></li>
          ))}
          {(!verificationReturnAdjudication.lessonCandidates || verificationReturnAdjudication.lessonCandidates.length === 0) ? <li>none pasted</li> : null}
        </ul>
        <h5>Suggested Capability / Skill Upgrade</h5>
        <p>{verificationReturnAdjudication.skillUpgradeSuggestion}</p>
        <h5>Agent Task Verification Return (compact)</h5>
        <ul>
          <li><strong>verification return status:</strong> {compactVerificationSummary.verificationReturnStatus}</li>
          <li><strong>verification decision:</strong> {compactVerificationSummary.verificationDecision}</li>
          <li><strong>merge readiness:</strong> {compactVerificationSummary.mergeReadiness}</li>
          <li><strong>verification return next action:</strong> {compactVerificationSummary.verificationReturnNextAction}</li>
          <li><strong>highest priority blocker/warning:</strong> {compactVerificationSummary.highestPriorityIssue}</li>
          <li><strong>manual-only handoff:</strong> {compactVerificationSummary.manualOnly ? 'yes' : 'no'}</li>
          <li><strong>reality forge proof status:</strong> {compactVerificationSummary.realityForgeProofStatus}</li>
          <li><strong>build verified:</strong> {compactVerificationSummary.realityForgeBuildVerified ? 'yes' : 'no'}</li>
          <li><strong>runtime verified:</strong> {compactVerificationSummary.realityForgeRuntimeVerified ? 'yes' : 'no'}</li>
          <li><strong>operator-visible proof pending:</strong> {compactVerificationSummary.realityForgeOperatorVisibleProofPending ? 'yes' : 'no'}</li>
          <li><strong>manual verification required:</strong> {compactVerificationSummary.realityForgeManualVerificationRequired ? 'yes' : 'no'}</li>
          <li><strong>world workspace proof checks pending:</strong> {compactVerificationSummary.realityForgeWorldWorkspaceChecksPending.join(' | ') || 'none'}</li>
          <li><strong>openclaw readiness:</strong> {compactVerificationSummary.openClawReadiness}</li>
          <li><strong>openclaw integration mode:</strong> {compactVerificationSummary.openClawIntegrationMode}</li>
          <li><strong>openclaw safe-to-use:</strong> {compactVerificationSummary.openClawSafeToUse ? 'yes' : 'no'}</li>
          <li><strong>openclaw kill switch:</strong> {compactVerificationSummary.openClawKillSwitchState}</li>
          <li><strong>openclaw kill-switch mode:</strong> {compactVerificationSummary.openClawKillSwitchMode}</li>
          <li><strong>openclaw execution allowed:</strong> {compactVerificationSummary.openClawExecutionAllowed ? 'yes' : 'no'}</li>
          <li><strong>openclaw top blocker:</strong> {compactVerificationSummary.openClawHighestPriorityBlocker}</li>
          <li><strong>openclaw next action:</strong> {compactVerificationSummary.openClawNextAction}</li>
          <li><strong>openclaw adapter mode:</strong> {compactVerificationSummary.openClawAdapterMode}</li>
          <li><strong>openclaw adapter readiness:</strong> {compactVerificationSummary.openClawAdapterReadiness}</li>
          <li><strong>openclaw adapter connection mode:</strong> {compactVerificationSummary.openClawAdapterConnectionMode}</li>
          <li><strong>openclaw adapter connection state:</strong> {compactVerificationSummary.openClawAdapterConnectionState}</li>
          <li><strong>openclaw adapter endpoint configured:</strong> {compactVerificationSummary.openClawAdapterEndpointConfigured ? 'yes' : 'no'}</li>
          <li><strong>openclaw adapter endpoint label:</strong> {compactVerificationSummary.openClawAdapterEndpointLabel}</li>
          <li><strong>openclaw adapter endpoint host/port:</strong> {compactVerificationSummary.openClawAdapterEndpointHost}:{compactVerificationSummary.openClawAdapterEndpointPort}</li>
          <li><strong>openclaw adapter endpoint scope:</strong> {compactVerificationSummary.openClawAdapterEndpointScope}</li>
          <li><strong>openclaw adapter endpoint mode:</strong> {compactVerificationSummary.openClawAdapterEndpointMode}</li>
          <li><strong>openclaw adapter expected protocol:</strong> {compactVerificationSummary.openClawAdapterExpectedProtocolVersion}</li>
          <li><strong>openclaw adapter allowed probes:</strong> {compactVerificationSummary.openClawAdapterAllowedProbeTypes}</li>
          <li><strong>openclaw adapter config ready:</strong> {compactVerificationSummary.openClawAdapterConnectionConfigReady ? 'yes' : 'no'}</li>
          <li><strong>openclaw adapter config blocker:</strong> {compactVerificationSummary.openClawAdapterConnectionConfigTopBlocker}</li>
          <li><strong>openclaw adapter config warning:</strong> {compactVerificationSummary.openClawAdapterConnectionConfigTopWarning}</li>
          <li><strong>openclaw adapter config next action:</strong> {compactVerificationSummary.openClawAdapterConnectionConfigNextAction}</li>
          <li><strong>openclaw adapter health check:</strong> {compactVerificationSummary.openClawAdapterHealthCheckState}</li>
          <li><strong>openclaw adapter handshake:</strong> {compactVerificationSummary.openClawAdapterHandshakeState}</li>
          <li><strong>openclaw readonly validation status:</strong> {compactVerificationSummary.openClawHealthValidationStatus}</li>
          <li><strong>openclaw readonly validation mode:</strong> {compactVerificationSummary.openClawHealthValidationMode}</li>
          <li><strong>openclaw protocol compatible:</strong> {compactVerificationSummary.openClawProtocolCompatible ? 'yes' : 'no'}</li>
          <li><strong>openclaw capability trial:</strong> {compactVerificationSummary.openClawCapabilityTrialStatus}</li>
          <li><strong>openclaw proposal packet:</strong> {compactVerificationSummary.openClawProposalPacketStatus}</li>
          <li><strong>openclaw review queue:</strong> {compactVerificationSummary.openClawOperatorReviewQueueStatus}</li>
          <li><strong>openclaw codex export:</strong> {compactVerificationSummary.openClawCodexProposalExportStatus}</li>
          <li><strong>openclaw controlled execution gate:</strong> {compactVerificationSummary.openClawControlledExecutionStatus}</li>
          <li><strong>openclaw readonly assurance:</strong> {compactVerificationSummary.openClawReadonlyAsserted ? 'asserted' : 'not asserted'}</li>
          <li><strong>openclaw validation next action:</strong> {compactVerificationSummary.openClawHealthValidationNextAction}</li>
          <li><strong>openclaw adapter connection ready:</strong> {compactVerificationSummary.openClawAdapterConnectionReady ? 'yes' : 'no'}</li>
          <li><strong>openclaw adapter connection execution allowed:</strong> {compactVerificationSummary.openClawAdapterConnectionExecutionAllowed ? 'yes' : 'no'}</li>
          <li><strong>openclaw adapter connection blocker:</strong> {compactVerificationSummary.openClawAdapterConnectionHighestPriorityBlocker}</li>
          <li><strong>openclaw adapter connection next action:</strong> {compactVerificationSummary.openClawAdapterConnectionNextAction}</li>
          <li><strong>openclaw adapter execution mode:</strong> {compactVerificationSummary.openClawAdapterExecutionMode}</li>
          <li><strong>openclaw adapter can execute:</strong> {compactVerificationSummary.openClawAdapterCanExecute ? 'yes' : 'no'}</li>
          <li><strong>openclaw adapter next action:</strong> {compactVerificationSummary.openClawAdapterNextAction}</li>
          <li><strong>openclaw adapter stub status:</strong> {compactVerificationSummary.openClawAdapterStubStatus}</li>
          <li><strong>openclaw adapter stub health:</strong> {compactVerificationSummary.openClawAdapterStubHealth}</li>
          <li><strong>openclaw adapter stub connection:</strong> {compactVerificationSummary.openClawAdapterStubConnectionState}</li>
          <li><strong>openclaw adapter stub execution disabled:</strong> {compactVerificationSummary.openClawAdapterStubCanExecute ? 'no (unexpected)' : 'yes'}</li>
          <li><strong>openclaw adapter stub next action:</strong> {compactVerificationSummary.openClawAdapterStubNextAction}</li>
          <li><strong>openclaw policy notice:</strong> endpoint configuration only, no live automation</li>
        </ul>
        <div className="mission-console-copy-row">
          <button type="button" onClick={() => copyToClipboard(JSON.stringify(intentToBuild.missionSpec, null, 2), setSpecCopyState)}>
            {specCopyState === COPY_STATE.SUCCESS ? 'Mission Spec Copied' : 'Copy Mission Spec'}
          </button>
          <button type="button" onClick={() => copyToClipboard(intentToBuild.codexPrompt, setPromptCopyState)}>
            {promptCopyState === COPY_STATE.SUCCESS ? 'Codex Prompt Copied' : 'Copy Codex Prompt'}
          </button>
        </div>
        <pre className="openclaw-prompt-box">{intentToBuild.codexPrompt}</pre>
      </section>


      <section className="mission-console-section">
        <h4>Mission Intelligence Brief</h4>
        <p><strong>Current phase:</strong> {missionIntelligence.missionPhase}</p>
        <p><strong>Situation summary:</strong> {missionIntelligence.currentSituationSummary}</p>
        <p><strong>Recommended next mission:</strong> {missionIntelligence.recommendedNextMission}</p>
        <p><strong>Recommended next action:</strong> {missionIntelligence.recommendedNextAction}</p>
        <p><strong>Suggested agent route:</strong> {missionIntelligence.recommendedAgentRoute}</p>
        <p><strong>Why:</strong> {missionIntelligence.reason}</p>
        <p><strong>Risk:</strong> {missionIntelligence.riskLevel}</p>
        <p><strong>Execution posture:</strong> {missionIntelligence.executionPosture}</p>
        <p><strong>Confidence:</strong> {missionIntelligence.confidence}</p>
        <p><strong>Operator decision needed:</strong> {missionIntelligence.operatorDecisionNeeded ? 'yes' : 'no'}</p>
        <p><strong>Next checkpoint:</strong> {missionIntelligence.nextReviewCheckpoint}</p>
        <ul>
          <li><strong>Blockers:</strong> {missionIntelligence.blockers.join(' | ') || 'none'}</li>
          <li><strong>Warnings:</strong> {missionIntelligence.warnings.join(' | ') || 'none'}</li>
          <li><strong>Contradictions:</strong> {missionIntelligence.contradictionSignals.join(' | ') || 'none'}</li>
          <li><strong>Stale signals:</strong> {missionIntelligence.staleSignals.join(' | ') || 'none'}</li>
          <li><strong>Suggested operator actions:</strong> {missionIntelligence.suggestedOperatorActions.join(' | ') || 'none'}</li>
        </ul>
      </section>


      <section className="mission-console-section">
        <h4>Reality Upgrade Orchestrator v1</h4>
        <p><strong>Upgrade intent:</strong> {runtimeStatusModel?.realityUpgradeOrchestrator?.upgradeIntent || 'Awaiting intent'}</p>
        <p><strong>Affected system area:</strong> {runtimeStatusModel?.realityUpgradeOrchestrator?.affectedSystemArea || 'unknown'}</p>
        <p><strong>Current stage:</strong> {runtimeStatusModel?.realityUpgradeOrchestrator?.supportSnapshot?.activeMissionStage || 'none'}</p>
        <p><strong>Recommended crew of minds:</strong> {(runtimeStatusModel?.realityUpgradeOrchestrator?.recommendedMinds || []).map((mind) => mind.displayName).join(' | ') || 'none yet'}</p>
        <p><strong>Approval checkpoints:</strong> {(runtimeStatusModel?.realityUpgradeOrchestrator?.approvalCheckpoints || []).join(' | ') || 'none'}</p>
        <p><strong>Verification contract:</strong> {(runtimeStatusModel?.realityUpgradeOrchestrator?.verificationContract?.checks || []).join(' | ') || 'none'}</p>
        <button type="button" onClick={() => copyToClipboard(JSON.stringify(runtimeStatusModel?.realityUpgradeOrchestrator || {}, null, 2), setSpecCopyState)}>Generate Codex Handoff Packet</button>
      </section>

      <section className="mission-console-section">
        <h4>Conversation Workspace</h4>
        <div className="mission-console-ledger">
          {messages.map((message) => (
            <article key={message.id} className={`mission-console-message mission-console-message-${message.role}`}>
              <header>
                <strong>{message.responder}</strong> · target <strong>{message.target}</strong> · status <strong>{message.status}</strong>
                {message.approvalNeeded ? <span className="mission-console-pill">approval-needed</span> : null}
              </header>
              <p>{message.content}</p>
              <small>{message.timestamp}{message.linkedProposalId ? ` · proposal ${message.linkedProposalId}` : ''}</small>
            </article>
          ))}
        </div>
        <form className="command-form mission-console-input" onSubmit={submitMissionMessage}>
          <textarea
            className="paneTextarea paneControl"
            rows={3}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Talk to Stephanos, route to agents, or request bounded OpenClaw analysis."
          />
          <button type="submit">Submit to {resolvedTarget.label}</button>
        </form>
      </section>

      <section className="mission-console-section">

        <h4>Agent Command Console Mission Card</h4>
        <ul className="paneList">
          <li><strong>Current mission state:</strong> {agentCommandConsole.commandConsoleStatus}</li>
          <li><strong>Active agent:</strong> {agentCommandConsole.activeAgent}</li>
          <li><strong>Active packet id:</strong> {agentCommandConsole.activePacketId}</li>
          <li><strong>Active stage:</strong> {agentCommandConsole.activeStage}</li>
          <li><strong>Next best action:</strong> {agentCommandConsole.nextBestAction}</li>
          <li><strong>Operator action required:</strong> {agentCommandConsole.operatorActionRequired ? 'yes' : 'no'}</li>
          <li><strong>Execution allowed:</strong> no</li>
          <li><strong>Safety posture:</strong> {agentCommandConsole.safetyPosture}</li>
        </ul>

        <h4>Agent Command Queue</h4>
        <p><strong>queue status:</strong> {agentCommandQueue.queueStatus} · <strong>ready items:</strong> {agentCommandQueue.readyCount} / {agentCommandQueue.itemCount}</p>
        <ul className="paneList">{agentCommandQueue.items.map((item) => (
          <li key={item.itemId}><strong>{item.label}</strong> · {item.itemType} · {item.status} · next: {item.nextAction}</li>
        ))}</ul>

        <h4>Current Work Item Details</h4>
        <ul className="paneList">
          <li><strong>Proposal packet summary:</strong> {agentTaskProjection?.operatorSurface?.openClawProposalPacket?.proposalSummary || 'none'}</li>
          <li><strong>Codex prompt export summary:</strong> {agentTaskProjection?.operatorSurface?.openClawCodexProposalExport?.summary || 'none'}</li>
          <li><strong>Codex review result summary:</strong> {agentTaskProjection?.operatorSurface?.openClawCodexReviewResult?.summary || 'none'}</li>
          <li><strong>Evidence request summary:</strong> {agentTaskProjection?.operatorSurface?.openClawEvidenceRequest?.requestSummary || 'none'}</li>
          <li><strong>Implementation plan summary:</strong> {agentTaskProjection?.operatorSurface?.openClawImplementationPlan?.summary || 'none'}</li>
          <li><strong>Approval readiness summary:</strong> {agentTaskProjection?.operatorSurface?.openClawApprovalGateReadiness?.summary || 'none'}</li>
          <li><strong>Dry-run preview summary:</strong> {agentTaskProjection?.operatorSurface?.openClawDryRunPlan?.summary || 'none'}</li>
          <li><strong>Codex mode:</strong> manual_prompt</li>
        </ul>

                <h4>OpenClaw Interaction + Visibility</h4>
        <ul>
          <li><strong>current OpenClaw mode:</strong> {OPENCLAW_MODE}</li>
          <li><strong>current authority posture:</strong> {OPENCLAW_AUTHORITY}</li>
          <li><strong>current workspace / repo scope:</strong> {openClawIntegration.workspacePath} / {openClawIntegration.repoScope}</li>
          <li><strong>sandbox state:</strong> {openClawIntegration.sandboxStatus}</li>
          <li><strong>trust posture:</strong> {openClawIntegration.pluginTrustPosture}</li>
          <li><strong>scan state:</strong> {openClawIntegration.sessionState}</li>
          <li><strong>last inspection scope:</strong> {openClawIntegration.lastInspectionScope.join(', ') || 'none'}</li>
          <li><strong>last proposed prompt:</strong> {openClawIntegration.lastProposedPrompt}</li>
          <li><strong>blocked capabilities:</strong> {openClawIntegration.blockedCapabilities.join(', ')}</li>
          <li><strong>approval required:</strong> {openClawIntegration.approvalRequired}</li>
          <li><strong>waiting for operator review:</strong> {proposalCards.some((card) => card.approvalStatus === 'pending') ? 'yes' : 'no'}</li>
        </ul>
        {openClawIntegration.warnings.length > 0 ? (
          <div className="mission-dashboard__banner mission-dashboard__banner--warning">
            <strong>OpenClaw trust warning:</strong>
            <span>{openClawIntegration.warnings.join(' ')}</span>
          </div>
        ) : null}
      </section>

      <section className="mission-console-section">
        <h4>Shared Agent Context Panel</h4>
        <ul>
          <li><strong>active / visible agents:</strong> {visibleAgents.map((agent) => agent.agentId).join(', ') || 'none visible'}</li>
          <li><strong>currently acting agent:</strong> {actingAgentId}</li>
          <li><strong>last handoff:</strong> {lastHandoff}</li>
          <li><strong>current agent summary:</strong> {currentAgentSummary}</li>
          <li><strong>selected agent:</strong> {selectedAgentId}</li>
          <li><strong>active agents:</strong> {activeAgentIds.join(', ') || 'none'}</li>
        </ul>
      </section>

      <section className="mission-console-section">
        <h4>Proposal / Approval Rail</h4>
        {proposalCards.length === 0 ? <p>No active OpenClaw proposal cards.</p> : (
          <div className="openclaw-findings-grid">
            {proposalCards.map((card) => (
              <article key={card.id} className="mission-dashboard__milestone">
                <h5>{card.title}</h5>
                <p>{card.diagnosis}</p>
                <ul>
                  <li><strong>Approval status:</strong> {card.approvalStatus}</li>
                  <li><strong>Risk level:</strong> {card.riskLevel}</li>
                  <li><strong>Linked files:</strong> {card.relevantFiles.join(', ') || 'none'}</li>
                </ul>
                <pre className="openclaw-prompt-box">{card.candidatePrompt}</pre>
                <div className="openclaw-approval-rail">
                  <button type="button" onClick={() => handleProposalStatusChange(card.id, 'approved')}>Approve for Codex handoff</button>
                  <button type="button" onClick={() => handleProposalStatusChange(card.id, 'refine')}>Refine</button>
                  <button type="button" onClick={() => handleProposalStatusChange(card.id, 'archived')}>Archive</button>
                  <button type="button" onClick={() => handleProposalStatusChange(card.id, 'rejected')}>Reject</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="mission-console-section">
        <h4>Integration Topology in Agent Mission Console</h4>
        <p>{openClawIntegration.topology.map((node) => node.label).join(' -> ')}</p>
        <ul>
          {openClawIntegration.topology.map((node) => <li key={node.id}><strong>{node.label}:</strong> {node.policyNote}</li>)}
        </ul>
      </section>

      <section className="mission-console-section">
        <h4>Guardrails</h4>
        <ul>
          <li><strong>zero-cost posture active:</strong> {guardrails.zeroCostPosture}</li>
          <li><strong>proposal-only OpenClaw posture:</strong> {openClawIntegration.proposalOnlyEnforced ? 'active' : 'degraded'}</li>
          <li><strong>catastrophic-safety blocks active:</strong> {guardrails.blockedActionCount}</li>
          <li><strong>no direct destructive execution:</strong> blocked</li>
          <li><strong>no secret discovery/export:</strong> blocked</li>
          <li><strong>no plugin installation from Agent Mission Console:</strong> blocked</li>
          <li><strong>no GitHub destructive operations:</strong> blocked</li>
          <li><strong>no filesystem destructive operations:</strong> blocked</li>
          <li><strong>no hidden background tasks:</strong> blocked</li>
        </ul>
      </section>
    </CollapsiblePanel>
  );
}
