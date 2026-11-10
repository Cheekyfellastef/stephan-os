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
      sourceHarnessOnly: true,
      mutationAllowed: false,
      arbitraryShellAllowed: false,
      arbitraryPathAllowed: false,
      sourceMutationAllowed: false,
      mergeAuthority: false,
      deploymentAuthority: false,
      battleBridgeAdapterRequired: true,
      operatorApprovalRequired: ![
        OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED,
        OPENCLAW_STAGED_UPDATE_STATUS.ROLLED_BACK_AND_VERIFIED,
      ].includes(status),
      secretsIncluded: false,
      absolutePathsPublished: false,
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
      capabilityId: 'oc8:protected',
      protected: true,
      updateDisposition: OPENCLAW_UPDATE_DISPOSITION.PRESERVE,
      affectedTaskClasses: required.slice(0, 1),
      currentImplementation: 'oc8:retained',
      candidateImplementation: 'oc8:retained',
      origin: 'stephanos-extension',
      candidateOrigin: 'stephanos-extension',
      lastQualifiedVersion: '1.2.3',
      qualificationRefs: ['qualification:oc8'],
      tests: ['test:oc8'],
      evidenceRefs: ['evidence:oc8'],
    }],
    updateAllowed: true,
    authority: {
      sourceMutationAllowed: false,
      runtimeMutationAllowed: false,
      updateExecutionAllowed: false,
      approvalAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      providerQualificationAllowed: false,
      qualificationInvalidationRequired: required.length > 0,
    },
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

test('post-update promotion refuses contradictory ledger replay-invalidation authority', () => {
  const verified = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  const consistent = ledger();
  const evidence = [replay(OPENCLAW_TASK_CLASS.OC1)];
  const evaluate = (candidate, status = verified) => evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: status,
    capabilityLedger: candidate,
    qualificationReplay: status.status === OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED ? evidence : [],
  });
  assert.equal(evaluate(consistent).updatePromotionAllowed, true);
  const contradicted = {
    ...consistent,
    authority: { ...consistent.authority, qualificationInvalidationRequired: false },
  };
  const refused = evaluate(contradicted);
  assert.equal(refused.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
  assert.equal(refused.updatePromotionAllowed, false);
  assert.equal(refused.providerRoutingResumeAllowed, false);
  assert.ok(refused.blockers.includes('CAPABILITY_LEDGER_QUALIFICATION_INVALIDATION_MISMATCH'));
  // Read-only legacy preflight still has no routing authority.
  const preflight = evaluate(contradicted, staged(OPENCLAW_STAGED_UPDATE_STATUS.READY_TO_APPLY));
  assert.equal(preflight.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.PRE_UPDATE_CAPABILITY_GATE_READY);
  assert.equal(preflight.updatePromotionAllowed, false);
  assert.equal(preflight.providerRoutingResumeAllowed, false);
});

