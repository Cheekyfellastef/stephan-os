import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('connector feed applies in place without rebuilding the listening deck', () => {
  const start = source.indexOf('async function refreshVerifiedSpotifyLinks()');
  const end = source.indexOf('\n\nfunction renderAiResultPanel', start);
  const implementation = source.slice(start, end);
  assert.match(implementation, /updateConnectorTargetCard\(track, incoming\)/);
  assert.doesNotMatch(implementation, /renderListeningDeck\(|renderAll\(/);
  assert.match(source, /spotifyInput\.value = spotify\.openUrl/);
  assert.match(source, /current\.uri !== incoming\.uri/);
  assert.match(source, /AI suggestion · \$\{getCandidateVerificationStatus\(track\)\}/);
  assert.match(source, /verificationBadge\.classList\.add\('music-badge--success'\)/);
});
