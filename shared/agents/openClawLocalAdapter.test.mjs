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

test('openClaw local adapter remains non-executable in design_only and contract_defined modes', () => {
  const designOnly = adjudicateOpenClawLocalAdapter({ adapterMode: 'design_only' });
  const contractDefined = adjudicateOpenClawLocalAdapter({ adapterMode: 'contract_defined' });
  assert.equal(designOnly.adapterCanExecute, false);
  assert.equal(contractDefined.adapterCanExecute, false);
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

test('openClaw local adapter enables execution only when all gates are satisfied', () => {
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

  assert.equal(summary.adapterCanExecute, true);
  assert.equal(summary.adapterConnected, true);
  assert.equal(summary.adapterReadiness, 'connected_ready');
});
