import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  STARFIELD_NATIVE_BUILD_ACTIVATION as ownership, classifyPostSyncRefresh,
  executePostSyncRefreshPlan, buildPostSyncRefreshProjection, postSyncRefreshTargetResultPass,
  projectPostSyncGovernorProof,
} from './postSyncRuntimeRefreshCoordinator.mjs';
import {
  projectPostSyncGovernorProof as policyProjector, pendingPostSyncRefreshDebt,
  inspectPendingPostSyncRefreshDebt, collectPostSyncRefreshDebt, inspectPostSyncRefreshCompletion,
  resolvePostSyncRefreshDebt,
} from '../../scripts/battle-bridge-github-sync-policy.mjs';
import { createFixedPostSyncRuntimeAdapter, runBattleBridgePostSyncRefresh }
  from '../../scripts/battle-bridge-post-sync-refresh.mjs';

const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
const governor = 'scripts/windows/run-vr-resource-governor.ps1';
const pass = () => ({ ok: true, exactHeadProofOk: true, sourceHead: B });
const readSource = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
// Inspect the actual tested source workspace, including new patch members.
// Escrow validation applies a verified patch before making its final commit;
// HEAD alone would silently omit those inputs. Git ignores keep generated
// caches out, while an unregistered source neighbor still fails completeness.
const inventory = (prefix, cwd = new URL('../../', import.meta.url)) => {
  const result = spawnSync(process.platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : 'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', prefix],
    { cwd, encoding: 'utf8', shell: false, windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split('\0').filter(Boolean).sort();
};

test('source inventory includes unapplied-to-HEAD patch members and refuses unknown source neighbors', async t => {
  const root = await mkdtemp(join(tmpdir(), 'starfield-source-inventory-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = process.platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : 'git';
  const runGit = args => {
    const result = spawnSync(git, args, { cwd: root, encoding: 'utf8', shell: false, windowsHide: true, timeout: 10_000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
  };
  runGit(['init', '--quiet']);
  await mkdir(join(root, 'source', '__pycache__'), { recursive: true });
  await writeFile(join(root, '.gitignore'), '__pycache__/\n');
  await writeFile(join(root, 'source', 'tracked.py'), '# tracked fixture\n');
  runGit(['add', '--', '.gitignore', 'source/tracked.py']);
  await writeFile(join(root, 'source', 'new.py'), '# new verified patch member\n');
  await writeFile(join(root, 'source', '__pycache__', 'generated.pyc'), 'generated fixture');
  const registered = ['source/new.py', 'source/tracked.py'];
  assert.deepEqual(inventory('source/', root), registered);
  await writeFile(join(root, 'source', 'unregistered.py'), '# unknown neighbor\n');
  assert.notDeepEqual(inventory('source/', root), registered);
  assert.ok(inventory('source/', root).includes('source/unregistered.py'));
});
const proof = (sourceHead = B) => ({ schemaVersion: 'stephanos.post-sync-governor-proof.v1', watchdogSucceeded: true,
  normalOperatorObserved: true, healthy: true, inventoryComplete: true, processCount: 1,
  identityVerified: true, progressVerified: true, currentSourceVerified: true,
  sourceHead, sourceHeadMatchesLive: true, sourceSha256: 'a'.repeat(64), blocker: '' });
const ancestor = (before, after) => ({ ok: true, ancestor: before <= after });

test('actual watchdog observation refuses changed identity, stale source, held progress and source-epoch races', { skip: process.platform !== 'win32' }, () => {
  const loader = String.raw`$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$inputData=[Console]::In.ReadToEnd() | ConvertFrom-Json
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($inputData.source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'SOURCE_PARSE_FAILED'}
$functions=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Get-VrResourceGovernorAdoptionObservation'},$false))
if($functions.Count -ne 1){throw 'OBSERVATION_FUNCTION_UNPROVEN'}
. ([ScriptBlock]::Create($functions[0].Extent.Text))
function Get-VrResourceGovernorProcesses {
 $script:vrGovernorInventoryComplete=($scenario -cne 'opaque')
 if($scenario -ceq 'absent'){return @()}
 if($scenario -ceq 'multiple'){return @($row,$row)}
 return @($row)
}
function Test-VrResourceGovernorProcessIdentity {param($Process) return $scenario -cne 'identity'}
function Test-VrResourceGovernorProcessCurrent {param($Process) return $scenario -cne 'stale-source'}
function Get-VrResourceGovernorProgress {param($Process) return [pscustomobject]@{fresh=($scenario -cne 'stale-progress');custodyHeld=($scenario -ceq 'held');updatedAtUtc='2026-11-19T05:25:00Z'}}
function Wait-VrResourceGovernorProgress {param($Process,[string]$After) return $scenario -cne 'no-advance'}
function Get-VrResourceGovernorSourceObservation {
 $source=[pscustomobject]@{sourceHead=('b'*40);sourceSha256=('a'*64);writeTicks=$owner.CreationDate.AddSeconds(-1).Ticks;creationTicks=1;length=2}
 if($scenario -ceq 'head-race'){$source.sourceHead='a'*40}
 if($scenario -ceq 'digest-race'){$source.sourceSha256='b'*64}
 if($scenario -ceq 'metadata-race'){$source.length=3}
 if($scenario -ceq 'write-after-birth'){$source.writeTicks=$owner.CreationDate.AddSeconds(1).Ticks}
 return $source
}
$results=@()
foreach($scenario in @('valid','replacement','opaque','absent','multiple','pid-race','birth-race','identity','stale-source','stale-progress','held','head-race','digest-race','metadata-race','write-after-birth','no-advance','elevated','token-string','progress-unproven','source-unproven')){
 $operatorContext=[pscustomobject]@{normalOperatorObserved=$true}
 if($scenario -ceq 'elevated'){$operatorContext.normalOperatorObserved=$false}
 if($scenario -ceq 'token-string'){$operatorContext.normalOperatorObserved='true'}
 $owner=[pscustomobject]@{ProcessId=42;CreationDate=[DateTime]'2026-11-19T05:24:00Z'}
 $row=[pscustomobject]@{ProcessId=42;CreationDate=$owner.CreationDate}
 if($scenario -ceq 'replacement'){$owner.ProcessId=73;$row.ProcessId=73}
 if($scenario -ceq 'pid-race'){$row.ProcessId=43}
 if($scenario -ceq 'birth-race'){$row.CreationDate=$owner.CreationDate.AddSeconds(1)}
 $sourceBefore=[pscustomobject]@{sourceHead=('b'*40);sourceSha256=('a'*64);writeTicks=$owner.CreationDate.AddSeconds(-1).Ticks;creationTicks=1;length=2}
 if($scenario -ceq 'source-unproven'){$sourceBefore=$null}
 $observation=Get-VrResourceGovernorAdoptionObservation -Process $owner -SourceBefore $sourceBefore -ProgressVerified ($scenario -cne 'progress-unproven')
 $results+=,[pscustomobject]@{scenario=$scenario;accepted=($null -ne $observation)}
}
ConvertTo-Json -InputObject $results -Compress`;
  const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(loader, 'utf16le').toString('base64')],
    { input: JSON.stringify({ source: readSource('scripts/windows/run-sovereign-commander-hidden.ps1') }),
      cwd: 'C:\\Windows\\System32', encoding: 'utf8', shell: false, windowsHide: true, timeout: 10_000, maxBuffer: 16_384 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const rows = JSON.parse(result.stdout);
  assert.equal(rows.length, 20);
  for (const row of rows) assert.equal(row.accepted, ['valid', 'replacement'].includes(row.scenario), row.scenario);
});

test('existing owned lifecycle uses hard actual file freshness at one-second-before, exact and later birth boundaries', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'governor-source-birth-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'governor.ps1');
  await writeFile(path, '# isolated source freshness fixture\n');
  const loader = String.raw`$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$data=[Console]::In.ReadToEnd() | ConvertFrom-Json
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($data.source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'SOURCE_PARSE_FAILED'}
$functions=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Test-VrResourceGovernorProcessCurrent'},$false))
if($functions.Count -ne 1){throw 'SOURCE_FUNCTION_UNPROVEN'}
. ([ScriptBlock]::Create($functions[0].Extent.Text))
$vrGovernorScript=$data.path
$written=(Get-Item -LiteralPath $vrGovernorScript).LastWriteTimeUtc
$result=@()
foreach($offset in @(-1,0,1)){
 $process=[pscustomobject]@{CreationDate=$written.AddSeconds($offset)}
 $result+=,[pscustomobject]@{offset=$offset;current=(Test-VrResourceGovernorProcessCurrent -Process $process)}
}
ConvertTo-Json -InputObject $result -Compress`;
  const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(loader, 'utf16le').toString('base64')],
    { input: JSON.stringify({ source: readSource('scripts/windows/run-sovereign-commander-hidden.ps1'), path }),
      cwd: 'C:\\Windows\\System32', encoding: 'utf8', shell: false, windowsHide: true, timeout: 10_000, maxBuffer: 16_384 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [{ offset: -1, current: false }, { offset: 0, current: true }, { offset: 1, current: true }]);
  const source = readSource('scripts/windows/run-sovereign-commander-hidden.ps1');
  assert(source.indexOf('$vrGovernorAdoption = Get-VrResourceGovernorAdoptionObservation') > source.lastIndexOf('$fleetGoalSupervisorOk = [bool]'),
    'Final adoption is observed after potentially slow fleet/Core/relay work');
});

test('actual source observer binds real LF and CRLF fixture bytes to the canonical blob and refuses different content', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'governor-source-blob-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = Buffer.from('# canonical fixture\n');
  const blob = createHash('sha1').update(Buffer.from('blob ' + original.length + '\0')).update(original).digest('hex');
  const files = [];
  for (const [index, content] of [original, Buffer.from('# canonical fixture\r\n'), Buffer.from('# different fixture\n')].entries()) {
    const path = join(root, 'source-' + index + '.ps1');
    await writeFile(path, content); files.push(path);
  }
  const loader = String.raw`$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$data=[Console]::In.ReadToEnd() | ConvertFrom-Json
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($data.source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'SOURCE_PARSE_FAILED'}
$functions=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Get-VrResourceGovernorSourceObservation'},$false))
if($functions.Count -ne 1){throw 'SOURCE_FUNCTION_UNPROVEN'}
. ([ScriptBlock]::Create($functions[0].Extent.Text))
function Get-VrResourceGovernorSourceHead {return ('b'*40)}
function Get-FixtureGit { $global:LASTEXITCODE=0;return $data.blob }
$gitExe='Get-FixtureGit';$repoRoot='fixture'
$results=@()
foreach($path in $data.paths){
 $vrGovernorScript=$path
 $observation=Get-VrResourceGovernorSourceObservation
 $results+=,($null -ne $observation)
}
ConvertTo-Json -InputObject $results -Compress`;
  const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(loader, 'utf16le').toString('base64')],
    { input: JSON.stringify({ source: readSource('scripts/windows/run-sovereign-commander-hidden.ps1'), paths: files, blob }),
      cwd: 'C:\\Windows\\System32', encoding: 'utf8', shell: false, windowsHide: true, timeout: 10_000, maxBuffer: 16_384 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [true, true, false]);
});

test('source ownership is complete against canonical recipe, fresh capture, and both dotfile-inclusive inventories', () => {
  const recipePath = 'VR-Research-Lab/native/starfield-paired-observer-v1/build-recipe.json';
  const recipe = JSON.parse(readSource(recipePath));
  const packageInputs = [recipePath, ...recipe.publicMembers.map(row => row.path),
    'VR-Research-Lab/native/starfield-paired-observer-v1/.gitattributes',
    'VR-Research-Lab/native/starfield-paired-observer-v1/README.md',
    'VR-Research-Lab/native/starfield-paired-observer-v1/reconstruct_paired_loader.py',
    'VR-Research-Lab/native/starfield-paired-observer-v1/test_paired_loader_preparation.py'];
  assert.equal(packageInputs.length, 16);
  assert.deepEqual([...ownership.offlinePackage].sort(), packageInputs.sort());
  for (const row of recipe.publicMembers) {
    const bytes = readFileSync(new URL('../../' + row.path, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256, row.path);
  }
  assert.deepEqual([...ownership.offlinePackage].sort(), inventory('VR-Research-Lab/native/starfield-paired-observer-v1/'));
  assert.equal(ownership.freshCapture.length, 5);
  assert.equal(ownership.offlineBuild.length, 9);
  assert.deepEqual([...ownership.freshCapture, ...ownership.offlineBuild].sort(), inventory('scripts/windows/starfield-native-build/'));
  assert.equal(new Set([...ownership.freshCapture, ...ownership.offlineBuild, ...ownership.offlinePackage]).size, 30);
  const builder = readSource('shared/agents/starfieldVrNativeBuildV1.mjs');
  const declarations = [...builder.matchAll(/^const (RUNNER|OWNED_JOB|LAUNCHER|RUNTIME_MODULE|RUNTIME_MANIFEST) = '([^']+)';$/gm)];
  assert.equal(declarations.length, 5);
  assert.deepEqual(declarations.map(row => row[2]).sort(), [...ownership.freshCapture].sort());
  assert.match(builder, /for \(const path of \[RUNNER, OWNED_JOB, LAUNCHER, RUNTIME_MODULE, RUNTIME_MANIFEST, \.\.\.recipe\.publicMembers\.map\(row => row\.path\)\]\)/,
    'Changing the source-capture shape requires renewed activation ownership review');
  for (const path of ownership.freshCapture) {
    const plan = classifyPostSyncRefresh([path]);
    assert.deepEqual(plan.targetIds, ['natural-reload'], path);
    assert.equal(plan.noRuntimePathCount, 0);
  }
  for (const path of [...ownership.offlineBuild, ...ownership.offlinePackage]) {
    assert.equal(classifyPostSyncRefresh([path]).classification, 'NO_RUNTIME_REFRESH_REQUIRED', path);
  }
});

test('full retained rollout keeps separate resident debts and rejects every unknown sibling before adapters', async () => {
  const corpus = JSON.parse(readSource('tests/fixtures/post-sync-native-build-retained-delta-v1.json'));
  assert.equal(corpus.beforeHead, 'd729d17c65298e4c27305bca243848585a5bc8aa');
  assert.equal(corpus.afterHead, 'db730e7f9a83e2f5a053b63e89163189acec9719');
  assert.equal(corpus.paths.length, 818);
  const plan = classifyPostSyncRefresh(corpus.paths);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.spatialAdoptionRequired, true);
  assert.equal(plan.pluginHostActivationRequired, true);
  assert.equal(plan.sovereignRelayRefreshRequired, true);
  assert.equal(plan.governorRefreshRequired, true);
  assert.equal(plan.classification, 'BLOCKED_SPATIAL_ADOPTION_REQUIRED');
  const forbidden = new Proxy({}, { get() { return () => assert.fail('held unknown debt invoked an adapter'); } });
  for (const path of [...ownership.freshCapture, ...ownership.offlineBuild, ...ownership.offlinePackage].filter(path => !path.endsWith('.md'))) {
    const sibling = path.replace(/([^/]+)$/, 'unreviewed-$1');
    assert.equal(classifyPostSyncRefresh([sibling]).classification, 'BLOCKED_UNCLASSIFIED_RUNTIME_PATH', sibling);
  }
  const mixed = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B,
    changedPaths: [...ownership.freshCapture, ...ownership.offlinePackage, 'scripts/windows/starfield-native-build/unreviewed.py'], adapters: forbidden });
  assert.equal(mixed.ok, false);
  assert.deepEqual(mixed.results, []);
  const offline = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B,
    changedPaths: [...ownership.offlineBuild, ...ownership.offlinePackage], adapters: forbidden });
  assert.equal(offline.ok, true);
  const called = [];
  const fresh = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B,
    changedPaths: ownership.freshCapture, adapters: { confirmNaturalReload: async () => { called.push('natural'); return pass(); } } });
  assert.equal(fresh.ok, true);
  assert.deepEqual(called, ['natural']);
});

