import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';

export const BATTLE_BRIDGE_CANONICAL_REMOTE_URL = 'https://github.com/Cheekyfellastef/stephan-os.git';
export const BATTLE_BRIDGE_POSIX_GIT_EXECUTABLE = '/usr/bin/git';

export function resolveBattleBridgeGitExecutable(platform = process.platform) {
  if (platform === 'win32') return BATTLE_BRIDGE_WINDOWS_HOST.git;
  if (platform === 'linux' || platform === 'darwin') return BATTLE_BRIDGE_POSIX_GIT_EXECUTABLE;
  throw new Error(`BATTLE_BRIDGE_GIT_PLATFORM_UNSUPPORTED:${platform}`);
}

export function battleBridgeCanonicalRepositoryArgs(repoRoot) {
  const root = path.resolve(String(repoRoot || ''));
  return Object.freeze([
    `--git-dir=${path.resolve(root, '.git')}`,
    `--work-tree=${root}`,
  ]);
}

// Every authority-bearing Git invocation carries these overrides before the
// fixed operation. Local repository configuration remains readable for the
// closed-world audit, but cannot install hooks, external transports, a file
// monitor, credential commands, or recursive submodule execution.
export const BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS = Object.freeze([
  '-c', 'core.hooksPath=NUL',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.trustctime=true',
  '-c', 'core.checkStat=default',
  '-c', 'core.ignoreStat=false',
  '-c', 'core.untrackedCache=false',
  '-c', 'core.attributesFile=NUL',
  '-c', 'core.excludesFile=NUL',
  '-c', 'credential.helper=',
  '-c', 'protocol.allow=never',
  '-c', 'protocol.https.allow=always',
  '-c', 'submodule.recurse=false',
  '-c', 'fetch.recurseSubmodules=false',
  '-c', 'fetch.writeCommitGraph=false',
  '-c', 'gc.auto=0',
  '-c', 'maintenance.auto=false',
]);

export function battleBridgeGitFixedConfigArgs(platform = process.platform) {
  resolveBattleBridgeGitExecutable(platform);
  const nullDevice = platform === 'win32' ? 'NUL' : '/dev/null';
  return Object.freeze(BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS.map((value) => (
    value.endsWith('=NUL') ? `${value.slice(0, -3)}${nullDevice}` : value
  )));
}

function fixedEnvironmentConfig(fixedConfigArgs) {
  return Object.freeze(
    fixedConfigArgs.reduce((entries, value, index, values) => {
      if (value !== '-c') return entries;
      const assignment = String(values[index + 1] || '');
      const separator = assignment.indexOf('=');
      if (separator < 1) throw new Error('BATTLE_BRIDGE_FIXED_GIT_CONFIG_INVALID');
      entries.push(Object.freeze([assignment.slice(0, separator), assignment.slice(separator + 1)]));
      return entries;
    }, []),
  );
}

const SAFE_WINDOWS_ENVIRONMENT_KEYS = Object.freeze([
  'APPDATA',
  'HOMEDRIVE',
  'HOMEPATH',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'USERDOMAIN',
  'USERNAME',
  'USERPROFILE',
  'WINDIR',
]);
const SAFE_POSIX_ENVIRONMENT_KEYS = Object.freeze(['LANG', 'LC_ALL', 'TEMP', 'TMP', 'TMPDIR', 'USER']);

function readCaseInsensitive(environment, expectedKey) {
  const key = Object.keys(environment || {}).find((candidate) => candidate.toUpperCase() === expectedKey);
  const value = key ? String(environment[key] ?? '') : '';
  return value && !/[\0\r\n]/.test(value) ? value : '';
}

export function createBattleBridgeMinimalChildEnvironment(environment = process.env, { git = false, platform = process.platform } = {}) {
  resolveBattleBridgeGitExecutable(platform);
  const sanitized = Object.create(null);
  const safeKeys = platform === 'win32' ? SAFE_WINDOWS_ENVIRONMENT_KEYS : SAFE_POSIX_ENVIRONMENT_KEYS;
  for (const key of safeKeys) {
    const value = readCaseInsensitive(environment, key);
    if (value) sanitized[key] = value;
  }
  sanitized.PATH = platform === 'win32'
    ? 'C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\WindowsPowerShell\\v1.0;C:\\Program Files\\nodejs;C:\\Program Files\\Git\\cmd'
    : '/usr/bin:/bin';
  if (platform === 'win32') sanitized.PATHEXT = '.COM;.EXE;.BAT;.CMD';
  if (git) {
    const fixedConfig = fixedEnvironmentConfig(battleBridgeGitFixedConfigArgs(platform));
    const nullDevice = platform === 'win32' ? 'NUL' : '/dev/null';
    sanitized.GIT_CONFIG_COUNT = String(fixedConfig.length);
    fixedConfig.forEach(([key, value], index) => {
      sanitized[`GIT_CONFIG_KEY_${index}`] = key;
      sanitized[`GIT_CONFIG_VALUE_${index}`] = value;
    });
    sanitized.GIT_CONFIG_GLOBAL = nullDevice;
    sanitized.GIT_CONFIG_NOSYSTEM = '1';
    sanitized.GIT_GRAFT_FILE = nullDevice;
    sanitized.GIT_NO_LAZY_FETCH = '1';
    sanitized.GIT_NO_REPLACE_OBJECTS = '1';
    sanitized.GIT_OPTIONAL_LOCKS = '0';
    sanitized.GIT_PROTOCOL_FROM_USER = '0';
    sanitized.GIT_TERMINAL_PROMPT = '0';
    sanitized.GCM_INTERACTIVE = 'Never';
  }
  return Object.freeze(sanitized);
}

