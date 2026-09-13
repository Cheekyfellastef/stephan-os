import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const requestAdapter = new URL('./windows/request-battle-bridge-recovery.ps1', import.meta.url);

test('Windows recovery derives general mailbox authority from the canonical source contract', async () => {
  const source = await readFile(requestAdapter, 'utf8');

  assert.match(source, /function Get-CanonicalMailboxIssue/);
  assert.match(source, /Join-Path \$repoRoot 'shared\\agents\\canonicalMailboxAuthorityV1\.mjs'/);
  assert.match(source, /RECOVERY_CANONICAL_MAILBOX_AUTHORITY_INVALID/);
  assert.match(source, /\$declarations\.Count -ne 1 -or \$assignments\.Count -ne 1/);
  assert.match(source, /\$canonicalMailboxIssue = Get-CanonicalMailboxIssue/);
  assert.match(source, /\[int\]\$mailboxReceipt\.issueNumber -ne \$canonicalMailboxIssue/);
  assert.doesNotMatch(source, /\[int\]\$mailboxReceipt\.issueNumber -ne \d+/);
  assert.doesNotMatch(source, /\b2158\b/);
});
