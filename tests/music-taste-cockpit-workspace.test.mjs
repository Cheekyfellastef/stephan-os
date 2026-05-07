import test from 'node:test';
import assert from 'node:assert/strict';

import { SEEDED_TASTE_TRACKS } from '../apps/music-tile/data/musicTasteSeeds.js';
import { buildTasteCockpitMarkup } from '../apps/music-tile/ui/tasteCockpitView.js';

test('expanded workspace renders Spotify-first Taste Cockpit header and lane target', () => {
  const markup = buildTasteCockpitMarkup(SEEDED_TASTE_TRACKS);
  assert.match(markup, /Spotify-first Taste Cockpit/);
  assert.match(markup, /Dark Courtyard \/ Ghost Vocal \/ Serious Trance DNA/);
  assert.match(markup, /Spotify canonical · YouTube discovery\/fallback/);
  assert.match(markup, /Learning: serious hypnotic trance architecture \+ echo-heavy ghost vocals \+ dark club pressure\./);
});

test('expanded workspace renders anchors and reject patterns sections', () => {
  const markup = buildTasteCockpitMarkup(SEEDED_TASTE_TRACKS);
  assert.match(markup, /Taste Anchors/);
  assert.match(markup, /Push - Universal Nation/);
  assert.match(markup, /Reject Patterns/);
  assert.match(markup, /Too Goa \/ psy: Root Level/);
});

test('track cards render spotify iframe with encrypted-media and spotify fallback link when available', () => {
  const markup = buildTasteCockpitMarkup(SEEDED_TASTE_TRACKS);
  assert.match(markup, /<iframe[^>]+open\.spotify\.com\/embed\/track\//);
  assert.match(markup, /allow="[^"]*encrypted-media[^"]*"/);
  assert.match(markup, /Open in Spotify/);
});

test('tracks without spotify references render Needs Spotify link instead of broken iframe', () => {
  const markup = buildTasteCockpitMarkup([
    { id: 'x1', artist: 'No Ref Artist', title: 'No Ref Title', signal: 'interesting', lane: 'Test Lane' },
  ]);
  assert.match(markup, /Needs Spotify link/);
  assert.doesNotMatch(markup, /<iframe/);
});

test('feedback controls render for each track card', () => {
  const markup = buildTasteCockpitMarkup(SEEDED_TASTE_TRACKS.slice(0, 1));
  ['Fantastic', 'Liked', 'Good', 'Interesting', 'Nearly', 'Reject'].forEach((label) => {
    assert.match(markup, new RegExp(`>${label}<`));
  });
});

test('track cards render positive and reject reason tag buttons', () => {
  const markup = buildTasteCockpitMarkup(SEEDED_TASTE_TRACKS.slice(0, 1));
  ['reverb vocal', 'Universal Nation spine', 'too cheesy', 'no club pressure'].forEach((label) => {
    assert.match(markup, new RegExp(`>${label}<`));
  });
});

test('music seed list remains single-source and avoids duplicate workspace/tile model', () => {
  assert.ok(Array.isArray(SEEDED_TASTE_TRACKS));
  const uniqueIds = new Set(SEEDED_TASTE_TRACKS.map((track) => track.id));
  assert.equal(uniqueIds.size, SEEDED_TASTE_TRACKS.length);
});
