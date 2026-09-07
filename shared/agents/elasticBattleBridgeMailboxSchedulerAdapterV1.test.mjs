import test from 'node:test';
import assert from 'node:assert/strict';
import * as mailbox from './battleBridgeGitHubCommandMailbox.mjs';
import { ELASTIC_BUILD_CAPACITY_SCHEMA } from './elasticBuildCapacityV1.mjs';
import { selectElasticBattleBridgeMailboxBatchFromScheduler } from './elasticBattleBridgeMailboxSchedulerAdapterV1.mjs';

const HEAD = 'bff514af59d7580917a665a06140a8eaebca2add';
const NOW = new Date('2026-09-04T16:40:00Z');
const OWNED_REQUEST = 'req-owned-001';
const REQUEST_A = 'req-a-001';
const REQUEST_B = 'req-b-001';

function command(requestId) {
  return {
    schemaVersion: mailbox.BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
    requestId,
    operation: 'UPDATE_STEPHANOS_FROM_CHAT',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: '2026-09-04T17:30:00Z',
  };
}

function comment(requestId, id) {
  return {
    id,
    html_url: `https://github.com/Cheekyfellastef/stephan-os/issues/1507#issuecomment-${id}`,
    created_at: '2026-09-04T16:39:00Z',
    user: { login: 'Cheekyfellastef' },
    body: `\`\`\`${mailbox.BATTLE_BRIDGE_GITHUB_COMMAND_MARKER}\n${JSON.stringify(command(requestId))}\n\`\`\``,
  };
}

function capacity(overrides = {}) {
  return {
    schemaVersion: ELASTIC_BUILD_CAPACITY_SCHEMA,
    status: 'RUNNING',
    desiredWidth: 3,
    availableExecutorSlots: 5,
    activeLaneCount: 1,
    mutationAuthority: false,
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    sourceHead: HEAD,
    observedAtUtc: '2026-09-04T16:39:30Z',
    exactSourceBound: true,
    mutationAuthority: false,
    activeResourceIds: ['file:owned'],
    commandClaims: [
      { requestId: OWNED_REQUEST, resourceIds: ['file:owned'] },
      { requestId: REQUEST_A, resourceIds: ['file:a'] },
      { requestId: REQUEST_B, resourceIds: ['file:b'] },
    ],
    ...overrides,
  };
}

test('uses scheduler width and parks commands conflicting with active scheduler resources', () => {
  const result = selectElasticBattleBridgeMailboxBatchFromScheduler([
    comment(OWNED_REQUEST, 1),
    comment(REQUEST_A, 2),
    comment(REQUEST_B, 3),
  ], { schedulerCapacity: capacity(), schedulerSnapshot: snapshot(), currentHead: HEAD, now: NOW, maxBatch: 4 });

  assert.equal(result.ok, true);
  assert.deepEqual(result.commands.map((entry) => entry.command.requestId), [REQUEST_A, REQUEST_B]);
  assert.equal(result.elasticDispatch.width, 3);
  assert.equal(result.elasticDispatch.parked.some((entry) => entry.requestId === OWNED_REQUEST), true);
  assert.equal(result.elasticDispatch.duplicateMailboxAllowed, false);
});

test('invalid capacity truth collapses elastic admission to width one', () => {
  const result = selectElasticBattleBridgeMailboxBatchFromScheduler([
    comment(REQUEST_A, 2),
    comment(REQUEST_B, 3),
  ], { schedulerCapacity: capacity({ status: 'DEGRADED_CAPACITY' }), schedulerSnapshot: snapshot(), currentHead: HEAD, now: NOW, maxBatch: 4 });
  assert.equal(result.commands.length, 1);
  assert.equal(result.elasticDispatch.width, 1);
  assert.equal(result.elasticDispatch.capacityProven, false);
});

test('invalid resource truth falls back to canonical single-command mailbox', () => {
  const result = selectElasticBattleBridgeMailboxBatchFromScheduler([
    comment(REQUEST_A, 2),
    comment(REQUEST_B, 3),
  ], { schedulerCapacity: capacity(), schedulerSnapshot: snapshot({ sourceHead: '0'.repeat(40) }), currentHead: HEAD, now: NOW, maxBatch: 4 });
  assert.equal(result.commands.length, 1);
  assert.equal(Object.hasOwn(result, 'elasticDispatch'), false);
});
