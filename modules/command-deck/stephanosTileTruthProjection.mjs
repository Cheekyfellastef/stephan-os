function normalizeLaunchState(value) {
  const state = String(value || '').trim().toLowerCase();
  if (state === 'ready' || state === 'degraded' || state === 'unavailable') {
    return state;
  }
  return 'unknown';
}

function normalizeRouteKind(value) {
  const routeKind = String(value || '').trim().toLowerCase();
  return routeKind || 'unknown';
}

function normalizeProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  return provider || 'unknown';
}

function normalizeBlockingIssues(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function toYesNoUnknown(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'unknown';
}

function asBooleanOrNull(value) {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function isMeaningfulValue(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return Boolean(normalized) && !['unknown', 'none', 'n/a', 'na', 'unavailable'].includes(normalized);
}

function asCompactSentence(value, fallback = '') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  return text.endsWith('.') ? text.slice(0, -1) : text;
}

function classifyMissionStatus({ launchState, routeOperational, agentTaskLayerStatus }) {
  if (launchState === 'unavailable') return 'Mission systems: Blocked';
  if (launchState === 'degraded') return 'Mission systems: Degraded';
  if (launchState === 'ready' && routeOperational && agentTaskLayerStatus === 'complete') return 'Mission systems: Ready';
  if (launchState === 'ready' && routeOperational) return 'Mission systems: Active';
  return 'Mission systems: Monitoring';
}

function buildExecutionSafetyLabel({ agentTaskSummary, topBlocker }) {
  const blockerText = String(topBlocker || '').toLowerCase();
  const hasApprovalBlocker = blockerText.includes('approval') || blockerText.includes('approve');
  const executionAllowed = agentTaskSummary.openClawExecutionAllowed === 'yes'
    && agentTaskSummary.openClawAdapterCanExecute === 'yes';

  if (executionAllowed) {
    return 'Execution permitted';
  }
  if (hasApprovalBlocker) {
    return 'Execution blocked';
  }
  if (agentTaskSummary.openClawIntegrationMode === 'policy_only' || agentTaskSummary.openClawAdapterExecutionMode === 'disabled') {
    return 'Policy-only';
  }
  return 'Execution guarded';
}

function isOpenClawTopDependency(nextAction, topBlocker) {
  const combined = `${String(nextAction || '').toLowerCase()} ${String(topBlocker || '').toLowerCase()}`;
  return ['openclaw', 'kill switch', 'adapter'].some((token) => combined.includes(token));
}


function normalizeSubsystemSummary(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const status = String(source.status || '').trim().toLowerCase() || 'unknown';
  const nextAction = String((Array.isArray(source.nextActions) ? source.nextActions[0] : source.nextAction) || '').trim();
  const blocker = String((Array.isArray(source.blockers) ? source.blockers[0] : '') || '').trim();
  const warning = String((Array.isArray(source.warnings) ? source.warnings[0] : source.topWarning || '') || '').trim();
  return { status, nextAction, blocker, warning };
}

function buildLandingTileSummary({
  launchState,
  routeOperational,
  agentTaskSummary,
  canonicalBlockingIssues,
  telemetrySummary = {},
  promptBuilderSummary = {},
}) {
  const overallStatus = classifyMissionStatus({
    launchState,
    routeOperational,
    agentTaskLayerStatus: agentTaskSummary.agentTaskLayerStatus,
  });
  const nextAction = asCompactSentence(agentTaskSummary.nextAgentTaskAction, 'Review mission task truth');
  const topBlocker = isMeaningfulValue(agentTaskSummary.openClawHighestPriorityBlocker)
    ? asCompactSentence(agentTaskSummary.openClawHighestPriorityBlocker)
    : (agentTaskSummary.agentTaskLayerBlockers.find((entry) => isMeaningfulValue(entry))
      || canonicalBlockingIssues.find((entry) => isMeaningfulValue(entry))
      || '');
  const safetyLabel = buildExecutionSafetyLabel({ agentTaskSummary, topBlocker });
  const openClawDependencyTop = isOpenClawTopDependency(nextAction, topBlocker);
  const openClawStatus = openClawDependencyTop
    ? `OpenClaw: ${agentTaskSummary.openClawReadiness} (${agentTaskSummary.openClawIntegrationMode})`
    : '';
  const telemetry = normalizeSubsystemSummary(telemetrySummary);
  const promptBuilder = normalizeSubsystemSummary(promptBuilderSummary);
  const telemetryPriority = ['blocked', 'degraded'].includes(telemetry.status)
    || nextAction.toLowerCase().includes('telemetry')
    || topBlocker.toLowerCase().includes('telemetry');
  const promptPriority = ['blocked', 'degraded'].includes(promptBuilder.status)
    || nextAction.toLowerCase().includes('prompt builder')
    || topBlocker.toLowerCase().includes('prompt');
  const telemetryLine = telemetryPriority ? `Telemetry: ${telemetry.status}${telemetry.blocker ? ` (${asCompactSentence(telemetry.blocker)})` : ''}` : '';
  const promptLine = promptPriority ? `Prompt Builder: ${promptBuilder.status}${promptBuilder.blocker ? ` (${asCompactSentence(promptBuilder.blocker)})` : ''}` : '';

  const lines = [
    overallStatus,
    `Next: ${nextAction}`,
    topBlocker ? `Blocker: ${asCompactSentence(topBlocker)}` : '',
    openClawStatus,
    telemetryLine,
    promptLine,
    `Status: ${safetyLabel}`,
  ].filter(Boolean);

  return {
    overallStatus,
    nextAction,
    topBlocker: topBlocker ? asCompactSentence(topBlocker) : '',
    openClawStatus,
    safetyLabel,
    lines,
    summary: lines.join(' · '),
  };
}


function normalizeAgentReadinessSummary(value) {
  const summary = value && typeof value === 'object' ? value : {};
  const toText = (entry, fallback = 'unknown') => {
    const text = String(entry || '').trim().toLowerCase();
    return text || fallback;
  };
  const blockers = Array.isArray(summary.agentTaskLayerBlockers)
    ? summary.agentTaskLayerBlockers.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];

  return {
    agentTaskLayerStatus: toText(summary.agentTaskLayerStatus),
    codexReadiness: toText(summary.codexReadiness),
    openClawReadiness: toText(summary.openClawReadiness),
    openClawIntegrationMode: toText(summary.openClawIntegrationMode, 'policy_only'),
    openClawSafeToUse: summary.openClawSafeToUse === true ? 'yes' : 'no',
    openClawKillSwitchState: toText(summary.openClawKillSwitchState, 'missing'),
    openClawKillSwitchMode: toText(summary.openClawKillSwitchMode, 'unavailable'),
    openClawExecutionAllowed: summary.openClawExecutionAllowed === true ? 'yes' : 'no',
    openClawHighestPriorityBlocker: toText(summary.openClawHighestPriorityBlocker, 'none'),
    openClawNextAction: toText(summary.openClawNextAction, 'Wire kill-switch lifecycle + adapter contract.'),
    openClawAdapterMode: toText(summary.openClawAdapterMode, 'design_only'),
    openClawAdapterReadiness: toText(summary.openClawAdapterReadiness, 'needs_contract'),
    openClawAdapterConnectionState: toText(summary.openClawAdapterConnectionState, 'not_configured'),
    openClawAdapterExecutionMode: toText(summary.openClawAdapterExecutionMode, 'disabled'),
    openClawAdapterCanExecute: summary.openClawAdapterCanExecute === true ? 'yes' : 'no',
    openClawAdapterNextAction: toText(summary.openClawAdapterNextAction, 'Design OpenClaw local adapter contract.'),
    openClawAdapterStubStatus: toText(summary.openClawAdapterStubStatus, 'unknown'),
    openClawAdapterStubHealth: toText(summary.openClawAdapterStubHealth, 'unknown'),
    openClawAdapterStubConnectionState: toText(summary.openClawAdapterStubConnectionState, 'unknown'),
    openClawAdapterStubCanExecute: summary.openClawAdapterStubCanExecute === true ? 'yes' : 'no',
    openClawAdapterStubNextAction: toText(summary.openClawAdapterStubNextAction, 'Create OpenClaw local adapter stub.'),
    nextAgentTaskAction: String(summary.nextAgentTaskAction || '').trim() || 'Build canonical Agent Task Model',
    readinessScore: Number.isFinite(Number(summary.readinessScore)) ? Math.max(0, Math.min(100, Number(summary.readinessScore))) : 0,
    agentTaskLayerBlockers: blockers,
  };
}

