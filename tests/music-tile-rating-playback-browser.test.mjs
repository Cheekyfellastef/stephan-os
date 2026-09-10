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
const AUTO_TRACK_ID = 'journey-enjoy-the-silence';
const AUTO_SPOTIFY_ID = '4uLU6hMCjMI75M1A2tKUQC';
const AUTO_SPOTIFY_URL = `https://open.spotify.com/track/${AUTO_SPOTIFY_ID}`;
const AUTO_SPOTIFY_URI = `spotify:track:${AUTO_SPOTIFY_ID}`;
const AUTO_ARTWORK_URL = 'https://i.scdn.co/image/ab67616d00001e02f7f1f53af3505f5638d7d8b1';
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

test('rating preserves the mounted Listening Deck and verified Discovery players', async () => {
  const server = await startRepositoryServer();
  let browser;
  try {
    browser = await chromium.launch(
      process.env.STEPHANOS_BROWSER_CHANNEL
        ? { channel: process.env.STEPHANOS_BROWSER_CHANNEL, headless: true }
        : { headless: true },
    );
    const page = await browser.newPage();
    await page.route('https://open.spotify.com/embed/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><title>Bound Spotify player fixture</title>',
      });
    });
    await page.addInitScript(({ key }) => {
      localStorage.setItem(key, JSON.stringify({
        candidates: [
          {
            id: 'candidate-first',
            title: 'First candidate',
            artist: 'Stephanos Proof',
            tasteScore: 2,
            why: { positiveHits: [], rejectHits: [] },
          },
          {
            id: 'candidate-second',
            title: 'Second candidate',
            artist: 'Stephanos Proof',
            tasteScore: 1,
            why: { positiveHits: [], rejectHits: [] },
          },
        ],
        listeningDeck: [{
          id: 'deck-track',
          title: 'Playback must continue',
          artist: 'Stephanos Proof',
          spotifyUrl: 'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl',
          candidateVerificationStatus: 'verified',
          why: { positiveHits: [], rejectHits: [] },
        }],
        ratings: {},
        tags: {},
        trackFeedback: {},
        linkMessages: {},
      }));
    }, { key: STORAGE_KEY });

    await page.goto(`${server.origin}/apps/music-tile/index.html`);
    await page.waitForSelector('.player-deck-card iframe');
    await page.evaluate(() => {
      const discovery = document.getElementById('discovery-results-list');
      discovery.innerHTML = `
        <section>
          <h3>Verified Candidates</h3>
          <article class="music-card">
            <iframe
              data-testid="verified-discovery-player"
              src="https://open.spotify.com/embed/track/0VjIjW4GlUZAMYd2vXMi3b"
              title="Verified Discovery player"
            ></iframe>
          </article>
        </section>
        <section>
          <h3>Discovery Results (Legacy / local results — secondary)</h3>
          <div class="meta">stale ranking sentinel</div>
        </section>
      `;
      const deckFrame = document.querySelector('.player-deck-card iframe');
      const discoveryFrame = document.querySelector('[data-testid="verified-discovery-player"]');
      window.__musicRatingPlaybackProof = {
        deckFrame,
        deckWindow: deckFrame.contentWindow,
        discoveryFrame,
        discoveryWindow: discoveryFrame.contentWindow,
      };
    });

    await page.click('[data-id="deck-track"][data-rate="2"]');

    const proof = await page.evaluate(() => {
      const before = window.__musicRatingPlaybackProof;
      const deckFrame = document.querySelector('.player-deck-card iframe');
      const discoveryFrame = document.querySelector('[data-testid="verified-discovery-player"]');
      const legacyText = Array.from(
        document.querySelectorAll('#discovery-results-list section'),
      ).find((section) => (
        section.querySelector('h3')?.textContent?.startsWith('Discovery Results')
      ))?.textContent || '';
      return {
        deckFrameSame: deckFrame === before.deckFrame,
        deckWindowSame: deckFrame.contentWindow === before.deckWindow,
        discoveryFrameSame: discoveryFrame === before.discoveryFrame,
        discoveryWindowSame: discoveryFrame.contentWindow === before.discoveryWindow,
        ratingPressed: document.querySelector(
          '[data-id="deck-track"][data-rate="2"]',
        )?.getAttribute('aria-pressed'),
        ratingMeta: document.querySelector(
          '.player-deck-card .music-card-header .music-card-meta',
        )?.textContent,
        legacyText,
      };
    });

    assert.deepEqual(proof, {
      deckFrameSame: true,
      deckWindowSame: true,
      discoveryFrameSame: true,
      discoveryWindowSame: true,
      ratingPressed: 'true',
      ratingMeta: 'Stephanos Proof · rating 2',
      legacyText: 'Discovery Results (Legacy / local results — secondary)Stephanos Proof - First candidateStephanos Proof - Second candidate',
    });
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
});

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
        body: JSON.stringify({
          ok: true,
          provider: 'spotify',
          providerLabel: 'Spotify',
          results: [{
            universalId: `spotify:track:${AUTO_SPOTIFY_ID}`,
            provider: 'spotify',
            providerItemId: AUTO_SPOTIFY_ID,
            providerLabel: 'Spotify',
            providerUrl: AUTO_SPOTIFY_URL,
            title: 'Enjoy the Silence',
            artist: 'Depeche Mode',
            album: 'Violator',
            confidence: 'high',
            verificationStatus: 'metadata_verified',
            playbackAvailability: 'playback_unverified',
            spotifyUrl: AUTO_SPOTIFY_URL,
            spotifyUri: AUTO_SPOTIFY_URI,
          }],
        }),
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
    }, { key: STORAGE_KEY, trackId: AUTO_TRACK_ID });

    await page.goto(`${server.origin}/apps/music-tile/index.html`);
    await page.waitForSelector(`[data-link-input="spotify-${AUTO_TRACK_ID}"]`, { state: 'attached' });
    await page.evaluate(() => {
      window.__catalogAutoApplyCard = document.querySelector('.player-deck-card');
    });

    await page.fill('#native-music-search-input', 'Enjoy the Silence');
    await page.click('#native-music-search-button');
    await page.waitForFunction(({ trackId, spotifyUrl }) => {
      const input = document.querySelector(`[data-link-input="spotify-${trackId}"]`);
      const resultButton = document.querySelector('[data-action="add-native-catalog-result"]');
      return input?.value === spotifyUrl
        && resultButton?.disabled === true
        && resultButton?.textContent?.trim() === 'In Listening Room';
    }, { trackId: AUTO_TRACK_ID, spotifyUrl: AUTO_SPOTIFY_URL });

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
    }, { key: STORAGE_KEY, trackId: AUTO_TRACK_ID, spotifyUrl: AUTO_SPOTIFY_URL });

    assert.deepEqual(proof, {
      cardPreserved: true,
      spotifyInput: AUTO_SPOTIFY_URL,
      openLink: AUTO_SPOTIFY_URL,
      resolveButtonPresent: false,
      iframeCount: 0,
      message: 'Spotify track URL found by Stephanos and applied automatically.',
      catalogueTruth: true,
      resultDisabled: true,
      resultLabel: 'In Listening Room',
      storedSpotifyUrl: AUTO_SPOTIFY_URL,
      storedSpotifyUri: AUTO_SPOTIFY_URI,
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
    ), { trackId: AUTO_TRACK_ID, spotifyUrl: AUTO_SPOTIFY_URL });
    const reloadProof = await page.evaluate(({ trackId, spotifyUrl }) => {
      const card = document.querySelector('.player-deck-card');
      return {
        spotifyInput: document.querySelector(`[data-link-input="spotify-${trackId}"]`)?.value,
        openLinkPresent: Array.from(card.querySelectorAll('a')).some((link) => link.href === spotifyUrl),
        iframeCount: card.querySelectorAll('iframe').length,
        message: card.querySelector('[data-catalog-auto-apply-message]')?.textContent,
      };
    }, { trackId: AUTO_TRACK_ID, spotifyUrl: AUTO_SPOTIFY_URL });
    assert.deepEqual(reloadProof, {
      spotifyInput: AUTO_SPOTIFY_URL,
      openLinkPresent: true,
      iframeCount: 0,
      message: 'Spotify track URL found by Stephanos and applied automatically.',
    });
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
});

