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

test('cleanup process observation fails closed when its bounded CIM query fails', async () => {
  const source = await readFile(new URL('./windows/restart-approved-stephanos-runtime.ps1', import.meta.url), 'utf8');
  const cleanupBlock = source.match(/if \(\$ExpectedProcessId -gt 0[\s\S]*?MISSION_WORKER_CLEANUP_PROCESS_DID_NOT_STOP' \}/)?.[0] ?? '';

  assert.ok(cleanupBlock, 'expected the canonical cleanup process observation block');
  assert.match(cleanupBlock, /Get-CimInstance Win32_Process[^\r\n]*-OperationTimeoutSec\s+1\b[^\r\n]*-ErrorAction\s+Stop\b/);
  assert.match(cleanupBlock, /return\s+-not\s+\$cleanupProcess\b/);
  assert.match(cleanupBlock, /catch\s*\{\s*return\s+\$false\s*\}/);
  assert.doesNotMatch(cleanupBlock, /Get-CimInstance Win32_Process[^\r\n]*-ErrorAction\s+SilentlyContinue\b/);
});