export function resolveBattleBridgeGitExecution({
  platform = process.platform,
  environment = process.env,
} = {}) {
  return Object.freeze({
    executable: resolveBattleBridgeGitExecutable(platform),
    fixedConfigArgs: battleBridgeGitFixedConfigArgs(platform),
    environment: createBattleBridgeMinimalChildEnvironment(environment, { git: true, platform }),
  });
}

function parseNullConfig(output = '') {
  return String(output || '').split('\0').filter(Boolean).map((entry) => {
    const separator = entry.includes('\n') ? entry.indexOf('\n') : entry.indexOf('=');
    return Object.freeze({
      key: (separator >= 0 ? entry.slice(0, separator) : entry).trim().toLowerCase(),
      value: separator >= 0 ? entry.slice(separator + 1).trim() : '',
    });
  });
}

export function validateBattleBridgeLocalGitConfiguration(output = '') {
  const entries = parseNullConfig(output);
  const remoteUrls = entries.filter((entry) => entry.key === 'remote.origin.url').map((entry) => entry.value);
  const risky = entries.filter((entry) => (
    entry.key.startsWith('alias.')
    || entry.key === 'core.worktree'
    || entry.key === 'core.sparsecheckout'
    || entry.key === 'core.sparsecheckoutcone'
    || entry.key === 'index.sparse'
    || entry.key === 'core.hookspath'
    || entry.key === 'core.fsmonitor'
    || entry.key === 'core.trustctime'
    || entry.key === 'core.checkstat'
    || entry.key === 'core.ignorestat'
    || entry.key === 'core.untrackedcache'
    || entry.key === 'core.sshcommand'
    || entry.key === 'core.alternaterefscommand'
    || entry.key === 'core.askpass'
    || entry.key === 'core.gitproxy'
    || entry.key === 'core.pager'
    || entry.key === 'diff.external'
    || entry.key.startsWith('credential.')
    || entry.key.startsWith('filter.')
    || /^diff\..+\.(command|textconv)$/.test(entry.key)
    || /^merge\..+\.driver$/.test(entry.key)
    || /^branch\..+\.mergeoptions$/.test(entry.key)
    || /^remote\..+\.vcs$/.test(entry.key)
    || /^remote\..+\.(proxy|uploadpack|receivepack)$/.test(entry.key)
    || entry.key.startsWith('url.')
    || entry.key === 'include.path'
    || entry.key.startsWith('includeif.')
    || entry.key.startsWith('protocol.')
    || entry.key === 'extensions.worktreeconfig'
    || /^submodule\..+\.update$/.test(entry.key)
    || /^gc\..*(hook|command)$/.test(entry.key)
    || entry.key === 'gc.recentobjectshook'
    || entry.key.startsWith('pager.')
    || entry.key === 'interactive.difffilter'
    || entry.key === 'sequence.editor'
    || entry.key === 'core.editor'
    || entry.key === 'gpg.program'
    || entry.key.startsWith('http.')
  ));
  const ok = remoteUrls.length === 1
    && remoteUrls[0].toLowerCase() === BATTLE_BRIDGE_CANONICAL_REMOTE_URL.toLowerCase()
    && risky.length === 0;
  return Object.freeze({
    ok,
    blocker: ok ? '' : 'CANONICAL_GIT_CONFIGURATION_INVALID',
    remoteUrl: ok ? remoteUrls[0] : '',
    riskyKeys: Object.freeze(risky.map((entry) => entry.key)),
  });
}

const FORBIDDEN_GIT_TOPOLOGY_PATHS = Object.freeze([
  ['commondir', 'GIT_COMMON_DIRECTORY_REDIRECT_PRESENT'],
  [path.join('info', 'grafts'), 'GIT_GRAFTS_PRESENT'],
  [path.join('objects', 'info', 'alternates'), 'GIT_OBJECT_ALTERNATES_PRESENT'],
]);