test('complete repair rollout, including its regression corpus, has existing activation owners', () => {
  const paths = ['shared/agents/postSyncRuntimeRefreshCoordinator.mjs', 'scripts/battle-bridge-github-sync-policy.mjs',
    'scripts/battle-bridge-post-sync-refresh.mjs', 'scripts/battle-bridge-github-sync-executor.mjs',
    'scripts/battle-bridge-github-sync-and-refresh.mjs', 'scripts/windows/run-sovereign-commander-hidden.ps1',
    'shared/agents/postSyncRuntimeRefreshControlPlaneClassification.test.mjs',
    'shared/agents/postSyncRuntimeRefreshNativeBuildOwnership.test.mjs',
    'scripts/battle-bridge-github-sync-executor.test.mjs', 'scripts/battle-bridge-github-sync-and-refresh.test.mjs',
    'tests/fixtures/post-sync-native-build-retained-delta-v1.json',
    'docs/architecture/ignition-source-activation-routing.md'];
  const plan = classifyPostSyncRefresh(paths);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.classification, 'REFRESH_READY');
  assert.deepEqual(plan.targetIds, ['mission-orchestrator-worker', 'github-command-mailbox', 'sovereign-commander', 'natural-reload']);
  assert.equal(classifyPostSyncRefresh(['tests/fixtures/post-sync-native-build-retained-delta-v1.json']).classification,
    'NO_RUNTIME_REFRESH_REQUIRED');
});

