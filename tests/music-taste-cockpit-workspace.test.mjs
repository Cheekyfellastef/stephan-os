import test from 'node:test';
import assert from 'node:assert/strict';

import { SEEDED_TASTE_TRACKS } from '../apps/music-tile/data/musicTasteSeeds.js';
import { buildTasteProfileMarkup, buildListeningCardsMarkup } from '../apps/music-tile/ui/tasteCockpitView.js';

test('taste profile renders target anchors and rejects', () => {
  const markup = buildTasteProfileMarkup(SEEDED_TASTE_TRACKS);
  assert.match(markup, /Dark Courtyard \/ Ghost Vocal \/ Serious Trance DNA/);
  assert.match(markup, /Push - Universal Nation/);
  assert.match(markup, /Reject Patterns/);
});

test('listening cards render spotify iframe with encrypted-media and spotify link when available', () => {
  const markup = buildListeningCardsMarkup(SEEDED_TASTE_TRACKS);
  assert.match(markup, /<iframe[^>]+open\.spotify\.com\/embed\/track\//);
  assert.match(markup, /allow="[^"]*encrypted-media[^"]*"/);
  assert.match(markup, /Open in Spotify/);
});

test('tracks without spotify references render Needs Spotify link', () => {
  const markup = buildListeningCardsMarkup([{ id:'x1', artist:'No Ref Artist', title:'No Ref Title', signal:'interesting', lane:'Test Lane' }]);
  assert.match(markup, /Needs Spotify link/);
});
