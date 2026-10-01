import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../scripts/windows/configure-sovereign-commander-tailscale.ps1', import.meta.url), 'utf8');

test('tailnet exposure is explicit, private, and preserves bearer auth', () => {
  assert.match(source, /ApproveTailnetExposure/);
  assert.match(source, /APPROVE_TAILNET_EXPOSURE_REQUIRED/);
  assert.match(source, /http:\/\/127\.0\.0\.1:\$localPort/);
  assert.match(source, /serve --bg --https=\$servePort \$target/);
  assert.match(source, /publicFunnelEnabledByThisAction = \$false/);
  assert.match(source, /bearerAuthenticationStillRequired = \$true/);
  assert.match(source, /backendLoopbackOnly = \$true/);
  assert.doesNotMatch(source, /tailscale\s+funnel/i);
});

test('tailnet configuration requires healthy local Sovereign Commander and running Tailscale', () => {
  assert.match(source, /SOVEREIGN_COMMANDER_LOCAL_HEALTH_REQUIRED/);
  assert.match(source, /TAILSCALE_NOT_RUNNING/);
  assert.match(source, /TAILSCALE_SERVE_PROOF_FAILED/);
});