test('Governor evidence is closed, inert, strict and source-bound in fresh and retained consumers', () => {
  assert.equal(projectPostSyncGovernorProof, policyProjector);
  assert.deepEqual(policyProjector(proof(), B), proof());
  for (const key of Object.keys(proof())) {
    const missing = proof(); delete missing[key];
    assert.equal(policyProjector(missing, B), null, 'missing ' + key);
  }
  for (const [key, value] of Object.entries(proof())) {
    const bad = typeof value === 'boolean' ? 'true' : key === 'processCount' ? '1' : 'unproven';
    assert.equal(policyProjector({ ...proof(), [key]: bad }, B), null, key);
  }
  for (const count of [0, 2, -1, NaN]) assert.equal(policyProjector({ ...proof(), processCount: count }, B), null);
  assert.equal(policyProjector(proof(A), B), null);
  assert.equal(policyProjector({ ...proof(), privatePid: 99 }, B), null);
  assert.equal(policyProjector(new Proxy(proof(), {}), B), null);
  let read = false;
  const accessor = proof();
  Object.defineProperty(accessor, 'healthy', { get() { read = true; return true; } });
  assert.equal(policyProjector(accessor, B), null);
  assert.equal(read, false);
  const plan = classifyPostSyncRefresh([governor]);
  assert.equal(plan.governorRefreshRequired, true);
  assert.equal(plan.sovereignRelayRefreshRequired, false);
  assert.deepEqual(plan.targetIds, ['sovereign-commander']);
  assert.equal(postSyncRefreshTargetResultPass(pass(), { targetId: 'sovereign-commander', plan, expectedHead: B }), false);
  assert.equal(postSyncRefreshTargetResultPass({ ...pass(), governorProof: proof() }, { targetId: 'sovereign-commander', plan, expectedHead: B }), true);
});

