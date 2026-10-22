import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OPENCLAW_STAGED_UPDATE_SCHEMA,
  OPENCLAW_STAGED_UPDATE_STATUS,
} from './openClawStagedUpdateV1.mjs';
import {
  buildOpenClawUpdateCapabilityLedgerV1,
  OPENCLAW_TASK_CLASS,
} from './openClawUpdateCapabilityLedgerV1.mjs';
import {
  OPENCLAW_UPDATE_CAPABILITY_COMPARISON_SCHEMA,
  OPENCLAW_UPDATE_CAPABILITY_TEST_RESULT_SCHEMA,
} from './openClawUpdateCapabilityOutcomeV1.mjs';
import {
  OPENCLAW_UPDATE_QUALIFICATION_REPLAY_SCHEMA,
} from './openClawUpdateCapabilityCandidateGateV1.mjs';
import {
  OPENCLAW_UPDATE_FINAL_ACCEPTANCE_STATUS,
  evaluateOpenClawUpdateFinalAcceptanceV1,
} from './openClawUpdateFinalAcceptanceV1.mjs';

const HEAD = 'a'.repeat(40);

function capability() {
  return {
    capabilityId: 'openclaw.repo-scout',
    purpose: 'Bounded repository scout.',
    currentImplementation: 'plugin.repo-scout.v1',
    candidateImplementation: 'plugin.repo-scout.v2',
    origin: 'stephanos-extension',
    candidateOrigin: 'stephanos-extension',
    protected: true,
    qualificationRefs: ['qualification.oc1.current'],
    tests: ['test.oc1.repo-scout'],
    dependencies: ['shared.workspace'],
    migrationPolicy: 'Preserve the bounded mission contract.',
    replacementCriteria: 'Pass the same acceptance contract without authority widening.',
    lastQualifiedVersion: '1.2.3',
    updateDisposition: 'IMPROVE',
    evidenceRefs: ['proof.oc1.candidate'],
    affectedTaskClasses: [OPENCLAW_TASK_CLASS.OC1],
  };
}

function ledger() {
  return buildOpenClawUpdateCapabilityLedgerV1({
    currentVersion: '1.2.3',
    targetVersion: '1.3.0',
    capabilities: [capability()],
  });
}

function staged(status) {
  return {
    schema: OPENCLAW_STAGED_UPDATE_SCHEMA,
    status,
    exactIdentity: {
      repository: 'Cheekyfellastef/stephan-os',
      sourceHead: HEAD,
      manifestSha256: 'b'.repeat(64),
      packetId: 'openclaw-update-1',
      packetSha256: 'c'.repeat(64),
      currentVersion: '1.2.3',
      targetVersion: '1.3.0',
    },
    safety: {
      mutationAllowed: false,
      sourceMutationAllowed: false,
      mergeAuthority: false,
      deploymentAuthority: false,
    },
  };
}

function comparisons(candidateVerdict = 'PASS') {
  return [{
    schemaVersion: OPENCLAW_UPDATE_CAPABILITY_COMPARISON_SCHEMA,
    capabilityId: 'openclaw.repo-scout',
    testResults: [{
      schemaVersion: OPENCLAW_UPDATE_CAPABILITY_TEST_RESULT_SCHEMA,
      testId: 'test.oc1.repo-scout',
      baselineVerdict: 'PASS',
      candidateVerdict,
      proofRef: 'proof.oc1.candidate',
    }],
  }];
}

function replay(verdict = 'PRODUCTION_ELIGIBLE') {
  return [{
    schemaVersion: OPENCLAW_UPDATE_QUALIFICATION_REPLAY_SCHEMA,
    taskClass: OPENCLAW_TASK_CLASS.OC1,
    qualificationId: 'qualification:oc1-repository-scout',
    sourceHead: HEAD,
    providerVersion: '1.3.0',
    verdict,
    proofRefs: ['proof:oc1-requalified'],
  }];
}

test('pre-update candidate must already prove equal-or-better capability outcomes', () => {
  const result = evaluateOpenClawUpdateFinalAcceptanceV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.READY_TO_APPLY),
    capabilityLedger: ledger(),
    capabilityComparisons: comparisons(),
    qualificationReplay: [],
  });
  assert.equal(result.status, OPENCLAW_UPDATE_FINAL_ACCEPTANCE_STATUS.PRE_UPDATE_READY);
  assert.equal(result.updatePromotionAllowed, false);
  assert.equal(result.providerRoutingResumeAllowed, false);
});

test('post-update provider routing resumes only after equal-or-better outcome and requalification', () => {
  const result = evaluateOpenClawUpdateFinalAcceptanceV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED),
    capabilityLedger: ledger(),
    capabilityComparisons: comparisons(),
    qualificationReplay: replay(),
  });
  assert.equal(result.status, OPENCLAW_UPDATE_FINAL_ACCEPTANCE_STATUS.UPDATED_AND_VERIFIED);
  assert.equal(result.updatePromotionAllowed, true);
  assert.equal(result.providerRoutingResumeAllowed, true);
  assert.equal(result.rollbackRequired, false);
  assert.equal(result.authority.providerQualificationAllowed, false);
});

test('candidate capability regression blocks routing even when qualification replay claims success', () => {
  const result = evaluateOpenClawUpdateFinalAcceptanceV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED),
    capabilityLedger: ledger(),
    capabilityComparisons: comparisons('FAIL'),
    qualificationReplay: replay(),
  });
  assert.equal(result.status, OPENCLAW_UPDATE_FINAL_ACCEPTANCE_STATUS.POST_UPDATE_FAILED);
  assert.equal(result.updatePromotionAllowed, false);
  assert.equal(result.providerRoutingResumeAllowed, false);
  assert.equal(result.rollbackRequired, true);
  assert.match(result.blockers.join('\n'), /CANDIDATE_REGRESSION/);
});

test('equal-or-better capability result cannot substitute for missing task-class requalification', () => {
  const result = evaluateOpenClawUpdateFinalAcceptanceV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED),
    capabilityLedger: ledger(),
    capabilityComparisons: comparisons(),
    qualificationReplay: [],
  });
  assert.equal(result.status, OPENCLAW_UPDATE_FINAL_ACCEPTANCE_STATUS.POST_UPDATE_PROOF_REQUIRED);
  assert.equal(result.updatePromotionAllowed, false);
  assert.equal(result.providerRoutingResumeAllowed, false);
});

test('hostile top-level accessor is rejected without invocation', () => {
  let invoked = false;
  const input = {
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.READY_TO_APPLY),
    capabilityLedger: ledger(),
    capabilityComparisons: comparisons(),
  };
  Object.defineProperty(input, 'qualificationReplay', {
    enumerable: true,
    get() { invoked = true; return []; },
  });
  const result = evaluateOpenClawUpdateFinalAcceptanceV1(input);
  assert.equal(invoked, false);
  assert.equal(result.status, OPENCLAW_UPDATE_FINAL_ACCEPTANCE_STATUS.BLOCK_UPDATE);
});
