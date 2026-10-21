import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveBattleBridgeGitExecution } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { executeCorePublicationDirectoryActionV1 } from './sovereign-core-directory-action-v1.mjs';
import { buildSovereignCommanderCommandV1, SOVEREIGN_COMMANDER_OPERATION } from '../shared/agents/sovereignCommanderV1.mjs';
import { buildStephanosExecutionCommandEnvelopeV1, buildStephanosExecutionSurfaceCatalogV1,
  STEPHANOS_EXECUTION_SURFACE } from '../shared/agents/stephanosExecutionCommandFabricV1.mjs';

const root = 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os';
const routeProof = { commandPathProven: true, authenticatedMcp: true, mcpSessionReady: true };
function fixture(patch = {}) {
  const objects = new Map();
  const object = (type, bytes) => {
    bytes = Buffer.from(bytes);
    const sha = createHash('sha1').update(type + ' ' + bytes.length + '\0').update(bytes).digest('hex');
    objects.set(type + ':' + sha, bytes); return sha;
  };
  const native = Buffer.from('fixed installed native bytes');
  const blob = object('blob', native);
  const entry = (mode, name, sha) => Buffer.concat([Buffer.from(mode + ' ' + name + '\0'), Buffer.from(sha, 'hex')]);
  const windows = object('tree', entry(patch.mode ?? '100644', 'SovereignCoreJobCustodyV1.cs', blob));
  const scripts = object('tree', entry('40000', 'windows', windows));
  const tree = object('tree', entry('40000', 'scripts', scripts));
  const head = object('commit', 'tree ' + tree + '\n\nfixture\n');
  const command = { commandId: 'command-one', missionId: 'original-mission', plan: { expectedMain: head } };
  let calls = 0, dispatches = [];
  return { head, command, dispatches, options: { repoRoot: root, platform: 'win32', routeProof,
    spawnSyncFn(executable, args, options) {
      calls++;
      assert.match(executable, /Git.*git\.exe$/i);
      assert.equal(options.shell, false); assert.equal(options.env.GIT_NO_REPLACE_OBJECTS, '1');
      assert.equal(options.env.GIT_GRAFT_FILE, 'NUL');
      assert.ok(args.includes('core.fsmonitor=false'));
      let bytes;
      if (args.includes('symbolic-ref')) bytes = Buffer.from(patch.branch ?? 'main\n');
      else if (args.includes('rev-parse')) bytes = Buffer.from(patch.head ?? head + '\n');
      else if (args.includes('status')) bytes = Buffer.from(patch.dirty ? ' M preserve.txt\n' : '');
      else {
        bytes = objects.get(args.at(-2) + ':' + args.at(-1));
        if (patch.corrupt && args.at(-2) === 'blob') bytes = Buffer.from('corrupt');
      }
      if (patch.fail || !bytes) return { status: 1, stdout: Buffer.alloc(0) };
      return { status: 0, stdout: bytes };
    },
    runCoreDirectoryRepairFn: async binding => {
      dispatches.push(binding);
      assert.equal(binding.expectedNativeSourceSha256, createHash('sha256').update(native).digest('hex'));
      return { ok: true, repairExecuted: true, corePublicationDirectoriesReady: true };
    },
  }, get calls() { return calls; } };
}

test('private Core action authenticates raw objects, fixed scope and stable original request without enrolment', async () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) {
    const r = await executeCorePublicationDirectoryActionV1(f.command, f.options);
    assert.equal(r.ok, true); assert.equal(r.specialistQualified, false);
    assert.equal(r.dispatchAllowed, false); assert.equal(r.coreHealthProven, false);
    assert.equal(r.originalBuilderRecovered, false); assert.equal(r.originalR7Authority, false);
  }
  assert.equal(f.dispatches[0].requestId, f.dispatches[1].requestId);
  assert.equal(f.dispatches[0].sourceHead, f.head);
  assert.match(f.dispatches[0].requestId, /^core-dir-[a-f0-9]{64}$/);
});

test('unauthenticated route and missing identity never read Git or dispatch native work', async () => {
  for (const key of ['commandPathProven','authenticatedMcp','mcpSessionReady']) {
    const f = fixture();
    assert.equal((await executeCorePublicationDirectoryActionV1(f.command,
      { ...f.options, routeProof: { ...routeProof, [key]: false } })).ok, false);
    assert.equal(f.calls, 0); assert.equal(f.dispatches.length, 0);
  }
});

