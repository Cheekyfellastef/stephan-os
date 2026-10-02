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
export const STARFIELD_VR_TELEMETRY_HISTORY_SCHEMA = 'stephanos.starfield-vr-telemetry-history-index.v1';
export const STARFIELD_VR_TELEMETRY_HEADLINE_SCHEMA = 'stephanos.starfield-vr-telemetry-headline.v1';
export const STARFIELD_VR_TELEMETRY_HEADLINE_MARKER = 'STARFIELD_VR_TELEMETRY_HEADLINE_RESULT=';
export const STARFIELD_VR_PHYSICAL_VERDICT_SCHEMA = 'stephanos.starfield-vr-physical-verdict.v1';
export const STARFIELD_VR_PHYSICAL_VERDICT_SOURCE = 'OPERATOR_ONE_CLICK_POST_RUN';

const PHYSICAL_ACCEPTANCE_BY_VERDICT = Object.freeze({
  SMOOTH_COMFORTABLE: 'ACCEPTED_THIS_RUN',
  JUDDER_LOW_FPS: 'REJECTED_THIS_RUN',
  STEREO_BREAKUP: 'REJECTED_THIS_RUN',
  STRETCHING_DISTORTION: 'REJECTED_THIS_RUN',
  PARTICLE_ARTEFACTS: 'REJECTED_THIS_RUN',
  NAUSEA_DISCOMFORT: 'REJECTED_THIS_RUN',
  CRASH_OR_UNUSABLE: 'REJECTED_THIS_RUN',
  UNRECORDED: 'UNRECORDED',
  UNRECORDED_TIMEOUT: 'UNRECORDED',
});
const MAX_PHYSICAL_VERDICT_DELAY_MS = 10 * 60 * 1000;
const MAX_PHYSICAL_VERDICT_FUTURE_SKEW_MS = 30 * 1000;

function text(value = '') {
  return String(value ?? '').trim();
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

export function validateStarfieldVrPhysicalVerdict(candidate, {
  sessionId = '',
  endedAtUtc = '',
  now = new Date(),
} = {}) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { valid: false, reason: 'PHYSICAL_VERDICT_MISSING', verdict: null };
  }
  if (text(candidate.schemaVersion) !== STARFIELD_VR_PHYSICAL_VERDICT_SCHEMA) {
    return { valid: false, reason: 'PHYSICAL_VERDICT_SCHEMA_INVALID', verdict: null };
  }
  if (text(candidate.source) !== STARFIELD_VR_PHYSICAL_VERDICT_SOURCE || candidate.inferred !== false) {
    return { valid: false, reason: 'PHYSICAL_VERDICT_PROVENANCE_INVALID', verdict: null };
  }
  if (!sessionId || text(candidate.sessionId) !== text(sessionId)) {
    return { valid: false, reason: 'PHYSICAL_VERDICT_SESSION_MISMATCH', verdict: null };
  }
  const primaryVerdict = text(candidate.primaryVerdict);
  const physicalAcceptance = text(candidate.physicalAcceptance);
  if (!Object.hasOwn(PHYSICAL_ACCEPTANCE_BY_VERDICT, primaryVerdict)
      || PHYSICAL_ACCEPTANCE_BY_VERDICT[primaryVerdict] !== physicalAcceptance) {
    return { valid: false, reason: 'PHYSICAL_VERDICT_VALUE_INVALID', verdict: null };
  }

  const recordedAtMs = Date.parse(text(candidate.recordedAtUtc));
  const endedAtMs = Date.parse(text(endedAtUtc));
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(text(now));
  if (!Number.isFinite(recordedAtMs) || !Number.isFinite(endedAtMs) || !Number.isFinite(nowMs)) {
    return { valid: false, reason: 'PHYSICAL_VERDICT_TIME_INVALID', verdict: null };
  }
  if (recordedAtMs < endedAtMs
      || recordedAtMs - endedAtMs > MAX_PHYSICAL_VERDICT_DELAY_MS
      || recordedAtMs - nowMs > MAX_PHYSICAL_VERDICT_FUTURE_SKEW_MS) {
    return { valid: false, reason: 'PHYSICAL_VERDICT_TIME_UNBOUND', verdict: null };
  }
  return { valid: true, reason: 'PHYSICAL_VERDICT_OPERATOR_BOUND', verdict: candidate };
}

