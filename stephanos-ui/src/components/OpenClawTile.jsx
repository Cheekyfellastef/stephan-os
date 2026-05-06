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
      <section className="openclaw-section">
        <h4>OpenClaw Mission Card</h4>
        <ul>
          <li><strong>Current stage:</strong> {currentStage}</li>
          <li><strong>Next action:</strong> {missionNextAction}</li>
          <li><strong>Execution allowed:</strong> no</li>
          <li><strong>Risk level:</strong> {operatorTask?.openClawProposalRisk?.riskLevel || oversightProposal?.riskLevel || 'guarded'}</li>
          <li><strong>Top blocker/warning:</strong> {topBlockerOrWarning}</li>
          <li><strong>Primary operator action:</strong> {primaryOperatorAction}</li>
        </ul>
      </section>
      <section className="openclaw-section">
        <h4>Current Stage Progression</h4>
        {OPENCLAW_STAGE_ORDER.map((stageId, index) => {
          const stageState = index < currentStageIndex ? 'completed' : (stageId === currentStage ? 'current' : 'future');
          return (
            <details key={stageId} open={stageState === 'current'}>
              <summary>{stageId} ({stageState})</summary>
              <p className="muted">Execution allowed: no</p>
              <p className="muted">Next action: {missionNextAction}</p>
            </details>
          );
        })}
      </section>
      <details className="openclaw-section openclaw-tile-root">
        <summary>Details</summary>
      <section className="openclaw-section">
        <h4>Endpoint Configuration (session-only v1)</h4>
        <p className="muted"><strong>session-only, no secrets stored</strong></p>
        <p className="muted"><strong>endpoint configuration only: no health check, no handshake, no connection, no live automation</strong></p>
        <label className="openclaw-field">label input
          <input className="openclaw-input" value={endpointDraft.endpointLabel || ''} onChange={(event) => onApplyOpenClawEndpointConfig({ ...endpointDraft, endpointLabel: event.target.value })} />
        </label>
        <label className="openclaw-field">host input
          <input className="openclaw-input" value={endpointDraft.endpointHost || ''} onChange={(event) => onApplyOpenClawEndpointConfig({ ...endpointDraft, endpointHost: event.target.value })} />
        </label>
        <label className="openclaw-field">port input
          <input className="openclaw-input" value={endpointDraft.endpointPort || ''} onChange={(event) => onApplyOpenClawEndpointConfig({ ...endpointDraft, endpointPort: event.target.value })} />
        </label>
        <label className="openclaw-field">expected protocol input/select
          <input className="openclaw-input" value={endpointDraft.expectedProtocolVersion || 'v1'} onChange={(event) => onApplyOpenClawEndpointConfig({ ...endpointDraft, expectedProtocolVersion: event.target.value })} />
        </label>
        <label className="openclaw-field">allowed probes select
          <select className="openclaw-input" value={endpointDraft.allowedProbeTypes || 'health_and_handshake'} onChange={(event) => onApplyOpenClawEndpointConfig({ ...endpointDraft, allowedProbeTypes: event.target.value })}>
            <option value="none">none</option><option value="health_only">health_only</option><option value="handshake_only">handshake_only</option><option value="health_and_handshake">health_and_handshake</option>
          </select>
        </label>
        <p>scope display/select locked to local_only for v1</p>
        <div className="openclaw-button-row">
        <button type="button" onClick={() => onApplyOpenClawEndpointConfig({ ...endpointDraft, endpointScope: 'local_only', configPersistenceMode: 'session_only', endpointMode: 'configured' })}>apply/update button</button>
        <button type="button" onClick={onClearOpenClawEndpointConfig}>reset/clear session config button</button>
        </div>
        <ul>
          <li><strong>Configured host:</strong> {endpointDraft.endpointHost || 'none'}</li>
          <li><strong>Configured port:</strong> {endpointDraft.endpointPort || 'none'}</li>
          <li><strong>Resolved validation host:</strong> {resolvedValidationEndpoint.host}</li>
          <li><strong>Resolved validation port:</strong> {resolvedValidationEndpoint.port}</li>
          <li><strong>Endpoint validity:</strong> {resolvedValidationEndpoint.valid ? 'valid' : 'invalid'}</li>
          <li><strong>OpenClaw adapter endpoint configured:</strong> {operatorTask?.openClawAdapterEndpointConfigured ? 'yes' : 'no'}</li>
          <li><strong>OpenClaw adapter endpoint label:</strong> {operatorTask?.openClawAdapterEndpointLabel || 'none'}</li>
          <li><strong>OpenClaw adapter endpoint host:</strong> {operatorTask?.openClawAdapterEndpointHost || 'none'}</li>
          <li><strong>OpenClaw adapter endpoint port:</strong> {operatorTask?.openClawAdapterEndpointPort || 'none'}</li>
          <li><strong>OpenClaw adapter endpoint scope:</strong> {operatorTask?.openClawAdapterEndpointScope || 'none'}</li>
          <li><strong>OpenClaw adapter endpoint mode:</strong> {operatorTask?.openClawAdapterEndpointMode || 'model_only'}</li>
          <li><strong>OpenClaw adapter expected protocol:</strong> {operatorTask?.openClawAdapterExpectedProtocolVersion || 'unknown'}</li>
          <li><strong>OpenClaw adapter config persistence:</strong> {operatorTask?.openClawAdapterConfigPersistenceMode || 'session_only'}</li>
          <li><strong>OpenClaw adapter config ready:</strong> {operatorTask?.openClawAdapterConnectionConfigReady ? 'yes' : 'no'}</li>
          <li><strong>OpenClaw adapter config next action:</strong> {operatorTask?.openClawAdapterConnectionConfigNextAction || 'not reported'}</li>
          <li><strong>OpenClaw adapter config blocker:</strong> {operatorTask?.openClawAdapterConnectionConfigBlockers?.[0] || 'none'}</li>
          <li><strong>OpenClaw adapter config warning:</strong> {operatorTask?.openClawAdapterConnectionConfigWarnings?.[0] || 'none'}</li>
        </ul>
      </section>
      <section className="openclaw-section">
        <h4>Readonly Health / Handshake Validation v1</h4>
        <p className="muted"><strong>readonly validation only:</strong> no commands, no file edits, no browser control, no Git writes, no execution.</p>
        <ul>
          <li><strong>Configured host:</strong> {endpointDraft.endpointHost || 'none'}</li>
          <li><strong>Configured port:</strong> {endpointDraft.endpointPort || 'none'}</li>
          <li><strong>Resolved validation host:</strong> {resolvedValidationEndpoint.host}</li>
          <li><strong>Resolved validation port:</strong> {resolvedValidationEndpoint.port}</li>
          <li><strong>Endpoint validity:</strong> {resolvedValidationEndpoint.valid ? 'valid' : 'invalid'}</li>
          <li><strong>Validation endpoint:</strong> {validationEndpointAvailable ? 'available' : 'missing'}</li>
          <li><strong>Validation endpoint path:</strong> {operatorTask?.openClawReadonlyValidationEndpointPath || 'none'}</li>
          <li><strong>Execution disabled:</strong> yes</li>
          <li><strong>Validation endpoint mode:</strong> {operatorTask?.openClawReadonlyValidationEndpointMode || 'missing'}</li>
          <li><strong>Validation status:</strong> {validationStatus}</li>
          <li><strong>Validation mode:</strong> {operatorTask?.openClawHealthValidationMode || 'none'}</li>
          <li><strong>Validation source:</strong> {operatorTask?.openClawHealthValidationSource || 'unknown'}</li>
          <li><strong>Health state:</strong> {operatorTask?.openClawHealthState || 'not_run'}</li>
          <li><strong>Handshake state:</strong> {operatorTask?.openClawHandshakeState || 'not_run'}</li>
          <li><strong>Protocol compatible:</strong> {(operatorTask?.openClawProtocolCompatible || (validationStatus === 'succeeded' && operatorTask?.openClawHandshakeState === 'compatible')) ? 'yes' : 'no'}</li>
          <li><strong>Adapter identity:</strong> {operatorTask?.openClawAdapterIdentity || 'missing'}</li>
          <li><strong>Readonly assurance:</strong> {operatorTask?.openClawReadonlyAssurance?.readonlyOnly ? 'asserted' : 'not asserted'}</li>
          <li><strong>Top blocker:</strong> {operatorTask?.openClawHealthValidationBlockers?.[0] || 'none'}</li>
          <li><strong>Top warning:</strong> {operatorTask?.openClawHealthValidationWarnings?.[0] || 'none'}</li>
          <li><strong>Validation freshness:</strong> {validationFreshness}</li>
          <li><strong>Last validated at:</strong> {validationLastCheckedAt || 'unknown'}</li>
          <li><strong>Validation restored from local evidence:</strong> {validationRestoredFromStorage ? 'yes' : 'no'}</li>
          <li><strong>Next action:</strong> {operatorTask?.openClawHealthValidationNextAction || operatorTask?.openClawHealthHandshakeNextAction || 'not reported'}</li>
        </ul>
        {adapterUnreachable ? (
          <p className="muted">
            Stephanos is alive, but the readonly OpenClaw adapter is not reachable at {adapterHost}:{adapterPort}. Start or repair the readonly adapter. Execution remains disabled.
          </p>
        ) : null}
        {validationSucceeded ? (
          <p className="muted"><strong>Readonly adapter validated. OpenClaw can be observed and assessed. Execution remains disabled.</strong></p>
        ) : null}
        {validationRestoredFromStorage && validationFreshness === 'fresh' ? (
          <p className="muted"><strong>Readonly validation restored. Execution remains disabled.</strong></p>
        ) : null}
        {validationSucceeded && validationFreshness === 'stale' ? (
          <p className="muted"><strong>Last validation is stale; re-check recommended.</strong></p>
        ) : null}
        <button type="button" disabled={!validationButtonEnabled} onClick={() => { setTrialRunRequested(false); onRequestReadonlyValidation({ ...endpointDraft, endpointHost: resolvedValidationEndpoint.host, endpointPort: resolvedValidationEndpoint.port }); }}>
          {validationButtonEnabled ? (validationSucceeded ? 'Re-check readonly health/handshake' : 'Validate readonly health/handshake') : 'Validation unavailable: missing safe readonly validation endpoint or config readiness'}
        </button>
      </section>
      <section className="openclaw-section">
        <h4>OpenClaw Capability Trial</h4>
        <ul>
          <li><strong>Trial status:</strong> {trialStatus}</li>
          <li><strong>Capability mode:</strong> {capabilityTrial?.capabilityMode || 'readonly_observation'}</li>
          <li><strong>Adapter validated:</strong> {capabilityTrial?.adapterValidated ? 'yes' : 'no'}</li>
          <li><strong>Execution allowed:</strong> no</li>
          <li><strong>Operator approval required:</strong> yes</li>
          <li><strong>Allowed readonly trial actions:</strong> {(capabilityTrial?.allowedTrialActions || ['report_identity', 'report_declared_capabilities', 'report_safety_posture', 'report_required_permissions']).join(', ')}</li>
          <li><strong>Forbidden actions:</strong> {(capabilityTrial?.forbiddenTrialActions || ['execute_command', 'edit_file', 'control_browser', 'write_git', 'mutate_system']).join(', ')}</li>
          <li><strong>Next action:</strong> {trialNextAction}</li>
        </ul>
        <button type="button" disabled={!validationSucceeded} onClick={() => setTrialRunRequested(true)}>Run readonly capability trial</button>
        {reportVisible ? (
          <ul>
            <li><strong>Adapter identity:</strong> {capabilityReport?.adapterIdentity || operatorTask?.openClawAdapterIdentity || 'missing'}</li>
            <li><strong>Health state:</strong> {capabilityReport?.healthState || operatorTask?.openClawHealthState || 'not_run'}</li>
            <li><strong>Handshake state:</strong> {capabilityReport?.handshakeState || operatorTask?.openClawHandshakeState || 'not_run'}</li>
            <li><strong>Protocol compatibility:</strong> {capabilityReport?.protocolCompatibility || (operatorTask?.openClawProtocolCompatible ? 'compatible' : 'not_compatible')}</li>
            <li><strong>Readonly assurance:</strong> {capabilityReport?.readonlyAssurance || (operatorTask?.openClawReadonlyAssurance?.readonlyOnly ? 'asserted' : 'not_asserted')}</li>
            <li><strong>Execution allowed:</strong> no</li>
            <li><strong>Declared safe capabilities:</strong> {(capabilityReport?.declaredSafeCapabilities || ['health_check', 'handshake_check', 'identity_report', 'safety_posture_report']).join(', ')}</li>
            <li><strong>Blocked capabilities:</strong> {(capabilityReport?.blockedCapabilities || ['command_execution', 'file_mutation', 'browser_control', 'git_write', 'autonomous_action']).join(', ')}</li>
            <li><strong>Suggested next stage:</strong> {capabilityReport?.suggestedNextStage || 'Operator-reviewed proposal generation only.'}</li>
          </ul>
        ) : null}
      </section>

      <section className="openclaw-section">
        <h4>OpenClaw Oversight Proposal</h4>
        <p className="muted"><strong>OpenClaw can help design oversight, but cannot approve or apply its own power increase.</strong></p>
        <ul>
          <li><strong>Proposal status:</strong> {oversightProposal?.proposalStatus || 'unknown'}</li>
          <li><strong>Proposal mode:</strong> {oversightProposal?.proposalMode || 'proposal_only'}</li>
          <li><strong>Trust stage:</strong> {oversightProposal?.trustStage || 'stage_0_stub_validated'}</li>
          <li><strong>Execution allowed:</strong> no</li>
          <li><strong>Self-modification allowed:</strong> no</li>
          <li><strong>Operator approval required:</strong> yes</li>
          <li><strong>Required oversight layers:</strong> {(oversightProposal?.requiredOversightLayers || []).join(', ') || 'operator approval gate, readonly validation'}</li>
          <li><strong>Proposed next controls:</strong> {(oversightProposal?.proposedNextControls || []).join(', ') || 'Validate readonly adapter before generating oversight proposal.'}</li>
          <li><strong>Forbidden self-actions:</strong> {(oversightProposal?.forbiddenSelfActions || []).join(', ') || 'enable_execution, change_own_permissions, weaken_guardrails'}</li>
          <li><strong>Risk level:</strong> {oversightProposal?.riskLevel || 'guarded'}</li>
          <li><strong>Next action:</strong> {oversightProposal?.nextAction || 'Validate readonly adapter before generating oversight proposal.'}</li>
        </ul>
      </section>


      <section className="openclaw-section">
        <h4>OpenClaw Proposal Packet</h4>
        <p className="muted"><strong>Review packet only.</strong> OpenClaw may contribute readonly observations, but cannot approve or apply its own packet.</p>
        <p className="muted">This packet is for operator review and future ChatGPT/Codex workflow. Execution remains unavailable.</p>
        <ul>
          <li><strong>Packet status:</strong> {operatorTask?.openClawProposalPacket?.packetStatus || 'unknown'}</li>
          <li><strong>Packet mode:</strong> {operatorTask?.openClawProposalPacket?.packetMode || 'proposal_only'}</li>
          <li><strong>Proposal type:</strong> {operatorTask?.openClawProposalPacket?.proposalType || 'observe_capability'}</li>
          <li><strong>Requested outcome:</strong> {operatorTask?.openClawProposalPacket?.requestedOutcome || 'operator_review'}</li>
          <li><strong>Risk level:</strong> {operatorTask?.openClawProposalRisk?.riskLevel || 'guarded'}</li>
          <li><strong>Execution allowed:</strong> {operatorTask?.openClawProposalPacket?.executionAllowed ? 'yes' : 'no'}</li>
          <li><strong>Self-modification allowed:</strong> {operatorTask?.openClawProposalPacket?.selfModificationAllowed ? 'yes' : 'no'}</li>
          <li><strong>Operator approval required:</strong> {operatorTask?.openClawProposalPacket?.operatorApprovalRequired ? 'yes' : 'no'}</li>
          <li><strong>Approval status:</strong> {operatorTask?.openClawProposalApprovalRequirements?.approvalStatus || 'awaiting_requirements'}</li>
          <li><strong>Rollback status:</strong> {operatorTask?.openClawProposalRollback?.rollbackStatus || 'missing_preview'}</li>
          <li><strong>Evidence status:</strong> {operatorTask?.openClawProposalEvidence?.status || 'none'}</li>
          <li><strong>Blocked actions:</strong> {(operatorTask?.openClawProposalPacket?.blockedActions || []).join(', ') || 'none'}</li>
          <li><strong>Forbidden self-actions:</strong> {(operatorTask?.openClawProposalPacket?.forbiddenSelfActions || []).join(', ') || 'none'}</li>
          <li><strong>Next action:</strong> {operatorTask?.openClawProposalPacket?.nextAction || 'Operator review only.'}</li>
        </ul>
      </section>

      <section className="openclaw-section">
        <h4>OpenClaw Operator Review Queue</h4>
        <p className="muted">This queue is for human/ChatGPT/Codex review only. It does not approve or execute packets.</p>
        <ul>
          <li><strong>Queue status:</strong> {operatorReviewQueue?.queueStatus || 'awaiting_packet'}</li>
          <li><strong>Queue mode:</strong> {operatorReviewQueue?.queueMode || 'operator_review_only'}</li>
          <li><strong>Active packet id:</strong> {operatorReviewQueue?.activePacketId || 'none'}</li>
          <li><strong>Review status:</strong> {operatorReviewQueue?.reviewStatus || 'not_reviewed'}</li>
          <li><strong>Missing evidence:</strong> {(operatorReviewQueue?.missingEvidence || []).join(', ') || 'none'}</li>
          <li><strong>Evidence context:</strong> {(operatorReviewQueue?.missingEvidence || []).length === 0 ? 'Evidence satisfied for review context.' : 'Missing evidence must be resolved before advancing.'}</li>
          <li><strong>Available evidence:</strong> {(operatorReviewQueue?.availableEvidence || []).join(', ') || 'none'}</li>
          <li><strong>Risk summary:</strong> {operatorReviewQueue?.riskSummary?.riskSummary || 'Risk under review.'}</li>
          <li><strong>Approval summary:</strong> {operatorReviewQueue?.approvalSummary?.approvalStatus || 'unknown'}</li>
          <li><strong>Rollback summary:</strong> {operatorReviewQueue?.rollbackSummary?.rollbackStatus || 'unknown'}</li>
          <li><strong>Permission diff summary:</strong> {operatorReviewQueue?.permissionDiffSummary?.permissionDiffStatus || 'unknown'}</li>
          <li><strong>Audit preview summary:</strong> {operatorReviewQueue?.auditSummary?.auditPreviewStatus || 'unknown'}</li>
          <li><strong>Codex export status:</strong> {operatorReviewQueue?.codexExportStatus || 'unavailable'}</li>
                    <li><strong>Risk classification:</strong> {operatorTask?.openClawProposalRisk?.riskLevel || 'guarded'}</li>
          <li><strong>Rollback preview:</strong> {operatorTask?.openClawProposalRollback?.rollbackStatus || 'unknown'}</li>
          <li><strong>Permission diff:</strong> {operatorTask?.openClawPermissionDiff?.diffStatus || 'unknown'}</li>
          <li><strong>Approval requirements:</strong> {operatorTask?.openClawProposalApprovalRequirements?.approvalStatus || 'unknown'}</li>
          <li><strong>Audit preview:</strong> {(operatorTask?.openClawAuditLedgerPreview?.length || 0) > 0 ? 'preview_ready' : 'not_generated'}</li>
