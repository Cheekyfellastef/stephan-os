// The existing escrow node-changed profile discovers .test.mjs files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectKnownMalformedPatchRetryEvidenceV1 as collect } from './knownMalformedPatchRetryService.js';
import { proveMissionWorkerRetryOwnershipReleased as release } from './missionOrchestratorWorkerConsumer.js';
import { inspectStructuredNewFileContractV1 as inspect } from './providerNeutralSourceBuilderService.js';
import { KNOWN_MALFORMED_PATCH_REPAIR_V1 as C } from '../../shared/agents/knownMalformedPatchRetryV1.mjs';

const HEAD = 'a'.repeat(40);
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE_PATHS = ['stephanos-server/services/providerNeutralSourceBuilderService.js',
  'shared/ai/localBuilderModelRequestV1.mjs', 'shared/agents/knownMalformedPatchRetryV1.mjs'];
const digest = value => createHash('sha256').update(value).digest('hex');
const mission = () => ({ missionId: C.missionId, repository: C.repository,
  git: { branch: C.branch, clean: true, worktreeReady: true, changedFiles: [] },
  currentPhase: 'BLOCKED', continuity: { parkingStatus: 'PARKED_BLOCKED' },
  cancelled: false, activeWriter: 'none', revision: 4,
  dispatch: { status: 'failed', adapter: C.adapter, resultId: C.actionId },
  repair: { currentRound: 0, maximumRounds: 3 }, blockers: [C.blocker],
  allowedFiles: ['**'], requiredTests: ['npm run stephanos:verify'] });

function pair() {
  const common = { missionId: C.missionId, repository: C.repository, issueNumber: C.issueNumber,
    branch: C.branch, sourceRevision: C.originalSourceHead, missionRevision: 1, grantId: 'offline-original-grant' };
  return {
    item: { schemaVersion: 'stephanos.mission-worker-queue-item.v1', missionId: C.missionId,
      actionId: C.actionId, adapter: C.adapter,
      actionGrant: { ...common, schemaVersion: 'stephanos.mission-worker-action-grant.v1', actionId: C.actionId, adapter: C.adapter },
      executionBinding: { ...common, schemaVersion: 'stephanos.mission-worker-queue-execution-binding.v1',
        executionId: C.actionId, leaseKey: C.missionId + '-r1-lease' } },
    result: { schemaVersion: 'stephanos.provider-neutral-source-builder.v1', missionId: C.missionId,
      actionId: C.actionId, adapter: C.adapter, providerAdapter: C.adapter, processed: true,
      success: false, providerInvoked: true, providerCompleted: true, failureStage: 'SOURCE_OR_TEST',
      finalVerdict: 'PROVIDER_NEUTRAL_SOURCE_BUILD_BLOCKED', error: C.blocker },
  };
}

async function queueFixture(t, change = () => {}, terminalReceipt = false) {
  const parent = await mkdtemp(join(tmpdir(), 'known-patch-evidence-'));
  // Only this test's uniquely created directory may be removed.
  const allowedRoot = resolve(tmpdir()) + sep;
  assert.ok(resolve(parent).startsWith(allowedRoot));
  t.after(async () => {
    assert.ok(resolve(parent).startsWith(allowedRoot));
    assert.match(parent.split(sep).at(-1), /^known-patch-evidence-/);
    await rm(parent, { recursive: true, force: true });
  });
  const fixture = pair();
  change(fixture);
  const failed = join(parent, C.adapter, 'failed');
  await mkdir(failed, { recursive: true });
  const itemBytes = JSON.stringify(fixture.item) + '\n';
  const resultBytes = JSON.stringify(fixture.result, null, 2) + '\n';
  await writeFile(join(failed, C.actionId + '.json'), itemBytes);
  await writeFile(join(failed, C.actionId + '.result.json'), resultBytes);
  return { parent, itemBytes, resultBytes,
    read: () => release({ missionId: C.missionId, actionId: C.actionId, adapter: C.adapter,
      queueRoot: parent, sharedWorkspaceRoot: join(parent, 'workspace'), repoRoot: REPO, env: {},
      readReceiptHistory: async () => terminalReceipt
        ? { ok: true, latestReceipt: { state: 'failed', executionId: C.actionId,
          leaseKey: C.missionId + '-r1-lease', receiptId: 'offline-terminal-receipt' } }
        : { ok: false, reason: 'NO_RECEIPTS' } }),
  };
}

async function sourceFixture(ownershipRelease) {
  const bytes = new Map(await Promise.all(SOURCE_PATHS.map(async name => [name, await readFile(join(REPO, name))])));
  let reads = 0, heads = 0;
  const input = { mission: mission(), sourceHead: HEAD, ownershipRelease, repoRoot: REPO,
    runGit: (root, args) => {
      assert.equal(root, REPO);
      if (args[0] === 'rev-parse') {
        assert.ok(['HEAD', 'refs/remotes/origin/main'].includes(args[1])); heads++;
        return { status: 0, stdout: HEAD + '\n' };
      }
      if (args[0] === 'merge-base') {
        assert.deepEqual(args, ['merge-base', '--is-ancestor', C.repairCommit, HEAD]);
        return { status: 0, stdout: '' };
      }
      assert.equal(args[0], 'show');
      assert.ok(args[1].startsWith(HEAD + ':'));
      const name = args[1].slice(41);
      assert.ok(bytes.has(name), 'only fixed mechanism source paths are read');
      return { status: 0, stdout: Buffer.from(bytes.get(name).toString().replaceAll('\r\n', '\n')) };
    },
    readSource: async pathname => {
      reads++;
      const name = SOURCE_PATHS.find(name => resolve(REPO, name) === resolve(pathname));
      assert.ok(name, 'only fixed mechanism source paths are read');
      return bytes.get(name);
    },
  };
  return { input, bytes, counts: () => ({ reads, heads }) };
}

