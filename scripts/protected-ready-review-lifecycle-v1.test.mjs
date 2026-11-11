import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import {
  prepareReadyReviewProducer, finishReadyReviewProducer, dispatchReadyReview,
  prepareReadyReview, executeReadyReview, loadProtectedReadyReviewLifecycle, readReadyReviewCollection,
  prepareReadyReviewRecovery, executeReadyReviewRecovery,
  loadReadyReviewHandoff, readReadyReviewUnresolvedThreads, readyReviewTransports,
  readReadyReviewInput,
} from './protected-ready-review-lifecycle-v1.mjs';
import { validateProtectedReadyReviewLifecycleEvidence, parseReadyReviewInputs,
  sealReadyReviewPayload, hasReadyReviewSelection,
  READY_REVIEW_HANDOFF_FILE, READY_REVIEW_RECEIPT_FILE } from '../shared/agents/protectedReadyReviewLifecycleV1.mjs';
import { readyLifecycleFixture, fixtureEnv, fixtureTransport, fixtureThreadPage,
  readyRecoveryFixture, fixtureRecoveryTransport, fixtureArtifact, clock } from '../shared/agents/fixtures/protectedReadyReviewLifecycleV1.fixture.mjs';

function active(run) { run.status = 'in_progress'; run.conclusion = null; }
function activeJob(job) { active(job); job.completed_at = null; }
function deps(f, role) { return { ...fixtureTransport(f), env: fixtureEnv(f, role), sourceSha: f.identity.baseSha }; }
function prepareActive(f) {
  active(f.proof.handoff.run); activeJob(f.proof.handoff.dispatchJob);
  active(f.proof.review.run); activeJob(f.proof.review.job);
}