<li><strong>Operator approval required:</strong> {operatorReviewQueue?.operatorApprovalRequired ? 'yes' : 'no'}</li>
          <li><strong>Execution allowed:</strong> no</li>
          <li><strong>Self-modification allowed:</strong> no</li>
          <li><strong>OpenClaw self-approval allowed:</strong> no</li>
          <li><strong>Next action:</strong> {operatorReviewQueue?.nextAction || 'Operator review only.'}</li>
        </ul>
        <button type="button" onClick={() => copyOperatorReviewPacket()}>Copy active review packet</button>
        {packetCopyStatus === 'copied' ? <p className="muted">Review packet copied.</p> : null}
      </section>

      <section className="openclaw-section">
        <h4>Operator Review Workflow</h4>
        <ul>
          <li><strong>Workflow status:</strong> {operatorReviewWorkflow?.workflowStatus || 'awaiting_packet'}</li>
          <li><strong>Review decision:</strong> {effectiveReviewDecision?.reviewDecision || operatorReviewWorkflow?.reviewDecision || 'not_reviewed'}</li>
          <li><strong>Persistence mode:</strong> local review state</li>
          <li><strong>Last updated:</strong> {effectiveReviewDecision?.updatedAt || 'n/a'}</li>
          <li><strong>Allowed review actions:</strong> {(operatorReviewWorkflow?.allowedReviewActions || []).join(', ') || 'none'}</li>
          <li><strong>Forbidden review actions:</strong> {(operatorReviewWorkflow?.forbiddenReviewActions || []).join(', ') || 'none'}</li>
          <li><strong>Next action:</strong> {effectiveReviewDecision?.nextAction || operatorReviewWorkflow?.nextAction || 'Review packet manually.'}</li>
        </ul>
        <label className="openclaw-field">Review note
          <input className="openclaw-input" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} />
        </label>
        <div className="openclaw-button-row">
          <button type="button" onClick={() => updateReviewDecision('needs_more_evidence')}>Mark needs more evidence</button>
          <button type="button" onClick={() => updateReviewDecision('ready_for_codex_review')}>Mark ready for Codex review</button>
          <button type="button" onClick={() => updateReviewDecision('rejected')}>Reject packet</button>
          <button type="button" onClick={() => updateReviewDecision('archived')}>Archive packet</button>
          <button type="button" onClick={() => { clearOpenClawReviewDecision({ packetId: activePacketId }); setLocalReviewDecision(null); }}>Clear review decision</button>
        </div>
      </section>


      <section className="openclaw-section">
        <h4>OpenClaw Evidence Requests</h4>
        <ul>
          <li><strong>Evidence request status:</strong> {evidenceRequest?.requestStatus || 'none'}</li>
          <li><strong>Requested evidence type:</strong> {evidenceRequest?.requestedEvidenceType || 'none'}</li>
          <li><strong>Reason:</strong> {evidenceRequest?.reason || 'none'}</li>
          <li><strong>Blocking:</strong> {evidenceRequest?.blocking ? 'yes' : 'no'}</li>
          <li><strong>Missing evidence:</strong> {(evidenceRequest?.missingEvidence || []).join(', ') || 'none'}</li>
          <li><strong>Attached evidence summary:</strong> {(evidenceAttachments || []).map((a)=>a.summary || a.title).join(' | ') || 'none'}</li>
          <li><strong>Next action:</strong> {evidenceRequest?.nextAction || 'Add requested OpenClaw proposal evidence'}</li>
          <li><strong>Execution allowed:</strong> no</li>
        </ul>
        <label className="openclaw-field">Operator evidence note
          <textarea className="openclaw-input" value={evidenceNote} onChange={(event) => setEvidenceNote(event.target.value)} rows={4} />
        </label>
        <div className="openclaw-button-row">
          <button type="button" onClick={attachOperatorEvidenceNote}>Attach operator note</button>
          <button type="button">Add evidence request</button>
          <button type="button">Mark evidence request satisfied</button>
          <button type="button">Mark evidence insufficient</button>
          <button type="button">Clear evidence request</button>
        </div>
      </section>

      <section className="openclaw-section">
        <h4>Codex Proposal Export</h4>
        <p className="muted">Manual prompt export only. OpenClaw does not execute, approve, commit, or create PRs.</p>
        <ul>
          <li><strong>Export status:</strong> {operatorTask?.openClawCodexProposalExport?.exportStatus || 'unavailable'}</li>
          <li><strong>Export mode:</strong> {operatorTask?.openClawCodexProposalExport?.exportMode || 'manual_prompt'}</li>
          <li><strong>Source packet id:</strong> {operatorTask?.openClawCodexProposalExport?.sourcePacketId || 'none'}</li>
          <li><strong>Risk level:</strong> {operatorTask?.openClawProposalRisk?.riskLevel || 'guarded'}</li>
          <li><strong>Required tests:</strong> {(operatorTask?.openClawCodexProposalExport?.requiredTests || []).join(', ') || 'none'}</li>
          <li><strong>Next action:</strong> {operatorTask?.openClawCodexProposalExport?.nextAction || 'Prepare packet for operator review.'}</li>
          <li><strong>Next safe stage after review:</strong> Codex planning/implementation proposal only.</li>
        </ul>
        <div className={`openclaw-codex-preview ${codexRiskPresentation.toneClass}`} role="region" aria-label="Codex prompt preview">
          <p className="openclaw-codex-preview__risk"><strong>{codexRiskPresentation.riskLabel}</strong></p>
          <p className="openclaw-codex-preview__policy">{codexRiskPresentation.policyLabel}</p>
          {codexRiskPresentation.blockedWarning ? <p className="openclaw-codex-preview__warning"><strong>{codexRiskPresentation.blockedWarning}</strong></p> : null}
          <label htmlFor="openclawCodexPromptPreview"><strong>Codex Prompt Preview</strong></label>
          <textarea
            className="openclaw-input"
            id="openclawCodexPromptPreview"
            value={codexPromptText}
            readOnly
            rows={10}
            aria-readonly="true"
          />
          <p className="muted">Selectable review text only. Execution remains disabled.</p>
        </div>
        <button type="button" onClick={() => copyCodexProposalPrompt()}>
          Copy Codex prompt ({operatorTask?.openClawCodexProposalExport?.sourcePacketId || 'none'})
        </button>
        {codexExportCopyStatus === 'copied' ? <p className="muted">Codex prompt copied.</p> : null}
      </section>

      <section className="openclaw-section">
        <h4>Codex Review Result Intake</h4>
        <p className="muted">Review evidence only. Planning only. Preview only. Execution disabled. Operator approval required.</p>
        <p className="muted">Pasted Codex result is review evidence only. It cannot execute, edit files, write Git, or approve OpenClaw actions.</p>
        <label htmlFor="openclawCodexReviewResultIntake">Paste Codex review result</label>
        <textarea className="openclaw-input" id="openclawCodexReviewResultIntake" value={codexReviewText} onChange={(event) => setCodexReviewText(event.target.value)} rows={8} />
        <div className="openclaw-button-row">
        <button type="button" onClick={importCodexReviewResult}>Import Codex review result</button>
        <button type="button" onClick={clearCodexReviewResult}>Clear Codex review result</button>
        </div>
      </section>
      <section className="openclaw-section">
        <h4>Codex Review Result</h4>
        <ul>
          <li><strong>Status:</strong> {effectiveCodexReviewResult?.resultStatus || 'not_received'}</li>
          <li><strong>Safety classification:</strong> {effectiveCodexReviewResult?.resultStatus === 'blocked' ? 'blocked (unsafe request detected)' : effectiveCodexReviewResult?.resultStatus ? 'safe/reviewable' : 'not yet reviewed'}</li>
          <li><strong>Summary:</strong> {effectiveCodexReviewResult?.reviewSummary || 'none'}</li>
          <li><strong>Findings:</strong> {(effectiveCodexReviewResult?.findings || []).join(' | ') || 'none'}</li>
          <li><strong>Risks:</strong> {(effectiveCodexReviewResult?.risks || []).join(' | ') || 'none'}</li>
          <li><strong>Open questions:</strong> {(effectiveCodexReviewResult?.openQuestions || []).join(' | ') || 'none'}</li>
          <li><strong>Safety confirmations:</strong> {(effectiveCodexReviewResult?.safetyConfirmations || []).join(' | ') || 'none'}</li>
          <li><strong>Next action:</strong> {effectiveCodexReviewResult?.nextAction || 'Ingest Codex review result.'}</li>
          <li><strong>Execution allowed:</strong> no</li>
        </ul>
        <button type="button" onClick={async () => { await navigator.clipboard.writeText(JSON.stringify(effectiveCodexReviewResult || {}, null, 2)); setCodexReviewCopyStatus('copied'); }}>Copy imported Codex review summary</button>
        {codexReviewCopyStatus === 'copied' ? <p className="muted">Codex review summary copied.</p> : null}
      </section>
      <section className="openclaw-section">
        <h4>Implementation Planning Packet</h4>
        <ul>
          <li><strong>Plan status:</strong> {operatorTask?.openClawImplementationPlan?.planStatus || 'unavailable'}</li>
          <li><strong>Files to inspect:</strong> {(operatorTask?.openClawImplementationPlan?.proposedFilesToInspect || []).join(', ') || 'none'}</li>
          <li><strong>Files to change:</strong> {(operatorTask?.openClawImplementationPlan?.proposedFilesToChange || []).join(', ') || 'none'}</li>
          <li><strong>Required tests:</strong> {(operatorTask?.openClawImplementationPlan?.proposedTests || []).join(', ') || 'none'}</li>
          <li><strong>Build checks:</strong> {(operatorTask?.openClawImplementationPlan?.proposedBuildChecks || []).join(', ') || 'none'}</li>
          <li><strong>Rollback plan:</strong> {(operatorTask?.openClawImplementationPlan?.rollbackPlan || []).join(' | ') || 'none'}</li>
          <li><strong>Open questions:</strong> {(operatorTask?.openClawImplementationPlan?.openQuestions || []).join(' | ') || 'none'}</li>
          <li><strong>Next action:</strong> {operatorTask?.openClawImplementationPlan?.nextAction || 'Build implementation planning packet.'}</li>
          <li><strong>Execution allowed:</strong> no</li>
        </ul>
        <button type="button" onClick={async () => { await navigator.clipboard.writeText(JSON.stringify(operatorTask?.openClawImplementationPlan || {}, null, 2)); setImplementationPlanCopyStatus('copied'); }}>Copy implementation planning packet</button>
        {implementationPlanCopyStatus === 'copied' ? <p className="muted">Implementation planning packet copied.</p> : null}
      </section>
      <section className="openclaw-section">
        <h4>Approval Gate Readiness</h4>
        <ul>
          <li><strong>Readiness status:</strong> {operatorTask?.openClawApprovalGateReadiness?.approvalReadinessStatus || 'not_ready'}</li>
          <li><strong>Satisfied gates:</strong> {(operatorTask?.openClawApprovalGateReadiness?.satisfiedGates || []).join(', ') || 'none'}</li>
          <li><strong>Missing gates:</strong> {(operatorTask?.openClawApprovalGateReadiness?.missingGates || []).join(', ') || 'none'}</li>
          <li><strong>Next action:</strong> {operatorTask?.openClawApprovalGateReadiness?.nextAction || 'Complete approval readiness evidence.'}</li>
          <li><strong>Execution allowed:</strong> no</li>
        </ul>
      </section>
      <section className="openclaw-section">
        <h4>Dry-run Action Planning Preview</h4>
        <ul>
          <li><strong>Dry-run status:</strong> {operatorTask?.openClawDryRunPlan?.dryRunStatus || 'unavailable'}</li>
          <li><strong>Simulated steps:</strong> {(operatorTask?.openClawDryRunPlan?.simulatedSteps || []).join(' | ') || 'none'}</li>
          <li><strong>Files that would be touched:</strong> {(operatorTask?.openClawDryRunPlan?.filesThatWouldBeChanged || []).join(', ') || 'none'}</li>
          <li><strong>Commands that would be requested:</strong> {(operatorTask?.openClawDryRunPlan?.commandsThatWouldBeRequested || []).join(', ') || 'none'}</li>
          <li><strong>Tests that would be required:</strong> {(operatorTask?.openClawDryRunPlan?.testsThatWouldBeRun || []).join(', ') || 'none'}</li>
          <li><strong>Blocked steps:</strong> {(operatorTask?.openClawDryRunPlan?.blockedSteps || []).join(' | ') || 'none'}</li>
          <li><strong>Next action:</strong> {operatorTask?.openClawDryRunPlan?.nextAction || 'Prepare dry-run action planning preview.'}</li>
          <li><strong>Execution allowed:</strong> no</li>
        </ul>
        <button type="button" onClick={async () => { await navigator.clipboard.writeText(JSON.stringify(operatorTask?.openClawDryRunPlan || {}, null, 2)); setDryRunCopyStatus('copied'); }}>Copy dry-run preview</button>
        {dryRunCopyStatus === 'copied' ? <p className="muted">Dry-run preview copied.</p> : null}
      </section>
      <section className="openclaw-section">
        <h4>Controlled Execution Gate</h4>
        <ul>
          <li><strong>Status:</strong> {operatorTask?.openClawControlledExecutionGate?.controlledExecutionStatus || 'future_gated'}</li>
          <li><strong>Available:</strong> {operatorTask?.openClawControlledExecutionGate?.controlledExecutionAvailable ? 'yes' : 'no'}</li>
          <li><strong>Reason:</strong> {operatorTask?.openClawControlledExecutionGate?.controlledExecutionReason || 'Future-gated by policy.'}</li>
        </ul>
      </section>

      <section className="openclaw-section">
        <h4>OpenClaw Control Harness</h4>
        <p className="muted">Governance scaffolding only for future operator-reviewed stages; no execution machinery is enabled in this stage.</p>
        <ul>
          <li><strong>Permission envelope status:</strong> {operatorTask?.openClawPermissionEnvelope?.envelopeStatus || 'unknown'}</li>
          <li><strong>Current mode:</strong> {operatorTask?.openClawPermissionEnvelope?.currentMode || 'proposal_only'}</li>
          <li><strong>Execution allowed:</strong> {(operatorTask?.openClawPermissionEnvelope?.executionAllowed || operatorTask?.openClawPermissionDiff?.executionAllowed || operatorTask?.openClawApprovalGate?.executionAllowed || operatorTask?.openClawRollbackPlan?.executionAllowed) ? 'yes' : 'no'}</li>
          <li><strong>Self-modification allowed:</strong> {(operatorTask?.openClawPermissionEnvelope?.selfModificationAllowed || operatorTask?.openClawApprovalGate?.selfModificationAllowed) ? 'yes' : 'no'}</li>
          <li><strong>Operator approval required:</strong> {(operatorTask?.openClawPermissionEnvelope?.operatorApprovalRequired || operatorTask?.openClawApprovalGate?.operatorApprovalRequired) ? 'yes' : 'no'}</li>
          <li><strong>Allowed capabilities:</strong> {(operatorTask?.openClawPermissionEnvelope?.allowedCapabilities || []).join(', ') || 'none'}</li>
          <li><strong>Blocked capabilities:</strong> {(operatorTask?.openClawPermissionEnvelope?.blockedCapabilities || []).join(', ') || 'none'}</li>
          <li><strong>Future-gated capabilities:</strong> {(operatorTask?.openClawPermissionEnvelope?.futureGatedCapabilities || []).join(', ') || 'none'}</li>
          <li><strong>Permission diff status:</strong> {operatorTask?.openClawPermissionDiff?.diffStatus || 'unknown'}</li>
          <li><strong>Approval gate status:</strong> {operatorTask?.openClawApprovalGate?.gateStatus || 'unknown'}</li>
          <li><strong>Proposal Review Queue:</strong> {operatorTask?.openClawProposalReviewQueue?.queueStatus || 'not_available'}</li>
          <li><strong>Operator review handoff status:</strong> {operatorReviewHandoff?.handoffStatus || 'unknown'}</li>
          <li><strong>Operator review handoff next action:</strong> {operatorReviewHandoff?.nextAction || 'Operator review only.'}</li>
          <li><strong>Permission Diff Viewer:</strong> {operatorTask?.openClawPermissionDiff?.diffMode || 'preview_only'}</li>
          <li><strong>Audit preview status:</strong> {(operatorTask?.openClawAuditLedgerPreview?.length || 0) > 0 ? 'preview_ready' : 'not_generated'}</li>
          <li><strong>Rollback plan status:</strong> {operatorTask?.openClawRollbackPlan?.rollbackStatus || 'unknown'}</li>
          <li><strong>Risk level:</strong> {operatorTask?.openClawPermissionEnvelope?.riskLevel || operatorTask?.openClawOversightProposal?.riskLevel || 'guarded'}</li>
          <li><strong>Next action:</strong> {operatorTask?.openClawApprovalGate?.nextAction || operatorTask?.openClawPermissionEnvelope?.nextAction || 'Operator review only.'}</li>
        </ul>
        {operatorReviewHandoff?.handoffStatus === 'ready_for_operator_review' ? (
          <div className="mission-dashboard__banner mission-dashboard__banner--warning">
            <strong>Operator review queue ready</strong>
            <span> Preview-only marker: OpenClaw cannot submit/approve/apply its own packet. </span>
            <button type="button" disabled>Review queue is non-executing (preview only)</button>
          </div>
        ) : null}
      </section>

      <section className="openclaw-section">
        <h4>Control Plane Safety Lifecycle</h4>
        <ul>
          <li><strong>Configured host:</strong> {endpointDraft.endpointHost || 'none'}</li>
          <li><strong>Configured port:</strong> {endpointDraft.endpointPort || 'none'}</li>
          <li><strong>Resolved validation host:</strong> {resolvedValidationEndpoint.host}</li>
          <li><strong>Resolved validation port:</strong> {resolvedValidationEndpoint.port}</li>
          <li><strong>Endpoint validity:</strong> {resolvedValidationEndpoint.valid ? 'valid' : 'invalid'}</li>
          <li><strong>Control mode:</strong> {operatorTask?.openClawControlMode || 'readonly_validation'}</li>
          <li><strong>Kill switch engaged:</strong> {(operatorTask?.openClawKillSwitchEngaged || killSwitchEngagedUi) ? 'yes' : 'no'}</li>
          <li><strong>Pause state:</strong> {operatorTask?.openClawPauseState || pauseStateUi || 'not_configured'}</li>
          <li><strong>Readonly validation available:</strong> {operatorTask?.openClawReadonlyValidationAvailable ? 'yes' : 'no'}</li>
          <li><strong>Readonly validation status:</strong> {operatorTask?.openClawReadonlyValidationStatus || validationStatus}</li>
          <li><strong>Execution allowed:</strong> no (disabled)</li>
          <li><strong>Next action:</strong> {operatorTask?.openClawControlNextAction || 'Keep proposal-only review path and collect evidence.'}</li>
        </ul>
        {(operatorTask?.openClawKillSwitchEngaged || killSwitchEngagedUi) ? (
          <p className="muted">Kill switch engaged: OpenClaw control plane blocked.</p>
        ) : null}
        {(operatorTask?.openClawPauseState || pauseStateUi) === 'paused' ? (
          <p className="muted">Paused: readonly validation is paused. Execution remains disabled.</p>
        ) : validationSucceeded ? (
          <p className="muted">Readonly validation ready. Execution remains disabled.</p>
        ) : null}
        <div className="openclaw-button-row">
          <button type="button" onClick={() => setKillSwitchEngagedUi(true)}>Engage Kill Switch</button>
          <button type="button" onClick={() => setPauseStateUi('paused')}>Pause OpenClaw control plane</button>
          <button type="button" onClick={() => setPauseStateUi('resumed')}>Resume readonly validation/control plane</button>
        </div>
      </section>

      <section className="openclaw-section">
        <h4>Status / Governance</h4>
        <ul>
          <li><strong>Configured host:</strong> {endpointDraft.endpointHost || 'none'}</li>
          <li><strong>Configured port:</strong> {endpointDraft.endpointPort || 'none'}</li>
          <li><strong>Resolved validation host:</strong> {resolvedValidationEndpoint.host}</li>
          <li><strong>Resolved validation port:</strong> {resolvedValidationEndpoint.port}</li>
          <li><strong>Endpoint validity:</strong> {resolvedValidationEndpoint.valid ? 'valid' : 'invalid'}</li>
          <li><strong>OpenClaw mode:</strong> {OPENCLAW_MODE}</li>
          <li><strong>Authority:</strong> {OPENCLAW_AUTHORITY}</li>
          <li><strong>Cost posture:</strong> {OPENCLAW_COST_POSTURE}</li>
          <li><strong>Execution posture:</strong> {OPENCLAW_EXECUTION_POSTURE}</li>
          <li><strong>Sandbox status:</strong> {integrationSnapshot.sandboxStatus}</li>
          <li><strong>Workspace path:</strong> {integrationSnapshot.workspacePath}</li>
          <li><strong>Repo scope:</strong> {integrationSnapshot.repoScope}</li>
          <li><strong>Current branch:</strong> {integrationSnapshot.branchName}</li>
          <li><strong>Route source:</strong> {integrationSnapshot.connectedTo.routeTruthSource}</li>
          <li><strong>Zero-cost posture active:</strong> {guardrails.zeroCostPosture === 'active' ? 'yes' : 'no'}</li>
        </ul>
        {distCautionVisible ? (
          <div className="mission-dashboard__banner mission-dashboard__banner--warning">
            <strong>Dist/source caution:</strong>
            <span>
              Dist is generated and non-authoritative. Preserve source truth and verify parity before operational handoff.
            </span>
          </div>
        ) : null}
      </section>

      {integrationSnapshot.warnings.length > 0 ? (
        <section className="openclaw-section">
          <h4>Trust Posture Warnings</h4>
          <ul>
          <li><strong>Configured host:</strong> {endpointDraft.endpointHost || 'none'}</li>
          <li><strong>Configured port:</strong> {endpointDraft.endpointPort || 'none'}</li>
          <li><strong>Resolved validation host:</strong> {resolvedValidationEndpoint.host}</li>
          <li><strong>Resolved validation port:</strong> {resolvedValidationEndpoint.port}</li>
          <li><strong>Endpoint validity:</strong> {resolvedValidationEndpoint.valid ? 'valid' : 'invalid'}</li>
            {integrationSnapshot.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </section>
      ) : null}

      <section className="openclaw-section">
        <h4>Integration Topology</h4>
        <p>{integrationSnapshot.topology.map((entry) => entry.label).join(' → ')}</p>
        <ul>
          <li><strong>Configured host:</strong> {endpointDraft.endpointHost || 'none'}</li>
          <li><strong>Configured port:</strong> {endpointDraft.endpointPort || 'none'}</li>
          <li><strong>Resolved validation host:</strong> {resolvedValidationEndpoint.host}</li>
          <li><strong>Resolved validation port:</strong> {resolvedValidationEndpoint.port}</li>
          <li><strong>Endpoint validity:</strong> {resolvedValidationEndpoint.valid ? 'valid' : 'invalid'}</li>
          {integrationSnapshot.topology.map((entry) => (
            <li key={entry.id}><strong>{entry.label}:</strong> {entry.policyNote}</li>
          ))}
        </ul>
      </section>

      <section className="openclaw-section">
        <h4>Authority Model</h4>
        <ul className="openclaw-authority-grid">
          {OPENCLAW_AUTHORITY_MODEL.map((entry) => (
            <li key={entry.capability} className={`openclaw-authority-item ${getTone(entry.status)}`}>
              <strong>{entry.capability}</strong>
              <span>{entry.status === 'allowed' ? 'Allowed' : 'Blocked'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="openclaw-section">
        <h4>Scan Controls</h4>
        <div className="openclaw-scan-controls">
          {OPENCLAW_SCAN_MODES.map((mode) => (
            <label key={mode.id}>
              <input
                type="radio"
                name="openclawScanMode"
                value={mode.id}
                checked={selectedScanType === mode.id}
                onChange={() => setSelectedScanType(mode.id)}
              />
              <strong>{mode.label}</strong> — {mode.description}
            </label>
          ))}
        </div>
        <button type="button" onClick={runScan}>Run bounded scan</button>
      </section>

      <section className="openclaw-section">
        <h4>Findings / Evidence</h4>
        {!scanReport ? <p>No scan yet.</p> : (
          <>
            <p>
              Inspected categories: <strong>{scanReport.inspected.categories.join(', ')}</strong>
            </p>
            <div className="openclaw-findings-grid">
              {scanReport.findings.map((finding) => (
                <article key={finding.id} className="mission-dashboard__milestone">
                  <h5>{finding.title}</h5>
                  <p>{finding.diagnosis}</p>
                  <ul>
          <li><strong>Configured host:</strong> {endpointDraft.endpointHost || 'none'}</li>
          <li><strong>Configured port:</strong> {endpointDraft.endpointPort || 'none'}</li>
          <li><strong>Resolved validation host:</strong> {resolvedValidationEndpoint.host}</li>
          <li><strong>Resolved validation port:</strong> {resolvedValidationEndpoint.port}</li>
          <li><strong>Endpoint validity:</strong> {resolvedValidationEndpoint.valid ? 'valid' : 'invalid'}</li>
                    <li><strong>Confidence:</strong> {finding.confidence}</li>
                    <li><strong>Uncertainty:</strong> {finding.uncertainty}</li>
                    <li><strong>Doctrine drift risk:</strong> {finding.doctrineRisk}</li>
                    <li><strong>Likely files:</strong> {(finding.likelyFiles || []).join(', ')}</li>
                  </ul>
                  <p><strong>Evidence:</strong></p>
                  <ul>
          <li><strong>Configured host:</strong> {endpointDraft.endpointHost || 'none'}</li>
          <li><strong>Configured port:</strong> {endpointDraft.endpointPort || 'none'}</li>
          <li><strong>Resolved validation host:</strong> {resolvedValidationEndpoint.host}</li>
          <li><strong>Resolved validation port:</strong> {resolvedValidationEndpoint.port}</li>
          <li><strong>Endpoint validity:</strong> {resolvedValidationEndpoint.valid ? 'valid' : 'invalid'}</li>
                    {finding.evidence.map((line) => <li key={line}>{line}</li>)}
                  </ul>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="openclaw-section">
        <h4>Candidate Prompt Cards</h4>
        {candidatePrompts.length === 0 ? <p>No prompt cards yet. Run Candidate Codex Prompt Generation scan.</p> : (
          <div className="openclaw-findings-grid">
            {candidatePrompts.map((prompt) => (
              <article key={prompt.id} className="mission-dashboard__milestone">
                <h5>{prompt.title}</h5>
                <p>{prompt.diagnosis}</p>
                <ul>
          <li><strong>Configured host:</strong> {endpointDraft.endpointHost || 'none'}</li>
          <li><strong>Configured port:</strong> {endpointDraft.endpointPort || 'none'}</li>
          <li><strong>Resolved validation host:</strong> {resolvedValidationEndpoint.host}</li>
          <li><strong>Resolved validation port:</strong> {resolvedValidationEndpoint.port}</li>
          <li><strong>Endpoint validity:</strong> {resolvedValidationEndpoint.valid ? 'valid' : 'invalid'}</li>
                  <li><strong>Risk level:</strong> {prompt.riskLevel}</li>
                  <li><strong>Relevant files:</strong> {prompt.relevantFiles.join(', ') || 'none'}</li>
                  <li><strong>Doctrine alignment:</strong> {prompt.doctrineAlignment}</li>
                  <li><strong>Why it might be wrong:</strong> {prompt.uncertainty}</li>
                  <li><strong>Safe for review only:</strong> {prompt.safeForReviewOnly ? 'yes' : 'no'}</li>
                  <li><strong>Approval status:</strong> {prompt.approvalStatus}</li>
                </ul>
                <pre className="openclaw-prompt-box">{prompt.candidatePrompt}</pre>
                <div className="openclaw-approval-rail">
                  <button type="button" onClick={() => updatePromptStatus(prompt.id, 'approved')}>Approve for Codex handoff</button>
                  <button type="button" onClick={() => updatePromptStatus(prompt.id, 'refine')}>Refine prompt</button>
                  <button type="button" onClick={() => updatePromptStatus(prompt.id, 'archived')}>Archive</button>
                  <button type="button" onClick={() => updatePromptStatus(prompt.id, 'rejected')}>Reject</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="openclaw-section">
        <h4>Catastrophic-Safety Blocks</h4>
        <p>Hard blocks active for catastrophic actions in shadow mode. These actions are structurally disallowed, not only warned.</p>
        <ul>
          <li><strong>Configured host:</strong> {endpointDraft.endpointHost || 'none'}</li>
          <li><strong>Configured port:</strong> {endpointDraft.endpointPort || 'none'}</li>
          <li><strong>Resolved validation host:</strong> {resolvedValidationEndpoint.host}</li>
          <li><strong>Resolved validation port:</strong> {resolvedValidationEndpoint.port}</li>
          <li><strong>Endpoint validity:</strong> {resolvedValidationEndpoint.valid ? 'valid' : 'invalid'}</li>
          {guardrails.blockedActions.map((actionId) => (
            <li key={actionId}>
              <code>{actionId}</code> — {isOpenClawActionBlocked(actionId) ? 'BLOCKED' : 'unexpected'}
            </li>
          ))}
        </ul>
      </section>

      <section className="openclaw-section">
        <h4>Trace / Audit</h4>
        <ul>
          <li><strong>Configured host:</strong> {endpointDraft.endpointHost || 'none'}</li>
          <li><strong>Configured port:</strong> {endpointDraft.endpointPort || 'none'}</li>
          <li><strong>Resolved validation host:</strong> {resolvedValidationEndpoint.host}</li>
          <li><strong>Resolved validation port:</strong> {resolvedValidationEndpoint.port}</li>
          <li><strong>Endpoint validity:</strong> {resolvedValidationEndpoint.valid ? 'valid' : 'invalid'}</li>
          {auditTrail.length === 0 ? <li>No actions yet.</li> : auditTrail.map((entry) => (
            <li key={entry.id}>
              <strong>{entry.type}</strong> · {entry.at}
            </li>
          ))}
        </ul>
      </section>
      </details>
    </CollapsiblePanel>
  );
}
