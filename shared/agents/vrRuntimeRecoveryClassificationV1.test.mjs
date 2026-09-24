import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VR_RUNTIME_RECOVERY_NEXT_ACTIONS,
  VR_RUNTIME_RECOVERY_VERDICTS,
  classifyVrRuntimeRecoveryEvidenceV1,
} from './vrRuntimeRecoveryClassificationV1.mjs';

function evidence(overrides = {}) {
  return {
    vrRunId: 'starfield-vr-run-0001',
    machineVerdict: 'FAIL',
    physicalAcceptance: { state: 'NOT_TESTED' },
    failureSignals: [{
      layer: 'LAUNCHER_OR_PREFLIGHT',
      code: 'verified-launch-profile-missing',
      evidenceRefs: ['battle-bridge/starfield/readiness/0001'],
    }],
    ...overrides,
  };
}

test('classifies one explicit fail-closed Starfield readiness signal without inventing runtime authority', () => {
  const classified = classifyVrRuntimeRecoveryEvidenceV1(evidence());
  assert.equal(classified.verdict, VR_RUNTIME_RECOVERY_VERDICTS.CLASSIFIED);
  assert.equal(classified.classification, 'LAUNCHER_OR_PREFLIGHT');
  assert.equal(classified.nextAction, VR_RUNTIME_RECOVERY_NEXT_ACTIONS.SEARCH_OWNER);
  assert.deepEqual(classified.ownerSearchIssues, [1769, 2321]);
  assert.equal(classified.ownerSearchIsHintOnly, true);
  assert.equal(classified.deduplicationRequiredBeforeNewGoal, true);
  assert.equal(classified.runtimeExecutionAllowed, false);
  assert.equal(classified.providerMutationAllowed, false);
  assert.equal(classified.mergeAuthority, false);
  assert.equal(classified.arbitraryShellAllowed, false);
});

test('multiple owning layers remain unknown and require a bounded experiment', () => {
  const classified = classifyVrRuntimeRecoveryEvidenceV1(evidence({
    failureSignals: [
      {
        layer: 'OPENXR_LOADER',
        code: 'runtime-json-unavailable',
        evidenceRefs: ['receipt/openxr-loader'],
      },
      {
        layer: 'STREAMING_TRANSPORT',
        code: 'air-link-session-missing',
        evidenceRefs: ['receipt/air-link'],
      },
    ],
  }));
  assert.equal(classified.verdict, VR_RUNTIME_RECOVERY_VERDICTS.AMBIGUOUS);
  assert.equal(classified.classification, 'UNKNOWN_REQUIRES_EXPERIMENT');
  assert.deepEqual(classified.candidateLayers, ['OPENXR_LOADER', 'STREAMING_TRANSPORT']);
  assert.equal(classified.nextAction, VR_RUNTIME_RECOVERY_NEXT_ACTIONS.EXPERIMENT);
});

test('machine failure without an evidence-backed owning layer stays unknown', () => {
  const classified = classifyVrRuntimeRecoveryEvidenceV1(evidence({ failureSignals: [] }));
  assert.equal(classified.verdict, VR_RUNTIME_RECOVERY_VERDICTS.AMBIGUOUS);
  assert.equal(classified.classification, 'UNKNOWN_REQUIRES_EXPERIMENT');
  assert.equal(classified.nextAction, VR_RUNTIME_RECOVERY_NEXT_ACTIONS.EXPERIMENT);
});

test('machine pass cannot be promoted to headset acceptance without explicit operator evidence', () => {
  const classified = classifyVrRuntimeRecoveryEvidenceV1(evidence({
    machineVerdict: 'PASS',
    failureSignals: [],
  }));
  assert.equal(classified.verdict, VR_RUNTIME_RECOVERY_VERDICTS.PHYSICAL_RETEST_REQUIRED);
  assert.equal(classified.physicalAcceptanceProven, false);
  assert.equal(classified.nextAction, VR_RUNTIME_RECOVERY_NEXT_ACTIONS.PHYSICAL_RETEST);
});

test('physical failure is admitted only from explicit operator-observed evidence', () => {
  const classified = classifyVrRuntimeRecoveryEvidenceV1(evidence({
    machineVerdict: 'PASS',
    failureSignals: [],
    physicalAcceptance: {
      state: 'FAIL',
      operatorObserved: true,
      evidenceRef: 'operator/quest3/starfield/comfort-0001',
    },
  }));
  assert.equal(classified.verdict, VR_RUNTIME_RECOVERY_VERDICTS.CLASSIFIED);
  assert.equal(classified.classification, 'PHYSICAL_ACCEPTANCE_ONLY');
  assert.equal(classified.physicalAcceptanceProven, true);
  assert.deepEqual(classified.ownerSearchIssues, [1769, 2321]);
});

test('machine and physical pass produce acceptance evidence only when physical proof is explicit', () => {
  const classified = classifyVrRuntimeRecoveryEvidenceV1(evidence({
    machineVerdict: 'PASS',
    failureSignals: [],
    physicalAcceptance: {
      state: 'PASS',
      operatorObserved: true,
      evidenceRef: 'operator/quest3/starfield/acceptance-0001',
    },
  }));
  assert.equal(classified.verdict, VR_RUNTIME_RECOVERY_VERDICTS.ACCEPTED);
  assert.equal(classified.nextAction, VR_RUNTIME_RECOVERY_NEXT_ACTIONS.PROMOTE_ACCEPTANCE);
  assert.equal(classified.physicalAcceptanceProven, true);
  assert.equal(classified.runtimeExecutionAllowed, false);
});

test('claimed physical result without operator-observed proof fails closed', () => {
  const classified = classifyVrRuntimeRecoveryEvidenceV1(evidence({
    machineVerdict: 'PASS',
    failureSignals: [],
    physicalAcceptance: {
      state: 'PASS',
      evidenceRef: 'machine-only/receipt',
    },
  }));
  assert.equal(classified.verdict, VR_RUNTIME_RECOVERY_VERDICTS.INVALID);
  assert.ok(classified.blockers.includes('physical-acceptance-operator-observation-required'));
});

test('machine pass and failure signals are contradictory and blocked', () => {
  const classified = classifyVrRuntimeRecoveryEvidenceV1(evidence({
    machineVerdict: 'PASS',
  }));
  assert.equal(classified.verdict, VR_RUNTIME_RECOVERY_VERDICTS.INVALID);
  assert.ok(classified.blockers.includes('machine-pass-conflicts-with-failure-signals'));
});
