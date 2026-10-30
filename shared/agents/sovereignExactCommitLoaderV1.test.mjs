import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { sovereignExactCommitLoaderV1 } from './sovereignExactCommitLoaderV1.mjs';
import { resolveBattleBridgeGitExecution } from './battleBridgeExecutionBoundaryV1.mjs';
import { REVIEWER_CRITICAL_SOURCE_PATHS } from '../../scripts/sovereign-reviewer-wsl-bridge-v1.mjs';
import { WINDOWS_CALIBRATION_SOURCE_PATHS } from './sovereignCommanderV1.mjs';

const git = resolveBattleBridgeGitExecution();
function command(root, args) {
  const r = spawnSync(git.executable, [...git.fixedConfigArgs, '-C', root, ...args],
    { env: git.environment, encoding: 'utf8', timeout: 12000, shell: false });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'sovereign-custody-'));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'shared', 'agents'), { recursive: true });
    const entry = 'scripts/sovereign-reviewer-v1.mjs';
    const dependency = 'shared/agents/sovereignReviewerV1.mjs';
    writeFileSync(join(root, entry), `import { value } from '../${dependency}'; console.log(value);`);
    writeFileSync(join(root, dependency), 'export const value = "AUTHENTIC";');
    command(root, ['init']);
    command(root, ['add', '.']);
    command(root, ['-c', 'user.name=Custody Test', '-c', 'user.email=custody@example.invalid', 'commit', '-m', 'fixture']);
    const head = command(root, ['rev-parse', 'HEAD']);
    const files = [entry, dependency];
    const loader = sovereignExactCommitLoaderV1({ root, head, files, git });
    const run = (selected = loader) => spawnSync(process.execPath,
      ['--no-warnings', '--experimental-loader', selected, join(root, entry)],
      { encoding: 'utf8', env: git.environment, shell: false, timeout: 20000 });
    fn({ root, head, files, entry, dependency, loader, run });
  } finally {
    assert.ok(root.startsWith(join(tmpdir(), 'sovereign-custody-')));
    rmSync(root, { recursive: true, force: true });
  }
}

test('exact-commit execution survives malicious skip-worktree and verify/load swap-and-restore', () => fixture(f => {
  const original = readFileSync(join(f.root, f.entry), 'utf8');
  command(f.root, ['update-index', '--skip-worktree', f.entry, f.dependency]);
  // Swap BOTH entry and dependency after parent constructed launch argv.
  // A mutable-path launch executes the sentinel; restoration cannot erase it.
  writeFileSync(join(f.root, f.entry), 'console.log("MALICIOUS_ENTRY");');
  writeFileSync(join(f.root, f.dependency), 'export const value = "MALICIOUS_IMPORT";');
  const r = f.run();
  writeFileSync(join(f.root, f.entry), original);
  writeFileSync(join(f.root, f.dependency), 'export const value = "AUTHENTIC";');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'AUTHENTIC');
  assert.ok(f.loader.length < 26000, 'fit native Windows command-line limit');
}));

test('repository replace refs and changed HEAD cannot redefine authenticated committed modules', () => fixture(f => {
  writeFileSync(join(f.root, f.dependency), 'export const value = "REPLACED";');
  command(f.root, ['add', '.']);
  command(f.root, ['-c', 'user.name=Custody Test', '-c', 'user.email=custody@example.invalid', 'commit', '-m', 'attacker']);
  const other = command(f.root, ['rev-parse', 'HEAD']);
  command(f.root, ['replace', f.head, other]);
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'AUTHENTIC');
}));

test('unlisted imports and missing exact object fail closed before candidate evaluation', () => fixture(f => {
  const limited = sovereignExactCommitLoaderV1({ root: f.root, head: f.head, files: [f.entry], git });
  const denied = f.run(limited);
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /EXACT_COMMIT_IMPORT_DENIED/);
  assert.equal(denied.stdout, '');
  const missing = sovereignExactCommitLoaderV1({ root: f.root, head: '1'.repeat(40), files: f.files, git });
  assert.notEqual(f.run(missing).status, 0);
}));

test('corrupt object-store bytes cannot masquerade as the pinned module hash', () => fixture(f => {
  const sha = command(f.root, ['rev-parse', f.head + ':' + f.dependency]);
  const forged = Buffer.from('export const value = "FORGED_OBJECT";');
  chmodSync(join(f.root, '.git', 'objects', sha.slice(0, 2), sha.slice(2)), 0o600);
  writeFileSync(join(f.root, '.git', 'objects', sha.slice(0, 2), sha.slice(2)),
    deflateSync(Buffer.concat([Buffer.from('blob ' + forged.length + '\0'), forged])));
  const r = f.run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /EXACT_COMMIT_OBJECT_(HASH_MISMATCH|UNAVAILABLE)/);
  assert.equal(r.stdout, '');
}));

test('both production closures initialize solely from committed modules and remain held without identity', () => {
  const root = resolve(import.meta.dirname, '../..');
  const head = command(root, ['rev-parse', 'HEAD']);
  for (const [files, entry, args, marker] of [
    [REVIEWER_CRITICAL_SOURCE_PATHS, 'scripts/sovereign-reviewer-v1.mjs', [], 'SOVEREIGN_REVIEWER_RESULT='],
    [WINDOWS_CALIBRATION_SOURCE_PATHS, 'scripts/sovereign-windows-review-calibration-v1.mjs', ['--commander-once'], 'SOVEREIGN_WINDOWS_CALIBRATION_REMOTE_RESULT='],
  ]) {
    const loader = sovereignExactCommitLoaderV1({ root, head, files, git });
    const r = spawnSync(process.execPath, ['--no-warnings', '--experimental-loader', loader, join(root, entry), ...args],
      { encoding: 'utf8', env: git.environment, shell: false, timeout: 30000 });
    assert.doesNotMatch(r.stderr, /EXACT_COMMIT_IMPORT_DENIED|ERR_MODULE_NOT_FOUND/);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, new RegExp(marker));
    assert.ok(loader.length < 26000);
  }
});
