import assert from 'node:assert/strict';
import test from 'node:test';

import { validateSharedWorkspaceRecord } from './sharedAgentWorkspaceStore.mjs';
import {
  UI_AGENT_ID,
  UI_AGENT_QA_CAPABILITY,
  buildUiAgentReadiness,
  createUiAgentCapabilityRecord,
  createUiAgentParticipantStatusRecord,
  createUiAgentWorkspaceRecords,
} from './uiAgentParticipantV1.mjs';

const timestampUtc = '2026-08-14T11:00:00.000Z';
const proofRefs = ['evidence/receipts/ui-agent-participant-v1'];
const validationOptions = { nowMs: Date.parse(timestampUtc) };

function readinessForCapability(capability, options = validationOptions) {
  return buildUiAgentReadiness({ capability, timestampUtc, proofRefs, validationOptions: options });
}

test('UI Agent capability card registers one read-only candidate with bounded authority', () => {
  const record = createUiAgentCapabilityRecord({ timestampUtc, proofRefs });
  const validation = validateSharedWorkspaceRecord(record, validationOptions);

  assert.equal(record.agentId, UI_AGENT_ID);
  assert.equal(record.agentClass, 'USER_INTERFACE_AND_EXPERIENCE_SPECIALIST');
  assert.equal(record.qaCapability, UI_AGENT_QA_CAPABILITY);
  assert.equal(record.lifecycleState, 'READ_ONLY_CANDIDATE');
  assert.equal(record.mode, 'read_first');
  assert.equal(record.boundedWritePath, 'shared-workspace/ui/proposals');
  assert.equal(record.mutationAuthority, 'NONE_BY_PARTICIPATION');
  assert.equal(record.implementationAuthority, 'GOVERNED_TASK_CONTRACT_REQUIRED');
  assert.equal(record.trustedBuilder, false);
  assert.equal(record.mergeAuthority, false);
  assert.equal(record.arbitraryShellAllowed, false);
  assert.equal(record.deploymentAuthority, false);
  assert.equal(record.productAuthority, false);
  assert.equal(record.personalDataAuthority, false);
  assert.equal(record.selfPromotionAllowed, false);
  assert.equal(validation.valid, true, validation.errors.join(','));
  assert.equal(validation.stale, false);
});

test('UI Agent advertises the required shared-workspace Q&A and knowledge domains', () => {
  const record = createUiAgentCapabilityRecord({ timestampUtc, proofRefs });

  assert.equal(record.qaCapability, 'CAN_ASK_AND_ANSWER');
  assert.ok(record.knowledgeDomains.includes('ui'));
  assert.ok(record.knowledgeDomains.includes('accessibility'));
  assert.ok(record.knowledgeDomains.includes('spatial-ui'));
  assert.ok(record.acceptedTaskTypes.includes('UI_RESEARCH'));
  assert.ok(record.acceptedTaskTypes.includes('UI_AUDIT'));
  assert.ok(record.acceptedTaskTypes.includes('UI_DESIGN'));
  assert.ok(record.acceptedTaskTypes.includes('UI_REVIEW'));
  assert.ok(record.acceptedTaskTypes.includes('EXPERIENCE_PROOF_PLANNING'));
  assert.equal(record.acceptedTaskTypes.includes('UI_IMPLEMENTATION'), false);
});

test('M1 readiness advances only to M2 and never self-promotes into implementation', () => {
  const readiness = buildUiAgentReadiness({ timestampUtc, proofRefs, validationOptions });

  assert.equal(readiness.readyForSharedWorkspaceRegistration, true);
  assert.equal(readiness.productionEligible, false);
  assert.equal(readiness.implementationEligible, false);
  assert.equal(readiness.lifecycleState, 'READ_ONLY_CANDIDATE');
  assert.equal(readiness.nextMilestone, 'M2_INVENTORY_USER_FACING_SURFACES_AND_SHARED_VISUAL_PRIMITIVES');
  assert.deepEqual(readiness.blockers, []);
});

