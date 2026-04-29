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
});

test('protocol mismatch degrades handshake and still does not execute', () => {
  const r = adjudicateOpenClawHealthHandshake({ expectedProtocolVersion: '1', protocolVersion: '2' });
  assert.equal(r.protocol.compatible, false);
  assert.notEqual(r.handshakeState, 'compatible');
  assert.equal(r.readonlyAssurance.commandExecutionDisabled, true);
});
