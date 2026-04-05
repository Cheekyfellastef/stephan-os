import { spawn } from 'node:child_process';
import { getLocalShellConfig } from '../config/localShellConfig.js';

function escapePowerShellSingleQuotedLiteral(value = '') {
  return String(value || '').replace(/'/g, "''");
}

export function launchRepoPowerShell({ env = process.env, platform = process.platform, spawnImpl = spawn } = {}) {
  const config = getLocalShellConfig(env);

  if (platform !== 'win32') {
    return {
      ok: false,
      launched: false,
      repoPath: config.repoPath,
      reason: 'windows-only-local-shell-launch',
    };
  }

  const command = `Set-Location -LiteralPath '${escapePowerShellSingleQuotedLiteral(config.repoPath)}'`;

  try {
    const child = spawnImpl('powershell.exe', ['-NoExit', '-Command', command], {
      cwd: config.repoPath,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });

    if (typeof child.unref === 'function') {
      child.unref();
    }

    return {
      ok: true,
      launched: true,
      repoPath: config.repoPath,
      reason: '',
    };
  } catch (error) {
    return {
      ok: false,
      launched: false,
      repoPath: config.repoPath,
      reason: error?.message || 'failed-to-launch-powershell',
    };
  }
}
