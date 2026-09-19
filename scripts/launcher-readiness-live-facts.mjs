#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createLauncherReadinessReport } from './launcher-readiness-report.mjs';

export const LAUNCHER_READINESS_LIVE_FACTS_SCHEMA = 'stephanos.launcher-readiness-live-facts.v1';

export const LIVE_FACT_SERVICES = Object.freeze({
  backend: Object.freeze({ id: 'backend', host: '127.0.0.1', port: 8787 }),
  'stephanos-ui': Object.freeze({ id: 'stephanos-ui', host: '127.0.0.1', port: 4173 }),
  'openclaw-gateway': Object.freeze({ id: 'openclaw-gateway', host: '127.0.0.1', port: 18789 }),
});

export const LIVE_COLLECTOR_AUTHORITY = Object.freeze({
  executesCommands: false,
  executesArbitraryShell: false,
  startsServices: false,
  killsProcesses: false,
  mergesOrPushes: false,
  mutatesRuntime: false,
  writesOutputOnlyWhenAsked: true,
});

const REPO_LOCAL_WORKSPACE_DIR = path.join('runtime-activity', 'shared-workspace');
const DEFAULT_WORKSPACE_CURRENT_DIR = path.join(REPO_LOCAL_WORKSPACE_DIR, 'current');
const DEFAULT_MAX_RECORD_AGE_MS = 5 * 60 * 1000;

function normalizeRepoRelativePath(value) {
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

function gitPorcelainLines(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function parseGitPorcelain(output) {
  return gitPorcelainLines(output)
    .map((line) => {
      const rawPath = line.slice(3).trim();
      const renamedPath = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() : rawPath;
      return normalizeRepoRelativePath(renamedPath);
    })
    .filter(Boolean);
}

function collectGitSourceFacts(repoRoot, execFile = execFileSync) {
  try {
    const output = execFile('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repoRoot, encoding: 'utf8' });
    return {
      // Preserve exact two-character porcelain status so downstream policy can
      // distinguish runtime-owned unstaged state from staged/deleted source.
      statusLines: gitPorcelainLines(output),
      dirtyPaths: parseGitPorcelain(output),
    };
  } catch (error) {
    return {
      statusLines: [],
      dirtyPaths: [`source-dirt-unknown: git status failed (${error.message})`],
    };
  }
}

function probeTcpService({ host, port }, timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (ready, detail) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ready, evidence: { host, port, probe: 'tcp-connect', detail } });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true, 'connected'));
    socket.once('timeout', () => finish(false, 'timeout'));
    socket.once('error', (error) => finish(false, error.code || error.message));
  });
}

async function collectServiceFacts({ serviceProbe = probeTcpService } = {}) {
  const entries = await Promise.all(Object.values(LIVE_FACT_SERVICES).map(async (service) => [service.id, await serviceProbe(service)]));
  return Object.fromEntries(entries);
}

