import test from 'node:test';
import assert from 'node:assert/strict';
import { adjudicateOpenClawAdapterConnectionConfig } from './openClawAdapterConnectionConfig.mjs';

test('defaults to model-only and not configured', () => {
  const r = adjudicateOpenClawAdapterConnectionConfig({});
  assert.equal(r.endpointConfigured, false);
  assert.equal(r.endpointMode, 'model_only');
  assert.equal(r.connectionConfigNextAction, 'Configure OpenClaw local adapter endpoint.');
});

test('local_only configured endpoint becomes config-ready and advances readonly validation action', () => {
  const r = adjudicateOpenClawAdapterConnectionConfig({ endpointUrl: 'http://127.0.0.1:8787', endpointScope: 'local_only' });
  assert.equal(r.endpointConfigured, true);
  assert.equal(r.connectionConfigReady, true);
  assert.equal(r.connectionConfigNextAction, 'Validate readonly OpenClaw health/handshake telemetry.');
  assert.match(r.connectionConfigEvidence.join('\n'), /execution:disabled/);
});

test('unknown scope blocks readiness', () => {
  const r = adjudicateOpenClawAdapterConnectionConfig({ endpointUrl: 'http://127.0.0.1:8787', endpointScope: 'unknown' });
  assert.equal(r.connectionConfigReady, false);
  assert.match(r.connectionConfigBlockers.join('\n'), /unknown/i);
});

test('secret-like endpoint url is rejected and sanitized', () => {
  const r = adjudicateOpenClawAdapterConnectionConfig({ endpointUrl: 'http://user:token@127.0.0.1:8787', endpointScope: 'local_only' });
  assert.equal(r.endpointUrl, '');
  assert.equal(r.connectionConfigReady, false);
  assert.match(r.connectionConfigBlockers.join('\n'), /credential|token|secret/i);
  assert.match(r.connectionConfigEvidence.join('\n'), /rejected_secret_like/);
});
