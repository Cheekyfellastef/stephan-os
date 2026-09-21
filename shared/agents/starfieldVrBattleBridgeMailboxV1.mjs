import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { win32 } from 'node:path';
import { spawnSync } from 'node:child_process';

export const STARFIELD_VR_DELIVERY_STATUS_OPERATION = 'READ_STARFIELD_VR_DELIVERY_STATUS';
export const STARFIELD_VR_SHORTCUT_INSTALL_OPERATION = 'INSTALL_STARFIELD_VR_DESKTOP_SHORTCUT';
export const STARFIELD_VR_READINESS_OPERATION = 'READ_STARFIELD_VR_LAUNCH_READINESS';
export const STARFIELD_VR_BATTLE_BRIDGE_OPERATIONS = Object.freeze([
  STARFIELD_VR_DELIVERY_STATUS_OPERATION,
  STARFIELD_VR_SHORTCUT_INSTALL_OPERATION,
  STARFIELD_VR_READINESS_OPERATION,
]);
export const STARFIELD_VR_BATTLE_BRIDGE_SCHEMA = 'stephanos.starfield-vr-battle-bridge-mailbox.v1';

const LOCAL_SCHEMA = 'stephanos.starfield-vr-local-delivery-observation.v1';
const INSTALL_SCHEMA = 'stephanos.starfield-vr-shortcut-install.v1';
const SHA = /^[0-9a-f]{40}$/i;
const INSTALLER_RELATIVE_PATH = 'scripts/windows/install-starfield-vr-desktop-shortcut.ps1';
const PROBE_RELATIVE_PATH = 'scripts/starfield-vr-delivery-truth-probe.mjs';
const LAUNCHER_RELATIVE_PATH = 'scripts/windows/launch-starfield-vr.ps1';
const DECISION_RELATIVE_PATH = 'scripts/starfield-vr-launch-decision.mjs';
const POLICY_RELATIVE_PATH = 'shared/agents/starfieldVrLaunchPolicy.mjs';
const SHORTCUT_INSPECTION_COMMAND = [
  "$ErrorActionPreference='Stop'",
  '$desktop=[Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)',
  "if (-not $desktop) { throw 'Desktop path unavailable' }",
  "$shortcutPath=Join-Path $desktop 'Starfield VR.lnk'",
  "if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) { [ordered]@{present=$false;shortcutPath=$shortcutPath;targetPath='';arguments=''} | ConvertTo-Json -Compress; exit 0 }",
  '$shell=New-Object -ComObject WScript.Shell',
  '$shortcut=$shell.CreateShortcut($shortcutPath)',
  '[ordered]@{present=$true;shortcutPath=$shortcutPath;targetPath=[string]$shortcut.TargetPath;arguments=[string]$shortcut.Arguments} | ConvertTo-Json -Compress',
].join('; ');
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
    const normalized = String(stdout || '').trim().replace(/^\uFEFF/, '');
    const value = JSON.parse(normalized);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function normalizeWindowsPath(value) {
  const path = String(value || '').trim();
  return path ? win32.normalize(path).toLowerCase() : '';
}

