export const IGNITION_COCKPIT_SCHEMA_VERSION = 'stephanos.ignition-cockpit.v1';

export const TRAFFIC_LIGHT = Object.freeze({
  GREEN: 'green',
  AMBER: 'amber',
  RED: 'red',
  BLUE: 'blue',
});

export const DEFAULT_IGNITION_STAGES = Object.freeze([
  { id: 'source-update', label: 'Source update', weight: 15 },
  { id: 'build-output', label: 'Build Output', weight: 20 },
  { id: 'verify', label: 'Verify', weight: 20 },
  { id: 'runtime', label: 'Runtime', weight: 45 },
]);

const TERMINAL_PASS = new Set(['passed', 'complete', 'current', 'not-needed']);
const TERMINAL_FAIL = new Set(['failed', 'blocked', 'mismatch']);
const ACTIVE = new Set(['running', 'requested', 'pending']);

function normalizeStage(input, index) {
  const base = DEFAULT_IGNITION_STAGES[index] || { id: `stage-${index + 1}`, label: `Stage ${index + 1}`, weight: 1 };
  const status = String(input?.status || 'pending');
  return {
    id: String(input?.id || base.id),
    label: String(input?.label || base.label),
    status,
    trafficLight: TERMINAL_FAIL.has(status) ? TRAFFIC_LIGHT.RED : (TERMINAL_PASS.has(status) ? TRAFFIC_LIGHT.GREEN : (ACTIVE.has(status) ? TRAFFIC_LIGHT.BLUE : TRAFFIC_LIGHT.AMBER)),
    detail: String(input?.detail || ''),
    startedAt: input?.startedAt || null,
    completedAt: input?.completedAt || null,
    weight: Number.isFinite(input?.weight) ? input.weight : base.weight,
  };
}

export function projectIgnitionCockpit(input = {}) {
  const stages = (input.stages?.length ? input.stages : DEFAULT_IGNITION_STAGES).map(normalizeStage);
  const totalWeight = stages.reduce((sum, stage) => sum + Math.max(0, stage.weight), 0) || 1;
  const completeWeight = stages.reduce((sum, stage) => sum + (TERMINAL_PASS.has(stage.status) ? Math.max(0, stage.weight) : 0), 0);
  const progressPercentage = Math.min(100, Math.max(0, Math.round((completeWeight / totalWeight) * 100)));
  const blocker = input.blocker || stages.find((stage) => stage.trafficLight === TRAFFIC_LIGHT.RED)?.detail || '';
  const buildPassed = input.buildPassed === true
    || TERMINAL_PASS.has(stages.find((stage) => stage.id === 'build')?.status)
    || TERMINAL_PASS.has(stages.find((stage) => stage.id === 'build-output')?.status);
  const verifyPassed = input.verifyPassed === true || TERMINAL_PASS.has(stages.find((stage) => stage.id === 'verify')?.status);
  const servedProof = input.servedProof || {};
  const servedProofReady = servedProof.healthProbePass === true
    && servedProof.runtimeMarkerMatches === true
    && servedProof.moduleMimeChecksPass === true;
  let trafficLight = TRAFFIC_LIGHT.BLUE;
  let exactNextOperatorAction = input.exactNextOperatorAction || 'Wait for ignition to finish the current proof stage.';
  let readyToEnterStephanos = false;

  if (blocker) {
    trafficLight = TRAFFIC_LIGHT.RED;
    exactNextOperatorAction = input.exactNextOperatorAction || 'Resolve the blocker, then rerun npm run stephanos:ignite.';
  } else if (buildPassed && verifyPassed && servedProofReady) {
    trafficLight = TRAFFIC_LIGHT.GREEN;
    readyToEnterStephanos = true;
    exactNextOperatorAction = 'Enter Stephanos.';
  } else if (buildPassed && verifyPassed && input.serverStarted === true) {
    trafficLight = TRAFFIC_LIGHT.AMBER;
    exactNextOperatorAction = input.exactNextOperatorAction || 'Wait for served runtime proof, then hard-refresh only after marker and MIME proof pass.';
  }

  const lastCompleted = [...stages].reverse().find((stage) => TERMINAL_PASS.has(stage.status));
  const current = stages.find((stage) => ACTIVE.has(stage.status)) || stages.find((stage) => !TERMINAL_PASS.has(stage.status));

  return {
    schema: IGNITION_COCKPIT_SCHEMA_VERSION,
    trafficLight,
    progressPercentage: readyToEnterStephanos ? 100 : progressPercentage,
    currentAction: input.currentAction || current?.label || 'Ignition complete',
    lastCompletedAction: input.lastCompletedAction || lastCompleted?.label || 'None yet',
    blocker,
    exactNextOperatorAction,
    readyToEnterStephanos,
    enterStephanosEnabled: readyToEnterStephanos,
    proofSummary: {
      source: input.sourceProof || {},
      sourceUpdate: input.sourceUpdateProof || input.sourceProof?.sourceUpdateProof || {},
      runningLatestMain: (input.sourceUpdateProof || input.sourceProof?.sourceUpdateProof || {}).runningLatestMain === true,
      commitShortSha: input.commitShortSha || String((input.sourceUpdateProof || input.sourceProof?.sourceUpdateProof || {}).localHeadAfter || input.sourceProof?.afterCommit || '').slice(0, 12),
      prTitle: input.prTitle || input.gitBranchIntelligence?.associatedPr?.title || '',
      exactBlocker: input.exactBlocker || (input.sourceUpdateProof || input.sourceProof?.sourceUpdateProof || {}).exactBlocker || blocker,
      nextAction: exactNextOperatorAction,
      buildPassed,
      verifyPassed,
      serverStarted: input.serverStarted === true,
      servedProofReady,
      servedProof,
    },
    timestamps: {
      startedAt: input.startedAt || null,
      updatedAt: input.updatedAt || new Date().toISOString(),
      completedAt: readyToEnterStephanos ? (input.completedAt || new Date().toISOString()) : null,
    },
    stages,
  };
}
