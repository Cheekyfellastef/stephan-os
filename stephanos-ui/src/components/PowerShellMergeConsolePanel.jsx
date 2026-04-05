import { useMemo, useState } from 'react';
import { useAIStore } from '../state/aiStore';
import {
  applyCommitMessageProgress,
  applyPhaseCopyTransition,
  buildFullRitualPayload,
  buildRitualBox1Payload,
  buildRitualBox2Payload,
  buildRitualBox3Payload,
  createDefaultRitualPhaseState,
  createUnknownRitualTruthSnapshot,
} from '../state/powerShellMergeConsoleModel';
import { writeTextToClipboard } from '../utils/clipboardCopy';
import CollapsiblePanel from './CollapsiblePanel';

function formatLabel(value) {
  return String(value || 'unknown');
}

function statusTone(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'success' || normalized === 'clean' || normalized === 'low') {
    return 'ready';
  }
  if (normalized === 'failed' || normalized === 'dirty' || normalized === 'high') {
    return 'degraded';
  }
  if (normalized === 'medium' || normalized === 'in-progress') {
    return 'warning';
  }
  return 'unknown';
}

function phaseTone(value) {
  if (value === 'completed') return 'ready';
  if (value === 'copied') return 'active';
  if (value === 'in-progress') return 'warning';
  return 'unknown';
}

