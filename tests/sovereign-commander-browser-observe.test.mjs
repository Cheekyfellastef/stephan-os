import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  admittedBrowserOrigins, admittedBrowserTab,
  observeSovereignBrowser, parseBrowserObservationArguments,
  publicBrowserObservationProjection, safeBrowserPageId, summarizeDomObservation,
} from '../scripts/sovereign-commander-browser-observe.mjs';

test('remote entry forbids arbitrary URLs, debugger ports and shell flags', () => {
  assert.equal(parseBrowserObservationArguments([]).ok, true);
  for (const arg of ['--url', '--cdp-endpoint', '--shell', '--profile', 'http://example.com']) {
    assert.equal(parseBrowserObservationArguments([arg]).ok, false);
  }
});

test('admission is strict-origin only, not a hostname substring', () => {
  const list = admittedBrowserOrigins();
  assert.equal(admittedBrowserTab('http://127.0.0.1:4173/apps/music-tile/index.html?token=private', list), true);
  assert.equal(admittedBrowserTab('http://localhost:5173/apps/stephanos/index.html', list), true);
  for (const url of ['https://127.0.0.1:4173', 'http://localhost.evil.test:4173', 'file:///C:/private', 'chrome://settings', 'http://localhost:18791/mcp', 'http://user:pass@localhost:4173/']) {
    assert.equal(admittedBrowserTab(url, list), false, url);
  }
  assert.notEqual(safeBrowserPageId('http://localhost:4173/a?q=1'), safeBrowserPageId('http://localhost:4173/a?q=2'));
  assert.throws(() => admittedBrowserOrigins({ STEPHANOS_BROWSER_OBSERVE_ALLOWED_ORIGINS: 'https://example.com/private' }));
});

test('DOM metrics detect unloaded and broken artwork and generic Spotify destinations', () => {
  const data = summarizeDomObservation({
    readyState: 'complete', images: [{ complete: true, naturalWidth: 0 }, { complete: false, naturalWidth: 0 }, { complete: true, naturalWidth: 300 }],
    links: [{ href: 'https://open.spotify.com/' }, { href: 'https://open.spotify.com/track/123' }, { href: '' }],
    buttonCount: 5, disabledButtonCount: 1, headingCount: 2,
  });
  assert.equal(data.brokenImages, 1);
  assert.equal(data.unloadedImages, 1);
  assert.equal(data.genericSpotifyLinks, 1);
  assert.equal(data.emptyLinks, 1);
  assert.equal(data.semanticFunctionalityVerified, false);
});

test('attached local tab captures screenshot and bounded evidence without navigation or click', async () => {
  const proofRoot = await mkdtemp(join(tmpdir(), 'sc-browser-'));
  const calls = [];
  const handlers = new Map();
  const page = {
    url: () => 'http://127.0.0.1:4173/apps/music-tile/index.html?secret=123',
    on(name, cb) { calls.push('on:' + name); handlers.set(name, cb); },
    off(name) { calls.push('off:' + name); },
    async evaluate(fn) { calls.push('evaluate'); assert.match(fn.toString(), /querySelectorAll/); return { readyState: 'complete', images: [{ complete: true, naturalWidth: 0 }], links: [{ href: 'https://open.spotify.com/' }], buttonCount: 1, disabledButtonCount: 0, headingCount: 1 }; },
    async screenshot() { calls.push('screenshot'); return Buffer.from('fake-image'); },
    async goto() { throw new Error('Must not navigate'); },
    async click() { throw new Error('Must not click'); },
  };
  try {
    const result = await observeSovereignBrowser({
      connect: async () => ({ contexts: () => [{ pages: () => [page, { url: () => 'https://bank.example/account' }] }] }),
      env: { STEPHANOS_BROWSER_OBSERVE_ENABLE_CDP: '1' }, proofRoot, now: () => new Date('2026-10-18T19:00:00.000Z'),
    });
    assert.equal(result.ok, true);
    assert.equal(result.observedTabCount, 1);
    assert.equal(result.observations[0].brokenImages, 1);
    assert.equal(result.observations[0].genericSpotifyLinks, 1);
    assert.equal(result.servedHeadVerified, false);
    assert.equal(result.functionalAcceptanceVerified, false);
    const files = await readdir(proofRoot);
    assert.equal(files.filter(f => f.endsWith('.png')).length, 1);
    assert.equal(files.filter(f => f.endsWith('.json')).length, 1);
    const receipt = await readFile(join(proofRoot, files.find(f => f.endsWith('.json'))), 'utf8');
    assert.doesNotMatch(receipt, /secret=123|bank\.example/);
    assert.deepEqual(calls.slice(0, 3), ['on:console', 'on:pageerror', 'on:requestfailed']);
    assert.equal(calls.includes('screenshot'), true);
    const publicResult = publicBrowserObservationProjection(result);
    assert.equal(publicResult.observedTabCount, 1);
    assert.equal(JSON.stringify(publicResult).includes('spotify'), false);
    assert.equal(JSON.stringify(publicResult).includes('secret'), false);
  } finally { await rm(proofRoot, { recursive: true, force: true }); }
});

test('unconnected CDP session fails closed, not green', async () => {
  const result = await observeSovereignBrowser({ env: { STEPHANOS_BROWSER_OBSERVE_ENABLE_CDP: '1' }, connect: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'BROWSER_SESSION_NOT_CONNECTED');
  assert.equal(publicBrowserObservationProjection(result).finalVerdict, 'BROWSER_OBSERVATION_BLOCKED');
});

test('CDP browser is not attached or screenshotted without explicit local opt-in', async () => {
  let connected = false;
  const result = await observeSovereignBrowser({
    env: {}, connect: async () => { connected = true; throw new Error('Should never attach'); },
  });
  assert.equal(connected, false);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'BROWSER_NATIVE_WITNESS_NOT_READY');
  assert.equal(result.finalVerdict, 'BROWSER_OBSERVATION_BLOCKED');
});
