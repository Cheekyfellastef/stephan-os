import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createBattleBridgeGitProbeContextV1, isBattleBridgeGitProbeContextV1,
  validateBattleBridgeGitProbeConfigurationV1 } from './battleBridgeGitProbeContextV1.mjs';
import { BATTLE_BRIDGE_CANONICAL_REMOTE_URL, resolveBattleBridgeGitExecution, validateBattleBridgeLocalGitConfiguration } from './battleBridgeExecutionBoundaryV1.mjs';
import { collectCanonicalIgnitionSourceTruth } from '../../scripts/battle-bridge-ignition-supervisor.mjs';

const g = resolveBattleBridgeGitExecution();
function fixture(t) {
  const base = mkdtempSync(path.join(tmpdir(), 'git-source-context-fixture-'));
  const root = path.join(base, 'main'); mkdirSync(root);
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const run = (args, context = null, allowFailure = false) => {
    const r = spawnSync(g.executable, [...g.fixedConfigArgs,
      ...(context ? context.repositoryArgs() : []), ...args], {
      cwd: root, env: g.environment, shell: false, windowsHide: true, encoding: 'utf8', timeout: 10000,
    });
    if (!allowFailure) assert.equal(r.status, 0, r.stderr || r.error?.message);
    return r;
  };
  run(['init', '-b', 'main']);
  writeFileSync(path.join(root, 'tracked'), 'AAAA');
  run(['add', 'tracked']);
  run(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']);
  const head = run(['rev-parse', 'HEAD']).stdout.trim();
  run(['remote', 'add', 'origin', BATTLE_BRIDGE_CANONICAL_REMOTE_URL]);
  run(['update-ref', 'refs/remotes/origin/main', head]);
  run(['config', 'branch.main.remote', 'origin']); run(['config', 'branch.main.merge', 'refs/heads/main']);
  run(['config', 'extensions.worktreeConfig', 'true']);
  return { base, root, head, run };
}

function contextFor(t, root) {
  const context = createBattleBridgeGitProbeContextV1(root);
  const privateRoot = context.repositoryArgs()[0].slice('--git-dir='.length);
  // Explicit disposable fixture cleanup also handles intentionally damaged test
  // contexts which the production cleanup correctly refuses to delete.
  assert.ok(path.resolve(privateRoot).startsWith(path.resolve(tmpdir()) + path.sep + 'stephanos-git-source-probe-'));
  t.after(() => { try { context.close(); } catch {} rmSync(privateRoot, { recursive: true, force: true }); });
  return { context, privateRoot };
}

test('native private bootstrap excludes original worktree settings and preserves canonical bytes', t => {
  const f = fixture(t), marker = path.join(f.root, '.git', 'helper-executed');
  f.run(['worktree', 'add', '-b', 'linked-fixture', path.join(f.base, 'linked')]);
  const linkedConfig = path.join(f.root, '.git', 'worktrees', 'linked', 'config.worktree');
  writeFileSync(linkedConfig, '[fixture]\n scope = linked-specific\n');
  const registrations = f.run(['worktree', 'list', '--porcelain']).stdout;
  const helper = path.join(f.root, '.git', 'fsmonitor-helper');
  writeFileSync(helper, `#!/bin/sh\nprintf executed > '${marker.replace(/\\/g, '/')}'\nprintf 'fixture-token\\0'\n`); chmodSync(helper, 0o755);
  const specific = path.join(f.root, '.git', 'config.worktree');
  writeFileSync(specific, `[fixture]\n scope = original-specific\n[core]\n fsmonitor = "${helper.replace(/\\/g, '/')}"\n[remote "origin"]\n url = https://attacker.invalid/repo\n`);
  const before = ['HEAD', 'index', 'config', 'config.worktree'].map(name => readFileSync(path.join(f.root, '.git', name)));
  assert.equal(f.run(['config', '--get', 'fixture.scope']).stdout.trim(), 'original-specific');
  const { context, privateRoot } = contextFor(t, f.root);
  assert.equal(f.run(['config', '--get', 'fixture.scope'], context, true).status, 1);
  assert.equal(f.run(['config', '--get', 'remote.origin.url'], context).stdout.trim(), BATTLE_BRIDGE_CANONICAL_REMOTE_URL);
  assert.equal(f.run(['config', '--worktree', '--null', '--list'], context).stdout, '');
  assert.equal(f.run(['branch', '--show-current'], context).stdout.trim(), 'main');
  assert.equal(f.run(['rev-parse', 'HEAD'], context).stdout.trim(), f.head);
  assert.equal(f.run(['status', '--porcelain', '--untracked-files=no'], context).stdout, '');
  assert.equal(existsSync(marker), false);
  ['HEAD', 'index', 'config', 'config.worktree'].forEach((name, i) => assert.deepEqual(readFileSync(path.join(f.root, '.git', name)), before[i]));
  assert.equal(readFileSync(linkedConfig, 'utf8'), '[fixture]\n scope = linked-specific\n');
  assert.equal(f.run(['worktree', 'list', '--porcelain']).stdout, registrations);
  assert.equal(context.close(), true); assert.equal(existsSync(privateRoot), false);
  assert.equal(isBattleBridgeGitProbeContextV1(context, f.root), false);
});

test('only a live native context for this root can qualify the sole literal true declaration', t => {
  const f = fixture(t), { context } = contextFor(t, f.root);
  const base = `remote.origin.url\n${BATTLE_BRIDGE_CANONICAL_REMOTE_URL}\0`;
  const declaration = 'extensions.worktreeconfig\ntrue\0';
  const native = { gitProbeContext: context, repoRoot: f.root };
  assert.equal(validateBattleBridgeLocalGitConfiguration(base + declaration).ok, false);
  assert.equal(validateBattleBridgeGitProbeConfigurationV1(base + declaration, native).ok, true);
  assert.equal(validateBattleBridgeGitProbeConfigurationV1(base + declaration, { ...native, repoRoot: path.dirname(f.root) }).ok, false);
  assert.equal(validateBattleBridgeGitProbeConfigurationV1(base + declaration, { ...native, gitProbeContext: { ...context } }).ok, false);
  for (const raw of [base + declaration + declaration, base + declaration.replace('true', 'yes'), base + declaration.replace('true', 'false'),
    base + declaration + 'alias.exec\n!unsafe\0', base + declaration + 'filter.trap.clean\nunsafe\0',
    base + declaration + `remote.origin.url\n${BATTLE_BRIDGE_CANONICAL_REMOTE_URL}\0`])
    assert.equal(validateBattleBridgeGitProbeConfigurationV1(raw, native).ok, false);
  context.close();
  assert.equal(validateBattleBridgeGitProbeConfigurationV1(base + declaration, native).ok, false);
});

test('racy same-size edit is dirty with original and conservative copied index', t => {
  const f = fixture(t), indexPath = path.join(f.root, '.git', 'index');
  const oldBlob = f.run(['rev-parse', 'HEAD:tracked']).stdout.trim();
  writeFileSync(path.join(f.root, 'tracked'), 'BBBB'); f.run(['add', 'tracked']);
  const index = readFileSync(indexPath);
  assert.equal(index.readUInt32BE(4), 2); assert.equal(index.readUInt32BE(8), 1);
  Buffer.from(oldBlob, 'hex').copy(index, 52);
  createHash('sha1').update(index.subarray(0, -20)).digest().copy(index, index.length - 20);
  writeFileSync(indexPath, index);
  const second = Math.floor(statSync(path.join(f.root, 'tracked')).mtimeMs / 1000);
  utimesSync(indexPath, second, second);
  assert.equal(f.run(['status', '--porcelain', '--untracked-files=no']).stdout.trim(), 'M tracked');
  const { context, privateRoot } = contextFor(t, f.root);
  assert.ok(statSync(path.join(privateRoot, 'index'), { bigint: true }).mtimeNs <= statSync(indexPath, { bigint: true }).mtimeNs);
  assert.equal(f.run(['status', '--porcelain', '--untracked-files=no'], context).stdout.trim(), 'M tracked');
  // The documented attack's positive control uses an independent disposable
  // unqualified copy. The qualified factory must reject such timestamp drift.
  utimesSync(path.join(privateRoot, 'index'), second + 5, second + 5);
  const naive = spawnSync(g.executable, [...g.fixedConfigArgs,
    `--git-dir=${privateRoot}`, `--work-tree=${f.root}`, 'status', '--porcelain', '--untracked-files=no'],
  { cwd: f.root, env: g.environment, shell: false, windowsHide: true, encoding: 'utf8', timeout: 10000 });
  assert.equal(naive.status, 0, naive.stderr); assert.equal(naive.stdout, '', 'positive control must reproduce the newer-copy false clean');
  assert.equal(isBattleBridgeGitProbeContextV1(context, f.root), false);
  assert.throws(() => context.assert(), /CONTEXT_CHANGED/);
});

test('changed original metadata, nonempty private configuration and invalid index never qualify', t => {
  for (const target of ['original', 'private']) {
    const f = fixture(t), { context, privateRoot } = contextFor(t, f.root);
    if (target === 'original') writeFileSync(path.join(f.root, '.git', 'HEAD'), 'ref: refs/heads/foreign\n');
    else writeFileSync(path.join(privateRoot, 'config.worktree'), '[core]\n fsmonitor = unsafe\n');
    assert.equal(isBattleBridgeGitProbeContextV1(context, f.root), false);
    assert.throws(() => context.assert(), /CANONICAL_GIT_PROBE_/);
  }
  const f = fixture(t);
  f.run(['worktree', 'add', '-b', 'linked-fixture', path.join(f.base, 'linked')]);
  utimesSync(path.join(f.root, '.git', 'index'), 0, 0);
  assert.throws(() => createBattleBridgeGitProbeContextV1(f.root), /INDEX_TIMESTAMP_UNPROVEN/);
  writeFileSync(path.join(f.root, '.git', 'index'), Buffer.alloc(64));
  assert.throws(() => createBattleBridgeGitProbeContextV1(f.root), /INDEX_UNSUPPORTED/);
});

test('actual collector uses private configuration while preserving current main and all original guards', t => {
  const f = fixture(t);
  writeFileSync(path.join(f.root, '.git', 'config.worktree'), '[remote "origin"]\n url = https://attacker.invalid/repo\n');
  let fetches = 0;
  const result = collectCanonicalIgnitionSourceTruth({ cwd: f.root,
    environment: { ...process.env, GIT_DIR: '/foreign', GIT_COMMON_DIR: '/foreign',
      GIT_INDEX_FILE: '/foreign-index', GIT_CONFIG_PARAMETERS: "'extensions.worktreeConfig'='true'" },
    spawnSyncFn: (executable, args, options) => {
      assert.equal(options.env.GIT_DIR, undefined); assert.equal(options.env.GIT_INDEX_FILE, undefined);
      assert.equal(options.env.GIT_CONFIG_PARAMETERS, undefined);
      const operation = args.slice(args.findIndex(arg => arg.startsWith('--work-tree=')) + 1);
      if (operation[0] === 'fetch') { fetches++; return { status: 0, stdout: '', stderr: '' }; }
      return spawnSync(executable, args, options);
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.head, f.head); assert.equal(fetches, 1);
  writeFileSync(path.join(f.root, 'tracked'), 'BBBB');
  const dirty = collectCanonicalIgnitionSourceTruth({ cwd: f.root,
    spawnSyncFn: (exe, args, options) => {
      assert.ok(!args.includes('fetch'), 'dirty source must be denied before fetch');
      return spawnSync(exe, args, options);
    } });
  assert.equal(dirty.ok, false); assert.equal(dirty.blocker.code, 'CANONICAL_CHECKOUT_DIRTY');
  f.run(['checkout', '--', 'tracked']); f.run(['update-index', '--assume-unchanged', 'tracked']);
  const hidden = collectCanonicalIgnitionSourceTruth({ cwd: f.root,
    spawnSyncFn: (exe, args, options) => {
      assert.ok(!args.includes('fetch'), 'hidden index flags must be denied before fetch');
      return spawnSync(exe, args, options);
    } });
  assert.equal(hidden.ok, false); assert.equal(hidden.blocker.code, 'HIDDEN_TRACKED_PATHS_PRESENT');
});

test('private configuration drift during the source frame stops before another Git command', t => {
  const f = fixture(t); let privateRoot, changed = false, commandsAfterDrift = 0;
  t.after(() => {
    if (privateRoot) {
      assert.ok(path.resolve(privateRoot).startsWith(path.resolve(tmpdir()) + path.sep + 'stephanos-git-source-probe-'));
      rmSync(privateRoot, { recursive: true, force: true });
    }
  });
  const result = collectCanonicalIgnitionSourceTruth({ cwd: f.root,
    spawnSyncFn: (exe, args, options) => {
      privateRoot = args.find(arg => arg.startsWith('--git-dir=')).slice('--git-dir='.length);
      const operation = args.slice(args.findIndex(arg => arg.startsWith('--work-tree=')) + 1);
      if (changed) commandsAfterDrift++;
      if (operation[0] === 'fetch') {
        writeFileSync(path.join(privateRoot, 'config.worktree'), '[filter "untrusted"]\n clean = unsafe\n');
        changed = true; return { status: 0, stdout: '', stderr: '' };
      }
      return spawnSync(exe, args, options);
    } });
  assert.equal(changed, true); assert.equal(commandsAfterDrift, 0);
  assert.equal(result.ok, false); assert.equal(result.blocker.code, 'CANONICAL_GIT_PROBE_CONTEXT_CHANGED');
});

test('unqualified nested checkout is refused before status can enter another Git namespace', t => {
  const f = fixture(t);
  f.run(['update-index', '--add', '--cacheinfo', '160000', f.head, 'nested']);
  const result = collectCanonicalIgnitionSourceTruth({ cwd: f.root,
    spawnSyncFn: (exe, args, options) => {
      const operation = args.slice(args.findIndex(arg => arg.startsWith('--work-tree=')) + 1);
      assert.ok(!['status', 'fetch'].includes(operation[0]), 'unsupported nested state must stop before status/fetch');
      return spawnSync(exe, args, options);
    } });
  assert.equal(result.ok, false); assert.equal(result.blocker.code, 'CANONICAL_GIT_PROBE_SUBMODULE_UNSUPPORTED');
});
