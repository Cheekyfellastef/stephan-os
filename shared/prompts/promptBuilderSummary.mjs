function asText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function asBoolean(value) {
  return value === true;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function buildPromptBuilderSummary({
  promptBuilderAvailable = true,
  promptText = '',
  telemetryEntries = [],
  actionHints = [],
  finalRouteTruth = null,
  orchestrationTruth = null,
  copySupported = true,
  codexHandoffReady = null,
} = {}) {
  const hasPromptText = asText(promptText).length > 0;
  const telemetryCount = asArray(telemetryEntries).length;
  const hintCount = asArray(actionHints).length;
  const missionWorkflow = orchestrationTruth?.missionPacketWorkflow || {};

  const supportsTelemetryContext = telemetryCount > 0;
  const supportsRuntimeTruthContext = finalRouteTruth && typeof finalRouteTruth === 'object';
  const supportsActionHints = hintCount > 0;
  const supportsConstraints = true;
  const supportsCopyAction = copySupported === true;
  const supportsAgentTaskContext = Boolean(orchestrationTruth?.canonicalMissionPacket || missionWorkflow?.missionPacket);
  const supportsCodexHandoff = codexHandoffReady === null
    ? supportsAgentTaskContext
    : asBoolean(codexHandoffReady);

  const blockers = [];
  const warnings = [];

  if (promptBuilderAvailable !== true) {
    blockers.push('Prompt Builder panel is unavailable in this runtime.');
  }
  if (supportsCopyAction !== true) {
    blockers.push('Prompt copy action is not available in this runtime.');
  }
  if (supportsTelemetryContext !== true) {
    warnings.push('Telemetry context is not bound into Prompt Builder summary.');
  }
  if (supportsRuntimeTruthContext !== true) {
    warnings.push('Runtime truth context is missing from Prompt Builder summary.');
  }
  if (supportsAgentTaskContext !== true) {
    warnings.push('Agent Task context is not yet bound to Prompt Builder summary.');
  }

  let status = 'unknown';
  if (promptBuilderAvailable !== true) {
    status = 'unavailable';
  } else if (blockers.length > 0) {
    status = 'blocked';
  } else if (supportsAgentTaskContext && supportsTelemetryContext && supportsRuntimeTruthContext && supportsActionHints && hasPromptText && supportsCodexHandoff) {
    status = 'ready';
  } else if (hasPromptText || supportsRuntimeTruthContext || supportsAgentTaskContext) {
    status = warnings.length > 0 ? 'partial' : 'started';
  } else {
    status = 'not_started';
  }

  const readinessScore = status === 'ready'
    ? 88
    : status === 'partial'
      ? 64
      : status === 'started'
        ? 54
        : status === 'blocked'
          ? 30
          : status === 'unavailable'
            ? 10
            : 20;

  const nextActions = [];
  if (promptBuilderAvailable !== true) {
    nextActions.push('Restore Prompt Builder panel wiring for mission surfaces.');
  }
  if (!supportsAgentTaskContext) {
    nextActions.push('Bind Prompt Builder summary to Agent Task context.');
  }
  if (!supportsTelemetryContext) {
    nextActions.push('Bind telemetry context into Prompt Builder summary export.');
  }
  if (!supportsRuntimeTruthContext) {
    nextActions.push('Bind runtime truth context into Prompt Builder summary export.');
  }
  if (!supportsCopyAction) {
    nextActions.push('Restore Prompt Builder copy flow for Codex handoff packet usage.');
  }
  if (nextActions.length === 0) {
    nextActions.push('Improve prompt packet preview quality and maintain copy-ready handoff flow.');
  }

  const evidence = [];
  if (hasPromptText) evidence.push('Prompt Builder compiles prompt text.');
  if (supportsCopyAction) evidence.push('Prompt Builder copy action is available.');
  if (supportsTelemetryContext) evidence.push(`Telemetry context available (${telemetryCount} entries).`);
  if (supportsRuntimeTruthContext) evidence.push('Runtime truth context available.');
  if (supportsActionHints) evidence.push(`Action hints available (${hintCount}).`);
  if (supportsCodexHandoff) evidence.push('Codex handoff context is available.');

  return {
    systemId: 'prompt-builder',
    label: 'Prompt Builder',
    status,
    readinessScore,
    supportsAgentTaskContext,
    supportsTelemetryContext,
    supportsRuntimeTruthContext,
    supportsActionHints,
    supportsConstraints,
    supportsCodexHandoff,
    supportsCopyAction,
    blockers,
    warnings,
    nextActions,
    evidence,
    dashboardSummaryText: `Prompt Builder ${status}. ${nextActions[0] || 'No next action.'}`,
    compactSummaryText: `Prompt Builder ${status} · agent ${supportsAgentTaskContext ? 'yes' : 'no'} · telemetry ${supportsTelemetryContext ? 'yes' : 'no'} · truth ${supportsRuntimeTruthContext ? 'yes' : 'no'}`,
  };
}
