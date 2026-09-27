import {
  readSharedWorkspaceDashboardFeed,
  SHARED_WORKSPACE_FEED_RECORD_SCOPES,
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
  const feed = await readSharedWorkspaceDashboardFeed({
    root: resolved.root,
    repoRoot,
    nowMs,
    recordScope: SHARED_WORKSPACE_FEED_RECORD_SCOPES.FULL_HISTORY,
  });
  const existingLessonIds = new Set(
    list(feed?.records?.lessonRecords).map((record) => text(record?.lessonId)).filter(Boolean),
  );
  const maxPromotions = Number.isSafeInteger(input.maxPromotions)
    ? Math.max(1, Math.min(32, input.maxPromotions))
    : DEFAULT_LEARNING_PROMOTION_LIMIT_V1;
  const promotedLessonIds = [];
  const skippedLessonIds = [];
  const errors = [];

  for (const event of list(feed?.records?.eventRecords)) {
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