test('actual failed queue bytes bind the original attempt and real loaded builder mechanism', async t => {
  const q = await queueFixture(t);
  const ownershipRelease = await q.read();
  assert.equal(ownershipRelease.ok, true);
  assert.equal(ownershipRelease.classification, 'MISSION_WORKER_RETRY_PROVIDER_NEUTRAL_QUEUE_RELEASE_PROVEN');
  assert.equal(ownershipRelease.knownMalformedPatchTerminal.itemSha256, digest(q.itemBytes));
  assert.equal(ownershipRelease.knownMalformedPatchTerminal.resultSha256, digest(q.resultBytes));
  const f = await sourceFixture(ownershipRelease);
  const outcome = await collect(f.input);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(outcome.proof.sourceHead, HEAD);
  assert.equal(outcome.proof.repairCommit, C.repairCommit);
  assert.deepEqual(outcome.proof.terminal, ownershipRelease.knownMalformedPatchTerminal);
  assert.deepEqual(f.counts(), { reads: 6, heads: 4 });
  assert.equal('verified' in outcome.proof, false);
});

test('processing ownership prevents terminal evidence even when failed files remain', async t => {
  const q = await queueFixture(t);
  await mkdir(join(q.parent, C.adapter, 'processing'), { recursive: true });
  await writeFile(join(q.parent, C.adapter, 'processing', C.actionId + '.json'), q.itemBytes);
  const result = await q.read();
  assert.equal(result.ok, false);
  assert.equal(result.classification, 'MISSION_WORKER_RETRY_PRIOR_CLAIM_STILL_PROCESSING');
  assert.equal(result.knownMalformedPatchTerminal, undefined);
});

test('wrong queue identity, original grant, binding or completion cannot prove this repair', async t => {
  const changes = {
    'foreign mission': f => { f.item.missionId += '-other'; },
    'foreign action': f => { f.result.actionId += '-other'; },
    'foreign grant branch': f => { f.item.actionGrant.branch += '-other'; },
    'foreign grant source': f => { f.item.actionGrant.sourceRevision = HEAD; },
    'foreign grant revision': f => { f.item.actionGrant.missionRevision = 2; },
    'foreign binding source': f => { f.item.executionBinding.sourceRevision = HEAD; },
    'mismatched grant': f => { f.item.executionBinding.grantId += '-other'; },
    'absent grant identity': f => { delete f.item.actionGrant.grantId; delete f.item.executionBinding.grantId; },
    'invalid grant schema': f => { f.item.actionGrant.schemaVersion = 'other'; },
    'invalid binding schema': f => { f.item.executionBinding.schemaVersion = 'other'; },
    'successful result': f => { f.result.success = true; },
    'provider incomplete': f => { f.result.providerCompleted = false; },
    'provider never invoked': f => { f.result.providerInvoked = false; },
    'provider-stage failure': f => { f.result.failureStage = 'PROVIDER'; },
    'different malformed patch': f => { f.result.error += '-different'; },
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async t => {
    // A terminal receipt cannot make a mismatched original queue pair valid.
    const q = await queueFixture(t, change, true);
    const proof = await q.read();
    assert.ok(proof.knownMalformedPatchTerminal == null, JSON.stringify(proof));
    const f = await sourceFixture(proof);
    const result = await collect(f.input);
    assert.equal(result.ok, false);
    assert.equal(result.proof, null);
  });
});

test('source qualification rejects moved main, missing ancestry, dirty bytes and stale loaded code', async t => {
  const q = await queueFixture(t), ownershipRelease = await q.read();
  const cases = {
    'head moved before reading': f => {
      const git = f.input.runGit;
      f.input.runGit = (root, args) => args[0] === 'rev-parse'
        ? { status: 0, stdout: 'b'.repeat(40) } : git(root, args);
    },
    'head moved during reading': f => {
      const git = f.input.runGit; let count = 0;
      f.input.runGit = (root, args) => args[0] === 'rev-parse' && ++count > 2
        ? { status: 0, stdout: 'b'.repeat(40) } : git(root, args);
    },
    'merged repair absent': f => {
      const git = f.input.runGit;
      f.input.runGit = (root, args) => args[0] === 'merge-base' ? { status: 1, stdout: '' } : git(root, args);
    },
    'disk differs from committed source': f => {
      const read = f.input.readSource;
      f.input.readSource = async path => Buffer.concat([await read(path), Buffer.from('// dirty\n')]);
    },
    'disk changed during awaited reads': f => {
      const read = f.input.readSource; let count = 0;
      f.input.readSource = async path => ++count > 3
        ? Buffer.concat([await read(path), Buffer.from('// changed after first read\n')]) : read(path);
    },
    'disk and Git changed after module load': f => {
      const name = SOURCE_PATHS[0]; f.bytes.set(name, Buffer.concat([f.bytes.get(name), Buffer.from('// newer loaded source\n')]));
    },
    'required loaded observation fails': f => {
      const inspection = inspect();
      f.input.inspect = () => ({ ...inspection, observations: { ...inspection.observations, rejectsInventedOldContents: false } });
    },
    'original terminal missing': f => { f.input.ownershipRelease = { ...ownershipRelease, knownMalformedPatchTerminal: null }; },
    'round already consumed': f => { f.input.mission.repair.currentRound = 1; },
    'cancelled original': f => { f.input.mission.cancelled = true; },
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, async () => {
    const f = await sourceFixture(ownershipRelease); change(f);
    const result = await collect(f.input);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.proof, null);
  });
});
