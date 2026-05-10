import test from 'node:test';
import assert from 'node:assert/strict';
import { MUSIC_FAILURE_SCENARIO_PACK } from '../stephanos-ui/src/state/operatorReliefProjection.js';

test('music failure scenario pack captures lesson candidates and blockers', () => {
  assert.match(MUSIC_FAILURE_SCENARIO_PACK.ai_suggested_fake_track.lessonCandidate, /unverified/);
  assert.match(MUSIC_FAILURE_SCENARIO_PACK.wrong_spotify_url.lessonCandidate, /Spotify search URLs/);
  assert.match(MUSIC_FAILURE_SCENARIO_PACK.false_canon_invention.lessonCandidate, /Canon/);
  assert.match(MUSIC_FAILURE_SCENARIO_PACK.build_journey_froze.requiredProof, /Build Journey/);
});
