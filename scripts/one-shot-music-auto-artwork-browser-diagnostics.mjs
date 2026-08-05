import { readFileSync, writeFileSync } from 'node:fs';

const path = 'tests/music-tile-rating-playback-browser.test.mjs';
let source = readFileSync(path, 'utf8');

function replaceOnce(needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (source.indexOf(needle, first + needle.length) >= 0) throw new Error(`Non-unique patch anchor: ${label}`);
  source = `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

replaceOnce(
`    await page.waitForFunction(() => (
      document.getElementById('native-music-search-status')?.textContent?.includes('updated automatically')
    ));`,
`    await page.waitForFunction(({ trackId, spotifyUrl }) => (
      document.querySelector(\`[data-link-input="spotify-\${trackId}"]\`)?.value === spotifyUrl
    ), { trackId: AUTO_TRACK_ID, spotifyUrl: AUTO_SPOTIFY_URL });`,
'legacy manual-search wait uses card truth',
);

replaceOnce(
`    const page = await browser.newPage({ viewport: { width: 820, height: 1180 } });
    let catalogRequests = 0;
    await page.route('https://i.scdn.co/**', async (route) => {`,
`    const page = await browser.newPage({ viewport: { width: 820, height: 1180 } });
    let catalogRequests = 0;
    const pageErrors = [];
    const browserConsole = [];
    page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error?.message || error)));
    page.on('console', (message) => browserConsole.push(\`\${message.type()}: \${message.text()}\`));
    await page.route('https://i.scdn.co/**', async (route) => {`,
'no-click browser diagnostics listeners',
);

replaceOnce(
`    await page.goto(\`\${server.origin}/apps/music-tile/index.html\`);
    await page.waitForFunction(({ trackId, spotifyUrl, artworkUrl }) => {
      const input = document.querySelector(\`[data-link-input="spotify-\${trackId}"]\`);
      const image = document.querySelector('[data-catalog-artwork] img');
      return input?.value === spotifyUrl && image?.src === artworkUrl;
    }, { trackId: AUTO_TRACK_ID, spotifyUrl: AUTO_SPOTIFY_URL, artworkUrl: AUTO_ARTWORK_URL });

    const proof = await page.evaluate`,
`    await page.goto(\`\${server.origin}/apps/music-tile/index.html\`);
    try {
      await page.waitForFunction(({ trackId, spotifyUrl, artworkUrl }) => {
        const input = document.querySelector(\`[data-link-input="spotify-\${trackId}"]\`);
        const image = document.querySelector('[data-catalog-artwork] img');
        return input?.value === spotifyUrl && image?.src === artworkUrl;
      }, { trackId: AUTO_TRACK_ID, spotifyUrl: AUTO_SPOTIFY_URL, artworkUrl: AUTO_ARTWORK_URL }, { timeout: 10000 });
    } catch (error) {
      const diagnostic = await page.evaluate(({ key, trackId }) => {
        let stored = null;
        try { stored = JSON.parse(localStorage.getItem(key)); } catch {}
        const track = stored?.listeningDeck?.find?.((item) => item.id === trackId) || null;
        const input = document.querySelector(\`[data-link-input="spotify-\${trackId}"]\`);
        const card = input?.closest('.player-deck-card') || document.querySelector('.player-deck-card');
        const image = card?.querySelector('[data-catalog-artwork] img');
        return {
          readyState: document.readyState,
          track,
          inputValue: input?.value || '',
          artworkSrc: image?.src || '',
          artworkPanelPresent: Boolean(card?.querySelector('[data-catalog-artwork]')),
          cardPresent: Boolean(card),
          cardText: String(card?.textContent || '').slice(0, 1200),
          nativeStatus: document.getElementById('native-music-search-status')?.textContent || '',
          bodyText: String(document.body?.textContent || '').slice(0, 1600),
        };
      }, { key: STORAGE_KEY, trackId: AUTO_TRACK_ID });
      throw new Error(\`AUTO_URL_ARTWORK_DIAGNOSTIC=\${JSON.stringify({
        catalogRequests,
        pageErrors,
        browserConsole: browserConsole.slice(-30),
        diagnostic,
        waitError: String(error?.message || error),
      })}\`);
    }

    const proof = await page.evaluate`,
'no-click browser diagnostic failure payload',
);

writeFileSync(path, source, 'utf8');
console.log('MUSIC_AUTO_ARTWORK_BROWSER_DIAGNOSTICS_PATCHED=YES');
