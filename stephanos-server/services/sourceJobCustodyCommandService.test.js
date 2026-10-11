import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequiredSourceJobCommandRunner, sanitizeSourceCustodyChildEnvironment, sourceJobCustodyRequired } from './sourceJobCustodyCommandService.js';

const env = Object.freeze({
  SystemRoot: '/windows',
  STEPHANOS_SOURCE_CUSTODY_GIT_EXE: '/trusted/git.exe',
});
const context = {
  env,
  platform: 'win32',
  nodePath: '/trusted/node.exe',
  script: '/runner/Invoke-StephanosSourceJobCustody.ps1',
  existsSync: () => true,
  inspectLocalGitConfig: () => ({ ok: true }),
};
test('custody is opt-in and exact flag value only', () => {
  assert.equal(sourceJobCustodyRequired({}), false);
  assert.equal(sourceJobCustodyRequired({ STEPHANOS_SOURCE_JOB_CUSTODY_REQUIRED: 'yes' }), false);
  assert.equal(sourceJobCustodyRequired({ STEPHANOS_SOURCE_JOB_CUSTODY_REQUIRED: '1' }), true);
});
test('required Win32 runner sends only exact allowlisted program and bounded argv to no-shell wrapper', () => {
  const seen = [];
  const run = createRequiredSourceJobCommandRunner({ ...context, spawnSync: (...args) => {
    seen.push(args); return { status: 0, stdout: 'checked', stderr: '' };
  }});
  assert.equal(run('git.exe', ['status', '--porcelain'], { cwd: '/worktree' }).status, 0);
  assert.equal(run('node.exe', ['--test', 'test.mjs'], { cwd: '/worktree' }).status, 0);
  assert.equal(seen.length, 2);
  assert.equal(seen[0][0], '/windows/System32/WindowsPowerShell/v1.0/powershell.exe');
  assert.equal(seen[0][1].includes('/trusted/git.exe'), true);
  assert.equal(seen[0][2].shell, false);
  const raw = seen[0][1][seen[0][1].indexOf('-ArgumentsBase64') + 1];
  assert.deepEqual(JSON.parse(Buffer.from(raw, 'base64').toString('utf8')), ['status', '--porcelain']);
  assert.equal(seen[1][1].includes('/trusted/node.exe'), true);
});
test('arbitrary executables and malformed/caller-smuggled argv cannot enter native custody runner', () => {
  let calls = 0;
  const run = createRequiredSourceJobCommandRunner({ ...context,
    spawnSync: () => { calls++; return { status: 0 }; } });
  for (const [program, argv, cwd] of [
    ['powershell.exe', ['-Command', 'Write-Host hi'], '/worktree'],
    ['node.exe', ['-e', 'abc\0def'], '/worktree'],
    ['git.exe', ['x'], 'relative/worktree'],
    ['git.exe', new Array(130).fill('x'), '/worktree'],
  ]) {
    const result = run(program, argv, { cwd });
    assert.ok(result.error instanceof Error);
    assert.notEqual(result.status, 0);
  }
  assert.equal(calls, 0);
});
test('Windows missing executable, repository root or custodian aborts without raw fallback', () => {
  let rawCalls = 0;
  const run = createRequiredSourceJobCommandRunner({ ...context,
    existsSync: () => false, spawnSync: () => { rawCalls++; return { status: 0 }; } });
  assert.match(run('node.exe', ['--check', 'x'], { cwd: '/worktree' }).error.message,
    /WORKTREE_UNPROVEN/);
  const linux = createRequiredSourceJobCommandRunner({ ...context, platform: 'linux',
    spawnSync: () => { rawCalls++; return { status: 0 }; } });
  assert.match(linux('node.exe', ['x'], { cwd: '/worktree' }).error.message, /WINDOWS_REQUIRED/);
  assert.equal(rawCalls, 0);
});
test('nonzero source runner status remains a failure and is never turned into proof', () => {
  const run = createRequiredSourceJobCommandRunner({ ...context,
    spawnSync: () => ({ status: 125, stdout: '', stderr: 'SOURCE_CUSTODY_BLOCKED' }) });
  const result = run('git.exe', ['status'], { cwd: '/worktree' });
  assert.equal(result.status, 125);
  assert.doesNotMatch(JSON.stringify(result), /NO_SOURCE_WRITING_DESCENDANTS/);
});
test('real source executor selects native custody in strict mode even with a runCommand injection', async () => {
  const source = await readFile(new URL('./providerNeutralSourceBuilderService.js', import.meta.url), 'utf8');
  assert.match(source, /sourceJobCustodyRequired\(options\.env \|\| process\.env\)/);
  assert.match(source, /createRequiredSourceJobCommandRunner\(\{ env: options\.env \|\| process\.env \}\)/);
  assert.match(source, /: options\.runCommand \|\| defaultRun;/);
});


