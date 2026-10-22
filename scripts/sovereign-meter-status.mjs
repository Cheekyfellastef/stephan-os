#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveSharedWorkspaceRuntimeConfig } from '../shared/agents/sharedWorkspaceRuntimeConfig.mjs';

export const SOVEREIGN_METER_STATUS_SCHEMA = 'stephanos.sovereign-meter-status.v1';
export const SOVEREIGN_METER_STATUS_MARKER = 'SOVEREIGN_COMMANDER_METER_STATUS_RESULT=';
const DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000;
const MAX_STATUS_FILES = 256;
const MAX_METERS = 64;

function safeText(value, max = 120) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeId(value) {
  const candidate = safeText(value, 120).toLowerCase();
  return /^[a-z0-9][a-z0-9._:-]{0,119}$/.test(candidate) ? candidate : '';
}

function safeTimestamp(value) {
  const candidate = safeText(value, 80);
  const ms = Date.parse(candidate);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

function boundedPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100
    ? Math.round(number * 100) / 100
    : null;
}

function boundedInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function canonicalMeterId(value) {
  const id = safeId(value);
  if (!id) return '';
  if (/codex/.test(id)) return 'codex-capacity';
  if (/(remote.*commander|desktop.*commander)/.test(id)) return 'remote-desktop-commander';
  if (/(chatgpt.*work|work.*capacity)/.test(id)) return 'chatgpt-work-capacity';
  return id;
}

function meterLikeRecord(record = {}) {
  const identity = [
    record.participantStatusId,
    record.statusId,
    record.meterId,
    record.participantId,
    record.kind,
  ].map((item) => safeText(item, 120)).join(' ');
  return /(meter|capacity|quota|usage|rate.?limit)/i.test(identity)
    || record.remainingPercent !== undefined
    || record.meterTruthUsable !== undefined
    || record.naturalResetAtUtc !== undefined
    || record?.metrics?.remainingPercent !== undefined;
}

function trafficLight({ remainingPercent, availability, truthState, fresh }) {
  const posture = `${safeText(availability, 80)} ${safeText(truthState, 80)}`.toUpperCase();
  if (/(METER_STALLED|EXHAUSTED|DEPLETED|INSUFFICIENT_QUOTA|QUOTA_EXHAUSTED|BLOCKED_BY_METER)/.test(posture)) return 'RED';
  if (remainingPercent === 0) return 'RED';
  if (remainingPercent !== null) {
    if (fresh === false) return 'AMBER';
    if (remainingPercent < 5) return 'RED';
    if (remainingPercent < 25) return 'AMBER';
    return 'GREEN';
  }
  if (/STALE/.test(posture)) return 'AMBER';
  return 'GREY';
}

export function normalizeWorkspaceMeterRecord(record = {}, { nowMs = Date.now(), staleAfterMs = DEFAULT_STALE_AFTER_MS } = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || !meterLikeRecord(record)) return null;
  const rawId = record.meterId || record.participantStatusId || record.statusId || record.participantId;
  const meterId = canonicalMeterId(rawId);
  if (!meterId) return null;

  const observedAtUtc = safeTimestamp(record.observedAtUtc || record.timestampUtc);
  const observedMs = observedAtUtc ? Date.parse(observedAtUtc) : NaN;
  const ageSeconds = Number.isFinite(observedMs)
    ? Math.max(0, Math.floor((nowMs - observedMs) / 1000))
    : null;
  const truthState = safeText(record.truthState || record.status || 'UNKNOWN', 80).toUpperCase();
  const availability = safeText(record.availability || 'UNKNOWN', 80).toUpperCase();
  const remainingPercent = boundedPercent(record.remainingPercent ?? record?.metrics?.remainingPercent);
  const explicitlyCurrent = truthState === 'CURRENT' || record.meterTruthUsable === true;
  const explicitlyStale = truthState === 'STALE' || record.meterTruthUsable === false;
  const freshByAge = ageSeconds !== null && ageSeconds * 1000 <= staleAfterMs;
  const fresh = explicitlyStale ? false : (explicitlyCurrent ? freshByAge : freshByAge);
  const naturalResetAtUtc = safeTimestamp(record.naturalResetAtUtc);
  const light = trafficLight({ remainingPercent, availability, truthState, fresh });

  return Object.freeze({
    meterId,
    provider: safeId(record.participantId || meterId),
    source: 'shared-workspace',
    observationState: light === 'GREY' ? 'UNKNOWN' : (fresh ? 'CURRENT' : 'STALE'),
    trafficLight: light,
    remainingPercent,
    availability,
    truthState,
    observedAtUtc,
    ageSeconds,
    naturalResetAtUtc,
    meterTruthUsable: record.meterTruthUsable === true,
    observableBySovereign: true,
  });
}

