import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { backendStarterInvocation } from './run-battle-bridge-ignition.mjs';
import { createExactHeadSourceLoader } from '../stephanos-server/backend-exact-head-loader.mjs';

const restartSource = await readFile(new URL('./windows/restart-approved-stephanos-runtime.ps1', import.meta.url), 'utf8');
const backendStartSource = await readFile(new URL('./windows/start-stephanos-backend.ps1', import.meta.url), 'utf8');
const ignitionEntrySource = await readFile(new URL('./run-battle-bridge-ignition.mjs', import.meta.url), 'utf8');
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const backendBootstrapPath = fileURLToPath(new URL('../stephanos-server/backend-bootstrap.mjs', import.meta.url));
const backendBootstrapSource = await readFile(backendBootstrapPath, 'utf8');
const backendLoaderSource = await readFile(new URL('../stephanos-server/backend-exact-head-loader.mjs', import.meta.url), 'utf8');
const backendServerPath = fileURLToPath(new URL('../stephanos-server/server.js', import.meta.url));
const backendServerSource = await readFile(backendServerPath, 'utf8');

function backendHeadProofForObservedHeads(observedHeads, expectedHead) {
  const proofFunctionsStart = backendServerSource.indexOf('function minimalBackendChildGitEnvironment()');
  const proofFunctionsEnd = backendServerSource.indexOf('const backendExpectedHead =');
  const proofFunctionsSource = backendServerSource.slice(proofFunctionsStart, proofFunctionsEnd);
  const remainingHeads = [...observedHeads];
  const spawnSyncImpl = () => ({
    status: 0,
    stdout: `${remainingHeads.shift() || ''}\n`,
    stderr: '',
  });
  const processForTest = {
    env: { STEPHANOS_BACKEND_SOURCE_HEAD: expectedHead },
    platform: 'linux',
  };
  return Function(
    'spawnSync',
    'canonicalGitDirectory',
    'canonicalRepoRoot',
    'process',
    `'use strict'; ${proofFunctionsSource}; return enforceBattleBridgeBackendChildExpectedHead;`,
  )(spawnSyncImpl, '/repo/.git', '/repo', processForTest);
}

async function simulateBackendImportBoundary(observedHeads, expectedHead) {
  const proveExpectedHead = backendHeadProofForObservedHeads(observedHeads, expectedHead);
  let listenerStarted = false;
  try {
    proveExpectedHead();
    await Promise.resolve(); // backend module loading boundary
    proveExpectedHead();
    listenerStarted = true;
    return { listenerStarted, error: null };
  } catch (error) {
    return { listenerStarted, error };
  }
}

