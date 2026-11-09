import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OPENCLAW_STAGED_UPDATE_SCHEMA,
  OPENCLAW_STAGED_UPDATE_STATUS,
} from './openClawStagedUpdateV1.mjs';
import {
  OPENCLAW_TASK_CLASS,
  OPENCLAW_UPDATE_CAPABILITY_LEDGER_SCHEMA,
  OPENCLAW_UPDATE_DISPOSITION,
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
    blockers: [],
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
    blockers: [],
    currentVersion: '1.2.3',
    targetVersion: '1.3.0',
    requiredQualificationReplay: required,
    capabilities: [{
      protected: true,
      updateDisposition: OPENCLAW_UPDATE_DISPOSITION.PRESERVE,
      affectedTaskClasses: required.slice(0, 1),
    }],
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

test('READY ledger cannot smuggle mutation, approval or qualification authority', () => {
  const verified = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  const proof = [replay(OPENCLAW_TASK_CLASS.OC1)];
  const noAuthority = {
    sourceMutationAllowed: false,
    runtimeMutationAllowed: false,
    updateExecutionAllowed: false,
    approvalAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    providerQualificationAllowed: false,
    qualificationInvalidationRequired: true,
  };
  const evaluate = (authority) => evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: verified,
    capabilityLedger: { ...ledger(), authority },
    qualificationReplay: proof,
  });
  const positive = evaluate(noAuthority);
  assert.equal(positive.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.UPDATED_AND_CAPABILITIES_VERIFIED);
  assert.equal(positive.updatePromotionAllowed, true);

  for (const key of [
    'sourceMutationAllowed', 'runtimeMutationAllowed', 'updateExecutionAllowed',
    'approvalAllowed', 'mergeAllowed', 'deploymentAllowed', 'providerQualificationAllowed',
  ]) {
    for (const bad of [true, 0, 'false', null, undefined]) {
      const negative = evaluate({ ...noAuthority, [key]: bad });
      assert.equal(negative.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE, key);
      assert.equal(negative.updatePromotionAllowed, false, key);
      assert.equal(negative.providerRoutingResumeAllowed, false, key);
      assert.ok(negative.blockers.includes('CAPABILITY_LEDGER_AUTHORITY_WIDENED'), key);
    }
    const partial = { ...noAuthority };
    delete partial[key];
    assert.ok(evaluate(partial).blockers.includes('CAPABILITY_LEDGER_AUTHORITY_WIDENED'), key);
  }
  assert.ok(evaluate(null).blockers.includes('CAPABILITY_LEDGER_AUTHORITY_WIDENED'));
});

test('explicitly contradictory producer safety flags cannot promote a candidate', () => {
  const verified = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  const evidence = [replay(OPENCLAW_TASK_CLASS.OC1)];
  const validProducerFlags = {
    sourceHarnessOnly: true,
    arbitraryShellAllowed: false,
    arbitraryPathAllowed: false,
    battleBridgeAdapterRequired: true,
    secretsIncluded: false,
    absolutePathsPublished: false,
    operatorApprovalRequired: false,
  };
  const positive = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: { ...verified, safety: { ...verified.safety, ...validProducerFlags } },
    capabilityLedger: ledger(),
    qualificationReplay: evidence,
  });
  assert.equal(positive.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.UPDATED_AND_CAPABILITIES_VERIFIED);
  assert.equal(positive.updatePromotionAllowed, true);

  for (const [key, goodValue] of Object.entries(validProducerFlags)) {
    const negative = evaluateOpenClawUpdateCapabilityCandidateV1({
      stagedUpdate: { ...verified, safety: { ...verified.safety, [key]: !goodValue } },
      capabilityLedger: ledger(),
      qualificationReplay: evidence,
    });
    assert.equal(negative.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE, key);
    assert.equal(negative.updatePromotionAllowed, false, key);
    assert.equal(negative.providerRoutingResumeAllowed, false, key);
    assert.ok(negative.blockers.includes('STAGED_UPDATE_SAFETY_CONTRADICTION'), key);
  }

  const preflight = staged(OPENCLAW_STAGED_UPDATE_STATUS.READY_TO_APPLY);
  preflight.safety.operatorApprovalRequired = false;
  const negativePreflight = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: preflight,
    capabilityLedger: ledger(),
    qualificationReplay: [],
  });
  assert.equal(negativePreflight.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
  assert.ok(negativePreflight.blockers.includes('STAGED_UPDATE_SAFETY_CONTRADICTION'));
});

