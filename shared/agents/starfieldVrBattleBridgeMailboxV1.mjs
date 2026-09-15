import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { win32 } from 'node:path';
import { spawnSync } from 'node:child_process';

export const STARFIELD_VR_DELIVERY_STATUS_OPERATION = 'READ_STARFIELD_VR_DELIVERY_STATUS';
export const STARFIELD_VR_SHORTCUT_INSTALL_OPERATION = 'INSTALL_STARFIELD_VR_DESKTOP_SHORTCUT';
export const STARFIELD_VR_BATTLE_BRIDGE_OPERATIONS = Object.freeze([
  STARFIELD_VR_DELIVERY_STATUS_OPERATION,
  STARFIELD_VR_SHORTCUT_INSTALL_OPERATION,
]);
export const STARFIELD_VR_BATTLE_BRIDGE_SCHEMA = 'stephanos.starfield-vr-battle-bridge-mailbox.v1';

const LOCAL_SCHEMA = 'stephanos.starfield-vr-local-delivery-observation.v1';
const INSTALL_SCHEMA = 'stephanos.starfield-vr-shortcut-install.v1';
const SHA = /^[0-9a-f]{40}$/i;
const COMMAND_FIELDS = new Set([
  'schemaVersion',
  'requestId',
  'operation',
  'repository',
  'issueNumber',
  'branch',
  'operatorApproval',
  'expectedHead',
  'expiresAt',
]);

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, ...details });
}

