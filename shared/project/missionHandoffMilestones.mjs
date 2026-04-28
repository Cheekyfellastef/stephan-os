import { normalizeMissionDashboardState } from '../../stephanos-ui/src/state/missionDashboardModel.js';

const LIVE_STATUS = Object.freeze({
  not_started: { status: 'not-started', percent: 0 },
  planned: { status: 'planned', percent: 20 },
  started: { status: 'in-progress', percent: 45 },
  partial: { status: 'in-progress', percent: 62 },
  degraded: { status: 'in-progress', percent: 55 },
  review: { status: 'review', percent: 88 },
  ready: { status: 'review', percent: 92 },
  complete: { status: 'complete', percent: 100 },
  blocked: { status: 'blocked', percent: 35 },
  unavailable: { status: 'not-started', percent: 5 },
  unknown: { status: 'planned', percent: 15 },
});

function asText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value.map((entry) => asText(entry)).filter(Boolean) : [];
}
const DEFAULT_MANUAL_NOTE = 'Manual baseline; update with concrete progress evidence.';

function mapLiveStatus(value, fallback = 'unknown') {
  const key = asText(value, fallback).toLowerCase().replace(/-/g, '_');
  return LIVE_STATUS[key] || LIVE_STATUS.unknown;
}

function laneIndex(projection) {
  const lanes = Array.isArray(projection?.lanes) ? projection.lanes : [];
  return new Map(lanes.map((lane) => [lane.id, lane]));
}