test('post-update promotion refuses absent or malformed capability ledger no-authority envelope', () => {
  const verified = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  const baseline = ledger();
  const proof = [replay(OPENCLAW_TASK_CLASS.OC1)];
  const evaluate = (candidate, status = verified) => evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: status,
    capabilityLedger: candidate,
    qualificationReplay: status.status === OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED ? proof : [],
  });
  assert.equal(evaluate(baseline).updatePromotionAllowed, true);
  const missing = { ...baseline };
  delete missing.authority;
  const refused = evaluate(missing);
  assert.equal(refused.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
  assert.equal(refused.updatePromotionAllowed, false);
  assert.equal(refused.providerRoutingResumeAllowed, false);
  assert.ok(refused.blockers.includes('CAPABILITY_LEDGER_AUTHORITY_WIDENED'));

  for (const malformed of [null, {}, { ...baseline.authority, qualificationInvalidationRequired: null },
    { ...baseline.authority, qualificationInvalidationRequired: 'true' },
    { ...baseline.authority, qualificationInvalidationRequired: undefined }]) {
    const result = evaluate({ ...baseline, authority: malformed });
    assert.equal(result.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
    assert.equal(result.providerRoutingResumeAllowed, false);
    assert.ok(result.blockers.includes('CAPABILITY_LEDGER_QUALIFICATION_INVALIDATION_INVALID'));
  }
  // Preserve read-only legacy preflight compatibility, without post-update promotion.
  const preflight = evaluate(missing, staged(OPENCLAW_STAGED_UPDATE_STATUS.READY_TO_APPLY));
  assert.equal(preflight.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.PRE_UPDATE_CAPABILITY_GATE_READY);
  assert.equal(preflight.updatePromotionAllowed, false);
  assert.equal(preflight.providerRoutingResumeAllowed, false);
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
    ...ledger().capabilities[0],
    updateDisposition: OPENCLAW_UPDATE_DISPOSITION.IMPROVE,
    candidateImplementation: 'oc8:improved',
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
    capabilityLedger: { ...omitted, requiredQualificationReplay: [OPENCLAW_TASK_CLASS.OC1],
      // The producer invalidates qualifications whenever its replay set is nonempty.
      authority: { ...omitted.authority, qualificationInvalidationRequired: true } },
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
        candidateImplementation: changingCapability.currentImplementation,
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
      capabilities: [{ ...ledger().capabilities[0],
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

test('READY protected capability identities must be unique and complete when supplied', () => {
  const updated = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  const proof = [replay(OPENCLAW_TASK_CLASS.OC1)];
  const first = { ...ledger().capabilities[0], capabilityId: 'openclaw:capability-1' };
  const one = { ...ledger(), capabilities: [first], protectedCapabilityCount: 1 };
  const evaluate = (candidate) => evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: updated, capabilityLedger: candidate, qualificationReplay: proof,
  });

  // Genuine producer identity is eligible; missing identity never promotes after update.
  assert.equal(evaluate(one).updatePromotionAllowed, true);
  const missingId = { ...ledger().capabilities[0] };
  delete missingId.capabilityId;
  const missingIdentityVerdict = evaluate({ ...ledger(), capabilities: [missingId] });
  assert.equal(missingIdentityVerdict.updatePromotionAllowed, false);
  assert.ok(missingIdentityVerdict.blockers.includes('CAPABILITY_LEDGER_PROTECTED_IDENTITY_UNPROVEN'));

  const duplicate = {
    ...one, capabilities: [first, { ...first }],
    protectedCapabilityCount: 2,
  };
  const rejected = evaluate(duplicate);
  assert.equal(rejected.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
  assert.equal(rejected.updatePromotionAllowed, false);
  assert.equal(rejected.providerRoutingResumeAllowed, false);
  assert.ok(rejected.blockers.includes('CAPABILITY_LEDGER_CAPABILITY_ID_INVALID_OR_DUPLICATE'));

  // Contradictory producer records cannot silently discard identity or inject malformed IDs.
  const partial = evaluate({ ...duplicate, capabilities: [first, { ...first, capabilityId: undefined }] });
  assert.ok(partial.blockers.includes('CAPABILITY_LEDGER_CAPABILITY_ID_INVALID_OR_DUPLICATE'));
  const anonymous = { ...first };
  delete anonymous.capabilityId;
  const incomplete = evaluate({ ...duplicate, capabilities: [first, anonymous] });
  assert.ok(incomplete.blockers.includes('CAPABILITY_LEDGER_CAPABILITY_ID_INCOMPLETE'));
  for (const badId of ['', null, 42, 'invalid capability id']) {
    const bad = evaluate({ ...one, capabilities: [{ ...first, capabilityId: badId }] });
    assert.equal(bad.updatePromotionAllowed, false, String(badId));
    assert.ok(bad.blockers.includes('CAPABILITY_LEDGER_CAPABILITY_ID_INVALID_OR_DUPLICATE'));
  }
});


test('same-version PRESERVE cannot launder malformed affected-task classes', () => {
  const verified = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  verified.exactIdentity.targetVersion = '1.2.3';
  const baseline = { ...ledger([]), targetVersion: '1.2.3' };
  const evaluate = (candidate) => evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: verified,
    capabilityLedger: candidate,
    qualificationReplay: [],
  });
  const good = evaluate(baseline);
  assert.equal(good.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.UPDATED_AND_CAPABILITIES_VERIFIED);
  assert.equal(good.updatePromotionAllowed, true);
  for (const malformed of [null, undefined, 'OC1', ['NOT_A_CLASS'],
    [OPENCLAW_TASK_CLASS.OC1, OPENCLAW_TASK_CLASS.OC1]]) {
    const hostile = evaluate({
      ...baseline,
      capabilities: [{ ...baseline.capabilities[0], affectedTaskClasses: malformed }],
    });
    assert.equal(hostile.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE, String(malformed));
    assert.equal(hostile.updatePromotionAllowed, false);
    assert.equal(hostile.providerRoutingResumeAllowed, false);
    assert.ok(hostile.blockers.includes('CAPABILITY_LEDGER_AFFECTED_TASK_CLASSES_INVALID'));
  }
  const legacy = { ...baseline.capabilities[0] };
  delete legacy.affectedTaskClasses;
  assert.equal(evaluate({ ...baseline, capabilities: [legacy] }).updatePromotionAllowed, true);
});

test('same-version protected PRESERVE cannot smuggle a different implementation or origin', () => {
  const verified = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  verified.exactIdentity.targetVersion = '1.2.3';
  const preserved = {
    ...ledger([]),
    targetVersion: '1.2.3',
    capabilities: [{
      ...ledger().capabilities[0],
      protected: true,
      updateDisposition: OPENCLAW_UPDATE_DISPOSITION.PRESERVE,
      affectedTaskClasses: [],
      currentImplementation: 'oc8:trusted',
      candidateImplementation: 'oc8:trusted',
      origin: 'stephanos-extension',
      candidateOrigin: 'stephanos-extension',
    }],
  };
  const evaluate = (capabilities) => evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: verified,
    capabilityLedger: { ...preserved, capabilities },
    qualificationReplay: [],
  });
  const positive = evaluate(preserved.capabilities);
  assert.equal(positive.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.UPDATED_AND_CAPABILITIES_VERIFIED);
  assert.equal(positive.updatePromotionAllowed, true);

  // Legacy minimal source fixtures may be read, but cannot promote a runtime.
  const legacy = evaluate([{
    protected: true,
    updateDisposition: OPENCLAW_UPDATE_DISPOSITION.PRESERVE,
    affectedTaskClasses: [],
  }]);
  assert.equal(legacy.updatePromotionAllowed, false);
  assert.ok(legacy.blockers.includes('CAPABILITY_LEDGER_PROTECTED_IDENTITY_UNPROVEN'));

  for (const changed of [
    { candidateImplementation: 'oc8:unqualified' },
    { candidateOrigin: 'upstream' },
    { candidateImplementation: null },
    { origin: 'unknown-origin' },
    { currentImplementation: undefined },
  ]) {
    const unsafe = evaluate([{ ...preserved.capabilities[0], ...changed }]);
    assert.equal(unsafe.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE, JSON.stringify(changed));
    assert.equal(unsafe.updatePromotionAllowed, false);
    assert.equal(unsafe.providerRoutingResumeAllowed, false);
    assert.ok(unsafe.blockers.includes('CAPABILITY_LEDGER_PRESERVE_IDENTITY_CONTRADICTION'));
  }

  const incomplete = { ...preserved.capabilities[0] };
  delete incomplete.candidateOrigin;
  const partial = evaluate([incomplete]);
  assert.equal(partial.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE);
  assert.ok(partial.blockers.includes('CAPABILITY_LEDGER_PRESERVE_IDENTITY_CONTRADICTION'));
});