test('iPad-width complete journey renders every fresh track and Continue changes nothing', async () => {
  const server = await startRepositoryServer();
  let browser;
  try {
    browser = await chromium.launch(
      process.env.STEPHANOS_BROWSER_CHANNEL
        ? { channel: process.env.STEPHANOS_BROWSER_CHANNEL, headless: true }
        : { headless: true },
    );
    const page = await browser.newPage({ viewport: { width: 820, height: 1180 } });
    const catalogueRows = Array.from({ length: 6 }, (_, index) => {
      const number = String(index + 1);
      const spotifyId = number.repeat(22);
      return {
        universalId: `spotify:track:${spotifyId}`,
        provider: 'spotify',
        providerItemId: spotifyId,
        providerLabel: 'Spotify',
        providerUrl: `https://open.spotify.com/track/${spotifyId}`,
        title: `Fresh Catalogue Track ${number}`,
        artist: `Fresh Catalogue Artist ${number}`,
        album: 'Fresh Journey Proof',
        confidence: 'high',
        verificationStatus: 'metadata_verified',
        playbackAvailability: 'playback_unverified',
        spotifyUrl: `https://open.spotify.com/track/${spotifyId}`,
        spotifyUri: `spotify:track:${spotifyId}`,
      };
    });
    await page.route(/\/api\/music\/catalog\/search\?/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          ok: true,
          provider: 'spotify',
          providerLabel: 'Spotify',
          results: catalogueRows,
        }),
      });
    });
    await page.addInitScript(({ key }) => {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, JSON.stringify({
        candidates: [{
          id: 'old-candidate',
          title: 'The Same Old Candidate',
          artist: 'Repeated Artist',
          traits: ['club engine'],
        }],
        listeningDeck: [{
          id: 'existing-room-track',
          title: 'Keep Existing Track',
          artist: 'Current Artist',
          traits: ['ghost in the track'],
          candidateVerificationStatus: 'search-only',
        }],
        ratings: { 'existing-room-track': 2, 'old-candidate': -1 },
        tags: { 'existing-room-track': ['ghost in the track'] },
        trackFeedback: { 'existing-room-track': 'Keep this existing card.' },
        linkMessages: {},
        recentlyShownCandidateIds: ['old-candidate'],
        journeyHistoryKeys: ['id:old-candidate'],
        sessionCounter: 4,
      }));
    }, { key: STORAGE_KEY });

    await page.goto(`${server.origin}/apps/music-tile/index.html`);
    await page.waitForFunction(() => (
      document.getElementById('start-journey-btn')?.textContent === 'Start New Journey'
      && Boolean(document.getElementById('continue-journey-btn'))
    ));
    await page.fill('#artist-input', 'Anyma');
    await page.click('#start-journey-btn');
    await page.waitForFunction(() => (
      performance.getEntriesByType('navigation')[0]?.type === 'reload'
      && document.querySelectorAll('#listening-deck > .player-deck-card').length >= 10
    ));

    const proof = await page.evaluate(({ key }) => {
      const stored = JSON.parse(localStorage.getItem(key));
      const candidateIds = stored.candidates.map((track) => track.id);
      const deckIds = stored.listeningDeck.map((track) => track.id);
      const renderedCards = Array.from(document.querySelectorAll('#listening-deck > .player-deck-card'));
      const catalogueCandidates = stored.candidates.filter((track) => track.sourceKind === 'native-catalog');
      return {
        freshCount: stored.lastFreshJourneySummary?.freshCount,
        activeJourneyCount: stored.lastFreshJourneySummary?.activeJourneyCount,
        addedCount: stored.lastFreshJourneySummary?.addedCount,
        roomCount: stored.lastFreshJourneySummary?.roomCount,
        preservedCount: stored.lastFreshJourneySummary?.preservedCount,
        catalogueCount: stored.lastFreshJourneySummary?.catalogueCount,
        recycledCount: stored.lastFreshJourneySummary?.recycledCount,
        renderedCardCount: renderedCards.length,
        allCandidatesReachable: candidateIds.every((id) => deckIds.includes(id)),
        everyCardHasMediaControls: renderedCards.every((card) => Boolean(card.querySelector('.media-controls'))),
        oldCandidateReused: candidateIds.includes('old-candidate'),
        freshCataloguePresent: catalogueCandidates.some((track) => track.title === 'Fresh Catalogue Track 1'),
        existingTrackPreserved: deckIds.includes('existing-room-track'),
        existingRating: stored.ratings?.['existing-room-track'],
        existingTags: stored.tags?.['existing-room-track'],
        existingFeedback: stored.trackFeedback?.['existing-room-track'],
        activeJourneyTrackIds: stored.activeJourneyTrackIds,
        discoveryPipelineStored: Boolean(stored.discoveryPipeline),
        discoveryPipelineRendered: Boolean(document.getElementById('discovery-pipeline-summary')),
        startLabel: document.getElementById('start-journey-btn')?.textContent,
        continueLabel: document.getElementById('continue-journey-btn')?.textContent,
        status: document.getElementById('status-text')?.textContent,
        novelty: document.getElementById('briefing-novelty')?.textContent,
        noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      };
    }, { key: STORAGE_KEY });

    assert.equal(proof.freshCount, 10);
    assert.equal(proof.activeJourneyCount, 10);
    assert.equal(proof.addedCount, 10);
    assert.equal(proof.roomCount, 11);
    assert.equal(proof.preservedCount, 1);
    assert.ok(proof.catalogueCount >= 4);
    assert.equal(proof.recycledCount, 0);
    assert.equal(proof.renderedCardCount, 11);
    assert.equal(proof.allCandidatesReachable, true);
    assert.equal(proof.everyCardHasMediaControls, true);
    assert.equal(proof.oldCandidateReused, false);
    assert.equal(proof.freshCataloguePresent, true);
    assert.equal(proof.existingTrackPreserved, true);
    assert.equal(proof.existingRating, 2);
    assert.deepEqual(proof.existingTags, ['ghost in the track']);
    assert.equal(proof.existingFeedback, 'Keep this existing card.');
    assert.equal(proof.activeJourneyTrackIds.length, 10);
    assert.equal(proof.discoveryPipelineStored, true);
    assert.equal(proof.discoveryPipelineRendered, true);
    assert.equal(proof.startLabel, 'Start New Journey');
    assert.equal(proof.continueLabel, 'Continue Current Journey');
    assert.match(proof.status, /complete journey|genuinely new/);
    assert.match(proof.novelty, /0 recycled/);
    assert.equal(proof.noHorizontalOverflow, true);

    const beforeContinue = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    await page.click('#continue-journey-btn');
    const afterContinue = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    assert.equal(afterContinue, beforeContinue);
    assert.equal(
      await page.textContent('#status-text'),
      'Continuing the current journey. No songs were replaced or added.',
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
});

