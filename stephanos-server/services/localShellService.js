import { spawnSync } from 'node:child_process';
import { getLocalShellConfig } from '../config/localShellConfig.js';

const LOCAL_SHELL_SESSION = {
  lastPid: null,
  lastLaunchIso: '',
};

function escapePowerShellSingleQuotedLiteral(value = '') {
  return String(value || '').replace(/'/g, "''");
}

function buildStdErrReason(prefix, details = '') {
  const normalizedDetails = String(details || '').trim();
  if (!normalizedDetails) {
    return prefix;
  }
  return `${prefix}: ${normalizedDetails}`;
}

function buildWindowFocusTypeDefinition() {
  return [
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class StephanosWindowOps {',
    '  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);',
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);',
    '}',
    '"@',
  ].join('\n');
}

function buildOpenRepoPowerShellScript(repoPath) {
  const escapedPath = escapePowerShellSingleQuotedLiteral(repoPath);
  const setLocationCommand = `Set-Location -LiteralPath '${escapedPath}'`;
  const escapedSetLocation = escapePowerShellSingleQuotedLiteral(setLocationCommand);

  return [
    '$ErrorActionPreference = "Stop"',
    `$repoPath = '${escapedPath}'`,
    `$launchCommand = '${escapedSetLocation}'`,
    "$proc = Start-Process -FilePath 'powershell.exe' -WorkingDirectory $repoPath -ArgumentList @('-NoExit', '-Command', $launchCommand) -PassThru",
    '$mainWindowHandle = [IntPtr]::Zero',
    'for ($i = 0; $i -lt 20; $i++) {',
    '  Start-Sleep -Milliseconds 150',
    '  $targetProcess = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue',
    '  if ($targetProcess -and $targetProcess.MainWindowHandle -ne 0) {',
    '    $mainWindowHandle = [IntPtr]$targetProcess.MainWindowHandle',
    '    break',
    '  }',
    '}',
    buildWindowFocusTypeDefinition(),
    '$focusApplied = $false',
    '$topmostApplied = $false',
    'if ($mainWindowHandle -ne [IntPtr]::Zero) {',
    '  if ([StephanosWindowOps]::IsIconic($mainWindowHandle)) {',
    '    [void][StephanosWindowOps]::ShowWindowAsync($mainWindowHandle, 9)',
    '  }',
    '  $focusApplied = [bool][StephanosWindowOps]::SetForegroundWindow($mainWindowHandle)',
    '  $topmostApplied = $focusApplied',
    '}',
    '$result = @{ ok = $true; launched = $true; pid = [int]$proc.Id; focusApplied = $focusApplied; topmostApplied = $topmostApplied; reason = "" }',
    '$result | ConvertTo-Json -Compress',
  ].join('\n');
}

function buildFocusRepoPowerShellScript(pid) {
  return [
    '$ErrorActionPreference = "Stop"',
    `$targetPid = ${Number(pid)}`,
    '$targetProcess = Get-Process -Id $targetPid -ErrorAction Stop',
    '$mainWindowHandle = [IntPtr]$targetProcess.MainWindowHandle',
    buildWindowFocusTypeDefinition(),
    '$focusApplied = $false',
    '$topmostApplied = $false',
    'if ($mainWindowHandle -ne [IntPtr]::Zero) {',
    '  if ([StephanosWindowOps]::IsIconic($mainWindowHandle)) {',
    '    [void][StephanosWindowOps]::ShowWindowAsync($mainWindowHandle, 9)',
    '  }',
    '  $focusApplied = [bool][StephanosWindowOps]::SetForegroundWindow($mainWindowHandle)',
    '  $topmostApplied = $focusApplied',
    '} else {',
    '  $focusApplied = $false',
    '}',
    '$reason = if ($focusApplied) { "" } else { "window-handle-unavailable-or-foreground-denied" }',
    '$result = @{ ok = ($focusApplied -eq $true); focused = $focusApplied; focusApplied = $focusApplied; topmostApplied = $topmostApplied; pid = [int]$targetPid; reason = $reason }',
    '$result | ConvertTo-Json -Compress',
  ].join('\n');
}

function runPowerShellJsonScript(script, { spawnSyncImpl = spawnSync } = {}) {
  const child = spawnSyncImpl('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    encoding: 'utf8',
  });

  if (child.error) {
    return {
      ok: false,
      launched: false,
      reason: buildStdErrReason('failed-to-start-powershell-launch-helper', child.error.message),
      diagnostics: { error: child.error.message },
    };
  }

  if (Number(child.status) !== 0) {
    return {
      ok: false,
      launched: false,
      reason: buildStdErrReason('powershell-launch-helper-failed', child.stderr || child.stdout),
      diagnostics: {
        status: child.status,
        stdout: String(child.stdout || '').trim(),
        stderr: String(child.stderr || '').trim(),
      },
    };
  }

  try {
    const data = JSON.parse(String(child.stdout || '{}').trim() || '{}');
    return {
      ok: data.ok === true,
      launched: data.launched === true,
      focused: data.focused === true,
      focusApplied: data.focusApplied === true,
      topmostApplied: data.topmostApplied === true,
      pid: Number.isFinite(Number(data.pid)) ? Number(data.pid) : null,
      reason: String(data.reason || ''),
      diagnostics: {
        status: child.status,
      },
    };
  } catch (error) {
    return {
      ok: false,
      launched: false,
      reason: buildStdErrReason('invalid-powershell-launch-helper-output', error.message),
      diagnostics: {
        status: child.status,
        stdout: String(child.stdout || '').trim(),
        stderr: String(child.stderr || '').trim(),
      },
    };
  }
}

