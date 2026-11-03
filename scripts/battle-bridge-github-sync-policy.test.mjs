import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_SYNC_CONTRACT,
  DEFAULT_RUNTIME_ONLY_ALLOWLIST,
  FIXED_GIT_COMMANDS,
  POST_SYNC_REFRESH_REGISTRY,
  POST_SYNC_SOVEREIGN_RELAY_OBSERVATION_SCHEMA,
  SYNC_CLASSIFICATIONS,
  buildRemoteDirtBlockerSummary,
  buildSharedWorkspaceHeartbeat,
  buildSharedWorkspaceReceipt,
  classifyDirt,
  collectPostSyncRefreshDebt,
  evaluateSyncPolicy,
  inspectPostSyncRefreshCompletion,
  inspectPendingPostSyncRefreshDebt,
  pendingPostSyncRefreshDebt,
  projectPostSyncSovereignRelayObservation,
  resolvePostSyncRefreshDebt,
  rejectArbitraryShellPlan,
} from './battle-bridge-github-sync-policy.mjs';

const LOCAL_HEAD = 'a'.repeat(40);
const REMOTE_HEAD = 'b'.repeat(40);
const OTHER_HEAD = 'c'.repeat(40);
const WRONG_BEFORE_HEAD = 'd'.repeat(40);

function refreshReport(overrides = {}) {
  return { schemaVersion: 'shared-agent-workspace-record.v1', kind: 'stephanos.shared_workspace.status',
    statusId: 'post-sync-runtime-refresh-current', beforeHead: LOCAL_HEAD, afterHead: REMOTE_HEAD,
    phase: 'complete', classification: 'REFRESH_COMPLETE', finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_PASS',
    exactHeadProofOk: true, blocker: '', targetIds: ['stephanos-ui-4173'],
    resultTargets: [{ targetId: 'stephanos-ui-4173', ok: true, exactHeadProofOk: true, sourceHead: REMOTE_HEAD, blocker: '' }],
    changedPathCount: 1, noRuntimePathCount: 0, unknownPathCount: 0, unsafePathCount: 0,
    openClawPathCount: 0, pluginHostActivationRequired: false, ...overrides };
}

function relayProof(sourceHead = REMOTE_HEAD) {
  return { schemaVersion: 'stephanos.post-sync-sovereign-relay-proof.v1', watchdogSucceeded: true,
    healthy: true, sourceHead, sourceHeadMatchesLive: true, processCount: 1, heartbeatAgeSeconds: 2, blocker: '' };
}

test('failed relay observation is diagnostic only and cannot be confused with proof', () => {
  const observation = {
    schemaVersion: POST_SYNC_SOVEREIGN_RELAY_OBSERVATION_SCHEMA,
    watchdogSucceeded: true,
    healthy: false,
    sourceHead: REMOTE_HEAD,
    sourceHeadMatchesLive: false,
    processCount: 0,
    heartbeatAgeSeconds: 4,
    blocker: 'SOVEREIGN_RELAY_SOURCE_HEAD_STALE',
  };
  const projected = projectPostSyncSovereignRelayObservation(observation, REMOTE_HEAD);
  assert.deepEqual(projected, observation);
  assert.equal(Object.hasOwn(projected, 'authorityGranted'), false);
  assert.equal(projectPostSyncSovereignRelayObservation({ ...observation, rawPath: 'C:\\private' }, REMOTE_HEAD), null);
  assert.equal(projectPostSyncSovereignRelayObservation({ ...observation, processCount: 33 }, REMOTE_HEAD), null);
  assert.equal(projectPostSyncSovereignRelayObservation({ ...observation, blocker: 'PRIVATE_ARBITRARY_FAILURE' }, REMOTE_HEAD), null);
  assert.equal(projectPostSyncSovereignRelayObservation({ ...observation, blocker: 'private path C:\\x' }, REMOTE_HEAD), null);
});

function commanderReport({ required = true, proof = relayProof(), ...overrides } = {}) {
  return refreshReport({ targetIds: ['sovereign-commander'], sovereignRelayRefreshRequired: required,
    resultTargets: [{ targetId: 'sovereign-commander', ok: true, exactHeadProofOk: true,
      sourceHead: overrides.afterHead || REMOTE_HEAD, blocker: '', ...(proof === undefined ? {} : { sovereignRelayProof: proof }) }], ...overrides });
}

