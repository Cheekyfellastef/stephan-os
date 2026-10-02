import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import {
  buildFlywheelCapabilityGapCandidateV1,
} from './flywheelLearningFabricV1.mjs';
import {
  SHARED_WORKSPACE_RECORD_KINDS,
  SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceProofRecord,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';
import {
  resolveSharedWorkspaceRuntimeConfig,
} from './sharedWorkspaceRuntimeConfig.mjs';

export const SOVEREIGN_COMMANDER_LEARNING_INTAKE_SCHEMA_V1 =
  'stephanos.sovereign-commander-learning-intake.v1';
export const SOVEREIGN_COMMANDER_CAPABILITY_GAP_PROOF_VERDICT_V1 =
  'SOVEREIGN_COMMANDER_CAPABILITY_GAP_LIVE_PROVEN';

export const SOVEREIGN_COMMANDER_LEARNING_FAILURE_CLASSES_V1 = Object.freeze([
  'PATH_UNKNOWN',
  'CAPABILITY_MISSING',
  'CANNOT_DISCOVER_SURFACE',
  'NO_VERIFICATION_METHOD',
  'UNSUPPORTED_OPERATION',
]);

const FAILURE_CLASS_SET = new Set(SOVEREIGN_COMMANDER_LEARNING_FAILURE_CLASSES_V1);
const PROOF_HASH = /^[0-9a-f]{64}$/i;
const SOURCE_HEAD = /^[0-9a-f]{40}$/i;
const MAX_RECORD_FILES = 512;
const DEFAULT_PROOF_FRESHNESS_MS = 24 * 60 * 60 * 1000;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function sha256(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function safeFailureClass(value) {
  const raw = text(value);
  const normalized = raw.toUpperCase();
  if (FAILURE_CLASS_SET.has(normalized)) return normalized;
  if (normalized === 'UNKNOWN_TOOL') return 'CAPABILITY_MISSING';
  if (
    normalized === 'ENOENT'
    || /(?:PATH|FILE|DIRECTORY).*(?:NOT[-_ ]?FOUND|MISSING)/i.test(raw)
    || /(?:READ|WRITE|EDIT|LIST).*(?:ABSOLUTE[-_ ]?TARGET|TARGET.*REQUIRED)/i.test(raw)
    || /EDIT-OLD-STRING-NOT-FOUND/i.test(raw)
  ) return 'PATH_UNKNOWN';
  if (
    /PROCESS-NOT-REGISTERED/i.test(raw)
    || /OPERATION-NOT-REGISTERED/i.test(raw)
    || /UNSUPPORTED/i.test(raw)
    || /NODE-TEST-DISABLED/i.test(raw)
    || /WINDOWS_REQUIRED/i.test(raw)
  ) return 'UNSUPPORTED_OPERATION';
  if (/SURFACE.*(?:UNAVAILABLE|UNKNOWN|UNPROVEN)/i.test(raw)) return 'CAPABILITY_MISSING';
  if (/VERIFY|VERIFICATION|PROOF.*(?:MISSING|UNAVAILABLE|UNPROVEN)/i.test(raw)) return 'NO_VERIFICATION_METHOD';
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
  const digest = createHash('sha256')
    .update(JSON.stringify({
      task: candidate.originalTask,
      failureClass: candidate.failureClass,
      problemClass: candidate.problemClass,
      originatingAgent: candidate.originatingAgent,
    }))
    .digest('hex')
    .slice(0, 24);
  return `sovereign-gap-${digest}`;
}

function proofIdFor(candidate) {
  return `sovereign-gap-proof-${sha256(candidate?.candidateId).slice(0, 24)}`;
}

function learningCandidateFor(gap, canonicalProof, timestampUtc) {
  const proofRef = `proof/${canonicalProof.proofId}.json`;
  return Object.freeze({
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
      'Require deterministic self-test and canonical Battle Bridge runtime proof.',
    ]),
    forbiddenShortcuts: Object.freeze([
      'Do not promote source-only or unit-only proof.',
      'Do not trust caller-supplied LIVE_PROVEN labels or arbitrary proof references.',
      'Do not expose unbounded process execution or broaden merge authority.',
    ]),
    failureModes: Object.freeze([
      'Capability exists only as a bespoke one-off verb.',
      'Runtime proof is absent, stale, unbound, or fabricated.',
    ]),
    counterexamples: Object.freeze([
      'A successful source edit without canonical served/runtime proof is not LIVE_PROVEN.',
    ]),
    testAndProofRefs: Object.freeze([proofRef]),
    runtimeEvidenceRefs: Object.freeze([proofRef]),
    confidenceBasis: 'Promotion is derived from a fresh canonical Shared Workspace Battle Bridge proof bound to the exact gap candidate and original task hash.',
    freshness: 'CURRENT',
    applicableDomains: Object.freeze(['sovereign-commander', text(gap.problemClass).toLowerCase()]),
    privacyAndSensitivity: 'INTERNAL_BOUNDED',
    status: 'CURRENT',
  });
}

