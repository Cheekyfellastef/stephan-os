import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, persistReview } from './sovereign-reviewer-v1.mjs';

const candidate = (timestampUtc = '2026-10-10T14:00:00.000Z', sourceHead = 'a'.repeat(40)) => ({
  status: 'LOCAL_REVIEW_EVIDENCE_READY', proofRef: `proofs/sovereign-review-pr-3005-${sourceHead.slice(0, 12)}.json`,
  candidateEvidence: { prNumber: 3005, sourceHead, timestampUtc, verdict: 'clean' }, mergeAuthority: false,
});

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-reviewer-'));
  fs.mkdirSync(path.join(root, 'status'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('runner publishes only a candidate proof, with no GitHub, merge or deployment authority', async () => {
  let published = false;
  const result = await main({ STEPHANOS_REVIEW_PR: '3005' }, {
    snapshot: () => ({
      repository: 'Cheekyfellastef/stephan-os', issueNumber: 1574, prNumber: 3005,
      branch: 'goal/1574-sovereign-reviewer-local-v1',
      sourceHead: 'a'.repeat(40), baseSha: 'b'.repeat(40),
      changedFiles: ['src/test.js'],
      diff: 'diff --git a/src/test.js b/src/test.js\n-old\n+new\n',
      implementerProvider: 'github-builder', implementerSessionId: 'builder-1',
      reviewerSessionId: 'reviewer-2', modelClass: 'qwen-14b',
      timestampUtc: '2026-10-10T14:00:00.000Z',
    }),
    invokeModel: async () => JSON.stringify({ verdict: 'clean', reviewedPaths: ['src/test.js'], findings: [] }),
    persist: result => {
      assert.equal(result.qualification, 'PENDING_INDEPENDENT_ATTESTATION');
      assert.equal(result.mergeAuthority, false);
      published = true;
    },
  });
  assert.equal(result.status, 'LOCAL_REVIEW_EVIDENCE_READY');
  assert.equal(published, true);
});

test('trusted Git boundary ignores hostile PATH and Git overrides', async () => {
  const calls = [];
  const outputs = ['a'.repeat(40), 'goal/review', '', 'b'.repeat(40), '', 'src/test.js', 'diff --git a/src/test.js b/src/test.js\n-old\n+new\n'];
  const result = await main({
    PATH: '/attacker', GIT_EXEC_PATH: '/attacker', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: '/attacker', STEPHANOS_REVIEW_EXACT_HEAD: 'a'.repeat(40), STEPHANOS_REVIEW_EXACT_BASE: 'b'.repeat(40),
    STEPHANOS_REVIEW_EXACT_BRANCH: 'goal/review', STEPHANOS_REVIEW_REPOSITORY: 'owner/repo', STEPHANOS_REVIEW_ISSUE: '1',
    STEPHANOS_REVIEW_PR: '3005', STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER: 'builder', STEPHANOS_REVIEW_IMPLEMENTER_SESSION: 'build-1',
    STEPHANOS_REVIEW_SESSION: 'review-2',
  }, {
    platform: 'linux', environment: { PATH: '/attacker', GIT_EXEC_PATH: '/attacker', GIT_CONFIG_COUNT: '99' },
    spawn: (executable, args, options) => { calls.push({ executable, args, env: options.env }); return { status: 0, stdout: outputs.shift() }; },
    invokeModel: async () => JSON.stringify({ verdict: 'clean', reviewedPaths: ['src/test.js'], findings: [] }), persist: () => true,
  });
  assert.equal(result.status, 'LOCAL_REVIEW_EVIDENCE_READY');
  assert.equal(calls.every(call => call.executable === '/usr/bin/git'), true);
  assert.equal(calls.every(call => call.env.PATH === '/usr/bin:/bin' && call.env.GIT_EXEC_PATH === undefined), true);
  assert.equal(calls.every(call => call.env.GIT_CONFIG_COUNT !== '99' && call.args.includes('core.fsmonitor=false')), true);
});

test('publication rejects linked workspace ancestors', (t) => {
  const root = workspace(t);
  const linked = `${root}-linked`;
  fs.symlinkSync(root, linked, process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => fs.rmSync(linked, { force: true }));
  assert.throws(() => persistReview(candidate(), { STEPHANOS_SHARED_AGENT_WORKSPACE: linked, STEPHANOS_REVIEW_PR: '3005' }), /SHARED_WORKSPACE_LINKED_PATH/);
});

test('proof publication is immutable and rejects replay', (t) => {
  const root = workspace(t);
  const env = { STEPHANOS_SHARED_AGENT_WORKSPACE: root, STEPHANOS_REVIEW_PR: '3005' };
  assert.equal(persistReview(candidate(), env), true);
  assert.throws(() => persistReview(candidate('2026-10-10T15:00:00.000Z'), env), error => error.code === 'EEXIST');
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(root, candidate().proofRef), 'utf8')));
});