test('READY protected changed dispositions cannot launder contradictory implementation identity', () => {
  const verified = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  const proof = [replay(OPENCLAW_TASK_CLASS.OC1)];
  const base = {
    ...ledger(),
    capabilities: [{
      ...ledger().capabilities[0],
      protected: true,
      updateDisposition: OPENCLAW_UPDATE_DISPOSITION.MIGRATE,
      affectedTaskClasses: [OPENCLAW_TASK_CLASS.OC1],
      currentImplementation: 'oc8:existing',
      candidateImplementation: 'oc8:new',
      origin: 'stephanos-extension',
      candidateOrigin: 'stephanos-extension',
    }],
  };
  const evaluate = (capability) => evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: verified,
    capabilityLedger: { ...base, capabilities: [capability] },
    qualificationReplay: proof,
  });
  const original = base.capabilities[0];
  assert.equal(evaluate(original).status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.UPDATED_AND_CAPABILITIES_VERIFIED);
  assert.equal(evaluate(original).updatePromotionAllowed, true);

  const replacement = {
    ...original,
    updateDisposition: OPENCLAW_UPDATE_DISPOSITION.REPLACE_WITH_UPSTREAM,
    candidateOrigin: 'upstream',
  };
  assert.equal(evaluate(replacement).updatePromotionAllowed, true);

  const malformed = [
    { ...original, candidateImplementation: original.currentImplementation },
    { ...original, updateDisposition: OPENCLAW_UPDATE_DISPOSITION.IMPROVE,
      candidateImplementation: original.currentImplementation },
    { ...replacement, origin: 'upstream' },
    { ...replacement, candidateOrigin: 'local-config' },
    { ...original, candidateImplementation: null },
    { ...original, origin: 'unregistered' },
    { ...original, candidateOrigin: undefined },
  ];
  const incomplete = { ...original };
  delete incomplete.candidateImplementation;
  malformed.push(incomplete);
  for (const capability of malformed) {
    const rejected = evaluate(capability);
    assert.equal(rejected.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE,
      JSON.stringify(capability));
    assert.equal(rejected.updatePromotionAllowed, false);
    assert.equal(rejected.providerRoutingResumeAllowed, false);
    assert.ok(rejected.blockers.includes('CAPABILITY_LEDGER_CHANGED_DISPOSITION_IDENTITY_CONTRADICTION'),
      JSON.stringify(capability));
  }

  // Incomplete protected identity is no longer a post-update positive fixture.
  const legacy = { ...original };
  for (const key of ['currentImplementation', 'candidateImplementation', 'origin', 'candidateOrigin']) {
    delete legacy[key];
  }
  const blocked = evaluate(legacy);
  assert.equal(blocked.updatePromotionAllowed, false);
  assert.ok(blocked.blockers.includes('CAPABILITY_LEDGER_PROTECTED_IDENTITY_UNPROVEN'));
});

