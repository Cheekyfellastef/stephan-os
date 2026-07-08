import { homedir } from 'node:os';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { stat, mkdir } from 'node:fs/promises';
import { SHARED_WORKSPACE_DIRECTORIES } from './sharedAgentWorkspace.mjs';

export const SHARED_WORKSPACE_ENV = 'STEPHANOS_SHARED_AGENT_WORKSPACE';
export const DEFAULT_SHARED_WORKSPACE_DIRECTORY_NAME = 'Stephanos-openclaw-workspace';
export const SHARED_WORKSPACE_BLOCKERS = Object.freeze({
  UNCONFIGURED: 'SHARED_WORKSPACE_PATH_UNCONFIGURED',
  MISSING: 'STEPHANOS_SHARED_AGENT_WORKSPACE_PATH_MISSING',
  INSIDE_REPO: 'STEPHANOS_SHARED_AGENT_WORKSPACE_PATH_INSIDE_REPOSITORY',
  UNSAFE: 'STEPHANOS_SHARED_AGENT_WORKSPACE_PATH_UNSAFE',
  NOT_DIRECTORY: 'STEPHANOS_SHARED_AGENT_WORKSPACE_PATH_NOT_DIRECTORY',
});
export const SHARED_WORKSPACE_RUNTIME_DIRECTORIES = Object.freeze([
  ...SHARED_WORKSPACE_DIRECTORIES,
  'goals',
  'capabilities',
]);
export const SHARED_WORKSPACE_NEXT_ACTION = 'Set STEPHANOS_SHARED_AGENT_WORKSPACE to an existing external Shared Agent Workspace directory, then restart Battle Bridge startup supervision.';
export const SHARED_WORKSPACE_BOOTSTRAP_COMMAND = `mkdir -p "$HOME/Documents/${DEFAULT_SHARED_WORKSPACE_DIRECTORY_NAME}"`;

const SECRET_PATH_RE = /(^|[\\/\.])(\.ssh|\.aws|\.azure|\.config|\.gnupg|keychains?|secrets?|credentials?|tokens?|sessions?|\.env)([\\/]|$)/i;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function isWithin(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

function defaultDocumentsRoot(env = process.env) {
  const home = text(env.USERPROFILE || env.HOME || homedir());
  return resolve(join(home, 'Documents', DEFAULT_SHARED_WORKSPACE_DIRECTORY_NAME));
}

function hasTraversal(raw) {
  return String(raw).split(/[\\/]+/).some((segment) => segment === '..');
}

function displayPath(root) {
  const home = resolve(homedir());
  const normalized = resolve(root);
  if (isWithin(home, normalized)) return `~${sep}${relative(home, normalized)}`;
  return normalized;
}

export function getDefaultSharedWorkspaceRoot(input = {}) {
  return defaultDocumentsRoot(input.env);
}

export function resolveSharedWorkspaceRuntimeConfig(input = {}) {
  const env = input.env || process.env;
  const repoRoot = resolve(input.repoRoot || process.cwd());
  const rawInput = text(input.root);
  const rawOverride = text(env[SHARED_WORKSPACE_ENV]);
  const source = rawInput ? 'input' : (rawOverride ? 'env' : 'default-documents');
  const rawRoot = rawInput || rawOverride || defaultDocumentsRoot(env);
  if (!rawRoot) return { ok: false, configured: false, source, reason: SHARED_WORKSPACE_BLOCKERS.UNCONFIGURED, workspaceRoot: 'UNKNOWN', safeDisplayPath: 'UNKNOWN', exactNextAction: SHARED_WORKSPACE_NEXT_ACTION };
  if (rawRoot.includes('\0') || /%[A-Z_]+%/i.test(rawRoot) || hasTraversal(rawRoot) || SECRET_PATH_RE.test(rawRoot)) {
    return { ok: false, configured: !!rawOverride, source, reason: SHARED_WORKSPACE_BLOCKERS.UNSAFE, workspaceRoot: 'UNKNOWN', safeDisplayPath: 'UNKNOWN', exactNextAction: SHARED_WORKSPACE_NEXT_ACTION };
  }
  const root = resolve(rawRoot);
  if (isWithin(repoRoot, root)) {
    return { ok: false, configured: !!rawOverride, source, reason: SHARED_WORKSPACE_BLOCKERS.INSIDE_REPO, workspaceRoot: 'UNKNOWN', safeDisplayPath: 'UNKNOWN', exactNextAction: SHARED_WORKSPACE_NEXT_ACTION };
  }
  return { ok: true, configured: true, source, reason: 'STEPHANOS_SHARED_AGENT_WORKSPACE_PATH_RESOLVED', root, workspaceRoot: root, safeDisplayPath: displayPath(root), exactNextAction: 'Keep Battle Bridge publisher, backend feed, and dashboard on this resolved Shared Agent Workspace path.' };
}

export async function validateExistingSharedWorkspaceRuntimeConfig(input = {}) {
  const resolved = resolveSharedWorkspaceRuntimeConfig(input);
  if (!resolved.ok) return resolved;
  try {
    const info = await stat(resolved.root);
    if (!info.isDirectory()) return { ...resolved, ok: false, reason: SHARED_WORKSPACE_BLOCKERS.NOT_DIRECTORY, workspaceRoot: 'UNKNOWN', exactNextAction: SHARED_WORKSPACE_NEXT_ACTION };
    return { ...resolved, reason: 'STEPHANOS_SHARED_AGENT_WORKSPACE_READY' };
  } catch (error) {
    const reason = resolved.source === 'default-documents' ? SHARED_WORKSPACE_BLOCKERS.UNCONFIGURED : SHARED_WORKSPACE_BLOCKERS.MISSING;
    return { ...resolved, ok: false, reason, missing: true, workspaceRoot: reason === SHARED_WORKSPACE_BLOCKERS.UNCONFIGURED ? 'UNKNOWN' : resolved.root, exactNextAction: SHARED_WORKSPACE_NEXT_ACTION, errorCode: error?.code || 'STAT_FAILED' };
  }
}

export async function bootstrapSharedWorkspaceRuntimeLayout(input = {}) {
  const resolved = resolveSharedWorkspaceRuntimeConfig(input);
  if (!resolved.ok) return { ok: false, reason: resolved.reason, created: [], exactNextAction: resolved.exactNextAction };
  const created = [];
  await mkdir(resolved.root, { recursive: true, mode: 0o700 });
  created.push(resolved.root);
  for (const directory of SHARED_WORKSPACE_RUNTIME_DIRECTORIES) {
    const child = resolve(resolved.root, directory);
    if (!isWithin(resolved.root, child)) return { ok: false, reason: SHARED_WORKSPACE_BLOCKERS.UNSAFE, created };
    await mkdir(child, { recursive: true, mode: 0o700 });
    created.push(child);
  }
  return { ok: true, reason: 'STEPHANOS_SHARED_AGENT_WORKSPACE_LAYOUT_READY', root: resolved.root, safeDisplayPath: resolved.safeDisplayPath, directories: [...SHARED_WORKSPACE_RUNTIME_DIRECTORIES], created };
}
