import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path';
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

// Child commands may execute arbitrary source-controlled Node tests. NEVER
// construct their environment by subtracting known secrets from process.env:
// passwords, Git credential helpers, cloud-agent sockets and auth-config paths
// have unbounded names. Use a closed world and disposable config/profile roots.
// OS token & filesystem rights are STILL NOT isolated by this function.
export function sanitizeSourceCustodyChildEnvironment(
  _untrustedParentEnvironment = {},
  isolatedHome = '',
  { systemRoot = '', nodePath = '', gitPath = '' } = {},
) {
  if (!isAbsolute(isolatedHome) || !isAbsolute(systemRoot)
    || !isAbsolute(nodePath) || !isAbsolute(gitPath)) {
    throw new Error('SOURCE_CUSTODY_ENVIRONMENT_ROOTS_UNPROVEN');
  }
  const safePath = [...new Set([
    dirname(nodePath),
    dirname(gitPath),
    join(systemRoot, 'System32'),
    systemRoot,
    join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
  ])].join(';');
  const homeRoot = parse(isolatedHome).root;
  const homeRelative = isolatedHome.slice(homeRoot.length).replaceAll('/', '\\');
  return Object.freeze({
    SystemRoot: systemRoot,
    windir: systemRoot,
    OS: 'Windows_NT',
    PATH: safePath,
    Path: safePath,
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    ComSpec: join(systemRoot, 'System32', 'cmd.exe'),
    TEMP: isolatedHome,
    TMP: isolatedHome,
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    HOMEDRIVE: homeRoot.replace(/[\\/]$/, ''),
    HOMEPATH: '\\' + homeRelative,
    APPDATA: join(isolatedHome, 'Roaming'),
    LOCALAPPDATA: join(isolatedHome, 'Local'),
    XDG_CONFIG_HOME: join(isolatedHome, 'xdg-config'),
    XDG_CACHE_HOME: join(isolatedHome, 'xdg-cache'),
    XDG_DATA_HOME: join(isolatedHome, 'xdg-data'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(isolatedHome, 'nonexistent-git-config'),
    GIT_CONFIG_COUNT: '0',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    NPM_CONFIG_USERCONFIG: join(isolatedHome, 'nonexistent-user-npmrc'),
    NPM_CONFIG_GLOBALCONFIG: join(isolatedHome, 'nonexistent-global-npmrc'),
    NPM_CONFIG_CACHE: join(isolatedHome, 'npm-cache'),
    NODE_OPTIONS: '',
  });
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
  const makeHome = options.mkdtempSync || mkdtempSync;
  const createDirectory = options.mkdirSync || mkdirSync;
  const removeHome = options.rmSync || rmSync;
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
    if (!isAbsolute(systemRoot)) return blocked('SYSTEM_ROOT_UNPROVEN');
    const gitPath = hostEnv.STEPHANOS_SOURCE_CUSTODY_GIT_EXE;
    if (!isAbsolute(String(gitPath || '')) || basename(gitPath).toLowerCase() !== 'git.exe'
      || !isPresent(gitPath)) return blocked('GIT_PATH_UNPROVEN');
    // Failure to create or clean a disposable profile must fail this source
    // command closed. Never rerun with the ambient operator profile.
    let home;
    let result;
    let setupFailed = false;
    let cleanupFailed = false;
    try {
      home = makeHome(join(tmpdir(), 'stephanos-source-custody-'));
      for (const folder of ['Roaming', 'Local', 'xdg-config', 'xdg-cache', 'xdg-data']) {
        createDirectory(join(home, folder), { recursive: true });
      }
      const isolated = sanitizeSourceCustodyChildEnvironment(commandOptions.env || hostEnv, home, {
        systemRoot, nodePath: options.nodePath || process.execPath, gitPath,
      });
      result = execute(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', script, '-Executable', path, '-Worktree', cwd,
        '-ArgumentsBase64', encoded, '-TimeoutSeconds', String(Math.ceil(timeoutMs / 1000))], {
        cwd, env: isolated, shell: false, windowsHide: true,
        encoding: Object.hasOwn(commandOptions, 'encoding') ? commandOptions.encoding : 'utf8',
        maxBuffer: 2 * 1024 * 1024, timeout: timeoutMs + 30000,
      });
    } catch {
      setupFailed = true;
    } finally {
      if (home) {
        try { removeHome(home, { recursive: true, force: true }); }
        catch { cleanupFailed = true; }
      }
    }
    if (cleanupFailed) return blocked('DISPOSABLE_PROFILE_CLEANUP_FAILED');
    if (setupFailed || !result) return blocked('DISPOSABLE_PROFILE_UNAVAILABLE');
    return result;
  };
}
