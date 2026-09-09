import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTLE_BRIDGE_GITHUB_COMMAND_MARKER,
  BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
  selectBattleBridgeGitHubCommandBatch,
} from './battleBridgeGitHubCommandMailbox.mjs';

const NOW = new Date('2026-09-04T16:35:00.000Z');
const HEAD = 'bff514af59d7580917a665a06140a8eaebca2add';

function command(requestId) {
  return {
    schemaVersion: BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
    requestId,
    operation: 'READ_DEPLOYMENT_STATUS',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: '2026-09-04T17:30:00.000Z',
  };
}

function comment(id, requestId) {
  return {
    id,
    html_url: `https://github.com/Cheekyfellastef/stephan-os/issues/1507#issuecomment-${id}`,
    created_at: NOW.toISOString(),
    user: { login: 'Cheekyfellastef' },
    body: `\`\`\`${BATTLE_BRIDGE_GITHUB_COMMAND_MARKER}\n${JSON.stringify(command(requestId))}\n\`\`\``,
  };
}

const comments = [
  comment(2114001, 'elastic-mailbox-a'),
  comment(2114002, 'elastic-mailbox-b'),
  comment(2114003, 'elastic-mailbox-c'),
];

const capacity = {
  ok: true,
  exactSourceBound: true,
  provenWidth: 2,
  observedAtUtc: '2026-09-04T16:34:45.000Z',
};

test('preserves canonical mailbox behaviour when elastic evidence is absent', () => {
  const result = selectBattleBridgeGitHubCommandBatch(comments, { now: NOW, maxBatch: 4 });
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result, 'elasticDispatch'), false);
});

test('filters already validated commands through proven elastic capacity and publishes telemetry', () => {
  const result = selectBattleBridgeGitHubCommandBatch(comments, {
    now: NOW,
    maxBatch: 4,
    elasticCapacityEvidence: capacity,
    elasticCommandMetadata: {
      'elastic-mailbox-a': { laneId: 'lane-a', resources: ['mailbox:resource:a'] },
      'elastic-mailbox-b': { laneId: 'lane-b', resources: ['mailbox:resource:b'], approvalGated: true },
      'elastic-mailbox-c': { laneId: 'lane-c', resources: ['mailbox:resource:c'] },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.commands.map((entry) => entry.command.requestId), ['elastic-mailbox-a', 'elastic-mailbox-c']);
  assert.equal(result.elasticDispatch.enabled, true);
  assert.equal(result.elasticDispatch.width, 2);
  assert.equal(result.elasticDispatch.capacityProven, true);
  assert.equal(result.elasticDispatch.selectedCount, 2);
  assert.equal(result.elasticDispatch.parkedCount, 1);
  assert.equal(result.elasticDispatch.parked[0].requestId, 'elastic-mailbox-b');
  assert.equal(result.elasticDispatch.duplicateMailboxAllowed, false);
});

test('serializes resource-conflicting commands while refilling with disjoint work', () => {
  const result = selectBattleBridgeGitHubCommandBatch(comments, {
    now: NOW,
    maxBatch: 4,
    elasticCapacityEvidence: { ...capacity, provenWidth: 3 },
    elasticCommandMetadata: {
      'elastic-mailbox-a': { laneId: 'lane-a', resources: ['mailbox:shared'] },
      'elastic-mailbox-b': { laneId: 'lane-b', resources: ['mailbox:shared'] },
      'elastic-mailbox-c': { laneId: 'lane-c', resources: ['mailbox:other'] },
    },
  });

  assert.deepEqual(result.commands.map((entry) => entry.command.requestId), ['elastic-mailbox-a', 'elastic-mailbox-c']);
  assert.equal(result.elasticDispatch.deferred.find((entry) => entry.requestId === 'elastic-mailbox-b')?.reason, 'MAILBOX_ELASTIC_RESOURCE_CONFLICT');
});
