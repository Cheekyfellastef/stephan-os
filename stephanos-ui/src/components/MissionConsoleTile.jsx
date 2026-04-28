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
import { createIntentToBuildState, INTENT_TO_BUILD_BOUNDARIES } from '../state/intentToBuildModel.js';
import { createMissionBridgeState, processMissionBridgeIntent, requestMissionBridgeAI } from '../state/missionBridge.js';

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
      openClawNextAction: summary.openClawNextAction || operatorSurface.openClawNextAction || 'not reported',
      openClawAdapterMode: summary.openClawAdapterMode || operatorSurface.openClawAdapterMode || 'design_only',
      openClawAdapterReadiness: summary.openClawAdapterReadiness || operatorSurface.openClawAdapterReadiness || 'needs_contract',
      openClawAdapterConnectionState: summary.openClawAdapterConnectionState || operatorSurface.openClawAdapterConnectionState || 'not_configured',
      openClawAdapterExecutionMode: summary.openClawAdapterExecutionMode || operatorSurface.openClawAdapterExecutionMode || 'disabled',
      openClawAdapterCanExecute: pickBoolean(summary.openClawAdapterCanExecute, operatorSurface.openClawAdapterCanExecute),
      openClawAdapterNextAction: summary.openClawAdapterNextAction || operatorSurface.openClawAdapterNextAction || 'not reported',
      openClawAdapterStubStatus: summary.openClawAdapterStubStatus || operatorSurface.openClawAdapterStubStatus || 'unknown',
      openClawAdapterStubHealth: summary.openClawAdapterStubHealth || operatorSurface.openClawAdapterStubHealth || 'unknown',
      openClawAdapterStubConnectionState: summary.openClawAdapterStubConnectionState || operatorSurface.openClawAdapterStubConnectionState || 'unknown',
      openClawAdapterStubCanExecute: pickBoolean(summary.openClawAdapterStubCanExecute, operatorSurface.openClawAdapterStubCanExecute),
      openClawAdapterStubNextAction: summary.openClawAdapterStubNextAction || operatorSurface.openClawAdapterStubNextAction || 'not reported',
    };
  }, [agentTaskProjection]);

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
    });
  }, [intentToBuild, onIntentToBuildUpdate]);
  useEffect(() => {
    onMissionBridgeUpdate(missionBridgeState);
  }, [missionBridgeState, onMissionBridgeUpdate]);

  function addMessage(message) {
    setMessages((previous) => appendMissionConsoleMessage(previous, message));
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
        content: `Stephanos received your request in governed mode. Route truth source: ${openClawIntegration.connectedTo.routeTruthSource}.`,
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
          content: `OpenClaw mode ${openClawIntegration.mode}; authority posture ${openClawIntegration.authority}; sandbox ${openClawIntegration.sandboxStatus}.`,
          status: 'ready',
        }));
      }
    }

    setInput('');
  }

  function handleIntentInputChange(field, value) {
    setIntentInput((previous) => ({ ...previous, [field]: value }));
  }

  function generateIntentToBuildSpec() {
    const next = createIntentToBuildState(intentInput);
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
          <li><strong>verification checklist:</strong> {intentToBuild.verificationEvidence.checks.map((entry) => entry.command).join(' | ')}</li>
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
        <h5>Agent Task Verification Return (compact)</h5>
        <ul>
          <li><strong>verification return status:</strong> {compactVerificationSummary.verificationReturnStatus}</li>
          <li><strong>verification decision:</strong> {compactVerificationSummary.verificationDecision}</li>
          <li><strong>merge readiness:</strong> {compactVerificationSummary.mergeReadiness}</li>
          <li><strong>verification return next action:</strong> {compactVerificationSummary.verificationReturnNextAction}</li>
          <li><strong>highest priority blocker/warning:</strong> {compactVerificationSummary.highestPriorityIssue}</li>
          <li><strong>manual-only handoff:</strong> {compactVerificationSummary.manualOnly ? 'yes' : 'no'}</li>
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
          <li><strong>openclaw adapter connection:</strong> {compactVerificationSummary.openClawAdapterConnectionState}</li>
          <li><strong>openclaw adapter execution mode:</strong> {compactVerificationSummary.openClawAdapterExecutionMode}</li>
          <li><strong>openclaw adapter can execute:</strong> {compactVerificationSummary.openClawAdapterCanExecute ? 'yes' : 'no'}</li>
          <li><strong>openclaw adapter next action:</strong> {compactVerificationSummary.openClawAdapterNextAction}</li>
          <li><strong>openclaw adapter stub status:</strong> {compactVerificationSummary.openClawAdapterStubStatus}</li>
          <li><strong>openclaw adapter stub health:</strong> {compactVerificationSummary.openClawAdapterStubHealth}</li>
          <li><strong>openclaw adapter stub connection:</strong> {compactVerificationSummary.openClawAdapterStubConnectionState}</li>
          <li><strong>openclaw adapter stub execution disabled:</strong> {compactVerificationSummary.openClawAdapterStubCanExecute ? 'no (unexpected)' : 'yes'}</li>
          <li><strong>openclaw adapter stub next action:</strong> {compactVerificationSummary.openClawAdapterStubNextAction}</li>
          <li><strong>openclaw policy notice:</strong> stub/status only, no live automation</li>
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