test('canonical completion retains relay binding and rejects generic discharge of a required relay span', () => {
  const isAncestor = (before, after) => ({ ok: true, ancestor: before <= after });
  const span = { beforeHead: LOCAL_HEAD, afterHead: REMOTE_HEAD };
  const complete = inspectPostSyncRefreshCompletion(commanderReport());
  assert.equal(complete.ok, true);
  assert.equal(complete.sovereignRelayRefreshRequired, true);
  assert.deepEqual(complete.sovereignRelayProof, relayProof());
  const base = { spans: [span], requiredTargetIds: ['sovereign-commander'], sovereignRelayRefreshRequired: true,
    currentHead: REMOTE_HEAD, isAncestor };
  assert.equal(resolvePostSyncRefreshDebt({ ...base, completion: JSON.parse(JSON.stringify(complete)) }).debt, null);
  const nonRelay = commanderReport({ required: false });
  delete nonRelay.resultTargets[0].sovereignRelayProof;
  const generic = inspectPostSyncRefreshCompletion(nonRelay);
  assert.equal(generic.ok, true);
  const unresolved = resolvePostSyncRefreshDebt({ ...base, completion: generic });
  assert.deepEqual(unresolved.debt, { ...span, requiredTargetIds: ['sovereign-commander'], sovereignRelayRefreshRequired: true });
  for (const mutation of [{ sovereignRelayRefreshRequired: 'true' }, { sovereignRelayProof: null },
    { sovereignRelayProof: relayProof(LOCAL_HEAD) }, { sovereignRelayProof: { ...relayProof(), processCount: 2 } }]) {
    assert.equal(resolvePostSyncRefreshDebt({ ...base, completion: { ...complete, ...mutation } }).ok, false);
  }
  const stripped = { ok: true, ...span, targetIds: ['sovereign-commander'] };
  const restored = resolvePostSyncRefreshDebt({ ...base, completion: stripped });
  assert.equal(restored.debt.sovereignRelayRefreshRequired, true);
  assert.equal(restored.debt.beforeHead, LOCAL_HEAD);
});

test('only an otherwise-valid legacy Commander completion migrates to its own recoverable debt', () => {
  const legacy = commanderReport();
  delete legacy.sovereignRelayRefreshRequired;
  delete legacy.resultTargets[0].sovereignRelayProof;
  const inspected = inspectPostSyncRefreshCompletion(legacy);
  assert.equal(inspected.ok, false);
  assert.equal(inspected.legacyCommanderCompletion, true);
  const recovered = collectPostSyncRefreshDebt({ refreshRecord: legacy });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.completion, null);
  assert.equal(recovered.sovereignRelayRefreshRequired, true);
  assert.deepEqual(recovered.spans, [{ beforeHead: LOCAL_HEAD, afterHead: REMOTE_HEAD }]);
  assert.deepEqual(recovered.requiredTargetIds, ['sovereign-commander']);
  for (const mutation of [{ beforeHead: [LOCAL_HEAD] }, { targetIds: [] }, { resultTargets: [] },
    { exactHeadProofOk: 'true' }, { blocker: 'FAILED' }, { unknownPathCount: 1 },
    { sovereignRelayRefreshRequired: 'false' }]) {
    assert.equal(collectPostSyncRefreshDebt({ refreshRecord: { ...legacy, ...mutation } }).ok, false);
  }
  const claimedWithoutProof = { ...legacy, sovereignRelayRefreshRequired: true };
  assert.equal(collectPostSyncRefreshDebt({ refreshRecord: claimedWithoutProof }).ok, false);
});

test('serialized relay obligation survives repeated coalescing and reverts until exact covering proof pays it', () => {
  const isAncestor = (before, after) => ({ ok: true, ancestor: before <= after });
  const heads = [LOCAL_HEAD, REMOTE_HEAD, OTHER_HEAD, WRONG_BEFORE_HEAD, 'e'.repeat(40)];
  let pending = pendingPostSyncRefreshDebt([{ beforeHead: heads[0], afterHead: heads[1] }],
    ['sovereign-commander'], '', { sovereignRelayRefreshRequired: true });
  for (let index = 2; index < heads.length; index++) {
    const afterHead = heads[index];
    const httpOnly = commanderReport({ required: false, beforeHead: heads[0], afterHead });
    delete httpOnly.resultTargets[0].sovereignRelayProof;
    const syncRecord = { schemaVersion: 'shared-agent-workspace-record.v1', kind: 'stephanos.shared_workspace.status',
      statusId: 'battle-bridge-github-sync-current', classification: 'SYNC_NO_CHANGE', pendingRefresh: JSON.parse(JSON.stringify(pending)) };
    const evidence = collectPostSyncRefreshDebt({ syncRecord, refreshRecord: httpOnly });
    assert.equal(evidence.sovereignRelayRefreshRequired, true);
    const result = resolvePostSyncRefreshDebt({ ...evidence,
      requestedSpans: [{ beforeHead: heads[index - 1], afterHead }], currentHead: afterHead, isAncestor });
    assert.equal(result.debt.beforeHead, heads[0]);
    assert.equal(result.debt.afterHead, afterHead);
    assert.equal(result.debt.sovereignRelayRefreshRequired, true);
    pending = pendingPostSyncRefreshDebt([result.debt], result.debt.requiredTargetIds, '', result.debt);
    assert.equal(inspectPendingPostSyncRefreshDebt(pending).sovereignRelayRefreshRequired, true);
  }
  const afterHead = heads.at(-1);
  const paid = inspectPostSyncRefreshCompletion(commanderReport({ afterHead, proof: relayProof(afterHead) }));
  const result = resolvePostSyncRefreshDebt({ ...inspectPendingPostSyncRefreshDebt(pending),
    completion: paid, currentHead: afterHead, isAncestor });
  assert.equal(result.debt, null);
  assert.equal(result.discharged, true);
});

