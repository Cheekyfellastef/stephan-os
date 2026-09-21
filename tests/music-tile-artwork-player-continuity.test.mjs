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
const TRACK_ID = 'artwork-player-continuity';
const SPOTIFY_ID = '4uLU6hMCjMI75M1A2tKUQC';
const SPOTIFY_URL = `https://open.spotify.com/track/${SPOTIFY_ID}`;
const ARTWORK_URL = 'https://i.scdn.co/image/ab67616d00001e02f7f1f53af3505f5638d7d8b1';
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

test('catalogue artwork hydrates beside a mounted Spotify player without replacing it', async () => {
  const server = await startRepositoryServer();
  let browser;
  try {
    browser = await chromium.launch(
      process.env.STEPHANOS_BROWSER_CHANNEL
        ? { channel: process.env.STEPHANOS_BROWSER_CHANNEL, headless: true }
        : { headless: true },
    );
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route('https://open.spotify.com/embed/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><title>Spotify player continuity fixture</title>',
      });
    });
    await page.route('https://i.scdn.co/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" />',
      });
    });
    await page.addInitScript(({ key, trackId, spotifyUrl }) => {
      localStorage.setItem(key, JSON.stringify({
        candidates: [],
        listeningDeck: [{
          id: trackId,
          title: 'Enjoy the Silence',
          artist: 'Depeche Mode',
          spotifyUrl,
          spotifyUri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
          candidateVerificationStatus: 'verified',
          why: { positiveHits: [], rejectHits: [] },
        }],
        ratings: { [trackId]: 2 },
        tags: {},
        trackFeedback: {},
        linkMessages: {},
      }));
    }, { key: STORAGE_KEY, trackId: TRACK_ID, spotifyUrl: SPOTIFY_URL });

    await page.goto(`${server.origin}/apps/music-tile/index.html`);
    await page.waitForSelector('.player-deck-card iframe');

    await page.evaluate(() => {
      const frame = document.querySelector('.player-deck-card iframe');
      window.__artworkContinuityPlayer = { frame, frameWindow: frame.contentWindow };
    });

    const proof = await page.evaluate(async ({ key, trackId, artworkUrl }) => {
      const state = JSON.parse(localStorage.getItem(key));
      const track = state.listeningDeck.find((entry) => entry.id === trackId);
      track.artworkUrl = artworkUrl;
      track.artworkSource = 'spotify-catalogue';
      localStorage.setItem(key, JSON.stringify(state));

      const module = await import('/apps/music-tile/engine/catalogArtworkContinuity.js');
      const result = module.hydrateCatalogArtworkContinuity();
      const before = window.__artworkContinuityPlayer;
      const frame = document.querySelector('.player-deck-card iframe');
      const image = document.querySelector('.player-deck-card [data-catalog-artwork] img');
      return {
        result,
        frameSame: frame === before.frame,
        frameWindowSame: frame.contentWindow === before.frameWindow,
        iframeCount: document.querySelectorAll('.player-deck-card iframe').length,
        artworkSrc: image?.src || '',
        artworkAlt: image?.alt || '',
      };
    }, { key: STORAGE_KEY, trackId: TRACK_ID, artworkUrl: ARTWORK_URL });

    assert.equal(proof.frameSame, true);
    assert.equal(proof.frameWindowSame, true);
    assert.equal(proof.iframeCount, 1);
    assert.equal(proof.artworkSrc, ARTWORK_URL);
    assert.equal(proof.artworkAlt, 'Artwork for Enjoy the Silence');
    assert.equal(proof.result.checked, 1);

    await page.reload();
    await page.waitForSelector('.player-deck-card iframe');
    await page.waitForFunction((artworkUrl) => (
      document.querySelector('.player-deck-card [data-catalog-artwork] img')?.src === artworkUrl
    ), ARTWORK_URL);
    assert.equal(await page.locator('.player-deck-card iframe').count(), 1);
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
});