function buildCanonicalSnapshot(runtimeStatusModel = {}) {
  const canonical = runtimeStatusModel?.canonicalRouteRuntimeTruth;
  const compatibility = runtimeStatusModel?.runtimeTruthSnapshot;
  if (canonical && typeof canonical === 'object') {
    return { snapshot: canonical, source: 'canonicalRouteRuntimeTruth' };
  }

  if (compatibility && typeof compatibility === 'object') {
    return { snapshot: compatibility, source: 'runtimeTruthSnapshot' };
  }

  return { snapshot: null, source: 'unavailable' };
}

function pickRouteKind(snapshot = {}) {
  return normalizeRouteKind(snapshot?.winningRoute || snapshot?.selectedRouteKind || snapshot?.routeKind);
}

function pickLaunchState(snapshot = {}, runtimeStatusModel = {}, project = {}) {
  const canonicalLaunchState = normalizeLaunchState(snapshot?.appLaunchState || snapshot?.launchState);
  if (snapshot && typeof snapshot === 'object') {
    return canonicalLaunchState;
  }
  return normalizeLaunchState(runtimeStatusModel?.appLaunchState || project?.dependencyState);
}

function buildCompatibilityProjection(runtimeStatusModel = {}, project = {}) {
  const finalRoute = runtimeStatusModel?.finalRoute;
  const finalRouteTruth = runtimeStatusModel?.finalRouteTruth;

  return {
    launchState: normalizeLaunchState(runtimeStatusModel?.appLaunchState || project?.dependencyState),
    routeKind: normalizeRouteKind(
      runtimeStatusModel?.preferredRoute
      || runtimeStatusModel?.selectedRoute
      || finalRouteTruth?.routeKind
      || finalRoute?.routeKind,
    ),
    selectedRouteReachable: toYesNoUnknown(
      runtimeStatusModel?.cloudRouteReachable === true
        ? true
        : asBooleanOrNull(runtimeStatusModel?.backendReachable),
    ),
    selectedRouteUsable: toYesNoUnknown(asBooleanOrNull(runtimeStatusModel?.routeUsable)),
    executableProvider: normalizeProvider(runtimeStatusModel?.executedProvider),
    fallbackActive: toYesNoUnknown(asBooleanOrNull(runtimeStatusModel?.fallbackActive)),
    blockingIssues: normalizeBlockingIssues(runtimeStatusModel?.blockingIssueCodes),
  };
}

