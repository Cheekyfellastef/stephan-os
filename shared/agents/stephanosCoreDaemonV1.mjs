export const STEPHANOS_CORE_DAEMON_SCHEMA = 'stephanos.core-daemon.v1';

const SHA = /^[0-9a-f]{40}$/i;

function bool(value) {
  return value === true;
}

function finiteAge(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
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
  const gamingActive = bool(input.gamingActive);
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