test('participant status preserves issue lineage and zero mutation authority', () => {
  const status = createUiAgentParticipantStatusRecord({
    timestampUtc,
    correlationId: 'ui-agent-m1',
    proofRefs,
    validationOptions,
  });
  const validation = validateSharedWorkspaceRecord(status, validationOptions);
  const body = JSON.parse(status.body);

  assert.equal(status.participantId, UI_AGENT_ID);
  assert.equal(status.relatedIssue, '#1722');
  assert.equal(status.correlationId, 'ui-agent-m1');
  assert.equal(status.status, 'UI_AGENT_READ_ONLY_CANDIDATE_READY');
  assert.equal(body.qaCapability, 'CAN_ASK_AND_ANSWER');
  assert.equal(body.mutationAuthority, 'NONE_BY_PARTICIPATION');
  assert.equal(body.mergeAuthority, false);
  assert.equal(body.deploymentAuthority, false);
  assert.equal(body.productionEligible, false);
  assert.equal(validation.valid, true, validation.errors.join(','));
});

test('workspace record bundle validates both capability and participant status', () => {
  const bundle = createUiAgentWorkspaceRecords({
    timestampUtc,
    correlationId: 'ui-agent-m1-bundle',
    proofRefs,
    validationOptions,
  });

  assert.equal(bundle.capability.agentId, UI_AGENT_ID);
  assert.equal(bundle.status.participantId, UI_AGENT_ID);
  assert.equal(bundle.readiness.readyForSharedWorkspaceRegistration, true);
  assert.equal(bundle.validations.capability.valid, true, bundle.validations.capability.errors.join(','));
  assert.equal(bundle.validations.status.valid, true, bundle.validations.status.errors.join(','));
});

test('shared workspace rejects a UI capability card that tries to gain merge authority', () => {
  const record = {
    ...createUiAgentCapabilityRecord({ timestampUtc, proofRefs }),
    mergeAuthority: true,
  };
  const validation = validateSharedWorkspaceRecord(record, validationOptions);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('merge-authority-forbidden'));
});

test('readiness enforces every canonical read-only identity, mode, task and authority invariant', () => {
  const canonical = createUiAgentCapabilityRecord({ timestampUtc, proofRefs });
  const cases = [
    ['participantSchemaVersion', 'wrong-schema', 'participant-schema-version-mismatch'],
    ['agentClass', 'UNRELATED_AGENT', 'agent-class-mismatch'],
    ['qaCapability', 'CAN_ASK_ONLY', 'qa-capability-missing'],
    ['knowledgeDomains', ['ui'], 'knowledge-domains-mismatch'],
    ['acceptedTaskTypes', [...canonical.acceptedTaskTypes, 'UI_IMPLEMENTATION'], 'advisory-task-set-mismatch'],
    ['lifecycleState', 'BOUNDED_EXECUTOR', 'unexpected-lifecycle-state'],
    ['mode', 'write_enabled', 'mode-not-read-first'],
    ['boundedWritePath', 'src/ui', 'proposal-path-mismatch'],
    ['trustedBuilder', true, 'trusted-builder-widened'],
    ['mergeAuthority', undefined, 'merge-authority-widened'],
    ['arbitraryShellAllowed', 'false', 'arbitrary-shell-widened'],
    ['mutationAuthority', 'DIRECT_SOURCE_WRITE', 'mutation-authority-widened'],
    ['implementationAuthority', 'DIRECT_IMPLEMENTATION', 'implementation-authority-widened'],
    ['productAuthority', true, 'product-authority-widened'],
    ['deploymentAuthority', true, 'deployment-authority-widened'],
    ['personalDataAuthority', true, 'personal-data-authority-widened'],
    ['selfPromotionAllowed', true, 'self-promotion-widened'],
  ];

  for (const [field, value, expectedBlocker] of cases) {
    const capability = { ...canonical, [field]: value };
    const readiness = readinessForCapability(capability);
    assert.equal(readiness.readyForSharedWorkspaceRegistration, false, `${field} must fail closed`);
    assert.ok(readiness.blockers.includes(expectedBlocker), `${field} should emit ${expectedBlocker}`);
    assert.equal(readiness.productionEligible, false);
    assert.equal(readiness.implementationEligible, false);
  }
});

