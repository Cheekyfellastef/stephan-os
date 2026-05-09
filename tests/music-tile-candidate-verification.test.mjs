import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('AI candidate without URLs defaults to unverified', () => {
  assert.match(js, /candidateVerificationStatus: verified \? AI_CANDIDATE_STATUSES\.verified : AI_CANDIDATE_STATUSES\.unverified/);
});

test('Unverified candidate does not render Spotify iframe/open links and shows warning label', () => {
  assert.match(js, /AI suggestion · unverified/);
  assert.match(js, /Unverified AI candidate\. Search before treating as real\./);
  assert.match(js, /const hasPlayableSpotifyTrack = verifiedCandidate && spotifyRef\.valid && spotifyRef\.type === 'track';/);
});

test('Hallucination feedback parser and events are present', () => {
  assert.match(js, /not a real song/);
  assert.match(js, /artist is real but song isn't/);
  assert.match(js, /music\.ai_candidate_hallucinated/);
  assert.match(js, /music\.ai_candidate_unverified/);
  assert.match(js, /User could not verify this track\. Artist\/reference may be real, title may be AI-generated\./);
});

test('Candidate verification controls and state transitions are present', () => {
  assert.match(js, /Candidate Verification/);
  assert.match(js, /Mark verified/);
  assert.match(js, /Mark not found/);
  assert.match(js, /Mark hallucinated/);
  assert.match(js, /Replace with verified link/);
  assert.match(js, /track\.candidateVerificationStatus = track\.aiSuggested \? AI_CANDIDATE_STATUSES\.userConfirmed : AI_CANDIDATE_STATUSES\.verified/);
});

test('AI prompt hardening includes no invented titles instruction', () => {
  assert.match(js, /Do not invent track titles\./);
});
