import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  createSharedWorkspaceStatusRecord,
  resolveSharedWorkspacePath,
  writeAtomicJson,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  validateExistingSharedWorkspaceRuntimeConfig,
} from '../../shared/agents/sharedWorkspaceRuntimeConfig.mjs';

export const SUPPORT_SNAPSHOT_WORKSPACE_STATUS_ID = 'support-snapshot-observation';
export const SUPPORT_SNAPSHOT_WORKSPACE_REFRESH_MS = 5 * 60 * 1000;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function bounded(value, fallback = 'unknown', max = 120) {
  const out = text(value, fallback).replace(/[\u0000-\u001f\u007f]/gu, ' ');
  return out.slice(0, max);
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}
function canonicalObservation(input = {}) {
  return Object.freeze({
    backendState: bounded(input.backendState),
    routeMode: bounded(input.routeMode),
    flywheelState: bounded(input.flywheelState),
    lessonCount: integer(input.lessonCount),
    latestLessonId: bounded(input.latestLessonId, 'none'),
    renderState: bounded(input.renderState),
  });
}

function signatureFor(observation) {
  return createHash('sha256')
    .update(JSON.stringify(observation))
    .digest('hex')
    .slice(0, 24);
}

async function readExisting(root, repoRoot) {
  const resolved = resolveSharedWorkspacePath({
    root,
    repoRoot,
    segments: ['status', `${SUPPORT_SNAPSHOT_WORKSPACE_STATUS_ID}.json`],
  });
  if (!resolved.ok) return null;
  try {
    return JSON.parse(await readFile(resolved.path, 'utf8'));
  } catch {
    return null;
  }
}
export async function publishSupportSnapshotWorkspaceObservation(input = {}) {
  const repoRoot = input.repoRoot || process.cwd();
  const config = await validateExistingSharedWorkspaceRuntimeConfig({
    root: input.root,
    env: input.env,
    repoRoot,
  });
  if (!config.ok) {
    return Object.freeze({
      ok: false,
      changed: false,
      reason: config.reason,
      finalVerdict: 'SUPPORT_SNAPSHOT_WORKSPACE_BRIDGE_UNAVAILABLE',
    });
  }

  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const timestampUtc = new Date(nowMs).toISOString();
  const observation = canonicalObservation(input.observation);
  const signature = signatureFor(observation);
  const existing = await readExisting(config.root, repoRoot);
  const existingAgeMs = existing?.timestampUtc
    ? Math.max(0, nowMs - Date.parse(existing.timestampUtc))
    : Number.POSITIVE_INFINITY;

  if (
    existing?.observation?.signature === signature
    && Number.isFinite(existingAgeMs)
    && existingAgeMs < SUPPORT_SNAPSHOT_WORKSPACE_REFRESH_MS
  ) {
    return Object.freeze({
      ok: true,
      changed: false,
      reason: 'SUPPORT_SNAPSHOT_OBSERVATION_UNCHANGED',
      signature,
      observation,
      finalVerdict: 'SUPPORT_SNAPSHOT_WORKSPACE_BRIDGE_CURRENT',
    });
  }
  const status = observation.backendState === 'online' && observation.renderState !== 'looping'
    ? 'READY'
    : 'DEGRADED';
  const base = createSharedWorkspaceStatusRecord({
    statusId: SUPPORT_SNAPSHOT_WORKSPACE_STATUS_ID,
    participantId: 'stephanos',
    timestampUtc,
    status,
    summary: `Support Snapshot bridge: backend=${observation.backendState}; render=${observation.renderState}; lessons=${observation.lessonCount}.`,
    proofRefs: [],
  });
  const record = Object.freeze({
    ...base,
    source: 'support-snapshot-bounded-observation',
    observation: Object.freeze({ ...observation, signature }),
    readOnlyObservation: true,
    mergeAuthority: false,
    runtimeMutationAllowed: false,
  });
  const write = await writeAtomicJson(
    config.root,
    ['status', `${SUPPORT_SNAPSHOT_WORKSPACE_STATUS_ID}.json`],
    record,
    { repoRoot, nowMs },
  );

  return Object.freeze({
    ok: write.ok === true,
    changed: write.ok === true,
    reason: write.reason,
    signature,
    observation,
    finalVerdict: write.ok === true
      ? 'SUPPORT_SNAPSHOT_WORKSPACE_BRIDGE_PUBLISHED'
      : 'SUPPORT_SNAPSHOT_WORKSPACE_BRIDGE_BLOCKED',
  });
}
