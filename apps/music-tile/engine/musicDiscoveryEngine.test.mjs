import test from 'node:test';
import assert from 'node:assert/strict';

import { applyArtistSearchContext, createDiscoveryQueries, createFlowQueue, scoreMediaItem } from './musicDiscoveryEngine.js';

test('createDiscoveryQueries expands artist into query strategy set', () => {
  const queries = createDiscoveryQueries({ name: 'Anyma', collaborators: ['Chris Avantgarde'], labels: ['Afterlife'] });
  assert.ok(queries.includes('Anyma live'));
  assert.ok(queries.includes('Anyma Afterlife set'));
});

test('scoreMediaItem rewards long-form trusted set and penalizes seen items', () => {
  const score = scoreMediaItem({
    id: 'abc12345678',
    title: 'Anyma Afterlife Full Set',
    channelId: 'trusted-1',
    duration: 4200,
    publishDate: '2026-01-02T00:00:00.000Z',
    type: 'set',
    detectedArtists: ['Anyma'],
  }, {
    trustByChannel: { 'trusted-1': 4 },
    affinityByArtist: { Anyma: 2 },
    seenIds: new Set(),
  });

  const seenPenalty = scoreMediaItem({
    id: 'abc12345678',
    title: 'Anyma Afterlife Full Set',
    channelId: 'trusted-1',
    duration: 4200,
    publishDate: '2026-01-02T00:00:00.000Z',
    type: 'set',
    detectedArtists: ['Anyma'],
  }, {
    trustByChannel: { 'trusted-1': 4 },
    affinityByArtist: { Anyma: 2 },
    seenIds: new Set(['abc12345678']),
  });

  assert.ok(score > seenPenalty);
});

test('createFlowQueue excludes seen and ignored by default', () => {
  const queue = createFlowQueue([
    { id: '1', title: 'A', channelId: 'c', channelName: 'C', duration: 2400, type: 'set', seen: false, ignored: false, detectedArtists: [], playbackMode: 'inline' },
    { id: '2', title: 'B', channelId: 'c', channelName: 'C', duration: 2500, type: 'set', seen: true, ignored: false, detectedArtists: [], playbackMode: 'inline' },
    { id: '3', title: 'C', channelId: 'c', channelName: 'C', duration: 2500, type: 'set', seen: false, ignored: true, detectedArtists: [], playbackMode: 'inline' },
    { id: '4', title: 'D', channelId: 'c', channelName: 'C', duration: 2600, type: 'set', seen: false, ignored: false, detectedArtists: [], playbackMode: 'suppress' },
  ], {});

  assert.equal(queue.length, 1);
  assert.equal(queue[0].id, '1');
});

test('applyArtistSearchContext tiers strong, soft, and general without starving queue', () => {
  const context = applyArtistSearchContext([
    {
      id: 'strong-1',
      title: 'Anyma Live in Tulum',
      description: 'Official stream',
      channelName: 'Afterlife Official',
      detectedArtists: ['Anyma'],
      detectedEvents: ['afterlife'],
      detectedLabels: [],
    },
    {
      id: 'soft-1',
      title: 'Afterlife Event Highlights',
      description: 'Scene mix featuring melodic techno',
      channelName: 'Festival TV',
      detectedArtists: [],
      detectedEvents: ['afterlife'],
      detectedLabels: [],
      artistSearchSource: 'Anyma live',
    },
    {
      id: 'general-1',
      title: 'Melodic techno journey',
      description: 'Discovered by algorithm',
      channelName: 'Discovery Channel',
      detectedArtists: [],
      detectedEvents: [],
      detectedLabels: [],
    },
  ], {
    activeArtists: [{ name: 'Anyma' }],
    artistSearchActive: true,
  });

  assert.equal(context.filteredItems.length, 3);
  assert.equal(context.counts.strong, 1);
  assert.equal(context.counts.soft, 1);
  assert.equal(context.counts.general, 1);
});