test('paid relay debt does not infect later unrelated work and legacy pending metadata remains unknown', () => {
  const complete = inspectPostSyncRefreshCompletion(commanderReport());
  const next = resolvePostSyncRefreshDebt({ spans: [{ beforeHead: LOCAL_HEAD, afterHead: REMOTE_HEAD }],
    requestedSpans: [{ beforeHead: REMOTE_HEAD, afterHead: OTHER_HEAD }], requiredTargetIds: ['sovereign-commander'],
    sovereignRelayRefreshRequired: true, completion: complete, currentHead: OTHER_HEAD,
    isAncestor: (before, after) => ({ ok: true, ancestor: before <= after }) });
  assert.deepEqual(next.debt, { beforeHead: REMOTE_HEAD, afterHead: OTHER_HEAD, requiredTargetIds: [], sovereignRelayRefreshRequired: false });
  const pending = pendingPostSyncRefreshDebt([{ beforeHead: LOCAL_HEAD, afterHead: REMOTE_HEAD }],
    ['sovereign-commander'], '', { sovereignRelayRefreshRequired: false });
  assert.equal(inspectPendingPostSyncRefreshDebt(pending).sovereignRelayRefreshRequired, false);
  const legacy = { ...pending }; delete legacy.sovereignRelayRefreshRequired;
  assert.equal(inspectPendingPostSyncRefreshDebt(legacy).sovereignRelayRefreshRequired, true);
  assert.equal(inspectPendingPostSyncRefreshDebt({ ...pending, sovereignRelayRefreshRequired: 'false' }).ok, false);
});

test('an insufficient newer completion cannot strand retained relay recovery at an obsolete source head', () => {
  const debt = { beforeHead: LOCAL_HEAD, afterHead: REMOTE_HEAD };
  const base = { spans: [debt], requiredTargetIds: ['sovereign-commander'], sovereignRelayRefreshRequired: true,
    currentHead: OTHER_HEAD, isAncestor: (before, after) => ({ ok: true, ancestor: before <= after }) };
  const generic = commanderReport({ required: false, afterHead: OTHER_HEAD });
  delete generic.resultTargets[0].sovereignRelayProof;
  const nonCovering = commanderReport({ beforeHead: REMOTE_HEAD, afterHead: OTHER_HEAD, proof: relayProof(OTHER_HEAD) });
  for (const report of [generic, nonCovering]) {
    const completion = inspectPostSyncRefreshCompletion(report);
    assert.equal(completion.ok, true);
    for (const requestedSpans of [[], [{ beforeHead: REMOTE_HEAD, afterHead: OTHER_HEAD }]]) {
      const result = resolvePostSyncRefreshDebt({ ...base, completion, requestedSpans });
      assert.equal(result.discharged, false);
      assert.deepEqual(result.debt, { beforeHead: LOCAL_HEAD, afterHead: OTHER_HEAD,
        requiredTargetIds: ['sovereign-commander'], sovereignRelayRefreshRequired: true });
    }
  }
});

