import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMusicMissionContext } from '../apps/music-tile/engine/musicMissionContext.js';

test('Mission Console can summarize Spotify setup requirements', () => {
  const context = buildMusicMissionContext({
    integrationSetupSnapshot: {
      configured: false,
      status: 'not-configured',
      missingSecrets: ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'],
      nextAction: 'Add secrets and retest.',
    },
  });
  assert.equal(context.spotify.setup.configured, false);
  assert.match(context.spotify.setup.missingSecrets.join(','), /SPOTIFY_CLIENT_ID/);
});