function fixedPaths({ env = process.env, home = homedir() } = {}) {
  const userProfile = String(env?.USERPROFILE || home || '').trim();
  const systemRoot = String(env?.SystemRoot || env?.SYSTEMROOT || '').trim();
  if (!userProfile || !systemRoot) return null;
  const repoRoot = win32.resolve(userProfile, 'Documents', 'GitHub', 'stephan-os');
  return Object.freeze({
    repoRoot,
    installerScript: win32.resolve(repoRoot, INSTALLER_RELATIVE_PATH),
    probeScript: win32.resolve(repoRoot, PROBE_RELATIVE_PATH),
    launcherScript: win32.resolve(repoRoot, LAUNCHER_RELATIVE_PATH),
    decisionScript: win32.resolve(repoRoot, DECISION_RELATIVE_PATH),
    policyScript: win32.resolve(repoRoot, POLICY_RELATIVE_PATH),
    splashScript: win32.resolve(repoRoot, 'scripts', 'windows', 'launch-starfield-vr-with-splash.ps1'),
    profilePath: win32.resolve(userProfile, 'Documents', 'Stephanos-openclaw-workspace', 'vr', 'starfield-vr-launch-profile.json'),
    powershellExe: win32.resolve(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  });
}

function expectedShortcutArguments(paths) {
  return `-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${paths.splashScript}" -ProfilePath "${paths.profilePath}"`;
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

function verifyWorkingScriptIdentity(relativePath, absolutePath, expectedHead, paths, spawnSyncFn) {
  const committedInvocation = spawnSyncFn(
    'git',
    ['rev-parse', `${expectedHead}:${relativePath}`],
    invocationOptions(paths.repoRoot, 30_000),
  );
  const committedBlob = String(committedInvocation?.stdout || '').trim().toLowerCase();
  if (committedInvocation?.error || committedInvocation?.status !== 0 || !SHA.test(committedBlob)) {
    return fail('STARFIELD_VR_COMMITTED_SCRIPT_BLOB_READ_FAILED', { script: relativePath });
  }

  const workingInvocation = spawnSyncFn(
    'git',
    ['hash-object', `--path=${relativePath}`, '--', absolutePath],
    invocationOptions(paths.repoRoot, 30_000),
  );
  const workingBlob = String(workingInvocation?.stdout || '').trim().toLowerCase();
  if (workingInvocation?.error || workingInvocation?.status !== 0 || !SHA.test(workingBlob)) {
    return fail('STARFIELD_VR_WORKING_SCRIPT_BLOB_READ_FAILED', { script: relativePath });
  }
  if (workingBlob !== committedBlob) {
    return fail('STARFIELD_VR_EXECUTED_SCRIPT_DIRTY', { script: relativePath, committedBlob, workingBlob });
  }
  return Object.freeze({ ok: true, script: relativePath, committedBlob, workingBlob });
}

function verifyCurrentProtectedMain(expectedHead, paths, spawnSyncFn) {
  const invocation = spawnSyncFn(
    'git',
    ['ls-remote', 'origin', 'refs/heads/main'],
    invocationOptions(paths.repoRoot, 30_000),
  );
  const output = String(invocation?.stdout || '').trim();
  const match = /^([0-9a-f]{40})\s+refs\/heads\/main$/i.exec(output);
  if (invocation?.error || invocation?.status !== 0 || !match) {
    return fail('STARFIELD_VR_GITHUB_MAIN_HEAD_READ_FAILED');
  }
  const githubMainHead = String(match[1] || '').toLowerCase();
  if (githubMainHead !== expectedHead) {
    return fail('STARFIELD_VR_GITHUB_MAIN_HEAD_MISMATCH', { githubMainHead, expectedHead });
  }
  return Object.freeze({ ok: true, githubMainHead, expectedHead });
}

function inspectShortcut(paths, spawnSyncFn) {
  const invocation = spawnSyncFn(paths.powershellExe, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-Command', SHORTCUT_INSPECTION_COMMAND,
  ], invocationOptions(paths.repoRoot, 30_000));
  if (invocation?.error || invocation?.status !== 0) return fail('STARFIELD_VR_SHORTCUT_INSPECTION_FAILED');
  const record = parseJson(invocation?.stdout);
  if (!record
    || typeof record.present !== 'boolean'
    || typeof record.shortcutPath !== 'string'
    || typeof record.targetPath !== 'string'
    || typeof record.arguments !== 'string') {
    return fail('STARFIELD_VR_SHORTCUT_INSPECTION_INVALID');
  }
  const targetPath = String(record.targetPath || '').trim();
  const shortcutArguments = String(record.arguments || '').trim();
  const targetMatches = record.present === true
    && normalizeWindowsPath(targetPath) === normalizeWindowsPath(paths.powershellExe);
  const argumentsMatch = record.present === true
    && shortcutArguments === expectedShortcutArguments(paths);
  return Object.freeze({
    ok: true,
    present: record.present,
    shortcutPath: String(record.shortcutPath || ''),
    targetPath,
    arguments: shortcutArguments,
    routesThroughSplash: targetMatches && argumentsMatch,
  });
}

function validateObservation(value, expectedHead, shortcutInspection) {
  if (!value || value.schemaVersion !== LOCAL_SCHEMA) return fail('STARFIELD_VR_DELIVERY_OBSERVATION_INVALID');
  if (typeof value.desktopIconPresent !== 'boolean'
    || typeof value.splashWrapperPresent !== 'boolean'
    || typeof value.shortcutRoutesThroughSplash !== 'boolean'
    || typeof value.installerReceiptPresent !== 'boolean') {
    return fail('STARFIELD_VR_DELIVERY_OBSERVATION_INVALID');
  }
  if (!shortcutInspection?.ok) return shortcutInspection || fail('STARFIELD_VR_SHORTCUT_INSPECTION_INVALID');
  const sourceHead = String(value.installedSourceHead || '').trim().toLowerCase();
  if (!SHA.test(sourceHead)) return fail('STARFIELD_VR_DELIVERY_SOURCE_HEAD_MISSING');
  if (sourceHead !== expectedHead) {
    return fail('STARFIELD_VR_DELIVERY_SOURCE_HEAD_MISMATCH', { sourceHead, expectedHead });
  }
  const installerReceiptVerdict = String(value.installerReceiptVerdict || '');
  const shortcutRoutesThroughSplash = shortcutInspection.routesThroughSplash === true;
  const desktopIconPresent = value.desktopIconPresent === true && shortcutInspection.present === true;
  const installed = desktopIconPresent
    && value.splashWrapperPresent === true
    && shortcutRoutesThroughSplash
    && value.installerReceiptPresent === true
    && installerReceiptVerdict === 'STARFIELD_VR_SHORTCUT_INSTALLED';
  return Object.freeze({
    ok: true,
    sourceHead,
    installed,
    observation: Object.freeze({
      schemaVersion: LOCAL_SCHEMA,
      observedAtUtc: String(value.observedAtUtc || ''),
      desktopIconPresent,
      splashWrapperPresent: value.splashWrapperPresent,
      shortcutTargetPath: shortcutInspection.targetPath,
      shortcutArguments: shortcutInspection.arguments,
      shortcutRoutesThroughSplash,
      installerReceiptPresent: value.installerReceiptPresent,
      installerReceiptVerdict,
      installedSourceHead: sourceHead,
    }),
  });
}

function normalizeReadinessResult(record, status) {
  if (!record || ![0, 2].includes(status)) return null;
  const decision = record.decision && typeof record.decision === 'object' && !Array.isArray(record.decision)
    ? record.decision
    : record;
  const explicitVerdict = String(record.verdict || '').trim();
  const inferredVerdict = decision?.ok === false || String(decision?.action || '') === 'BLOCKED'
    ? 'STARFIELD_VR_LAUNCH_BLOCKED'
    : '';
  const verdict = explicitVerdict || inferredVerdict;
  const launchReady = status === 0
    && verdict === 'STARFIELD_VR_LAUNCH_READY'
    && decision?.ok === true;
  const blocked = status === 2
    && verdict === 'STARFIELD_VR_LAUNCH_BLOCKED'
    && decision?.ok === false;
  if (!launchReady && !blocked) return null;
  return Object.freeze({
    launchReady,
    verdict,
    selectedProvider: String(decision?.selectedProvider || 'unknown'),
    blockers: Object.freeze(Array.isArray(decision?.blockers) ? decision.blockers.map(String) : []),
    warnings: Object.freeze(Array.isArray(decision?.warnings) ? decision.warnings.map(String) : []),
    receiptWritten: typeof record.receiptPath === 'string' && record.receiptPath.length > 0,
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
  if (!existsSyncFn(paths.powershellExe)) return fail('STARFIELD_VR_POWERSHELL_MISSING');

  const headInvocation = spawnSyncFn('git', ['rev-parse', 'HEAD'], invocationOptions(paths.repoRoot, 30_000));
  const localHead = String(headInvocation?.stdout || '').trim().toLowerCase();
  if (headInvocation?.error || headInvocation?.status !== 0 || !SHA.test(localHead)) {
    return fail('STARFIELD_VR_LOCAL_HEAD_READ_FAILED');
  }
  if (localHead !== shape.expectedHead) {
    return fail('STARFIELD_VR_LOCAL_HEAD_MISMATCH', { localHead, expectedHead: shape.expectedHead });
  }

  if (shape.operation === STARFIELD_VR_READINESS_OPERATION) {
    const protectedMain = verifyCurrentProtectedMain(shape.expectedHead, paths, spawnSyncFn);
    if (!protectedMain.ok) return protectedMain;
    if (!existsSyncFn(paths.launcherScript)) return fail('STARFIELD_VR_LAUNCHER_MISSING');
    if (!existsSyncFn(paths.decisionScript)) return fail('STARFIELD_VR_LAUNCH_DECISION_MISSING');
    if (!existsSyncFn(paths.policyScript)) return fail('STARFIELD_VR_LAUNCH_POLICY_MISSING');
    const launcherIdentity = verifyWorkingScriptIdentity(
      LAUNCHER_RELATIVE_PATH,
      paths.launcherScript,
      shape.expectedHead,
      paths,
      spawnSyncFn,
    );
    if (!launcherIdentity.ok) return launcherIdentity;
    const decisionIdentity = verifyWorkingScriptIdentity(
      DECISION_RELATIVE_PATH,
      paths.decisionScript,
      shape.expectedHead,
      paths,
      spawnSyncFn,
    );
    if (!decisionIdentity.ok) return decisionIdentity;
    const policyIdentity = verifyWorkingScriptIdentity(
      POLICY_RELATIVE_PATH,
      paths.policyScript,
      shape.expectedHead,
      paths,
      spawnSyncFn,
    );
    if (!policyIdentity.ok) return policyIdentity;
    const readinessInvocation = spawnSyncFn(paths.powershellExe, [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', paths.launcherScript,
      '-ReadinessOnly',
    ], invocationOptions(paths.repoRoot, 120_000));
    if (readinessInvocation?.error || ![0, 2].includes(readinessInvocation?.status)) {
      return fail('STARFIELD_VR_READINESS_EXECUTION_FAILED');
    }
    const readiness = normalizeReadinessResult(parseJson(readinessInvocation?.stdout), readinessInvocation.status);
    if (!readiness) return fail('STARFIELD_VR_READINESS_RECEIPT_INVALID');
    return Object.freeze({
      ok: true,
      schemaVersion: STARFIELD_VR_BATTLE_BRIDGE_SCHEMA,
      operation: shape.operation,
      expectedHead: shape.expectedHead,
      sourceHead: shape.expectedHead,
      launchReady: readiness.launchReady,
      selectedProvider: readiness.selectedProvider,
      blockers: readiness.blockers,
      warnings: readiness.warnings,
      receiptWritten: readiness.receiptWritten,
      arbitraryShellAllowed: false,
      arbitraryPowerShellAllowed: false,
      arbitraryPathAllowed: false,
      arbitraryExecutableAllowed: false,
      profileOverrideAllowed: false,
      launchAllowed: false,
      providerMutationAllowed: false,
      sourceMutationAllowed: false,
      finalVerdict: readiness.verdict,
    });
  }

  if (shape.operation === STARFIELD_VR_SHORTCUT_INSTALL_OPERATION) {
    const protectedMain = verifyCurrentProtectedMain(shape.expectedHead, paths, spawnSyncFn);
    if (!protectedMain.ok) return protectedMain;
    if (!existsSyncFn(paths.installerScript)) return fail('STARFIELD_VR_SHORTCUT_INSTALLER_MISSING');
    const installerIdentity = verifyWorkingScriptIdentity(
      INSTALLER_RELATIVE_PATH,
      paths.installerScript,
      shape.expectedHead,
      paths,
      spawnSyncFn,
    );
    if (!installerIdentity.ok) return installerIdentity;
  }
  const probeIdentity = verifyWorkingScriptIdentity(
    PROBE_RELATIVE_PATH,
    paths.probeScript,
    shape.expectedHead,
    paths,
    spawnSyncFn,
  );
  if (!probeIdentity.ok) return probeIdentity;

  if (shape.operation === STARFIELD_VR_SHORTCUT_INSTALL_OPERATION) {
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
  const shortcutInspection = inspectShortcut(paths, spawnSyncFn);
  if (!shortcutInspection.ok) return shortcutInspection;
  const observed = validateObservation(parseJson(probeInvocation?.stdout), shape.expectedHead, shortcutInspection);
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
      : observed.installed
        ? 'STARFIELD_VR_DELIVERY_STATUS_INSTALLED'
        : 'STARFIELD_VR_DELIVERY_STATUS_NOT_INSTALLED',
  });
}
