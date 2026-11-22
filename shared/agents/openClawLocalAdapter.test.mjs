import test from 'node:test';
import assert from 'node:assert/strict';
import { adjudicateOpenClawLocalAdapter } from './openClawLocalAdapter.mjs';

test('openClaw local adapter defaults to design-only contract posture', () => {
  const summary = adjudicateOpenClawLocalAdapter();
  assert.equal(summary.adapterMode, 'design_only');
  assert.equal(summary.adapterCanExecute, false);
  assert.equal(summary.adapterConnected, false);
  assert.match(summary.adapterNextAction, /design openclaw local adapter contract/i);
});

test('openClaw local adapter consumes stub evidence and advances to connection-readiness action when stub exists', () => {
  const summary = adjudicateOpenClawLocalAdapter({
    adapterStub: {
      stubMode: 'local_stub',
      stubStatus: 'health_check_only',
      stubConnectionState: 'local_only',
    },
  });

  assert.equal(summary.adapterMode, 'local_stub');
  assert.equal(summary.adapterCanExecute, false);
  assert.match(summary.adapterNextAction, /connection readiness/i);
  assert.equal(summary.adapterStub.stubCanExecute, false);
});

test('openClaw local adapter blocks execution when kill switch is unavailable or engaged', () => {
  const unavailable = adjudicateOpenClawLocalAdapter({
    adapterMode: 'connected',
    adapterConnectionState: 'connected',
    adapterExecutionMode: 'enabled',
    policyAllowsExecution: true,
    killSwitchAvailable: false,
    adapterRequiredApprovals: ['approve_openclaw_adapter_enable'],
    adapterSatisfiedApprovals: ['approve_openclaw_adapter_enable'],
  });
  const engaged = adjudicateOpenClawLocalAdapter({
    adapterMode: 'connected',
    adapterConnectionState: 'connected',
    adapterExecutionMode: 'enabled',
    policyAllowsExecution: true,
    killSwitchAvailable: true,
    killSwitchEngaged: true,
    adapterRequiredApprovals: ['approve_openclaw_adapter_enable'],
    adapterSatisfiedApprovals: ['approve_openclaw_adapter_enable'],
  });
  assert.equal(unavailable.adapterCanExecute, false);
  assert.equal(engaged.adapterCanExecute, false);
});

test('openClaw local adapter blocks execution when approvals are missing', () => {
  const summary = adjudicateOpenClawLocalAdapter({
    adapterMode: 'connected',
    adapterConnectionState: 'connected',
    adapterExecutionMode: 'enabled',
    policyAllowsExecution: true,
    killSwitchAvailable: true,
    adapterRequiredApprovals: ['approve_openclaw_adapter_enable', 'approve_command_execution'],
    adapterSatisfiedApprovals: ['approve_openclaw_adapter_enable'],
  });

  assert.equal(summary.adapterCanExecute, false);
  assert.equal(summary.adapterApprovalsComplete, false);
  assert.match(summary.adapterNextAction, /complete openclaw approval gates/i);
});

test('openClaw local adapter v1 remains non-executing even when all future gates would otherwise be satisfied', () => {
  const summary = adjudicateOpenClawLocalAdapter({
    adapterMode: 'connected',
    adapterConnectionState: 'connected',
    adapterExecutionMode: 'enabled',
    policyAllowsExecution: true,
    killSwitchAvailable: true,
    killSwitchEngaged: false,
    adapterRequiredApprovals: ['approve_openclaw_adapter_enable', 'approve_command_execution'],
    adapterSatisfiedApprovals: ['approve_openclaw_adapter_enable', 'approve_command_execution'],
  });

  assert.equal(summary.adapterCanExecute, false);
  assert.equal(summary.adapterReadiness, 'connected_blocked');
  assert.ok(summary.adapterBlockers.some((entry) => /status\/health-only/i.test(entry)));
});