export function normalizeGithubRateResources(resources = {}, { nowMs = Date.now() } = {}) {
  const names = ['core', 'search', 'graphql', 'code_search', 'actions_runner_registration'];
  return Object.freeze(names.flatMap((name) => {
    const item = resources?.[name];
    if (!item || typeof item !== 'object') return [];
    const limit = boundedInteger(item.limit);
    const remaining = boundedInteger(item.remaining);
    if (limit === null || limit <= 0 || remaining === null) return [];
    const remainingPercent = boundedPercent((remaining / limit) * 100);
    const resetEpoch = boundedInteger(item.reset);
    const naturalResetAtUtc = resetEpoch === null ? '' : new Date(resetEpoch * 1000).toISOString();
    return [Object.freeze({
      meterId: `github-${name.replaceAll('_', '-')}`,
      provider: 'github',
      source: 'github-rate-limit-api',
      observationState: 'CURRENT',
      trafficLight: trafficLight({ remainingPercent, availability: 'AVAILABLE', truthState: 'CURRENT', fresh: true }),
      remainingPercent,
      availability: 'AVAILABLE',
      truthState: 'CURRENT',
      observedAtUtc: new Date(nowMs).toISOString(),
      ageSeconds: 0,
      naturalResetAtUtc,
      meterTruthUsable: true,
      observableBySovereign: true,
      limit,
      remaining,
    })];
  }));
}

function unknownMeter(meterId, provider, reason) {
  return Object.freeze({
    meterId,
    provider,
    source: 'external-observation-required',
    observationState: 'UNKNOWN',
    trafficLight: 'GREY',
    remainingPercent: null,
    availability: 'UNKNOWN',
    truthState: 'UNKNOWN',
    observedAtUtc: '',
    ageSeconds: null,
    naturalResetAtUtc: '',
    meterTruthUsable: false,
    observableBySovereign: false,
    blocker: reason,
  });
}

function scoreMeter(meter) {
  if (!meter) return -1;
  let score = 0;
  if (meter.observationState === 'CURRENT') score += 8;
  else if (meter.observationState === 'STALE') score += 4;
  if (meter.remainingPercent !== null) score += 2;
  if (meter.observableBySovereign === true) score += 1;
  return score;
}

