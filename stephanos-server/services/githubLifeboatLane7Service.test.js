import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  GITHUB_LIFEBOAT_LANE7_INBOX_COMMENT_ID,
  GITHUB_LIFEBOAT_LANE7_INBOX_MARKER,
  GITHUB_LIFEBOAT_LANE7_INBOX_SCHEMA,
  GITHUB_LIFEBOAT_LANE7_WORKER_ID,
  runGitHubLifeboatLane7,
} from './githubLifeboatLane7Service.js';

const NOW = new Date('2026-09-18T10:30:00.000Z');
const HEAD = 'a'.repeat(40);
const RESULT = 'd'.repeat(40);
const PATH = 'shared/agents/lane7-test.mjs';

function inbox(state = 'READY', overrides = {}) {
  const body = {
    schemaVersion: GITHUB_LIFEBOAT_LANE7_INBOX_SCHEMA,
    state,
    workerId: GITHUB_LIFEBOAT_LANE7_WORKER_ID,
    observedAtUtc: NOW.toISOString(),
    expiresAtUtc: new Date(NOW.getTime() + 4 * 60 * 1000).toISOString(),
    sourceHead: HEAD,
    p95StartLatencySeconds: 10,
    claim: null,
    completion: null,
    ...overrides,
  };
  return {
    ok: true,
    authorLogin: 'Cheekyfellastef',
    body: `${GITHUB_LIFEBOAT_LANE7_INBOX_MARKER}\n\`\`\`json\n${JSON.stringify(body)}\n\`\`\``,
  };
}

function adapter(observed, writes = []) {
  return {
    readComment(commentId) {
      assert.equal(commentId, GITHUB_LIFEBOAT_LANE7_INBOX_COMMENT_ID);
      return observed;
    },
    writeComment(commentId, body) {
      writes.push({ commentId, body });
      return { ok: true };
    },
  };
}

function baseOptions(observed, extra = {}) {
  const writes = [];
  const publications = [];
  return {
    writes,
    publications,
    options: {
      now: NOW,
      paths: { repoRoot: 'C:/repo', workspaceRoot: 'C:/workspace' },
      readSourceHead: async () => HEAD,
      adapter: adapter(observed, writes),
      readQueue: async () => [],
      writeProof: async () => ({ ok: true }),
      publishCapacity: async (observation) => {
        publications.push(observation);
        return { finalVerdict: 'GITHUB_CONTINUITY_CAPACITY_PUBLISHED', publication: { ok: true } };
      },
      writeOutbox: async (body) => {
        writes.push({ commentId: 'outbox', body });
        return { ok: true };
      },
      ...extra,
    },
  };
}

test('fresh authenticated Lane 7 heartbeat publishes canonical CHATGPT_GITHUB focused-repair capacity', async () => {
  const fixture = baseOptions(inbox());
  const result = await runGitHubLifeboatLane7(fixture.options);
  assert.equal(result.ok, true);
  assert.equal(result.capacity.available, true);
  assert.equal(fixture.publications.length, 1);
  assert.equal(fixture.publications[0].route, 'CHATGPT_GITHUB');
  assert.equal(fixture.publications[0].workerId, GITHUB_LIFEBOAT_LANE7_WORKER_ID);
  assert.deepEqual(fixture.publications[0].supportedTaskClasses, ['FOCUSED_REPAIR']);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
});

test('stale or wrong-head Lane 7 heartbeat never becomes build capacity', async () => {
  const stale = baseOptions(inbox('READY', {
    observedAtUtc: '2026-09-18T10:00:00.000Z',
    expiresAtUtc: '2026-09-18T10:04:00.000Z',
  }));
  const staleResult = await runGitHubLifeboatLane7(stale.options);
  assert.equal(staleResult.capacity.available, false);
  assert.equal(stale.publications.length, 0);

  const wrongHead = baseOptions(inbox('READY', { sourceHead: 'b'.repeat(40) }));
  const wrongHeadResult = await runGitHubLifeboatLane7(wrongHead.options);
  assert.equal(wrongHeadResult.capacity.available, false);
  assert.equal(wrongHead.publications.length, 0);
});

test('Lane 7 projects one existing canonical chatgpt-github queue item without creating a second queue', async () => {
  const actionId = 'lane7-action-001';
  const missionId = 'goal-1622-lane7';
  const queue = [{
    adapter: 'chatgpt-github',
    item: {
      schemaVersion: 'stephanos.mission-worker-queue-item.v1',
      adapter: 'chatgpt-github',
      actionId,
      missionId,
      createdAt: NOW.toISOString(),
      actionGrant: {
        repository: 'Cheekyfellastef/stephan-os', issueNumber: 1622, prNumber: 0,
        branch: 'fix/lane7-test', headSha: HEAD, sourceRevision: HEAD,
      },
      payload: {
        actionId, missionId, adapter: 'chatgpt-github', repository: 'Cheekyfellastef/stephan-os',
        branch: 'fix/lane7-test', allowedFiles: [PATH], requiredTests: ['node --test lane7.test.mjs'],
        requiredEvidence: ['focused tests'], capacityReceiptId: 'lane7-capacity', capacityProofRefs: ['proof/lane7.json'],
      },
    },
  }];
  const fixture = baseOptions(inbox(), {
    readQueue: async () => queue,
    readWorkspaceHandoff: async () => ({ handoffId: actionId, toParticipantId: 'chatgpt', correlationId: missionId }),
  });
  const result = await runGitHubLifeboatLane7(fixture.options);
  assert.equal(result.outbox.payload.state, 'HANDOFF_READY');
  assert.equal(result.outbox.payload.handoff.actionId, actionId);
  assert.equal(result.outbox.payload.handoff.headSha, HEAD);
  assert.deepEqual(result.outbox.payload.handoff.allowedFiles, [PATH]);
  assert.equal(result.outbox.payload.handoff.authority.mergeAuthority, false);
});

