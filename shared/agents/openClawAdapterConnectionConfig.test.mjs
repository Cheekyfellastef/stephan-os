import test from 'node:test';
import assert from 'node:assert/strict';
import { adjudicateOpenClawAdapterConnectionConfig } from './openClawAdapterConnectionConfig.mjs';

test('defaults to model-only and not configured', () => {
  const r = adjudicateOpenClawAdapterConnectionConfig({});
  assert.equal(r.endpointConfigured, false);
  assert.equal(r.endpointMode, 'model_only');
  assert.equal(r.connectionConfigNextAction, 'Configure OpenClaw local adapter endpoint.');
});

test('configured endpoint advances next action and does not imply execution', () => {
  const r = adjudicateOpenClawAdapterConnectionConfig({ endpointUrl: 'http://127.0.0.1:8787', endpointScope: 'local_only' });
  assert.equal(r.endpointConfigured, true);
  assert.equal(r.connectionConfigNextAction, 'Validate readonly OpenClaw health/handshake telemetry.');
  assert.match(r.connectionConfigEvidence.join('\n'), /execution:disabled/);
});
