import { useMemo, useState } from 'react';
import CollapsiblePanel from '../CollapsiblePanel';
import { useAIStore } from '../../state/aiStore';
import {
  buildCopyResult,
  buildStephanosPrompt,
  PROMPT_BUILDER_DEFAULT_MAX_TELEMETRY,
} from './promptBuilder.js';
import { buildPromptBuilderSummary } from '../../../../shared/prompts/promptBuilderSummary.mjs';

export default function PromptBuilder({
  runtimeStatusModel,
  finalRouteTruth = null,
  telemetryEntries,
  actionHints,
  orchestrationTruth,
  agentTaskProjection = null,
}) {
  const { uiLayout, togglePanel } = useAIStore();
  const [mission, setMission] = useState('');
  const [includeTruth, setIncludeTruth] = useState(true);
  const [includeTelemetry, setIncludeTelemetry] = useState(true);
  const [includeActionHints, setIncludeActionHints] = useState(true);
  const [includeConstraints, setIncludeConstraints] = useState(true);
  const [maxTelemetryEntries, setMaxTelemetryEntries] = useState(PROMPT_BUILDER_DEFAULT_MAX_TELEMETRY);
  const [copyStatus, setCopyStatus] = useState('');

  const promptText = useMemo(() => buildStephanosPrompt({
    mission,
    finalRouteTruth: finalRouteTruth ?? runtimeStatusModel?.finalRouteTruth ?? null,
    telemetryEntries,
    actionHints,
    includeTruth,
    includeTelemetry,
    includeActionHints,
    includeConstraints,
    maxTelemetryEntries,
    orchestrationTruth,
  }), [
    actionHints,
    includeActionHints,
    includeConstraints,
    includeTelemetry,
    includeTruth,
    maxTelemetryEntries,
    mission,
    finalRouteTruth,
    runtimeStatusModel?.finalRouteTruth,
    telemetryEntries,
    orchestrationTruth,
  ]);

  const contextBindings = useMemo(() => {
    const readiness = agentTaskProjection?.readinessSummary || {};
    return {
      agentTaskContextAvailable: Boolean(agentTaskProjection?.readinessSummary),
      codexHandoffContextAvailable: readiness.codexManualHandoffReady === true
        || ['ready', 'manual_handoff_only'].includes(String(readiness.codexReadiness || '').toLowerCase()),
      verificationReturnContextAvailable: Boolean(readiness.verificationReturnStatus),
      telemetryContextAvailable: Array.isArray(telemetryEntries) && telemetryEntries.length > 0,
      runtimeTruthContextAvailable: Boolean(finalRouteTruth ?? runtimeStatusModel?.finalRouteTruth),
      openClawContextAvailable: Boolean(readiness.openClawReadiness),
      actionHintsAvailable: Array.isArray(actionHints) && actionHints.length > 0,
      constraintsAvailable: includeConstraints === true,
    };
  }, [actionHints, agentTaskProjection?.readinessSummary, finalRouteTruth, includeConstraints, runtimeStatusModel?.finalRouteTruth, telemetryEntries]);

  const promptBuilderSummary = useMemo(() => buildPromptBuilderSummary({
    promptBuilderAvailable: true,
    promptText,
    telemetryEntries,
    actionHints,
    finalRouteTruth: finalRouteTruth ?? runtimeStatusModel?.finalRouteTruth ?? null,
    orchestrationTruth,
    contextBindings,
    constraintsIncluded: includeConstraints,
    copySupported: true,
  }), [actionHints, contextBindings, finalRouteTruth, includeConstraints, orchestrationTruth, promptText, runtimeStatusModel?.finalRouteTruth, telemetryEntries]);

  const topMissingContext = useMemo(() => {
    if (!promptBuilderSummary.supportsAgentTaskContext) return 'Agent Task context';
    if (!promptBuilderSummary.supportsTelemetryContext) return 'Telemetry context';
    if (!promptBuilderSummary.supportsRuntimeTruthContext) return 'Runtime truth context';
    if (!promptBuilderSummary.supportsCodexHandoff) return 'Codex handoff context';
    if (!promptBuilderSummary.supportsConstraints || !promptBuilderSummary.supportsActionHints) return 'Constraints/action hints';
    return 'none';
  }, [promptBuilderSummary]);

  const handleCopyPrompt = async () => {
    const result = await buildCopyResult({
      clipboard: globalThis.navigator?.clipboard,
      promptText,
    });
    setCopyStatus(result.message);
  };

  return (
    <CollapsiblePanel
      as="aside"
      panelId="promptBuilderPanel"
      title="Prompt Builder"
      description="Compile deterministic, copy-ready implementation prompts from current mission console truth."
      className="prompt-builder-panel"
      isOpen={uiLayout.promptBuilderPanel !== false}
      onToggle={() => togglePanel('promptBuilderPanel')}
    >

      <ul className="compact-list">
        <li>Status: {promptBuilderSummary.status}</li>
        <li>Agent Task context: {promptBuilderSummary.supportsAgentTaskContext ? 'available' : 'missing'}</li>
        <li>Telemetry context: {promptBuilderSummary.supportsTelemetryContext ? 'available' : 'missing'}</li>
        <li>Runtime truth context: {promptBuilderSummary.supportsRuntimeTruthContext ? 'available' : 'missing'}</li>
        <li>Codex handoff context: {promptBuilderSummary.supportsCodexHandoff ? 'available' : 'missing'}</li>
        <li>Constraints/action hints: {(promptBuilderSummary.supportsConstraints && promptBuilderSummary.supportsActionHints) ? 'available' : 'missing'}</li>
        <li>Top missing context: {topMissingContext}</li>
        <li>Top warning/blocker: {promptBuilderSummary.blockers[0] || promptBuilderSummary.warnings[0] || 'none'}</li>
        <li>Next action: {promptBuilderSummary.nextActions[0] || 'none'}</li>
      </ul>

      <label className="prompt-builder-field">
        Mission
        <input
          type="text"
          value={mission}
          onChange={(event) => setMission(event.target.value)}
          placeholder="Describe the implementation or debugging mission"
        />
      </label>

      <div className="prompt-builder-controls">
        <label><input type="checkbox" checked={includeTruth} onChange={(event) => setIncludeTruth(event.target.checked)} /> Include truth snapshot</label>
        <label><input type="checkbox" checked={includeTelemetry} onChange={(event) => setIncludeTelemetry(event.target.checked)} /> Include telemetry</label>
        <label><input type="checkbox" checked={includeActionHints} onChange={(event) => setIncludeActionHints(event.target.checked)} /> Include action hints</label>
        <label><input type="checkbox" checked={includeConstraints} onChange={(event) => setIncludeConstraints(event.target.checked)} /> Include constraints</label>
      </div>

      <label className="prompt-builder-field">
        Telemetry entries
        <select value={maxTelemetryEntries} onChange={(event) => setMaxTelemetryEntries(Number(event.target.value))}>
          <option value={3}>3</option>
          <option value={5}>5</option>
          <option value={10}>10</option>
        </select>
      </label>

      <label className="prompt-builder-field">
        Prompt output
        <textarea value={promptText} readOnly rows={14} className="prompt-builder-output" />
      </label>

      <div className="prompt-builder-actions">
        <button type="button" className="ghost-button" onClick={handleCopyPrompt}>Copy Prompt</button>
        {copyStatus ? <span className="prompt-builder-copy-status" role="status" aria-live="polite">{copyStatus}</span> : null}
      </div>
    </CollapsiblePanel>
  );
}
