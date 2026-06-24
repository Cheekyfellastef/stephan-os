import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../scripts/windows/invoke-openclaw-github-operator-bridge.ps1', import.meta.url),
  'utf8',
);

test('bridge invokes only the signed Stephanos OpenClaw GitHub operator', () => {
  assert.match(source, /scripts\\openclaw-github-operator\.mjs/);
  assert.match(source, /& node\.exe \$operatorScript \$requestFullPath/);
  assert.doesNotMatch(source, /Invoke-Expression/);
  assert.doesNotMatch(source, /Start-Process/);
});

test('bridge publishes running and terminal snapshots atomically', () => {
  assert.match(source, /Write-AtomicJson -Path \$snapshotPath -Value \$runningSnapshot/);
  assert.match(source, /Write-AtomicJson -Path \$snapshotPath -Value \$finalSnapshot/);
  assert.match(source, /Move-Item -LiteralPath \$temporaryPath -Destination \$Path -Force/);
  assert.match(source, /state\s+= "RUNNING"/);
  assert.match(source, /\$finalState = \$\(if \(\$passed\) \{ "COMPLETE" \} else \{ "BLOCKED" \}\)/);
});

test('bridge hashes command output and does not persist raw stdout or stderr', () => {
  assert.match(source, /commandOutputHash = Get-Sha256TextLower \$combined/);
  assert.match(source, /executorOutputHash = Get-Sha256TextLower \$rawOutput/);
  assert.doesNotMatch(source, /stdout\s+= \$stdout/);
  assert.doesNotMatch(source, /stderr\s+= \$stderr/);
});

test('bridge writes to the canonical Mission Runner proof directory', () => {
  assert.match(source, /mission-runner\\proof\\mission-operations/);
  assert.match(source, /\$safeMissionId\.snapshot\.json/);
  assert.match(source, /\$safeAuthorizationId\.operation\.json/);
  assert.match(source, /FINAL_VERDICT=\$finalVerdict/);
});
