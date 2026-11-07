import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, existsSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { planWindowsSovereignReviewerV1, runWindowsSovereignReviewerV1,
  verifyWslReviewerExecutableBytesV1, REVIEWER_CRITICAL_SOURCE_PATHS,
} from './sovereign-reviewer-wsl-bridge-v1.mjs';
import { main as runStandardReview } from './sovereign-reviewer-v1.mjs';
import { inspectLocalCalibrationGitIdentityV1 } from './sovereign-reviewer-ollama-calibration-v1.mjs';
import { resolveBattleBridgeGitExecution } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';

const ROOT = 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os';
const canonicalConfig = 'remote.origin.url\nhttps://github.com/Cheekyfellastef/stephan-os.git\0';
const env = Object.freeze({
  STEPHANOS_SHARED_AGENT_WORKSPACE: 'C:\\Users\\Operator\\Documents\\Stephanos-openclaw-workspace',
  STEPHANOS_REVIEW_EXACT_HEAD: 'a'.repeat(40),
  STEPHANOS_REVIEW_EXACT_BASE: 'b'.repeat(40),
  STEPHANOS_REVIEW_EXACT_BRANCH: 'fix/repair-3059',
  STEPHANOS_REVIEW_REPOSITORY: 'Cheekyfellastef/stephan-os',
  STEPHANOS_REVIEW_ISSUE: '3059',
  STEPHANOS_REVIEW_PR: '3059',
  STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER: 'github-builder',
  STEPHANOS_REVIEW_IMPLEMENTER_SESSION: 'builder-session-1',
  STEPHANOS_REVIEW_SESSION: 'reviewer-session-2',
  STEPHANOS_SOVEREIGN_REVIEW_MODEL: 'qwen:14b',
});
// Existing receipt/WSL transport fixtures validate the post-attestation path.
// Dedicated tests below validate the production pre-launch attestor itself.
const context = { platform: 'win32', sourceRoot: ROOT, exists: () => true,
  verifySource: () => ({ ok: true }) };

test('Windows runner admits only fixed reviewed source and exact PR/head identity', () => {
  const plan = planWindowsSovereignReviewerV1(env, context);
  assert.equal(plan.ok, true);
  assert.equal(plan.reviewer, ROOT + '\\scripts\\sovereign-reviewer-v1.mjs');
  assert.equal(plan.mergeAuthority, false);
  assert.deepEqual(Object.keys(plan.reviewEnv).sort(), [
    'STEPHANOS_REVIEW_EXACT_HEAD', 'STEPHANOS_REVIEW_EXACT_BASE',
    'STEPHANOS_REVIEW_EXACT_BRANCH', 'STEPHANOS_REVIEW_REPOSITORY',
    'STEPHANOS_REVIEW_ISSUE', 'STEPHANOS_REVIEW_PR',
    'STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER', 'STEPHANOS_REVIEW_IMPLEMENTER_SESSION',
    'STEPHANOS_REVIEW_SESSION', 'STEPHANOS_SOVEREIGN_REVIEW_MODEL',
  ].sort());
});