function runGit(gitExecutable, root, args) {
  const result = spawnSync(gitExecutable, ['-C', root, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5_000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return String(result.stdout || '').trim();
}

test('restart helper accepts only backend and mission-worker', () => {
  assert.match(restartSource, /ValidateSet\('backend', 'mission-worker'\)/);
  assert.match(restartSource, /Stephanos Battle Bridge Backend/);
  assert.match(restartSource, /Stephanos Mission Orchestrator Worker/);
  assert.doesNotMatch(restartSource, /\[string\]\$TaskName/);
});

test('restart helper validates canonical task action and overlap policy before mutation', () => {
  assert.match(restartSource, /run-stephanos-scheduled-task-windowless\.vbs/);
  assert.match(restartSource, /APPROVED_TASK_EXECUTABLE_MISMATCH/);
  assert.match(restartSource, /APPROVED_TASK_ARGUMENTS_MISMATCH/);
  assert.match(restartSource, /\$Target -eq 'backend' -and \[string\]\$task\.Settings\.MultipleInstances -ne 'IgnoreNew'/);
  assert.match(restartSource, /APPROVED_BACKEND_TASK_MULTIPLE_INSTANCES_MISMATCH/);
  assert.ok(restartSource.includes("TaskPath '\\'"));
});

test('backend entry preflight carries the parent-proven exact head into its PowerShell child', () => {
  const provenHead = 'a'.repeat(40);
  const laterHead = 'b'.repeat(40);
  const invocation = backendStarterInvocation(provenHead);
  const expectedHeadIndex = invocation.args.indexOf('-ExpectedHead');
  assert.notEqual(expectedHeadIndex, -1);
  assert.equal(invocation.args[expectedHeadIndex + 1], provenHead);
  assert.equal(invocation.args.includes(laterHead), false);
  assert.match(ignitionEntrySource, /const currentHead = entryHeadProof\.currentHead;[\s\S]*const starter = backendStarterInvocation\(currentHead\)/);
});

test('backend Node child rejects checkout drift before loading or listening', () => {
  const gitExecutable = process.platform === 'win32'
    ? 'C:\\Program Files\\Git\\cmd\\git.exe'
    : '/usr/bin/git';
  const headProof = spawnSync(gitExecutable, ['-C', repoRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5_000,
  });
  assert.equal(headProof.status, 0, headProof.stderr || headProof.error?.message);
  const actualHead = String(headProof.stdout || '').trim().toLowerCase();
  assert.match(actualHead, /^[0-9a-f]{40}$/);
  const driftedExpectedHead = actualHead === 'a'.repeat(40) ? 'b'.repeat(40) : 'a'.repeat(40);
  const child = spawnSync(process.execPath, [backendBootstrapPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      STEPHANOS_BACKEND_SOURCE_HEAD: driftedExpectedHead,
    },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
  });
  assert.notEqual(child.status, 0, 'drifted backend child must fail closed');
  assert.match(String(child.stderr || ''), /BACKEND_CHILD_EXPECTED_HEAD_MISMATCH/);
  assert.doesNotMatch(`${child.stdout || ''}\n${child.stderr || ''}`, /\[BACKEND LIVE\] Stephanos server listening/);
});

test('backend Node child re-proves exact head after module loading immediately before listening', () => {
  const proofCall = 'enforceBattleBridgeBackendChildExpectedHead();';
  const proofOffsets = [...backendServerSource.matchAll(/enforceBattleBridgeBackendChildExpectedHead\(\);/g)]
    .map((match) => match.index);
  const lastBackendImportOffset = backendServerSource.lastIndexOf('await import(');
  const listenerOffset = backendServerSource.indexOf('server.listen(');

  assert.equal(proofOffsets.length, 2, 'backend entry must prove the fixed expected head exactly twice');
  assert.ok(proofOffsets[0] < lastBackendImportOffset, 'the first proof must happen before backend module loading');
  assert.ok(lastBackendImportOffset < proofOffsets[1], 'checkout drift during module loading must reach a second proof');
  assert.equal(
    backendServerSource.slice(proofOffsets[1], listenerOffset).trim(),
    proofCall,
    'the second proof must be the only operation before listener/health publication',
  );
  assert.ok(proofOffsets[1] < listenerOffset, 'failed re-proof must prevent server.listen');
});

test('backend immutable bootstrap registers the exact-head loader before importing the server entry', () => {
  const firstProofOffset = backendBootstrapSource.indexOf('\n  proveExpectedHead();');
  const loaderRegistrationOffset = backendBootstrapSource.indexOf('\n  register(');
  const serverEntryImportOffset = backendBootstrapSource.lastIndexOf('\nawait import(');
  const firstBackendImportOffset = backendServerSource.indexOf("await import('dotenv/config')");

  assert.ok(firstProofOffset >= 0);
  assert.ok(firstProofOffset < loaderRegistrationOffset);
  assert.ok(loaderRegistrationOffset < serverEntryImportOffset);
  assert.ok(backendServerSource.indexOf('BACKEND_CHILD_IMMUTABLE_BOOTSTRAP_REQUIRED') < firstBackendImportOffset);
  assert.match(
    backendBootstrapSource,
    /readExactHeadBlob\('stephanos-server\/backend-exact-head-loader\.mjs'/,
    'the loader implementation must come from the approved Git object',
  );
  assert.match(backendBootstrapSource, /readExactHeadBlob\('stephanos-server\/backend-bootstrap\.mjs'/);
  assert.match(backendBootstrapSource, /GIT_NO_REPLACE_OBJECTS: '1'/);
  assert.match(backendLoaderSource, /GIT_NO_REPLACE_OBJECTS: '1'/);
});

test('bound backend server entry cannot be launched without the immutable bootstrap', () => {
  const child = spawnSync(process.execPath, [backendServerPath], {
    cwd: repoRoot,
    env: { ...process.env, STEPHANOS_BACKEND_SOURCE_HEAD: 'a'.repeat(40) },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
  });
  assert.notEqual(child.status, 0);
  assert.match(String(child.stderr || ''), /BACKEND_CHILD_IMMUTABLE_BOOTSTRAP_REQUIRED/);
  assert.doesNotMatch(`${child.stdout || ''}\n${child.stderr || ''}`, /\[BACKEND LIVE\] Stephanos server listening/);
});

test('immutable module loading admits A during an A to B to A checkout transition', async () => {
  const gitExecutable = process.platform === 'win32'
    ? 'C:\\Program Files\\Git\\cmd\\git.exe'
    : '/usr/bin/git';
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'stephanos-exact-head-loader-'));
  const modulePath = join(fixtureRoot, 'module.js');
  try {
    runGit(gitExecutable, fixtureRoot, ['init', '--quiet']);
    runGit(gitExecutable, fixtureRoot, ['config', 'user.name', 'Stephanos Test']);
    runGit(gitExecutable, fixtureRoot, ['config', 'user.email', 'stephanos-test@example.invalid']);

    writeFileSync(modulePath, "export const sourceIdentity = 'A';\n", 'utf8');
    runGit(gitExecutable, fixtureRoot, ['add', '--', 'module.js']);
    runGit(gitExecutable, fixtureRoot, ['commit', '--quiet', '-m', 'source A']);
    const approvedHead = runGit(gitExecutable, fixtureRoot, ['rev-parse', 'HEAD']).toLowerCase();

    writeFileSync(modulePath, "export const sourceIdentity = 'B';\n", 'utf8');
    runGit(gitExecutable, fixtureRoot, ['add', '--', 'module.js']);
    runGit(gitExecutable, fixtureRoot, ['commit', '--quiet', '-m', 'source B']);
    const driftedHead = runGit(gitExecutable, fixtureRoot, ['rev-parse', 'HEAD']).toLowerCase();
    assert.notEqual(driftedHead, approvedHead);

    const loadExactHeadSource = createExactHeadSourceLoader({
      canonicalGitDirectory: join(fixtureRoot, '.git'),
      canonicalRepoRoot: fixtureRoot,
      expectedHead: approvedHead,
      gitEnvironment: process.env,
      gitExecutable,
    });
    const moduleUrl = pathToFileURL(modulePath).href;
    const duringDrift = await loadExactHeadSource(moduleUrl, { format: 'commonjs' }, () => {
      throw new Error('repository module must not fall through to the mutable checkout');
    });
    assert.equal(duringDrift.format, 'module', 'mutable checkout package metadata must not change source format');
    assert.match(duringDrift.source, /sourceIdentity = 'A'/);
    assert.doesNotMatch(duringDrift.source, /sourceIdentity = 'B'/);

    runGit(gitExecutable, fixtureRoot, ['checkout', '--quiet', '--detach', approvedHead]);
    const afterReturn = await loadExactHeadSource(moduleUrl, { format: 'module' }, () => {
      throw new Error('repository module must not fall through to the mutable checkout');
    });
    assert.match(afterReturn.source, /sourceIdentity = 'A'/);
    assert.equal(runGit(gitExecutable, fixtureRoot, ['rev-parse', 'HEAD']).toLowerCase(), approvedHead);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('materialized production bootstrap rejects package, bootstrap, server, and replace-ref drift from A to B', () => {
  const gitExecutable = process.platform === 'win32'
    ? 'C:\\Program Files\\Git\\cmd\\git.exe'
    : '/usr/bin/git';
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'stephanos-production-bootstrap-'));
  const fixtureServerRoot = join(fixtureRoot, 'stephanos-server');
  const fixtureBootstrap = join(fixtureServerRoot, 'backend-bootstrap.mjs');
  const fixtureServer = join(fixtureServerRoot, 'server.js');
  const fixturePackage = join(fixtureRoot, 'package.json');
  const alternateEntry = join(fixtureRoot, 'alternate-b.mjs');
  const runtimeBootstrap = join(fixtureRoot, 'runtime', 'backend-bootstrap-exact-a.mjs');
  try {
    mkdirSync(fixtureServerRoot, { recursive: true });
    runGit(gitExecutable, fixtureRoot, ['init', '--quiet']);
    runGit(gitExecutable, fixtureRoot, ['config', 'user.name', 'Stephanos Test']);
    runGit(gitExecutable, fixtureRoot, ['config', 'user.email', 'stephanos-test@example.invalid']);
    writeFileSync(fixturePackage, '{"scripts":{"stephanos:backend":"node stephanos-server/backend-bootstrap.mjs"}}\n', 'utf8');
    writeFileSync(fixtureBootstrap, backendBootstrapSource, 'utf8');
    writeFileSync(join(fixtureServerRoot, 'backend-exact-head-loader.mjs'), backendLoaderSource, 'utf8');
    writeFileSync(fixtureServer, "console.log('PRODUCTION_ENTRY_A');\n", 'utf8');
    runGit(gitExecutable, fixtureRoot, ['add', '--', 'package.json', 'stephanos-server']);
    runGit(gitExecutable, fixtureRoot, ['commit', '--quiet', '-m', 'production entry A']);
    const approvedHead = runGit(gitExecutable, fixtureRoot, ['rev-parse', 'HEAD']).toLowerCase();

    const packageB = '{"scripts":{"stephanos:backend":"node alternate-b.mjs"}}\n';
    const bootstrapB = "console.log('BOOTSTRAP_B_EXECUTED');\n" + backendBootstrapSource;
    const serverB = "console.log('PRODUCTION_ENTRY_B');\n";
    const alternateB = "console.log('ALTERNATE_PACKAGE_ENTRY_B');\n";
    writeFileSync(fixturePackage, packageB, 'utf8');
    writeFileSync(fixtureBootstrap, bootstrapB, 'utf8');
    writeFileSync(fixtureServer, serverB, 'utf8');
    writeFileSync(alternateEntry, alternateB, 'utf8');
    runGit(gitExecutable, fixtureRoot, ['add', '--', 'package.json', 'alternate-b.mjs', 'stephanos-server']);
    runGit(gitExecutable, fixtureRoot, ['commit', '--quiet', '-m', 'production entry B']);
    const replacementHead = runGit(gitExecutable, fixtureRoot, ['rev-parse', 'HEAD']).toLowerCase();
    assert.notEqual(replacementHead, approvedHead);

    runGit(gitExecutable, fixtureRoot, ['checkout', '--quiet', '--detach', approvedHead]);
    writeFileSync(fixturePackage, packageB, 'utf8');
    writeFileSync(fixtureBootstrap, bootstrapB, 'utf8');
    writeFileSync(fixtureServer, serverB, 'utf8');
    writeFileSync(alternateEntry, alternateB, 'utf8');
    runGit(gitExecutable, fixtureRoot, ['replace', approvedHead, replacementHead]);
    assert.match(readFileSync(fixturePackage, 'utf8'), /alternate-b\.mjs/);
    assert.match(readFileSync(fixtureBootstrap, 'utf8'), /BOOTSTRAP_B_EXECUTED/);

    const exactBootstrap = spawnSync(gitExecutable, ['-C', fixtureRoot, 'show', `${approvedHead}:stephanos-server/backend-bootstrap.mjs`], {
      env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' },
      encoding: 'utf8', windowsHide: true, timeout: 5_000,
    });
    assert.equal(exactBootstrap.status, 0, exactBootstrap.stderr || exactBootstrap.error?.message);
    mkdirSync(join(fixtureRoot, 'runtime'), { recursive: true });
    writeFileSync(runtimeBootstrap, exactBootstrap.stdout, 'utf8');

    const child = spawnSync(process.execPath, [runtimeBootstrap], {
      cwd: fixtureRoot,
      env: {
        ...process.env,
        GIT_NO_REPLACE_OBJECTS: '0',
        STEPHANOS_BACKEND_REPO_ROOT: fixtureRoot,
        STEPHANOS_BACKEND_SOURCE_HEAD: approvedHead,
      },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
    });
    assert.equal(child.status, 0, child.stderr || child.error?.message);
    assert.match(String(child.stdout || ''), /PRODUCTION_ENTRY_A/);
    assert.doesNotMatch(String(child.stdout || ''), /PRODUCTION_ENTRY_B/);
    assert.doesNotMatch(String(child.stdout || ''), /BOOTSTRAP_B_EXECUTED|ALTERNATE_PACKAGE_ENTRY_B/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('checkout drift A to B during backend module loading prevents listener publication', async () => {
  const approvedHead = 'a'.repeat(40);
  const driftedHead = 'b'.repeat(40);
  const result = await simulateBackendImportBoundary([approvedHead, driftedHead], approvedHead);

  assert.equal(result.listenerStarted, false);
  assert.match(result.error?.message || '', /BACKEND_CHILD_EXPECTED_HEAD_MISMATCH/);
});

test('unchanged exact head A across backend module loading proceeds to listener publication', async () => {
  const approvedHead = 'a'.repeat(40);
  const result = await simulateBackendImportBoundary([approvedHead, approvedHead], approvedHead);

  assert.equal(result.error, null);
  assert.equal(result.listenerStarted, true);
});

test('backend Node child ignores hostile inherited Git repository-selection variables', () => {
  const gitExecutable = process.platform === 'win32'
    ? 'C:\\Program Files\\Git\\cmd\\git.exe'
    : '/usr/bin/git';
  const hostileRoot = mkdtempSync(join(tmpdir(), 'stephanos-backend-hostile-git-'));
  try {
    const init = spawnSync(gitExecutable, ['init', '--quiet', hostileRoot], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
    });
    assert.equal(init.status, 0, init.stderr || init.error?.message);

    const commit = spawnSync(gitExecutable, [
      '-C', hostileRoot,
      '-c', 'user.name=Stephanos Test',
      '-c', 'user.email=stephanos-test@example.invalid',
      'commit', '--allow-empty', '--quiet', '-m', 'hostile Git redirect',
    ], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
    });
    assert.equal(commit.status, 0, commit.stderr || commit.error?.message);

    const hostileHeadProof = spawnSync(gitExecutable, ['-C', hostileRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
    });
    assert.equal(hostileHeadProof.status, 0, hostileHeadProof.stderr || hostileHeadProof.error?.message);
    const hostileHead = String(hostileHeadProof.stdout || '').trim().toLowerCase();
    assert.match(hostileHead, /^[0-9a-f]{40}$/);

    const canonicalHeadProof = spawnSync(gitExecutable, ['-C', repoRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
    });
    assert.equal(canonicalHeadProof.status, 0, canonicalHeadProof.stderr || canonicalHeadProof.error?.message);
    const canonicalHead = String(canonicalHeadProof.stdout || '').trim().toLowerCase();
    assert.match(canonicalHead, /^[0-9a-f]{40}$/);
    assert.notEqual(hostileHead, canonicalHead);

    const child = spawnSync(process.execPath, [backendBootstrapPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        STEPHANOS_BACKEND_SOURCE_HEAD: hostileHead,
        GIT_DIR: join(hostileRoot, '.git'),
        GIT_WORK_TREE: hostileRoot,
        GIT_COMMON_DIR: join(hostileRoot, '.git'),
        GIT_OBJECT_DIRECTORY: join(hostileRoot, '.git', 'objects'),
        GIT_INDEX_FILE: join(hostileRoot, '.git', 'index'),
      },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
    });
    assert.notEqual(child.status, 0, 'hostile Git environment must not redirect the backend proof');
    assert.match(String(child.stderr || ''), /BACKEND_CHILD_EXPECTED_HEAD_MISMATCH/);
    assert.doesNotMatch(`${child.stdout || ''}\n${child.stderr || ''}`, /\[BACKEND LIVE\] Stephanos server listening/);
  } finally {
    rmSync(hostileRoot, { recursive: true, force: true });
  }
});

test('backend restart terminates only the verified 8787 Stephanos Node listener', () => {
  assert.match(restartSource, /Get-NetTCPConnection -LocalPort 8787 -State Listen/);
  assert.match(restartSource, /backend-runtime\\backend-bootstrap-\$ExpectedHead\.mjs/);
  assert.match(restartSource, /BACKEND_LISTENER_COMMAND_NOT_ALLOWLISTED/);
  assert.match(restartSource, /Stop-Process -Id \$listener\.ProcessId -Force/);
  assert.match(restartSource, /stephanos-backend-runtime\.json/);
  assert.match(restartSource, /BACKEND_EXACT_HEAD_RECEIPT_TIMEOUT/);
  assert.match(restartSource, /stephanos\.backend-expected-head-handoff\.v1/);
  assert.match(restartSource, /BACKEND_LISTENER_DID_NOT_STOP[\s\S]*Publish-BackendExpectedHeadHandoff[\s\S]*Start-ScheduledTask/);
  assert.match(restartSource, /Disable-ScheduledTask[\s\S]*\$task\.State -in @\('Running', 'Queued'\)[\s\S]*\$prePublishTask = Get-ScheduledTask[\s\S]*\$prePublishTask\.State -ne 'Disabled'[\s\S]*\$prePublishTask\.Settings\.MultipleInstances -ne 'IgnoreNew'[\s\S]*BACKEND_TASK_MULTIPLE_INSTANCES_MISMATCH_BEFORE_HANDOFF[\s\S]*Publish-BackendExpectedHeadHandoff[\s\S]*Enable-ScheduledTask[\s\S]*\$preStartTask = Get-ScheduledTask[\s\S]*\$preStartTask\.Settings\.MultipleInstances -ne 'IgnoreNew'[\s\S]*BACKEND_TASK_MULTIPLE_INSTANCES_MISMATCH_BEFORE_START[\s\S]*Start-ScheduledTask/);
  assert.match(restartSource, /backend-expected-head-handoff\.json/);
  assert.match(restartSource, /expiresAtUtc = \$issuedAtUtc\.AddMinutes\(2\)/);
  assert.match(restartSource, /catch \{[\s\S]*Remove-Item -LiteralPath \$backendExpectedHeadHandoffPath/);
  assert.match(restartSource, /BACKEND_TASK_DID_NOT_STOP/);
  assert.doesNotMatch(restartSource, /Stop-Process\s+-Name|taskkill|killall/);
});

test('worker restart requires task-owned process stop and a fresh exact-head heartbeat', () => {
  assert.match(restartSource, /mission-orchestrator-worker-heartbeat\.json/);
  assert.match(restartSource, /headSha -ne \$ExpectedSourceHead/);
  assert.match(restartSource, /MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT/);
  assert.match(restartSource, /MISSION_WORKER_TASK_DID_NOT_STOP/);
  assert.match(restartSource, /MISSION_WORKER_VERIFIED_PROCESS_DID_NOT_STOP/);
  assert.match(restartSource, /Stop-Process -Id \$oldWorker\.ProcessId -Force/);
  assert.doesNotMatch(restartSource, /MISSION_WORKER_TASK_OR_PROCESS_DID_NOT_STOP|MISSION_WORKER_PROCESS_OUTSIDE_RUNNING_TASK/);
  assert.match(restartSource, /unrelatedTasksChanged = \$false/);
});

test('backend starter proves canonical main and writes a bounded exact-head runtime receipt', () => {
  assert.match(backendStartSource, /\[string\]\$ExpectedHead = ''/);
  assert.match(backendStartSource, /branch --show-current/);
  assert.match(backendStartSource, /rev-parse HEAD/);
  assert.match(backendStartSource, /branch -ne 'main'/);
  assert.match(backendStartSource, /upstream -ne 'origin\/main'/);
  assert.match(backendStartSource, /originHead -ne \$headSha/);
  assert.match(backendStartSource, /\$boundExpectedHead = if \(\$providedExpectedHead\) \{ \$providedExpectedHead \} else \{ \$headSha \}/);
  assert.match(backendStartSource, /observedHead -ne \$boundExpectedHead/);
  assert.match(backendStartSource, /function Read-BackendExpectedHeadHandoff/);
  assert.match(backendStartSource, /Move-Item -LiteralPath \$handoffPath -Destination \$consumedPath/);
  assert.match(backendStartSource, /BACKEND_EXPECTED_HEAD_HANDOFF_CONSUME_FAILED/);
  assert.match(backendStartSource, /BACKEND_EXPECTED_HEAD_HANDOFF_EXPIRED/);
  assert.doesNotMatch(backendStartSource, /expiresAtUtc -le \$nowUtc\) \{ return \$null/);
  assert.match(backendStartSource, /BACKEND_EXPECTED_HEAD_HANDOFF_TIME_INVALID/);
  assert.match(backendStartSource, /expiresAtUtc -le \$issuedAtUtc/);
  assert.match(backendStartSource, /if \(-not \$providedExpectedHead\) \{[\s\S]*Read-BackendExpectedHeadHandoff/);
  assert.match(backendStartSource, /stephanos-backend-runtime\.json/);
  assert.match(backendStartSource, /headSha = \$HeadSha/);
  assert.match(backendStartSource, /taskName = 'Stephanos Battle Bridge Backend'/);
  assert.match(backendStartSource, /pathValuesPublished = \$false/);
  assert.match(backendStartSource, /function Publish-ExactHeadBackendBootstrap/);
  assert.match(backendStartSource, /'show', "\$\{HeadSha\}:\$bootstrapGitPath"/);
  assert.match(backendStartSource, /hash-object "--path=\$bootstrapGitPath" \$temporaryPath/);
  assert.match(backendStartSource, /backend-bootstrap-\$headSha\.mjs/);
  assert.match(backendStartSource, /Start-Process -FilePath \$canonicalNode/);
  assert.doesNotMatch(backendStartSource, /Start-Process -FilePath \$canonicalNpm/);
  assert.match(backendStartSource, /Get-NetTCPConnection -LocalPort 8787 -State Listen/);
  assert.doesNotMatch(backendStartSource, /repositoryRoot\s*=/);
});

test('backend starter captures native Git exit codes before selecting bounded output', () => {
  assert.match(
    backendStartSource,
    /\$branchOutput = @\(& \$canonicalGit -C \$repoRoot branch --show-current 2>\$null\)\r?\n\$branchExitCode = \$LASTEXITCODE\r?\nif \(\$branchExitCode -ne 0\)/,
  );
  assert.match(
    backendStartSource,
    /\$headOutput = @\(& \$canonicalGit -C \$repoRoot rev-parse HEAD 2>\$null\)\r?\n\$headExitCode = \$LASTEXITCODE\r?\nif \(\$headExitCode -ne 0\)/,
  );
  assert.match(backendStartSource, /\$branchRaw = \$branchOutput \| Select-Object -First 1/);
  assert.match(backendStartSource, /\$headRaw = \$headOutput \| Select-Object -First 1/);
  assert.doesNotMatch(backendStartSource, /& \$canonicalGit[^\r\n]+\|\s*Select-Object/);
});