function adapterFixture(receipt = {}, status = 0) {
  const { watchdogSucceeded, ...observation } = proof();
  const payload = { schemaVersion: 'stephanos.sovereign-commander-watchdog.v1', taskName: 'Stephanos Sovereign Commander',
    daemonHealthy: true, healthyAfter: true, requiredCapabilityVersion: '2026-10-18-island-action-contract-v6',
    capabilityVersionAfter: '2026-10-18-island-action-contract-v6', vendorMeterRequired: false,
    externalSaasRelayRequired: false, arbitraryShellAllowed: false, pcRestartAllowed: false,
    visiblePowerShellRequired: false, vrResourceGovernorHealthy: true, vrResourceGovernorAdoption: observation, ...receipt };
  const calls = [];
  const adapter = createFixedPostSyncRuntimeAdapter({ spawnSyncFn(command, args) {
    calls.push({ command, args });
    return String(command).toLowerCase().includes('powershell')
      ? { status, stdout: JSON.stringify(payload), stderr: '' }
      : { status: 0, stdout: B + '\n', stderr: '' };
  } });
  return { adapter, calls };
}

test('actual fixed adapter derives Governor proof only from the successful observed watchdog, independently of relay work', () => {
  const paths = { repoRoot: 'C:/fixture/repo' };
  for (const [receipt, status] of [[{ vrResourceGovernorAdoption: null }, 0], [{ vrResourceGovernorHealthy: false }, 0],
    [{ vrResourceGovernorHealthy: 'true' }, 0], [{}, 4], [{}, 2],
    [{ vrResourceGovernorAdoption: { ...proof(), sourceHead: A } }, 0]]) {
    const fx = adapterFixture(receipt, status);
    const denied = fx.adapter.refreshSovereignCommander({ afterHead: B, paths, requireGovernorProof: true });
    assert.equal(denied.ok, false);
    assert.equal(denied.blocker, 'SOVEREIGN_GOVERNOR_REFRESH_PROOF_UNPROVEN');
    assert.equal(denied.governorProof, null);
    assert.equal(fx.calls.length, 2, 'No new executor: existing watchdog plus exact-head check');
    assert.equal(fx.adapter.refreshSovereignCommander({ afterHead: B, paths }).ok, true);
  }
  for (const status of [0, 3, 5]) {
    const accepted = adapterFixture({}, status).adapter.refreshSovereignCommander({ afterHead: B, paths, requireGovernorProof: true });
    assert.equal(accepted.ok, true);
    assert.deepEqual(accepted.governorProof, proof());
  }
});

