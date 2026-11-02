import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  STEPHANOS_NATIVE_CAPACITY_PUBLISHER_INSTALL_OPERATION,
  executeStephanosNativeCapacityPublisherInstallOnBattleBridge,
  proveNativePublisherSignedReadbackV1,
  validateStephanosNativeCapacityPublisherInstallCommandShape,
} from './stephanosNativeCapacityPublisherBattleBridgeV1.mjs';
import {
  BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE,
  BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
  classifyBattleBridgeMailboxOperation,
  executeBattleBridgeGitHubCommand,
  validateBattleBridgeGitHubCommand,
} from './battleBridgeGitHubCommandMailbox.mjs';

const HEAD = 'b'.repeat(40);
const NOW = new Date('2026-09-22T17:50:00.000Z');
const CAPACITY_OBSERVED_AT = new Date(Date.now() + 60_000).toISOString();

test('generated publisher bootstrap parses in Windows PowerShell and retains every source denial', {
  skip: process.platform !== 'win32' ? 'Requires the scheduled-task Windows PowerShell engine.' : false,
}, () => {
  const installer = fileURLToPath(new URL('../../scripts/windows/install-stephanos-native-capacity-publisher.ps1', import.meta.url));
  const escaped = installer.replaceAll("'", "''");
  const script = `
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile('${escaped}', [ref]$tokens, [ref]$errors)
if (@($errors).Count -ne 0) { throw 'Installer syntax invalid.' }
$assignment = $ast.Find({ param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$bootstrap' }, $true)
if ($null -eq $assignment) { throw 'Bootstrap assignment absent.' }
function Quote-Single([string]$value) { return "'" + $value.Replace("'", "''") + "'" }
$repositoryRoot = 'C:\\Users\\Test\\Documents\\GitHub\\stephan-os'
$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git.exe'
$canonicalNode = 'C:\\Program Files\\nodejs\\node.exe'
$publisherScript = $repositoryRoot + '\\scripts\\stephanos-native-capacity-publisher.mjs'
$sourceGateScript = $repositoryRoot + '\\scripts\\stephanos-native-capacity-publisher-source-gate.mjs'
$missionRunnerRoot = 'C:\\Users\\Test\\Documents\\OpenClaw-Standalone\\mission-runner'
$workspaceRoot = 'C:\\Users\\Test\\Documents\\Stephanos-openclaw-workspace'
# Expand only the installer here-string; never run the resulting bootstrap.
$bootstrap = Invoke-Expression $assignment.Right.Extent.Text
$bootstrapAst = [Management.Automation.Language.Parser]::ParseInput($bootstrap, [ref]$tokens, [ref]$errors)
if (@($errors).Count -ne 0) { throw ('Generated bootstrap syntax: ' + ($errors.Message -join '; ')) }
$gate = $bootstrapAst.Find({ param($node) $node -is [Management.Automation.Language.IfStatementAst] -and $node.Extent.Text.Contains('dirtSummary.blocksSync') }, $true)
if ($null -eq $gate -or $gate.Clauses.Count -ne 1) { throw 'Source denial gate absent.' }
$condition = $gate.Clauses[0].Item1.Extent.Text
$head = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
$sourceGate = [pscustomobject]@{ok=$true;finalVerdict='STEPHANOS_NATIVE_PUBLISHER_SOURCE_GATE_PASS';sourceHead=$head;dirtSummary=[pscustomobject]@{blocksSync=$false}}
if (Invoke-Expression $condition) { throw 'Qualified source incorrectly denied.' }
$sourceGate.ok=$false; if (-not (Invoke-Expression $condition)) { throw 'Failed source accepted.' }; $sourceGate.ok=$true
$sourceGate.finalVerdict='UNKNOWN'; if (-not (Invoke-Expression $condition)) { throw 'Unknown verdict accepted.' }; $sourceGate.finalVerdict='STEPHANOS_NATIVE_PUBLISHER_SOURCE_GATE_PASS'
$sourceGate.sourceHead='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; if (-not (Invoke-Expression $condition)) { throw 'Wrong head accepted.' }; $sourceGate.sourceHead=$head
$sourceGate.dirtSummary.blocksSync=$true; if (-not (Invoke-Expression $condition)) { throw 'Unsafe dirt accepted.' }
'GENERATED_BOOTSTRAP_SOURCE_GATES_PASS'
`;
  const proof = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', [
    '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
  ], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 20_000 });
  assert.equal(proof.status, 0, proof.stderr);
  assert.match(proof.stdout, /GENERATED_BOOTSTRAP_SOURCE_GATES_PASS/);
});

