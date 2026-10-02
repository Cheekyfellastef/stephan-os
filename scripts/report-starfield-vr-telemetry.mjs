#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSharedWorkspaceEventRecord,
  renameAtomicJsonWithRetry,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceWriteAncestors,
  writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import { resolveSharedWorkspaceRuntimeConfig } from '../shared/agents/sharedWorkspaceRuntimeConfig.mjs';
import { buildStarfieldVrPerformanceRecommendations } from './starfield-vr-performance-recommendations.mjs';
import { buildStarfieldVrProjectPerformanceLoop } from './starfield-vr-project-performance-loop.mjs';

export const STARFIELD_VR_TELEMETRY_REPORT_SCHEMA = 'stephanos.starfield-vr-telemetry-report.v1';

function text(value = '') {
  return String(value ?? '').trim();
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

async function findLatestPerformanceCsv(sessionRoot) {
  let entries = [];
  try { entries = await readdir(sessionRoot, { withFileTypes: true }); } catch { return ''; }
  const candidates = entries
    .filter((entry) => entry.isFile() && /^starfield-vr-performance-.*\.csv$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  return candidates.length ? resolve(sessionRoot, candidates[0]) : '';
}

function normalizedIdentity(value = {}) {
  return {
    provider: text(value?.provider),
    profilePath: text(value?.profilePath),
    profileSha256: text(value?.profileSha256).toLowerCase(),
    launchSessionId: text(value?.launchSessionId),
    sourceHead: text(value?.sourceHead).toLowerCase(),
    telemetrySessionId: text(value?.telemetrySessionId),
  };
}

function identityConflict(a, b) {
  if (!a || !b) return false;
  for (const key of ['provider', 'profileSha256', 'launchSessionId', 'sourceHead', 'telemetrySessionId']) {
    if (a[key] && b[key] && a[key] !== b[key]) return true;
  }
  return false;
}

export function resolveStarfieldVrTelemetryRunIdentity({
  session = null,
  summary = null,
  launch = null,
  sessionId = 'none',
} = {}) {
  const allowedProviders = new Set(['mutar-openxr', 'vorpx']);
  const sessionIdentity = session?.routeIdentity ? normalizedIdentity(session.routeIdentity) : null;
  const summaryIdentity = summary?.routeIdentity ? normalizedIdentity(summary.routeIdentity) : null;
  const base = summaryIdentity || sessionIdentity;
  let conflict = identityConflict(sessionIdentity, summaryIdentity);

  const launchIdentity = launch?.routeIdentity ? normalizedIdentity(launch.routeIdentity) : null;
  const telemetryLaunchSessionId = text(base?.launchSessionId);
  const launchMatched = Boolean(
    launchIdentity &&
    telemetryLaunchSessionId &&
    launchIdentity.launchSessionId === telemetryLaunchSessionId
  );
  if (launchMatched && identityConflict(base, launchIdentity)) conflict = true;

  const provider = text(base?.provider);
  const telemetrySessionId = text(base?.telemetrySessionId || session?.sessionId || summary?.sessionId || sessionId);
  if (telemetrySessionId && sessionId !== 'none' && telemetrySessionId !== sessionId) conflict = true;

  const status = conflict
    ? 'PROVIDER_IDENTITY_CONFLICT'
    : allowedProviders.has(provider)
      ? 'VERIFIED_PROVIDER'
      : 'UNKNOWN_PROVIDER';

  return {
    status,
    provider: status === 'VERIFIED_PROVIDER' ? provider : 'UNKNOWN',
    profilePath: text(base?.profilePath),
    profileSha256: text(base?.profileSha256),
    launchSessionId: telemetryLaunchSessionId,
    sourceHead: text(base?.sourceHead),
    telemetrySessionId,
    launchReceiptMatched: launchMatched,
    providerSpecificRecommendationsAllowed: status === 'VERIFIED_PROVIDER',
  };
}

async function tailCsv(path, count = 20) {
  if (!path) return [];
  try {
    const raw = await readFile(path, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (lines.length <= 1) return lines;
    return [lines[0], ...lines.slice(-Math.max(1, count))];
  } catch {
    return [];
  }
}

function runDiagnosis({ repoRoot, workspaceRoot }) {
  const script = resolve(repoRoot, 'scripts', 'windows', 'read-starfield-vr-performance-diagnosis.ps1');
  const powershell = resolve(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(
    powershell,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-WorkspaceRoot', workspaceRoot],
    { encoding: 'utf8', windowsHide: true, timeout: 20_000, maxBuffer: 512 * 1024 },
  );
  if (result.error || Number(result.status) !== 0) {
    return {
      ok: false,
      error: text(result.error?.message || result.stderr || result.stdout || 'diagnosis-failed'),
      payload: null,
    };
  }
  try {
    return { ok: true, error: '', payload: JSON.parse(text(result.stdout)) };
  } catch {
    return { ok: false, error: 'diagnosis-json-unreadable', payload: null };
  }
}

async function writePacket({
  workspaceRoot,
  repoRoot,
  packet,
  segments = ['vr', 'performance', 'current.json'],
}) {
  const resolved = resolveSharedWorkspacePath({
    root: workspaceRoot,
    repoRoot,
    segments,
  });
  if (!resolved.ok) return { ok: false, reason: resolved.reason, path: '' };
  await mkdir(dirname(resolved.path), { recursive: true });
  const ancestors = await validateSharedWorkspaceWriteAncestors(resolved);
  if (!ancestors.ok) return { ok: false, reason: ancestors.reason, path: resolved.path };
  const temp = `${resolved.path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(packet, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    const recheck = await validateSharedWorkspaceWriteAncestors(resolved);
    if (!recheck.ok) throw new Error(recheck.reason);
    await renameAtomicJsonWithRetry(temp, resolved.path);
    return { ok: true, reason: 'STARFIELD_VR_TELEMETRY_PACKET_WRITTEN', path: resolved.path };
  } catch (error) {
    await unlink(temp).catch(() => {});
    return { ok: false, reason: text(error?.message || error), path: resolved.path };
  }
}

export async function reportStarfieldVrTelemetry({
  repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  env = process.env,
  now = new Date(),
} = {}) {
  const workspace = resolveSharedWorkspaceRuntimeConfig({ repoRoot, env });
  if (!workspace.ok) {
    return {
      schemaVersion: STARFIELD_VR_TELEMETRY_REPORT_SCHEMA,
      ok: false,
      verdict: 'STARFIELD_VR_TELEMETRY_REPORT_BLOCKED',
      reason: workspace.reason,
      sharedWorkspace: { ok: false, reason: workspace.reason },
    };
  }

  const workspaceRoot = workspace.root;
  const vrRoot = resolve(workspaceRoot, 'vr');
  const sessionRoot = resolve(vrRoot, 'starfield-vr-performance-sessions');
  const csvPath = await findLatestPerformanceCsv(sessionRoot);
  const summaryPath = csvPath ? csvPath.replace(/\.csv$/i, '.summary.json') : '';
  const sessionPath = csvPath ? csvPath.replace(/\.csv$/i, '.json') : '';
  const sessionId = csvPath ? basename(csvPath, '.csv') : 'none';
  const diagnosis = runDiagnosis({ repoRoot, workspaceRoot });
  const [summary, session, vrModeState, governor, providerSlot, launch, recentSampleCsv] = await Promise.all([
    summaryPath ? readJson(summaryPath) : null,
    sessionPath ? readJson(sessionPath) : null,
    readJson(resolve(vrRoot, 'vr-mode-state-current.json')),
    readJson(resolve(vrRoot, 'vr-resource-governor-current.json')),
    readJson(resolve(vrRoot, 'starfield-vr-provider-slot-current.json')),
    readJson(resolve(vrRoot, 'starfield-vr-launch-current.json')),
    tailCsv(csvPath, 20),
  ]);

  const generatedAtUtc = now.toISOString();
  const metrics = diagnosis.payload?.metrics || summary || {};
  const runIdentity = resolveStarfieldVrTelemetryRunIdentity({ session, summary, launch, sessionId });
  const recommendationPlan = await buildStarfieldVrPerformanceRecommendations({
    repoRoot,
    diagnosis: diagnosis.payload || {},
    provider: runIdentity.provider,
    runIdentity,
  });
  const projectPerformanceLoop = await buildStarfieldVrProjectPerformanceLoop({
    repoRoot,
    runIdentity,
    diagnosis: diagnosis.payload || {},
    metrics,
    recommendationPlan,
  });
  const packet = {
    schemaVersion: STARFIELD_VR_TELEMETRY_REPORT_SCHEMA,
    ok: diagnosis.ok && runIdentity.status === 'VERIFIED_PROVIDER',
    verdict: !diagnosis.ok
      ? 'STARFIELD_VR_TELEMETRY_REPORT_DEGRADED'
      : runIdentity.status === 'PROVIDER_IDENTITY_CONFLICT'
        ? 'STARFIELD_VR_TELEMETRY_PROVIDER_IDENTITY_CONFLICT'
        : runIdentity.status === 'UNKNOWN_PROVIDER'
          ? 'STARFIELD_VR_TELEMETRY_UNKNOWN_PROVIDER'
          : 'STARFIELD_VR_TELEMETRY_REPORT_READY',
    generatedAtUtc,
    sessionId,
    runIdentity,
    diagnosis: diagnosis.payload,
    diagnosisError: diagnosis.error,
    summary,
    recommendationPlan,
    projectPerformanceLoop,
    recentSampleCsv,
    state: {
      vrMode: vrModeState,
      governor,
      providerSlot,
      launch,
    },
    headline: {
      focus: text(diagnosis.payload?.focus || ''),
      provider: runIdentity.provider,
      providerIdentityStatus: runIdentity.status,
      launchSessionId: runIdentity.launchSessionId,
      sourceHead: runIdentity.sourceHead,
      telemetrySessionId: runIdentity.telemetrySessionId,
      signals: Array.isArray(diagnosis.payload?.signals) ? diagnosis.payload.signals : [],
      sessionOutcome: text(summary?.sessionOutcome || diagnosis.payload?.context?.sessionOutcome || ''),
      partialTelemetry: Boolean(summary?.partialTelemetry || diagnosis.payload?.context?.partialTelemetry),
      crashEvidenceCount: Number(diagnosis.payload?.context?.crashEvidenceCount) || 0,
      sampleCount: Number(metrics?.sampleCount) || 0,
      avgGpuUtilPct: metrics?.avgGpuUtilPct ?? null,
      maxGpuUtilPct: metrics?.maxGpuUtilPct ?? null,
      maxGpuMemoryPct: metrics?.maxGpuMemoryPct ?? null,
      avgStarfieldCpuPct: metrics?.avgStarfieldCpuPct ?? null,
      avgSystemCpuPct: metrics?.avgSystemCpuPct ?? null,
      maxLlamaServerCount: metrics?.maxLlamaServerCount ?? null,
      airLinkRuntimeSamplePct: metrics?.airLinkRuntimeSamplePct ?? null,
      minGameDriveFreeGiB: metrics?.minGameDriveFreeGiB ?? null,
      minGameDriveFreePct: metrics?.minGameDriveFreePct ?? null,
      avgGameDriveActivePct: metrics?.avgGameDriveActivePct ?? null,
      maxGameDriveLatencyMs: metrics?.maxGameDriveLatencyMs ?? null,
      maxGameDriveQueueLength: metrics?.maxGameDriveQueueLength ?? null,
      maxPagesPerSec: metrics?.maxPagesPerSec ?? null,
      storageTelemetryAvailable: metrics?.storageTelemetryAvailable ?? false,
      topRecommendation: recommendationPlan?.nextExperiment?.title ?? '',
      topRecommendationSource: recommendationPlan?.nextExperiment?.sourceLabel ?? '',
      projectLoopState: projectPerformanceLoop?.loopState ?? '',
      projectTelemetryGapCount: projectPerformanceLoop?.telemetryGapCount ?? null,
      projectNextExperiment: projectPerformanceLoop?.nextExperiment?.title ?? '',
    },
    authority: {
      readOnlySourceInspection: true,
      writesSharedWorkspaceTelemetryPacket: true,
      launchesGame: false,
      changesGraphicsSettings: false,
      killsProcesses: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
    },
  };

  const packetWrite = await writePacket({\n    workspaceRoot,\n    repoRoot,\n    packet,\n    segments: ['vr', 'performance', 'current.json'],\n  });
  const loopWrite = await writePacket({
    workspaceRoot,
    repoRoot,
    packet: projectPerformanceLoop,
    segments: ['vr', 'performance', 'loop-current.json'],
  });
  const event = createSharedWorkspaceEventRecord({
    eventId: 'starfield-vr-performance-current',
    participantId: 'stephanos',
    timestampUtc: generatedAtUtc,
    eventKind: 'vr-performance-telemetry',
    summary: `Starfield VR telemetry session ${sessionId}: provider ${packet.headline.provider}/${packet.headline.providerIdentityStatus}; outcome ${packet.headline.sessionOutcome || 'UNKNOWN'}${packet.headline.partialTelemetry ? ' partial' : ''}; crash evidence ${packet.headline.crashEvidenceCount}; focus ${packet.headline.focus || 'UNCLASSIFIED'}; project loop ${packet.headline.projectLoopState || 'unknown'} with ${packet.headline.projectTelemetryGapCount ?? 'n/a'} telemetry gaps; next ${packet.headline.projectNextExperiment || 'none'}; GPU ${packet.headline.avgGpuUtilPct ?? 'n/a'}% avg; VRAM ${packet.headline.maxGpuMemoryPct ?? 'n/a'}% max; drive free ${packet.headline.minGameDriveFreeGiB ?? 'n/a'} GiB/${packet.headline.minGameDriveFreePct ?? 'n/a'}%; disk active ${packet.headline.avgGameDriveActivePct ?? 'n/a'}% avg; top technique ${packet.headline.topRecommendation || 'none'} (${packet.headline.topRecommendationSource || 'no source'}); local AI processes ${packet.headline.maxLlamaServerCount ?? 'n/a'} max.`,
  });
  const eventWrite = await writeAtomicJson(
    workspaceRoot,
    ['events', 'starfield-vr-performance-current.json'],
    event,
    { repoRoot, nowMs: now.getTime() },
  );

  return {
    ...packet,
    sharedWorkspace: {
      root: workspaceRoot,
      packetRef: 'workspace:vr/performance/current.json',
      loopRef: 'workspace:vr/performance/loop-current.json',
      eventRef: 'workspace:events/starfield-vr-performance-current.json',
      packetWrite,
      loopWrite,
      eventWrite,
    },
    finalVerdict: packetWrite.ok && loopWrite.ok && eventWrite.ok
      ? 'STARFIELD_VR_TELEMETRY_REPORT_PUBLISHED'
      : 'STARFIELD_VR_TELEMETRY_REPORT_DEGRADED',
  };
}

export async function main(stdout = process.stdout) {
  const result = await reportStarfieldVrTelemetry();
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok && result.sharedWorkspace?.packetWrite?.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(); }
  catch (error) {
    process.stderr.write(`${text(error?.stack || error?.message || error)}\n`);
    process.exitCode = 1;
  }
}
