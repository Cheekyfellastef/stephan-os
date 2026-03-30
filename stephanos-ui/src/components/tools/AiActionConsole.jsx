import { useMemo, useState } from 'react';
import { AI_ACTION_MODES } from '../../ai/missionActionService';
import { ensureRuntimeStatusModel } from '../../state/runtimeStatusDefaults';
import { buildFinalRouteTruthView } from '../../state/finalRouteTruthView';
import { useAIStore } from '../../state/aiStore';
import { writeTextToClipboard } from '../../utils/clipboardCopy';

const AI_ACTION_LABELS = {
  [AI_ACTION_MODES.NEXT_MOVE]: 'Best Next Move',
  [AI_ACTION_MODES.BLOCKERS]: 'Top Blockers',
  [AI_ACTION_MODES.CODEX_PROMPT]: 'Suggest Codex Prompt',
  [AI_ACTION_MODES.MISSION_UPDATE]: 'Suggest Mission Update',
};

function buildContextStrip(contextPreview) {
  if (!contextPreview || typeof contextPreview !== 'object') {
    return 'Context not built yet.';
  }

  const missing = Object.entries(contextPreview.missingContext || {})
    .filter(([, value]) => value === true)
    .map(([key]) => key);
  const workspace = contextPreview.workspace || {};
  const openPanelCount = Number.isFinite(workspace.openPanelCount) ? workspace.openPanelCount : 0;
  const blockerCount = Array.isArray(contextPreview.mission?.activeBlockers)
    ? contextPreview.mission.activeBlockers.length
    : 0;

  const summary = [
    `Mission ${contextPreview.mission ? 'ready' : 'missing'}`,
    `Workspace panels ${openPanelCount}`,
    `Blockers ${blockerCount}`,
    `Runtime ${contextPreview.runtime ? 'ready' : 'missing'}`,
  ];

  if (missing.length > 0) {
    summary.push(`Missing: ${missing.join(', ')}`);
  }

  return summary.join(' · ');
}

export default function AiActionConsole({ runAiButlerAction, aiActionState }) {
  const [copyFeedback, setCopyFeedback] = useState('');
  const [fallbackCopyText, setFallbackCopyText] = useState('');
  const { isBusy, runtimeStatusModel } = useAIStore();
  const runtimeStatus = ensureRuntimeStatusModel(runtimeStatusModel);
  const routeTruthView = buildFinalRouteTruthView(runtimeStatus);
  const contextSummary = useMemo(
    () => buildContextStrip(aiActionState?.contextPreview),
    [aiActionState?.contextPreview],
  );

  async function handleRunAction(mode) {
    setCopyFeedback('');
    setFallbackCopyText('');
    await runAiButlerAction(mode);
  }

  async function handleCopyActionOutput() {
    if (!aiActionState?.output) {
      setCopyFeedback('Nothing to copy yet.');
      return;
    }

    const copyResult = await writeTextToClipboard(aiActionState.output, { navigatorObject: navigator });
    if (copyResult.ok) {
      setCopyFeedback('AI action output copied.');
      console.info('[AI ACTION] copy output succeeded');
      return;
    }

    setFallbackCopyText(aiActionState.output);
    setCopyFeedback('Clipboard unavailable. Manual copy fallback opened.');
    console.warn('[AI ACTION] fallback copy opened', { reason: copyResult.reason });
  }

  return (
    <section className="ai-action-panel" aria-label="AI Action Console">
      <div className="ai-action-header">
        <h3>AI Action Console</h3>
        <p>Grounded outputs from canonical mission/workspace/runtime truth routed through the active backend/provider path.</p>
      </div>

      <p className="ai-action-context-strip" role="status" aria-live="polite">{contextSummary}</p>
      <p className="ai-action-context-strip muted" role="status" aria-live="polite">
        Requested provider {aiActionState?.requestedProvider || routeTruthView.requestedProvider}
        {' · '}
        Executed provider {aiActionState?.executedProvider || routeTruthView.executedProvider}
        {' · '}
        Fallback {aiActionState?.fallbackUsed == null ? 'unknown' : aiActionState.fallbackUsed ? 'active' : 'not active'}
      </p>

      <div className="ai-action-buttons">
        {Object.entries(AI_ACTION_LABELS).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            className="ghost-button"
            onClick={() => handleRunAction(mode)}
            disabled={isBusy || aiActionState?.isRunning}
          >
            {aiActionState?.isRunning && aiActionState.mode === mode ? `Running ${label}...` : label}
          </button>
        ))}
      </div>

      {aiActionState?.missingContext?.length ? (
        <p className="ai-action-context-warning" role="status" aria-live="polite">
          Missing context: {aiActionState.missingContext.join(', ')}. Output may be partial.
        </p>
      ) : null}
      {aiActionState?.error ? (
        <p className="ai-action-context-warning" role="status" aria-live="polite">
          {aiActionState.error}
        </p>
      ) : null}
      {aiActionState?.output ? (
        <div className="ai-action-result">
          <div className="ai-action-result-header">
            <strong>{AI_ACTION_LABELS[aiActionState.mode] || 'AI Action Result'}</strong>
            <span>{aiActionState.generatedAt ? new Date(aiActionState.generatedAt).toLocaleTimeString() : ''}</span>
          </div>
          <textarea value={aiActionState.output} rows={10} readOnly />
          <div className="ai-action-buttons">
            <button type="button" onClick={handleCopyActionOutput}>Copy Output</button>
          </div>
          {copyFeedback ? <p className="ai-action-copy-feedback">{copyFeedback}</p> : null}
        </div>
      ) : null}

      {fallbackCopyText ? (
        <div className="clipboard-sanitiser-fallback" role="dialog" aria-modal="true" aria-label="AI action manual copy fallback">
          <h3>Manual Copy AI Action Output</h3>
          <p>Clipboard write was unavailable. Select all and copy manually.</p>
          <textarea value={fallbackCopyText} readOnly rows={12} onFocus={(event) => event.target.select()} />
          <button type="button" onClick={() => setFallbackCopyText('')}>Close</button>
        </div>
      ) : null}
    </section>
  );
}
