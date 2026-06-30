import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProofComment } from './ignition-concierge-proof-runner.mjs';

test('proof comment records exact-head approval boundary and checks', () => {
  const comment = buildProofComment({
    headSha: 'abc123',
    generatedAt: '2026-06-30T00:00:00.000Z',
    checks: [{ label: 'syntax', command: 'node --check scripts/ignition-concierge-proof-runner.mjs', status: 0, ok: true, stdout: '', stderr: '' }],
  });

  assert.match(comment, /HEAD: abc123/);
  assert.match(comment, /Verdict: PASS/);
  assert.match(comment, /exact HEAD SHA/);
  assert.match(comment, /does not merge, push, unlock OpenClaw, or bypass operator approval/);
  assert.match(comment, /PASS — syntax/);
});
