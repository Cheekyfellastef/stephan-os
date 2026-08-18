import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const installerUrl = new URL('./windows/install-battle-bridge-recovery-lifeboat-v1.ps1', import.meta.url);

test('Battle Bridge Recovery Lifeboat scheduled task launches PowerShell hidden', async () => {
  const source = await readFile(installerUrl, 'utf8');
  assert.match(
    source,
    /New-ScheduledTaskAction -Execute \$powershellExe -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `\\"\$installedLauncher`\\""/,
  );
  assert.doesNotMatch(
    source,
    /New-ScheduledTaskAction -Execute \$powershellExe -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File/,
  );
});