export function inspectBattleBridgeGitTopology(repoRoot, { lstatFn = lstatSync, stabilizeIndex = false } = {}) {
  const gitDirectory = path.resolve(String(repoRoot || ''), '.git');
  const stableIdentities = Object.create(null);
  const samePath = (left, right) => process.platform === 'win32'
    ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
    : path.resolve(left) === path.resolve(right);
  const boundedDigest = (pathname, maxBytes = 1024 * 1024) => {
    let fd;
    try {
      fd = openSync(pathname, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      const before = fstatSync(fd);
      if (!before.isFile() || before.size < 0 || before.size > maxBytes) throw new Error('CANONICAL_GIT_METADATA_SIZE_INVALID');
      const bytes = Buffer.alloc(before.size + 1);
      let offset = 0;
      while (offset < bytes.length) {
        const count = readSync(fd, bytes, offset, bytes.length - offset, null);
        if (count === 0) break;
        offset += count;
      }
      const after = fstatSync(fd);
      if (offset !== before.size || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size) {
        throw new Error('CANONICAL_GIT_METADATA_CHANGED_DURING_READ');
      }
      return createHash('sha256').update(bytes.subarray(0, offset)).digest('hex');
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  };
  const inspectEntry = (relative, expectedType, { required = false, stable = true } = {}) => {
    const pathname = relative ? path.resolve(gitDirectory, relative) : gitDirectory;
    let info;
    try { info = lstatFn(pathname); } catch (error) {
      if (error?.code === 'ENOENT' && !required) return null;
      return Object.freeze({ ok: false, blocker: 'CANONICAL_GIT_TOPOLOGY_UNPROVEN', pathname });
    }
    let canonical;
    try { canonical = realpathSync(pathname); } catch {
      return Object.freeze({ ok: false, blocker: 'CANONICAL_GIT_TOPOLOGY_UNPROVEN', pathname });
    }
    const correctType = expectedType === 'directory' ? info.isDirectory() : info.isFile();
    if (info.isSymbolicLink() || !correctType || !samePath(canonical, pathname)) {
      return Object.freeze({ ok: false, blocker: 'CANONICAL_GIT_REPARSE_POINT_PRESENT', pathname });
    }
    if (stable) {
      let digest = '';
      try { digest = expectedType === 'file' ? boundedDigest(pathname) : ''; } catch {
        return Object.freeze({ ok: false, blocker: 'CANONICAL_GIT_TOPOLOGY_UNPROVEN', pathname });
      }
      stableIdentities[relative || '.git'] = [info.dev, info.ino, info.mode, digest].map(String).join(':');
    }
    return null;
  };
  for (const [relative, expectedType] of [
    ['', 'directory'],
    ['objects', 'directory'],
    ['refs', 'directory'],
    ['config', 'file'],
    ['HEAD', 'file'],
  ]) {
    const failure = inspectEntry(relative, expectedType, { required: true });
    if (failure) return failure;
  }
  for (const [relative, expectedType, stable] of [
    ['info', 'directory', true],
    [path.join('objects', 'info'), 'directory', true],
    [path.join('objects', 'pack'), 'directory', true],
    [path.join('refs', 'heads'), 'directory', true],
    [path.join('refs', 'remotes'), 'directory', true],
    ['logs', 'directory', true],
    ['hooks', 'directory', true],
    // Git legitimately commits these through lockfile + rename. They must be
    // ordinary canonical files at every boundary, but their inode is not a
    // cross-mutation invariant.
    ['index', 'file', stabilizeIndex],
    ['packed-refs', 'file', false],
    ['config.worktree', 'file', false],
    ['shallow', 'file', false],
    ['FETCH_HEAD', 'file', false],
    ['ORIG_HEAD', 'file', false],
  ]) {
    const failure = inspectEntry(relative, expectedType, { stable });
    if (failure) return failure;
  }
  for (const [relative, blocker] of FORBIDDEN_GIT_TOPOLOGY_PATHS) {
    const pathname = path.resolve(gitDirectory, relative);
    if (!pathname.startsWith(`${gitDirectory}${path.sep}`)) {
      return Object.freeze({ ok: false, blocker: 'CANONICAL_GIT_TOPOLOGY_INVALID' });
    }
    try {
      lstatFn(pathname);
      return Object.freeze({ ok: false, blocker, pathname });
    } catch (error) {
      if (error?.code !== 'ENOENT') return Object.freeze({ ok: false, blocker: 'CANONICAL_GIT_TOPOLOGY_UNPROVEN', pathname });
    }
  }
  return Object.freeze({ ok: true, blocker: '', stableIdentities: Object.freeze(stableIdentities) });
}