async function readJsonRecords(directory) {
  let names = [];
  try {
    names = (await readdir(directory))
      .filter((name) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,140}\.json$/.test(name))
      .slice(0, MAX_RECORD_FILES);
  } catch {
    return [];
  }
  const records = [];
  for (const name of names) {
    try {
      const record = JSON.parse(await readFile(join(directory, name), 'utf8'));
      if (record && typeof record === 'object' && !Array.isArray(record)) {
        records.push({ name, record });
      }
    } catch {}
  }
  return records;
}

export function classifySovereignCommanderFailureV1(result = {}) {
  return safeFailureClass(
    result.failureClass
      || result.blocker
      || result.reason
      || result.finalVerdict,
  );
}

export function buildSovereignCommanderCapabilityGapProofRecordV1(input = {}) {
  const gap = input.gapCandidate || {};
  const sourceGapEventId = text(input.sourceGapEventId);
  const timestampUtc = text(input.timestampUtc, new Date().toISOString());
  const proofId = proofIdFor(gap);
  const proofRef = `proof/${proofId}.json`;
  const proofHash = text(input.executionProofHash).toLowerCase();
  const sourceHead = text(input.sourceHead).toLowerCase();
  return Object.freeze({
    ...createSharedWorkspaceProofRecord({
      proofId,
      participantId: 'sovereign-commander',
      timestampUtc,
      correlationId: text(gap.candidateId),
      relatedIssue: '#2573',
      status: 'LIVE_PROVEN',
      summary: `Canonical Battle Bridge capability-gap proof for ${text(gap.problemClass, 'unknown-gap')}.`,
      refs: [proofRef],
      proofRefs: [proofRef],
    }),
    capabilityGapCandidateId: text(gap.candidateId),
    sourceGapEventId,
    problemClass: text(gap.problemClass),
    originalTaskHash: sha256(text(gap.originalTask)),
    executionProofHash: proofHash,
    sourceHead,
    runtimeSurface: 'BATTLE_BRIDGE',
    runtimeProven: true,
    proofState: 'LIVE_PROVEN',
    finalVerdict: SOVEREIGN_COMMANDER_CAPABILITY_GAP_PROOF_VERDICT_V1,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
  });
}

export function validateSovereignCommanderCapabilityGapProofV1({
  gapEvent,
  proofRecord,
  nowMs = Date.now(),
  proofFreshnessMs = DEFAULT_PROOF_FRESHNESS_MS,
} = {}) {
  const gap = gapEvent?.capabilityGapCandidate;
  const errors = [];
  if (!gap || typeof gap !== 'object') errors.push('GAP_CANDIDATE_REQUIRED');
  const workspaceValidation = validateSharedWorkspaceRecord(proofRecord || {}, {
    nowMs,
    staleAfterMs: proofFreshnessMs,
  });
  if (!workspaceValidation.valid || workspaceValidation.stale) errors.push('CANONICAL_PROOF_RECORD_INVALID_OR_STALE');
  if (proofRecord?.schemaVersion !== SHARED_WORKSPACE_RECORD_SCHEMA_VERSION) errors.push('CANONICAL_PROOF_SCHEMA_INVALID');
  if (proofRecord?.kind !== SHARED_WORKSPACE_RECORD_KINDS.PROOF) errors.push('CANONICAL_PROOF_KIND_INVALID');
  if (text(proofRecord?.participantId) !== 'sovereign-commander') errors.push('CANONICAL_PROOF_PARTICIPANT_INVALID');
  if (text(proofRecord?.status).toUpperCase() !== 'LIVE_PROVEN') errors.push('CANONICAL_PROOF_STATUS_INVALID');
  if (proofRecord?.runtimeSurface !== 'BATTLE_BRIDGE' || proofRecord?.runtimeProven !== true) errors.push('BATTLE_BRIDGE_RUNTIME_PROOF_REQUIRED');
  if (proofRecord?.finalVerdict !== SOVEREIGN_COMMANDER_CAPABILITY_GAP_PROOF_VERDICT_V1) errors.push('CANONICAL_PROOF_VERDICT_INVALID');
  if (text(proofRecord?.capabilityGapCandidateId) !== text(gap?.candidateId)) errors.push('GAP_CANDIDATE_BINDING_MISMATCH');
  if (text(proofRecord?.correlationId) !== text(gap?.candidateId)) errors.push('GAP_CORRELATION_MISMATCH');
  if (text(proofRecord?.sourceGapEventId) !== text(gapEvent?.eventId)) errors.push('GAP_EVENT_BINDING_MISMATCH');
  if (text(proofRecord?.problemClass) !== text(gap?.problemClass)) errors.push('GAP_PROBLEM_CLASS_MISMATCH');
  if (text(proofRecord?.originalTaskHash).toLowerCase() !== sha256(text(gap?.originalTask))) errors.push('GAP_ORIGINAL_TASK_HASH_MISMATCH');
  if (!PROOF_HASH.test(text(proofRecord?.executionProofHash))) errors.push('EXECUTION_PROOF_HASH_INVALID');
  if (!SOURCE_HEAD.test(text(proofRecord?.sourceHead))) errors.push('SOURCE_HEAD_INVALID');
  const gapMs = Date.parse(text(gapEvent?.timestampUtc || gap?.observedAtUtc));
  const proofMs = Date.parse(text(proofRecord?.timestampUtc));
  if (!Number.isFinite(gapMs) || !Number.isFinite(proofMs) || proofMs < gapMs) errors.push('PROOF_PREDATES_GAP');
  if (!Number.isFinite(proofMs) || proofMs > nowMs + 60_000) errors.push('PROOF_TIMESTAMP_INVALID');
  if (Number.isFinite(proofMs) && nowMs - proofMs > proofFreshnessMs) errors.push('PROOF_TOO_OLD');
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze([...new Set(errors)]),
    finalVerdict: errors.length === 0
      ? 'SOVEREIGN_COMMANDER_CAPABILITY_GAP_PROOF_VALID'
      : 'SOVEREIGN_COMMANDER_CAPABILITY_GAP_PROOF_BLOCKED',
  });
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
    canonicalProofId: proofIdFor(candidate),
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

