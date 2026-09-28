import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { resolveSharedWorkspacePath } from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import { validateExistingSharedWorkspaceRuntimeConfig } from '../../shared/agents/sharedWorkspaceRuntimeConfig.mjs';
import { VR_PLAYTEST_EVIDENCE_PACKET_SCHEMA_V1 } from '../../shared/agents/vrPlaytestFlywheelBridgeV1.mjs';

export const VR_PLAYTEST_FEED_ROUTE = '/api/shared-workspace/vr-playtest-feed';
export const VR_PLAYTEST_LIVE_FEED_SCHEMA_V1 = 'stephanos.vr-playtest-live-feed.v1';
export const DEFAULT_VR_PLAYTEST_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function text(value, fallback = '') {
  const out = value === null || value === undefined ? '' : String(value).trim();
  return out || fallback;
}

function timestampMs(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function evidenceFreshness(packet, nowMs, staleAfterMs) {
  const observedMs = timestampMs(packet?.observedAtUtc);
  if (!observedMs || observedMs > nowMs + MAX_FUTURE_SKEW_MS) return 'unknown';
  return nowMs - observedMs > staleAfterMs ? 'stale' : 'current';
}

function packetIsSafe(packet = {}) {
  if (packet?.schemaVersion !== VR_PLAYTEST_EVIDENCE_PACKET_SCHEMA_V1) return false;
  if (packet?.packetType !== 'vr-playtest-evidence') return false;
  if (!text(packet?.sessionId) || !text(packet?.observedAtUtc)) return false;
  if (!packet?.labProjections?.vrResearchLab || !packet?.labProjections?.starfieldReferenceLab) return false;
  if (!packet?.flywheel || !packet?.authority) return false;
  if (packet.authority.sourceMutationAllowed === true || packet.authority.runtimeMutationAllowed === true) return false;
  return true;
}

async function resolveRuntimeRoot({ root, env, repoRoot }) {
  if (root) return { ok: true, root: resolve(root), safeDisplayPath: 'EXPLICIT_TEST_OR_RUNTIME_ROOT' };
  return validateExistingSharedWorkspaceRuntimeConfig({ env, repoRoot });
}

async function readEvidencePackets({ root, repoRoot, limit = 20 }) {
  const evidenceDir = resolveSharedWorkspacePath({
    root,
    repoRoot,
    segments: ['vr', 'flywheel', 'evidence'],
  });
  if (!evidenceDir.ok) return [];
  let names = [];
  try {
    names = await readdir(evidenceDir.path);
  } catch {
    return [];
  }
  const packets = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const packet = JSON.parse(await readFile(join(evidenceDir.path, name), 'utf8'));
      if (!packetIsSafe(packet)) continue;
      packets.push(packet);
    } catch {}
  }
  return packets
    .sort((left, right) => timestampMs(right.observedAtUtc) - timestampMs(left.observedAtUtc)
      || text(right.sessionId).localeCompare(text(left.sessionId)))
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 20)));
}

function projectGeneral(packet, freshness = 'unknown') {
  if (!packet) return null;
  return Object.freeze({
    freshness,
    current: freshness === 'current',
    sessionId: packet.sessionId,
    observedAtUtc: packet.observedAtUtc,
    game: packet.game,
    route: packet.route,
    mode: packet.mode,
    reusableFindings: Object.freeze([...(packet.labProjections?.vrResearchLab?.reusableFindings || [])]),
    techniqueCandidate: text(packet.labProjections?.vrResearchLab?.techniqueCandidate),
    sequenceFaultCount: Number(packet.telemetry?.sequenceFaultCount) || 0,
    rollback: text(packet.rollback?.state, 'UNKNOWN'),
    protectReady: freshness === 'current' && packet.modeProgression?.protectReady === true,
    provenanceRef: text(packet.labProjections?.vrResearchLab?.provenanceRef),
  });
}

function projectStarfield(packet, freshness = 'unknown') {
  if (!packet || text(packet.game).toLowerCase() !== 'starfield') return null;
  const recordedNextMode = text(packet.labProjections?.starfieldReferenceLab?.nextMode, 'OBSERVE');
  return Object.freeze({
    freshness,
    current: freshness === 'current',
    sessionId: packet.sessionId,
    observedAtUtc: packet.observedAtUtc,
    route: packet.route,
    mode: packet.mode,
    findings: Object.freeze([...(packet.labProjections?.starfieldReferenceLab?.findings || [])]),
    baselineDllSha256: text(packet.runtimeIdentity?.baselineDllSha256),
    experimentalDllSha256: text(packet.runtimeIdentity?.experimentalDllSha256),
    sequenceFaultCount: Number(packet.telemetry?.sequenceFaultCount) || 0,
    maxAbsDelta: Number(packet.telemetry?.maxAbsDelta) || 0,
    rollback: text(packet.rollback?.state, 'UNKNOWN'),
    nextMode: freshness === 'current' ? recordedNextMode : 'OBSERVE',
    recordedNextMode,
    provenanceRef: text(packet.labProjections?.starfieldReferenceLab?.provenanceRef),
  });
}