const diffType = 'application/vnd.github.v3.diff; charset=utf-8';
const textDiff = path => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`;
function inputReaderFixture(files, patch) {
  const f = readyLifecycleFixture(), d = fixtureTransport(f), originalApi = d.api;
  f.state.pull.draft = true; f.state.pull.changed_files = files.length;
  const api = async path => {
    const page = path.match(/^\/pulls\/2094\/files\?per_page=100&page=([1-9][0-9]*)$/);
    return page ? files.slice((Number(page[1]) - 1) * 100, Number(page[1]) * 100) : originalApi(path);
  };
  return { f, d, api, readPatch: async () => patch, expectedDraft: true };
}

test('preflight reads a complete multi-page file estate and parses every unchanged Git hunk', async () => {
  const files = Array.from({ length: 101 }, (_, index) => ({ filename: `src/file-${index}.mjs`, additions: 1, deletions: 1 }));
  const patch = files.map(file => textDiff(file.filename)).join('');
  const f = inputReaderFixture(files, patch), pages = [];
  const input = await readReadyReviewInput(f.f.identity, { ...f, api: async path => {
    if (path.includes('/files?')) pages.push(path);
    return f.api(path);
  } });
  assert.deepEqual(input.changedFiles, files.map(file => file.filename));
  assert.equal(input.patch, patch);
  assert.deepEqual(pages, ['/pulls/2094/files?per_page=100&page=1', '/pulls/2094/files?per_page=100&page=2']);
});

test('Git parser preserves ordinary spaces, Unicode, rename, binary and mode-only file identities', async () => {
  const files = [
    { filename: 'a name.txt', additions: 1, deletions: 1 },
    { filename: 'é.txt', additions: 1, deletions: 1 },
    { filename: 'new.txt', previous_filename: 'old.txt', status: 'renamed', additions: 0, deletions: 0 },
    { filename: 'image.png', additions: 0, deletions: 0 },
    { filename: 'script.sh', additions: 0, deletions: 0 },
  ];
  const patch = textDiff('a name.txt') + textDiff('é.txt')
    + 'diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n'
    + 'diff --git a/image.png b/image.png\nindex 1111111..2222222 100644\nBinary files a/image.png and b/image.png differ\n'
    + 'diff --git a/script.sh b/script.sh\nold mode 100644\nnew mode 100755\n';
  const f = inputReaderFixture(files, patch);
  assert.deepEqual((await readReadyReviewInput(f.f.identity, f)).changedFiles, files.map(file => file.filename));
});

test('complete-looking HTTP200 cannot conceal a truncated hunk or a different file/stat estate', async t => {
  const patch = textDiff('src/a.mjs');
  for (const [name, body, rows] of [
    ['truncated final hunk', patch.replace('+new\n', ''), [{ filename: 'src/a.mjs', additions: 1, deletions: 1 }]],
    ['changed hunk count', patch.replace('@@ -1 +1 @@', '@@ -1 +1,0 @@').replace('+new\n', ''), [{ filename: 'src/a.mjs', additions: 1, deletions: 1 }]],
    ['foreign path', textDiff('src/other.mjs'), [{ filename: 'src/a.mjs', additions: 1, deletions: 1 }]],
    ['duplicate path', patch + patch, [{ filename: 'src/a.mjs', additions: 2, deletions: 2 }]],
    ['wrong additions', patch, [{ filename: 'src/a.mjs', additions: 2, deletions: 1 }]],
    ['missing statistics', patch, [{ filename: 'src/a.mjs' }]],
  ]) await t.test(name, async st => {
    const f = inputReaderFixture(rows, body);
    st.mock.method(globalThis, 'fetch', async () => new Response(body, {
      headers: { 'Content-Type': diffType, 'Content-Length': String(Buffer.byteLength(body)) },
    }));
    await assert.rejects(readReadyReviewInput(f.f.identity, { ...f,
      readPatch: readyReviewTransports({ GH_TOKEN: 'unit-test-token' }).readPatch }), /PREFLIGHT_(PATCH|FILE)_/);
  });
});

test('input read refuses incomplete pages and identity, count or draft drift', async t => {
  for (const attack of ['missing row', 'duplicate row', 'missing count', 'excess count', 'draft drift', 'head drift', 'tree drift', 'base drift', 'count drift']) {
    await t.test(attack, async () => {
      const rows = [{ filename: 'a.txt', additions: 1, deletions: 1 }];
      const f = inputReaderFixture(rows, textDiff('a.txt'));
      let api = f.api, readPatch = f.readPatch;
      if (attack === 'missing row') f.f.state.pull.changed_files = 2;
      if (attack === 'duplicate row') { rows.push(rows[0]); f.f.state.pull.changed_files = 2; }
      if (attack === 'missing count') delete f.f.state.pull.changed_files;
      if (attack === 'excess count') f.f.state.pull.changed_files = 601;
      if (attack.endsWith('drift')) readPatch = async () => {
        if (attack === 'draft drift') f.f.state.pull.draft = false;
        if (attack === 'head drift') f.f.state.pull.head.sha = 'e'.repeat(40);
        if (attack === 'tree drift') f.f.state.commit.tree.sha = 'e'.repeat(40);
        if (attack === 'base drift') f.f.state.main.object.sha = 'e'.repeat(40);
        if (attack === 'count drift') f.f.state.pull.changed_files++;
        return f.readPatch();
      };
      await assert.rejects(readReadyReviewInput(f.f.identity, { ...f, api, readPatch }), /PROTECTED_READY_REVIEW_BLOCKED/);
    });
  }
});

test('fixed diff transport proves identity-encoded bytes and refuses partial or unbounded responses', async t => {
  const patch = textDiff('src/a.mjs'), bytes = Buffer.from(patch), requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return new Response(bytes, { headers: { 'Content-Type': diffType, 'Content-Length': String(bytes.length) } });
  });
  const transport = readyReviewTransports({ GH_TOKEN: 'unit-test-token' });
  assert.equal(await transport.readPatch(2094), patch);
  assert.equal(requests[0].url, 'https://api.github.com/repos/Cheekyfellastef/stephan-os/pulls/2094');
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(requests[0].options.headers['Accept-Encoding'], 'identity');
  assert.ok(requests[0].options.signal instanceof AbortSignal);
  for (const [name, status, headers, body] of [
    ['206', 206, {}, bytes],
    ['ranged200', 200, { 'Content-Range': 'bytes 0-99/4000' }, bytes],
    ['empty range', 200, { 'Content-Range': '' }, bytes],
    ['wrong type', 200, { 'Content-Type': 'text/html' }, bytes],
    ['encoded', 200, { 'Content-Encoding': 'gzip' }, bytes],
    ['short body', 200, { 'Content-Length': String(bytes.length + 1) }, bytes],
    ['extra body', 200, { 'Content-Length': String(bytes.length - 1) }, bytes],
    ['oversized declaration', 200, { 'Content-Length': '2000001' }, bytes],
    ['malformed declaration', 200, { 'Content-Length': '1e6' }, bytes],
    ['invalid UTF-8', 200, {}, Buffer.from([0xff])],
  ]) await t.test(name, async st => {
    st.mock.method(globalThis, 'fetch', async () => new Response(body, { status, headers: { 'Content-Type': diffType, ...headers } }));
    await assert.rejects(readyReviewTransports({ GH_TOKEN: 'unit-test-token' }).readPatch(2094));
  });
});

test('streaming diff transport preserves split UTF-8 and rejects oversized or interrupted prefixes', async t => {
  const patch = textDiff('é.txt'), bytes = Buffer.from(patch);
  const streamResponse = body => ({ status: 200, headers: new Headers({ 'Content-Type': diffType }), body });
  t.mock.method(globalThis, 'fetch', async () => streamResponse((async function* () {
    for (let offset = 0; offset < bytes.length; offset++) yield bytes.subarray(offset, offset + 1);
  })()));
  assert.equal(await readyReviewTransports({ GH_TOKEN: 'unit-test-token' }).readPatch(2094), patch);
  await t.test('byte cap stops the stream', async st => {
    let after = false, closed = false;
    st.mock.method(globalThis, 'fetch', async () => streamResponse((async function* () {
      try { yield new Uint8Array(2_000_001); after = true; } finally { closed = true; }
    })()));
    await assert.rejects(readyReviewTransports({ GH_TOKEN: 'unit-test-token' }).readPatch(2094), /PATCH_TOO_LARGE/);
    assert.equal(after, false); assert.equal(closed, true);
  });
  await t.test('interrupted prefix is never returned', async st => {
    st.mock.method(globalThis, 'fetch', async () => streamResponse((async function* () {
      yield bytes.subarray(0, 20); throw Error('interrupted diff stream');
    })()));
    await assert.rejects(readyReviewTransports({ GH_TOKEN: 'unit-test-token' }).readPatch(2094), /interrupted diff stream/);
  });
});

test('one actual fetch deadline covers both waiting for headers and a stalled response body', async t => {
  const fetchNative = globalThis.fetch, timeoutNative = AbortSignal.timeout.bind(AbortSignal);
  for (const stage of ['headers', 'body']) await t.test(stage, async st => {
    const server = createServer((_request, response) => {
      if (stage === 'body') { response.writeHead(200, { 'Content-Type': diffType }); response.write('diff --git '); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    st.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    st.mock.method(AbortSignal, 'timeout', duration => { assert.equal(duration, 30_000); return timeoutNative(30); });
    st.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(url, 'https://api.github.com/repos/Cheekyfellastef/stephan-os/pulls/2094');
      return fetchNative(`http://127.0.0.1:${server.address().port}/diff`, options);
    });
    await assert.rejects(readyReviewTransports({ GH_TOKEN: 'unit-test-token' }).readPatch(2094),
      error => /abort|timeout/i.test(`${error.name} ${error.message}`));
  });
});

test('a new unresolved thread during owner reread blocks the final producer snapshot', async () => {
  const f = readyLifecycleFixture(); active(f.proof.handoff.run); f.state.pull.draft = true;
  const d = deps(f, 'dispatch'), api = d.api; let owners = 0, newThread = false, threadReads = 0;
  d.api = async path => { if (path === '/issues/comments/900' && ++owners === 2) newThread = true; return api(path); };
  d.readThreadsPage = async () => { threadReads++; return fixtureThreadPage(f,
    newThread ? { nodes: [{ id: 'new-after-owner', isResolved: false }] } : {}); };
  await assert.rejects(prepareReadyReviewProducer({ command: f.command, comment: f.proof.handoff.ownerComment,
    ...d, now: () => clock(5) }), /REVIEW_NOT_CLEAN/);
  assert.equal(owners, 2); assert.equal(threadReads, 1);
});

test('a new thread during diff preflight still blocks and the final thread read cannot renew owner expiry', async () => {
  for (const attack of ['thread during diff', 'expiry during final threads']) {
    const f = readyLifecycleFixture(); active(f.proof.handoff.run); f.state.pull.draft = true;
    const d = deps(f, 'dispatch'); let newThread = false, current = clock(5);
    d.readExactHeadInput = async () => { if (attack === 'thread during diff') newThread = true; return f.input; };
    d.readThreadsPage = async () => {
      if (attack === 'expiry during final threads') current = clock(301);
      return fixtureThreadPage(f, newThread ? { nodes: [{ id: 'new-during-diff', isResolved: false }] } : {});
    };
    await assert.rejects(prepareReadyReviewProducer({ command: f.command, comment: f.proof.handoff.ownerComment,
      ...d, now: () => current }), /REVIEW_NOT_CLEAN|EXPIRED/);
  }
});

