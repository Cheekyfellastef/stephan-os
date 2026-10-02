import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFlywheelCapabilityGapCandidateV1,
} from './flywheelLearningFabricV1.mjs';
import {
  classifySovereignCommanderFailureV1,
} from './sovereignCommanderLearningIntakeV1.mjs';

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
