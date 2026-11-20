import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BATTLE_BRIDGE_GITHUB_COMMAND_AUTHOR, BATTLE_BRIDGE_GITHUB_COMMAND_MARKER,
  BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE, BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS,
  buildBattleBridgeGitHubCommandReceipt, classifyBattleBridgeMailboxOperation,
  executeBattleBridgeGitHubCommand, selectBattleBridgeGitHubCommandBatch,
  validateBattleBridgeGitHubCommand,
} from '../shared/agents/battleBridgeGitHubCommandMailbox.mjs';
import {
  FRONTEND_VISIBILITY_OBSERVE_OPERATION, FRONTEND_VISIBILITY_START_OPERATION,
  FRONTEND_VISIBILITY_SOURCE_BLOCKERS,
} from '../shared/agents/sovereignFrontendVisibilityMailboxV1.mjs';
import { createSanitizedMailboxReceiptProjection, preflightMailboxControlExpectedHead,
  serializeBoundedReceiptJson } from './battle-bridge-github-command-mailbox.mjs';

const HEAD = 'a'.repeat(40), BUILD = 'b'.repeat(40), DIST = 'c'.repeat(64), SERVED = 'd'.repeat(64);
const NOW = new Date('2026-10-25T12:00:00.000Z');
function command(starting = false, extra = {}) {
  return { schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: starting ? 'frontend-start-integration-01' : 'frontend-observe-integration-01',
    operation: starting ? FRONTEND_VISIBILITY_START_OPERATION : FRONTEND_VISIBILITY_OBSERVE_OPERATION,
    repository: 'Cheekyfellastef/stephan-os', issueNumber: BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE,
    branch: 'main', operatorApproval: 'operator-approved', expectedHead: HEAD,
    expiresAt: '2026-10-25T12:10:00.000Z', ...(starting ? { expectedDistFingerprint: DIST } : {}), ...extra };
}
function comment(id, value, author = BATTLE_BRIDGE_GITHUB_COMMAND_AUTHOR) {
  return { id, user: { login: author }, created_at: NOW.toISOString(),
    html_url: `https://github.com/Cheekyfellastef/stephan-os/issues/${BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE}#issuecomment-${id}`,
    body: `\`\`\`${BATTLE_BRIDGE_GITHUB_COMMAND_MARKER}\n${JSON.stringify(value)}\n\`\`\`` };
}
function child(starting, extra = {}) {
  return { schemaVersion: 'stephanos.frontend-start-only.v1', service: 'stephanos-dist-server',
    ok: true, mode: 'visibility-only', installedHead: HEAD, existingBuildHead: BUILD,
    approvedDistFingerprint: DIST, servedFingerprint: SERVED,
    frontendAvailable: starting, action: starting ? 'started' : 'validated-not-started',
    controlsEnabled: false, externalConnectionsEnabled: false, custodyReleased: false,
    listenerObserved: true, listenerOwnerCount: starting ? 1 : 0,
    exactVisibilityProfile: starting, pageHttpVerified: starting, ...extra };
}
async function receipt(starting = false, childExtra = {}) {
  const input = command(starting);
  const result = await executeBattleBridgeGitHubCommand(input, {
    runFixedFrontendVisibilityFn: async () => child(starting, childExtra),
    executeMaintenanceRecoveryFn: () => assert.fail('static visibility must not invoke maintenance recovery'),
  });
  return buildBattleBridgeGitHubCommandReceipt({ command: input, result,
    state: result.ok ? 'DONE' : 'BLOCKED', acceptedAt: NOW.toISOString(),
    completedAt: NOW.toISOString(), processSourceHead: HEAD });
}

