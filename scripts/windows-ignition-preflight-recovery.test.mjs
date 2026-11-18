import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const source = readFileSync(new URL('../windows/Launch-Stephanos-Local.ps1', import.meta.url), 'utf8');
const marker = 'BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_RESULT=';
const blocked = {
  schemaVersion: 'stephanos.battle-bridge-ignition-sync-preflight.v1',
  ok: false, classification: 'IGNITION_SYNC_PREFLIGHT_BLOCKED',
  finalVerdict: 'IGNITION_SYNC_PREFLIGHT_BLOCKED',
  blocker: 'BLOCKED_INSTALL_OR_PERMISSION_REQUIRED', syncBlockerReason: 'SYNC_ALREADY_RUNNING',
};
const packet = data => marker + JSON.stringify(data);
const quote = value => "'" + value.replaceAll("'", "''") + "'";
function definition(name) {
  const match = source.match(new RegExp(`^function ${name}(?:\\([^\\n]*\\))? \\{[\\s\\S]*?^}\\r?$`, 'm'));
  assert.ok(match, `exercise actual ${name}`);
  return match[0];
}
function runFixture(body, logs = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'ignition-preflight-recovery-'));
  try {
    for (const [name, content] of Object.entries(logs)) writeFileSync(join(directory, name), content, 'utf8');
    const script = join(directory, 'fixture.ps1');
    writeFileSync(script, '\ufeff' + `
$ErrorActionPreference = 'Stop'
$ignitionProofRoot = ${quote(directory)}
$script:ignitionHelperLogFiles = @((Join-Path $ignitionProofRoot '.\\current.stdout.log'), (Join-Path $ignitionProofRoot '.\\current.stderr.log'))
function Initialize-IgnitionProofWorkspace {}
${definition('Get-LauncherChildBlocker')}
${body}
`, 'utf8');
    return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      encoding: 'utf8', windowsHide: true, shell: false, timeout: 10_000,
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('current helper preflight packets preserve safe refusal codes and exclude stale or untrusted logs', { skip: process.platform !== 'win32' }, () => {
  const cases = [
    { name: 'current-busy', stdout: packet(blocked), reason: 'SYNC_ALREADY_RUNNING' },
    { name: 'current-permission', stdout: packet({ ...blocked, syncBlockerReason: '' }), reason: 'BLOCKED_INSTALL_OR_PERMISSION_REQUIRED' },
    { name: 'unsafe-detail', stdout: packet({ ...blocked, syncBlockerReason: 'C:\\private\\token.txt' }), reason: 'BLOCKED_INSTALL_OR_PERMISSION_REQUIRED' },
    { name: 'wrong-schema', stdout: packet({ ...blocked, schemaVersion: 'foreign' }) },
    { name: 'string-false', stdout: packet({ ...blocked, ok: 'false' }) },
    { name: 'partial', stdout: marker + '{"ok":false' },
    { name: 'unsafe-blocker', stdout: packet({ ...blocked, blocker: 'C:\\private\\secret' }) },
    { name: 'unrelated-old-file', other: packet(blocked) },
    { name: 'stderr-is-not-protocol', stderr: packet(blocked) },
    { name: 'retry-success-wins', stdout: packet(blocked) + '\n' + packet({ ...blocked, ok: true, classification: 'IGNITION_SYNC_PREFLIGHT_PASS', finalVerdict: 'IGNITION_SYNC_PREFLIGHT_PASS', blocker: '' }) },
    { name: 'partial-latest-does-not-reuse-old-refusal', stdout: packet(blocked) + '\n' + marker + '{' },
  ];
  for (const fixture of cases) {
    const result = runFixture('ConvertTo-Json -InputObject (Get-LauncherChildBlocker) -Depth 8 -Compress', {
      'current.stdout.log': fixture.stdout || '', 'current.stderr.log': fixture.stderr || '',
      'old.stdout.log': fixture.other || packet(blocked),
    });
    assert.equal(result.status, 0, `${fixture.name}: ${result.stderr || result.stdout || result.error?.message}`);
    const observation = result.stdout.trim() ? JSON.parse(result.stdout.trim()) : null;
    if (fixture.reason) {
      assert.ok(observation, `${fixture.name}: expected a current helper refusal`);
      assert.equal(observation.reason, fixture.reason, fixture.name);
      assert.equal(observation.packetType, 'ignition-sync-preflight', fixture.name);
      assert.doesNotMatch(JSON.stringify(observation), /private|token\.txt|rawLine/);
    } else assert.equal(observation, null, fixture.name);
  }
});

test('exited helper refusal is surfaced without an ExitCode while active retries and green preflight still wait for service proof', { skip: process.platform !== 'win32' }, () => {
  for (const fixture of [
    { name: 'exited-null-code', exited: true, stdout: packet(blocked), expected: 'Ignition source preflight blocked: SYNC_ALREADY_RUNNING' },
    { name: 'repair-still-running', exited: false, stdout: packet(blocked), expected: 'fixture-waited-for-service-proof' },
    { name: 'green-preflight-is-not-service-proof', exited: true, stdout: packet({ ...blocked, ok: true, blocker: '', classification: 'IGNITION_SYNC_PREFLIGHT_PASS', finalVerdict: 'IGNITION_SYNC_PREFLIGHT_PASS' }), expected: 'fixture-waited-for-service-proof' },
  ]) {
    const result = runFixture(`
function Get-RepositoryHeadForSupervisorProof { return '${'a'.repeat(40)}' }
function Get-BattleBridgeSupervisorCurrentRecord { return $null }
function Write-LiveLog { param($Message) }
function Write-IgnitionStatus { param($Phase,$Message,$Extra) }
function Start-Sleep { throw 'fixture-waited-for-service-proof' }
$battleBridgeSupervisorCurrentPath = 'fixture-supervisor'
$script:ignitionHelperProcess = [pscustomobject]@{ HasExited = $${fixture.exited}; ExitCode = $null }
$script:ignitionHelperProcess | Add-Member ScriptMethod WaitForExit {}
$script:ignitionHelperProcess | Add-Member ScriptMethod Refresh {}
${definition('Wait-ForBattleBridgeSupervisorReady')}
try { Wait-ForBattleBridgeSupervisorReady; throw 'unexpected-ready' }
catch { ConvertTo-Json -InputObject $_.Exception.Message -Compress }
`, { 'current.stdout.log': fixture.stdout, 'current.stderr.log': '' });
    assert.equal(result.status, 0, `${fixture.name}: ${result.stderr || result.stdout || result.error?.message}`);
    assert.equal(JSON.parse(result.stdout.trim()), fixture.expected, fixture.name);
  }
});