test('sole review dispatch repeats qualification and sees a concurrent launch after preflight', async t => {
  for (const attack of ['missing qualification', 'missing reader', 'concurrent launch']) await t.test(attack, async () => {
    const f = readyLifecycleFixture({ engineFindings: attack === 'missing qualification' });
    active(f.proof.handoff.run); activeJob(f.proof.handoff.dispatchJob);
    const d = deps(f, 'review-ready'); d.inventory.runs = []; let posts = 0;
    if (attack === 'missing qualification') f.proof.escalationComment = null;
    if (attack === 'missing reader') delete d.readExactHeadInput;
    if (attack === 'concurrent launch') d.readExactHeadInput = async () => { d.inventory.runs = [f.proof.review.run]; return f.input; };
    await assert.rejects(dispatchReadyReview({ inputs: f.inputs, ...d, now: () => clock(15),
      dispatch: async () => { posts++; d.inventory.runs = [f.proof.review.run]; } }),
    /OWNER_COMMENT_ABSENT|PREFLIGHT_ENGINE_INPUT_READER_UNAVAILABLE|REVIEW_ALREADY_DISPATCHED/);
    assert.equal(posts, 0);
  });
});

test('the actual mailbox READY branch completes target and rotation reads before its final producer', async t => {
  // Execute the exact existing branch with fixed synthetic dependencies, not a
  // second implementation of its ordering. All mutation callbacks stay local.
  const source = readFileSync(new URL('./dispatch-protected-merge-from-mailbox.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('  if (command.operation === PROTECTED_WORKFLOW_READY_OPERATION) {');
  const end = source.indexOf('  if (command.operation === PROTECTED_WORKFLOW_DISPATCH_OPERATION) {', start);
  assert.ok(start >= 0 && end > start);
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = new AsyncFunction('d', `const {command,event,PROTECTED_WORKFLOW_READY_OPERATION,hasReadyReviewSelection,
    readyReviewTransports,prepareReadyReviewProducer,readExactState,fail,assertMailboxRotationWorkflowAdmission,
    graphqlReady,postReceipt,finishReadyReviewProducer,console}=d;\n${source.slice(start, end)}`);
  for (const attack of ['none', 'thread during target', 'thread during rotation', 'expiry during rotation',
    'draft changes during rotation', 'rotation failure', 'already ready', 'legacy']) await t.test(attack, async () => {
    const f = readyLifecycleFixture({ alreadyReady: attack === 'already ready' });
    active(f.proof.handoff.run); f.state.pull.draft = attack !== 'already ready';
    const d = deps(f, 'dispatch'); let newThread = false, current = clock(5), reads = 0, posts = 0, producers = 0, fences = 0;
    d.readThreadsPage = async () => fixtureThreadPage(f, newThread ? { nodes: [{ id: 'late-caller-thread', isResolved: false }] } : {});
    const command = { ...f.command };
    if (attack === 'legacy') for (const key of Object.keys(command)) if (key.startsWith('independentReview')) delete command[key];
    const promise = run({ command, event: { comment: f.proof.handoff.ownerComment },
      PROTECTED_WORKFLOW_READY_OPERATION: command.operation, hasReadyReviewSelection,
      readyReviewTransports: () => d,
      prepareReadyReviewProducer: args => { producers++; return prepareReadyReviewProducer({ ...args,
        env: d.env, sourceSha: d.sourceSha, now: () => current }); },
      readExactState: async () => { reads++; if (reads === 1 && attack === 'thread during target') newThread = true;
        return { pull: structuredClone(f.state.pull) }; },
      assertMailboxRotationWorkflowAdmission: async () => { fences++;
        if (attack === 'thread during rotation') newThread = true;
        if (attack === 'expiry during rotation') current = clock(301);
        if (attack === 'draft changes during rotation') f.state.pull.draft = false;
        if (attack === 'rotation failure') throw Error('rotation refused'); },
      graphqlReady: async () => { posts++; f.state.pull.draft = false;
        return { number: f.identity.prNumber, headRefOid: f.identity.sourceHead, isDraft: false }; },
      fail: message => { throw Error(message); }, postReceipt: async () => ({}), finishReadyReviewProducer: async () => {},
      console: { log() {} },
    });
    if (['none', 'already ready', 'legacy'].includes(attack)) {
      await promise; assert.equal(posts, attack === 'already ready' ? 0 : 1);
      assert.equal(producers, attack === 'legacy' ? 0 : 1); assert.equal(fences, attack === 'already ready' ? 0 : 1);
    } else { await assert.rejects(promise, /REVIEW_NOT_CLEAN|EXPIRED|DRAFT_STATE_CHANGED|rotation refused/); assert.equal(posts, 0); }
  });
});

test('loads complete real-shaped GitHub evidence and keeps the base-headed review separate', async () => {
  const f = readyLifecycleFixture(), transport = fixtureTransport(f);
  const proof = await loadProtectedReadyReviewLifecycle({ identity: f.identity, skippedRunIds: [50], ...transport });
  assert.equal(validateProtectedReadyReviewLifecycleEvidence(proof, f.identity, 50).valid, true);
  assert.equal(proof.review.run.head_sha, f.identity.baseSha);
  assert.equal(proof.review.run.event, 'workflow_dispatch');
  assert.ok(transport.calls.includes('/actions/runs/100/attempts/1/jobs?filter=all&per_page=100&page=1'));
  assert.ok(transport.calls.includes('/check-runs/201'));
  assert.equal(transport.calls.filter(p => p.startsWith('/actions/workflows/stephanos-exact-head-review.yml/runs?')).length, 2);
});

test('collector composes the preserved failed run and distinct recovery receipt without selecting old success', async () => {
  const f = readyRecoveryFixture(), transport = fixtureRecoveryTransport(f);
  const currentSelection = { workflowRunId: 910, workflowRunAttempt: 1, artifactId: 911,
    artifactDigest: `sha256:${'a'.repeat(64)}`, payloadSha256: 'b'.repeat(64),
    reviewMode: 'clean-independent', findings: [] };
  const proof = await loadProtectedReadyReviewLifecycle({ identity: f.identity, skippedRunIds: [50],
    selectedReview: currentSelection, ...transport });
  assert.equal(proof.failedReview.run.id, 200);
  assert.equal(proof.failedReview.run.conclusion, 'failure');
  assert.equal(proof.recovery.run.id, 300);
  assert.equal(proof.recovery.run.event, 'issue_comment');
  assert.ok(transport.calls.includes(`/compare/${f.originalIdentity.baseSha}...${f.currentMainSha}`));
  assert.ok(transport.calls.includes('/actions/runs/200/artifacts?per_page=100&page=1'));
  assert.equal(transport.calls.filter(path => path.includes('event=issue_comment')).length, 2);
});

test('ordinary READY evidence still binds the separately authenticated current review selection', async () => {
  const f = readyLifecycleFixture(), transport = fixtureTransport(f);
  await assert.rejects(loadProtectedReadyReviewLifecycle({ identity: f.identity, skippedRunIds: [50],
    selectedReview: { workflowRunId: 910, workflowRunAttempt: 1, artifactId: 911,
      artifactDigest: `sha256:${'a'.repeat(64)}`, payloadSha256: 'b'.repeat(64),
      reviewMode: 'clean-independent', findings: [] }, ...transport }),
  /MERGE_SELECTION_DIFFERS_FROM_OWNER_READY/);
});

test('recovery execution qualifies the historical review against its proven live current-base target', async () => {
  const f = readyRecoveryFixture();
  active(f.proof.recovery.run); activeJob(f.proof.recovery.job);
  const transport = fixtureRecoveryTransport(f);
  const env = { ...fixtureEnv(f), GITHUB_EVENT_NAME: 'issue_comment', GITHUB_RUN_ID: '300' };
  const prepared = await prepareReadyReviewRecovery({ comment: f.proof.escalationComment, env,
    sourceSha: f.currentMainSha, ...transport, now: clock(72) });
  assert.equal(prepared.target.prBaseSha, f.currentMainSha);
  const receipt = await executeReadyReviewRecovery({ prepared, env, sourceSha: f.currentMainSha,
    ...transport, now: () => clock(85) });
  assert.equal(receipt.qualification.finalVerdict, 'EXACT_HEAD_QUALIFIED_ESCALATION_PASS');
  assert.equal(receipt.target.prBaseSha, f.currentMainSha);
  assert.equal(receipt.identity.baseSha, f.originalIdentity.baseSha);
  assert.equal(receipt.recoverySourceSha, f.currentMainSha);
});

test('collector rejects diagnostic archive corruption, duplicate diagnostics and recovery replay inventory', async t => {
  await t.test('diagnostic archive corruption', async () => {
    const f = readyRecoveryFixture(), transport = fixtureRecoveryTransport(f), read = transport.download;
    transport.download = async id => {
      const bytes = Buffer.from(await read(id));
      if (id === 503) bytes[40] ^= 0x01;
      return bytes;
    };
    await assert.rejects(loadProtectedReadyReviewLifecycle({ identity: f.identity, skippedRunIds: [50], ...transport }),
      /DIAGNOSTIC_ZIP|DIAGNOSTIC_ARTIFACT_ARCHIVE/);
  });
  await t.test('duplicate diagnostic metadata', async () => {
    const f = readyRecoveryFixture(), transport = fixtureRecoveryTransport(f), read = transport.api;
    transport.api = async path => {
      const value = await read(path);
      if (path === '/actions/runs/200/artifacts?per_page=100&page=1') return { total_count: 2,
        artifacts: [value.artifacts[0], { ...value.artifacts[0], id: 999 }] };
      return value;
    };
    await assert.rejects(loadProtectedReadyReviewLifecycle({ identity: f.identity, skippedRunIds: [50], ...transport }),
      /RECOVERY_FAILED_ARTIFACT_SET/);
  });
  await t.test('second recovery run', async () => {
    const f = readyRecoveryFixture(), transport = fixtureRecoveryTransport(f), read = transport.api;
    transport.api = async path => {
      const value = await read(path);
      if (path.includes('event=issue_comment')) return { total_count: 2,
        workflow_runs: [value.workflow_runs[0], { ...value.workflow_runs[0], id: 301,
          display_title: value.workflow_runs[0].display_title.replace('comment-901', 'comment-902') }] };
      return value;
    };
    await assert.rejects(loadProtectedReadyReviewLifecycle({ identity: f.identity, skippedRunIds: [50], ...transport }),
      /RECOVERY_RUN_NOT_UNIQUE/);
  });
});

test('full artifact bytes and singleton immutable metadata are required before consumer admission', async t => {
  for (const attack of ['corrupt archive', 'different payload', 'different name', 'duplicate metadata']) {
    await t.test(attack, async () => {
      const f = readyLifecycleFixture(), transport = fixtureTransport(f);
      if (attack === 'corrupt archive') transport.download = async () => Buffer.from('corrupted');
      if (attack === 'different payload') transport.artifacts.get(502).zip = transport.artifacts.get(501).zip;
      if (attack === 'different name') transport.artifacts.get(502).metadata.name += '-unbound';
      if (attack === 'duplicate metadata') transport.artifacts.set(503, {
        ...transport.artifacts.get(502), metadata: { ...transport.artifacts.get(502).metadata, id: 503 } });
      await assert.rejects(loadProtectedReadyReviewLifecycle({ identity: f.identity, skippedRunIds: [50], ...transport }), /ARTIFACT/);
    });
  }
});

test('collector rejects producer failure after artifact upload and a later conflicting review', async () => {
  for (const failure of ['producer', 'later pending', 'later canceled', 'later unbound']) {
    const f = readyLifecycleFixture(), transport = fixtureTransport(f);
    if (failure === 'producer') f.proof.handoff.run.conclusion = 'failure';
    else transport.inventory.runs.push({ ...f.proof.review.run, id: 300,
      ...(failure === 'later pending' ? { status: 'in_progress', conclusion: null } : { conclusion: 'cancelled' }),
      ...(failure === 'later unbound' ? { display_title: 'ambiguous execution' } : {}) });
    await assert.rejects(loadProtectedReadyReviewLifecycle({ identity: f.identity, skippedRunIds: [50], ...transport }));
  }
});

test('final proof reread sees changed main, head, tree, draft and owner record', async t => {
  const attacks = {
    main: f => { f.state.main.object.sha = 'e'.repeat(40); },
    head: f => { f.state.pull.head.sha = 'e'.repeat(40); },
    tree: f => { f.state.commit.tree.sha = 'e'.repeat(40); },
    draft: f => { f.state.pull.draft = true; },
    owner: f => { f.proof.handoff.ownerComment.updated_at = clock(2); },
  };
  for (const [name, mutate] of Object.entries(attacks)) await t.test(name, async () => {
    const f = readyLifecycleFixture(), transport = fixtureTransport(f);
    assert.ok(await loadProtectedReadyReviewLifecycle({ identity: f.identity, skippedRunIds: [50], ...transport }));
    mutate(f);
    await assert.rejects(loadProtectedReadyReviewLifecycle({ identity: f.identity, skippedRunIds: [50], ...transport }));
  });
});

test('a complete clean selection is validated before the new draft transition and sealed after reality reread', async () => {
  const f = readyLifecycleFixture(); active(f.proof.handoff.run); f.state.pull.draft = true;
  const d = deps(f, 'dispatch');
  const prepared = await prepareReadyReviewProducer({ command: f.command,
    comment: f.proof.handoff.ownerComment, ...d, now: () => clock(5) });
  assert.equal(prepared.beforeDraft, true);
  assert.equal(prepared.unresolvedReviewThreads, 0);
  assert.equal(prepared.preflight.engineReceipt.verdict, 'STEPHANOS_REVIEW_PASS');
  assert.equal(prepared.preflight.escalationCommentId, 0);
  assert.ok(d.calls.includes(`exactHeadInput:2094:${f.identity.sourceHead}:${f.identity.baseSha}`));
  assert.ok(d.calls.includes('reviewThreads:2094:null'));
  const dir = mkdtempSync(join(tmpdir(), 'ready-review-test-'));
  try {
    const args = { ...d, env: { ...d.env, GITHUB_OUTPUT: join(dir, 'outputs') }, path: join(dir, 'handoff.json'), now: clock(8) };
    await assert.rejects(finishReadyReviewProducer(prepared, 'READY_FOR_REVIEW_PROVEN', args), /DRAFT_CHANGED/);
    f.state.pull.draft = false;
    const handoff = await finishReadyReviewProducer(prepared, 'READY_FOR_REVIEW_PROVEN', args);
    assert.equal(handoff.command.independentReviewPayloadSha256, f.command.independentReviewPayloadSha256);
    assert.equal(handoff.unresolvedReviewThreads, 0);
    assert.match(readFileSync(join(dir, 'outputs'), 'utf8'), /ready_review=true/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'handoff.json'), 'utf8')).payloadSha256, handoff.payloadSha256);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('READY preflight refuses engine findings before draft mutation until exact owner qualification exists', async () => {
  const f = readyLifecycleFixture({ engineFindings: true }); active(f.proof.handoff.run); f.state.pull.draft = true;
  f.proof.escalationComment = null;
  const d = deps(f, 'dispatch');
  await assert.rejects(prepareReadyReviewProducer({ command: f.command,
    comment: f.proof.handoff.ownerComment, ...d, now: () => clock(5) }), /OWNER_(COMMENT_ABSENT|ESCALATION_NOT_POSTED)/);
  assert.equal(d.calls.includes('reviewThreads:2094:null'), false);
});

test('READY preflight accepts only the owner qualification bound to its selected independent review', async () => {
  const f = readyLifecycleFixture({ engineFindings: true }); active(f.proof.handoff.run); f.state.pull.draft = true;
  const d = deps(f, 'dispatch');
  const prepared = await prepareReadyReviewProducer({ command: f.command,
    comment: f.proof.handoff.ownerComment, ...d, now: () => clock(5) });
  assert.equal(prepared.preflight.engineReceipt.verdict, 'STEPHANOS_REVIEW_FINDINGS');
  assert.equal(prepared.preflight.qualification.finalVerdict, 'EXACT_HEAD_QUALIFIED_ESCALATION_PASS');
  assert.equal(prepared.preflight.escalationCommentId, 901);
  f.proof.escalationComment.body = f.proof.escalationComment.body.replace('"reviewRunId":90', '"reviewRunId":91');
  await assert.rejects(prepareReadyReviewProducer({ command: f.command,
    comment: f.proof.handoff.ownerComment, ...deps(f, 'dispatch'), now: () => clock(5) }), /REVIEW_RUN_UNBOUND|DIFFERENT_FROM_OWNER_READY_SELECTION/);
});

test('READY preflight rejects a changed or incomplete exact-head engine input', async t => {
  const attacks = {
    head: input => { input.headSha = 'e'.repeat(40); },
    base: input => { input.baseSha = 'e'.repeat(40); },
    duplicate: input => { input.changedFiles.push(input.changedFiles[0]); },
    patch: input => { input.patch = ''; },
  };
  for (const [name, attack] of Object.entries(attacks)) await t.test(name, async () => {
    const f = readyLifecycleFixture(); active(f.proof.handoff.run); f.state.pull.draft = true;
    const d = deps(f, 'dispatch'), input = structuredClone(f.input); attack(input);
    d.readExactHeadInput = async () => input;
    await assert.rejects(prepareReadyReviewProducer({ command: f.command,
      comment: f.proof.handoff.ownerComment, ...d, now: () => clock(5) }), /PREFLIGHT_ENGINE_INPUT_BINDING/);
  });
});

test('draft bootstrap remains HOLD; independently already-ready bootstrap is not mislabeled clean', async () => {
  const f = readyLifecycleFixture({ bootstrap: true, alreadyReady: true }); active(f.proof.handoff.run);
  f.state.pull.draft = true;
  const args = { command: f.command, comment: f.proof.handoff.ownerComment, ...deps(f, 'dispatch'), now: () => clock(5),
    readThreadsPage: async () => { throw new Error('already-ready must not create a new transition gate'); } };
  await assert.rejects(prepareReadyReviewProducer(args), /DRAFT_BOOTSTRAP_READY_NOT_AUTHORIZED/);
  f.state.pull.draft = false;
  const prepared = await prepareReadyReviewProducer(args);
  assert.equal(prepared.beforeDraft, false);
  assert.equal(prepared.unresolvedReviewThreads, null);
  assert.equal(f.proof.independent.payload.reviewMode, 'qualified-operator-bootstrap');
});

test('new draft transition requires the existing planner zero-thread predicate and exact complete query evidence', async t => {
  const attacks = {
    unresolved: page => { page.data.repository.pullRequest.reviewThreads = {
      totalCount: 1, nodes: [{ id: 'PRRT_1', isResolved: false }], pageInfo: { hasNextPage: false, endCursor: null } }; },
    truncated: page => { page.data.repository.pullRequest.reviewThreads.totalCount = 1; },
    'unknown resolution': page => { page.data.repository.pullRequest.reviewThreads = {
      totalCount: 1, nodes: [{ id: 'PRRT_1' }], pageInfo: { hasNextPage: false, endCursor: null } }; },
    'unknown page state': page => { delete page.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage; },
    'stale head': page => { page.data.repository.pullRequest.headRefOid = 'e'.repeat(40); },
    'stale base': page => { page.data.repository.pullRequest.baseRefOid = 'e'.repeat(40); },
    'other PR': page => { page.data.repository.pullRequest.number++; },
    'other repository': page => { page.data.repository.nameWithOwner = 'other/repository'; },
    'draft changed': page => { page.data.repository.pullRequest.isDraft = false; },
    'GraphQL partial error': page => { page.errors = [{ message: 'partial data' }]; },
    'over bound': page => { page.data.repository.pullRequest.reviewThreads.totalCount = 601; },
  };
  for (const [name, attack] of Object.entries(attacks)) await t.test(name, async () => {
    const f = readyLifecycleFixture(); active(f.proof.handoff.run); f.state.pull.draft = true;
    const d = deps(f, 'dispatch'), page = fixtureThreadPage(f); attack(page);
    d.threadPages.push(page);
    await assert.rejects(prepareReadyReviewProducer({ command: f.command,
      comment: f.proof.handoff.ownerComment, ...d, now: () => clock(5) }), /REVIEW_(THREAD|NOT_CLEAN)/);
  });
});

test('thread collection paginates completely, rejects changing totals, and never ignores unresolved later pages', async () => {
  const f = readyLifecycleFixture(); f.state.pull.draft = true;
  const first = fixtureThreadPage(f, { totalCount: 101, hasNextPage: true, endCursor: 'cursor-100',
    nodes: Array.from({ length: 100 }, (_, n) => ({ id: `PRRT_${n}`, isResolved: true })) });
  const last = fixtureThreadPage(f, { totalCount: 101, nodes: [{ id: 'PRRT_100', isResolved: true }] });
  const d = fixtureTransport(f); d.threadPages.push(first, last);
  assert.equal(await readReadyReviewUnresolvedThreads(d.readThreadsPage, f.identity), 0);
  assert.deepEqual(d.calls, ['reviewThreads:2094:null', 'reviewThreads:2094:cursor-100']);
  last.data.repository.pullRequest.reviewThreads.nodes[0].isResolved = false;
  d.threadPages.push(first, last);
  assert.equal(await readReadyReviewUnresolvedThreads(d.readThreadsPage, f.identity), 1);
  last.data.repository.pullRequest.reviewThreads.totalCount = 102;
  d.threadPages.push(first, last);
  await assert.rejects(readReadyReviewUnresolvedThreads(d.readThreadsPage, f.identity), /CHANGED/);
  last.data.repository.pullRequest.reviewThreads.totalCount = 101;
  last.data.repository.pullRequest.reviewThreads.nodes[0].id = 'PRRT_0';
  d.threadPages.push(first, last);
  await assert.rejects(readReadyReviewUnresolvedThreads(d.readThreadsPage, f.identity), /DUPLICATE/);
});

test('thread query cannot renew the owner window before the new draft mutation', async () => {
  const f = readyLifecycleFixture(); active(f.proof.handoff.run); f.state.pull.draft = true;
  const d = deps(f, 'dispatch'); let current = clock(5);
  await assert.rejects(prepareReadyReviewProducer({ command: f.command, comment: f.proof.handoff.ownerComment,
    ...d, now: () => current, readThreadsPage: async () => { current = clock(301); return fixtureThreadPage(f); } }), /EXPIRED/);
});

test('fixed dispatch follows completed READY producer and does not replay ALREADY_READY or another tuple attempt', async () => {
  const f = readyLifecycleFixture({ alreadyReady: true }); active(f.proof.handoff.run); activeJob(f.proof.handoff.dispatchJob);
  const d = deps(f, 'review-ready'), posts = [];
  d.inventory.runs = [];
  const result = await dispatchReadyReview({ inputs: f.inputs, ...d, now: () => clock(15),
    dispatch: async (path, body) => { posts.push({ path, body }); d.inventory.runs = [f.proof.review.run]; } });
  assert.equal(result.verdict, 'PROTECTED_READY_REVIEW_DISPATCHED');
  assert.equal(result.reviewRunId, 200);
  assert.deepEqual(posts, [{ path: '/actions/workflows/stephanos-exact-head-review.yml/dispatches',
    body: { ref: 'main', inputs: f.inputs } }]);
  d.inventory.runs = [{ ...f.proof.review.run, conclusion: 'failure' }];
  await assert.rejects(dispatchReadyReview({ inputs: f.inputs, ...d, now: () => clock(16),
    dispatch: async () => { posts.push('unexpected'); } }), /ALREADY_DISPATCHED/);
  assert.equal(posts.length, 1);
  d.inventory.runs = []; activeJob(f.proof.handoff.job);
  await assert.rejects(dispatchReadyReview({ inputs: f.inputs, ...d, now: () => clock(17),
    dispatch: async () => { posts.push('unexpected'); } }), /JOB_PROVENANCE/);
  assert.equal(posts.length, 1);
});

test('one POST is followed by bounded observation of its queued bound run while the launcher is active', async () => {
  const f = readyLifecycleFixture(); active(f.proof.handoff.run); activeJob(f.proof.handoff.dispatchJob);
  const d = deps(f, 'review-ready'), waits = []; let posts = 0;
  d.inventory.runs = [];
  const queued = { ...f.proof.review.run, status: 'queued', conclusion: null, run_started_at: null };
  const result = await dispatchReadyReview({ inputs: f.inputs, ...d, now: () => clock(15),
    dispatch: async () => { posts++; }, wait: async ms => {
      waits.push(ms); d.inventory.runs = [queued]; d.runs.set(200, queued);
    } });
  assert.equal(posts, 1);
  assert.deepEqual(waits, [5000]);
  assert.equal(result.reviewRunId, 200); assert.equal(result.launchStatus, 'queued');
  await assert.rejects(loadProtectedReadyReviewLifecycle({ identity: f.identity, skippedRunIds: [50], ...d }), /PROVENANCE_OR_STATE/);
});

test('unobserved, ambiguous, unbound, wrong-actor or expired launches never send a second POST', async t => {
  for (const attack of ['not visible', 'ambiguous', 'unbound handoff', 'wrong actor', 'second attempt', 'expired']) {
    await t.test(attack, async () => {
      const f = readyLifecycleFixture(); active(f.proof.handoff.run); activeJob(f.proof.handoff.dispatchJob);
      const d = deps(f, 'review-ready'); d.inventory.runs = [];
      let posts = 0, waits = 0, current = clock(15);
      const run = { ...f.proof.review.run };
      await assert.rejects(dispatchReadyReview({ inputs: f.inputs, ...d, now: () => current,
        dispatch: async () => {
          posts++;
          if (attack === 'not visible' || attack === 'expired') return;
          if (attack === 'unbound handoff') run.display_title = run.display_title.replace(/binding-[a-f0-9]+$/, `binding-${'e'.repeat(64)}`);
          if (attack === 'wrong actor') run.actor = { login: 'github-actions[bot]', id: 99 };
          if (attack === 'second attempt') run.run_attempt = 2;
          d.runs.set(200, run); d.inventory.runs = attack === 'ambiguous' ? [run, { ...run, id: 300 }] : [run];
        }, wait: async ms => { assert.equal(ms, 5000); waits++; if (attack === 'expired') current = clock(301); },
      }), /PROTECTED_READY_REVIEW_BLOCKED/);
      assert.equal(posts, 1);
      assert.equal(waits, attack === 'not visible' ? 5 : attack === 'expired' ? 1 : 0);
    });
  }
});

test('receipt and handoff IDs are validated before they can select API paths', async t => {
  for (const key of ['readyRunId', 'readyArtifactId', 'prNumber']) await t.test(`normalized ${key}`, async () => {
    const f = readyLifecycleFixture(), d = fixtureTransport(f);
    await assert.rejects(loadReadyReviewHandoff({ ...parseReadyReviewInputs(f.inputs), [key]: '1/../../issues/7' }, d), /NORMALIZED/);
    assert.deepEqual(d.calls, []);
  });
  for (const [key, value] of [['handoffRunId', '1/../../issues/7'], ['handoffArtifactId', -1],
    ['escalationCommentId', '900'], ['handoffRunId', Number.MAX_SAFE_INTEGER + 1]]) {
    await t.test(`receipt ${key} ${value}`, async () => {
      const f = readyLifecycleFixture(), d = fixtureTransport(f), old = f.proof.review.artifact;
      const { payloadSha256, ...body } = old.payload;
      const artifact = fixtureArtifact(502, old.metadata.name, READY_REVIEW_RECEIPT_FILE,
        sealReadyReviewPayload({ ...body, [key]: value }), f.proof.review.run, clock(51));
      d.artifacts.set(502, artifact);
      await assert.rejects(loadProtectedReadyReviewLifecycle({ identity: f.identity, skippedRunIds: [50], ...d }), /NORMALIZED|COMMENT_ID_INVALID/);
      assert.equal(d.calls.some(path => path.includes('/actions/runs/100') || path.includes('/issues/comments/')), false);
      assert.equal(d.calls.some(path => path.includes('..') || path.includes(String(Number.MAX_SAFE_INTEGER + 1))), false);
    });
  }
  await t.test('handoff owner comment ID', async () => {
    const f = readyLifecycleFixture(), d = fixtureTransport(f), old = f.proof.handoff.artifact;
    const { payloadSha256, ...body } = old.payload;
    const payload = sealReadyReviewPayload({ ...body, authorizationCommentId: '900/../901' });
    d.artifacts.set(501, fixtureArtifact(501, old.metadata.name, READY_REVIEW_HANDOFF_FILE, payload, f.proof.handoff.run, clock(9)));
    await assert.rejects(loadReadyReviewHandoff({ ...parseReadyReviewInputs(f.inputs), handoffSha256: payload.payloadSha256 }, d), /API_ID_INVALID/);
    assert.equal(d.calls.some(path => path.includes('/issues/comments/')), false);
  });
});

test('thread transport exposes only the fixed read-only query and typed variables under existing permissions', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options }); return { ok: true, text: async () => '{}' };
  });
  const transport = readyReviewTransports({ GITHUB_TOKEN: 'fixture-token' });
  await transport.readThreadsPage(2094, null);
  const request = calls[0], body = JSON.parse(request.options.body);
  assert.equal(request.url, 'https://api.github.com/graphql');
  assert.equal(request.options.method, 'POST'); assert.equal(request.options.redirect, 'error');
  assert.match(body.query, /^query\(/); assert.doesNotMatch(body.query, /mutation|reviewDecision/);
  assert.match(body.query, /repository\(owner:"Cheekyfellastef",name:"stephan-os"\)/);
  assert.match(body.query, /reviewThreads\(first:100,after:\$after\)/);
  assert.deepEqual(body.variables, { number: 2094, after: null });
  await assert.rejects(transport.readThreadsPage('2094', null), /API_ID_INVALID/);
  await assert.rejects(transport.readThreadsPage(2094, {}), /QUERY_INPUT/);
  assert.equal(calls.length, 1);
});

