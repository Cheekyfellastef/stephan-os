import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const splashPath = fileURLToPath(new URL('./windows/launch-starfield-vr-with-splash.ps1', import.meta.url));
const monitorDirectory = path.join(path.dirname(splashPath), 'starfield-native-monitor');
const source = await readFile(splashPath, 'utf8');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const python = process.env.CODEX_PRIMARY_RUNTIME_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const bootstrap = source.match(/\$monitorBootstrap = @'\r?\n([\s\S]*?)\r?\n'@/)?.[1];

function functionSource(name) {
  const start = source.indexOf(`function ${name} {`);
  assert.ok(start >= 0, `missing ${name}`);
  const next = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

function withFixtureDigest(expected) {
  assert.ok(bootstrap, 'the actual embedded bootstrap must exist');
  const marker = /actual!='(?:__MONITOR_BRIDGE_SHA256__|[a-f0-9]{64})'/g;
  assert.equal([...bootstrap.matchAll(marker)].length, 1);
  return bootstrap.replace(marker, `actual!='${expected}'`);
}

async function executeBootstrap(sourceText, expected) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "Stephanos monitor's fixture "));
  const entry = path.join(directory, 'splash_monitor_bridge.py');
  await writeFile(entry, sourceText, 'utf8');
  const result = spawnSync(python, ['-I', '-S', '-B', '-u', '-c', withFixtureDigest(expected || digest(sourceText)), entry,
    '--parent-pid', '999', '--parent-filetime', '134384678410182997', '--channel', 'a'.repeat(32)],
  { encoding: 'utf8', timeout: 10000 });
  return { directory, entry, result };
}

