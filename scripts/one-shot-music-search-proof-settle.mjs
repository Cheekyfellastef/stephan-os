import { readFileSync, writeFileSync } from 'node:fs';

const path = 'tests/music-tile-rating-playback-browser.test.mjs';
let source = readFileSync(path, 'utf8');
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
const first = source.indexOf(needle);
if (first < 0) throw new Error('Manual-search proof anchor missing');
if (source.indexOf(needle, first + needle.length) >= 0) throw new Error('Manual-search proof anchor is not unique');
source = `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
writeFileSync(path, source, 'utf8');
console.log('MUSIC_SEARCH_PROOF_SETTLED=YES');
