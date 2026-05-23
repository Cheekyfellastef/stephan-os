import { memo, useEffect, useMemo, useRef, useState } from 'react';
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
import { recordCopyFeedbackEvent } from '../utils/copyFeedbackRecorder';
import { createIntentToBuildState, deriveVerificationReturnLessonCandidates, INTENT_TO_BUILD_BOUNDARIES } from '../state/intentToBuildModel.js';
import { buildPrEvidenceFromInput, parsePrEvidenceInput } from '../state/prEvidenceConnectorModel.js';
import { buildMemoryLibrarianQueue } from '../state/memoryLibrarianModel.js';
import { adjudicateMissionVerificationJudge } from '../state/missionVerificationJudgeModel.js';
import { buildMissionEvidenceLedger } from '../state/missionEvidenceLedgerModel.js';
import { buildMissionCommandPacket, buildMissionCommandPacketJson, buildMissionCommandPacketMarkdown } from '../state/missionCommandPacketModel.js';
import { buildAgentAssignmentMatrix } from '../state/agentAssignmentMatrixModel.js';
import { buildMissionRoutingReadiness } from '../state/missionRoutingReadinessModel.js';
import { deriveOperatorReliefProjection } from '../state/operatorReliefProjection.js';
import { createMissionBridgeState, processMissionBridgeIntent, requestMissionBridgeAI } from '../state/missionBridge.js';
import { buildAgentCommandConsoleProjection } from '../../../shared/agents/agentCommandConsole.mjs';
import { buildAgentCommandQueue } from '../../../shared/agents/agentCommandQueue.mjs';
import { buildMissionIntelligenceLayer } from '../../../shared/agents/missionIntelligenceLayer.mjs';
import MissionCommandDeck from './MissionCommandDeck';
import AIConsole from './AIConsole';
import { buildMusicMissionContext } from '../../../apps/music-tile/engine/musicMissionContext.js';
import { buildMissionConsoleContext, registerTileMissionContext } from '../../../shared/runtime/tileMissionContextRegistry.mjs';
import { emitPresenceEvent } from '../../../shared/runtime/stephanosPresenceBridge.mjs';
import { copyPerfDiagnosticsSnapshot, recordPerfCounter, setPerfIdentityField } from '../state/perfDiagnostics.js';

registerTileMissionContext('music', ({ state }) => buildMusicMissionContext(state));