test('forged READY ledger cannot promote a protected BLOCK_UPDATE capability', () => {
  const updated = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  const evidence = [replay(OPENCLAW_TASK_CLASS.OC1)];
  const eligible = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: updated,
    capabilityLedger: ledger(),
    qualificationReplay: evidence,
  });
  assert.equal(eligible.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.UPDATED_AND_CAPABILITIES_VERIFIED);
  assert.equal(eligible.updatePromotionAllowed, true);

  const forged = ledger();
  forged.capabilities[0] = {
    ...forged.capabilities[0],
    updateDisposition: OPENCLAW_UPDATE_DISPOSITION.BLOCK_UPDATE,
    affectedTaskClasses: [],
  };
  const rejected = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: updated,
    capabilityLedger: forged,
    qualificationReplay: evidence,
  });
  assert.equal(rejected.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
  assert.equal(rejected.updatePromotionAllowed, false);
  assert.equal(rejected.providerRoutingResumeAllowed, false);
  assert.ok(rejected.blockers.includes('PROTECTED_CAPABILITY_BLOCKS_UPDATE'));
});

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

test('authority flags must be explicit own boolean false before any capability promotion', () => {
  const legitimate = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED),
    capabilityLedger: ledger(),
    qualificationReplay: [replay(OPENCLAW_TASK_CLASS.OC1)],
  });
  assert.equal(legitimate.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.UPDATED_AND_CAPABILITIES_VERIFIED);
  assert.equal(legitimate.updatePromotionAllowed, true);

  for (const key of ['mutationAllowed', 'sourceMutationAllowed', 'mergeAuthority', 'deploymentAuthority']) {
    for (const variation of ['missing', undefined, null, 0, 'false', true]) {
      const candidate = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
      if (variation === 'missing') delete candidate.safety[key];
      else candidate.safety[key] = variation;
      const result = evaluateOpenClawUpdateCapabilityCandidateV1({
        stagedUpdate: candidate,
        capabilityLedger: ledger(),
        qualificationReplay: [replay(OPENCLAW_TASK_CLASS.OC1)],
      });
      assert.equal(result.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE, `${key}=${String(variation)}`);
      assert.equal(result.updatePromotionAllowed, false, key);
      assert.equal(result.providerRoutingResumeAllowed, false, key);
      assert.ok(result.blockers.includes('STAGED_UPDATE_AUTHORITY_WIDENED'), key);
    }
  }

  const noFlags = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  noFlags.safety = {};
  const blocked = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: noFlags,
    capabilityLedger: ledger(),
    qualificationReplay: [replay(OPENCLAW_TASK_CLASS.OC1)],
  });
  assert.equal(blocked.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
  assert.ok(blocked.blockers.includes('STAGED_UPDATE_AUTHORITY_WIDENED'));
});

