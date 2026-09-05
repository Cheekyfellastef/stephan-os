import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_SYNC_CONTRACT,
  DEFAULT_RUNTIME_ONLY_ALLOWLIST,
  FIXED_GIT_COMMANDS,
  POST_SYNC_REFRESH_REGISTRY,
  SYNC_CLASSIFICATIONS,
  buildRemoteDirtBlockerSummary,
  buildSharedWorkspaceHeartbeat,
  buildSharedWorkspaceReceipt,
  classifyDirt,
  evaluateSyncPolicy,
  rejectArbitraryShellPlan,
} from './battle-bridge-github-sync-policy.mjs';

const LOCAL_HEAD = 'a'.repeat(40);
const REMOTE_HEAD = 'b'.repeat(40);
const OTHER_HEAD = 'c'.repeat(40);
const WRONG_BEFORE_HEAD = 'd'.repeat(40);

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