function command(overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'native-publisher-install-v1',
    operation: STEPHANOS_NATIVE_CAPACITY_PUBLISHER_INSTALL_OPERATION,
    repository: BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
    issueNumber: BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: '2026-09-22T18:30:00.000Z',
    ...overrides,
  };
}

function installerReceipt() {
  return `${JSON.stringify({
    finalVerdict: 'STEPHANOS_NATIVE_CAPACITY_PUBLISHER_TASK_INSTALLED',
    sourceHead: HEAD,
    startRequested: true,
    taskName: 'Stephanos Native Capacity Publisher',
    arbitraryCommandAllowed: false,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  })}\n`;
}

test('native publisher mailbox operation is exact-head control work with no caller-shaped fields', () => {
  const shaped = validateStephanosNativeCapacityPublisherInstallCommandShape(command());
  assert.equal(shaped.ok, true);
  assert.equal(shaped.requested, true);
  assert.equal(shaped.expectedHead, HEAD);
  assert.equal(classifyBattleBridgeMailboxOperation(STEPHANOS_NATIVE_CAPACITY_PUBLISHER_INSTALL_OPERATION), 'CONTROL');

  const validated = validateBattleBridgeGitHubCommand(command(), {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
    authoredAt: NOW,
  });
  assert.equal(validated.ok, true);
  assert.equal(validated.command.operation, STEPHANOS_NATIVE_CAPACITY_PUBLISHER_INSTALL_OPERATION);
  assert.equal(validated.command.expectedHead, HEAD);

  const hostile = validateBattleBridgeGitHubCommand(command({ executable: 'powershell.exe' }), {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
    authoredAt: NOW,
  });
  assert.equal(hostile.ok, false);
  assert.equal(hostile.blocker, 'STEPHANOS_NATIVE_PUBLISHER_FIELD_NOT_ALLOWED');
});

