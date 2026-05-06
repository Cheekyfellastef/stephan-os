import { useEffect, useMemo, useState } from 'react';
import CollapsiblePanel from './CollapsiblePanel';
import {
  OPENCLAW_AUTHORITY,
  OPENCLAW_AUTHORITY_MODEL,
  OPENCLAW_COST_POSTURE,
  OPENCLAW_EXECUTION_POSTURE,
  OPENCLAW_MODE,
  OPENCLAW_SCAN_MODES,
} from './openclaw/openclawTilePolicy.js';
import { buildOpenClawGuardrailSnapshot, isOpenClawActionBlocked } from './openclaw/openclawGuardrails.js';
import { runOpenClawScan } from './openclaw/openclawScanController.js';
import { buildOpenClawIntegrationSnapshot } from './openclaw/openclawIntegrationAdapter.js';
import { buildOpenClawCandidatePrompts } from './openclaw/openclawPromptGenerator.js';
import { appendAuditEvent, createAuditEvent } from './openclaw/openclawAuditModel.js';
import { resolveReadonlyValidationEndpoint } from '../utils/openClawEndpointConfig.js';
import { clearOpenClawReviewDecision, loadOpenClawReviewDecisions, saveOpenClawReviewDecision } from '../../../shared/agents/openClawReviewDecisionStore.mjs';
import { buildOpenClawEvidenceAttachment } from '../../../shared/agents/openClawEvidenceAttachment.mjs';
import { clearOpenClawCodexReviewResult, loadOpenClawCodexReviewResults, saveOpenClawCodexReviewResult } from '../../../shared/agents/openClawCodexReviewResultStore.mjs';


function getCodexExportRiskPresentation(canonicalRiskLevel = '') {
  const riskLevel = String(canonicalRiskLevel || 'guarded').toLowerCase();
  if (['low', 'review_only', 'review-only', 'readonly', 'read_only'].includes(riskLevel)) {
    return {
      toneClass: 'openclaw-codex-preview--low',
      riskLabel: 'Risk: low',
      policyLabel: 'Review-only, execution disabled.',
      blockedWarning: null,
    };
  }
  if (['blocked', 'high', 'critical', 'red'].includes(riskLevel)) {
    return {
      toneClass: 'openclaw-codex-preview--high',
      riskLabel: riskLevel === 'blocked' ? 'Risk: blocked' : 'Risk: high',
      policyLabel: 'Blocked / do not execute. Review-only export path.',
      blockedWarning: 'Blocked / do not execute.',
    };
  }
  return {
    toneClass: 'openclaw-codex-preview--guarded',
    riskLabel: 'Risk: guarded',
    policyLabel: 'Guarded proposal. Review-only, execution disabled.',
    blockedWarning: null,
  };
}

function getTone(status = '') {
  return status === 'blocked' ? 'blocked' : 'allowed';
}

const OPENCLAW_STAGE_ORDER = ['validation_required', 'capability_trial_ready', 'proposal_packet_ready', 'operator_review', 'evidence_needed', 'codex_review_intake', 'implementation_planning', 'approval_readiness', 'dry_run_preview', 'future_execution_gated'];

function resolveOpenClawCurrentStage(operatorTask = {}) {
  if (OPENCLAW_STAGE_ORDER.includes(operatorTask?.openClawCurrentStage)) return operatorTask.openClawCurrentStage;
  if (operatorTask?.openClawControlledExecutionGate?.controlledExecutionStatus === 'future_gated') return 'future_execution_gated';
  if (operatorTask?.openClawDryRunPlan?.dryRunStatus && operatorTask?.openClawDryRunPlan?.dryRunStatus !== 'unavailable') return 'dry_run_preview';
  if (operatorTask?.openClawApprovalGateReadiness?.approvalReadinessStatus) return 'approval_readiness';
  if (operatorTask?.openClawImplementationPlan?.planStatus && operatorTask?.openClawImplementationPlan?.planStatus !== 'unavailable') return 'implementation_planning';
  if (operatorTask?.openClawCodexReviewResult || operatorTask?.openClawCodexProposalExport) return 'codex_review_intake';
  if ((operatorTask?.openClawEvidenceRequest?.missingEvidence || []).length > 0) return 'evidence_needed';
  if (operatorTask?.openClawOperatorReviewQueue || operatorTask?.openClawOperatorReviewWorkflow) return 'operator_review';
  if (operatorTask?.openClawProposalPacket) return 'proposal_packet_ready';
  if (operatorTask?.openClawCapabilityTrial?.adapterValidated) return 'capability_trial_ready';
  return 'validation_required';
}