export function launchRepoPowerShell({ env = process.env, platform = process.platform, spawnSyncImpl = spawnSync } = {}) {
  const config = getLocalShellConfig(env);

  if (platform !== 'win32') {
    return {
      ok: false,
      launched: false,
      repoPath: config.repoPath,
      reason: 'windows-only-local-shell-launch',
      diagnostics: { platform },
    };
  }

  const script = buildOpenRepoPowerShellScript(config.repoPath);
  const launchResult = runPowerShellJsonScript(script, { spawnSyncImpl });

  if (launchResult.ok && Number.isFinite(launchResult.pid)) {
    LOCAL_SHELL_SESSION.lastPid = launchResult.pid;
    LOCAL_SHELL_SESSION.lastLaunchIso = new Date().toISOString();
  }

  return {
    ok: launchResult.ok,
    launched: launchResult.launched,
    repoPath: config.repoPath,
    pid: launchResult.pid,
    focusApplied: launchResult.focusApplied,
    topmostApplied: launchResult.topmostApplied,
    reason: launchResult.reason,
    diagnostics: launchResult.diagnostics,
  };
}

export function focusRepoPowerShell({ env = process.env, platform = process.platform, spawnSyncImpl = spawnSync } = {}) {
  const config = getLocalShellConfig(env);

  if (platform !== 'win32') {
    return {
      ok: false,
      focused: false,
      repoPath: config.repoPath,
      reason: 'windows-only-local-shell-launch',
      diagnostics: { platform },
    };
  }

  if (!Number.isFinite(LOCAL_SHELL_SESSION.lastPid)) {
    return {
      ok: false,
      focused: false,
      repoPath: config.repoPath,
      reason: 'no-known-powershell-session',
      diagnostics: { lastLaunchIso: LOCAL_SHELL_SESSION.lastLaunchIso || '' },
    };
  }

  const script = buildFocusRepoPowerShellScript(LOCAL_SHELL_SESSION.lastPid);
  const focusResult = runPowerShellJsonScript(script, { spawnSyncImpl });
  return {
    ok: focusResult.ok,
    focused: focusResult.focusApplied,
    repoPath: config.repoPath,
    pid: LOCAL_SHELL_SESSION.lastPid,
    focusApplied: focusResult.focusApplied,
    topmostApplied: focusResult.topmostApplied,
    reason: focusResult.reason,
    diagnostics: focusResult.diagnostics,
  };
}

export function resetLocalShellSession() {
  LOCAL_SHELL_SESSION.lastPid = null;
  LOCAL_SHELL_SESSION.lastLaunchIso = '';
}
