import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readControlTowerBuildRequestV1, isAuthenticatedControlTowerBuildRequestV1 } from './controlTowerBuildReaderV1.mjs';
import { fixture, inputs, zip, API, HEAD, NOW, SIGNED } from './fixtures/controlTowerBuildV1.mjs';
import { createControlTowerBuildRequestV1 } from './controlTowerBuildRequestV1.mjs';
const read = (f, extra = {}) => readControlTowerBuildRequestV1({ token: 'test-only', fetchImpl: f.fetchImpl, now: () => NOW, ...extra });

test('fixed GET, owner run, full job estate and archive digest mint a frozen native intent', async () => {
  const f = fixture(), result = await read(f);
  assert.equal(result.ok, true); assert.equal(result.request.runId, 100);
  assert.equal(isAuthenticatedControlTowerBuildRequestV1(result.request), true);
  assert.equal(isAuthenticatedControlTowerBuildRequestV1({ ...result.request }), false);
  assert.equal(Object.isFrozen(result.request), true);
  assert.equal(f.calls.length, 9);
  for (const { url, init } of f.calls) {
    assert.equal(init.method, 'GET');
    assert.equal(init.headers.Authorization, url === SIGNED ? undefined : 'Bearer test-only');
  }
});

test('read-only inspection uses the same authenticated artifact without widening transport authority', async () => {
  const f = fixture();
  const { event, env } = inputs();
  event.inputs = { operation: 'OBSERVE_CONTROL_SYSTEM' };
  const minted = createControlTowerBuildRequestV1(event, env, HEAD, '2026-10-28T12:00:05.000Z');
  assert.equal(minted.ok, true);
  f.repack(minted.request);
  const result = await read(f);
  assert.equal(result.ok, true);
  assert.equal(result.request.operation, 'OBSERVE_CONTROL_SYSTEM');
  assert.equal(isAuthenticatedControlTowerBuildRequestV1(result.request), true);
  assert.equal(result.request.runtimeMutationAuthority, false);
  assert.equal(result.request.arbitraryShellAllowed, false);
  assert.equal(result.request.admissionGranted, false);
  assert.equal(f.calls.length, 9);
});

test('a held build cannot starve a later authenticated inspection or become falsely recorded', async () => {
  const f = fixture();
  const { event, env } = inputs();
  event.inputs = { operation: 'OBSERVE_CONTROL_SYSTEM' }; env.GITHUB_RUN_ID = '101';
  const request = createControlTowerBuildRequestV1(event, env, HEAD, '2026-10-28T12:00:05.000Z').request;
  const archive = zip(request);
  const run = { ...f.run, id: 101 };
  f.list.workflow_runs.unshift(run); f.list.total_count = 2;
  const observed = [];
  const fetchImpl = async (url, init) => {
    observed.push(url);
    if (url === API + '/actions/runs/101') return Response.json(run);
    if (url === API + '/actions/runs/101/jobs?per_page=100') return Response.json({
      total_count: 2, jobs: f.jobs.jobs.map(job => ({ ...job, run_id: 101 })),
    });
    if (url === API + '/actions/runs/101/artifacts?per_page=100') return Response.json({ total_count: 1, artifacts: [{
      ...f.artifacts.artifacts[0], id: 201, name: 'stephanos-control-tower-build-101', size_in_bytes: archive.length,
      digest: 'sha256:' + createHash('sha256').update(archive).digest('hex'),
      workflow_run: { ...f.artifacts.artifacts[0].workflow_run, id: 101 },
    }] });
    if (url === API + '/actions/artifacts/201/zip') return new Response(null, { status: 302, headers: { location: SIGNED + '/observe' } });
    if (url === SIGNED + '/observe') {
      assert.equal(init.headers.Authorization, undefined);
      return new Response(archive);
    }
    return f.fetchImpl(url, init);
  };
  const queriedIds = [];
  const result = await readControlTowerBuildRequestV1({ token: 'test-only', now: () => NOW,
    fetchImpl, observationOnly: true, isRecorded: id => { queriedIds.push(id); return false; } });
  assert.equal(result.ok, true);
  assert.equal(result.request.runId, 101);
  assert.equal(result.request.operation, 'OBSERVE_CONTROL_SYSTEM');
  assert.equal(isAuthenticatedControlTowerBuildRequestV1(result.request), true);
  assert.ok(observed.indexOf(API + '/actions/artifacts/200/zip') < observed.indexOf(API + '/actions/artifacts/201/zip'));
  assert.ok(queriedIds.includes(100) && queriedIds.includes(101));
  assert.equal((await read(f)).request.runId, 100, 'restrictive observation selection does not consume or mark the build');
});

