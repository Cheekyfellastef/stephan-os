import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../.github/workflows/battle-bridge-out-of-band-observer-v1.yml', import.meta.url);

async function workflow() {
  return readFile(workflowUrl, 'utf8');
}

test('observer listens only for the owner-authored fixed read-only prerequisite marker', async () => {
  const source = await workflow();
  assert.match(source, /github\.event\.issue\.number == 1507/);
  assert.match(source, /github\.actor == 'Cheekyfellastef'/);
  assert.match(source, /stephanos-battle-bridge-tailscale-bootstrap-prerequisites/);
  assert.match(source, /validate-event/);
  assert.match(source, /encoded-command/);
});

test('observer has only read and receipt-publication GitHub authority', async () => {
  const source = await workflow();
  assert.match(source, /contents: read/);
  assert.match(source, /id-token: write/);
  assert.match(source, /issues: write/);
  assert.match(source, /actions\/github-script@v7/);
  assert.match(source, /issues\.createComment/);
  assert.doesNotMatch(source, /contents:\s*write/);
});

test('observer cannot sync, install, restart or mutate source', async () => {
  const source = await workflow();
  assert.doesNotMatch(source, /git\s+(?:merge|pull|reset|clean|checkout|switch|rebase|push)\b/i);
  assert.doesNotMatch(source, /Start-ScheduledTask|Register-ScheduledTask|Stop-Process|Restart-Computer|Remove-Item/i);
  assert.doesNotMatch(source, /install-battle-bridge-github-sync\.ps1[^']*StartNow/i);
  assert.match(source, /Read exact Battle Bridge head without mutation/);
});

test('observer terminalizes transport and settings failures rather than leaving silence', async () => {
  const source = await workflow();
  assert.match(source, /continue-on-error: true/);
  assert.match(source, /Publish terminal external observer receipt/);
  assert.match(source, /if: always\(\)/);
  assert.match(source, /Fail workflow closed after publishing non-DONE receipt/);
  assert.match(source, /steps\.terminal\.outputs\.state != 'DONE'/);
});