test('prototype-named data fields cannot launder inherited update identity or ledger approval', () => {
  const ready = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  const legitimate = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: ready,
    capabilityLedger: ledger(),
    qualificationReplay: [replay(OPENCLAW_TASK_CLASS.OC1)],
  });
  assert.equal(legitimate.updatePromotionAllowed, true);

  const missingHead = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  delete missingHead.exactIdentity.sourceHead;
  Object.defineProperty(missingHead.exactIdentity, '__proto__', {
    value: { sourceHead: HEAD },
    enumerable: true,
    configurable: true,
  });
  const spoofedIdentity = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: missingHead,
    capabilityLedger: ledger(),
    qualificationReplay: [replay(OPENCLAW_TASK_CLASS.OC1)],
  });
  assert.equal(spoofedIdentity.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
  assert.equal(spoofedIdentity.updatePromotionAllowed, false);
  assert.ok(spoofedIdentity.blockers.includes('SOURCE_HEAD_INVALID'));

  const inheritedLedger = {};
  Object.defineProperty(inheritedLedger, '__proto__', {
    value: ledger(),
    enumerable: true,
    configurable: true,
  });
  const spoofedLedger = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: ready,
    capabilityLedger: inheritedLedger,
    qualificationReplay: [replay(OPENCLAW_TASK_CLASS.OC1)],
  });
  assert.equal(spoofedLedger.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
  assert.equal(spoofedLedger.updatePromotionAllowed, false);
  assert.ok(spoofedLedger.blockers.includes('CAPABILITY_LEDGER_SCHEMA_MISMATCH'));
});

test('cross-version promotion requires a non-empty qualification replay contract at the consumer', () => {
  // A fabricated "ready" ledger with no required classes must not promote across versions.
  // This is independent of the protected producer fix in #1727.
  const unsafe = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED),
    capabilityLedger: ledger([]),
    qualificationReplay: [],
  });
  assert.equal(unsafe.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
  assert.equal(unsafe.updatePromotionAllowed, false);
  assert.equal(unsafe.providerRoutingResumeAllowed, false);
  assert.ok(unsafe.blockers.includes('CROSS_VERSION_QUALIFICATION_REPLAY_REQUIRED'));

  // A legitimate same-version PRESERVE with no changed capabilities may need no replay.
  const sameVersionStaged = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  sameVersionStaged.exactIdentity.targetVersion = '1.2.3';
  const sameVersionLedger = { ...ledger([]), targetVersion: '1.2.3' };
  const preserved = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: sameVersionStaged,
    capabilityLedger: sameVersionLedger,
    qualificationReplay: [],
  });
  assert.equal(preserved.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.UPDATED_AND_CAPABILITIES_VERIFIED);
  assert.equal(preserved.updatePromotionAllowed, true);

  const qualified = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED),
    capabilityLedger: ledger([OPENCLAW_TASK_CLASS.OC1]),
    qualificationReplay: [replay(OPENCLAW_TASK_CLASS.OC1)],
  });
  assert.equal(qualified.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.UPDATED_AND_CAPABILITIES_VERIFIED);
  assert.equal(qualified.updatePromotionAllowed, true);
});

test('staged states without complete authority preflight cannot masquerade as candidate-ready', () => {
  // Test at the consumer boundary, not just in the staged-update producer.
  // A post-update health gap must never appear to be a pre-update green signal.
  const unqualifiedStatuses = [
    OPENCLAW_STAGED_UPDATE_STATUS.APPROVAL_REQUIRED,
    OPENCLAW_STAGED_UPDATE_STATUS.STAGING_REQUIRED,
    OPENCLAW_STAGED_UPDATE_STATUS.POST_UPDATE_PROOF_REQUIRED,
    'UPDATED_AND_VERIFED',
    'PRE_UPDATE_CAPABILITY_GATE_READY',
    undefined,
    null,
    '',
  ];
  for (const status of unqualifiedStatuses) {
    const unsafe = staged(OPENCLAW_STAGED_UPDATE_STATUS.READY_TO_APPLY);
    unsafe.status = status;
    const result = evaluateOpenClawUpdateCapabilityCandidateV1({
      stagedUpdate: unsafe,
      capabilityLedger: ledger([OPENCLAW_TASK_CLASS.OC1]),
      qualificationReplay: [replay(OPENCLAW_TASK_CLASS.OC1)],
    });
    assert.equal(result.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE, String(status));
    assert.ok(result.blockers.includes('STAGED_UPDATE_STATUS_NOT_CANDIDATE_READY'), String(status));
    assert.equal(result.updatePromotionAllowed, false, String(status));
    assert.equal(result.providerRoutingResumeAllowed, false, String(status));
  }

  // Real READY_TO_APPLY still has the existing no-authority preflight classification.
  const ready = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.READY_TO_APPLY),
    capabilityLedger: ledger(),
    qualificationReplay: [],
  });
  assert.equal(ready.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.PRE_UPDATE_CAPABILITY_GATE_READY);
  assert.equal(ready.updatePromotionAllowed, false);
});

