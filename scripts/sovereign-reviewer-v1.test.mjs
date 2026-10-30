import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { resolveBattleBridgeGitExecution } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { main, persistReview, localModel, authenticatedReviewDiff } from './sovereign-reviewer-v1.mjs';

function reviewedObjects() {
  const objects = new Map();
  const put = (type, value) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const sha = createHash('sha1').update(type + ' ' + bytes.length + '\0').update(bytes).digest('hex');
    objects.set(type + ':' + sha, bytes);
    return sha;
  };
  const tree = (name, sha, mode = '100644') => put('tree', Buffer.concat([
    Buffer.from(mode + ' ' + name + '\0'), Buffer.from(sha, 'hex'),
  ]));
  const oldBlob = put('blob', 'old\n'), newBlob = put('blob', 'new\n');
  const baseTree = tree('src', tree('test.js', oldBlob), '40000');
  const headTree = tree('src', tree('test.js', newBlob), '40000');
  const base = put('commit', 'tree ' + baseTree + '\n\nbase\n');
  const head = put('commit', 'tree ' + headTree + '\nparent ' + base + '\n\nhead\n');
  const read = (type, sha) => Buffer.from(objects.get(type + ':' + sha));
  return { objects, put, tree, base, head, oldBlob, newBlob, read };
}

test('review diff is derived from authenticated committed buffers, never Git diff', () => {
  const f = reviewedObjects();
  const result = authenticatedReviewDiff(f.base, f.head, f.read);
  assert.deepEqual(result.changedFiles, ['src/test.js']);
  assert.match(result.diff, /@@ -1,1 \+1,1 @@\n-old\n\+new\n/);
});

test('review input rejects substituted base/head blobs and trees under their original object names', () => {
  for (const kind of ['oldBlob', 'newBlob', 'tree', 'commit']) {
    const f = reviewedObjects();
    const target = kind === 'tree' ? [...f.objects.keys()].find(k => k.startsWith('tree:'))
      : kind === 'commit' ? 'commit:' + f.head : 'blob:' + f[kind];
    const original = f.objects.get(target);
    f.objects.set(target, Buffer.concat([original, Buffer.from('substitution')]));
    assert.throws(() => authenticatedReviewDiff(f.base, f.head, f.read), /REVIEW_OBJECT_HASH_MISMATCH/);
  }
});

test('object replacement after capture cannot change the model diff', () => {
  const f = reviewedObjects();
  const result = authenticatedReviewDiff(f.base, f.head, (type, sha) => {
    const captured = f.read(type, sha);
    if (type === 'blob') f.objects.set(type + ':' + sha, Buffer.from('forged restored-object race\n'));
    return captured;
  });
  assert.match(result.diff, /-old\n\+new\n/);
  assert.doesNotMatch(result.diff, /forged/);
});

test('real Git loose-object substitution cannot enter the reviewed diff', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewed-objects-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const execution = resolveBattleBridgeGitExecution({ platform: process.platform, environment: process.env });
  const run = args => {
    const result = spawnSync(execution.executable, [...execution.fixedConfigArgs, '-C', root, ...args], {
      env: execution.environment, shell: false, windowsHide: true, timeout: 12000,
    });
    assert.equal(result.status, 0, String(result.stderr));
    return result.stdout;
  };
  run(['init', '--bare']);
  const f = reviewedObjects();
  const objectPath = sha => path.join(root, 'objects', sha.slice(0, 2), sha.slice(2));
  const encode = (type, bytes) => deflateSync(Buffer.concat([Buffer.from(type + ' ' + bytes.length + '\0'), bytes]));
  for (const [key, bytes] of f.objects) {
    const [type, sha] = key.split(':');
    fs.mkdirSync(path.dirname(objectPath(sha)), { recursive: true });
    fs.writeFileSync(objectPath(sha), encode(type, bytes));
  }
  const read = (type, sha) => run(['cat-file', type, sha]);
  assert.match(authenticatedReviewDiff(f.base, f.head, read).diff, /-old\n\+new\n/);
  for (const sha of [f.oldBlob, f.newBlob]) {
    const saved = fs.readFileSync(objectPath(sha));
    try {
      const forged = Buffer.from('forged object bytes under original pathname\n');
      fs.writeFileSync(objectPath(sha), encode('blob', forged));
      assert.deepEqual(read('blob', sha), forged, 'ordinary Git reads the substituted loose bytes');
      assert.throws(() => authenticatedReviewDiff(f.base, f.head, read), /REVIEW_OBJECT_HASH_MISMATCH/);
    } finally { fs.writeFileSync(objectPath(sha), saved); }
  }
});

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
      assert.equal(result.candidateEvidence.baseSha, 'b'.repeat(40),
        'the persisted candidate must carry the exact reviewed base');
      assert.equal(result.mergeAuthority, false);
      published = true;
    },
  });
  assert.equal(result.status, 'LOCAL_REVIEW_EVIDENCE_READY');
  assert.equal(published, true);
});

