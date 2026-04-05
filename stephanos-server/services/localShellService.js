import { spawnSync } from 'node:child_process';
import { getLocalShellConfig } from '../config/localShellConfig.js';

const LOCAL_SHELL_SESSION = {
  lastPid: null,
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

function buildOpenRepoPowerShellScript(repoPath) {
  const escapedPath = escapePowerShellSingleQuotedLiteral(repoPath);
  const setLocationCommand = `Set-Location -LiteralPath '${escapedPath}'`;
  const escapedSetLocation = escapePowerShellSingleQuotedLiteral(setLocationCommand);

  return [
    "$ErrorActionPreference = 'Stop'",
    "$repoPath = '" + escapedPath + "'",
    "$launchCommand = '" + escapedSetLocation + "'",
    "$proc = Start-Process -FilePath 'powershell.exe' -WorkingDirectory $repoPath -ArgumentList @('-NoExit', '-Command', $launchCommand) -PassThru",
    'Start-Sleep -Milliseconds 300',
    '$wshell = New-Object -ComObject WScript.Shell',
    '$focusApplied = [bool]$wshell.AppActivate($proc.Id)',
    '$topmostApplied = $false',
    '$mainWindowHandle = (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue).MainWindowHandle',
    'if ($mainWindowHandle -ne 0) {',
    "  Add-Type @'",
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class StephanosWindowOps {',
    '  [DllImport("user32.dll")]',
    '  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);',
    '}',
    "'@",
    '  [void][StephanosWindowOps]::SetWindowPos([IntPtr]$mainWindowHandle, [IntPtr](-1), 0, 0, 0, 0, 0x0003)',
    '  $topmostApplied = $true',
    '}',
    '$result = @{',
    '  ok = $true',
    '  launched = $true',
    '  pid = [int]$proc.Id',
    '  focusApplied = $focusApplied',
    '  topmostApplied = $topmostApplied',
    '  reason = ""',
    '}',
    '$result | ConvertTo-Json -Compress',
  ].join('; ');
}

function buildFocusRepoPowerShellScript(pid) {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$targetPid = ${Number(pid)}`,
    '$targetProcess = Get-Process -Id $targetPid -ErrorAction Stop',
    '$wshell = New-Object -ComObject WScript.Shell',
    '$focusApplied = [bool]$wshell.AppActivate($targetPid)',
    '$topmostApplied = $false',
    '$mainWindowHandle = $targetProcess.MainWindowHandle',
    'if ($mainWindowHandle -ne 0) {',
    "  Add-Type @'",
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class StephanosWindowOps {',
    '  [DllImport("user32.dll")]',
    '  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);',
    '}',
    "'@",
    '  [void][StephanosWindowOps]::SetWindowPos([IntPtr]$mainWindowHandle, [IntPtr](-1), 0, 0, 0, 0, 0x0003)',
    '  $topmostApplied = $true',
    '}',
    '$result = @{',
    '  ok = $true',
    '  focused = $focusApplied',
    '  focusApplied = $focusApplied',
    '  topmostApplied = $topmostApplied',
    '  pid = [int]$targetPid',
    '  reason = ""',
    '}',
    '$result | ConvertTo-Json -Compress',
  ].join('; ');
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
      diagnostics: {},
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
}
