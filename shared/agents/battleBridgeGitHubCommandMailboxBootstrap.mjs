import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAILBOX_SELF_BOOTSTRAP_SCHEMA = 'stephanos.battle-bridge-mailbox-self-bootstrap.v1';
export const MAILBOX_SELF_BOOTSTRAP_TASK = 'Stephanos Battle Bridge GitHub Command Mailbox';
export const MAILBOX_SELF_BOOTSTRAP_INSTALLER = 'scripts/windows/install-battle-bridge-github-command-mailbox.ps1';

function normalizedPath(value = '') {
  return resolve(String(value || '')).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function defaultRepoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function bounded(value = '', limit = 4000) {
  const text = String(value || '').trim();
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text;
}

function verdict(status, details = {}) {
  return Object.freeze({
    schemaVersion: MAILBOX_SELF_BOOTSTRAP_SCHEMA,
    status,
    ok: status === 'MAILBOX_SELF_BOOTSTRAP_INSTALLED' || status.startsWith('MAILBOX_SELF_BOOTSTRAP_SKIPPED_'),
    ...details,
  });
}

export function buildMailboxSelfBootstrapCommand({ repoRoot = defaultRepoRoot() } = {}) {
  const installerPath = resolve(repoRoot, ...MAILBOX_SELF_BOOTSTRAP_INSTALLER.split('/'));
  return Object.freeze({
    executable: 'powershell.exe',
    args: Object.freeze([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', installerPath,
      '-StartNow',
    ]),
    cwd: repoRoot,
    installerPath,
    arbitraryShellAllowed: false,
    liveOpenClawUpdateAllowed: false,
  });
}

export async function ensureBattleBridgeGitHubCommandMailbox({
  platform = process.platform,
  env = process.env,
  repoRoot = defaultRepoRoot(),
  exists = existsSync,
  run = spawnSync,
} = {}) {
  if (platform !== 'win32') {
    return verdict('MAILBOX_SELF_BOOTSTRAP_SKIPPED_NON_WINDOWS', { repoRoot });
  }
  if (!env.USERPROFILE) {
    return verdict('MAILBOX_SELF_BOOTSTRAP_BLOCKED_USERPROFILE_REQUIRED', { repoRoot, operatorNeeded: true });
  }

  const canonicalRepoRoot = resolve(env.USERPROFILE, 'Documents', 'GitHub', 'stephan-os');
  if (normalizedPath(repoRoot) !== normalizedPath(canonicalRepoRoot)) {
    return verdict('MAILBOX_SELF_BOOTSTRAP_BLOCKED_NON_CANONICAL_CHECKOUT', {
      repoRoot,
      canonicalRepoRoot,
      operatorNeeded: false,
    });
  }

  const command = buildMailboxSelfBootstrapCommand({ repoRoot });
  if (!exists(command.installerPath)) {
    return verdict('MAILBOX_SELF_BOOTSTRAP_BLOCKED_INSTALLER_MISSING', {
      repoRoot,
      installerPath: command.installerPath,
      operatorNeeded: false,
    });
  }

  const result = run(command.executable, command.args, {
    cwd: command.cwd,
    env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 120000,
  });
  if (result?.error || result?.status !== 0) {
    return verdict('MAILBOX_SELF_BOOTSTRAP_BLOCKED_INSTALL_FAILED', {
      repoRoot,
      command,
      exitCode: result?.status ?? null,
      error: result?.error?.message || '',
      stdout: bounded(result?.stdout),
      stderr: bounded(result?.stderr),
      operatorNeeded: true,
    });
  }

  return verdict('MAILBOX_SELF_BOOTSTRAP_INSTALLED', {
    repoRoot,
    taskName: MAILBOX_SELF_BOOTSTRAP_TASK,
    command,
    exitCode: result.status,
    stdout: bounded(result.stdout),
    stderr: bounded(result.stderr),
    operatorNeeded: false,
  });
}
