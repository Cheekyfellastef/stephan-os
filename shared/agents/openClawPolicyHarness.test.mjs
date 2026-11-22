import test from 'node:test';
import assert from 'node:assert/strict';
import { adjudicateOpenClawPolicyHarness } from './openClawPolicyHarness.mjs';

test('openClaw policy harness keeps safe-to-use false in policy-only mode', () => {
  const summary = adjudicateOpenClawPolicyHarness({
    integrationMode: 'policy_only',
    adapterPresent: false,
    requiredApprovals: ['approve_handoff'],
    satisfiedApprovals: ['approve_handoff'],
    killSwitchState: 'available',
    blockers: [],
  });

  assert.equal(summary.openClawSafeToUse, false);
  assert.equal(summary.openClawReadiness, 'needs_policy');
  assert.equal(summary.openClawExecutionAllowed, false);
  assert.equal(summary.killSwitchMode, 'policy_only');
});

test('openClaw policy harness keeps execution safely gated even when adapter/approvals/kill switch gates pass under stub v1', () => {
  const summary = adjudicateOpenClawPolicyHarness({
    integrationMode: 'local_adapter',
    adapterPresent: true,
    localAdapterAvailable: true,
    requiredApprovals: ['approve_handoff', 'approve_command_execution'],
    satisfiedApprovals: ['approve_handoff', 'approve_command_execution'],
    killSwitchState: 'disengaged',
    blockers: [],
    openClawAdapter: {
      adapterMode: 'connected',
      adapterConnectionState: 'connected',
      adapterExecutionMode: 'enabled',
      adapterRequiredApprovals: ['approve_openclaw_adapter_enable'],
      adapterSatisfiedApprovals: ['approve_openclaw_adapter_enable'],
    },
  });

  assert.equal(summary.openClawSafeToUse, false);
  assert.equal(summary.openClawReadiness, 'blocked');
  assert.equal(summary.openClawExecutionAllowed, false);
});

test('openClaw policy harness keeps execution blocked when kill switch is engaged', () => {
  const summary = adjudicateOpenClawPolicyHarness({
    integrationMode: 'local_adapter',
    adapterPresent: true,
    localAdapterAvailable: true,
    requiredApprovals: ['approve_handoff'],
    satisfiedApprovals: ['approve_handoff'],
    killSwitchState: 'engaged',
    blockers: [],
    openClawAdapter: {
      adapterMode: 'connected',
      adapterConnectionState: 'connected',
      adapterExecutionMode: 'enabled',
      adapterRequiredApprovals: ['approve_openclaw_adapter_enable'],
      adapterSatisfiedApprovals: ['approve_openclaw_adapter_enable'],
    },
  });

  assert.equal(summary.openClawSafeToUse, false);
  assert.equal(summary.openClawExecutionAllowed, false);
  assert.equal(summary.killSwitchState, 'engaged');
});
