import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyHostedIdeaStagingAction,
  buildHostedStagingHandoffPayload,
  createDefaultHostedIdeaStagingQueue,
  normalizeHostedIdeaStagingQueue,
} from './hostedIdeaStaging.mjs';

test('hosted idea staging add normalizes staged-not-canon payload', () => {
  const base = createDefaultHostedIdeaStagingQueue();
  const { queue, item } = applyHostedIdeaStagingAction(base, {
    type: 'add',
    item: {
      type: 'mission',
      title: 'Hosted mission candidate',
      sourceProvider: 'gemini',
      canonicalEligibility: true,
    },
  }, { now: '2026-04-22T00:00:00.000Z' });

  assert.equal(queue.items.length, 1);
  assert.equal(item.type, 'mission');
  assert.equal(item.status, 'staged');
  assert.equal(item.canonicalEligibility, false);
});

test('promotion stays deferred when trusted persistence is unavailable', () => {
  const added = applyHostedIdeaStagingAction(createDefaultHostedIdeaStagingQueue(), {
    type: 'add',
    item: { title: 'Deferred candidate', sourceProvider: 'groq' },
  }, { now: '2026-04-22T00:00:00.000Z' });

  const promoted = applyHostedIdeaStagingAction(added.queue, {
    type: 'promote',
    id: added.item.id,
  }, { now: '2026-04-22T00:01:00.000Z', localAuthorityAvailable: false });

  assert.equal(promoted.item.status, 'staged');
  assert.equal(promoted.item.promotionState, 'deferred');
  assert.match(promoted.item.promotionReason, /deferred/i);
});

test('normalize queue stays bounded and handoff export includes staged truth', () => {
  const normalized = normalizeHostedIdeaStagingQueue({
    items: Array.from({ length: 140 }).map((_, index) => ({ title: `item-${index + 1}` })),
  });
  assert.equal(normalized.items.length, 120);

  const payload = buildHostedStagingHandoffPayload(normalized.items[0]);
  assert.match(payload, /Hosted staged item:/);
  assert.match(payload, /Promotion state:/);
});
