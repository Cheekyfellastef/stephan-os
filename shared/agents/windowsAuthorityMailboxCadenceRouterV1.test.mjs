import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('top-level Windows specialist pins and routes the mailbox cadence reviewer', async () => {
  const source = await readFile(new URL('./windowsAuthoritySpecialistReviewV1.mjs', import.meta.url), 'utf8');
  assert.match(source, /MAILBOX_CADENCE_PATH = '\.\/windowsAuthorityMailboxCadenceReviewV1\.mjs'/);
  assert.match(source, /MAILBOX_CADENCE_BLOB_SHA = 'd1319d542b219c786a36e8063f4080369f1f9a51'/);
  assert.match(source, /WINDOWS_AUTHORITY_MAILBOX_CADENCE_PATH_INVENTORY_MISMATCH/);
  assert.match(source, /mailboxCadence\.analyzeWindowsAuthorityMailboxCadenceReviewV1\(input\)/);
  const cadenceRoute = source.indexOf('mailboxCadence.analyzeWindowsAuthorityMailboxCadenceReviewV1');
  const coreRoute = source.indexOf('core.analyzeWindowsAuthoritySpecialistReview');
  assert.ok(cadenceRoute > 0 && coreRoute > cadenceRoute);
});
