import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { SOVEREIGN_COMMANDER_REMOTE_ACTIONS } from './sovereignCommanderRemoteMailboxV1.mjs';

const governor = await readFile(new URL('../../scripts/windows/run-vr-resource-governor.ps1', import.meta.url), 'utf8');
const runner = await readFile(new URL('../../scripts/windows/run-sovereign-commander-hidden.ps1', import.meta.url), 'utf8');
const installer = await readFile(new URL('../../scripts/windows/install-sovereign-commander.ps1', import.meta.url), 'utf8');
const provider = await readFile(new URL('../../stephanos-server/services/llm/providers/ollamaProvider.js', import.meta.url), 'utf8');
const commander = await readFile(new URL('./sovereignCommanderV1.mjs', import.meta.url), 'utf8');
const mcp = await readFile(new URL('../../scripts/sovereign-commander-mcp.mjs', import.meta.url), 'utf8');

test('VR resource governor detects the active Air Link session and parks non-lightweight Ollama models', () => {
  assert.match(governor, /Get-Process -Name 'OculusDash'/);
  assert.match(governor, /ollama\.exe/);
  assert.match(governor, /& \$OllamaExecutable stop \$Model/);
  assert.match(governor, /\$lightweightModel = 'llama3\.2:3b'/);
  assert.match(governor, /\[string\]::Equals\(\$model, \$lightweightModel/);
  assert.match(governor, /ReleaseGraceSeconds = 45/);
  assert.match(governor, /meta-air-link-session-active/);
  assert.match(governor, /stephanos\.vr-resource-governor\.v1/);
});

test('Stephanos router cannot escalate back to a heavy local model while VR governor is active', () => {
  assert.match(provider, /function readVrResourceGovernorState\(\)/);
  assert.match(provider, /stephanos\.vr-resource-governor\.v1/);
  assert.match(provider, /if \(vrResourceGovernor\.active\)/);
  assert.match(provider, /ollamaLoadMode: 'cool'/);
  assert.match(provider, /forceHeavyModel: false/);
  assert.match(provider, /OLLAMA_MODEL_POLICY\.lightweight/);
});

test('Sovereign Commander owns and self-heals the hidden VR resource governor', () => {
  assert.match(runner, /run-vr-resource-governor\.ps1/);
  assert.match(runner, /Get-VrResourceGovernorProcesses/);
  assert.match(runner, /'-Action', 'Watch'/);
  assert.match(runner, /-WindowStyle Hidden/);
  assert.match(runner, /vrResourceGovernorHealthy/);
  assert.match(runner, /if \(-not \$vrGovernorOk\) \{ exit 4 \}/);
  assert.match(installer, /vrResourceGovernorEnabled = \$true/);
  assert.match(installer, /run-vr-resource-governor\.ps1/);
});

test('VR resource governor is an admitted bounded maintenance action locally and remotely', () => {
  assert.ok(SOVEREIGN_COMMANDER_REMOTE_ACTIONS.includes('vr-resource-governor'));
  assert.match(commander, /'vr-resource-governor': frozen\(\{/);
  assert.match(commander, /run-vr-resource-governor\.ps1/);
  assert.match(commander, /'-Action', 'Reconcile'/);
  assert.match(mcp, /'vr-resource-governor'/);
});