test('source worker strips verifier paths, private keys and credentials before executing untrusted tests', () => {
  const hostile = {
    PATH: '/trusted',
    SystemRoot: '/windows',
    STEPHANOS_SOURCE_CUSTODY_GIT_EXE: '/trusted/git.exe',
    STEPHANOS_SOURCE_CUSTODY_VERIFIER_PUBLIC_KEY_PATH: '/host/custody/public.pem',
    STEPHANOS_SOURCE_CUSTODY_VERIFIER_KEY_PATH: '/host/custody/legacy-secret',
    STEPHANOS_SOURCE_CUSTODY_SIGNING_KEY_PATH: '/host/custody/private.pem',
    STEPHANOS_GITHUB_AUTH_PRIVATE_KEY_PATH: '/host/secret/gh.pem',
    GH_TOKEN: 'forbidden',
    OPENAI_API_KEY: 'forbidden',
    CUSTOM_SECRET: 'forbidden',
    STEPHANOS_SOURCE_JOB_CUSTODY_REQUIRED: '1',
  };
  const seen = [];
  const run = createRequiredSourceJobCommandRunner({ ...context,
    env: hostile,
    spawnSync: (_, __, options) => { seen.push(options.env); return { status: 0 }; },
  });
  assert.equal(run('node.exe', ['-e', 'process.exit(0)'], { cwd: '/worktree' }).status, 0);
  assert.equal(seen.length, 1);
  const safe = seen[0];
  assert.equal(safe.SystemRoot, '/windows');
  assert.equal(safe.OS, 'Windows_NT');
  assert.match(safe.USERPROFILE, /stephanos-source-custody-/);
  assert.equal(safe.HOME, safe.USERPROFILE);
  assert.equal(safe.TEMP, safe.USERPROFILE);
  assert.equal(safe.APPDATA, safe.USERPROFILE + '/Roaming');
  assert.equal(safe.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(safe.GIT_TERMINAL_PROMPT, '0');
  assert.equal(safe.GIT_CONFIG_GLOBAL, safe.HOME + '/nonexistent-git-config');
  assert.equal(safe.NODE_OPTIONS, '');
  for (const name of Object.keys(hostile).filter(k => k !== 'SystemRoot' && k !== 'PATH')) {
    assert.equal(Object.hasOwn(safe, name), false, name);
  }
  assert.equal(hostile.GH_TOKEN, 'forbidden'); // no caller-visible env mutation
});


test('child environment is closed-world against unconventionally named password and config channels', () => {
  const hostile = {
    SystemRoot: '/windows',
    HOME: '/Users/operator',
    USERPROFILE: '/Users/operator',
    SSH_AUTH_SOCK: '\\\\.\\pipe\\ssh-agent',
    GIT_ASKPASS: '/Users/operator/helper.sh',
    API_PASSWORD: 'password',
    GOOGLE_APPLICATION_CREDENTIALS: '/Users/operator/auth.json',
    AWS_SHARED_CREDENTIALS_FILE: '/Users/operator/.aws/credentials',
    GH_TOKEN: 'secret',
    GITHUB_TOKEN: 'secret',
    NPM_CONFIG_USERCONFIG: '/Users/operator/.npmrc',
    GIT_CONFIG_GLOBAL: '/Users/operator/.gitconfig',
    NODE_OPTIONS: '--require /Users/operator/steal.js',
    CUSTOM_OAUTH_REFRESH: 'secret',
    MY_RANDOM_AUTH_CHANNEL: 'secret',
    PATH: '/Users/operator/bin',
  };
  const safe = sanitizeSourceCustodyChildEnvironment(hostile, '/isolated/home', {
    systemRoot: '/windows', nodePath: '/trusted/node.exe', gitPath: '/trusted/git.exe',
  });
  for (const key of [
    'SSH_AUTH_SOCK', 'GIT_ASKPASS', 'API_PASSWORD', 'GOOGLE_APPLICATION_CREDENTIALS',
    'AWS_SHARED_CREDENTIALS_FILE', 'GH_TOKEN', 'GITHUB_TOKEN',
    'CUSTOM_OAUTH_REFRESH', 'MY_RANDOM_AUTH_CHANNEL',
  ]) assert.equal(Object.hasOwn(safe, key), false, key);
  assert.equal(safe.USERPROFILE, '/isolated/home');
  assert.equal(safe.HOME, '/isolated/home');
  assert.equal(safe.GIT_TERMINAL_PROMPT, '0');
  assert.equal(safe.NODE_OPTIONS, '');
  assert.equal(safe.PATH.includes('/Users/operator'), false);
  assert.equal(JSON.stringify(safe).includes('secret'), false);
  assert.equal(JSON.stringify(safe).includes('password'), false);
});

test('closed-world child environment rejects absent trusted roots, not inherited fallbacks', () => {
  for (const roots of [
    { systemRoot: '', nodePath: '/trusted/node.exe', gitPath: '/trusted/git.exe' },
    { systemRoot: '/windows', nodePath: '', gitPath: '/trusted/git.exe' },
    { systemRoot: '/windows', nodePath: '/trusted/node.exe', gitPath: '' },
  ]) {
    assert.throws(() => sanitizeSourceCustodyChildEnvironment({ API_PASSWORD: 'secret' },
      '/sandbox', roots), /SOURCE_CUSTODY_ENVIRONMENT_ROOTS_UNPROVEN/);
  }
});

test('temporary profile is cleaned after subprocess failure without raw retry', () => {
  const removed = [];
  const run = createRequiredSourceJobCommandRunner({ ...context,
    mkdtempSync: () => '/transient/source-home',
    mkdirSync: () => {},
    rmSync: (path) => { removed.push(path); },
    spawnSync: () => ({ status: 125, stderr: 'SOURCE_CUSTODY_BLOCKED' }),
  });
  const result = run('node.exe', ['--test', 'test.mjs'], { cwd: '/worktree' });
  assert.equal(result.status, 125);
  assert.deepEqual(removed, ['/transient/source-home']);
});


test('disposable source profile cleanup failure is an explicit blocked outcome', () => {
  const run = createRequiredSourceJobCommandRunner({
    ...context,
    mkdtempSync: () => '/transient/source-home',
    mkdirSync: () => {},
    rmSync: () => { throw new Error('mock cleanup denied'); },
    spawnSync: () => ({ status: 0, stdout: 'untrusted-success' }),
  });
  const result = run('node.exe', ['--test', 'test.mjs'], { cwd: '/worktree' });
  assert.notEqual(result.status, 0);
  assert.match(result.error.message, /DISPOSABLE_PROFILE_CLEANUP_FAILED/);
  assert.equal(result.stdout, '');
});


test('strict source runner refuses credential-bearing local Git configuration before Node or Git execution', () => {
  const removed = [];
  let invoked = 0;
  const run = createRequiredSourceJobCommandRunner({
    ...context,
    inspectLocalGitConfig: () => ({ ok: false, reason: 'LOCAL_GIT_CONFIG_UNKNOWN_OR_CREDENTIAL_CAPABLE_KEY' }),
    mkdtempSync: () => '/tmp/isolated-source-custody',
    mkdirSync: () => {},
    rmSync: value => removed.push(value),
    spawnSync: () => { invoked++; return { status: 0 }; },
  });
  for (const executable of ['node.exe', 'git.exe']) {
    const rejected = run(executable, ['--version'], { cwd: '/worktree' });
    assert.equal(rejected.status, null);
    assert.match(rejected.error.message, /LOCAL_GIT_CONFIG_UNSAFE/);
  }
  assert.equal(invoked, 0);
  assert.deepEqual(removed, ['/tmp/isolated-source-custody', '/tmp/isolated-source-custody']);
});

test('strict source runner passes only its isolated environment to trusted local Git inspection', () => {
  const observed = [];
  const env = {
    ...context.env,
    GIT_ASKPASS: 'attacker.exe',
    API_PASSWORD: 'attacker',
    GH_TOKEN: 'attacker',
  };
  const run = createRequiredSourceJobCommandRunner({
    ...context,
    env,
    inspectLocalGitConfig: (cwd, git, isolated) => {
      observed.push({ cwd, git, isolated });
      return { ok: true };
    },
    spawnSync: () => ({ status: 0, stdout: 'safe', stderr: '' }),
  });
  assert.equal(run('node.exe', ['-e', 'console.log("safe")'], { cwd: '/worktree' }).status, 0);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].cwd, '/worktree');
  assert.equal(observed[0].git, '/trusted/git.exe');
  assert.equal(observed[0].isolated.GIT_ASKPASS, undefined);
  assert.equal(observed[0].isolated.API_PASSWORD, undefined);
  assert.equal(observed[0].isolated.GH_TOKEN, undefined);
});


test('source command rejects an alternate -C worktree and attacker-supplied Git config override', () => {
  const invoked = [];
  const run = createRequiredSourceJobCommandRunner({
    ...context,
    spawnSync: (_, args) => { invoked.push(args); return { status: 0 }; },
  });
  for (const args of [
    ['-C', '/another-worktree', 'status'],
    ['-C/another-worktree', 'status'],
    ['-c', 'credential.helper=!steal', 'status'],
    ['--config-env=credential.helper=STEAL', 'status'],
    ['--git-dir=/another-worktree/.git', 'status'],
    ['--work-tree=/another-worktree', 'status'],
  ]) {
    const outcome = run('git.exe', args, { cwd: '/worktree' });
    assert.notEqual(outcome.status, 0, JSON.stringify(args));
    assert.equal(outcome.stdout, '', JSON.stringify(args));
  }
  assert.equal(invoked.length, 0);
  assert.equal(run('git.exe', ['-C', '/worktree', 'status'], { cwd: '/worktree' }).status, 0);
  assert.equal(invoked.length, 1);
});
