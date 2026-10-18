import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMusicCardEvidence, inspectMusicCardSnapshot, collectMusicCardEvidence,
  MUSIC_CARD_PROOF_SCHEMA, MUSIC_CARD_PROOF_SCENARIO } from './music-card-browser-proof.mjs';
import { evaluateBrowserProofResult, parseBrowserProofArguments } from './browser-proof-runner.mjs';

const head = 'a'.repeat(40);
const id = '4uLU6hMCjMI75M1A2tKUQC';
const url = `https://open.spotify.com/track/${id}`;
const artwork = 'https://i.scdn.co/image/known-artwork';
function row(overrides = {}) {
  return { id: 'stored-track', eligible: true, spotify: url, youtube: '', present: true,
    links: [{ label: 'Open in Spotify', href: url }], artwork, artworkLoaded: true,
    overlay: { trackId: 'stored-track', spotifyTrackId: id, artworkUrl: artwork, source: 'spotify-oembed' },
    catalogArtwork: {}, iframeCount: 1, ...overrides };
}
function snapshot(rows = [row()]) { return { stateValid: true, cards: rows, renderedCount: rows.length }; }
function evidence() {
  const before = inspectMusicCardSnapshot(snapshot());
  const binding = { exact: true, sourceHead: head, fingerprint: 'b'.repeat(64), fileCount: 3,
    responseBinding: 'playwright-scenario-source-responses-git-blob-v2' };
  return { schemaVersion: MUSIC_CARD_PROOF_SCHEMA, collector: 'playwright-existing-music-cards-v1',
    fixtureInjected: false, realCardContextAdmitted: true, sourceHead: head, proofTarget: 'MERGED_MAIN', sourceBefore: binding,
    sourceAfter: { ...binding }, before, after: { ...before }, iframeIdentityPreserved: true,
    consoleErrorCount: 0, pageErrorCount: 0, blocker: '' };
}
const evaluate = (value) => evaluateMusicCardEvidence(value, { expectedHead: head, proofTarget: 'MERGED_MAIN' });

test('existing verified card requires loaded artwork bound to the same exact song', () => {
  assert.equal(inspectMusicCardSnapshot(snapshot()).ok, true);
  assert.equal(evaluate(evidence()).accepted, true);
});

for (const [label, override, blocker] of [
  ['generic Spotify landing page', { links: [{ label: 'Open in Spotify', href: 'https://open.spotify.com/' }] }, 'MUSIC_EXACT_TRACK_ACTION_MISMATCH'],
  ['wrong song', { links: [{ label: 'Open in Spotify', href: `https://open.spotify.com/track/${'x'.repeat(22)}` }] }, 'MUSIC_EXACT_TRACK_ACTION_MISMATCH'],
  ['spoofed host', { links: [{ label: 'Open in Spotify', href: `${url.replace('open.spotify.com', 'open.spotify.com.attacker.test')}` }] }, 'MUSIC_EXACT_TRACK_ACTION_MISMATCH'],
  ['embedded credentials', { links: [{ label: 'Open in Spotify', href: url.replace('https://', 'https://user:pass@') }] }, 'MUSIC_EXACT_TRACK_ACTION_MISMATCH'],
  ['redundant generic search', { links: [row().links[0], { label: 'Find on Spotify', href: 'https://open.spotify.com/search/test' }] }, 'MUSIC_REDUNDANT_SEARCH_ACTION'],
  ['unloaded artwork', { artworkLoaded: false }, 'MUSIC_ARTWORK_MISSING_UNLOADED_OR_IDENTITY_UNBOUND'],
  ['missing artwork panel', { artwork: '', artworkLoaded: false }, 'MUSIC_ARTWORK_MISSING_UNLOADED_OR_IDENTITY_UNBOUND'],
  ['untrusted artwork', { artwork: 'https://i.scdn.co.attacker.test/cover' }, 'MUSIC_ARTWORK_MISSING_UNLOADED_OR_IDENTITY_UNBOUND'],
  ['stale overlay', { overlay: { ...row().overlay, spotifyTrackId: 'x'.repeat(22) } }, 'MUSIC_ARTWORK_MISSING_UNLOADED_OR_IDENTITY_UNBOUND'],
  ['identity-mismatched overlay', { overlay: { ...row().overlay, trackId: 'other-card' } }, 'MUSIC_ARTWORK_MISSING_UNLOADED_OR_IDENTITY_UNBOUND'],
  ['missing card DOM', { present: false }, 'MUSIC_CARD_DOM_INCOMPLETE'],
  ['unverified exact action', { eligible: false }, 'MUSIC_EXACT_TRACK_ACTION_MISMATCH'],
  ['unverified artwork', { eligible: false, links: [{ label: 'Find on Spotify', href: 'https://open.spotify.com/search/test' }] }, 'MUSIC_UNVERIFIED_SPOTIFY_ARTWORK_VISIBLE'],
]) test(`rejects ${label}`, () => {
  assert.equal(inspectMusicCardSnapshot(snapshot([row(override)])).blocker, blocker);
});