test('scoped debt survives generic completions and reverted net deltas, but valid Governor evidence discharges it', () => {
  const pending = pendingPostSyncRefreshDebt([{ beforeHead: A, afterHead: B }], ['sovereign-commander'], '',
    { sovereignRelayRefreshRequired: false, governorRefreshRequired: true });
  assert.equal(inspectPendingPostSyncRefreshDebt(pending).governorRefreshRequired, true);
  assert.equal(inspectPendingPostSyncRefreshDebt({ ...pending, governorRefreshRequired: 'true' }).ok, false);
  assert.equal(pendingPostSyncRefreshDebt([{ beforeHead: A, afterHead: B }], [], '', { governorRefreshRequired: true }).state, 'HELD');
  const base = { spans: pending.spans, requiredTargetIds: pending.requiredTargetIds,
    sovereignRelayRefreshRequired: false, governorRefreshRequired: true, currentHead: C, isAncestor: ancestor };
  const generic = { ok: true, beforeHead: A, afterHead: C, targetIds: ['sovereign-commander'], sovereignRelayRefreshRequired: false };
  const unpaid = resolvePostSyncRefreshDebt({ ...base, requestedSpans: [{ beforeHead: B, afterHead: C }], completion: generic });
  assert.equal(unpaid.ok, true);
  assert.equal(unpaid.debt.beforeHead, A);
  assert.equal(unpaid.debt.afterHead, C);
  assert.equal(unpaid.debt.governorRefreshRequired, true);
  const paid = resolvePostSyncRefreshDebt({ ...base, completion: { ...generic, governorRefreshRequired: true, governorProof: proof(C) } });
  assert.equal(paid.ok, true);
  assert.equal(paid.debt, null);
  assert.equal(resolvePostSyncRefreshDebt({ ...base, completion: { ...generic, governorRefreshRequired: true } }).ok, false);
  assert.equal(resolvePostSyncRefreshDebt({ ...base, completion: { ...generic, governorRefreshRequired: true, governorProof: proof(B) } }).ok, false);
});

