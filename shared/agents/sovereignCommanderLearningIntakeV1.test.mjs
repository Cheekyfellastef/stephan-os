import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildFlywheelCapabilityGapCandidateV1,
} from './flywheelLearningFabricV1.mjs';
import {
  buildSovereignCommanderCapabilityGapProofRecordV1,
  classifySovereignCommanderFailureV1,
  reconcileSovereignCommanderCapabilityGapLearningV1,
  reportSovereignCommanderCapabilityGapV1,
  validateSovereignCommanderCapabilityGapProofV1,
} from './sovereignCommanderLearningIntakeV1.mjs';
import {
  ensureSharedWorkspaceLayout,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';

const GAP_TIME = '2026-10-02T23:20:00.000Z';
const PROOF_TIME = '2026-10-02T23:22:00.000Z';
const NOW_MS = Date.parse('2026-10-02T23:23:00.000Z');

test('Flywheel classifies landing-page failures as product-surface learning for OpenClaw Local', () => {
  const candidate = buildFlywheelCapabilityGapCandidateV1({
    task: 'Add a landing page tile and workspace for Stephanos AI',
    failureClass: 'CANNOT_DISCOVER_SURFACE',
    originatingAgent: 'chatgpt',
    scope: 'STEPHANOS_PROJECT',
    evidenceRefs: ['pr:#2645'],
    observedAtUtc: GAP_TIME,
  });

  assert.equal(candidate.problemClass, 'PRODUCT_SURFACE_DISCOVERY_AND_MUTATION');
  assert.equal(candidate.teacherParticipantId, 'openclaw-local');
  assert.equal(candidate.studentParticipantId, 'sovereign-commander');
  assert.deepEqual(candidate.pipeline, [
    'discover-product-surface',
    'understand-registration-model',
    'plan-bounded-change',
    'mutate',
    'build',
    'verify-runtime',
    'prove-live',
  ]);
  assert.equal(candidate.proofGate, 'LIVE_PROVEN');
  assert.equal(candidate.promotionAllowed, false);
  assert.match(candidate.acceptanceExam, /landing|workspace|tile/i);
});

test('failure classifier translates real executor blockers without learning ordinary approval holds', () => {
  assert.equal(classifySovereignCommanderFailureV1({ blocker: 'UNKNOWN_TOOL' }), 'CAPABILITY_MISSING');
  assert.equal(classifySovereignCommanderFailureV1({ blocker: 'ENOENT' }), 'PATH_UNKNOWN');
  assert.equal(
    classifySovereignCommanderFailureV1({ blocker: 'sovereign-commander-process-not-registered' }),
    'UNSUPPORTED_OPERATION',
  );
  assert.equal(
    classifySovereignCommanderFailureV1({ blocker: 'sovereign-commander-operation-not-registered' }),
    'UNSUPPORTED_OPERATION',
  );
  assert.equal(classifySovereignCommanderFailureV1({ blocker: 'APPROVAL_REQUIRED' }), '');
});

async function capturedGap(root) {
  const captured = await reportSovereignCommanderCapabilityGapV1({
    root,
    repoRoot: process.cwd(),
    task: 'Add a landing page tile and workspace for Stephanos AI',
    failureClass: 'CANNOT_DISCOVER_SURFACE',
    originatingAgent: 'chatgpt',
    evidenceRefs: ['pr:#2645'],
    timestampUtc: GAP_TIME,
  });
  assert.equal(captured.ok, true);
  return captured;
}

test('learning intake remains a candidate when canonical Battle Bridge proof is absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sovereign-learning-intake-'));
  try {
    const layout = await ensureSharedWorkspaceLayout({ root, repoRoot: process.cwd() });
    assert.equal(layout.ok, true);
    const captured = await capturedGap(root);
    const reconciled = await reconcileSovereignCommanderCapabilityGapLearningV1({
      root,
      repoRoot: process.cwd(),
      nowMs: NOW_MS,
      timestampUtc: new Date(NOW_MS).toISOString(),
    });
    assert.equal(reconciled.ok, true);
    assert.deepEqual(reconciled.promotedCandidateIds, []);
    assert.deepEqual(reconciled.heldCandidateIds, [captured.candidate.candidateId]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('caller labels and arbitrary refs cannot masquerade as canonical LIVE_PROVEN evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sovereign-learning-spoof-'));
  try {
    await ensureSharedWorkspaceLayout({ root, repoRoot: process.cwd() });
    const captured = await capturedGap(root);
    const fake = buildSovereignCommanderCapabilityGapProofRecordV1({
      gapCandidate: captured.candidate,
      sourceGapEventId: captured.eventId,
      timestampUtc: PROOF_TIME,
      executionProofHash: 'not-a-proof-hash',
      sourceHead: 'not-a-source-head',
    });
    const validation = validateSovereignCommanderCapabilityGapProofV1({
      gapEvent: {
        eventId: captured.eventId,
        timestampUtc: GAP_TIME,
        capabilityGapCandidate: captured.candidate,
      },
      proofRecord: fake,
      nowMs: NOW_MS,
    });
    assert.equal(validation.ok, false);
    assert.ok(validation.errors.includes('EXECUTION_PROOF_HASH_INVALID'));
    assert.ok(validation.errors.includes('SOURCE_HEAD_INVALID'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('fresh canonical Battle Bridge proof bound to the exact gap becomes a promotable Flywheel event', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sovereign-learning-proof-'));
  try {
    await ensureSharedWorkspaceLayout({ root, repoRoot: process.cwd() });
    const captured = await capturedGap(root);
    const proof = buildSovereignCommanderCapabilityGapProofRecordV1({
      gapCandidate: captured.candidate,
      sourceGapEventId: captured.eventId,
      timestampUtc: PROOF_TIME,
      executionProofHash: 'e'.repeat(64),
      sourceHead: 'a'.repeat(40),
    });
    const proofWrite = await writeAtomicJson(
      root,
      ['proof', `${proof.proofId}.json`],
      proof,
      { repoRoot: process.cwd(), nowMs: Date.parse(PROOF_TIME) },
    );
    assert.equal(proofWrite.ok, true);

    const reconciled = await reconcileSovereignCommanderCapabilityGapLearningV1({
      root,
      repoRoot: process.cwd(),
      nowMs: NOW_MS,
      timestampUtc: new Date(NOW_MS).toISOString(),
    });
    assert.equal(reconciled.ok, true);
    assert.deepEqual(reconciled.promotedCandidateIds, [captured.candidate.candidateId]);
    assert.deepEqual(reconciled.heldCandidateIds, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('proof for another gap cannot promote this candidate', async () => {
  const candidate = buildFlywheelCapabilityGapCandidateV1({
    task: 'Different task',
    failureClass: 'CAPABILITY_MISSING',
    observedAtUtc: GAP_TIME,
  });
  const wrongGap = buildFlywheelCapabilityGapCandidateV1({
    task: 'Another unrelated task',
    failureClass: 'CAPABILITY_MISSING',
    observedAtUtc: GAP_TIME,
  });
  const proof = buildSovereignCommanderCapabilityGapProofRecordV1({
    gapCandidate: wrongGap,
    sourceGapEventId: 'sovereign-gap-wrong',
    timestampUtc: PROOF_TIME,
    executionProofHash: 'f'.repeat(64),
    sourceHead: 'b'.repeat(40),
  });
  const validation = validateSovereignCommanderCapabilityGapProofV1({
    gapEvent: {
      eventId: 'sovereign-gap-right',
      timestampUtc: GAP_TIME,
      capabilityGapCandidate: candidate,
    },
    proofRecord: proof,
    nowMs: NOW_MS,
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes('GAP_CANDIDATE_BINDING_MISMATCH'));
  assert.ok(validation.errors.includes('GAP_EVENT_BINDING_MISMATCH'));
  assert.ok(validation.errors.includes('GAP_ORIGINAL_TASK_HASH_MISMATCH'));
});