test('older overlapping review cannot replace current status', (t) => {
  const root = workspace(t);
  const env = { STEPHANOS_SHARED_AGENT_WORKSPACE: root, STEPHANOS_REVIEW_PR: '3005' };
  const newer = candidate('2026-10-10T15:00:00.000Z', 'c'.repeat(40));
  const older = candidate('2026-10-10T14:00:00.000Z', 'd'.repeat(40));
  persistReview(newer, env);
  assert.throws(() => persistReview(older, env), /STALE_REVIEW_STATUS/);
  const status = JSON.parse(fs.readFileSync(path.join(root, 'status', 'sovereign-review-pr-3005.json'), 'utf8'));
  assert.equal(status.sourceHead, newer.candidateEvidence.sourceHead);
});
test('stable proof handle fails closed when proofs is substituted before the raw write', (t) => {
  const root = workspace(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-reviewer-outside-'));
  const detached = `${root}-detached-proofs`;
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  t.after(() => fs.rmSync(detached, { recursive: true, force: true }));
  assert.throws(() => persistReview(candidate(), {
    STEPHANOS_SHARED_AGENT_WORKSPACE: root, STEPHANOS_REVIEW_PR: '3005',
  }, { beforeStableOperation(operation) {
    if (operation !== 'proof-temp-open') return;
    fs.renameSync(path.join(root, 'proofs'), detached);
    fs.symlinkSync(outside, path.join(root, 'proofs'), process.platform === 'win32' ? 'junction' : 'dir');
  } }), /SHARED_WORKSPACE_DIRECTORY_REPLACED/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('stable status and lock handles reject substitution without outside writes or cleanup', (t) => {
  const root = workspace(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-reviewer-outside-'));
  const detached = `${root}-detached-status`;
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  t.after(() => fs.rmSync(detached, { recursive: true, force: true }));
  assert.throws(() => persistReview(candidate(), {
    STEPHANOS_SHARED_AGENT_WORKSPACE: root, STEPHANOS_REVIEW_PR: '3005',
  }, { beforeStableOperation(operation) {
    if (operation !== 'status-temp-open') return;
    fs.renameSync(path.join(root, 'status'), detached);
    fs.symlinkSync(outside, path.join(root, 'status'), process.platform === 'win32' ? 'junction' : 'dir');
  } }), /SHARED_WORKSPACE_DIRECTORY_REPLACED/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('lock cleanup refuses to remove a substituted lock owned by another participant', (t) => {
  const root = workspace(t);
  const lockName = 'sovereign-review-pr-3005.json.lock';
  const displaced = path.join(root, 'status', `${lockName}.displaced`);
  assert.throws(() => persistReview(candidate(), {
    STEPHANOS_SHARED_AGENT_WORKSPACE: root, STEPHANOS_REVIEW_PR: '3005',
  }, { beforeStableOperation(operation) {
    if (operation !== 'status-lock-cleanup') return;
    fs.renameSync(path.join(root, 'status', lockName), displaced);
    fs.mkdirSync(path.join(root, 'status', lockName));
  } }), /SHARED_WORKSPACE_LOCK_REPLACED/);
  assert.equal(fs.statSync(path.join(root, 'status', lockName)).isDirectory(), true);
});

test('older held result retains capture head and time and cannot supersede a newer review', (t) => {
  const root = workspace(t);
  const env = { STEPHANOS_SHARED_AGENT_WORKSPACE: root, STEPHANOS_REVIEW_PR: '3005' };
  persistReview(candidate('2026-10-10T15:00:00.000Z', 'c'.repeat(40)), env);
  const held = {
    status: 'SOVEREIGN_REVIEW_HELD', reason: 'LOCAL_MODEL_UNAVAILABLE', mergeAuthority: false,
    reviewObservation: {
      capturedAtUtc: '2026-10-10T14:00:00.000Z', sourceHead: 'd'.repeat(40), requestedSourceHead: 'd'.repeat(40),
    },
  };
  assert.throws(() => persistReview(held, env), /STALE_REVIEW_STATUS/);
  const status = JSON.parse(fs.readFileSync(path.join(root, 'status', 'sovereign-review-pr-3005.json'), 'utf8'));
  assert.equal(status.sourceHead, 'c'.repeat(40));
});

test('capture errors preserve requested identity separately and never claim an observed head', async () => {
  let published;
  const requested = 'e'.repeat(40);
  await main({ STEPHANOS_REVIEW_PR: '3005', STEPHANOS_REVIEW_EXACT_HEAD: requested }, {
    snapshot: () => { throw new Error('LOCAL_GIT_PROOF_UNAVAILABLE'); },
    persist: result => { published = result; },
  });
  assert.equal(published.reviewObservation.sourceHead, '');
  assert.equal(published.reviewObservation.requestedSourceHead, requested);
  assert.equal(Number.isFinite(Date.parse(published.reviewObservation.capturedAtUtc)), true);
});

test('publication fails closed where no admitted stable directory writer exists', (t) => {
  const root = workspace(t);
  assert.throws(() => persistReview(candidate(), {
    STEPHANOS_SHARED_AGENT_WORKSPACE: root, STEPHANOS_REVIEW_PR: '3005',
  }, { platform: 'win32' }), /STABLE_WORKSPACE_WRITER_UNAVAILABLE/);
});
test('offline local model is held and still published as a blocked status, never clean', async () => {
  let published;
  const result = await main({ STEPHANOS_REVIEW_PR: '3005' }, {
    snapshot: () => { throw new Error('REVIEW_WORKTREE_NOT_CLEAN'); },
    persist: data => { published = data; },
  });
  assert.equal(result.status, 'SOVEREIGN_REVIEW_HELD');
  assert.equal(published.reason, 'REVIEW_WORKTREE_NOT_CLEAN');
  assert.equal(result.mergeAuthority, false);
});