test('refresh completion requires coherent native target proofs and strict primitive fields', () => {
  assert.equal(inspectPostSyncRefreshCompletion(refreshReport()).ok, true);
  const invalid = [
    { beforeHead: [LOCAL_HEAD] }, { afterHead: ` ${REMOTE_HEAD}` }, { phase: 'plan' },
    { exactHeadProofOk: 'true' }, { finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_BLOCKED' },
    { blocker: 'STILL_BLOCKED' }, { targetIds: [] }, { targetIds: ['stephanos-ui-4173', 'stephanos-ui-4173'] },
    { resultTargets: [] }, { resultTargets: [{ targetId: 'stephanos-ui-4173', ok: true, exactHeadProofOk: true, sourceHead: LOCAL_HEAD, blocker: '' }] },
    { resultTargets: [{ targetId: 'stephanos-ui-4173', ok: false, exactHeadProofOk: true, sourceHead: REMOTE_HEAD, blocker: '' }] },
    { changedPathCount: 0 }, { noRuntimePathCount: 1 }, { unknownPathCount: 1 }, { unsafePathCount: 1 },
    { openClawPathCount: 1 }, { pluginHostActivationRequired: true }, { changedPathCount: '1' },
  ];
  for (const mutation of invalid) assert.equal(inspectPostSyncRefreshCompletion(refreshReport(mutation)).ok, false, JSON.stringify(mutation));
  const noRuntime = refreshReport({ classification: 'NO_RUNTIME_REFRESH_REQUIRED', targetIds: [], resultTargets: [], noRuntimePathCount: 1 });
  assert.equal(inspectPostSyncRefreshCompletion(noRuntime).ok, true);
  assert.equal(inspectPostSyncRefreshCompletion({ ...noRuntime, changedPathCount: 2 }).ok, false);
});

test('refresh debt parser retains legacy blocked reports and rejects incomplete owned records', () => {
  const blocked = refreshReport({ phase: 'blocked', classification: 'BLOCKED_REFRESH_FAILED', finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_BLOCKED', exactHeadProofOk: false });
  const recovered = collectPostSyncRefreshDebt({ refreshRecord: blocked });
  assert.deepEqual(recovered.spans, [{ beforeHead: LOCAL_HEAD, afterHead: REMOTE_HEAD }]);
  assert.deepEqual(recovered.requiredTargetIds, ['stephanos-ui-4173']);
  for (const key of ['classification', 'finalVerdict', 'exactHeadProofOk', 'targetIds', 'changedPathCount', 'pluginHostActivationRequired']) {
    const malformed = { ...blocked }; delete malformed[key];
    assert.equal(collectPostSyncRefreshDebt({ refreshRecord: malformed }).ok, false, key);
  }
  const missingClassification = { schemaVersion: 'shared-agent-workspace-record.v1', kind: 'stephanos.shared_workspace.status', statusId: 'battle-bridge-github-sync-current' };
  assert.equal(collectPostSyncRefreshDebt({ syncRecord: missingClassification }).ok, false);
  assert.equal(collectPostSyncRefreshDebt({ syncRecord: { ...missingClassification, classification: 'SYNC_NO_CHANGE' } }).ok, true);
});

test('completed span discharges only a covered ancestry chain and retained target obligations', () => {
  const isAncestor = (before, after) => ({ ok: true, ancestor: before <= after });
  const debt = { beforeHead: LOCAL_HEAD, afterHead: REMOTE_HEAD };
  const complete = inspectPostSyncRefreshCompletion(refreshReport());
  const resolve = options => resolvePostSyncRefreshDebt({ spans: [debt], requiredTargetIds: ['stephanos-ui-4173'], currentHead: OTHER_HEAD, isAncestor, ...options });
  assert.equal(resolve({ completion: complete }).debt, null);
  assert.deepEqual(resolve({ completion: { ...complete, beforeHead: REMOTE_HEAD, afterHead: OTHER_HEAD } }).debt, { ...debt, requiredTargetIds: ['stephanos-ui-4173'], sovereignRelayRefreshRequired: false });
  assert.ok(resolve({ completion: { ...complete, targetIds: ['natural-reload'] } }).debt);
  assert.equal(resolve({ completion: { ...complete, afterHead: WRONG_BEFORE_HEAD } }).ok, false);
  assert.equal(resolve({ spans: [{ beforeHead: REMOTE_HEAD, afterHead: LOCAL_HEAD }] }).blocker, 'PENDING_POST_SYNC_SPAN_REVERSED');
  assert.equal(resolve({ isAncestor: () => ({ ok: false, ancestor: false }) }).blocker, 'PENDING_POST_SYNC_ANCESTRY_UNPROVEN');
  assert.equal(resolve({ isAncestor: () => ({ ok: true, ancestor: false }) }).blocker, 'PENDING_POST_SYNC_SPANS_UNRELATED');
  assert.equal(resolve({ currentHead: LOCAL_HEAD }).blocker, 'PENDING_POST_SYNC_RETAINED_HEAD_NOT_CURRENT');
});

test('same-after spans retain the oldest proven before head and reject unrelated branches', () => {
  const spans = [{ beforeHead: LOCAL_HEAD, afterHead: OTHER_HEAD }, { beforeHead: REMOTE_HEAD, afterHead: OTHER_HEAD }];
  const resolved = resolvePostSyncRefreshDebt({ spans, currentHead: OTHER_HEAD, isAncestor: (before, after) => ({ ok: true, ancestor: before <= after }) });
  assert.equal(resolved.debt.beforeHead, LOCAL_HEAD);
  const forked = resolvePostSyncRefreshDebt({ spans, currentHead: OTHER_HEAD, isAncestor: (before, after) => ({ ok: true, ancestor: after === OTHER_HEAD }) });
  assert.equal(forked.blocker, 'PENDING_POST_SYNC_SPANS_UNRELATED');
  assert.equal(pendingPostSyncRefreshDebt([{ beforeHead: [LOCAL_HEAD], afterHead: REMOTE_HEAD }]).state, 'HELD');
});

test('covered old debt is paid before a new revert delta, while unresolved coalesced debt retains intermediate target effects', () => {
  const completion = inspectPostSyncRefreshCompletion(refreshReport());
  const base = { completion, currentHead: OTHER_HEAD, isAncestor: (before, after) => ({ ok: true, ancestor: before <= after }) };
  const next = resolvePostSyncRefreshDebt({ ...base,
    spans: [{ beforeHead: LOCAL_HEAD, afterHead: REMOTE_HEAD }],
    requestedSpans: [{ beforeHead: REMOTE_HEAD, afterHead: OTHER_HEAD }],
  });
  assert.deepEqual(next.debt, { beforeHead: REMOTE_HEAD, afterHead: OTHER_HEAD, requiredTargetIds: [], sovereignRelayRefreshRequired: false });
  const coalesced = resolvePostSyncRefreshDebt({ ...base, spans: [{ beforeHead: LOCAL_HEAD, afterHead: OTHER_HEAD }] });
  assert.deepEqual(coalesced.debt, { beforeHead: LOCAL_HEAD, afterHead: OTHER_HEAD, requiredTargetIds: ['stephanos-ui-4173'], sovereignRelayRefreshRequired: false });
});

const baseFacts = Object.freeze({
  currentBranch: 'main',
  originUrl: 'https://github.com/Cheekyfellastef/stephan-os.git',
  localHead: LOCAL_HEAD,
  remoteHead: LOCAL_HEAD,
  mergeBase: LOCAL_HEAD,
  statusLines: [],
  fetchOk: true,
});

test('canonical contract fixes repo checkout branch remote and no scheduled task', () => {
  assert.equal(CANONICAL_SYNC_CONTRACT.repositoryIdentity, 'Cheekyfellastef/stephan-os');
  assert.equal(CANONICAL_SYNC_CONTRACT.canonicalWindowsCheckout, '%USERPROFILE%\\Documents\\GitHub\\stephan-os');
  assert.equal(CANONICAL_SYNC_CONTRACT.branch, 'main');
  assert.equal(CANONICAL_SYNC_CONTRACT.remote, 'origin');
  assert.equal(CANONICAL_SYNC_CONTRACT.performsShellExecution, false);
  assert.equal(CANONICAL_SYNC_CONTRACT.installsScheduledTask, false);
});

test('clean equal observed heads => SYNC_NO_CHANGE', () => {
  assert.equal(evaluateSyncPolicy(baseFacts).classification, SYNC_CLASSIFICATIONS.SYNC_NO_CHANGE);
});

test('missing or malformed head observations fail closed', () => {
  for (const value of [undefined, null, '', ' ', 'aaa', 'g'.repeat(40)]) {
    assert.equal(
      evaluateSyncPolicy({ ...baseFacts, localHead: value, remoteHead: value }).classification,
      SYNC_CLASSIFICATIONS.BLOCKED_HEAD_PROOF_MISSING,
    );
  }
  assert.equal(evaluateSyncPolicy({ ...baseFacts, localHead: undefined }).classification, SYNC_CLASSIFICATIONS.BLOCKED_HEAD_PROOF_MISSING);
  assert.equal(evaluateSyncPolicy({ ...baseFacts, remoteHead: null }).classification, SYNC_CLASSIFICATIONS.BLOCKED_HEAD_PROOF_MISSING);
});

test('only exact canonical GitHub HTTPS and SSH origins are accepted', () => {
  const accepted = [
    'https://github.com/Cheekyfellastef/stephan-os',
    'https://github.com/Cheekyfellastef/stephan-os.git',
    'git@github.com:Cheekyfellastef/stephan-os.git',
    'ssh://git@github.com/Cheekyfellastef/stephan-os.git',
  ];
  for (const originUrl of accepted) {
    assert.equal(evaluateSyncPolicy({ ...baseFacts, originUrl }).classification, SYNC_CLASSIFICATIONS.SYNC_NO_CHANGE);
  }

  const rejected = [
    'https://evil.example/Cheekyfellastef/stephan-os.git',
    'https://github.com/other/stephan-os.git',
    'https://github.com/Cheekyfellastef/stephan-os-mirror.git',
    'git@evil.example:Cheekyfellastef/stephan-os.git',
    'ssh://git@github.example/Cheekyfellastef/stephan-os.git',
  ];
  for (const originUrl of rejected) {
    assert.equal(evaluateSyncPolicy({ ...baseFacts, originUrl }).classification, SYNC_CLASSIFICATIONS.BLOCKED_REMOTE_MISMATCH);
  }
});

test('clean strict fast-forward => SYNC_FAST_FORWARD_READY', () => {
  const result = evaluateSyncPolicy({ ...baseFacts, remoteHead: REMOTE_HEAD, mergeBase: LOCAL_HEAD });
  assert.equal(result.classification, SYNC_CLASSIFICATIONS.SYNC_FAST_FORWARD_READY);
  assert.equal(result.performsGitMutation, true);
});

test('applied receipt requires exact before remote after correlation and exact-head proof', () => {
  assert.throws(() => evaluateSyncPolicy({ ...baseFacts, remoteHead: REMOTE_HEAD, mergeBase: LOCAL_HEAD, applied: true, localHeadBefore: WRONG_BEFORE_HEAD, localHeadAfter: REMOTE_HEAD, exactHeadProofOk: true }), /exact before/);
  const result = evaluateSyncPolicy({ ...baseFacts, remoteHead: REMOTE_HEAD, mergeBase: LOCAL_HEAD, applied: true, localHeadBefore: LOCAL_HEAD, localHeadAfter: REMOTE_HEAD, exactHeadProofOk: true, postSyncRefreshOk: true });
  assert.equal(result.classification, SYNC_CLASSIFICATIONS.SYNC_FAST_FORWARD_APPLIED);
});

test('dirty source blocks and runtime-only dirt cannot hide source dirt', () => {
  const dirt = classifyDirt([' M scripts/ignite-stephanos-local.mjs', '?? logs/runtime.txt']);
  assert.deepEqual(dirt.trackedSource, ['scripts/ignite-stephanos-local.mjs']);
  assert.deepEqual(dirt.runtimeOnly, ['logs/runtime.txt']);
  assert.equal(evaluateSyncPolicy({ ...baseFacts, statusLines: [' M scripts/ignite-stephanos-local.mjs'] }).classification, SYNC_CLASSIFICATIONS.BLOCKED_DIRTY_SOURCE);
});

test('only the exact untracked OpenClaw workspace state is runtime-only', () => {
  const runtime = classifyDirt(['?? .openclaw/workspace-state.json']);
  assert.deepEqual(runtime.runtimeOnly, ['.openclaw/workspace-state.json']);
  assert.deepEqual(runtime.untrackedSource, []);
  assert.equal(runtime.blocksSync, false);

  const sibling = classifyDirt([
    '?? .openclaw/workspace-state.json',
    '?? .openclaw/commands.ps1',
  ]);
  assert.deepEqual(sibling.runtimeOnly, ['.openclaw/workspace-state.json']);
  assert.deepEqual(sibling.untrackedSource, ['.openclaw/commands.ps1']);
  assert.equal(sibling.blocksSync, true);

  const tracked = classifyDirt([' M .openclaw/workspace-state.json']);
  assert.deepEqual(tracked.runtimeOnly, []);
  assert.deepEqual(tracked.trackedSource, ['.openclaw/workspace-state.json']);
  assert.equal(tracked.blocksSync, true);
});

test('dirty-source blocker exposes samples when bounded and compact counts when redacted', () => {
  const dirt = classifyDirt([
    ' M scripts/ignite-stephanos-local.mjs',
    '?? docs/recovery-note.md',
    '?? ghp_abcdefghijklmnop.txt',
    '?? ../outside.txt',
    '?? path with spaces.txt',
    '?? logs/runtime.txt',
  ]);
  const summary = buildRemoteDirtBlockerSummary(dirt);
  assert.match(summary, /tracked=1/);
  assert.match(summary, /untracked=4/);
  assert.match(summary, /hidden=5/);
  assert.match(summary, /runtime=1/);
  assert.match(summary, /samplesRedacted=true/);
  assert.ok(summary.length <= 180);
  assert.doesNotMatch(summary, /ghp_|\.\.\/|path with spaces/);

  const evaluation = evaluateSyncPolicy({
    ...baseFacts,
    statusLines: [' M scripts/ignite-stephanos-local.mjs', '?? docs/recovery-note.md'],
  });
  assert.equal(evaluation.classification, SYNC_CLASSIFICATIONS.BLOCKED_DIRTY_SOURCE);
  assert.match(evaluation.exactNextAction, /tracked:scripts\/ignite-stephanos-local\.mjs/);
  assert.match(evaluation.exactNextAction, /untracked:docs\/recovery-note\.md/);
});

test('credential-shaped and high-entropy filename components are never published', () => {
  const sensitivePaths = [
    'debug/AKIAIOSFODNN7EXAMPLE.txt',
    'secrets/npm_abcdefghijklmnopqrstuvwxyz.txt',
    'debug/eyJabcDEF12.abcDEF123456.sigABC123456.txt',
    'scratch/Abcdefghijklmnopqrstuv1234567890.txt',
  ];
  const dirt = classifyDirt(sensitivePaths.map((path) => `?? ${path}`));
  const summary = buildRemoteDirtBlockerSummary(dirt);
  assert.match(summary, /untracked=4/);
  assert.match(summary, /hidden=4/);
  assert.match(summary, /samplesRedacted=true/);
  assert.ok(summary.length <= 180);
  for (const path of sensitivePaths) {
    assert.doesNotMatch(summary, new RegExp(path.split('/').at(-1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(summary, /AKIA|npm_|eyJabcDEF12|Abcdefghijklmnopqrstuv/);
});

test('length fallback counts otherwise safe samples that it redacts', () => {
  const trackedPath = `scripts/${'a'.repeat(60)}.mjs`;
  const untrackedPath = `docs/${'b'.repeat(63)}.md`;
  const dirt = classifyDirt([
    ` M ${trackedPath}`,
    `?? ${untrackedPath}`,
  ]);
  const summary = buildRemoteDirtBlockerSummary(dirt);
  assert.match(summary, /tracked=1/);
  assert.match(summary, /untracked=1/);
  assert.match(summary, /hidden=2/);
  assert.match(summary, /samplesRedacted=true/);
  assert.doesNotMatch(summary, /blockingSamples=/);
  assert.doesNotMatch(summary, /aaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbb/);
  assert.ok(summary.length <= 180);
});

test('oversized or unsafe dirt diagnostics fall back to counts without raw path leakage', () => {
  const longName = `scripts/${'a'.repeat(90)}.mjs`;
  const dirt = classifyDirt([
    ` M ${longName}`,
    '?? C:/Users/example/private.txt',
    '?? github_pat_abcdefghijklmnop.txt',
  ]);
  const summary = buildRemoteDirtBlockerSummary(dirt);
  assert.match(summary, /tracked=1/);
  assert.match(summary, /untracked=2/);
  assert.match(summary, /hidden=3/);
  assert.match(summary, /samplesRedacted=true/);
  assert.doesNotMatch(summary, /C:\/|Users\/example|github_pat_|aaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.ok(summary.length <= 180);
});

test('generated dream-memory journals are runtime-only while other memory paths still block', () => {
  const dreamFiles = [
    '?? memory/.dreams/events.jsonl',
    '?? memory/.dreams/session-ingestion.json',
    '?? memory/dreaming/deep/2026-07-16.md',
    '?? memory/dreaming/light/2026-07-16.md',
    '?? memory/dreaming/rem/2026-07-16.md',
  ];
  const dirt = classifyDirt([...dreamFiles, '?? memory/source-contract.md']);
  assert.deepEqual(dirt.runtimeOnly, dreamFiles.map((line) => line.slice(3)));
  assert.deepEqual(dirt.untrackedSource, ['memory/source-contract.md']);
  assert.equal(dirt.blocksSync, true);
  assert.equal(
    evaluateSyncPolicy({ ...baseFacts, statusLines: dreamFiles }).classification,
    SYNC_CLASSIFICATIONS.SYNC_NO_CHANGE,
  );
  assert.deepEqual(
    DEFAULT_RUNTIME_ONLY_ALLOWLIST.filter((path) => path.startsWith('memory/')),
    ['memory/.dreams/', 'memory/dreaming/deep/', 'memory/dreaming/light/', 'memory/dreaming/rem/'],
  );
});

test('non-main branch wrong remote diverged fetch and ff-only failures block', () => {
  assert.equal(evaluateSyncPolicy({ ...baseFacts, currentBranch: 'feature' }).classification, SYNC_CLASSIFICATIONS.BLOCKED_NON_MAIN_BRANCH);
  assert.equal(evaluateSyncPolicy({ ...baseFacts, originUrl: 'https://github.com/other/repo.git' }).classification, SYNC_CLASSIFICATIONS.BLOCKED_REMOTE_MISMATCH);
  assert.equal(evaluateSyncPolicy({ ...baseFacts, remoteHead: REMOTE_HEAD, mergeBase: OTHER_HEAD }).classification, SYNC_CLASSIFICATIONS.BLOCKED_DIVERGED_HISTORY);
  assert.equal(evaluateSyncPolicy({ ...baseFacts, fetchOk: false }).classification, SYNC_CLASSIFICATIONS.BLOCKED_FETCH_FAILED);
  assert.equal(evaluateSyncPolicy({ ...baseFacts, remoteHead: REMOTE_HEAD, mergeBase: LOCAL_HEAD, mergeAttempted: true, mergeOk: false }).classification, SYNC_CLASSIFICATIONS.BLOCKED_FAST_FORWARD_FAILED);
});

test('unsafe Git operations and arbitrary shell input are rejected or absent', () => {
  assert.deepEqual(FIXED_GIT_COMMANDS.fetchOriginMain.argv, ['fetch', '--prune', 'origin', 'main']);
  assert.deepEqual(FIXED_GIT_COMMANDS.mergeFfOnlyOriginMain.argv, ['merge', '--ff-only', 'origin/main']);
  assert.throws(() => rejectArbitraryShellPlan({ command: 'git reset --hard' }), /Arbitrary shell/);
  const serialized = JSON.stringify(FIXED_GIT_COMMANDS);
  assert.doesNotMatch(serialized, /reset|clean|stash|rebase|push|checkout|branch -D|PowerShell|powershell/);
});

test('Shared Workspace records are bounded external no-shell records', () => {
  const evaluation = evaluateSyncPolicy(baseFacts);
  const heartbeat = buildSharedWorkspaceHeartbeat(evaluation, { localHead: LOCAL_HEAD, remoteHead: LOCAL_HEAD }, ['proof://head']);
  const receipt = buildSharedWorkspaceReceipt(evaluation, { localHeadBefore: LOCAL_HEAD, remoteHeadObserved: LOCAL_HEAD, localHeadAfter: LOCAL_HEAD }, []);
  assert.equal(heartbeat.workspaceLocation, 'shared-agent-workspace-external-to-repo');
  assert.equal(heartbeat.performsShellExecution, false);
  assert.equal(receipt.classification, SYNC_CLASSIFICATIONS.SYNC_NO_CHANGE);
  assert.equal(receipt.dirtClassification.pathValuesPublished, false);
  assert.equal(receipt.dirtClassification.sanitizedBlockingSamplesPublished, false);
  assert.ok(Object.isFrozen(receipt));

  const dirtyEvaluation = evaluateSyncPolicy({ ...baseFacts, statusLines: [' M scripts/ignite-stephanos-local.mjs'] });
  const dirtyHeartbeat = buildSharedWorkspaceHeartbeat(dirtyEvaluation, { localHead: LOCAL_HEAD, remoteHead: LOCAL_HEAD }, []);
  assert.equal(dirtyHeartbeat.dirtClassification.pathValuesPublished, false);
  assert.equal(dirtyHeartbeat.dirtClassification.sanitizedBlockingSamplesPublished, true);
  assert.match(dirtyHeartbeat.exactNextAction, /blockingSamples=\[tracked:scripts\/ignite-stephanos-local\.mjs\]/);
});

test('exact-head proof and named refresh registry are required before completion', () => {
  assert.deepEqual(Object.keys(POST_SYNC_REFRESH_REGISTRY).sort(), ['refresh-shared-workspace', 'refresh-ui-runtime', 'restart-approved-services', 'run-exact-head-proof'].sort());
  assert.equal(POST_SYNC_REFRESH_REGISTRY['run-exact-head-proof'].rawCommand, null);
  assert.equal(evaluateSyncPolicy({ ...baseFacts, remoteHead: REMOTE_HEAD, mergeBase: LOCAL_HEAD, applied: true, localHeadBefore: LOCAL_HEAD, localHeadAfter: REMOTE_HEAD, exactHeadProofOk: false }).classification, SYNC_CLASSIFICATIONS.BLOCKED_RUNTIME_PROOF_FAILED);
  assert.equal(evaluateSyncPolicy({ ...baseFacts, remoteHead: REMOTE_HEAD, mergeBase: LOCAL_HEAD, applied: true, localHeadBefore: LOCAL_HEAD, localHeadAfter: REMOTE_HEAD, exactHeadProofOk: true, postSyncRefreshRequired: true, postSyncRefreshOk: false }).classification, SYNC_CLASSIFICATIONS.BLOCKED_POST_SYNC_REFRESH_REQUIRED);
});
