import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  GITHUB_LIFEBOAT_LANE7_CLAIM_ACK_KEEPER_SCHEMA,
  refreshGitHubLifeboatLane7ClaimAck,
} from './githubLifeboatLane7ClaimAckKeeper.js';

const HEAD = 'a'.repeat(40);
const ACTION_ID = 'lane7-action-001';
const MISSION_ID = 'critical-1622-lane7-canary';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-lane7-claim-ack-'));
  const processing = join(root, 'chatgpt-github', 'processing');
  await mkdir(processing, { recursive: true });
  const item = {
    schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    adapter: 'chatgpt-github',
    actionId: ACTION_ID,
    missionId: MISSION_ID,
    createdAt: '2026-09-18T10:00:00.000Z',
    actionGrant: {
      repository: 'Cheekyfellastef/stephan-os',
      issueNumber: 1622,
      prNumber: 0,
      branch: 'fix/lane7-canary',
      headSha: HEAD,
      sourceRevision: HEAD,
    },
    payload: {
      actionKind: 'agent-handoff',
      adapter: 'chatgpt-github',
      actionId: ACTION_ID,
      missionId: MISSION_ID,
      repository: 'Cheekyfellastef/stephan-os',
      branch: 'fix/lane7-canary',
      allowedFiles: ['shared/agents/example.mjs'],
      requiredTests: ['node --test shared/agents/example.test.mjs'],
      requiredEvidence: ['focused-test-output'],
      capacityReceiptId: 'lane7-capacity-001',
      capacityProofRefs: ['proof/lane7-capacity.json'],
    },
  };
  await writeFile(join(processing, `${ACTION_ID}.json`), `${JSON.stringify(item, null, 2)}\n`, 'utf8');
  return { root, processing };
}

test('processing claim is republished as CLAIM_ACCEPTED on every heartbeat until completion removes it', async () => {
  const { root } = await fixture();
  const bodies = [];
  try {
    const options = {
      queueRoot: root,
      sourceHead: HEAD,
      writeOutbox: async (body) => {
        bodies.push(body);
        return { ok: true, reason: 'TEST_OUTBOX_WRITE_PASS' };
      },
    };
    const first = await refreshGitHubLifeboatLane7ClaimAck(options);
    const second = await refreshGitHubLifeboatLane7ClaimAck(options);

    assert.equal(first.schemaVersion, GITHUB_LIFEBOAT_LANE7_CLAIM_ACK_KEEPER_SCHEMA);
    assert.equal(first.ok, true);
    assert.equal(first.published, true);
    assert.equal(first.state, 'CLAIM_ACCEPTED');
    assert.equal(first.actionId, ACTION_ID);
    assert.equal(first.missionId, MISSION_ID);
    assert.equal(second.finalVerdict, 'GITHUB_LIFEBOAT_LANE7_CLAIM_ACK_PUBLISHED');
    assert.equal(bodies.length, 2);
    for (const body of bodies) {
      assert.match(body, /"state": "CLAIM_ACCEPTED"/);
      assert.match(body, new RegExp(ACTION_ID));
      assert.match(body, new RegExp(MISSION_ID));
      assert.match(body, /"authoritativeQueueState": "processing"/);
      assert.match(body, /"mergeAuthority": false/);
      assert.match(body, /"runtimeMutationAuthority": false/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('claim acknowledgement disappears naturally after the processing item is removed', async () => {
  const { root, processing } = await fixture();
  try {
    await rm(join(processing, `${ACTION_ID}.json`));
    const result = await refreshGitHubLifeboatLane7ClaimAck({
      queueRoot: root,
      sourceHead: HEAD,
      writeOutbox: async () => {
        throw new Error('outbox must not be touched without an active claim');
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.published, false);
    assert.equal(result.state, 'NO_ACTIVE_CLAIM');
    assert.equal(result.finalVerdict, 'GITHUB_LIFEBOAT_LANE7_NO_ACTIVE_CLAIM');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('multiple processing items fail closed instead of acknowledging an ambiguous owner', async () => {
  const { root, processing } = await fixture();
  try {
    const second = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(join(processing, `${ACTION_ID}.json`), 'utf8')));
    second.actionId = 'lane7-action-002';
    second.missionId = 'critical-1622-lane7-canary-2';
    second.payload.actionId = second.actionId;
    second.payload.missionId = second.missionId;
    await writeFile(join(processing, `${second.actionId}.json`), `${JSON.stringify(second, null, 2)}\n`, 'utf8');

    const result = await refreshGitHubLifeboatLane7ClaimAck({
      queueRoot: root,
      sourceHead: HEAD,
      writeOutbox: async () => ({ ok: true }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.published, false);
    assert.equal(result.state, 'SAFE_HOLD');
    assert.equal(result.reason, 'LANE7_CLAIM_ACK_MULTIPLE_PROCESSING_ITEMS');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
