// The existing escrow node-changed profile discovers .test.mjs files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMissionRecord, appendMissionEvent, readMissionRecord, listMissionRecords } from './missionOrchestratorStore.js';
import { retrySafelyBlockedAgentFailure, refreshRetryWorktreeToCurrentMain } from './criticalBacklogConveyorService.js';
import { KNOWN_MALFORMED_PATCH_REPAIR_V1 as C } from '../../shared/agents/knownMalformedPatchRetryV1.mjs';

const HEAD = 'a'.repeat(40), VERIFY = 'npm run stephanos:verify';
const ORACLE = 'node --test shared/agents/sharedAgentWorkspaceStore.test.mjs';
const RESOURCE = 'repo:cheekyfellastef/stephan-os:path:shared/agents/sharedAgentWorkspaceStore.mjs';
const permissions = { mergeAuthority: false, deploymentAuthority: false, runtimeMutationAuthority: false, arbitraryShellAllowed: false };
const receipt = receiptId => ({ receiptId, requirement: 'offline fixture', source: 'offline-test', evidenceType: 'command-output', verified: true, exitCode: 0 });

async function fixture(mode = 'valid', advanceClock = () => {}) {
  const parent = await mkdtemp(join(tmpdir(), 'known-patch-admission-'));
  const options = { root: join(parent, 'state'), snapshotRoot: join(parent, 'snapshots'), env: {} };
  const created = await createMissionRecord({ missionId: C.missionId, title: 'Offline original failure fixture',
    operatorIntent: 'Test original retry custody', intendedOutcome: 'Verified lessons', missionKind: 'implementation',
    repository: C.repository, branch: C.branch, worktreePath: join(parent, 'worktree'), allowedFiles: ['**'],
    requiredEvidence: ['independent tests'], requiredTests: [VERIFY] }, options);
  for (const [i, event] of [
    { eventType: 'WORKTREE_READY', worktreePath: join(parent, 'worktree'), clean: true, receipt: receipt('worktree') },
    { eventType: 'AGENT_DISPATCHED', agentId: C.adapter },
    { eventType: 'AGENT_RESULT_RECEIVED', success: false, resultId: C.actionId, error: C.blocker },
    { eventType: 'MISSION_PARKED_FOR_REPAIR', reason: 'Original failure retained', repairOwner: '#2961', receipt: receipt('park') },
  ].entries()) await appendMissionEvent(C.missionId, { ...event, eventId: `fixture-${i}` }, options);
  const read = async () => (await readMissionRecord(C.missionId, options)).state;
  const original = await read(), bytes = await readFile(created.statePath, 'utf8');
  assert.equal(original.revision, 4);
  const updatedAt = new Date(Date.now() - 1000).toISOString();
  let reads = 0, custody = 0, refreshes = 0, appends = 0, collections = 0;
  const custodyRoots = [];
  const proof = { schemaVersion: 'stephanos.known-malformed-patch-retry.v1', missionId: C.missionId,
    missionRevision: original.revision, sourceHead: HEAD, repairCommit: C.repairCommit,
    terminal: { schemaVersion: 'stephanos.known-malformed-patch-terminal.v1', missionId: C.missionId,
      actionId: C.actionId, blocker: C.blocker, originalSourceHead: C.originalSourceHead,
      itemSha256: '1'.repeat(64), resultSha256: '2'.repeat(64) },
    mechanismSha256: '3'.repeat(64), sourceBlobSetSha256: '4'.repeat(64) };
  const run = () => retrySafelyBlockedAgentFailure({ backlog: [], env: { STEPHANOS_SHARED_AGENT_WORKSPACE: join(parent, 'configured-workspace') },
    paths: { repoRoot: join(parent, 'repo'), workspaceRoot: join(parent, 'workspace'), orchestratorRoot: options.root, snapshotRoot: options.snapshotRoot },
    listMissions: listMissionRecords,
    readProgrammeProjection: async () => {
      reads++;
      const admission = { schemaVersion: 'stephanos.github-goal-admission.v1', issueNumber: 1372,
        repository: C.repository, state: 'READY', route: 'OPENCLAW_LOCAL', prerequisites: [],
        resourceIds: [RESOURCE], requiredTests: [VERIFY, ORACLE], sourceImplementationAllowed: true, ...permissions };
      const issue = { issueNumber: 1372, repository: C.repository, state: 'open', labels: ['goal'],
        retrievedAt: new Date().toISOString(), updatedAt, admissionProofSource: 'OWNER_AUTHENTICATED_COMMENT',
        admissionState: 'ADMISSION_PROVEN', schedulerEligible: true, admission };
      if (reads >= 3 && mode === 'owner-changed') issue.admissionProofSource = 'UNTRUSTED';
      if (reads >= 4 && mode === 'owner-changed-after-refresh') issue.updatedAt = new Date().toISOString();
      return { machineryInventory: { sourceHead: reads >= 3 && mode === 'head-changed' ? 'b'.repeat(40) : HEAD },
        githubGoalEstateRead: { ok: true, issues: [issue] }, goalMirrorEstate: { records: [{
          schemaVersion: 'shared-agent-workspace-record.v1', kind: 'stephanos.shared_workspace.goal',
          goalId: 'goal-1372', issueNumber: 1372, repository: C.repository, source: 'github-goal-estate-mirror',
          mirrorSchema: 'stephanos.github-goal-mirror.v1', githubAdmissionState: 'ADMISSION_PROVEN',
          mirrorIssueNumber: 1372, mirrorRepository: C.repository, mirrorBuildPickupAllowed: true,
          mirrorObservedAtUtc: updatedAt, state: 'READY', route: 'OPENCLAW_LOCAL', resourceIds: [], ...permissions,
        }] } };
    },
    proveRetryOwnershipReleased: async input => {
      custody++; assert.equal(input.actionId, C.actionId);
      custodyRoots.push(input.sharedWorkspaceRoot);
      return { ok: !(custody >= 2 && mode === 'custody-changed') };
    },
    // Collector/terminal-file authenticity is tested independently; this seam
    // makes races deterministic while the actual mission store owns its lock.
    collectKnownPatchEvidence: async ({ ownershipRelease }) => {
      collections++;
      if (collections === 3 && mode === 'owner-expired') advanceClock();
      return { ok: ownershipRelease.ok,
        proof: custody >= 2 && mode === 'terminal-changed' ? { ...proof, mechanismSha256: '5'.repeat(64) } : proof };
    },
    refreshRetryWorktree: async ({ expectedSourceHead }) => {
      refreshes++;
      assert.equal(expectedSourceHead, HEAD);
      const lock = await readFile(join(options.root, C.missionId + '.lock'), 'utf8');
      assert.ok(lock.length > 0, 'original branch changes only while mission lock is held');
      return { ok: true, clean: mode !== 'dirty-worktree', afterHead: HEAD };
    },
    appendEvent: async (id, event, storeOptions) => {
      appends++;
      if (mode === 'cancel-before-cas') await appendMissionEvent(id, { eventId: 'cancel-before-cas', eventType: 'MISSION_CANCELLED' }, options);
      if (mode === 'fence-before-cas') {
        const state = await read(); state.storeMetadata.supervisedRecoveryMaintenance = { reserved: true };
        await writeFile(created.statePath, JSON.stringify(state));
      }
      return appendMissionEvent(id, event, storeOptions);
    },
  });
  return { run, read, original, bytes, proof, options, statePath: created.statePath,
    counts: () => ({ reads, custody, refreshes, appends }), custodyRoots,
    configuredWorkspace: join(parent, 'configured-workspace') };
}

