import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  buildPostSyncRefreshProjection, classifyPostSyncRefresh, executePostSyncRefreshPlan,
  parseGitChangedPathStatus, projectPostSyncRemainingIgnitionObligationsV1,
} from './postSyncRuntimeRefreshCoordinator.mjs';
import { createFixedPostSyncRuntimeAdapter } from '../../scripts/battle-bridge-post-sync-refresh.mjs';
import {
  createStephanosNativeCapacityReceipt, createStephanosNativeSourceAuthority,
} from './stephanosNativeCapacityReceiptV1.mjs';
import {
  isVerifiedStephanosNativeRoutingCandidate, readVerifiedStephanosNativeRoutingCandidate,
  STEPHANOS_NATIVE_CAPACITY_KEY_ID,
} from './stephanosNativeCapacityRoutingAdmissionV1.mjs';

// Source/fixture proof only. No installed task, publisher, key store, Ollama,
// native producer or service is invoked. Fixture signing keys stay in memory.
const ENTRY = 'scripts/stephanos-native-capacity-publisher.mjs';
const A = 'a'.repeat(40), B = 'b'.repeat(40);
const RETAINED_BEFORE = 'd729d17c65298e4c27305bca243848585a5bc8aa';
const RETAINED_AFTER = '97a09c75abf744e1ee91f3fb6fd4601412aee437';
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const TARGETS = ['stephanos-ui-4173', 'stephanos-backend-8787', 'mission-orchestrator-worker',
  'github-command-mailbox', 'sovereign-commander', 'natural-reload'];
const UNPAID = [...TARGETS.map(id => 'target:' + id), 'governor', 'sovereign-relay',
  'spatial-resident', 'desktop-plugin-host'];
const flags = { sovereignRelayRefreshRequired: true, governorRefreshRequired: true, spatialAdoptionRequired: true };
const pass = sourceHead => ({ ok: true, sourceHead, exactHeadProofOk: true, blocker: '' });

function naturalAdapter(observedHead, calls) {
  return createFixedPostSyncRuntimeAdapter({ spawnSyncFn(command, args, options) {
    calls.push({ command, args, options });
    assert.deepEqual(args, ['rev-parse', 'HEAD']);
    assert.equal(options.shell, false);
    return { status: 0, stdout: observedHead + '\n', stderr: '' };
  } });
}

async function runEntry(observedHead = B) {
  const calls = [], forbidden = [];
  const fixed = naturalAdapter(observedHead, calls);
  const adapters = Object.fromEntries(['refreshUi', 'proveVrAtlas', 'restartBackend', 'restartMissionWorker',
    'restartGitHubMailbox', 'refreshSovereignCommander', 'verifySovereignPluginHost',
    'installPublisher', 'startPublisher', 'stopPublisher', 'createSigningKey', 'probeNativeCapacity',
    'qualifyNativeCapacity', 'publishNativeCapacity'].map(name => [name, () => { forbidden.push(name); assert.fail(name); }]));
  adapters.confirmNaturalReload = ({ afterHead }) => fixed.confirmNaturalReload({ afterHead, repoRoot: REPO });
  const result = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B, changedPaths: [ENTRY], adapters });
  return { result, calls, forbidden };
}

