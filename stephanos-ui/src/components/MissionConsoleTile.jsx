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
import { discoverLocalAiRunnerModels, runLocalAiWorkbenchReview } from '../ai/localAiRunner.js';
import { getProviderHealth, sendPrompt } from '../ai/aiClient';
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

const DEFAULT_MISSION_CONSOLE_SECTION_ORDER = Object.freeze([
  'missionConsoleOperatorOverviewPanel',
  'missionConsoleRuntimeRouteStatusPanel',
  'missionConsoleOperatorReliefPanel',
  'missionConsoleAssistantCommandConsolePanel',
  'missionConsoleSecondaryDiagnosticsPanel',
  'missionConsoleConnectedTileContextsPanel',
  'missionConsoleQuickContextPanel',
  'missionConsoleRoutingControlsPanel',
  'missionConsoleIntentToBuildPanel',
  'missionConsoleAgentAssignmentMatrixPanel',
  'missionConsoleRoutingReadinessPanel',
  'missionConsolePrEvidencePanel',
  'missionConsoleEvidenceLedgerPanel',
  'missionConsoleMissionIntelligencePanel',
  'missionConsoleRealityUpgradePanel',
  'missionConsoleConversationWorkspacePanel',
  'missionConsoleAgentCommandPanel',
  'missionConsoleSharedAgentContextPanel',
  'missionConsoleProposalApprovalRailPanel',
  'missionConsoleIntegrationTopologyPanel',
  'missionConsoleGuardrailsPanel',
]);

