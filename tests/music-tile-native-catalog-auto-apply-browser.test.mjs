import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const STORAGE_KEY = 'stephanos.musicTile.dashboardState.v1';
const TRACK_ID = 'journey-enjoy-the-silence';
const SPOTIFY_ID = '4uLU6hMCjMI75M1A2tKUQC';
const SPOTIFY_URL = `https://open.spotify.com/track/${SPOTIFY_ID}`;
const SPOTIFY_URI = `spotify:track:${SPOTIFY_ID}`;
const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
});

function repositoryFile(requestUrl = '/') {
  const pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  const candidate = resolve(REPOSITORY_ROOT, `.${pathname}`);
  const rel = relative(REPOSITORY_ROOT, candidate);
  if (rel.startsWith('..') || rel === '') return '';
  return candidate;
}

async function startRepositoryServer() {
  const server = createServer(async (request, response) => {
    const candidate = repositoryFile(request.url);
    try {
      if (!candidate) throw Object.assign(new Error('invalid path'), { code: 'ENOENT' });
      await access(candidate);
      const info = await stat(candidate);
      if (!info.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': MIME_TYPES[extname(candidate)] || 'application/octet-stream',
      });
      createReadStream(candidate).pipe(response);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  return Object.freeze({
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolvePromise, rejectPromise) => {
      server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
    }),
  });
}

function cataloguePayload() {
  return {
    ok: true,
    provider: 'spotify',
    providerLabel: 'Spotify',
    results: [{
      universalId: `spotify:track:${SPOTIFY_ID}`,
      provider: 'spotify',
      providerItemId: SPOTIFY_ID,
      providerLabel: 'Spotify',
      providerUrl: SPOTIFY_URL,
      title: 'Enjoy the Silence',
      artist: 'Depeche Mode',
      album: 'Violator',
      confidence: 'high',
      verificationStatus: 'metadata_verified',
      playbackAvailability: 'playback_unverified',
      spotifyUrl: SPOTIFY_URL,
      spotifyUri: SPOTIFY_URI,
    }],
  };
}

test('iPad-width native search writes the Spotify URL into an existing card automatically', async () => {
  const server = await startRepositoryServer();
  let browser;
  try {
    browser = await chromium.launch(
      process.env.STEPHANOS_BROWSER_CHANNEL
        ? { channel: process.env.STEPHANOS_BROWSER_CHANNEL, headless: true }
        : { headless: true },
    );
    const page = await browser.newPage({ viewport: { width: 820, height: 1180 } });
    await page.route(/\/api\/music\/catalog\/search\?/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(cataloguePayload()),
      });
    });
    await page.addInitScript(({ key, trackId }) => {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, JSON.stringify({
        candidates: [],
        listeningDeck: [{
          id: trackId,
          title: 'Enjoy the Silence',
          artist: 'Depeche Mode',
          lane: 'doorway-track',
          sourceKind: 'journey-candidate',
          candidateVerificationStatus: 'search-only',
          traits: ['dark club pressure'],
        }],
        ratings: { [trackId]: 2 },
        tags: { [trackId]: ['ghost in the track'] },
        trackFeedback: { [trackId]: 'Keep this.' },
        linkMessages: {},
      }));
    }, { key: STORAGE_KEY, trackId: TRACK_ID });

    await page.goto(`${server.origin}/apps/music-tile/index.html`);
    await page.waitForSelector(`[data-link-input="spotify-${TRACK_ID}"]`, { state: 'attached' });
    await page.evaluate(() => {
      window.__catalogAutoApplyCard = document.querySelector('.player-deck-card');
    });

    await page.fill('#native-music-search-input', 'Enjoy the Silence');
    await page.click('#native-music-search-button');
    await page.waitForFunction(() => (
      document.getElementById('native-music-search-status')?.textContent?.includes('updated automatically')
    ));

    const proof = await page.evaluate(({ key, trackId, spotifyUrl }) => {
      const card = document.querySelector('.player-deck-card');
      const input = document.querySelector(`[data-link-input="spotify-${trackId}"]`);
      const openLink = Array.from(card.querySelectorAll('a')).find((link) => link.href === spotifyUrl);
      const stored = JSON.parse(localStorage.getItem(key));
      const track = stored.listeningDeck.find((item) => item.id === trackId);
      const resultButton = document.querySelector('[data-action="add-native-catalog-result"]');
      return {
        cardPreserved: card === window.__catalogAutoApplyCard,
        spotifyInput: input?.value,
        openLink: openLink?.href,
        resolveButtonPresent: Boolean(card.querySelector(`[data-action="resolve-spotify-link"][data-id="${trackId}"]`)),
        iframeCount: card.querySelectorAll('iframe').length,
        message: card.querySelector('[data-catalog-auto-apply-message]')?.textContent,
        catalogueTruth: Array.from(card.querySelectorAll('.meta')).some((node) => (
          node.textContent === 'Spotify catalogue link found; browser playback not yet verified.'
        )),
        resultDisabled: resultButton?.disabled,
        resultLabel: resultButton?.textContent,
        storedSpotifyUrl: track?.spotifyUrl,
        storedSpotifyUri: track?.spotifyUri,
        storedSourceKind: track?.sourceKind,
        storedCandidateStatus: track?.candidateVerificationStatus,
        storedRating: stored.ratings?.[trackId],
        storedTags: stored.tags?.[trackId],
        storedFeedback: stored.trackFeedback?.[trackId],
        noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      };
    }, { key: STORAGE_KEY, trackId: TRACK_ID, spotifyUrl: SPOTIFY_URL });

    assert.deepEqual(proof, {
      cardPreserved: true,
      spotifyInput: SPOTIFY_URL,
      openLink: SPOTIFY_URL,
      resolveButtonPresent: false,
      iframeCount: 0,
      message: 'Spotify track URL found by Stephanos and applied automatically.',
      catalogueTruth: true,
      resultDisabled: true,
      resultLabel: 'In Listening Room',
      storedSpotifyUrl: SPOTIFY_URL,
      storedSpotifyUri: SPOTIFY_URI,
      storedSourceKind: 'journey-candidate',
      storedCandidateStatus: 'search-only',
      storedRating: 2,
      storedTags: ['ghost in the track'],
      storedFeedback: 'Keep this.',
      noHorizontalOverflow: true,
    });

    await page.reload();
    await page.waitForFunction(({ trackId, spotifyUrl }) => (
      document.querySelector(`[data-link-input="spotify-${trackId}"]`)?.value === spotifyUrl
    ), { trackId: TRACK_ID, spotifyUrl: SPOTIFY_URL });
    const reloadProof = await page.evaluate(({ trackId, spotifyUrl }) => {
      const card = document.querySelector('.player-deck-card');
      return {
        spotifyInput: document.querySelector(`[data-link-input="spotify-${trackId}"]`)?.value,
        openLinkPresent: Array.from(card.querySelectorAll('a')).some((link) => link.href === spotifyUrl),
        iframeCount: card.querySelectorAll('iframe').length,
        message: card.querySelector('[data-catalog-auto-apply-message]')?.textContent,
      };
    }, { trackId: TRACK_ID, spotifyUrl: SPOTIFY_URL });
    assert.deepEqual(reloadProof, {
      spotifyInput: SPOTIFY_URL,
      openLinkPresent: true,
      iframeCount: 0,
      message: 'Spotify track URL found by Stephanos and applied automatically.',
    });
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
});