test('Windows bridge refuses unsupported platform, fake path, missing identity, hostile WSL output', () => {
  const cases = [
    { env, options: { ...context, platform: 'linux' }, reason: 'WINDOWS_HOST_REQUIRED' },
    { env, options: { ...context, sourceRoot: '\\\\attacker\\share' }, reason: 'REVIEWER_SOURCE_UNAVAILABLE' },
    { env, options: { ...context, exists: () => false }, reason: 'REVIEWER_SOURCE_UNAVAILABLE' },
    { env: { ...env, STEPHANOS_REVIEW_EXACT_HEAD: 'none' }, options: context, reason: 'EXACT_GIT_IDENTITY_REQUIRED' },
    { env: { ...env, STEPHANOS_SHARED_AGENT_WORKSPACE: '\\\\server\\share' }, options: context, reason: 'LOCAL_WORKSPACE_REQUIRED' },
    { env: { ...env, STEPHANOS_REVIEW_SESSION: '' }, options: context, reason: 'INDEPENDENT_REVIEW_IDENTITIES_REQUIRED' },
    { env: { ...env, STEPHANOS_REVIEW_SESSION: 'BUILDER-SESSION-1' },
      options: context, reason: 'REVIEWER_IMPLEMENTER_SESSION_COLLISION' },
  ];
  for (const entry of cases) {
    const got = runWindowsSovereignReviewerV1(entry.env, { ...entry.options, spawn() { throw Error('unexpected call'); } });
    assert.equal(got.ok, false);
    assert.equal(got.reason, entry.reason);
  }
  const poisoned = runWindowsSovereignReviewerV1(env, { ...context, spawn: () => ({ status: 0, stdout: '../outside\n' }) });
  assert.equal(poisoned.reason, 'WSL_INSTALLED_REVIEWER_PROFILE_REQUIRED');
});

