import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runApprovedBackend8787Start } from './battle-bridge-ignition-supervisor.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from '../shared/agents/battleBridgeWindowsHosts.mjs';

function captureBackendStart(workspace, platform) {
  const calls = [];
  const expectedHead = 'a'.repeat(40);
  return runApprovedBackend8787Start({
    sharedWorkspace: workspace,
    platform,
    expectedHead,
    currentHeadFn: () => expectedHead,
    spawnFn: (command, args, options) => {
      calls.push({ command, args, options });
      return null;
    },
  }).then((result) => ({ calls, result }));
}

function canonicalExactHeadBackendHealth({ statusCode = 200, body, expectedHead }) {
  if (statusCode !== 200) return false;
  let payload;
  try {
    payload = typeof body === 'string' ? JSON.parse(body) : body;
  } catch {
    return false;
  }
  if (payload?.schemaVersion !== 'stephanos.backend-health.v1') return false;
  if (payload?.backendIdentity?.runtimeId !== 'stephanos-battle-bridge-backend') return false;
  const observed = String(payload?.backendIdentity?.sourceHead || '').trim().toLowerCase();
  const expected = String(expectedHead || '').trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(observed) && observed === expected;
}

test('Battle Bridge backend repair uses fixed cmd.exe npm.cmd execution on Windows without Node shell mode', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-backend-win-npm-'));
  const { calls, result } = await captureBackendStart(workspace, 'win32');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, BATTLE_BRIDGE_WINDOWS_HOST.cmd);
  assert.deepEqual(calls[0].args, ['/d', '/s', '/c', `""${BATTLE_BRIDGE_WINDOWS_HOST.npm}" run stephanos:battle-bridge:repair"`]);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.env.STEPHANOS_EXPECTED_HEAD, 'a'.repeat(40));
  assert.equal(result.started, true);
  assert.equal(result.exitCode, 0);
});

test('Battle Bridge backend repair keeps direct npm executable on non-Windows hosts', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-backend-posix-npm-'));
  const { calls } = await captureBackendStart(workspace, 'linux');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'npm');
  assert.deepEqual(calls[0].args, ['run', 'stephanos:battle-bridge:repair']);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.env.STEPHANOS_EXPECTED_HEAD, 'a'.repeat(40));
});

