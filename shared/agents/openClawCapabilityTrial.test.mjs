import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawCapabilityReport, buildOpenClawCapabilityTrialState } from './openClawCapabilityTrial.mjs';

test('capability trial blocks until readonly adapter validation succeeds and execution stays disabled', () => {
  const blocked = buildOpenClawCapabilityTrialState({ operatorSurface: {} });
  assert.equal(blocked.trialStatus, 'not_started');
  assert.equal(blocked.executionAllowed, false);

  const ready = buildOpenClawCapabilityTrialState({ operatorSurface: {
    openClawHealthValidationStatus: 'succeeded',
    openClawHealthState: 'passing',
    openClawHandshakeState: 'compatible',
    openClawProtocolCompatible: true,
  } });
  assert.equal(ready.executionAllowed, false);
  assert.equal(ready.trialStatus, 'report_ready');
  assert.equal(ready.nextAction, 'Review OpenClaw capability report.');
});

test('capability report includes blocked execution/mutation surfaces', () => {
  const report = buildOpenClawCapabilityReport({ operatorSurface: { openClawAdapterIdentity: 'openclaw-readonly-adapter-stub' } });
  assert.equal(report.executionAllowed, false);
  assert.equal(report.adapterIdentity, 'openclaw-readonly-adapter-stub');
  assert.deepEqual(report.blockedCapabilities, ['command_execution', 'file_mutation', 'browser_control', 'git_write', 'autonomous_action']);
});
