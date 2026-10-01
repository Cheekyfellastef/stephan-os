import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(sourceFile), '..', '..');
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const governorScript = resolve(repoRoot, 'scripts', 'windows', 'run-vr-resource-governor.ps1');
const acceptanceScript = resolve(repoRoot, 'scripts', 'windows', 'run-gaming-resource-acceptance.ps1');

const MODE_ACTIONS = Object.freeze({
  AUTO: 'SetAuto',
  FORCE_ON: 'ForceOn',
  FORCE_OFF: 'ForceOff',
});

function text(value = '') {
  return String(value ?? '').trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean).slice(0, 16) : [];
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeGpu(value = {}) {
  return Object.freeze({
    available: value?.available === true,
    memoryFreeMiB: safeNumber(value?.memoryFreeMiB),
    memoryUsedMiB: safeNumber(value?.memoryUsedMiB),
    memoryTotalMiB: safeNumber(value?.memoryTotalMiB),
    utilizationGpuPercent: safeNumber(value?.utilizationGpuPercent),
  });
}

export function projectGamingResourceState(value = {}) {
  const profile = value?.profile && typeof value.profile === 'object' ? value.profile : {};
  return Object.freeze({
    schemaVersion: 'stephanos.gaming-resource-public-state.v1',
    governorVersion: Number(value?.governorVersion || 0),
    phase: text(value?.phase, 'UNKNOWN'),
    active: value?.active === true,
    reason: text(value?.reason),
    overrideMode: text(value?.overrideMode, 'AUTO'),
    airLinkActive: value?.airLinkActive === true,
    realAirLinkActive: value?.realAirLinkActive === true,
    virtualAirLinkTestActive: value?.virtualAirLinkTestActive === true,
    flatGameActive: value?.flatGameActive === true,
    gameProcessName: text(value?.gameProcessName),
    launcherProcessName: text(value?.launcherProcessName),
    parentProcessName: text(value?.parentProcessName),
    profile: Object.freeze({
      name: text(profile?.name, 'generic-safe'),
      processName: text(profile?.processName),
      minFreeVramMiB: safeNumber(profile?.minFreeVramMiB),
      lightweightOnly: profile?.lightweightOnly === true,
      cooldownSeconds: safeNumber(profile?.cooldownSeconds),
      customProfileApplied: profile?.customProfileApplied === true,
    }),
    preferredModel: text(value?.preferredModel),
    ollamaLoadMode: text(value?.ollamaLoadMode),
    heavyModelAllowed: value?.heavyModelAllowed === true,
    parkedModels: Object.freeze(safeArray(value?.parkedModels)),
    heavyModelsAfter: Object.freeze(safeArray(value?.heavyModelsAfter)),
    evictionHealthy: value?.evictionHealthy === true,
    gpuBefore: safeGpu(value?.gpuBefore),
    gpuAfter: safeGpu(value?.gpuAfter),
    vramPressure: value?.vramPressure === true,
    vramReleasedMiB: safeNumber(value?.vramReleasedMiB),
    evictionDurationMs: safeNumber(value?.evictionDurationMs),
    cooldownUntilUtc: text(value?.cooldownUntilUtc),
    transition: text(value?.transition),
    updatedAtUtc: text(value?.updatedAtUtc),
  });
}

function parseJsonOutput(stdout = '') {
  const raw = text(stdout);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  }
}

function runFixedScript(script, args, {
  spawnSyncFn = spawnSync,
  timeoutMs = 70_000,
} = {}) {
  const result = spawnSyncFn(powershell, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', script,
    ...args,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 256 * 1024,
  });

  const payload = parseJsonOutput(result?.stdout);
  const status = Number.isInteger(result?.status) ? result.status : null;
  return Object.freeze({
    ok: !result?.error && status === 0 && Boolean(payload),
    status,
    payload,
    errorCode: text(result?.error?.code || result?.error?.message || (payload ? '' : 'GAMING_RESOURCE_OUTPUT_INVALID')).slice(0, 160),
  });
}

export function getGamingResourceState(options = {}) {
  const result = runFixedScript(governorScript, ['-Action', 'Status'], { ...options, timeoutMs: 20_000 });
  if (!result.ok) {
    return Object.freeze({
      ok: false,
      status: result.status,
      blocker: result.errorCode || 'GAMING_RESOURCE_STATUS_FAILED',
      state: null,
    });
  }
  return Object.freeze({ ok: true, status: 0, blocker: '', state: projectGamingResourceState(result.payload) });
}

export function setGamingResourceMode(mode = '', options = {}) {
  const normalized = text(mode).toUpperCase();
  const action = MODE_ACTIONS[normalized];
  if (!action) {
    return Object.freeze({
      ok: false,
      status: null,
      blocker: 'GAMING_RESOURCE_MODE_NOT_ALLOWED',
      allowedModes: Object.freeze(Object.keys(MODE_ACTIONS)),
      state: null,
    });
  }
  const result = runFixedScript(governorScript, ['-Action', action], options);
  if (!result.ok) {
    return Object.freeze({
      ok: false,
      status: result.status,
      blocker: result.errorCode || 'GAMING_RESOURCE_MODE_CHANGE_FAILED',
      state: result.payload ? projectGamingResourceState(result.payload) : null,
    });
  }
  return Object.freeze({
    ok: true,
    status: 0,
    blocker: '',
    requestedMode: normalized,
    state: projectGamingResourceState(result.payload),
  });
}

export function runGamingResourceAcceptance(options = {}) {
  const result = runFixedScript(acceptanceScript, [], { ...options, timeoutMs: 130_000 });
  const payload = result.payload || {};
  return Object.freeze({
    ok: result.ok && payload?.ok === true,
    status: result.status,
    blocker: text(payload?.blocker || result.errorCode),
    finalVerdict: text(payload?.finalVerdict),
    telemetryObserved: payload?.telemetryObserved === true,
    realGameLaunchUsed: payload?.realGameLaunchUsed === true,
    realHeadsetProofClaimed: payload?.realHeadsetProofClaimed === true,
    restored: payload?.restored ? projectGamingResourceState(payload.restored) : null,
  });
}

export const GAMING_RESOURCE_ALLOWED_MODES = Object.freeze(Object.keys(MODE_ACTIONS));
