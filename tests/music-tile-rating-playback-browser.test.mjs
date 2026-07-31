import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const STORAGE_KEY = 'stephanos.musicTile.dashboardState.v1';
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
