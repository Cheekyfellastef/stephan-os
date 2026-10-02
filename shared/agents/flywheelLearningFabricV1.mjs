import {
  readSharedWorkspaceRecordDirectory,
} from './shared-workspace-dashboard-feed.mjs';
import {
  buildEngineeringIncidentMethodRecordV1,
} from './engineeringIncidentMethodMemoryV1.mjs';
import {
  createSharedWorkspaceLessonRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';
import {
  resolveSharedWorkspaceRuntimeConfig,
} from './sharedWorkspaceRuntimeConfig.mjs';

export const FLYWHEEL_LEARNING_FABRIC_SCHEMA_V1 = 'stephanos.flywheel-learning-fabric.v1';
export const DEFAULT_LEARNING_PROMOTION_LIMIT_V1 = 8;

export const FLYWHEEL_CAPABILITY_GAP_PIPELINE_V1 = Object.freeze([
  'discover-product-surface',
  'understand-registration-model',
  'plan-bounded-change',
  'mutate',
  'build',
  'verify-runtime',
  'prove-live',
]);

function flywheelGapProblemClass(task = '', failureClass = '') {
  const source = `${task} ${failureClass}`.toLowerCase();
  if (/landing|workspace|tile|launcher|manifest|product surface|app registry|frontend surface/.test(source)) {
    return 'PRODUCT_SURFACE_DISCOVERY_AND_MUTATION';
  }
  if (/proof|verify|verification/.test(source) || failureClass === 'NO_VERIFICATION_METHOD') {
    return 'VERIFICATION_METHOD_DISCOVERY';
  }
  if (/runtime|service|process|windows|audio|display|game|whole pc/.test(source)) {
    return 'BATTLE_BRIDGE_SYSTEM_CAPABILITY';
  }
  return 'GENERAL_SOVEREIGN_CAPABILITY_GAP';
}

export function buildFlywheelCapabilityGapCandidateV1(input = {}) {
  const originalTask = text(input.task);
  const failureClass = text(input.failureClass).toUpperCase();
  const scope = text(input.scope, 'STEPHANOS_PROJECT').toUpperCase();
  const evidenceRefs = list(input.evidenceRefs).map((value) => text(value)).filter(Boolean);
  const problemClass = flywheelGapProblemClass(originalTask, failureClass);
  const teacherParticipantId = scope === 'WHOLE_PC' ? 'openclaw-standalone' : 'openclaw-local';
  const acceptanceExam = problemClass === 'PRODUCT_SURFACE_DISCOVERY_AND_MUTATION'
    ? 'Discover the Stephanos landing/product registration model, add or register a bounded test tile/workspace, build it, verify the served route, prove LIVE_PROVEN, then remove the test artefact unless it is an approved real goal.'
    : `Replay the original failed task "${originalTask}" using the learned guarded capability and return deterministic self-test plus Battle Bridge LIVE_PROVEN evidence.`;
  return Object.freeze({
    schemaVersion: 'stephanos.flywheel-capability-gap-candidate.v1',
    candidateId: safeLessonId(`gap-${problemClass}-${originalTask}`).slice(0, 80),
    originalTask,
    failureClass,
    problemClass,
    summary: text(input.summary, `Capability gap: ${originalTask}`),
    originatingAgent: text(input.originatingAgent, 'sovereign-commander'),
    observedAtUtc: text(input.observedAtUtc, new Date().toISOString()),
    scope,
    teacherParticipantId,
    studentParticipantId: 'sovereign-commander',
    pipeline: FLYWHEEL_CAPABILITY_GAP_PIPELINE_V1,
    acceptanceExam,
    evidenceRefs: Object.freeze(evidenceRefs),
    proofGate: 'LIVE_PROVEN',
    promotionAllowed: false,
    retryOriginalTaskAfterProof: true,
    canonicalOwnerGoals: Object.freeze(['#2573', '#1903']),
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
  });
}

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function safeLessonId(value) {
  const normalized = text(value)
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || '';
}

function reflectionText(candidate = {}) {
  const explicit = text(candidate.reflection);
  if (explicit) return explicit;
  const rootCause = text(candidate.rootCause, 'Root cause not recorded.');
  const method = text(candidate.repairOrMethod, 'No reusable method recorded.');
  return `Root cause: ${rootCause} Reusable method: ${method}`;
}

export function buildSharedEngineeringLessonFromEventV1(event = {}) {
  const candidate = event?.learningCandidate;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;

  const engineeringRecord = buildEngineeringIncidentMethodRecordV1({
    ...candidate,
    recordKey: text(candidate.recordKey, text(event.eventId)),
    observedAtUtc: text(candidate.observedAtUtc, text(event.timestampUtc)),
  });
  const lessonId = safeLessonId(
    candidate.lessonId
      || `lesson-${engineeringRecord.recordKey}`,
  );
  if (!lessonId) return null;

  return createSharedWorkspaceLessonRecord({
    lessonId,
    participantId: text(candidate.participantId, text(event.participantId, 'stephanos')),
    timestampUtc: text(candidate.lessonTimestampUtc, text(event.timestampUtc)),
    summary: text(candidate.summary, text(event.summary, 'Engineering lesson promoted from incident evidence.')),
    reflection: reflectionText(candidate),
    sourceEventIds: [text(event.eventId)].filter(Boolean),
    engineeringRecord,
  });
}

export async function promoteSharedWorkspaceLearningCandidatesV1(input = {}) {
  const repoRoot = input.repoRoot || process.cwd();
  const resolved = resolveSharedWorkspaceRuntimeConfig({
    root: input.root,
    env: input.env,
    repoRoot,
  });
  if (!resolved.ok) {
    return Object.freeze({
      schemaVersion: FLYWHEEL_LEARNING_FABRIC_SCHEMA_V1,
      ok: false,
      reason: resolved.reason,
      promotedLessonIds: Object.freeze([]),
      skippedLessonIds: Object.freeze([]),
      errors: Object.freeze([]),
      finalVerdict: 'FLYWHEEL_LEARNING_PROMOTION_UNAVAILABLE',
    });
  }

  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const [eventHistory, lessonHistory] = await Promise.all([
    readSharedWorkspaceRecordDirectory(resolved.root, 'events', { repoRoot, nowMs }),
    readSharedWorkspaceRecordDirectory(resolved.root, 'lessons', { repoRoot, nowMs }),
  ]);
  const existingLessonIds = new Set(
    list(lessonHistory?.records).map((record) => text(record?.lessonId)).filter(Boolean),
  );
  const maxPromotions = Number.isSafeInteger(input.maxPromotions)
    ? Math.max(1, Math.min(32, input.maxPromotions))
    : DEFAULT_LEARNING_PROMOTION_LIMIT_V1;
  const promotedLessonIds = [];
  const skippedLessonIds = [];
  const errors = [
    ...list(eventHistory?.errors),
    ...list(lessonHistory?.errors),
  ];

  for (const event of list(eventHistory?.records)) {
    if (promotedLessonIds.length >= maxPromotions) break;
    if (!event?.learningCandidate) continue;
    try {
      const lesson = buildSharedEngineeringLessonFromEventV1(event);
      if (!lesson) continue;
      if (existingLessonIds.has(lesson.lessonId)) {
        skippedLessonIds.push(lesson.lessonId);
        continue;
      }
      const write = await writeAtomicJson(
        resolved.root,
        ['lessons', `${lesson.lessonId}.json`],
        lesson,
        { repoRoot, nowMs },
      );
      if (!write.ok) {
        errors.push(`${lesson.lessonId}:${write.reason}`);
        continue;
      }
      existingLessonIds.add(lesson.lessonId);
      promotedLessonIds.push(lesson.lessonId);
    } catch (error) {
      errors.push(`${text(event?.eventId, 'unknown-event')}:${text(error?.message, 'promotion-failed')}`);
    }
  }

  return Object.freeze({
    schemaVersion: FLYWHEEL_LEARNING_FABRIC_SCHEMA_V1,
    ok: errors.length === 0,
    reason: errors.length ? 'LEARNING_PROMOTION_PARTIAL' : 'LEARNING_PROMOTION_COMPLETE',
    promotedLessonIds: Object.freeze(promotedLessonIds),
    skippedLessonIds: Object.freeze([...new Set(skippedLessonIds)]),
    errors: Object.freeze(errors),
    finalVerdict: errors.length
      ? 'FLYWHEEL_LEARNING_PROMOTION_DEGRADED'
      : 'FLYWHEEL_LEARNING_PROMOTION_READY',
  });
}