async function listPerformanceCsvs(sessionRoot) {
  let entries = [];
  try { entries = await readdir(sessionRoot, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((entry) => entry.isFile() && /^starfield-vr-performance-.*\.csv$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
}

async function findLatestPerformanceCsv(sessionRoot) {
  const candidates = await listPerformanceCsvs(sessionRoot);
  return candidates.length ? resolve(sessionRoot, candidates[0]) : '';
}

async function buildHistoryIndex({ sessionRoot, generatedAtUtc }) {
  const csvNames = await listPerformanceCsvs(sessionRoot);
  const sessions = [];
  for (const csvName of csvNames) {
    const sessionId = basename(csvName, '.csv');
    const csvPath = resolve(sessionRoot, csvName);
    const summaryPath = csvPath.replace(/\.csv$/i, '.summary.json');
    const sessionPath = csvPath.replace(/\.csv$/i, '.json');
    const [summary, session] = await Promise.all([readJson(summaryPath), readJson(sessionPath)]);
    const routeIdentity = normalizedIdentity(summary?.routeIdentity || session?.routeIdentity || {});
    const metrics = summary && typeof summary === 'object' ? summary : {};
    sessions.push({
      sessionId,
      generatedAtUtc: text(summary?.endedAtUtc || session?.enteredAtUtc),
      provider: text(routeIdentity.provider || 'UNKNOWN'),
      providerIdentityStatus: ['mutar-openxr', 'vorpx'].includes(text(routeIdentity.provider))
        ? 'VERIFIED_PROVIDER'
        : 'UNKNOWN_PROVIDER',
      launchSessionId: text(routeIdentity.launchSessionId),
      sourceHead: text(routeIdentity.sourceHead),
      sessionOutcome: text(summary?.sessionOutcome || session?.lifecycle?.status),
      partialTelemetry: Boolean(summary?.partialTelemetry),
      sampleCount: Number(metrics?.sampleCount || session?.lifecycle?.sampleCount || 0),
      avgGpuUtilPct: metrics?.avgGpuUtilPct ?? null,
      maxGpuUtilPct: metrics?.maxGpuUtilPct ?? null,
      maxGpuMemoryPct: metrics?.maxGpuMemoryPct ?? null,
      avgSystemCpuPct: metrics?.avgSystemCpuPct ?? null,
      minSystemFreeMemoryMiB: metrics?.minSystemFreeMemoryMiB ?? null,
      airLinkRuntimeSamplePct: metrics?.airLinkRuntimeSamplePct ?? null,
      maxLlamaServerCount: metrics?.maxLlamaServerCount ?? null,
      minGameDriveFreeGiB: metrics?.minGameDriveFreeGiB ?? null,
      minGameDriveFreePct: metrics?.minGameDriveFreePct ?? null,
      maxGameDriveLatencyMs: metrics?.maxGameDriveLatencyMs ?? null,
      maxGameDriveQueueLength: metrics?.maxGameDriveQueueLength ?? null,
      maxPagesPerSec: metrics?.maxPagesPerSec ?? null,
      avgApplicationFrameTimeMs: metrics?.avgApplicationFrameTimeMs ?? null,
      p95ApplicationFrameTimeMs: metrics?.p95ApplicationFrameTimeMs ?? null,
      p99ApplicationFrameTimeMs: metrics?.p99ApplicationFrameTimeMs ?? null,
      avgDeliveredCadenceHz: metrics?.avgDeliveredCadenceHz ?? null,
      headsetRefreshRateHz: metrics?.headsetRefreshRateHz ?? null,
      maxEyePresentationSkewMs: metrics?.maxEyePresentationSkewMs ?? null,
      maxPoseAgeMs: metrics?.maxPoseAgeMs ?? null,
      avgNetworkLatencyMs: metrics?.avgNetworkLatencyMs ?? null,
      maxPacketLossPct: metrics?.maxPacketLossPct ?? null,
      maxJitterMs: metrics?.maxJitterMs ?? null,
      controllerProblemSampleCount: metrics?.controllerProblemSampleCount ?? null,
      adaptiveCaptureSampleCount: metrics?.adaptiveCaptureSampleCount ?? null,
      configurationFingerprintSha256: text(summary?.configurationFingerprint?.sha256),
      telemetryMissing: Array.isArray(summary?.telemetryCompleteness?.missing)
        ? summary.telemetryCompleteness.missing
        : [],
      crashEvidenceCount: Array.isArray(summary?.crashEvidence) ? summary.crashEvidence.length : 0,
      crashFingerprints: Array.isArray(summary?.crashEvidence)
        ? [...new Set(summary.crashEvidence.map((item) => text(item?.crashFingerprint)).filter(Boolean))]
        : [],
      rawTelemetryRef: `workspace:vr/starfield-vr-performance-sessions/${csvName}`,
      sessionRef: `workspace:vr/starfield-vr-performance-sessions/${sessionId}.json`,
      summaryRef: `workspace:vr/starfield-vr-performance-sessions/${sessionId}.summary.json`,
    });
  }
  return {
    schemaVersion: STARFIELD_VR_TELEMETRY_HISTORY_SCHEMA,
    generatedAtUtc,
    sessionCount: sessions.length,
    newestSessionId: sessions[0]?.sessionId || '',
    rawTelemetryAlreadyCanonicalInSharedWorkspace: true,
    sessions,
    authority: {
      readOnlyIndex: true,
      rawTelemetryMutationAllowed: false,
      sourceMutationAllowed: false,
      mergeAuthority: false,
    },
  };
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
  const [summary, session, vrModeState, governor, providerSlot, launch, recentSampleCsv, physicalVerdictCandidate] = await Promise.all([
    summaryPath ? readJson(summaryPath) : null,
    sessionPath ? readJson(sessionPath) : null,
    readJson(resolve(vrRoot, 'vr-mode-state-current.json')),
    readJson(resolve(vrRoot, 'vr-resource-governor-current.json')),
    readJson(resolve(vrRoot, 'starfield-vr-provider-slot-current.json')),
    readJson(resolve(vrRoot, 'starfield-vr-launch-current.json')),
    tailCsv(csvPath, 20),
    readJson(resolve(vrRoot, 'starfield-vr-physical-verdict-current.json')),
  ]);

  const physicalVerdictValidation = validateStarfieldVrPhysicalVerdict(physicalVerdictCandidate, {
    sessionId,
    endedAtUtc: summary?.endedAtUtc,
    now,
  });
  const physicalVerdict = physicalVerdictValidation.verdict;
  const generatedAtUtc = now.toISOString();
  const historyIndex = await buildHistoryIndex({ sessionRoot, generatedAtUtc });
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
    physicalVerdict,
    physicalVerdictValidation: {
      valid: physicalVerdictValidation.valid,
      reason: physicalVerdictValidation.reason,
    },
    history: {
      sessionCount: historyIndex.sessionCount,
      newestSessionId: historyIndex.newestSessionId,
      historyIndexRef: 'workspace:vr/performance/history-index.json',
      rawTelemetryAlreadyCanonicalInSharedWorkspace: true,
    },
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
      frameTimeTelemetryAvailable: metrics?.frameTimeTelemetryAvailable ?? false,
      avgApplicationFrameTimeMs: metrics?.avgApplicationFrameTimeMs ?? null,
      p95ApplicationFrameTimeMs: metrics?.p95ApplicationFrameTimeMs ?? null,
      p99ApplicationFrameTimeMs: metrics?.p99ApplicationFrameTimeMs ?? null,
      avgDeliveredCadenceHz: metrics?.avgDeliveredCadenceHz ?? null,
      headsetRefreshRateHz: metrics?.headsetRefreshRateHz ?? null,
      maxEyePresentationSkewMs: metrics?.maxEyePresentationSkewMs ?? null,
      maxPoseAgeMs: metrics?.maxPoseAgeMs ?? null,
      avgEncodeLatencyMs: metrics?.avgEncodeLatencyMs ?? null,
      avgNetworkLatencyMs: metrics?.avgNetworkLatencyMs ?? null,
      avgDecodeLatencyMs: metrics?.avgDecodeLatencyMs ?? null,
      avgAirLinkBitrateMbps: metrics?.avgAirLinkBitrateMbps ?? null,
      maxPacketLossPct: metrics?.maxPacketLossPct ?? null,
      maxJitterMs: metrics?.maxJitterMs ?? null,
      maxControllerProblemCount: metrics?.maxControllerProblemCount ?? null,
      adaptiveCaptureSampleCount: metrics?.adaptiveCaptureSampleCount ?? null,
      configurationFingerprintSha256: text(summary?.configurationFingerprint?.sha256),
      telemetryCompleteness: summary?.telemetryCompleteness ?? diagnosis.payload?.context?.telemetryCompleteness ?? null,
      skyrimBaselineComparison: text(diagnosis.payload?.context?.skyrimBaselineComparison || ''),
      crashFingerprints: Array.isArray(diagnosis.payload?.context?.crashFingerprints)
        ? diagnosis.payload.context.crashFingerprints
        : [],
      physicalVerdict: text(physicalVerdict?.primaryVerdict || ''),
      physicalAcceptance: text(physicalVerdict?.physicalAcceptance || 'UNRECORDED'),
      physicalVerdictInferred: Boolean(physicalVerdict?.inferred),
      physicalVerdictStatus: physicalVerdictValidation.reason,
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

  const packetWrite = await writePacket({
    workspaceRoot,
    repoRoot,
    packet,
    segments: ['vr', 'performance', 'current.json'],
  });
  const loopWrite = await writePacket({
    workspaceRoot,
    repoRoot,
    packet: projectPerformanceLoop,
    segments: ['vr', 'performance', 'loop-current.json'],
  });
  const historyWrite = await writePacket({
    workspaceRoot,
    repoRoot,
    packet: historyIndex,
    segments: ['vr', 'performance', 'history-index.json'],
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
      historyIndexRef: 'workspace:vr/performance/history-index.json',
      packetWrite,
      loopWrite,
      historyWrite,
      eventWrite,
    },
    finalVerdict: packetWrite.ok && loopWrite.ok && historyWrite.ok && eventWrite.ok
      ? 'STARFIELD_VR_TELEMETRY_REPORT_PUBLISHED'
      : 'STARFIELD_VR_TELEMETRY_REPORT_DEGRADED',
  };
}

export function buildStarfieldVrTelemetryHeadlineProjection(result = {}) {
  const headline = result?.headline && typeof result.headline === 'object' ? result.headline : {};
  const history = result?.history && typeof result.history === 'object' ? result.history : {};
  const shared = result?.sharedWorkspace && typeof result.sharedWorkspace === 'object' ? result.sharedWorkspace : {};
  const safeText = (value, max = 160) => text(value).replace(/[\r\n\t]/g, ' ').slice(0, max);
  const safeCount = (value, max = 1_000_000) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 && number <= max ? number : null;
  };
  const safeMetric = (value, min = 0, max = 1_000_000) => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max
      ? Math.round(number * 100) / 100
      : null;
  };
  const safeSignals = (items) => Object.freeze(
    (Array.isArray(items) ? items : [])
      .map((item) => safeText(item, 120))
      .filter((item) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(item))
      .slice(0, 32),
  );
  const sourceHead = safeText(headline.sourceHead, 40).toLowerCase();
  const generatedAtUtc = safeText(result.generatedAtUtc, 40);
  const published = shared?.packetWrite?.ok === true
    && shared?.loopWrite?.ok === true
    && shared?.historyWrite?.ok === true
    && shared?.eventWrite?.ok === true;
  return Object.freeze({
    schemaVersion: STARFIELD_VR_TELEMETRY_HEADLINE_SCHEMA,
    ok: result.ok === true,
    generatedAtUtc: Number.isFinite(Date.parse(generatedAtUtc)) ? new Date(generatedAtUtc).toISOString() : '',
    finalVerdict: safeText(result.finalVerdict, 120),
    sessionId: safeText(result.sessionId, 160),
    headline: Object.freeze({
      focus: safeText(headline.focus, 120),
      provider: safeText(headline.provider, 80),
      providerIdentityStatus: safeText(headline.providerIdentityStatus, 80),
      launchSessionId: safeText(headline.launchSessionId, 160),
      sourceHead: /^[0-9a-f]{40}$/.test(sourceHead) ? sourceHead : '',
      telemetrySessionId: safeText(headline.telemetrySessionId, 160),
      signals: safeSignals(headline.signals),
      sessionOutcome: safeText(headline.sessionOutcome, 80),
      partialTelemetry: headline.partialTelemetry === true,
      crashEvidenceCount: safeCount(headline.crashEvidenceCount, 10_000),
      sampleCount: safeCount(headline.sampleCount, 10_000_000),
      avgGpuUtilPct: safeMetric(headline.avgGpuUtilPct, 0, 100),
      maxGpuUtilPct: safeMetric(headline.maxGpuUtilPct, 0, 100),
      maxGpuMemoryPct: safeMetric(headline.maxGpuMemoryPct, 0, 100),
      avgStarfieldCpuPct: safeMetric(headline.avgStarfieldCpuPct, 0, 100),
      avgSystemCpuPct: safeMetric(headline.avgSystemCpuPct, 0, 100),
      maxLlamaServerCount: safeCount(headline.maxLlamaServerCount, 1000),
      airLinkRuntimeSamplePct: safeMetric(headline.airLinkRuntimeSamplePct, 0, 100),
      minGameDriveFreeGiB: safeMetric(headline.minGameDriveFreeGiB, 0, 10_000_000),
      minGameDriveFreePct: safeMetric(headline.minGameDriveFreePct, 0, 100),
      avgGameDriveActivePct: safeMetric(headline.avgGameDriveActivePct, 0, 100),
      maxGameDriveLatencyMs: safeMetric(headline.maxGameDriveLatencyMs, 0, 10_000_000),
      maxGameDriveQueueLength: safeMetric(headline.maxGameDriveQueueLength, 0, 1_000_000),
      maxPagesPerSec: safeMetric(headline.maxPagesPerSec, 0, 1_000_000_000),
      storageTelemetryAvailable: headline.storageTelemetryAvailable === true,
      topRecommendation: safeText(headline.topRecommendation, 240),
      topRecommendationSource: safeText(headline.topRecommendationSource, 160),
      projectLoopState: safeText(headline.projectLoopState, 120),
      projectTelemetryGapCount: safeCount(headline.projectTelemetryGapCount, 10_000),
      projectNextExperiment: safeText(headline.projectNextExperiment, 240),
    }),
    history: Object.freeze({
      sessionCount: safeCount(history.sessionCount, 1_000_000),
      newestSessionId: safeText(history.newestSessionId, 160),
    }),
    sharedWorkspacePublished: published,
    rawTelemetryReturned: false,
    hostPathsReturned: false,
    secretMaterialReturned: false,
  });
}

export async function main(stdout = process.stdout) {
  const result = await reportStarfieldVrTelemetry();
  const headlineProjection = buildStarfieldVrTelemetryHeadlineProjection(result);
  stdout.write(`${STARFIELD_VR_TELEMETRY_HEADLINE_MARKER}${JSON.stringify(headlineProjection)}\n`);
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const publicationComplete = result.sharedWorkspace?.packetWrite?.ok === true
    && result.sharedWorkspace?.loopWrite?.ok === true
    && result.sharedWorkspace?.historyWrite?.ok === true
    && result.sharedWorkspace?.eventWrite?.ok === true;
  return publicationComplete ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(); }
  catch (error) {
    process.stderr.write(`${text(error?.stack || error?.message || error)}\n`);
    process.exitCode = 1;
  }
}
