import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRemoteCodexDispatchCall,
  createRemoteCodexBattleBridgeHandoff,
  createRemoteCodexOperatorApprovalReceipt,
  validateRemoteCodexBattleBridgeAttachment,
  validateRemoteCodexBattleBridgeHandoff,
} from './remoteCodexBattleBridgeHandoffV1.mjs';

const HEAD = '024e5abfd8525c48a41a4b8b30c7f9a6112b1ac8';
const NOW = '2026-08-08T19:55:00.000Z';
const CREATED_AT = '2026-08-08T19:54:00.000Z';
const EXPIRES_AT = '2026-08-08T21:54:00.000Z';
const REQUEST_ID = 'remote-codex-proof-1706-024e5abf';
const TASK = 'Prove the exact merged-main Battle Bridge attachment and Recovery Mesh guardian canaries without creating a duplicate task.';

function exactHeadProof() {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 1706,
    expectedHead: HEAD,
    proofTarget: 'MERGED_MAIN',
    pullRequestHead: '1'.repeat(40),
    mergeCommitHead: HEAD,
    githubMainHead: HEAD,
    mergeCommitIncluded: true,
    proofScenario: 'merged-main-battle-bridge-recovery-mesh-proof',
  };
}

function pullRequestHeadProof() {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 1706,
    expectedHead: HEAD,
    proofTarget: 'PULL_REQUEST_HEAD_BASE_BOUND',
    pullRequestHead: HEAD,
    mergeCommitHead: '',
    githubMainHead: '2'.repeat(40),
    mergeCommitIncluded: false,
    proofScenario: 'pull-request-head-read-only-specialist-review',
  };
}

function approvalReceipt({ task = TASK, proof = exactHeadProof(), expiresAt = EXPIRES_AT } = {}) {
  const result = createRemoteCodexOperatorApprovalReceipt({
    approvalId: 'approval-remote-codex-proof-1706',
    requestId: REQUEST_ID,
    owningIssue: 1507,
    expectedHead: HEAD,
    task,
    requestedProofCommands: ['git rev-parse HEAD'],
    exactHeadProof: proof,
    approvedAt: '2026-08-08T19:53:00.000Z',
    expiresAt,
  });
  assert.equal(result.ok, true);
  return result.receipt;
}

