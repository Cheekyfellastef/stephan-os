import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { SOVEREIGN_COMMANDER_REMOTE_ACTIONS } from './sovereignCommanderRemoteMailboxV1.mjs';

const governor = await readFile(new URL('../../scripts/windows/run-vr-resource-governor.ps1', import.meta.url), 'utf8');
const virtualAcceptance = await readFile(new URL('../../scripts/windows/run-vr-virtual-airlink-acceptance.ps1', import.meta.url), 'utf8');
const runner = await readFile(new URL('../../scripts/windows/run-sovereign-commander-hidden.ps1', import.meta.url), 'utf8');
const installer = await readFile(new URL('../../scripts/windows/install-sovereign-commander.ps1', import.meta.url), 'utf8');
const provider = await readFile(new URL('../../stephanos-server/services/llm/providers/ollamaProvider.js', import.meta.url), 'utf8');
const commander = await readFile(new URL('./sovereignCommanderV1.mjs', import.meta.url), 'utf8');
const mcp = await readFile(new URL('../../scripts/sovereign-commander-mcp.mjs', import.meta.url), 'utf8');

test('gaming resource governor detects VR and flat-game sessions and parks non-lightweight Ollama models', () => {
  assert.match(governor, /'OculusDash', 'vrcompositor', 'vrdashboard'/);
  assert.match(governor, /starfield-vr-sim-air-link\.json/);
  assert.match(governor, /stephanos\.starfield-vr-sim-air-link\.v1/);
  assert.match(governor, /virtual-air-link-test-active/);
  assert.match(governor, /virtualAirLinkTestActive/);
  assert.match(governor, /ollama\.exe/);
  assert.match(governor, /& \$OllamaExecutable stop \$Model/);
  assert.match(governor, /\$lightweightModel = 'llama3\.2:3b'/);
  assert.match(governor, /\[string\]::Equals\(\$model, \$lightweightModel/);
  assert.match(governor, /ReleaseGraceSeconds = 45/);
  assert.match(governor, /meta-air-link-session-active/);
  assert.match(governor, /stephanos\.vr-resource-governor\.v1/);
  assert.match(governor, /function Get-FlatGameSignal/);
  assert.match(governor, /function Get-GamingSignal/);
  assert.match(governor, /'Starfield'/);
  assert.match(governor, /'Cyberpunk2077'/);
  assert.match(governor, /'SkyrimSE'/);
  assert.match(governor, /\\\\steamapps\\\\common\\\\/);
  assert.match(governor, /\\\\XboxGames\\\\/);
  assert.match(governor, /STEPHANOS_GAME_PROCESS_NAMES/);
  assert.match(governor, /STEPHANOS_GAME_LIBRARY_ROOTS/);
  assert.match(governor, /GameBarPresenceWriter/);
  assert.match(governor, /function Test-WindowsGamePresenceActive/);
  assert.match(governor, /game-library-process-active/);
  assert.match(governor, /windows-game-presence-active/);
  assert.match(governor, /\\\\Ubisoft\\\\Ubisoft Game Launcher\\\\games\\\\/);
  assert.match(governor, /\\\\Rockstar Games\\\\/);
  assert.match(governor, /flatGameActive/);
  assert.match(governor, /gameProcessName/);
  assert.match(governor, /gaming-session-release-grace/);
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
  assert.match(runner, /VR protection is intentionally independent of daemon health/);
  assert.doesNotMatch(runner, /if \(\$ok\) \{\s*if \(-not \(Test-Path -LiteralPath \$vrGovernorScript/s);
  assert.match(runner, /if \(-not \$vrGovernorOk\) \{ exit 4 \}/);
  assert.match(installer, /vrResourceGovernorEnabled = \$true/);
  assert.match(installer, /run-vr-resource-governor\.ps1/);
  assert.equal((installer.match(/vrResourceGovernorPath = \$vrGovernorPath/g) ?? []).length, 2);
  assert.equal((installer.match(/vrResourceGovernorEnabled = \$true/g) ?? []).length, 2);
});

test('VR resource governor is an admitted bounded maintenance action locally and remotely', () => {
  assert.ok(SOVEREIGN_COMMANDER_REMOTE_ACTIONS.includes('vr-resource-governor'));
  assert.match(commander, /'vr-resource-governor': frozen\(\{/);
  assert.match(commander, /run-vr-resource-governor\.ps1/);
  assert.match(commander, /'-Action', 'Reconcile'/);
  assert.match(commander, /timeoutMs: 60_000/);
  assert.match(mcp, /'vr-resource-governor'/);
});

test('Sovereign Commander owns a bounded Virtual AirLink acceptance cycle', () => {
  assert.ok(SOVEREIGN_COMMANDER_REMOTE_ACTIONS.includes('vr-virtual-airlink-acceptance'));
  assert.match(commander, /'vr-virtual-airlink-acceptance': frozen\(\{/);
  assert.match(commander, /run-vr-virtual-airlink-acceptance\.ps1/);
  assert.match(mcp, /'vr-virtual-airlink-acceptance'/);

  assert.match(virtualAcceptance, /stephanos\.vr-virtual-airlink-acceptance\.v1/);
  assert.match(virtualAcceptance, /stephanos\.starfield-vr-sim-air-link\.v1/);
  assert.match(virtualAcceptance, /Set-VirtualAirLink -Enabled \$true/);
  assert.match(virtualAcceptance, /finally \{/);
  assert.match(virtualAcceptance, /Set-VirtualAirLink -Enabled \$false/);
  assert.match(virtualAcceptance, /VR_ACCEPTANCE_HEAVY_MODEL_RESPAWNED/);
  assert.match(virtualAcceptance, /heavyModelSamplesDuringGuard/);
  assert.match(virtualAcceptance, /nvidia-smi\.exe/);
  assert.match(virtualAcceptance, /vramReleasedMiB/);
  assert.match(virtualAcceptance, /launchAllowed = \$false/);
  assert.match(virtualAcceptance, /realHeadsetProofClaimed = \$false/);
  assert.match(virtualAcceptance, /arbitraryShellAllowed = \$false/);
  assert.match(virtualAcceptance, /pcRestartAllowed = \$false/);
  assert.match(virtualAcceptance, /SOVEREIGN_COMMANDER_VIRTUAL_AIR_LINK_ACCEPTANCE_PASSED/);
});
