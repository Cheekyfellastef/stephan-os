import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeQueuedOpenClawUpdate } from './recovery-update-executor.mjs';

test('legacy executor is permanently inert for bare or fully forged receipt input', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'inert-update-executor-'));
  const forged = path.join(profile, 'forged.json');
  writeFileSync(forged, JSON.stringify({
    schemaVersion: 'stephanos.openclaw-exact-head-update-receipt.v3',
    status: 'QUEUED',
    authorization: { senderIsOwner: true, authenticatedByHost: true },
  }));
  const result = await executeQueuedOpenClawUpdate({
    receiptId: '1'.repeat(32),
    expectedHead: 'a'.repeat(40),
    env: { USERPROFILE: profile },
    platform: 'win32',
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'DISK_TRIGGERED_UPDATE_DISABLED');
  assert.equal(result.sourceMutationAttempted, false);
  assert.equal(result.runtimeMutationAttempted, false);
});
