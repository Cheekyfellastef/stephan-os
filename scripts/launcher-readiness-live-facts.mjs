#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';
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
  executesArbitraryShell: false,
  startsServices: false,
  killsProcesses: false,
  mutatesRuntime: false,
  writesOutputOnlyWhenAsked: true,
});

const DEFAULT_WORKSPACE_CURRENT_DIR = path.join('runtime-activity', 'shared-workspace', 'current');
const DEFAULT_MAX_RECORD_AGE_MS = 5 * 60 * 1000;

function normalizeRepoRelativePath(value) {
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

function parseGitPorcelain(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const rawPath = line.slice(3).trim();
      const renamedPath = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() : rawPath;
      return normalizeRepoRelativePath(renamedPath);
    })
    .filter(Boolean);
}

function collectGitDirtyPaths(repoRoot, execFile = execFileSync) {
  try {
    const output = execFile('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repoRoot, encoding: 'utf8' });
    return parseGitPorcelain(output);
  } catch (error) {
    return [`source-dirt-unknown: git status failed (${error.message})`];
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
  return { path: normalizeRepoRelativePath(filePath), mtimeMs: stat.mtimeMs, length: stat.size, parsed };
}

function recordLooksUnknown(record) {
  const text = JSON.stringify(record.parsed ?? {});
  return /UNKNOWN|STALE|blocked|error/i.test(text);
}

function collectWorkspaceFacts(repoRoot, { now = Date.now(), maxRecordAgeMs = DEFAULT_MAX_RECORD_AGE_MS, workspaceCurrentDir = DEFAULT_WORKSPACE_CURRENT_DIR } = {}) {
  const currentDir = path.resolve(repoRoot, workspaceCurrentDir);
  const staleRecords = [];
  const records = [];
  if (!fs.existsSync(currentDir)) {
    return { ready: false, evidence: { currentDir: workspaceCurrentDir, records: [] }, staleRecords: [`${workspaceCurrentDir} missing`] };
  }
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const absolutePath = path.join(currentDir, entry.name);
    const record = readWorkspaceRecord(absolutePath);
    const relativePath = normalizeRepoRelativePath(path.relative(repoRoot, absolutePath));
    records.push({ ...record, path: relativePath });
    if ((now - record.mtimeMs) > maxRecordAgeMs) staleRecords.push(`${relativePath} stale`);
    if (recordLooksUnknown(record)) staleRecords.push(`${relativePath} UNKNOWN`);
  }
  if (!records.length) staleRecords.push(`${workspaceCurrentDir} empty`);
  return { ready: staleRecords.length === 0, evidence: { currentDir: workspaceCurrentDir, records }, staleRecords };
}

export async function collectLauncherReadinessLiveFacts(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const services = await collectServiceFacts(options);
  const workspace = collectWorkspaceFacts(repoRoot, options);
  services['shared-workspace'] = { ready: workspace.ready, evidence: workspace.evidence };
  return {
    schema: LAUNCHER_READINESS_LIVE_FACTS_SCHEMA,
    observedFacts: { services, staleWorkspaceRecords: workspace.staleRecords, workspace: { staleRecords: workspace.staleRecords } },
    sourceFacts: { dirtyPaths: collectGitDirtyPaths(repoRoot, options.execFile) },
    authority: LIVE_COLLECTOR_AUTHORITY,
  };
}

function requireFlagValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

function parseArgs(argv) {
  const args = { pretty: true, report: false, output: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') args.pretty = false;
    else if (argv[i] === '--report') args.report = true;
    else if (argv[i] === '--output') { args.output = requireFlagValue(argv, i, '--output'); i += 1; }
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
    stdout.write('Usage: node scripts/launcher-readiness-live-facts.mjs [--json] [--report] [--output <workspace-relative-path>]\n');
    return 0;
  }
  const facts = await collectLauncherReadinessLiveFacts();
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
