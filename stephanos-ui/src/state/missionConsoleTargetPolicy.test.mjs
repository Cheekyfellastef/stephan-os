import test from 'node:test';
import assert from 'node:assert/strict';
import { MISSION_CONSOLE_TARGETS, evaluateMissionConsoleRequest } from './missionConsoleTargetPolicy.js';

test('mission console blocks destructive OpenClaw requests with policy visibility', () => {
  const result = evaluateMissionConsoleRequest({
    targetId: 'openclaw',
    content: 'Please delete the entire repository and force push rewrite history.',
    openClawIntentType: 'run-scan',
  });
  assert.equal(result.accepted, false);
  assert.equal(result.blocked, true);
  assert.match(result.reason, /Blocked request category:/);
  assert.ok(result.policy);
});

test('mission console accepts bounded OpenClaw intent routing', () => {
  const result = evaluateMissionConsoleRequest({
    targetId: 'openclaw',
    content: 'Summarize inspection scope and explain doctrine risk.',
    openClawIntentType: 'refresh-status',
  });
  assert.equal(result.accepted, true);
  assert.equal(result.blocked, false);
  assert.equal(result.boundedIntent?.accepted, true);
});


test('mission console declares Stephanos, agents, and OpenClaw addressed targets', () => {
  const labels = MISSION_CONSOLE_TARGETS.map((entry) => entry.label);
  assert.deepEqual(labels, ['Stephanos → Assistant Router', 'Agents → Mission Bridge', 'OpenClaw → Bounded Analysis']);
});
