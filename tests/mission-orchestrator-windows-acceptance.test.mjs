import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const path = new URL('../scripts/windows/verify-mission-orchestrator-v1-acceptance.ps1', import.meta.url);

test('Windows acceptance proves worker, repository, dashboard, Tailscale, and optional completed mission truth', async () => {
  const source = await readFile(path, 'utf8');
  for (const evidence of [
    'exact-main-head', 'no-source-dirt', 'worker-task-installed', 'worker-task-last-result', 'worker-log-fresh',
    'local-backend-health', 'mission-feed-schema', 'public-feed-token-redaction', 'tailscale-login',
    'tailscale-serve-target', 'tailscale-hosted-health', 'single-active-writer', 'repair-bound',
    'evidence-present', 'mission-complete',
  ]) assert.equal(source.includes(evidence), true, evidence);
  assert.match(source, /foreach \(\$step in @\('sync', 'build', 'verify', 'restart'\)\)/);
  assert.match(source, /Add-Check "deployment-\$step"/);
  assert.match(source, /ValidatePattern\('\^\[a-f0-9\]\{40\}\$'\)/);
  assert.match(source, /MISSION_ORCHESTRATOR_WINDOWS_ACCEPTANCE_PASS/);
  assert.match(source, /proof\\mission-orchestrator-acceptance/);
  assert.doesNotMatch(source, /reset --hard|push --force|checkout --force/i);
});
