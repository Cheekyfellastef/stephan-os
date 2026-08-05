import { readFileSync, writeFileSync } from 'node:fs';

const path = 'tests/music-tile-rating-playback-browser.test.mjs';
let source = readFileSync(path, 'utf8');
const testMarker = "test('iPad-width native search writes the Spotify URL into an existing card automatically'";
const testStart = source.indexOf(testMarker);
if (testStart < 0) throw new Error('Manual-search test marker missing');
const needle = `    await page.waitForFunction(({ trackId, spotifyUrl }) => (
      document.querySelector(\`[data-link-input="spotify-\${trackId}"]\`)?.value === spotifyUrl
    ), { trackId: AUTO_TRACK_ID, spotifyUrl: AUTO_SPOTIFY_URL });`;
const replacement = `    await page.waitForFunction(({ trackId, spotifyUrl }) => {
      const input = document.querySelector(\`[data-link-input="spotify-\${trackId}"]\`);
      const resultButton = document.querySelector('[data-action="add-native-catalog-result"]');
      return input?.value === spotifyUrl
        && resultButton?.disabled === true
        && resultButton?.textContent?.trim() === 'In Listening Room';
    }, { trackId: AUTO_TRACK_ID, spotifyUrl: AUTO_SPOTIFY_URL });`;
const relative = source.slice(testStart).indexOf(needle);
if (relative < 0) throw new Error('Manual-search proof anchor missing inside target test');
const first = testStart + relative;
source = `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
writeFileSync(path, source, 'utf8');
console.log('MUSIC_SEARCH_PROOF_SETTLED=YES');
