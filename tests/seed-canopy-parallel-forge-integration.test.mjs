import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeParallelSeedExactApprovalV1, parallelSeedManifestHashV1 } from '../shared/runtime/seedCanopyParallelSupervisorV1.mjs';

const sourceRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const SEED_ID = 'test-seed-isolated-builder';
const TARGET = 'docs/architecture/test-seed-parallel-result.md';
const TASK_ID = 'isolated-build-fixture';

function command(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  return result;
}
async function runAsync(program, args, options = {}) {
  return await new Promise((resolveRun, reject) => {
    const child = spawn(program, args, { ...options, shell: false, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('close', (code) => resolveRun({ code, stdout, stderr }));
  });
}
test('independent forge performs real fixture worktree, scoped edit, tests, commit and durable receipt', { timeout: 90000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'stephanos-seed-parallel-'));
  const repo = join(scratch, 'fixture-repo');
  const home = join(scratch, 'operator-home');
  const path = (relative) => join(repo, relative);
  let server;
  try {
    for (const folder of ['scripts', 'shared/runtime', 'shared/project', 'tests']) {
      await mkdir(path(folder), { recursive: true });
    }
    await mkdir(home, { recursive: true });
    const governorDir = join(home, 'Documents', 'Stephanos-openclaw-workspace', 'vr');
    await mkdir(governorDir, { recursive: true });
    await writeFile(join(governorDir, 'vr-resource-governor-current.json'),
      JSON.stringify({ schemaVersion: 'stephanos.vr-resource-governor.v1',
        active: false, localModelAllowed: true, updatedAtUtc: new Date().toISOString() }));
    await copyFile(join(sourceRoot, 'scripts/seed-canopy-parallel-builder.mjs'),
      path('scripts/seed-canopy-parallel-builder.mjs'));
    await copyFile(join(sourceRoot, 'shared/runtime/seedCanopyParallelForgeV1.mjs'),
      path('shared/runtime/seedCanopyParallelForgeV1.mjs'));
    await copyFile(join(sourceRoot, 'scripts/seed-canopy-parallel-supervisor.mjs'),
      path('scripts/seed-canopy-parallel-supervisor.mjs'));
    await copyFile(join(sourceRoot, 'shared/runtime/seedCanopyParallelSupervisorV1.mjs'),
      path('shared/runtime/seedCanopyParallelSupervisorV1.mjs'));
    await copyFile(join(sourceRoot, 'shared/runtime/seedCanopyParallelResourceV1.mjs'),
      path('shared/runtime/seedCanopyParallelResourceV1.mjs'));
    await writeFile(path('shared/project/seedGardenProjectionV1.mjs'),
      'export const HIGH_LEVEL_FLYWHEEL_SEEDS_V1 = ' + JSON.stringify([{
        seedId: SEED_ID, issue: '#3096',
        title: 'Fixture Seed',
        source: 'shared/project/seedGardenProjectionV1.mjs',
        growthRungs: ['INVENTORY'],
      }]) + ';\n');
    await writeFile(path('tests/fixture-safe.test.mjs'),
      'import test from "node:test"; import assert from "node:assert/strict"; test("fixture",()=>assert.ok(true));\n');
    const git = (...args) => {
      const result = command('git', args, { cwd: repo });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git('init', '-b', 'main');
    git('config', 'user.name', 'Seed Fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    git('add', '.');
    git('commit', '-m', 'fixture baseline');
    const main = git('rev-parse', 'main');
    const portPromise = new Promise((done) => {
      server = createServer((req, res) => {
        if (req.url === '/api/ps' && req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ models: [{ name: 'mock-fixture-model' }] }));
          return;
        }
        if (req.url !== '/api/generate' || req.method !== 'POST') {
          res.writeHead(404); res.end(); return;
        }
        // Deliberately no actual inference: verifies every real Git/receipt step only.
        req.resume();
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ response: JSON.stringify({
            path: TARGET, content: '# Parallel Forge\n\nFixture model-generated source candidate.\n',
          }) }));
        });
      });
      server.listen(0, '127.0.0.1', () => done(server.address().port));
    });
    const port = await portPromise;
    const request = {
      schemaVersion: 'stephanos.seed-parallel-build-request.v1',
      seedId: SEED_ID, ownerIssue: '#3096',
      contractSource: 'shared/project/seedGardenProjectionV1.mjs',
      taskId: TASK_ID,
      intent: 'Create one harmless architecture document demonstrating isolated source authorship.',
      targetPath: TARGET, expectedTargetSha256: null, baseSha: main,
      testPaths: ['tests/fixture-safe.test.mjs'],
      reviewAuthority: 'PROTECTED_REVIEW_REQUIRED',
      sourceScopeApproval: 'EXACT_TARGET_ONLY',
      mergeAllowed: false, deployAllowed: false,
    };
    const manifest = join(scratch, 'approved-bounded-request.json');
    await writeFile(manifest, JSON.stringify(request));
    const env = { ...process.env, HOME: home, USERPROFILE: home,
      STEPHANOS_SEED_LOCAL_PORT: String(port), STEPHANOS_SEED_LOCAL_MODEL: 'mock-fixture-model' };
    const executable = path('scripts/seed-canopy-parallel-builder.mjs');
    const supervisor = path('scripts/seed-canopy-parallel-supervisor.mjs');
    const scope = createHash('sha256').update(resolve(repo)).digest('hex').slice(0, 12);
    const stateRoot = join(home, '.stephanos', 'seed-parallel', scope);
    await mkdir(join(stateRoot, 'inbox'), { recursive: true });
    await mkdir(join(stateRoot, 'approvals'), { recursive: true });
    const raw = await readFile(manifest, 'utf8');
    await writeFile(join(stateRoot, 'inbox', TASK_ID + '.json'), raw);
    const direct = await runAsync(process.execPath, [
      path('scripts/seed-canopy-parallel-builder.mjs'), 'build', manifest, '--execute',
    ], { cwd: repo, env });
    assert.notEqual(direct.code, 0);
    assert.match(direct.stderr, /EXACT_LOCAL_OPERATOR_APPROVAL_MISSING_OR_UNREADABLE/);
    const issuedAtUtc = new Date().toISOString();
    const approval = makeParallelSeedExactApprovalV1({
      request, manifestSha256: parallelSeedManifestHashV1(raw), nowUtc: issuedAtUtc,
      expiryUtc: new Date(Date.parse(issuedAtUtc) + 3600000).toISOString(),
    });
    await writeFile(join(stateRoot, 'approvals', TASK_ID + '.json'), JSON.stringify(approval));
    const run = await runAsync(process.execPath, [supervisor, 'run-once'], { cwd: repo, env });
    assert.equal(run.code, 0, run.stderr);
    const completed = JSON.parse(await readFile(
      join(stateRoot, 'receipts', TASK_ID + '.json'), 'utf8'));
    assert.equal(completed.stage, 'COMMITTED');
    assert.match(completed.commitSha, /^[a-f0-9]{40}$/);
    assert.equal(completed.merged, false);
    assert.equal(completed.deployed, false);
    assert.equal(completed.goalCompleted, false);
    assert.equal(git('rev-parse', 'main'), main, 'canonical main must remain unchanged');
    assert.equal(git('branch', '--show-current'), 'main');
    const worktreeFile = join(completed.worktree, TARGET);
    assert.match(await readFile(worktreeFile, 'utf8'), /Fixture model-generated source candidate/);
    const commit = command('git', ['rev-parse', 'HEAD'], { cwd: completed.worktree });
    assert.equal(commit.stdout.trim(), completed.commitSha);
    const persisted = JSON.parse(await readFile(
      join(stateRoot, 'receipts', TASK_ID + '.json'), 'utf8'));
    assert.equal(persisted.commitSha, completed.commitSha);
    const status = await runAsync(process.execPath, [supervisor, 'status'], { cwd: repo, env });
    assert.equal(status.code, 0, status.stderr);
    const supervised = JSON.parse(status.stdout);
    assert.equal(supervised.taskCount, 1);
    assert.equal(supervised.tasks[0].candidateCommitted, true);
    assert.equal(supervised.tasks[0].merged, false);
    assert.equal(supervised.liveBuildProven, true);
    const emptyRun = await runAsync(process.execPath, [supervisor, 'run-once'], { cwd: repo, env });
    assert.equal(emptyRun.code, 0, emptyRun.stderr);
    assert.equal(JSON.parse(emptyRun.stdout).ran, false);
    const claim = JSON.parse(await readFile(
      join(stateRoot, 'receipts', TASK_ID + '.claim'), 'utf8'));
    assert.equal(claim.targetPath, TARGET);
    const second = await runAsync(process.execPath, [executable, 'build', manifest, '--execute'],
      { cwd: repo, env });
    assert.notEqual(second.code, 0);
    assert.match(second.stderr, /TASK_ALREADY_HAS_A_RECEIPT|TASK_ALREADY_CLAIMED/);
    assert.equal(git('rev-parse', 'main'), main);
  } finally {
    if (server) await new Promise((resolveDone) => server.close(resolveDone));
    await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
  }
});
