import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawCapabilityReport, buildOpenClawCapabilityTrialState } from './openClawCapabilityTrial.mjs';

test('capability trial consumes successful readonly validation truth and remains execution-disabled', () => {
  const blocked = buildOpenClawCapabilityTrialState({ operatorSurface: {} });
  assert.equal(blocked.adapterValidated, false);
  assert.equal(blocked.trialStatus, 'not_started');
  assert.equal(blocked.nextAction, 'Validate readonly adapter first.');
  assert.equal(blocked.executionAllowed, false);
  assert.deepEqual(blocked.forbiddenTrialActions, ['execute_command', 'edit_file', 'control_browser', 'write_git', 'mutate_system']);

  const ready = buildOpenClawCapabilityTrialState({ operatorSurface: {
    openClawHealthValidationStatus: 'succeeded',
    openClawHealthState: 'passing',
    openClawHandshakeState: 'compatible',
    openClawProtocolCompatible: true,
    openClawReadonlyAssurance: { readonlyOnly: true },
  } });
  assert.equal(ready.adapterValidated, true);
  assert.equal(ready.executionAllowed, false);
  assert.equal(ready.trialStatus, 'ready');
  assert.equal(ready.nextAction, 'Run readonly capability trial.');
});

test('capability report includes blocked execution/mutation surfaces', () => {
  const report = buildOpenClawCapabilityReport({ operatorSurface: { openClawAdapterIdentity: 'openclaw-readonly-adapter-stub' } });
  assert.equal(report.executionAllowed, false);
  assert.equal(report.adapterIdentity, 'openclaw-readonly-adapter-stub');
  assert.deepEqual(report.blockedCapabilities, ['command_execution', 'file_mutation', 'browser_control', 'git_write', 'autonomous_action']);
});
