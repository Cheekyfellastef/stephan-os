import path from 'node:path';

export const STARFIELD_VR_LAUNCH_SCHEMA = 'stephanos.starfield-vr-launch-profile.v1';
export const STARFIELD_VR_LAUNCH_EVIDENCE_VERDICT = 'STARFIELD_VR_LAUNCH_PATH_VERIFIED';
export const STARFIELD_VR_LAUNCH_ACTIONS = Object.freeze({
  MUTAR_OPENXR: 'LAUNCH_MUTAR_OPENXR',
  VORPX: 'LAUNCH_VORPX',
  BLOCKED: 'BLOCKED',
});

const ALLOWED_PROVIDERS = new Set(['mutar-openxr', 'vorpx']);
const ALLOWED_GAME_LAUNCHERS = new Set(['starfield.exe', 'sfse_loader.exe']);
const ALLOWED_VORPX_COMPANIONS = new Set(['vorpcontrol.exe']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedPath(value) {
  return text(value).replaceAll('/', '\\').toLowerCase();
}

function basename(value) {
  return path.win32.basename(text(value)).toLowerCase();
}

function addBlocker(blockers, condition, blocker) {
  if (condition && !blockers.includes(blocker)) blockers.push(blocker);
}

function exactFileMatches(expected, observed) {
  if (!expected || !observed) return false;
  return observed.exists === true
    && normalizedPath(expected.path) === normalizedPath(observed.path)
    && SHA256_PATTERN.test(text(expected.sha256))
    && text(expected.sha256).toLowerCase() === text(observed.sha256).toLowerCase();
}

function findObservedFile(observations, expectedPath) {
  const expected = normalizedPath(expectedPath);
  return (observations.providerFiles ?? []).find((entry) => normalizedPath(entry?.path) === expected);
}

export function evaluateStarfieldVrLaunch(profile, observations, { now = new Date() } = {}) {
  const blockers = [];
  const warnings = [];

  addBlocker(blockers, !profile || typeof profile !== 'object', 'profile-missing-or-invalid');
  addBlocker(blockers, !observations || typeof observations !== 'object', 'observations-missing-or-invalid');
  if (blockers.length > 0) {
    return Object.freeze({
      ok: false,
      action: STARFIELD_VR_LAUNCH_ACTIONS.BLOCKED,
      blockers,
      warnings,
    });
  }

  addBlocker(blockers, profile.schemaVersion !== STARFIELD_VR_LAUNCH_SCHEMA, 'profile-schema-unsupported');
  addBlocker(blockers, profile.goal !== 1591, 'profile-goal-mismatch');
  addBlocker(blockers, profile.workerGoal !== 1595, 'profile-worker-goal-mismatch');
  addBlocker(blockers, profile.status !== 'ready', 'profile-not-ready');
  addBlocker(blockers, profile.transport !== 'meta-air-link', 'transport-not-meta-air-link');
  addBlocker(blockers, !ALLOWED_PROVIDERS.has(profile.selectedProvider), 'provider-not-allowlisted');
  addBlocker(blockers, observations.platform !== 'win32', 'windows-host-not-proven');

  const launchExecutable = {
    path: text(profile.game?.launchExecutablePath),
    sha256: text(profile.game?.launchExecutableSha256),
  };
  addBlocker(blockers, !text(profile.game?.installationRoot), 'game-installation-root-missing');
  addBlocker(blockers, !ALLOWED_GAME_LAUNCHERS.has(basename(launchExecutable.path)), 'game-launcher-not-allowlisted');
  addBlocker(blockers, !exactFileMatches(launchExecutable, observations.gameLauncher), 'game-launcher-identity-mismatch');

  addBlocker(blockers, observations.metaClient?.exists !== true, 'meta-horizon-link-client-missing');
  addBlocker(blockers, basename(observations.metaClient?.path) !== 'oculusclient.exe', 'meta-horizon-link-client-identity-mismatch');
  addBlocker(blockers, observations.airLinkSession?.active !== true, 'meta-air-link-session-not-active');

  const evidenceTimestamp = Date.parse(text(profile.evidence?.verifiedAtUtc));
  addBlocker(blockers, profile.evidence?.verdict !== STARFIELD_VR_LAUNCH_EVIDENCE_VERDICT, 'verified-launch-evidence-missing');
  addBlocker(blockers, !text(profile.evidence?.packetPath), 'evidence-packet-path-missing');
  addBlocker(blockers, !Number.isFinite(evidenceTimestamp), 'evidence-timestamp-invalid');
  if (Number.isFinite(evidenceTimestamp)) {
    const ageDays = Math.max(0, (now.getTime() - evidenceTimestamp) / 86_400_000);
    if (ageDays > 30) warnings.push('launch-evidence-older-than-30-days');
  }

  let action = STARFIELD_VR_LAUNCH_ACTIONS.BLOCKED;
  if (profile.selectedProvider === 'mutar-openxr') {
    const providerFiles = Array.isArray(profile.provider?.files) ? profile.provider.files : [];
    addBlocker(blockers, profile.runtime?.openxrRuntime !== 'meta', 'meta-openxr-runtime-not-selected-in-profile');
    addBlocker(
      blockers,
      !/(^|[\\/])(oculus|meta[^\\/]*)[^\\/]*[\\/]/i.test(text(observations.activeOpenXrRuntimePath)),
      'meta-openxr-runtime-not-active',
    );
    addBlocker(blockers, providerFiles.length === 0, 'mutar-provider-files-missing');
    addBlocker(
      blockers,
      !providerFiles.some((entry) => entry?.role === 'injection-proxy' && basename(entry?.path) === 'dxgi.dll'),
      'mutar-injection-proxy-not-declared',
    );
    for (const expected of providerFiles) {
      addBlocker(
        blockers,
        !exactFileMatches(expected, findObservedFile(observations, expected?.path)),
        `provider-file-identity-mismatch:${text(expected?.role) || 'unknown'}`,
      );
    }
    action = STARFIELD_VR_LAUNCH_ACTIONS.MUTAR_OPENXR;
  }

  if (profile.selectedProvider === 'vorpx') {
    const companion = {
      path: text(profile.provider?.companionExecutablePath),
      sha256: text(profile.provider?.companionExecutableSha256),
    };
    addBlocker(blockers, !ALLOWED_VORPX_COMPANIONS.has(basename(companion.path)), 'vorpx-companion-not-allowlisted');
    addBlocker(blockers, !exactFileMatches(companion, observations.companionExecutable), 'vorpx-companion-identity-mismatch');
    action = STARFIELD_VR_LAUNCH_ACTIONS.VORPX;
  }

  if (blockers.length > 0) action = STARFIELD_VR_LAUNCH_ACTIONS.BLOCKED;
  return Object.freeze({
    ok: blockers.length === 0,
    action,
    selectedProvider: text(profile.selectedProvider) || 'unknown',
    blockers,
    warnings,
    evidencePacketPath: text(profile.evidence?.packetPath) || null,
  });
}