test('protected qualification version and cross-version PRESERVE references match the producer', () => {
  const candidate = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  const original = {
    ...ledger().capabilities[0],
    capabilityId: 'oc8:gateway',
    lastQualifiedVersion: '1.2.3',
    qualificationRefs: ['qualification:oc8'],
    tests: ['test:oc8'],
    evidenceRefs: ['evidence:oc8'],
  };
  const evaluate = (capability) => evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: candidate,
    capabilityLedger: { ...ledger(), capabilities: [capability] },
    qualificationReplay: [replay(OPENCLAW_TASK_CLASS.OC1)],
  });
  const positive = evaluate(original);
  assert.equal(positive.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.UPDATED_AND_CAPABILITIES_VERIFIED);
  assert.equal(positive.updatePromotionAllowed, true);

  for (const lastQualifiedVersion of ['1.2.2', '1.3.0', null, '']) {
    const negative = evaluate({ ...original, lastQualifiedVersion });
    assert.equal(negative.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE, String(lastQualifiedVersion));
    assert.equal(negative.providerRoutingResumeAllowed, false);
    assert.ok(negative.blockers.includes('CAPABILITY_LEDGER_PROTECTED_QUALIFICATION_VERSION_MISMATCH'));
  }
  for (const field of ['qualificationRefs', 'tests', 'evidenceRefs']) {
    for (const invalid of [[], [null], ['invalid proof reference']]) {
      const negative = evaluate({ ...original, [field]: invalid });
      assert.equal(negative.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE, field);
      assert.equal(negative.updatePromotionAllowed, false);
      assert.ok(negative.blockers.includes('CAPABILITY_LEDGER_PRESERVE_EVIDENCE_UNPROVEN'), field);
    }
  }
  const sameVersion = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  sameVersion.exactIdentity.targetVersion = '1.2.3';
  const compatible = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: sameVersion,
    capabilityLedger: {
      ...ledger([]),
      targetVersion: '1.2.3',
      capabilities: [{ ...original, qualificationRefs: [], tests: [], evidenceRefs: [], affectedTaskClasses: [] }],
    },
    qualificationReplay: [],
  });
  assert.equal(compatible.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.UPDATED_AND_CAPABILITIES_VERIFIED);
  assert.equal(compatible.updatePromotionAllowed, true);
});


