import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  acquireMissionWorkerClaimOwnership,
  inspectMissionWorkerClaimOwnership,
  missionWorkerQueueItemSha256,
} from './missionWorkerClaimOwnershipV1.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mission-worker-owner-'));
  const queueBytes = Buffer.from('{"schemaVersion":"stephanos.mission-worker-queue-item.v1"}\n');
  return { root, queueBytes, digest: missionWorkerQueueItemSha256(queueBytes) };
}

test('claim ownership is exclusive and bound to the exact queue bytes', async () => {
  const f = await fixture();
  try {
    const first = await acquireMissionWorkerClaimOwnership({
      queueRoot: f.root,
      adapter: 'foundry-forge',
      actionId: 'action-1',
      queueItemSha256: f.digest,
      pid: 111,
      hostname: 'battle-bridge',
      processStartedAtUtc: '2026-09-25T15:00:00.000Z',
      acquiredAtUtc: '2026-09-25T15:01:00.000Z',
    }, {
      hostname: 'battle-bridge',
      killFn(pid) {
        if (pid === 111) return;
        throw Object.assign(new Error('missing'), { code: 'ESRCH' });
      },
    });
    assert.equal(first.acquired, true);

    const second = await acquireMissionWorkerClaimOwnership({
      queueRoot: f.root,
      adapter: 'foundry-forge',
      actionId: 'action-1',
      queueItemSha256: f.digest,
      pid: 222,
      hostname: 'battle-bridge',
    }, {
      hostname: 'battle-bridge',
      killFn(pid) {
        if (pid === 111) return;
        throw Object.assign(new Error('missing'), { code: 'ESRCH' });
      },
    });
    assert.equal(second.acquired, false);
    assert.equal(second.reason, 'MISSION_WORKER_CLAIM_OWNER_ALIVE');

    const mismatch = await inspectMissionWorkerClaimOwnership({
      queueRoot: f.root,
      adapter: 'foundry-forge',
      actionId: 'action-1',
      queueItemSha256: 'f'.repeat(64),
    }, { hostname: 'battle-bridge', killFn() {} });
    assert.equal(mismatch.state, 'invalid');
    assert.equal(await first.release(), true);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('a provably dead same-host owner can be atomically replaced', async () => {
  const f = await fixture();
  try {
    const dead = await acquireMissionWorkerClaimOwnership({
      queueRoot: f.root,
      adapter: 'chatgpt-github',
      actionId: 'action-2',
      queueItemSha256: f.digest,
      pid: 333,
      hostname: 'battle-bridge',
      processStartedAtUtc: '2026-09-25T15:00:00.000Z',
      acquiredAtUtc: '2026-09-25T15:01:00.000Z',
    }, {
      hostname: 'battle-bridge',
      killFn() { throw Object.assign(new Error('dead'), { code: 'ESRCH' }); },
    });
    assert.equal(dead.acquired, true);

    const takeover = await acquireMissionWorkerClaimOwnership({
      queueRoot: f.root,
      adapter: 'chatgpt-github',
      actionId: 'action-2',
      queueItemSha256: f.digest,
      pid: 444,
      hostname: 'battle-bridge',
    }, {
      hostname: 'battle-bridge',
      killFn(pid) {
        if (pid === 333) throw Object.assign(new Error('dead'), { code: 'ESRCH' });
        if (pid === 444) return;
        throw Object.assign(new Error('unknown'), { code: 'ESRCH' });
      },
    });
    assert.equal(takeover.acquired, true);
    assert.equal(takeover.owner.pid, 444);
    assert.notEqual(takeover.owner.token, dead.owner.token);
    assert.equal(await dead.release(), false);
    assert.equal(await takeover.release(), true);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('foreign-host ownership is never stolen', async () => {
  const f = await fixture();
  try {
    const foreign = await acquireMissionWorkerClaimOwnership({
      queueRoot: f.root,
      adapter: 'foundry-forge',
      actionId: 'action-3',
      queueItemSha256: f.digest,
      pid: 555,
      hostname: 'other-host',
    }, { hostname: 'other-host', killFn() {} });
    assert.equal(foreign.acquired, true);

    const attempt = await acquireMissionWorkerClaimOwnership({
      queueRoot: f.root,
      adapter: 'foundry-forge',
      actionId: 'action-3',
      queueItemSha256: f.digest,
      pid: 666,
      hostname: 'battle-bridge',
    }, {
      hostname: 'battle-bridge',
      killFn() { throw Object.assign(new Error('dead'), { code: 'ESRCH' }); },
    });
    assert.equal(attempt.acquired, false);
    assert.equal(attempt.reason, 'MISSION_WORKER_CLAIM_OWNER_UNKNOWN');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('malformed ownership never grants takeover authority', async () => {
  const f = await fixture();
  try {
    const ownerRoot = join(f.root, 'foundry-forge', 'claim-owners');
    await mkdir(ownerRoot, { recursive: true });
    await writeFile(join(ownerRoot, 'action-4.json'), '{"pid":999}\n');
    const evidence = await inspectMissionWorkerClaimOwnership({
      queueRoot: f.root,
      adapter: 'foundry-forge',
      actionId: 'action-4',
      queueItemSha256: f.digest,
    }, {
      hostname: 'battle-bridge',
      killFn() { throw Object.assign(new Error('dead'), { code: 'ESRCH' }); },
    });
    assert.equal(evidence.state, 'invalid');

    const bytes = await readFile(join(ownerRoot, 'action-4.json'), 'utf8');
    assert.equal(bytes, '{"pid":999}\n');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});


test('concurrent rescuers cannot use stale death evidence to evict the takeover winner', async () => {
  const f = await fixture();
  try {
    const dead = await acquireMissionWorkerClaimOwnership({
      queueRoot: f.root,
      adapter: 'foundry-forge',
      actionId: 'action-5',
      queueItemSha256: f.digest,
      pid: 777,
      hostname: 'battle-bridge',
      processStartedAtUtc: '2026-09-25T15:00:00.000Z',
      acquiredAtUtc: '2026-09-25T15:01:00.000Z',
    });
    assert.equal(dead.acquired, true);

    const liveness = {
      hostname: 'battle-bridge',
      killFn(pid) {
        if (pid === 777) throw Object.assign(new Error('dead'), { code: 'ESRCH' });
        return undefined;
      },
    };
    const contender = (pid) => acquireMissionWorkerClaimOwnership({
      queueRoot: f.root,
      adapter: 'foundry-forge',
      actionId: 'action-5',
      queueItemSha256: f.digest,
      pid,
      hostname: 'battle-bridge',
    }, liveness);

    const results = await Promise.all([contender(888), contender(999)]);
    const winners = results.filter((result) => result.acquired === true);
    const losers = results.filter((result) => result.acquired !== true);

    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.equal(losers[0].reason, 'MISSION_WORKER_CLAIM_OWNER_ALIVE');

    const current = await inspectMissionWorkerClaimOwnership({
      queueRoot: f.root,
      adapter: 'foundry-forge',
      actionId: 'action-5',
      queueItemSha256: f.digest,
    }, liveness);
    assert.equal(current.state, 'alive');
    assert.equal(current.owner.token, winners[0].owner.token);
    assert.equal(await dead.release(), false);
    assert.equal(await winners[0].release(), true);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