test('dirty/stale/non-main/corrupt/missing/symlink Git evidence preserves checkout and refuses mutation', async () => {
  for (const patch of [{ dirty: true }, { head: 'a'.repeat(40) }, { branch: 'repair\n' },
    { corrupt: true }, { fail: true }, { mode: '120000' }]) {
    const f = fixture(patch);
    const r = await executeCorePublicationDirectoryActionV1(f.command, f.options);
    assert.equal(r.ok, false, JSON.stringify(patch)); assert.equal(f.dispatches.length, 0);
    assert.equal(r.originalR7Authority, false);
  }
});

test('Commander exposes only the fixed private maintenance action and refuses caller scope/qualification', () => {
  const f = fixture();
  for (const [operation, extra, allowed] of [
    [SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION, {}, true],
    [SOVEREIGN_COMMANDER_OPERATION.START_PROCESS, {}, false],
    [SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION, { root: 'C:\\outside' }, false],
    [SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION, { specialistQualified: true }, false],
    [SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION, { command: 'anything' }, false],
  ]) {
    const envelope = buildStephanosExecutionCommandEnvelopeV1({
      catalog: buildStephanosExecutionSurfaceCatalogV1({ repositoryRoot: root }),
      surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
      actionId: 'original-command', missionId: 'original-mission', operation,
      payload: { actionId: 'repair-core-publication-directories', expectedMain: f.head, ...extra },
    });
    const plan = buildSovereignCommanderCommandV1(envelope, { repoRoot: root });
    assert.equal(plan.dispatchAllowed, allowed);
    if (allowed) assert.equal(plan.plan.kind, 'core-publication-repair');
  }
});

test('real hostile Git checkout cannot substitute skip-worktree bytes or run its fsmonitor', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'core-action-git-'));
  const git = resolveBattleBridgeGitExecution();
  const invoke = args => {
    const r = spawnSync(git.executable, ['-c', 'safe.directory=' + repo, '-C', repo, ...args],
      { env: git.environment, shell: false, windowsHide: true, encoding: 'utf8' });
    assert.equal(r.status, 0, String(r.stderr)); return r.stdout.trim();
  };
  try {
    invoke(['init', '-b', 'main']);
    invoke(['config', 'user.name', 'Fixture']); invoke(['config', 'user.email', 'fixture@example.invalid']);
    invoke(['config', 'core.autocrlf', 'false']);
    await mkdir(join(repo, 'scripts', 'windows'), { recursive: true });
    const file = 'scripts/windows/SovereignCoreJobCustodyV1.cs';
    const safe = 'fixed source bytes\n';
    await writeFile(join(repo, file), safe);
    invoke(['add', '--', file]); invoke(['-c', 'commit.gpgSign=false', 'commit', '-m', 'fixture']);
    const head = invoke(['rev-parse', 'HEAD']);
    invoke(['update-index', '--skip-worktree', '--', file]);
    await writeFile(join(repo, file), 'hostile unchecked checkout bytes');
    const marker = join(repo, '.git', 'fsmonitor-ran').replaceAll('\\', '/');
    invoke(['config', 'core.fsmonitor', "!echo compromised > '" + marker + "' #"]);
    let witnessed = false;
    const result = await executeCorePublicationDirectoryActionV1({ commandId: 'hostile-checkout',
      missionId: 'same-mission', plan: { expectedMain: head } }, {
      repoRoot: repo, platform: 'win32', routeProof,
      // Use the real platform Git on Linux CI as well, preserving production's
      // fixed flags/environment. safe.directory applies only to this fixture.
      spawnSyncFn(_exe, args, options) {
        return spawnSync(git.executable, ['-c', 'safe.directory=' + repo, ...args],
          { ...options, env: git.environment });
      },
      runCoreDirectoryRepairFn: async binding => {
        witnessed = true;
        assert.equal(binding.expectedNativeSourceSha256, createHash('sha256').update(safe).digest('hex'));
        return { ok: false, reason: 'FIXTURE_ONLY_NO_MUTATION' };
      },
    });
    assert.equal(witnessed, true); assert.equal(result.reason, 'FIXTURE_ONLY_NO_MUTATION');
    await assert.rejects(access(marker));
  } finally { await rm(repo, { recursive: true, force: true }); }
});
