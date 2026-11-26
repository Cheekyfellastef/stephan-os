import test from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectChangedJavaScriptFiles,
  runChangedSourceIntegrityGuard,
  validateJavaScriptFiles,
} from '../.github/scripts/changed-source-integrity-guard.mjs';

test('changed source discovery is deterministic and limits itself to JavaScript source', () => {
  const files = collectChangedJavaScriptFiles({
    execGit: (_command, args) => {
      assert.deepEqual(args, ['diff', '--name-only', '-z', '--diff-filter=ACMRT', 'origin/main...HEAD']);
      return 'z.mjs\0notes.md\0a.js\0a.js\0config.json\0worker.cjs\0';
    },
  });
  assert.deepEqual(files, ['a.js', 'worker.cjs', 'z.mjs']);
});

test('valid changed JavaScript passes syntax validation', () => {
  const root = mkdtempSync(join(tmpdir(), 'stephanos-source-integrity-'));
  writeFileSync(join(root, 'good.mjs'), 'export const value = 1;\n');
  const result = validateJavaScriptFiles(['good.mjs'], { cwd: root });
  assert.equal(result.ok, true);
  assert.equal(result.blocker, '');
  assert.equal(result.finalVerdict, 'CHANGED_SOURCE_INTEGRITY_PASS');
  assert.deepEqual(result.checked, ['good.mjs']);
});

test('truncated JavaScript is reported with exact file and typed blocker', () => {
  const root = mkdtempSync(join(tmpdir(), 'stephanos-source-integrity-'));
  writeFileSync(join(root, 'truncated.mjs'), 'export function broken() {\n  return 1;\n');
  const result = validateJavaScriptFiles(['truncated.mjs'], { cwd: root });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CHANGED_SOURCE_INTEGRITY_FAILED');
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].path, 'truncated.mjs');
  assert.equal(result.failures[0].blocker, 'CHANGED_SOURCE_SYNTAX_INVALID');
  assert.match(result.failures[0].detail, /SyntaxError|Unexpected end/i);
});

test('missing changed source fails closed rather than disappearing from proof', () => {
  const result = validateJavaScriptFiles(['missing.mjs'], {
    stat: () => { throw new Error('ENOENT'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.failures[0].blocker, 'CHANGED_SOURCE_FILE_MISSING');
});

test('type-changed and newline-containing changed filenames stay in integrity proof', () => {
  const files = collectChangedJavaScriptFiles({
    execGit: (_command, args) => {
      assert.equal(args.includes('--diff-filter=ACMRT'), true);
      assert.equal(args.includes('-z'), true);
      return Buffer.from('broken\nname.js\0link.mjs\0', 'utf8');
    },
  });
  assert.deepEqual(files, ['broken\nname.js', 'link.mjs']);
});

test('ambiguous newline-delimited Git output fails closed', () => {
  assert.throws(() => collectChangedJavaScriptFiles({
    execGit: () => 'safe.js\nunsafe.js\n',
  }), /CHANGED_SOURCE_DIFF_PATH_ENCODING_INVALID/);
});

test('leading-dash changed JavaScript paths use genuine Git discovery and Node syntax checks', () => {
  const root = mkdtempSync(join(tmpdir(), 'stephanos-source-integrity-dash-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const commit = (message) => git(
    '-c', 'user.name=CI Fixture',
    '-c', 'user.email=ci-fixture@example.invalid',
    'commit', '-qm', message,
  );

  git('init', '-q');
  writeFileSync(join(root, 'baseline.txt'), 'baseline\n');
  git('add', '--', 'baseline.txt');
  commit('baseline');

  const dashPaths = ['-literal.mjs', '--guard.js', '-worker.cjs'];
  for (const path of dashPaths) {
    writeFileSync(
      join(root, path),
      path.endsWith('.cjs') ? 'module.exports = { value: 1 };\n' : 'const value = 1;\n',
    );
  }
  git('add', '--', ...dashPaths);
  commit('add leading-dash JavaScript filenames');

  const discovered = collectChangedJavaScriptFiles({ cwd: root, baseRef: 'HEAD~1' });
  assert.deepEqual(discovered, [...dashPaths].sort());
  const result = validateJavaScriptFiles(discovered, { cwd: root });
  assert.equal(result.ok, true, JSON.stringify(result.failures));
  assert.deepEqual(result.checked, discovered);
});

test('invalid UTF-8 raw Git paths cannot alias valid replacement-character filenames', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'stephanos-source-integrity-utf8-'));
  const git = (...args) => execFileSync('git', args, { cwd: root });
  const commit = (message) => git('-c', 'user.name=CI Fixture', '-c', 'user.email=ci-fixture@example.invalid', 'commit', '-qm', message);
  try {
    git('init', '-q');
    writeFileSync(join(root, 'bad\uFFFD.js'), 'const good = 1;\n');
    git('add', '--', '.');
    commit('baseline');
    const rawPath = Buffer.concat([Buffer.from(root + '/bad'), Buffer.from([0xff]), Buffer.from('.js')]);
    writeFileSync(rawPath, 'const broken = ;\n');
    git('add', '--', '.');
    commit('invalid UTF-8 changed filename');
    const result = runChangedSourceIntegrityGuard({ cwd: root, baseRef: 'HEAD~1' });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'CHANGED_SOURCE_DIFF_READ_FAILED');
    assert.match(result.failures[0].detail, /CHANGED_SOURCE_DIFF_PATH_ENCODING_INVALID/);
    assert.deepEqual(result.checked, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('valid Unicode, replacement character, leading BOM and newline remain exact filenames', () => {
  const names = ['\uFEFFleading.js', 'bad\uFFFD.js', 'café.mjs', 'line\nbreak.cjs'];
  const discovered = collectChangedJavaScriptFiles({
    execGit: () => Buffer.from(names.join('\0') + '\0', 'utf8'),
  });
  assert.deepEqual(discovered, [...names].sort());
});
