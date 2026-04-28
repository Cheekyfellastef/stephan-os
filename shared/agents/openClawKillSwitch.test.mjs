import test from 'node:test';
import assert from 'node:assert/strict';
import { adjudicateOpenClawKillSwitch } from './openClawKillSwitch.mjs';

test('openClaw kill switch remains non-executable in policy_only mode', () => {
  const summary = adjudicateOpenClawKillSwitch({
    integrationMode: 'policy_only',
    killSwitchState: 'required',
    safeConditionsSatisfied: true,
  });

  assert.equal(summary.killSwitchMode, 'policy_only');
  assert.equal(summary.openClawExecutionAllowed, false);
});

test('openClaw kill switch blocks execution when engaged', () => {
  const summary = adjudicateOpenClawKillSwitch({
    integrationMode: 'local_adapter',
    killSwitchState: 'engaged',
    safeConditionsSatisfied: true,
  });

  assert.equal(summary.openClawExecutionAllowed, false);
  assert.equal(summary.operatorCanResumeOpenClaw, true);
});
