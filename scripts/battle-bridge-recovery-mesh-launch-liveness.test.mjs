import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Recovery Mesh hidden launcher always emits bounded terminal liveness without widening authority', async () => {
  const source = await readFile(new URL('./windows/run-battle-bridge-recovery-mesh-hidden.ps1', import.meta.url), 'utf8');

  assert.match(source, /battle-bridge-recovery-mesh-launch-current\.json/);
  assert.match(source, /stephanos\.battle-bridge-recovery-mesh-launch\.v1/);
  for (const classification of [
    'RECOVERY_MESH_HIDDEN_WRAPPER_STARTED',
    'RECOVERY_MESH_MUTEX_BUSY',
    'RECOVERY_MESH_STALE_LOCK_RECLAIM_FAILED',
    'RECOVERY_MESH_RUNNER_STARTING',
    'RECOVERY_MESH_RUNNER_COMPLETED',
    'RECOVERY_MESH_RUNNER_FAILED',
    'RECOVERY_MESH_HIDDEN_WRAPPER_FAILED',
  ]) assert.match(source, new RegExp(classification));

  assert.match(source, /runnerResultParsed/);
  assert.match(source, /runnerClassification/);
  assert.match(source, /\$runnerOutput = @\(& \$nodeExecutable \$runnerPath 2>&1\)/);
  assert.doesNotMatch(source, /\$nodeExecutable \$runnerPath \*> \$null/);

  assert.match(source, /System\.Threading\.Mutex/);
  assert.match(source, /STEPHANOS_RECOVERY_MESH_MUTEX_HELD = '1'/);
  assert.match(source, /Get-RecoveryLockPathBaseline/);
  assert.match(source, /Assert-RecoveryLockPathBaseline/);
  assert.match(source, /OpenVerifiedForDelete/);
  assert.match(source, /DeleteByHandle/);
  assert.match(source, /RECOVERY_LOCK_MULTIPLE_LINKS_REJECTED/);

  assert.match(source, /visiblePowerShellRequired = \$false/);
  assert.match(source, /arbitraryShellAllowed = \$false/);
  assert.match(source, /arbitraryPowerShellAllowed = \$false/);
  assert.match(source, /sourceMutationAllowed = \$false/);
  assert.match(source, /pcRestartAllowed = \$false/);
  assert.doesNotMatch(source, /["']-Command["']|Invoke-Expression|Start-Process|Restart-Computer|git\s+(?:reset|clean|checkout|switch|push)/i);
});