test('contradictory staged or ledger producer blockers cannot masquerade as ready', () => {
  const verified = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  const qualified = [replay(OPENCLAW_TASK_CLASS.OC1)];
  const positive = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: verified,
    capabilityLedger: ledger(),
    qualificationReplay: qualified,
  });
  assert.equal(positive.updatePromotionAllowed, true);

  for (const badBlockers of [['POST_UPDATE_HEALTH_UNPROVEN'], undefined, null, '']) {
    const result = evaluateOpenClawUpdateCapabilityCandidateV1({
      stagedUpdate: { ...verified, blockers: badBlockers },
      capabilityLedger: ledger(),
      qualificationReplay: qualified,
    });
    assert.equal(result.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
    assert.equal(result.updatePromotionAllowed, false);
    assert.ok(result.blockers.includes('STAGED_UPDATE_BLOCKERS_NOT_EMPTY'));
  }

  for (const badBlockers of [['PROTECTED_CAPABILITY_NOT_QUALIFIED'], undefined, null, '']) {
    const result = evaluateOpenClawUpdateCapabilityCandidateV1({
      stagedUpdate: verified,
      capabilityLedger: { ...ledger(), blockers: badBlockers },
      qualificationReplay: qualified,
    });
    assert.equal(result.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
    assert.equal(result.providerRoutingResumeAllowed, false);
    assert.ok(result.blockers.includes('CAPABILITY_LEDGER_BLOCKERS_NOT_EMPTY'));
  }
});


test('same-version protected implementation changes cannot bypass producer task-class replay', () => {
  const verified = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  verified.exactIdentity.targetVersion = '1.2.3';
  const changingCapability = {
    protected: true,
    updateDisposition: OPENCLAW_UPDATE_DISPOSITION.IMPROVE,
    affectedTaskClasses: [OPENCLAW_TASK_CLASS.OC1],
  };
  const omitted = {
    ...ledger([]),
    targetVersion: '1.2.3',
    capabilities: [changingCapability],
  };
  const negative = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: verified,
    capabilityLedger: omitted,
    qualificationReplay: [],
  });
  assert.equal(negative.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
  assert.equal(negative.updatePromotionAllowed, false);
  assert.ok(negative.blockers.includes('PROTECTED_CAPABILITY_REPLAY_CONTRACT_INVALID'));

  const emptyAffected = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: verified,
    capabilityLedger: {
      ...omitted,
      capabilities: [{ ...changingCapability, affectedTaskClasses: [] }],
    },
    qualificationReplay: [],
  });
  assert.equal(emptyAffected.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
  assert.ok(emptyAffected.blockers.includes('PROTECTED_CAPABILITY_REPLAY_CONTRACT_INVALID'));

  const missingCapabilities = { ...omitted };
  delete missingCapabilities.capabilities;
  const missing = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: verified,
    capabilityLedger: missingCapabilities,
    qualificationReplay: [],
  });
  assert.equal(missing.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
  assert.ok(missing.blockers.includes('CAPABILITY_LEDGER_CAPABILITIES_UNPROVEN'));

  // Positive control: a same-version protected change with the actual affected
  // class declared and an exact-version replay is still eligible in source.
  const qualified = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: verified,
    capabilityLedger: { ...omitted, requiredQualificationReplay: [OPENCLAW_TASK_CLASS.OC1] },
    qualificationReplay: [replay(OPENCLAW_TASK_CLASS.OC1, { providerVersion: '1.2.3' })],
  });
  assert.equal(qualified.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.UPDATED_AND_CAPABILITIES_VERIFIED);
  assert.equal(qualified.updatePromotionAllowed, true);

  // Legitimate same-version PRESERVE needs no replay if nothing changed.
  const preserved = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: verified,
    capabilityLedger: {
      ...omitted,
      capabilities: [{ ...changingCapability,
        updateDisposition: OPENCLAW_UPDATE_DISPOSITION.PRESERVE,
        affectedTaskClasses: [] }],
    },
    qualificationReplay: [],
  });
  assert.equal(preserved.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.UPDATED_AND_CAPABILITIES_VERIFIED);
  assert.equal(preserved.updatePromotionAllowed, true);
});