test('READY preflight transport reads only the exact bounded PR files and complete patch around identity rereads', async t => {
  const f = readyLifecycleFixture(), calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push({ url, options });
    const path = String(url).replace('https://api.github.com/repos/Cheekyfellastef/stephan-os', '');
    let value;
    if (path === '/pulls/2094' && options.headers?.Accept === 'application/vnd.github.v3.diff') value = f.input.patch;
    else if (path === '/pulls/2094') value = JSON.stringify(f.state.pull);
    else if (path === '/git/ref/heads/main') value = JSON.stringify(f.state.main);
    else if (path === `/git/commits/${f.identity.sourceHead}`) value = JSON.stringify(f.state.commit);
    else if (path === '/pulls/2094/files?per_page=100&page=1') value = JSON.stringify([
      { filename: f.input.changedFiles[0], additions: 1, deletions: 1 }]);
    else throw new Error(`unexpected fetch ${path}`);
    return new Response(value, { headers: { 'Content-Type': options.headers?.Accept === 'application/vnd.github.v3.diff'
      ? diffType : 'application/json' } });
  });
  const transport = readyReviewTransports({ GITHUB_TOKEN: 'fixture-token' });
  assert.deepEqual(await transport.readExactHeadInput(f.identity, { expectedDraft: false }), f.input);
  assert.equal(calls.filter(call => call.url.endsWith('/pulls/2094')).length, 3);
  assert.equal(calls.filter(call => call.url.includes('/pulls/2094/files?')).length, 1);
  assert.equal(calls.filter(call => call.options.headers?.Accept === 'application/vnd.github.v3.diff').length, 1);
});