export async function reconcileSovereignCommanderCapabilityGapLearningV1(input = {}) {
  const repoRoot = resolve(input.repoRoot || process.cwd());
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const timestampUtc = text(input.timestampUtc, new Date(nowMs).toISOString());
  const resolved = resolveSharedWorkspaceRuntimeConfig({
    root: input.root,
    env: input.env,
    repoRoot,
  });
  if (!resolved.ok) {
    return Object.freeze({
      schemaVersion: SOVEREIGN_COMMANDER_LEARNING_INTAKE_SCHEMA_V1,
      ok: false,
      promotedCandidateIds: Object.freeze([]),
      blocker: resolved.reason,
      finalVerdict: 'SOVEREIGN_COMMANDER_LEARNING_RECONCILIATION_BLOCKED',
    });
  }

  const [eventEntries, proofEntries] = await Promise.all([
    readJsonRecords(join(resolved.root, 'events')),
    readJsonRecords(join(resolved.root, 'proof')),
  ]);
  const alreadyProven = new Set(eventEntries
    .map(({ record }) => record)
    .filter((event) => event?.eventKind === 'capability-gap-proven')
    .map((event) => text(event?.sourceGapCandidateId))
    .filter(Boolean));
  const proofs = proofEntries.map(({ record }) => record);
  const promotedCandidateIds = [];
  const heldCandidateIds = [];
  const writes = [];
  for (const { record: gapEvent } of eventEntries) {
    const gap = gapEvent?.capabilityGapCandidate;
    if (gapEvent?.eventKind !== 'capability-gap' || !gap?.candidateId) continue;
    if (alreadyProven.has(gap.candidateId)) continue;
    const canonicalProofId = proofIdFor(gap);
    const proofRecord = proofs.find((proof) => text(proof?.proofId) === canonicalProofId);
    if (!proofRecord) {
      heldCandidateIds.push(gap.candidateId);
      continue;
    }
    const validation = validateSovereignCommanderCapabilityGapProofV1({
      gapEvent,
      proofRecord,
      nowMs,
      proofFreshnessMs: input.proofFreshnessMs,
    });
    if (!validation.ok) {
      heldCandidateIds.push(gap.candidateId);
      continue;
    }
    const learningCandidate = learningCandidateFor(gap, proofRecord, timestampUtc);
    const provenEventId = `${eventIdFor(gap)}-proven`.slice(0, 80);
    const provenEvent = Object.freeze({
      ...createSharedWorkspaceEventRecord({
        eventId: provenEventId,
        participantId: 'sovereign-commander',
        timestampUtc,
        eventKind: 'capability-gap-proven',
        summary: `Sovereign Commander proved ${text(gap.problemClass)} against the original failed task.`,
        learningCandidate,
      }),
      sourceGapCandidateId: text(gap.candidateId),
      sourceGapEventId: text(gapEvent.eventId),
      canonicalProofId: text(proofRecord.proofId),
      proofState: 'LIVE_PROVEN',
      promotionAllowed: true,
      mergeAuthority: false,
      runtimeMutationAuthority: false,
      arbitraryShellAllowed: false,
    });
    const write = await (input.writeEvent || writeAtomicJson)(
      resolved.root,
      ['events', `${provenEventId}.json`],
      provenEvent,
      { repoRoot, nowMs },
    );
    writes.push(write);
    if (write?.ok === true) {
      promotedCandidateIds.push(gap.candidateId);
      alreadyProven.add(gap.candidateId);
    } else {
      heldCandidateIds.push(gap.candidateId);
    }
  }

  const ok = writes.every((write) => write?.ok === true);
  return Object.freeze({
    schemaVersion: SOVEREIGN_COMMANDER_LEARNING_INTAKE_SCHEMA_V1,
    ok,
    promotedCandidateIds: Object.freeze(promotedCandidateIds),
    heldCandidateIds: Object.freeze([...new Set(heldCandidateIds)]),
    writes: Object.freeze(writes),
    finalVerdict: ok
      ? 'SOVEREIGN_COMMANDER_LEARNING_CANDIDATES_RECONCILED'
      : 'SOVEREIGN_COMMANDER_LEARNING_RECONCILIATION_DEGRADED',
  });
}
