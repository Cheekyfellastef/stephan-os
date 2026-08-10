import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const adapterPath = new URL('./windows/request-battle-bridge-recovery.ps1', import.meta.url);

test('recovery wake persists the request and idempotently nudges the fixed coordinator task', async () => {
  const source = await readFile(adapterPath, 'utf8');

  assert.match(source, /Move-Item -LiteralPath \$temporaryPath -Destination \$requestPath -Force/);
  assert.match(source, /\$taskStateBefore = \[string\]\$task\.State/);
  assert.match(source, /\$startAttempted = \$false/);
  assert.match(source, /if \(\$taskStateBefore -ne 'Running'\) \{/);
  assert.match(source, /\$startAttempted = \$true/);
  assert.match(source, /try \{\s*Start-ScheduledTask -TaskName \$taskName\s*\}/);
  assert.match(source, /RECOVERY_MESH_TASK_START_FAILED/);
  assert.match(source, /coordinatorStateBefore = \$taskStateBefore/);
  assert.match(source, /startAttempted = \$startAttempted/);

  assert.doesNotMatch(
    source,
    /Move-Item -LiteralPath \$temporaryPath -Destination \$requestPath -Force\s*\r?\nStart-ScheduledTask -TaskName \$taskName\s*\r?\n/,
  );
  assert.doesNotMatch(source, /Invoke-Expression|cmd\.exe|Start-Process|\[string\]\s*\$TaskName/i);
});
