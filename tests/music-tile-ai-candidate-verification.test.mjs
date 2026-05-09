import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('AI candidate hints default to unverified unless valid source URL exists', () => {
  assert.match(js, /candidateVerificationStatus: verified \? AI_CANDIDATE_STATUSES\.verified : AI_CANDIDATE_STATUSES\.unverified/);
});

test('unverified candidates show badge and hide direct Spotify open/embed', () => {
  assert.match(js, /AI suggestion · unverified/);
  assert.match(js, /const hasPlayableSpotifyTrack = verifiedCandidate && spotifyRef\.valid && spotifyRef\.type === 'track';/);
});

test('candidate controls include search links and not found flow', () => {
  assert.match(js, /Find on Spotify/);
  assert.match(js, /Find on YouTube/);
  assert.match(js, /Mark as not found/);
  assert.match(js, /music\.ai_candidate_not_found/);
});

test('saving Spotify URL upgrades candidate verification status', () => {
  assert.match(js, /track\.candidateVerificationStatus = track\.aiSuggested \? AI_CANDIDATE_STATUSES\.userConfirmed : AI_CANDIDATE_STATUSES\.verified/);
});

test('AI prompt instructs model not to invent track titles', () => {
  assert.match(js, /Do not invent track titles\. If unsure, provide search query candidates instead of exact track claims\./);
});
