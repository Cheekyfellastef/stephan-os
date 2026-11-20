import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPENCLAW_CAPABILITY_STAGES,
  OPENCLAW_STAGE_STATE,
  buildOpenClawCapabilityLadderContract,
  createOpenClawCapabilityRecord,
  createOpenClawDispatchQueueRecord,
  projectOpenClawOperatorAutomation,
  verifyOpenClawCapabilityStage,
} from './openClawCapabilityLadder.mjs';

test('capability ladder exposes safe staged automation contract', () => {
  const contract = buildOpenClawCapabilityLadderContract();

  assert.deepEqual(contract.stages, ['repo_scout', 'test_runner', 'patch_prep', 'approval_gated_writer', 'pr_helper']);
  assert.equal(contract.guardrails.defaultMode, 'design_only');
  assert.equal(contract.guardrails.boundedWritePath, '/courier-open');
  assert.equal(contract.guardrails.trustedSourceWritesAllowed, false);
  assert.equal(contract.guardrails.mergeAuthority, false);
  assert.equal(contract.finalVerdict, 'OPENCLAW_CAPABILITY_LADDER_CONTRACT_READY');
});

test('OpenClaw capability records always publish design_only bounded posture', () => {
  for (const stage of OPENCLAW_CAPABILITY_STAGES) {
    const record = createOpenClawCapabilityRecord({
      stage,
      timestampUtc: '2026-07-07T00:00:00Z',
      proofRefs: [`proof/openclaw/${stage}.json`],
    });

    assert.equal(record.agentId, 'openclaw');
    assert.equal(record.mode, 'design_only');
    assert.equal(record.boundedWritePath, '/courier-open');
    assert.equal(record.trustedBuilder, false);
    assert.equal(record.mergeAuthority, false);
    assert.equal(record.arbitraryShellAllowed, false);
    assert.equal(record.stage, stage);
  }
});

test('operator automation projection separates now approval and blocked actions', () => {
  const projection = projectOpenClawOperatorAutomation({ timestampUtc: '2026-07-07T00:00:00Z' });

  assert.deepEqual(projection.canRunNow, ['repo_scout', 'test_runner', 'patch_prep']);
  assert.deepEqual(projection.needsApproval, ['approval_gated_writer']);
  assert.deepEqual(projection.blocked, ['pr_helper']);
  assert.equal(projection.exactNextAction, 'Read repository metadata and publish a design-only scout note to Shared Workspace.');
  assert.equal(projection.sharedWorkspaceMessage.requiresOperator, true);
  assert.equal(projection.finalVerdict, 'OPENCLAW_OPERATOR_AUTOMATION_PROJECTION_READY');
});

test('verification harness checks every capability stage with shared workspace records and proof refs', () => {
  for (const stage of OPENCLAW_CAPABILITY_STAGES) {
    const verification = verifyOpenClawCapabilityStage({ stage, timestampUtc: '2026-07-07T00:00:00Z' });

    assert.equal(verification.status, 'PASS');
    assert.equal(verification.overall, 'VERIFIED');
    assert.equal(verification.checks.length, 2);
    assert.equal(verification.proofRefs.includes(`proof/openclaw/${stage}.json`), true);
  }
});

test('dispatch queue integration keeps Codex as writer and gates writer stage approval', () => {
  const scout = createOpenClawDispatchQueueRecord({ stage: 'repo_scout', timestampUtc: '2026-07-07T00:00:00Z' });
  const writer = createOpenClawDispatchQueueRecord({ stage: 'approval_gated_writer', timestampUtc: '2026-07-07T00:00:00Z' });

  assert.equal(scout.approvalRequirements.requiresOperatorApprovalBeforeDispatch, false);
  assert.equal(writer.approvalRequirements.requiresOperatorApprovalBeforeDispatch, true);
  assert.equal(writer.approvalRequirements.requiresOperatorApprovalBeforeMerge, true);
  assert.equal(writer.resultMetadata.openClawMode, 'design_only');
  assert.equal(writer.resultMetadata.boundedWritePath, '/courier-open');
  assert.equal(writer.requestedProofCommands.includes('node --test shared/agents/*openclaw*capability*.test.mjs'), true);
});

test('stage states are deterministic', () => {
  assert.equal(createOpenClawCapabilityRecord({ stage: 'repo_scout' }).stageState, OPENCLAW_STAGE_STATE.CAN_RUN_NOW);
  assert.equal(createOpenClawCapabilityRecord({ stage: 'approval_gated_writer' }).stageState, OPENCLAW_STAGE_STATE.NEEDS_APPROVAL);
  assert.equal(createOpenClawCapabilityRecord({ stage: 'pr_helper' }).stageState, OPENCLAW_STAGE_STATE.BLOCKED);
});
