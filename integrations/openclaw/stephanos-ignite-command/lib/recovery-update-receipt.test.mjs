import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  OPENCLAW_BATTLE_BRIDGE_UPDATE_RECEIPT_SCHEMA,
  buildOpenClawUpdateAuthorization,
  claimOpenClawUpdateInOwnerHandler,
  ensureOpenClawUpdateReceiptRoot,
  persistOpenClawUpdateCheckpoint,
  readStableOpenClawUpdateReceipt,
  releaseOpenClawUpdateOwnerLane,
  resolveOpenClawUpdateReceiptPaths,
  validateOpenClawUpdateAuthorization,
  writeNewOpenClawUpdateReceipt,
} from './recovery-update-receipt.mjs';

const HEAD = 'a'.repeat(40);
const RECEIPT_ID = '1'.repeat(32);
const PID = 1234;
const NOW = new Date('2026-08-20T00:00:00.000Z');
const OWNER = Object.freeze({ authenticatedByHost: true, commandName: 'stephanos-ignite', command: 'update', senderIsOwner: true });

function fixture({ write = true } = {}) {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'update-receipt-claim-'));
  const paths = resolveOpenClawUpdateReceiptPaths({ env: { USERPROFILE: profile }, receiptId: RECEIPT_ID });
  const safeRoot = ensureOpenClawUpdateReceiptRoot(paths, { create: true });
  const authorization = buildOpenClawUpdateAuthorization({ receiptId: RECEIPT_ID, expectedHead: HEAD, authenticatedContext: OWNER, hostPid: PID, now: NOW });
  const receipt = {
    schemaVersion: OPENCLAW_BATTLE_BRIDGE_UPDATE_RECEIPT_SCHEMA,
    receiptId: RECEIPT_ID,
    status: 'QUEUED',
    expectedHead: HEAD,
    queuedAtUtc: NOW.toISOString(),
    authorization,
    finalVerdict: 'UPDATE_EXECUTION_QUEUED',
    blocker: '',
    pluginReloadProof: 'NOT_STARTED',
  };
  if (write) writeNewOpenClawUpdateReceipt({ paths, safeRoot, receipt });
  return { paths, safeRoot, receipt, authorization };
}

test('owner handler claim produces exactly one durable QUEUED to EXECUTING transition', () => {
  const value = fixture();
  const claimed = claimOpenClawUpdateInOwnerHandler({
    paths: value.paths,
    safeRoot: value.safeRoot,
    queued: value.receipt,
    claimantPid: PID,
    now: NOW,
  });
  assert.equal(claimed.receipt.status, 'EXECUTING');
  assert.equal(JSON.parse(readFileSync(value.paths.receiptPath, 'utf8')).status, 'EXECUTING');
  assert.equal(JSON.parse(readFileSync(value.paths.claimPath, 'utf8')).claimantPid, PID);
  assert.throws(() => claimOpenClawUpdateInOwnerHandler({
    paths: value.paths,
    safeRoot: value.safeRoot,
    queued: value.receipt,
    claimantPid: PID,
    now: NOW,
  }), /PREVIOUS_UPDATE_EXECUTION_UNPROVEN/);
  assert.equal(JSON.parse(readFileSync(value.paths.receiptPath, 'utf8')).status, 'EXECUTING');
});

test('only the live owner lane releases matching terminal truth; terminal JSON is never adopted', () => {
  const value = fixture();
  const claimed = claimOpenClawUpdateInOwnerHandler({
    paths: value.paths,
    safeRoot: value.safeRoot,
    queued: value.receipt,
    claimantPid: PID,
    now: NOW,
  });
  persistOpenClawUpdateCheckpoint({
    paths: value.paths,
    safeRoot: value.safeRoot,
    claimed,
    receipt: { ...claimed.receipt, status: 'FAILED', finalVerdict: 'SOURCE_SYNC_FAILED', blocker: 'SOURCE_SYNC_FAILED' },
    claimStatus: 'FAILED',
  });
  assert.deepEqual(releaseOpenClawUpdateOwnerLane({ paths: value.paths, safeRoot: value.safeRoot, claimed }), {
    receiptId: RECEIPT_ID,
    status: 'FAILED',
    released: true,
  });
  assert.throws(() => readFileSync(value.paths.activePath, 'utf8'), /ENOENT/);

  const next = fixture();
  writeFileSync(next.paths.activePath, `${JSON.stringify({
    schemaVersion: 'stephanos.openclaw-exact-head-update-owner-handler-claim.v1',
    receiptId: 'f'.repeat(32),
    expectedHead: HEAD,
    claimantPid: 999,
    status: 'FAILED',
  })}\n`);
  assert.throws(() => claimOpenClawUpdateInOwnerHandler({
    paths: next.paths,
    safeRoot: next.safeRoot,
    queued: next.receipt,
    claimantPid: PID,
    now: NOW,
  }), /PREVIOUS_UPDATE_EXECUTION_UNPROVEN/);
});