test('real store admits only one narrowed attempt, preserving original history and branch', async () => {
  const f = await fixture();
  const result = await f.run();
  assert.equal(result.retried, true, JSON.stringify(result));
  const state = await f.read();
  assert.equal(state.repair.currentRound, 1);
  assert.equal(state.git.branch, C.branch);
  assert.equal(state.currentPhase, 'AGENT_IMPLEMENTATION');
  assert.deepEqual(state.requiredTests, [VERIFY, ORACLE]);
  assert.deepEqual(state.allowedFiles, ['shared/agents/sharedAgentWorkspaceStore.mjs', 'shared/agents/sharedAgentWorkspaceStore.mjs/**']);
  assert.deepEqual(state.repair.history.at(-1).retryKnownMalformedPatchProof, f.proof);
  assert.equal(f.counts().refreshes, 1);
  assert.equal(f.custodyRoots.length, 3);
  assert.ok(f.custodyRoots.every(root => root === f.configuredWorkspace));
  assert.equal((await f.run()).retried, false);
  assert.equal((await f.read()).repair.currentRound, 1);
  assert.equal(state.pullRequest.number, null);
});

test('owner evidence that expires during the final source read cannot admit a retry', async t => {
  const realNow = Date.now.bind(Date);
  let offset = 0;
  t.mock.method(Date, 'now', () => realNow() + offset);
  const f = await fixture('owner-expired', () => { offset = 300001; });
  await assert.rejects(f.run(), /REVALIDATION_FAILED/);
  assert.equal(await readFile(f.statePath, 'utf8'), f.bytes);
  assert.equal(f.counts().refreshes, 1);
});

