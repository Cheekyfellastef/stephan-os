import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, lstat, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SOVEREIGN_COMMANDER_REMOTE_ACTIONS } from './sovereignCommanderRemoteMailboxV1.mjs';
import { coreGamingProtectionFromGovernor } from './stephanosCoreDaemonV1.mjs';
import { projectVrGovernorExecutionPermissionsV1 } from '../ai/ollamaLoadGovernor.mjs';
import { classifyQwen35CanaryGovernorV1 } from './qwen35CanaryGovernorAdmissionV1.mjs';
// Keep the behavioral Windows fixtures in the existing hosted governor entry.
import '../../scripts/governor-progress-repair.test.mjs';

const governor = await readFile(new URL('../../scripts/windows/run-vr-resource-governor.ps1', import.meta.url), 'utf8');
const qwen35Canary = await readFile(new URL('../../scripts/qwen35-canary.mjs', import.meta.url), 'utf8');
const ollamaLoadGovernor = await readFile(new URL('../ai/ollamaLoadGovernor.mjs', import.meta.url), 'utf8');
const virtualAcceptance = await readFile(new URL('../../scripts/windows/run-vr-virtual-airlink-acceptance.ps1', import.meta.url), 'utf8');
const gamingAcceptance = await readFile(new URL('../../scripts/windows/run-gaming-resource-acceptance.ps1', import.meta.url), 'utf8');
const starfieldPerformance = await readFile(new URL('../../scripts/windows/starfield-vr-performance-mode.ps1', import.meta.url), 'utf8');
const starfieldDiagnosis = await readFile(new URL('../../scripts/windows/read-starfield-vr-performance-diagnosis.ps1', import.meta.url), 'utf8');
const starfieldTelemetryReport = await readFile(new URL('../../scripts/report-starfield-vr-telemetry.mjs', import.meta.url), 'utf8');
const profileExample = await readFile(new URL('../../config/gaming-resource-profiles.example.json', import.meta.url), 'utf8');
const runner = await readFile(new URL('../../scripts/windows/run-sovereign-commander-hidden.ps1', import.meta.url), 'utf8');
const installer = await readFile(new URL('../../scripts/windows/install-sovereign-commander.ps1', import.meta.url), 'utf8');
const provider = await readFile(new URL('../../stephanos-server/services/llm/providers/ollamaProvider.js', import.meta.url), 'utf8');
const commander = await readFile(new URL('./sovereignCommanderV1.mjs', import.meta.url), 'utf8');
const mcp = await readFile(new URL('../../scripts/sovereign-commander-mcp.mjs', import.meta.url), 'utf8');
const remoteMailbox = await readFile(new URL('./sovereignCommanderRemoteMailboxV1.mjs', import.meta.url), 'utf8');
const gamingService = await readFile(new URL('../../stephanos-server/services/gamingResourceService.js', import.meta.url), 'utf8');
const gamingRoute = await readFile(new URL('../../stephanos-server/routes/gaming-resource.js', import.meta.url), 'utf8');
const server = await readFile(new URL('../../stephanos-server/server.js', import.meta.url), 'utf8');
const gamingTile = await readFile(new URL('../../stephanos-ui/src/components/GamingResourceTile.jsx', import.meta.url), 'utf8');
const aiClient = await readFile(new URL('../../stephanos-ui/src/ai/aiClient.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../../stephanos-ui/src/App.jsx', import.meta.url), 'utf8');

