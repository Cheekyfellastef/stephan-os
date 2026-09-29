import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const probeUrl = new URL('./windows/probe-battle-bridge-recovery-mesh.ps1', import.meta.url);

test('Recovery Mesh OpenClaw task condition is Windows PowerShell 5.1 parse-safe', async () => {
  const source = await readFile(probeUrl, 'utf8');
  assert.match(
    source,
    /\[string\]::Equals\(\$execute, \$expectedGateway, \[System\.StringComparison\]::OrdinalIgnoreCase\) `\r?\n\s*-and \[string\]::IsNullOrWhiteSpace\(\[string\]\$action\.Arguments\)/,
  );
  assert.doesNotMatch(
    source,
    /OrdinalIgnoreCase\)\r?\n\s*-and \[string\]::IsNullOrWhiteSpace/,
  );
});
