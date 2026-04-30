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

function getTone(status = '') {
  return status === 'blocked' ? 'blocked' : 'allowed';
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
  const validationButtonEnabled = operatorTask?.openClawAdapterEndpointConfigured === true
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
        <h4>Endpoint Configuration (session-only v1)</h4>
        <p className="muted"><strong>session-only, no secrets stored</strong></p>
        <p className="muted"><strong>endpoint configuration only: no health check, no handshake, no connection, no live automation</strong></p>
        <label>label input
          <input value={endpointDraft.endpointLabel || ''} onChange={(event) => onApplyOpenClawEndpointConfig({ ...endpointDraft, endpointLabel: event.target.value })} />
        </label>
        <label>host input
          <input value={endpointDraft.endpointHost || ''} onChange={(event) => onApplyOpenClawEndpointConfig({ ...endpointDraft, endpointHost: event.target.value })} />
        </label>
        <label>port input
          <input value={endpointDraft.endpointPort || ''} onChange={(event) => onApplyOpenClawEndpointConfig({ ...endpointDraft, endpointPort: event.target.value })} />
        </label>
        <label>expected protocol input/select
          <input value={endpointDraft.expectedProtocolVersion || 'v1'} onChange={(event) => onApplyOpenClawEndpointConfig({ ...endpointDraft, expectedProtocolVersion: event.target.value })} />
        </label>
        <label>allowed probes select
          <select value={endpointDraft.allowedProbeTypes || 'health_and_handshake'} onChange={(event) => onApplyOpenClawEndpointConfig({ ...endpointDraft, allowedProbeTypes: event.target.value })}>
            <option value="none">none</option><option value="health_only">health_only</option><option value="handshake_only">handshake_only</option><option value="health_and_handshake">health_and_handshake</option>
          </select>
        </label>
        <p>scope display/select locked to local_only for v1</p>
        <button type="button" onClick={() => onApplyOpenClawEndpointConfig({ ...endpointDraft, endpointScope: 'local_only', configPersistenceMode: 'session_only', endpointMode: 'configured' })}>apply/update button</button>
        <button type="button" onClick={onClearOpenClawEndpointConfig}>reset/clear session config button</button>
        <ul>
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
          <li><strong>Validation endpoint:</strong> {validationEndpointAvailable ? 'available' : 'missing'}</li>
          <li><strong>Validation endpoint path:</strong> {operatorTask?.openClawReadonlyValidationEndpointPath || 'none'}</li>
          <li><strong>Validation endpoint mode:</strong> {operatorTask?.openClawReadonlyValidationEndpointMode || 'missing'}</li>
          <li><strong>Validation status:</strong> {validationStatus}</li>
          <li><strong>Validation mode:</strong> {operatorTask?.openClawHealthValidationMode || 'none'}</li>
          <li><strong>Validation source:</strong> {operatorTask?.openClawHealthValidationSource || 'unknown'}</li>
          <li><strong>Health state:</strong> {operatorTask?.openClawHealthState || 'not_run'}</li>
          <li><strong>Handshake state:</strong> {operatorTask?.openClawHandshakeState || 'not_run'}</li>
          <li><strong>Protocol compatible:</strong> {operatorTask?.openClawProtocolCompatible ? 'yes' : 'no'}</li>
          <li><strong>Adapter identity:</strong> {operatorTask?.openClawAdapterIdentity || 'missing'}</li>
          <li><strong>Readonly assurance:</strong> {operatorTask?.openClawReadonlyAssurance?.readonlyOnly ? 'asserted' : 'not asserted'}</li>
          <li><strong>Top blocker:</strong> {operatorTask?.openClawHealthValidationBlockers?.[0] || 'none'}</li>
          <li><strong>Top warning:</strong> {operatorTask?.openClawHealthValidationWarnings?.[0] || 'none'}</li>
          <li><strong>Next action:</strong> {operatorTask?.openClawHealthValidationNextAction || operatorTask?.openClawHealthHandshakeNextAction || 'not reported'}</li>
        </ul>
        {adapterUnreachable ? (
          <p className="muted">
            Stephanos is alive, but the readonly OpenClaw adapter is not reachable at {adapterHost}:{adapterPort}. Start or configure the local adapter, then retry validation. Execution remains disabled.
          </p>
        ) : null}
        <button type="button" disabled={!validationButtonEnabled} onClick={() => onRequestReadonlyValidation(endpointDraft)}>
          {validationButtonEnabled ? 'Validate readonly health/handshake' : 'Validation unavailable: missing safe readonly validation endpoint or config readiness'}
        </button>
      </section>

      <section className="openclaw-section">
        <h4>Status / Governance</h4>
        <ul>
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
            {integrationSnapshot.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </section>
      ) : null}

      <section className="openclaw-section">
        <h4>Integration Topology</h4>
        <p>{integrationSnapshot.topology.map((entry) => entry.label).join(' → ')}</p>
        <ul>
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
                    <li><strong>Confidence:</strong> {finding.confidence}</li>
                    <li><strong>Uncertainty:</strong> {finding.uncertainty}</li>
                    <li><strong>Doctrine drift risk:</strong> {finding.doctrineRisk}</li>
                    <li><strong>Likely files:</strong> {(finding.likelyFiles || []).join(', ')}</li>
                  </ul>
                  <p><strong>Evidence:</strong></p>
                  <ul>
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
          {auditTrail.length === 0 ? <li>No actions yet.</li> : auditTrail.map((entry) => (
            <li key={entry.id}>
              <strong>{entry.type}</strong> · {entry.at}
            </li>
          ))}
        </ul>
      </section>
    </CollapsiblePanel>
  );
}