export async function readVrPlaytestFeed({
  env = process.env,
  repoRoot = process.cwd(),
  root,
  limit = 20,
  nowMs = Date.now(),
  staleAfterMs = DEFAULT_VR_PLAYTEST_STALE_AFTER_MS,
} = {}) {
  const runtime = await resolveRuntimeRoot({ root, env, repoRoot });
  if (!runtime.ok) {
    return Object.freeze({
      schemaVersion: VR_PLAYTEST_LIVE_FEED_SCHEMA_V1,
      route: VR_PLAYTEST_FEED_ROUTE,
      readOnly: true,
      state: 'unavailable',
      reason: runtime.reason || 'SHARED_WORKSPACE_UNAVAILABLE',
      workspace: Object.freeze({ live: false, safeWorkspaceRoot: runtime.safeDisplayPath || 'UNKNOWN' }),
      sessions: Object.freeze([]),
      latest: null,
      vrResearchLab: Object.freeze({ latest: null, history: Object.freeze([]) }),
      starfieldReferenceLab: Object.freeze({ latest: null, history: Object.freeze([]) }),
      flywheel: Object.freeze({ learningCandidateCount: 0, improvementCandidateCount: 0, latestLessonId: '' }),
    });
  }

  const packets = await readEvidencePackets({ root: runtime.root, repoRoot, limit });
  const boundedStaleAfterMs = Number.isFinite(staleAfterMs) && staleAfterMs > 0
    ? staleAfterMs
    : DEFAULT_VR_PLAYTEST_STALE_AFTER_MS;
  const freshnessByPacket = new Map(packets.map((packet) => [
    packet,
    evidenceFreshness(packet, nowMs, boundedStaleAfterMs),
  ]));
  const generalHistory = packets.map((packet) => projectGeneral(packet, freshnessByPacket.get(packet))).filter(Boolean);
  const starfieldHistory = packets.map((packet) => projectStarfield(packet, freshnessByPacket.get(packet))).filter(Boolean);
  const rawLatest = packets[0] || null;
  const latestFreshness = rawLatest ? freshnessByPacket.get(rawLatest) : 'unknown';
  const latest = rawLatest ? Object.freeze({ ...rawLatest, freshness: latestFreshness, current: latestFreshness === 'current' }) : null;
  const state = !rawLatest ? 'ready' : latestFreshness === 'current' ? 'ready' : latestFreshness;
  const reason = !rawLatest
    ? 'NO_VR_PLAYTEST_EVIDENCE_YET'
    : latestFreshness === 'current'
      ? 'VR_PLAYTEST_EVIDENCE_READY'
      : latestFreshness === 'stale'
        ? 'VR_PLAYTEST_EVIDENCE_STALE'
        : 'VR_PLAYTEST_EVIDENCE_UNKNOWN';
  const learningCandidateCount = packets.filter((packet) => packet.flywheel?.learningCandidate === true).length;
  const improvementCandidateCount = packets.filter((packet) => packet.flywheel?.improvementCandidate).length;

  return Object.freeze({
    schemaVersion: VR_PLAYTEST_LIVE_FEED_SCHEMA_V1,
    route: VR_PLAYTEST_FEED_ROUTE,
    readOnly: true,
    state,
    reason,
    workspace: Object.freeze({
      live: true,
      safeWorkspaceRoot: runtime.safeDisplayPath || 'SHARED_WORKSPACE',
    }),
    sessions: Object.freeze(packets),
    latest,
    vrResearchLab: Object.freeze({
      latest: generalHistory[0] || null,
      history: Object.freeze(generalHistory),
    }),
    starfieldReferenceLab: Object.freeze({
      latest: starfieldHistory[0] || null,
      history: Object.freeze(starfieldHistory),
    }),
    flywheel: Object.freeze({
      learningCandidateCount,
      improvementCandidateCount,
      latestLessonId: text(latest?.flywheel?.lessonId),
      latestProtectReady: latestFreshness === 'current' && latest?.modeProgression?.protectReady === true,
    }),
  });
}
