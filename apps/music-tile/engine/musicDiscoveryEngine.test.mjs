import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscoveryQueries, createFlowQueue, scoreMediaItem } from './musicDiscoveryEngine.js';

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