test('cross-version protected PRESERVE requires its own replay, not an unrelated success', () => {
  const verified = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  const unrelated = ledger([OPENCLAW_TASK_CLASS.OC6]);
  unrelated.capabilities[0].affectedTaskClasses = [OPENCLAW_TASK_CLASS.OC1];
  const missingOwnReplay = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: verified,
    capabilityLedger: unrelated,
    qualificationReplay: [replay(OPENCLAW_TASK_CLASS.OC6)],
  });
  assert.equal(missingOwnReplay.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
  assert.equal(missingOwnReplay.updatePromotionAllowed, false);
  assert.ok(missingOwnReplay.blockers.includes('PROTECTED_CAPABILITY_REPLAY_CONTRACT_INVALID'));

  const missingAffected = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: verified,
    capabilityLedger: {
      ...unrelated,
      capabilities: [{ ...unrelated.capabilities[0], affectedTaskClasses: [] }],
    },
    qualificationReplay: [replay(OPENCLAW_TASK_CLASS.OC6)],
  });
  assert.equal(missingAffected.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
  assert.ok(missingAffected.blockers.includes('PROTECTED_CAPABILITY_REPLAY_CONTRACT_INVALID'));

  const qualified = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: verified,
    capabilityLedger: {
      ...ledger([OPENCLAW_TASK_CLASS.OC1, OPENCLAW_TASK_CLASS.OC6]),
      capabilities: [{
        protected: true,
        updateDisposition: OPENCLAW_UPDATE_DISPOSITION.PRESERVE,
        affectedTaskClasses: [OPENCLAW_TASK_CLASS.OC1],
      }],
    },
    qualificationReplay: [
      replay(OPENCLAW_TASK_CLASS.OC1),
      replay(OPENCLAW_TASK_CLASS.OC6),
    ],
  });
  assert.equal(qualified.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.UPDATED_AND_CAPABILITIES_VERIFIED);
  assert.equal(qualified.updatePromotionAllowed, true);

  const sameVersion = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  sameVersion.exactIdentity.targetVersion = '1.2.3';
  const sameVersionLedger = { ...ledger([]), targetVersion: '1.2.3' };
  const preserved = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: sameVersion,
    capabilityLedger: sameVersionLedger,
    qualificationReplay: [],
  });
  assert.equal(preserved.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.UPDATED_AND_CAPABILITIES_VERIFIED);
  assert.equal(preserved.updatePromotionAllowed, true);
});


test('a fabricated ready ledger without protected capabilities cannot promote', () => {
  const verified = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  const qualifiedReplay = [replay(OPENCLAW_TASK_CLASS.OC1)];
  const positive = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: verified,
    capabilityLedger: ledger(),
    qualificationReplay: qualifiedReplay,
  });
  assert.equal(positive.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.UPDATED_AND_CAPABILITIES_VERIFIED);
  assert.equal(positive.updatePromotionAllowed, true);

  // The original producer would reject this as NO_PROTECTED_CAPABILITIES.
  // A contradictory ready verdict must not bypass that invariant at the consumer.
  const unprotectedLedger = {
    ...ledger(),
    capabilities: [{
      protected: false,
      updateDisposition: OPENCLAW_UPDATE_DISPOSITION.PRESERVE,
      affectedTaskClasses: [],
    }],
    protectedCapabilityCount: 0,
  };
  const rejected = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: verified,
    capabilityLedger: unprotectedLedger,
    qualificationReplay: qualifiedReplay,
  });
  assert.equal(rejected.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
  assert.equal(rejected.updatePromotionAllowed, false);
  assert.equal(rejected.providerRoutingResumeAllowed, false);
  assert.ok(rejected.blockers.includes('CAPABILITY_LEDGER_PROTECTED_INVENTORY_EMPTY'));
});


