import test from 'node:test';
import assert from 'node:assert/strict';

import { createYouTubeMediaProviderAdapter } from './youtubeMediaProviderAdapter.js';

test('youtube adapter classifies embeddable processed video as inline', () => {
  const adapter = createYouTubeMediaProviderAdapter({ apiKey: 'key', fetchImpl: async () => ({ ok: false }) });
  const validated = adapter.validateCandidate({
    id: 'abc12345678',
    provider: 'youtube',
    providerItemId: 'abc12345678',
    title: 'Test',
  }, {
    enrichedById: {
      abc12345678: {
        status: { embeddable: true, privacyStatus: 'public', uploadStatus: 'processed' },
        contentDetails: { duration: 'PT1H2M3S' },
      },
    },
    regionCode: 'US',
  });

  assert.equal(validated.playbackMode, 'inline');
  assert.equal(validated.duration, 3723);
  assert.equal(validated.capabilities.canPlayInline, true);
});

test('youtube adapter classifies embed blocked as external and private as suppress', () => {
  const adapter = createYouTubeMediaProviderAdapter({ apiKey: 'key', fetchImpl: async () => ({ ok: false }) });
  const externalOnly = adapter.validateCandidate({
    id: 'emb12345678',
    provider: 'youtube',
    providerItemId: 'emb12345678',
    title: 'Embed blocked',
  }, {
    enrichedById: {
      emb12345678: {
        status: { embeddable: false, privacyStatus: 'public', uploadStatus: 'processed' },
        contentDetails: { duration: 'PT45M' },
      },
    },
    regionCode: 'US',
  });

  const suppressed = adapter.validateCandidate({
    id: 'pri12345678',
    provider: 'youtube',
    providerItemId: 'pri12345678',
    title: 'Private',
  }, {
    enrichedById: {
      pri12345678: {
        status: { embeddable: false, privacyStatus: 'private', uploadStatus: 'processed' },
        contentDetails: { duration: 'PT45M' },
      },
    },
    regionCode: 'US',
  });

  assert.equal(externalOnly.playbackMode, 'external');
  assert.ok(externalOnly.validationReasons.includes('youtube.embed_blocked'));
  assert.equal(suppressed.playbackMode, 'suppress');
  assert.ok(suppressed.validationReasons.includes('youtube.private'));
});


test('youtube adapter selects enriched thumbnail from videos snippet', () => {
  const adapter = createYouTubeMediaProviderAdapter({ apiKey: 'key', fetchImpl: async () => ({ ok: false }) });
  const validated = adapter.validateCandidate({
    id: 'thumb1234567',
    provider: 'youtube',
    providerItemId: 'thumb1234567',
    title: 'Thumbnail test',
    thumbnail: 'https://example.com/search-medium.jpg',
    thumbnailSource: 'youtube-search-snippet',
  }, {
    enrichedById: {
      thumb1234567: {
        snippet: {
          thumbnails: {
            high: { url: 'https://example.com/high.jpg' },
            maxres: { url: 'https://example.com/maxres.jpg' },
          },
        },
        status: { embeddable: true, privacyStatus: 'public', uploadStatus: 'processed' },
        contentDetails: { duration: 'PT5M' },
      },
    },
    regionCode: 'US',
  });

  assert.equal(validated.thumbnail, 'https://example.com/maxres.jpg');
  assert.equal(validated.thumbnailSource, 'youtube-snippet');
});

test('youtube adapter thumbnail selector falls back across known sizes', () => {
  const adapter = createYouTubeMediaProviderAdapter({ apiKey: 'key', fetchImpl: async () => ({ ok: false }) });
  assert.equal(adapter.selectBestThumbnail({ medium: { url: 'https://example.com/med.jpg' } }), 'https://example.com/med.jpg');
  assert.equal(adapter.selectBestThumbnail({ default: { url: 'https://example.com/default.jpg' } }), 'https://example.com/default.jpg');
  assert.equal(adapter.selectBestThumbnail({}), '');
});
