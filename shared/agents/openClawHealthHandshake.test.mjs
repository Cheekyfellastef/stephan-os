import test from 'node:test';
import assert from 'node:assert/strict';
import { adjudicateOpenClawHealthHandshake } from './openClawHealthHandshake.mjs';

test('default is model-only not-run and non-executing', () => {
  const r = adjudicateOpenClawHealthHandshake({});
  assert.equal(r.healthTelemetryMode, 'model_only');
  assert.equal(r.healthState, 'not_run');
  assert.equal(r.handshakeState, 'not_run');
  assert.equal(r.readonlyAssurance.executionDisabled, true);
  assert.equal(r.capabilityDeclaration.canExecuteActions, false);
  assert.equal(r.readonlyValidationEndpoint.available, false);
  assert.equal(r.readonlyValidationEndpoint.mode, 'missing');
});

test('protocol mismatch degrades handshake and still does not execute', () => {
  const r = adjudicateOpenClawHealthHandshake({ expectedProtocolVersion: '1', protocolVersion: '2' });
  assert.equal(r.protocol.compatible, false);
  assert.notEqual(r.handshakeState, 'compatible');
  assert.equal(r.readonlyAssurance.commandExecutionDisabled, true);
});

test('preserves canonical nested readonly validation endpoint from App-style payload', () => {
  const r = adjudicateOpenClawHealthHandshake({
    readonlyValidationEndpoint: {
      available: true,
      path: '/api/openclaw/health-handshake/validate-readonly',
      mode: 'local_readonly_probe',
      canExecute: false,
    },
  });

  assert.equal(r.readonlyValidationEndpoint.available, true);
  assert.equal(r.readonlyValidationEndpoint.path, '/api/openclaw/health-handshake/validate-readonly');
  assert.equal(r.readonlyValidationEndpoint.mode, 'local_readonly_probe');
  assert.equal(r.readonlyValidationEndpoint.canExecute, false);
});

test('supports flat compatibility fields when nested endpoint is missing', () => {
  const r = adjudicateOpenClawHealthHandshake({
    openClawReadonlyValidationEndpointAvailable: true,
    openClawReadonlyValidationEndpointPath: '/compat/path',
    openClawReadonlyValidationEndpointMode: 'local_readonly_probe',
    openClawReadonlyValidationEndpointCanExecute: false,
  });

  assert.equal(r.readonlyValidationEndpoint.available, true);
  assert.equal(r.readonlyValidationEndpoint.path, '/compat/path');
  assert.equal(r.readonlyValidationEndpoint.mode, 'local_readonly_probe');
  assert.equal(r.readonlyValidationEndpoint.canExecute, false);
});

test('nested endpoint takes precedence over flat compatibility fields when both are provided', () => {
  const r = adjudicateOpenClawHealthHandshake({
    readonlyValidationEndpoint: {
      available: true,
      path: '/nested/path',
      mode: 'local_readonly_probe',
      canExecute: false,
    },
    openClawReadonlyValidationEndpointAvailable: false,
    openClawReadonlyValidationEndpointPath: '/flat/path',
    openClawReadonlyValidationEndpointMode: 'missing',
    openClawReadonlyValidationEndpointCanExecute: true,
  });

  assert.equal(r.readonlyValidationEndpoint.available, true);
  assert.equal(r.readonlyValidationEndpoint.path, '/nested/path');
  assert.equal(r.readonlyValidationEndpoint.mode, 'local_readonly_probe');
  assert.equal(r.readonlyValidationEndpoint.canExecute, false);
});

test('canExecute claims never open execution gates', () => {
  const r = adjudicateOpenClawHealthHandshake({
    readonlyValidationEndpoint: {
      available: true,
      path: '/api/openclaw/health-handshake/validate-readonly',
      mode: 'local_readonly_probe',
      canExecute: true,
    },
  });

  assert.equal(r.readonlyValidationEndpoint.canExecute, true);
  assert.equal(r.readonlyAssurance.executionDisabled, true);
  assert.equal(r.readonlyAssurance.commandExecutionDisabled, true);
  assert.equal(r.capabilityDeclaration.canExecuteActions, false);
  assert.equal(r.capabilityDeclaration.canRunCommands, false);
});