export default function PowerShellMergeConsolePanel() {
  const { uiLayout, togglePanel } = useAIStore();
  const safeUiLayout = uiLayout || {};

  const [commitMessage, setCommitMessage] = useState('');
  const [phaseState, setPhaseState] = useState(createDefaultRitualPhaseState);
  const [powerShellOutput, setPowerShellOutput] = useState('');
  const [showRawMode, setShowRawMode] = useState(false);
  const [feedback, setFeedback] = useState({ tone: 'neutral', message: '' });

  const truthSnapshot = useMemo(() => createUnknownRitualTruthSnapshot(), []);
  const box1Payload = useMemo(() => buildRitualBox1Payload(commitMessage), [commitMessage]);
  const box2Payload = useMemo(() => buildRitualBox2Payload(), []);
  const box3Payload = useMemo(() => buildRitualBox3Payload(), []);
  const fullPayload = useMemo(() => buildFullRitualPayload(commitMessage), [commitMessage]);

  function setCopyFeedback(result, successMessage) {
    if (result.ok) {
      setFeedback({ tone: 'success', message: successMessage });
      return;
    }
    setFeedback({ tone: 'warning', message: 'Clipboard unavailable. Copy manually from the raw mode section.' });
  }

  async function handleCopyBox1() {
    if (!commitMessage.trim()) {
      setFeedback({ tone: 'warning', message: 'Enter a commit message before copying Box 1.' });
      return;
    }
    const result = await writeTextToClipboard(box1Payload);
    setCopyFeedback(result, 'Copied Box 1.');
    setPhaseState((prev) => applyPhaseCopyTransition(prev, 'box1'));
  }

  async function handleCopyBox2() {
    const result = await writeTextToClipboard(box2Payload);
    setCopyFeedback(result, 'Copied Box 2.');
    setPhaseState((prev) => applyPhaseCopyTransition(prev, 'box2'));
  }

  async function handleCopyBox3() {
    const result = await writeTextToClipboard(box3Payload);
    setCopyFeedback(result, 'Copied Box 3.');
    setPhaseState((prev) => applyPhaseCopyTransition(prev, 'box3'));
  }

  async function handleCopyFullRitual() {
    const result = await writeTextToClipboard(fullPayload);
    setCopyFeedback(result, 'Copied full ritual.');
  }

  async function handleCopyPowerShellOutput() {
    const result = await writeTextToClipboard(powerShellOutput);
    setCopyFeedback(result, 'Copied PowerShell output transcript.');
  }

  function handleCommitMessageChange(nextValue) {
    setCommitMessage(nextValue);
    setPhaseState((prev) => applyCommitMessageProgress(prev, nextValue));
  }

  function handleResetRitualState() {
    setPhaseState(createDefaultRitualPhaseState());
    setFeedback({ tone: 'neutral', message: 'Ritual phase state reset.' });
  }

  return (
    <CollapsiblePanel
      panelId="powerShellMergeConsolePanel"
      title="PowerShell Merge Console"
      description="Engineering merge / rebuild ritual console"
      className="power-shell-merge-panel"
      isOpen={safeUiLayout.powerShellMergeConsolePanel !== false}
      onToggle={() => togglePanel('powerShellMergeConsolePanel')}
      keepMountedWhenClosed
    >
      <p className="power-shell-intro">
        Truth-first operator console for the 3-box PowerShell ritual. Commands stay explicit and manual while future execution hooks remain possible.
      </p>

      <section className="power-shell-truth-grid" aria-label="Ritual truth status">
        <article className="power-shell-truth-card">
          <h3>Branch + Sync State</h3>
          <p><b>Current branch:</b> {formatLabel(truthSnapshot.branchLabel)}</p>
          <p><b>Ahead/behind origin:</b> {formatLabel(truthSnapshot.aheadBehindLabel)}</p>
          <p><b>Rebase likely/required:</b> {formatLabel(truthSnapshot.rebaseIndicator)}</p>
        </article>
        <article className="power-shell-truth-card">
          <h3>Working State</h3>
          <p><b>Clean/dirty:</b> {formatLabel(truthSnapshot.workingStateLabel)}</p>
          <p><b>Staged/unstaged:</b> {formatLabel(truthSnapshot.stagedSummary)}</p>
          <p><b>Dist changes detected:</b> {formatLabel(truthSnapshot.distChangesDetected)}</p>
        </article>
        <article className="power-shell-truth-card">
          <h3>Conflict + Build/Verify</h3>
          <p><b>Conflict risk:</b> <span className={`health-badge ${statusTone(truthSnapshot.conflictRisk)}`}>{formatLabel(truthSnapshot.conflictRisk)}</span></p>
          <p><b>Last build:</b> <span className={`health-badge ${statusTone(truthSnapshot.lastBuildStatus)}`}>{formatLabel(truthSnapshot.lastBuildStatus)}</span></p>
          <p><b>Last verify:</b> <span className={`health-badge ${statusTone(truthSnapshot.lastVerifyStatus)}`}>{formatLabel(truthSnapshot.lastVerifyStatus)}</span></p>
        </article>
      </section>

      <section className="power-shell-phase-strip" aria-label="Ritual phase tracker">
        <h3>Ritual Phase Tracker</h3>
        <ul>
          <li><span>Box 1 · Commit + Rebase Start</span><span className={`health-badge ${phaseTone(phaseState.box1)}`}>{phaseState.box1}</span></li>
          <li><span>Box 2 · Dist Conflict Resolution + Rebuild</span><span className={`health-badge ${phaseTone(phaseState.box2)}`}>{phaseState.box2}</span></li>
          <li><span>Box 3 · Finalize + Push</span><span className={`health-badge ${phaseTone(phaseState.box3)}`}>{phaseState.box3}</span></li>
        </ul>
      </section>

      <label className="power-shell-commit-field">
        Commit message
        <input
          type="text"
          value={commitMessage}
          placeholder="Describe this ritual commit"
          onChange={(event) => handleCommitMessageChange(event.target.value)}
        />
      </label>

      <section className="power-shell-box" aria-label="Ritual box 1">
        <div className="power-shell-box-header">
          <h3>Box 1 · Commit + Rebase Start</h3>
          <button type="button" className="ghost-button" onClick={handleCopyBox1}>Copy Box 1</button>
        </div>
        <pre>{box1Payload}</pre>
      </section>

      <section className="power-shell-box" aria-label="Ritual box 2">
        <div className="power-shell-box-header">
          <h3>Box 2 · Dist Conflict Resolution + Rebuild</h3>
          <button type="button" className="ghost-button" onClick={handleCopyBox2}>Copy Box 2</button>
        </div>
        <p className="power-shell-note">Use this block if dist conflicts appear during rebase.</p>
        <pre>{box2Payload}</pre>
      </section>

      <section className="power-shell-box" aria-label="Ritual box 3">
        <div className="power-shell-box-header">
          <h3>Box 3 · Finalize + Push</h3>
          <button type="button" className="ghost-button" onClick={handleCopyBox3}>Copy Box 3</button>
        </div>
        <pre>{box3Payload}</pre>
      </section>

      <section className="power-shell-controls">
        <button type="button" onClick={handleCopyFullRitual}>Copy Full Ritual</button>
        <button type="button" className="ghost-button" onClick={handleResetRitualState}>Reset Ritual State</button>
        <button type="button" className="ghost-button" onClick={() => setShowRawMode((prev) => !prev)}>
          {showRawMode ? 'Hide Raw Mode' : 'Manual Override / Raw Mode'}
        </button>
      </section>

      <section className="power-shell-output" aria-label="PowerShell output uplink">
        <div className="power-shell-box-header">
          <h3>PowerShell Output Uplink</h3>
          <button type="button" className="ghost-button" onClick={handleCopyPowerShellOutput}>Copy PowerShell Output</button>
        </div>
        <p className="power-shell-note">Paste terminal output here, then copy it cleanly for diagnostic handoff into ChatGPT.</p>
        <textarea
          value={powerShellOutput}
          onChange={(event) => setPowerShellOutput(event.target.value)}
          placeholder="Paste PowerShell transcript here..."
          rows={7}
        />
      </section>

      {showRawMode ? (
        <section className="power-shell-raw" aria-label="Manual override raw ritual blocks">
          <h3>Captain Manual Override</h3>
          <p className="power-shell-note">Raw ritual blocks, no abstraction.</p>
          <pre>{fullPayload}</pre>
        </section>
      ) : null}

      {feedback.message ? <p className={`mission-feedback ${feedback.tone}`}>{feedback.message}</p> : null}
      <p className="power-shell-future-note">Future hooks: live git truth source, real command execution, transcript logging, and assisted step execution.</p>
    </CollapsiblePanel>
  );
}