function buildLiveMilestoneMap({ projectProgressProjection = {}, agentTaskSummary = {}, telemetrySummary = {}, promptBuilderSummary = {}, finalRouteTruth = null } = {}) {
  const lanes = laneIndex(projectProgressProjection);
  const verification = projectProgressProjection?.verificationStatus || {};
  const routeLane = lanes.get('route-backend-health');
  const hostedLane = lanes.get('hosted-bridge-tailscale-serve');
  const missionConsoleLane = lanes.get('mission-console-ui');
  const intentLane = lanes.get('intent-proposal-engine');
  const agentLane = lanes.get('agent-task-layer');
  const codexLane = lanes.get('codex-handoff');
  const openClawLane = lanes.get('openclaw-control');
  const verifyLane = lanes.get('verification-loop');

  const live = new Map();

  live.set('agent-layer-v1-foundation', {
    source: 'live_projection',
    statusSeed: agentTaskSummary.status || agentLane?.status,
    blockerReason: asArray(agentTaskSummary.blockers)[0] || '',
    nextAction: asText(agentTaskSummary.nextAgentTaskAction || agentTaskSummary.nextActions?.[0]?.title),
    notes: 'Bound to shared Agent Task, Codex handoff, and Verification Return summaries.',
    evidence: [
      ...asArray(agentTaskSummary.evidence),
      asText(agentTaskSummary.codexReadiness) ? `Codex readiness: ${agentTaskSummary.codexReadiness}` : '',
      asText(agentTaskSummary.verificationReturnStatus) ? `Verification Return: ${agentTaskSummary.verificationReturnStatus}` : '',
    ].filter(Boolean),
    linkedSystems: ['agent-task-layer', 'codex-handoff', 'verification-loop'],
  });

  live.set('agent-layer-v2-surface-elevation', {
    source: missionConsoleLane ? 'live_projection' : 'unknown',
    statusSeed: missionConsoleLane?.status,
    blockerReason: asArray(missionConsoleLane?.blockers)[0] || '',
    nextAction: asText(projectProgressProjection?.nextBestActions?.[0]?.title, 'Elevate agent surfaces across Mission Dashboard and launcher entry points.'),
    notes: 'Surface elevation projection sourced from Mission Console UI + Agent tile readiness lanes.',
    evidence: [...asArray(missionConsoleLane?.evidence), ...asArray(missionConsoleLane?.blockers).map((entry) => `Blocker: ${entry}`)],
    linkedSystems: ['mission-console-ui', 'agent-task-layer'],
  });

  live.set('agent-layer-v3-persistent-orchestration', {
    source: openClawLane || agentTaskSummary.openClawReadiness ? 'live_projection' : 'unknown',
    statusSeed: agentTaskSummary.openClawReadiness || openClawLane?.status,
    blockerReason: asText(agentTaskSummary.openClawHighestPriorityBlocker || asArray(openClawLane?.blockers)[0]),
    nextAction: asText(agentTaskSummary.openClawNextAction || projectProgressProjection?.nextBestActions?.find((action) => action.id.includes('openclaw'))?.title),
    notes: 'Bound to OpenClaw policy, kill-switch, and local-adapter readiness summaries (policy-only safe posture preserved).',
    evidence: [
      asText(agentTaskSummary.openClawKillSwitchState) ? `Kill switch: ${agentTaskSummary.openClawKillSwitchState}` : '',
      asText(agentTaskSummary.openClawAdapterMode) ? `Adapter mode: ${agentTaskSummary.openClawAdapterMode}` : '',
      asText(agentTaskSummary.openClawAdapterReadiness) ? `Adapter readiness: ${agentTaskSummary.openClawAdapterReadiness}` : '',
      ...asArray(agentTaskSummary.openClawAdapterEvidenceContract),
      ...asArray(openClawLane?.evidence),
    ].filter(Boolean),
    linkedSystems: ['openclaw-control', 'agent-task-layer'],
  });

  live.set('mission-console-hosted-repair', {
    source: hostedLane || routeLane || finalRouteTruth ? 'live_projection' : 'unknown',
    statusSeed: hostedLane?.status || routeLane?.status || (finalRouteTruth?.launchable ? 'ready' : 'started'),
    blockerReason: asArray(hostedLane?.blockers)[0] || asArray(routeLane?.blockers)[0] || '',
    nextAction: asText(projectProgressProjection?.nextBestActions?.find((action) => action.id.includes('bridge') || action.id.includes('route'))?.title),
    notes: 'Hosted repair bound to route/backend health and hosted bridge lane summaries.',
    evidence: [
      ...asArray(hostedLane?.evidence),
      ...asArray(routeLane?.evidence),
      finalRouteTruth?.routeKind ? `Final route: ${finalRouteTruth.routeKind}` : '',
      typeof finalRouteTruth?.launchable === 'boolean' ? `Launchable: ${finalRouteTruth.launchable ? 'yes' : 'no'}` : '',
    ].filter(Boolean),
    linkedSystems: ['hosted-bridge-tailscale-serve', 'route-backend-health'],
  });

  live.set('intent-engine-operator-interface', {
    source: intentLane || promptBuilderSummary.status ? 'mixed' : 'unknown',
    statusSeed: promptBuilderSummary.status || intentLane?.status,
    blockerReason: asArray(promptBuilderSummary.blockers)[0] || asArray(intentLane?.blockers)[0] || '',
    nextAction: asText(promptBuilderSummary.nextActions?.[0] || projectProgressProjection?.nextBestActions?.find((action) => action.id.includes('prompt'))?.title),
    notes: 'Intent operator interface milestone combines Prompt Builder and intent/proposal lane summaries.',
    evidence: [...asArray(promptBuilderSummary.evidence), ...asArray(intentLane?.evidence)],
    linkedSystems: ['intent-proposal-engine', 'prompt-builder'],
  });

  live.set('route-recovery-bridge-validation', {
    source: routeLane ? 'live_projection' : 'unknown',
    statusSeed: routeLane?.status,
    blockerReason: asArray(routeLane?.blockers)[0] || '',
    nextAction: asText(projectProgressProjection?.nextBestActions?.find((action) => action.id.includes('route') || action.id.includes('bridge'))?.title),
    notes: 'Bridge recovery milestone uses route/backend health lane truth and adjudicated next actions.',
    evidence: [...asArray(routeLane?.evidence), ...asArray(routeLane?.blockers).map((entry) => `Blocker: ${entry}`)],
    linkedSystems: ['route-backend-health', 'hosted-bridge-tailscale-serve'],
  });

  live.set('provider-routing-hosted-safety', {
    source: routeLane ? 'mixed' : 'unknown',
    statusSeed: routeLane?.status,
    blockerReason: asArray(projectProgressProjection?.doctrineWarnings)[0] || '',
    nextAction: asText(projectProgressProjection?.nextBestActions?.find((action) => action.id.includes('provider') || action.id.includes('route'))?.title),
    notes: 'Provider routing safety uses route health + doctrine warnings where available.',
    evidence: asArray(projectProgressProjection?.doctrineWarnings).slice(0, 3),
    linkedSystems: ['route-backend-health'],
  });

  live.set('continuity-resume-handoff', {
    source: codexLane || agentLane ? 'live_projection' : 'unknown',
    statusSeed: codexLane?.status || agentLane?.status,
    blockerReason: asArray(codexLane?.blockers)[0] || '',
    nextAction: asText(agentTaskSummary.verificationReturnNextAction || projectProgressProjection?.nextBestActions?.find((action) => action.id.includes('handoff'))?.title),
    notes: 'Continuity handoff milestone bound to Codex handoff + Agent Task verification-return continuity signals.',
    evidence: [
      ...asArray(codexLane?.evidence),
      asText(agentTaskSummary.verificationReturnStatus) ? `Verification return status: ${agentTaskSummary.verificationReturnStatus}` : '',
    ].filter(Boolean),
    linkedSystems: ['codex-handoff', 'agent-task-layer'],
  });

  live.set('build-verify-truth-gates', {
    source: verifyLane || verification ? 'verified_build' : 'unknown',
    statusSeed: verification.taskCompletionBound ? 'ready' : (verifyLane?.status || verification.status),
    blockerReason: verification.taskCompletionBound ? '' : asText(agentTaskSummary.missingRequiredChecks?.[0]),
    nextAction: asText(agentTaskSummary.verificationReturnNextAction || projectProgressProjection?.nextBestActions?.find((action) => action.id.includes('verification'))?.title),
    notes: verification.summary || 'Build/verify truth gate summary unavailable.',
    evidence: [
      verification.buildVerifyScriptsPresent ? 'Build/verify scripts present.' : '',
      verification.taskCompletionBound ? 'Task completion bound to verification loop.' : 'Task completion not yet bound to verification loop.',
      ...asArray(verifyLane?.evidence),
    ].filter(Boolean),
    linkedSystems: ['verification-loop'],
  });

  live.set('launcher-agents-entry', {
    source: missionConsoleLane ? 'mixed' : 'unknown',
    statusSeed: missionConsoleLane?.status,
    blockerReason: '',
    nextAction: asText(projectProgressProjection?.nextBestActions?.find((action) => action.id.includes('tile') || action.id.includes('surface'))?.title),
    notes: 'Launcher entry milestone currently uses Mission Console UI and agent-surface projections; explicit launcher summary wiring still partial.',
    evidence: [...asArray(missionConsoleLane?.evidence)],
    linkedSystems: ['mission-console-ui'],
    wiringGap: 'No dedicated shared launcher-agents-entry summary is exported yet.',
  });

  live.set('telemetry-summary-binding', {
    source: telemetrySummary.status ? 'live_projection' : 'unknown',
    statusSeed: telemetrySummary.status,
    blockerReason: asArray(telemetrySummary.blockers)[0] || '',
    nextAction: asText(telemetrySummary.nextActions?.[0]),
    notes: 'Telemetry summary binding tracked in shared telemetry summary exporter.',
    evidence: asArray(telemetrySummary.evidence),
    linkedSystems: ['telemetry'],
  });

  return live;
}