test('absent protected post-update evidence fails as closed as explicit empty evidence', () => {
  const verified = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  const full = ledger();
  const proof = [replay(OPENCLAW_TASK_CLASS.OC1)];
  const evaluate = (capability) => evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: verified,
    capabilityLedger: { ...full, capabilities: [capability] },
    qualificationReplay: proof,
  });
  const good = evaluate(full.capabilities[0]);
  assert.equal(good.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.UPDATED_AND_CAPABILITIES_VERIFIED);
  assert.equal(good.updatePromotionAllowed, true);

  for (const field of ['capabilityId', 'currentImplementation', 'candidateImplementation',
    'origin', 'candidateOrigin', 'lastQualifiedVersion']) {
    const missing = { ...full.capabilities[0] };
    delete missing[field];
    const result = evaluate(missing);
    assert.equal(result.updatePromotionAllowed, false, field);
    assert.equal(result.providerRoutingResumeAllowed, false, field);
    assert.ok(result.blockers.includes('CAPABILITY_LEDGER_PROTECTED_IDENTITY_UNPROVEN'), field);
  }
  for (const field of ['qualificationRefs', 'tests', 'evidenceRefs']) {
    for (const value of [undefined, [], null]) {
      const changed = { ...full.capabilities[0] };
      if (value === undefined) delete changed[field];
      else changed[field] = value;
      const result = evaluate(changed);
      assert.equal(result.updatePromotionAllowed, false, field);
      assert.equal(result.providerRoutingResumeAllowed, false, field);
      assert.ok(result.blockers.includes('CAPABILITY_LEDGER_PRESERVE_EVIDENCE_UNPROVEN'), field);
    }
  }

  const changed = { ...full.capabilities[0],
    updateDisposition: OPENCLAW_UPDATE_DISPOSITION.MIGRATE,
    candidateImplementation: 'oc8:migrated' };
  assert.equal(evaluate(changed).updatePromotionAllowed, true);
  for (const field of ['currentImplementation', 'candidateImplementation', 'origin', 'candidateOrigin']) {
    const missing = { ...changed };
    delete missing[field];
    const result = evaluate(missing);
    assert.equal(result.updatePromotionAllowed, false, field);
    assert.ok(result.blockers.includes('CAPABILITY_LEDGER_CHANGED_DISPOSITION_IDENTITY_CONTRADICTION'), field);
  }

  // Pre-update/source-only legacy records remain readable but never grant promotion.
  const preflight = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.READY_TO_APPLY),
    capabilityLedger: { ...full, capabilities: [{
      protected: true,
      updateDisposition: OPENCLAW_UPDATE_DISPOSITION.PRESERVE,
      affectedTaskClasses: [OPENCLAW_TASK_CLASS.OC1],
    }] },
    qualificationReplay: [],
  });
  assert.equal(preflight.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.PRE_UPDATE_CAPABILITY_GATE_READY);
  assert.equal(preflight.updatePromotionAllowed, false);
  assert.equal(preflight.providerRoutingResumeAllowed, false);
});