test('metadata-verified catalogue artwork can supply the same identity-bound image', () => {
  const catalogArtwork = { provider: 'spotify', id, status: 'metadata_verified', source: 'spotify-catalogue', url: artwork,
    linkSource: 'native-catalog-search' };
  assert.equal(inspectMusicCardSnapshot(snapshot([row({ overlay: null, catalogArtwork })])).ok, true);
});

test('unresolved cards may retain honest searches alongside a verified sample', () => {
  const unresolved = row({ id: 'unresolved', spotify: '', eligible: false, artwork: '', artworkLoaded: false,
    iframeCount: 0, links: [{ label: 'Find on Spotify', href: 'https://open.spotify.com/search/test' }] });
  assert.equal(inspectMusicCardSnapshot(snapshot([row(), unresolved])).ok, true);
  assert.equal(inspectMusicCardSnapshot(snapshot([row(), { ...unresolved, links: [] }])).ok, false);
});

test('unresolved search controls cannot masquerade as links to arbitrary sites', () => {
  const unresolved = row({ id: 'unresolved', spotify: '', eligible: false, artwork: '', artworkLoaded: false,
    iframeCount: 0, links: [{ label: 'Find on Spotify', href: 'https://attacker.test/search/test' }] });
  assert.equal(inspectMusicCardSnapshot(snapshot([row(), unresolved])).blocker, 'MUSIC_SEARCH_ACTION_INVALID');
});

test('empty, oversized, duplicate, missing and malformed observations never pass vacuously', () => {
  for (const value of [null, {}, snapshot([]), snapshot([null]), snapshot([row(), row()]),
    snapshot(Array.from({ length: 21 }, (_, i) => row({ id: String(i) }))),
    snapshot([row({ links: [null] })]), { ...snapshot(), renderedCount: 0 }]) {
    assert.equal(inspectMusicCardSnapshot(value).ok, false);
  }
});

test('sanitized snapshot evidence contains only counts and a digest', () => {
  const result = inspectMusicCardSnapshot(snapshot());
  const serialized = JSON.stringify(result);
  for (const secret of [url, artwork, 'stored-track', id]) assert.equal(serialized.includes(secret), false);
  assert.match(result.fingerprint, /^[0-9a-f]{64}$/);
});

test('rejects stale heads, fixture proof, source drift, reload drift, replaced frames and browser errors', () => {
  const cases = [
    { sourceHead: 'c'.repeat(40) }, { fixtureInjected: true }, { realCardContextAdmitted: false }, { proofTarget: 'PULL_REQUEST_HEAD' },
    { sourceBefore: null }, { sourceAfter: { ...evidence().sourceAfter, exact: false } },
    { sourceAfter: { ...evidence().sourceAfter, fingerprint: 'c'.repeat(64) } },
    { after: { ...evidence().after, fingerprint: 'c'.repeat(64) } },
    { iframeIdentityPreserved: false }, { consoleErrorCount: 1 }, { pageErrorCount: 1 },
    { before: { ...evidence().before, count: 0 } }, { blocker: 'MUSIC_REAL_CARDS_UNAVAILABLE_OR_OUT_OF_BOUNDS' },
  ];
  for (const changes of cases) assert.equal(evaluate({ ...evidence(), ...changes }).accepted, false);
  assert.equal(evaluate(null).accepted, false);
});

test('new scenario is admitted by the runner but cannot pass with missing evidence', () => {
  assert.equal(parseBrowserProofArguments(['--expected-head', head, '--proof-scenario', MUSIC_CARD_PROOF_SCENARIO]).ok, true);
  const result = evaluateBrowserProofResult({ browserAutomationAvailable: true,
    checks: { runtimeReachable: true, runtimeSourceHead: head } }, {
    expectedHead: head, proofScenario: MUSIC_CARD_PROOF_SCENARIO, proofTarget: 'MERGED_MAIN',
  });
  assert.equal(result.scenarioEvidenceAccepted, false);
  assert.equal(result.mergeReady, false);
});

test('collector refuses arbitrary URL or missing binding without touching the browser', async () => {
  let touched = false;
  const page = { route() { touched = true; } };
  for (const runtime of ['https://example.com', 'http://127.0.0.1:8787', 'http://user:pass@127.0.0.1:4173']) {
    const result = await collectMusicCardEvidence(page, runtime, { expectedHead: head, bindSourceResponses() {} });
    assert.equal(result.blocker, 'MUSIC_CARD_FIXED_LOCAL_ROUTE_REQUIRED');
  }
  assert.equal(touched, false);
});

test('fresh or unqualified contexts cannot become real-profile proof even when populated', async () => {
  let touched = false;
  const page = { route() { touched = true; } };
  const result = await collectMusicCardEvidence(page, 'http://127.0.0.1:4173/apps/stephanos/dist/index.html', {
    expectedHead: head, bindSourceResponses() {},
  });
  assert.equal(result.blocker, 'MUSIC_REAL_CARD_CONTEXT_NOT_ADMITTED');
  assert.equal(evaluate(result).accepted, false);
  assert.equal(touched, false);
});
