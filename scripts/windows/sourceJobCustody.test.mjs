import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, mkdtemp, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequiredSourceJobCommandRunner } from '../../stephanos-server/services/sourceJobCustodyCommandService.js';

const powershell = 'powershell.exe';
const script = resolve('scripts/windows/Invoke-StephanosSourceJobCustody.ps1');
const encode = (args) => Buffer.from(JSON.stringify(args), 'utf8').toString('base64');

function invoke(worktree, args, timeoutSeconds = 10, executable = process.execPath) {
  return spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy',
    'Bypass', '-File', script, '-Executable', executable, '-Worktree', worktree,
    '-ArgumentsBase64', encode(args), '-TimeoutSeconds', String(timeoutSeconds)], {
    cwd: worktree, encoding: 'utf8', timeout: (timeoutSeconds + 30) * 1000,
    maxBuffer: 256 * 1024,
    windowsHide: true,
  });
}

test('Windows custodian has no issuer key / attestation path or public shell', async () => {
  const source = await readFile('scripts/windows/StephanosSourceJobCustody.cs', 'utf8');
  const wrapper = await readFile(script, 'utf8');
  assert.match(source, /CREATE_SUSPENDED/);
  assert.match(source, /AssignProcessToJobObject/);
  assert.match(source, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(source, /JobObjectBasicAccountingInformation/);
  assert.match(source, /JobMembersExited/);
  assert.match(source, /WholeSourceWriterExclusionProven \{ get \{ return false; \} \}/);
  assert.doesNotMatch(source, /result\.AllProcessesExited/);
  assert.match(wrapper, /WMI/);
  assert.match(source, /TerminateJobObject/);
  assert.match(wrapper, /SOURCE_CUSTODY_OS_LIFETIME_UNPROVEN/);
  assert.doesNotMatch(wrapper, /hmac|privatekey|writefile/i);
  assert.doesNotMatch(source, /hmac|privatekey/i);
});

test('Windows Job Object contains a clean bounded node command and relays exit status', {
  skip: process.platform !== 'win32',
}, async () => {
  const worktree = await mkdtemp(join(tmpdir(), 'source-job-positive-'));
  try {
    const good = invoke(worktree, ['-e', 'process.stdout.write("job-custody-pass")'], 8);
    assert.equal(good.status, 0, 'stderr=' + good.stderr);
    assert.match(good.stdout, /job-custody-pass/);
    const negative = invoke(worktree, ['-e', 'process.exit(9)'], 8);
    assert.equal(negative.status, 9, 'stderr=' + negative.stderr);
  } finally { await rm(worktree, { recursive: true, force: true }); }
});

test('Windows Job Object fails closed and terminates detached grandchildren before their late write', {
  skip: process.platform !== 'win32',
}, async () => {
  const worktree = await mkdtemp(join(tmpdir(), 'source-job-descendant-'));
  const marker = join(worktree, 'late-mutation-attempt');
  try {
    const grandson = 'setTimeout(() => require("node:fs").writeFileSync(' +
      JSON.stringify(marker) + ', "escaped"), 3000)';
    const parent = 'const {spawn}=require("node:child_process");' +
      'const child=spawn(process.execPath,["-e",' + JSON.stringify(grandson) +
      '],{detached:true,stdio:"ignore"}); child.unref();';
    const run = invoke(worktree, ['-e', parent], 1);
    assert.equal(run.status, 125, 'stdout=' + run.stdout + ' stderr=' + run.stderr);
    assert.match(run.stderr, /SOURCE_CUSTODY_BLOCKED:/);
    await new Promise(r => setTimeout(r, 3600));
    await assert.rejects(access(marker), /ENOENT/);
  } finally { await rm(worktree, { recursive: true, force: true }); }
});

test('Windows Job Object refuses unallowlisted executables without launching a shell', {
  skip: process.platform !== 'win32',
}, async () => {
  const worktree = await mkdtemp(join(tmpdir(), 'source-job-allowlist-'));
  try {
    const denied = invoke(worktree, ['/C', 'exit', '0'], 2,
      join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'));
    assert.equal(denied.status, 125);
    assert.match(denied.stderr, /SOURCE_CUSTODY_EXECUTABLE_NOT_ALLOWLISTED/);
  } finally { await rm(worktree, { recursive: true, force: true }); }
});

test('actual Windows source-builder adapter invokes contained node and refuses raw fallback', {
  skip: process.platform !== 'win32',
}, async () => {
  const worktree = await mkdtemp(join(tmpdir(), 'source-job-adapter-integrated-'));
  try {
    const located = spawnSync('where.exe', ['git.exe'], {
      encoding: 'utf8', windowsHide: true, timeout: 10000,
    });
    assert.equal(located.status, 0, 'required trusted Git executable not located');
    const gitExe = located.stdout.split(/\r?\n/).map(x => x.trim())
      .find(x => x.toLowerCase().endsWith('git.exe'));
    assert.ok(gitExe, 'Git executable path not found');
    // The production gate is fail-closed for arbitrary/non-Git worktrees.
    // Build a safe, credential-free local checkout fixture for integration.
    const initialized = spawnSync(gitExe, ['init', '-q', worktree], {
      encoding: 'utf8', windowsHide: true, timeout: 10000,
    });
    assert.equal(initialized.status, 0, 'git init fixture: ' + initialized.stderr);
    const remoteAdded = spawnSync(gitExe, ['-C', worktree, 'remote', 'add', 'origin',
      'https://github.com/Cheekyfellastef/stephan-os.git'], {
      encoding: 'utf8', windowsHide: true, timeout: 10000,
    });
    assert.equal(remoteAdded.status, 0, 'git remote fixture: ' + remoteAdded.stderr);
    const ambient = {
      ...process.env,
      STEPHANOS_SOURCE_CUSTODY_GIT_EXE: gitExe,
      API_PASSWORD: 'synthetic-hostile-password',
      GIT_ASKPASS: 'synthetic-hostile-helper',
      GOOGLE_APPLICATION_CREDENTIALS: 'synthetic-hostile-cloud-file',
      GH_TOKEN: 'synthetic-hostile-gh-token',
    };
    const run = createRequiredSourceJobCommandRunner({ env: ambient, timeoutMs: 15000 });
    const good = run('node.exe', ['-e', [
      'const assert=require("node:assert/strict");',
      'for(const k of ["API_PASSWORD","GIT_ASKPASS","GOOGLE_APPLICATION_CREDENTIALS","GH_TOKEN"])',
      '  assert.equal(process.env[k],undefined,k);',
      'assert.ok(process.env.HOME.includes("stephanos-source-custody-"));',
      'process.stdout.write("custody-adapter-pass");',
    ].join('')], {
      cwd: worktree, env: ambient,
    });
    assert.equal(good.status, 0, 'stderr=' + good.stderr);
    assert.match(good.stdout, /custody-adapter-pass/);
    const poison = spawnSync(gitExe, ['-C', worktree, 'config', '--local',
      'http.https://github.com/.extraheader', 'AUTHORIZATION: basic synthetic-not-secret'], {
      encoding: 'utf8', windowsHide: true, timeout: 10000,
    });
    assert.equal(poison.status, 0, 'config hostile fixture: ' + poison.stderr);
    const blockedLocal = run('node.exe', ['-e', 'process.stdout.write("unsafe")'], {
      cwd: worktree, env: ambient,
    });
    assert.equal(blockedLocal.status, null);
    assert.match(blockedLocal.error?.message || '', /LOCAL_GIT_CONFIG_UNSAFE/);
    assert.equal(blockedLocal.stdout, '');

    const denied = run('powershell.exe', ['-Command', 'exit 0'], { cwd: worktree });
    assert.ok(denied.error instanceof Error);
    assert.match(denied.error.message, /EXECUTABLE_NOT_ALLOWLISTED/);
  } finally { await rm(worktree, { recursive: true, force: true }); }
});
