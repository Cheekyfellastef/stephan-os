import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(path, needle, replacement) {
  const source = readFileSync(path, 'utf8');
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`Missing patch anchor in ${path}`);
  if (source.indexOf(needle, first + needle.length) >= 0) throw new Error(`Non-unique patch anchor in ${path}`);
  writeFileSync(path, `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`, 'utf8');
}

replaceOnce(
  'apps/music-tile/engine/nativeCatalogAutoApply.js',
  `  if (artistCoverage <= 0) return 0;`,
  `  if (artistCoverage < 0.8) return 0;`,
);

const testPath = 'tests/music-intelligence-centre-vnext.test.mjs';
let tests = readFileSync(testPath, 'utf8');
const testBlock = `

test('automatic deck resolution rejects a same-title result with only incidental artist overlap', async () => {
  const snapshot = {
    listeningDeck: [existingCatalogTrack()],
    ratings: {},
    tags: {},
    trackFeedback: {},
  };
  const data = new Map([[STORAGE_KEY_FOR_TEST, JSON.stringify(snapshot)]]);
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
  const result = await resolveUnlinkedDeckTracks({
    storage,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        results: [verifiedCatalogResult({ artist: 'Mode Seven' })],
      }),
    }),
  });
  const stored = JSON.parse(storage.getItem(STORAGE_KEY_FOR_TEST));
  assert.equal(result.resolvedCount, 0);
  assert.equal(stored.listeningDeck[0].spotifyUrl, undefined);
  assert.equal(stored.listeningDeck[0].artworkUrl, undefined);
});
`;
if (tests.includes("automatic deck resolution rejects a same-title result with only incidental artist overlap")) {
  throw new Error('Identity hardening regression already exists');
}
tests += testBlock;
writeFileSync(testPath, tests, 'utf8');

console.log('MUSIC_AUTO_ARTWORK_IDENTITY_HARDENING_APPLIED=YES');
