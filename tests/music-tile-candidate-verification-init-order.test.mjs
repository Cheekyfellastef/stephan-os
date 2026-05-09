import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AI_CANDIDATE_STATUSES, getCandidateVerificationStatus, isVerifiedCandidateTrack } from '../apps/music-tile/engine/candidateVerification.js';

const mainJs = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('main.js declares candidate verification imports before startup render call', () => {
  const importIndex = mainJs.indexOf("import { AI_CANDIDATE_STATUSES, getCandidateVerificationStatus, isVerifiedCandidateTrack } from './engine/candidateVerification.js';");
  const startupIndex = mainJs.indexOf('const state = loadState(); renderAll(); wireEvents(); updateAiStatus(); renderPresencePanel();');
  assert.ok(importIndex >= 0);
  assert.ok(startupIndex > importIndex);
});

test('getCandidateVerificationStatus runs safely for persisted/legacy data', () => {
  assert.equal(getCandidateVerificationStatus(null), AI_CANDIDATE_STATUSES.searchOnly);
  assert.equal(getCandidateVerificationStatus({ aiSuggested: true }), AI_CANDIDATE_STATUSES.unverified);
  assert.equal(getCandidateVerificationStatus({ candidateVerificationStatus: 'likely-hallucinated' }), AI_CANDIDATE_STATUSES.likelyHallucinated);
  assert.equal(getCandidateVerificationStatus({ candidateVerificationStatus: 'unknown-legacy', aiSuggested: true }), AI_CANDIDATE_STATUSES.unverified);
});

test('valid spotify refs resolve to verified/user-confirmed and stay openable', () => {
  const userConfirmed = getCandidateVerificationStatus({
    aiSuggested: true,
    spotifyUrl: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
  });
  const verified = getCandidateVerificationStatus({
    aiSuggested: false,
    spotifyUrl: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
  });
  assert.equal(userConfirmed, AI_CANDIDATE_STATUSES.userConfirmed);
  assert.equal(verified, AI_CANDIDATE_STATUSES.verified);
  assert.equal(isVerifiedCandidateTrack({ aiSuggested: true, spotifyUrl: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT' }), true);
});

test('render path expectations remain present for listening deck and journey actions', () => {
  assert.match(mainJs, /function renderListeningDeck\(\)/);
  assert.match(mainJs, /state\.listeningDeck\.map\(\(track\) => listeningCardMarkup\(track\)\)/);
  assert.match(mainJs, /data-action="ai-why-failed"/);
  assert.match(mainJs, /askAiTrackTask\(btn\.dataset\.id,'why-this-failed','Ask AI why this failed'\)/);
  assert.doesNotMatch(mainJs, /Cannot access 'AI_CANDIDATE_STATUSES' before initialization/);
});