test('a ready capability ledger cannot contradict its own protected count', () => {
  const verified = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  const qualifications = [replay(OPENCLAW_TASK_CLASS.OC1)];
  const producerLedger = { ...ledger(), protectedCapabilityCount: 1 };
  const good = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: verified,
    capabilityLedger: producerLedger,
    qualificationReplay: qualifications,
  });
  assert.equal(good.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.UPDATED_AND_CAPABILITIES_VERIFIED);
  assert.equal(good.updatePromotionAllowed, true);

  // Older source-only acceptance fixtures omit this optional producer field.
  const legacy = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: verified,
    capabilityLedger: ledger(),
    qualificationReplay: qualifications,
  });
  assert.equal(legacy.updatePromotionAllowed, true);

  for (const malformedCount of [0, 2, -1, '1', null, NaN, Infinity]) {
    const rejected = evaluateOpenClawUpdateCapabilityCandidateV1({
      stagedUpdate: verified,
      capabilityLedger: { ...producerLedger, protectedCapabilityCount: malformedCount },
      qualificationReplay: qualifications,
    });
    assert.equal(rejected.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE, String(malformedCount));
    assert.equal(rejected.updatePromotionAllowed, false);
    assert.equal(rejected.providerRoutingResumeAllowed, false);
    assert.ok(rejected.blockers.includes('CAPABILITY_LEDGER_PROTECTED_COUNT_MISMATCH'));
  }
});

test('READY protected disposition summary must match producer inventory exactly', () => {
  const verified = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  const proof = [replay(OPENCLAW_TASK_CLASS.OC1)];
  const counts = Object.fromEntries(Object.values(OPENCLAW_UPDATE_DISPOSITION).map((name) => [name, 0]));
  counts[OPENCLAW_UPDATE_DISPOSITION.PRESERVE] = 1;
  const ready = { ...ledger(), protectedCapabilityCount: 1, dispositionCounts: counts };
  const evaluate = (capabilityLedger) => evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: verified, capabilityLedger, qualificationReplay: proof,
  });
  const positive = evaluate(ready);
  assert.equal(positive.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.UPDATED_AND_CAPABILITIES_VERIFIED);
  assert.equal(positive.updatePromotionAllowed, true);

  // Legacy pre-envelope fixtures remain compatible until the producer migration.
  assert.equal(evaluate(ledger()).updatePromotionAllowed, true);
  const swapped = { ...counts, [OPENCLAW_UPDATE_DISPOSITION.PRESERVE]: 0,
    [OPENCLAW_UPDATE_DISPOSITION.BLOCK_UPDATE]: 1 };
  const missing = { ...counts };
  delete missing[OPENCLAW_UPDATE_DISPOSITION.IMPROVE];
  const badRecords = [
    { ...counts, [OPENCLAW_UPDATE_DISPOSITION.PRESERVE]: 0 },
    swapped,
    missing,
    { ...counts, [OPENCLAW_UPDATE_DISPOSITION.PRESERVE]: 1.5 },
    { ...counts, [OPENCLAW_UPDATE_DISPOSITION.PRESERVE]: '1' },
    { ...counts, [OPENCLAW_UPDATE_DISPOSITION.PRESERVE]: null },
    { ...counts, [OPENCLAW_UPDATE_DISPOSITION.PRESERVE]: Infinity },
    { ...counts, UNKNOWN_DISPOSITION: 0 },
    null,
  ];
  for (const candidate of badRecords) {
    const rejected = evaluate({ ...ready, dispositionCounts: candidate });
    assert.equal(rejected.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
    assert.equal(rejected.updatePromotionAllowed, false);
    assert.equal(rejected.providerRoutingResumeAllowed, false);
    assert.ok(rejected.blockers.includes('CAPABILITY_LEDGER_DISPOSITION_COUNTS_MISMATCH'));
  }
});
