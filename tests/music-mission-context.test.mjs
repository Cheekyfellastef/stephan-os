import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMusicMissionContext } from '../apps/music-tile/engine/musicMissionContext.js';

test('buildMusicMissionContext returns compact state with taste and pipeline counts', () => {
  const context = buildMusicMissionContext({
    discoveryPipeline: { query: 'Anyma', verifiedCandidates: [{}], searchLeads: [{}, {}], fallbackCandidates: [{}] },
    tasteDNA: { melodic: { polarity: 'positive', weight: 3 }, flat: { polarity: 'negative', weight: 2 } },
    listeningDeck: [{ id: '1', spotifyUrl: 'https://open.spotify.com/track/x' }],
    aiCandidateAudit: [{ status: 'likely_hallucinated' }],
  });
  assert.equal(context.tile, 'music');
  assert.equal(context.discoveryPipeline.verifiedCount, 1);
  assert.equal(context.discoveryPipeline.searchLeadCount, 2);
  assert.equal(context.verification.hallucinated, 1);
  assert.match(context.plainEnglishSummary, /Music Tile is currently exploring/i);
});