test('trusted WSL git verifies every reviewer executable and imported policy file before launch', () => {
  const root = '/mnt/c/Users/Operator/Documents/GitHub/stephan-os';
  const reviewerPath = root + '/scripts/sovereign-reviewer-v1.mjs';
  const proof = {
    STEPHANOS_REVIEW_EXACT_HEAD: env.STEPHANOS_REVIEW_EXACT_HEAD,
    STEPHANOS_REVIEW_EXACT_BASE: env.STEPHANOS_REVIEW_EXACT_BASE,
    STEPHANOS_REVIEW_EXACT_BRANCH: env.STEPHANOS_REVIEW_EXACT_BRANCH,
  };
  const calls = [];
  function verify({ flag = 'H', swap = '', badHead = false, failGit = false, status = '', configuration = canonicalConfig } = {}) {
    calls.length = 0;
    return verifyWslReviewerExecutableBytesV1({ reviewerPath, reviewEnv: proof,
      run(argv, timeout) {
        assert.equal(timeout, 12_000);
        const execution = resolveBattleBridgeGitExecution({ platform: 'linux', environment: {} });
        const executableIndex = argv.indexOf('/usr/bin/git');
        assert.deepEqual(argv.slice(0, executableIndex), ['/usr/bin/env', '-i', 'HOME=/tmp',
          ...Object.entries(execution.environment).map(([key, value]) => key + '=' + value)]);
        assert.ok(argv.includes('GIT_NO_LAZY_FETCH=1'));
        assert.ok(argv.includes('GIT_OPTIONAL_LOCKS=0'));
        assert.ok(argv.includes('core.fsmonitor=false'));
        assert.ok(argv.includes('credential.helper='));
        assert.deepEqual(argv.slice(executableIndex + 1, executableIndex + 1 + execution.fixedConfigArgs.length),
          execution.fixedConfigArgs);
        const commandIndex = executableIndex + 1 + execution.fixedConfigArgs.length;
        assert.equal(argv[commandIndex], '-C');
        assert.equal(argv[commandIndex + 1], root);
        const git = argv.slice(commandIndex + 2);
        calls.push(git);
        if (failGit) return { status: 1, stdout: '' };
        if (git.join(' ') === 'config --local --null --list --no-includes') {
          return { status: 0, stdout: configuration };
        }
        if (git.join(' ') === 'rev-parse HEAD')
          return { status: 0, stdout: (badHead ? 'c'.repeat(40) : proof.STEPHANOS_REVIEW_EXACT_HEAD) + '\n' };
        if (git.join(' ') === 'symbolic-ref --quiet --short HEAD')
          return { status: 0, stdout: proof.STEPHANOS_REVIEW_EXACT_BRANCH + '\n' };
        if (git.join(' ') === '-c status.renames=false status --porcelain --untracked-files=normal') {
          return { status: 0, stdout: status };
        }
        if (git[0] === 'merge-base') return { status: 0, stdout: '' };
        const file = git.at(-1);
        if (git[0] === 'ls-files') return { status: 0, stdout: flag + ' ' + file + '\n' };
        if (git[0] === 'rev-parse') return { status: 0, stdout: 'd'.repeat(40) + '\n' };
        if (git[0] === 'hash-object') return {
          status: 0, stdout: (file === swap ? 'e' : 'd').repeat(40) + '\n' };
        throw Error('unapproved Git read: ' + git.join(' '));
      },
    });
  }
  const ok = verify();
  assert.equal(ok.ok, true);
  assert.equal(calls.filter(x => x[0] === 'hash-object').length,
    REVIEWER_CRITICAL_SOURCE_PATHS.length);
  assert.equal(REVIEWER_CRITICAL_SOURCE_PATHS.includes('scripts/sovereign-reviewer-v1.mjs'), true);
  assert.equal(REVIEWER_CRITICAL_SOURCE_PATHS.includes('shared/agents/sovereignReviewerV1.mjs'), true);
  assert.equal(REVIEWER_CRITICAL_SOURCE_PATHS.includes('scripts/sovereign-reviewer-ollama-calibration-v1.mjs'), true);
  assert.equal(REVIEWER_CRITICAL_SOURCE_PATHS.includes('scripts/battle-bridge-github-sync-policy.mjs'), true);
  for (const status of [
    ' M stephanos-server/data/memory/durable-memory.json\n',
    '?? apps/stephanos/dist/assets/new.js\r\n M logs/reviewer.log\r\n',
  ]) assert.equal(verify({ status }).ok, true, status);
  for (const status of [
    ' M scripts/reviewer.mjs\n', '?? scripts/new-reviewer.mjs\n',
    '?? apps/stephanos/dist/assets/new.js\n M scripts/reviewer.mjs\n',
    'M  stephanos-server/data/memory/durable-memory.json\n',
    'R  apps/stephanos/dist/old.js -> scripts/new.js\n',
    'XX apps/stephanos/dist/new.js\n', ' M\tapps/stephanos/dist/new.js\n',
    '?? tmp/../scripts/new.mjs\n', '?? tmp/./new.mjs\n',
    '?? tmp/new\0.mjs\n', '?? tmp/new\r.mjs\n',
    '??  tmp/new.mjs\n', '?? tmp/new.mjs \n',
    '?? tmp/first\n\n?? tmp/second\n',
  ]) assert.equal(verify({ status }).reason, 'REVIEWER_SOURCE_HEAD_OR_WORKTREE_UNVERIFIED', status);
  assert.equal(verify({ flag: 's' }).reason, 'REVIEWER_SOURCE_INDEX_FLAGS_UNSAFE',
    'skip-worktree may conceal changes from git status');
  assert.equal(verify({ flag: 'h' }).reason, 'REVIEWER_SOURCE_INDEX_FLAGS_UNSAFE',
    'assume-unchanged may conceal changes from git status');
  assert.equal(verify({ swap: 'scripts/sovereign-reviewer-v1.mjs' }).reason,
    'REVIEWER_SOURCE_BYTES_NOT_HEAD');
  assert.equal(verify({ swap: 'shared/agents/sovereignReviewerV1.mjs' }).reason,
    'REVIEWER_SOURCE_BYTES_NOT_HEAD');
  assert.equal(verify({ swap: 'scripts/battle-bridge-github-sync-policy.mjs', status: '?? tmp/runtime.json\n' }).reason,
    'REVIEWER_SOURCE_BYTES_NOT_HEAD', 'runtime allowance never skips policy-byte authentication');
  assert.equal(verify({ badHead: true }).reason, 'REVIEWER_SOURCE_HEAD_OR_WORKTREE_UNVERIFIED');
  assert.equal(verify({ failGit: true }).reason, 'REVIEWER_SOURCE_GIT_UNVERIFIED');
  for (const configuration of [
    '', canonicalConfig + canonicalConfig,
    'remote.origin.url\nhttps://example.invalid/repository.git\0',
    canonicalConfig + 'filter.fixture.clean\n/tmp/fixture-helper\0',
    canonicalConfig + 'include.path\n/tmp/fixture-config\0',
    canonicalConfig + 'core.fsmonitor\n/tmp/fixture-helper\0',
    canonicalConfig + 'extensions.worktreeconfig\ntrue\0',
  ]) {
    assert.equal(verify({ configuration }).reason, 'REVIEWER_SOURCE_GIT_UNVERIFIED');
    assert.equal(calls.length, 1, 'configuration denial must precede every status read');
  }
  assert.equal(verifyWslReviewerExecutableBytesV1({
    run() { throw Error('must not run'); }, reviewerPath: '../../forged/reviewer.mjs',
    reviewEnv: proof,
  }).ok, false);
});
test('WSL source preflight never executes repository fsmonitor before its source admission result',
  { skip: process.platform !== 'linux' }, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'reviewer-wsl-fsmonitor-'));
  try {
    const git = args => {
      const result = spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
        '-c', 'commit.gpgSign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
        '-C', root, ...args], { encoding: 'utf8', shell: false,
        env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git(['init', '-b', 'fixture']);
    git(['remote', 'add', 'origin', 'https://github.com/Cheekyfellastef/stephan-os.git']);
    for (const file of REVIEWER_CRITICAL_SOURCE_PATHS) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), '// exact reviewer source\n');
    }
    git(['add', '.']); git(['commit', '-m', 'fixture base']);
    const base = git(['rev-parse', 'HEAD']);
    writeFileSync(path.join(root, REVIEWER_CRITICAL_SOURCE_PATHS[0]), '// exact reviewer head\n');
    git(['add', '.']); git(['commit', '-m', 'fixture head']);
    const head = git(['rev-parse', 'HEAD']);
    const marker = path.join(root, '.git', 'fsmonitor-was-executed');
    const helper = path.join(root, '.git', 'fsmonitor-fixture');
    writeFileSync(helper, '#!/bin/sh\nprintf observed > "' + marker + '"\nprintf "fixture-token\\0"\n');
    chmodSync(helper, 0o755);
    const verify = () => verifyWslReviewerExecutableBytesV1({
      reviewerPath: root + '/scripts/sovereign-reviewer-v1.mjs',
      reviewEnv: { ...env, STEPHANOS_REVIEW_EXACT_HEAD: head,
        STEPHANOS_REVIEW_EXACT_BASE: base, STEPHANOS_REVIEW_EXACT_BRANCH: 'fixture' },
      run(argv, timeout) {
        return spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', shell: false, timeout });
      },
    });
    assert.equal(verify().ok, true, 'ordinary clean source remains admissible');
    assert.equal(existsSync(marker), false, 'status must not execute the local helper');
    git(['config', 'core.fsmonitor', helper]);
    assert.equal(verify().reason, 'REVIEWER_SOURCE_GIT_UNVERIFIED');
    assert.equal(existsSync(marker), false, 'configuration must be denied before the helper can execute');
    git(['config', '--unset', 'core.fsmonitor']);
    git(['update-index', '--skip-worktree', '--', 'scripts/battle-bridge-github-sync-policy.mjs']);
    writeFileSync(path.join(root, 'scripts/battle-bridge-github-sync-policy.mjs'), '// substituted policy\n');
    assert.equal(verify().reason, 'REVIEWER_SOURCE_INDEX_FLAGS_UNSAFE');
    assert.equal(existsSync(marker), false, 'source denial must also precede every helper execution');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('real Git runtime dirt, staged renames and local clean filters are bounded on all three reviewer routes',
  { skip: process.platform !== 'linux' }, async () => {
  for (const scenario of ['runtime-only', 'mixed-source', 'runtime-to-source', 'source-to-runtime', 'staged-memory', 'filter-config']) {
    const root = mkdtempSync(path.join(tmpdir(), 'reviewer-runtime-dirt-'));
    try {
      const git = args => {
        const result = spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
          '-c', 'commit.gpgSign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
          '-C', root, ...args], { encoding: 'utf8', shell: false,
          env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
      };
      const write = (file, content) => {
        const target = path.join(root, file);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, content);
      };
      git(['init', '-b', 'fixture']);
      git(['remote', 'add', 'origin', 'https://github.com/Cheekyfellastef/stephan-os.git']);
      for (const file of REVIEWER_CRITICAL_SOURCE_PATHS) write(file, '// exact tracked source\n');
      write('src/reviewed.js', 'export const value = 1;\n');
      write('src/moving.js', '// source rename fixture\n');
      write('apps/stephanos/dist/moving.js', '// runtime rename fixture\n');
      write('stephanos-server/data/memory/durable-memory.json', '{}\n');
      write('.gitattributes', 'logs/probe.log filter=fixture\n');
      write('logs/probe.log', 'before\n');
      git(['add', '.']); git(['commit', '-m', 'fixture base']);
      const base = git(['rev-parse', 'HEAD']);
      write('src/reviewed.js', 'export const value = 2;\n');
      git(['add', '.']); git(['commit', '-m', 'fixture reviewed change']);
      const head = git(['rev-parse', 'HEAD']);
      // Host configuration deliberately requests rename detection. Each real
      // reviewer must override it, so neither side of a source move is hidden.
      git(['config', 'status.renames', 'true']);
      const filterMarker = path.join(root, '.git', 'filter-was-executed');
      if (scenario === 'runtime-to-source') {
        git(['mv', 'apps/stephanos/dist/moving.js', 'src/promoted.js']);
        assert.match(git(['status', '--porcelain']), /^R /);
      } else if (scenario === 'source-to-runtime') {
        git(['mv', 'src/moving.js', 'apps/stephanos/dist/demoted.js']);
        assert.match(git(['status', '--porcelain']), /^R /);
      } else {
        write('stephanos-server/data/memory/durable-memory.json', '{"runtime":true}\n');
        write('apps/stephanos/dist/assets/runtime.js', '// generated runtime state\n');
        if (scenario === 'mixed-source') write('scripts/untracked-source.mjs', '// source dirt\n');
        if (scenario === 'staged-memory') git(['add', 'stephanos-server/data/memory/durable-memory.json']);
        if (scenario === 'filter-config') {
          const helper = path.join(root, '.git', 'clean-filter-fixture');
          writeFileSync(helper, '#!/bin/sh\nprintf observed > "' + filterMarker + '"\ncat\n');
          chmodSync(helper, 0o755);
          git(['config', 'filter.fixture.clean', helper]);
          const observed = statSync(path.join(root, 'logs/probe.log'));
          write('logs/probe.log', 'after!\n');
          utimesSync(path.join(root, 'logs/probe.log'), observed.atime, observed.mtime);
        }
      }
      const identity = { ...env, STEPHANOS_REVIEW_EXACT_HEAD: head,
        STEPHANOS_REVIEW_EXACT_BASE: base, STEPHANOS_REVIEW_EXACT_BRANCH: 'fixture' };
      const expected = scenario === 'runtime-only';
      const baseline = inspectLocalCalibrationGitIdentityV1(identity, { platform: 'linux', sourceRoot: root });
      assert.equal(baseline.ok, expected, 'baseline: ' + scenario);
      assert.equal(existsSync(filterMarker), false, 'baseline must not invoke clean filters');
      const bridge = verifyWslReviewerExecutableBytesV1({ reviewerPath: root + '/scripts/sovereign-reviewer-v1.mjs',
        reviewEnv: identity, run(argv, timeout) {
          return spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', shell: false,
            timeout, maxBuffer: 4096 });
        } });
      assert.equal(bridge.ok, expected, 'bridge: ' + scenario);
      assert.equal(existsSync(filterMarker), false, 'bridge must not invoke clean filters');
      let modelCalls = 0;
      const standard = await runStandardReview(identity, { platform: 'linux',
        spawn(executable, args, options) {
          const fixtureArgs = args.map(arg => arg.startsWith('--git-dir=') ? '--git-dir=' + path.join(root, '.git')
            : arg.startsWith('--work-tree=') ? '--work-tree=' + root : arg);
          return spawnSync(executable, fixtureArgs, { ...options, cwd: root });
        },
        invokeModel: async () => {
          modelCalls++;
          return JSON.stringify({ verdict: 'clean', reviewedPaths: ['src/reviewed.js'], findings: [] });
        }, persist: () => true,
      });
      assert.equal(standard.status, expected ? 'LOCAL_REVIEW_EVIDENCE_READY' : 'SOVEREIGN_REVIEW_HELD', 'standard: ' + scenario);
      assert.equal(modelCalls, expected ? 1 : 0, scenario);
      assert.equal(existsSync(filterMarker), false, 'standard review must not invoke clean filters');
      if (!expected) {
        assert.equal(standard.reason, scenario === 'filter-config' ? 'LOCAL_GIT_PROOF_UNAVAILABLE' : 'REVIEW_WORKTREE_NOT_CLEAN');
        assert.equal(baseline.reason, scenario === 'filter-config' ? 'CALIBRATION_SOURCE_GIT_UNPROVEN' : 'CALIBRATION_CLEAN_EXACT_CHECKOUT_REQUIRED');
        assert.equal(bridge.reason, scenario === 'filter-config' ? 'REVIEWER_SOURCE_GIT_UNVERIFIED' : 'REVIEWER_SOURCE_HEAD_OR_WORKTREE_UNVERIFIED');
      }
      assert.equal(standard.mergeAuthority, false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});


