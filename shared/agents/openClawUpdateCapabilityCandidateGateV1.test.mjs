import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OPENCLAW_STAGED_UPDATE_SCHEMA,
  OPENCLAW_STAGED_UPDATE_STATUS,
} from './openClawStagedUpdateV1.mjs';
import {
  OPENCLAW_TASK_CLASS,
  OPENCLAW_UPDATE_CAPABILITY_LEDGER_SCHEMA,
} from './openClawUpdateCapabilityLedgerV1.mjs';
import {
  OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS,
  OPENCLAW_UPDATE_QUALIFICATION_REPLAY_SCHEMA,
  evaluateOpenClawUpdateCapabilityCandidateV1,
} from './openClawUpdateCapabilityCandidateGateV1.mjs';

const HEAD = 'a'.repeat(40);

function staged(status = OPENCLAW_STAGED_UPDATE_STATUS.READY_TO_APPLY) {
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

function ledger(required = [OPENCLAW_TASK_CLASS.OC1]) {
  return {
    schemaVersion: OPENCLAW_UPDATE_CAPABILITY_LEDGER_SCHEMA,
    verdict: 'CAPABILITY_LEDGER_READY_FOR_CANDIDATE_PROOF',
    currentVersion: '1.2.3',
    targetVersion: '1.3.0',
    requiredQualificationReplay: required,
    updateAllowed: true,
  };
}

function replay(taskClass, overrides = {}) {
  return {
    schemaVersion: OPENCLAW_UPDATE_QUALIFICATION_REPLAY_SCHEMA,
    taskClass,
    qualificationId: `qualification:${taskClass.toLowerCase()}`,
    sourceHead: HEAD,
    providerVersion: '1.3.0',
    verdict: 'PRODUCTION_ELIGIBLE',
    proofRefs: [`proof:${taskClass.toLowerCase()}`],
    ...overrides,
  };
}

test('pre-update candidate gate is ready but grants no execution authority', () => {
  const result = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: staged(),
    capabilityLedger: ledger(),
    qualificationReplay: [],
  });
  assert.equal(result.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.PRE_UPDATE_CAPABILITY_GATE_READY);
  assert.equal(result.updatePromotionAllowed, false);
  assert.equal(result.providerRoutingResumeAllowed, false);
  assert.equal(result.authority.updateExecutionAllowed, false);
});

test('updated runtime cannot promote until every required task class requalifies', () => {
  const result = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED),
    capabilityLedger: ledger([OPENCLAW_TASK_CLASS.OC1, OPENCLAW_TASK_CLASS.OC6]),
    qualificationReplay: [replay(OPENCLAW_TASK_CLASS.OC1)],
  });
  assert.equal(result.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.POST_UPDATE_CAPABILITY_PROOF_REQUIRED);
  assert.equal(result.updatePromotionAllowed, false);
  assert.equal(result.providerRoutingResumeAllowed, false);
  assert.deepEqual(result.blockers, [`QUALIFICATION_REPLAY_MISSING:${OPENCLAW_TASK_CLASS.OC6}`]);
});

test('complete exact target-version replay allows capability promotion and routing resume', () => {
  const result = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED),
    capabilityLedger: ledger([OPENCLAW_TASK_CLASS.OC1, OPENCLAW_TASK_CLASS.OC6]),
    qualificationReplay: [
      replay(OPENCLAW_TASK_CLASS.OC6),
      replay(OPENCLAW_TASK_CLASS.OC1),
    ],
  });
  assert.equal(result.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.UPDATED_AND_CAPABILITIES_VERIFIED);
  assert.equal(result.updatePromotionAllowed, true);
  assert.equal(result.providerRoutingResumeAllowed, true);
  assert.equal(result.rollbackRequired, false);
  assert.deepEqual(result.requiredQualificationReplay, [OPENCLAW_TASK_CLASS.OC1, OPENCLAW_TASK_CLASS.OC6].sort());
});

test('failed affected-task replay makes rollback required', () => {
  const result = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED),
    capabilityLedger: ledger(),
    qualificationReplay: [replay(OPENCLAW_TASK_CLASS.OC1, { verdict: 'FAILED' })],
  });
  assert.equal(result.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.POST_UPDATE_CAPABILITY_REPLAY_FAILED);
  assert.equal(result.rollbackRequired, true);
  assert.equal(result.updatePromotionAllowed, false);
});