test('changed protected capabilities cannot promote without producer-required test and evidence proofs', () => {
  const verified = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  const full = ledger();
  const qualificationReplay = [replay(OPENCLAW_TASK_CLASS.OC1)];
  const dispositions = [
    OPENCLAW_UPDATE_DISPOSITION.MIGRATE,
    OPENCLAW_UPDATE_DISPOSITION.IMPROVE,
    OPENCLAW_UPDATE_DISPOSITION.REPLACE_WITH_UPSTREAM,
  ];
  const evaluate = (capability) => evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: verified,
    capabilityLedger: { ...full, capabilities: [capability] },
    qualificationReplay,
  });
  for (const updateDisposition of dispositions) {
    const good = {
      ...full.capabilities[0],
      updateDisposition,
      candidateImplementation: 'oc8:new',
      candidateOrigin: updateDisposition === OPENCLAW_UPDATE_DISPOSITION.REPLACE_WITH_UPSTREAM
        ? 'upstream' : 'stephanos-extension',
    };
    assert.equal(evaluate(good).updatePromotionAllowed, true, updateDisposition);
    for (const field of ['tests', 'evidenceRefs']) {
      for (const value of [undefined, null, [], [null], ['invalid proof reference']]) {
        const malformed = { ...good };
        if (value === undefined) delete malformed[field];
        else malformed[field] = value;
        const rejected = evaluate(malformed);
        assert.equal(rejected.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE,
          `${updateDisposition} ${field} ${String(value)}`);
        assert.equal(rejected.updatePromotionAllowed, false);
        assert.equal(rejected.providerRoutingResumeAllowed, false);
        assert.ok(rejected.blockers.includes('CAPABILITY_LEDGER_CHANGED_PROOF_UNPROVEN'));
      }
    }
  }
  // A legacy source-only preflight is still readable, but never self-authorizes promotion.
  const preflight = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.READY_TO_APPLY),
    capabilityLedger: { ...full, capabilities: [{ ...full.capabilities[0], tests: [], evidenceRefs: [] }] },
    qualificationReplay: [],
  });
  assert.equal(preflight.updatePromotionAllowed, false);
  assert.equal(preflight.providerRoutingResumeAllowed, false);
});

test('post-update promotion requires the complete producer adapter and source-only safety envelope', () => {
  const verified = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  const candidate = ledger();
  const qualificationReplay = [replay(OPENCLAW_TASK_CLASS.OC1)];
  const evaluate = (stage) => evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: stage,
    capabilityLedger: candidate,
    qualificationReplay: stage.status === OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED
      ? qualificationReplay : [],
  });
  assert.equal(evaluate(verified).updatePromotionAllowed, true);
  for (const key of [
    'sourceHarnessOnly', 'arbitraryShellAllowed', 'arbitraryPathAllowed',
    'battleBridgeAdapterRequired', 'operatorApprovalRequired',
    'secretsIncluded', 'absolutePathsPublished',
  ]) {
    const safety = { ...verified.safety };
    delete safety[key];
    const result = evaluate({ ...verified, safety });
    assert.equal(result.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE, key);
    assert.equal(result.updatePromotionAllowed, false, key);
    assert.equal(result.providerRoutingResumeAllowed, false, key);
    assert.ok(result.blockers.includes('STAGED_UPDATE_SAFETY_PRODUCER_ENVELOPE_MISSING'), key);
  }
  // Read-only legacy fixtures need not pretend they can commission a loaded guard.
  const preflight = staged(OPENCLAW_STAGED_UPDATE_STATUS.READY_TO_APPLY);
  for (const key of [
    'sourceHarnessOnly', 'arbitraryShellAllowed', 'arbitraryPathAllowed',
    'battleBridgeAdapterRequired', 'operatorApprovalRequired',
    'secretsIncluded', 'absolutePathsPublished',
  ]) delete preflight.safety[key];
  const legacy = evaluate(preflight);
  assert.equal(legacy.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.PRE_UPDATE_CAPABILITY_GATE_READY);
  assert.equal(legacy.updatePromotionAllowed, false);
  assert.equal(legacy.providerRoutingResumeAllowed, false);
});

