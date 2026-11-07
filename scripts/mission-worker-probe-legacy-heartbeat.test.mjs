import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const probeUrl = new URL('./windows/probe-mission-orchestrator-worker-watchdog.ps1', import.meta.url);

test('read-only Mission Worker probe tolerates pre-launch-identity heartbeat shape without weakening health proof', async () => {
  const source = await readFile(probeUrl, 'utf8');
  const projectionStart = source.indexOf('    heartbeat = if ($heartbeat) {');
  const projectionEnd = source.indexOf('    heartbeatPath = $heartbeatPath', projectionStart);
  assert.ok(projectionStart >= 0 && projectionEnd > projectionStart);
  const projection = source.slice(projectionStart, projectionEnd);

  assert.match(
    projection,
    /launchIdentityId = if \(\$heartbeat\.PSObject\.Properties\['launchIdentityId'\]\) \{ \[string\]\$heartbeat\.launchIdentityId \} else \{ '' \}/,
  );
  assert.match(
    projection,
    /workerStartedAtUtc = if \(\$heartbeat\.PSObject\.Properties\['workerStartedAtUtc'\]\) \{ \[string\]\$heartbeat\.workerStartedAtUtc \} else \{ '' \}/,
  );
  assert.doesNotMatch(projection, /^\s*launchIdentityId = \[string\]\$heartbeat\.launchIdentityId/m);
  assert.doesNotMatch(projection, /^\s*workerStartedAtUtc = \[string\]\$heartbeat\.workerStartedAtUtc/m);

  // Missing legacy fields are observation-only. A worker is still healthy only
  // when the existing launch-identity verifier proves the new exact identity.
  assert.match(source, /function Get-VerifiedWorkerLaunchIdentity/);
  assert.match(source, /\$launchIdentityId -notmatch '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(source, /launchIdentityVerified = \[bool\]\$launchIdentity/);
  assert.match(source, /arbitraryTaskNameAllowed = \$false/);
  assert.match(source, /arbitraryPowerShellAllowed = \$false/);
  assert.match(source, /visiblePowerShellRequired = \$false/);
});