test('target runs unchanged engine on full exact input and keeps a genuine clean result', async () => {
  const f = readyLifecycleFixture(); prepareActive(f);
  const d = deps(f, 'exact-head-review');
  const prepared = await prepareReadyReview({ inputs: f.inputs, ...d, now: clock(15) });
  const receipt = await executeReadyReview({ prepared, input: f.input, ...d, now: () => clock(50) });
  assert.equal(receipt.engineReceipt.verdict, 'STEPHANOS_REVIEW_PASS');
  assert.deepEqual(receipt.engineReceipt.findings, []);
  assert.equal(receipt.qualification, null);
  assert.equal(receipt.independentReviewMode, 'clean-independent');
  await assert.rejects(executeReadyReview({ prepared, input: { ...f.input, headSha: 'e'.repeat(40) }, ...d,
    now: () => clock(50) }), /ENGINE_INPUT_BINDING/);
});

test('authenticated owner READY cannot substitute for separate owner escalation of actual engine findings', async () => {
  const f = readyLifecycleFixture({ engineFindings: true }); prepareActive(f);
  const d = deps(f, 'exact-head-review');
  const prepared = await prepareReadyReview({ inputs: f.inputs, ...d, now: clock(15) });
  f.proof.escalationComment = null;
  await assert.rejects(executeReadyReview({ prepared, input: f.input, ...d, now: () => clock(50) }), /OWNER_COMMENT_ABSENT/);
});

