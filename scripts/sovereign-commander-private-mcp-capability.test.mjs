import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const VERSION = '2026-10-18-island-action-contract-v6';
const RUNTIME_CALLERS = [
  'scripts/sovereign-commander-http.mjs',
  'scripts/sovereign-commander-ignition-autoheal.mjs',
  'scripts/sovereign-commander-stephanos-repair.mjs',
  'scripts/windows/run-desktop-commander-watchdog-hidden.ps1',
  'shared/agents/sovereignCommanderBattleBridgeV1.mjs',
  'shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs',
];
async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}
test('service, explicit ignition calls and watchdog require the current private MCP capability generation', async () => {
  for (const path of RUNTIME_CALLERS) {
    const body = await source(path);
    assert.ok(body.includes(VERSION), path + ' must use this capability generation');
    assert.equal(body.includes('2026-10-05-continuous-repair-reporting-v4'), false, path + ' must not demand the older generation');
  }
});
test('existing specialist-pinned Windows starter accepts the required generation from guarded callers', async () => {
  const [http, mcp, autoheal, runner] = await Promise.all([
    source('scripts/sovereign-commander-http.mjs'),
    source('scripts/sovereign-commander-mcp.mjs'),
    source('scripts/sovereign-commander-ignition-autoheal.mjs'),
    source('scripts/windows/run-sovereign-commander-hidden.ps1'),
  ]);
  assert.ok(http.includes("SOVEREIGN_COMMANDER_HTTP_CAPABILITY_VERSION = '2026-10-18-island-action-contract-v6'"));
  assert.ok(mcp.includes("name: 'read_multiple_files'"));
  assert.ok(mcp.includes("name: 'get_file_info'"));
  assert.ok(autoheal.includes("'-RequireCapabilityVersion', REQUIRED_COMMANDER_CAPABILITY_VERSION"));
  assert.ok(runner.includes('[string]$RequireCapabilityVersion'));
  assert.ok(runner.includes('$staleCapability = [bool]'));
  assert.ok(runner.includes('$staleCapabilityRecycleRequested'));
});


test('scheduled S4U launcher and post-sync refresh explicitly require same generation', async () => {
  const [launcher, postSync] = await Promise.all([
    source('scripts/windows/run-stephanos-scheduled-task-windowless.vbs'),
    source('scripts/battle-bridge-post-sync-refresh.mjs'),
  ]);
  assert.ok(launcher.includes('Case "sovereign-commander-watchdog"'));
  assert.ok(launcher.includes('Quote(targetPath) & " -RequireCapabilityVersion 2026-10-18-island-action-contract-v6"'));
  const refresh = postSync.slice(postSync.indexOf('refreshSovereignCommander({ afterHead, paths })'), postSync.indexOf('restartGitHubMailbox({ afterHead, paths })'));
  assert.ok(refresh.includes("'-RequireCapabilityVersion', '2026-10-18-island-action-contract-v6'"));
});

test('Island readonly action is included in the v6 registered MCP process contract', async () => {
  const [registry, mcp, http, runner] = await Promise.all([
    source('shared/agents/sovereignCommanderV1.mjs'),
    source('scripts/sovereign-commander-mcp.mjs'),
    source('scripts/sovereign-commander-http.mjs'),
    source('scripts/windows/run-sovereign-commander-hidden.ps1'),
  ]);
  assert.ok(registry.includes("'rescue-island-readonly-boundary': frozen({"));
  assert.ok(registry.includes("nodeFile('rescue-island-boundary-probe.mjs')"));
  assert.ok(mcp.includes("'rescue-island-readonly-boundary'"));
  assert.ok(http.includes("SOVEREIGN_COMMANDER_HTTP_CAPABILITY_VERSION = '2026-10-18-island-action-contract-v6'"));
  assert.ok(runner.includes('$staleDaemonContract'));
  assert.ok(runner.includes('$staleCapabilityRecycleRequested'));
});