function parseJson(stdout = '') {
  try {
    const value = JSON.parse(String(stdout || '').trim());
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function fixedPaths({ env = process.env, home = homedir() } = {}) {
  const userProfile = String(env?.USERPROFILE || home || '').trim();
  const systemRoot = String(env?.SystemRoot || env?.SYSTEMROOT || '').trim();
  if (!userProfile || !systemRoot) return null;
  const repoRoot = win32.resolve(userProfile, 'Documents', 'GitHub', 'stephan-os');
  return Object.freeze({
    repoRoot,
    installerScript: win32.resolve(repoRoot, 'scripts', 'windows', 'install-starfield-vr-desktop-shortcut.ps1'),
    probeScript: win32.resolve(repoRoot, 'scripts', 'starfield-vr-delivery-truth-probe.mjs'),
    powershellExe: win32.resolve(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  });
}

function invocationOptions(cwd, timeout = 120_000) {
  return {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout,
    maxBuffer: 1024 * 1024,
  };
}

function validateObservation(value, expectedHead) {
  if (!value || value.schemaVersion !== LOCAL_SCHEMA) return fail('STARFIELD_VR_DELIVERY_OBSERVATION_INVALID');
  if (typeof value.desktopIconPresent !== 'boolean'
    || typeof value.splashWrapperPresent !== 'boolean'
    || typeof value.shortcutRoutesThroughSplash !== 'boolean'
    || typeof value.installerReceiptPresent !== 'boolean') {
    return fail('STARFIELD_VR_DELIVERY_OBSERVATION_INVALID');
  }
  const sourceHead = String(value.installedSourceHead || '').trim().toLowerCase();
  if (!SHA.test(sourceHead)) return fail('STARFIELD_VR_DELIVERY_SOURCE_HEAD_MISSING');
  if (sourceHead !== expectedHead) {
    return fail('STARFIELD_VR_DELIVERY_SOURCE_HEAD_MISMATCH', { sourceHead, expectedHead });
  }
  const installerReceiptVerdict = String(value.installerReceiptVerdict || '');
  const installed = value.desktopIconPresent === true
    && value.splashWrapperPresent === true
    && value.shortcutRoutesThroughSplash === true
    && value.installerReceiptPresent === true
    && installerReceiptVerdict === 'STARFIELD_VR_SHORTCUT_INSTALLED';
  return Object.freeze({
    ok: true,
    sourceHead,
    installed,
    observation: Object.freeze({
      schemaVersion: LOCAL_SCHEMA,
      observedAtUtc: String(value.observedAtUtc || ''),
      desktopIconPresent: value.desktopIconPresent,
      splashWrapperPresent: value.splashWrapperPresent,
      shortcutTargetPath: String(value.shortcutTargetPath || ''),
      shortcutArguments: String(value.shortcutArguments || ''),
      shortcutRoutesThroughSplash: value.shortcutRoutesThroughSplash,
      installerReceiptPresent: value.installerReceiptPresent,
      installerReceiptVerdict,
      installedSourceHead: sourceHead,
    }),
  });
}

export function validateStarfieldVrBattleBridgeCommandShape(command = {}) {
  if (!STARFIELD_VR_BATTLE_BRIDGE_OPERATIONS.includes(String(command?.operation || ''))) {
    return fail('STARFIELD_VR_OPERATION_MISMATCH');
  }
  const unexpectedField = Object.keys(command).find((field) => !COMMAND_FIELDS.has(field));
  if (unexpectedField) return fail('STARFIELD_VR_FIELD_NOT_ALLOWED', { field: unexpectedField });
  const expectedHead = String(command?.expectedHead || '').trim().toLowerCase();
  if (!SHA.test(expectedHead)) return fail('STARFIELD_VR_EXPECTED_HEAD_REQUIRED');
  return Object.freeze({ ok: true, expectedHead, operation: String(command.operation) });
}

export function projectStarfieldVrBattleBridgeCommand(command = {}) {
  const shape = validateStarfieldVrBattleBridgeCommandShape(command);
  if (!shape.ok) return shape;
  const projected = {};
  for (const field of COMMAND_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(command, field)) projected[field] = command[field];
  }
  projected.operation = shape.operation;
  projected.expectedHead = shape.expectedHead;
  return Object.freeze({ ok: true, command: Object.freeze(projected) });
}

export async function executeStarfieldVrBattleBridgeCommand(command = {}, {
  platform = process.platform,
  env = process.env,
  home = homedir(),
  spawnSyncFn = spawnSync,
  existsSyncFn = existsSync,
  nodeExecutable = process.execPath,
} = {}) {
  const shape = validateStarfieldVrBattleBridgeCommandShape(command);
  if (!shape.ok) return shape;
  if (platform !== 'win32') return fail('STARFIELD_VR_WINDOWS_REQUIRED');
  const paths = fixedPaths({ env, home });
  if (!paths) return fail('STARFIELD_VR_FIXED_PATHS_UNAVAILABLE');
  if (!existsSyncFn(paths.repoRoot)) return fail('STARFIELD_VR_REPOSITORY_MISSING');
  if (!existsSyncFn(paths.probeScript)) return fail('STARFIELD_VR_DELIVERY_PROBE_MISSING');
  if (!nodeExecutable || !existsSyncFn(nodeExecutable)) return fail('STARFIELD_VR_NODE_EXECUTABLE_MISSING');

  const headInvocation = spawnSyncFn('git', ['rev-parse', 'HEAD'], invocationOptions(paths.repoRoot, 30_000));
  const localHead = String(headInvocation?.stdout || '').trim().toLowerCase();
  if (headInvocation?.error || headInvocation?.status !== 0 || !SHA.test(localHead)) {
    return fail('STARFIELD_VR_LOCAL_HEAD_READ_FAILED');
  }
  if (localHead !== shape.expectedHead) {
    return fail('STARFIELD_VR_LOCAL_HEAD_MISMATCH', { localHead, expectedHead: shape.expectedHead });
  }

  if (shape.operation === STARFIELD_VR_SHORTCUT_INSTALL_OPERATION) {
    if (!existsSyncFn(paths.installerScript)) return fail('STARFIELD_VR_SHORTCUT_INSTALLER_MISSING');
    if (!existsSyncFn(paths.powershellExe)) return fail('STARFIELD_VR_POWERSHELL_MISSING');
    const installInvocation = spawnSyncFn(paths.powershellExe, [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', paths.installerScript,
    ], invocationOptions(paths.repoRoot, 120_000));
    const installReceipt = parseJson(installInvocation?.stdout);
    if (installInvocation?.error || installInvocation?.status !== 0) {
      return fail('STARFIELD_VR_SHORTCUT_INSTALL_EXECUTION_FAILED');
    }
    if (!installReceipt
      || installReceipt.schemaVersion !== INSTALL_SCHEMA
      || installReceipt.finalVerdict !== 'STARFIELD_VR_SHORTCUT_INSTALLED'
      || installReceipt.created !== true
      || String(installReceipt.shortcutName || '') !== 'Starfield VR') {
      return fail('STARFIELD_VR_SHORTCUT_INSTALL_RECEIPT_INVALID');
    }
  }

  const probeInvocation = spawnSyncFn(nodeExecutable, [paths.probeScript], invocationOptions(paths.repoRoot, 60_000));
  if (probeInvocation?.error || probeInvocation?.status !== 0) {
    return fail('STARFIELD_VR_DELIVERY_PROBE_FAILED');
  }
  const observed = validateObservation(parseJson(probeInvocation?.stdout), shape.expectedHead);
  if (!observed.ok) return observed;
  if (shape.operation === STARFIELD_VR_SHORTCUT_INSTALL_OPERATION && !observed.installed) {
    return fail('STARFIELD_VR_SHORTCUT_INSTALL_NOT_PROVEN', { observation: observed.observation });
  }

  return Object.freeze({
    ok: true,
    schemaVersion: STARFIELD_VR_BATTLE_BRIDGE_SCHEMA,
    operation: shape.operation,
    expectedHead: shape.expectedHead,
    sourceHead: observed.sourceHead,
    installed: observed.installed,
    observation: observed.observation,
    arbitraryShellAllowed: false,
    arbitraryPowerShellAllowed: false,
    arbitraryPathAllowed: false,
    arbitraryExecutableAllowed: false,
    profileOverrideAllowed: false,
    launchAllowed: false,
    providerMutationAllowed: false,
    sourceMutationAllowed: false,
    finalVerdict: shape.operation === STARFIELD_VR_SHORTCUT_INSTALL_OPERATION
      ? 'STARFIELD_VR_SHORTCUT_INSTALL_PROVEN'
      : 'STARFIELD_VR_DELIVERY_STATUS_READ',
  });
}
