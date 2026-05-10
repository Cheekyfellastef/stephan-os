import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationSetupModel } from '../shared/runtime/integrationSetupModel.mjs';

test('Spotify setup model lists required env vars', () => {
  const rows = buildIntegrationSetupModel({ env: {} });
  const spotify = rows.find((row) => row.id === 'spotify-catalog');
  assert.ok(spotify);
  assert.deepEqual(spotify.requiredSecrets, ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET']);
  assert.equal(spotify.configured, false);
});