test('actual unchanged qualification composes with already-ready bootstrap without erasing residual findings', async () => {
  const f = readyLifecycleFixture({ bootstrap: true, alreadyReady: true, engineFindings: true }); prepareActive(f);
  const d = deps(f, 'exact-head-review');
  const prepared = await prepareReadyReview({ inputs: f.inputs, ...d, now: clock(15) });
  const receipt = await executeReadyReview({ prepared, input: f.input, ...d, now: () => clock(50) });
  assert.equal(receipt.engineReceipt.verdict, 'STEPHANOS_REVIEW_FINDINGS');
  assert.equal(receipt.independentReviewMode, 'qualified-operator-bootstrap');
  assert.equal(receipt.qualification.finalVerdict, 'EXACT_HEAD_QUALIFIED_ESCALATION_PASS');
  assert.equal(receipt.qualification.mergeAuthority, false);
  assert.equal(receipt.escalationCommentId, 901);
});

test('incomplete, oversized or unstable GitHub inventories cannot establish absence or select old success', async () => {
  await assert.rejects(readReadyReviewCollection(async () => ({ total_count: 101, workflow_runs: [{ id: 1 }] }), '/runs', 'workflow_runs'), /TRUNCATED/);
  await assert.rejects(readReadyReviewCollection(async () => ({ total_count: 601, workflow_runs: [] }), '/runs', 'workflow_runs'), /INCOMPLETE/);
  let page = 0;
  await assert.rejects(readReadyReviewCollection(async () => (++page === 1
    ? { total_count: 101, workflow_runs: Array.from({ length: 100 }, (_, n) => ({ id: n + 1 })) }
    : { total_count: 102, workflow_runs: [{ id: 101 }] }), '/runs', 'workflow_runs'), /CHANGED/);
});

