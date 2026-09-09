import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createFixedPostSyncRuntimeAdapter } from './battle-bridge-post-sync-refresh.mjs';

const HEAD = 'a'.repeat(40);
const paths = {
  repoRoot: 'C:\\repo',
  restartScript: 'C:\\repo\\scripts\\windows\\restart-approved-stephanos-runtime.ps1',
};

test('post-sync surfaces a bounded child timeout instead of collapsing it into invalid JSON', () => {
  const adapter = createFixedPostSyncRuntimeAdapter({
    spawnSyncFn() {
      return {
        status: null,
        stdout: '',
        stderr: '',
        error: { code: 'ETIMEDOUT' },
      };
    },
  });

  const result = adapter.restartApprovedTarget({
    target: 'mission-worker',
    afterHead: HEAD,
    paths,
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'APPROVED_RUNTIME_RESTART_PROCESS_TIMEOUT');
  assert.equal(result.exactHeadProofOk, false);
  assert.equal(result.sourceHead, '');
});

test('approved runtime restart bounds every Win32 process CIM observation', async () => {
  const source = await readFile(new URL('./windows/restart-approved-stephanos-runtime.ps1', import.meta.url), 'utf8');
  const processQueries = source
    .split(/\r?\n/)
    .filter((line) => line.includes('Get-CimInstance Win32_Process'));

  assert.ok(processQueries.length >= 6, 'expected the canonical restart script to retain its explicit process observations');
  for (const line of processQueries) {
    assert.match(line, /-OperationTimeoutSec\s+1\b/, line.trim());
  }
});