export function buildMissionHandoffMilestones({
  dashboardState = {},
  projectProgressProjection = {},
  agentTaskSummary = {},
  telemetrySummary = {},
  promptBuilderSummary = {},
  finalRouteTruth = null,
} = {}) {
  const normalized = normalizeMissionDashboardState(dashboardState);
  const liveMap = buildLiveMilestoneMap({
    projectProgressProjection,
    agentTaskSummary,
    telemetrySummary,
    promptBuilderSummary,
    finalRouteTruth,
  });

  const wiringGaps = [];
  const milestones = normalized.milestones.map((manualMilestone) => {
    const live = liveMap.get(manualMilestone.id);
    const hasLive = Boolean(live && live.source !== 'unknown');
    const hasOverride = manualMilestone.operatorOverride === true;

    const mapped = hasLive ? mapLiveStatus(live.statusSeed) : { status: manualMilestone.status, percent: manualMilestone.percentComplete };
    const status = hasOverride
      ? manualMilestone.status
      : hasLive
        ? mapped.status
        : manualMilestone.status;
    const percentComplete = hasOverride
      ? manualMilestone.percentComplete
      : hasLive
        ? mapped.percent
        : manualMilestone.percentComplete;

    const evidence = hasLive ? live.evidence : [];
    const blockerReason = hasOverride
      ? asText(manualMilestone.blockerDetails || live?.blockerReason)
      : asText(live?.blockerReason || manualMilestone.blockerDetails);
    const blocker = status === 'blocked' || manualMilestone.blockerFlag || Boolean(blockerReason);

    const hasMeaningfulManualNote = asText(manualMilestone.notes) && asText(manualMilestone.notes) !== DEFAULT_MANUAL_NOTE;
    const truthSource = hasOverride
      ? 'operator_override'
      : hasLive
        ? (hasMeaningfulManualNote ? 'mixed' : live.source)
        : 'manual_baseline';

    if (live?.wiringGap) {
      wiringGaps.push(`${manualMilestone.title}: ${live.wiringGap}`);
    }
    if (!hasLive) {
      wiringGaps.push(`${manualMilestone.title}: no live shared subsystem summary mapping yet.`);
    }

    const notes = hasLive
      ? (hasMeaningfulManualNote
        ? `Manual annotation: ${manualMilestone.notes}`
        : live.notes)
      : (manualMilestone.notes || 'Manual baseline milestone.');

    return {
      ...manualMilestone,
      milestoneId: manualMilestone.id,
      label: manualMilestone.title,
      status,
      percentComplete,
      blocker,
      blockerReason,
      nextAction: hasOverride
        ? asText(manualMilestone.nextAction || live?.nextAction)
        : asText(live?.nextAction || manualMilestone.nextAction),
      notes,
      evidence,
      truthSource,
      staleReason: hasLive ? '' : 'No mapped live projection summary; using manual fallback.',
      updatedAt: hasLive ? (projectProgressProjection.generatedAt || manualMilestone.updatedAt) : manualMilestone.updatedAt,
      linkedSystems: [...new Set([...(manualMilestone.linkedSystems || []), ...(live?.linkedSystems || [])])],
      operatorOverride: hasOverride,
    };
  });

  const total = milestones.length || 1;
  const overallCompletion = Math.round(milestones.reduce((sum, milestone) => sum + milestone.percentComplete, 0) / total);

  return {
    generatedAt: new Date().toISOString(),
    milestones,
    wiringGaps: [...new Set(wiringGaps)],
    overallCompletion,
    nextBestActions: Array.isArray(projectProgressProjection?.nextBestActions) ? projectProgressProjection.nextBestActions : [],
  };
}