test('wrapper delegates only the fixed native publisher install operation', async () => {
  let calls = 0;
  const result = await executeBattleBridgeGitHubCommand(command(), {
    executeStephanosNativeCapacityPublisherInstallOnBattleBridgeFn: async (selected) => {
      calls += 1;
      assert.equal(selected.operation, STEPHANOS_NATIVE_CAPACITY_PUBLISHER_INSTALL_OPERATION);
      assert.equal(selected.expectedHead, HEAD);
      return { ok: true, verdict: 'COMMAND_EXECUTION_COMPLETE', sourceHead: HEAD };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
});

test('Battle Bridge executor proves exact main then invokes only the fixed installer with StartNow', async () => {
  const invocations = [];
  const spawnSyncFn = (executable, args) => {
    invocations.push({ executable, args: [...args] });
    if (args.includes('branch')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('rev-parse')) return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
    if (args.includes('status')) return { status: 0, stdout: '', stderr: '' };
    return { status: 0, stdout: installerReceipt(), stderr: '' };
  };

  const result = await executeStephanosNativeCapacityPublisherInstallOnBattleBridge(command(), {
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    spawnSyncFn,
    verifyCandidateFn: async () => ({ ok: true, candidate: {
      sourceHead: HEAD, repository: BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
      taskClass: 'FOCUSED_REPAIR', capacityObservedAtUtc: CAPACITY_OBSERVED_AT, sourceMutationAllowed: true,
      mergeAuthority: false, leaseSeizureAllowed: false,
    } }),
    sleepFn: async () => {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'STEPHANOS_NATIVE_PUBLISHER_SIGNED_CAPACITY_LIVE_PROVEN');
  assert.equal(result.signedCapacityProven, true);
  assert.equal(result.expectedHeadMatch, true);
  assert.equal(result.dirtSummary.blocksSync, false);
  assert.equal(invocations.length, 4);
  const statusProbe = invocations[2];
  assert.ok(statusProbe.args.includes('--untracked-files=all'));
  const installer = invocations[3];
  assert.equal(installer.executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.ok(installer.args.includes('-StartNow'));
  assert.ok(installer.args.some((value) => String(value).endsWith('install-stephanos-native-capacity-publisher.ps1')));
});

test('runtime-owned tracked and untracked dirt does not block native publisher activation', async () => {
  const invocations = [];
  const spawnSyncFn = (executable, args) => {
    invocations.push({ executable, args: [...args] });
    if (args.includes('branch')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('rev-parse')) return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
    if (args.includes('status')) {
      return {
        status: 0,
        stdout: ' M stephanos-server/data/memory/durable-memory.json\n?? logs/native-capacity-runtime.json\n',
        stderr: '',
      };
    }
    return { status: 0, stdout: installerReceipt(), stderr: '' };
  };

  const result = await executeStephanosNativeCapacityPublisherInstallOnBattleBridge(command(), {
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    spawnSyncFn,
    verifyCandidateFn: async () => ({ ok: true, candidate: {
      sourceHead: HEAD, repository: BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
      taskClass: 'FOCUSED_REPAIR', capacityObservedAtUtc: CAPACITY_OBSERVED_AT, sourceMutationAllowed: true,
      mergeAuthority: false, leaseSeizureAllowed: false,
    } }),
    sleepFn: async () => {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'STEPHANOS_NATIVE_PUBLISHER_SIGNED_CAPACITY_LIVE_PROVEN');
  assert.equal(result.signedCapacityProven, true);
  assert.deepEqual(result.dirtSummary, {
    trackedSourceCount: 0,
    untrackedSourceCount: 0,
    runtimeOnlyCount: 2,
    generatedSourceCount: 0,
    unknownCount: 0,
    blocksSync: false,
  });
  assert.equal(invocations.length, 4);
});

test('real tracked or untracked source dirt still fails closed before native publisher installation', async () => {
  const invocations = [];
  const spawnSyncFn = (executable, args) => {
    invocations.push({ executable, args: [...args] });
    if (args.includes('branch')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('rev-parse')) return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
    if (args.includes('status')) {
      return {
        status: 0,
        stdout: ' M shared/agents/missionWorker.mjs\n?? shared/agents/untracked-native-source.mjs\n',
        stderr: '',
      };
    }
    throw new Error('installer must not be invoked with blocking source dirt');
  };

  const result = await executeStephanosNativeCapacityPublisherInstallOnBattleBridge(command(), {
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    spawnSyncFn,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'STEPHANOS_NATIVE_PUBLISHER_SOURCE_DIRT_BLOCKED');
  assert.deepEqual(result.dirtSummary, {
    trackedSourceCount: 1,
    untrackedSourceCount: 1,
    runtimeOnlyCount: 0,
    generatedSourceCount: 0,
    unknownCount: 0,
    blocksSync: true,
  });
  assert.equal(invocations.length, 3);
});

test('native task install cannot falsely certify a stale signed capacity receipt', async () => {
  let observed = 0, slept = 0;
  const result = await proveNativePublisherSignedReadbackV1({
    notBeforeUtc: NOW.toISOString(), expectedHead: HEAD, repositoryRoot: '/repo', env: { USERPROFILE: '/operator' },
    verify: async () => {
      observed += 1;
      return { ok: false, reason: 'STEPHANOS_NATIVE_CAPACITY_RECEIPT_INVALID:SOURCE-HEAD-INVALID' };
    },
    sleep: async (ms) => { assert.equal(ms, 10_000); slept += 1; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'STEPHANOS_NATIVE_CAPACITY_RECEIPT_INVALID:SOURCE-HEAD-INVALID');
  assert.equal(observed, 16);
  assert.equal(slept, 15);
});

test('native task installation requires an exact signed routing candidate', async () => {
  const candidate = {
    sourceHead: HEAD, repository: BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
    taskClass: 'FOCUSED_REPAIR', capacityObservedAtUtc: CAPACITY_OBSERVED_AT, sourceMutationAllowed: true,
    mergeAuthority: false, leaseSeizureAllowed: false,
  };
  const fail = await proveNativePublisherSignedReadbackV1({
    notBeforeUtc: NOW.toISOString(), expectedHead: HEAD, repositoryRoot: '/repo', env: { USERPROFILE: '/operator' },
    verify: async () => ({ ok: true, candidate: { ...candidate, sourceHead: 'c'.repeat(40) } }),
    sleep: async () => {},
  });
  assert.equal(fail.ok, false);
  const pass = await proveNativePublisherSignedReadbackV1({
    notBeforeUtc: NOW.toISOString(), expectedHead: HEAD, repositoryRoot: '/repo', env: { USERPROFILE: '/operator' },
    verify: async () => ({ ok: true, candidate }),
    sleep: async () => { throw new Error('must not sleep after successful proof'); },
  });
  assert.equal(pass.ok, true);
  assert.equal(pass.attempt, 1);
});

test('typed stale signed head triggers only one guarded fixed-task reconcile and demands new signed proof', async () => {
  let verifications = 0, starts = 0, reconcileAttempts = 0;
  const spawnSyncFn = (_executable, args) => {
    if (args.includes('branch')) return { status: 0, stdout: 'main\n' };
    if (args.includes('rev-parse')) return { status: 0, stdout: HEAD + '\n' };
    if (args.includes('status')) return { status: 0, stdout: '' };
    if (args.some(v => String(v).endsWith('reconcile-stephanos-native-capacity-publisher-stale.ps1'))) {
      reconcileAttempts++;
      assert.deepEqual(args.slice(-4), ['-ExpectedHead', HEAD, '-RequestId', 'native-publisher-install-v1'].slice(-4));
      return { status: 0, stdout: JSON.stringify({
        finalVerdict: 'NATIVE_PUBLISHER_FIXED_TASK_RESTART_REQUESTED',
        expectedHead: HEAD, taskName: 'Stephanos Native Capacity Publisher',
        signedCapacityVerified: false, leaseReleaseAllowed: false,
        sourceMutationAllowed: false, mergeAuthority: false,
      }) + '\n' };
    }
    starts++;
    return { status: 0, stdout: installerReceipt() };
  };
  const result = await executeStephanosNativeCapacityPublisherInstallOnBattleBridge(command(), {
    env: { USERPROFILE: 'C:\\Users\\operator' },
    spawnSyncFn,
    sleepFn: async () => {},
    verifyCandidateFn: async () => {
      verifications++;
      return verifications <= 16
        ? { ok: false, reason: 'STEPHANOS_NATIVE_CAPACITY_RECEIPT_INVALID:SOURCE-HEAD-INVALID' }
        : { ok: true, candidate: {
            sourceHead: HEAD, repository: BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
            taskClass: 'FOCUSED_REPAIR', capacityObservedAtUtc: CAPACITY_OBSERVED_AT, sourceMutationAllowed: true,
            mergeAuthority: false, leaseSeizureAllowed: false,
          } };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.signedCapacityProven, true);
  assert.equal(result.boundedRestartAttempted, true);
  assert.equal(reconcileAttempts, 1);
  assert.equal(starts, 1);
  assert.equal(verifications, 17);
});

test('stale signed head never becomes success when guarded restart is blocked', async () => {
  let recover = 0;
  const result = await executeStephanosNativeCapacityPublisherInstallOnBattleBridge(command(), {
    env: { USERPROFILE: 'C:\\Users\\operator' },
    spawnSyncFn: (_exe,args) => {
      if (args.includes('branch')) return { status: 0, stdout: 'main\n' };
      if (args.includes('rev-parse')) return { status: 0, stdout: HEAD + '\n' };
      if (args.includes('status')) return { status: 0, stdout: '' };
      if (args.some(v => String(v).endsWith('reconcile-stephanos-native-capacity-publisher-stale.ps1'))) {
        recover++;
        return { status: 1, stdout: '', stderr: 'NATIVE_RECONCILE_EXACT_HEAD_ALREADY_ATTEMPTED' };
      }
      return { status: 0, stdout: installerReceipt() };
    },
    sleepFn: async () => {},
    verifyCandidateFn: async () => ({
      ok: false, reason: 'STEPHANOS_NATIVE_CAPACITY_RECEIPT_INVALID:SOURCE-HEAD-INVALID',
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'STEPHANOS_NATIVE_PUBLISHER_BOUNDED_RESTART_BLOCKED');
  assert.equal(result.signedCapacityProven, false);
  assert.equal(recover, 1);
});

test('unrelated signed-capacity failures do not acquire task-stop authority', async () => {
  let restartCalled = false;
  const result = await executeStephanosNativeCapacityPublisherInstallOnBattleBridge(command(), {
    env: { USERPROFILE: 'C:\\Users\\operator' },
    spawnSyncFn: (_exe,args) => {
      if (args.includes('branch')) return { status: 0, stdout: 'main\n' };
      if (args.includes('rev-parse')) return { status: 0, stdout: HEAD + '\n' };
      if (args.includes('status')) return { status: 0, stdout: '' };
      if (args.some(v => String(v).endsWith('reconcile-stephanos-native-capacity-publisher-stale.ps1'))) {
        restartCalled = true; throw new Error('unexpected task restart');
      }
      return { status: 0, stdout: installerReceipt() };
    },
    sleepFn: async () => {},
    verifyCandidateFn: async () => ({ ok: false, reason: 'STEPHANOS_NATIVE_ROUTING_TRUST_PATH_UNAVAILABLE' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'STEPHANOS_NATIVE_PUBLISHER_SIGNED_READBACK_NOT_PROVEN');
  assert.equal(result.boundedRestartAttempted, false);
  assert.equal(restartCalled, false);
});

test('qualified native publisher restart source is fixed, one-shot and never targets an original writer', async () => {
  const { readFileSync } = await import('node:fs');
  const ps = readFileSync(new URL('../../scripts/windows/reconcile-stephanos-native-capacity-publisher-stale.ps1', import.meta.url), 'utf8');
  assert.match(ps, /\$taskName = 'Stephanos Native Capacity Publisher'/);
  assert.match(ps, /Stop-ScheduledTask -TaskName \$taskName/);
  assert.match(ps, /Start-ScheduledTask -TaskName \$taskName/);
  assert.match(ps, /FileMode\]::CreateNew/);
  assert.match(ps, /NATIVE_RECONCILE_TASK_OWNER_MISMATCH/);
  assert.match(ps, /NATIVE_RECONCILE_EXACT_HEAD_ALREADY_ATTEMPTED/);
  assert.match(ps, /NATIVE_RECONCILE_DIRT_OR_SOURCE_UNSAFE/);
  assert.match(ps, /sourceMutationAllowed=\$false/);
  assert.doesNotMatch(ps, /^\s*(?:Stop-Process|taskkill|Unregister-ScheduledTask|Remove-Item|git\s+(?:reset|clean|push))\b/gim);
});

test('same-head signed capacity predating StartNow never proves new publication', async () => {
  const result = await proveNativePublisherSignedReadbackV1({
    expectedHead: HEAD, repositoryRoot: '/repo', env: { USERPROFILE: '/operator' },
    notBeforeUtc: NOW.toISOString(),
    verify: async () => ({ ok: true, candidate: {
      sourceHead: HEAD, repository: BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
      taskClass: 'FOCUSED_REPAIR', capacityObservedAtUtc: '2026-09-22T17:49:59.000Z',
      sourceMutationAllowed: true, mergeAuthority: false, leaseSeizureAllowed: false,
    } }),
    sleep: async () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'STEPHANOS_NATIVE_PUBLISHER_POST_START_SIGNED_RECEIPT_UNPROVEN');
  assert.equal(result.attempt, 16);
});

test('stale publisher clears its status without losing a prior authenticated stale head', async () => {
  for (const [laterReason, expected] of [
    ['STEPHANOS_NATIVE_ROUTING_TRUTH_MISSING', 'STEPHANOS_NATIVE_CAPACITY_RECEIPT_INVALID:SOURCE-HEAD-INVALID'],
    ['STEPHANOS_NATIVE_SOURCE_AUTHORITY_INVALID:authority-id-binding-mismatch', 'STEPHANOS_NATIVE_SOURCE_AUTHORITY_INVALID:authority-id-binding-mismatch'],
  ]) {
    let probes = 0;
    const result = await proveNativePublisherSignedReadbackV1({
      notBeforeUtc: NOW.toISOString(), expectedHead: HEAD,
      repositoryRoot: '/repo', env: { USERPROFILE: '/operator' },
      verify: async () => ({ ok: false, reason: ++probes === 1
        ? 'STEPHANOS_NATIVE_CAPACITY_RECEIPT_INVALID:SOURCE-HEAD-INVALID' : laterReason }),
      sleep: async () => {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, expected);
    assert.equal(probes, 16);
  }
});

test('cold-start native capacity may become signed-current after the old 8s window', async () => {
  let checked = 0, sleeps = 0;
  const candidate = {
    sourceHead: HEAD, repository: BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
    taskClass: 'FOCUSED_REPAIR', capacityObservedAtUtc: new Date(Date.now() + 60000).toISOString(), sourceMutationAllowed: true,
    mergeAuthority: false, leaseSeizureAllowed: false,
  };
  const result = await proveNativePublisherSignedReadbackV1({
    notBeforeUtc: NOW.toISOString(), expectedHead: HEAD, repositoryRoot: '/repo', env: { USERPROFILE: '/operator' },
    verify: async () => {
      checked++;
      return checked < 13
        ? { ok: false, reason: 'STEPHANOS_NATIVE_ROUTING_TRUTH_MISSING' }
        : { ok: true, candidate };
    },
    sleep: async delay => { assert.equal(delay, 10000); sleeps++; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempt, 13);
  assert.equal(checked, 13);
  assert.equal(sleeps, 12);
  assert.equal(result.finalVerdict, 'STEPHANOS_NATIVE_PUBLISHER_SIGNED_CAPACITY_LIVE_PROVEN');
});
