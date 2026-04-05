import { useEffect, useMemo, useState } from 'react';
import {
  focusRepoPowerShell,
  getApiRuntimeConfig,
  getLocalGitRitualState,
  getLocalRepoShellConfig,
  openRepoPowerShell,
} from '../ai/aiClient';
import { useAIStore } from '../state/aiStore';
import {
  applyCommitMessageProgress,
  applyPhaseCopyTransition,
  buildFullRitualPayload,
  buildRepoCdCommand,
  buildRitualBox1Payload,
  buildRitualBox2Payload,
  buildRitualBox3Payload,
  createDefaultRitualPhaseState,
  createUnknownRitualTruthSnapshot,
  formatRitualTruthDisplay,
  getRitualButtonState,
  isLocalShellLaunchAvailable,
  normalizeGitRitualTruthSnapshot,
  resolveRitualRepoPath,
} from '../state/powerShellMergeConsoleModel';
import { writeTextToClipboard } from '../utils/clipboardCopy';
import { DEFAULT_STEPHANOS_REPO_PATH } from '../../../shared/runtime/stephanosRepoShellConfig.mjs';
import CollapsiblePanel from './CollapsiblePanel';

function formatLabel(value) {
  return String(value ?? 'unknown');
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
  const { uiLayout, togglePanel, runtimeStatusModel } = useAIStore();
  const safeUiLayout = uiLayout || {};

  const [commitMessage, setCommitMessage] = useState('');
  const [phaseState, setPhaseState] = useState(createDefaultRitualPhaseState);
  const [powerShellOutput, setPowerShellOutput] = useState('');
  const [showRawMode, setShowRawMode] = useState(false);
  const [feedback, setFeedback] = useState({ tone: 'neutral', message: '' });
  const [repoPath, setRepoPath] = useState(DEFAULT_STEPHANOS_REPO_PATH);
  const [lastKnownPowerShellPid, setLastKnownPowerShellPid] = useState(null);
  const [truthSnapshot, setTruthSnapshot] = useState(createUnknownRitualTruthSnapshot);
  const [copiedButtonId, setCopiedButtonId] = useState('');

  const box1Payload = useMemo(() => buildRitualBox1Payload(commitMessage), [commitMessage]);
  const box2Payload = useMemo(() => buildRitualBox2Payload(), []);
  const box3Payload = useMemo(() => buildRitualBox3Payload(), []);
  const fullPayload = useMemo(() => buildFullRitualPayload(commitMessage), [commitMessage]);
  const localShellAvailable = useMemo(() => isLocalShellLaunchAvailable(runtimeStatusModel), [runtimeStatusModel]);
  const cdCommand = useMemo(() => buildRepoCdCommand(repoPath), [repoPath]);
  const buttonState = useMemo(() => getRitualButtonState(truthSnapshot, { manualOverride: showRawMode }), [truthSnapshot, showRawMode]);
  const truthDisplay = useMemo(() => formatRitualTruthDisplay(truthSnapshot), [truthSnapshot]);

  useEffect(() => {
    if (!copiedButtonId) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      setCopiedButtonId('');
    }, 2200);
    return () => window.clearTimeout(timeoutId);
  }, [copiedButtonId]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateLocalTruth() {
      const runtimeConfig = getApiRuntimeConfig();
      try {
        const shellConfig = await getLocalRepoShellConfig(runtimeConfig);
        if (!cancelled && shellConfig.ok) {
          setRepoPath((current) => resolveRitualRepoPath({ configuredRepoPath: shellConfig.repoPath, fallbackRepoPath: current }));
        }
      } catch {
        // Hosted/unavailable mode keeps default fallback path.
      }

      if (!localShellAvailable) {
        if (!cancelled) {
          setTruthSnapshot((current) => normalizeGitRitualTruthSnapshot(current, { hosted: true }));
        }
        return;
      }

      try {
        const ritualState = await getLocalGitRitualState(runtimeConfig);
        if (cancelled) {
          return;
        }
        setTruthSnapshot(normalizeGitRitualTruthSnapshot(ritualState.data, {
          hosted: false,
          errorMessage: ritualState.ok ? '' : 'Could not load local ritual state. Standard ritual guidance unavailable.',
        }));
        if (ritualState.data?.repoPath) {
          setRepoPath((current) => resolveRitualRepoPath({ configuredRepoPath: ritualState.data.repoPath, fallbackRepoPath: current }));
        }
      } catch {
        if (!cancelled) {
          setTruthSnapshot(normalizeGitRitualTruthSnapshot({}, {
            hosted: false,
            errorMessage: 'Could not load local ritual state. Standard ritual guidance unavailable.',
          }));
        }
      }
    }

    hydrateLocalTruth();

    return () => {
      cancelled = true;
    };
  }, [localShellAvailable]);

  function setCopyFeedback(result, successMessage, copyTargetId) {
    if (result.ok) {
      setFeedback({ tone: 'success', message: successMessage });
      setCopiedButtonId(copyTargetId);
      return;
    }
    setCopiedButtonId('');
    setFeedback({ tone: 'warning', message: 'Clipboard unavailable. Copy manually from the raw mode section.' });
  }

  async function handleCopyBox1() {
    if (!buttonState.box1.enabled) {
      setFeedback({ tone: 'warning', message: buttonState.box1.reason || 'Box 1 is currently blocked.' });
      return;
    }
    if (!commitMessage.trim()) {
      setFeedback({ tone: 'warning', message: 'Enter a commit message before copying Box 1.' });
      return;
    }
    const result = await writeTextToClipboard(box1Payload);
    setCopyFeedback(result, 'Copied Box 1.', 'box1');
    setPhaseState((prev) => applyPhaseCopyTransition(prev, 'box1'));
  }

  async function handleCopyBox2() {
    if (!buttonState.box2.enabled) {
      setFeedback({ tone: 'warning', message: buttonState.box2.reason || 'Box 2 is currently blocked.' });
      return;
    }
    const result = await writeTextToClipboard(box2Payload);
    setCopyFeedback(result, 'Copied Box 2.', 'box2');
    setPhaseState((prev) => applyPhaseCopyTransition(prev, 'box2'));
  }

  async function handleCopyBox3() {
    if (!buttonState.box3.enabled) {
      setFeedback({ tone: 'warning', message: buttonState.box3.reason || 'Box 3 is currently blocked.' });
      return;
    }
    const result = await writeTextToClipboard(box3Payload);
    setCopyFeedback(result, 'Copied Box 3.', 'box3');
    setPhaseState((prev) => applyPhaseCopyTransition(prev, 'box3'));
  }

  async function handleCopyFullRitual() {
    if (!buttonState.copyFullRitual.enabled) {
      setFeedback({ tone: 'warning', message: buttonState.copyFullRitual.reason || 'Full ritual copy is currently guarded.' });
      return;
    }
    const result = await writeTextToClipboard(fullPayload);
    setCopyFeedback(result, 'Copied full ritual.', 'fullRitual');
  }

  async function handleCopyPowerShellOutput() {
    const result = await writeTextToClipboard(powerShellOutput);
    setCopyFeedback(result, 'Copied PowerShell output transcript.', 'output');
  }

  async function handleCopyRepoPath() {
    const result = await writeTextToClipboard(repoPath);
    setCopyFeedback(result, 'Copied repo path.', 'repoPath');
  }

  async function handleCopyCdCommand() {
    const result = await writeTextToClipboard(cdCommand);
    setCopyFeedback(result, 'Copied PowerShell cd command.', 'cdCommand');
  }

  async function handleOpenRepoPowerShell() {
    const runtimeTruth = runtimeStatusModel?.finalRouteTruth || {};
    const routeKind = runtimeTruth.routeKind || 'unknown';
    console.info('[POWER SHELL MERGE CONSOLE] open repo PowerShell requested', {
      sessionKind: runtimeTruth.sessionKind || 'unknown',
      routeKind,
      backendReachable: runtimeTruth.backendReachable === true,
      localShellAvailable,
    });

    if (!localShellAvailable) {
      setFeedback({
        tone: 'warning',
        message: 'Local shell controls are only available in local desktop runtime. Use Copy Repo Path or Copy cd Command.',
      });
      return;
    }

    try {
      const runtimeConfig = getApiRuntimeConfig();
      const result = await openRepoPowerShell(runtimeConfig);
      console.info('[POWER SHELL MERGE CONSOLE] open repo PowerShell response received', result);
      const resolvedRepoPath = resolveRitualRepoPath({ configuredRepoPath: result.repoPath, fallbackRepoPath: repoPath });
      setRepoPath(resolvedRepoPath);
      setLastKnownPowerShellPid(result.pid || null);

      if (result.ok && result.launched) {
        const focusSummary = result.topmostApplied ? ' Brought to front and pinned on top.' : (result.focusApplied ? ' Brought to front.' : '');
        setFeedback({ tone: 'success', message: `Opened PowerShell in repo folder.${focusSummary}` });
        return;
      }

      setFeedback({
        tone: 'warning',
        message: result.reason === 'local-desktop-runtime-required'
          ? 'Local shell controls are only available in local desktop runtime.'
          : `Could not open PowerShell: ${result.reason || 'unknown reason'}.`,
      });
    } catch (error) {
      setFeedback({ tone: 'warning', message: `Could not open PowerShell: ${error?.message || 'backend request failed'}.` });
    }
  }

  async function handleFocusRepoPowerShell() {
    const runtimeTruth = runtimeStatusModel?.finalRouteTruth || {};
    const routeKind = runtimeTruth.routeKind || 'unknown';
    console.info('[POWER SHELL MERGE CONSOLE] focus repo PowerShell requested', {
      sessionKind: runtimeTruth.sessionKind || 'unknown',
      routeKind,
      backendReachable: runtimeTruth.backendReachable === true,
      localShellAvailable,
      lastKnownPowerShellPid,
    });

    if (!localShellAvailable) {
      setFeedback({ tone: 'warning', message: 'Local shell controls are only available in local desktop runtime.' });
      return;
    }

    try {
      const runtimeConfig = getApiRuntimeConfig();
      const result = await focusRepoPowerShell(runtimeConfig);
      console.info('[POWER SHELL MERGE CONSOLE] focus repo PowerShell response received', result);
      if (result.ok && result.focused) {
        setFeedback({
          tone: 'success',
          message: result.topmostApplied ? 'Focused PowerShell and kept it on top.' : 'Focused PowerShell.',
        });
        setLastKnownPowerShellPid(result.pid || null);
        return;
      }

      setFeedback({
        tone: 'warning',
        message: result.reason === 'no-known-powershell-session'
          ? 'Could not focus PowerShell: no launched shell is known yet. Open PowerShell first.'
          : `Could not focus PowerShell: ${result.reason || 'unknown reason'}.`,
      });
    } catch (error) {
      setFeedback({ tone: 'warning', message: `Could not focus PowerShell: ${error?.message || 'backend request failed'}.` });
    }
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

      {truthSnapshot.hostedLimitation ? <p className="power-shell-note">{truthSnapshot.hostedLimitation}</p> : null}
      {truthSnapshot.errorMessage ? <p className="mission-feedback warning">{truthSnapshot.errorMessage}</p> : null}

      <section className="power-shell-truth-grid" aria-label="Ritual truth status">
        <article className="power-shell-truth-card">
          <h3>Branch + Sync State</h3>
          <p><b>Branch:</b> {formatLabel(truthSnapshot.currentBranch)}</p>
          <p><b>Tracking:</b> {formatLabel(truthSnapshot.trackingBranch || 'unknown')}</p>
          <p><b>Sync:</b> {truthDisplay.syncState}</p>
        </article>
        <article className="power-shell-truth-card">
          <h3>Working State</h3>
          <p><b>Working Tree:</b> {truthDisplay.workingTree}</p>
          <p><b>Staged:</b> {truthDisplay.staged} · <b>Unstaged:</b> {truthDisplay.unstaged}</p>
          <p><b>Untracked:</b> {truthDisplay.untracked} · <b>Dist changed:</b> {formatLabel(truthDisplay.distChanged)}</p>
        </article>
        <article className="power-shell-truth-card">
          <h3>Conflict / Flow State</h3>
          <p><b>Rebase:</b> {truthDisplay.rebase} · <b>Merge:</b> {truthDisplay.merge}</p>
          <p><b>Cherry-pick:</b> {truthDisplay.cherryPick} · <b>Conflicts:</b> {truthDisplay.conflicts}</p>
          <p><b>Dist conflicts:</b> {truthDisplay.distConflicts}</p>
        </article>
        <article className="power-shell-truth-card">
          <h3>Build + Verify Status</h3>
          <p><b>Build:</b> <span className={`health-badge ${statusTone(truthSnapshot.buildLastResult)}`}>{formatLabel(truthSnapshot.buildLastResult)}</span></p>
          <p><b>Verify:</b> <span className={`health-badge ${statusTone(truthSnapshot.verifyLastResult)}`}>{formatLabel(truthSnapshot.verifyLastResult)}</span></p>
          <p className="power-shell-note">Source: build {formatLabel(truthSnapshot.buildStatusSource)} / verify {formatLabel(truthSnapshot.verifyStatusSource)}</p>
        </article>
      </section>

      <section className="power-shell-phase-strip" aria-label="Ritual applicability layer">
        <h3>Ritual Applicability</h3>
        <ul>
          <li><span>Next Action</span><span className={`health-badge ${statusTone(truthSnapshot.riskLevel)}`}>{formatLabel(truthSnapshot.nextRecommendedAction)}</span></li>
          <li><span>Risk Level</span><span className={`health-badge ${statusTone(truthSnapshot.riskLevel)}`}>{formatLabel(truthSnapshot.riskLevel)}</span></li>
          <li><span>Flow State</span><span className={`health-badge ${statusTone(truthSnapshot.riskLevel)}`}>{formatLabel(truthSnapshot.activeFlowState)}</span></li>
          <li><span>Box 1 · Commit + Rebase Start</span><span className={`health-badge ${phaseTone(phaseState.box1)}`}>{phaseState.box1}</span></li>
          <li><span>Box 2 · Dist Conflict Resolution + Rebuild</span><span className={`health-badge ${phaseTone(phaseState.box2)}`}>{phaseState.box2}</span></li>
          <li><span>Box 3 · Finalize + Push</span><span className={`health-badge ${phaseTone(phaseState.box3)}`}>{phaseState.box3}</span></li>
        </ul>
      </section>

      <section className="power-shell-local-shell" aria-label="Local shell actions">
        <div className="power-shell-box-header">
          <h3>Local Shell</h3>
          <span className={`health-badge ${localShellAvailable ? 'ready' : 'warning'}`}>
            {localShellAvailable ? 'local desktop' : 'hosted / fallback'}
          </span>
        </div>
        <p className="power-shell-note">Repo path source of truth: <code>{repoPath}</code></p>
        <div className="power-shell-controls">
          <button type="button" className="power-shell-ops-button" onClick={handleOpenRepoPowerShell}>Open PowerShell in Repo Folder</button>
          <button type="button" className="power-shell-ops-button" onClick={handleFocusRepoPowerShell}>Focus PowerShell</button>
          <button type="button" className={`ghost-button ${copiedButtonId === 'repoPath' ? 'power-shell-copy-success' : ''}`} onClick={handleCopyRepoPath}>{copiedButtonId === 'repoPath' ? 'Copied Repo Path' : 'Copy Repo Path'}</button>
          <button type="button" className={`ghost-button ${copiedButtonId === 'cdCommand' ? 'power-shell-copy-success' : ''}`} onClick={handleCopyCdCommand}>{copiedButtonId === 'cdCommand' ? 'Copied cd Command' : 'Copy cd Command'}</button>
        </div>
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
          <button type="button" className={`ghost-button ${copiedButtonId === 'box1' ? 'power-shell-copy-success' : ''}`} onClick={handleCopyBox1} disabled={!buttonState.box1.enabled} title={buttonState.box1.reason}>{copiedButtonId === 'box1' ? 'Copied Box 1' : 'Copy Box 1'}</button>
        </div>
        {!buttonState.box1.enabled ? <p className="power-shell-note">{buttonState.box1.reason}</p> : null}
        <pre>{box1Payload}</pre>
      </section>

      <section className="power-shell-box" aria-label="Ritual box 2">
        <div className="power-shell-box-header">
          <h3>Box 2 · Dist Conflict Resolution + Rebuild</h3>
          <button type="button" className={`ghost-button ${copiedButtonId === 'box2' ? 'power-shell-copy-success' : ''}`} onClick={handleCopyBox2} disabled={!buttonState.box2.enabled} title={buttonState.box2.reason}>{copiedButtonId === 'box2' ? 'Copied Box 2' : 'Copy Box 2'}</button>
        </div>
        <p className="power-shell-note">Use this block if dist conflicts appear during rebase.</p>
        {!buttonState.box2.enabled ? <p className="power-shell-note">{buttonState.box2.reason}</p> : null}
        <pre>{box2Payload}</pre>
      </section>

      <section className="power-shell-box" aria-label="Ritual box 3">
        <div className="power-shell-box-header">
          <h3>Box 3 · Finalize + Push</h3>
          <button type="button" className={`ghost-button ${copiedButtonId === 'box3' ? 'power-shell-copy-success' : ''}`} onClick={handleCopyBox3} disabled={!buttonState.box3.enabled} title={buttonState.box3.reason}>{copiedButtonId === 'box3' ? 'Copied Box 3' : 'Copy Box 3'}</button>
        </div>
        {!buttonState.box3.enabled ? <p className="power-shell-note">{buttonState.box3.reason}</p> : null}
        <pre>{box3Payload}</pre>
      </section>

      <section className="power-shell-controls">
        <button type="button" className={copiedButtonId === 'fullRitual' ? 'power-shell-copy-success' : ''} onClick={handleCopyFullRitual} disabled={!buttonState.copyFullRitual.enabled} title={buttonState.copyFullRitual.reason}>{copiedButtonId === 'fullRitual' ? 'Copied Full Ritual' : 'Copy Full Ritual'}</button>
        <button type="button" className="ghost-button" onClick={handleResetRitualState}>Reset Ritual State</button>
        <button type="button" className="ghost-button" onClick={() => setShowRawMode((prev) => !prev)}>
          {showRawMode ? 'Hide Raw Mode' : 'Manual Override / Raw Mode'}
        </button>
      </section>

      <section className="power-shell-output" aria-label="PowerShell output uplink">
        <div className="power-shell-box-header">
          <h3>PowerShell Output Uplink</h3>
          <button type="button" className={`ghost-button ${copiedButtonId === 'output' ? 'power-shell-copy-success' : ''}`} onClick={handleCopyPowerShellOutput}>{copiedButtonId === 'output' ? 'Copied PowerShell Output' : 'Copy PowerShell Output'}</button>
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
          <p className="power-shell-note">Raw ritual blocks stay available even when truth-aware controls are guarded.</p>
          <div className="power-shell-controls">
            <button type="button" className={`ghost-button ${copiedButtonId === 'rawBox1' ? 'power-shell-copy-success' : ''}`} onClick={async () => setCopyFeedback(await writeTextToClipboard(box1Payload), 'Copied raw Box 1.', 'rawBox1')}>{copiedButtonId === 'rawBox1' ? 'Copied Raw Box 1' : 'Copy Raw Box 1'}</button>
            <button type="button" className={`ghost-button ${copiedButtonId === 'rawBox2' ? 'power-shell-copy-success' : ''}`} onClick={async () => setCopyFeedback(await writeTextToClipboard(box2Payload), 'Copied raw Box 2.', 'rawBox2')}>{copiedButtonId === 'rawBox2' ? 'Copied Raw Box 2' : 'Copy Raw Box 2'}</button>
            <button type="button" className={`ghost-button ${copiedButtonId === 'rawBox3' ? 'power-shell-copy-success' : ''}`} onClick={async () => setCopyFeedback(await writeTextToClipboard(box3Payload), 'Copied raw Box 3.', 'rawBox3')}>{copiedButtonId === 'rawBox3' ? 'Copied Raw Box 3' : 'Copy Raw Box 3'}</button>
          </div>
          <pre>{fullPayload}</pre>
        </section>
      ) : null}

      {feedback.message ? <p className={`mission-feedback ${feedback.tone}`}>{feedback.message}</p> : null}
    </CollapsiblePanel>
  );
}