function readWorkspaceRecord(filePath) {
  const stat = fs.statSync(filePath);
  let parsed = null;
  if (filePath.endsWith('.json')) {
    try { parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
  }
  return { path: filePath, mtimeMs: stat.mtimeMs, length: stat.size, parsed };
}

function isWindowsPlatform(platform = process.platform) {
  return platform === 'win32';
}

export function defaultWindowsSharedWorkspacePath({ home = process.env.USERPROFILE || process.env.HOME || os.homedir(), platform = process.platform } = {}) {
  if (!isWindowsPlatform(platform)) return null;
  if (!home || home.includes('\0')) return null;
  return path.join(home, 'Documents', 'Stephanos-openclaw-workspace');
}

function assertSafeSharedWorkspacePath(value, source) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Unsafe shared workspace path rejected from ${source}: empty path is not allowed.`);
  if (value.includes('\0')) throw new Error(`Unsafe shared workspace path rejected from ${source}: NUL byte is not allowed.`);
  if (!path.isAbsolute(value) && value.split(/[\\/]+/).includes('..')) throw new Error(`Unsafe shared workspace path rejected from ${source}: relative traversal is not allowed.`);
  return value.trim();
}

function resolveSharedWorkspaceRoot(repoRoot, { sharedWorkspace = null, env = process.env, platform = process.platform } = {}) {
  const candidates = [
    sharedWorkspace ? { source: 'cli-arg', value: sharedWorkspace, fallback: false } : null,
    env.STEPHANOS_SHARED_WORKSPACE ? { source: 'env:STEPHANOS_SHARED_WORKSPACE', value: env.STEPHANOS_SHARED_WORKSPACE, fallback: false } : null,
    env.STEPHANOS_OPENCLAW_WORKSPACE ? { source: 'env:STEPHANOS_OPENCLAW_WORKSPACE', value: env.STEPHANOS_OPENCLAW_WORKSPACE, fallback: false } : null,
    defaultWindowsSharedWorkspacePath({ home: env.USERPROFILE || env.HOME || os.homedir(), platform }) ? { source: 'windows-default', value: defaultWindowsSharedWorkspacePath({ home: env.USERPROFILE || env.HOME || os.homedir(), platform }), fallback: false } : null,
    { source: 'repo-local-fallback', value: path.join(repoRoot, REPO_LOCAL_WORKSPACE_DIR), fallback: true },
  ].filter(Boolean);
  const selected = candidates[0];
  const safeValue = assertSafeSharedWorkspacePath(selected.value, selected.source);
  const root = path.isAbsolute(safeValue) ? path.resolve(safeValue) : path.resolve(repoRoot, safeValue);
  return { root, source: selected.source, fallback: selected.fallback };
}

function recordStatus(record) {
  const status = record.parsed && typeof record.parsed === 'object' && !Array.isArray(record.parsed) ? record.parsed.status : undefined;
  return typeof status === 'string' ? status : null;
}

function workspaceEvidencePath(repoRoot, absolutePath) {
  const relativePath = path.relative(repoRoot, absolutePath);
  if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) return normalizeRepoRelativePath(relativePath);
  return absolutePath;
}

const BATTLE_BRIDGE_CURRENT_RECORD_PATHS = Object.freeze([
  path.join('status', 'battle-bridge-current.json'),
  path.join('proof', 'battle-bridge-current.json'),
  path.join('events', 'battle-bridge-current.json'),
]);

function currentRecordEvidence(repoRoot, absolutePath, record, now, maxRecordAgeMs) {
  const ageMs = Math.max(0, now - record.mtimeMs);
  const ageSeconds = Math.floor(ageMs / 1000);
  const status = recordStatus(record);
  return {
    path: workspaceEvidencePath(repoRoot, absolutePath),
    mtimeMs: record.mtimeMs,
    length: record.length,
    ageSeconds,
    status,
    stale: ageMs > maxRecordAgeMs,
    unknownStatus: status === 'UNKNOWN',
  };
}

function collectWorkspaceFacts(repoRoot, { now = Date.now(), maxRecordAgeMs = DEFAULT_MAX_RECORD_AGE_MS, workspaceCurrentDir = null, sharedWorkspace = null, env = process.env, platform = process.platform } = {}) {
  const resolvedWorkspace = workspaceCurrentDir
    ? { root: path.resolve(repoRoot, workspaceCurrentDir, '..'), source: 'legacy-current-dir-option', fallback: false, currentDir: path.resolve(repoRoot, workspaceCurrentDir) }
    : resolveSharedWorkspaceRoot(repoRoot, { sharedWorkspace, env, platform });
  const currentDir = resolvedWorkspace.currentDir || path.join(resolvedWorkspace.root, 'current');
  const battleBridgePaths = BATTLE_BRIDGE_CURRENT_RECORD_PATHS.map((relativePath) => path.join(resolvedWorkspace.root, relativePath));
  const checkedAbsolutePaths = [currentDir, ...battleBridgePaths];
  const checkedPaths = checkedAbsolutePaths.map((checkedPath) => workspaceEvidencePath(repoRoot, checkedPath));
  const foundRecords = [];
  const missingPaths = [];
  const staleRecords = [];

  if (fs.existsSync(currentDir)) {
    const currentEntries = fs.readdirSync(currentDir, { withFileTypes: true }).filter((entry) => entry.isFile());
    if (!currentEntries.length) missingPaths.push(`${workspaceEvidencePath(repoRoot, currentDir)} empty`);
    for (const entry of currentEntries) {
      const absolutePath = path.join(currentDir, entry.name);
      checkedAbsolutePaths.push(absolutePath);
      checkedPaths.push(workspaceEvidencePath(repoRoot, absolutePath));
      const record = readWorkspaceRecord(absolutePath);
      foundRecords.push(currentRecordEvidence(repoRoot, absolutePath, record, now, maxRecordAgeMs));
    }
  } else {
    missingPaths.push(`${workspaceEvidencePath(repoRoot, currentDir)} missing`);
  }

  for (const absolutePath of battleBridgePaths) {
    if (!fs.existsSync(absolutePath)) {
      missingPaths.push(`${workspaceEvidencePath(repoRoot, absolutePath)} missing`);
      continue;
    }
    const record = readWorkspaceRecord(absolutePath);
    foundRecords.push(currentRecordEvidence(repoRoot, absolutePath, record, now, maxRecordAgeMs));
  }

  for (const record of foundRecords) {
    if (record.stale) staleRecords.push(`${record.path} stale ageSeconds=${record.ageSeconds}`);
    if (record.unknownStatus) staleRecords.push(`${record.path} UNKNOWN ageSeconds=${record.ageSeconds}`);
  }

  if (!foundRecords.length) staleRecords.push(...missingPaths);

  const evidence = {
    currentDir: workspaceEvidencePath(repoRoot, currentDir),
    workspaceRoot: resolvedWorkspace.root,
    source: resolvedWorkspace.source,
    fallback: resolvedWorkspace.fallback,
    checkedPaths: [...new Set(checkedPaths)],
    foundRecords,
    missingPaths,
    records: foundRecords,
  };
  return { ready: foundRecords.length > 0 && staleRecords.length === 0, evidence, staleRecords };
}

export { resolveSharedWorkspaceRoot };

export async function collectLauncherReadinessLiveFacts(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const services = await collectServiceFacts(options);
  const workspace = collectWorkspaceFacts(repoRoot, options);
  const sourceFacts = collectGitSourceFacts(repoRoot, options.execFile);
  services['shared-workspace'] = { ready: workspace.ready, evidence: workspace.evidence };
  return {
    schema: LAUNCHER_READINESS_LIVE_FACTS_SCHEMA,
    observedFacts: { services, staleWorkspaceRecords: workspace.staleRecords, workspace: { staleRecords: workspace.staleRecords } },
    sourceFacts,
    authority: LIVE_COLLECTOR_AUTHORITY,
  };
}

function requireFlagValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

function parseArgs(argv) {
  const args = { pretty: true, report: false, output: null, sharedWorkspace: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') args.pretty = false;
    else if (argv[i] === '--report') args.report = true;
    else if (argv[i] === '--output') { args.output = requireFlagValue(argv, i, '--output'); i += 1; }
    else if (argv[i] === '--shared-workspace') { args.sharedWorkspace = requireFlagValue(argv, i, '--shared-workspace'); i += 1; }
    else if (argv[i] === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

function resolveSafeOutputPath(outputArg) {
  if (!outputArg) return null;
  if (outputArg.includes('\0')) throw new Error('Unsafe --output path rejected: NUL byte is not allowed.');
  const cwd = process.cwd();
  const resolvedPath = path.resolve(cwd, outputArg);
  const relativePath = path.relative(cwd, resolvedPath);
  if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) throw new Error('Unsafe --output path rejected: path must stay within the current workspace.');
  return resolvedPath;
}

export async function main(argv = process.argv.slice(2), stdout = process.stdout) {
  const args = parseArgs(argv);
  if (args.help) {
    stdout.write('Usage: node scripts/launcher-readiness-live-facts.mjs [--json] [--report] [--shared-workspace <path>] [--output <workspace-relative-path>]\n');
    return 0;
  }
  const facts = await collectLauncherReadinessLiveFacts({ sharedWorkspace: args.sharedWorkspace });
  const payload = args.report ? createLauncherReadinessReport(facts) : facts;
  const serialized = `${JSON.stringify(payload, null, args.pretty ? 2 : 0)}\n`;
  const outputPath = resolveSafeOutputPath(args.output);
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  } else {
    stdout.write(serialized);
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