test('legacy three-card fresh journey state self-recovers to the complete active journey', async () => {
  const server = await startRepositoryServer();
  let browser;
  try {
    browser = await chromium.launch(
      process.env.STEPHANOS_BROWSER_CHANNEL
        ? { channel: process.env.STEPHANOS_BROWSER_CHANNEL, headless: true }
        : { headless: true },
    );
    const page = await browser.newPage({ viewport: { width: 820, height: 1180 } });
    await page.addInitScript(({ key }) => {
      const candidates = Array.from({ length: 10 }, (_, index) => ({
        id: `legacy-fresh-${index + 1}`,
        title: `Legacy Fresh Track ${index + 1}`,
        artist: `Legacy Artist ${index + 1}`,
        tasteScore: 10 - index,
      }));
      localStorage.setItem(key, JSON.stringify({
        candidates,
        listeningDeck: candidates.slice(0, 3),
        ratings: { 'legacy-fresh-1': 2 },
        tags: { 'legacy-fresh-1': ['ghost in the track'] },
        trackFeedback: { 'legacy-fresh-1': 'Keep this.' },
        lastFreshJourneySummary: {
          schemaVersion: 1,
          freshCount: 10,
          addedCount: 3,
          recycledCount: 0,
        },
      }));
    }, { key: STORAGE_KEY });

    await page.goto(`${server.origin}/apps/music-tile/index.html`);
    await page.waitForFunction(() => (
      document.querySelectorAll('#listening-deck > .player-deck-card').length === 10
    ));
    const proof = await page.evaluate((key) => {
      const stored = JSON.parse(localStorage.getItem(key));
      return {
        renderedCards: document.querySelectorAll('#listening-deck > .player-deck-card').length,
        storedCards: stored.listeningDeck.length,
        activeJourneyCount: stored.activeJourneyTrackIds?.length,
        recovered: stored.lastFreshJourneySummary?.legacyTruncatedJourneyRecovered,
        rating: stored.ratings?.['legacy-fresh-1'],
        tags: stored.tags?.['legacy-fresh-1'],
        feedback: stored.trackFeedback?.['legacy-fresh-1'],
      };
    }, STORAGE_KEY);
    assert.deepEqual(proof, {
      renderedCards: 10,
      storedCards: 10,
      activeJourneyCount: 10,
      recovered: true,
      rating: 2,
      tags: ['ghost in the track'],
      feedback: 'Keep this.',
    });
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
});


test('iPad-width existing card receives Spotify URL and artwork without manual search', async () => {
  const server = await startRepositoryServer();
  let browser;
  try {
    browser = await chromium.launch(
      process.env.STEPHANOS_BROWSER_CHANNEL
        ? { channel: process.env.STEPHANOS_BROWSER_CHANNEL, headless: true }
        : { headless: true },
    );
    const page = await browser.newPage({ viewport: { width: 820, height: 1180 } });
    let catalogRequests = 0;
    const pageErrors = [];
    const browserConsole = [];
    page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error?.message || error)));
    page.on('console', (message) => browserConsole.push(`${message.type()}: ${message.text()}`));
    await page.route('https://i.scdn.co/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" />' });
    });
    await page.route(/\/api\/music\/catalog\/search\?/, async (route) => {
      catalogRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          ok: true,
          provider: 'spotify',
          providerLabel: 'Spotify',
          results: [{
            universalId: `spotify:track:${AUTO_SPOTIFY_ID}`,
            provider: 'spotify',
            providerItemId: AUTO_SPOTIFY_ID,
            providerLabel: 'Spotify',
            providerUrl: AUTO_SPOTIFY_URL,
            title: 'Enjoy the Silence',
            artist: 'Depeche Mode',
            album: 'Violator',
            confidence: 'high',
            verificationStatus: 'metadata_verified',
            playbackAvailability: 'playback_unverified',
            spotifyUrl: AUTO_SPOTIFY_URL,
            spotifyUri: AUTO_SPOTIFY_URI,
            artworkUrl: AUTO_ARTWORK_URL,
          }],
        }),
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
    }, { key: STORAGE_KEY, trackId: AUTO_TRACK_ID });

    await page.goto(`${server.origin}/apps/music-tile/index.html`);
    try {
      await page.waitForFunction(({ trackId, spotifyUrl, artworkUrl }) => {
        const input = document.querySelector(`[data-link-input="spotify-${trackId}"]`);
        const image = document.querySelector('[data-catalog-artwork] img');
        return input?.value === spotifyUrl && image?.src === artworkUrl;
      }, { trackId: AUTO_TRACK_ID, spotifyUrl: AUTO_SPOTIFY_URL, artworkUrl: AUTO_ARTWORK_URL }, { timeout: 10000 });
    } catch (error) {
      const diagnostic = await page.evaluate(({ key, trackId }) => {
        let stored = null;
        try { stored = JSON.parse(localStorage.getItem(key)); } catch {}
        const track = stored?.listeningDeck?.find?.((item) => item.id === trackId) || null;
        const input = document.querySelector(`[data-link-input="spotify-${trackId}"]`);
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
      throw new Error(`AUTO_URL_ARTWORK_DIAGNOSTIC=${JSON.stringify({
        catalogRequests,
        pageErrors,
        browserConsole: browserConsole.slice(-30),
        diagnostic,
        waitError: String(error?.message || error),
      })}`);
    }

    const proof = await page.evaluate(({ key, trackId, spotifyUrl, artworkUrl }) => {
      const stored = JSON.parse(localStorage.getItem(key));
      const track = stored.listeningDeck.find((item) => item.id === trackId);
      const card = document.querySelector('.player-deck-card');
      const image = card.querySelector('[data-catalog-artwork] img');
      return {
        spotifyInput: document.querySelector(`[data-link-input="spotify-${trackId}"]`)?.value,
        openLinkPresent: Array.from(card.querySelectorAll('a')).some((link) => link.href === spotifyUrl),
        artworkSrc: image?.src,
        artworkAlt: image?.alt,
        iframeCount: card.querySelectorAll('iframe').length,
        storedSpotifyUrl: track?.spotifyUrl,
        storedArtworkUrl: track?.artworkUrl,
        storedArtworkSource: track?.artworkSource,
        storedRating: stored.ratings?.[trackId],
        storedTags: stored.tags?.[trackId],
        storedFeedback: stored.trackFeedback?.[trackId],
        noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        expectedArtworkUrl: artworkUrl,
      };
    }, { key: STORAGE_KEY, trackId: AUTO_TRACK_ID, spotifyUrl: AUTO_SPOTIFY_URL, artworkUrl: AUTO_ARTWORK_URL });
    assert.equal(catalogRequests, 1);
    assert.deepEqual(proof, {
      spotifyInput: AUTO_SPOTIFY_URL,
      openLinkPresent: true,
      artworkSrc: AUTO_ARTWORK_URL,
      artworkAlt: 'Artwork for Enjoy the Silence',
      iframeCount: 0,
      storedSpotifyUrl: AUTO_SPOTIFY_URL,
      storedArtworkUrl: AUTO_ARTWORK_URL,
      storedArtworkSource: 'spotify-catalogue',
      storedRating: 2,
      storedTags: ['ghost in the track'],
      storedFeedback: 'Keep this.',
      noHorizontalOverflow: true,
      expectedArtworkUrl: AUTO_ARTWORK_URL,
    });

    await page.reload();
    await page.waitForFunction(({ trackId, spotifyUrl, artworkUrl }) => (
      document.querySelector(`[data-link-input="spotify-${trackId}"]`)?.value === spotifyUrl
      && document.querySelector('[data-catalog-artwork] img')?.src === artworkUrl
    ), { trackId: AUTO_TRACK_ID, spotifyUrl: AUTO_SPOTIFY_URL, artworkUrl: AUTO_ARTWORK_URL });
    assert.equal(catalogRequests, 1);
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
});