test('backend repair child source requires fixed exact-head proof immediately before mutation', async () => {
  const source = fs.readFileSync(new URL('./battle-bridge-repair.mjs', import.meta.url), 'utf8');
  assert.match(source, /STEPHANOS_EXPECTED_HEAD/);
  assert.match(source, /collectCanonicalIgnitionSourceTruth/);
  assert.match(source, /evaluateCanonicalIgnitionSourceTruth/);
  assert.match(source, /if \(!expectedHead\) \{[\s\S]*canonicalSourceTruth[\s\S]*BATTLE_BRIDGE_BACKEND_CANONICAL_HEAD_UNPROVEN/);
  assert.match(source, /process\.platform === 'win32'[\s\S]*BATTLE_BRIDGE_WINDOWS_HOST\.powershell/);
  assert.match(source, /BATTLE_BRIDGE_REPAIR_CANONICAL_POWERSHELL_UNAVAILABLE/);
  assert.match(source, /const expectedHead = assertExpectedHeadImmediatelyBeforeMutation\(\);\s*const result = spawnSync\(ps,[\s\S]*'-ExpectedHead', expectedHead/);
  assert.match(source, /assertExpectedHeadImmediatelyBeforeMutation\(\);\s*const child = spawn\(process\.execPath, \['stephanos-server\/backend-bootstrap\.mjs'\]/);
  assert.match(source, /STEPHANOS_BACKEND_REPO_ROOT: repoRoot/);
  assert.match(source, /STEPHANOS_BACKEND_SOURCE_HEAD: portableExpectedHead/);
  assert.match(source, /schemaVersion === 'stephanos\.backend-health\.v1'/);
  assert.match(source, /runtimeId === 'stephanos-battle-bridge-backend'/);
  assert.match(source, /sourceHead \|\| ''/);
  const repairPowerShell = fs.readFileSync(new URL('./windows/repair-stephanos-battle-bridge.ps1', import.meta.url), 'utf8');
  const backendPowerShell = fs.readFileSync(new URL('./windows/start-stephanos-backend.ps1', import.meta.url), 'utf8');
  assert.match(repairPowerShell, /Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'backend starter child'/);
  assert.match(repairPowerShell, /'-ExpectedHead', \$ExpectedHead/);
  assert.match(repairPowerShell, /Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'OpenClaw readonly adapter ensure'/);
  assert.match(repairPowerShell, /function Test-BackendExactHeadHealth/);
  assert.match(repairPowerShell, /ConvertFrom-Json -ErrorAction Stop/);
  assert.match(repairPowerShell, /stephanos\.backend-health\.v1/);
  assert.match(repairPowerShell, /BACKEND_HEALTH_SCHEMA_MISSING_OR_MISMATCH/);
  assert.match(repairPowerShell, /stephanos-battle-bridge-backend/);
  assert.match(repairPowerShell, /BACKEND_HEALTH_RUNTIME_ID_MISSING_OR_MISMATCH/);
  assert.match(repairPowerShell, /\$payload\.backendIdentity\.sourceHead/);
  assert.match(repairPowerShell, /BACKEND_HEALTH_SOURCE_HEAD_MISSING_OR_INVALID/);
  assert.match(repairPowerShell, /BACKEND_HEALTH_SOURCE_HEAD_MISMATCH/);
  assert.match(repairPowerShell, /Test-BackendExactHeadHealth -Url \$localHealthUrl -ExpectedSourceHead \$ExpectedHead/);
  assert.match(repairPowerShell, /Test-BackendExactHeadHealth -Url \$hostedHealthUrl -ExpectedSourceHead \$ExpectedHead/);
  assert.doesNotMatch(repairPowerShell, /\$localResult = Test-Url/);
  assert.match(backendPowerShell, /Backend startup expected-head binding mismatch/);
  assert.match(backendPowerShell, /Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'backend process start'/);
  assert.match(backendPowerShell, /Get-ExactHeadBackendBootstrapBase64/);
  assert.match(backendPowerShell, /Start-Process -FilePath \$canonicalNode/);
  assert.match(backendPowerShell, /STEPHANOS_BACKEND_BOOTSTRAP_BASE64/);
  assert.match(backendPowerShell, /--input-type=module', '--eval'/);
  assert.doesNotMatch(backendPowerShell, /Start-Process -FilePath \$canonicalNpm/);
});

test('already-healthy backend requires exact runtime head before bypassing convergence', () => {
  const expectedHead = 'a'.repeat(40);
  const staleHead = 'b'.repeat(40);
  const canonicalIdentity = {
    runtimeId: 'stephanos-battle-bridge-backend',
    sourceHead: expectedHead,
  };

  assert.equal(canonicalExactHeadBackendHealth({
    expectedHead,
    body: {
      schemaVersion: 'stephanos.backend-health.v1',
      backendIdentity: { ...canonicalIdentity, sourceHead: staleHead },
    },
  }), false, 'HTTP 200 from stale head B must not satisfy expected head A');

  assert.equal(canonicalExactHeadBackendHealth({
    expectedHead,
    body: {
      schemaVersion: 'stephanos.backend-health.v0',
      backendIdentity: canonicalIdentity,
    },
  }), false, 'correct head with the wrong health schema must fail closed');

  assert.equal(canonicalExactHeadBackendHealth({
    expectedHead,
    body: {
      schemaVersion: 'stephanos.backend-health.v1',
      backendIdentity: { ...canonicalIdentity, runtimeId: 'foreign-backend' },
    },
  }), false, 'correct head with the wrong runtime ID must fail closed');

  assert.equal(canonicalExactHeadBackendHealth({
    expectedHead,
    body: { backendIdentity: { sourceHead: expectedHead } },
  }), false, 'missing schema and runtime identity must fail closed');

  assert.equal(canonicalExactHeadBackendHealth({
    expectedHead,
    body: {
      schemaVersion: 'stephanos.backend-health.v1',
      backendIdentity: { runtimeId: 'stephanos-battle-bridge-backend' },
    },
  }), false, 'missing source head must fail closed');

  assert.equal(canonicalExactHeadBackendHealth({
    expectedHead,
    body: '{malformed-json',
  }), false, 'malformed health identity must fail closed');

  assert.equal(canonicalExactHeadBackendHealth({
    expectedHead,
    body: {
      schemaVersion: 'stephanos.backend-health.v1',
      backendIdentity: canonicalIdentity,
    },
  }), true, 'only canonical schema, runtime ID, and exact head may bypass backend convergence');
});
