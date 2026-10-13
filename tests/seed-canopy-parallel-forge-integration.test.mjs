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
import { SEED_PARALLEL_APPROVAL_REF_SCHEMA } from '../shared/runtime/seedCanopyParallelGitHubApprovalV1.mjs';

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
  let ownerComment = null;
  try {
    for (const folder of ['scripts', 'shared/runtime', 'shared/project', 'shared/agents', 'tests']) {
      await mkdir(path(folder), { recursive: true });
    }
    await mkdir(home, { recursive: true });
    const governorDir = join(home, 'Documents', 'Stephanos-openclaw-workspace', 'vr');
    await mkdir(governorDir, { recursive: true });
    await writeFile(join(governorDir, 'vr-resource-governor-current.json'),
      JSON.stringify({ schemaVersion: 'stephanos.vr-resource-governor.v1',
        active: false, phase: 'NORMAL', localModelAllowed: true, updatedAtUtc: new Date().toISOString() }));
    const builderModule = await readFile(join(sourceRoot, 'scripts/seed-canopy-parallel-builder.mjs'), 'utf8');
    // The fixture supplies its own fresh governor; never run production Windows
    // resource reconciliation or model workloads in a temporary test checkout.
    await writeFile(path('scripts/seed-canopy-parallel-builder.mjs'),
      builderModule.replaceAll("process.platform === 'win32'", 'false'));
    await copyFile(join(sourceRoot, 'shared/agents/battleBridgeExecutionBoundaryV1.mjs'),
      path('shared/agents/battleBridgeExecutionBoundaryV1.mjs'));
    await copyFile(join(sourceRoot, 'shared/agents/battleBridgeWindowsHosts.mjs'),
      path('shared/agents/battleBridgeWindowsHosts.mjs'));
    await copyFile(join(sourceRoot, 'shared/runtime/seedCanopyParallelForgeV1.mjs'),
      path('shared/runtime/seedCanopyParallelForgeV1.mjs'));
    await copyFile(join(sourceRoot, 'scripts/seed-canopy-parallel-supervisor.mjs'),
      path('scripts/seed-canopy-parallel-supervisor.mjs'));
    await copyFile(join(sourceRoot, 'shared/runtime/seedCanopyParallelSupervisorV1.mjs'),
      path('shared/runtime/seedCanopyParallelSupervisorV1.mjs'));
    // A deliberately modified fixture-only copy redirects the immutable production
    // GitHub owner proof URL to our loopback stub; production source stays HTTPS-fixed.
    const approvalModule = await readFile(join(sourceRoot,
      'shared/runtime/seedCanopyParallelGitHubApprovalV1.mjs'), 'utf8');
    const githubLiteral = "'https://api.github.com/repos/' + REPO + '/issues/comments/'";
    if (!approvalModule.includes(githubLiteral)) throw new Error('GITHUB_APPROVAL_FIXTURE_ANCHOR_MISSING');
    await writeFile(path('shared/runtime/seedCanopyParallelGitHubApprovalV1.mjs'),
      approvalModule.replace(githubLiteral,
        "('http://127.0.0.1:' + process.env.STEPHANOS_SEED_LOCAL_PORT + '/repos/') + REPO + '/issues/comments/'"));
    const resourceModule = await readFile(join(sourceRoot,
      'shared/runtime/seedCanopyParallelResourceV1.mjs'), 'utf8');
    const custodyAnchor = 'SEED_PARALLEL_ROUTER_GOVERNOR_CUSTODY_IMPLEMENTED = false';
    assert.ok(resourceModule.includes(custodyAnchor));
    await writeFile(path('shared/runtime/seedCanopyParallelResourceV1.mjs'), resourceModule);
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
    let main = git('rev-parse', 'main');
    const portPromise = new Promise((done) => {
      server = createServer((req, res) => {
        if (req.url === '/repos/Cheekyfellastef/stephan-os/issues/comments/7654321'
          && req.method === 'GET' && ownerComment) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(ownerComment));
          return;
        }
        if (req.url === '/models' && req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'mock-fixture-model', status: { value: 'loaded', args: ['llama-server'] } }] }));
          return;
        }
        // An inference call without atomic autoload=false must fail the fixture.
        if (req.url !== '/v1/completions?autoload=false' || req.method !== 'POST') {
          res.writeHead(404); res.end(); return;
        }
        // Deliberately no actual inference: verifies every real Git/receipt step only.
        req.resume();
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ text: JSON.stringify({
            path: TARGET, content: '# Parallel Forge\n\nFixture model-generated source candidate.\n',
          }) }] }));
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
    // Four earlier, valid but UNAPPROVED manifests must not consume the four
    // GitHub owner-approval verification slots or starve the eligible fifth.
    for (const taskId of ['aaa-unapproved', 'aab-unapproved', 'aac-unapproved', 'aad-unapproved']) {
      await writeFile(join(stateRoot, 'inbox', taskId + '.json'),
        JSON.stringify({ ...request, taskId }));
    }
    // Poison four earlier approval-pointer files. Only schema-valid references
    // may consume the bounded GitHub verification budget.
    for (const taskId of ['aae-badref', 'aaf-badref', 'aag-badref', 'aah-badref']) {
      await writeFile(join(stateRoot, 'inbox', taskId + '.json'),
        JSON.stringify({ ...request, taskId }));
      await writeFile(join(stateRoot, 'approvals', taskId + '.json'), '{}');
    }
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
    ownerComment = {
      id: 7654321, user: { login: 'Cheekyfellastef' }, author_association: 'OWNER',
      issue_url: 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/3096',
      created_at: issuedAtUtc, updated_at: issuedAtUtc,
      body: '```stephanos-seed-parallel-owner-approval\n' +
        JSON.stringify(approval) + '\n```',
    };
    await writeFile(join(stateRoot, 'approvals', TASK_ID + '.json'),
      JSON.stringify({ schemaVersion: SEED_PARALLEL_APPROVAL_REF_SCHEMA, commentId: 7654321 }));
    // Production must reject even a valid owner approval before any router call
    // or new task claim. Only this ephemeral fixture uses a mocked custody gate.
    const held = await runAsync(process.execPath, [executable, 'build', manifest, '--execute'], { cwd: repo, env });
    assert.notEqual(held.code, 0);
    assert.match(held.stderr, /RESIDENT_ROUTER_GOVERNOR_CUSTODY_UNIMPLEMENTED/);
    const { access } = await import('node:fs/promises');
    await assert.rejects(() => access(join(stateRoot, 'receipts', TASK_ID + '.claim')));
    await writeFile(path('shared/runtime/seedCanopyParallelResourceV1.mjs'),
      resourceModule.replace(custodyAnchor, 'SEED_PARALLEL_ROUTER_GOVERNOR_CUSTODY_IMPLEMENTED = true'));
    git('add', '--', 'shared/runtime/seedCanopyParallelResourceV1.mjs');
    git('commit', '-m', 'fixture-only mocked custody');
    // Bind all fixture approval evidence to its new exact fixture base.
    main = git('rev-parse', 'main');
    request.baseSha = main;
    const fixtureRaw = JSON.stringify(request);
    await writeFile(manifest, fixtureRaw);
    await writeFile(join(stateRoot, 'inbox', TASK_ID + '.json'), fixtureRaw);
    ownerComment.body = '```stephanos-seed-parallel-owner-approval\n' + JSON.stringify(
      makeParallelSeedExactApprovalV1({ request, manifestSha256: parallelSeedManifestHashV1(fixtureRaw),
        nowUtc: issuedAtUtc, expiryUtc: new Date(Date.parse(issuedAtUtc) + 3600000).toISOString() })
    ) + '\n```';
    const run = await runAsync(process.execPath, [supervisor, 'run-once'], { cwd: repo, env });
    assert.equal(run.code, 0, run.stderr);
    // GitHub may return the live canonical issue title or be unavailable.
    // Both states must be labelled accurately, never invented or self-attested.
    const titleReport = run.stdout.match(/"owner": "([^"\n]+)"[\s\S]*?"issueTitleTruth": "([^"]+)"/);
    assert.ok(titleReport, 'operator report must include issue title truth');
    const [, reportedOwner, titleTruth] = titleReport;
    if (titleTruth === 'UNAVAILABLE') {
      assert.equal(reportedOwner, '#3096 — title unavailable from current evidence');
    } else {
      assert.equal(titleTruth, 'CURRENT_CANONICAL_GITHUB');
      assert.match(reportedOwner, /^#3096 — (?!title unavailable from current evidence).+/);
    }
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
    assert.equal(supervised.localSourceCandidateProven, true);
    assert.equal(supervised.liveBuildProven, false);
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
    // Adversarial post-build receipt forgery: a second clean commit plus a
    // locally rewritten receipt is NOT verified proof of the approved build.
    await writeFile(join(completed.worktree, 'unapproved-extra.md'), 'out-of-scope\\n');
    const extraAdd = command('git', ['add', '--', 'unapproved-extra.md'], { cwd: completed.worktree });
    assert.equal(extraAdd.status, 0, extraAdd.stderr);
    const extraCommit = command('git', ['commit', '-m', 'unrelated fixture mutation'], { cwd: completed.worktree });
    assert.equal(extraCommit.status, 0, extraCommit.stderr);
    const forgedSha = command('git', ['rev-parse', 'HEAD'], { cwd: completed.worktree }).stdout.trim();
    await writeFile(join(stateRoot, 'receipts', TASK_ID + '.json'),
      JSON.stringify({ ...persisted, commitSha: forgedSha }, null, 2));
    const forgedStatus = await runAsync(process.execPath, [supervisor, 'status'], { cwd: repo, env });
    assert.equal(forgedStatus.code, 0, forgedStatus.stderr);
    const forgedProjection = JSON.parse(forgedStatus.stdout);
    assert.equal(forgedProjection.tasks[0].candidateCommitted, false);
    assert.equal(forgedProjection.liveBuildProven, false);
    assert.equal(git('rev-parse', 'main'), main);
  } finally {
    if (server) await new Promise((resolveDone) => server.close(resolveDone));
    await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
  }
});