test('post-update changed unprotected capabilities require the producer implementation identity', () => {
  const verified = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  const original = ledger();
  const proof = [replay(OPENCLAW_TASK_CLASS.OC1)];
  const changed = {
    capabilityId: 'oc4:unprotected',
    protected: false,
    updateDisposition: OPENCLAW_UPDATE_DISPOSITION.MIGRATE,
    affectedTaskClasses: [OPENCLAW_TASK_CLASS.OC1],
    currentImplementation: 'oc4:old',
    candidateImplementation: 'oc4:new',
    origin: 'stephanos-extension',
    candidateOrigin: 'stephanos-extension',
    tests: ['test:oc4'],
    evidenceRefs: ['evidence:oc4'],
  };
  const evaluate = (capability) => evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: verified,
    capabilityLedger: { ...original, capabilities: [...original.capabilities, capability] },
    qualificationReplay: proof,
  });
  const positive = evaluate(changed);
  assert.equal(positive.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.UPDATED_AND_CAPABILITIES_VERIFIED);
  assert.equal(positive.updatePromotionAllowed, true);
  const missingAll = { ...changed };
  for (const key of ['currentImplementation', 'candidateImplementation', 'origin', 'candidateOrigin']) {
    delete missingAll[key];
  }
  const negatives = [missingAll, ...['currentImplementation', 'candidateImplementation', 'origin', 'candidateOrigin']
    .map((key) => {
      const incomplete = { ...changed };
      delete incomplete[key];
      return incomplete;
    })];
  for (const candidate of negatives) {
    const blocked = evaluate(candidate);
    assert.equal(blocked.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE,
      JSON.stringify(candidate));
    assert.equal(blocked.updatePromotionAllowed, false);
    assert.equal(blocked.providerRoutingResumeAllowed, false);
    assert.ok(blocked.blockers.includes('CAPABILITY_LEDGER_CHANGED_DISPOSITION_IDENTITY_CONTRADICTION'),
      JSON.stringify(candidate));
  }
});

test('post-update promotion retains preflight manifest and packet identity pins', () => {
  const verified = staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  const candidate = ledger();
  const qualificationReplay = [replay(OPENCLAW_TASK_CLASS.OC1)];
  const evaluate = (stage) => evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: stage,
    capabilityLedger: candidate,
    qualificationReplay,
  });
  assert.equal(evaluate(verified).updatePromotionAllowed, true);

  // The producer refuses these malformed/absent identities before a stage can
  // claim UPDATED_AND_VERIFIED. A forged consumer envelope must not restore routing.
  for (const key of ['repository', 'manifestSha256', 'packetId', 'packetSha256']) {
    for (const value of [undefined, null, '', 0]) {
      const result = evaluate({ ...verified, exactIdentity: { ...verified.exactIdentity, [key]: value } });
      assert.equal(result.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE, key);
      assert.equal(result.updatePromotionAllowed, false, key);
      assert.equal(result.providerRoutingResumeAllowed, false, key);
      assert.ok(result.blockers.includes('STAGED_UPDATE_EXACT_IDENTITY_INCOMPLETE'), key);
    }
  }
  for (const [key, value] of [
    ['repository', 'repository-without-owner'],
    ['manifestSha256', 'a'.repeat(63)],
    ['manifestSha256', 'z'.repeat(64)],
    ['packetSha256', 'z'.repeat(64)],
  ]) {
    const result = evaluate({ ...verified, exactIdentity: { ...verified.exactIdentity, [key]: value } });
    assert.equal(result.updatePromotionAllowed, false, key);
    assert.ok(result.blockers.includes('STAGED_UPDATE_EXACT_IDENTITY_INCOMPLETE'), key);
  }
  const noPacket = { ...verified.exactIdentity };
  delete noPacket.packetId;
  assert.equal(evaluate({ ...verified, exactIdentity: noPacket }).updatePromotionAllowed, false);

  // A read-only legacy preflight does not gain runtime promotion authority.
  const preflight = staged(OPENCLAW_STAGED_UPDATE_STATUS.READY_TO_APPLY);
  delete preflight.exactIdentity.packetSha256;
  const legacy = evaluate(preflight);
  assert.equal(legacy.status, OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.PRE_UPDATE_CAPABILITY_GATE_READY);
  assert.equal(legacy.updatePromotionAllowed, false);
  assert.equal(legacy.providerRoutingResumeAllowed, false);
});
