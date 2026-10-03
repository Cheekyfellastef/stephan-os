import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SOVEREIGN_COMMANDER_CAPABILITY_COMPILER_SCHEMA,
  SOVEREIGN_COMMANDER_PRIMITIVE,
  compileSovereignCommanderCapabilityPlanV1,
} from './sovereignCommanderCapabilityCompilerV1.mjs';

test('compiler decomposes process parity into a guarded primitive recipe without arbitrary shell', () => {
  const result = compileSovereignCommanderCapabilityPlanV1({
    timestampUtc: '2026-10-02T14:30:00.000Z',
    capabilities: [{
      capabilityId: 'start-process',
      state: 'BUILDABLE_GAP',
      sovereignEquivalent: 'sovereign-start-process',
    }],
  });

  assert.equal(result.schemaVersion, SOVEREIGN_COMMANDER_CAPABILITY_COMPILER_SCHEMA);
  assert.equal(result.buildableCapabilityCount, 1);
  assert.equal(result.plans[0].primitive, SOVEREIGN_COMMANDER_PRIMITIVE.EXECUTE_GUARDED_PROCESS);
  assert.equal(result.plans[0].compilerAction, 'COMPOSE_GUARDED_RECIPE');
  assert.equal(result.plans[0].requiresKernelChange, false);
  assert.equal(result.plans[0].arbitraryShellAllowed, false);
  assert.equal(result.flywheelExam.length, 10);
  assert.equal(result.flywheelImprovementTargetCount, 1);
});

test('unknown capability proves a minimum primitive need instead of inventing a broad shell', () => {
  const result = compileSovereignCommanderCapabilityPlanV1({
    capabilities: [{
      capabilityId: 'future-widget-control',
      state: 'BUILDABLE_GAP',
    }],
  });
  assert.equal(result.plans[0].primitive, SOVEREIGN_COMMANDER_PRIMITIVE.COMPOSE_RECIPE);
  assert.equal(result.plans[0].requiresKernelChange, true);
  assert.equal(result.primitiveGapCount, 1);
  assert.match(result.plans[0].strategy, /add one new primitive/i);
});

test('only proven parity transitions become Flywheel learning candidates', () => {
  const result = compileSovereignCommanderCapabilityPlanV1({
    timestampUtc: '2026-10-02T14:30:00.000Z',
    capabilities: [
      {
        capabilityId: 'start-process',
        state: 'BUILDABLE_GAP',
        newlyProvenParity: false,
      },
      {
        capabilityId: 'read-file',
        state: 'PARITY_PRESENT',
        newlyProvenParity: true,
        sovereignEquivalent: 'read_file',
      },
      {
        capabilityId: 'arbitrary-shell',
        state: 'BOUNDARY_HOLD',
        newlyProvenParity: false,
      },
    ],
  });

  assert.equal(result.learningCandidates.length, 1);
  assert.equal(result.learningCandidates[0].recordClass, 'REUSABLE_METHOD');
  assert.equal(result.learningCandidates[0].recordKey, 'sovereign-capability-read-file');
  assert.match(result.learningCandidates[0].repairOrMethod, /read_file/);
  assert.equal(result.learningCandidates[0].status, 'CURRENT');
  assert.equal(result.arbitraryShellAllowed, false);
});