test('existing hosted governor entry exercises actual inference and capacity consumers', () => {
  const files = [
    '../../stephanos-server/tests/ollama-provider.test.js',
    '../../stephanos-server/services/forgeLifeboatCapacityService.test.js',
    '../../stephanos-server/services/sovereignBuilder8CapacityService.test.js',
    '../../scripts/battle-bridge-github-sync-and-refresh.test.mjs',
  ].map(path => fileURLToPath(new URL(path, import.meta.url)));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', ...files], {
    encoding: 'utf8', windowsHide: true, shell: false, timeout: 45000, maxBuffer: 1024 * 1024, env,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
  assert.ok(Number(result.stdout.match(/^# tests (\d+)$/m)?.[1]) >= 40, 'consumer tests must actually execute');
  assert.match(result.stdout, /^# skipped 0$/m);
  assert.match(result.stdout, /# Subtest: unchanged exact source observes Forge once before unrelated runtime debt while retaining every hold/);
});

test('idle custody and unknown observations deny canonical local execution independently of game activity', () => {
  const now = Date.now();
  const normal = { schemaVersion: 'stephanos.vr-resource-governor.v1', governorVersion: 3,
    updatedAtUtc: new Date(now).toISOString(), phase: 'NORMAL', active: false,
    flatGameActive: false, airLinkActive: false, realAirLinkActive: false,
    virtualAirLinkTestActive: false, prepareLeaseActive: false,
    nativeProbeCustodyHeld: false, dependencyObservationKnown: true,
    localModelAllowed: true, heavyModelAllowed: true, evictionHealthy: true };
  assert.equal(projectVrGovernorExecutionPermissionsV1(normal, now).localCpuAllowed, true);
  for (const denial of [
    { nativeProbeCustodyHeld: true }, { dependencyObservationKnown: false },
    { localModelAllowed: false }, { evictionHealthy: false },
    { nativeProbeCustodyHeld: 'false' }, { dependencyObservationKnown: undefined },
    { updatedAtUtc: new Date(now - 15001).toISOString() },
    { updatedAtUtc: new Date(now + 1).toISOString() },
  ]) {
    const state = { ...normal, ...denial };
    const actual = projectVrGovernorExecutionPermissionsV1(state, now);
    assert.equal(actual.localModelAllowed, false, JSON.stringify(denial));
    assert.equal(actual.heavyModelAllowed, false);
    assert.equal(actual.localCpuAllowed, false);
    assert.equal(coreGamingProtectionFromGovernor(state, now), true);
  }
  const lightweightOnly = { ...normal, heavyModelAllowed: false };
  assert.equal(projectVrGovernorExecutionPermissionsV1(lightweightOnly, now).localModelAllowed, true);
  assert.equal(projectVrGovernorExecutionPermissionsV1(lightweightOnly, now).heavyModelAllowed, false);
  assert.equal(coreGamingProtectionFromGovernor(lightweightOnly, now), true);
  const gaming = { ...normal, phase: 'GAMING', active: true, heavyModelAllowed: false };
  assert.equal(projectVrGovernorExecutionPermissionsV1(gaming, now).localModelAllowed, true);
  assert.equal(projectVrGovernorExecutionPermissionsV1(gaming, now).heavyModelAllowed, false);
});

test('effective model grants remain distinct from observed-activity CPU exclusion', () => {
  const now = Date.now();
  const forcedOff = { schemaVersion: 'stephanos.vr-resource-governor.v1', governorVersion: 3,
    updatedAtUtc: new Date(now).toISOString(), phase: 'NORMAL', active: false,
    overrideMode: 'FORCE_OFF', flatGameActive: true, airLinkActive: false,
    realAirLinkActive: false, virtualAirLinkTestActive: false, prepareLeaseActive: false,
    nativeProbeCustodyHeld: false, dependencyObservationKnown: true,
    localModelAllowed: true, heavyModelAllowed: true, evictionHealthy: true };
  for (const state of [forcedOff, { ...forcedOff, phase: 'GAMING', active: true, overrideMode: 'AUTO' }]) {
    const permission = projectVrGovernorExecutionPermissionsV1(state, now);
    assert.equal(permission.localModelAllowed, true);
    assert.equal(permission.heavyModelAllowed, true, 'effective profile/override model grant remains canonical');
    assert.equal(permission.localCpuAllowed, false, 'observed gameplay still excludes background CPU builds');
    assert.equal(coreGamingProtectionFromGovernor(state, now), true);
    for (const denial of [{ nativeProbeCustodyHeld: true }, { dependencyObservationKnown: false },
      { evictionHealthy: false }, { localModelAllowed: false }, { heavyModelAllowed: false }]) {
      const denied = projectVrGovernorExecutionPermissionsV1({ ...state, ...denial }, now);
      assert.equal(denied.heavyModelAllowed, false);
      assert.equal(denied.localCpuAllowed, false);
    }
  }
});

test('idle VR governor refreshes its verified state before consumer freshness budgets expire', () => {
  assert.match(governor, /\$idleHeartbeatDue = \$false/);
  assert.match(governor, /if \(-not \$effective\.active\)/);
  assert.match(governor, /\$idleHeartbeatDue = \(\$now\.ToUniversalTime\(\) - \$observedUtc\)\.TotalSeconds -ge 5/);
  assert.match(governor, /\$guardDue -or \$idleHeartbeatDue/);
  assert.match(governor, /Get-GamingSignal -ThrottleFlatGameScan/);
  assert.match(governor, /Start-Sleep -Milliseconds \$poll/);
});

test('idle publisher cadence leaves Core fresh through observation latency but never masks a stopped governor', () => {
  const match = governor.match(/\$idleHeartbeatDue = \(\$now\.ToUniversalTime\(\) - \$observedUtc\)\.TotalSeconds -ge (\d+)/);
  assert.ok(match, 'Read the actual publisher cadence, not a duplicate test setting');
  const intervalMs = Number(match[1]) * 1000;
  assert.ok(intervalMs >= 1000, 'Idle reconciliation must remain bounded');
  const start = Date.parse('2026-10-26T12:00:00Z');
  const normal = { schemaVersion: 'stephanos.vr-resource-governor.v1', governorVersion: 3,
    active: false, phase: 'NORMAL', flatGameActive: false, airLinkActive: false,
    realAirLinkActive: false, virtualAirLinkTestActive: false, prepareLeaseActive: false,
    nativeProbeCustodyHeld: false, dependencyObservationKnown: true,
    localModelAllowed: true, heavyModelAllowed: true, evictionHealthy: true };
  for (const observationDelayMs of [0, 2500, 5000]) {
    const period = intervalMs + observationDelayMs;
    for (let elapsed = 0; elapsed < period * 3; elapsed += 250) {
      const publishedAt = start + Math.floor(elapsed / period) * period;
      assert.equal(coreGamingProtectionFromGovernor({ ...normal,
        updatedAtUtc: new Date(publishedAt).toISOString() }, start + elapsed), false,
      `Idle evidence expired at cadence ${intervalMs}ms plus ${observationDelayMs}ms observation delay`);
    }
  }
  const stopped = { ...normal, updatedAtUtc: new Date(start).toISOString() };
  assert.equal(coreGamingProtectionFromGovernor(stopped, start + 15001), true);
  assert.equal(coreGamingProtectionFromGovernor({ ...stopped, active: true }, start), true);
});

test('gaming resource governor detects VR and flat-game sessions and parks non-lightweight Ollama models', () => {
  assert.match(governor, /'vrcompositor', 'vrdashboard'/);
  assert.match(governor, /function Test-StaleOculusDashAfterCrash/);
  assert.match(governor, /Get-Process -Name 'OculusDash'/);
  assert.match(governor, /HMD Reporting state change/);
  assert.match(governor, /current_session_type:/);
  assert.match(governor, /Groups\[2\]\.Value -eq 'streaming'/);
  assert.match(governor, /return -not \(Test-StaleOculusDashAfterCrash\)/);
  assert.match(governor, /starfield-vr-sim-air-link\.json/);
  assert.match(governor, /stephanos\.starfield-vr-sim-air-link\.v1/);
  assert.match(governor, /virtual-air-link-test-active/);
  assert.match(governor, /virtualAirLinkTestActive/);
  assert.match(governor, /ollama\.exe/);
  assert.match(governor, /Invoke-GovernorNativeProbe -Operation OllamaStop -Model \$Model/);
  assert.doesNotMatch(governor, /& \$OllamaExecutable (?:ps|stop)/);
  assert.match(governor, /\$parked = @\(\)/);
  assert.doesNotMatch(governor, /\$parked = New-Object System\.Collections\.Generic\.List\[string\]/);
  assert.match(governor, /\$lightweightModel = 'llama3\.2:3b'/);
  assert.match(governor, /Where-Object[\s\S]*?\[string\]::Equals\([\s\S]*?\[string\]\$_,[\s\S]*?\$lightweightModel,[\s\S]*?\[System\.StringComparison\]::OrdinalIgnoreCase/);
  assert.match(governor, /ReleaseGraceSeconds = 45/);
  assert.match(governor, /vr-runtime-active/);
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
  assert.match(governor, /function Get-ParentProcessInfo/);
  assert.match(governor, /Get-CimInstance Win32_Process/);
  assert.match(governor, /parentProcessId/);
  assert.match(governor, /parentProcessName/);
  assert.match(governor, /parentExecutablePath/);
  assert.match(governor, /flat-game-inactive/);
  assert.match(governor, /gaming-session-cooldown/);
  assert.match(governor, /governorVersion = 3/);
  assert.match(governor, /'NORMAL'/);
  assert.match(governor, /'PREPARING'/);
  assert.match(governor, /'GAMING'/);
  assert.match(governor, /'COOLDOWN'/);
  assert.match(governor, /PrepareGaming/);
  assert.match(governor, /CancelPrepare/);
  assert.match(governor, /SetAuto/);
  assert.match(governor, /ForceOn/);
  assert.match(governor, /ForceOff/);
  assert.match(governor, /gaming-resource-override\.json/);
  assert.match(governor, /gaming-resource-prepare\.json/);
  assert.match(governor, /gaming-resource-profiles\.json/);
  assert.match(governor, /gaming-resource-governor-events\.jsonl/);
  assert.match(governor, /nvidia-smi\.exe/);
  assert.match(governor, /memory\.free/);
  assert.match(governor, /minFreeVramMiB/);
  assert.match(governor, /vramPressure/);
  assert.match(governor, /vramReleasedMiB/);
  assert.match(governor, /lightweightOnly/);
  assert.match(governor, /parkAllModels/);
  assert.match(governor, /Normalize legacy\/custom profile shapes before StrictMode consumers/);
  assert.match(governor, /\$profile\.PSObject\.Properties\['processName'\]/);
  assert.match(governor, /\$profile\.PSObject\.Properties\['parkAllModels'\]/);
  assert.match(governor, /function Normalize-GovernorState/);
  assert.match(governor, /function Add-MissingGovernorProperty/);
  assert.match(governor, /Normalize older shapes before StrictMode reads any field/);
  assert.match(governor, /return Normalize-GovernorState -State \$state/);
  assert.match(governor, /localModelAllowed/);
  assert.match(governor, /loadedModelsBefore/);
  assert.match(governor, /loadedModelsAfter/);
  assert.match(governor, /zeroLocalModelInvariant/);
  assert.match(governor, /reappearanceDetected/);
  assert.match(governor, /reappearanceCount/);
  assert.match(governor, /\$modelsToPark = if \(\$parkAllModels\) \{ @\(\$loadedBefore\) \} else \{ @\(\$heavyBefore\) \}/);
  assert.match(governor, /\$guardIntervalSeconds = if \(\$effective\.active -and \$effective\.profile\.parkAllModels\) \{ 0\.5 \} else \{ 5 \}/);
  assert.match(governor, /PollMilliseconds = 500/);
  assert.match(governor, /function Invoke-ImmediateVrModelEviction/);
  assert.match(governor, /function Get-OllamaVrRuntimeProcesses/);
  assert.match(governor, /function Stop-OllamaRuntimeForRealVr/);
  assert.match(governor, /'llama-server\.exe','ollama\.exe','ollama app\.exe'/);
  assert.match(governor, /\$hardBlockRealVr = \[bool\]\(\$parkAllModels -and \$Signal\.realAirLinkActive\)/);
  assert.match(governor, /ollamaRuntimeHardBlocked/);
  assert.match(governor, /A synchronous 'ollama stop' can itself stall for minutes/);
  assert.match(governor, /Headset detection is the highest-priority signal/);
  assert.match(governor, /First bite: headset presence wins over every other workload/);
  assert.match(governor, /\$priorParkAllModels/);
  assert.match(governor, /An explicitly prepared VR session must not silently downgrade/);
  assert.match(governor, /\$profile = \$PriorState\.profile/);
  assert.match(governor, /\$state\.zeroLocalModelInvariant -ne \$true/);
  assert.match(governor, /cooldownSeconds/);
  assert.match(governor, /evictionHealthy/);
  assert.match(governor, /heavyModelsBefore/);
  assert.match(governor, /heavyModelsAfter/);
  assert.match(governor, /TotalMinutes -gt 30/);
  assert.match(governor, /stephanos\.gaming-resource-governor-event\.v1/);
  assert.match(governor, /stephanos\.gaming-resource-profiles\.v1/);
  assert.match(profileExample, /stephanos\.gaming-resource-profiles\.v1/);
  assert.match(profileExample, /"processName": "Starfield"/);
});


test('Qwen 3.5 canary refuses unknown governor and does not unload a model it never started', () => {
  assert.match(ollamaLoadGovernor, /qwen3\.5:27b/);
  assert.match(qwen35Canary, /vr-resource-governor-current\.json/);
  assert.match(qwen35Canary, /classifyQwen35CanaryGovernorV1/);
  assert.match(qwen35Canary, /return classifyQwen35CanaryGovernorV1\(null\)/);
  assert.match(qwen35Canary, /const beforeInference = readVrResourceGovernorBlock\(\)/);
  assert.doesNotMatch(qwen35Canary, /unloadCanaryModel|inferenceAttempted|\/api\/generate|keep_alive:\s*0/);
  const check = spawnSync(process.execPath, ['--check',
    fileURLToPath(new URL('../../scripts/qwen35-canary.mjs', import.meta.url))],
    { encoding: 'utf8', timeout: 10_000 });
  assert.equal(check.status, 0, check.stderr || 'node --check should accept the actual canary script');
});


test('Qwen canary never emits a global unload without authenticated model ownership', async () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const body = qwen35Canary.replace(/^#![^\n]*\n/, '').replace(/^import [^\n]*\n/gm, '');
  const execute = new AsyncFunction('readFileSync', 'homedir', 'resolve', 'process',
    'classifyQwen35CanaryGovernorV1', 'fetch', 'AbortController',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', body);
  const AbortStub = class { constructor() { this.signal = {}; } abort() {} };
  const governor = () => ({
    schemaVersion: 'stephanos.vr-resource-governor.v1',
    governorVersion: 3, phase: 'NORMAL', updatedAtUtc: new Date().toISOString(),
    active: false, flatGameActive: false, airLinkActive: false,
    realAirLinkActive: false, virtualAirLinkTestActive: false,
    prepareLeaseActive: false, nativeProbeCustodyHeld: false,
    dependencyObservationKnown: true, evictionHealthy: true,
    localModelAllowed: true, heavyModelAllowed: true,
  });
  for (const mode of ['stale', 'tags503', 'modelMissing', 'transportError', 'chat503', 'success']) {
    const calls = [], outputs = [];
    const state = mode === 'stale'
      ? { ...governor(), updatedAtUtc: new Date(Date.now() - 16000).toISOString() } : governor();
    const proc = { stdout: { write(text) { outputs.push(JSON.parse(text)); } }, exitCode: undefined };
    const fakeFetch = async (url, options) => {
      assert.match(url, /^http:\/\/127\.0\.0\.1:11434\/api\/(tags|chat)$/);
      const endpoint = url.endsWith('/tags') ? 'tags' : 'chat';
      calls.push(endpoint);
      if (endpoint === 'tags') return mode === 'tags503' ? { ok: false, status: 503 }
        : { ok: true, json: async () => ({ models: mode === 'modelMissing'
          ? [] : [{ name: 'qwen3.5:27b' }] }) };
      assert.equal(options.method, 'POST');
      assert.equal(JSON.parse(options.body).model, 'qwen3.5:27b');
      assert.equal(Object.hasOwn(JSON.parse(options.body), 'keep_alive'), false);
      if (mode === 'transportError') throw new Error('synthetic transport error');
      if (mode === 'chat503') return { ok: false, status: 503 };
      return { ok: true, json: async () => ({
        model: 'qwen3.5:27b', done: true, message: { content: 'QWEN35_CANARY_OK' },
      }) };
    };
    await execute(() => JSON.stringify(state), () => '/virtual',
      () => '/virtual/governor', proc, classifyQwen35CanaryGovernorV1, fakeFetch,
      AbortStub, () => 1, () => {}, () => ({ unref() {} }), () => {});
    assert.deepEqual(calls, mode === 'stale' ? []
      : ['tags', ...(['tags503', 'modelMissing'].includes(mode) ? [] : ['chat'])], mode);
    assert.equal(outputs.length, 1, mode);
    assert.equal(outputs[0].ok, mode === 'success', mode);
    assert.equal(proc.exitCode, mode === 'success' ? undefined : 2, mode);
  }
});


test('Qwen 27B canary cancels on in-flight VR transition or stale governor and never returns false GREEN', async () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const body = qwen35Canary.replace(/^#![^\n]*\n/, '').replace(/^import [^\n]*\n/gm, '');
  const run = new AsyncFunction('readFileSync', 'homedir', 'resolve', 'process',
    'classifyQwen35CanaryGovernorV1', 'fetch', 'AbortController',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', body);
  const safe = () => ({
    schemaVersion: 'stephanos.vr-resource-governor.v1',
    governorVersion: 3, phase: 'NORMAL', updatedAtUtc: new Date().toISOString(),
    active: false, flatGameActive: false, airLinkActive: false,
    realAirLinkActive: false, virtualAirLinkTestActive: false,
    prepareLeaseActive: false, nativeProbeCustodyHeld: false,
    dependencyObservationKnown: true, evictionHealthy: true,
    localModelAllowed: true, heavyModelAllowed: true,
  });
  for (const mode of ['steady', 'during-flight', 'response-parse', 'stale-flight', 'transport-rejection']) {
    let state = safe(), checkPoll, pollCleared = 0, aborted = false;
    const requests = [], outputs = [];
    const proc = { stdout: { write(text) { outputs.push(JSON.parse(text)); } },
      exitCode: undefined };
    const AbortStub = class {
      constructor() { this.signal = { aborted: false }; }
      abort() { this.signal.aborted = true; aborted = true; }
    };
    const gaming = () => {
      state = { ...safe(), active: true, phase: 'GAMING' };
    };
    const http = async (url, options) => {
      assert.match(url, /^http:\/\/127\.0\.0\.1:11434\/api\/(tags|chat)$/);
      const endpoint = url.endsWith('/tags') ? 'tags' : 'chat';
      requests.push(endpoint);
      if (endpoint === 'tags') return { ok: true, json: async () =>
        ({ models: [{ name: 'qwen3.5:27b' }] }) };
      assert.equal(options.method, 'POST');
      assert.equal(Object.hasOwn(JSON.parse(options.body), 'keep_alive'), false);
      if (mode === 'during-flight' || mode === 'transport-rejection') {
        gaming();
        checkPoll();
        if (mode === 'transport-rejection') throw new Error('cancelled HTTP request');
      }
      if (mode === 'stale-flight') {
        state = { ...safe(), updatedAtUtc: new Date(Date.now() - 16000).toISOString() };
        checkPoll();
      }
      return { ok: true, json: async () => {
        if (mode === 'response-parse') gaming();
        return { model: 'qwen3.5:27b', done: true, message: { content: 'QWEN35_CANARY_OK' } };
      } };
    };
    await run(() => JSON.stringify(state), () => '/virtual',
      () => '/virtual/governor', proc, classifyQwen35CanaryGovernorV1,
      http, AbortStub, () => 1, () => {},
      (callback) => { checkPoll = callback; return { unref() {} }; },
      () => { pollCleared += 1; });
    assert.deepEqual(requests, ['tags', 'chat'], mode);
    assert.equal(pollCleared, 1, mode);
    assert.equal(outputs.length, 1, mode);
    if (mode === 'steady') {
      assert.equal(outputs[0].ok, true, mode);
      assert.equal(proc.exitCode, undefined, mode);
      assert.equal(aborted, false, mode);
    } else {
      assert.equal(outputs[0].ok, false, mode);
      assert.equal(proc.exitCode, 2, mode);
      assert.equal(outputs[0].blocker, mode === 'stale-flight'
        ? 'QWEN35_CANARY_GOVERNOR_UNPROVEN'
        : 'QWEN35_CANARY_BLOCKED_BY_VR_RESOURCE_GOVERNOR', mode);
      assert.equal(aborted, true, mode);
    }
    assert.equal(requests.includes('generate'), false, mode);
  }
});

test('Qwen 27B canary rejects mismatched, incomplete and coerced local responses', async () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const body = qwen35Canary.replace(/^#![^\n]*\n/, '').replace(/^import [^\n]*\n/gm, '');
  const run = new AsyncFunction('readFileSync', 'homedir', 'resolve', 'process',
    'classifyQwen35CanaryGovernorV1', 'fetch', 'AbortController',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', body);
  const safe = () => ({
    schemaVersion: 'stephanos.vr-resource-governor.v1',
    governorVersion: 3, phase: 'NORMAL', updatedAtUtc: new Date().toISOString(),
    active: false, flatGameActive: false, airLinkActive: false,
    realAirLinkActive: false, virtualAirLinkTestActive: false,
    prepareLeaseActive: false, nativeProbeCustodyHeld: false,
    dependencyObservationKnown: true, evictionHealthy: true,
    localModelAllowed: true, heavyModelAllowed: true,
  });
  const good = { model: 'qwen3.5:27b', done: true,
    message: { content: 'QWEN35_CANARY_OK' } };
  const cases = [
    ['exact-identity-complete', good, true, 'QWEN35_CANARY_GREEN'],
    ['different-model', { ...good, model: 'qwen3:27b' }, false, 'QWEN35_CANARY_MODEL_IDENTITY_UNPROVEN'],
    ['model-absent', { done: true, message: good.message }, false, 'QWEN35_CANARY_MODEL_IDENTITY_UNPROVEN'],
    ['model-null', { ...good, model: null }, false, 'QWEN35_CANARY_MODEL_IDENTITY_UNPROVEN'],
    ['completion-absent', { model: good.model, message: good.message }, false, 'QWEN35_CANARY_COMPLETION_UNPROVEN'],
    ['completion-false', { ...good, done: false }, false, 'QWEN35_CANARY_COMPLETION_UNPROVEN'],
    ['completion-string', { ...good, done: 'true' }, false, 'QWEN35_CANARY_COMPLETION_UNPROVEN'],
    ['wrong-marker', { ...good, message: { content: 'WRONG' } }, false, 'QWEN35_CANARY_RESPONSE_MISMATCH'],
    ['json-array-marker', { ...good, message: { content: ['QWEN35_CANARY_OK'] } }, false, 'QWEN35_CANARY_RESPONSE_MISMATCH'],
    ['json-nested-array', { ...good, message: { content: [['QWEN35_CANARY_OK']] } }, false, 'QWEN35_CANARY_RESPONSE_MISMATCH'],
    ['json-empty-prefix', { ...good, message: { content: ['', 'QWEN35_CANARY_OK'] } }, false, 'QWEN35_CANARY_RESPONSE_MISMATCH'],
    ['json-null', { ...good, message: { content: null } }, false, 'QWEN35_CANARY_RESPONSE_MISMATCH'],
    ['json-number', { ...good, message: { content: 0 } }, false, 'QWEN35_CANARY_RESPONSE_MISMATCH'],
    ['whitespace', { ...good, message: { content: '  QWEN35_CANARY_OK  ' } }, true, 'QWEN35_CANARY_GREEN'],
  ];
  for (const [name, reply, expected, verdict] of cases) {
    const outputs = [], calls = [];
    const proc = { stdout: { write(s) { outputs.push(JSON.parse(s)); } }, exitCode: undefined };
    const fetchStub = async (url) => {
      const path = url.endsWith('/tags') ? 'tags' : 'chat';
      calls.push(path);
      return path === 'tags' ? { ok: true, json: async () => ({ models: [{ name: 'qwen3.5:27b' }] }) }
        : { ok: true, json: async () => JSON.parse(JSON.stringify(reply)) };
    };
    const AbortStub = class { constructor() { this.signal = {}; } abort() {} };
    await run(() => JSON.stringify(safe()), () => '/virtual', () => '/virtual/governor',
      proc, classifyQwen35CanaryGovernorV1, fetchStub, AbortStub,
      () => 1, () => {}, () => ({ unref() {} }), () => {});
    assert.deepEqual(calls, ['tags', 'chat'], name);
    assert.equal(outputs.length, 1, name);
    assert.equal(outputs[0].ok, expected, name);
    assert.equal(outputs[0].finalVerdict, verdict, name);
    assert.equal(outputs[0].completionProven, reply.done === true, name);
    assert.equal(outputs[0].requestedModel, 'qwen3.5:27b', name);
    assert.equal(proc.exitCode, expected ? undefined : 3, name);
  }
});

test('Qwen canary enforces the shared governor effective heavy grant and native-custody denial', () => {
  const state = { schemaVersion: 'stephanos.vr-resource-governor.v1', governorVersion: 3,
    phase: 'NORMAL', updatedAtUtc: new Date().toISOString(),
    active: false, flatGameActive: false, airLinkActive: false,
    realAirLinkActive: false, virtualAirLinkTestActive: false, prepareLeaseActive: false,
    localModelAllowed: true, heavyModelAllowed: true, nativeProbeCustodyHeld: false,
    dependencyObservationKnown: true, evictionHealthy: true };
  assert.equal(classifyQwen35CanaryGovernorV1(state).blocked, false);
  for (const override of [
    { nativeProbeCustodyHeld: true },
    { dependencyObservationKnown: false },
    { evictionHealthy: false },
  ]) {
    const check = classifyQwen35CanaryGovernorV1({ ...state, ...override });
    assert.equal(check.blocked, true);
    assert.equal(check.blocker, 'QWEN35_CANARY_BLOCKED_BY_VR_RESOURCE_GOVERNOR');
    assert.equal(check.modelStarted, false);
    assert.equal(check.sourceMutationAllowed, false);
    assert.equal(check.pcRestartAllowed, false);
  }
});

test('Qwen 27B canary admission is fail closed on every missing, corrupt or denied VR record', () => {
  const nowMs = Date.parse('2026-11-11T05:20:00.000Z');
  const allowed = { schemaVersion: 'stephanos.vr-resource-governor.v1',
    governorVersion: 3, phase: 'NORMAL',
    updatedAtUtc: new Date(nowMs).toISOString(),
    active: false, flatGameActive: false, airLinkActive: false,
    realAirLinkActive: false, virtualAirLinkTestActive: false,
    prepareLeaseActive: false, nativeProbeCustodyHeld: false,
    dependencyObservationKnown: true, evictionHealthy: true,
    localModelAllowed: true, heavyModelAllowed: true };
  const denied = [
    [null, 'QWEN35_CANARY_GOVERNOR_UNPROVEN'],
    [{}, 'QWEN35_CANARY_GOVERNOR_UNPROVEN'],
    [[], 'QWEN35_CANARY_GOVERNOR_UNPROVEN'],
    [{ ...allowed, schemaVersion: 'other' }, 'QWEN35_CANARY_GOVERNOR_UNPROVEN'],
    [{ ...allowed, active: 'false' }, 'QWEN35_CANARY_GOVERNOR_UNPROVEN'],
    [{ ...allowed, heavyModelAllowed: undefined }, 'QWEN35_CANARY_GOVERNOR_UNPROVEN'],
    [{ ...allowed, nativeProbeCustodyHeld: undefined }, 'QWEN35_CANARY_GOVERNOR_UNPROVEN'],
    [{ ...allowed, dependencyObservationKnown: undefined }, 'QWEN35_CANARY_GOVERNOR_UNPROVEN'],
    [{ ...allowed, evictionHealthy: undefined }, 'QWEN35_CANARY_GOVERNOR_UNPROVEN'],
    [{ ...allowed, localModelAllowed: undefined }, 'QWEN35_CANARY_GOVERNOR_UNPROVEN'],
    [{ ...allowed, updatedAtUtc: 'bad-date' }, 'QWEN35_CANARY_GOVERNOR_UNPROVEN'],
    [{ ...allowed, updatedAtUtc: new Date(nowMs - 15_001).toISOString() }, 'QWEN35_CANARY_GOVERNOR_UNPROVEN'],
    [{ ...allowed, updatedAtUtc: new Date(nowMs + 1).toISOString() }, 'QWEN35_CANARY_GOVERNOR_UNPROVEN'],
    [{ ...allowed, governorVersion: undefined }, 'QWEN35_CANARY_GOVERNOR_UNPROVEN'],
    [{ ...allowed, governorVersion: '3' }, 'QWEN35_CANARY_GOVERNOR_UNPROVEN'],
    [{ ...allowed, phase: undefined }, 'QWEN35_CANARY_GOVERNOR_UNPROVEN'],
    [{ ...allowed, flatGameActive: undefined }, 'QWEN35_CANARY_GOVERNOR_UNPROVEN'],
    [{ ...allowed, phase: 'PREPARING' }, 'QWEN35_CANARY_BLOCKED_BY_VR_RESOURCE_GOVERNOR'],
    [{ ...allowed, flatGameActive: true }, 'QWEN35_CANARY_BLOCKED_BY_VR_RESOURCE_GOVERNOR'],
    [{ ...allowed, airLinkActive: true }, 'QWEN35_CANARY_BLOCKED_BY_VR_RESOURCE_GOVERNOR'],
    [{ ...allowed, realAirLinkActive: true }, 'QWEN35_CANARY_BLOCKED_BY_VR_RESOURCE_GOVERNOR'],
    [{ ...allowed, virtualAirLinkTestActive: true }, 'QWEN35_CANARY_BLOCKED_BY_VR_RESOURCE_GOVERNOR'],
    [{ ...allowed, prepareLeaseActive: true }, 'QWEN35_CANARY_BLOCKED_BY_VR_RESOURCE_GOVERNOR'],
    [{ ...allowed, active: true, heavyModelAllowed: false }, 'QWEN35_CANARY_BLOCKED_BY_VR_RESOURCE_GOVERNOR'],
    [{ ...allowed, active: true, localModelAllowed: false }, 'QWEN35_CANARY_BLOCKED_BY_VR_RESOURCE_GOVERNOR'],
    [{ ...allowed, nativeProbeCustodyHeld: true }, 'QWEN35_CANARY_BLOCKED_BY_VR_RESOURCE_GOVERNOR'],
    [{ ...allowed, dependencyObservationKnown: false }, 'QWEN35_CANARY_BLOCKED_BY_VR_RESOURCE_GOVERNOR'],
    [{ ...allowed, evictionHealthy: false }, 'QWEN35_CANARY_BLOCKED_BY_VR_RESOURCE_GOVERNOR'],
    [{ ...allowed, heavyModelAllowed: false }, 'QWEN35_CANARY_BLOCKED_BY_VR_RESOURCE_GOVERNOR'],
    [{ ...allowed, localModelAllowed: false }, 'QWEN35_CANARY_BLOCKED_BY_VR_RESOURCE_GOVERNOR'],
  ];
  for (const [raw, blocker] of denied) {
    const status = classifyQwen35CanaryGovernorV1(raw, nowMs);
    assert.equal(status.blocked, true);
    assert.equal(status.blocker, blocker);
    assert.equal(status.modelStarted, false);
    assert.equal(status.pcRestartAllowed, false);
    assert.equal(status.sourceMutationAllowed, false);
    assert.deepEqual(Object.keys(status).sort(),
      ['blocker','blocked','modelStarted','pcRestartAllowed','schemaVersion','sourceMutationAllowed'].sort());
  }
  for (const value of [allowed, { ...allowed, updatedAtUtc: new Date(nowMs - 15_000).toISOString() }]) {
    const status = classifyQwen35CanaryGovernorV1(value, nowMs);
    assert.equal(status.blocked, false);
    assert.equal(status.modelStarted, false, 'approval only permits later canary execution');
  }
  const expired = classifyQwen35CanaryGovernorV1({
    ...allowed, updatedAtUtc: new Date(nowMs - 15_001).toISOString(),
  }, nowMs);
  assert.equal(expired.blocked, true);
  const future = classifyQwen35CanaryGovernorV1({
    ...allowed, updatedAtUtc: new Date(nowMs + 1).toISOString(),
  }, nowMs);
  assert.equal(future.blocked, true);
});



test('Qwen 27B canary never opens a gaming interval the protected Core blocks', () => {
  const nowMs = Date.parse('2026-11-11T05:20:00.000Z');
  const normal = {
    schemaVersion: 'stephanos.vr-resource-governor.v1', governorVersion: 3,
    phase: 'NORMAL', updatedAtUtc: new Date(nowMs).toISOString(),
    active: false, flatGameActive: false, airLinkActive: false,
    realAirLinkActive: false, virtualAirLinkTestActive: false,
    prepareLeaseActive: false, nativeProbeCustodyHeld: false,
    dependencyObservationKnown: true, evictionHealthy: true,
    localModelAllowed: true, heavyModelAllowed: true,
  };
  const cases = [
    ['fresh and clear', normal],
    ['15-second boundary', { ...normal, updatedAtUtc: new Date(nowMs - 15_000).toISOString() }],
    ['stale 16 seconds', { ...normal, updatedAtUtc: new Date(nowMs - 16_000).toISOString() }],
    ['stale 60 seconds', { ...normal, updatedAtUtc: new Date(nowMs - 60_000).toISOString() }],
    ['stale 180 seconds', { ...normal, updatedAtUtc: new Date(nowMs - 180_000).toISOString() }],
    ['future 1 ms', { ...normal, updatedAtUtc: new Date(nowMs + 1).toISOString() }],
    ['missing version', { ...normal, governorVersion: undefined }],
    ['wrong version', { ...normal, governorVersion: 2 }],
    ['phase preparing', { ...normal, phase: 'PREPARING' }],
    ['flat game active', { ...normal, flatGameActive: true }],
    ['air link active', { ...normal, airLinkActive: true }],
    ['real air link active', { ...normal, realAirLinkActive: true }],
    ['virtual air link active', { ...normal, virtualAirLinkTestActive: true }],
    ['prepare lease active', { ...normal, prepareLeaseActive: true }],
    ['local model denied', { ...normal, localModelAllowed: false }],
    ['heavy model denied', { ...normal, heavyModelAllowed: false }],
  ];
  for (const [name, record] of cases) {
    const coreBlocks = coreGamingProtectionFromGovernor(record, nowMs);
    const decision = classifyQwen35CanaryGovernorV1(record, nowMs);
    assert.equal(decision.blocked, coreBlocks
      || record.localModelAllowed !== true || record.heavyModelAllowed !== true, name);
    assert.equal(decision.modelStarted, false, name);
    assert.equal(decision.sourceMutationAllowed, false, name);
    assert.equal(decision.pcRestartAllowed, false, name);
  }
});

test('Stephanos router honours the gaming governor heavy-model policy', () => {
  assert.match(provider, /function readVrResourceGovernorState\(\)/);
  assert.match(provider, /projectVrGovernorExecutionPermissionsV1\(parsed\)/);
  assert.match(provider, /heavyModelAllowed = permission\.heavyModelAllowed/);
  assert.match(provider, /protectHeavy: !heavyModelAllowed/);
  assert.match(provider, /if \(vrResourceGovernor\.protectHeavy\)/);
  assert.match(provider, /ollamaLoadMode: 'cool'/);
  assert.match(provider, /forceHeavyModel: false/);
  assert.match(provider, /OLLAMA_MODEL_POLICY\.lightweight/);
  assert.match(provider, /localModelAllowed = permission\.localModelAllowed/);
  assert.match(provider, /if \(vrResourceGovernor\.localModelAllowed === false\)/);
  assert.doesNotMatch(provider, /vrResourceGovernor\.active && vrResourceGovernor\.(?:protectHeavy|localModelAllowed)/);
  assert.match(provider, /Local Ollama inference is paused by the resource governor\./);
  assert.match(provider, /loadMode: 'off'/);
});

test('Sovereign Commander owns and self-heals the hidden VR resource governor', () => {
  assert.match(runner, /run-vr-resource-governor\.ps1/);
  assert.match(runner, /Get-VrResourceGovernorProcesses/);
  assert.match(runner, /'-Action', 'Watch'/);
  assert.match(runner, /-WindowStyle Hidden/);
  assert.match(runner, /vrResourceGovernorHealthy/);
  assert.match(runner, /VR protection is intentionally independent of daemon health/);
  assert.match(runner, /function Test-VrResourceGovernorProcessCurrent/);
  assert.match(runner, /vrGovernorRestartRequested/);
  assert.match(runner, /SOVEREIGN_COMMANDER_VR_RESOURCE_GOVERNOR_STALE_RECYCLE_FAILED/);
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

test('Sovereign Commander exposes bounded gaming resource controls and acceptance', () => {
  for (const action of [
    'gaming-resource-status',
    'gaming-resource-prepare',
    'starfield-vr-resource-preflight',
    'gaming-resource-cancel-prepare',
    'gaming-resource-auto',
    'gaming-resource-force-on',
    'gaming-resource-force-off',
    'gaming-resource-acceptance',
  ]) {
    assert.ok(SOVEREIGN_COMMANDER_REMOTE_ACTIONS.includes(action), action);
    assert.ok(commander.includes(`'${action}': frozen({`), action);
    assert.ok(mcp.includes(`'${action}'`), action);
  }

  assert.match(commander, /run-gaming-resource-acceptance\.ps1/);
  assert.match(commander, /'starfield-vr-resource-preflight': frozen\(\{/);
  assert.match(commander, /'-Action', 'PrepareGaming',[\s\S]*?'-ProcessName', 'Starfield',[\s\S]*?'-ProfileName', 'vr-maximum'/);
  assert.match(commander, /'gaming-resource-cancel-prepare': frozen\(\{[\s\S]*?'-Action', 'CancelPrepare'/);
  assert.match(mcp, /'starfield-vr-resource-preflight'/);
  assert.match(mcp, /'gaming-resource-cancel-prepare'/);
  assert.match(remoteMailbox, /STARFIELD_VR_RESOURCE_PREFLIGHT_STRICTMODE_PROPERTY/);
  assert.match(remoteMailbox, /SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_PREFLIGHT_COMPLETE/);
  assert.match(gamingAcceptance, /stephanos\.gaming-resource-acceptance\.v1/);
  assert.match(gamingAcceptance, /PrepareGaming/);
  assert.match(gamingAcceptance, /ForceOn/);
  assert.match(gamingAcceptance, /ForceOff/);
  assert.match(gamingAcceptance, /SetAuto/);
  assert.match(gamingAcceptance, /telemetryObserved/);
  assert.match(gamingAcceptance, /realGameLaunchUsed = \$false/);
  assert.match(gamingAcceptance, /realHeadsetProofClaimed = \$false/);
  assert.match(gamingAcceptance, /arbitraryProcessKillAllowed = \$false/);
  assert.match(gamingAcceptance, /SOVEREIGN_COMMANDER_GAMING_RESOURCE_ACCEPTANCE_PASSED/);
});

test('Starfield VR telemetry is richer and Sovereign Commander can diagnose the latest playtest', () => {
  assert.match(starfieldPerformance, /gpuEncoderUtilPct/);
  assert.match(starfieldPerformance, /gpuDecoderUtilPct/);
  assert.match(starfieldPerformance, /gpuMemoryPct/);
  assert.match(starfieldPerformance, /starfieldCpuPct/);
  assert.match(starfieldPerformance, /systemCpuPct/);
  assert.match(starfieldPerformance, /metaVrProcessCount/);
  assert.match(starfieldPerformance, /metaVrWorkingSetMiB/);
  assert.match(starfieldPerformance, /airLinkRuntimeActive/);
  assert.match(starfieldPerformance, /ollamaRestoreDeferred/);
  assert.match(starfieldPerformance, /A Starfield exit does not necessarily mean VR has ended/);
  assert.match(starfieldPerformance, /\$ollamaRestoreDeferred = \[bool\]\$gamingResourceReconcile\.active/);
  assert.match(starfieldPerformance, /avgGpuUtilPct/);
  assert.match(starfieldPerformance, /avgStarfieldCpuPct/);
  assert.match(starfieldPerformance, /airLinkRuntimeSamplePct/);
  assert.match(starfieldPerformance, /frameTimeTelemetryAvailable = \[bool\]\(\$applicationFrameTimeSamples\.Count -gt 0\)/);
  assert.match(starfieldPerformance, /Get-StarfieldVrRuntimeMetricSample/);
  assert.match(starfieldPerformance, /telemetryCompleteness/);

  assert.ok(SOVEREIGN_COMMANDER_REMOTE_ACTIONS.includes('starfield-vr-performance-diagnosis'));
  assert.match(commander, /'starfield-vr-performance-diagnosis': frozen\(\{/);
  assert.match(commander, /read-starfield-vr-performance-diagnosis\.ps1/);
  assert.match(mcp, /'starfield-vr-performance-diagnosis'/);

  assert.match(starfieldDiagnosis, /stephanos\.starfield-vr-performance-diagnosis\.v1/);
  assert.match(starfieldDiagnosis, /STARFIELD_VR_PERFORMANCE_DIAGNOSIS_READY/);
  assert.match(starfieldDiagnosis, /ollama-contention-observed/);
  assert.match(starfieldDiagnosis, /vram-pressure-high/);
  assert.match(starfieldDiagnosis, /gpu-saturation-high/);
  assert.match(starfieldDiagnosis, /frame-time-source-not-yet-captured/);
  assert.match(starfieldDiagnosis, /starfield-vr-provider-slot-current\.json/);
  assert.match(starfieldDiagnosis, /starfield-vr-launch-current\.json/);
  assert.match(starfieldDiagnosis, /vr-resource-governor-current\.json/);
  assert.match(starfieldDiagnosis, /vr-mode-state-current\.json/);
  assert.match(starfieldDiagnosis, /vr-prelaunch-error-observed/);
  assert.match(starfieldDiagnosis, /'LAUNCH_FAILURE'/);
  assert.match(starfieldDiagnosis, /vrModeStatus/);
  assert.match(starfieldDiagnosis, /vrModeTrafficLight/);
  assert.match(starfieldDiagnosis, /vrModeError/);
  assert.match(starfieldDiagnosis, /localModelAllowed/);
  assert.match(starfieldDiagnosis, /loadedModelsAfter/);
  assert.match(starfieldDiagnosis, /elseif \(\$signals\.Contains\('vram-pressure-high'\)\)[\s\S]*?'VRAM_PRESSURE'[\s\S]*?elseif \(\$signals\.Contains\('ollama-contention-observed'\)\)/);
  assert.match(starfieldDiagnosis, /readOnly = \$true/);
  assert.match(starfieldDiagnosis, /arbitraryShellAllowed = \$false/);
  assert.match(starfieldDiagnosis, /mutationAuthority = \$false/);
});

test('Sovereign Commander can report Starfield VR telemetry into the shared workspace', () => {
  assert.ok(SOVEREIGN_COMMANDER_REMOTE_ACTIONS.includes('report-starfield-vr-telemetry'));
  assert.ok(SOVEREIGN_COMMANDER_REMOTE_ACTIONS.includes('starfield-vr-telemetry-refresh'));
  assert.match(commander, /'report-starfield-vr-telemetry': frozen\(\{/);
  assert.match(commander, /'starfield-vr-telemetry-refresh': frozen\(\{/);
  assert.match(commander, /report-starfield-vr-telemetry\.mjs/);
  assert.match(mcp, /'report-starfield-vr-telemetry'/);
  assert.match(mcp, /'starfield-vr-telemetry-refresh'/);

  assert.match(starfieldTelemetryReport, /stephanos\.starfield-vr-telemetry-report\.v1/);
  assert.match(starfieldTelemetryReport, /read-starfield-vr-performance-diagnosis\.ps1/);
  assert.match(starfieldTelemetryReport, /starfield-vr-performance-.*\\\.csv/);
  assert.match(starfieldTelemetryReport, /vr-mode-state-current\.json/);
  assert.match(starfieldTelemetryReport, /vr-resource-governor-current\.json/);
  assert.match(starfieldTelemetryReport, /starfield-vr-provider-slot-current\.json/);
  assert.match(starfieldTelemetryReport, /starfield-vr-launch-current\.json/);
  assert.match(starfieldTelemetryReport, /segments: \['vr', 'performance', 'current\.json'\]/);
  assert.match(starfieldTelemetryReport, /segments: \['vr', 'performance', 'history-index\.json'\]/);
  assert.match(starfieldTelemetryReport, /stephanos\.starfield-vr-telemetry-history-index\.v1/);
  assert.match(starfieldTelemetryReport, /rawTelemetryAlreadyCanonicalInSharedWorkspace: true/);
  assert.match(starfieldTelemetryReport, /starfield-vr-performance-current\.json/);
  assert.match(starfieldTelemetryReport, /workspace:vr\/performance\/current\.json/);
  assert.match(starfieldTelemetryReport, /workspace:vr\/performance\/history-index\.json/);
  assert.match(starfieldTelemetryReport, /writesSharedWorkspaceTelemetryPacket: true/);
  assert.match(starfieldTelemetryReport, /arbitraryShellAllowed: false/);
  assert.match(starfieldTelemetryReport, /mergeAuthority: false/);
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
  assert.doesNotMatch(virtualAcceptance, /governorState = \$governorStateDuringTest/);
  assert.match(virtualAcceptance, /launchAllowed = \$false/);
  assert.match(virtualAcceptance, /realHeadsetProofClaimed = \$false/);
  assert.match(virtualAcceptance, /localModelAllowed -ne \$false/);
  assert.match(virtualAcceptance, /loadedModelsAfter/);
  assert.match(virtualAcceptance, /loadedModelSamplesDuringGuard/);
  assert.match(virtualAcceptance, /VR_ACCEPTANCE_LOCAL_MODEL_RESPAWNED/);
  assert.match(virtualAcceptance, /arbitraryShellAllowed = \$false/);
  assert.match(virtualAcceptance, /pcRestartAllowed = \$false/);
  assert.match(virtualAcceptance, /SOVEREIGN_COMMANDER_VIRTUAL_AIR_LINK_ACCEPTANCE_PASSED/);
});


test('Gaming Resource Guard exposes only bounded trusted UI controls', () => {
  assert.match(gamingService, /MODE_ACTIONS = Object\.freeze\(\{[\s\S]*AUTO: 'SetAuto'[\s\S]*FORCE_ON: 'ForceOn'[\s\S]*FORCE_OFF: 'ForceOff'/);
  assert.match(gamingService, /run-vr-resource-governor\.ps1/);
  assert.match(gamingService, /run-gaming-resource-acceptance\.ps1/);
  assert.match(gamingService, /shell: false/);
  assert.match(gamingService, /windowsHide: true/);
  assert.doesNotMatch(gamingService, /Invoke-Expression|cmd\.exe|powershell\s+-Command/i);
  assert.match(gamingRoute, /isAllowedPrivateFrontendOrigin/);
  assert.match(gamingRoute, /isAllowedTailscaleFrontendOrigin/);
  assert.match(gamingRoute, /GAMING_RESOURCE_TRUSTED_FRONTEND_REQUIRED/);
  assert.match(gamingRoute, /GAMING_RESOURCE_MODE_NOT_ALLOWED/);
  assert.match(gamingRoute, /router\.get\('\/state'/);
  assert.match(gamingRoute, /router\.post\('\/mode'/);
  assert.match(gamingRoute, /router\.post\('\/acceptance'/);
  assert.doesNotMatch(gamingRoute, /req\.body\?\.(?:command|path|processName|args)/);
  assert.match(server, /app\.use\('\/api\/gaming-resource', gamingResourceRouter\)/);

  assert.match(aiClient, /getGamingResourceState/);
  assert.match(aiClient, /setGamingResourceMode/);
  assert.match(aiClient, /runGamingResourceAcceptance/);
  assert.match(gamingTile, /title="Gaming Resource Guard"/);
  assert.match(gamingTile, />AUTO<\/button>/);
  assert.match(gamingTile, />FORCE ON<\/button>/);
  assert.match(gamingTile, />FORCE OFF<\/button>/);
  assert.match(gamingTile, />Run self-test<\/button>/);
  assert.match(app, /id: 'gamingResourcePanel'/);
  assert.match(app, /<GamingResourceTile uiLayout=\{safeUiLayout\} togglePanel=\{togglePanel\}/);
});


test('VR Watch throttles heavyweight desktop scans without slowing VR headset protection', () => {
  assert.match(governor, /param\(\[switch\]\$ThrottleFlatGameScan\)/);
  assert.match(governor, /\$script:flatGameScanIntervalSeconds = 3/);
  assert.match(governor, /\$script:cachedFlatGameSignal = Get-FlatGameSignal/);
  assert.match(governor, /\$signal = Get-GamingSignal -ThrottleFlatGameScan/);
  assert.match(governor, /if \(\$airLink\.active\) \{[\s\S]{0,170}cachedFlatGameSignal = \$null/);
  assert.match(governor, /\[void\]\(Invoke-ImmediateVrModelEviction\)[\s\S]{0,500}\$signal = Get-GamingSignal -ThrottleFlatGameScan/);
  assert.match(governor, /\$flatGame = Get-FlatGameSignal[\s\S]{0,170}\$flatGame\.active/);
});

// Execute the unchanged full script, including its real parameter block and
// ObserveAdmission dispatch. Constant aliases precede functions in PowerShell
// command resolution, so production helper definitions cannot replace these
// inert mutation guards. No host process/model/registry action is reachable.
const GOVERNOR_OBSERVATION_FIXTURE_WRAPPER = String.raw`$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
$ProgressPreference='SilentlyContinue'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Import-Module 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop
Import-Module 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1' -ErrorAction Stop
function Deny-GovernorFixtureMutation {
    [Console]::Error.WriteLine('GOVERNOR_FIXTURE_MUTATION_FORBIDDEN')
    exit 97
}
function Get-Process {
    [CmdletBinding()]param([string[]]$Name,[int[]]$Id)
    [Console]::Error.WriteLine('GOVERNOR_FIXTURE_PROCESS_READ')
    if($PSBoundParameters.ContainsKey('Id')) { Deny-GovernorFixtureMutation }
    $mode=$env:STEPHANOS_OBSERVE_FIXTURE_SIGNAL
    if($mode -ceq 'NONE') { return }
    $processName=if($mode -ceq 'VR'){'vrcompositor'}elseif($mode -ceq 'FLAT'){'Starfield'}else{Deny-GovernorFixtureMutation}
    if($PSBoundParameters.ContainsKey('Name') -and $Name -notcontains $processName) { return }
    [pscustomobject]@{ProcessName=$processName;Id=424242;Path='C:\fixture\Starfield.exe';MainWindowHandle=1}
}
function Get-CimInstance {
    [CmdletBinding()]param([string]$ClassName,[string]$Filter)
    if($ClassName -cne 'Win32_Process' -or $Filter -cne 'ProcessId=424242') { Deny-GovernorFixtureMutation }
    [Console]::Error.WriteLine('GOVERNOR_FIXTURE_PARENT_READ')
    [pscustomobject]@{ParentProcessId=0}
}
foreach($name in @(
    'Ensure-StateRoot','Write-OverrideMode','Write-PrepareLease','Clear-PrepareLease','Read-PrepareLease',
    'Resolve-EffectiveState','Read-GovernorState','Resolve-OllamaExecutable','Get-GpuSnapshot',
    'Get-LoadedOllamaModels','Get-OllamaVrRuntimeProcesses','Stop-OllamaModel',
    'Stop-OllamaRuntimeForRealVr','Invoke-ImmediateVrModelEviction','Append-TelemetryEvent',
    'Write-GovernorState','Invoke-Reconcile','Invoke-CurrentReconcile',
    'Stop-Process','Start-Process','Remove-Item','New-Item','Set-Content','Add-Content','Out-File',
    'Set-Item','Copy-Item','Move-Item','Clear-Content','Get-Command','Get-ChildItem',
    'Set-ItemProperty','New-ItemProperty','Remove-ItemProperty','Invoke-Expression','Add-Type',
    'Invoke-RestMethod','Invoke-WebRequest','Start-Sleep','Register-ScheduledTask','Start-ScheduledTask',
    'ollama','ollama.exe','nvidia-smi','nvidia-smi.exe','taskkill','taskkill.exe',
    'powershell','powershell.exe','pwsh','pwsh.exe','cmd','cmd.exe','reg','reg.exe','schtasks','schtasks.exe'
)) {
    Set-Alias -Name $name -Value Deny-GovernorFixtureMutation -Option Constant -Scope Global
    $guard=Get-Alias -Name $name
    if($guard.Definition -cne 'Deny-GovernorFixtureMutation' -or
       (($guard.Options -band [System.Management.Automation.ScopedItemOptions]::Constant) -eq 0)) {
        Deny-GovernorFixtureMutation
    }
}
$source=[Console]::In.ReadToEnd()
$hash=[Security.Cryptography.SHA256]::Create()
try{$digest=([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($source)))).Replace('-','').ToLowerInvariant()}
finally{$hash.Dispose()}
[Console]::Error.WriteLine('GOVERNOR_FIXTURE_SOURCE_SHA256='+$digest)
& ([ScriptBlock]::Create($source)) -Action ObserveAdmission`;

async function governorFixtureTree(root) {
  const rows = [];
  async function visit(path, relative) {
    let stat;
    try { stat = await lstat(path); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    assert.equal(stat.isSymbolicLink(), false);
    if (stat.isDirectory()) {
      rows.push({ path: relative, kind: 'directory', mtimeMs: stat.mtimeMs });
      for (const child of (await readdir(path)).sort()) await visit(join(path, child), relative ? relative + '/' + child : child);
    } else {
      assert.equal(stat.isFile(), true);
      rows.push({ path: relative, kind: 'file', mtimeMs: stat.mtimeMs,
        bytes: (await readFile(path)).toString('base64') });
    }
  }
  await visit(root, '');
  return rows;
}

for (const scenario of [
  { name: 'fresh flat game with absent state and retained expired preparation', signal: 'FLAT',
    mode: 'FORCE_OFF', prepare: true, state: false, workspace: true },
  { name: 'fresh idle signals despite stale recorded activity', signal: 'NONE',
    mode: 'FORCE_ON', prepare: false, state: true, workspace: true },
  { name: 'fresh VR signals with unchanged preparation and persisted state', signal: 'VR',
    mode: 'AUTO', prepare: true, state: true, workspace: true },
  { name: 'absent workspace stays absent during idle observation', signal: 'NONE',
    mode: null, prepare: false, state: false, workspace: false },
]) {
  test('Windows actual ObserveAdmission: ' + scenario.name, {
    skip: process.platform !== 'win32', timeout: 20000,
  }, async t => {
    const profile = await mkdtemp(join(tmpdir(), 'stephanos-governor-observation-'));
    t.after(() => rm(profile, { recursive: true, force: true }));
    const workspace = join(profile, 'Documents', 'Stephanos-openclaw-workspace');
    const stateRoot = join(workspace, 'vr');
    const localAppData = join(profile, 'AppData', 'Local');
    const appData = join(profile, 'AppData', 'Roaming');
    const temp = join(profile, 'Temp');
    await Promise.all([mkdir(localAppData, { recursive: true }), mkdir(appData, { recursive: true }),
      mkdir(temp, { recursive: true })]);
    if (scenario.workspace) {
      await mkdir(stateRoot, { recursive: true });
      await writeFile(join(stateRoot, 'gaming-resource-governor-events.jsonl'), '{"fixture":"retained-event"}\n');
      await writeFile(join(stateRoot, 'gaming-resource-profiles.json'), '{"fixture":"retained-profile"}\n');
      await writeFile(join(stateRoot, 'gaming-resource-override.json'), JSON.stringify({
        schemaVersion: 'stephanos.gaming-resource-override.v1', mode: scenario.mode,
        updatedAtUtc: '2000-01-01T00:00:00.000Z',
      }) + '\n');
    }
    if (scenario.prepare) await writeFile(join(stateRoot, 'gaming-resource-prepare.json'), JSON.stringify({
      schemaVersion: 'stephanos.gaming-resource-prepare.v1', active: true, processName: 'FixtureGame',
      profileName: 'generic-safe', expiresAtUtc: '2000-01-01T00:00:00.000Z',
      fixtureEvidence: 'expired-owner-evidence-must-remain-exact',
    }) + '\n');
    if (scenario.state) await writeFile(join(stateRoot, 'vr-resource-governor-current.json'), JSON.stringify({
      schemaVersion: 'stephanos.vr-resource-governor.v1', governorVersion: 3,
      active: scenario.signal === 'NONE', updatedAtUtc: '2000-01-01T00:00:00.000Z',
      fixtureEvidence: 'historical-state-must-never-be-refreshed-by-observation',
    }) + '\n');
    const before = await governorFixtureTree(workspace);
    const encoded = Buffer.from(GOVERNOR_OBSERVATION_FIXTURE_WRAPPER, 'utf16le').toString('base64');
    assert.ok(encoded.length < 28000, 'Only the small fixture wrapper belongs on the Windows command line');
    const startedAt = Date.now();
    const observed = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
        input: governor, encoding: 'utf8', shell: false, windowsHide: true, cwd: profile,
        timeout: 12000, maxBuffer: 16384,
        env: {
          SystemRoot: process.env.SystemRoot || 'C:\\Windows', WINDIR: process.env.WINDIR || 'C:\\Windows',
          USERPROFILE: profile, LOCALAPPDATA: localAppData, APPDATA: appData, TEMP: temp, TMP: temp,
          PATH: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0;C:\\Windows\\System32',
          STEPHANOS_OBSERVE_FIXTURE_SIGNAL: scenario.signal,
          STEPHANOS_GAME_PROCESS_NAMES: '', STEPHANOS_GAME_LIBRARY_ROOTS: '',
        },
      });
    const completedAt = Date.now();
    assert.ifError(observed.error);
    assert.equal(observed.signal, null);
    assert.equal(observed.status, 0, observed.stderr);
    const stderr = observed.stderr.trim().split(/\r?\n/).filter(Boolean);
    assert.ok(stderr.includes('GOVERNOR_FIXTURE_PROCESS_READ'), 'The real signal detector must read the inert process inventory');
    assert.ok(stderr.every(line => /^GOVERNOR_FIXTURE_(?:PROCESS_READ|PARENT_READ|SOURCE_SHA256=[a-f0-9]{64})$/.test(line)),
      'Only fixed fixture observations may reach stderr: ' + observed.stderr);
    assert.equal(stderr.filter(line => line.startsWith('GOVERNOR_FIXTURE_SOURCE_SHA256=')).length, 1);
    assert.ok(stderr.includes('GOVERNOR_FIXTURE_SOURCE_SHA256=' + createHash('sha256').update(governor).digest('hex')),
      'PowerShell must execute the captured original bytes, including their actual parameter block');
    assert.equal(stderr.includes('GOVERNOR_FIXTURE_PARENT_READ'), scenario.signal === 'FLAT');
    const result = JSON.parse(observed.stdout);
    assert.deepEqual(Object.keys(result).sort(),
      ['observedAtUtc', 'overrideMode', 'preparePending', 'readOnly', 'schemaVersion', 'signalActive']);
    assert.equal(result.schemaVersion, 'stephanos.gaming-resource-admission-observation.v1');
    assert.equal(result.signalActive, scenario.signal !== 'NONE');
    assert.equal(result.overrideMode, scenario.mode || 'AUTO');
    assert.equal(result.preparePending, scenario.prepare);
    assert.equal(result.readOnly, true);
    assert.ok(Date.parse(result.observedAtUtc) >= startedAt && Date.parse(result.observedAtUtc) <= completedAt);
    assert.deepEqual(await governorFixtureTree(workspace), before,
      'Observation must not create state, refresh timestamps, clear preparation, or write telemetry');
  });
}
