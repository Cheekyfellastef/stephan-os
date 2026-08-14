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

test('UI Agent capability card registers one read-only candidate with bounded authority', () => {
  const record = createUiAgentCapabilityRecord({ timestampUtc, proofRefs });
  const validation = validateSharedWorkspaceRecord(record, validationOptions);

  assert.equal(record.agentId, UI_AGENT_ID);
  assert.equal(record.agentClass, 'USER_INTERFACE_AND_EXPERIENCE_SPECIALIST');
  assert.equal(record.qaCapability, UI_AGENT_QA_CAPABILITY);
  assert.equal(record.lifecycleState, 'READ_ONLY_CANDIDATE');
  assert.equal(record.mutationAuthority, 'NONE_BY_PARTICIPATION');
  assert.equal(record.implementationAuthority, 'GOVERNED_TASK_CONTRACT_REQUIRED');
  assert.equal(record.trustedBuilder, false);
  assert.equal(record.mergeAuthority, false);
  assert.equal(record.arbitraryShellAllowed, false);
  assert.equal(record.deploymentAuthority, false);
  assert.equal(record.selfPromotionAllowed, false);
  assert.equal(validation.valid, true, validation.errors.join(','));
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

test('readiness fails closed if participation tries to widen mutation authority', () => {
  const capability = {
    ...createUiAgentCapabilityRecord({ timestampUtc, proofRefs }),
    mutationAuthority: 'DIRECT_SOURCE_WRITE',
  };
  const readiness = buildUiAgentReadiness({ capability, timestampUtc, proofRefs, validationOptions });

  assert.equal(readiness.readyForSharedWorkspaceRegistration, false);
  assert.equal(readiness.productionEligible, false);
  assert.equal(readiness.implementationEligible, false);
  assert.ok(readiness.blockers.includes('mutation-authority-widened'));
  assert.equal(readiness.nextMilestone, 'M1_REPAIR_UI_AGENT_PARTICIPANT_CONTRACT');
});
