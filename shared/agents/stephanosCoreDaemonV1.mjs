export const STEPHANOS_CORE_DAEMON_SCHEMA = 'stephanos.core-daemon.v1';

const SHA = /^[0-9a-f]{40}$/i;

function bool(value) {
  return value === true;
}

function finiteAge(value) {
  // fileAgeMs returns null on a missing/unreadable heartbeat. Coercing it
  // to zero suppresses dependency repair by falsely proving a fresh worker.
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value : null;
}

// Worker-dependent Core orchestration may reach lifecycle maintenance through
// the Flywheel/Octopus repair graph. Unknown/stale worker evidence cannot admit
// that graph merely because the direct dependency sweep returned a HOLD.
export function coreWorkerDependentWorkAllowed(state = {}) {
  const age = finiteAge(state?.missionWorkerHeartbeatAgeMs);
  return state?.missionWorkerHealthy === true && age !== null && age <= 300_000;
}

// The Windows gaming governor publishes to Shared Workspace/vr, not status.
// Missing, corrupt, or contradictory state must never authorise a local CPU
// build. External GitHub runners are independent of this Core admission gate.
export function coreGamingProtectionFromGovernor(state, nowMs = Date.now()) {
  if (!state || typeof state !== 'object' || Array.isArray(state)
    || state.schemaVersion !== 'stephanos.vr-resource-governor.v1'
    || state.governorVersion !== 3 || !Number.isFinite(nowMs)) return true;
  const when = typeof state.updatedAtUtc === 'string' ? Date.parse(state.updatedAtUtc) : NaN;
  const flags = ['active','flatGameActive','airLinkActive','realAirLinkActive',
    'virtualAirLinkTestActive','prepareLeaseActive'];
  return state.phase !== 'NORMAL' || flags.some(key => state[key] !== false)
    || !Number.isFinite(when) || when > nowMs || nowMs - when > 15000;
}

export function shouldReloadStephanosCoreDaemon(initialHead, currentHead) {
  const initial = String(initialHead || '').trim().toLowerCase();
  const current = String(currentHead || '').trim().toLowerCase();
  return !SHA.test(initial) || !SHA.test(current) || initial !== current;
}

export function projectStephanosCoreDaemonState(input = {}) {
  const sourceHead = String(input.sourceHead || '').trim().toLowerCase();
  const missionWorkerHeartbeatAgeMs = finiteAge(input.missionWorkerHeartbeatAgeMs);
  const missionWorkerHealthy = missionWorkerHeartbeatAgeMs !== null
    && missionWorkerHeartbeatAgeMs <= 5 * 60 * 1000;
  const sovereignCommanderHealthy = bool(input.sovereignCommanderHealthy);
  const backendHealthy = bool(input.backendHealthy);
  const gamingActive = input.gamingActive !== false;
  const observedHealthyCount = [
    sovereignCommanderHealthy,
    backendHealthy,
    missionWorkerHealthy,
  ].filter(Boolean).length;
  const readiness = observedHealthyCount === 3 ? 'READY' : 'DEGRADED';

  return Object.freeze({
    schemaVersion: STEPHANOS_CORE_DAEMON_SCHEMA,
    sourceHead: SHA.test(sourceHead) ? sourceHead : '',
    daemonHealthy: true,
    readiness,
    sovereignCommanderHealthy,
    backendHealthy,
    missionWorkerHealthy,
    missionWorkerHeartbeatAgeMs,
    gamingActive,
    computePosture: gamingActive ? 'GAMING_PROTECTED' : 'AI_AVAILABLE',
    uiRequired: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    schedulerAuthority: false,
    leaseAuthority: false,
    arbitraryShellAllowed: false,
    pcRestartAuthority: false,
    canonicalMissionWorkerOnly: true,
    sovereignCommanderIsMachineExecutor: true,
    duplicateControllerFabricAllowed: false,
    finalVerdict: readiness === 'READY'
      ? 'STEPHANOS_CORE_DAEMON_READY'
      : 'STEPHANOS_CORE_DAEMON_DEGRADED',
  });
}