function normalizeMissionConsoleSectionOrder(value = []) {
  const seen = new Set();
  const normalized = [];
  (Array.isArray(value) ? value : []).forEach((panelId) => {
    const id = String(panelId || '');
    if (!DEFAULT_MISSION_CONSOLE_SECTION_ORDER.includes(id) || seen.has(id)) return;
    seen.add(id);
    normalized.push(id);
  });
  DEFAULT_MISSION_CONSOLE_SECTION_ORDER.forEach((id) => {
    if (!seen.has(id)) normalized.push(id);
  });
  return normalized;
}

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
  onMissionConsoleInstanceRegistration = () => {},
  onOperatorReliefProjectionUpdate = () => {},
  forcePanelOpen = false,
  panelId = 'missionConsolePanel',
  panelTitle = 'Agent Mission Console',
  paneLayout = {},
  setMissionConsoleSectionOrder,
}) {
  const registrationCallbackInvokedRef = useRef('no');
  const registrationDropBoundaryRef = useRef('effect-not-fired');
  const [registrationTraceState, setRegistrationTraceState] = useState({
    callbackInvoked: 'no',
    dropBoundary: 'effect-not-fired',
  });
  recordPerfCounter('render', 'MissionConsoleTile');
  useEffect(() => {
    setPerfIdentityField('component.MissionConsoleTile.mounted', true);
    recordPerfCounter('surface_mount', 'MissionConsoleTile.mount');
    return () => {
      setPerfIdentityField('component.MissionConsoleTile.mounted', false);
      recordPerfCounter('surface_mount', 'MissionConsoleTile.unmount');
    };
  }, []);

  useEffect(() => {
    const callbackPresent = typeof onMissionConsoleInstanceRegistration === 'function';
    registrationDropBoundaryRef.current = callbackPresent ? 'none' : 'missing-prop';
    setRegistrationTraceState({ callbackInvoked: 'no', dropBoundary: registrationDropBoundaryRef.current });
    if (!callbackPresent) {
      onOperatorReliefProjectionUpdate(null, {
        sourceSurface: panelId,
        registrationTrace: {
          effectSeen: 'yes',
          effectPanelId: panelId,
          callbackPropPresent: 'no',
          callbackInvoked: 'no',
          dropBoundary: 'missing-prop',
        },
      });
      return;
    }
    registrationCallbackInvokedRef.current = 'yes';
    setRegistrationTraceState({ callbackInvoked: 'yes', dropBoundary: 'none' });
    onMissionConsoleInstanceRegistration({
      panelId,
      sourceSurface: panelId,
      visible: forcePanelOpen ? true : uiLayout?.[panelId] !== false,
      collapsed: forcePanelOpen ? false : uiLayout?.[panelId] === false,
      hasBridgeCallback: typeof onOperatorReliefProjectionUpdate === 'function',
      registrationTrace: {
        effectSeen: 'yes',
        effectPanelId: panelId,
        callbackPropPresent: 'yes',
        callbackInvoked: 'yes',
        dropBoundary: 'none',
      },
    });
  }, [forcePanelOpen, onMissionConsoleInstanceRegistration, onOperatorReliefProjectionUpdate, panelId, uiLayout]);
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
  const { copyState: localAiReviewPacketCopyState, setCopyState: setLocalAiReviewPacketCopyState } = useClipboardButtonState();
  const { copyState: openClawPatchPlanPacketCopyState, setCopyState: setOpenClawPatchPlanPacketCopyState } = useClipboardButtonState();
  const { copyState: openClawWebPromptCopyState, setCopyState: setOpenClawWebPromptCopyState } = useClipboardButtonState();
  const { copyState: openClawWebHandoffCopyState, setCopyState: setOpenClawWebHandoffCopyState } = useClipboardButtonState();
  const { copyState: openClawPatchPlannerPromptCopyState, setCopyState: setOpenClawPatchPlannerPromptCopyState } = useClipboardButtonState();
  const { copyState: openClawPatchPlannerHandoffCopyState, setCopyState: setOpenClawPatchPlannerHandoffCopyState } = useClipboardButtonState();
  const { copyState: openClawSourcePackPromptCopyState, setCopyState: setOpenClawSourcePackPromptCopyState } = useClipboardButtonState();
  const { copyState: openClawSourcePackHandoffCopyState, setCopyState: setOpenClawSourcePackHandoffCopyState } = useClipboardButtonState();
  const { copyState: openClawWorkspaceCleanupCopyState, setCopyState: setOpenClawWorkspaceCleanupCopyState } = useClipboardButtonState();
  const { copyState: githubPrInspectionPacketCopyState, setCopyState: setGithubPrInspectionPacketCopyState } = useClipboardButtonState();
  const { copyState: codexFallbackPacketCopyState, setCopyState: setCodexFallbackPacketCopyState } = useClipboardButtonState();
  const { copyState: localAiRunnerRawCopyState, setCopyState: setLocalAiRunnerRawCopyState } = useClipboardButtonState();
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
  const [builderWorkbenchInput, setBuilderWorkbenchInput] = useState(() => ({
    activePacketType: 'none',
    activePacketTarget: 'zero-cost-builder-mesh',
    localAiReviewRequested: false,
    openClawResearchRequested: false,
    openClawPatchPlanRequested: false,
    openClawPatchPlanJudgedAt: '',
    openClawSourcePackJudgedAt: '',
    openClawSourcePackIntakeButtonClicked: 'no',
    openClawSourcePackJudgmentAttempted: 'no',
    localAiReviewText: '',
    openClawResearchText: '',
    openClawSourcePackText: '',
    openClawSourcePackOutput: '',
    localAiRunnerStatus: 'idle',
    localAiRunnerSelectedModel: '',
    localAiRunnerAvailableModels: [],
    localAiRunnerLastRunResult: 'none',
    localAiRunnerLastRunBlockedReason: '',
    localAiRunnerErrorMessage: '',
    localAiRunnerDispatchAttempted: 'no',
    localAiRunnerRequestSent: 'no',
    localAiRunnerResponseRetained: 'no',
    localAiRunnerParseAttempted: 'no',
    localAiRunnerParseResultStatus: 'empty',
    localAiRunnerRawResponse: '',
  }));
  const [showBuilderWorkbenchVerdict, setShowBuilderWorkbenchVerdict] = useState(false);

  const operatorReliefPresenceSignatureRef = useRef('');
  const operatorReliefProjectionPublishSignatureRef = useRef('');
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
    supportSnapshot: { ...(runtimeStatusModel || {}), builderWorkbenchInput },
    builderWorkbenchInput,
    });
  }, [intentToBuild, missionEvidenceLedger, verificationReturnAdjudication, memoryLibrarian, runtimeStatusModel, builderWorkbenchInput]);

  useEffect(() => {
    const nextProjection = operatorReliefProjection || null;
    const nextSignature = JSON.stringify(nextProjection);
    if (operatorReliefProjectionPublishSignatureRef.current === nextSignature) {
      return;
    }
    operatorReliefProjectionPublishSignatureRef.current = nextSignature;
    onOperatorReliefProjectionUpdate(nextProjection, { sourceSurface: panelId });
  }, [onOperatorReliefProjectionUpdate, operatorReliefProjection, panelId]);

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
  const missionConsoleSectionOrder = useMemo(
    () => normalizeMissionConsoleSectionOrder(paneLayout?.missionConsoleSectionOrder),
    [paneLayout?.missionConsoleSectionOrder],
  );
  const moveMissionConsoleSection = (sectionPanelId, direction) => {
    if (typeof setMissionConsoleSectionOrder !== 'function') return;
    const currentOrder = normalizeMissionConsoleSectionOrder(paneLayout?.missionConsoleSectionOrder);
    const currentIndex = currentOrder.indexOf(sectionPanelId);
    const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= currentOrder.length) return;
    const nextOrder = [...currentOrder];
    const [moved] = nextOrder.splice(currentIndex, 1);
    nextOrder.splice(nextIndex, 0, moved);
    setMissionConsoleSectionOrder(nextOrder);
  };
  const getMissionConsoleSectionOrderStyle = (sectionPanelId) => ({
    order: missionConsoleSectionOrder.indexOf(sectionPanelId) >= 0
      ? missionConsoleSectionOrder.indexOf(sectionPanelId)
      : DEFAULT_MISSION_CONSOLE_SECTION_ORDER.length,
  });
  const getMissionConsoleMoveControls = (sectionPanelId) => {
    const sectionIndex = missionConsoleSectionOrder.indexOf(sectionPanelId);
    const arrangeModeActive = uiLayout?.arrangeMode === true;
    if (!arrangeModeActive) return null;
    return (
      <div className="pane-order-controls" aria-label={`${sectionPanelId} arrangement controls`} data-pane-control-group="move-order" data-pane-control-layer="mission-console-section-header" data-pane-control-attached="true" data-testid={`pane-${sectionPanelId}-move-controls`}>
        <button type="button" className="ghost-button pane-order-button" onClick={() => moveMissionConsoleSection(sectionPanelId, 'up')} disabled={sectionIndex <= 0} aria-label={`Move ${sectionPanelId} up`} data-testid={`pane-${sectionPanelId}-move-up`}>Move up</button>
        <button type="button" className="ghost-button pane-order-button" onClick={() => moveMissionConsoleSection(sectionPanelId, 'down')} disabled={sectionIndex < 0 || sectionIndex >= missionConsoleSectionOrder.length - 1} aria-label={`Move ${sectionPanelId} down`} data-testid={`pane-${sectionPanelId}-move-down`}>Move down</button>
      </div>
    );
  };
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


  useEffect(() => {
    let cancelled = false;
    setBuilderWorkbenchInput((prev) => prev.localAiRunnerStatus === 'idle'
      ? { ...prev, localAiRunnerStatus: 'running', localAiRunnerLastRunResult: 'model-discovery-running' }
      : prev);
    discoverLocalAiRunnerModels({ providerConfigs: {}, runtimeConfig: runtimeStatusModel || {}, fetchHealth: getProviderHealth })
      .then((discovery) => {
        if (cancelled) return;
        setBuilderWorkbenchInput((prev) => ({
          ...prev,
          localAiRunnerStatus: discovery.ok ? 'ready' : 'blocked',
          localAiRunnerAvailableModels: discovery.models || [],
          localAiRunnerSelectedModel: prev.localAiRunnerSelectedModel || discovery.selectedModel || '',
          localAiRunnerLastRunResult: discovery.ok ? 'model-discovery-succeeded' : 'model-discovery-blocked',
          localAiRunnerLastRunBlockedReason: discovery.ok ? 'none' : (discovery.reason || 'No approved local Ollama models discovered.'),
          localAiRunnerErrorMessage: discovery.ok ? '' : (discovery.reason || 'No approved local Ollama models discovered.'),
        }));
      })
      .catch((error) => {
        if (cancelled) return;
        setBuilderWorkbenchInput((prev) => ({
          ...prev,
          localAiRunnerStatus: 'blocked',
          localAiRunnerLastRunResult: 'model-discovery-failed',
          localAiRunnerLastRunBlockedReason: error?.message || 'Ollama model discovery failed.',
          localAiRunnerErrorMessage: error?.message || 'Ollama model discovery failed.',
        }));
      });
    return () => { cancelled = true; };
  }, [runtimeStatusModel]);

  const localAiRunnerInFlightRef = useRef(false);

  const runBuilderWorkbenchLocalAiReview = async () => {
    if (localAiRunnerInFlightRef.current) return;
    localAiRunnerInFlightRef.current = true;
    const packet = operatorReliefProjection.builderMeshProjection?.copyPackets?.localAiReviewPacket || null;
    const selectedModel = builderWorkbenchInput.localAiRunnerSelectedModel || '';
    const availableModels = builderWorkbenchInput.localAiRunnerAvailableModels || [];
    setBuilderWorkbenchInput((prev) => ({
      ...prev,
      activePacketType: 'local-ai-review',
      activePacketTarget: 'local-ai-runner',
      localAiReviewRequested: true,
      localAiReviewRequestedAt: new Date().toISOString(),
      localAiRunnerStatus: 'running',
      localAiRunnerLastRunResult: 'running',
      localAiRunnerLastRunBlockedReason: 'none',
      localAiRunnerErrorMessage: '',
      localAiRunnerDispatchAttempted: 'yes',
      localAiRunnerRequestSent: 'no',
      localAiRunnerResponseRetained: 'no',
      localAiRunnerParseAttempted: 'no',
      localAiRunnerParseResultStatus: 'empty',
    }));
    try {
      const result = await runLocalAiWorkbenchReview({
        packet,
        selectedModel,
        availableModels,
        runtimeConfig: runtimeStatusModel || {},
        sendPromptImpl: sendPrompt,
        onRequestSent: () => setBuilderWorkbenchInput((prev) => ({
          ...prev,
          localAiRunnerStatus: 'running',
          localAiRunnerLastRunResult: 'running',
          localAiRunnerDispatchAttempted: 'yes',
          localAiRunnerRequestSent: 'yes',
        })),
      });
      setBuilderWorkbenchInput((prev) => ({
        ...prev,
        localAiRunnerStatus: result.status || (result.ok ? 'succeeded' : 'failed'),
        localAiRunnerLastRunResult: result.ok ? 'succeeded' : (result.status || 'failed'),
        localAiRunnerLastRunBlockedReason: result.blockedReason || 'none',
        localAiRunnerErrorMessage: result.errorMessage || '',
        localAiRunnerDispatchAttempted: result.dispatchAttempted ? 'yes' : 'yes',
        localAiRunnerRequestSent: result.requestSent ? 'yes' : 'no',
        localAiRunnerResponseRetained: result.responseRetained || (result.responseText ? 'yes' : 'no'),
        localAiRunnerParseAttempted: result.parseAttempted || 'no',
        localAiRunnerParseResultStatus: result.parseResultStatus || (result.ok ? 'parsed' : 'blocked'),
        localAiRunnerRawResponse: result.responseText || '',
        localAiReviewText: result.responseText || prev.localAiReviewText,
        activePacketType: 'local-ai-review',
      }));
    } catch (error) {
      const message = error?.message || 'Local AI review failed.';
      setBuilderWorkbenchInput((prev) => ({
        ...prev,
        localAiRunnerStatus: 'failed',
        localAiRunnerLastRunResult: 'failed',
        localAiRunnerLastRunBlockedReason: 'none',
        localAiRunnerErrorMessage: message,
        localAiRunnerDispatchAttempted: 'yes',
        localAiRunnerRequestSent: prev.localAiRunnerRequestSent === 'yes' ? 'yes' : 'no',
        localAiRunnerResponseRetained: 'no',
        localAiRunnerParseAttempted: 'no',
        localAiRunnerParseResultStatus: 'failed',
      }));
    } finally {
      localAiRunnerInFlightRef.current = false;
    }
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
      <span
        data-mission-console-component="MissionConsoleTile"
        data-mission-console-panel-id={panelId}
        data-mission-console-registration-effect-seen="yes"
        data-mission-console-registration-callback-prop-present={typeof onMissionConsoleInstanceRegistration === 'function' ? 'yes' : 'no'}
        data-mission-console-registration-callback-invoked={registrationTraceState.callbackInvoked}
        data-mission-console-registration-drop-boundary={registrationTraceState.dropBoundary}
        hidden
        aria-hidden="true"
      />
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
        uiLayout={uiLayout}
        togglePanel={dispatchPanelToggle}
      />
      </div>
      <section className="mission-console-section mission-console-section--operator-overview" style={getMissionConsoleSectionOrderStyle('missionConsoleOperatorOverviewPanel')}>
        <CollapsiblePanel
          panelId="missionConsoleOperatorOverviewPanel"
          title="Operator Overview"
          isOpen={uiLayout.missionConsoleOperatorOverviewPanel !== false}
          onToggle={() => dispatchPanelToggle('missionConsoleOperatorOverviewPanel')}
          actions={getMissionConsoleMoveControls('missionConsoleOperatorOverviewPanel')}
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
      <section className="mission-console-section mission-console-section--status-strip" style={getMissionConsoleSectionOrderStyle('missionConsoleRuntimeRouteStatusPanel')}>
        <CollapsiblePanel
          panelId="missionConsoleRuntimeRouteStatusPanel"
          title="Runtime + Route Status"
          isOpen={uiLayout.missionConsoleRuntimeRouteStatusPanel !== false}
          onToggle={() => dispatchPanelToggle('missionConsoleRuntimeRouteStatusPanel')}
          actions={getMissionConsoleMoveControls('missionConsoleRuntimeRouteStatusPanel')}
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

      <section className="mission-console-section mission-console-section--operator-relief" style={getMissionConsoleSectionOrderStyle('missionConsoleOperatorReliefPanel')}>
        <CollapsiblePanel
          panelId="missionConsoleOperatorReliefPanel"
          title="Operator Relief v2 · Mission Brain"
          isOpen={uiLayout.missionConsoleOperatorReliefPanel !== false}
          onToggle={() => dispatchPanelToggle('missionConsoleOperatorReliefPanel')}
          actions={getMissionConsoleMoveControls('missionConsoleOperatorReliefPanel')}
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
            <li><strong>Can Codex Help?</strong> fallback/specialist only — {operatorReliefProjection.missionIntelligenceSummary?.codexReady || 'unknown'}</li>
            <li><strong>Can OpenClaw Help?</strong> {operatorReliefProjection.missionIntelligenceSummary?.openClawReady || 'unknown'}</li>
            <li><strong>Codex role:</strong> {operatorReliefProjection.builderHarnessProjection?.codexRole || 'fallback-specialist-only'}</li>
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
          <CollapsiblePanel panelId="missionConsoleAgentRealityLoopPanel" title="Agent Reality Loop V1" isOpen={uiLayout.missionConsoleAgentRealityLoopPanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleAgentRealityLoopPanel')}>
            <ul className="mission-console__status-list">
              <li><strong>Status:</strong> {operatorReliefProjection.agentRealityLoopProjection?.status || 'unknown'}</li>
              <li><strong>Lead recommendation:</strong> {operatorReliefProjection.agentRealityLoopProjection?.recommendedLead || 'hold'}</li>
              <li><strong>Next action:</strong> {operatorReliefProjection.agentRealityLoopProjection?.nextBestAction || 'Review mission evidence'}</li>
              <li><strong>Proof required:</strong> {(operatorReliefProjection.agentRealityLoopProjection?.requiredProof || []).join(' · ') || 'none'}</li>
              <li><strong>Merge recommendation:</strong> {operatorReliefProjection.agentRealityLoopProjection?.mergeRecommendation || 'unknown'}</li>
            </ul>
            <button type="button" className={`status-panel-copy-button ${codexPacketCopyState}`} onClick={() => copyToClipboard(JSON.stringify(operatorReliefProjection.agentRealityLoopProjection?.copyCodexPacket || {}, null, 2), setCodexPacketCopyState, 'MissionConsoleTile.copyAgentRealityLoopCodexPacket')}>Copy Agent Reality Loop Codex Packet</button>
            <button type="button" className={`status-panel-copy-button ${missionHandoffCopyState}`} onClick={() => copyToClipboard(JSON.stringify(operatorReliefProjection.agentRealityLoopProjection?.copyOpenClawPacket || {}, null, 2), setMissionHandoffCopyState, 'MissionConsoleTile.copyAgentRealityLoopOpenClawPacket')}>Copy Agent Reality Loop OpenClaw Packet</button>
            <button type="button" className={`status-panel-copy-button ${operatorChecklistCopyState}`} onClick={() => copyToClipboard(operatorReliefProjection.agentRealityLoopProjection?.copyOperatorProofChecklist || '', setOperatorChecklistCopyState, 'MissionConsoleTile.copyAgentRealityLoopOperatorChecklist')}>Copy Agent Reality Loop Operator Checklist</button>
          </CollapsiblePanel>
          <CollapsiblePanel panelId="missionConsoleOperatorApprovedRepairLoopPanel" title="Operator-Approved Repair Loop V1" isOpen={uiLayout.missionConsoleOperatorApprovedRepairLoopPanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleOperatorApprovedRepairLoopPanel')}>
            <ul className="mission-console__status-list">
              <li><strong>Current repair loop status:</strong> {operatorReliefProjection.operatorApprovedRepairLoopProjection?.status || 'inactive'}</li>
              <li><strong>Approved mission:</strong> {operatorReliefProjection.operatorApprovedRepairLoopProjection?.approvedMissionTitle || 'none'}</li>
              <li><strong>Recommended lead:</strong> {operatorReliefProjection.operatorApprovedRepairLoopProjection?.recommendedLead || 'hold'}</li>
              <li><strong>Current blocker:</strong> {operatorReliefProjection.operatorApprovedRepairLoopProjection?.currentBlocker || 'none'}</li>
              <li><strong>Next action:</strong> {operatorReliefProjection.operatorApprovedRepairLoopProjection?.nextAction || 'Review mission evidence'}</li>
              <li><strong>Proof state:</strong> {(operatorReliefProjection.operatorApprovedRepairLoopProjection?.missingProofLines || []).length > 0 ? 'proof-missing' : 'proof-satisfied'}</li>
              <li><strong>Scope-change required:</strong> {operatorReliefProjection.operatorApprovedRepairLoopProjection?.scopeChangeRequired || 'no'}</li>
            </ul>
            <button type="button" className={`status-panel-copy-button ${missionHandoffCopyState}`} onClick={() => copyToClipboard(JSON.stringify(operatorReliefProjection.operatorApprovedRepairLoopProjection?.copyOpenClawContinuationPacket || {}, null, 2), setMissionHandoffCopyState, 'MissionConsoleTile.copyOpenClawContinuationPacket')}>Copy OpenClaw Continuation Packet</button>
            <button type="button" className={`status-panel-copy-button ${codexPacketCopyState}`} onClick={() => copyToClipboard(JSON.stringify(operatorReliefProjection.operatorApprovedRepairLoopProjection?.copyCodexContinuationPacket || {}, null, 2), setCodexPacketCopyState, 'MissionConsoleTile.copyCodexContinuationPacket')}>Copy Codex Continuation Packet</button>
            <button type="button" className={`status-panel-copy-button ${operatorChecklistCopyState}`} onClick={() => copyToClipboard(operatorReliefProjection.operatorApprovedRepairLoopProjection?.copyOperatorProofChecklist || '', setOperatorChecklistCopyState, 'MissionConsoleTile.copyOperatorRepairChecklist')}>Copy Operator Proof Checklist</button>
            <button type="button" className={`status-panel-copy-button ${repairPromptCopyState}`} onClick={() => copyToClipboard(operatorReliefProjection.operatorApprovedRepairLoopProjection?.copyMissionContract || '', setRepairPromptCopyState, 'MissionConsoleTile.copyOperatorMissionContract')}>Copy Mission Contract</button>
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
          <CollapsiblePanel panelId="missionConsoleBuilderHarnessPanel" title="OpenClaw Builder Harness V1" isOpen={uiLayout.missionConsoleBuilderHarnessPanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleBuilderHarnessPanel')}>
            <CollapsiblePanel panelId="missionConsoleBuilderMeshPanel" title="Zero-Cost Builder Mesh V1" titleAs="h5" description={operatorReliefProjection.builderMeshProjection?.recommendedBuilder || 'routing pending'} isOpen={uiLayout.missionConsoleBuilderMeshPanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleBuilderMeshPanel')}>
              <ul className="mission-console__status-list">
                <li><strong>Builder mesh status:</strong> {operatorReliefProjection.builderMeshProjection?.builderMeshStatus || 'unknown'}</li>
                <li><strong>Recommended builder:</strong> {operatorReliefProjection.builderMeshProjection?.recommendedBuilder || 'hold'}</li>
                <li><strong>Zero-cost route available:</strong> {operatorReliefProjection.builderMeshProjection?.zeroCostRouteAvailable ? 'yes' : 'no'}</li>
                <li><strong>Codex required:</strong> {operatorReliefProjection.builderMeshProjection?.codexRequired ? 'yes' : 'no'} · {operatorReliefProjection.builderMeshProjection?.codexReason || 'Codex is fallback only.'}</li>
                <li><strong>Local AI / OpenClaw / GitHub readiness:</strong> {operatorReliefProjection.builderMeshProjection?.localAiCanHelp || 'unknown'} · {operatorReliefProjection.builderMeshProjection?.openClawCanHelp || 'unknown'} · {operatorReliefProjection.builderMeshProjection?.githubCanHelp || 'unknown'}</li>
                <li><strong>Next best action:</strong> {operatorReliefProjection.builderMeshProjection?.nextBestAction || 'Review Builder Mesh truth.'}</li>
                <li><strong>Blockers / warnings:</strong> {(operatorReliefProjection.builderMeshProjection?.blockers || []).length} blocker(s) · {(operatorReliefProjection.builderMeshProjection?.warnings || []).length} warning(s)</li>
                <li><strong>Approval before mutation:</strong> {operatorReliefProjection.builderMeshProjection?.approvalRequiredBeforeMutation ? 'required' : 'not reported'}</li>
              </ul>
              <CollapsiblePanel panelId="missionConsoleBuilderWorkbenchPanel" title="Zero-Cost Builder Workbench V1" titleAs="h6" description={operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.workbenchStatus || 'ready'} isOpen={uiLayout.missionConsoleBuilderWorkbenchPanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleBuilderWorkbenchPanel')}>
                <ul className="mission-console__status-list">
                  <li><strong>Builder Workbench Status:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.workbenchStatus || 'unknown'}</li>
                  <li><strong>Local AI Review Result Present:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.localAiReviewResultPresent ? 'yes' : 'no'}</li>
                  <li><strong>OpenClaw Research Result Present:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawResearchResultPresent ? 'yes' : 'no'}</li>
                  <li><strong>Patch Plan Present:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.patchPlanPresent ? 'yes' : 'no'} · risk {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.patchPlanRisk || 'unknown'}</li>
                  <li><strong>OpenClaw Route Trust:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSanityGate?.routeLabel || 'unknown'} · {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSanityGate?.routeTrustStatus || 'untrusted'} · patch planning {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSanityGate?.trustedForPatchPlanning || 'no'} · session risk {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSanityGate?.activeSessionContaminationRisk || 'no'} · model mismatch {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSanityGate?.routeModelMismatchDetected || 'no'}</li>
                  <li><strong>OpenClaw Sanity Status:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSanityGate?.sanityStatus || 'idle'} · trusted for builder routing {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSanityGate?.trustedForBuilderRouting || 'no'}</li>
                  <li><strong>OpenClaw Sanity Failure:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSanityGate?.failureReason || 'none'}</li>
                  <li><strong>OpenClaw Exact Response:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSanityGate?.exactResponseStatus || 'unknown'} · payload {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSanityGate?.exactResponsePayload || 'none'} · banner ignored {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSanityGate?.cliBannerIgnored || 'no'}</li>
                  <li><strong>Patch Planner Status:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawPatchPlanner?.patchPlannerStatus || 'idle'} · specificity {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawPatchPlanner?.planSpecificity || 'unknown'}</li>
                  <li><strong>Patch Planner Risk / Scope:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawPatchPlanner?.riskLevel || 'unknown'} · {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawPatchPlanner?.patchScope || 'unknown'}</li>
                  <li><strong>Likely files / Required tests:</strong> {(operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawPatchPlanner?.likelyFiles || []).length} file(s) · {(operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawPatchPlanner?.requiredTests || []).length} test(s)</li>
                  <li><strong>Browser proof required:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawPatchPlanner?.browserProofRequired || 'unknown'}</li>
                  <li><strong>Forbidden / Placeholder leakage:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawPatchPlanner?.forbiddenActionsDetected || 'no'} · {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawPatchPlanner?.placeholderLeakageDetected || 'no'}</li>
                  <li><strong>Mutation locked / Auto-start:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawPatchPlanner?.mutationAuthority || 'locked'} · {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawPatchPlanner?.autoStart || 'forbidden'}</li>
                  <li><strong>Trusted for patch:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawPatchPlanner?.trustedForPatch || 'no'} until operator approval</li>
                  <li><strong>Approval Required Before Patch:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.approvalRequiredBeforePatch ? 'yes' : 'no'}</li>
                  <li><strong>Codex Fallback Still Needed:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawPatchPlanner?.codexFallbackNeeded || (operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.codexFallbackStillNeeded ? 'yes' : 'no')} · {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawPatchPlanner?.codexFallbackReason || operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.codexFallbackReason || 'none'}</li>
                  <li><strong>OpenClaw Workspace Hygiene Status:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWorkspaceHygiene?.workspaceHygieneStatus || 'clean'} · dirt {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWorkspaceHygiene?.workspaceDirtDetected || 'no'} · blocks ignition {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWorkspaceHygiene?.workspaceBlocksIgnition || 'no'}</li>
                  <li><strong>OpenClaw Workspace Dirt Paths:</strong> {(operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWorkspaceHygiene?.workspaceDirtPaths || []).join(' · ') || 'none'}</li>
                  <li><strong>OpenClaw Workspace Cleanup:</strong> <code>{operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWorkspaceHygiene?.workspaceRecommendedCleanup || 'No cleanup needed.'}</code></li>
                  <li><strong>OpenClaw Workspace Authority:</strong> mutation {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWorkspaceHygiene?.workspaceMutationAuthority || 'locked'} · runtime directory {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWorkspaceHygiene?.workspaceSafeRuntimeDirectory || 'unknown'}</li>
                  <li><strong>OpenClaw Workspace Next Operator Action:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWorkspaceHygiene?.workspaceNextOperatorAction || 'No OpenClaw workspace dirt detected.'}</li>
                  <li><strong>OpenClaw Source Pack Runner Status:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSourcePackRunner?.sourcePackStatus || 'idle'} · route {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSourcePackRunner?.route || 'stephanos-scout / llama3.2 CLI'} · model {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSourcePackRunner?.model || 'ollama/llama3.2:3b'}</li>
                  <li><strong>OpenClaw Source Pack Result Present:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSourcePackRunner?.sourcePackResultPresent || 'no'} · source-bounded {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSourcePackRunner?.sourceBounded || 'unknown'} · handoff {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSourcePackRunner?.handoffPacketPresent || 'no'}</li>
                  <li><strong>OpenClaw Source Pack Counts:</strong> facts {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSourcePackRunner?.usefulFactCount ?? 0} · unknowns {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSourcePackRunner?.unknownCount ?? 0} · risks {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSourcePackRunner?.riskCount ?? 0} · next questions {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSourcePackRunner?.nextQuestionCount ?? 0}</li>
                  <li><strong>OpenClaw Source Pack Leakage:</strong> hallucinated sources {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSourcePackRunner?.hallucinatedSourcesDetected || 'no'} · template {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSourcePackRunner?.templateLeakageDetected || 'no'} · asks for next {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSourcePackRunner?.asksForNextDetected || 'no'}</li>
                  <li><strong>OpenClaw Source Pack Trust:</strong> canon {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSourcePackRunner?.trustedForCanon || 'no'} · research {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSourcePackRunner?.trustedForResearch || 'no'} · mutation {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSourcePackRunner?.mutationAuthority || 'locked'}</li>
                  <li><strong>OpenClaw Source Pack Next Operator Action:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSourcePackRunner?.nextOperatorAction || 'Copy the Source Pack CLI Prompt and paste a bounded source-pack result.'}</li>
                </ul>
                <button type="button" className={`status-panel-copy-button ${localAiReviewPacketCopyState}`} onClick={() => { setBuilderWorkbenchInput((prev) => ({ ...prev, activePacketType: 'local-ai-review', activePacketTarget: operatorReliefProjection.builderMeshProjection?.recommendedBuilder || 'local-ai', localAiReviewRequested: true, localAiReviewRequestedAt: new Date().toISOString() })); copyToClipboard(JSON.stringify(operatorReliefProjection.builderMeshProjection?.copyPackets?.localAiReviewPacket || {}, null, 2), setLocalAiReviewPacketCopyState, 'MissionConsoleTile.copyBuilderMeshLocalAiReviewPacket'); }}>
                  {localAiReviewPacketCopyState === COPY_STATE.SUCCESS ? 'Local AI Review Packet Copied' : localAiReviewPacketCopyState === COPY_STATE.FAILURE ? 'Copy Local AI Review Packet failed' : 'Copy Local AI Review Packet'}
                </button>
                <label className="mission-console__field-label">Local model selector<select value={builderWorkbenchInput.localAiRunnerSelectedModel} onChange={(event) => setBuilderWorkbenchInput((prev) => ({ ...prev, localAiRunnerSelectedModel: event.target.value, localAiRunnerStatus: prev.localAiRunnerStatus === 'blocked' && event.target.value ? 'idle' : prev.localAiRunnerStatus }))}>
                  {(builderWorkbenchInput.localAiRunnerAvailableModels || []).length ? (builderWorkbenchInput.localAiRunnerAvailableModels || []).map((model) => <option key={model} value={model}>{model}</option>) : <option value="">No approved Ollama models discovered</option>}
                </select></label>
                <button type="button" className="status-panel-copy-button" disabled={builderWorkbenchInput.localAiRunnerStatus === 'running' || !builderWorkbenchInput.localAiRunnerSelectedModel} onClick={runBuilderWorkbenchLocalAiReview}>Run Local AI Review</button>
                <ul className="mission-console__status-list">
                  <li><strong>Local AI Runner Status:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.localAiRunnerStatus || builderWorkbenchInput.localAiRunnerStatus || 'idle'}</li>
                  <li><strong>Local AI Runner Selected Model:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.localAiRunnerSelectedModel || builderWorkbenchInput.localAiRunnerSelectedModel || 'none'}</li>
                  <li><strong>Local AI Runner Last Run Result:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.localAiRunnerLastRunResult || builderWorkbenchInput.localAiRunnerLastRunResult || 'none'}</li>
                  <li><strong>Local AI Runner Last Run Blocked Reason:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.localAiRunnerLastRunBlockedReason || builderWorkbenchInput.localAiRunnerLastRunBlockedReason || 'none'}</li>
                  <li><strong>Local AI Runner Error Message:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.localAiRunnerErrorMessage || builderWorkbenchInput.localAiRunnerErrorMessage || 'none'}</li>
                  <li><strong>Local AI Runner Dispatch Attempted:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.localAiRunnerDispatchAttempted || builderWorkbenchInput.localAiRunnerDispatchAttempted || 'no'}</li>
                  <li><strong>Local AI Runner Request Sent:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.localAiRunnerRequestSent || builderWorkbenchInput.localAiRunnerRequestSent || 'no'}</li>
                  <li><strong>Local AI Runner Response Retained:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.localAiRunnerResponseRetained || builderWorkbenchInput.localAiRunnerResponseRetained || 'no'}</li>
                  <li><strong>Local AI Runner Parse Attempted:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.localAiRunnerParseAttempted || builderWorkbenchInput.localAiRunnerParseAttempted || 'no'}</li>
                  <li><strong>Local AI Runner Parse Result Status:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.localAiRunnerParseResultStatus || builderWorkbenchInput.localAiRunnerParseResultStatus || 'empty'}</li>
                  <li><strong>Local AI Runner Parsed Result Present:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.localAiRunnerParsedResultPresent ? 'yes' : 'no'}</li>
                  <li className="builder-workbench-summary-row"><strong>Response summary:</strong> <span className="builder-workbench-summary-text">{operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.localAiReview?.summary || 'none'}</span></li>
                  <li><strong>Parsed verdict:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.verdict || 'awaiting-results'}</li>
                  <li><strong>Fallback still needed:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.codexFallbackStillNeeded ? 'yes' : 'no'}</li>
                </ul>
                <div className="builder-workbench-output-card builder-workbench-output-card--raw" data-workbench-output-viewport="raw-bounded-response">
	                  <strong>Raw bounded response output</strong>
	                  <pre className="builder-workbench-raw-output" data-testid="builder-workbench-raw-bounded-response">{builderWorkbenchInput.localAiRunnerRawResponse || builderWorkbenchInput.localAiReviewText || 'No Local AI Runner response retained yet.'}</pre>
	                </div>
	                <button type="button" className={`status-panel-copy-button ${localAiRunnerRawCopyState}`} onClick={() => copyToClipboard(builderWorkbenchInput.localAiRunnerRawResponse || builderWorkbenchInput.localAiReviewText || '', setLocalAiRunnerRawCopyState, 'MissionConsoleTile.copyLocalAiRunnerRawBoundedResponse')}>Copy raw bounded response</button>
                <button type="button" className={`status-panel-copy-button ${openClawPatchPlanPacketCopyState}`} onClick={() => { setBuilderWorkbenchInput((prev) => ({ ...prev, activePacketType: 'openclaw-research-patch-plan', activePacketTarget: 'openclaw', openClawResearchRequested: true, openClawResearchRequestedAt: new Date().toISOString() })); copyToClipboard(JSON.stringify(operatorReliefProjection.builderMeshProjection?.copyPackets?.openClawResearchPacket || {}, null, 2), setOpenClawPatchPlanPacketCopyState, 'MissionConsoleTile.copyBuilderMeshOpenClawResearchPacket'); }}>
                  {openClawPatchPlanPacketCopyState === COPY_STATE.SUCCESS ? 'OpenClaw Research Packet Copied' : openClawPatchPlanPacketCopyState === COPY_STATE.FAILURE ? 'Copy OpenClaw Research Packet failed' : 'Copy OpenClaw Research Packet'}
                </button>
                <button type="button" className={`status-panel-copy-button ${openClawPatchPlannerPromptCopyState}`} onClick={() => { setBuilderWorkbenchInput((prev) => ({ ...prev, activePacketType: 'openclaw-patch-planner', activePacketTarget: 'openclaw', openClawPatchPlanRequested: true, openClawPatchPlanRequestedAt: new Date().toISOString() })); copyToClipboard(operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawPatchPlannerPrompt || '', setOpenClawPatchPlannerPromptCopyState, 'MissionConsoleTile.copyOpenClawPatchPlannerPrompt'); }}>
                  {openClawPatchPlannerPromptCopyState === COPY_STATE.SUCCESS ? 'OpenClaw Patch Planner Prompt Copied' : openClawPatchPlannerPromptCopyState === COPY_STATE.FAILURE ? 'Copy OpenClaw Patch Planner Prompt failed' : 'Copy OpenClaw Patch Planner Prompt'}
                </button>
                <button type="button" className={`status-panel-copy-button ${openClawSourcePackPromptCopyState}`} onClick={() => { setBuilderWorkbenchInput((prev) => ({ ...prev, activePacketType: 'openclaw-source-pack-runner', activePacketTarget: 'openclaw', openClawSourcePackRequested: true, openClawSourcePackRequestedAt: new Date().toISOString() })); copyToClipboard(operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSourcePackPrompt || '', setOpenClawSourcePackPromptCopyState, 'MissionConsoleTile.copyOpenClawSourcePackPrompt'); }}>
                  {openClawSourcePackPromptCopyState === COPY_STATE.SUCCESS ? 'Source Pack CLI Prompt Copied' : openClawSourcePackPromptCopyState === COPY_STATE.FAILURE ? 'Copy Source Pack CLI Prompt failed' : 'Copy Source Pack CLI Prompt'}
                </button>
                <button type="button" className={`status-panel-copy-button ${openClawWorkspaceCleanupCopyState}`} onClick={() => copyToClipboard(operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWorkspaceHygiene?.workspaceRecommendedCleanup || '', setOpenClawWorkspaceCleanupCopyState, 'MissionConsoleTile.copyOpenClawWorkspaceCleanupCommand')}>
                  {openClawWorkspaceCleanupCopyState === COPY_STATE.SUCCESS ? 'OpenClaw Workspace Cleanup Command Copied' : openClawWorkspaceCleanupCopyState === COPY_STATE.FAILURE ? 'Copy OpenClaw Workspace Cleanup failed' : 'Copy OpenClaw Workspace Cleanup Command'}
                </button>
                <label className="mission-console__field-label builder-workbench-field-label">Paste Local AI Review Result<textarea className="builder-workbench-result-textarea builder-workbench-result-textarea--local-ai" data-testid="builder-workbench-local-ai-review-result" value={builderWorkbenchInput.localAiReviewText} onChange={(event) => setBuilderWorkbenchInput((prev) => ({ ...prev, activePacketType: 'local-ai-review', localAiReviewText: event.target.value }))} placeholder="Paste local AI read-only review output here." /></label>

                <CollapsiblePanel panelId="missionConsoleOpenClawWebResearchIntakePanel" title="OpenClaw Web Research Intake V1" titleAs="h6" description={operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWebResearchIntake?.status || 'idle'} isOpen={uiLayout.missionConsoleOpenClawWebResearchIntakePanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleOpenClawWebResearchIntakePanel')}>
                  <p className="mission-console__helper-text">OpenClaw is research-only here. Pasted results are heuristic intake only and are not trusted for canon until operator review.</p>
                  <ul className="mission-console__status-list">
                    <li><strong>Intake status:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWebResearchIntake?.status || 'idle'}</li>
                    <li><strong>Web access:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWebResearchIntake?.webAccessStatus || 'unknown'} · trusted for canon {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWebResearchIntake?.resultTrustedForCanon || 'no'}</li>
                    <li><strong>Sources / valid URLs:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWebResearchIntake?.sourceCount ?? 0} / {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWebResearchIntake?.validUrlCount ?? 0}</li>
                    <li><strong>Placeholder leakage:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWebResearchIntake?.placeholderLeakageDetected || 'no'} · <strong>Forbidden leakage:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWebResearchIntake?.forbiddenLeakageDetected || 'no'}</li>
                    <li><strong>Task-frame adherence:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWebResearchIntake?.taskFrameAdherence || 'unknown'} · confidence {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWebResearchIntake?.technicalConfidence || 'unknown'}</li>
                    <li><strong>Authority:</strong> mutation {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWebResearchIntake?.mutationAuthority || 'locked'} · auto-start {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWebResearchIntake?.autoStart || 'forbidden'} · use {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWebResearchIntake?.recommendedUse || 'research-only'}</li>
                    <li><strong>Next operator action:</strong> {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWebResearchIntake?.nextOperatorAction || 'Copy the bounded prompt and paste OpenClaw results.'}</li>
                  </ul>
                  <button type="button" className={`status-panel-copy-button ${openClawWebPromptCopyState}`} onClick={() => { setBuilderWorkbenchInput((prev) => ({ ...prev, activePacketType: 'openclaw-web-research-intake', activePacketTarget: 'openclaw', openClawResearchRequested: true, openClawResearchRequestedAt: new Date().toISOString() })); copyToClipboard(operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWebResearchPrompt || '', setOpenClawWebPromptCopyState, 'MissionConsoleTile.copyOpenClawVrResearchPrompt'); }}>
                    {openClawWebPromptCopyState === COPY_STATE.SUCCESS ? 'VR Research Prompt Copied' : openClawWebPromptCopyState === COPY_STATE.FAILURE ? 'Copy VR Research Prompt failed' : 'Copy VR Research Prompt'}
                  </button>
                  <button type="button" className="status-panel-copy-button" onClick={() => setBuilderWorkbenchInput((prev) => ({ ...prev, activePacketType: 'openclaw-web-research-intake', openClawResearchJudgedAt: new Date().toISOString() }))}>Run OpenClaw Web Intake Judgement</button>
                  <label className="mission-console__field-label builder-workbench-field-label">Paste OpenClaw Web Research Result<textarea className="builder-workbench-result-textarea builder-workbench-result-textarea--openclaw-web" data-testid="openclaw-web-research-intake-result" value={builderWorkbenchInput.openClawResearchText} onChange={(event) => setBuilderWorkbenchInput((prev) => ({ ...prev, activePacketType: 'openclaw-web-research-intake', openClawResearchText: event.target.value }))} placeholder="Paste source-cited OpenClaw web research output here, or WEB_ACCESS_UNAVAILABLE." /></label>
                  <button type="button" className={`status-panel-copy-button ${openClawWebHandoffCopyState}`} onClick={() => copyToClipboard(operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawWebResearchIntake?.cleanedHandoffPacket || '', setOpenClawWebHandoffCopyState, 'MissionConsoleTile.copyOpenClawWebResearchHandoffPacket')}>
                    {openClawWebHandoffCopyState === COPY_STATE.SUCCESS ? 'Cleaned Handoff Packet Copied' : openClawWebHandoffCopyState === COPY_STATE.FAILURE ? 'Copy Cleaned Handoff Packet failed' : 'Copy Cleaned Handoff Packet'}
                  </button>
                </CollapsiblePanel>
                <label className="mission-console__field-label builder-workbench-field-label">Paste Source Pack Text<textarea className="builder-workbench-result-textarea builder-workbench-result-textarea--openclaw-source-pack" data-testid="builder-workbench-openclaw-source-pack-text" value={builderWorkbenchInput.openClawSourcePackText} onChange={(event) => setBuilderWorkbenchInput((prev) => ({ ...prev, activePacketType: 'openclaw-source-pack-runner', openClawSourcePackText: event.target.value }))} placeholder={operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSourcePackTemplate || 'SOURCE PACK START...'} /></label>
                <label className="mission-console__field-label builder-workbench-field-label">Paste Source Pack Output<textarea className="builder-workbench-result-textarea builder-workbench-result-textarea--openclaw-source-pack" data-testid="builder-workbench-openclaw-source-pack-output" value={builderWorkbenchInput.openClawSourcePackOutput} onChange={(event) => setBuilderWorkbenchInput((prev) => ({ ...prev, activePacketType: 'openclaw-source-pack-runner', openClawSourcePackOutput: event.target.value }))} placeholder="Paste OpenClaw SOURCE_PACK_STATUS / SUMMARY / USEFUL_FACTS / UNKNOWNS / RISKS / NEXT_RESEARCH_QUESTIONS / STEPHANOS_HANDOFF_PACKET output here." /></label>
                <button type="button" className="status-panel-copy-button" onClick={() => setBuilderWorkbenchInput((prev) => ({ ...prev, activePacketType: 'openclaw-source-pack-runner', openClawSourcePackIntakeButtonClicked: 'yes', openClawSourcePackJudgmentAttempted: 'yes', openClawSourcePackJudgedAt: new Date().toISOString() }))}>Run Source Pack Intake Judgment</button>
                <button type="button" className={`status-panel-copy-button ${openClawSourcePackHandoffCopyState}`} onClick={() => copyToClipboard(operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawSourcePackRunner?.cleanedSourcePackHandoff || '', setOpenClawSourcePackHandoffCopyState, 'MissionConsoleTile.copyCleanedOpenClawSourcePackHandoff')}>
                  {openClawSourcePackHandoffCopyState === COPY_STATE.SUCCESS ? 'Cleaned Source Pack Handoff Copied' : openClawSourcePackHandoffCopyState === COPY_STATE.FAILURE ? 'Copy Cleaned Source Pack Handoff failed' : 'Copy Cleaned Source Pack Handoff'}
                </button>
                <label className="mission-console__field-label builder-workbench-field-label">Paste OpenClaw Research / Patch Plan Result<textarea className="builder-workbench-result-textarea builder-workbench-result-textarea--openclaw" data-testid="builder-workbench-openclaw-research-result" value={builderWorkbenchInput.openClawResearchText} onChange={(event) => setBuilderWorkbenchInput((prev) => ({ ...prev, activePacketType: 'openclaw-research-patch-plan', openClawResearchText: event.target.value }))} placeholder="Paste OpenClaw research or patch plan output here." /></label>
                <button type="button" className="status-panel-copy-button" onClick={() => setBuilderWorkbenchInput((prev) => ({ ...prev, activePacketType: 'openclaw-patch-planner', openClawPatchPlanJudgedAt: new Date().toISOString() }))}>Run Patch Plan Intake Judgment</button>
                <button type="button" className={`status-panel-copy-button ${openClawPatchPlannerHandoffCopyState}`} onClick={() => copyToClipboard(operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.openClawPatchPlanner?.cleanedPatchPlanHandoff || '', setOpenClawPatchPlannerHandoffCopyState, 'MissionConsoleTile.copyCleanedOpenClawPatchPlanHandoff')}>
                  {openClawPatchPlannerHandoffCopyState === COPY_STATE.SUCCESS ? 'Cleaned Patch Plan Handoff Copied' : openClawPatchPlannerHandoffCopyState === COPY_STATE.FAILURE ? 'Copy Cleaned Patch Plan Handoff failed' : 'Copy Cleaned Patch Plan Handoff'}
                </button>
                <button type="button" className="status-panel-copy-button" onClick={() => setShowBuilderWorkbenchVerdict((value) => !value)}>{showBuilderWorkbenchVerdict ? 'Hide Workbench Verdict' : 'Show Workbench Verdict'}</button>
                {showBuilderWorkbenchVerdict ? <div className="builder-workbench-output-card builder-workbench-output-card--parsed" data-workbench-output-viewport="parsed-verdict"><strong>Parsed verdict output</strong><pre className="builder-workbench-parsed-output" data-testid="builder-workbench-parsed-verdict">{JSON.stringify(operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection || {}, null, 2)}</pre></div> : null}
                <button type="button" className={`status-panel-copy-button ${operatorChecklistCopyState}`} onClick={() => copyToClipboard(JSON.stringify(operatorReliefProjection.builderMeshProjection?.copyPackets?.operatorApprovalChecklist || {}, null, 2), setOperatorChecklistCopyState, 'MissionConsoleTile.copyBuilderWorkbenchOperatorApprovalChecklist')}>
                  {operatorChecklistCopyState === COPY_STATE.SUCCESS ? 'Operator Approval Checklist Copied' : operatorChecklistCopyState === COPY_STATE.FAILURE ? 'Copy Operator Approval Checklist failed' : 'Copy Operator Approval Checklist'}
                </button>
                {operatorReliefProjection.builderMeshProjection?.builderWorkbenchProjection?.codexFallbackStillNeeded ? (
                  <button type="button" className={`status-panel-copy-button ${codexFallbackPacketCopyState}`} onClick={() => copyToClipboard(JSON.stringify(operatorReliefProjection.builderMeshProjection?.copyPackets?.codexFallbackPacket || {}, null, 2), setCodexFallbackPacketCopyState, 'MissionConsoleTile.copyBuilderWorkbenchCodexFallbackPacket')}>
                    {codexFallbackPacketCopyState === COPY_STATE.SUCCESS ? 'Codex Fallback Packet Copied' : codexFallbackPacketCopyState === COPY_STATE.FAILURE ? 'Copy Codex Fallback Packet failed' : 'Copy Codex Fallback Packet'}
                  </button>
                ) : null}
              </CollapsiblePanel>
              <button type="button" className={`status-panel-copy-button ${githubPrInspectionPacketCopyState}`} onClick={() => copyToClipboard(JSON.stringify(operatorReliefProjection.builderMeshProjection?.copyPackets?.githubInspectionPacket || {}, null, 2), setGithubPrInspectionPacketCopyState, 'MissionConsoleTile.copyBuilderMeshGithubInspectionPacket')}>
                {githubPrInspectionPacketCopyState === COPY_STATE.SUCCESS ? 'GitHub Inspection Packet Copied' : githubPrInspectionPacketCopyState === COPY_STATE.FAILURE ? 'Copy GitHub Inspection Packet failed' : 'Copy GitHub Inspection Packet'}
              </button>
            </CollapsiblePanel>
            <ul className="mission-console__status-list">
              <li><strong>Builder harness status:</strong> {operatorReliefProjection.builderHarnessProjection?.builderHarnessStatus || 'unknown'}</li>
              <li><strong>Can OpenClaw build?</strong> {operatorReliefProjection.builderHarnessProjection?.canOpenClawBuild || 'unknown'}</li>
              <li><strong>Can local AIs help?</strong> {operatorReliefProjection.builderHarnessProjection?.canLocalAisHelp || 'unknown'} · {operatorReliefProjection.builderHarnessProjection?.connectedLocalAiStatus || 'unknown'}</li>
              <li><strong>Can GitHub be inspected?</strong> {operatorReliefProjection.builderHarnessProjection?.canGithubBeInspected || 'unknown'} · {operatorReliefProjection.builderHarnessProjection?.githubIntegrationStatus || 'unknown'}</li>
              <li><strong>Can a patch be proposed?</strong> {operatorReliefProjection.builderHarnessProjection?.canPatchBeProposed || 'unknown'} · {operatorReliefProjection.builderHarnessProjection?.patchPlanningCapability || 'unknown'}</li>
              <li><strong>What approval is needed?</strong> {operatorReliefProjection.builderHarnessProjection?.approvalNeeded || 'Operator approval required before mutation, execution, or merge.'}</li>
              <li><strong>Repo inspection capability:</strong> {operatorReliefProjection.builderHarnessProjection?.repoInspectionCapability || 'unknown'}</li>
              <li><strong>Test execution capability:</strong> {operatorReliefProjection.builderHarnessProjection?.testExecutionCapability || 'unknown'}</li>
              <li><strong>Browser proof capability:</strong> {operatorReliefProjection.builderHarnessProjection?.browserProofCapability || 'unknown'}</li>
              <li><strong>Next best action:</strong> {operatorReliefProjection.builderHarnessProjection?.nextBestAction || 'Review builder harness readiness.'}</li>
              <li><strong>Mutation allowed:</strong> {operatorReliefProjection.builderHarnessProjection?.mutationAllowed ? 'yes' : 'no'}</li>
              <li><strong>No auto-merge:</strong> {operatorReliefProjection.builderHarnessProjection?.noAutoMerge ? 'yes' : 'unknown'}</li>
              <li><strong>Warnings:</strong> {(operatorReliefProjection.builderHarnessProjection?.warnings || []).join(' · ') || 'none'}</li>
              <li><strong>Blockers:</strong> {(operatorReliefProjection.builderHarnessProjection?.blockers || []).join(' · ') || 'none'}</li>
            </ul>
            <button type="button" className={`status-panel-copy-button ${localAiReviewPacketCopyState}`} onClick={() => copyToClipboard(JSON.stringify(operatorReliefProjection.builderHarnessProjection?.copyLocalAiReviewPacket || {}, null, 2), setLocalAiReviewPacketCopyState, 'MissionConsoleTile.copyLocalAiReviewPacket')}>
              {localAiReviewPacketCopyState === COPY_STATE.SUCCESS ? 'Local AI Review Packet Copied' : localAiReviewPacketCopyState === COPY_STATE.FAILURE ? 'Copy Local AI Review Packet failed' : 'Copy Local AI Review Packet'}
            </button>
            <button type="button" className={`status-panel-copy-button ${openClawPatchPlanPacketCopyState}`} onClick={() => copyToClipboard(JSON.stringify(operatorReliefProjection.builderHarnessProjection?.copyOpenClawPatchPlanPacket || {}, null, 2), setOpenClawPatchPlanPacketCopyState, 'MissionConsoleTile.copyOpenClawPatchPlanPacket')}>
              {openClawPatchPlanPacketCopyState === COPY_STATE.SUCCESS ? 'OpenClaw Patch Plan Packet Copied' : openClawPatchPlanPacketCopyState === COPY_STATE.FAILURE ? 'Copy OpenClaw Patch Plan Packet failed' : 'Copy OpenClaw Patch Plan Packet'}
            </button>
            <button type="button" className={`status-panel-copy-button ${githubPrInspectionPacketCopyState}`} onClick={() => copyToClipboard(JSON.stringify(operatorReliefProjection.builderHarnessProjection?.copyGithubPrInspectionPacket || {}, null, 2), setGithubPrInspectionPacketCopyState, 'MissionConsoleTile.copyGithubPrInspectionPacket')}>
              {githubPrInspectionPacketCopyState === COPY_STATE.SUCCESS ? 'GitHub PR Inspection Packet Copied' : githubPrInspectionPacketCopyState === COPY_STATE.FAILURE ? 'Copy GitHub PR Inspection Packet failed' : 'Copy GitHub PR Inspection Packet'}
            </button>
            <button type="button" className={`status-panel-copy-button ${codexFallbackPacketCopyState}`} onClick={() => copyToClipboard(JSON.stringify(operatorReliefProjection.builderHarnessProjection?.copyCodexFallbackPacket || {}, null, 2), setCodexFallbackPacketCopyState, 'MissionConsoleTile.copyCodexFallbackPacket')}>
              {codexFallbackPacketCopyState === COPY_STATE.SUCCESS ? 'Codex Fallback Packet Copied' : codexFallbackPacketCopyState === COPY_STATE.FAILURE ? 'Copy Codex Fallback Packet failed' : 'Copy Codex Fallback Packet'}
            </button>
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
          <CollapsiblePanel panelId="missionConsoleCodexChangeSummaryPanel" title="Codex Change Summary" titleAs="h5" description={operatorReliefProjection.codex.prTitle || 'No PR change summary yet'} isOpen={uiLayout.missionConsoleCodexChangeSummaryPanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleCodexChangeSummaryPanel')}>
            <p className="compact-feed-summary"><strong>PR:</strong> {operatorReliefProjection.codex.prTitle} · <strong>Branch:</strong> {operatorReliefProjection.codex.branch}</p>
            <p>{operatorReliefProjection.codex.deltaSummary}</p>
          </CollapsiblePanel>
          <CollapsiblePanel panelId="missionConsoleTestsBuildVerifyPanel" title="Tests / Build / Verify Evidence" titleAs="h5" description={`Passed ${operatorReliefProjection.tests.passed} · Failed ${operatorReliefProjection.tests.failed}`} isOpen={uiLayout.missionConsoleTestsBuildVerifyPanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleTestsBuildVerifyPanel')}>
            <p className="compact-feed-summary">Required tests: {operatorReliefProjection.tests.required.length} · Passed: {operatorReliefProjection.tests.passed} · Failed: {operatorReliefProjection.tests.failed}</p>
            <p>Build: {operatorReliefProjection.tests.buildPassed ? 'passed' : 'not-passed'} · Verify: {operatorReliefProjection.tests.verifyPassed ? 'passed' : 'not-passed'}</p>
          </CollapsiblePanel>
          <CollapsiblePanel panelId="missionConsoleBrowserProofChecklistPanel" title="Browser Proof Checklist" titleAs="h5" description={`${operatorReliefProjection.browserProof.missingItems?.length || 0} missing`} isOpen={uiLayout.missionConsoleBrowserProofChecklistPanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleBrowserProofChecklistPanel')}>
            <p className="compact-feed-summary">Required: {operatorReliefProjection.browserProof.required ? 'yes' : 'no'} · Missing: {operatorReliefProjection.browserProof.missingItems?.length || 0}</p>
            <ul className="compact-feed-list">{(operatorReliefProjection.browserProof.missingItems || []).map((item) => <li key={item}>{item}</li>)}{(operatorReliefProjection.browserProof.missingItems || []).length === 0 ? <li>No recent activity</li> : null}</ul>
          </CollapsiblePanel>
          <CollapsiblePanel panelId="missionConsoleRuntimeEvidenceWarningsPanel" title="Runtime Evidence and Warnings" titleAs="h5" description={`${operatorReliefProjection.runtimeEvidence.warnings.length} warning(s)`} isOpen={uiLayout.missionConsoleRuntimeEvidenceWarningsPanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleRuntimeEvidenceWarningsPanel')}>
            <p className="compact-feed-summary">Route: {operatorReliefProjection.runtimeEvidence.routeStatus} · Provider: {operatorReliefProjection.runtimeEvidence.providerStatus} · Tile readiness: {operatorReliefProjection.runtimeEvidence.tileStatus}</p>
            <ul className="compact-feed-list">{operatorReliefProjection.runtimeEvidence.warnings.map((warn) => <li key={warn}>{warn}</li>)}{operatorReliefProjection.runtimeEvidence.warnings.length === 0 ? <li>No recent activity</li> : null}</ul>
          </CollapsiblePanel>
          <CollapsiblePanel panelId="missionConsoleMergeSafetyVerdictPanel" title="Merge Safety Verdict" titleAs="h5" description={operatorReliefProjection.mergeSafety.verdict || 'pending'} isOpen={uiLayout.missionConsoleMergeSafetyVerdictPanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleMergeSafetyVerdictPanel')}>
            <p>{operatorReliefProjection.mergeSafety.verdict === 'safe-to-merge' ? 'Merge candidate — operator approval required' : operatorReliefProjection.mergeSafety.verdict}</p>
          </CollapsiblePanel>
          <CollapsiblePanel panelId="missionConsoleNextBestActionPanel" title="Next Best Action" titleAs="h5" description={operatorReliefProjection.nextBestAction?.label || 'Review mission evidence'} isOpen={uiLayout.missionConsoleNextBestActionPanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleNextBestActionPanel')}>
            <p><strong>{operatorReliefProjection.nextBestAction?.label || 'Review mission evidence'}</strong> — {operatorReliefProjection.nextBestAction?.reason}</p>
            <ul className="compact-feed-list">{operatorReliefProjection.nextActions.slice(1).map((action) => <li key={action.id}>{action.label}: {action.reason}</li>)}{operatorReliefProjection.nextActions.slice(1).length === 0 ? <li>No recent activity</li> : null}</ul>
          </CollapsiblePanel>
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
          <CollapsiblePanel panelId="missionConsoleLessonCandidatesPanel" title="Lesson Candidates" titleAs="h5" description={`${operatorReliefProjection.lessonCandidates.length} candidate(s)`} isOpen={uiLayout.missionConsoleLessonCandidatesPanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleLessonCandidatesPanel')}>
            <ul className="compact-feed-list">{operatorReliefProjection.lessonCandidates.map((candidate) => <li key={candidate.id}>{candidate.title} (approval required)</li>)}{operatorReliefProjection.lessonCandidates.length === 0 ? <li>No recent activity</li> : null}</ul>
          </CollapsiblePanel>
          <CollapsiblePanel
            panelId="missionConsoleEvidenceGapsPanel"
            title="Evidence Gaps / Proof Requirements"
            isOpen={evidenceGapsPanelOpen}
            onToggle={() => dispatchPanelToggle('missionConsoleEvidenceGapsPanel')}
          >
          <h5>Evidence Gaps</h5>
          <ul>{(operatorReliefProjection.evidenceGaps || []).map((gap) => <li key={gap.id}><strong>{gap.label}</strong>: {gap.reason}</li>)}</ul>
          </CollapsiblePanel>
          <CollapsiblePanel panelId="missionConsoleOperatorDecisionQueuePanel" title="Operator Decision Queue" titleAs="h5" description={`${(operatorReliefProjection.operatorDecisionQueue || []).length} pending`} isOpen={uiLayout.missionConsoleOperatorDecisionQueuePanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleOperatorDecisionQueuePanel')}>
            <p className="compact-feed-summary">Decision required: {(operatorReliefProjection.operatorDecisionQueue || []).length > 0 ? 'yes' : 'no'}</p>
            <ul className="compact-feed-list">{(operatorReliefProjection.operatorDecisionQueue || []).map((decision) => <li key={decision.id}>{decision.label} — recommended: {decision.recommendedChoice}</li>)}{(operatorReliefProjection.operatorDecisionQueue || []).length === 0 ? <li>No recent activity</li> : null}</ul>
          </CollapsiblePanel>
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

      <section className="mission-console-section mission-console-section--assistant-console" style={getMissionConsoleSectionOrderStyle('missionConsoleAssistantCommandConsolePanel')}>
        <CollapsiblePanel
          panelId="missionConsoleAssistantCommandConsolePanel"
          title="Assistant Command Console"
          isOpen={uiLayout.missionConsoleAssistantCommandConsolePanel !== false}
          onToggle={() => dispatchPanelToggle('missionConsoleAssistantCommandConsolePanel')}
          actions={getMissionConsoleMoveControls('missionConsoleAssistantCommandConsolePanel')}
          keepMountedWhenClosed
        >
          <AIConsole
            surfaceOwnerKey="mission-console-section"
            panelId="aiCoreMissionConsolePanel"
            input={sharedConsoleInput}
            setInput={setSharedConsoleInput}
            submitPrompt={(rawPrompt) => submitPrompt?.(rawPrompt, { orchestrationTruth, submissionSource: 'stephanos-mission-console', submissionRoute: 'assistant-router' })}
            cancelActivePrompt={cancelActivePrompt}
            emergencyReleaseOllamaLoad={emergencyReleaseOllamaLoad}
            commandHistory={sharedCommandHistory}
          />
        </CollapsiblePanel>
      </section>

      <section className="mission-console-section mission-console-section--secondary" style={getMissionConsoleSectionOrderStyle('missionConsoleSecondaryDiagnosticsPanel')}>
        <CollapsiblePanel
          panelId="missionConsoleSecondaryDiagnosticsPanel"
          title="Secondary Diagnostics"
          isOpen={uiLayout.missionConsoleSecondaryDiagnosticsPanel !== false}
          onToggle={() => dispatchPanelToggle('missionConsoleSecondaryDiagnosticsPanel')}
          actions={getMissionConsoleMoveControls('missionConsoleSecondaryDiagnosticsPanel')}
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

      <section className="mission-console-section" style={getMissionConsoleSectionOrderStyle('missionConsoleConnectedTileContextsPanel')}>
        <CollapsiblePanel
          panelId="missionConsoleConnectedTileContextsPanel"
          title="Connected Tile Contexts (advanced)"
          isOpen={uiLayout.missionConsoleConnectedTileContextsPanel !== false}
          onToggle={() => dispatchPanelToggle('missionConsoleConnectedTileContextsPanel')}
          actions={getMissionConsoleMoveControls('missionConsoleConnectedTileContextsPanel')}
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

      <section className="mission-console-section" style={getMissionConsoleSectionOrderStyle('missionConsoleQuickContextPanel')}>
        <CollapsiblePanel
          panelId="missionConsoleQuickContextPanel"
          title="Quick Chat Context Selector"
          isOpen={uiLayout.missionConsoleQuickContextPanel !== false}
          onToggle={() => dispatchPanelToggle('missionConsoleQuickContextPanel')}
          actions={getMissionConsoleMoveControls('missionConsoleQuickContextPanel')}
        >
          <select className="paneSelect paneControl" value={contextScope} onChange={(event) => setContextScope(event.target.value)}>
            <option value="whole-stephanos">Whole Stephanos</option>
            <option value="music">Music Tile</option>
            <option value="openclaw">OpenClaw</option>
            <option value="codex">Codex/PRs</option>
            <option value="route-health">Route Health</option>
            <option value="runtime-diagnostics">Runtime Diagnostics</option>
          </select>
        </CollapsiblePanel>
      </section>

      <section className="mission-console-section" style={getMissionConsoleSectionOrderStyle('missionConsoleRoutingControlsPanel')}>
        <CollapsiblePanel
          panelId="missionConsoleRoutingControlsPanel"
          title="Addressing / Routing Controls"
          isOpen={uiLayout.missionConsoleRoutingControlsPanel !== false}
          onToggle={() => dispatchPanelToggle('missionConsoleRoutingControlsPanel')}
          actions={getMissionConsoleMoveControls('missionConsoleRoutingControlsPanel')}
        >
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
        </CollapsiblePanel>
      </section>

      <section className="mission-console-section mission-console-section--intent-to-build-loop" style={getMissionConsoleSectionOrderStyle('missionConsoleIntentToBuildPanel')}>
        <CollapsiblePanel
          panelId="missionConsoleIntentToBuildPanel"
          title="Intent-to-Build Control Loop"
          description={`Mission ${intentToBuild.missionSpec.missionId || 'pending'} · status ${intentToBuild.missionSpec.missionStatus || 'draft'} · next ${intentToBuild.missionSpec.nextBestAction || 'generate spec'}`}
          isOpen={uiLayout.missionConsoleIntentToBuildPanel !== false}
          onToggle={() => dispatchPanelToggle('missionConsoleIntentToBuildPanel')}
          actions={getMissionConsoleMoveControls('missionConsoleIntentToBuildPanel')}
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

      <section className="mission-console-section" style={getMissionConsoleSectionOrderStyle('missionConsoleAgentAssignmentMatrixPanel')}>
        <CollapsiblePanel panelId="missionConsoleAgentAssignmentMatrixPanel" title="Agent Assignment Matrix" isOpen={uiLayout.missionConsoleAgentAssignmentMatrixPanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleAgentAssignmentMatrixPanel')} actions={getMissionConsoleMoveControls('missionConsoleAgentAssignmentMatrixPanel')}>

        <dl className="mission-console-compact-summary-grid" aria-label="Agent Assignment Matrix summary">
          <div><dt>assignments</dt><dd>{agentAssignmentMatrix.summary.assignmentCount}</dd></div>
          <div><dt>active roles</dt><dd>{agentAssignmentMatrix.summary.activeRoleCount}</dd></div>
          <div><dt>lead</dt><dd>{agentAssignmentMatrix.summary.recommendedLeadRole}</dd></div>
          <div><dt>openclaw</dt><dd>{agentAssignmentMatrix.summary.openClawAssigned ? 'yes' : 'no'}</dd></div>
          <div><dt>codex</dt><dd>{agentAssignmentMatrix.summary.codexAssigned ? 'yes' : 'no'}</dd></div>
          <div><dt>approval</dt><dd>{agentAssignmentMatrix.summary.operatorApprovalRequired ? 'required' : 'clear'}</dd></div>
          <div><dt>high risk</dt><dd>{agentAssignmentMatrix.summary.highRiskAssignmentCount}</dd></div>
        </dl>
        <ul className="mission-console__status-list mission-console-agent-matrix-list" aria-label="Agent Assignment Matrix compact rows">
          {(agentAssignmentMatrix.assignments || []).slice(0, 8).map((assignment) => (
            <li key={assignment.assignmentId} className="mission-console-agent-matrix-row"><strong>{assignment.roleLabel}</strong><span>{assignment.responsibility}</span><span>authority: {assignment.authorityLevel}</span><span>allow: {(assignment.allowedActions || []).join(', ') || 'none'}</span><span>block: {(assignment.blockedActions || []).slice(0, 3).join(', ') || 'none'}</span><span>output: {assignment.outputExpected}</span><span>next: {assignment.nextAction}</span></li>
          ))}
        </ul>
        </CollapsiblePanel>
      </section>
      <section className="mission-console-section" style={getMissionConsoleSectionOrderStyle('missionConsoleRoutingReadinessPanel')}>
        <CollapsiblePanel panelId="missionConsoleRoutingReadinessPanel" title="Mission Routing / Delegation Readiness" isOpen={uiLayout.missionConsoleRoutingReadinessPanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleRoutingReadinessPanel')} actions={getMissionConsoleMoveControls('missionConsoleRoutingReadinessPanel')}>

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
        </CollapsiblePanel>
      </section>
      <section className="mission-console-section" style={getMissionConsoleSectionOrderStyle('missionConsolePrEvidencePanel')}>
        <CollapsiblePanel panelId="missionConsolePrEvidencePanel" title="PR Evidence Input" isOpen={uiLayout.missionConsolePrEvidencePanel !== false} onToggle={() => dispatchPanelToggle('missionConsolePrEvidencePanel')} actions={getMissionConsoleMoveControls('missionConsolePrEvidencePanel')}>

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
        </CollapsiblePanel>
      </section>
      <section className="mission-console-section" style={getMissionConsoleSectionOrderStyle('missionConsoleEvidenceLedgerPanel')}>
        <CollapsiblePanel panelId="missionConsoleEvidenceLedgerPanel" title="Mission Evidence Ledger" isOpen={uiLayout.missionConsoleEvidenceLedgerPanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleEvidenceLedgerPanel')} actions={getMissionConsoleMoveControls('missionConsoleEvidenceLedgerPanel')}>

        <ul className="mission-console__status-list">
          <li><strong>evidence completeness:</strong> {missionEvidenceLedger.summary.evidenceCompleteness}</li>
          <li><strong>latest event:</strong> {missionEvidenceLedger.summary.latestEventType}</li>
          <li><strong>warnings / blockers:</strong> {missionEvidenceLedger.summary.warningCount} / {missionEvidenceLedger.summary.blockerCount}</li>
          <li><strong>pending operator review:</strong> {missionEvidenceLedger.summary.pendingOperatorReviewCount}</li>
          <li><strong>next required evidence:</strong> {missionEvidenceLedger.summary.nextRequiredEvidence}</li>
          <li><strong>readiness narrative:</strong> {missionEvidenceLedger.summary.missionReadyNarrative}</li>
        </ul>
        <ul className="mission-console__status-list compact-feed-list" aria-label="Mission Evidence Ledger compact event rows">
          {(missionEvidenceLedger.entries || []).slice(0, 6).map((entry) => (
            <li key={entry.entryId} className="compact-feed-row"><time>{entry.timestamp || entry.createdAt || 'pending'}</time><span className={`status-chip status-${String(entry.severity || entry.status || 'info').toLowerCase()}`}>{entry.eventType}</span><p>{entry.summary}</p></li>
          ))}
          {(missionEvidenceLedger.entries || []).length === 0 ? <li className="compact-feed-row compact-feed-row--empty"><time>idle</time><span className="status-chip status-info">empty</span><p>No recent activity</p></li> : null}
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
        </CollapsiblePanel>
      </section>

      <section className="mission-console-section" style={getMissionConsoleSectionOrderStyle('missionConsoleMissionIntelligencePanel')}>
        <CollapsiblePanel panelId="missionConsoleMissionIntelligencePanel" title="Mission Intelligence Brief" isOpen={uiLayout.missionConsoleMissionIntelligencePanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleMissionIntelligencePanel')} actions={getMissionConsoleMoveControls('missionConsoleMissionIntelligencePanel')}>

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
        </CollapsiblePanel>
      </section>


      <section className="mission-console-section" style={getMissionConsoleSectionOrderStyle('missionConsoleRealityUpgradePanel')}>
        <CollapsiblePanel panelId="missionConsoleRealityUpgradePanel" title="Reality Upgrade Orchestrator v1" isOpen={uiLayout.missionConsoleRealityUpgradePanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleRealityUpgradePanel')} actions={getMissionConsoleMoveControls('missionConsoleRealityUpgradePanel')}>

        <p><strong>Upgrade intent:</strong> {runtimeStatusModel?.realityUpgradeOrchestrator?.upgradeIntent || 'Awaiting intent'}</p>
        <p><strong>Affected system area:</strong> {runtimeStatusModel?.realityUpgradeOrchestrator?.affectedSystemArea || 'unknown'}</p>
        <p><strong>Current stage:</strong> {runtimeStatusModel?.realityUpgradeOrchestrator?.supportSnapshot?.activeMissionStage || 'none'}</p>
        <p><strong>Recommended crew of minds:</strong> {(runtimeStatusModel?.realityUpgradeOrchestrator?.recommendedMinds || []).map((mind) => mind.displayName).join(' | ') || 'none yet'}</p>
        <p><strong>Approval checkpoints:</strong> {(runtimeStatusModel?.realityUpgradeOrchestrator?.approvalCheckpoints || []).join(' | ') || 'none'}</p>
        <p><strong>Verification contract:</strong> {(runtimeStatusModel?.realityUpgradeOrchestrator?.verificationContract?.checks || []).join(' | ') || 'none'}</p>
        <button type="button" onClick={() => copyToClipboard(JSON.stringify(runtimeStatusModel?.realityUpgradeOrchestrator || {}, null, 2), setSpecCopyState)}>Generate Codex Handoff Packet</button>
        </CollapsiblePanel>
      </section>

      <section className="mission-console-section" style={getMissionConsoleSectionOrderStyle('missionConsoleConversationWorkspacePanel')}>
        <CollapsiblePanel panelId="missionConsoleConversationWorkspacePanel" title="Conversation Workspace" isOpen={uiLayout.missionConsoleConversationWorkspacePanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleConversationWorkspacePanel')} actions={getMissionConsoleMoveControls('missionConsoleConversationWorkspacePanel')} keepMountedWhenClosed>

        <div className="mission-console-ledger">
          {messages.map((message) => (
            <article key={message.id} className={`mission-console-message compact-feed-row mission-console-message-${message.role}`}>
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
        </CollapsiblePanel>
      </section>

      <section className="mission-console-section" style={getMissionConsoleSectionOrderStyle('missionConsoleAgentCommandPanel')}>
        <CollapsiblePanel panelId="missionConsoleAgentCommandPanel" title="Agent Command Console Mission Card" isOpen={uiLayout.missionConsoleAgentCommandPanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleAgentCommandPanel')} actions={getMissionConsoleMoveControls('missionConsoleAgentCommandPanel')}>

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
        </CollapsiblePanel>
      </section>

      <section className="mission-console-section" style={getMissionConsoleSectionOrderStyle('missionConsoleSharedAgentContextPanel')}>
        <CollapsiblePanel panelId="missionConsoleSharedAgentContextPanel" title="Shared Agent Context Panel" isOpen={uiLayout.missionConsoleSharedAgentContextPanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleSharedAgentContextPanel')} actions={getMissionConsoleMoveControls('missionConsoleSharedAgentContextPanel')}>

        <ul>
          <li><strong>active / visible agents:</strong> {visibleAgents.map((agent) => agent.agentId).join(', ') || 'none visible'}</li>
          <li><strong>currently acting agent:</strong> {actingAgentId}</li>
          <li><strong>last handoff:</strong> {lastHandoff}</li>
          <li><strong>current agent summary:</strong> {currentAgentSummary}</li>
          <li><strong>selected agent:</strong> {selectedAgentId}</li>
          <li><strong>active agents:</strong> {activeAgentIds.join(', ') || 'none'}</li>
        </ul>
        </CollapsiblePanel>
      </section>

      <section className="mission-console-section" style={getMissionConsoleSectionOrderStyle('missionConsoleProposalApprovalRailPanel')}>
        <CollapsiblePanel panelId="missionConsoleProposalApprovalRailPanel" title="Proposal / Approval Rail" isOpen={uiLayout.missionConsoleProposalApprovalRailPanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleProposalApprovalRailPanel')} actions={getMissionConsoleMoveControls('missionConsoleProposalApprovalRailPanel')}>

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
        </CollapsiblePanel>
      </section>

      <section className="mission-console-section" style={getMissionConsoleSectionOrderStyle('missionConsoleIntegrationTopologyPanel')}>
        <CollapsiblePanel panelId="missionConsoleIntegrationTopologyPanel" title="Integration Topology in Agent Mission Console" isOpen={uiLayout.missionConsoleIntegrationTopologyPanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleIntegrationTopologyPanel')} actions={getMissionConsoleMoveControls('missionConsoleIntegrationTopologyPanel')}>

        <p>{openClawIntegration.topology.map((node) => node.label).join(' -> ')}</p>
        <ul>
          {openClawIntegration.topology.map((node) => <li key={node.id}><strong>{node.label}:</strong> {node.policyNote}</li>)}
        </ul>
        </CollapsiblePanel>
      </section>

      <section className="mission-console-section" style={getMissionConsoleSectionOrderStyle('missionConsoleGuardrailsPanel')}>
        <CollapsiblePanel panelId="missionConsoleGuardrailsPanel" title="Guardrails" isOpen={uiLayout.missionConsoleGuardrailsPanel !== false} onToggle={() => dispatchPanelToggle('missionConsoleGuardrailsPanel')} actions={getMissionConsoleMoveControls('missionConsoleGuardrailsPanel')}>

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
        </CollapsiblePanel>
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