test('existing owner rejects old generic checkpoint and proves retained Governor obligation after a net revert', async t => {
  const root = await mkdtemp(join(tmpdir(), 'post-sync-governor-adoption-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = { repoRoot: join(root, 'repo'), workspaceRoot: join(root, 'workspace') };
  await mkdir(paths.repoRoot);
  const base = { inspectHeads: pass, isAncestor: ancestor, changedPaths: () => ({ ok: true, paths: [governor] }),
    refreshSovereignCommander: pass, reconcileControlPlane: pass };
  const failed = await runBattleBridgePostSyncRefresh({ paths, expectedPaths: paths, beforeHead: A, afterHead: B, adapter: base });
  assert.equal(failed.ok, false);
  assert.equal(failed.blocker, 'SOVEREIGN_GOVERNOR_REFRESH_PROOF_UNPROVEN');
  const statusPath = join(paths.workspaceRoot, 'status', 'post-sync-runtime-refresh-current.json');
  const record = JSON.parse(await readFile(statusPath, 'utf8'));
  assert.equal(record.governorRefreshRequired, true);
  const collected = collectPostSyncRefreshDebt({ refreshRecord: record });
  assert.equal(collected.governorRefreshRequired, true);
  record.phase = 'checkpoint-1'; record.classification = 'REFRESH_READY'; record.blocker = '';
  record.resultTargets = [{ targetId: 'sovereign-commander', ...pass(), blocker: '' }];
  await writeFile(statusPath, JSON.stringify(record));
  const fx = adapterFixture();
  const accepted = await runBattleBridgePostSyncRefresh({ paths, expectedPaths: paths, beforeHead: A, afterHead: B,
    adapter: { ...base, changedPaths: () => ({ ok: true, paths: ['docs/reverted-governor.md'] }),
      refreshSovereignCommander: input => {
        assert.equal(input.requireGovernorProof, true);
        assert.equal(input.requireSovereignRelayProof, false);
        assert.deepEqual(JSON.parse(readFileSync(statusPath, 'utf8')).resultTargets, []);
        return fx.adapter.refreshSovereignCommander(input);
      } } });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.governorRefreshRequired, true);
  assert.deepEqual(accepted.resultTargets[0].governorProof, proof());
  assert.equal(inspectPostSyncRefreshCompletion({ ...accepted, phase: 'complete' }).ok, true);
  const reused = await runBattleBridgePostSyncRefresh({ paths, expectedPaths: paths, beforeHead: A, afterHead: B,
    adapter: { ...base, refreshSovereignCommander: () => assert.fail('Proven same-head adoption should not replay') } });
  assert.equal(reused.ok, true);
  assert.equal(reused.retainedCompletionReused, true);
});

test('real Windows PowerShell 5.1 native Git reads bind HEAD and source blobs without terminating upstream output', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'governor-source-git-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const loader = String.raw`$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Set-StrictMode -Version Latest
$data=[Console]::In.ReadToEnd() | ConvertFrom-Json
if($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1){throw 'ACTUAL_WINDOWS_POWERSHELL_51_REQUIRED'}
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($data.source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'SOURCE_PARSE_FAILED'}
$names=@('Get-VrResourceGovernorSourceHead','Get-VrResourceGovernorSourceObservation')
$functions=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -cin $names},$false))
if($functions.Count -ne 2){throw 'SOURCE_FUNCTIONS_UNPROVEN'}
foreach($fn in $functions){. ([ScriptBlock]::Create($fn.Extent.Text))}
$gitExe='C:\Program Files\Git\cmd\git.exe'
$repoRoot=[IO.Path]::GetFullPath([string]$data.fixtureRoot)
$vrGovernorScript=Join-Path $repoRoot 'scripts\windows\run-vr-resource-governor.ps1'
$gitArgs=@('-c','core.hooksPath=','-c','commit.gpgsign=false','-c','core.autocrlf=false',
 '-c','user.name=Stephanos isolated regression','-c','user.email=fixture@example.invalid',
 '-c','credential.helper=','-c','protocol.allow=never')