test('registered commands preserve observation/control partitions, exact fingerprint and stable deduplication', () => {
  for (const operation of [FRONTEND_VISIBILITY_OBSERVE_OPERATION, FRONTEND_VISIBILITY_START_OPERATION])
    assert.equal(BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS.filter(value => value === operation).length, 1);
  assert.equal(classifyBattleBridgeMailboxOperation(command().operation), 'OBSERVATION');
  assert.equal(classifyBattleBridgeMailboxOperation(command(true).operation), 'CONTROL');
  const comments = [comment(1, command()), comment(2, command(true)), comment(3, command(true))];
  const batch = selectBattleBridgeGitHubCommandBatch(comments, { now: NOW, currentHead: HEAD });
  assert.equal(batch.ok, true); assert.equal(batch.commands.length, 2);
  assert.deepEqual(batch.commands.map(value => value.partition), ['OBSERVATION', 'CONTROL']);
  assert.equal(batch.observationCount, 1); assert.equal(batch.controlCount, 1);
  assert.equal(batch.commands[1].command.expectedDistFingerprint, DIST);
  const repeated = selectBattleBridgeGitHubCommandBatch(comments,
    { now: NOW, currentHead: HEAD, consumedRequestIds: new Set([command(true).requestId]) });
  assert.equal(repeated.commands.length, 1); assert.equal(repeated.commands[0].command.operation, command().operation);
});

test('envelope author/expiry checks and main-current start admission remain in the existing mailbox', async () => {
  const options = { authorLogin: BATTLE_BRIDGE_GITHUB_COMMAND_AUTHOR, now: NOW, authoredAt: NOW };
  assert.equal(validateBattleBridgeGitHubCommand(command(true), options).ok, true);
  assert.equal(validateBattleBridgeGitHubCommand(command(true), { ...options, authorLogin: 'other' }).ok, false);
  assert.equal(validateBattleBridgeGitHubCommand(command(true, { expiresAt: NOW.toISOString() }), options).ok, false);
  const stale = selectBattleBridgeGitHubCommandBatch([comment(1, command()), comment(2, command(true))],
    { now: NOW, currentHead: BUILD });
  assert.equal(stale.commands.length, 1); assert.equal(stale.commands[0].partition, 'OBSERVATION');
  assert.equal(stale.terminalRejections[0].blocker, 'COMMAND_EXPECTED_HEAD_SUPERSEDED');
  assert.equal(preflightMailboxControlExpectedHead({ partition: 'CONTROL', command: command(true) },
    { readMainHead: () => HEAD }).ok, true);
  assert.equal(preflightMailboxControlExpectedHead({ partition: 'CONTROL', command: command(true) },
    { readMainHead: () => BUILD }).blocker, 'COMMAND_EXPECTED_HEAD_SUPERSEDED');
  assert.equal(preflightMailboxControlExpectedHead({ partition: 'OBSERVATION', command: command() },
    { readMainHead: () => assert.fail('observation does not fetch remote main') }).ok, true);
  let invoked = false;
  const invalid = await executeBattleBridgeGitHubCommand(command(true, { expectedDistFingerprint: 'bad' }), {
    runFixedFrontendVisibilityFn: async () => { invoked = true; return child(true); },
  });
  assert.equal(invalid.ok, false); assert.equal(invoked, false);
});

