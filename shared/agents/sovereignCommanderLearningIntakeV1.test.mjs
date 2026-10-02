import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildFlywheelCapabilityGapCandidateV1,
} from './flywheelLearningFabricV1.mjs';
import {
  classifySovereignCommanderFailureV1,
  promoteProvenSovereignCommanderCapabilityGapV1,
  reportSovereignCommanderCapabilityGapV1,
} from './sovereignCommanderLearningIntakeV1.mjs';
import { ensureSharedWorkspaceLayout } from './sharedAgentWorkspaceStore.mjs';

test('Flywheel classifies landing-page failures as product-surface learning for OpenClaw Local', () => {
  const candidate = buildFlywheelCapabilityGapCandidateV1({
    task: 'Add a landing page tile and workspace for Stephanos AI',
    failureClass: 'CANNOT_DISCOVER_SURFACE',
    originatingAgent: 'chatgpt',
    scope: 'STEPHANOS_PROJECT',
    evidenceRefs: ['pr:#2645'],
    observedAtUtc: '2026-10-02T23:20:00.000Z',
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

test('failure classifier captures capability failures but not ordinary approval holds', () => {
  assert.equal(classifySovereignCommanderFailureV1({ blocker: 'UNKNOWN_TOOL' }), 'CAPABILITY_MISSING');
  assert.equal(classifySovereignCommanderFailureV1({ blocker: 'PATH_UNKNOWN' }), 'PATH_UNKNOWN');
  assert.equal(classifySovereignCommanderFailureV1({ blocker: 'APPROVAL_REQUIRED' }), '');
});


test('learning intake persists a candidate and refuses durable promotion before LIVE_PROVEN', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sovereign-learning-intake-'));
  try {
    const layout = await ensureSharedWorkspaceLayout({ root, repoRoot: process.cwd() });
    assert.equal(layout.ok, true);
    const captured = await reportSovereignCommanderCapabilityGapV1({
      root,
      repoRoot: process.cwd(),
      task: 'Add a landing page tile and workspace for Stephanos AI',
      failureClass: 'CANNOT_DISCOVER_SURFACE',
      originatingAgent: 'chatgpt',
      evidenceRefs: ['pr:#2645'],
      timestampUtc: '2026-10-02T23:20:00.000Z',
    });
    assert.equal(captured.ok, true);
    assert.equal(captured.captured, true);
    assert.equal(captured.candidate.teacherParticipantId, 'openclaw-local');

    const held = await promoteProvenSovereignCommanderCapabilityGapV1({
      root,
      repoRoot: process.cwd(),
      gapCandidate: captured.candidate,
      proofState: 'BUILT',
      proofRefs: ['pr:#2645'],
      runtimeEvidenceRefs: [],
      timestampUtc: '2026-10-02T23:21:00.000Z',
    });
    assert.equal(held.ok, false);
    assert.equal(held.blocker, 'LIVE_PROVEN_RUNTIME_EVIDENCE_REQUIRED');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
