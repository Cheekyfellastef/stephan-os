import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  buildFlywheelCapabilityGapCandidateV1,
  promoteSharedWorkspaceLearningCandidatesV1,
} from './flywheelLearningFabricV1.mjs';
import {
  createSharedWorkspaceEventRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';
import {
  resolveSharedWorkspaceRuntimeConfig,
} from './sharedWorkspaceRuntimeConfig.mjs';

export const SOVEREIGN_COMMANDER_LEARNING_INTAKE_SCHEMA_V1 =
  'stephanos.sovereign-commander-learning-intake.v1';

export const SOVEREIGN_COMMANDER_LEARNING_FAILURE_CLASSES_V1 = Object.freeze([
  'PATH_UNKNOWN',
  'CAPABILITY_MISSING',
  'CANNOT_DISCOVER_SURFACE',
  'NO_VERIFICATION_METHOD',
  'UNSUPPORTED_OPERATION',
]);

const FAILURE_CLASS_SET = new Set(SOVEREIGN_COMMANDER_LEARNING_FAILURE_CLASSES_V1);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function safeFailureClass(value) {
  const normalized = text(value).toUpperCase();
  if (FAILURE_CLASS_SET.has(normalized)) return normalized;
  if (normalized === 'UNKNOWN_TOOL') return 'CAPABILITY_MISSING';
  return '';
}

function isWithin(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

function inferScope(input = {}) {
  const explicit = text(input.scope).toUpperCase();
  if (['STEPHANOS_PROJECT', 'WHOLE_PC'].includes(explicit)) return explicit;
  const repoRoot = resolve(input.repoRoot || process.cwd());
  const targets = list(input.targetPaths)
    .map((target) => {
      try { return resolve(target); } catch { return ''; }
    })
    .filter(Boolean);
  if (targets.some((target) => !isWithin(repoRoot, target))) return 'WHOLE_PC';
  return 'STEPHANOS_PROJECT';
}

function eventIdFor(candidate) {
  const hash = createHash('sha256')
    .update(JSON.stringify({
      task: candidate.originalTask,
      failureClass: candidate.failureClass,
      problemClass: candidate.problemClass,
      originatingAgent: candidate.originatingAgent,
    }))
    .digest('hex')
    .slice(0, 24);
  return `sovereign-gap-${hash}`;
}

export function classifySovereignCommanderFailureV1(result = {}) {
  return safeFailureClass(
    result.failureClass
      || result.blocker
      || result.reason
      || result.finalVerdict,
  );
}

export async function reportSovereignCommanderCapabilityGapV1(input = {}) {
  const repoRoot = resolve(input.repoRoot || process.cwd());
  const failureClass = safeFailureClass(input.failureClass);
  const task = text(input.task);
  const timestampUtc = text(input.timestampUtc, new Date().toISOString());
  if (!failureClass || !task) {
    return Object.freeze({
      schemaVersion: SOVEREIGN_COMMANDER_LEARNING_INTAKE_SCHEMA_V1,
      ok: false,
      captured: false,
      blocker: !failureClass ? 'LEARNING_FAILURE_CLASS_NOT_ELIGIBLE' : 'LEARNING_TASK_REQUIRED',
      finalVerdict: 'SOVEREIGN_COMMANDER_LEARNING_INTAKE_BLOCKED',
    });
  }

  const resolved = resolveSharedWorkspaceRuntimeConfig({
    root: input.root,
    env: input.env,
    repoRoot,
  });
  if (!resolved.ok) {
    return Object.freeze({
      schemaVersion: SOVEREIGN_COMMANDER_LEARNING_INTAKE_SCHEMA_V1,
      ok: false,
      captured: false,
      blocker: resolved.reason,
      finalVerdict: 'SOVEREIGN_COMMANDER_LEARNING_INTAKE_BLOCKED',
    });
  }

  const candidate = buildFlywheelCapabilityGapCandidateV1({
    task,
    failureClass,
    summary: text(input.summary, `Sovereign Commander could not complete: ${task}`),
    originatingAgent: text(input.originatingAgent, 'sovereign-commander'),
    scope: inferScope({ ...input, repoRoot }),
    evidenceRefs: list(input.evidenceRefs),
    observedAtUtc: timestampUtc,
  });
  const eventId = eventIdFor(candidate);
  const event = Object.freeze({
    ...createSharedWorkspaceEventRecord({
      eventId,
      participantId: 'sovereign-commander',
      timestampUtc,
      eventKind: 'capability-gap',
      summary: candidate.summary,
    }),
    capabilityGapCandidate: candidate,
    flywheelReviewRequired: true,
    learningState: 'CANDIDATE',
    promotionAllowed: false,
    canonicalOwnerGoal: '#2573',
    selfImprovementOwnerGoal: '#1903',
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
  });

  const writer = input.writeEvent || writeAtomicJson;
  const publication = await writer(
    resolved.root,
    ['events', `${eventId}.json`],
    event,
    { repoRoot, nowMs: Date.parse(timestampUtc) },
  );
  return Object.freeze({
    schemaVersion: SOVEREIGN_COMMANDER_LEARNING_INTAKE_SCHEMA_V1,
    ok: publication?.ok === true,
    captured: publication?.ok === true,
    eventId,
    candidate,
    publication,
    finalVerdict: publication?.ok === true
      ? 'SOVEREIGN_COMMANDER_CAPABILITY_GAP_CAPTURED'
      : 'SOVEREIGN_COMMANDER_LEARNING_INTAKE_BLOCKED',
  });
}

export async function maybeReportSovereignCommanderFailureV1(input = {}) {
  const failureClass = classifySovereignCommanderFailureV1(input.result);
  if (!failureClass) {
    return Object.freeze({
      schemaVersion: SOVEREIGN_COMMANDER_LEARNING_INTAKE_SCHEMA_V1,
      ok: true,
      captured: false,
      reason: 'FAILURE_NOT_LEARNING_ELIGIBLE',
      finalVerdict: 'SOVEREIGN_COMMANDER_LEARNING_INTAKE_NOT_REQUIRED',
    });
  }
  return reportSovereignCommanderCapabilityGapV1({
    ...input,
    failureClass,
    summary: text(input.summary, text(input.result?.blocker || input.result?.reason || input.result?.finalVerdict)),
  });
}

export async function promoteProvenSovereignCommanderCapabilityGapV1(input = {}) {
  const gap = input.gapCandidate;
  const proofRefs = list(input.proofRefs);
  const runtimeEvidenceRefs = list(input.runtimeEvidenceRefs);
  if (!gap || input.proofState !== 'LIVE_PROVEN' || proofRefs.length === 0 || runtimeEvidenceRefs.length === 0) {
    return Object.freeze({
      schemaVersion: SOVEREIGN_COMMANDER_LEARNING_INTAKE_SCHEMA_V1,
      ok: false,
      promoted: false,
      blocker: 'LIVE_PROVEN_RUNTIME_EVIDENCE_REQUIRED',
      finalVerdict: 'SOVEREIGN_COMMANDER_LEARNING_PROMOTION_HELD',
    });
  }

  const repoRoot = resolve(input.repoRoot || process.cwd());
  const timestampUtc = text(input.timestampUtc, new Date().toISOString());
  const resolved = resolveSharedWorkspaceRuntimeConfig({
    root: input.root,
    env: input.env,
    repoRoot,
  });
  if (!resolved.ok) {
    return Object.freeze({
      schemaVersion: SOVEREIGN_COMMANDER_LEARNING_INTAKE_SCHEMA_V1,
      ok: false,
      promoted: false,
      blocker: resolved.reason,
      finalVerdict: 'SOVEREIGN_COMMANDER_LEARNING_PROMOTION_HELD',
    });
  }

  const learningCandidate = Object.freeze({
    lessonId: `sovereign-${text(gap.problemClass, 'capability-gap').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 58)}`,
    recordKey: text(gap.candidateId, 'sovereign-capability-gap'),
    participantId: 'sovereign-commander',
    recordClass: 'REUSABLE_METHOD',
    problemClass: text(gap.problemClass, 'sovereign-capability-gap'),
    componentAndOwnerRefs: Object.freeze(['#2573', '#1903']),
    observedAtUtc: timestampUtc,
    rootCause: `Sovereign Commander lacked a reusable capability for ${text(gap.originalTask)}.`,
    repairOrMethod: `Use the proven guarded pipeline: ${list(gap.pipeline).join(' -> ')}.`,
    prerequisites: Object.freeze([
      'Retain existing authority boundaries.',
      'Require deterministic self-test and Battle Bridge runtime proof.',
    ]),
    forbiddenShortcuts: Object.freeze([
      'Do not promote source-only or unit-only proof.',
      'Do not expose unbounded process execution or broaden merge authority.',
    ]),
    failureModes: Object.freeze([
      'Capability exists only as a bespoke one-off verb.',
      'Runtime proof is absent or stale.',
    ]),
    counterexamples: Object.freeze([
      'A successful source edit without served-runtime proof is not LIVE_PROVEN.',
    ]),
    testAndProofRefs: Object.freeze(proofRefs),
    runtimeEvidenceRefs: Object.freeze(runtimeEvidenceRefs),
    confidenceBasis: 'Promotion requires LIVE_PROVEN evidence against the original failed task.',
    freshness: 'CURRENT',
    applicableDomains: Object.freeze(['sovereign-commander', text(gap.problemClass).toLowerCase()]),
    privacyAndSensitivity: 'INTERNAL_BOUNDED',
    status: 'CURRENT',
  });
  const eventId = `${eventIdFor(gap)}-proven`.slice(0, 80);
  const event = Object.freeze({
    ...createSharedWorkspaceEventRecord({
      eventId,
      participantId: 'sovereign-commander',
      timestampUtc,
      eventKind: 'capability-gap-proven',
      summary: `Sovereign Commander proved ${text(gap.problemClass)} against the original failed task.`,
      learningCandidate,
    }),
    sourceGapCandidateId: text(gap.candidateId),
    proofState: 'LIVE_PROVEN',
    promotionAllowed: true,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
  });
  const writer = input.writeEvent || writeAtomicJson;
  const publication = await writer(
    resolved.root,
    ['events', `${eventId}.json`],
    event,
    { repoRoot, nowMs: Date.parse(timestampUtc) },
  );
  if (publication?.ok !== true) {
    return Object.freeze({
      schemaVersion: SOVEREIGN_COMMANDER_LEARNING_INTAKE_SCHEMA_V1,
      ok: false,
      promoted: false,
      blocker: text(publication?.reason, 'LEARNING_EVENT_PUBLICATION_FAILED'),
      publication,
      finalVerdict: 'SOVEREIGN_COMMANDER_LEARNING_PROMOTION_HELD',
    });
  }
  const promote = input.promoteLearning || promoteSharedWorkspaceLearningCandidatesV1;
  const promotion = await promote({
    root: resolved.root,
    repoRoot,
    nowMs: Date.parse(timestampUtc),
    maxPromotions: 8,
  });
  return Object.freeze({
    schemaVersion: SOVEREIGN_COMMANDER_LEARNING_INTAKE_SCHEMA_V1,
    ok: promotion?.ok === true,
    promoted: Array.isArray(promotion?.promotedLessonIds) && promotion.promotedLessonIds.length > 0,
    eventId,
    publication,
    promotion,
    finalVerdict: promotion?.ok === true
      ? 'SOVEREIGN_COMMANDER_LEARNING_PROMOTION_COMPLETE'
      : 'SOVEREIGN_COMMANDER_LEARNING_PROMOTION_DEGRADED',
  });
}