test('canonical workflows preserve draft guards, pin main source and upload separate single files after successful jobs', () => {
  const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const mailbox = source('.github/workflows/protected-workflow-dispatch-mailbox.yml');
  const reviewer = source('.github/workflows/stephanos-exact-head-review.yml');
  assert.match(mailbox, /review-ready:\n    needs: \[dispatch\]\n    if: needs\.dispatch\.outputs\.ready_review == 'true'/);
  assert.match(mailbox, /ref: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(mailbox, /ref: main|overwrite: true/);
  assert.match(mailbox, /path: protected-ready-review-handoff\.json/);
  assert.match(mailbox, /permissions:\n      actions: write\n      contents: read\n      issues: read\n      pull-requests: read/);
  assert.match(reviewer, /github\.event_name == 'pull_request_target' && !github\.event\.pull_request\.draft/);
  assert.match(reviewer, /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main' && github\.sha == inputs\.base_sha/);
  assert.match(reviewer, /test "\$\{GITHUB_WORKFLOW_SHA\}" = "\$\{GITHUB_SHA\}"/);
  assert.match(reviewer, /path: protected-ready-review-receipt\.json/);
  assert.match(reviewer, /Probe preserved protected READY failure recovery[\s\S]*recovery-prepare/);
  assert.match(reviewer, /Recover preserved failed READY review with the unchanged engine[\s\S]*recovery-review/);
  assert.match(reviewer, /name: protected-ready-review-recovery-receipt-\$\{\{ github\.run_id \}\}-attempt-\$\{\{ github\.run_attempt \}\}/);
  assert.match(reviewer, /path: protected-ready-review-recovery-receipt\.json/);
  assert.match(reviewer, /steps\.ready_recovery\.outputs\.ready_recovery != 'true'/);
  assert.match(reviewer, /path: review-proof\//);
  assert.match(reviewer, /if: github\.event_name != 'workflow_dispatch'[\s\S]*node scripts\/exact-head-qualified-escalation-v1\.mjs/);
  const collector = source('scripts/operator-protected-personal-repository-merge.mjs');
  assert.match(collector, /export async function loadReadyReviewForCheckSnapshot/);
  assert.match(collector, /readReadyReview = loadReadyReviewForCheckSnapshot[\s\S]*readyReviewLifecycleEvidence = await readReadyReview/);
  assert.match(collector, /initialReadyReview = await loadReadyReviewForCheckSnapshot/);
  assert.match(collector, /refreshedAuthority = await readPersonalRepositoryAuthoritySnapshot[\s\S]*refreshedReadyReview = await loadReadyReviewForCheckSnapshot/);
  assert.match(collector, /cleanIndependentReviewProved: true, readyReviewLifecycleEvidence/);
  assert.match(collector, /readyReviewLifecycleEvidence: refreshedReadyReview/);
  const dispatcher = source('scripts/dispatch-protected-merge-from-mailbox.mjs');
  assert.ok(dispatcher.indexOf('await prepareReadyReviewProducer') < dispatcher.indexOf('await graphqlReady(before.pull.node_id)'));
});