$initial=@(& $gitExe @gitArgs init --quiet $repoRoot 2>&1)
if($LASTEXITCODE -ne 0){throw 'FIXTURE_INIT_FAILED'}
[void][IO.Directory]::CreateDirectory((Split-Path -Parent $vrGovernorScript))
$utf8=[Text.UTF8Encoding]::new($false,$true)
$lf=$utf8.GetBytes('# canonical isolated Governor source'+[char]10)
[IO.File]::WriteAllBytes($vrGovernorScript,$lf)
$added=@(& $gitExe @gitArgs -C $repoRoot add -- scripts/windows/run-vr-resource-governor.ps1 2>&1)
if($LASTEXITCODE -ne 0){throw 'FIXTURE_ADD_FAILED'}
$committed=@(& $gitExe @gitArgs -C $repoRoot commit --quiet --no-verify -m 'Isolated source-observer regression fixture' 2>&1)
if($LASTEXITCODE -ne 0){throw 'FIXTURE_COMMIT_FAILED'}
$expectedHead=[string](& $gitExe @gitArgs -C $repoRoot rev-parse HEAD)
if($LASTEXITCODE -ne 0 -or $expectedHead -cnotmatch '^[a-f0-9]{40}$'){throw 'FIXTURE_HEAD_UNPROVEN'}
$expectedBlob=[string](& $gitExe @gitArgs -C $repoRoot rev-parse ($expectedHead+':scripts/windows/run-vr-resource-governor.ps1'))
if($LASTEXITCODE -ne 0 -or $expectedBlob -cnotmatch '^[a-f0-9]{40}$'){throw 'FIXTURE_BLOB_UNPROVEN'}
$observedHead=Get-VrResourceGovernorSourceHead
$headExit=$LASTEXITCODE
$lfObservation=Get-VrResourceGovernorSourceObservation
$lfExit=$LASTEXITCODE
$crlf=$utf8.GetBytes('# canonical isolated Governor source'+[char]13+[char]10)
[IO.File]::WriteAllBytes($vrGovernorScript,$crlf)
$crlfObservation=Get-VrResourceGovernorSourceObservation
$crlfExit=$LASTEXITCODE
[IO.File]::WriteAllBytes($vrGovernorScript,$utf8.GetBytes('# unapproved source bytes'+[char]10))
$dirtyObservation=Get-VrResourceGovernorSourceObservation
$sha=[Security.Cryptography.SHA256]::Create()
try{
 $lfDigest=([BitConverter]::ToString($sha.ComputeHash($lf))).Replace('-','').ToLowerInvariant()
 $crlfDigest=([BitConverter]::ToString($sha.ComputeHash($crlf))).Replace('-','').ToLowerInvariant()
}finally{$sha.Dispose()}
[pscustomobject]@{
 actualWindowsPowerShell51=($PSVersionTable.PSVersion.Major -eq 5 -and $PSVersionTable.PSVersion.Minor -eq 1)
 headMatches=($observedHead -ceq $expectedHead)
 headExit=$headExit
 canonicalBlobObserved=($expectedBlob -cmatch '^[a-f0-9]{40}$')
 lfAccepted=($null -ne $lfObservation)
 lfExit=$lfExit
 lfHeadMatches=($null -ne $lfObservation -and $lfObservation.sourceHead -ceq $expectedHead)
 lfRawDigestMatches=($null -ne $lfObservation -and $lfObservation.sourceSha256 -ceq $lfDigest)
 crlfAccepted=($null -ne $crlfObservation)
 crlfExit=$crlfExit
 crlfHeadMatches=($null -ne $crlfObservation -and $crlfObservation.sourceHead -ceq $expectedHead)
 crlfRawDigestMatches=($null -ne $crlfObservation -and $crlfObservation.sourceSha256 -ceq $crlfDigest)
 rawRepresentationsDiffer=($lfDigest -cne $crlfDigest)
 dirtyBytesRefused=($null -eq $dirtyObservation)
}|ConvertTo-Json -Compress`;
  const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(loader, 'utf16le').toString('base64')],
    { input: JSON.stringify({ source: readSource('scripts/windows/run-sovereign-commander-hidden.ps1'), fixtureRoot: root }),
      cwd: 'C:\\Windows\\System32', encoding: 'utf8', shell: false, windowsHide: true, timeout: 15_000, maxBuffer: 16_384 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    actualWindowsPowerShell51: true, headMatches: true, headExit: 0, canonicalBlobObserved: true,
    lfAccepted: true, lfExit: 0, lfHeadMatches: true, lfRawDigestMatches: true,
    crlfAccepted: true, crlfExit: 0, crlfHeadMatches: true, crlfRawDigestMatches: true,
    rawRepresentationsDiffer: true, dirtyBytesRefused: true,
  });
});

test('actual Windows PowerShell 5.1 Governor collector preserves its result array across real match operations', { skip: process.platform !== 'win32' }, () => {
  const loader = String.raw`$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Set-StrictMode -Version Latest
