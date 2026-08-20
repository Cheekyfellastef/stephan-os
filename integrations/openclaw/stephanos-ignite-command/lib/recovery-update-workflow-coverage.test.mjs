import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = new URL('../../../../.github/workflows/battle-bridge-resilience-proof.yml', import.meta.url);

test('hosted resilience proof keeps the complete exact-head update authority suite', async () => {
  const source = await readFile(workflow, 'utf8');
  for (const required of [
    'integrations/openclaw/stephanos-ignite-command/lib/recovery-update.test.mjs',
    'integrations/openclaw/stephanos-ignite-command/lib/recovery-update-executor.test.mjs',
    'integrations/openclaw/stephanos-ignite-command/lib/recovery-update-receipt.test.mjs',
    'integrations/openclaw/stephanos-ignite-command/lib/recovery-update-windows-adversarial.test.mjs',
    'integrations/openclaw/stephanos-ignite-command/lib/command-handler.test.mjs',
    'integrations/openclaw/stephanos-ignite-command/lib/ignite-status.test.mjs',
    'integrations/openclaw/stephanos-ignite-command/manifest.test.mjs',
    'shared/agents/battleBridgeExactHeadSyncGuardV1.test.mjs',
    'shared/agents/battleBridgeExactHeadAsyncUpdateV1.mjs',
    'shared/agents/battleBridgeExactHeadAsyncUpdateV1.test.mjs',
    'shared/agents/battleBridgeExecutionBoundaryV1.mjs',
    'shared/agents/battleBridgeExecutionBoundaryV1.test.mjs',
    'shared/agents/safeReceiptDirectoryChainV1.test.mjs',
    'shared/agents/stephanosUpdateDirt.test.mjs',
    'shared/agents/codexDispatchHostOps.test.mjs',
    'shared/agents/stephanosChatUpdate.test.mjs',
    'scripts/run-battle-bridge-ignition.mjs',
    'scripts/run-battle-bridge-ignition.test.mjs',
    'scripts/launcher-readiness-live-facts.mjs',
    'scripts/launcher-readiness-live-facts.test.mjs',
    'scripts/windows/probe-openclaw-gateway-18789-owner.ps1',
    'shared/agents/battleBridgeWindowsHosts.mjs',
    'shared/agents/openClawGatewayStartup.mjs',
    'runs-on: windows-latest',
    'Parse fixed OpenClaw listener owner probe',
    'Windows filesystem, claim, config, async-child, and listener adversarial proof',
  ]) assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const windowsJob = source.slice(source.indexOf('update-owner-lane-windows-adversarial:'));
  for (const requiredWindowsTest of [
    'recovery-update-windows-adversarial.test.mjs',
    'recovery-update.test.mjs',
    'recovery-update-receipt.test.mjs',
    'battleBridgeExecutionBoundaryV1.test.mjs',
    'battleBridgeExactHeadAsyncUpdateV1.test.mjs',
    'stephanosChatUpdate.test.mjs',
    'run-battle-bridge-ignition.test.mjs',
    'battle-bridge-ignition-supervisor.test.mjs',
  ]) assert.match(windowsJob, new RegExp(requiredWindowsTest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(source, /verify-openclaw-exact-head-update-host|recovery-update-host-verifier/);
});
