import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  invalidateBrokeredGithubObservation,
  readBrokeredGithubRateLimitHold,
  recordBrokeredGithubRateLimitHold,
  publishBrokeredGithubMutation,
  readBrokeredGithubJson,
} from './githubObservationBrokerV1.mjs';

test('shared GitHub observation cache makes one upstream read inside the TTL', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'stephanos-github-broker-'));
  let calls = 0;
  const spawnSyncFn = (_command, args) => {
    calls += 1;
    return { status: 0, stdout: JSON.stringify({ endpoint: args[1], revision: calls }), stderr: '' };
  };
  const base = {
    key: 'mailbox:2590',
    endpoint: 'repos/Cheekyfellastef/stephan-os/issues/2590',
    workspaceRoot,
    ttlMs: 90_000,
    maxStaleMs: 300_000,
    ghCommand: 'gh-test',
    spawnSyncFn,
  };
  try {
    const first = readBrokeredGithubJson({ ...base, nowMs: Date.parse('2026-09-28T15:00:00.000Z') });
    const second = readBrokeredGithubJson({ ...base, nowMs: Date.parse('2026-09-28T15:00:30.000Z') });
    assert.equal(first.ok, true);
    assert.equal(first.source, 'UPSTREAM_REFRESH');
    assert.equal(second.ok, true);
    assert.equal(second.source, 'SHARED_CACHE');
    assert.equal(calls, 1);
    assert.deepEqual(second.payload, first.payload);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('cache key cannot accidentally reuse a different GitHub endpoint', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'stephanos-github-broker-endpoint-'));
  let calls = 0;
  const spawnSyncFn = (_command, args) => {
    calls += 1;
    return { status: 0, stdout: JSON.stringify({ endpoint: args[1] }), stderr: '' };
  };
  try {
    const first = readBrokeredGithubJson({
      key: 'shared-key',
      endpoint: 'repos/Cheekyfellastef/stephan-os/issues/2590',
      workspaceRoot,
      ghCommand: 'gh-test',
      spawnSyncFn,
      nowMs: Date.parse('2026-09-28T15:00:00.000Z'),
    });
    const second = readBrokeredGithubJson({
      key: 'shared-key',
      endpoint: 'repos/Cheekyfellastef/stephan-os/issues/1889',
      workspaceRoot,
      ghCommand: 'gh-test',
      spawnSyncFn,
      nowMs: Date.parse('2026-09-28T15:00:10.000Z'),
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.source, 'UPSTREAM_REFRESH');
    assert.equal(calls, 2);
    assert.match(second.payload.endpoint, /1889$/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('stale observation is served after an upstream failure inside the stale window', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'stephanos-github-broker-stale-'));
  let fail = false;
  let calls = 0;
  const spawnSyncFn = () => {
    calls += 1;
    return fail
      ? { status: 1, stdout: '', stderr: 'rate limited' }
      : { status: 0, stdout: JSON.stringify({ ok: true }), stderr: '' };
  };
  const base = {
    key: 'stale-test',
    endpoint: 'repos/Cheekyfellastef/stephan-os/issues/2590',
    workspaceRoot,
    ttlMs: 5_000,
    maxStaleMs: 60_000,
    ghCommand: 'gh-test',
    spawnSyncFn,
  };
  try {
    const first = readBrokeredGithubJson({ ...base, nowMs: Date.parse('2026-09-28T15:00:00.000Z') });
    fail = true;
    const second = readBrokeredGithubJson({ ...base, nowMs: Date.parse('2026-09-28T15:00:10.000Z') });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.source, 'SHARED_CACHE_STALE_AFTER_UPSTREAM_FAILURE');
    assert.equal(calls, 2);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('unchanged GitHub publication is suppressed until bounded heartbeat expiry', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'stephanos-github-broker-write-'));
  let publishes = 0;
  const publish = () => {
    publishes += 1;
    return { ok: true, reason: 'UPDATED' };
  };
  const base = {
    key: 'health-beacon',
    body: 'body with volatile timestamp',
    material: 'stable-health-state',
    workspaceRoot,
    heartbeatMs: 300_000,
    publish,
  };
  try {
    const first = publishBrokeredGithubMutation({ ...base, nowMs: Date.parse('2026-09-28T15:00:00.000Z') });
    const second = publishBrokeredGithubMutation({ ...base, body: 'body with another timestamp', nowMs: Date.parse('2026-09-28T15:01:00.000Z') });
    const third = publishBrokeredGithubMutation({ ...base, body: 'heartbeat refresh', nowMs: Date.parse('2026-09-28T15:05:01.000Z') });
    assert.equal(first.published, true);
    assert.equal(second.published, false);
    assert.equal(second.reason, 'GITHUB_PUBLICATION_DEDUPED');
    assert.equal(third.published, true);
    assert.equal(publishes, 2);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('publication lock contention fails closed instead of reporting success', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'stephanos-github-broker-inflight-'));
  const key = 'in-flight-publication';
  const id = createHash('sha256').update(key).digest('hex');
  const lockDir = join(workspaceRoot, 'status', 'github-observation-broker');
  const lockPath = join(lockDir, `write-${id}.lock`);
  await mkdir(lockDir, { recursive: true });
  await writeFile(lockPath, JSON.stringify({ ownerToken: 'other-process', pid: 999, acquiredAtUtc: new Date().toISOString() }));
  let publishes = 0;
  try {
    const result = publishBrokeredGithubMutation({
      key, body: 'state', material: 'state', workspaceRoot,
      publish: () => { publishes += 1; return { ok: true }; },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'GITHUB_PUBLICATION_IN_FLIGHT');
    assert.equal(result.published, false);
    assert.equal(publishes, 0);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('a sixty-second-old read lock is still live for a bounded GitHub call', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'stephanos-github-broker-lock-'));
  const key = 'slow-read-lock';
  const id = createHash('sha256').update(key).digest('hex');
  const lockDir = join(workspaceRoot, 'status', 'github-observation-broker');
  const lockPath = join(lockDir, `read-${id}.lock`);
  await mkdir(lockDir, { recursive: true });
  await writeFile(lockPath, JSON.stringify({ ownerToken: 'slow-owner', pid: 999, acquiredAtUtc: new Date().toISOString() }));
  const old = new Date(Date.now() - 60_000);
  await utimes(lockPath, old, old);
  let calls = 0;
  try {
    const result = readBrokeredGithubJson({
      key, endpoint: 'repos/Cheekyfellastef/stephan-os/issues/2590',
      workspaceRoot, spawnSyncFn: () => { calls += 1; return { status: 0, stdout: '{}', stderr: '' }; },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'GITHUB_OBSERVATION_REFRESH_IN_PROGRESS');
    assert.equal(calls, 0);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('invalidating an observation forces the next read upstream', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'stephanos-github-broker-invalidate-'));
  let calls = 0;
  const base = {
    key: 'invalidate-test',
    endpoint: 'repos/Cheekyfellastef/stephan-os/issues/1889/comments?per_page=100',
    workspaceRoot,
    ttlMs: 60_000,
    spawnSyncFn: () => {
      calls += 1;
      return { status: 0, stdout: JSON.stringify([{ id: calls }]), stderr: '' };
    },
  };
  try {
    const first = readBrokeredGithubJson({ ...base, nowMs: Date.parse('2026-09-28T15:00:00.000Z') });
    assert.equal(first.ok, true);
    assert.equal(invalidateBrokeredGithubObservation({ key: base.key, workspaceRoot }).ok, true);
    const second = readBrokeredGithubJson({ ...base, nowMs: Date.parse('2026-09-28T15:00:10.000Z') });
    assert.equal(second.source, 'UPSTREAM_REFRESH');
    assert.equal(calls, 2);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});


test('shared cooldown is atomic, monotonic, and visible to a separate Node process', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'stephanos-shared-gh-rate-'));
  const nowMs = Date.parse('2026-10-09T10:00:00Z');
  try {
    const first = recordBrokeredGithubRateLimitHold({ repository: 'Owner/Repo', workspaceRoot, nowMs, retryAfterMs: 120_000 });
    const shorter = recordBrokeredGithubRateLimitHold({ repository: 'owner/repo', workspaceRoot, nowMs: nowMs + 1_000, retryAfterMs: 30_000 });
    assert.equal(first.ok, true);
    assert.equal(shorter.ok, true);
    assert.equal(shorter.retryAfterUtc, first.retryAfterUtc);
    const script = `import {readBrokeredGithubRateLimitHold} from ${JSON.stringify(new URL('./githubObservationBrokerV1.mjs', import.meta.url).href)}; console.log(JSON.stringify(readBrokeredGithubRateLimitHold({repository:'OWNER/REPO',workspaceRoot:${JSON.stringify(workspaceRoot)},nowMs:${nowMs + 2_000}})));`;
    const observed = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }));
    assert.equal(observed.retryAfterUtc, first.retryAfterUtc);
    assert.equal(observed.source, 'SHARED_GITHUB_RATE_LIMIT_HOLD');
    assert.equal(readBrokeredGithubRateLimitHold({ repository: 'other/repo', workspaceRoot, nowMs }), null);
    assert.equal(readBrokeredGithubRateLimitHold({ repository: 'owner/repo', workspaceRoot, nowMs: nowMs + 120_001 }), null);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('a rate-limited broker reader stops another endpoint from retrying during hold', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'stephanos-shared-gh-cli-hold-'));
  const nowMs = Date.parse('2026-10-09T10:00:00Z');
  let calls = 0;
  const base = {
    workspaceRoot, nowMs, ttlMs: 1_000,
    spawnSyncFn: () => { calls++; return { status: 1, stdout: '', stderr: 'HTTP 403: API rate limit exceeded for user ID 123' }; },
  };
  try {
    const first = readBrokeredGithubJson({ ...base, key: 'first', endpoint: 'repos/owner/repo/issues/1' });
    const second = readBrokeredGithubJson({ ...base, key: 'second', endpoint: 'repos/owner/repo/issues/2', nowMs: nowMs + 1_000 });
    assert.equal(first.reason, 'GITHUB_RATE_LIMIT_BACKOFF');
    assert.equal(second.reason, 'GITHUB_RATE_LIMIT_BACKOFF');
    assert.equal(second.upstreamCalls, 0);
    assert.equal(calls, 1);
    const third = readBrokeredGithubJson({ ...base, key: 'third', endpoint: 'repos/owner/repo/issues/3', nowMs: nowMs + 120_001 });
    assert.equal(third.upstreamCalls, 1);
    assert.equal(calls, 2);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('a permissions 403 is not misclassified as GitHub rate limiting', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'stephanos-shared-gh-permission-'));
  let calls = 0;
  try {
    const a = readBrokeredGithubJson({
      key: 'permission-a', endpoint: 'repos/owner/permissions-repo/issues/1', workspaceRoot,
      spawnSyncFn: () => { calls++; return { status: 1, stdout: '', stderr: 'HTTP 403: Resource not accessible by integration' }; },
    });
    const b = readBrokeredGithubJson({
      key: 'permission-b', endpoint: 'repos/owner/permissions-repo/issues/2', workspaceRoot,
      spawnSyncFn: () => { calls++; return { status: 1, stdout: '', stderr: 'HTTP 403: Resource not accessible by integration' }; },
    });
    assert.equal(a.reason, 'GITHUB_OBSERVATION_UPSTREAM_FAILED');
    assert.equal(b.reason, 'GITHUB_OBSERVATION_UPSTREAM_FAILED');
    assert.equal(calls, 2);
    assert.equal(readBrokeredGithubRateLimitHold({ repository: 'owner/permissions-repo', workspaceRoot }), null);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});