$data=[Console]::In.ReadToEnd() | ConvertFrom-Json
if($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1){throw 'ACTUAL_WINDOWS_POWERSHELL_51_REQUIRED'}
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($data.source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'SOURCE_PARSE_FAILED'}
$names=@('Get-VrResourceGovernorProcesses','Test-VrResourceGovernorProcessIdentity')
$functions=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -cin $names},$false))
if($functions.Count -ne 2){throw 'COLLECTOR_FUNCTIONS_UNPROVEN'}
foreach($fn in $functions){. ([ScriptBlock]::Create($fn.Extent.Text))}
$powershellExecutable='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$vrGovernorScript='C:\fixture\scripts\windows\run-vr-resource-governor.ps1'
$vrGovernorScriptPattern=[regex]::Escape($vrGovernorScript)
$tail='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$vrGovernorScript+'" -Action Watch'
$closedCommand='"'+$powershellExecutable+'" '+$tail
function New-FixtureGovernorRow {
 param([int]$OwnerPid)
 [pscustomobject]@{Name='powershell.exe';ProcessId=$OwnerPid;ExecutablePath=$powershellExecutable;
  CommandLine=$closedCommand+' ';CreationDate=[DateTime]::UtcNow.AddSeconds(-2)}
}
function Get-CimInstance {
 param([string]$ClassName,[string]$Filter,[string]$ErrorAction)
 if($ClassName -cne 'Win32_Process' -or $Filter -cne "Name='powershell.exe'" -or $ErrorAction -cne 'Stop'){throw 'FIXTURE_FIXED_QUERY_CHANGED'}
 if($scenario -ceq 'query-failure'){throw 'FIXTURE_QUERY_FAILED'}
 return $fixtureRows
}
$results=@()
foreach($scenario in @('zero','one','multiple','opaque-first','opaque-after-match','query-failure','wrong-image','future-birth','invalid-pid','extra-command')){
 $first=New-FixtureGovernorRow 42
 $second=New-FixtureGovernorRow 43
 $opaque=New-FixtureGovernorRow 44
 $opaque.CommandLine=$null
 $fixtureRows=@($first)
 switch -Exact ($scenario){
  'zero' {$first.CommandLine='powershell.exe -NoProfile -File C:\fixture\unrelated.ps1'}
  'multiple' {$fixtureRows=@($first,$second)}
  'opaque-first' {$fixtureRows=@($opaque,$first)}
  'opaque-after-match' {$fixtureRows=@($first,$opaque)}
  'wrong-image' {$first.ExecutablePath='C:\fixture\other\powershell.exe'}
  'future-birth' {$first.CreationDate=[DateTime]::UtcNow.AddMinutes(1)}
  'invalid-pid' {$first.ProcessId=0}
  'extra-command' {$first.CommandLine=$closedCommand+' extra'}
 }
 $script:vrGovernorInventoryComplete=$true
 $observed=@(Get-VrResourceGovernorProcesses)
 $results+=,[pscustomobject]@{scenario=$scenario;complete=[bool]$script:vrGovernorInventoryComplete;count=$observed.Count}
}
ConvertTo-Json -InputObject $results -Compress`;
  const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(loader, 'utf16le').toString('base64')],
    { input: JSON.stringify({ source: readSource('scripts/windows/run-sovereign-commander-hidden.ps1') }),
      cwd: 'C:\\Windows\\System32', encoding: 'utf8', shell: false, windowsHide: true, timeout: 10_000, maxBuffer: 16_384 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    { scenario: 'zero', complete: true, count: 0 },
    { scenario: 'one', complete: true, count: 1 },
    { scenario: 'multiple', complete: true, count: 2 },
    ...['opaque-first', 'opaque-after-match', 'query-failure', 'wrong-image', 'future-birth', 'invalid-pid', 'extra-command']
      .map(scenario => ({ scenario, complete: false, count: 0 })),
  ]);
});
