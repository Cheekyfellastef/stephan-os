import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRemoteCodexBattleBridgeHandoff,
  validateRemoteCodexBattleBridgeAttachment,
  buildRemoteCodexDispatchCall,
} from './remoteCodexBattleBridgeHandoffV1.mjs';

const HEAD = '024e5abfd8525c48a41a4b8b30c7f9a6112b1ac8';
const NOW = '2026-08-08T19:55:00.000Z';

function handoff() {
  const result = createRemoteCodexBattleBridgeHandoff({
    requestId: 'remote-codex-proof-1706-024e5abf',
    owningIssue: 1507,
    task: 'Prove the exact merged-main Battle Bridge attachment and Recovery Mesh guardian canaries without creating a duplicate task.',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    requestedProofCommands: ['git rev-parse HEAD'],
    createdAt: '2026-08-08T19:54:00.000Z',
    expiresAt: '2026-08-08T21:54:00.000Z',
  });
  assert.equal(result.ok, true);
  return result.handoff;
}

function attachment(overrides = {}) {
  return {
    schemaVersion: 'stephanos.codex-dispatch-surface-attachment.v1',
    observedAt: NOW,
    surfaceReceipt: 'surface-receipt-1',
    surfaceId: 'stephanos-codex-dispatch-local-mcp',
    attached: true,
    platform: 'win32',
    can_local_windows_proof: true,
    repositoryRoot: 'C:\\Users\\Stephan\\Documents\\GitHub\\stephan-os',
    sourceHead: HEAD,
    serverSourceSha256: 'a'.repeat(64),
    toolsListed: ['dispatch_codex_task', 'get_codex_task_status', 'read_codex_task_result'],
    requiredDispatchToolsPresent: true,
    ...overrides,
  };
}

test('creates a bounded operator-approved Remote Codex handoff with no fallback authority', () => {
  const value = handoff();
  assert.equal(value.requiredSurface, 'CONNECTED_WINDOWS_BATTLE_BRIDGE');
  assert.equal(value.requiresCanLocalWindowsProof, true);
  assert.equal(value.githubAtCodexFallbackAllowed, false);
  assert.equal(value.duplicateDispatchAllowed, false);
  assert.equal(value.mergeAuthority, false);
  assert.equal(value.sourceMutationAuthority, false);
});

test('rejects unsafe generic automation and credential fields', () => {
  for (const [field, value] of [['command', 'pwsh'], ['url', 'https://example.com'], ['token', 'secret'], ['atCodex', true]]) {
    const result = createRemoteCodexBattleBridgeHandoff({
      requestId: 'remote-codex-proof-1706-024e5abf',
      owningIssue: 1507,
      task: 'This is a sufficiently long bounded proof task for hostile validation.',
      operatorApproval: 'operator-approved',
      expectedHead: HEAD,
      createdAt: '2026-08-08T19:54:00.000Z',
      expiresAt: '2026-08-08T21:54:00.000Z',
      [field]: value,
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'REMOTE_CODEX_HANDOFF_UNSAFE_FIELD');
  }
});

test('fails closed without a real Windows attachment', () => {
  const value = handoff();
  for (const bad of [
    attachment({ attached: false }),
    attachment({ can_local_windows_proof: false }),
    attachment({ platform: 'linux' }),
    attachment({ sourceHead: '1'.repeat(40) }),
    attachment({ serverSourceSha256: '' }),
    attachment({ surfaceReceipt: '' }),
    attachment({ toolsListed: ['dispatch_codex_task'] }),
    attachment({ observedAt: '2026-08-08T19:40:00.000Z' }),
  ]) {
    assert.equal(validateRemoteCodexBattleBridgeAttachment(value, bad, { now: new Date(NOW) }).ok, false);
  }
});

test('maps a valid attachment to the existing dispatch_codex_task tool only', () => {
  const value = handoff();
  const result = buildRemoteCodexDispatchCall(value, attachment(), { now: new Date(NOW) });
  assert.equal(result.ok, true);
  assert.equal(result.toolName, 'dispatch_codex_task');
  assert.deepEqual(result.args, {
    issueNumber: 1507,
    task: value.task,
    operatorApproval: 'operator-approved',
    branch: 'main',
    requestedProofCommands: ['git rev-parse HEAD'],
  });
});