export function buildSovereignMeterStatus({
  workspaceRecords = [],
  githubRateResources = null,
  now = new Date(),
  workspaceReady = true,
  githubRateObservable = true,
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const meters = new Map();

  for (const record of Array.isArray(workspaceRecords) ? workspaceRecords : []) {
    const normalized = normalizeWorkspaceMeterRecord(record, { nowMs: safeNowMs });
    if (!normalized) continue;
    const existing = meters.get(normalized.meterId);
    if (!existing || scoreMeter(normalized) > scoreMeter(existing)) meters.set(normalized.meterId, normalized);
  }

  for (const meter of normalizeGithubRateResources(githubRateResources || {}, { nowMs: safeNowMs })) {
    meters.set(meter.meterId, meter);
  }

  if (!meters.has('codex-capacity')) {
    meters.set('codex-capacity', unknownMeter(
      'codex-capacity',
      'codex',
      workspaceReady ? 'CODEX_METER_OBSERVATION_NOT_CURRENT' : 'SHARED_WORKSPACE_UNAVAILABLE',
    ));
  }
  if (!meters.has('remote-desktop-commander')) {
    meters.set('remote-desktop-commander', unknownMeter(
      'remote-desktop-commander',
      'desktop-commander',
      'EXTERNAL_CONNECTOR_METER_NOT_PUBLISHED',
    ));
  }
  if (!meters.has('chatgpt-work-capacity')) {
    meters.set('chatgpt-work-capacity', unknownMeter(
      'chatgpt-work-capacity',
      'chatgpt-work',
      'EXTERNAL_PRODUCT_METER_NOT_PUBLISHED',
    ));
  }
  if (githubRateObservable === false && ![...meters.keys()].some((id) => id.startsWith('github-'))) {
    meters.set('github-api', unknownMeter('github-api', 'github', 'GITHUB_RATE_LIMIT_API_UNAVAILABLE'));
  }

  const ordered = [...meters.values()]
    .sort((a, b) => a.meterId.localeCompare(b.meterId))
    .slice(0, MAX_METERS);
  const counts = Object.freeze({
    total: ordered.length,
    green: ordered.filter((item) => item.trafficLight === 'GREEN').length,
    amber: ordered.filter((item) => item.trafficLight === 'AMBER').length,
    red: ordered.filter((item) => item.trafficLight === 'RED').length,
    grey: ordered.filter((item) => item.trafficLight === 'GREY').length,
  });

  return Object.freeze({
    schemaVersion: SOVEREIGN_METER_STATUS_SCHEMA,
    ok: true,
    capturedAtUtc: new Date(safeNowMs).toISOString(),
    counts,
    meters: Object.freeze(ordered),
    readOnly: true,
    arbitraryShellAllowed: false,
    secretMaterialIncluded: false,
    unknownMeansGreen: false,
    finalVerdict: counts.red > 0
      ? 'SOVEREIGN_METER_STATUS_RED_PRESENT'
      : (counts.amber > 0 ? 'SOVEREIGN_METER_STATUS_AMBER_PRESENT' : 'SOVEREIGN_METER_STATUS_READY'),
  });
}

async function readWorkspaceRecords({ repoRoot, env = process.env } = {}) {
  const config = resolveSharedWorkspaceRuntimeConfig({ repoRoot, env });
  if (!config.ok) return { ready: false, records: [] };
  const statusDir = join(config.root, 'status');
  let names = [];
  try {
    names = (await readdir(statusDir))
      .filter((name) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.json$/.test(name))
      .slice(0, MAX_STATUS_FILES);
  } catch {
    return { ready: false, records: [] };
  }
  const records = [];
  for (const name of names) {
    try {
      const record = JSON.parse(await readFile(join(statusDir, name), 'utf8'));
      if (meterLikeRecord(record)) records.push(record);
    } catch {}
  }
  return { ready: true, records };
}

function readGithubRateResources(spawnSyncFn = spawnSync) {
  const result = spawnSyncFn('gh', ['api', 'rate_limit'], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 5000,
    maxBuffer: 256 * 1024,
    env: { ...process.env, GH_PROMPT_DISABLED: '1' },
  });
  if (result?.status !== 0 || !safeText(result?.stdout, 256 * 1024)) return null;
  try {
    const parsed = JSON.parse(String(result.stdout));
    return parsed?.resources && typeof parsed.resources === 'object' ? parsed.resources : null;
  } catch {
    return null;
  }
}

export async function collectSovereignMeterStatus({
  repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url))),
  env = process.env,
  spawnSyncFn = spawnSync,
  now = () => new Date(),
} = {}) {
  const workspace = await readWorkspaceRecords({ repoRoot, env });
  const githubRateResources = readGithubRateResources(spawnSyncFn);
  return buildSovereignMeterStatus({
    workspaceRecords: workspace.records,
    githubRateResources,
    now: now(),
    workspaceReady: workspace.ready,
    githubRateObservable: githubRateResources !== null,
  });
}

export async function runSovereignMeterStatus(options = {}) {
  const status = await collectSovereignMeterStatus(options);
  process.stdout.write(`${SOVEREIGN_METER_STATUS_MARKER}${JSON.stringify(status)}\n`);
  return status;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSovereignMeterStatus().catch((error) => {
    process.stderr.write(`${safeText(error?.message || error, 240)}\n`);
    process.exitCode = 1;
  });
}
