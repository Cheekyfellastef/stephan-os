import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const WINDOWS_LAUNCHER_PS1 = new URL('../windows/Launch-Stephanos-Local.ps1', import.meta.url);

test('Launch-Stephanos-Local no longer treats runtime-status json as launcher-root Battle Bridge final gate', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  assert.doesNotMatch(script, /Wait-ForUrl -StepLabel 'launcher-root runtime-status endpoint'/, 'launcher-root final readiness must not wait on legacy runtime-status endpoint');
  assert.match(script, /Wait-ForBattleBridgeSupervisorReady/, 'launcher-root final readiness must use supervisor final contract');
});

test('button path delegates launcher-root ignition to Battle Bridge supervisor approval helper', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  assert.match(script, /\$launcherRootCanonicalCommand = 'npm run stephanos:ignite'/, 'canonical supervisor command must remain npm run stephanos:ignite');
  assert.match(script, /starting Battle Bridge supervisor through launcher-root approval helper/, 'launcher-root button path must announce supervisor delegation');
  assert.match(script, /Start-DevWindow -Title 'Stephanos Battle Bridge Ignition Supervisor' -Command \$launcherRootCommand/, 'launcher-root button path must start the approval helper that runs the supervisor');
});

test('button path reads and waits on canonical Battle Bridge supervisor current record', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  assert.match(script, /\$battleBridgeSupervisorCurrentPath = Join-Path \$canonicalSharedWorkspaceRoot 'status\/battle-bridge-ignition-supervisor-current\.json'/, 'current record must live in canonical shared workspace status directory');
  assert.match(script, /function Get-BattleBridgeSupervisorCurrentRecord[\s\S]*\$battleBridgeSupervisorCurrentPath[\s\S]*ConvertFrom-Json/, 'launcher must parse the current supervisor record');
  assert.match(script, /waiting for Battle Bridge supervisor current record at \$battleBridgeSupervisorCurrentPath/, 'launcher-root wait must observe the canonical current record');
});

test('success requires green supervisor state and exact-head servedRuntimeProof', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  assert.match(script, /function Test-BattleBridgeSupervisorFinalContract/, 'launcher must centralize final supervisor contract validation');
  for (const required of [
    /\$SupervisorRecord\.currentPhase -eq 'ready'/,
    /\$SupervisorRecord\.trafficLight -eq 'green'/,
    /\$SupervisorRecord\.services\.backend8787\.ready -eq \$true/,
    /\$SupervisorRecord\.services\.openClaw18789\.ready -eq \$true/,
    /\$SupervisorRecord\.services\.stephanosUi4173\.ready -eq \$true/,
    /\$servedRuntimeProof\.ready -eq \$true/,
    /\[string\]\$servedRuntimeProof\.currentHead -eq \[string\]\$ExpectedHead/,
  ]) {
    assert.match(script, required);
  }
  assert.match(script, /git rev-parse HEAD/, 'exact-head proof must compare against current git HEAD');
});

test('stale served runtime follows supervisor repair retry path instead of dead runtime-status timeout', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  assert.match(script, /\$record\.blockerId -eq 'served-runtime-stale'[\s\S]*guarded UI repair\/retry remains delegated to npm run stephanos:ignite/, 'stale served runtime must be surfaced as supervisor delegated repair/retry');
  assert.doesNotMatch(script, /Timed out waiting for launcher-root runtime-status endpoint/, 'launcher-root must not dead-timeout on the legacy final gate');
});