test('exact resident publisher entry uses source-only natural adoption and its existing fixed owner', async () => {
  const installer = await readFile(new URL('../../scripts/windows/install-stephanos-native-capacity-publisher.ps1', import.meta.url), 'utf8');
  const literal = installer.match(/\$publisherScript = Join-Path \$repositoryRoot '([^']+)'/);
  assert.equal(literal?.[1].replaceAll('\\', '/'), ENTRY);
  assert.match(installer, /& `\$canonicalNode `\$publisherScript\s+exit `\$LASTEXITCODE/);
  assert.match(installer, /-RestartCount 3\s+/);
  assert.match(installer, /-RestartInterval \(New-TimeSpan -Minutes 1\)/);
  const plan = classifyPostSyncRefresh([ENTRY]);
  assert.equal(plan.classification, 'REFRESH_READY');
  assert.deepEqual(plan.targetIds, ['natural-reload']);
  assert.equal(plan.noRuntimePathCount, 0);
  const { result, calls, forbidden } = await runEntry();
  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.targetIds, ['natural-reload']);
  assert.equal(calls.length, 1);
  assert.deepEqual(forbidden, []);
  const projection = buildPostSyncRefreshProjection(result, { beforeHead: A, afterHead: B });
  assert.equal(projection.resultTargets[0].exactHeadProofOk, true);
  assert.equal(Object.hasOwn(projection.resultTargets[0], 'freshProcessLoaded'), false);
  assert.equal(Object.hasOwn(projection, 'capacityReceipt'), false);
  assert.equal(Object.hasOwn(projection, 'sourceAuthority'), false);
});

test('unknown siblings mixed paths and unsafe input still stop before every adapter', async () => {
  for (const changedPaths of [[ENTRY + '.extra'], ['scripts/stephanos-native-capacity-publisher-v2.mjs'],
    ['scripts/stephanos-native-capacity-publisher-source-gate.mjs'],
    ['scripts/windows/install-stephanos-native-capacity-publisher.ps1'],
    [ENTRY, 'scripts/stephanos-native-capacity-unreviewed.mjs'], [ENTRY, '../outside.mjs']]) {
    let invocations = 0;
    const adapters = new Proxy({}, { get() { return () => { invocations++; assert.fail('unadmitted effect'); }; } });
    const result = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B, changedPaths, adapters });
    assert.equal(result.ok, false);
    assert.equal(result.plan.automaticExecutionAllowed, false);
    assert.ok(result.plan.unknownPathCount > 0 || result.plan.unsafePathCount > 0);
    assert.equal(invocations, 0);
  }
  assert.deepEqual(classifyPostSyncRefresh(['shared/agents/stephanosNativeCapacityPublisherV1.mjs']).targetIds,
    ['stephanos-backend-8787', 'mission-orchestrator-worker']);
  assert.ok(classifyPostSyncRefresh(['scripts/completion-guardian.mjs']).targetIds.includes('mission-orchestrator-worker'));
});

test('actual retained 833-path source range keeps all other ten unpaid obligations and Spatial hold', () => {
  const status = execFileSync('git', ['-c', 'safe.directory=' + resolve(REPO), 'diff', '--name-status', '--find-renames',
    '--diff-filter=ACDMRT', RETAINED_BEFORE, RETAINED_AFTER, '--'],
  { cwd: REPO, encoding: 'utf8', windowsHide: true, shell: false, timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
  const parsed = parseGitChangedPathStatus(status);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.paths.length, 833);
  assert.ok(parsed.paths.includes(ENTRY));
  const plan = classifyPostSyncRefresh(parsed.paths, flags);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.classification, 'BLOCKED_SPATIAL_ADOPTION_REQUIRED');
  assert.deepEqual(plan.targetIds, TARGETS);
  for (const key of ['pluginHostActivationRequired', 'spatialAdoptionRequired', 'sovereignRelayRefreshRequired', 'governorRefreshRequired']) assert.equal(plan[key], true);
  const project = selected => buildPostSyncRefreshProjection({ ok: false, exactHeadProofOk: false,
    classification: selected.classification, blocker: selected.classification, plan: selected, results: [] },
  { beforeHead: RETAINED_BEFORE, afterHead: RETAINED_AFTER });
  const record = project(plan);
  assert.equal(record.finalVerdict, 'POST_SYNC_RUNTIME_REFRESH_BLOCKED');
  assert.deepEqual(projectPostSyncRemainingIgnitionObligationsV1(record, RETAINED_AFTER).remaining, UNPAID);
  const mixed = project(classifyPostSyncRefresh([...parsed.paths, 'scripts/unreviewed-publisher-sibling.mjs'], flags));
  assert.deepEqual(projectPostSyncRemainingIgnitionObligationsV1(mixed, RETAINED_AFTER).remaining,
    [...UNPAID, 'unclassified-path']);
});

test('fixed changed-status adapter refuses removal and rename-away without hiding unknown copy destinations', () => {
  for (const status of [`D\t${ENTRY}`, `R100\t${ENTRY}\tscripts/unreviewed-publisher-v2.mjs`]) {
    const parsed = parseGitChangedPathStatus(status);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.blocker, 'POST_SYNC_REQUIRED_NATIVE_CAPACITY_PUBLISHER_REMOVED');
    const adapter = createFixedPostSyncRuntimeAdapter({ spawnSyncFn(command, args, options) {
      assert.ok(args.includes('--diff-filter=ACDMRT'));
      assert.equal(options.shell, false);
      return { status: 0, stdout: status + '\n', stderr: '' };
    } });
    assert.equal(adapter.changedPaths({ beforeHead: A, afterHead: B, repoRoot: REPO }).blocker, parsed.blocker);
  }
  const copied = parseGitChangedPathStatus(`C100\t${ENTRY}\tscripts/unreviewed-publisher-v2.mjs`);
  assert.equal(copied.ok, true);
  assert.equal(copied.paths.length, 2);
  assert.equal(classifyPostSyncRefresh(copied.paths).classification, 'BLOCKED_UNCLASSIFIED_RUNTIME_PATH');
});

test('a missing failed or wrong-head natural result cannot pay publisher source adoption', async () => {
  const stale = await runEntry(A);
  assert.equal(stale.result.ok, false);
  assert.equal(stale.result.exactHeadProofOk, false);
  assert.deepEqual(stale.forbidden, []);
  for (const response of [undefined, { ...pass(B), ok: false }, { ...pass(B), exactHeadProofOk: false }]) {
    const result = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B, changedPaths: [ENTRY],
      adapters: { confirmNaturalReload: async () => response } });
    assert.equal(result.ok, false);
    assert.equal(buildPostSyncRefreshProjection(result, { beforeHead: A, afterHead: B }).resultTargets[0].ok, false);
  }
});

test('natural source adoption neither supplies a signed candidate nor relabels an old-head signed capacity', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'publisher-source-adoption-'));
  const actualRoot = await realpath(parent);
  assert.equal(dirname(actualRoot), await realpath(tmpdir()));
  assert.ok(basename(actualRoot).startsWith('publisher-source-adoption-'));
  t.after(() => rm(actualRoot, { recursive: true, force: true }));
  const root = join(parent, 'workspace'), repoRoot = join(parent, 'repo'), runner = join(parent, 'runner');
  await Promise.all([mkdir(join(root, 'status'), { recursive: true }), mkdir(repoRoot), mkdir(join(runner, 'keys'), { recursive: true })]);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  await writeFile(join(runner, 'keys', 'stephanos-native-capacity-public.pem'), publicKeyPem);
  const statusPath = join(root, 'status', 'stephanos-native-capacity-current.json');
  const options = { root, repoRoot, env: { STEPHANOS_MISSION_RUNNER_ROOT: runner },
    repository: 'Cheekyfellastef/stephan-os', taskClass: 'FOCUSED_REPAIR', nowUtc: '2026-11-19T12:00:00.000Z' };
  const { result } = await runEntry(B);
  const adopted = buildPostSyncRefreshProjection(result, { beforeHead: A, afterHead: B });
  assert.equal(adopted.exactHeadProofOk, true);
  await writeFile(statusPath, JSON.stringify(adopted));
  const noCapacity = await readVerifiedStephanosNativeRoutingCandidate({ ...options, sourceHead: B });
  assert.equal(noCapacity.ok, false);
  assert.equal(noCapacity.candidate, null);
  const payload = { schemaVersion: 'stephanos.native-capacity-payload.v1', receiptId: 'native-capacity-fixture-a',
    repository: options.repository, sourceHead: A, workerId: 'stephanos-native-battle-bridge', provider: 'ollama-local',
    transport: 'http-loopback-fixed', endpoint: 'http://127.0.0.1:11434', model: 'qwen:14b', modelInventorySha256: '1'.repeat(64),
    qualificationId: 'native-source-qualification-v1', supportedTaskClasses: ['FOCUSED_REPAIR'],
    supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'], observedAtUtc: '2026-11-19T11:59:00.000Z',
    expiresAtUtc: '2026-11-19T12:04:00.000Z', queueDepth: 0, p95StartLatencySeconds: 2, loadState: 'READY',
    requestSha256: '2'.repeat(64), responseSha256: '3'.repeat(64), proofRefs: ['proof/publisher-source-adoption-fixture'] };
  const capacityReceipt = createStephanosNativeCapacityReceipt(payload, { privateKeyPem, keyId: STEPHANOS_NATIVE_CAPACITY_KEY_ID });
  const sourceAuthority = createStephanosNativeSourceAuthority(capacityReceipt, { publicKeyPem,
    expected: { repository: options.repository, sourceHead: A, workerId: payload.workerId,
      nowUtc: options.nowUtc, keyId: STEPHANOS_NATIVE_CAPACITY_KEY_ID } });
  assert.ok(capacityReceipt && sourceAuthority);
  const signed = { schemaVersion: 'shared-agent-workspace-record.v1', statusId: 'stephanos-native-capacity-current',
    participantId: payload.workerId, timestampUtc: payload.observedAtUtc, status: 'READY', capacityReceipt, sourceAuthority,
    publisherAttestation: { keyId: STEPHANOS_NATIVE_CAPACITY_KEY_ID, sourceHead: A,
      receiptSha256: createHash('sha256').update(JSON.stringify(capacityReceipt)).digest('hex'), proofRef: payload.proofRefs[0] },
    sourceMutationAllowed: true, arbitraryCommandAllowed: false, mergeAuthority: false,
    leaseSeizureAllowed: false, duplicateDispatchAllowed: false, supportedOperations: payload.supportedOperations };
  await writeFile(statusPath, JSON.stringify(signed));
  const original = await readVerifiedStephanosNativeRoutingCandidate({ ...options, sourceHead: A });
  assert.equal(original.ok, true, original.reason);
  assert.equal(isVerifiedStephanosNativeRoutingCandidate(original.candidate), true);
  const current = await readVerifiedStephanosNativeRoutingCandidate({ ...options, sourceHead: B });
  assert.equal(current.ok, false);
  assert.equal(current.candidate, null);
  assert.match(current.reason, /source-head-invalid/);
});