test('readiness blocks structurally valid but stale capability evidence', () => {
  const capability = createUiAgentCapabilityRecord({ timestampUtc, proofRefs });
  const staleValidationOptions = {
    nowMs: Date.parse('2026-08-14T13:00:01.000Z'),
    staleAfterMs: 60 * 60 * 1000,
  };
  const validation = validateSharedWorkspaceRecord(capability, staleValidationOptions);
  assert.equal(validation.valid, true);
  assert.equal(validation.stale, true);

  const readiness = readinessForCapability(capability, staleValidationOptions);
  assert.equal(readiness.readyForSharedWorkspaceRegistration, false);
  assert.ok(readiness.blockers.includes('capability-stale'));
  assert.equal(readiness.nextMilestone, 'M1_REPAIR_UI_AGENT_PARTICIPANT_CONTRACT');
});

test('readiness rejects duplicate or substituted advisory capability sets', () => {
  const canonical = createUiAgentCapabilityRecord({ timestampUtc, proofRefs });
  const duplicateTask = readinessForCapability({
    ...canonical,
    acceptedTaskTypes: [...canonical.acceptedTaskTypes.slice(0, -1), canonical.acceptedTaskTypes[0]],
  });
  assert.equal(duplicateTask.readyForSharedWorkspaceRegistration, false);
  assert.ok(duplicateTask.blockers.includes('advisory-task-set-mismatch'));

  const substitutedDomain = readinessForCapability({
    ...canonical,
    knowledgeDomains: [...canonical.knowledgeDomains.slice(0, -1), 'source-implementation'],
  });
  assert.equal(substitutedDomain.readyForSharedWorkspaceRegistration, false);
  assert.ok(substitutedDomain.blockers.includes('knowledge-domains-mismatch'));
});

test('readiness rejects undeclared authority-bearing or caller-invented capability fields', () => {
  const canonical = createUiAgentCapabilityRecord({ timestampUtc, proofRefs });
  for (const field of ['commandExecutionAllowed', 'sourceMutationAuthority', 'destructiveGitAllowed']) {
    const readiness = readinessForCapability({ ...canonical, [field]: false });
    assert.equal(readiness.readyForSharedWorkspaceRegistration, false, `${field} must fail closed even when false`);
    assert.ok(readiness.blockers.includes(`capability-unknown-field:${field}`));
  }
});

test('participant status recomputes readiness and ignores a caller-supplied green verdict', () => {
  const capability = {
    ...createUiAgentCapabilityRecord({ timestampUtc, proofRefs }),
    productAuthority: true,
  };
  const status = createUiAgentParticipantStatusRecord({
    timestampUtc,
    correlationId: 'ui-agent-forged-readiness',
    proofRefs,
    capability,
    readiness: {
      readyForSharedWorkspaceRegistration: true,
      productionEligible: true,
      implementationEligible: true,
      lifecycleState: 'PRODUCTION_ELIGIBLE',
      qaCapability: 'CAN_ASK_AND_ANSWER',
      nextMilestone: 'SELF_PROMOTE',
    },
    validationOptions,
  });
  const body = JSON.parse(status.body);

  assert.equal(status.status, 'UI_AGENT_PARTICIPANT_BLOCKED');
  assert.equal(body.productionEligible, false);
  assert.equal(body.implementationEligible, false);
  assert.equal(body.lifecycleState, 'READ_ONLY_CANDIDATE');
  assert.equal(body.nextMilestone, 'M1_REPAIR_UI_AGENT_PARTICIPANT_CONTRACT');
});

test('future-dated capability evidence cannot register as current readiness', () => {
  const capability = createUiAgentCapabilityRecord({
    timestampUtc: '2026-08-14T11:10:01.000Z',
    proofRefs,
  });
  const genericValidation = validateSharedWorkspaceRecord(capability, validationOptions);
  assert.equal(genericValidation.valid, true);
  assert.equal(genericValidation.stale, false);

  const readiness = readinessForCapability(capability, {
    nowMs: Date.parse(timestampUtc),
    maxFutureSkewMs: 5 * 60 * 1000,
  });
  assert.equal(readiness.readyForSharedWorkspaceRegistration, false);
  assert.ok(readiness.blockers.includes('capability-future-dated'));
  assert.equal(readiness.nextMilestone, 'M1_REPAIR_UI_AGENT_PARTICIPANT_CONTRACT');
});
