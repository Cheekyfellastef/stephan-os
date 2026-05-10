import test from 'node:test';
import assert from 'node:assert/strict';
import setupRouter from '../stephanos-server/routes/setup.js';

test('Backend setup route reports missing secrets without values', async () => {
  const layer = setupRouter.stack.find((entry) => entry.route?.path === '/integrations');
  let payload = null;
  const original = process.env.SPOTIFY_CLIENT_ID;
  const originalSecret = process.env.SPOTIFY_CLIENT_SECRET;
  delete process.env.SPOTIFY_CLIENT_ID;
  delete process.env.SPOTIFY_CLIENT_SECRET;
  await layer.route.stack[0].handle({}, { json(value) { payload = value; } });
  process.env.SPOTIFY_CLIENT_ID = original;
  process.env.SPOTIFY_CLIENT_SECRET = originalSecret;
  const spotify = payload.integrations.find((row) => row.id === 'spotify-catalog');
  assert.equal(spotify.configured, false);
  assert.ok(Array.isArray(spotify.missingSecrets));
  assert.equal(JSON.stringify(payload).includes('secret-value'), false);
});