test('Lane 7 completion advances only after exact external escrow is proven', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lane7-'));
  const processing = join(root, 'processing');
  const completed = join(root, 'completed');
  const failed = join(root, 'failed');
  await Promise.all([mkdir(processing), mkdir(completed), mkdir(failed)]);
  const actionId = 'lane7-action-escrow';
  const missionId = 'goal-1622-lane7-escrow';
  const processingPath = join(processing, `${actionId}.json`);
  const actionGrant = {
    repository: 'Cheekyfellastef/stephan-os', issueNumber: 1622, prNumber: 0,
    branch: 'fix/lane7-test', headSha: HEAD, sourceRevision: HEAD,
  };
  const payload = {
    actionId, missionId, adapter: 'chatgpt-github', repository: 'Cheekyfellastef/stephan-os',
    branch: 'fix/lane7-test', allowedFiles: [PATH], requiredTests: ['node --test lane7.test.mjs'],
  };
  const item = { actionId, missionId, actionGrant, payload };
  await writeFile(processingPath, JSON.stringify(item));
  const escrow = {
    schemaVersion: 'stephanos.source-artifact-escrow.v1', artifactKind: 'EXACT_COMMIT', repository: 'Cheekyfellastef/stephan-os',
    canonicalIssue: 1622, canonicalPr: null, canonicalBranch: 'fix/lane7-test', exactParentHead: HEAD,
    exactParentTree: 'b'.repeat(40), exactResultTree: 'c'.repeat(40), localCommitSha: RESULT,
    completeArtifactSha256: 'e'.repeat(64), artifactRef: `https://github.com/Cheekyfellastef/stephan-os/commit/${RESULT}`,
    externallyReadable: true, commitMessage: 'Lane 7 test', executorIdentity: 'chatgpt-github',
    changedFiles: [{ path: PATH, beforeBlobSha: '1'.repeat(40), afterBlobSha: '2'.repeat(40), sha256: '3'.repeat(64) }],
    testsRun: ['node --test lane7.test.mjs'], testVerdicts: ['PASS'], diffCheckVerdict: 'PASS',
    createdAtUtc: NOW.toISOString(), expiresAtUtc: new Date(NOW.getTime() + 10 * 60 * 1000).toISOString(),
  };
  const completion = {
    actionId, missionId, success: true, resultId: 'lane7-result-001', changedFiles: [PATH],
    receipt: { requirement: 'source proof', source: 'chatgpt-github', evidenceType: 'EXTERNAL_LANE_COMPLETION', verified: true, sha256: '4'.repeat(64) },
    evidenceReceipts: [{ requirement: 'focused tests', source: 'github-actions', evidenceType: 'TEST', verified: true, sha256: '5'.repeat(64), receiptPath: 'receipts/lane7-test.json' }],
    completedAtUtc: NOW.toISOString(), sourceArtifactEscrow: escrow,
  };
  let collected = null;
  const fixture = baseOptions(inbox('COMPLETED', { completion }), {
    readQueue: async () => [],
    loadProcessingClaim: async () => ({ adapter: 'chatgpt-github', item, processingPath, paths: { processing, completed, failed, pending: join(root, 'pending') } }),
    verifyPublishedEscrow: async () => ({ ok: true, branch: 'fix/lane7-test', parentHead: HEAD, resultCommit: RESULT }),
    collectResult: async (input) => {
      collected = input;
      return { state: { revision: 9, currentPhase: 'GITHUB_COMMIT' } };
    },
  });
  const result = await runGitHubLifeboatLane7(fixture.options);
  assert.equal(result.completion.ok, true);
  assert.equal(result.completion.result.success, true);
  assert.equal(collected.adapter, 'chatgpt-github');
  assert.deepEqual(collected.changedFiles, [PATH]);
  assert.match(await readFile(join(completed, `${actionId}.result.json`), 'utf8'), /GITHUB_LIFEBOAT_LANE7_SOURCE_CHANGED_AND_TESTED/);

  const missingEscrow = baseOptions(inbox('COMPLETED', { completion: { ...completion, sourceArtifactEscrow: null } }), {
    readQueue: async () => [],
    loadProcessingClaim: async () => ({ adapter: 'chatgpt-github', item, processingPath: join(processing, 'missing.json'), paths: { processing, completed, failed, pending: join(root, 'pending') } }),
    verifyPublishedEscrow: async () => ({ ok: false, reason: 'LANE7_ESCROW_REQUIRED' }),
    collectResult: async () => { throw new Error('must not collect'); },
  });
  const blocked = await runGitHubLifeboatLane7(missingEscrow.options);
  assert.equal(blocked.completion.ok, false);
  assert.match(blocked.completion.reason, /ESCROW/);
});