function summarizeMissionConsoleProps(props = {}) {
  const uiLayout = props.uiLayout || {};
  const runtimeStatus = props.runtimeStatusModel || {};
  const finalRouteTruth = props.finalRouteTruth || {};
  const finalAgentView = props.finalAgentView || {};
  const orchestrationTruth = props.orchestrationTruth || {};
  const agentTaskProjection = props.agentTaskProjection || {};
  return {
    uiLayout: Object.entries(uiLayout)
      .filter(([key]) => key.endsWith('Panel') || key === 'commandDeck')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${value !== false ? 'open' : 'closed'}`)
      .join('|'),
    routeStatus: [finalRouteTruth.routeUsableState || '', finalRouteTruth.routeKind || '', finalRouteTruth.selectedProvider || ''].join('|'),
    runtimeStatus: [runtimeStatus.provider || '', runtimeStatus.appLaunchState || '', runtimeStatus.routeMode || ''].join('|'),
    agentContext: [finalAgentView.actingAgentId || '', (finalAgentView.visibleAgents || []).length, (finalAgentView.activeAgentIds || []).length].join('|'),
    missionBridge: [props.onMissionBridgeUpdate, orchestrationTruth?.missionBridge?.state || orchestrationTruth?.missionBridgeState || ''].join('|'),
    operatorRelief: [agentTaskProjection?.readinessSummary?.verificationReturnStatus || '', agentTaskProjection?.operatorSurface?.verificationReturnStatus || ''].join('|'),
    callbacks: [props.togglePanel, props.onOpenClawIntegrationUpdate, props.onIntentToBuildUpdate, props.onMissionBridgeUpdate, props.setSharedConsoleInput, props.submitPrompt, props.cancelActivePrompt, props.emergencyReleaseOllamaLoad].map((fn)=>typeof fn==='function'?String(fn):'null').join('|'),
    input: props.sharedConsoleInput || '',
    commandHistory: (props.sharedCommandHistory || []).length,
    branch: props.branchName || 'unknown',
  };
}

function recordMissionConsoleRenderReasons(currentProps) {
  const next = summarizeMissionConsoleProps(currentProps);
  const previous = recordMissionConsoleRenderReasons.previous;
  if (!previous) {
    recordPerfCounter('render_reason', 'MissionConsoleTile.initial');
  } else {
    let changed = 0;
    for (const key of Object.keys(next)) {
      if (next[key] !== previous[key]) {
        changed += 1;
        recordPerfCounter('render_reason', `MissionConsoleTile.${key}`);
      }
    }
    if (changed === 0) recordPerfCounter('render_reason', 'MissionConsoleTile.no_semantic_change');
  }
  recordMissionConsoleRenderReasons.previous = next;
}
const OPENCLAW_INTENT_OPTIONS = Object.freeze([
  { id: 'run-scan', label: 'Run bounded scan' },
  { id: 'refresh-status', label: 'Summarize inspection scope' },
  { id: 'generate-candidate-prompts', label: 'Generate alternatives / refine prompts' },
]);

function MissionConsoleTile({
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
  sharedConsoleInput = '',
  setSharedConsoleInput = () => {},
  sharedCommandHistory = [],
  cancelActivePrompt = null,
  emergencyReleaseOllamaLoad = null,
  orchestrationTruth = null,
  agentTaskProjection = null,
  forcePanelOpen = false,
  panelId = 'missionConsolePanel',
  panelTitle = 'Agent Mission Console',
}) {
  recordPerfCounter('render', 'MissionConsoleTile');
  useEffect(() => {
    setPerfIdentityField('component.MissionConsoleTile.mounted', true);
    recordPerfCounter('surface_mount', 'MissionConsoleTile.mount');
    return () => {
      setPerfIdentityField('component.MissionConsoleTile.mounted', false);
      recordPerfCounter('surface_mount', 'MissionConsoleTile.unmount');
    };
  }, []);
  recordMissionConsoleRenderReasons({
    uiLayout, runtimeStatusModel, finalRouteTruth, finalAgentView, branchName,
    onOpenClawIntegrationUpdate, onIntentToBuildUpdate, onMissionBridgeUpdate,
    submitPrompt, sharedConsoleInput, setSharedConsoleInput, sharedCommandHistory,
    cancelActivePrompt, emergencyReleaseOllamaLoad, orchestrationTruth, agentTaskProjection, togglePanel,
  });
  const { copyState: promptCopyState, setCopyState: setPromptCopyState } = useClipboardButtonState();
  const { copyState: specCopyState, setCopyState: setSpecCopyState } = useClipboardButtonState();
  const { copyState: packetMarkdownCopyState, setCopyState: setPacketMarkdownCopyState } = useClipboardButtonState();
  const { copyState: packetJsonCopyState, setCopyState: setPacketJsonCopyState } = useClipboardButtonState();
  const { copyState: repairPromptCopyState, setCopyState: setRepairPromptCopyState } = useClipboardButtonState();
  const { copyState: missionHandoffCopyState, setCopyState: setMissionHandoffCopyState } = useClipboardButtonState();
  const { copyState: nextCodexPromptCopyState, setCopyState: setNextCodexPromptCopyState } = useClipboardButtonState();
  const { copyState: codexPacketCopyState, setCopyState: setCodexPacketCopyState } = useClipboardButtonState();
  const { copyState: operatorChecklistCopyState, setCopyState: setOperatorChecklistCopyState } = useClipboardButtonState();
  const { copyState: perfCopyState, setCopyState: setPerfCopyState } = useClipboardButtonState();
  const [input, setInput] = useState('');
  const [targetId, setTargetId] = useState('stephanos');
  const [contextScope, setContextScope] = useState('whole-stephanos');
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
  const [prEvidenceInput, setPrEvidenceInput] = useState('');
  const [prEvidenceParseResult, setPrEvidenceParseResult] = useState(() => parsePrEvidenceInput(''));
  const [showRepairPromptBody, setShowRepairPromptBody] = useState(false);
  const [showMissionHandoffJson, setShowMissionHandoffJson] = useState(false);
  const [missionApprovalDecisionState, setMissionApprovalDecisionState] = useState(() => ({ selectedDecision: 'hold', timestamp: '', sourceQueueItemId: '' }));

  const operatorReliefPresenceSignatureRef = useRef('');
  const intentUpdateSignatureRef = useRef('');
  const openClawIntegrationSignatureRef = useRef('');
  const missionBridgeSignatureRef = useRef('');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem('missionConsoleApprovalDecisionState');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') setMissionApprovalDecisionState({
        selectedDecision: parsed.selectedDecision || 'hold',
        timestamp: parsed.timestamp || '',
        sourceQueueItemId: parsed.sourceQueueItemId || '',
      });
    } catch {}
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('missionConsoleApprovalDecisionState', JSON.stringify(missionApprovalDecisionState));
  }, [missionApprovalDecisionState]);

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
    const judge = adjudicateMissionVerificationJudge({
      missionSpec: intentToBuild?.missionSpec || {},
      verificationReturnText: verificationReturnInput,
    });
    const lessonCandidates = deriveVerificationReturnLessonCandidates({
      verificationReturnText: verificationReturnInput,
      missionSpec: intentToBuild?.missionSpec || {},
      verificationJudge: judge,
    });
    const capabilityCandidate = lessonCandidates.find((candidate) => candidate.memoryCandidateType === 'capability_gap') || null;
    return {
      ...judge,
      lessonCandidates,
      lessonCandidatePending: lessonCandidates.length > 0,
      capabilityGapPending: Boolean(capabilityCandidate),
      skillUpgradeSuggestion: capabilityCandidate ? `This mission suggests a missing capability: ${capabilityCandidate.summary}` : 'none',
      suggestedLessonCandidate: lessonCandidates[0]?.memoryCandidateType || 'mission_history',
      matchesMissionGoal: judge.goalMatched,
      testsClaimedRun: judge.parsed.testsRun.length > 0 ? 'claimed' : 'not-claimed',
      blockers: judge.blockers.join(' | ') || 'none',
      mergeReadiness: judge.mergeReadyCandidate ? 'candidate-ready' : 'pending-review',
    };
  }, [intentToBuild?.missionSpec, verificationReturnInput]);

  const memoryLibrarian = useMemo(() => buildMemoryLibrarianQueue({
    memoryCandidates: intentToBuild?.missionSpec?.missionMemoryCandidate ? [intentToBuild.missionSpec.missionMemoryCandidate] : [],
    verificationLessonCandidates: verificationReturnAdjudication.lessonCandidates || [],
    missionMemoryCandidates: intentToBuild?.missionSpec?.missionMemoryContext?.memories || [],
    existingApprovedMemory: [],
    verificationJudge: verificationReturnAdjudication,
    capabilitySignals: verificationReturnAdjudication.capabilityGapPending ? [{ summary: verificationReturnAdjudication.skillUpgradeSuggestion || 'Capability gap from verification return.' }] : [],
  }), [intentToBuild?.missionSpec?.missionMemoryCandidate, intentToBuild?.missionSpec?.missionMemoryContext?.memories, verificationReturnAdjudication]);

  const missionEvidenceLedger = useMemo(() => buildMissionEvidenceLedger({
    missionSpec: intentToBuild?.missionSpec || {},
    prEvidenceConnector: prEvidenceParseResult || null,
    verificationReturnText: verificationReturnInput,
    verificationJudge: verificationReturnAdjudication,
    taskFinisherPlan: intentToBuild?.missionSpec?.taskFinisherPlan || null,
    memoryLibrarianQueue: memoryLibrarian,
  }), [intentToBuild?.missionSpec, memoryLibrarian, prEvidenceParseResult, verificationReturnAdjudication, verificationReturnInput]);

  const operatorReliefProjection = useMemo(() => {
    recordPerfCounter('projection', 'operatorReliefProjection');
    return deriveOperatorReliefProjection({
    intentToBuildModel: intentToBuild,
    taskFinisherModel: intentToBuild?.missionSpec?.taskFinisherPlan || {},
    missionEvidenceLedgerModel: missionEvidenceLedger || {},
    prEvidenceModel: intentToBuild?.missionSpec?.prEvidenceIntake || {},
    proofOfDoneModel: { verificationJudge: verificationReturnAdjudication, browserChecksObserved: verificationReturnAdjudication?.parsed?.proofClaim ? ['tile opens'] : [], consoleErrors: verificationReturnAdjudication?.parsed?.hasFailure ? ['Verification return reports failure/error.'] : [] },
    operatorDecisionQueue: intentToBuild?.missionSpec?.operatorDecisionConsole || {},
    memoryLibrarianQueue: memoryLibrarian || {},
    supportSnapshot: runtimeStatusModel || {},
    });
  }, [intentToBuild, missionEvidenceLedger, verificationReturnAdjudication, memoryLibrarian, runtimeStatusModel]);

  useEffect(() => {
    const verdict = operatorReliefProjection?.mergeSafety?.verdict;
    if (!verdict) return;

    const status = operatorReliefProjection?.status || 'unknown';
    const repairPromptAvailable = operatorReliefProjection?.repairPrompt?.available === true;
    const hasLessonCandidates = (operatorReliefProjection?.lessonCandidates || []).length > 0;
    const presenceSignature = `${status}|${verdict}|${repairPromptAvailable ? 'repair' : 'no-repair'}|${hasLessonCandidates ? 'lessons' : 'no-lessons'}`;
    if (operatorReliefPresenceSignatureRef.current === presenceSignature) {
      return;
    }
    operatorReliefPresenceSignatureRef.current = presenceSignature;

    const summary = verdict === 'safe-to-merge'
      ? 'Build and verify passed. Operator browser smoke test remains.'
      : verdict === 'needs-browser-proof'
        ? 'This PR is not merge-safe yet because browser proof is missing.'
        : 'A repair prompt is available from console error evidence.';
    recordPerfCounter('events', 'presence.operator_relief');
    emitPresenceEvent({ kind: `operator_relief.${status === 'merge-candidate' ? 'merge_candidate' : status === 'blocked' ? 'blocked' : 'ready'}`, summary, impact: operatorReliefProjection?.missionTitle || 'Operator Relief update.' });
    if (verdict === 'needs-browser-proof') emitPresenceEvent({ kind: 'operator_relief.browser_proof_missing', summary: 'Browser proof missing. Run UI smoke test before merge.' });
    if (repairPromptAvailable) emitPresenceEvent({ kind: 'operator_relief.repair_prompt_available', summary: 'A repair prompt is available from mission evidence.' });
    if (hasLessonCandidates) emitPresenceEvent({ kind: 'operator_relief.lesson_candidate_available', summary: 'I found a project lesson candidate from this failure.' });
  }, [operatorReliefProjection]);
  const missionCommandPacket = useMemo(() => buildMissionCommandPacket({
    missionSpec: intentToBuild?.missionSpec || {},
    codexPrompt: intentToBuild?.codexPrompt || '',
    missionEvidenceLedger,
    operatorDecisionConsole: intentToBuild?.missionSpec?.operatorDecisionConsole || {},
    verificationJudge: verificationReturnAdjudication,
    taskFinisherPlan: intentToBuild?.missionSpec?.taskFinisherPlan || {},
    memoryLibrarianQueue: memoryLibrarian,
    prEvidenceIntake: intentToBuild?.missionSpec?.prEvidenceIntake || {},
    openClawDelegation: intentToBuild?.missionSpec?.openClawDelegation || {},
    finishAuthority: intentToBuild?.missionSpec?.finishAuthority || {},
    repoArchitectureContext: intentToBuild?.missionSpec?.repoArchitectureContext || {},
    agentAssignmentMatrix: buildAgentAssignmentMatrix({
      missionSpec: intentToBuild?.missionSpec || {},
      missionCommandPacket: {},
      operatorDecisionConsole: intentToBuild?.missionSpec?.operatorDecisionConsole || {},
      taskFinisherPlan: intentToBuild?.missionSpec?.taskFinisherPlan || {},
      verificationJudge: verificationReturnAdjudication,
      memoryLibrarianQueue: memoryLibrarian,
      repoArchitectureContext: intentToBuild?.missionSpec?.repoArchitectureContext || {},
      openClawDelegation: intentToBuild?.missionSpec?.openClawDelegation || {},
      prEvidenceIntake: intentToBuild?.missionSpec?.prEvidenceIntake || {},
    }),
  }), [intentToBuild?.missionSpec, intentToBuild?.codexPrompt, memoryLibrarian, missionEvidenceLedger, verificationReturnAdjudication]);
  const agentAssignmentMatrix = useMemo(() => buildAgentAssignmentMatrix({
    missionCommandPacket,
    missionSpec: intentToBuild?.missionSpec || {},
    operatorDecisionConsole: intentToBuild?.missionSpec?.operatorDecisionConsole || {},
    taskFinisherPlan: intentToBuild?.missionSpec?.taskFinisherPlan || {},
    verificationJudge: verificationReturnAdjudication,
    memoryLibrarianQueue: memoryLibrarian,
    repoArchitectureContext: intentToBuild?.missionSpec?.repoArchitectureContext || {},
    openClawDelegation: intentToBuild?.missionSpec?.openClawDelegation || {},
    prEvidenceIntake: intentToBuild?.missionSpec?.prEvidenceIntake || {},
  }), [intentToBuild?.missionSpec, memoryLibrarian, missionCommandPacket, verificationReturnAdjudication]);

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
    const signature = JSON.stringify({
      sessionState: openClawIntegration?.sessionState || '',
      currentActivity: openClawIntegration?.currentActivity || '',
      readiness: openClawIntegration?.readiness || '',
      approvalRequired: openClawIntegration?.approvalRequired === true,
      warnings: Array.isArray(openClawIntegration?.warnings) ? openClawIntegration.warnings.join('|') : '',
      sandboxStatus: openClawIntegration?.sandboxStatus || '',
    });
    if (openClawIntegrationSignatureRef.current === signature) return;
    openClawIntegrationSignatureRef.current = signature;
    onOpenClawIntegrationUpdate(openClawIntegration);
  }, [onOpenClawIntegrationUpdate, openClawIntegration]);
  const missionRoutingReadiness = useMemo(() => buildMissionRoutingReadiness({
    missionSpec: intentToBuild?.missionSpec || {},
    missionCommandPacket,
    agentAssignmentMatrix,
    operatorDecisionConsole: intentToBuild?.missionSpec?.operatorDecisionConsole || {},
    missionEvidenceLedger,
    verificationJudge: verificationReturnAdjudication,
    taskFinisherPlan: intentToBuild?.missionSpec?.taskFinisherPlan || {},
    memoryLibrarianQueue: memoryLibrarian,
    prEvidenceIntake: intentToBuild?.missionSpec?.prEvidenceIntake || {},
    openClawDelegation: intentToBuild?.missionSpec?.openClawDelegation || {},
    finishAuthority: intentToBuild?.missionSpec?.finishAuthority || {},
  }), [agentAssignmentMatrix, intentToBuild?.missionSpec, memoryLibrarian, missionCommandPacket, missionEvidenceLedger, verificationReturnAdjudication]);

  const intentToBuildUpdateProjection = useMemo(() => {
    const missionSpec = intentToBuild?.missionSpec || {};
    return {
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
      taskFinisherPlanStatus: intentToBuild?.missionSpec?.taskFinisherPlan?.finishPlanStatus || 'unknown',
      taskFinisherSafeToContinue: intentToBuild?.missionSpec?.taskFinisherPlan?.safeToContinueRoutineFinish ? 'yes' : 'no',
      taskFinisherRoutineTaskCount: String(intentToBuild?.missionSpec?.taskFinisherPlan?.routineTasks?.length || 0),
      taskFinisherBlockedTaskCount: String(intentToBuild?.missionSpec?.taskFinisherPlan?.blockedTasks?.length || 0),
      taskFinisherCodexRepairNeeded: intentToBuild?.missionSpec?.taskFinisherPlan?.codexRepairNeeded ? 'yes' : 'no',
      taskFinisherRebuildDistNeeded: intentToBuild?.missionSpec?.taskFinisherPlan?.rebuildDistNeeded ? 'yes' : 'no',
      taskFinisherMemoryReviewNeeded: intentToBuild?.missionSpec?.taskFinisherPlan?.memoryReviewNeeded ? 'yes' : 'no',
      taskFinisherMergeOperatorControlled: intentToBuild?.missionSpec?.taskFinisherPlan?.mergeStillOperatorControlled ? 'yes' : 'no',
      taskFinisherWarningLevel: intentToBuild?.missionSpec?.taskFinisherPlan?.warningLevel || 'none',
      taskFinisherNextAction: intentToBuild?.missionSpec?.taskFinisherPlan?.nextAction || 'not reported',
      repoArchitectureAffectedSubsystemCount: String(intentToBuild?.missionSpec?.repoArchitectureContext?.affectedSubsystems?.length || 0),
      repoArchitectureAffectedSubsystems: (intentToBuild?.missionSpec?.repoArchitectureContext?.affectedSubsystems || []).join('|') || 'none',
      repoArchitectureLikelyTestCount: String(intentToBuild?.missionSpec?.repoArchitectureContext?.testsLikelyRequired?.length || 0),
      repoArchitectureGeneratedOutputTouched: (intentToBuild?.missionSpec?.repoArchitectureContext?.generatedOutputsLikelyTouched || []).length > 0 ? 'yes' : 'no',
      repoArchitectureSourceTruthWarning: (intentToBuild?.missionSpec?.repoArchitectureContext?.sourceTruthWarnings || [])[1] || 'none',
      repoArchitectureRiskLevel: (intentToBuild?.missionSpec?.repoArchitectureContext?.riskSummary || []).join('|') || 'none',
      prEvidenceInputDetected: prEvidenceInput.trim() ? 'yes' : 'no',
      prEvidenceParseConfidence: prEvidenceParseResult?.parseConfidence || 'none',
      prEvidenceParsedPrNumber: String(prEvidenceParseResult?.detectedPrNumber || 'n/a'),
      prEvidenceParsedRepo: prEvidenceParseResult?.detectedRepo || 'unknown',
      prEvidenceParseWarningCount: String(prEvidenceParseResult?.parseWarnings?.length || 0),
      prEvidenceConnectorSource: prEvidenceParseResult?.evidenceSource || 'none',
      missionVerificationJudgment: verificationReturnAdjudication.judgment || 'no_return',
      missionVerificationReadinessLevel: verificationReturnAdjudication.readinessLevel || 'not_ready',
      missionVerificationMergeReadyCandidate: verificationReturnAdjudication.mergeReadyCandidate ? 'yes' : 'no',
      missionVerificationBlockerCount: String((verificationReturnAdjudication.blockers || []).length || 0),
      missionVerificationWarningCount: String((verificationReturnAdjudication.warnings || []).length || 0),
      missionVerificationProofStatus: verificationReturnAdjudication.proofOfDoneStatus || 'pending',
      missionVerificationChangedFilesInScope: verificationReturnAdjudication.changedFilesInScope ? 'yes' : 'no',
      missionVerificationRequiredTestsRun: verificationReturnAdjudication.requiredTestsRun ? 'yes' : 'no',
      prEvidenceStatus: intentToBuild?.missionSpec?.prEvidenceIntake?.normalizedStatus || 'no_pr_evidence',
      prEvidenceNumber: String(intentToBuild?.missionSpec?.prEvidenceIntake?.prNumber || 'n/a'),
      prEvidenceChecksStatus: intentToBuild?.missionSpec?.prEvidenceIntake?.checksStatus || 'unknown',
      prEvidenceMerged: intentToBuild?.missionSpec?.prEvidenceIntake?.merged ? 'yes' : 'no',
      prEvidenceMergedBy: intentToBuild?.missionSpec?.prEvidenceIntake?.mergedBy || 'unknown',
      prEvidenceAutoMergeState: intentToBuild?.missionSpec?.prEvidenceIntake?.autoMergeState || 'unknown',
      prEvidenceChangedFileCount: String(intentToBuild?.missionSpec?.prEvidenceIntake?.changedFileCount || 0),
      prEvidenceWarningCount: String((intentToBuild?.missionSpec?.prEvidenceIntake?.evidenceWarnings || []).length || 0),
      prEvidenceCodexTaskPresent: (intentToBuild?.missionSpec?.prEvidenceIntake?.codexTaskUrl || intentToBuild?.missionSpec?.prEvidenceIntake?.codexTaskId) ? 'yes' : 'no',
      memoryLibrarianPendingCount: String(memoryLibrarian.counts.pending || 0),
      memoryLibrarianApprovalRequiredCount: String(memoryLibrarian.counts.approvalRequired || 0),
      memoryLibrarianCanonCandidateCount: String(memoryLibrarian.counts.canonCandidates || 0),
      memoryLibrarianProjectLessonCount: String(memoryLibrarian.counts.projectLessons || 0),
      memoryLibrarianCapabilityGapCount: String(memoryLibrarian.counts.capabilityGaps || 0),
      memoryLibrarianDuplicateCount: String(memoryLibrarian.counts.duplicates || 0),
      memoryLibrarianConflictCount: String(memoryLibrarian.counts.conflicts || 0),
      memoryLibrarianSavedCount: String(memoryLibrarian.counts.saved || 0),
      memoryLibrarianRejectedCount: String(memoryLibrarian.counts.rejected || 0),
      missionEvidenceLedgerEntryCount: String(missionEvidenceLedger.summary.ledgerEntryCount || 0),
      missionEvidenceLedgerWarningCount: String(missionEvidenceLedger.summary.warningCount || 0),
      missionEvidenceLedgerBlockerCount: String(missionEvidenceLedger.summary.blockerCount || 0),
      missionEvidenceLedgerPendingReviewCount: String(missionEvidenceLedger.summary.pendingOperatorReviewCount || 0),
      missionEvidenceCompleteness: missionEvidenceLedger.summary.evidenceCompleteness || 'low',
      missionEvidenceLatestEvent: missionEvidenceLedger.summary.latestEventType || 'none',
      missionEvidenceNextRequired: missionEvidenceLedger.summary.nextRequiredEvidence || 'none',
      agentAssignmentCount: String(agentAssignmentMatrix.summary.assignmentCount || 0),
      agentAssignmentActiveRoles: String(agentAssignmentMatrix.summary.activeRoleCount || 0),
      agentAssignmentLeadRole: agentAssignmentMatrix.summary.recommendedLeadRole || 'operator',
      agentAssignmentOpenClawAssigned: agentAssignmentMatrix.summary.openClawAssigned ? 'yes' : 'no',
      agentAssignmentCodexAssigned: agentAssignmentMatrix.summary.codexAssigned ? 'yes' : 'no',
      agentAssignmentOperatorApprovalRequired: agentAssignmentMatrix.summary.operatorApprovalRequired ? 'yes' : 'no',
      agentAssignmentHighRiskCount: String(agentAssignmentMatrix.summary.highRiskAssignmentCount || 0),
      agentAssignmentBlockedCount: String(agentAssignmentMatrix.summary.blockedAssignmentCount || 0),
      missionRoutingStatus: missionRoutingReadiness.routeStatus || 'draft',
      missionRoutingRecommendedRoute: missionRoutingReadiness.recommendedRoute || 'operator_decision',
      missionRoutingReadinessLevel: missionRoutingReadiness.readinessLevel || 'not_ready',
      missionRoutingLeadRole: missionRoutingReadiness.assignedLeadRole || 'operator',
      missionRoutingCodexReady: missionRoutingReadiness.codexReady ? 'yes' : 'no',
      missionRoutingOpenClawResearchReady: missionRoutingReadiness.openClawResearchReady ? 'yes' : 'no',
      missionRoutingOperatorDecisionRequired: missionRoutingReadiness.operatorDecisionRequired ? 'yes' : 'no',
      missionRoutingBlockerCount: String((missionRoutingReadiness.blockers || []).length || 0),
      missionRoutingWarningCount: String((missionRoutingReadiness.warnings || []).length || 0),
      missionRoutingNextAction: missionRoutingReadiness.nextAction || 'Await operator decision.',
    };
  }, [agentAssignmentMatrix.summary, intentToBuild, memoryLibrarian.counts, missionEvidenceLedger.summary, verificationReturnAdjudication.capabilityGapPending, verificationReturnAdjudication.lessonCandidatePending, missionRoutingReadiness]);
  useEffect(() => {
    const signature = [
      intentToBuildUpdateProjection.latestMissionId,
      intentToBuildUpdateProjection.missionStatus,
      intentToBuildUpdateProjection.verificationStatus,
      intentToBuildUpdateProjection.missionVerificationJudgment,
      intentToBuildUpdateProjection.missionVerificationReadinessLevel,
      intentToBuildUpdateProjection.missionRoutingReadinessLevel,
      intentToBuildUpdateProjection.memoryLibrarianPendingCount,
      intentToBuildUpdateProjection.missionEvidenceLedgerEntryCount,
    ].join('|');
    if (intentUpdateSignatureRef.current === signature) return;
    intentUpdateSignatureRef.current = signature;
    onIntentToBuildUpdate(intentToBuildUpdateProjection);
  }, [intentToBuildUpdateProjection, onIntentToBuildUpdate]);
  useEffect(() => {
    const signature = JSON.stringify({
      state: missionBridgeState?.state || '',
      pendingApproval: missionBridgeState?.pendingApproval === true,
      nextRecommendedAction: missionBridgeState?.nextRecommendedAction || '',
      missionPacketId: missionBridgeState?.missionPacket?.missionId || '',
      eventsCount: Array.isArray(missionBridgeState?.events) ? missionBridgeState.events.length : 0,
    });
    if (missionBridgeSignatureRef.current === signature) return;
    missionBridgeSignatureRef.current = signature;
    onMissionBridgeUpdate(missionBridgeState);
  }, [missionBridgeState, onMissionBridgeUpdate]);

  function addMessage(message) {
    setMessages((previous) => appendMissionConsoleMessage(previous, message));
  }

  const musicTileContext = useMemo(() => {
    if (typeof window === 'undefined') return null;
    try {
      const saved = JSON.parse(window.localStorage.getItem('stephanos.musicTile.state.v2') || '{}');
      const contextBundle = buildMissionConsoleContext({
        targetTile: 'music',
        payloadByTile: { music: { state: saved } },
      });
      return contextBundle.contexts[0] || null;
    } catch {
      return null;
    }
  }, [runtimeStatusModel?.musicContextRevision]);

  function buildStephanosResponse(content) {
    const normalizedPrompt = String(content || '').trim();
    if (/music tile|taste dna|spotify|verified|search leads|hallucinated|build journey|listen to next/i.test(normalizedPrompt) && musicTileContext) {
      return `${musicTileContext.plainEnglishSummary} Verified: ${musicTileContext.verification.verified}; search-only: ${musicTileContext.verification.searchOnly}; hallucinated: ${musicTileContext.verification.hallucinated}. Recommended next: ${(musicTileContext.recommendedNextActions || []).slice(0, 2).join(' ')}`;
    }
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
  const executionReadiness = useMemo(() => {
    const chatInputReady = typeof setSharedConsoleInput === 'function';
    const submitRouteReady = typeof submitPrompt === 'function';
    const answerPaneReady = Array.isArray(sharedCommandHistory);
    const aiRouteStatus = finalRouteTruth?.routeUsableState || 'unknown';
    const aiRouteReady = aiRouteStatus === 'ready' || aiRouteStatus === 'degraded';
    const musicContextAvailable = Boolean(musicTileContext);
    return {
      chatInputReady,
      submitRouteReady,
      answerPaneReady,
      aiRouteStatus: aiRouteReady ? aiRouteStatus : 'unavailable',
      musicContextAvailable,
      ready: chatInputReady && submitRouteReady && answerPaneReady && aiRouteReady,
    };
  }, [setSharedConsoleInput, submitPrompt, sharedCommandHistory, finalRouteTruth?.routeUsableState, musicTileContext]);

  function generateIntentToBuildSpec() {
    const parsedEvidence = buildPrEvidenceFromInput({
      rawPrInput: prEvidenceInput,
      missionSpec: {
        finishAuthority: {},
        repoArchitectureContext: {},
      },
    });
    setPrEvidenceParseResult(parsedEvidence.parseResult);
    const next = createIntentToBuildState({
      ...intentInput,
      memoryContext: missionMemoryContext,
      prMetadata: parsedEvidence.parseResult.normalizedPrMetadata,
    });
    setIntentToBuild(next);
  }

  function handleParsePrEvidence() {
    const parsedEvidence = parsePrEvidenceInput(prEvidenceInput);
    setPrEvidenceParseResult(parsedEvidence);
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

  async function copyToClipboard(text, setCopyState, copySource = 'MissionConsoleTile.copy') {
    const result = await writeTextToClipboard(text, { navigatorObject: typeof navigator !== 'undefined' ? navigator : null });
    setCopyState(result.ok ? COPY_STATE.SUCCESS : COPY_STATE.FAILURE);
    recordCopyFeedbackEvent({
      source: copySource,
      success: result.ok === true,
      visualState: result.ok ? 'success' : 'failure',
      greenConfirmed: result.ok === true,
      payloadKind: 'missionConsole',
      reason: result.reason || 'unknown',
      method: result.method || 'unknown',
    });
  }

  async function copyPerfDiagnostics() {
    const result = await copyPerfDiagnosticsSnapshot();
    if (result?.copied) {
      setPerfCopyState(COPY_STATE.SUCCESS);
      return;
    }
    const fallback = await writeTextToClipboard(result?.text || '', { navigatorObject: typeof navigator !== 'undefined' ? navigator : null });
    setPerfCopyState(fallback.ok ? COPY_STATE.SUCCESS : COPY_STATE.FAILURE);
  }

  const missionConsolePanelOpen = forcePanelOpen ? true : uiLayout[panelId] !== false;
  const dispatchPanelToggle = (panelId) => togglePanel(panelId, 'MissionConsoleTile');
  const missionBrainPanelOpen = uiLayout.missionConsoleMissionBrainPanel !== false;
  const operatorReliefSummaryPanelOpen = uiLayout.missionConsoleOperatorReliefSummaryPanel !== false;
  const evidenceGapsPanelOpen = (operatorReliefProjection.evidenceGaps || []).length > 0
    ? uiLayout.missionConsoleEvidenceGapsPanel !== false
    : uiLayout.missionConsoleEvidenceGapsPanel === true;
  const nextCodexPromptPanelOpen = uiLayout.missionConsoleNextCodexPromptPanel === true;
  const workRoutingPanelOpen = uiLayout.missionConsoleWorkRoutingCandidatePanel !== false;
  const workRoutingPayloadOpen = uiLayout.missionConsoleWorkRoutingPacketPreviewPanel === true;
  const verificationReturnPanelOpen = uiLayout.missionConsoleVerificationReturnIntakePanel !== false;
  const verificationReturnPayloadOpen = uiLayout.missionConsoleVerificationReturnPayloadPanel === true;
  const supportSnapshotPanelOpen = uiLayout.missionConsoleSupportSnapshotPanel === true;
  const repairPromptPanelOpen = uiLayout.missionConsoleRepairPromptPanel === true;
  const missionHandoffPanelOpen = uiLayout.missionConsoleMissionHandoffPanel === true;
  const updatePaneDiagnostics = (patch = {}) => {
    if (typeof window === 'undefined') return;
    const snapshot = window.__STEPHANOS_PANE_DIAGNOSTICS__ || {};
    const existingAgentMissionConsole = snapshot.agentMissionConsole || {};
    window.__STEPHANOS_PANE_DIAGNOSTICS__ = {
      ...snapshot,
      agentMissionConsole: {
        ...existingAgentMissionConsole,
        ...patch,
      },
    };
  };

  useEffect(() => {
    if (panelId !== 'missionConsolePanel') return;
    updatePaneDiagnostics({
      actualPanelId: panelId,
      forcePanelOpen: Boolean(forcePanelOpen),
      isOpenFromUiLayout: uiLayout?.[panelId] !== false,
      renderedOpenState: missionConsolePanelOpen,
      togglePanelKey: panelId,
      visibleChevronLayer: 'MissionConsoleTile.CollapsiblePanel.header',
      visibleContentLayer: 'MissionConsoleTile.CollapsiblePanel.body',
      missionConsolePaneCount: 6,
      collapsibleSectionIds: [
        'missionConsoleOperatorOverviewPanel',
        'missionConsoleRuntimeRouteStatusPanel',
        'missionConsoleOperatorReliefPanel',
        'missionConsoleIntentToBuildPanel',
        'missionConsoleSecondaryDiagnosticsPanel',
        'missionConsoleConnectedTileContextsPanel',
      ],
      collapsibleSectionStates: {
        missionConsoleMissionBrainPanel: missionBrainPanelOpen,
        missionConsoleOperatorReliefSummaryPanel: operatorReliefSummaryPanelOpen,
        missionConsoleEvidenceGapsPanel: evidenceGapsPanelOpen,
        missionConsoleNextCodexPromptPanel: nextCodexPromptPanelOpen,
        missionConsoleSupportSnapshotPanel: supportSnapshotPanelOpen,
      },
    });
  }, [evidenceGapsPanelOpen, forcePanelOpen, missionBrainPanelOpen, missionConsolePanelOpen, nextCodexPromptPanelOpen, operatorReliefSummaryPanelOpen, panelId, supportSnapshotPanelOpen, uiLayout]);

  const handleMissionConsolePanelToggle = () => {
    if (forcePanelOpen) {
      updatePaneDiagnostics({
        actualPanelId: panelId,
        forcePanelOpen: Boolean(forcePanelOpen),
        renderedOpenState: missionConsolePanelOpen,
        lastToggleEvent: {
          panelId,
          source: 'MissionConsoleTile.handleMissionConsolePanelToggle',
          blockedByForcePanelOpen: true,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    const nextOpen = uiLayout?.[panelId] === false;
    updatePaneDiagnostics({
      actualPanelId: panelId,
      forcePanelOpen: Boolean(forcePanelOpen),
      isOpenFromUiLayout: uiLayout?.[panelId] !== false,
      renderedOpenState: missionConsolePanelOpen,
      togglePanelKey: panelId,
      lastToggleEvent: {
        panelId,
        source: 'MissionConsoleTile.handleMissionConsolePanelToggle',
        blockedByForcePanelOpen: false,
        nextOpen,
        timestamp: new Date().toISOString(),
      },
    });
    dispatchPanelToggle(panelId);
  };

  return (
    <CollapsiblePanel
      panelId={panelId}
      title={panelTitle}
      description="Mission Router workspace for agent mission packets, target routing, and bounded OpenClaw interaction."
      className="pane-span-2 mission-console-workspace mission-console-workspace-wide stephanos-workspace-surface stephanos-workspace-surface--mission"
      isOpen={missionConsolePanelOpen}
      onToggle={handleMissionConsolePanelToggle}
      testIdBase="pane-agent-mission-console"
    >
      <div data-testid="mission-console-inner-command-deck">
      <MissionCommandDeck
        missionRoutingReadiness={missionRoutingReadiness}
        agentAssignmentMatrix={agentAssignmentMatrix}
        codexPrRepairContract={missionCommandPacket?.codexPrRepairContract || intentToBuild?.missionSpec?.codexPrRepairContract}
        missionCommandPacket={missionCommandPacket}
        supportSnapshot={runtimeStatusModel?.realityUpgradeOrchestrator?.supportSnapshot || {}}
        missionEvidenceLedger={missionEvidenceLedger}
        memoryLibrarian={memoryLibrarian}
        operatorDecisionConsole={intentToBuild.missionSpec.operatorDecisionConsole || {}}
        openClawDelegation={intentToBuild.missionSpec.openClawDelegation || {}}
        verificationJudge={verificationReturnAdjudication}
        finalRouteTruth={finalRouteTruth}
        runtimeStatusModel={runtimeStatusModel}
        compactVerificationSummary={compactVerificationSummary}
      />
      </div>
      <section className="mission-console-section mission-console-section--operator-overview">
        <CollapsiblePanel
          panelId="missionConsoleOperatorOverviewPanel"
          title="Operator Overview"
          isOpen={uiLayout.missionConsoleOperatorOverviewPanel !== false}
          onToggle={() => dispatchPanelToggle('missionConsoleOperatorOverviewPanel')}
        >
          <ul className="mission-console__status-list">
            <li><strong>Workspace / mode:</strong> Agent Mission Console · {sessionMode}</li>
            <li><strong>Stephanos readiness:</strong> {executionReadiness.ready ? 'ready' : 'not-ready'} ({compactVerificationSummary.verificationReturnStatus})</li>
            <li><strong>Route / provider:</strong> {finalRouteTruth?.routeUsableState || 'unknown'} via {finalRouteTruth?.routeKind || 'unknown'} · requested {finalRouteTruth?.providerRequested || 'unknown'} → executed {finalRouteTruth?.providerExecuted || 'unknown'}</li>
            <li><strong>Operator Relief:</strong> {operatorReliefProjection.status || 'unknown'} · merge safety {operatorReliefProjection.mergeSafety?.verdict || 'unknown'} · proof {compactVerificationSummary.realityForgeProofStatus}</li>
            <li><strong>Next action:</strong> {operatorReliefProjection?.nextActions?.[0]?.label || compactVerificationSummary.openClawNextAction || 'Review Operator Relief next actions.'}</li>
            <li><strong>Primary control:</strong> Use Assistant Command Console below to submit the next mission command.</li>
          </ul>
        </CollapsiblePanel>
      </section>
      <section className="mission-console-section mission-console-section--status-strip">
        <CollapsiblePanel
          panelId="missionConsoleRuntimeRouteStatusPanel"
          title="Runtime + Route Status"
          isOpen={uiLayout.missionConsoleRuntimeRouteStatusPanel !== false}
          onToggle={() => dispatchPanelToggle('missionConsoleRuntimeRouteStatusPanel')}
        >
          <ul className="mission-console__status-list">
            <li><strong>Opened route:</strong> mission-console</li>
            <li><strong>Canonical route:</strong> mission-console</li>
            <li><strong>Execution readiness:</strong> {executionReadiness.ready ? 'true' : 'false'}</li>
            <li><strong>Route status:</strong> {finalRouteTruth?.routeUsableState || 'unknown'} / {finalRouteTruth?.routeKind || 'unknown'}</li>
            <li><strong>Provider chain:</strong> requested {finalRouteTruth?.providerRequested || 'unknown'} → selected {finalRouteTruth?.providerSelected || 'unknown'} → executed {finalRouteTruth?.providerExecuted || 'unknown'}</li>
            <li><strong>Addressed target:</strong> {resolvedTarget.label}</li>
            <li><strong>Music context:</strong> {executionReadiness.musicContextAvailable ? 'available' : 'unavailable'}</li>
          </ul>
        </CollapsiblePanel>
      </section>

      <section className="mission-console-section mission-console-section--operator-relief">
        <CollapsiblePanel
          panelId="missionConsoleOperatorReliefPanel"
          title="Operator Relief v2 · Mission Brain"
          isOpen={uiLayout.missionConsoleOperatorReliefPanel !== false}
          onToggle={() => dispatchPanelToggle('missionConsoleOperatorReliefPanel')}
        >
          <CollapsiblePanel
            panelId="missionConsoleOperatorReliefSummaryPanel"
            title="Operator Relief Summary"
            isOpen={operatorReliefSummaryPanelOpen}
            onToggle={() => dispatchPanelToggle('missionConsoleOperatorReliefSummaryPanel')}
          >
          <h5>Current Mission Summary</h5>
          <ul className="mission-console__status-list">
            <li><strong>Current Mission:</strong> {operatorReliefProjection.missionIntelligenceSummary?.currentMissionSummary || operatorReliefProjection.mission.objective}</li>
            <li><strong>Next Best Action:</strong> {operatorReliefProjection.missionIntelligenceSummary?.nextBestAction || operatorReliefProjection.missionBrainNextAction?.nextBestAction || 'Review mission evidence'}</li>
            <li><strong>Can Codex Help?</strong> {operatorReliefProjection.missionIntelligenceSummary?.codexReady || 'unknown'}</li>
            <li><strong>Can OpenClaw Help?</strong> {operatorReliefProjection.missionIntelligenceSummary?.openClawReady || 'unknown'}</li>
            <li><strong>Operator Decision Needed:</strong> {operatorReliefProjection.missionIntelligenceSummary?.operatorDecisionRequired === false ? 'no' : 'yes'}</li>
          </ul>
          <button type="button" className={`status-panel-copy-button ${missionHandoffCopyState}`} onClick={() => copyToClipboard(JSON.stringify({
            missionIntelligenceSummary: operatorReliefProjection.missionIntelligenceSummary || {},
            harnessContractSummary: {
              harnessVersion: operatorReliefProjection.harnessAgentProjection?.harnessVersion || operatorReliefProjection.harnessVersion || 'v1.2',
              mergeRecommendation: operatorReliefProjection.harnessAgentProjection?.mergeRecommendation || 'unknown',
            },
            nextAction: operatorReliefProjection.missionIntelligenceSummary?.nextBestAction || operatorReliefProjection.nextBestAction?.label || 'Review mission evidence',
            allowedScopes: operatorReliefProjection.harnessAgentProjection?.allowedFileScopes || [],
            forbiddenScopes: operatorReliefProjection.harnessAgentProjection?.forbiddenFileScopes || operatorReliefProjection.harnessAgentProjection?.forbiddenFiles || [],
            proofRequirements: operatorReliefProjection.missionIntelligenceSummary?.proofRequiredSummary || 'targeted tests + build/verify + pr-clean',
            currentBlockers: operatorReliefProjection.missionIntelligenceSummary?.currentBlockers || [],
            finalReportRequirements: operatorReliefProjection.harnessAgentProjection?.finalReportRequirements || [],
          }, null, 2), setMissionHandoffCopyState, 'MissionConsoleTile.copyMissionContext')}>
            {missionHandoffCopyState === COPY_STATE.SUCCESS ? 'Mission Context Copied' : missionHandoffCopyState === COPY_STATE.FAILURE ? 'Copy Mission Context failed' : 'Copy Mission Context'}
          </button>
          </CollapsiblePanel>
          <CollapsiblePanel
            panelId="missionConsoleMissionBrainPanel"
            title="Mission Brain / Next Action"
            isOpen={missionBrainPanelOpen}
            onToggle={() => dispatchPanelToggle('missionConsoleMissionBrainPanel')}
          >
          <h5>Mission Brain / Next Action</h5>
          <ul className="mission-console__status-list">
            <li><strong>Current phase:</strong> {operatorReliefProjection.missionBrainNextAction?.currentPhase || 'unknown'}</li>
            <li><strong>Layer status:</strong> {Object.entries(operatorReliefProjection.missionBrainNextAction?.layerStatus || {}).map(([layer, status]) => `L${layer}:${status}`).join(' · ') || 'unknown'}</li>
            <li><strong>Next best action:</strong> {operatorReliefProjection.missionBrainNextAction?.nextBestAction || operatorReliefProjection.nextBestAction?.label || 'Review mission evidence'}</li>
            <li><strong>Evidence gaps count:</strong> {operatorReliefProjection.missionBrainNextAction?.openEvidenceGaps?.length || 0}</li>
            <li><strong>Merge readiness:</strong> {operatorReliefProjection.missionBrainNextAction?.mergeReadiness || 'unknown'}</li>
            <li><strong>Risk level:</strong> {operatorReliefProjection.missionBrainNextAction?.riskLevel || 'unknown'}</li>
          </ul>
          <p><strong>Top 3 Problems / Next Moves</strong></p>
          <ul className="mission-console__status-list">
            {(operatorReliefProjection.topProblemsProjection || []).slice(0, 3).map((problem, index) => (
              <li key={problem.id || `top-problem-${index}`}>
                <strong>{index + 1}. {problem.title}</strong> — {problem.nextBestAction || 'Review mission evidence'}
              </li>
            ))}
          </ul>
          </CollapsiblePanel>
          <CollapsiblePanel
            panelId="missionConsoleHarnessAgentPanel"
            title={`Harness Agent ${operatorReliefProjection.harnessVersion?.toUpperCase?.() || 'V1.2'}`}
            isOpen={uiLayout.missionConsoleHarnessAgentPanel !== false}
            onToggle={() => dispatchPanelToggle('missionConsoleHarnessAgentPanel')}
          >
            <ul className="mission-console__status-list">
              <li><strong>Harness Status:</strong> {operatorReliefProjection.harnessAgentProjection?.harnessStatus || 'unknown'}</li>
              <li><strong>Risk Level:</strong> {operatorReliefProjection.harnessAgentProjection?.harnessStatus === 'blocked-until-proof' ? 'high' : (operatorReliefProjection.missionBrainNextAction?.riskLevel || 'medium')}</li>
              <li><strong>Protected Canon At Risk:</strong> {(operatorReliefProjection.harnessAgentProjection?.protectedCanonAtRisk || []).join(' · ') || 'none'}</li>
              <li><strong>Required Proof:</strong> {operatorReliefProjection.harnessAgentProjection?.browserProofRequired ? 'browser-proof + targeted tests + build/verify + pr-clean' : 'targeted tests + build/verify + pr-clean'}</li>
              <li><strong>Merge Recommendation:</strong> {operatorReliefProjection.harnessAgentProjection?.mergeRecommendation || 'unknown'}</li>
              <li><strong>Next Operator Action:</strong> {operatorReliefProjection.harnessAgentProjection?.nextOperatorAction || 'Review contract and decide.'}</li>
            </ul>
            <button type="button" className={`status-panel-copy-button ${operatorChecklistCopyState}`} onClick={() => copyToClipboard(JSON.stringify({
              missionSummary: operatorReliefProjection.harnessAgentProjection?.currentMissionSummary || '',
              harnessVersion: operatorReliefProjection.harnessAgentProjection?.harnessVersion || operatorReliefProjection.harnessVersion || 'v1.2',
              allowedFiles: operatorReliefProjection.harnessAgentProjection?.allowedFileScopes || [],
              forbiddenFiles: operatorReliefProjection.harnessAgentProjection?.forbiddenFiles || operatorReliefProjection.harnessAgentProjection?.forbiddenFileScopes || [],
              protectedCanonClauses: operatorReliefProjection.harnessAgentProjection?.protectedCanonClauses || [],
              riskLevel: operatorReliefProjection.harnessAgentProjection?.harnessStatus === 'blocked-until-proof' ? 'high' : (operatorReliefProjection.missionBrainNextAction?.riskLevel || 'medium'),
              affectedSubsystems: operatorReliefProjection.harnessAgentProjection?.protectedSubsystems || [],
              protectedCanonWarning: operatorReliefProjection.harnessAgentProjection?.protectedCanonWarning || '',
              requiredTests: operatorReliefProjection.harnessAgentProjection?.requiredTests || [],
              definitionOfDone: operatorReliefProjection.harnessAgentProjection?.definitionOfDone || ['Preserve canon/truth boundaries and proof.'],
              finalReportRequirements: operatorReliefProjection.harnessAgentProjection?.finalReportRequirements || ['audit findings', 'files changed', 'tests'],
            }, null, 2), setOperatorChecklistCopyState, 'MissionConsoleTile.copyHarnessContract')}>
              {operatorChecklistCopyState === COPY_STATE.SUCCESS ? 'Harness Contract Copied' : operatorChecklistCopyState === COPY_STATE.FAILURE ? 'Copy Harness Contract failed' : 'Copy Harness Contract'}
            </button>
          </CollapsiblePanel>
          <CollapsiblePanel
            panelId="missionConsoleNextCodexPromptPanel"
            title="Next Codex Prompt Candidate"
            isOpen={nextCodexPromptPanelOpen}
            onToggle={() => dispatchPanelToggle('missionConsoleNextCodexPromptPanel')}
          >
          <button type="button" className={`status-panel-copy-button ${nextCodexPromptCopyState}`} onClick={() => copyToClipboard(operatorReliefProjection.missionBrainNextAction?.codexPromptCandidate || '', setNextCodexPromptCopyState, 'MissionConsoleTile.copyNextCodexPrompt')}>
            {nextCodexPromptCopyState === COPY_STATE.SUCCESS ? 'Next Codex Prompt Copied' : nextCodexPromptCopyState === COPY_STATE.FAILURE ? 'Copy Next Codex Prompt failed' : 'Copy Next Codex Prompt'}
          </button>
          </CollapsiblePanel>
          <CollapsiblePanel
            panelId="missionConsoleWorkRoutingCandidatePanel"
            title="Work Routing Candidate"
            isOpen={workRoutingPanelOpen}
            onToggle={() => dispatchPanelToggle('missionConsoleWorkRoutingCandidatePanel')}
          >
            <ul className="mission-console__status-list">
              <li><strong>Recommended Worker:</strong> {operatorReliefProjection.agentWorkRoutingProjection?.recommendedRoute || 'unknown'}</li>
              <li><strong>Why:</strong> {operatorReliefProjection.agentWorkRoutingProjection?.recommendedRouteReason || 'unknown'}</li>
              <li><strong>Risk:</strong> {operatorReliefProjection.agentWorkRoutingProjection?.riskLevel || 'unknown'}</li>
              <li><strong>Operator Approval Needed:</strong> {operatorReliefProjection.agentWorkRoutingProjection?.operatorApprovalRequired || 'yes'}</li>
              <li><strong>Proof required:</strong> {(operatorReliefProjection.agentWorkRoutingProjection?.requiredProof || []).join(' · ') || 'none'}</li>
            </ul>
            <button type="button" className={`status-panel-copy-button ${codexPacketCopyState}`} onClick={() => copyToClipboard(JSON.stringify(operatorReliefProjection.agentWorkRoutingProjection?.copyCodexWorkPacket || {}, null, 2), setCodexPacketCopyState, 'MissionConsoleTile.copyCodexPacket')}>
              {codexPacketCopyState === COPY_STATE.SUCCESS ? 'Codex Work Packet Copied' : codexPacketCopyState === COPY_STATE.FAILURE ? 'Copy Codex Packet failed' : 'Copy Codex Work Packet'}
            </button>
            <button type="button" className={`status-panel-copy-button ${operatorChecklistCopyState}`} onClick={() => copyToClipboard((operatorReliefProjection.agentWorkRoutingProjection?.requiredProof || []).join('\n'), setOperatorChecklistCopyState, 'MissionConsoleTile.copyOperatorChecklist')}>
              {operatorChecklistCopyState === COPY_STATE.SUCCESS ? 'Operator Proof Checklist Copied' : operatorChecklistCopyState === COPY_STATE.FAILURE ? 'Copy Operator Proof Checklist failed' : 'Copy Operator Proof Checklist'}
            </button>
            <CollapsiblePanel panelId="missionConsoleWorkRoutingPacketPreviewPanel" title="Work Routing Packet Payload Preview" isOpen={workRoutingPayloadOpen} onToggle={() => dispatchPanelToggle('missionConsoleWorkRoutingPacketPreviewPanel')}>
              <pre>{JSON.stringify(operatorReliefProjection.agentWorkRoutingProjection?.copyCodexWorkPacket || {}, null, 2)}</pre>
            </CollapsiblePanel>
          </CollapsiblePanel>
          <CollapsiblePanel panelId="missionConsoleCoBuilderLoopPanel" title="Co-Builder Loop V1" isOpen={uiLayout.missionConsoleCoBuilderLoopPanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleCoBuilderLoopPanel')}>
            <ul className="mission-console__status-list">
              <li><strong>Co-Builder Loop Status:</strong> {operatorReliefProjection.coBuilderLoopProjection?.coBuilderStatus || 'inactive'}</li>
              <li><strong>Round:</strong> {operatorReliefProjection.coBuilderLoopProjection?.loopRound || 1} / {operatorReliefProjection.coBuilderLoopProjection?.maxRounds || 3}</li>
              <li><strong>Recommended Next Worker:</strong> {operatorReliefProjection.coBuilderLoopProjection?.recommendedNextWorker || 'hold'}</li>
            </ul>
            <button type="button" className={`status-panel-copy-button ${codexPacketCopyState}`} onClick={() => copyToClipboard(JSON.stringify(operatorReliefProjection.coBuilderLoopProjection?.copyOpenClawResearchPacket || {}, null, 2), setCodexPacketCopyState, 'MissionConsoleTile.copyOpenClawResearchPacket')}>Copy OpenClaw Research Packet</button>
            <button type="button" className={`status-panel-copy-button ${missionHandoffCopyState}`} onClick={() => copyToClipboard(JSON.stringify(operatorReliefProjection.coBuilderLoopProjection?.copyCodexImplementationPacket || {}, null, 2), setMissionHandoffCopyState, 'MissionConsoleTile.copyCodexImplementationPacket')}>Copy Codex Implementation Packet</button>
            <button type="button" className={`status-panel-copy-button ${operatorChecklistCopyState}`} onClick={() => copyToClipboard(JSON.stringify(operatorReliefProjection.coBuilderLoopProjection?.copyVerificationPacket || {}, null, 2), setOperatorChecklistCopyState, 'MissionConsoleTile.copyVerificationPacket')}>Copy Verification Packet</button>
            {operatorReliefProjection.coBuilderLoopProjection?.repairPacketAvailable === 'yes' ? (
              <button type="button" className={`status-panel-copy-button ${repairPromptCopyState}`} onClick={() => copyToClipboard(JSON.stringify(operatorReliefProjection.coBuilderLoopProjection?.copyRepairPacket || {}, null, 2), setRepairPromptCopyState, 'MissionConsoleTile.copyRepairPacket')}>Copy Repair Packet</button>
            ) : null}
          </CollapsiblePanel>
          <CollapsiblePanel panelId="missionConsoleMissionApprovalQueuePanel" title="Mission Approval Queue" isOpen={uiLayout.missionConsoleMissionApprovalQueuePanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleMissionApprovalQueuePanel')}>
            <ul className="mission-console__status-list">
              <li><strong>Top recommended decision:</strong> {operatorReliefProjection.missionApprovalQueue?.topRecommendation?.recommendedDecision || 'hold'}</li>
              <li><strong>Risk level:</strong> {operatorReliefProjection.missionApprovalQueue?.topRecommendation?.riskLevel || 'unknown'}</li>
              <li><strong>Approval required:</strong> {operatorReliefProjection.missionApprovalQueue?.topRecommendation?.approvalRequired ? 'true' : 'false'}</li>
              <li><strong>Blocked reason:</strong> {operatorReliefProjection.missionApprovalQueue?.topRecommendation?.blockedReason || 'none'}</li>
              <li><strong>Required proof before approval:</strong> {(operatorReliefProjection.missionApprovalQueue?.topRecommendation?.requiredProofBeforeApproval || []).join(' · ') || 'none'}</li>
            </ul>
            <button type="button" className={`status-panel-copy-button ${codexPacketCopyState}`} onClick={() => copyToClipboard(operatorReliefProjection.missionApprovalQueue?.topRecommendation?.copyPayload || '', setCodexPacketCopyState, 'MissionConsoleTile.copyMissionApprovalActionPacket')}>{codexPacketCopyState === COPY_STATE.SUCCESS ? 'Action Packet Copied' : codexPacketCopyState === COPY_STATE.FAILURE ? 'Copy Action Packet failed' : 'Copy Action Packet'}</button>
            {operatorReliefProjection.missionApprovalQueue?.topRecommendation?.actionType === 'request-repair' || operatorReliefProjection.verificationReturnIntake?.repairPromptCandidate ? (
              <button type="button" className={`status-panel-copy-button ${repairPromptCopyState}`} onClick={() => copyToClipboard(operatorReliefProjection.verificationReturnIntake?.repairPromptCandidate || operatorReliefProjection.repairPrompt?.prompt || '', setRepairPromptCopyState, 'MissionConsoleTile.copyQueueRepairPrompt')}>{repairPromptCopyState === COPY_STATE.SUCCESS ? 'Repair Prompt Copied' : repairPromptCopyState === COPY_STATE.FAILURE ? 'Copy Repair Prompt failed' : 'Copy Repair Prompt'}</button>
            ) : null}
            <button type="button" className={`status-panel-copy-button ${missionHandoffCopyState}`} onClick={() => copyToClipboard(operatorReliefProjection.missionApprovalQueue?.queue?.find((item) => item.actionType === 'update-handoff')?.copyPayload || '', setMissionHandoffCopyState, 'MissionConsoleTile.copyMissionHandoffUpdate')}>{missionHandoffCopyState === COPY_STATE.SUCCESS ? 'Mission Handoff Update Copied' : missionHandoffCopyState === COPY_STATE.FAILURE ? 'Copy Mission Handoff Update failed' : 'Copy Mission Handoff Update'}</button>
            <p><strong>Selected decision (local):</strong> {missionApprovalDecisionState.selectedDecision} · <strong>timestamp:</strong> {missionApprovalDecisionState.timestamp || 'none'} · <strong>source queue item:</strong> {missionApprovalDecisionState.sourceQueueItemId || 'none'}</p>
            <div className="mission-console__button-row">
              {['approve', 'hold', 'needs-repair'].map((choice) => (
                <button key={choice} type="button" onClick={() => setMissionApprovalDecisionState({ selectedDecision: choice, timestamp: new Date().toISOString(), sourceQueueItemId: operatorReliefProjection.missionApprovalQueue?.topRecommendation?.id || '' })}>
                  {choice}
                </button>
              ))}
            </div>
          </CollapsiblePanel>
          <CollapsiblePanel panelId="missionConsoleVerificationReturnIntakePanel" title="Verification Return Intake" isOpen={verificationReturnPanelOpen} onToggle={() => dispatchPanelToggle('missionConsoleVerificationReturnIntakePanel')}>
            <ul className="mission-console__status-list">
              <li><strong>Return status:</strong> {operatorReliefProjection.verificationReturnIntake?.returnStatus || 'unknown'}</li>
              <li><strong>Merge recommendation:</strong> {operatorReliefProjection.verificationReturnIntake?.mergeRecommendation || 'unknown'}</li>
              <li><strong>Missing evidence count:</strong> {operatorReliefProjection.verificationReturnIntake?.missingEvidence?.length || 0}</li>
              <li><strong>Required operator action:</strong> {operatorReliefProjection.verificationReturnIntake?.requiredOperatorAction || 'unknown'}</li>
            </ul>
            {operatorReliefProjection.verificationReturnIntake?.repairPromptCandidate ? (
              <button type="button" className={`status-panel-copy-button ${repairPromptCopyState}`} onClick={() => copyToClipboard(operatorReliefProjection.verificationReturnIntake?.repairPromptCandidate || '', setRepairPromptCopyState, 'MissionConsoleTile.copyVerificationRepairPrompt')}>
                {repairPromptCopyState === COPY_STATE.SUCCESS ? 'Repair Prompt Copied' : repairPromptCopyState === COPY_STATE.FAILURE ? 'Copy Repair Prompt failed' : 'Copy Repair Prompt'}
              </button>
            ) : null}
            <CollapsiblePanel panelId="missionConsoleVerificationReturnPayloadPanel" title="Verification Intake Payload Preview" isOpen={verificationReturnPayloadOpen} onToggle={() => dispatchPanelToggle('missionConsoleVerificationReturnPayloadPanel')}>
              <pre>{JSON.stringify(operatorReliefProjection.verificationReturnIntake || {}, null, 2)}</pre>
            </CollapsiblePanel>
          </CollapsiblePanel>
          <h5>Codex Change Summary</h5>
          <p><strong>PR:</strong> {operatorReliefProjection.codex.prTitle} · <strong>Branch:</strong> {operatorReliefProjection.codex.branch}</p>
          <p>{operatorReliefProjection.codex.deltaSummary}</p>
          <h5>Tests / Build / Verify Evidence</h5>
          <p>Required tests: {operatorReliefProjection.tests.required.length} · Passed: {operatorReliefProjection.tests.passed} · Failed: {operatorReliefProjection.tests.failed}</p>
          <p>Build: {operatorReliefProjection.tests.buildPassed ? 'passed' : 'not-passed'} · Verify: {operatorReliefProjection.tests.verifyPassed ? 'passed' : 'not-passed'}</p>
          <h5>Browser Proof Checklist</h5>
          <p>Required: {operatorReliefProjection.browserProof.required ? 'yes' : 'no'} · Missing: {operatorReliefProjection.browserProof.missingItems?.length || 0}</p>
          <ul>{(operatorReliefProjection.browserProof.missingItems || []).map((item) => <li key={item}>{item}</li>)}</ul>
          <h5>Runtime Evidence and Warnings</h5>
          <p>Route: {operatorReliefProjection.runtimeEvidence.routeStatus} · Provider: {operatorReliefProjection.runtimeEvidence.providerStatus} · Tile readiness: {operatorReliefProjection.runtimeEvidence.tileStatus}</p>
          <ul>{operatorReliefProjection.runtimeEvidence.warnings.map((warn) => <li key={warn}>{warn}</li>)}</ul>
          <h5>Merge Safety Verdict</h5>
          <p>{operatorReliefProjection.mergeSafety.verdict === 'safe-to-merge' ? 'Merge candidate — operator approval required' : operatorReliefProjection.mergeSafety.verdict}</p>
          <h5>Next Best Action</h5>
          <p><strong>{operatorReliefProjection.nextBestAction?.label || 'Review mission evidence'}</strong> — {operatorReliefProjection.nextBestAction?.reason}</p>
          <h5>Secondary Actions</h5>
          <ul>{operatorReliefProjection.nextActions.slice(1).map((action) => <li key={action.id}>{action.label}: {action.reason}</li>)}</ul>
          <CollapsiblePanel
            panelId="missionConsoleRepairPromptPanel"
            title="Repair Prompt"
            isOpen={repairPromptPanelOpen}
            onToggle={() => dispatchPanelToggle('missionConsoleRepairPromptPanel')}
          >
          <h5>Repair Prompt</h5>
          <button type="button" className={`status-panel-copy-button ${repairPromptCopyState}`} onClick={() => copyToClipboard(operatorReliefProjection.repairPrompt.prompt || '', setRepairPromptCopyState, 'MissionConsoleTile.copyRepairPrompt')}>
            {repairPromptCopyState === COPY_STATE.SUCCESS ? 'Repair Prompt Copied' : repairPromptCopyState === COPY_STATE.FAILURE ? 'Copy Repair Prompt failed' : 'Copy Repair Prompt'}
          </button>
          <button type="button" onClick={() => setShowRepairPromptBody((prev) => !prev)}>
            {showRepairPromptBody ? 'Hide Repair Prompt Body' : 'Show Repair Prompt Body'}
          </button>
          {showRepairPromptBody ? (
            <pre>{operatorReliefProjection.repairPrompt.available ? operatorReliefProjection.repairPrompt.prompt : 'No active repair prompt. Operator Relief will generate one when failures or proof gaps appear.'}</pre>
          ) : null}
          </CollapsiblePanel>
          <h5>Lesson Candidates</h5>
          <ul>{operatorReliefProjection.lessonCandidates.map((candidate) => <li key={candidate.id}>{candidate.title} (approval required)</li>)}</ul>
          <CollapsiblePanel
            panelId="missionConsoleEvidenceGapsPanel"
            title="Evidence Gaps / Proof Requirements"
            isOpen={evidenceGapsPanelOpen}
            onToggle={() => dispatchPanelToggle('missionConsoleEvidenceGapsPanel')}
          >
          <h5>Evidence Gaps</h5>
          <ul>{(operatorReliefProjection.evidenceGaps || []).map((gap) => <li key={gap.id}><strong>{gap.label}</strong>: {gap.reason}</li>)}</ul>
          </CollapsiblePanel>
          <h5>Operator Decision Queue</h5>
          <p>Decision required: {(operatorReliefProjection.operatorDecisionQueue || []).length > 0 ? 'yes' : 'no'}</p>
          <ul>{(operatorReliefProjection.operatorDecisionQueue || []).map((decision) => <li key={decision.id}>{decision.label} — recommended: {decision.recommendedChoice}</li>)}</ul>
          <CollapsiblePanel
            panelId="missionConsoleMissionHandoffPanel"
            title="Mission Handoff Pack"
            isOpen={missionHandoffPanelOpen}
            onToggle={() => dispatchPanelToggle('missionConsoleMissionHandoffPanel')}
          >
          <h5>Mission Handoff Pack</h5>
          <button type="button" className={`status-panel-copy-button ${missionHandoffCopyState}`} data-testid="copy-button-mission-handoff" onClick={() => copyToClipboard(JSON.stringify(operatorReliefProjection.missionHandoff || {}, null, 2), setMissionHandoffCopyState, 'MissionConsoleTile.copyMissionHandoff')}>{missionHandoffCopyState === COPY_STATE.SUCCESS ? 'Mission Handoff Copied' : missionHandoffCopyState === COPY_STATE.FAILURE ? 'Copy Mission Handoff failed' : 'Copy Mission Handoff'}</button>
          <button type="button" onClick={() => setShowMissionHandoffJson((prev) => !prev)}>
            {showMissionHandoffJson ? 'Hide Mission Handoff JSON' : 'Show Mission Handoff JSON'}
          </button>
          {showMissionHandoffJson ? <pre>{JSON.stringify(operatorReliefProjection.missionHandoff || {}, null, 2)}</pre> : null}
          </CollapsiblePanel>
        </CollapsiblePanel>
      </section>

      <section className="mission-console-section mission-console-section--assistant-console">
        <h4>Assistant Command Console</h4>
        <AIConsole
          input={sharedConsoleInput}
          setInput={setSharedConsoleInput}
          submitPrompt={(rawPrompt) => submitPrompt?.(rawPrompt, { orchestrationTruth, submissionSource: 'stephanos-mission-console', submissionRoute: 'assistant-router' })}
          cancelActivePrompt={cancelActivePrompt}
          emergencyReleaseOllamaLoad={emergencyReleaseOllamaLoad}
          commandHistory={sharedCommandHistory}
        />
      </section>

      <section className="mission-console-section mission-console-section--secondary">
        <CollapsiblePanel
          panelId="missionConsoleSecondaryDiagnosticsPanel"
          title="Secondary Diagnostics"
          isOpen={uiLayout.missionConsoleSecondaryDiagnosticsPanel !== false}
          onToggle={() => dispatchPanelToggle('missionConsoleSecondaryDiagnosticsPanel')}
        >
        <h4>Workspace Header / Command Authority</h4>
        <button type="button" onClick={copyPerfDiagnostics}>
          {perfCopyState === COPY_STATE.SUCCESS ? 'Perf Diagnostics Copied' : 'Copy Perf Diagnostics'}
        </button>
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
        </CollapsiblePanel>
      </section>

      <section className="mission-console-section">
        <CollapsiblePanel
          panelId="missionConsoleConnectedTileContextsPanel"
          title="Connected Tile Contexts (advanced)"
          isOpen={uiLayout.missionConsoleConnectedTileContextsPanel !== false}
          onToggle={() => dispatchPanelToggle('missionConsoleConnectedTileContextsPanel')}
        >
          <h4>Connected Tile Contexts</h4>
          <p><strong>Music Tile:</strong> {musicTileContext ? 'available' : 'unavailable'}</p>
          <p><strong>Current artist/vibe:</strong> {musicTileContext?.currentArtistInput || 'not set'} · {musicTileContext?.currentTasteTarget || 'unknown'}</p>
          <p><strong>Counts:</strong> verified {musicTileContext?.verification?.verified || 0} / search {musicTileContext?.verification?.searchOnly || 0} / fallback {musicTileContext?.discoveryPipeline?.fallbackCount || 0}</p>
          <p><strong>Taste DNA:</strong> {(musicTileContext?.tasteDNA?.strongestPositiveTraits || []).slice(0, 3).map((row) => row.name).join(', ') || 'no strong positives yet'}</p>
          <button type="button" onClick={() => setInput('What is happening in the Music Tile right now?')}>Ask about Music Tile</button>
          <button type="button" onClick={() => { if (typeof window !== 'undefined') window.open('../music-tile/index.html', '_blank', 'noopener,noreferrer'); }}>Open Music Tile</button>
        </CollapsiblePanel>
      </section>

      <section className="mission-console-section">
        <h4>Quick Chat Context Selector</h4>
        <select className="paneSelect paneControl" value={contextScope} onChange={(event) => setContextScope(event.target.value)}>
          <option value="whole-stephanos">Whole Stephanos</option>
          <option value="music">Music Tile</option>
          <option value="openclaw">OpenClaw</option>
          <option value="codex">Codex/PRs</option>
          <option value="route-health">Route Health</option>
          <option value="runtime-diagnostics">Runtime Diagnostics</option>
        </select>
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

      <section className="mission-console-section mission-console-section--intent-to-build-loop">
        <CollapsiblePanel
          panelId="missionConsoleIntentToBuildPanel"
          title="Intent-to-Build Control Loop"
          description={`Mission ${intentToBuild.missionSpec.missionId || 'pending'} · status ${intentToBuild.missionSpec.missionStatus || 'draft'} · next ${intentToBuild.missionSpec.nextBestAction || 'generate spec'}`}
          isOpen={uiLayout.missionConsoleIntentToBuildPanel !== false}
          onToggle={() => dispatchPanelToggle('missionConsoleIntentToBuildPanel')}
        >
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
          <li><strong>Task Finisher / Routine Finish Plan:</strong> {intentToBuild.missionSpec.taskFinisherPlan?.finishPlanLevel === 'recommendations_only' ? 'Routine finish: recommendations only' : 'Routine finish: enabled'}</li>
          <li><strong>Safe to Continue Routine Finish:</strong> {intentToBuild.missionSpec.taskFinisherPlan?.safeToContinueRoutineFinish ? 'yes' : 'no'}</li>
          <li><strong>Recommended Routine Tasks:</strong> {(intentToBuild.missionSpec.taskFinisherPlan?.routineTasks || []).join(', ') || 'none'}</li>
          <li><strong>Blocked Tasks:</strong> {(intentToBuild.missionSpec.taskFinisherPlan?.blockedTasks || []).join(', ') || 'none'}</li>
          <li><strong>Required Operator Decisions:</strong> {(intentToBuild.missionSpec.taskFinisherPlan?.requiredOperatorDecisions || []).join(' | ') || 'none'}</li>
          <li><strong>Codex Repair Needed:</strong> {intentToBuild.missionSpec.taskFinisherPlan?.codexRepairNeeded ? 'yes' : 'no'}</li>
          <li><strong>Rebuild / Verify Needed:</strong> {intentToBuild.missionSpec.taskFinisherPlan?.rebuildDistNeeded || intentToBuild.missionSpec.taskFinisherPlan?.rerunTestsNeeded ? 'suggested' : 'not suggested'}</li>
          <li><strong>Memory Review Needed:</strong> {intentToBuild.missionSpec.taskFinisherPlan?.memoryReviewNeeded ? 'yes' : 'no'}</li>
          <li><strong>Merge Still Operator Controlled:</strong> {intentToBuild.missionSpec.taskFinisherPlan?.mergeStillOperatorControlled ? 'yes' : 'no'}</li>
          <li><strong>Next Action:</strong> {intentToBuild.missionSpec.taskFinisherPlan?.nextAction || 'not reported'}</li>
        </ul>

        <h5>Operator Decision Console</h5>
        <ul>
          <li><strong>pending decision count:</strong> {intentToBuild.missionSpec.operatorDecisionConsole?.summary?.pendingDecisionCount ?? 0}</li>
          <li><strong>recommended next decision:</strong> {intentToBuild.missionSpec.operatorDecisionConsole?.summary?.recommendedNextDecision || 'none'}</li>
          <li><strong>approval required count:</strong> {intentToBuild.missionSpec.operatorDecisionConsole?.summary?.approvalRequiredCount ?? 0}</li>
          <li><strong>high-risk count:</strong> {intentToBuild.missionSpec.operatorDecisionConsole?.summary?.highRiskDecisionCount ?? 0}</li>
          <li><strong>blocked count:</strong> {intentToBuild.missionSpec.operatorDecisionConsole?.summary?.blockedDecisionCount ?? 0}</li>
          <li><strong>operator can finish mission:</strong> {intentToBuild.missionSpec.operatorDecisionConsole?.summary?.operatorCanFinishMission ? 'yes' : 'no'}</li>
          <li><strong>merge decision required:</strong> {intentToBuild.missionSpec.operatorDecisionConsole?.summary?.operatorMergeDecisionRequired ? 'yes' : 'no'}</li>
        </ul>
        <ul>
          {(intentToBuild.missionSpec.operatorDecisionConsole?.decisions || []).slice(0, 6).map((decision) => (
            <li key={decision.decisionId}><strong>{decision.title}</strong> [{decision.sourceSystem}; risk {decision.riskLevel}] - recommend: {decision.recommendedAction} - allowed: {(decision.allowedActions || []).join(', ') || 'none'} - blocked: {(decision.blockedActions || []).join(', ') || 'none'} - reason: {decision.reason}</li>
          ))}
        </ul>

        <ul>
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
          <li><strong>verification judge:</strong> Proof Marshal v2</li>
          <li><strong>judgment:</strong> {verificationReturnAdjudication.judgment}</li>
          <li><strong>readiness level:</strong> {verificationReturnAdjudication.readinessLevel}</li>
          <li><strong>files scope:</strong> {verificationReturnAdjudication.changedFilesInScope ? 'in-scope' : 'review-needed'}</li>
          <li><strong>tests / build / verify:</strong> tests={verificationReturnAdjudication.requiredTestsRun ? 'ok' : 'missing'} - build+verify={verificationReturnAdjudication.buildVerifySatisfied ? 'ok' : 'missing'}</li>
          <li><strong>architecture checks:</strong> {verificationReturnAdjudication.architectureScopeSatisfied ? 'satisfied' : 'review-needed'}</li>
          <li><strong>finish authority checks:</strong> {verificationReturnAdjudication.finishAuthoritySatisfied ? 'satisfied' : 'not-authorized'}</li>
          <li><strong>openclaw boundary checks:</strong> {verificationReturnAdjudication.openClawBoundarySatisfied ? 'satisfied' : 'blocked'}</li>
          <li><strong>proof-of-done status:</strong> {verificationReturnAdjudication.proofOfDoneStatus}</li>
          <li><strong>blockers:</strong> {verificationReturnAdjudication.blockers}</li>
          <li><strong>warnings:</strong> {(verificationReturnAdjudication.warnings || []).join(' | ') || 'none'}</li>
          <li><strong>merge-ready candidate:</strong> {verificationReturnAdjudication.mergeReadyCandidate ? 'yes' : 'no'}</li>
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

        <h5>Memory Librarian / Canon Curator</h5>
        <ul>
          <li><strong>pending memory candidates:</strong> {memoryLibrarian.counts.pending}</li>
          <li><strong>requires approval:</strong> {memoryLibrarian.counts.approvalRequired}</li>
          <li><strong>canon candidates:</strong> {memoryLibrarian.counts.canonCandidates}</li>
          <li><strong>project lessons:</strong> {memoryLibrarian.counts.projectLessons}</li>
          <li><strong>capability gaps:</strong> {memoryLibrarian.counts.capabilityGaps}</li>
          <li><strong>duplicates / conflicts:</strong> {memoryLibrarian.counts.duplicates} / {memoryLibrarian.counts.conflicts}</li>
          <li><strong>saved / rejected / draft:</strong> {memoryLibrarian.counts.saved} / {memoryLibrarian.counts.rejected} / {memoryLibrarian.counts.pending}</li>
        </ul>
        <ul>
          {(memoryLibrarian.queue || []).slice(0, 4).map((candidate) => (
            <li key={candidate.candidateId}><strong>{candidate.memoryCandidateType}:</strong> {candidate.summary} <em>{candidate.influencePreview}</em> Suggested action: {candidate.suggestedAction}{candidate.duplicateOf ? ` - duplicate of ${candidate.duplicateOf}` : ''}{candidate.conflictWith?.length ? ` - conflicts: ${candidate.conflictWith.join(', ')}` : ''}</li>
          ))}
          {(memoryLibrarian.queue || []).length === 0 ? <li>none</li> : null}
        </ul>

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
          <button type="button" onClick={() => copyToClipboard(buildMissionCommandPacketMarkdown(missionCommandPacket), setPacketMarkdownCopyState)}>
            {packetMarkdownCopyState === COPY_STATE.SUCCESS ? 'Packet Markdown Copied' : 'Copy Packet Markdown'}
          </button>
          <button type="button" onClick={() => copyToClipboard(buildMissionCommandPacketJson(missionCommandPacket), setPacketJsonCopyState)}>
            {packetJsonCopyState === COPY_STATE.SUCCESS ? 'Packet JSON Copied' : 'Copy Packet JSON'}
          </button>
      </div>
        </CollapsiblePanel>
      </section>

      <div className="paneSection">
        <h5>Agent Assignment Matrix</h5>
        <ul>
          <li><strong>assignment count:</strong> {agentAssignmentMatrix.summary.assignmentCount}</li>
          <li><strong>active roles:</strong> {agentAssignmentMatrix.summary.activeRoleCount}</li>
          <li><strong>recommended lead role:</strong> {agentAssignmentMatrix.summary.recommendedLeadRole}</li>
          <li><strong>openclaw assigned:</strong> {agentAssignmentMatrix.summary.openClawAssigned ? 'yes' : 'no'}</li>
          <li><strong>codex assigned:</strong> {agentAssignmentMatrix.summary.codexAssigned ? 'yes' : 'no'}</li>
          <li><strong>operator approval required:</strong> {agentAssignmentMatrix.summary.operatorApprovalRequired ? 'yes' : 'no'}</li>
          <li><strong>high-risk count:</strong> {agentAssignmentMatrix.summary.highRiskAssignmentCount}</li>
        </ul>
        <ul className="mission-console__status-list">
          {(agentAssignmentMatrix.assignments || []).slice(0, 8).map((assignment) => (
            <li key={assignment.assignmentId}><strong>{assignment.roleLabel}</strong> - {assignment.responsibility} | authority: {assignment.authorityLevel} | allow: {(assignment.allowedActions || []).join(', ') || 'none'} | block: {(assignment.blockedActions || []).slice(0, 3).join(', ') || 'none'} | output: {assignment.outputExpected} | next: {assignment.nextAction}</li>
          ))}
        </ul>
      </div>
      <div className="paneSection">
        <h5>Mission Routing / Delegation Readiness</h5>
        <ul>
          <li><strong>route status:</strong> {missionRoutingReadiness.routeStatus}</li>
          <li><strong>recommended route:</strong> {missionRoutingReadiness.recommendedRoute}</li>
          <li><strong>readiness level:</strong> {missionRoutingReadiness.readinessLevel}</li>
          <li><strong>assigned lead role:</strong> {missionRoutingReadiness.assignedLeadRole}</li>
          <li><strong>Codex ready:</strong> {missionRoutingReadiness.codexReady ? 'yes' : 'no'}</li>
          <li><strong>OpenClaw research ready:</strong> {missionRoutingReadiness.openClawResearchReady ? 'yes' : 'no'}</li>
          <li><strong>operator decision required:</strong> {missionRoutingReadiness.operatorDecisionRequired ? 'yes' : 'no'}</li>
          <li><strong>blockers / warnings:</strong> {(missionRoutingReadiness.blockers || []).length} / {(missionRoutingReadiness.warnings || []).length}</li>
          <li><strong>required before route:</strong> {(missionRoutingReadiness.requiredBeforeRoute || []).join(' | ') || 'none'}</li>
          <li><strong>next action:</strong> {missionRoutingReadiness.nextAction}</li>
        </ul>

        <h5>Mission Command Packet</h5>
        <ul>
          <li><strong>packet version:</strong> {missionCommandPacket.packetVersion}</li>
          <li><strong>mission id:</strong> {missionCommandPacket.missionId}</li>
          <li><strong>created at:</strong> {missionCommandPacket.createdAt}</li>
          <li><strong>status:</strong> {missionCommandPacket.missionStatus}</li>
          <li><strong>warnings count:</strong> {missionCommandPacket.exportWarnings.length}</li>
          <li><strong>next action:</strong> {missionCommandPacket.nextAction}</li>
          <li><strong>included systems summary:</strong> memory, architecture, openclaw, finish-authority, pr-evidence, verification-judge, task-finisher, memory-librarian, evidence-ledger, operator-decision</li>
        </ul>
      </div>
      <div className="paneSection">
        <h5>PR Evidence Input</h5>
        <textarea
          className="paneTextarea paneControl"
          rows={5}
          value={prEvidenceInput}
          onChange={(event) => setPrEvidenceInput(event.target.value)}
          placeholder="Paste GitHub PR URL, PR summary, Codex PR summary, or metadata block."
        />
        <button type="button" onClick={handleParsePrEvidence}>Parse PR Evidence</button>
        <h6>Parsed PR Evidence Preview</h6>
        {!prEvidenceInput.trim() ? <p>No PR evidence supplied yet.</p> : (
          <ul>
            <li><strong>parse confidence:</strong> {prEvidenceParseResult.parseConfidence || 'none'}</li>
            <li><strong>PR number:</strong> {prEvidenceParseResult.detectedPrNumber || 'n/a'}</li>
            <li><strong>PR URL:</strong> {prEvidenceParseResult.detectedPrUrl || 'n/a'}</li>
            <li><strong>repository:</strong> {prEvidenceParseResult.detectedRepo || 'unknown'}</li>
            <li><strong>checks status:</strong> {prEvidenceParseResult.detectedChecksStatus || 'unknown'}</li>
            <li><strong>merged status:</strong> {prEvidenceParseResult.detectedMergeStatus || 'unknown'}</li>
            <li><strong>changed file count:</strong> {(prEvidenceParseResult.detectedChangedFiles || []).length}</li>
            <li><strong>codex task present:</strong> {prEvidenceParseResult.detectedCodexTaskId || prEvidenceParseResult.detectedCodexTaskUrl ? 'yes' : 'no'}</li>
            <li><strong>warnings:</strong> {(prEvidenceParseResult.parseWarnings || []).join(' | ') || 'none'}</li>
            <li><strong>normalized PR status:</strong> {intentToBuild?.missionSpec?.prEvidenceIntake?.normalizedStatus || 'no_pr_evidence'}</li>
          </ul>
        )}
      </div>
      <div className="paneSection">
        <h5>Mission Evidence Ledger</h5>
        <ul className="mission-console__status-list">
          <li><strong>evidence completeness:</strong> {missionEvidenceLedger.summary.evidenceCompleteness}</li>
          <li><strong>latest event:</strong> {missionEvidenceLedger.summary.latestEventType}</li>
          <li><strong>warnings / blockers:</strong> {missionEvidenceLedger.summary.warningCount} / {missionEvidenceLedger.summary.blockerCount}</li>
          <li><strong>pending operator review:</strong> {missionEvidenceLedger.summary.pendingOperatorReviewCount}</li>
          <li><strong>next required evidence:</strong> {missionEvidenceLedger.summary.nextRequiredEvidence}</li>
          <li><strong>readiness narrative:</strong> {missionEvidenceLedger.summary.missionReadyNarrative}</li>
        </ul>
        <ul className="mission-console__status-list">
          {(missionEvidenceLedger.entries || []).slice(0, 6).map((entry) => (
            <li key={entry.entryId}><strong>{entry.eventType}</strong>: {entry.summary}</li>
          ))}
          {(missionEvidenceLedger.entries || []).length === 0 ? <li>none</li> : null}
        </ul>

        <h5>PR Evidence Intake</h5>
        {!intentToBuild?.missionSpec?.prEvidenceIntake || intentToBuild?.missionSpec?.prEvidenceIntake?.normalizedStatus === 'no_pr_evidence' ? (
          <p>No PR evidence supplied yet.</p>
        ) : (
          <ul>
            <li><strong>normalized status:</strong> {intentToBuild.missionSpec.prEvidenceIntake.normalizedStatus}</li>
            <li><strong>PR:</strong> #{intentToBuild.missionSpec.prEvidenceIntake.prNumber || 'n/a'} {intentToBuild.missionSpec.prEvidenceIntake.prTitle || ''} {intentToBuild.missionSpec.prEvidenceIntake.prUrl || ''}</li>
            <li><strong>branch:</strong> {intentToBuild.missionSpec.prEvidenceIntake.prBranch || 'unknown'} {' → '} {intentToBuild.missionSpec.prEvidenceIntake.baseBranch || 'unknown'}</li>
            <li><strong>changed files:</strong> {intentToBuild.missionSpec.prEvidenceIntake.changedFileCount || 0}</li>
            <li><strong>checks:</strong> {intentToBuild.missionSpec.prEvidenceIntake.checksStatus || 'unknown'} (required: {intentToBuild.missionSpec.prEvidenceIntake.requiredChecksStatus || 'unknown'})</li>
            <li><strong>auto-merge:</strong> {intentToBuild.missionSpec.prEvidenceIntake.autoMergeState || 'unknown'}</li>
            <li><strong>merged:</strong> {intentToBuild.missionSpec.prEvidenceIntake.merged ? 'yes' : 'no'} by {intentToBuild.missionSpec.prEvidenceIntake.mergedBy || 'unknown'} at {intentToBuild.missionSpec.prEvidenceIntake.mergedAt || 'n/a'}</li>
            <li><strong>codex task:</strong> {intentToBuild.missionSpec.prEvidenceIntake.codexTaskId || 'n/a'} {intentToBuild.missionSpec.prEvidenceIntake.codexTaskUrl || ''}</li>
            <li><strong>warnings:</strong> {(intentToBuild.missionSpec.prEvidenceIntake.evidenceWarnings || []).join(' | ') || 'none'}</li>
          </ul>
        )}
      </div>

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
                <strong>{message.responder}</strong> - target <strong>{message.target}</strong> - status <strong>{message.status}</strong>
                {message.approvalNeeded ? <span className="mission-console-pill">approval-needed</span> : null}
              </header>
              <p>{message.content}</p>
              <small>{message.timestamp}{message.linkedProposalId ? ` - proposal ${message.linkedProposalId}` : ''}</small>
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
        <p><strong>queue status:</strong> {agentCommandQueue.queueStatus} - <strong>ready items:</strong> {agentCommandQueue.readyCount} / {agentCommandQueue.itemCount}</p>
        <ul className="paneList">{agentCommandQueue.items.map((item) => (
          <li key={item.itemId}><strong>{item.label}</strong> - {item.itemType} - {item.status} - next: {item.nextAction}</li>
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


function missionConsolePropsEqual(previousProps, nextProps) {
  const previousSummary = summarizeMissionConsoleProps(previousProps);
  const nextSummary = summarizeMissionConsoleProps(nextProps);
  const same = Object.keys(previousSummary).every((key) => previousSummary[key] === nextSummary[key]);
  if (!same) {
    for (const key of Object.keys(nextSummary)) {
      if (previousSummary[key] !== nextSummary[key]) {
        recordPerfCounter('render_reason', `MissionConsoleTile.memo_miss.${key}`);
      }
    }
  }
  return same;
}

export default memo(MissionConsoleTile, missionConsolePropsEqual);
