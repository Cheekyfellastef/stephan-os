import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deriveSharedConversationUpliftV1,
  readSharedConversationUpliftV1,
} from './sharedConversationUpliftService.js';

const NOW = '2026-10-12T14:00:00.000Z';
function turn(id, message, role = 'operator') {
  return {
    channel: 'shared-stephanos-chat',
    recordSubtype: 'conversation-turn',
    correlationId: 'shared-operator-primary',
    timestampUtc: NOW,
    body: JSON.stringify({
      threadId: 'shared-operator-primary',
      turnId: id,
      senderParticipantId: role,
      text: message,
    }),
  };
}

test('only repeated conversation requests produce investigation candidates, never proofs', () => {
  const result = deriveSharedConversationUpliftV1([
    turn('turn-1', 'Can we fix the logical controllers and autonomous build pickup?'),
    turn('turn-2', 'Please repair autonomous build pickup and the stuck lease.'),
    turn('turn-3', 'Autonomous build pickup has been fixed.', 'stephanos'),
    turn('turn-2', 'Please repair autonomous build pickup and the stuck lease.'),
  ], { nowMs: Date.parse(NOW) });
  const candidate = result.candidates.find(row => row.id === 'autonomous-build-conveyor');
  assert.equal(result.turnCount, 3);
  assert.equal(candidate.mentionCount, 2);
  assert.equal(candidate.eligibleForBoundedInvestigation, true);
  assert.equal(candidate.provenCapabilityFailure, false);
  assert.equal(candidate.authorityGranted, false);
  assert.equal(result.completedBuilds, 0);
  assert.equal(JSON.stringify(result).includes('stuck lease'), false);
});

test('the full canonical inbox is indexed beyond the legacy 256-turn loading limit', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'conversation-uplift-'));
  const root = join(parent, 'shared');
  const repoRoot = join(parent, 'repo');
  await mkdir(join(root, 'inbox'), { recursive: true });
  await mkdir(repoRoot);
  for (let i = 0; i < 300; i += 1) {
    const record = turn('turn-' + String(i).padStart(4, '0'),
      i < 2 ? 'We need to fix GitHub 403 quota hammering.' : 'Conversation context.');
    await writeFile(join(root, 'inbox', 'shared-turn-' + i.toString(16).padStart(24, '0') + '.json'), JSON.stringify(record));
  }
  const result = await readSharedConversationUpliftV1({ root, repoRoot, nowMs: Date.parse(NOW), useCache: false });
  assert.equal(result.state, 'ready');
  assert.equal(result.turnCount, 300);
  assert.equal(result.scannedFileCount, 300);
  assert.equal(result.candidates.find(row => row.id === 'github-api-quota').eligibleForBoundedInvestigation, true);
});

test('incomplete files fail closed instead of promoting an incomplete sample', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'conversation-uplift-broken-'));
  const root = join(parent, 'shared');
  const repoRoot = join(parent, 'repo');
  await mkdir(join(root, 'inbox'), { recursive: true });
  await mkdir(repoRoot);
  await writeFile(join(root, 'inbox', 'shared-turn-' + 'f'.repeat(24) + '.json'), '{ invalid');
  const result = await readSharedConversationUpliftV1({ root, repoRoot, nowMs: Date.parse(NOW), useCache: false });
  assert.equal(result.state, 'partial');
  assert.equal(result.unreadableFileCount, 1);
  assert.equal(result.candidates.length, 0);
});

test('one unproven request never creates an eligible candidate', () => {
  const result = deriveSharedConversationUpliftV1([
    turn('turn-1', 'Can we upgrade Sovereign Commander?'),
  ], { nowMs: Date.parse(NOW) });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].eligibleForBoundedInvestigation, false);
  assert.equal(result.candidates[0].classification, 'CONVERSATION_HINT_REVIEW_REQUIRED');
});
