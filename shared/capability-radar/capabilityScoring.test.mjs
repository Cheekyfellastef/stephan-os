import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITY_RADAR_CANDIDATES } from './capabilityCandidates.mjs';
import { buildCapabilityHandoff, scoreCapabilityCandidate } from './capabilityScoring.mjs';

test('scoreCapabilityCandidate returns bounded score and valid status', () => {
  const result = scoreCapabilityCandidate(CAPABILITY_RADAR_CANDIDATES[0]);
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.ok(result.supportedStatuses.includes(result.status));
});

test('buildCapabilityHandoff includes mandatory guardrails', () => {
  const text = buildCapabilityHandoff(CAPABILITY_RADAR_CANDIDATES[0], { score: 88, status: 'SANDBOX_TEST' });
  assert.match(text, /Do not install or execute without operator approval/i);
  assert.match(text, /Preserve canonical runtime truth rules/i);
});
