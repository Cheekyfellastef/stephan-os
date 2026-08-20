import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OPENCLAW_TASK_CLASS,
  OPENCLAW_UPDATE_CAPABILITY_ORIGIN,
  OPENCLAW_UPDATE_DISPOSITION,
  buildOpenClawUpdateCapabilityLedgerV1,
} from './openClawUpdateCapabilityLedgerV1.mjs';

function baseCapability(overrides = {}) {
  return {
    capabilityId: 'openclaw.gateway-provider',
    purpose: 'Provide the canonical OpenClaw Gateway provider surface.',
    currentImplementation: 'stephanos.gateway-provider.v1',
    candidateImplementation: 'stephanos.gateway-provider.v1',
    origin: OPENCLAW_UPDATE_CAPABILITY_ORIGIN.STEPHANOS_EXTENSION,
    candidateOrigin: OPENCLAW_UPDATE_CAPABILITY_ORIGIN.STEPHANOS_EXTENSION,
    protected: true,
    qualificationRefs: ['qualification:oc1'],
    tests: ['test:gateway-provider'],
    dependencies: ['capability:shared-workspace'],
    migrationPolicy: 'Preserve unless a candidate proves the same bounded provider contract.',
    replacementCriteria: 'Same or stronger bounded provider contract with dependent integrations passing.',
    lastQualifiedVersion: '1.2.3',
    updateDisposition: OPENCLAW_UPDATE_DISPOSITION.PRESERVE,
    evidenceRefs: ['proof:gateway-provider'],
    affectedTaskClasses: [OPENCLAW_TASK_CLASS.OC1],
    ...overrides,
  };
}

function ledger(capabilities) {
  return buildOpenClawUpdateCapabilityLedgerV1({
    currentVersion: '1.2.3',
    targetVersion: '1.3.0',
    capabilities,
  });
}

test('preserved protected capability is accepted without qualification replay', () => {
  const result = ledger([baseCapability()]);
  assert.equal(result.verdict, 'CAPABILITY_LEDGER_READY_FOR_CANDIDATE_PROOF');
  assert.equal(result.updateAllowed, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.protectedCapabilityCount, 1);
  assert.deepEqual(result.requiredQualificationReplay, []);
  assert.equal(result.authority.updateExecutionAllowed, false);
  assert.equal(result.authority.runtimeMutationAllowed, false);
});

test('migration requires candidate proof and marks affected task classes for replay', () => {
  const result = ledger([baseCapability({
    candidateImplementation: 'stephanos.gateway-provider.v2',
    updateDisposition: OPENCLAW_UPDATE_DISPOSITION.MIGRATE,
    evidenceRefs: ['proof:gateway-provider-v2'],
    tests: ['test:gateway-provider-v2'],
    affectedTaskClasses: [OPENCLAW_TASK_CLASS.OC1, OPENCLAW_TASK_CLASS.OC6],
  })]);
  assert.equal(result.updateAllowed, true);
  assert.deepEqual(result.requiredQualificationReplay, [
    OPENCLAW_TASK_CLASS.OC1,
    OPENCLAW_TASK_CLASS.OC6,
  ].sort());
  assert.equal(result.authority.qualificationInvalidationRequired, true);
});

test('custom capability may be replaced by upstream only with upstream candidate and proof', () => {
  const accepted = ledger([baseCapability({
    candidateImplementation: 'openclaw.native-gateway-provider',
    candidateOrigin: OPENCLAW_UPDATE_CAPABILITY_ORIGIN.UPSTREAM,
    updateDisposition: OPENCLAW_UPDATE_DISPOSITION.REPLACE_WITH_UPSTREAM,
    tests: ['test:native-gateway-provider'],
    evidenceRefs: ['proof:native-gateway-provider'],
  })]);
  assert.equal(accepted.updateAllowed, true);
  assert.deepEqual(accepted.requiredQualificationReplay, [OPENCLAW_TASK_CLASS.OC1]);

  const blocked = ledger([baseCapability({
    candidateImplementation: 'stephanos.gateway-provider.v2',
    candidateOrigin: OPENCLAW_UPDATE_CAPABILITY_ORIGIN.STEPHANOS_EXTENSION,
    updateDisposition: OPENCLAW_UPDATE_DISPOSITION.REPLACE_WITH_UPSTREAM,
  })]);
  assert.equal(blocked.verdict, 'BLOCK_UPDATE');
  assert.ok(blocked.blockers.includes('UPSTREAM_REPLACEMENT_ORIGIN_REQUIRED:openclaw.gateway-provider'));
});