test('receipt replacement before the exclusive claim rebound blocks authority', () => {
  const value = fixture();
  const forged = { ...value.receipt, queuedAtUtc: new Date(NOW.getTime() + 1_000).toISOString() };
  writeFileSync(value.paths.receiptPath, `${JSON.stringify(forged, null, 2)}\n`);
  assert.throws(() => claimOpenClawUpdateInOwnerHandler({
    paths: value.paths,
    safeRoot: value.safeRoot,
    queued: value.receipt,
    claimantPid: PID,
    now: NOW,
  }), /QUEUED_UPDATE_RECEIPT_IDENTITY_CHANGED/);
  assert.equal(JSON.parse(readFileSync(value.paths.receiptPath, 'utf8')).status, 'QUEUED');
  assert.equal(JSON.parse(readFileSync(value.paths.claimPath, 'utf8')).status, 'FAILED');
});

test('same-handle receipt reader rejects oversized input before JSON allocation', () => {
  const value = fixture({ write: false });
  writeFileSync(value.paths.receiptPath, Buffer.alloc((128 * 1024) + 1, 0x20));
  assert.throws(() => readStableOpenClawUpdateReceipt({ paths: value.paths, safeRoot: value.safeRoot }), /QUEUED_UPDATE_RECEIPT_INVALID/);
});

test('durable owner authorization is receipt/head/host bound, closed-world, and short-lived', () => {
  const { authorization } = fixture({ write: false });
  assert.equal(validateOpenClawUpdateAuthorization(authorization, {
    receiptId: RECEIPT_ID,
    expectedHead: HEAD,
    parentHostPid: PID,
    now: new Date(NOW.getTime() + 30_000),
  }).ok, true);
  for (const candidate of [
    { ...authorization, senderIsOwner: false },
    { ...authorization, expectedHead: 'b'.repeat(40) },
    { ...authorization, extraAuthority: true },
  ]) {
    assert.equal(validateOpenClawUpdateAuthorization(candidate, {
      receiptId: RECEIPT_ID,
      expectedHead: HEAD,
      parentHostPid: PID,
      now: new Date(NOW.getTime() + 30_000),
    }).ok, false);
  }
  assert.equal(validateOpenClawUpdateAuthorization(authorization, {
    receiptId: RECEIPT_ID,
    expectedHead: HEAD,
    parentHostPid: PID,
    now: new Date(NOW.getTime() + 61_000),
  }).blocker, 'QUEUED_UPDATE_AUTHORIZATION_INVALID');
});

test('active-record replacement prevents checkpoint success and leaves a failed canonical receipt', () => {
  const value = fixture();
  const claimed = claimOpenClawUpdateInOwnerHandler({
    paths: value.paths,
    safeRoot: value.safeRoot,
    queued: value.receipt,
    claimantPid: PID,
    now: NOW,
  });
  writeFileSync(value.paths.activePath, `${JSON.stringify({
    schemaVersion: 'forged',
    receiptId: 'f'.repeat(32),
    expectedHead: HEAD,
    claimantPid: PID,
    status: 'FAILED',
  })}\n`);
  assert.throws(() => persistOpenClawUpdateCheckpoint({
    paths: value.paths,
    safeRoot: value.safeRoot,
    claimed,
    receipt: { ...claimed.receipt, status: 'DONE', finalVerdict: 'DONE' },
    claimStatus: 'DONE',
  }), /UPDATE_ACTIVE_PROJECTION_BINDING_INVALID/);
  const receipt = JSON.parse(readFileSync(value.paths.receiptPath, 'utf8'));
  assert.equal(receipt.status, 'FAILED');
  assert.equal(receipt.finalVerdict, 'UPDATE_CHECKPOINT_PROJECTION_FAILED');
  assert.equal(JSON.parse(readFileSync(value.paths.activePath, 'utf8')).receiptId, 'f'.repeat(32));
});
