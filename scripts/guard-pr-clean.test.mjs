import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const guardSource = resolve('scripts/guard-pr-clean.mjs');

function run(command, args, cwd, options = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: options.encoding ?? 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function createRepo({ withOriginMain = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'stephanos-pr-clean-'));
  run('git', ['init', '-q', '-b', 'main'], dir);
  run('git', ['config', 'user.email', 'codex@example.test'], dir);
  run('git', ['config', 'user.name', 'Codex Test'], dir);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  cpSync(guardSource, join(dir, 'scripts/guard-pr-clean.mjs'));
  writeFileSync(join(dir, 'README.md'), '# clean base\n');
  run('git', ['add', 'README.md', 'scripts/guard-pr-clean.mjs'], dir);
  run('git', ['commit', '-q', '-m', 'base'], dir);
  if (withOriginMain) {
    run('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], dir);
  }
  run('git', ['switch', '-q', '-c', 'feature'], dir);
  return dir;
}

function commitFile(dir, file, content, encoding = 'utf8') {
  mkdirSync(join(dir, file, '..'), { recursive: true });
  writeFileSync(join(dir, file), content, encoding === null ? undefined : encoding);
  run('git', ['add', file], dir);
  run('git', ['commit', '-q', '-m', `add ${file}`], dir);
}

function runGuard(dir, mode = '--strict') {
  try {
    const stdout = run('node', ['scripts/guard-pr-clean.mjs', mode], dir);
    return { ok: true, output: stdout };
  } catch (error) {
    return {
      ok: false,
      output: `${error.stdout?.toString?.() ?? ''}${error.stderr?.toString?.() ?? ''}`,
      status: error.status,
    };
  }
}

function withRepo(options, fn) {
  const dir = createRepo(options);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('guard fails when PR diff includes a binary file detected by numstat', () => withRepo({}, (dir) => {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src/binary.dat'), Buffer.from([0, 1, 2, 3, 4, 0, 5]));
  run('git', ['add', 'src/binary.dat'], dir);
  run('git', ['commit', '-q', '-m', 'add binary'], dir);

  const result = runGuard(dir);
  assert.equal(result.ok, false);
  assert.match(result.output, /binary file detected by git diff --numstat/);
  assert.match(result.output, /src\/binary\.dat/);
}));

test('guard fails when PR diff includes apps/stephanos/dist/**', () => withRepo({}, (dir) => {
  commitFile(dir, 'apps/stephanos/dist/index.html', '<html></html>\n');
  const result = runGuard(dir);
  assert.equal(result.ok, false);
  assert.match(result.output, /apps\/stephanos\/dist\/index\.html/);
  assert.match(result.output, /generated dist/);
}));

test('guard fails when PR diff includes node_modules/**', () => withRepo({}, (dir) => {
  commitFile(dir, 'node_modules/pkg/index.js', 'module.exports = {};\n');
  const result = runGuard(dir);
  assert.equal(result.ok, false);
  assert.match(result.output, /node_modules\/pkg\/index\.js/);
  assert.match(result.output, /dependency artifact/);
}));

test('guard fails when PR diff includes screenshots, images, archives, and fonts', () => withRepo({}, (dir) => {
  commitFile(dir, 'reports/screenshot.png', 'not really png\n');
  commitFile(dir, 'artifacts/bundle.zip', 'not really zip\n');
  commitFile(dir, 'assets/font.woff2', 'not really font\n');
  const result = runGuard(dir);
  assert.equal(result.ok, false);
  assert.match(result.output, /reports\/screenshot\.png/);
  assert.match(result.output, /artifacts\/bundle\.zip/);
  assert.match(result.output, /assets\/font\.woff2/);
}));

test('guard fails when PR diff includes .env/secrets/token-like files', () => withRepo({}, (dir) => {
  commitFile(dir, '.env.local', 'TOKEN=abc\n');
  commitFile(dir, 'config/api-token.txt', 'abc\n');
  const result = runGuard(dir);
  assert.equal(result.ok, false);
  assert.match(result.output, /\.env\.local/);
  assert.match(result.output, /api-token\.txt/);
  assert.match(result.output, /secret\/env\/token-like path/);
}));

test('guard fails closed when strict mode cannot resolve origin/main', () => withRepo({ withOriginMain: false }, (dir) => {
  commitFile(dir, 'scripts/source.mjs', 'export const ok = true;\n');
  const result = runGuard(dir);
  assert.equal(result.ok, false);
  assert.match(result.output, /origin\/main cannot be resolved/);
  assert.match(result.output, /fails closed/);
}));

test('local fallback catches staged, unstaged, and untracked forbidden files', () => withRepo({}, (dir) => {
  mkdirSync(join(dir, 'logs'), { recursive: true });
  writeFileSync(join(dir, 'logs/runtime.log'), 'log\n');
  run('git', ['add', 'logs/runtime.log'], dir);
  run('git', ['commit', '-q', '-m', 'tracked log base'], dir);

  mkdirSync(join(dir, 'apps/stephanos/dist'), { recursive: true });
  writeFileSync(join(dir, 'apps/stephanos/dist/index.html'), '<html></html>\n');
  run('git', ['add', 'apps/stephanos/dist/index.html'], dir);
  writeFileSync(join(dir, 'logs/runtime.log'), 'changed log\n');

  mkdirSync(join(dir, 'node_modules/pkg'), { recursive: true });
  writeFileSync(join(dir, 'node_modules/pkg/index.js'), 'module.exports = {};\n');

  const result = runGuard(dir, '--local');
  assert.equal(result.ok, false);
  assert.match(result.output, /apps\/stephanos\/dist\/index\.html/);
  assert.match(result.output, /logs\/runtime\.log/);
  assert.match(result.output, /node_modules\/pkg\/index\.js/);
}));

test('clean source-only PR passes strict mode', () => withRepo({}, (dir) => {
  commitFile(dir, 'scripts/source-only.mjs', 'export const sourceOnly = true;\n');
  const result = runGuard(dir);
  assert.equal(result.ok, true, result.output);
  assert.match(result.output, /OK: strict PR proof passed/);
  assert.match(result.output, /scripts\/source-only\.mjs/);
}));
