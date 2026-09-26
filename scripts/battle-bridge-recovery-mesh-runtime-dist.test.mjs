import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const probeUrl = new URL('./windows/probe-battle-bridge-recovery-mesh.ps1', import.meta.url);

test('Recovery Mesh probe tolerates only canonical UI dist as runtime state', async () => {
  const source = await readFile(probeUrl, 'utf8');

  assert.match(source, /\$runtimeUiDistPrefix\s*=\s*'apps\/stephanos\/dist\/'/);
  assert.match(
    source,
    /\$path\.StartsWith\(\$runtimeUiDistPrefix, \[System\.StringComparison\]::OrdinalIgnoreCase\)/,
  );
  assert.match(source, /runtimeUiDistDirtTolerated\s*=\s*\[bool\]\$afterWorktree\.RuntimeUiDistDirty/);
  assert.match(source, /sourceWorktreeClean\s*=\s*\$true/);
  assert.doesNotMatch(source, /StartsWith\(['"]apps\/stephanos['"]\)/);
});