test('observation-only selection rejects ambiguous configuration and never returns a build', async () => {
  for (const observationOnly of ['true', [], {}, 1, null])
    assert.equal((await read(fixture(), { observationOnly })).blocker, 'CONTROL_TOWER_REQUEST_OPERATION_FILTER_INVALID');
  const result = await read(fixture(), { observationOnly: true });
  assert.equal(result.ok, false);
  assert.equal(result.request, null);
});
test('read-only discovery artifacts, foreign workflows and incomplete jobs never become a build command', async () => {
  for (const mutate of [f => { f.definition.path = '.github/workflows/stephanos-mailbox-free-readonly.yml'; },
    f => { f.run.workflow_id = 9; }, f => { f.jobs.total_count = 3; },
    f => { f.jobs.jobs[0].conclusion = 'skipped'; }, f => { f.run.actor.id = 1; },
    f => { f.artifacts.artifacts[0].name = 'stephanos-mailbox-free-readonly-100'; },
    f => { f.artifacts.artifacts[0].workflow_run.repository_id = 1; }]) {
    const f = fixture(); mutate(f); assert.equal((await read(f)).ok, false);
  }
});
test('tampering, extra files, traversal, privileged fields and oversized archives fail closed', async () => {
  for (const mutate of [f => { f.archive[45] ^= 1; }, f => { f.repack({ ...f.request, admissionGranted: true }); },
    f => { f.repack({ ...f.request, command: 'anything' }); }, f => { f.repack(f.request, '../evil.json'); },
    f => { f.artifacts.total_count = 2; }, f => { f.artifacts.artifacts[0].size_in_bytes = 65537; },
    f => { f.artifacts.artifacts[0].expired = true; }]) {
    const f = fixture(); mutate(f); assert.equal((await read(f)).ok, false);
  }
});
test('source moving during IO, expired request and untrusted signed redirects never dispatch', async () => {
  const f = fixture(); f.moved = { ref: 'refs/heads/main', object: { sha: 'b'.repeat(40) } };
  assert.equal((await read(f)).blocker, 'CONTROL_TOWER_MAIN_MOVED');
  const g = fixture(); g.redirect = 'https://attacker.invalid/private';
  assert.equal((await read(g)).ok, false); assert.ok(!g.calls.some(c => c.url.includes('attacker')));
  assert.equal((await read(fixture(), { now: () => '2026-10-28T12:11:00.000Z' })).ok, false);
});
test('already recorded requests are not returned and more than five active requests cause backpressure', async () => {
  const f = fixture(); assert.equal((await read(f, { isRecorded: id => id === 100 })).blocker, 'NO_CONTROL_TOWER_BUILD_REQUEST');
  const g = fixture(); g.list = { total_count: 11, workflow_runs: Array.from({ length: 10 }, (_, i) => ({ ...g.run, id: i + 1 })) };
  assert.equal((await read(g)).blocker, 'CONTROL_TOWER_BUILD_ACTIVE_WINDOW_OVERFLOW');
  assert.equal(g.calls.length, 3);
});
test('oldest unseen active request is selected without giving failed or pending runs execution', async () => {
  const f = fixture(); f.list.workflow_runs.unshift({ ...f.run, id: 101 }); f.list.total_count = 2;
  assert.equal((await read(f)).request.runId, 100);
  const g = fixture(); g.list.workflow_runs[0].status = 'in_progress';
  assert.equal((await read(g)).blocker, 'NO_CONTROL_TOWER_BUILD_REQUEST');
});
test('a stale-head request cannot starve a newer current-main build request', async () => {
  const f = fixture();
  f.list.workflow_runs.push({ ...f.run, id: 99, head_sha: 'b'.repeat(40), created_at: '2026-10-28T11:59:00Z' });
  f.list.total_count = 2;
  const result = await read(f);
  assert.equal(result.ok, true); assert.equal(result.request.runId, 100);
  assert.ok(f.calls.some(c => c.url.endsWith('head_sha=' + HEAD)));
  assert.ok(!f.calls.some(c => c.url.endsWith('/actions/runs/99')));
});

test('current-head authenticated owner push run is accepted from the same bounded GET carrier', async () => {
  const f = fixture();
  const { event, env } = inputs();
  env.GITHUB_EVENT_NAME = 'push';
  event.ref = 'refs/heads/main';
  event.before = 'b'.repeat(40);
  event.after = HEAD;
  event.head_commit = { id: HEAD };
  event.created = false;
  event.deleted = false;
  event.forced = false;
  delete event.inputs;
  const minted = createControlTowerBuildRequestV1(event, env, HEAD, '2026-10-28T12:00:05.000Z');
  assert.equal(minted.ok, true);
  f.repack(minted.request);
  f.run.event = 'push';
  f.list.workflow_runs[0].event = 'push';
  const value = await read(f);
  assert.equal(value.ok, true);
  assert.equal(value.request.runId, 100);
  assert.equal(isAuthenticatedControlTowerBuildRequestV1(value.request), true);
  assert.ok(f.calls.some(c => c.url.includes('runs?per_page=10&head_sha=' + HEAD)));
});

test('other event classes and wrong owner cannot wake through unfiltered run inventory', async () => {
  const f = fixture();
  f.run.event = 'pull_request';
  f.list.workflow_runs[0].event = 'pull_request';
  assert.equal((await read(f)).blocker, 'NO_CONTROL_TOWER_BUILD_REQUEST');
  const g = fixture();
  g.run.event = 'push';
  g.list.workflow_runs[0].event = 'push';
  g.run.actor.id = 1;
  assert.equal((await read(g)).ok, false);
});

test('unfiltered current-head inventory still prevents oldest current run starvation', async () => {
  const f = fixture();
  f.list.workflow_runs.push({ ...f.run, id: 99, event: 'pull_request', created_at: '2026-10-28T11:59:00Z' });
  f.list.total_count = 2;
  assert.equal((await read(f)).request.runId, 100);
});