test('a canonical head change is refused before any original-branch merge', () => {
  const calls = [];
  const result = refreshRetryWorktreeToCurrentMain({ mission: { git: { branch: C.branch, worktreePath: 'offline-worktree' } },
    repoRoot: 'offline-repo', expectedSourceHead: HEAD,
    runCommand: (_exe, args) => {
      calls.push(args);
      if (args[2] === 'status') return { status: 0, stdout: '' };
      if (args[2] === 'branch') return { status: 0, stdout: C.branch };
      if (args[2] === 'rev-parse') return { status: 0, stdout: args[1] === 'offline-repo' ? 'b'.repeat(40) : C.originalSourceHead };
      assert.fail('Unexpected mutation: ' + JSON.stringify(args));
    } });
  assert.equal(result.classification, 'RETRY_WORKTREE_EXPECTED_HEAD_MOVED');
  assert.equal(calls.some(args => args[2] === 'merge'), false);
});

test('simultaneous scanners consume only one attempt and change the branch once', async () => {
  const f = await fixture();
  const results = await Promise.all([f.run(), f.run()]);
  assert.equal(results.filter(r => r.retried).length, 1);
  assert.equal((await f.read()).repair.currentRound, 1);
  assert.equal(f.counts().refreshes, 1);
});

test('JSON proofs cannot create the server authentication callback', async () => {
  const f = await fixture();
  for (const eventType of ['AGENT_FAILURE_RETRY_ADMITTED', ' agent_failure_retry_admitted ']) {
    await assert.rejects(appendMissionEvent(C.missionId, { eventId: 'forged-' + eventType.trim(), eventType,
      expectedRevision: 4, retryPlanSourceHead: HEAD, retryKnownMalformedPatchProof: f.proof,
      authorizeKnownMalformedPatchRetry: true, receipt: receipt('forged') }, f.options), /AUTHENTICATOR_REQUIRED/);
  }
  assert.equal(await readFile(f.statePath, 'utf8'), f.bytes);
});

test('owner, source and custody races leave the original state byte-for-byte intact', async t => {
  for (const mode of ['owner-changed', 'head-changed', 'custody-changed', 'terminal-changed', 'dirty-worktree', 'owner-changed-after-refresh']) {
    await t.test(mode, async () => {
      const f = await fixture(mode);
      await assert.rejects(f.run(), /REVALIDATION_FAILED/);
      assert.equal(await readFile(f.statePath, 'utf8'), f.bytes);
      assert.equal(f.counts().refreshes, ['dirty-worktree', 'owner-changed-after-refresh'].includes(mode) ? 1 : 0);
    });
  }
});

test('cancellation and reservation win before a branch refresh', async t => {
  for (const mode of ['cancel-before-cas', 'fence-before-cas']) await t.test(mode, async () => {
    const f = await fixture(mode);
    if (mode === 'fence-before-cas') await assert.rejects(f.run(), /ORIGINAL_SOURCE_ATTEMPT_FENCED/);
    else assert.equal((await f.run()).retried, false);
    assert.equal(f.counts().refreshes, 0);
    assert.equal((await f.read()).repair.currentRound, 0);
  });
});
