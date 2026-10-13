import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const VERSION = '2026-10-13-private-mcp-batch-metadata-v5';
const RUNTIME_FILES = [
  'scripts/sovereign-commander-http.mjs',
  'scripts/sovereign-commander-ignition-autoheal.mjs',
  'scripts/sovereign-commander-stephanos-repair.mjs',
  'scripts/windows/run-sovereign-commander-hidden.ps1',
  'scripts/windows/run-desktop-commander-watchdog-hidden.ps1',
  'shared/agents/sovereignCommanderBattleBridgeV1.mjs',
];
async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}
test('runtime health, guarded ignition and watchdog use one private MCP capability generation', async () => {
  for (const path of RUNTIME_FILES) {
    const body = await source(path);
    assert.ok(body.includes(VERSION), path + ' must require this capability generation');
    assert.equal(body.includes('2026-10-05-continuous-repair-reporting-v4'), false, path + ' must not accept the older generation');
  }
});
test('advertised batch-read and metadata tools require the bumped health contract', async () => {
  const [http, mcp, runner] = await Promise.all([
    source('scripts/sovereign-commander-http.mjs'),
    source('scripts/sovereign-commander-mcp.mjs'),
    source('scripts/windows/run-sovereign-commander-hidden.ps1'),
  ]);
  assert.ok(http.includes("SOVEREIGN_COMMANDER_HTTP_CAPABILITY_VERSION = '2026-10-13-private-mcp-batch-metadata-v5'"));
  assert.ok(mcp.includes("name: 'read_multiple_files'"));
  assert.ok(mcp.includes("name: 'get_file_info'"));
  assert.ok(runner.includes('$staleCapability = [bool]'));
  assert.ok(runner.includes('$staleCapabilityRecycleRequested'));
});