test('protected BLOCK_UPDATE disposition fails closed', () => {
  const result = ledger([baseCapability({
    updateDisposition: OPENCLAW_UPDATE_DISPOSITION.BLOCK_UPDATE,
  })]);
  assert.equal(result.updateAllowed, false);
  assert.ok(result.blockers.includes('PROTECTED_CAPABILITY_BLOCKS_UPDATE:openclaw.gateway-provider'));
});

test('preserve cannot silently change implementation or origin', () => {
  const result = ledger([baseCapability({
    candidateImplementation: 'openclaw.native-gateway-provider',
    candidateOrigin: OPENCLAW_UPDATE_CAPABILITY_ORIGIN.UPSTREAM,
  })]);
  assert.equal(result.updateAllowed, false);
  assert.ok(result.blockers.includes('PRESERVE_IDENTITY_CHANGED:openclaw.gateway-provider'));
});

test('candidate-changing dispositions require tests and evidence', () => {
  const result = ledger([baseCapability({
    candidateImplementation: 'stephanos.gateway-provider.v2',
    updateDisposition: OPENCLAW_UPDATE_DISPOSITION.IMPROVE,
    tests: [],
    evidenceRefs: [],
  })]);
  assert.equal(result.updateAllowed, false);
  assert.ok(result.blockers.includes('CANDIDATE_TEST_PROOF_REQUIRED:openclaw.gateway-provider'));
  assert.ok(result.blockers.includes('CANDIDATE_EVIDENCE_REQUIRED:openclaw.gateway-provider'));
});

test('duplicate capability identities fail closed', () => {
  const result = ledger([
    baseCapability(),
    baseCapability({ purpose: 'Conflicting duplicate purpose.' }),
  ]);
  assert.equal(result.updateAllowed, false);
  assert.ok(result.blockers.includes('DUPLICATE_CAPABILITY_ID:openclaw.gateway-provider'));
});

test('unknown fields are rejected rather than gaining hidden authority', () => {
  const malformed = baseCapability();
  malformed.executeUpdate = true;
  const result = ledger([malformed]);
  assert.equal(result.updateAllowed, false);
  assert.ok(result.blockers.includes('CAPABILITY_SCHEMA_INVALID'));
});

test('unknown task classes are rejected', () => {
  const result = ledger([baseCapability({ affectedTaskClasses: ['OC99_UNBOUNDED'] })]);
  assert.equal(result.updateAllowed, false);
  assert.ok(result.blockers.includes('AFFECTEDTASKCLASSES_ENTRY_INVALID:openclaw.gateway-provider'));
});

test('ledger itself is closed-world and requires at least one protected capability', () => {
  const unknownTopLevel = buildOpenClawUpdateCapabilityLedgerV1({
    currentVersion: '1.2.3',
    targetVersion: '1.3.0',
    capabilities: [baseCapability()],
    approval: true,
  });
  assert.equal(unknownTopLevel.updateAllowed, false);
  assert.deepEqual(unknownTopLevel.blockers, ['LEDGER_SCHEMA_INVALID']);

  const unprotectedOnly = ledger([baseCapability({ protected: false })]);
  assert.equal(unprotectedOnly.updateAllowed, false);
  assert.ok(unprotectedOnly.blockers.includes('NO_PROTECTED_CAPABILITIES'));
});
