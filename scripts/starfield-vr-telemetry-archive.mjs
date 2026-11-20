#!/usr/bin/env node
/**
 * Read-only Starfield VR flight-recorder archive for Sovereign Commander.
 * Never publishes, modifies source/runtime state, or returns raw CSV/host paths.
 * Rebuilds its view from original session files, even if the headline/history
 * publisher stopped before generating its last canonical packet.
 */
import { lstat, readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSharedWorkspaceRuntimeConfig } from '../shared/agents/sharedWorkspaceRuntimeConfig.mjs';

export const STARFIELD_VR_TELEMETRY_ARCHIVE_SCHEMA = 'stephanos.starfield-vr-telemetry-archive.v1';
export const STARFIELD_VR_TELEMETRY_ARCHIVE_MARKER = 'STARFIELD_VR_TELEMETRY_ARCHIVE_RESULT=';
const SESSION_NAME = /^starfield-vr-performance-[A-Za-z0-9_-]{8,96}$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const SHA40 = /^[a-f0-9]{40}$/i;
const SAFE_TOKEN = /^[A-Za-z0-9._:-]{1,120}$/;
const MAX_SESSION_BYTES = 256 * 1024;
const PAGE_MAX = 12;

function safeCount(value, max = 1_000_000_000) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 && n <= max ? n : null;
}
function safeMetric(value, max = 1_000_000) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : null;
}
function safeToken(value) {
  const s = typeof value === 'string' ? value.trim() : '';
  return SAFE_TOKEN.test(s) ? s : '';
}
function iso(value) {
  if (typeof value !== 'string' || value.length > 60) return '';
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : '';
}
async function optionalJson(root, name, available) {
  // Path is constructed exclusively from validated locally enumerated basenames.
  if (!available) return null;
  try {
    const candidate = resolve(root, name);
    const info = await lstat(candidate);
    if (!info.isFile() || info.size > MAX_SESSION_BYTES) return null;
    const value = await readFile(candidate, 'utf8');
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}
function identity(summary, session) {
  const route = summary?.routeIdentity || session?.routeIdentity || {};
  const provider = route.provider === 'mutar-openxr' || route.provider === 'vorpx'
    ? route.provider : 'UNKNOWN';
  const head = typeof route.sourceHead === 'string' ? route.sourceHead.toLowerCase() : '';
  const fingerprint = typeof summary?.configurationFingerprint?.sha256 === 'string'
    ? summary.configurationFingerprint.sha256.toLowerCase() : '';
  return {
    provider,
    sourceHead: SHA40.test(head) ? head : '',
    launchSessionId: safeToken(route.launchSessionId),
    configurationFingerprintSha256: SHA256.test(fingerprint) ? fingerprint : '',
  };
}

export async function readStarfieldVrTelemetryArchive({
  workspaceRoot = resolve(homedir(), 'Documents', 'Stephanos-openclaw-workspace'),
  offset = 0,
  limit = 12,
  now = new Date(),
} = {}) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000
    || !Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_MAX) {
    throw new Error('STARFIELD_VR_ARCHIVE_PAGE_INVALID');
  }
  const vrRoot = resolve(workspaceRoot, 'vr');
  const sessionRoot = resolve(vrRoot, 'starfield-vr-performance-sessions');
  // Deny path redirection through a symlinked workspace or VR archive directory.
  for (const ancestor of [workspaceRoot, vrRoot, sessionRoot]) {
    try {
      const info = await lstat(ancestor);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error('STARFIELD_VR_ARCHIVE_DIRECTORY_UNSAFE');
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  let entries = [];
  let directoryAvailable = true;
  try { entries = await readdir(sessionRoot, { withFileTypes: true }); }
  catch (error) {
    if (error?.code === 'ENOENT') directoryAvailable = false;
    else throw new Error('STARFIELD_VR_ARCHIVE_DIRECTORY_UNREADABLE');
  }
  const available = new Map();
  for (const entry of entries) {
    if (!entry.isFile()) continue; // do not traverse folders or symlinks
    const name = entry.name;
    const base = name.endsWith('.summary.json')
      ? name.slice(0, -'.summary.json'.length)
      : name.endsWith('.csv')
        ? name.slice(0, -'.csv'.length)
        : name.endsWith('.json')
          ? name.slice(0, -'.json'.length)
          : '';
    if (!SESSION_NAME.test(base)) continue;
    const current = available.get(base) || { csv: false, summary: false, session: false };
    if (name === base + '.csv') current.csv = true;
    if (name === base + '.summary.json') current.summary = true;
    if (name === base + '.json') current.session = true;
    available.set(base, current);
  }
  const ids = [...available.keys()].sort().reverse();
  const selected = ids.slice(offset, offset + limit);
  const sessions = await Promise.all(selected.map(async (sessionId) => {
    const found = available.get(sessionId);
    const [summary, session] = await Promise.all([
      optionalJson(sessionRoot, sessionId + '.summary.json', found.summary),
      optionalJson(sessionRoot, sessionId + '.json', found.session),
    ]);
    const route = identity(summary, session);
    const count = safeCount(summary?.sampleCount ?? session?.lifecycle?.sampleCount);
    const outcome = safeToken(summary?.sessionOutcome || session?.lifecycle?.status);
    return {
      sessionId,
      endedAtUtc: iso(summary?.endedAtUtc || ''),
      enteredAtUtc: iso(session?.enteredAtUtc || session?.startedAtUtc || ''),
      ...route,
      sessionOutcome: outcome || 'UNKNOWN',
      sampleCount: count,
      partialTelemetry: summary?.partialTelemetry === true || !found.csv || !found.summary,
      csvPresent: found.csv,
      summaryPresent: found.summary && summary !== null,
      sessionReceiptPresent: found.session && session !== null,
      avgApplicationFrameTimeMs: safeMetric(summary?.avgApplicationFrameTimeMs),
      p95ApplicationFrameTimeMs: safeMetric(summary?.p95ApplicationFrameTimeMs),
      p99ApplicationFrameTimeMs: safeMetric(summary?.p99ApplicationFrameTimeMs),
      avgDeliveredCadenceHz: safeMetric(summary?.avgDeliveredCadenceHz, 1000),
      headsetRefreshRateHz: safeMetric(summary?.headsetRefreshRateHz, 1000),
      maxEyePresentationSkewMs: safeMetric(summary?.maxEyePresentationSkewMs),
      maxPoseAgeMs: safeMetric(summary?.maxPoseAgeMs),
      avgGpuUtilPct: safeMetric(summary?.avgGpuUtilPct, 100),
      avgSystemCpuPct: safeMetric(summary?.avgSystemCpuPct, 100),
      maxLlamaServerCount: safeCount(summary?.maxLlamaServerCount, 10000),
      telemetryMissingCount: Array.isArray(summary?.telemetryCompleteness?.missing)
        ? safeCount(summary.telemetryCompleteness.missing.length, 1000) : null,
      crashEvidenceCount: Array.isArray(summary?.crashEvidence)
        ? safeCount(summary.crashEvidence.length, 1000) : null,
    };
  }));
  const nextOffset = offset + sessions.length;
  return {
    schemaVersion: STARFIELD_VR_TELEMETRY_ARCHIVE_SCHEMA,
    ok: true,
    generatedAtUtc: now.toISOString(),
    directoryAvailable,
    totalSessions: ids.length,
    newestSessionId: ids[0] || '',
    offset,
    limit,
    nextOffset: nextOffset < ids.length ? nextOffset : null,
    hasMore: nextOffset < ids.length,
    sessions,
    readOnly: true,
    sourceMutationAllowed: false,
    rawTelemetryReturned: false,
    hostPathsReturned: false,
    secretMaterialReturned: false,
    arbitraryShellAllowed: false,
    unknownMeansGreen: false,
    finalVerdict: ids.length ? 'STARFIELD_VR_TELEMETRY_ARCHIVE_READY' : 'STARFIELD_VR_TELEMETRY_ARCHIVE_NO_SESSIONS',
  };
}
function readOptions(args) {
  const value = (flag, fallback) => {
    const at = args.indexOf(flag);
    if (at < 0) return fallback;
    if (at + 1 >= args.length || !/^\d{1,7}$/.test(args[at + 1])) throw new Error('STARFIELD_VR_ARCHIVE_PAGE_INVALID');
    return Number(args[at + 1]);
  };
  return { offset: value('--offset', 0), limit: value('--limit', 12) };
}
export async function main({ argv = process.argv.slice(2), env = process.env, stdout = process.stdout } = {}) {
  const options = readOptions(argv);
  const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const workspace = resolveSharedWorkspaceRuntimeConfig({ repoRoot, env });
  if (!workspace.ok) {
    stdout.write(STARFIELD_VR_TELEMETRY_ARCHIVE_MARKER + JSON.stringify({
      schemaVersion: STARFIELD_VR_TELEMETRY_ARCHIVE_SCHEMA,
      ok: false, blocker: 'WORKSPACE_NOT_AVAILABLE',
      readOnly: true, sourceMutationAllowed: false,
      rawTelemetryReturned: false, hostPathsReturned: false, secretMaterialReturned: false,
      arbitraryShellAllowed: false, unknownMeansGreen: false,
      finalVerdict: 'STARFIELD_VR_TELEMETRY_ARCHIVE_BLOCKED',
    }) + '\n');
    return 1;
  }
  const result = await readStarfieldVrTelemetryArchive({ ...options, workspaceRoot: workspace.root });
  stdout.write(STARFIELD_VR_TELEMETRY_ARCHIVE_MARKER + JSON.stringify(result) + '\n');
  return 0;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(); }
  catch (error) {
    process.stderr.write('STARFIELD_VR_ARCHIVE_ERROR:' + (error?.message === 'STARFIELD_VR_ARCHIVE_PAGE_INVALID'
      ? 'STARFIELD_VR_ARCHIVE_PAGE_INVALID' : 'ARCHIVE_READ_FAILED') + '\n');
    process.exitCode = 1;
  }
}