test('wrong target provider version and wrong source head fail replay identity', () => {
  const wrongVersion = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED),
    capabilityLedger: ledger(),
    qualificationReplay: [replay(OPENCLAW_TASK_CLASS.OC1, { providerVersion: '1.2.3' })],
  });
  assert.equal(wrongVersion.rollbackRequired, true);
  assert.ok(wrongVersion.blockers.includes(`QUALIFICATION_REPLAY_FAILED:${OPENCLAW_TASK_CLASS.OC1}:identity-mismatch`));

  const wrongHead = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED),
    capabilityLedger: ledger(),
    qualificationReplay: [replay(OPENCLAW_TASK_CLASS.OC1, { sourceHead: 'd'.repeat(40) })],
  });
  assert.equal(wrongHead.rollbackRequired, true);
});

test('blocked ledger and widened staged authority fail closed', () => {
  const blockedLedger = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: staged(),
    capabilityLedger: { ...ledger(), updateAllowed: false, verdict: 'BLOCK_UPDATE' },
    qualificationReplay: [],
  });
  assert.equal(blockedLedger.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);

  const unsafe = staged();
  unsafe.safety = { ...unsafe.safety, mutationAllowed: true };
  const authority = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: unsafe,
    capabilityLedger: ledger(),
    qualificationReplay: [],
  });
  assert.equal(authority.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
  assert.ok(authority.blockers.includes('STAGED_UPDATE_AUTHORITY_WIDENED'));
});

test('unrequested or duplicate replay records fail closed', () => {
  const unrequested = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED),
    capabilityLedger: ledger([OPENCLAW_TASK_CLASS.OC1]),
    qualificationReplay: [replay(OPENCLAW_TASK_CLASS.OC6)],
  });
  assert.equal(unrequested.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
  assert.ok(unrequested.blockers.includes(`UNREQUESTED_QUALIFICATION_REPLAY:${OPENCLAW_TASK_CLASS.OC6}`));

  const duplicate = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED),
    capabilityLedger: ledger(),
    qualificationReplay: [replay(OPENCLAW_TASK_CLASS.OC1), replay(OPENCLAW_TASK_CLASS.OC1)],
  });
  assert.equal(duplicate.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
});

test('rolled-back state never resumes provider routing through the candidate gate', () => {
  const result = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.ROLLED_BACK_AND_VERIFIED),
    capabilityLedger: ledger(),
    qualificationReplay: [],
  });
  assert.equal(result.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.ROLLED_BACK_AND_CAPABILITIES_PRESERVED);
  assert.equal(result.updatePromotionAllowed, false);
  assert.equal(result.providerRoutingResumeAllowed, false);
});

test('accessor, sparse, custom-prototype and revoked replay inputs fail without hidden execution', () => {
  let getterCalled = false;
  const top = {
    stagedUpdate: staged(),
    capabilityLedger: ledger(),
  };
  Object.defineProperty(top, 'qualificationReplay', {
    enumerable: true,
    get() {
      getterCalled = true;
      return [];
    },
  });
  const accessor = evaluateOpenClawUpdateCapabilityCandidateV1(top);
  assert.equal(getterCalled, false);
  assert.equal(accessor.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);

  const sparse = [];
  sparse.length = 1;
  const sparseResult = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: staged(),
    capabilityLedger: ledger(),
    qualificationReplay: sparse,
  });
  assert.equal(sparseResult.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);

  const custom = Object.create({ hidden: true });
  Object.assign(custom, replay(OPENCLAW_TASK_CLASS.OC1));
  const customResult = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED),
    capabilityLedger: ledger(),
    qualificationReplay: [custom],
  });
  assert.equal(customResult.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);

  const { proxy, revoke } = Proxy.revocable(replay(OPENCLAW_TASK_CLASS.OC1), {});
  revoke();
  const revoked = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED),
    capabilityLedger: ledger(),
    qualificationReplay: [proxy],
  });
  assert.equal(revoked.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
});

test('nested staged safety accessors are rejected without invoking hidden authority getters', () => {
  let getterCalled = false;
  const value = staged();
  Object.defineProperty(value.safety, 'mutationAllowed', {
    enumerable: true,
    configurable: true,
    get() {
      getterCalled = true;
      return true;
    },
  });
  const result = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: value,
    capabilityLedger: ledger(),
    qualificationReplay: [],
  });
  assert.equal(getterCalled, false);
  assert.equal(result.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
  assert.ok(result.blockers.includes('STAGED_UPDATE_SAFETY_INVALID'));
});