test('trusted Git boundary ignores hostile PATH and Git overrides', async () => {
  const calls = [];
  const fixture = reviewedObjects();
  const outputs = [fixture.head, 'goal/review', '', fixture.base, ''];
  const result = await main({
    PATH: '/attacker', GIT_EXEC_PATH: '/attacker', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: '/attacker', STEPHANOS_REVIEW_EXACT_HEAD: fixture.head, STEPHANOS_REVIEW_EXACT_BASE: fixture.base,
    STEPHANOS_REVIEW_EXACT_BRANCH: 'goal/review', STEPHANOS_REVIEW_REPOSITORY: 'owner/repo', STEPHANOS_REVIEW_ISSUE: '1',
    STEPHANOS_REVIEW_PR: '3005', STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER: 'builder', STEPHANOS_REVIEW_IMPLEMENTER_SESSION: 'build-1',
    STEPHANOS_REVIEW_SESSION: 'review-2',
  }, {
    platform: 'linux', environment: { PATH: '/attacker', GIT_EXEC_PATH: '/attacker', GIT_CONFIG_COUNT: '99' },
    spawn: (executable, args, options) => {
      calls.push({ executable, args, env: options.env });
      const index = args.indexOf('cat-file');
      return { status: 0, stdout: index < 0 ? outputs.shift() : fixture.read(args[index + 1], args[index + 2]) };
    },
    invokeModel: async () => JSON.stringify({ verdict: 'clean', reviewedPaths: ['src/test.js'], findings: [] }), persist: () => true,
  });
  assert.equal(result.status, 'LOCAL_REVIEW_EVIDENCE_READY');
  assert.equal(calls.every(call => call.executable === '/usr/bin/git'), true);
  assert.equal(calls.every(call => call.env.PATH === '/usr/bin:/bin' && call.env.GIT_EXEC_PATH === undefined), true);
  assert.equal(calls.every(call => call.env.GIT_CONFIG_COUNT !== '99' && call.args.includes('core.fsmonitor=false')), true);
  assert.equal(calls.some(call => call.args.includes('diff')), false);
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

test('localModel uses fixed localhost, digest pin, gaming guard, redirect denial and unload', async () => {
  const calls = [], pin = 'a'.repeat(64), guard = [], clear = [];
  const deps = {
    platform: 'linux',
    gamingGuard: () => { guard.push(true); return { ok: true }; },
    modelPin: async () => ({ ok: true, digest: pin }),
    startPolling: callback => callback,
    stopPolling: token => clear.push(token),
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, text: async () => JSON.stringify({
        model: 'sha256:' + pin, done: true, done_reason: 'stop',
        response: JSON.stringify({ verdict: 'clean', reviewedPaths: [], findings: [] }),
      }) };
    },
  };
  const result = await localModel('sensitive review diff', {}, deps);
  assert.match(result, /"verdict":"clean"/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:11434/api/generate');
  assert.equal(calls[0].opts.redirect, 'error');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(JSON.parse(calls[0].opts.body).keep_alive, 0);
  assert.equal(JSON.parse(calls[0].opts.body).model, 'sha256:' + pin,
    'the actual private prompt MUST use an immutable digest, never a mutable tag');
  assert.ok(guard.length >= 4, 'resource state must be rechecked around inference');
  assert.equal(clear.length, 1, 'inference governor monitor is always cleared');
});

test('localModel refuses gaming, tag replacement, redirected results, and aborts during gaming', async () => {
  const good = 'b'.repeat(64);
  const ready = { platform: 'linux', gamingGuard: () => ({ ok: true }),
    modelPin: async () => ({ ok: true, digest: good }),
    startPolling: fn => fn, stopPolling: () => {} };
  let invoked = false;
  await assert.rejects(localModel('private', {}, { ...ready,
    gamingGuard: () => ({ ok: false }), fetchImpl: () => { invoked = true; },
  }), /LOCAL_REVIEW_GAMING_RESOURCE_PROTECTED/);
  assert.equal(invoked, false, 'gaming denial must precede any private diff upload');
  let pinCall = 0;
  await assert.rejects(localModel('private', {}, { ...ready,
    modelPin: async () => ({ ok: true, digest: (++pinCall === 1 ? good : 'c'.repeat(64)) }),
    fetchImpl: () => { invoked = true; },
  }), /LOCAL_REVIEW_MODEL_DIGEST_CHANGED/);
  assert.equal(invoked, false, 'digest substitution must fail before generation');
  await assert.rejects(localModel('private', {}, { ...ready,
    fetchImpl: async () => { throw Error('fetch failed on redirect'); },
  }), /fetch failed on redirect/);
  let monitor;
  await assert.rejects(localModel('private', {}, { ...ready,
    startPolling: fn => { monitor = fn; return 1; },
    gamingGuard: (() => { let calls = 0; return () => ({ ok: ++calls < 3 }); })(),
    fetchImpl: async (_url, opts) => {
      monitor();
      assert.equal(opts.signal.aborted, true);
      return { ok: true, text: async () => JSON.stringify({
        model: 'qwen:14b', done: true, done_reason: 'stop', response: '{}',
      }) };
    },
  }), /LOCAL_REVIEW_GAMING_RESOURCE_PROTECTED/);
  await assert.rejects(localModel('private', {}, { ...ready,
    fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify({
      model: 'wrong-model', done: true, done_reason: 'stop', response: '{}',
    }) }),
  }), /LOCAL_MODEL_COMPLETION_IDENTITY_UNPROVEN/);
  await assert.rejects(localModel('private', {}, { ...ready,
    fetchImpl: async (_url, options) => {
      assert.equal(JSON.parse(options.body).model, 'sha256:' + good,
        'tag replacement immediately before generation cannot change requested weights');
      return { ok: true, text: async () => JSON.stringify({
        model: 'qwen:14b', done: true, done_reason: 'stop', response: '{}',
      }) };
    },
  }), /LOCAL_MODEL_COMPLETION_IDENTITY_UNPROVEN/,
    'older Ollama runtimes reporting only mutable tag must fail closed');
  await assert.rejects(localModel('private', {}, { ...ready,
    fetchImpl: async (_url, options) => {
      assert.equal(JSON.parse(options.body).model, 'sha256:' + good);
      return { ok: false, status: 404, text: async () => 'model digest not supported' };
    },
  }), /LOCAL_MODEL_REQUEST_FAILED/,
    'older Ollama builds lacking immutable digest addressing MUST NOT fall back to mutable tag');
});
