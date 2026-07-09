export const BATTLE_BRIDGE_IGNITION_HEALTH_BRIEF_VERSION = 'battle-bridge-ignition-health-brief.v1';

export const BATTLE_BRIDGE_IGNITION_STATE = Object.freeze({
  ALL_READY: 'all-ready',
  PARTIAL_BACKEND_ONLY: 'partial-backend-only',
  PARTIAL_OPENCLAW_ONLY: 'partial-openclaw-only',
  PARTIAL_UI_MISSING: 'partial-ui-missing',
  STALE_SHARED_WORKSPACE: 'stale-shared-workspace',
  BLOCKED_DIRTY_SOURCE: 'blocked-dirty-source',
  BLOCKED_UNKNOWN_PROCESSES: 'blocked-unknown-processes',
  BLOCKED_NEEDS_SUPERVISOR_RESTART: 'blocked-needs-supervisor-restart',
});

const SOURCE_DIRT_BLOCKED_PREFIXES = Object.freeze([
  'apps/stephanos/src/',
  'stephanos-ui/src/',
  'stephanos-server/',
  'shared/',
  'scripts/',
  'tests/',
  'docs/',
]);

const SOURCE_DIRT_BLOCKED_FILES = Object.freeze([
  'package.json',
  'package-lock.json',
  'main.js',
  'index.html',
]);

const RUNTIME_ONLY_PREFIXES = Object.freeze([
  'data/activity/',
  'data/runtime/',
  'runtime/',
  'tmp/',
  'stephanos-server/data/memory/',
]);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const stringValue = String(value).trim();
  return stringValue || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined).map(String) : [];
}

function endpointReady(endpoint) {
  return endpoint?.observed === true || endpoint?.reachable === true || endpoint?.listening === true || endpoint?.status === 'READY';
}

function currentFact(fact) {
  return fact?.current === true || fact?.freshness === 'CURRENT' || fact?.status === 'CURRENT';
}

function classifyGitDirt(files) {
  const paths = list(files);
  const runtimeOnly = [];
  const source = [];
  const other = [];
  for (const path of paths) {
    if (RUNTIME_ONLY_PREFIXES.some((prefix) => path.startsWith(prefix))) runtimeOnly.push(path);
    else if (SOURCE_DIRT_BLOCKED_FILES.includes(path) || SOURCE_DIRT_BLOCKED_PREFIXES.some((prefix) => path.startsWith(prefix))) source.push(path);
    else other.push(path);
  }
  return { all: paths, source, runtimeOnly, other, sourceBlocked: source.length > 0 || other.length > 0 };
}

export function buildBattleBridgeIgnitionHealthBriefContract() {
  return {
    schemaVersion: BATTLE_BRIDGE_IGNITION_HEALTH_BRIEF_VERSION,
    kind: 'stephanos.battle_bridge.ignition_health_brief.contract',
    acceptedFactsOnly: true,
    probesPortsItself: false,
    shellExecutionAllowed: false,
    processKillAllowed: false,
    serviceStartAllowed: false,
    runtimeFileMutationAllowed: false,
    mergeAllowed: false,
    pushAllowed: false,
    publicationClaimsRequireRealPrNumber: true,
    states: Object.values(BATTLE_BRIDGE_IGNITION_STATE),
  };
}

