import test from 'node:test';
import assert from 'node:assert/strict';

import { getMediaPlaybackLinkState } from './youtubeLinkResolver.js';

test('getMediaPlaybackLinkState returns exact playable watch url when provider item id is valid', () => {
  const state = getMediaPlaybackLinkState({
    providerItemId: 'abc12345678',
    title: 'Track',
    channelName: 'Channel',
  });

  assert.equal(state.hasExactVideo, true);
  assert.equal(state.reason, 'provider_item_id');
  assert.equal(state.label, 'Play');
  assert.equal(state.url, 'https://www.youtube.com/watch?v=abc12345678');
});

test('getMediaPlaybackLinkState returns search-only descriptor when no valid video id exists', () => {
  const state = getMediaPlaybackLinkState({
    providerItemId: '',
    canonicalQuery: 'Layla Benitez All I Need official audio',
    title: 'All I Need',
    artist: 'Layla Benitez',
  });

  assert.equal(state.hasExactVideo, false);
  assert.equal(state.reason, 'search_query');
  assert.equal(state.label, 'Find on YouTube');
  assert.ok(state.url.startsWith('https://www.youtube.com/results?search_query='));
});
