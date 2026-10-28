import test from 'node:test';
import assert from 'node:assert/strict';
import { readControlTowerBuildRequestV1, isAuthenticatedControlTowerBuildRequestV1 } from './controlTowerBuildReaderV1.mjs';
import { fixture, HEAD, NOW, SIGNED } from './fixtures/controlTowerBuildV1.mjs';
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
  const g = fixture(); g.list = { total_count: 6, workflow_runs: Array.from({ length: 5 }, (_, i) => ({ ...g.run, id: i + 1 })) };
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
