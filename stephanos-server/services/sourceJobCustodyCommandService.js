import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(fileURLToPath(new URL('../../scripts/windows/Invoke-StephanosSourceJobCustody.ps1', import.meta.url)));
const REQUIRED = '1';
const ERROR_PREFIX = 'PROVIDER_NEUTRAL_SOURCE_JOB_CUSTODY_';
const blocked = (reason) => ({
  error: new Error(ERROR_PREFIX + reason), status: null,
  stdout: '', stderr: ERROR_PREFIX + reason,
});

export function sourceJobCustodyRequired(env = process.env) {
  return env.STEPHANOS_SOURCE_JOB_CUSTODY_REQUIRED === REQUIRED;
}

// No caller-selectable shell, program, inherited bypass, receipt issuer,
// false-success fallback or arbitrary command. Only bounded git/node execution
// within the already-admitted clean source worktree is eligible.
export function createRequiredSourceJobCommandRunner(options = {}) {
  const hostEnv = options.env || process.env;
  const platform = options.platform || process.platform;
  const execute = options.spawnSync || spawnSync;
  const isPresent = options.existsSync || existsSync;
  const script = options.script || SCRIPT;
  const timeoutMs = options.timeoutMs || 120000;
  return function runSourceCommand(executable, args, commandOptions = {}) {
    const cwd = commandOptions.cwd;
    if (platform !== 'win32') return blocked('WINDOWS_REQUIRED');
    if (!isAbsolute(String(cwd || '')) || !isPresent(cwd)) return blocked('WORKTREE_UNPROVEN');
    if (!Array.isArray(args) || args.length > 128 || args.some(x => typeof x !== 'string' || x.includes('\0'))) {
      return blocked('ARGV_INVALID');
    }
    const requested = String(executable || '').toLowerCase();
    let path;
    if (requested === 'node.exe') path = options.nodePath || process.execPath;
    else if (requested === 'git.exe') path = hostEnv.STEPHANOS_SOURCE_CUSTODY_GIT_EXE;
    else return blocked('EXECUTABLE_NOT_ALLOWLISTED');
    if (!isAbsolute(String(path || '')) || !['node.exe', 'git.exe'].includes(basename(path).toLowerCase())
      || !isPresent(path)) return blocked('EXECUTABLE_UNVERIFIED');
    if (!isPresent(script) || !isAbsolute(script)) return blocked('RUNNER_MISSING');
    const systemRoot = hostEnv.SystemRoot || hostEnv.SYSTEMROOT || '';
    const ps = hostEnv.STEPHANOS_SOURCE_CUSTODY_POWERSHELL_EXE
      || (systemRoot ? join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : '');
    if (!isAbsolute(ps) || basename(ps).toLowerCase() !== 'powershell.exe' || !isPresent(ps)) {
      return blocked('POWERSHELL_UNVERIFIED');
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) {
      return blocked('TIMEOUT_INVALID');
    }
    const encoded = Buffer.from(JSON.stringify(args), 'utf8').toString('base64');
    if (encoded.length > 32768) return blocked('ARGV_UNBOUNDED');
    const result = execute(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', script, '-Executable', path, '-Worktree', cwd,
      '-ArgumentsBase64', encoded, '-TimeoutSeconds', String(Math.ceil(timeoutMs / 1000))], {
      cwd, env: commandOptions.env || hostEnv, shell: false, windowsHide: true,
      encoding: Object.hasOwn(commandOptions, 'encoding') ? commandOptions.encoding : 'utf8',
      maxBuffer: 2 * 1024 * 1024, timeout: timeoutMs + 30000,
    });
    // The PowerShell runner returns 125 on OS custody failure; no raw retry.
    return result;
  };
}