test('third card owns the monitor flow without a second window, icon or download', () => {
  const card = source.match(/\$hybridArgs = @\{([\s\S]*?)\n\}/)?.[1];
  assert.match(card, /Status = 'MONITOR TEST'/);
  assert.match(card, /ActionText = 'Start monitor test'/);
  assert.match(card, /Enabled = \$true/);
  assert.match(source, /HEADSET PLAYTEST NOT READY/);
  assert.match(source, /\$hybridButton\.Add_Click\(\{[\s\S]*?Start-MonitorFromHybridCard/);
  const shown = source.match(/\$form\.Add_Shown\(\{([\s\S]*?)\n\}\)/)?.[1];
  assert.ok(shown);
  assert.doesNotMatch(shown, /Start-Monitor|Send-Monitor|Start-Readiness/);
  assert.doesNotMatch(functionSource('Start-MonitorFromHybridCard'), /Start-StarfieldVrLauncherProcess|Start-ProviderSlotProcess|Invoke-WebRequest|Expand-Archive|\.vbs|tkinter|monitor_window/);
  assert.equal([...source.matchAll(/Send-MonitorCommand -Command 'confirm'/g)].length, 1,
    'only the actual third-card click can dispatch a fresh confirmation');
  assert.equal([...source.matchAll(/Send-MonitorCommand -Command 'finish'/g)].length, 1);
});

test('monitor is a hidden fixed child with no automatic interpreter retry after dispatch', () => {
  const start = functionSource('Start-MonitorFromHybridCard');
  assert.match(start, /\$python = Find-MonitorPython/);
  assert.match(start, /@\('-I', '-S', '-B', '-u', '-c', \$monitorBootstrap, \$monitorBridgePath,/);
  assert.match(start, /'--parent-pid', \[string\]\$PID, '--parent-filetime', \$parentCreated, '--channel', \$monitorState\.Channel/);
  assert.match(start, /ToFileTimeUtc\(\)\.ToString\(\[System\.Globalization\.CultureInfo\]::InvariantCulture\)/);
  assert.equal([...start.matchAll(/\$process\.Start\(\)/g)].length, 1);
  const startInfo = functionSource('New-MonitorProcessStartInfo');
  for (const property of ['CreateNoWindow', 'RedirectStandardInput', 'RedirectStandardOutput', 'RedirectStandardError']) {
    assert.match(startInfo, new RegExp(`\\$info\\.${property} = \\$true`));
  }
  assert.match(startInfo, /\$info\.UseShellExecute = \$false/);
  assert.doesNotMatch(start, /\.Kill\(|Stop-Process|force_terminate|Start-Process/);
});

test('command protocol binds actual confirmation and serializes mutation', () => {
  const sender = functionSource('Send-MonitorCommand');
  assert.match(sender, /ValidateSet\('prepare', 'confirm', 'finish', 'cancel', 'close'\)/);
  assert.match(sender, /\$Command -cnotin \$monitorState\.AllowedActions/);
  assert.match(sender, /\$monitorState\.Mode -cne 'waiting'/);
  assert.match(sender, /\$monitorState\.Pipe\.PermitForeground\(\)/);
  assert.ok(sender.indexOf('PermitForeground()') < sender.indexOf('StandardInput.WriteLine'));
  for (const field of ['confirmationToken', 'runId', 'pid', 'createdFileTime']) {
    assert.match(sender, new RegExp(`\\$request\\.${field} =`));
  }
  assert.match(sender, /\$monitorState\.ConfirmationToken = \$null/);
  assert.match(sender, /\$monitorState\.RequestSequence \+= 1L/);
  assert.ok(sender.indexOf('$monitorState.ProviderSlotReleased = $false') < sender.indexOf('StandardInput.WriteLine'));
  assert.match(source, /AllowSetForegroundWindow\(checked\(\(uint\)child\.Id\)\)/);
});

test('terminal projection requires capture and cleanup evidence independently of process exit', () => {
  const parser = functionSource('Receive-MonitorEvent');
  assert.match(parser, /\$event\.channel -cne \$monitorState\.Channel/);
  assert.match(parser, /\$event\.eventSequence -ne \(\$monitorState\.EventSequence \+ 1L\)/);
  assert.match(parser, /\$event\.childPid -ne \$monitorState\.Process\.Id/);
  assert.match(parser, /\$event\.bridgeSha256 -cne \$monitorBridgeSha256/);
  assert.match(parser, /\$event\.runnerSha256 -cne \$monitorRunnerSha256/);
  assert.match(functionSource('Test-MonitorBooleanFields'), /\$property\.Value -isnot \[bool\]/);
  const pass = parser.match(/\$passed = ([\s\S]*?)\n        \$hybridCard/)?.[1];
  assert.ok(pass);
  for (const evidence of ['REVIEWED_MONITOR_TEST_PASSED', 'analysisAccepted', 'bundleEvidenceIntegrityVerified', 'cleanupComplete', 'normalExitProven', 'providerSlotReleased', 'safeToClose', 'unresolvedChild']) {
    assert.ok(pass.includes(evidence), evidence);
  }
  assert.doesNotMatch(pass, /ExitCode|HasExited/);
  assert.match(source, /\$lostResult = -not \$drained -or -not \$monitorState\.ClosedReceived -or \$monitorState\.TransportFailed -or \$exitCode -ne 0/);
  assert.match(source, /if \(\$monitorState\.PrepareDispatched\) \{\s*\$monitorState\.ProviderSlotReleased = \$false/);
});

test('provider switching and splash close preserve monitor ownership', () => {
  assert.match(functionSource('Start-ProviderRoute'), /\$monitorState\.Process -or -not \$monitorState\.ProviderSlotReleased/);
  assert.match(source, /\$toggleSimulationState = \{\s*if \(\$processState\.ProviderBusy -or \$monitorState\.Process -or -not \$monitorState\.ProviderSlotReleased -or -not \$monitorState\.DurableCustodyReleased\)/);
  const closing = source.match(/\$form\.Add_FormClosing\(\{([\s\S]*?)\n\}\)/)?.[1];
  assert.ok(closing);
  assert.match(closing, /if \(\$monitorState\.Process -and -not \$monitorState\.Process\.HasExited\)/);
  assert.match(closing, /\$eventArgs\.Cancel = \$true/);
  assert.match(closing, /\$monitorState\.PendingPrepare = \$false/);
  assert.match(closing, /Send-MonitorCommand -Command 'close'/);
  assert.doesNotMatch(closing, /\.Kill\(|Stop-Process|\.Dispose\(/);
  assert.match(source, /Other provider buttons stay held; this window can be closed/);
});

test('singleton and durable custody prevent reopening around a pending monitor', () => {
  assert.match(functionSource('Enter-StarfieldSplashOwner'), /Global\\Stephanos\.StarfieldVrSplash/);
  assert.match(functionSource('Enter-StarfieldSplashOwner'), /WaitOne\(0\)/);
  const release = functionSource('Exit-StarfieldSplashOwner');
  assert.match(release, /while \(-not \$child\.HasExited\)/);
  assert.ok(release.indexOf('WaitForExit(1000)') < release.indexOf('ReleaseMutex()'));
  assert.match(functionSource('Start-ProviderSlotProcess'), /if \(-not \(Test-MonitorProviderCustody\)\)/);
  const custody = functionSource('Test-MonitorProviderCustody');
  assert.match(custody, /\$monitorState\.DurableCustodyReleased = \$false/);
  assert.match(custody, /Test-MonitorCustodyPathPresent -LiteralPath \$path/);
  assert.match(custody, /if \(-not \$present\) \{[\s\S]*?return \$true/);
  assert.match(custody, /\$receipt\.PSObject\.Properties\[\$name\]\.Value -isnot \[bool\]/);
  assert.match(custody, /\$receipt\.allowed -and \$receipt\.providerSlotReleased -and \$receipt\.observationsCurrent/);
  assert.match(functionSource('Set-MonitorProviderControls'), /\$monitorState\.ProviderSlotReleased -and \$monitorState\.DurableCustodyReleased/);
  assert.match(source, /\$launchDelayTimer\.Stop\(\)\s*if \(\$form\.IsDisposed -or \$processState\.CloseRequested\)/);
  assert.match(functionSource('Start-ReadinessCheck'), /\$processState\.CloseRequested/);
});

test('Python discovery resolves the real image before direct parent-bound launch', () => {
  const discovery = functionSource('Find-MonitorPython');
  assert.match(discovery, /QueryFullProcessImageNameW/);
  assert.match(discovery, /'executable':buffer\.value/);
  assert.doesNotMatch(discovery, /return.*Executable = \$command\.Source/);
  assert.match(functionSource('Read-MonitorProbeResult'), /Executable = \$file\.FullName; Prefix = @\(\)/);
  assert.match(functionSource('Read-MonitorProbeResult'), /FileAttributes\]::ReparsePoint/);
});

test('protocol drains are bounded and do not require a PowerShell callback runspace', () => {
  for (const bound of ['MaximumLine = 32768', 'MaximumQueue = 128', 'MaximumErrors = 16384', 'MaximumOutput = 1048576']) {
    assert.ok(source.includes(bound));
  }
  assert.match(source, /StreamReader outputReader = process\.StandardOutput;[\s\S]*?new Thread\(\(\) => Drain\(outputReader, true\)\)/);
  assert.match(source, /new Thread\(\(\) => Drain\(errorReader, false\)\)/);
  assert.match(source, /if \(\$monitorState\.Pipe\.Fault\) \{ Stop-MonitorTransport/);
  assert.doesNotMatch(source, /add_OutputDataReceived|add_ErrorDataReceived|Register-ObjectEvent/);
});

test('actual bootstrap executes only its hashed bytes with isolated main-module identity', async () => {
  const fixture = [
    "from __future__ import annotations",
    "from dataclasses import dataclass",
    "import json,sys",
    "from pathlib import Path",
    "@dataclass",
    "class Proof:",
    "    attempts: int",
    "p=Path(__file__).with_suffix('.result.json')",
    "if p.exists(): raise RuntimeError('second execution')",
    "p.write_text(json.dumps({'attempts':Proof(1).attempts,'name':__name__,'digest':__VERIFIED_BRIDGE_SHA256__,'isolated':bool(sys.flags.isolated),'noSite':bool(sys.flags.no_site),'noBytecode':bool(sys.dont_write_bytecode),'args':sys.argv[1:]}),encoding='utf-8')",
    "",
  ].join('\n');
  const { directory, entry, result } = await executeBootstrap(fixture);
  try {
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const proof = JSON.parse(await readFile(entry.replace(/\.py$/, '.result.json'), 'utf8'));
    assert.equal(proof.attempts, 1);
    assert.equal(proof.name, '__main__');
    assert.equal(proof.digest, digest(fixture));
    assert.equal(proof.isolated && proof.noSite && proof.noBytecode, true);
    assert.deepEqual(proof.args, ['--parent-pid', '999', '--parent-filetime', '134384678410182997', '--channel', 'a'.repeat(32)]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('actual bootstrap refuses changed bridge bytes without executing them', async () => {
  const fixture = "from pathlib import Path;Path(__file__).with_suffix('.ran').write_text('bad')";
  const { directory, entry, result } = await executeBootstrap(fixture, '0'.repeat(64));
  try {
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Monitor bridge hash mismatch/);
    await assert.rejects(readFile(entry.replace(/\.py$/, '.ran')), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('final splash pins exactly the packaged bridge and runner', async () => {
  const bridgePin = source.match(/\$monitorBridgeSha256 = '([a-f0-9]{64})'/)?.[1];
  const runnerPin = source.match(/\$monitorRunnerSha256 = '([a-f0-9]{64})'/)?.[1];
  assert.ok(bridgePin, 'freeze and stamp the reviewed adapter digest before publication');
  assert.ok(runnerPin, 'freeze and stamp the reviewed runner digest before publication');
  assert.equal(digest(await readFile(path.join(monitorDirectory, 'splash_monitor_bridge.py'))), bridgePin);
  assert.equal(digest(await readFile(path.join(monitorDirectory, 'run_native_eye_output_monitor.py'))), runnerPin);
  assert.ok(bootstrap.includes(`actual!='${bridgePin}'`));
  assert.doesNotMatch(source, /__MONITOR_(?:BRIDGE|RUNNER)_SHA256__/);
});
