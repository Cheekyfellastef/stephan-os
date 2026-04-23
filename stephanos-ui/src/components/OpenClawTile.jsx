import { useMemo, useState } from 'react';
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
import { buildOpenClawCandidatePrompts } from './openclaw/openclawPromptGenerator.js';
import { appendAuditEvent, createAuditEvent } from './openclaw/openclawAuditModel.js';

function getTone(status = '') {
  return status === 'blocked' ? 'blocked' : 'allowed';
}

export default function OpenClawTile({ uiLayout, togglePanel, runtimeStatusModel, finalRouteTruth, repoPath = '/workspace/stephan-os', branchName = 'unknown' }) {
  const [selectedScanType, setSelectedScanType] = useState(OPENCLAW_SCAN_MODES[0].id);
  const [scanReport, setScanReport] = useState(null);
  const [candidatePrompts, setCandidatePrompts] = useState([]);
  const [auditTrail, setAuditTrail] = useState([]);
  const guardrails = useMemo(() => buildOpenClawGuardrailSnapshot(), []);

  const distParity = runtimeStatusModel?.runtimeTruth?.sourceDistParityOk;
  const distCautionVisible = distParity !== true;

  function record(type, details = {}) {
    setAuditTrail((previous) => appendAuditEvent(previous, createAuditEvent(type, details)));
  }

  function runScan() {
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
  }

  function updatePromptStatus(promptId, nextStatus) {
    setCandidatePrompts((previous) => previous.map((prompt) => (prompt.id === promptId
      ? { ...prompt, approvalStatus: nextStatus }
      : prompt)));
    record(`prompt-${nextStatus}`, { promptId });
  }

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
        <h4>Status / Governance</h4>
        <ul>
          <li><strong>OpenClaw mode:</strong> {OPENCLAW_MODE}</li>
          <li><strong>Authority:</strong> {OPENCLAW_AUTHORITY}</li>
          <li><strong>Cost posture:</strong> {OPENCLAW_COST_POSTURE}</li>
          <li><strong>Execution posture:</strong> {OPENCLAW_EXECUTION_POSTURE}</li>
          <li><strong>Sandbox/trust posture:</strong> bounded read-focused repo inspection only</li>
          <li><strong>Current repo path:</strong> {repoPath}</li>
          <li><strong>Current branch:</strong> {branchName}</li>
          <li><strong>Route source:</strong> {finalRouteTruth?.source || 'unknown'}</li>
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