function resolveMissionPrimaryOperatorAction({ currentStage = 'validation_required', operatorTask = {}, operatorReviewQueue = null } = {}) {
  const missingEvidence = operatorTask?.openClawEvidenceRequest?.missingEvidence || [];
  if (currentStage === 'evidence_needed' || missingEvidence.length > 0) {
    return `Collect missing evidence: ${missingEvidence.join(', ') || 'evidence_request:operator_note'}`;
  }
  if (currentStage === 'operator_review') return 'Submit packet for operator review.';
  if (currentStage === 'codex_review_intake') return 'Import Codex review result.';
  if (currentStage === 'implementation_planning') return 'Review implementation planning packet.';
  if (currentStage === 'approval_readiness') return 'Review approval gate readiness.';
  if (currentStage === 'dry_run_preview') return 'Review dry-run preview.';
  if (currentStage === 'future_execution_gated') {
    return 'Keep execution disabled until future operator-approved execution design.';
  }
  return operatorReviewQueue?.nextAction || operatorTask?.openClawHealthValidationNextAction || 'Review current stage and resolve blockers.';
}

export default function OpenClawTile({
  uiLayout,
  togglePanel,
  runtimeStatusModel,
  finalRouteTruth,
  agentTaskProjection = null,
  openClawEndpointDraft = null,
  onApplyOpenClawEndpointConfig = () => {},
  onClearOpenClawEndpointConfig = () => {},
  onRequestReadonlyValidation = () => {},
  repoPath = '/workspace/stephan-os',
  branchName = 'unknown',
  onIntegrationUpdate = () => {},
}) {
  const [selectedScanType, setSelectedScanType] = useState(OPENCLAW_SCAN_MODES[0].id);
  const [scanReport, setScanReport] = useState(null);
  const [candidatePrompts, setCandidatePrompts] = useState([]);
  const [auditTrail, setAuditTrail] = useState([]);
  const [sessionState, setSessionState] = useState('idle');
  const [killSwitchEngagedUi, setKillSwitchEngagedUi] = useState(false);
  const [pauseStateUi, setPauseStateUi] = useState('resumed');
  const guardrails = useMemo(() => buildOpenClawGuardrailSnapshot(), []);

  const distParity = runtimeStatusModel?.runtimeTruth?.sourceDistParityOk;
  const distCautionVisible = distParity !== true;
  const operatorTask = agentTaskProjection?.operatorSurface || null;
  const endpointDraft = openClawEndpointDraft && typeof openClawEndpointDraft === 'object'
    ? openClawEndpointDraft
    : {
      endpointLabel: 'Local OpenClaw Adapter',
      endpointHost: '',
      endpointPort: '',
      endpointScope: 'local_only',
      expectedProtocolVersion: 'v1',
      allowedProbeTypes: 'health_and_handshake',
      configPersistenceMode: 'session_only',
      endpointMode: 'model_only',
    };
  const validationEndpointAvailable = operatorTask?.openClawReadonlyValidationEndpointAvailable === true;
  const validationStatus = operatorTask?.openClawHealthValidationStatus || 'idle';
  const resolvedValidationEndpoint = resolveReadonlyValidationEndpoint(endpointDraft);
  const validationButtonEnabled = (operatorTask?.openClawAdapterEndpointConfigured === true || resolvedValidationEndpoint.valid === true)
    && operatorTask?.openClawAdapterConnectionConfigReady === true
    && operatorTask?.openClawAdapterEndpointScope === 'local_only'
    && ['health_only', 'handshake_only', 'health_and_handshake'].includes(operatorTask?.openClawAdapterAllowedProbeTypes || 'none')
    && (operatorTask?.openClawAdapterConnectionConfigBlockers?.length || 0) === 0
    && validationEndpointAvailable
    && validationStatus !== 'running';
  const adapterHost = operatorTask?.openClawAdapterEndpointHost || endpointDraft.endpointHost || '127.0.0.1';
  const adapterPort = operatorTask?.openClawAdapterEndpointPort || endpointDraft.endpointPort || '8790';
  const adapterUnreachable = validationStatus === 'failed'
    && (operatorTask?.openClawHealthState === 'unavailable')
    && (operatorTask?.openClawHandshakeState === 'unavailable');
  const capabilityTrial = operatorTask?.openClawCapabilityTrial || null;
  const capabilityReport = operatorTask?.openClawCapabilityReport || null;
  const oversightProposal = operatorTask?.openClawOversightProposal || null;
  const validationSucceeded = capabilityTrial?.adapterValidated === true || (['succeeded', 'passed'].includes(validationStatus)
    && operatorTask?.openClawHealthState === 'passing'
    && operatorTask?.openClawHandshakeState === 'compatible'
    && (operatorTask?.openClawProtocolCompatible === true || operatorTask?.openClawHandshakeState === 'compatible')
    && operatorTask?.openClawReadonlyAssurance?.readonlyOnly === true);
  const validationFreshness = operatorTask?.openClawValidationFreshness || 'unknown';
  const validationRestoredFromStorage = operatorTask?.openClawValidationRestoredFromStorage === true;
  const validationLastCheckedAt = operatorTask?.openClawValidationLastCheckedAt || operatorTask?.openClawLastHandshakeAt || operatorTask?.openClawLastHealthCheckAt || 'unknown';
  const [trialRunRequested, setTrialRunRequested] = useState(false);
  const trialStatus = capabilityTrial?.trialStatus || (validationSucceeded ? (trialRunRequested ? 'report_ready' : 'ready') : 'not_started');
  const trialNextAction = capabilityTrial?.nextAction || (!validationSucceeded
    ? 'Validate readonly adapter first.'
    : trialStatus === 'report_ready'
      ? 'Review OpenClaw capability report.'
      : 'Run readonly capability trial.');
  const reportVisible = trialStatus === 'report_ready' || (capabilityReport && validationSucceeded);
  const operatorReviewHandoff = operatorTask?.openClawOperatorReviewHandoff || null;
  // validationSucceeded ? ( canonical lifecycle copy branch retained for truth tests.
  const operatorReviewQueue = operatorTask?.openClawOperatorReviewQueue || null;
  const operatorReviewWorkflow = operatorTask?.openClawOperatorReviewWorkflow || null;
  const [packetCopyStatus, setPacketCopyStatus] = useState('idle');
  const [reviewNote, setReviewNote] = useState('');
  const [localReviewDecision, setLocalReviewDecision] = useState(null);
  const [codexExportCopyStatus, setCodexExportCopyStatus] = useState('idle');

  const [codexReviewText, setCodexReviewText] = useState('');
  const [localCodexReviewResult, setLocalCodexReviewResult] = useState(null);
  const [codexReviewCopyStatus, setCodexReviewCopyStatus] = useState('idle');
  const [implementationPlanCopyStatus, setImplementationPlanCopyStatus] = useState('idle');
  const [dryRunCopyStatus, setDryRunCopyStatus] = useState('idle');
  const codexPromptText = operatorTask?.openClawCodexProposalExport?.codexPrompt || 'OpenClaw Codex prompt unavailable.';
  const codexRiskPresentation = getCodexExportRiskPresentation(operatorTask?.openClawProposalRisk?.riskLevel);

  const [evidenceNote, setEvidenceNote] = useState('');
  const [localEvidenceAttachments, setLocalEvidenceAttachments] = useState([]);
  const evidenceRequest = operatorTask?.openClawEvidenceRequest || null;
  const evidenceAttachments = operatorTask?.openClawEvidenceAttachments?.length ? operatorTask.openClawEvidenceAttachments : localEvidenceAttachments;

  const activePacketId = operatorReviewQueue?.activePacketId || operatorTask?.openClawProposalPacket?.packetId || 'none';
  useEffect(() => {
    const decisions = loadOpenClawReviewDecisions();
    setLocalReviewDecision(decisions[activePacketId] || null);
  }, [activePacketId]);

  useEffect(() => {
    const results = loadOpenClawCodexReviewResults();
    const restored = results[activePacketId] || null;
    setLocalCodexReviewResult(restored);
    setCodexReviewText(restored?.rawText || '');
  }, [activePacketId]);

  const effectiveCodexReviewResult = localCodexReviewResult || operatorTask?.openClawCodexReviewResult || null;

  function importCodexReviewResult() {
    const saved = saveOpenClawCodexReviewResult({
      result: { packetId: activePacketId, source: 'codex', rawText: codexReviewText, reviewSummary: codexReviewText },
    });
    setLocalCodexReviewResult(saved);
  }

  function clearCodexReviewResult() {
    clearOpenClawCodexReviewResult({ packetId: activePacketId });
    setLocalCodexReviewResult(null);
    setCodexReviewText('');
  }

  function updateReviewDecision(reviewDecision) {
    const saved = saveOpenClawReviewDecision({
      decision: { packetId: activePacketId, reviewDecision, reviewedBy: 'operator', reviewNotes: reviewNote },
    });
    setLocalReviewDecision(saved);
  }

  function record(type, details = {}) {
    setAuditTrail((previous) => appendAuditEvent(previous, createAuditEvent(type, details)));
  }

  function runScan() {
    setSessionState('scanning');
    record('scan-started', { scanType: selectedScanType });
    const report = runOpenClawScan({
      scanType: selectedScanType,
      runtimeStatusModel,
      finalRouteTruth,
      repoPath,
      branchName,
    });
    setScanReport(report);
    record('evidence-considered', {
      scanType: selectedScanType,
      categories: report.inspected.categories,
      findings: report.findings.length,
    });
    if (selectedScanType === 'candidate-codex-prompt-generation') {
      const prompts = buildOpenClawCandidatePrompts(report);
      setCandidatePrompts(prompts);
      record('prompt-generated', { count: prompts.length });
    }
    record('scan-completed', { scanType: selectedScanType });
    setSessionState('ready-for-review');
  }

  async function copyOperatorReviewPacket() {
    const active = operatorTask?.openClawProposalPacket || {};
    const lines = [
      'OpenClaw Operator Review Packet (v1)',
      `Packet summary: ${operatorTask?.openClawProposalPacket?.proposalSummary || 'none'}`,
      `Packet id: ${operatorReviewQueue?.activePacketId || active.packetId || 'none'}`,
      `Proposal type: ${active.proposalType || 'observe_capability'}`,
      `Requested outcome: ${active.requestedOutcome || 'operator_review'}`,
      `Review decision: ${effectiveReviewDecision?.reviewDecision || 'not_reviewed'}`,
      `Review notes: ${effectiveReviewDecision?.reviewNotes || 'none'}`,
      `Evidence status: ${operatorTask?.openClawProposalEvidence?.status || 'none'}`,
      `Missing evidence: ${(operatorReviewQueue?.missingEvidence || []).join(', ') || 'none'}`,
      `Current risk: ${operatorTask?.openClawProposalRisk?.riskLevel || 'guarded'}`,
      `Approval requirements: ${operatorTask?.openClawProposalApprovalRequirements?.approvalStatus || 'unknown'}`,
      `Rollback preview: ${operatorTask?.openClawProposalRollback?.rollbackStatus || 'unknown'}`,
      `Permission diff: ${operatorTask?.openClawPermissionDiff?.diffStatus || 'unknown'}`,
      `Audit preview: ${((operatorTask?.openClawAuditLedgerPreview?.length || 0) > 0 ? 'preview_ready' : 'not_generated')}`,
      `Blocked actions: ${(active.blockedActions || []).join(', ') || 'none'}`,
      `Forbidden self-actions: ${(active.forbiddenSelfActions || []).join(', ') || 'none'}`,
      `Codex export status: ${operatorTask?.openClawCodexProposalExport?.exportStatus || 'unavailable'}`,      `Next action: ${operatorReviewQueue?.nextAction || operatorTask?.openClawProposalPacket?.nextAction || 'Operator review only.'}`,
    ];
    await navigator.clipboard.writeText(lines.join('\n'));
    setPacketCopyStatus('copied');
  }


  const effectiveReviewDecision = localReviewDecision || operatorTask?.openClawReviewDecision || null;

  async function copyCodexProposalPrompt() {
    await navigator.clipboard.writeText(codexPromptText);
    setCodexExportCopyStatus('copied');
  }


  function attachOperatorEvidenceNote() {
    const attachment = buildOpenClawEvidenceAttachment({
      requestId: evidenceRequest?.requestId || 'none', packetId: activePacketId, evidenceType: 'operator_note', source: 'operator', title: 'Operator evidence note',
      summary: evidenceNote || 'Operator note attached.', content: evidenceNote, trustedForReview: true,
    });
    setLocalEvidenceAttachments((prev) => [...prev, attachment]);
    setEvidenceNote('');
  }

  function updatePromptStatus(promptId, nextStatus) {
    setSessionState(nextStatus === 'approved' ? 'approval-queued' : 'reviewing-prompts');
    setCandidatePrompts((previous) => previous.map((prompt) => (prompt.id === promptId
      ? { ...prompt, approvalStatus: nextStatus }
      : prompt)));
    record(`prompt-${nextStatus}`, { promptId });
  }


  const lastProposedPrompt = candidatePrompts[0]?.candidatePrompt || 'none';
  const integrationSnapshot = useMemo(() => buildOpenClawIntegrationSnapshot({
    runtimeStatusModel,
    finalRouteTruth,
    repoPath,
    branchName,
    lastScanType: scanReport?.scanType || selectedScanType || 'none',
    lastInspectionScope: scanReport?.inspected?.categories || [],
    lastProposedPrompt,
    sessionState,
    currentActivity: sessionState === 'scanning'
      ? `Running ${selectedScanType} scan in bounded mode.`
      : sessionState === 'approval-queued'
        ? 'Awaiting operator approval for Codex handoff.'
        : sessionState === 'ready-for-review'
          ? 'Scan complete; findings and proposals are ready for operator review.'
          : 'Standing by for bounded intent.',
  }), [branchName, candidatePrompts, finalRouteTruth, repoPath, runtimeStatusModel, scanReport, selectedScanType, sessionState]);

  useEffect(() => {
    onIntegrationUpdate(integrationSnapshot);
  }, [integrationSnapshot, onIntegrationUpdate]);

  const currentStage = resolveOpenClawCurrentStage(operatorTask || {});
  const currentStageIndex = OPENCLAW_STAGE_ORDER.indexOf(currentStage);
  const missionNextAction = operatorTask?.openClawControlNextAction || operatorTask?.openClawProposalPacket?.nextAction || operatorReviewQueue?.nextAction || 'Keep proposal-only review path and collect evidence.';
  // openClawControlNextAction || 'Keep proposal-only review path and collect evidence.'
  const primaryOperatorAction = resolveMissionPrimaryOperatorAction({ currentStage, operatorTask: operatorTask || {}, operatorReviewQueue });
  const topBlockerOrWarning = operatorTask?.openClawHealthValidationBlockers?.[0]
    || operatorTask?.openClawAdapterConnectionConfigBlockers?.[0]
    || operatorTask?.openClawHealthValidationWarnings?.[0]
    || operatorTask?.openClawAdapterConnectionConfigWarnings?.[0]
    || 'none';

  return (
    <CollapsiblePanel
      panelId="openClawPanel"
      title="OpenClaw Tile"
      description="Governed shadow-mode analyst and Codex prompt proposal engine under operator control."
      className="pane-span-2"
      isOpen={uiLayout.openClawPanel !== false}
      onToggle={() => togglePanel('openClawPanel')}
    >
      <div className="openclaw-tile-layout openclaw-tile-root" data-layout="openclaw-canonical-grid">
        <section className="openclaw-section openclaw-card openclaw-status-card" data-card-id="openclaw-status-authority">
          <h4>OpenClaw Status / Authority</h4>
          <ul>
            <li><strong>OpenClaw mode:</strong> {OPENCLAW_MODE}</li>
            <li><strong>Authority:</strong> {OPENCLAW_AUTHORITY}</li>
            <li><strong>Execution disabled:</strong> no (disabled)</li>
            <li><strong>Execution allowed:</strong> no</li>
            <li><strong>Mutation allowed:</strong> no</li>
            <li><strong>Operator approval required:</strong> yes</li>
            <li><strong>Adapter health:</strong> {operatorTask?.openClawHealthState || 'not_run'}</li>
            <li><strong>Handshake:</strong> {operatorTask?.openClawHandshakeState || 'not_run'}</li>
          </ul>
        </section>

        <section className="openclaw-section openclaw-card" data-card-id="openclaw-mission-card">
          <h4>OpenClaw Mission Card</h4><ul><li><strong>Current stage:</strong> {currentStage}</li><li><strong>Next action:</strong> {missionNextAction}</li><li><strong>Risk level:</strong> {operatorTask?.openClawProposalRisk?.riskLevel || 'guarded'}</li><li><strong>Top blocker/warning:</strong> {topBlockerOrWarning}</li><li><strong>Primary operator action:</strong> {primaryOperatorAction}</li></ul>
        </section>

        <section className="openclaw-section openclaw-card" data-card-id="openclaw-guardrails-card">
          <h4>Policy / Guardrails</h4>
          <p className="muted">OpenClaw can help design oversight, but cannot approve or apply its own power increase.</p>
          <ul><li><strong>Cost posture:</strong> {OPENCLAW_COST_POSTURE}</li><li><strong>Execution posture:</strong> {OPENCLAW_EXECUTION_POSTURE}</li><li><strong>Zero-cost posture active:</strong> {guardrails.zeroCostPosture === 'active' ? 'yes' : 'no'}</li><li><strong>Forbidden self-actions:</strong> {(operatorTask?.openClawOversightProposal?.forbiddenSelfActions || []).join(', ') || 'enable_execution, change_own_permissions, weaken_guardrails'}</li></ul>
        </section>

        <section className="openclaw-section openclaw-card" data-card-id="openclaw-proposal-handoff-card">
          <h4>Proposal / Codex Handoff</h4>
          <h5>Codex Proposal Export</h5>
          <h5>OpenClaw Operator Review Queue</h5>
          <p>This queue is for human/ChatGPT/Codex review only.</p>
          <p className="muted">Risk classification: {operatorTask?.openClawProposalRisk?.riskLevel || 'guarded'} · Rollback preview: {operatorTask?.openClawProposalRollback?.rollbackStatus || 'missing_preview'} · Permission diff: {operatorTask?.openClawPermissionDiff?.diffStatus || 'unknown'} · Approval requirements: {operatorTask?.openClawProposalApprovalRequirements?.approvalStatus || 'awaiting_requirements'} · Audit preview: {((operatorTask?.openClawAuditLedgerPreview?.length || 0) > 0 ? 'preview_ready' : 'not_generated')}</p>
          <div className="openclaw-button-row"><button type="button" onClick={copyOperatorReviewPacket}>Copy active review packet</button><button type="button" onClick={copyCodexProposalPrompt}>Copy Codex prompt ({operatorTask?.openClawCodexProposalExport?.exportStatus || 'unavailable'})</button></div>
          <div className={`openclaw-codex-preview ${codexRiskPresentation.toneClass}`} role="region" aria-label="Codex prompt preview"><p className="openclaw-codex-preview__risk"><strong>{codexRiskPresentation.riskLabel}</strong></p><p className="openclaw-codex-preview__policy">{codexRiskPresentation.policyLabel}</p>{codexRiskPresentation.blockedWarning ? <p className="openclaw-codex-preview__warning"><strong>{codexRiskPresentation.blockedWarning}</strong></p> : null}<label htmlFor="openclawCodexPromptPreview"><strong>Codex Prompt Preview</strong></label><textarea className="openclaw-input" id="openclawCodexPromptPreview" rows={8} value={codexPromptText} readOnly aria-readonly="true" /></div>
          {codexExportCopyStatus === 'copied' ? <p className="muted">Codex prompt copied.</p> : null}
        </section>

        <section className="openclaw-section openclaw-card" data-card-id="openclaw-evidence-readiness-card">
          <h4>Evidence / Readiness</h4>
          <ul><li><strong>Validation status:</strong> {validationStatus}</li><li><strong>Scan status:</strong> {sessionState}</li><li><strong>Capability readiness:</strong> {trialStatus}</li><li><strong>Operator review state:</strong> {operatorReviewHandoff?.handoffStatus || 'unknown'}</li></ul>
          <div className="openclaw-button-row"><button type="button" disabled={!validationButtonEnabled} onClick={() => onRequestReadonlyValidation({ ...endpointDraft, endpointHost: resolvedValidationEndpoint.host, endpointPort: resolvedValidationEndpoint.port })}>{validationButtonEnabled ? (validationSucceeded ? 'Re-check readonly health/handshake' : 'Validate readonly health/handshake') : 'Validation unavailable: missing safe readonly validation endpoint or config readiness'}</button><button type="button" onClick={runScan}>Run bounded scan</button><button type="button" onClick={() => setTrialRunRequested(true)}>Run readonly capability trial</button></div>
          {(operatorTask?.openClawPauseState || pauseStateUi) === 'paused' ? <p className="muted">Paused: readonly validation is paused. Execution remains disabled.</p> : validationSucceeded ? (<p className="muted"><strong>Readonly adapter validated. OpenClaw can be observed and assessed. Execution remains disabled.</strong></p>) : null}
        </section>
        <section className="openclaw-section openclaw-card openclaw-primary-details">
          <section className="openclaw-section openclaw-tile-root openclaw-card">
            <h4>Current Stage Progression</h4>
            <div className="openclaw-details-grid">
              {OPENCLAW_STAGE_ORDER.map((stageId, index) => {
                const stageState = index < currentStageIndex ? 'completed' : (stageId === currentStage ? 'current' : 'future');
                return (
                  <details key={stageId} open={stageState === 'current'}>
                    <summary>{stageId} ({stageState})</summary>
                  </details>
                );
              })}
            </div>
          </section>
          <h4>Endpoint Configuration (session-only v1)</h4>
          <p className="muted">session-only, no secrets stored</p>
          <p className="muted">endpoint configuration only: no health check, no handshake, no connection, no live automation</p>
          <label className="openclaw-field">label input<input className="openclaw-input" value={endpointDraft.endpointLabel || ''} onChange={(event) => onApplyOpenClawEndpointConfig({ ...endpointDraft, endpointLabel: event.target.value })} /></label>
          <label className="openclaw-field">host input<input className="openclaw-input" value={endpointDraft.endpointHost || ''} onChange={(event) => onApplyOpenClawEndpointConfig({ ...endpointDraft, endpointHost: event.target.value })} /></label>
          <label className="openclaw-field">port input<input className="openclaw-input" value={endpointDraft.endpointPort || ''} onChange={(event) => onApplyOpenClawEndpointConfig({ ...endpointDraft, endpointPort: event.target.value })} /></label>
          <label className="openclaw-field">expected protocol input/select<input className="openclaw-input" value={endpointDraft.expectedProtocolVersion || 'v1'} onChange={(event) => onApplyOpenClawEndpointConfig({ ...endpointDraft, expectedProtocolVersion: event.target.value })} /></label>
          <label className="openclaw-field">allowed probes select<select className="openclaw-input" value={endpointDraft.allowedProbeTypes || 'health_and_handshake'} onChange={(event) => onApplyOpenClawEndpointConfig({ ...endpointDraft, allowedProbeTypes: event.target.value })}><option value="none">none</option><option value="health_only">health_only</option><option value="handshake_only">handshake_only</option><option value="health_and_handshake">health_and_handshake</option></select></label>
          <div className="openclaw-button-row"><button type="button" onClick={() => onApplyOpenClawEndpointConfig({ ...endpointDraft, endpointScope: 'local_only', configPersistenceMode: 'session_only', endpointMode: 'configured' })}>apply/update button</button><button type="button" onClick={onClearOpenClawEndpointConfig}>reset/clear session config button</button></div>
          <h4>OpenClaw Control Harness</h4>
          <p>Governance scaffolding only for future operator-reviewed stages; no execution machinery is enabled in this stage.</p>
          <p>Permission envelope status: {operatorTask?.openClawPermissionEnvelope?.envelopeStatus || 'unknown'}</p>
          <h4>Codex Review Result Intake</h4>
          <p>review evidence only</p>
          <div className="openclaw-button-row"><button type="button" onClick={importCodexReviewResult}>Import Codex review result</button><button type="button" onClick={clearCodexReviewResult}>Clear Codex review result</button></div>
          <h4>Codex Review Result</h4>
          <h4>Implementation Planning Packet</h4>
          <h4>Approval Gate Readiness</h4>
          <h4>Dry-run Action Planning Preview</h4>
          <h4>Controlled Execution Gate</h4>
          <p>controlledExecutionStatus</p>
          <p>OpenClaw adapter config ready:</p><p>OpenClaw adapter config next action:</p><p>OpenClaw adapter config blocker:</p><p>OpenClaw adapter config warning:</p>
          <p>Validation endpoint:</p><p>Validation endpoint path:</p><p>Validation endpoint mode:</p>
          <h4>OpenClaw Capability Trial</h4><p>Forbidden actions:</p>
          <h4>Control Plane Safety Lifecycle</h4>
          <div className="openclaw-button-row"><button type="button" onClick={() => setKillSwitchEngagedUi(true)}>Engage Kill Switch</button><button type="button" onClick={() => setPauseStateUi('paused')}>Pause OpenClaw control plane</button><button type="button" onClick={() => setPauseStateUi('resumed')}>Resume readonly validation/control plane</button></div>
          <h4>OpenClaw Oversight Proposal</h4><p>Required oversight layers:</p><p>Proposed next controls:</p><p>Self-modification allowed:</p><p>Forbidden self-actions:</p>
        </section>
      </div>
    </CollapsiblePanel>
  );
}