function handoff() {
  const proof = exactHeadProof();
  const result = createRemoteCodexBattleBridgeHandoff({
    requestId: REQUEST_ID,
    owningIssue: 1507,
    task: TASK,
    operatorApproval: 'operator-approved',
    operatorApprovalReceipt: approvalReceipt({ proof }),
    expectedHead: HEAD,
    exactHeadProof: proof,
    requestedProofCommands: ['git rev-parse HEAD'],
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
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

function mutable(value) {
  return structuredClone(value);
}

test('creates a strict exact-head handoff with a digest-bound approval receipt and no fallback authority', () => {
  const value = handoff();
  assert.equal(value.requiredSurface, 'CONNECTED_WINDOWS_BATTLE_BRIDGE');
  assert.equal(value.requiresCanLocalWindowsProof, true);
  assert.equal(value.operatorApprovalReceipt.allowedOperation, 'dispatch_codex_task');
  assert.match(value.operatorApprovalReceipt.bindingSha256, /^[0-9a-f]{64}$/);
  assert.equal(value.exactHeadProof.expectedHead, HEAD);
  assert.equal(value.githubAtCodexFallbackAllowed, false);
  assert.equal(value.duplicateDispatchAllowed, false);
  assert.equal(value.mergeAuthority, false);
  assert.equal(value.sourceMutationAuthority, false);
});

test('rejects missing or denied approval instead of manufacturing authority', () => {
  const proof = exactHeadProof();
  for (const operatorApproval of [undefined, 'denied']) {
    const result = createRemoteCodexBattleBridgeHandoff({
      requestId: REQUEST_ID,
      owningIssue: 1507,
      task: TASK,
      operatorApproval,
      operatorApprovalReceipt: approvalReceipt({ proof }),
      expectedHead: HEAD,
      exactHeadProof: proof,
      requestedProofCommands: ['git rev-parse HEAD'],
      createdAt: CREATED_AT,
      expiresAt: EXPIRES_AT,
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'REMOTE_CODEX_HANDOFF_OPERATOR_APPROVAL_REQUIRED');
  }
});

test('rejects forged, stale, mismatched, and tampered approval receipts', () => {
  const cases = [
    (value) => { value.operatorApprovalReceipt.bindingSha256 = 'f'.repeat(64); },
    (value) => { value.operatorApprovalReceipt.decision = 'DENIED'; },
    (value) => { value.operatorApprovalReceipt.requestId = 'forged-request-id'; },
    (value) => { value.operatorApprovalReceipt.expectedHead = '2'.repeat(40); },
    (value) => { value.operatorApprovalReceipt.taskSha256 = '3'.repeat(64); },
    (value) => { value.operatorApprovalReceipt.exactHeadProofSha256 = '4'.repeat(64); },
    (value) => { delete value.operatorApprovalReceipt; },
  ];
  for (const tamper of cases) {
    const value = mutable(handoff());
    tamper(value);
    assert.equal(validateRemoteCodexBattleBridgeHandoff(value, { now: new Date(NOW) }).ok, false);
  }
  assert.equal(
    validateRemoteCodexBattleBridgeHandoff(handoff(), { now: new Date('2026-08-08T22:00:00.000Z') }).blocker,
    'REMOTE_CODEX_HANDOFF_EXPIRED',
  );
});

test('rejects payload, exact-head proof, extra-field, and authority-flag tampering', () => {
  const cases = [
    (value) => { value.task = `${value.task} tampered`; },
    (value) => { value.owningIssue = 1293; },
    (value) => { value.requestedProofCommands = ['git rev-parse --show-toplevel']; },
    (value) => { value.expectedHead = '5'.repeat(40); },
    (value) => { value.exactHeadProof.expectedHead = '6'.repeat(40); },
    (value) => { value.exactHeadProof.proofScenario = 'tampered-proof'; },
    (value) => { value.extraAuthority = true; },
    (value) => { value.duplicateDispatchAllowed = true; },
  ];
  for (const tamper of cases) {
    const value = mutable(handoff());
    tamper(value);
    assert.equal(validateRemoteCodexBattleBridgeHandoff(value, { now: new Date(NOW) }).ok, false);
  }
});

test('rejects unsafe generic automation, credential fields, and unsafe proof commands', () => {
  const proof = exactHeadProof();
  for (const [field, value] of [['command', 'pwsh'], ['url', 'https://example.com'], ['token', 'secret'], ['atCodex', true]]) {
    const result = createRemoteCodexBattleBridgeHandoff({
      requestId: REQUEST_ID,
      owningIssue: 1507,
      task: TASK,
      operatorApproval: 'operator-approved',
      operatorApprovalReceipt: approvalReceipt({ proof }),
      expectedHead: HEAD,
      exactHeadProof: proof,
      requestedProofCommands: ['git rev-parse HEAD'],
      createdAt: CREATED_AT,
      expiresAt: EXPIRES_AT,
      [field]: value,
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'REMOTE_CODEX_HANDOFF_UNSAFE_FIELD');
  }
  const unsafeProof = mutable(handoff());
  unsafeProof.requestedProofCommands = ['git push origin main'];
  assert.equal(validateRemoteCodexBattleBridgeHandoff(unsafeProof, { now: new Date(NOW) }).blocker, 'REMOTE_CODEX_HANDOFF_PROOF_COMMANDS_INVALID');
});

test('fails closed without a fresh exact-head Windows attachment', () => {
  const value = handoff();
  for (const bad of [
    attachment({ surfaceId: 'other-surface' }),
    attachment({ attached: false }),
    attachment({ can_local_windows_proof: false }),
    attachment({ platform: 'linux' }),
    attachment({ sourceHead: '2'.repeat(40) }),
    attachment({ serverSourceSha256: '' }),
    attachment({ surfaceReceipt: '' }),
    attachment({ toolsListed: ['dispatch_codex_task'] }),
    attachment({ requiredDispatchToolsPresent: false }),
    attachment({ observedAt: '2026-08-08T19:40:00.000Z' }),
  ]) {
    assert.equal(validateRemoteCodexBattleBridgeAttachment(value, bad, { now: new Date(NOW) }).ok, false);
  }
});

test('accepts a fresh Windows control attachment on the exact approved base for a separately re-proven PR-head worktree', () => {
  const proof = pullRequestHeadProof();
  const result = createRemoteCodexBattleBridgeHandoff({
    requestId: REQUEST_ID,
    owningIssue: 1507,
    task: TASK,
    operatorApproval: 'operator-approved',
    operatorApprovalReceipt: approvalReceipt({ proof }),
    expectedHead: HEAD,
    exactHeadProof: proof,
    requestedProofCommands: ['git rev-parse HEAD'],
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
  });
  assert.equal(result.ok, true);
  const accepted = validateRemoteCodexBattleBridgeAttachment(
    result.handoff,
    attachment({ sourceHead: '2'.repeat(40) }),
    { now: new Date(NOW) },
  );
  assert.equal(accepted.ok, true);
  assert.equal(
    validateRemoteCodexBattleBridgeAttachment(result.handoff, attachment({ sourceHead: '1'.repeat(40) }), { now: new Date(NOW) }).blocker,
    'BATTLE_BRIDGE_ATTACHMENT_BASE_HEAD_MISMATCH',
  );
  assert.equal(
    validateRemoteCodexBattleBridgeAttachment(result.handoff, attachment({ sourceHead: '' }), { now: new Date(NOW) }).blocker,
    'BATTLE_BRIDGE_ATTACHMENT_HEAD_INVALID',
  );
});

test('maps a valid attachment to one complete exact-head dispatch authority envelope', () => {
  const value = handoff();
  const surface = attachment();
  const result = buildRemoteCodexDispatchCall(value, surface, { now: new Date(NOW) });
  assert.equal(result.ok, true);
  assert.equal(result.toolName, 'dispatch_codex_task');
  assert.equal(result.args.requestId, REQUEST_ID);
  assert.equal(result.args.issueNumber, 1507);
  assert.equal(result.args.task, value.task);
  assert.equal(result.args.operatorApproval, 'operator-approved');
  assert.equal(result.args.branch, 'main');
  assert.equal(result.args.expectedHead, HEAD);
  assert.deepEqual(result.args.operatorApprovalReceipt, value.operatorApprovalReceipt);
  assert.deepEqual(result.args.exactHeadProof, value.exactHeadProof);
  assert.deepEqual(result.args.authorityEnvelope, value);
  assert.deepEqual(result.args.surfaceAttachment, surface);
});