export function buildStephanosTileTruthProjection(project = {}) {
  const runtimeStatusModel = project?.runtimeStatusModel && typeof project.runtimeStatusModel === 'object'
    ? project.runtimeStatusModel
    : {};
  const { snapshot, source } = buildCanonicalSnapshot(runtimeStatusModel);

  const launchState = pickLaunchState(snapshot, runtimeStatusModel, project);
  const canonicalRouteKind = pickRouteKind(snapshot || {});
  const canonicalProvider = normalizeProvider(snapshot?.executedProvider);
  const canonicalFallbackState = toYesNoUnknown(snapshot?.fallbackActive);
  const canonicalBlockingIssues = normalizeBlockingIssues(snapshot?.blockingIssueCodes);
  const selectedRouteReachable = toYesNoUnknown(snapshot?.routeReachable);
  const selectedRouteUsable = toYesNoUnknown(snapshot?.routeUsable);
  const agentTaskSummary = normalizeAgentReadinessSummary(
    runtimeStatusModel?.agentTaskReadinessSummary
    || runtimeStatusModel?.agentTaskLayerSummary
    || project?.agentTaskReadinessSummary,
  );

  const tone = launchState === 'ready' || launchState === 'degraded' || launchState === 'unavailable'
    ? launchState
    : 'unavailable';

  const hasCanonical = source !== 'unavailable';
  const compatibility = buildCompatibilityProjection(runtimeStatusModel, project);
  const driftFields = [];

  if (hasCanonical) {
    if (compatibility.launchState !== 'unknown' && launchState !== 'unknown' && compatibility.launchState !== launchState) {
      driftFields.push(`launch:${compatibility.launchState}->${launchState}`);
    }
    if (compatibility.routeKind !== 'unknown' && canonicalRouteKind !== 'unknown' && compatibility.routeKind !== canonicalRouteKind) {
      driftFields.push(`route:${compatibility.routeKind}->${canonicalRouteKind}`);
    }
    if (compatibility.executableProvider !== 'unknown' && canonicalProvider !== 'unknown' && compatibility.executableProvider !== canonicalProvider) {
      driftFields.push(`provider:${compatibility.executableProvider}->${canonicalProvider}`);
    }
    if (compatibility.fallbackActive !== 'unknown' && canonicalFallbackState !== 'unknown' && compatibility.fallbackActive !== canonicalFallbackState) {
      driftFields.push(`fallback:${compatibility.fallbackActive}->${canonicalFallbackState}`);
    }
  }

  const drift = driftFields.length > 0;

  const routeOperational = canonicalRouteKind === 'cloud'
    && selectedRouteReachable === 'yes'
    && selectedRouteUsable === 'yes';
  const telemetrySummary = runtimeStatusModel?.telemetrySummary || project?.telemetrySummary || {};
  const promptBuilderSummary = runtimeStatusModel?.promptBuilderSummary || project?.promptBuilderSummary || {};

  const landingTileSummary = buildLandingTileSummary({
    launchState,
    routeOperational,
    agentTaskSummary,
    canonicalBlockingIssues,
    telemetrySummary,
    promptBuilderSummary,
  });

  return {
    source,
    launchState,
    tone,
    routeKind: canonicalRouteKind,
    routeOperational,
    executableProvider: canonicalProvider,
    fallbackActive: canonicalFallbackState,
    blockingIssues: canonicalBlockingIssues,
    selectedRouteReachable,
    selectedRouteUsable,
    agentTaskSummary,
    landingTileSummary,
    drift,
    driftFields,
    summary: landingTileSummary.summary,
    diagnosticLabel: drift
      ? `Truth drift detected: compatibility projection disagrees with canonical truth (${driftFields.join(', ')}).`
      : '',
  };
}