test('Windows reviewer executable custody paths are LF-pinned for raw-byte verification', () => {
  const attrs = new Set(readFileSync(new URL('../.gitattributes', import.meta.url), 'utf8')
    .split(/\r?\n/).map(line => line.trim()).filter(Boolean));
  const rawByteCritical = [
    'scripts/sovereign-reviewer-v1.mjs',
    'scripts/sovereign-reviewer-ollama-calibration-v1.mjs',
    'scripts/sovereign-high-risk-advisory-v1.mjs',
    'scripts/sovereign-high-risk-advisory-launcher-v1.mjs',
    'scripts/sovereign-windows-review-calibration-v1.mjs',
    'scripts/sovereign-windows-review-calibration-v1-engine.mjs',
  ];
  for (const file of rawByteCritical) {
    assert.ok(attrs.has(file + ' text eol=lf'), file + ' must preserve exact LF Git bytes on Windows');
  }
});

test('unsupported WSL profile cannot evaluate a PR producer or promote any candidate/preflight receipt', () => {
  for (const mode of ['review', 'calibration', 'preflight']) {
    let spawned=0,attested=0;
    const result=runWindowsSovereignReviewerV1({...env,NODE_OPTIONS:'--import=attacker'}, {
      ...context, mode, verifySource:()=>{attested++;return{ok:true};},
      spawn:()=>{spawned++;return{status:0,stdout:'SOVEREIGN_REVIEWER_RESULT={"mergeAuthority":true}'};},
    });
    assert.equal(result.ok,false);
    assert.equal(result.reason,'WSL_INSTALLED_REVIEWER_PROFILE_REQUIRED');
    assert.equal(result.mergeAuthority,false);assert.equal(result.approvalAuthority,false);
    assert.equal(spawned,0);assert.equal(attested,0);
  }
});
