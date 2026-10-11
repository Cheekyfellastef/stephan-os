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
    STEPHANOS_SOURCE_CUSTODY_VERIFIER_PUBLIC_KEY_PATH: '/host/custody/public.pem',
    STEPHANOS_SOURCE_CUSTODY_VERIFIER_KEY_PATH: '/host/custody/legacy-secret',
    STEPHANOS_SOURCE_CUSTODY_SIGNING_KEY_PATH: '/host/custody/private.pem',
    STEPHANOS_GITHUB_AUTH_PRIVATE_KEY_PATH: '/host/secret/gh.pem',
    GH_TOKEN: 'forbidden',
    OPENAI_API_KEY: 'forbidden',
    CUSTOM_SECRET: 'forbidden',
    STEPHANOS_SOURCE_JOB_CUSTODY_REQUIRED: '1',
  };
  const safe = sanitizeSourceCustodyChildEnvironment(hostile);
  assert.equal(safe.PATH, '/trusted');
  assert.equal(safe.SystemRoot, '/windows');
  assert.equal(safe.STEPHANOS_SOURCE_JOB_CUSTODY_REQUIRED, '1');
  for (const name of Object.keys(hostile).filter(k => k !== 'PATH' && k !== 'SystemRoot'
    && k !== 'STEPHANOS_SOURCE_JOB_CUSTODY_REQUIRED')) {
    assert.equal(Object.hasOwn(safe, name), false, name);
  }
  const seen = [];
  const run = createRequiredSourceJobCommandRunner({ ...context,
    env: hostile,
    spawnSync: (_, __, options) => { seen.push(options.env); return { status: 0 }; },
  });
  assert.equal(run('node.exe', ['-e', 'process.exit(0)'], { cwd: '/worktree' }).status, 0);
  assert.deepEqual(seen, [safe]);
  assert.equal(hostile.GH_TOKEN, 'forbidden'); // no caller-visible env mutation
});
