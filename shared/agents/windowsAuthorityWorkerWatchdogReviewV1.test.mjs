import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1,
  analyzeWindowsAuthorityWorkerWatchdogReview,
} from './windowsAuthorityWorkerWatchdogReviewV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const head = 'a'.repeat(40);
const blob = (content) => { const bytes = Buffer.from(content); return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'); };
const record = (path, content) => ({ schemaVersion: 'stephanos.windows-authority-source.v1', repository, path, ref: head, exists: true, size: Buffer.byteLength(content), blobSha: blob(content), content });
const analysis = { findings: WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1.map((path) => ({ severity: 'P0', code: 'unsupported-high-risk-surface', path })) };

const fixtures = Object.freeze({
  [WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[0]]: [
    "[ValidateSet('Inspect', 'StartApprovedWorkerTask')]", "$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git.exe'", "$canonicalPowerShell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'", "$publicRemote = 'https://github.com/Cheekyfellastef/stephan-os.git'", "status '--porcelain=v1' '--untracked-files=no'", '$trackedStatusAfterRestart', "'-Target', 'mission-worker', '-ExpectedHead', $repositoryHead, '-TimeoutSeconds', '30'", '$restartReceipt.exactHeadProofOk -eq $true', '$restartReceipt.proofFresh -eq $true',
  ].join('\n'),
  [WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[1]]: [
    "[ValidateSet('backend', 'mission-worker')]", "$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git.exe'", 'CANONICAL_TRACKED_SOURCE_DIRTY', "Start-ScheduledTask -TaskName $plan.TaskName -TaskPath '\\'", 'CANONICAL_TRACKED_SOURCE_CHANGED_DURING_WORKER_START', "Stop-ScheduledTask -TaskName $plan.TaskName -TaskPath '\\' -ErrorAction SilentlyContinue", 'Get-VerifiedWorkerProcessFromHeartbeat', 'Stop-Process -Id $startedWorker.ProcessId', 'headSha -ne $ExpectedSourceHead', 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT',
  ].join('\n'),
  [WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[2]]: [
    "$canonicalNode = 'C:\\Program Files\\nodejs\\node.exe'", "$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git.exe'", 'branch --show-current', "$branch -ne 'main'", "status '--porcelain=v1' '--untracked-files=no'", 'tracked-clean exact-head source', "ls-remote' '--exit-code' $publicRemote 'refs/heads/main'", 'exact current public main head', '& $canonicalNode $workerScript',
  ].join('\n'),
});

const review = (overrides = {}) => analyzeWindowsAuthorityWorkerWatchdogReview({ repository, sourceHead: head, analysis, sources: Object.entries(fixtures).map(([path, content]) => record(path, content)), ...overrides });
const codes = (result) => result.findings.map((item) => item.code);

test('owns exactly the three worker-watchdog authority paths and accepts their bounded contract', () => {
  assert.deepEqual(WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1, [
    'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1',
    'scripts/windows/restart-approved-stephanos-runtime.ps1',
    'scripts/windows/start-mission-orchestrator-worker.ps1',
  ]);
  const result = review();
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true, JSON.stringify(result.findings));
  assert.equal(result.proofRefs.length, 3);
});

test('rejects partial, widened or non-watchdog escalation estates', () => {
  for (const paths of [
    WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1.slice(0, 2),
    [...WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1, 'scripts/windows/other.ps1'],
  ]) {
    const result = review({ analysis: { findings: paths.map((path) => ({ severity: 'P0', code: 'unsupported-high-risk-surface', path })) } });
    assert.equal(result.eligible, false);
  }
});

test('rejects unbound source evidence', () => {
  const sources = Object.entries(fixtures).map(([path, content]) => record(path, content));
  sources[0].blobSha = 'b'.repeat(40);
  assert.ok(codes(review({ sources })).includes('windows-authority-source-evidence-invalid'));
});

test('rejects each removed exact-head, clean-source, fixed-executable or owned-cleanup invariant', () => {
  const mutations = [
    [0, "$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git.exe'", '$git = Get-Command git', 'watchdog-probe-git-not-fixed'],
    [0, '$trackedStatusAfterRestart', '', 'watchdog-probe-clean-recheck-missing'],
    [1, 'CANONICAL_TRACKED_SOURCE_DIRTY', '', 'watchdog-restart-clean-boundary-incomplete'],
    [1, 'Stop-Process -Id $startedWorker.ProcessId', 'Stop-Process -Name node', 'watchdog-restart-dirty-cleanup-missing'],
    [2, "status '--porcelain=v1' '--untracked-files=no'", '', 'watchdog-launcher-clean-proof-missing'],
    [2, '& $canonicalNode $workerScript', '& node $env:CALLER_SCRIPT', 'watchdog-launcher-node-invocation-not-fixed'],
  ];
  for (const [index, from, to, expected] of mutations) {
    const changed = { ...fixtures, [WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[index]]: fixtures[WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[index]].replace(from, to) };
    const result = review({ sources: Object.entries(changed).map(([path, content]) => record(path, content)) });
    assert.ok(codes(result).includes(expected), expected);
  }
});

test('top-level specialist pins and routes the watchdog reviewer before the legacy core', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./windowsAuthoritySpecialistReviewV1.mjs', import.meta.url), 'utf8');
  assert.match(source, /WORKER_WATCHDOG_BLOB_SHA = '050c3fa400530b58a0d766395ce78f2acd657c12'/);
  assert.ok(source.indexOf('analyzeWindowsAuthorityWorkerWatchdogReview') < source.indexOf('core.analyzeWindowsAuthoritySpecialistReview'));
});
