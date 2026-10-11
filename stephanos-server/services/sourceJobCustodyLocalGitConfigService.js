import { spawnSync } from 'node:child_process';
import { basename, isAbsolute } from 'node:path';

const MAX_CONFIG_BYTES = 64 * 1024;
const CANONICAL_REMOTE = 'https://github.com/Cheekyfellastef/stephan-os.git';
const CORE_KEYS = new Set([
  'core.repositoryformatversion', 'core.filemode', 'core.bare',
  'core.logallrefupdates', 'core.ignorecase', 'core.symlinks',
  'core.autocrlf', 'core.precomposeunicode', 'core.longpaths',
]);
const SAFE_BOOLEAN = new Set(['true', 'false']);

const fail = (reason) => Object.freeze({ ok: false, reason: 'LOCAL_GIT_CONFIG_' + reason });

// Closed-world allowlist: Git can load .git/config even when global and system
// configs are disabled. An include, auth header, credential helper, URL
// rewriting rule or unknown key cannot be silently inherited by source tests.
// This check does NOT provide OS token or TOCTOU isolation.
export function validateSourceCustodyLocalGitConfig(output) {
  if (typeof output !== 'string' || output.length < 1 || Buffer.byteLength(output, 'utf8') > MAX_CONFIG_BYTES
    || !output.endsWith('\0')) return fail('MALFORMED');
  const parts = output.slice(0, -1).split('\0');
  if (parts.length < 1 || parts.length > 128) return fail('ENTRY_COUNT_INVALID');
  const seen = new Set();
  let origin = 0;
  for (const part of parts) {
    const newline = part.indexOf('\n');
    if (newline <= 0) return fail('ENTRY_MALFORMED');
    const key = part.slice(0, newline).toLowerCase();
    const value = part.slice(newline + 1);
    if (!/^[a-z][a-z0-9._-]*$/.test(key) || seen.has(key)
      || value.includes('\0') || value.includes('\r') || value.includes('\n')
      || value.length > 2048) return fail('ENTRY_INVALID_OR_DUPLICATE');
    seen.add(key);
    if (key === 'remote.origin.url') {
      if (value !== CANONICAL_REMOTE) return fail('NONCANONICAL_REMOTE');
      origin++;
    } else if (key === 'remote.origin.fetch') {
      if (value !== '+refs/heads/*:refs/remotes/origin/*') return fail('UNSAFE_FETCH');
    } else if (CORE_KEYS.has(key)) {
      if (key === 'core.repositoryformatversion') {
        if (value !== '0') return fail('FORMAT_INVALID');
      } else if (!SAFE_BOOLEAN.has(value.toLowerCase())) return fail('CORE_VALUE_INVALID');
    } else if (/^branch\.[a-z0-9._/-]+\.(remote|merge|rebase)$/.test(key)) {
      if (key.endsWith('.remote') && value !== 'origin') return fail('BRANCH_REMOTE_INVALID');
      if (key.endsWith('.merge') && !/^refs\/heads\/[a-z0-9._/-]+$/.test(value)) return fail('BRANCH_MERGE_INVALID');
      if (key.endsWith('.rebase') && !SAFE_BOOLEAN.has(value.toLowerCase())) return fail('BRANCH_REBASE_INVALID');
    } else return fail('UNKNOWN_OR_CREDENTIAL_CAPABLE_KEY');
  }
  if (origin !== 1) return fail('ORIGIN_REQUIRED');
  return Object.freeze({ ok: true, reason: 'LOCAL_GIT_CONFIG_CLOSED_WORLD' });
}

export function inspectSourceCustodyLocalGitConfig(worktree, gitPath, environment, {
  execute = spawnSync,
} = {}) {
  if (!isAbsolute(String(worktree || '')) || !isAbsolute(String(gitPath || ''))
    || basename(gitPath).toLowerCase() !== 'git.exe') return fail('TRUSTED_PATH_UNPROVEN');
  // The query deliberately does NOT dereference include.path or includeIf.
  // Any include key is rejected by the validator before source execution.
  const result = execute(gitPath, ['-C', worktree, 'config', '--local', '--null',
    '--list', '--no-includes'], {
    cwd: worktree, env: environment, encoding: 'utf8', shell: false,
    windowsHide: true, maxBuffer: MAX_CONFIG_BYTES, timeout: 10000,
  });
  if (result.error || result.status !== 0 || result.signal || typeof result.stdout !== 'string') {
    return fail('READ_FAILED');
  }
  return validateSourceCustodyLocalGitConfig(result.stdout);
}