export function createBattleBridgeIgnitionHealthBrief(input = {}) {
  const endpoints = {
    backend8787: { port: 8787, ...input.endpoints?.backend8787 },
    openclaw18789: { port: 18789, ...input.endpoints?.openclaw18789 },
    ui4173: { port: 4173, ...input.endpoints?.ui4173 },
  };
  const processes = {
    known: list(input.processes?.known),
    unknown: list(input.processes?.unknown),
    needsSupervisorRestart: input.processes?.needsSupervisorRestart === true,
  };
  const gitDirtyFiles = classifyGitDirt(input.gitDirtyFiles);
  const sharedWorkspaceStatus = {
    current: currentFact(input.sharedWorkspaceStatus),
    status: text(input.sharedWorkspaceStatus?.status, currentFact(input.sharedWorkspaceStatus) ? 'CURRENT' : 'UNKNOWN'),
    records: list(input.sharedWorkspaceStatus?.records),
  };
  const stalePublishers = list(input.stalePublishers);

  const backendReady = endpointReady(endpoints.backend8787);
  const openclawReady = endpointReady(endpoints.openclaw18789);
  const uiReady = endpointReady(endpoints.ui4173);
  const safetyBlockers = [];
  const caveats = [];
  if (gitDirtyFiles.sourceBlocked) safetyBlockers.push('Source working tree dirt blocks supervisor action.');
  if (processes.unknown.length) safetyBlockers.push('Unknown Battle Bridge processes require operator inspection.');
  if (processes.needsSupervisorRestart) safetyBlockers.push('Supervisor restart intent requires operator approval and proof.');
  if (!sharedWorkspaceStatus.current || stalePublishers.length) safetyBlockers.push('Shared workspace records are stale or unknown.');
  if (gitDirtyFiles.runtimeOnly.length) caveats.push('Runtime-only dirt observed; report as caveat, not source blocker.');

  let ignitionState = BATTLE_BRIDGE_IGNITION_STATE.BLOCKED_NEEDS_SUPERVISOR_RESTART;
  if (gitDirtyFiles.sourceBlocked) ignitionState = BATTLE_BRIDGE_IGNITION_STATE.BLOCKED_DIRTY_SOURCE;
  else if (processes.unknown.length) ignitionState = BATTLE_BRIDGE_IGNITION_STATE.BLOCKED_UNKNOWN_PROCESSES;
  else if (processes.needsSupervisorRestart) ignitionState = BATTLE_BRIDGE_IGNITION_STATE.BLOCKED_NEEDS_SUPERVISOR_RESTART;
  else if (!sharedWorkspaceStatus.current || stalePublishers.length) ignitionState = BATTLE_BRIDGE_IGNITION_STATE.STALE_SHARED_WORKSPACE;
  else if (backendReady && openclawReady && uiReady) ignitionState = BATTLE_BRIDGE_IGNITION_STATE.ALL_READY;
  else if (backendReady && openclawReady && !uiReady) ignitionState = BATTLE_BRIDGE_IGNITION_STATE.PARTIAL_UI_MISSING;
  else if (backendReady && !openclawReady && !uiReady) ignitionState = BATTLE_BRIDGE_IGNITION_STATE.PARTIAL_BACKEND_ONLY;
  else if (!backendReady && openclawReady && !uiReady) ignitionState = BATTLE_BRIDGE_IGNITION_STATE.PARTIAL_OPENCLAW_ONLY;

  return {
    schemaVersion: BATTLE_BRIDGE_IGNITION_HEALTH_BRIEF_VERSION,
    kind: 'stephanos.battle_bridge.ignition_health_brief',
    ignitionState,
    endpoints,
    processes,
    gitDirtyFiles,
    sharedWorkspaceStatus,
    stalePublishers,
    safetyBlockers,
    caveats,
    requiredProofs: [
      'Observed backend 8787 endpoint fact',
      'Observed OpenClaw gateway 18789 endpoint fact',
      'Observed Stephanos UI 4173 endpoint fact',
      'Current Shared Agent Workspace records',
      'Clean source working tree or explicit source-dirt blocker',
    ],
    smallestNextOperatorAction: ignitionState === BATTLE_BRIDGE_IGNITION_STATE.PARTIAL_UI_MISSING
      ? 'Start or repair Stephanos UI 4173 through approved ignition path, then rerun proof.'
      : safetyBlockers[0] || (ignitionState === BATTLE_BRIDGE_IGNITION_STATE.ALL_READY ? 'Capture browser proof and publish current health brief.' : 'Inspect missing observed facts, then rerun Battle Bridge proof.'),
    nextOwner: ignitionState === BATTLE_BRIDGE_IGNITION_STATE.ALL_READY ? 'operator-proof' : 'operator',
    authority: buildBattleBridgeIgnitionHealthBriefContract(),
    finalVerdict: ignitionState === BATTLE_BRIDGE_IGNITION_STATE.ALL_READY ? 'HEALTH_BRIEF_READY' : 'HEALTH_BRIEF_NOT_HEALTHY',
  };
}
