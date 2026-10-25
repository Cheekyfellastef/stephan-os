import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, writeFile, copyFile, rename, rm, realpath } from 'node:fs/promises';
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
const TRACKED_TARGET = 'docs/architecture/tracked-seed-result.md';
const TRACKED_CONTENT = '# Existing seed proposal\n';

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
async function runForgeFixture({ admissionOnly = false } = {}) {
  // Windows TEMP may use an 8.3 alias. Qualify the newly owned fixture's
  // native path rather than weakening production's no-redirection check.
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'stephanos-seed-parallel-')));
  assert.equal(scratch, await realpath(scratch));
  const repo = join(scratch, 'fixture-repo');
  const home = join(scratch, 'operator-home');
  const path = (relative) => join(repo, relative);
  let server;
  let ownerComment = null;
  let secondOwnerComment = null;
  const extraOwnerComments = new Map();
  let approvalFetches = 0;
  let inferenceCount = 0;
  let advanceMainOnNextInference = false;
  let redirectParentOnNextInference = null;
  let poisonTestOnNextInference = null;
  let poisonLocalGitConfigOnNextInference = false;
  let modelResponsePath = TARGET;
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
    const writeCustodyAnchor = 'SEED_PARALLEL_TARGET_WRITE_CUSTODY_IMPLEMENTED = false';
    assert.ok(resourceModule.includes(writeCustodyAnchor));
    // This modified copy is exclusively a disposable Git test fixture. There
    // is no production environment/manifest switch for either missing custody.
    const fixtureWriteResourceModule = resourceModule.replace(writeCustodyAnchor,
      'SEED_PARALLEL_TARGET_WRITE_CUSTODY_IMPLEMENTED = true');
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
    // Production boundary requires the one canonical origin even in an ephemeral fixture.
    git('remote', 'add', 'origin', 'https://github.com/Cheekyfellastef/stephan-os.git');
    git('config', 'user.name', 'Seed Fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    await mkdir(path('docs/architecture'), { recursive: true });
    await writeFile(path(TRACKED_TARGET), TRACKED_CONTENT);
    git('add', '.');
    git('commit', '-m', 'fixture baseline');
    let main = git('rev-parse', 'main');
    git('update-ref', 'refs/remotes/origin/main', main);
    const portPromise = new Promise((done) => {
      server = createServer((req, res) => {
        if (req.url.startsWith('/repos/Cheekyfellastef/stephan-os/issues/comments/')) approvalFetches += 1;
        const comment = req.url === '/repos/Cheekyfellastef/stephan-os/issues/comments/7654321'
          ? ownerComment
          : req.url === '/repos/Cheekyfellastef/stephan-os/issues/comments/7654322'
            ? secondOwnerComment : extraOwnerComments.get(req.url);
        if (req.method === 'GET' && comment) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(comment));
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
        inferenceCount += 1;
        req.resume();
        req.on('end', () => {
          if (poisonTestOnNextInference) {
            const { taskId } = poisonTestOnNextInference;
            poisonTestOnNextInference = null;
            const testInWorktree = join(home, '.stephanos', 'seed-parallel',
              createHash('sha256').update(resolve(repo)).digest('hex').slice(0, 12),
              'worktrees', taskId, 'tests', 'fixture-safe.test.mjs');
            writeFileSync(testInWorktree,
              'throw new Error("UNAPPROVED_TEST_CODE_EXECUTED");\n');
          }
          if (redirectParentOnNextInference) {
            const { taskId, outside } = redirectParentOnNextInference;
            redirectParentOnNextInference = null;
            const docsParent = join(home, '.stephanos', 'seed-parallel',
              createHash('sha256').update(resolve(repo)).digest('hex').slice(0, 12),
              'worktrees', taskId, 'docs');
            mkdirSync(docsParent, { recursive: true });
            renameSync(join(docsParent, 'architecture'), join(docsParent, 'architecture.original'));
            symlinkSync(outside, join(docsParent, 'architecture'), 'dir');
          }
          if (poisonLocalGitConfigOnNextInference) {
            poisonLocalGitConfigOnNextInference = false;
            // Simulate a same-account actor altering persisted repository Git
            // configuration while local inference is in flight. This must
            // never cause git add to execute a local filter command.
            const injected = command('git',
              ['config', '--local', 'filter.seedtrap.clean', 'cat'],
              { cwd: repo });
            assert.equal(injected.status, 0, injected.stderr);
          }
          if (advanceMainOnNextInference) {
            advanceMainOnNextInference = false;
            const moved = command('git', ['commit', '--allow-empty', '-m',
              'fixture: main advanced during inference'], { cwd: repo });
            assert.equal(moved.status, 0, moved.stderr);
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ text: JSON.stringify({
            path: modelResponsePath, content: '# Parallel Forge\n\nFixture model-generated source candidate.\n',
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
    // Schema-valid rejected references must not monopolize all four lookups
    // across separate real supervisor processes. This uses unavailable, expired
    // and wrong-task live HTTP responses, not malformed local-pointer shortcuts.
    const rejectedTasks = ['aai-unavailable', 'aaj-expired', 'aak-wrong-task', 'aal-unavailable'];
    for (let i = 0; i < rejectedTasks.length; i++) {
      const taskId = rejectedTasks[i];
      await writeFile(join(stateRoot, 'inbox', taskId + '.json'),
        JSON.stringify({ ...request, taskId }));
      const commentId = 7654330 + i;
      await writeFile(join(stateRoot, 'approvals', taskId + '.json'),
        JSON.stringify({ schemaVersion: SEED_PARALLEL_APPROVAL_REF_SCHEMA, commentId }));
      if (i === 1 || i === 2) {
        const rejectedRequest = i === 1 ? { ...request, taskId } : request;
        const rejectedRaw = JSON.stringify(rejectedRequest);
        const old = new Date(Date.now() - 7200000).toISOString();
        const evidence = makeParallelSeedExactApprovalV1({
          request: rejectedRequest, manifestSha256: parallelSeedManifestHashV1(rejectedRaw),
          nowUtc: i === 1 ? old : issuedAtUtc,
          expiryUtc: i === 1 ? new Date(Date.now() - 3600000).toISOString()
            : new Date(Date.now() + 3600000).toISOString(),
        });
        extraOwnerComments.set('/repos/Cheekyfellastef/stephan-os/issues/comments/' + commentId,
          { ...ownerComment, id: commentId,
            created_at: i === 1 ? old : issuedAtUtc, updated_at: i === 1 ? old : issuedAtUtc,
            body: '\x60\x60\x60stephanos-seed-parallel-owner-approval\n' + JSON.stringify(evidence) + '\n\x60\x60\x60' });
      }
    }
    const fetchesBefore = approvalFetches;
    const firstBatch = await runAsync(process.execPath, [supervisor, 'inbox'], { cwd: repo, env });
    assert.equal(firstBatch.code, 0, firstBatch.stderr);
    assert.equal(JSON.parse(firstBatch.stdout).selected, null);
    assert.equal(approvalFetches - fetchesBefore, 4);
    const savedCursor = JSON.parse(await readFile(join(stateRoot, 'approval-verification-cursor.json'), 'utf8'));
    assert.equal(savedCursor.afterFilename, 'aal-unavailable.json');
    const beforeSecond = approvalFetches;
    const secondBatch = await runAsync(process.execPath, [supervisor, 'inbox'], { cwd: repo, env });
    assert.equal(secondBatch.code, 0, secondBatch.stderr);
    assert.equal(JSON.parse(secondBatch.stdout).selected, TASK_ID);
    assert.equal(approvalFetches - beforeSecond, 4);
    assert.equal(inferenceCount, 0);
    await assert.rejects(() => access(join(stateRoot, 'receipts', TASK_ID + '.claim')));
    for (const taskId of rejectedTasks) {
      await rm(join(stateRoot, 'inbox', taskId + '.json'));
      await rm(join(stateRoot, 'approvals', taskId + '.json'));
    }
    extraOwnerComments.clear();
    // Production must reject even a valid owner approval before any router call
    // or new task claim. Only this ephemeral fixture uses a mocked custody gate.
    const held = await runAsync(process.execPath, [executable, 'build', manifest, '--execute'], { cwd: repo, env });
    assert.notEqual(held.code, 0);
    assert.match(held.stderr, /SEED_TARGET_WRITE_CUSTODY_UNIMPLEMENTED/);
    await assert.rejects(() => access(join(stateRoot, 'receipts', TASK_ID + '.claim')));
    await assert.rejects(() => access(join(stateRoot, 'target-claims')));
    await assert.rejects(() => access(join(stateRoot, 'worktrees')));
    assert.equal(inferenceCount, 0);
    // Deterministic generation must hit the SAME production custody hold;
    // a fresh owner approval cannot turn pathname checks into physical fencing.
    const inventoryRequest = { ...request, generationMode: 'CANONICAL_INVENTORY_V1' };
    const inventoryRaw = JSON.stringify(inventoryRequest);
    const originalOwnerBody = ownerComment.body;
    ownerComment.body = '```stephanos-seed-parallel-owner-approval\n' + JSON.stringify(
      makeParallelSeedExactApprovalV1({ request: inventoryRequest,
        manifestSha256: parallelSeedManifestHashV1(inventoryRaw), nowUtc: issuedAtUtc,
        expiryUtc: new Date(Date.parse(issuedAtUtc) + 3600000).toISOString() })) + '\n```';
    await writeFile(manifest, inventoryRaw);
    const inventoryHeld = await runAsync(process.execPath,
      [executable, 'build', manifest, '--execute'], { cwd: repo, env });
    assert.notEqual(inventoryHeld.code, 0);
    assert.match(inventoryHeld.stderr, /SEED_TARGET_WRITE_CUSTODY_UNIMPLEMENTED/);
    await assert.rejects(() => access(join(stateRoot, 'receipts', TASK_ID + '.claim')));
    await assert.rejects(() => access(join(stateRoot, 'target-claims')));
    await assert.rejects(() => access(join(stateRoot, 'worktrees')));
    assert.equal(inferenceCount, 0);
    assert.equal(git('rev-parse', 'main'), main);
    ownerComment.body = originalOwnerBody;
    await writeFile(manifest, raw);
    // Independently retain the original model-custody admission hold after
    // mocking ONLY target custody in the disposable fixture.
    await writeFile(path('shared/runtime/seedCanopyParallelResourceV1.mjs'), fixtureWriteResourceModule);
    const routerHeld = await runAsync(process.execPath,
      [executable, 'build', manifest, '--execute'], { cwd: repo, env });
    assert.notEqual(routerHeld.code, 0);
    assert.match(routerHeld.stderr, /RESIDENT_ROUTER_GOVERNOR_CUSTODY_UNIMPLEMENTED/);
    assert.equal(inferenceCount, 0);
    await assert.rejects(() => access(join(stateRoot, 'receipts', TASK_ID + '.claim')));
    if (admissionOnly) return;
    await writeFile(path('shared/runtime/seedCanopyParallelResourceV1.mjs'),
      fixtureWriteResourceModule.replace(custodyAnchor, 'SEED_PARALLEL_ROUTER_GOVERNOR_CUSTODY_IMPLEMENTED = true'));
    git('add', '--', 'shared/runtime/seedCanopyParallelResourceV1.mjs');
    git('commit', '-m', 'fixture-only mocked custody');
    // Bind all fixture approval evidence to its new exact fixture base.
    main = git('rev-parse', 'main');
    git('update-ref', 'refs/remotes/origin/main', main);
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
    assert.equal(completed.pickupProof?.localSourceReadback, 'VERIFIED');
    assert.equal(completed.pickupProof?.gitHead, main);
    assert.equal(completed.pickupProof?.gitBranch,
      'seed-parallel/' + SEED_ID + '/' + TASK_ID);
    assert.equal(completed.pickupProof?.independentHostCustody, 'NOT_PROVEN');
    assert.equal(completed.pickupProof?.unattendedBuildQualified, false);
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
    // A status request must never execute persisted Git filters. Prove this
    // exact fixture is executable by ordinary Git, then require the production
    // supervisor to stay passive even with a plausible COMMITTED receipt.
    const attributes = path('.git/info/attributes');
    const trapScript = join(scratch, 'status-filter-trap.cjs');
    const trapMarker = join(scratch, 'status-filter-ran.txt');
    const targetBeforeTrap = await readFile(join(completed.worktree, TARGET));
    let attributesBeforeTrap = null;
    try { attributesBeforeTrap = await readFile(attributes); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await writeFile(trapScript, [
      "const fs = require('node:fs');",
      'fs.writeFileSync(' + JSON.stringify(trapMarker) + ', "fixture-only");',
      'process.stdout.write(fs.readFileSync(0));',
    ].join('\n'));
    const filterCommand = '"' + process.execPath.replaceAll('\\', '/') + '" "'
      + trapScript.replaceAll('\\', '/') + '"';
    git('config', '--local', 'filter.seedstatustrap.clean', filterCommand);
    await writeFile(attributes, TARGET + ' filter=seedstatustrap\n');
    try {
      // Git can classify a changed size without cleaning the file. Keep the
      // size identical so its content comparison actually needs the filter.
      const changedBytes = Buffer.from(targetBeforeTrap);
      assert.ok(changedBytes.length > 0);
      changedBytes[0] = changedBytes[0] === 35 ? 33 : 35;
      await writeFile(join(completed.worktree, TARGET), changedBytes);
      const attr = command('git', ['check-attr', 'filter', '--', TARGET],
        { cwd: completed.worktree });
      assert.equal(attr.status, 0, attr.stderr);
      assert.match(attr.stdout, /filter: seedstatustrap/);
      const vulnerableControl = command('git',
        ['status', '--porcelain', '--untracked-files=all'], { cwd: completed.worktree });
      assert.equal(vulnerableControl.status, 0, vulnerableControl.stderr);
      await access(trapMarker);
      await rm(trapMarker);
      const passiveStatus = await runAsync(process.execPath,
        [supervisor, 'status'], { cwd: repo, env });
      assert.equal(passiveStatus.code, 0, passiveStatus.stderr);
      assert.equal(JSON.parse(passiveStatus.stdout).localCommitReadbackMatchedUntrusted, false);
      assert.equal(JSON.parse(passiveStatus.stdout).localSourceCandidateProven, false);
      await assert.rejects(access(trapMarker), { code: 'ENOENT' },
        'supervisor status must not execute the persisted filter');
    } finally {
      git('config', '--local', '--unset', 'filter.seedstatustrap.clean');
      if (attributesBeforeTrap === null) await rm(attributes, { force: true });
      else await writeFile(attributes, attributesBeforeTrap);
      await writeFile(join(completed.worktree, TARGET), targetBeforeTrap);
      await rm(trapMarker, { force: true });
    }

    const status = await runAsync(process.execPath, [supervisor, 'status'], { cwd: repo, env });
    assert.equal(status.code, 0, status.stderr);
    const supervised = JSON.parse(status.stdout);
    assert.equal(supervised.taskCount, 1);
    assert.equal(supervised.tasks[0].localCommitReadbackMatched, false);
    assert.equal(supervised.tasks[0].candidateCommitted, false);
    assert.equal(supervised.tasks[0].merged, false);
    assert.equal(supervised.localSourceCandidateProven, false);
    assert.equal(supervised.localCommitReadbackMatchedUntrusted, false);
    assert.equal(supervised.candidateTrustBlocker,
      'INDEPENDENT_CANDIDATE_PROVENANCE_NOT_COMMISSIONED');
    assert.equal(supervised.liveBuildProven, false);
    // Even if a metadata pointer resolves to the SAME administrative directory,
    // a symlink cannot authenticate the original linked worker checkout.
    if (process.platform !== 'win32') {
      const pointer = join(completed.worktree, '.git');
      const parkedPointer = pointer + '.original';
      const rawPointer = await readFile(pointer, 'utf8');
      assert.match(rawPointer, /^gitdir: /);
      await rename(pointer, parkedPointer);
      symlinkSync(parkedPointer, pointer);
      try {
        const redirected = await runAsync(process.execPath,
          [supervisor, 'status'], { cwd: repo, env });
        assert.equal(redirected.code, 0, redirected.stderr);
        const redirectedStatus = JSON.parse(redirected.stdout);
        assert.equal(redirectedStatus.localSourceCandidateProven, false,
          'symlinked worktree metadata is not independently attributable');
        assert.equal(redirectedStatus.liveBuildProven, false);
      } finally {
        await rm(pointer);
        await rename(parkedPointer, pointer);
      }
      const restored = await runAsync(process.execPath,
        [supervisor, 'status'], { cwd: repo, env });
      assert.equal(restored.code, 0, restored.stderr);
      const recovered = JSON.parse(restored.stdout);
      assert.equal(recovered.localCommitReadbackMatchedUntrusted, false);
      assert.equal(recovered.localSourceCandidateProven, false);
    }
    const approvalPath = join(stateRoot, 'approvals', TASK_ID + '.json');
    const validPointer = await readFile(approvalPath, 'utf8');
    await writeFile(approvalPath, '{}');
    const noApproval = await runAsync(process.execPath, [supervisor, 'status'], { cwd: repo, env });
    assert.equal(JSON.parse(noApproval.stdout).localSourceCandidateProven, false,
      'local claims and commits cannot replace external owner approval');
    await writeFile(approvalPath, validPointer);
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
    // Porcelain's leading space is the index status for a tracked edit.
    // Exercise the real worker, not a duplicate of its string parser: the
    // approved existing file must survive scope checks and reach commit.
    const trackedRequest = { ...request, taskId: 'tracked-file-update-fixture',
      targetPath: TRACKED_TARGET,
      expectedTargetSha256: createHash('sha256').update(TRACKED_CONTENT).digest('hex') };
    const trackedRaw = JSON.stringify(trackedRequest);
    const trackedManifest = join(scratch, 'tracked-file-update.json');
    await writeFile(trackedManifest, trackedRaw);
    await writeFile(join(stateRoot, 'approvals', trackedRequest.taskId + '.json'),
      JSON.stringify({ schemaVersion: SEED_PARALLEL_APPROVAL_REF_SCHEMA, commentId: 7654322 }));
    const trackedNow = new Date().toISOString();
    secondOwnerComment = { ...ownerComment, id: 7654322,
      created_at: trackedNow, updated_at: trackedNow,
      body: '```stephanos-seed-parallel-owner-approval\n' + JSON.stringify(
        makeParallelSeedExactApprovalV1({ request: trackedRequest,
          manifestSha256: parallelSeedManifestHashV1(trackedRaw), nowUtc: trackedNow,
          expiryUtc: new Date(Date.parse(trackedNow) + 3600000).toISOString() })) + '\n```' };
    modelResponsePath = TRACKED_TARGET;
    const trackedRun = await runAsync(process.execPath,
      [executable, 'build', trackedManifest, '--execute'], { cwd: repo, env });
    assert.equal(trackedRun.code, 0, trackedRun.stderr);
    const trackedReceipt = JSON.parse(await readFile(
      join(stateRoot, 'receipts', trackedRequest.taskId + '.json'), 'utf8'));
    assert.equal(trackedReceipt.stage, 'COMMITTED');
    assert.equal(git('rev-parse', 'main'), main);
    assert.equal(await readFile(path(TRACKED_TARGET), 'utf8'), TRACKED_CONTENT);
    assert.match(await readFile(join(trackedReceipt.worktree, TRACKED_TARGET), 'utf8'),
      /Fixture model-generated source candidate/);
    modelResponsePath = TARGET;
    secondOwnerComment = null;

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
    // A wholly fabricated clean clone with the approved parent/path/content and
    // valid owner pointer must still fail canonical linked-worktree identity.
    await rename(completed.worktree, completed.worktree + '.owned');
    const clone = command('git', ['clone', '--no-hardlinks', repo, completed.worktree]);
    assert.equal(clone.status, 0, clone.stderr);
    const fakeGit = (...args) => {
      const x = command('git', ['-C', completed.worktree, ...args]);
      assert.equal(x.status, 0, x.stderr); return x.stdout.trim();
    };
    fakeGit('checkout', '-b', 'seed-parallel/' + SEED_ID + '/' + TASK_ID, main);
    fakeGit('config', 'user.name', 'Fabricated Fixture');
    fakeGit('config', 'user.email', 'fabricated@example.invalid');
    await mkdir(join(completed.worktree, 'docs/architecture'), { recursive: true });
    await writeFile(join(completed.worktree, TARGET), '# Parallel Forge\n\nFixture model-generated source candidate.\n');
    fakeGit('add', '--', TARGET);
    fakeGit('commit', '-m', 'fabricated source proof');
    await writeFile(join(stateRoot, 'receipts', TASK_ID + '.json'), JSON.stringify({
      ...persisted, commitSha: fakeGit('rev-parse', 'HEAD'),
    }));
    const fakeStatus = await runAsync(process.execPath, [supervisor, 'status'], { cwd: repo, env });
    assert.equal(JSON.parse(fakeStatus.stdout).localSourceCandidateProven, false);

    // A *second*, approved and disjoint seed task must be able to create a
    // truthful isolated documentation commit with NO resident llama.cpp model.
    // Restore the production GPU-custody hold in this temporary repository;
    // the deterministic path may not quietly re-enable the model path.
    await writeFile(path('shared/runtime/seedCanopyParallelResourceV1.mjs'), fixtureWriteResourceModule);
    git('add', '--', 'shared/runtime/seedCanopyParallelResourceV1.mjs');
    git('commit', '-m', 'restore production router custody hold in fixture');
    const deterministicBase = git('rev-parse', 'main');
    git('update-ref', 'refs/remotes/origin/main', deterministicBase);
    const deterministicTask = 'model-free-seed-inventory-fixture';
    const deterministicTarget = 'docs/architecture/model-free-seed-inventory.md';
    const deterministicRequest = { ...request, taskId: deterministicTask,
      targetPath: deterministicTarget, baseSha: deterministicBase,
      generationMode: 'CANONICAL_INVENTORY_V1', expectedTargetSha256: null };
    const deterministicRaw = JSON.stringify(deterministicRequest);
    await writeFile(join(stateRoot, 'inbox', deterministicTask + '.json'), deterministicRaw);
    await writeFile(join(stateRoot, 'approvals', deterministicTask + '.json'),
      JSON.stringify({ schemaVersion: SEED_PARALLEL_APPROVAL_REF_SCHEMA, commentId: 7654321 }));
    const deterministicNow = new Date().toISOString();
    ownerComment.created_at = deterministicNow;
    ownerComment.updated_at = deterministicNow;
    ownerComment.body = '```stephanos-seed-parallel-owner-approval\n' +
      JSON.stringify(makeParallelSeedExactApprovalV1({
        request: deterministicRequest,
        manifestSha256: parallelSeedManifestHashV1(deterministicRaw),
        nowUtc: deterministicNow,
        expiryUtc: new Date(Date.parse(deterministicNow) + 3600000).toISOString(),
      })) + '\n```';
    await writeFile(join(governorDir, 'vr-resource-governor-current.json'),
      JSON.stringify({ schemaVersion: 'stephanos.vr-resource-governor.v1',
        active: false, phase: 'NORMAL', localModelAllowed: true,
        updatedAtUtc: new Date().toISOString() }));
    const previousInferenceCalls = inferenceCount;
    const deterministicRun = await runAsync(process.execPath,
      [supervisor, 'run-once'], { cwd: repo, env });
    assert.equal(deterministicRun.code, 0, deterministicRun.stderr);
    const deterministicReceipt = JSON.parse(await readFile(
      join(stateRoot, 'receipts', deterministicTask + '.json'), 'utf8'));
    assert.equal(deterministicReceipt.stage, 'COMMITTED');
    assert.equal(deterministicReceipt.merged, false);
    assert.equal(deterministicReceipt.deployed, false);
    assert.equal(deterministicReceipt.goalCompleted, false);
    assert.equal(inferenceCount, previousInferenceCalls,
      'deterministic inventory never calls the unqualified local model');
    assert.equal(git('rev-parse', 'main'), deterministicBase,
      'even the model-free proposal must leave main unchanged');
    const deterministicSource = await readFile(
      join(deterministicReceipt.worktree, deterministicTarget), 'utf8');
    assert.match(deterministicSource, /SOURCE PROPOSAL ONLY/);
    assert.match(deterministicSource, /No physical observations were supplied/);
    assert.match(deterministicReceipt.commitSha, /^[a-f0-9]{40}$/);

    // A separately approved task cannot treat a stale locally tracked origin
    // as proof of canonical source freshness. It must BLOCK its own claim
    // without changing main or consuming other independent seed work.
    const originTaskId = 'origin-drift-seed-pilot';
    const originTarget = 'docs/architecture/origin-drift-seed-pilot.md';
    const originRequest = { ...request, taskId: originTaskId,
      targetPath: originTarget, baseSha: deterministicBase,
      generationMode: 'CANONICAL_INVENTORY_V1', expectedTargetSha256: null };
    const originRaw = JSON.stringify(originRequest);
    const originManifest = join(scratch, 'origin-drift-seed-manifest.json');
    await writeFile(originManifest, originRaw);
    await writeFile(join(stateRoot, 'approvals', originTaskId + '.json'),
      JSON.stringify({ schemaVersion: SEED_PARALLEL_APPROVAL_REF_SCHEMA, commentId: 7654321 }));
    const originNow = new Date().toISOString();
    ownerComment.created_at = originNow;
    ownerComment.updated_at = originNow;
    ownerComment.body = [
      '```stephanos-seed-parallel-owner-approval',
      JSON.stringify(makeParallelSeedExactApprovalV1({
        request: originRequest,
        manifestSha256: parallelSeedManifestHashV1(originRaw),
        nowUtc: originNow,
        expiryUtc: new Date(Date.parse(originNow) + 3600000).toISOString(),
      })),
      '```',
    ].join(String.fromCharCode(10));
    git('update-ref', 'refs/remotes/origin/main', main);
    const originBlocked = await runAsync(process.execPath,
      [executable, 'build', originManifest, '--execute'], { cwd: repo, env });
    assert.notEqual(originBlocked.code, 0);
    assert.match(originBlocked.stderr, /SEED_SOURCE_TRACKED_ORIGIN_MAIN_MISMATCH/);
    const originReceipt = JSON.parse(await readFile(
      join(stateRoot, 'receipts', originTaskId + '.json'), 'utf8'));
    assert.equal(originReceipt.stage, 'BLOCKED');
    assert.equal(originReceipt.goalCompleted, false);
    assert.equal(git('rev-parse', 'main'), deterministicBase);
    assert.equal(git('rev-parse', 'refs/remotes/origin/main'), main);
    git('update-ref', 'refs/remotes/origin/main', deterministicBase);

    // An already-approved model task must not write when main moves while
    // the mock model is answering. This is a real temporary Git concurrency
    // test, NOT a Battle Bridge source or OS-custody claim.
    await writeFile(path('shared/runtime/seedCanopyParallelResourceV1.mjs'),
      fixtureWriteResourceModule.replace(custodyAnchor,
        'SEED_PARALLEL_ROUTER_GOVERNOR_CUSTODY_IMPLEMENTED = true'));
    git('add', '--', 'shared/runtime/seedCanopyParallelResourceV1.mjs');
    git('commit', '-m', 'fixture-only mock model-custody setup');
    const raceBase = git('rev-parse', 'main');
    git('update-ref', 'refs/remotes/origin/main', raceBase);
    const raceTaskId = 'model-main-race-pilot';
    const raceTarget = 'docs/architecture/model-main-race-pilot.md';
    const raceRequest = { ...request, taskId: raceTaskId, targetPath: raceTarget,
      baseSha: raceBase, expectedTargetSha256: null };
    const raceRaw = JSON.stringify(raceRequest);
    const raceManifest = join(scratch, 'raced-model-request.json');
    await writeFile(raceManifest, raceRaw);
    await writeFile(join(stateRoot, 'approvals', raceTaskId + '.json'),
      JSON.stringify({ schemaVersion: SEED_PARALLEL_APPROVAL_REF_SCHEMA, commentId: 7654321 }));
    const raceNow = new Date().toISOString();
    ownerComment.created_at = raceNow;
    ownerComment.updated_at = raceNow;
    ownerComment.body = '```stephanos-seed-parallel-owner-approval\n' +
      JSON.stringify(makeParallelSeedExactApprovalV1({
        request: raceRequest, manifestSha256: parallelSeedManifestHashV1(raceRaw),
        nowUtc: raceNow,
        expiryUtc: new Date(Date.parse(raceNow) + 3600000).toISOString(),
      })) + '\n```';
    modelResponsePath = raceTarget;
    advanceMainOnNextInference = true;
    await writeFile(join(governorDir, 'vr-resource-governor-current.json'),
      JSON.stringify({ schemaVersion: 'stephanos.vr-resource-governor.v1',
        active: false, phase: 'NORMAL', localModelAllowed: true,
        updatedAtUtc: new Date().toISOString() }));
    const racedRun = await runAsync(process.execPath,
      [executable, 'build', raceManifest, '--execute'], { cwd: repo, env });
    assert.notEqual(racedRun.code, 0);
    assert.match(racedRun.stderr, /SEED_SOURCE_MAIN_ADVANCED_DURING_BUILD/);
    assert.notEqual(git('rev-parse', 'main'), raceBase);
    const racedReceipt = JSON.parse(await readFile(
      join(stateRoot, 'receipts', raceTaskId + '.json'), 'utf8'));
    assert.equal(racedReceipt.stage, 'BLOCKED');
    assert.equal(racedReceipt.failedStage, 'PHYSICAL_PICKUP');
    await assert.rejects(() => access(join(racedReceipt.worktree, raceTarget)), /ENOENT/);

    // POSIX fixture adversary: while an approved local model is responding,
    // replace the intended parent directory with an outward symlink. The
    // bounded worker must not write its proposal through that redirected path.
    // Windows junction/native stable-handle testing remains a host-specific gate.
    if (process.platform !== 'win32') {
      const aliasBase = git('rev-parse', 'main');
      git('update-ref', 'refs/remotes/origin/main', aliasBase);
      const aliasTaskId = 'model-parent-alias-pilot';
      const aliasTarget = 'docs/architecture/model-parent-alias-pilot.md';
      const aliasRequest = { ...request, taskId: aliasTaskId,
        targetPath: aliasTarget, baseSha: aliasBase, expectedTargetSha256: null };
      const aliasRaw = JSON.stringify(aliasRequest);
      const aliasManifest = join(scratch, 'aliased-model-request.json');
      await writeFile(aliasManifest, aliasRaw);
      await writeFile(join(stateRoot, 'approvals', aliasTaskId + '.json'),
        JSON.stringify({ schemaVersion: SEED_PARALLEL_APPROVAL_REF_SCHEMA, commentId: 7654321 }));
      const aliasNow = new Date().toISOString();
      ownerComment.created_at = aliasNow;
      ownerComment.updated_at = aliasNow;
      ownerComment.body = '```stephanos-seed-parallel-owner-approval\n' +
        JSON.stringify(makeParallelSeedExactApprovalV1({
          request: aliasRequest, manifestSha256: parallelSeedManifestHashV1(aliasRaw),
          nowUtc: aliasNow,
          expiryUtc: new Date(Date.parse(aliasNow) + 3600000).toISOString(),
        })) + '\n```';
      const outside = join(scratch, 'outside-owner-scope');
      await mkdir(outside, { recursive: true });
      modelResponsePath = aliasTarget;
      redirectParentOnNextInference = { taskId: aliasTaskId, outside };
      await writeFile(join(governorDir, 'vr-resource-governor-current.json'),
        JSON.stringify({ schemaVersion: 'stephanos.vr-resource-governor.v1',
          active: false, phase: 'NORMAL', localModelAllowed: true,
          updatedAtUtc: new Date().toISOString() }));
      const aliasedRun = await runAsync(process.execPath,
        [executable, 'build', aliasManifest, '--execute'], { cwd: repo, env });
      assert.notEqual(aliasedRun.code, 0);
      assert.match(aliasedRun.stderr, /SYMLINK_TARGET_PARENT|SEED_TARGET_PARENT_PHYSICAL_REDIRECT/);
      assert.equal(git('rev-parse', 'main'), aliasBase);
      const blockedAlias = JSON.parse(await readFile(
        join(stateRoot, 'receipts', aliasTaskId + '.json'), 'utf8'));
      assert.equal(blockedAlias.stage, 'BLOCKED');
      await assert.rejects(() => access(join(outside, 'model-parent-alias-pilot.md')), /ENOENT/);
    }
    // A model-backed proposal is not an approval to execute modified test code.
    // Poison the independently selected test file in the isolated worktree
    // while the mocked inference is in flight; the test must NEVER execute.
    const poisonBase = git('rev-parse', 'main');
    git('update-ref', 'refs/remotes/origin/main', poisonBase);
    const poisonTaskId = 'model-test-source-poison-pilot';
    const poisonTarget = 'docs/architecture/model-test-source-poison-pilot.md';
    const poisonRequest = { ...request, taskId: poisonTaskId,
      targetPath: poisonTarget, baseSha: poisonBase, expectedTargetSha256: null };
    const poisonRaw = JSON.stringify(poisonRequest);
    const poisonManifest = join(scratch, 'test-source-poison-request.json');
    await writeFile(poisonManifest, poisonRaw);
    await writeFile(join(stateRoot, 'approvals', poisonTaskId + '.json'),
      JSON.stringify({ schemaVersion: SEED_PARALLEL_APPROVAL_REF_SCHEMA, commentId: 7654321 }));
    const poisonNow = new Date().toISOString();
    ownerComment.created_at = poisonNow;
    ownerComment.updated_at = poisonNow;
    ownerComment.body = [
      '```stephanos-seed-parallel-owner-approval',
      JSON.stringify(makeParallelSeedExactApprovalV1({
        request: poisonRequest, manifestSha256: parallelSeedManifestHashV1(poisonRaw),
        nowUtc: poisonNow,
        expiryUtc: new Date(Date.parse(poisonNow) + 3600000).toISOString(),
      })),
      '```',
    ].join('\n');
    modelResponsePath = poisonTarget;
    poisonTestOnNextInference = { taskId: poisonTaskId };
    await writeFile(join(governorDir, 'vr-resource-governor-current.json'),
      JSON.stringify({ schemaVersion: 'stephanos.vr-resource-governor.v1',
        active: false, phase: 'NORMAL', localModelAllowed: true,
        updatedAtUtc: new Date().toISOString() }));
    const poisoned = await runAsync(process.execPath,
      [executable, 'build', poisonManifest, '--execute'], { cwd: repo, env });
    assert.notEqual(poisoned.code, 0);
    assert.match(poisoned.stderr, /SEED_TEST_SOURCE_SCOPE_UNTRUSTED|SEED_TEST_SOURCE_BLOB_CHANGED/);
    assert.doesNotMatch(poisoned.stderr, /UNAPPROVED_TEST_CODE_EXECUTED/);
    const poisonReceipt = JSON.parse(await readFile(
      join(stateRoot, 'receipts', poisonTaskId + '.json'), 'utf8'));
    assert.equal(poisonReceipt.stage, 'BLOCKED');
    assert.equal(poisonReceipt.failedStage, 'EDITED');
    assert.equal(poisonReceipt.goalCompleted, false);
    assert.equal(git('rev-parse', 'main'), poisonBase);

    // Adversarial persisted Git config: an operator-account process adds a
    // potentially executable filter while inference is in progress. The
    // worker must detect it before git add/commit and leave main unchanged.
    const configBase = git('rev-parse', 'main');
    git('update-ref', 'refs/remotes/origin/main', configBase);
    const configTaskId = 'model-git-local-config-poison';
    const configTarget = 'docs/architecture/model-git-local-config-poison.md';
    const configRequest = { ...request, taskId: configTaskId,
      targetPath: configTarget, baseSha: configBase, expectedTargetSha256: null };
    const configRaw = JSON.stringify(configRequest);
    const configManifest = join(scratch, 'git-local-config-poison.json');
    await writeFile(configManifest, configRaw);
    await writeFile(join(stateRoot, 'approvals', configTaskId + '.json'),
      JSON.stringify({ schemaVersion: SEED_PARALLEL_APPROVAL_REF_SCHEMA, commentId: 7654321 }));
    const configNow = new Date().toISOString();
    ownerComment.created_at = configNow;
    ownerComment.updated_at = configNow;
    ownerComment.body = [
      '```stephanos-seed-parallel-owner-approval',
      JSON.stringify(makeParallelSeedExactApprovalV1({
        request: configRequest, manifestSha256: parallelSeedManifestHashV1(configRaw),
        nowUtc: configNow,
        expiryUtc: new Date(Date.parse(configNow) + 3600000).toISOString(),
      })),
      '```',
    ].join('\n');
    modelResponsePath = configTarget;
    poisonLocalGitConfigOnNextInference = true;
    await writeFile(join(governorDir, 'vr-resource-governor-current.json'),
      JSON.stringify({ schemaVersion: 'stephanos.vr-resource-governor.v1',
        active: false, phase: 'NORMAL', localModelAllowed: true,
        updatedAtUtc: new Date().toISOString() }));
    try {
      const configRun = await runAsync(process.execPath,
        [executable, 'build', configManifest, '--execute'], { cwd: repo, env });
      assert.notEqual(configRun.code, 0);
      assert.match(configRun.stderr, /CANONICAL_GIT_CONFIGURATION_INVALID/);
      const configReceipt = JSON.parse(await readFile(
        join(stateRoot, 'receipts', configTaskId + '.json'), 'utf8'));
      assert.equal(configReceipt.stage, 'BLOCKED');
      assert.equal(git('rev-parse', 'main'), configBase);
    } finally {
      git('config', '--local', '--unset', 'filter.seedtrap.clean');
    }

    // Two tasks whose targets differ only by case are the SAME Windows file.
    // Neither the new folded-hash claim nor any historical raw-case claim
    // may permit another worker to adopt the existing source target.
    const aliasClaimBase = git('rev-parse', 'main');
    git('update-ref', 'refs/remotes/origin/main', aliasClaimBase);
    const aliasClaimId = 'case-collision-claim-pilot';
    const aliasClaimTarget = 'docs/architecture/Test-seed-parallel-result.md';
    const aliasClaimRequest = { ...request, taskId: aliasClaimId,
      targetPath: aliasClaimTarget, baseSha: aliasClaimBase,
      generationMode: 'CANONICAL_INVENTORY_V1', expectedTargetSha256: null };
    const aliasClaimRaw = JSON.stringify(aliasClaimRequest);
    const aliasClaimManifest = join(scratch, 'case-collision-claim-manifest.json');
    await writeFile(aliasClaimManifest, aliasClaimRaw);
    await writeFile(join(stateRoot, 'approvals', aliasClaimId + '.json'),
      JSON.stringify({ schemaVersion: SEED_PARALLEL_APPROVAL_REF_SCHEMA, commentId: 7654321 }));
    const aliasClaimNow = new Date().toISOString();
    ownerComment.created_at = aliasClaimNow;
    ownerComment.updated_at = aliasClaimNow;
    ownerComment.body = [
      '```stephanos-seed-parallel-owner-approval',
      JSON.stringify(makeParallelSeedExactApprovalV1({
        request: aliasClaimRequest,
        manifestSha256: parallelSeedManifestHashV1(aliasClaimRaw),
        nowUtc: aliasClaimNow,
        expiryUtc: new Date(Date.parse(aliasClaimNow) + 3600000).toISOString(),
      })),
      '```',
    ].join('\n');
    await writeFile(join(governorDir, 'vr-resource-governor-current.json'),
      JSON.stringify({ schemaVersion: 'stephanos.vr-resource-governor.v1',
        active: false, phase: 'NORMAL', localModelAllowed: true,
        updatedAtUtc: new Date().toISOString() }));
    const collision = await runAsync(process.execPath,
      [executable, 'build', aliasClaimManifest, '--execute'], { cwd: repo, env });
    assert.notEqual(collision.code, 0);
    assert.match(collision.stderr, /TARGET_ALREADY_OWNED_BY_PARALLEL_TASK/);
    const collisionReceipt = JSON.parse(await readFile(
      join(stateRoot, 'receipts', aliasClaimId + '.json'), 'utf8'));
    assert.equal(collisionReceipt.stage, 'BLOCKED');
    assert.equal(collisionReceipt.goalCompleted, false);
    assert.equal(git('rev-parse', 'main'), aliasClaimBase);

    // Upgrade compatibility: an old revision hashed its original case spelling.
    // That historical claim must still block the equivalent folded Windows path.
    const legacyCasePath = 'docs/architecture/Legacy-Case-Claim.md';
    const legacyCaseKey = createHash('sha256').update(legacyCasePath).digest('hex');
    await writeFile(join(stateRoot, 'target-claims', legacyCaseKey + '.claim'),
      JSON.stringify({ taskId: 'legacy-case-owner', targetPath: legacyCasePath,
        seedId: SEED_ID, ownerIssue: '#3096', baseSha: aliasClaimBase }));
    const legacyId = 'legacy-case-conflict-pilot';
    const legacyRequest = { ...aliasClaimRequest, taskId: legacyId,
      targetPath: 'docs/architecture/legacy-case-claim.md' };
    const legacyRaw = JSON.stringify(legacyRequest);
    const legacyManifest = join(scratch, 'legacy-case-claim-request.json');
    await writeFile(legacyManifest, legacyRaw);
    await writeFile(join(stateRoot, 'approvals', legacyId + '.json'),
      JSON.stringify({ schemaVersion: SEED_PARALLEL_APPROVAL_REF_SCHEMA, commentId: 7654321 }));
    const legacyNow = new Date().toISOString();
    ownerComment.created_at = legacyNow;
    ownerComment.updated_at = legacyNow;
    ownerComment.body = [
      '```stephanos-seed-parallel-owner-approval',
      JSON.stringify(makeParallelSeedExactApprovalV1({
        request: legacyRequest, manifestSha256: parallelSeedManifestHashV1(legacyRaw),
        nowUtc: legacyNow,
        expiryUtc: new Date(Date.parse(legacyNow) + 3600000).toISOString(),
      })),
      '```',
    ].join('\n');
    const legacyBlocked = await runAsync(process.execPath,
      [executable, 'build', legacyManifest, '--execute'], { cwd: repo, env });
    assert.notEqual(legacyBlocked.code, 0);
    assert.match(legacyBlocked.stderr, /TARGET_ALREADY_OWNED_BY_PARALLEL_TASK/);
    const legacyReceipt = JSON.parse(await readFile(
      join(stateRoot, 'receipts', legacyId + '.json'), 'utf8'));
    assert.equal(legacyReceipt.stage, 'BLOCKED');
    assert.equal(legacyReceipt.goalCompleted, false);

    // A blocked candidate must never jam a disjoint approved seed. Use
    // production's disabled heavy-model flag for this actual Git fixture,
    // and prove a two-attempt foreground batch continues to a distinct goal.
    await writeFile(path('shared/runtime/seedCanopyParallelResourceV1.mjs'), fixtureWriteResourceModule);
    git('add', '--', 'shared/runtime/seedCanopyParallelResourceV1.mjs');
    git('commit', '-m', 'fixture restore model custody HOLD before batch');
    const batchBase = git('rev-parse', 'main');
    git('update-ref', 'refs/remotes/origin/main', batchBase);
    const batchNow = new Date().toISOString();
    const batchExpires = new Date(Date.parse(batchNow) + 3600000).toISOString();
    const batchRows = [
      { id: 'aaa-batch-fail', target: 'docs/architecture/batch-failed-inventory.md',
        testPath: 'tests/missing-approved-fixture.test.mjs', commentId: 7654321 },
      { id: 'aab-batch-success', target: 'docs/architecture/batch-successful-inventory.md',
        testPath: 'tests/fixture-safe.test.mjs', commentId: 7654322 },
    ];
    const makeApprovalComment = (row, body) => ({
      id: row.commentId, user: { login: 'Cheekyfellastef' }, author_association: 'OWNER',
      issue_url: 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/3096',
      created_at: batchNow, updated_at: batchNow,
      body: ['```stephanos-seed-parallel-owner-approval', body, '```'].join('\n'),
    });
    for (const row of batchRows) {
      const task = { ...request, taskId: row.id, targetPath: row.target,
        baseSha: batchBase, generationMode: 'CANONICAL_INVENTORY_V1',
        expectedTargetSha256: null, testPaths: [row.testPath] };
      const raw = JSON.stringify(task);
      const body = JSON.stringify(makeParallelSeedExactApprovalV1({
        request: task, manifestSha256: parallelSeedManifestHashV1(raw),
        nowUtc: batchNow, expiryUtc: batchExpires,
      }));
      if (row.commentId === 7654321) ownerComment = makeApprovalComment(row, body);
      else secondOwnerComment = makeApprovalComment(row, body);
      await writeFile(join(stateRoot, 'inbox', row.id + '.json'), raw);
      await writeFile(join(stateRoot, 'approvals', row.id + '.json'),
        JSON.stringify({ schemaVersion: SEED_PARALLEL_APPROVAL_REF_SCHEMA,
          commentId: row.commentId }));
    }
    await writeFile(join(governorDir, 'vr-resource-governor-current.json'),
      JSON.stringify({ schemaVersion: 'stephanos.vr-resource-governor.v1',
        active: false, phase: 'NORMAL', localModelAllowed: true,
        updatedAtUtc: new Date().toISOString() }));
    const beforeBatchModelCalls = inferenceCount;
    const batch = await runAsync(process.execPath,
      [supervisor, 'run-inventory-batch'], { cwd: repo, env });
    assert.equal(batch.code, 1, batch.stderr);
    assert.match(batch.stdout, /MODEL_FREE_APPROVED_INVENTORY_ONLY/);
    assert.match(batch.stdout, /"attemptedCount": 2/);
    assert.match(batch.stdout, /"blockedCount": 1/);
    assert.equal(inferenceCount, beforeBatchModelCalls,
      'a model-free fail-forward batch must not call an ungoverned model');
    const failedBatchReceipt = JSON.parse(await readFile(
      join(stateRoot, 'receipts', batchRows[0].id + '.json'), 'utf8'));
    const passedBatchReceipt = JSON.parse(await readFile(
      join(stateRoot, 'receipts', batchRows[1].id + '.json'), 'utf8'));
    assert.equal(failedBatchReceipt.stage, 'BLOCKED');
    assert.equal(passedBatchReceipt.stage, 'COMMITTED',
      'a blocked source candidate cannot strand a separate approved seed');
    assert.equal(passedBatchReceipt.merged, false);
    assert.equal(passedBatchReceipt.goalCompleted, false);
    assert.equal(git('rev-parse', 'main'), batchBase,
      'neither blocked nor committed batch task may change canonical main');

    // A passing test inside its approved checkout may substitute proposal
    // bytes before staging. It must not authorize a same-path replacement.
    await writeFile(path('tests/fixture-safe.test.mjs'), [
      'import test from "node:test";',
      'import { writeFile } from "node:fs/promises";',
      'test("approved test mutates output", async () => {',
      '  await writeFile("docs/architecture/post-test-swap-proof.md", "substituted\\n");',
      '});',
    ].join('\n') + '\n');
    git('add', '--', 'tests/fixture-safe.test.mjs');
    git('commit', '-m', 'fixture-only post-test output mutation scenario');
    const mutationBase = git('rev-parse', 'main');
    git('update-ref', 'refs/remotes/origin/main', mutationBase);
    const mutationId = 'post-test-output-swap-pilot';
    const mutationTarget = 'docs/architecture/post-test-swap-proof.md';
    const mutationRequest = { ...request, taskId: mutationId,
      targetPath: mutationTarget, baseSha: mutationBase,
      generationMode: 'CANONICAL_INVENTORY_V1', expectedTargetSha256: null,
      testPaths: ['tests/fixture-safe.test.mjs'] };
    const mutationRaw = JSON.stringify(mutationRequest);
    const mutationManifest = join(scratch, 'post-test-swap-manifest.json');
    await writeFile(mutationManifest, mutationRaw);
    await writeFile(join(stateRoot, 'approvals', mutationId + '.json'),
      JSON.stringify({ schemaVersion: SEED_PARALLEL_APPROVAL_REF_SCHEMA, commentId: 7654321 }));
    const mutationNow = new Date().toISOString();
    ownerComment.created_at = mutationNow;
    ownerComment.updated_at = mutationNow;
    const fence = String.fromCharCode(96).repeat(3);
    ownerComment.body = [
      fence + 'stephanos-seed-parallel-owner-approval',
      JSON.stringify(makeParallelSeedExactApprovalV1({
        request: mutationRequest, manifestSha256: parallelSeedManifestHashV1(mutationRaw),
        nowUtc: mutationNow,
        expiryUtc: new Date(Date.parse(mutationNow) + 3600000).toISOString(),
      })),
      fence,
    ].join('\n');
    await writeFile(join(governorDir, 'vr-resource-governor-current.json'),
      JSON.stringify({ schemaVersion: 'stephanos.vr-resource-governor.v1',
        active: false, phase: 'NORMAL', localModelAllowed: true,
        updatedAtUtc: new Date().toISOString() }));
    const mutated = await runAsync(process.execPath,
      [executable, 'build', mutationManifest, '--execute'], { cwd: repo, env });
    assert.notEqual(mutated.code, 0);
    assert.match(mutated.stderr, /SEED_OUTPUT_CHANGED_AFTER_TEST/);
    const mutatedReceipt = JSON.parse(await readFile(
      join(stateRoot, 'receipts', mutationId + '.json'), 'utf8'));
    assert.equal(mutatedReceipt.stage, 'BLOCKED');
    assert.equal(mutatedReceipt.goalCompleted, false);
    assert.equal(git('rev-parse', 'main'), mutationBase);

    // A malicious local Git config can contain more text than the bounded
    // child reader captures. The first 64 KiB must never be accepted as the
    // complete --null --list configuration, which could hide a later command
    // filter or hook setting. This fixture only writes inert config text.
    const oversizedId = 'oversized-git-config-pilot';
    const oversizedRequest = { ...request, taskId: oversizedId,
      baseSha: git('rev-parse', 'main'),
      targetPath: 'docs/architecture/oversized-git-config.md',
      generationMode: 'CANONICAL_INVENTORY_V1',
      expectedTargetSha256: null,
      testPaths: ['tests/fixture-safe.test.mjs'] };
    const oversizedRaw = JSON.stringify(oversizedRequest);
    const oversizedManifest = join(scratch, 'oversized-git-config-request.json');
    await writeFile(oversizedManifest, oversizedRaw);
    await writeFile(join(stateRoot, 'approvals', oversizedId + '.json'),
      JSON.stringify({ schemaVersion: SEED_PARALLEL_APPROVAL_REF_SCHEMA, commentId: 7654321 }));
    const oversizedNow = new Date().toISOString();
    ownerComment.created_at = oversizedNow;
    ownerComment.updated_at = oversizedNow;
    ownerComment.body = [
      fence + 'stephanos-seed-parallel-owner-approval',
      JSON.stringify(makeParallelSeedExactApprovalV1({
        request: oversizedRequest,
        manifestSha256: parallelSeedManifestHashV1(oversizedRaw),
        nowUtc: oversizedNow,
        expiryUtc: new Date(Date.parse(oversizedNow) + 3600000).toISOString(),
      })),
      fence,
    ].join('\n');
    await writeFile(join(governorDir, 'vr-resource-governor-current.json'),
      JSON.stringify({ schemaVersion: 'stephanos.vr-resource-governor.v1',
        active: false, phase: 'NORMAL', localModelAllowed: true,
        updatedAtUtc: new Date().toISOString() }));
    // Create the oversized config-output adversary through the owned fixture
    // file: a 70k argv exceeds Windows' command-line limit before Git can run.
    // Keep the actual Git-config read/output-overflow regression unchanged.
    const fixtureConfig = path('.git/config');
    const configBeforeOverflow = await readFile(fixtureConfig, 'utf8');
    await writeFile(fixtureConfig, `${configBeforeOverflow}\n[stephanos]\n\tsafevalue = ${'A'.repeat(70000)}\n`);
    try {
      const overflow = await runAsync(process.execPath,
        [executable, 'build', oversizedManifest, '--execute'], { cwd: repo, env });
      assert.notEqual(overflow.code, 0);
      assert.match(overflow.stderr, /SEED_CHILD_OUTPUT_LIMIT_EXCEEDED/);
      const receipt = JSON.parse(await readFile(join(stateRoot, 'receipts',
        oversizedId + '.json'), 'utf8'));
      assert.equal(receipt.stage, 'BLOCKED');
      assert.equal(receipt.goalCompleted, false);
      assert.equal(git('rev-parse', 'main'), oversizedRequest.baseSha);
    } finally {
      await writeFile(fixtureConfig, configBeforeOverflow);
    }

  } finally {
    if (server) await new Promise((resolveDone) => server.close(resolveDone));
    await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
  }
}

test('production target custody holds authenticated model and deterministic workers before any claim or source write',
  { timeout: 30000 }, () => runForgeFixture({ admissionOnly: true }));

test('independent forge performs real fixture worktree, scoped edit, tests, commit and durable receipt',
  { timeout: 90000 }, () => runForgeFixture());