test('flat dispatch receipts survive sanitizer, bounded core projection and publication round trip without private data', async () => {
  for (const starting of [false, true]) {
    const original = await receipt(starting, starting ? { action: 'already-running' } : {});
    assert.equal(original.result.ok, true);
    const augmented = { ...original, privatePath: 'PRIVATE_FRONTEND_PATH_NEVER_PUBLISH',
      result: { ...original.result, privatePath: 'PRIVATE_FRONTEND_PATH_NEVER_PUBLISH',
        codexLastMessage: 'bounded-display-noise-'.repeat(1800),
        frontendVisibility: { ...original.result.frontendVisibility, privatePath: 'PRIVATE_FRONTEND_PATH_NEVER_PUBLISH' } } };
    const sanitized = createSanitizedMailboxReceiptProjection(augmented).operationResult.frontendVisibility;
    assert.equal(sanitized.frontendAvailable, starting ? true : null);
    assert.equal(sanitized.approvedDistFingerprint, DIST);
    for (const limit of [65_536, 4_500]) {
      const serialized = serializeBoundedReceiptJson(augmented, limit);
      assert.ok(Buffer.byteLength(serialized) <= limit);
      assert.doesNotMatch(serialized, /PRIVATE_FRONTEND_PATH_NEVER_PUBLISH/);
      const projected = JSON.parse(serialized), front = projected.result.result.frontendVisibility;
      assert.equal(front.installedHead, HEAD); assert.equal(front.existingBuildHead, BUILD);
      assert.equal(front.approvedDistFingerprint, DIST); assert.equal(front.servedFingerprint, SERVED);
      assert.equal(front.frontendAvailable, starting ? true : null);
      assert.equal(front.controlsEnabled, false); assert.equal(front.externalConnectionsEnabled, false);
      assert.equal(front.custodyReleased, false); assert.equal(front.sourceLeaseReleased, false);
      assert.equal(front.pageHttpVerified, starting); assert.equal(front.browserVerified, false);
      assert.deepEqual(createSanitizedMailboxReceiptProjection(projected).operationResult.frontendVisibility, front);
      assert.deepEqual(JSON.parse(serializeBoundedReceiptJson(projected, limit)).result.result.frontendVisibility, front);
      if (starting) {
        assert.equal(projected.result.result.expectedDistFingerprint, DIST);
        const tampered = structuredClone(projected);
        tampered.result.result.frontendVisibility.approvedDistFingerprint = 'e'.repeat(64);
        assert.equal(createSanitizedMailboxReceiptProjection(tampered).operationResult.frontendVisibility, null);
        assert.equal(JSON.parse(serializeBoundedReceiptJson(tampered, limit)).result.result.frontendVisibility, null);
      }
    }
  }
});

test('outer projection refuses cross-head, cross-fingerprint and authority-contradicting frontend receipts', async () => {
  const original = await receipt(true);
  for (const patch of [
    { installedHead: BUILD }, { approvedDistFingerprint: 'e'.repeat(64) },
    { controlsEnabled: true }, { externalConnectionsEnabled: true }, { custodyReleased: true },
    { sourceLeaseReleased: true }, { exactVisibilityProfile: false }, { listenerOwnerCount: 2 },
    { existingBuildHead: [BUILD] }, { servedFingerprint: [SERVED] },
  ]) {
    const invalid = { ...original, result: { ...original.result,
      frontendVisibility: { ...original.result.frontendVisibility, ...patch } } };
    assert.equal(createSanitizedMailboxReceiptProjection(invalid).operationResult.frontendVisibility, null);
    assert.equal(JSON.parse(serializeBoundedReceiptJson(invalid)).result.result.frontendVisibility, null);
  }
});

test('finite source-byte refusals survive public serialization without a private file or exception channel', async () => {
  for (const blocker of FRONTEND_VISIBILITY_SOURCE_BLOCKERS) {
    const original = await receipt(false, { ok: false, blocker });
    assert.equal(original.state, 'BLOCKED');
    assert.equal(createSanitizedMailboxReceiptProjection(original).operationResult.blocker, blocker);
    for (const limit of [65_536, 4_500]) {
      const serialized = serializeBoundedReceiptJson(original, limit), published = JSON.parse(serialized);
      assert.equal(published.result.result.blocker, blocker);
      assert.equal(published.result.result.frontendVisibility, null);
      assert.equal(createSanitizedMailboxReceiptProjection(published).operationResult.blocker, blocker);
      assert.doesNotMatch(serialized, /scripts\/|shared\/|stdout|C:\\\\private/);
    }
  }
  const privateError = 'FRONTEND_MAILBOX_SOURCE_BYTES_CHANGED_STARTER_CONTENT C:\\private\\fixture ghp_privatefixture123456';
  const original = await receipt(false, { ok: false, blocker: privateError });
  const serialized = serializeBoundedReceiptJson(original);
  assert.equal(JSON.parse(serialized).result.result.blocker, 'FRONTEND_MAILBOX_EXECUTION_UNPROVEN');
  assert.equal(serialized.includes(privateError), false);
});
