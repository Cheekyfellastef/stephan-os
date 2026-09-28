import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

import {
  createSharedWorkspaceEventRecord,
  resolveSharedWorkspacePath,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';
import { promoteSharedWorkspaceLearningCandidatesV1 } from './flywheelLearningFabricV1.mjs';

export const VR_PLAYTEST_EVIDENCE_PACKET_SCHEMA_V1 = 'stephanos.vr-playtest-evidence-packet.v1';
export const VR_PLAYTEST_FLYWHEEL_BRIDGE_SCHEMA_V1 = 'stephanos.vr-playtest-flywheel-bridge.v1';

function text(value, fallback = '') {
  const out = value === null || value === undefined ? '' : String(value).trim();
  return out || fallback;
}

function safeId(value, fallback = 'session') {
  const out = text(value).toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
  return out || fallback;
}

function within(root, target) {
  const rel = relative(resolve(root), resolve(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readOptionalText(path) {
  try { return await readFile(path, 'utf8'); } catch { return ''; }
}

function parseAerLine(line = '') {
  const parts = String(line).trim().split(',');
  if (!parts[0]) return null;
  const values = {};
  for (const part of parts.slice(1)) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    values[part.slice(0, index)] = part.slice(index + 1);
  }
  return { event: parts[0], values };
}

export function analyseAerPlaytestLogV1(logText = '') {
  const parsed = String(logText || '').split(/\r?\n/).map(parseAerLine).filter(Boolean);
  const active = parsed.filter((entry) => entry.event === 'ACTIVE');
  const faults = parsed.filter((entry) => entry.event === 'SEQUENCE_FAULT');
  const deltas = faults.map((entry) => Number(entry.values.delta)).filter(Number.isFinite);
  const maxAbsDelta = deltas.length ? Math.max(...deltas.map((value) => Math.abs(value))) : 0;
  const backwardsOrDuplicateCount = deltas.filter((value) => value <= 0).length;
  const skippedForwardCount = deltas.filter((value) => value > 1).length;
  return Object.freeze({
    aerActiveSeen: active.length > 0,
    activeRecordCount: active.length,
    sequenceFaultCount: faults.length,
    maxAbsDelta,
    backwardsOrDuplicateCount,
    skippedForwardCount,
    sampleFaults: Object.freeze(faults.slice(0, 8).map((entry) => Object.freeze({
      fault: Number(entry.values.fault) || 0,
      previousFrame: Number(entry.values.prev),
      currentFrame: Number(entry.values.current),
      delta: Number(entry.values.delta),
      previousParity: Number(entry.values.prevParity),
      currentParity: Number(entry.values.currentParity),
      engineFrame: Number(entry.values.engine),
      renderFrame: Number(entry.values.render),
      presenterFrame: Number(entry.values.presenter),
      renderLoopFrame: Number(entry.values.renderLoop),
      mode: text(entry.values.mode, 'unknown'),
    }))),
  });
}

function evidenceRefForSession(sessionId) {
  return `workspace:vr/aer-stabilizer/sessions/${sessionId}`;
}

function packetRefForSession(sessionId) {
  return `workspace:vr/flywheel/evidence/${sessionId}`;
}

export function buildVrPlaytestEvidencePacketV1({
  session = {},
  modeState = {},
  analysis = {},
  sessionId = '',
  sourceSessionRef = '',
  observedAtUtc = '',
} = {}) {
  const id = safeId(sessionId);
  const rollback = text(modeState.rollback, 'UNKNOWN').toUpperCase();
  const protectReady = Boolean(
    modeState?.evidence?.protectReady === true
    || (analysis.aerActiveSeen && analysis.sequenceFaultCount >= 3 && rollback === 'RESTORED')
  );
  const mode = text(session.mode, text(modeState.stabilizerMode, 'OBSERVE')).toUpperCase();
  const route = text(modeState.route, 'MutaR / OpenXR');
  const game = text(modeState.game, 'Starfield');

  const reusableFindings = [];
  if (analysis.aerActiveSeen) reusableFindings.push('AER flight recorder was active during the headset session.');
  if (analysis.sequenceFaultCount > 0) {
    reusableFindings.push(`Presenter sequencing produced ${analysis.sequenceFaultCount} discontinuities; largest absolute frame delta was ${analysis.maxAbsDelta}.`);
  }
  if (rollback === 'RESTORED') reusableFindings.push('Experimental runtime automatically restored the validated baseline after the session.');

  const starfieldFindings = [
    `Route: ${route}; stabilizer mode: ${mode}.`,
    `AER sequence faults: ${analysis.sequenceFaultCount || 0}; backwards/duplicate: ${analysis.backwardsOrDuplicateCount || 0}; skipped-forward: ${analysis.skippedForwardCount || 0}.`,
    `Rollback: ${rollback}; next Protect rung: ${protectReady ? 'EVIDENCE_READY' : 'LOCKED'}.`,
  ];

  return Object.freeze({
    schemaVersion: VR_PLAYTEST_EVIDENCE_PACKET_SCHEMA_V1,
    packetType: 'vr-playtest-evidence',
    packetId: `vr-playtest-${id}`,
    sessionId: id,
    observedAtUtc: text(observedAtUtc, text(modeState.updatedAtUtc, text(session.enteredAtUtc))),
    sourceSessionRef: text(sourceSessionRef, evidenceRefForSession(id)),
    game,
    route,
    mode,
    runtimeIdentity: Object.freeze({
      baselineDllSha256: text(session.expectedBaselineHash),
      experimentalDllSha256: text(session.expectedCustomHash),
      gameProcessId: Number(session.gameProcessId) || null,
      observedGameProcessIds: Object.freeze(Array.isArray(modeState.observedGameProcessIds) ? modeState.observedGameProcessIds.map(Number).filter(Number.isFinite) : []),
    }),
    telemetry: Object.freeze({
      aerActiveSeen: Boolean(analysis.aerActiveSeen),
      activeRecordCount: Number(analysis.activeRecordCount) || 0,
      sequenceFaultCount: Number(analysis.sequenceFaultCount) || 0,
      maxAbsDelta: Number(analysis.maxAbsDelta) || 0,
      backwardsOrDuplicateCount: Number(analysis.backwardsOrDuplicateCount) || 0,
      skippedForwardCount: Number(analysis.skippedForwardCount) || 0,
      sampleFaults: Object.freeze(Array.isArray(analysis.sampleFaults) ? analysis.sampleFaults : []),
    }),
    rollback: Object.freeze({
      state: rollback,
      restoredHash: text(modeState.restoredHash),
      archiveError: text(modeState?.evidence?.archiveError),
    }),
    modeProgression: Object.freeze({
      baseline: 'green',
      observe: 'green',
      protect: protectReady ? 'yellow' : 'grey',
      adaptive: 'grey',
      protectReady,
      protectThreshold: Number(modeState?.evidence?.protectThreshold) || 3,
    }),
    labProjections: Object.freeze({
      vrResearchLab: Object.freeze({
        reusableFindings: Object.freeze(reusableFindings),
        techniqueCandidate: analysis.sequenceFaultCount > 0
          ? 'AER presenter-sequence telemetry plus evidence-gated protection is a reusable flat-to-VR stability method candidate.'
          : 'Continue observation before promoting an AER stability method.',
        provenanceRef: packetRefForSession(id),
      }),
      starfieldReferenceLab: Object.freeze({
        findings: Object.freeze(starfieldFindings),
        mutarBaseline: text(session.expectedBaselineHash),
        experimentalBuild: text(session.expectedCustomHash),
        nextMode: protectReady ? 'PROTECT' : 'OBSERVE',
        provenanceRef: packetRefForSession(id),
      }),
    }),
    flywheel: Object.freeze({
      learningCandidate: Boolean(analysis.aerActiveSeen && analysis.sequenceFaultCount > 0),
      lessonId: `vr-starfield-aer-${id}`,
      improvementCandidate: protectReady
        ? Object.freeze({
            gapSource: 'PERFORMANCE_OR_RELIABILITY_GAP',
            title: 'Stabilize Starfield AER presenter sequencing',
            summary: `Protect mode is evidence-ready after ${analysis.sequenceFaultCount} observed presenter sequence faults.`,
            evidenceRefs: Object.freeze([evidenceRefForSession(id), packetRefForSession(id)]),
          })
        : null,
    }),
    authority: Object.freeze({
      sourceMutationAllowed: false,
      runtimeMutationAllowed: false,
      goalCreationAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
    }),
  });
}

function buildLearningCandidate(packet) {
  if (!packet.flywheel.learningCandidate) return null;
  const automationCandidate = packet.modeProgression.protectReady;
  const sessionRef = evidenceRefForSession(packet.sessionId);
  const packetRef = packetRefForSession(packet.sessionId);
  return {
    lessonId: packet.flywheel.lessonId,
    recordKey: packet.flywheel.lessonId,
    recordClass: automationCandidate ? 'AUTOMATION_CANDIDATE' : 'ENGINEERING_INCIDENT',
    problemClass: 'aer-presenter-sequence-instability',
    componentAndOwnerRefs: [
      'VR-Research-Lab/knowledge-sources/mutar-nomoreflat',
      'shared/vr/starfieldVrReferenceCatalogue.mjs',
      'scripts/windows/starfield-aer-stabilizer-guardian.ps1',
    ],
    symptom: `Starfield AER recorded ${packet.telemetry.sequenceFaultCount} presenter-frame sequence discontinuities during an active headset playtest.`,
    rootCause: null,
    repairOrMethod: automationCandidate
      ? 'Advance only through the evidence-gated Observe to Protect ladder; detect broken presenter-frame pairs before submission and preserve automatic rollback.'
      : null,
    prerequisites: [
      'Use exact runtime hashes and preserve the public MutaR baseline.',
      'Require real headset/OpenXR evidence rather than simulated readiness.',
    ],
    forbiddenShortcuts: [
      'Do not infer AER stability from desktop rendering alone.',
      'Do not silently promote Protect or Adaptive without headset evidence.',
    ],
    failureModes: [
      'Presenter-frame parity discontinuity',
      'Skipped or duplicated presenter frame',
      'Temporal eye-history divergence under camera motion',
    ],
    counterexamples: [
      'A stationary image can appear acceptable while rotational motion exposes severe AER breakup.',
    ],
    testAndProofRefs: [sessionRef, packetRef],
    runtimeEvidenceRefs: [sessionRef, packetRef],
    confidenceBasis: `Direct AER flight-recorder telemetry with ${packet.telemetry.sequenceFaultCount} sequence faults and rollback state ${packet.rollback.state}.`,
    freshness: 'CURRENT',
    applicableDomains: ['vr/aer', 'starfield/vr', 'frame/pacing'],
    privacyAndSensitivity: 'INTERNAL_BOUNDED',
    status: automationCandidate ? 'CANDIDATE' : 'CURRENT',
  };
}

async function writeEvidencePacket({ root, repoRoot, packet }) {
  const resolved = resolveSharedWorkspacePath({
    root,
    repoRoot,
    segments: ['vr', 'flywheel', 'evidence', `${packet.sessionId}.json`],
  });
  if (!resolved.ok) throw new Error(`VR_EVIDENCE_PATH_BLOCKED:${resolved.reason}`);
  await mkdir(dirname(resolved.path), { recursive: true });
  try {
    const existing = JSON.parse(await readFile(resolved.path, 'utf8'));
    if (existing?.schemaVersion === VR_PLAYTEST_EVIDENCE_PACKET_SCHEMA_V1 && existing?.sessionId === packet.sessionId) {
      return { ok: true, reason: 'VR_EVIDENCE_ALREADY_PUBLISHED', path: resolved.path };
    }
  } catch {}
  const temp = `${resolved.path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(packet, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await rename(temp, resolved.path);
  return { ok: true, reason: 'VR_EVIDENCE_PUBLISHED', path: resolved.path };
}

export async function publishVrPlaytestSessionToFlywheelV1({
  sessionPath,
  root,
  repoRoot = process.cwd(),
  nowMs = Date.now(),
} = {}) {
  const workspaceRoot = resolve(root || '');
  const resolvedSession = resolve(sessionPath || '');
  if (!root || !sessionPath || !within(workspaceRoot, resolvedSession)) {
    return Object.freeze({
      schemaVersion: VR_PLAYTEST_FLYWHEEL_BRIDGE_SCHEMA_V1,
      ok: false,
      reason: 'VR_PLAYTEST_SESSION_PATH_BLOCKED',
      finalVerdict: 'VR_PLAYTEST_FLYWHEEL_BRIDGE_BLOCKED',
    });
  }

  const session = await readJson(resolvedSession);
  if (session?.schemaVersion !== 'stephanos.starfield-vr-aer-stabilizer-session.v1') {
    throw new Error('VR_PLAYTEST_SESSION_SCHEMA_INVALID');
  }
  const sessionId = safeId(basename(dirname(resolvedSession)));
  const modeStatePath = resolve(text(session.modeStatePath));
  const archiveLogPath = resolve(text(session.archiveLogPath));
  if (!within(workspaceRoot, modeStatePath) || !within(workspaceRoot, archiveLogPath)) {
    throw new Error('VR_PLAYTEST_EVIDENCE_PATH_OUTSIDE_WORKSPACE');
  }

  const modeState = await readJson(modeStatePath);
  const logText = await readOptionalText(archiveLogPath);
  const analysis = analyseAerPlaytestLogV1(logText);
  const packet = buildVrPlaytestEvidencePacketV1({
    session,
    modeState,
    analysis,
    sessionId,
    sourceSessionRef: evidenceRefForSession(sessionId),
    observedAtUtc: text(modeState.updatedAtUtc, new Date(nowMs).toISOString()),
  });

  const packetWrite = await writeEvidencePacket({ root: workspaceRoot, repoRoot, packet });

  const eventId = `vr-playtest-${sessionId}`;
  const eventPath = resolveSharedWorkspacePath({
    root: workspaceRoot,
    repoRoot,
    segments: ['events', `${eventId}.json`],
  });
  let eventWrite = { ok: true, reason: 'VR_PLAYTEST_EVENT_ALREADY_PUBLISHED', path: eventPath.path };
  let eventExists = false;
  if (eventPath.ok) {
    try {
      const existing = JSON.parse(await readFile(eventPath.path, 'utf8'));
      eventExists = existing?.eventId === eventId;
    } catch {}
  }

  if (!eventExists) {
    const learningCandidate = buildLearningCandidate(packet);
    const event = {
      ...createSharedWorkspaceEventRecord({
        eventId,
        participantId: 'vr-playtest-bridge',
        timestampUtc: packet.observedAtUtc,
        eventKind: 'vr-playtest-evidence',
        summary: `${packet.game} ${packet.mode} playtest recorded ${packet.telemetry.sequenceFaultCount} AER sequence faults; rollback ${packet.rollback.state}; next mode ${packet.labProjections.starfieldReferenceLab.nextMode}.`,
        ...(learningCandidate ? { learningCandidate } : {}),
      }),
      vrEvidence: {
        packetSchema: packet.schemaVersion,
        packetRef: packetRefForSession(sessionId),
        game: packet.game,
        route: packet.route,
        mode: packet.mode,
        sequenceFaultCount: packet.telemetry.sequenceFaultCount,
        protectReady: packet.modeProgression.protectReady,
      },
    };
    eventWrite = await writeAtomicJson(
      workspaceRoot,
      ['events', `${eventId}.json`],
      event,
      { repoRoot, nowMs },
    );
    if (!eventWrite.ok) throw new Error(`VR_PLAYTEST_EVENT_WRITE_FAILED:${eventWrite.reason}`);
  }

  const promotion = await promoteSharedWorkspaceLearningCandidatesV1({
    root: workspaceRoot,
    repoRoot,
    nowMs,
  });

  return Object.freeze({
    schemaVersion: VR_PLAYTEST_FLYWHEEL_BRIDGE_SCHEMA_V1,
    ok: packetWrite.ok && eventWrite.ok && promotion.ok,
    reason: promotion.ok ? 'VR_PLAYTEST_FLYWHEEL_BRIDGE_COMPLETE' : 'VR_PLAYTEST_FLYWHEEL_BRIDGE_DEGRADED',
    sessionId,
    packetRef: packetRefForSession(sessionId),
    packetWrite,
    eventWrite,
    promotedLessonIds: promotion.promotedLessonIds,
    skippedLessonIds: promotion.skippedLessonIds,
    protectReady: packet.modeProgression.protectReady,
    sequenceFaultCount: packet.telemetry.sequenceFaultCount,
    finalVerdict: promotion.ok ? 'VR_PLAYTEST_FLYWHEEL_READY' : 'VR_PLAYTEST_FLYWHEEL_DEGRADED',
  });
}
