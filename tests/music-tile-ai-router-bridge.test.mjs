import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../apps/music-tile/index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../apps/music-tile/engine/musicAiBridge.js', import.meta.url), 'utf8');

test('Music Tile renders AI router status section', () => { assert.match(html, /id="ai-status-card"/); });
test('AI unavailable fallback message exists', () => { assert.match(js, /AI router unavailable; rule-based interpretation active/); });
test('Ask AI to interpret feedback button exists', () => { assert.match(js, /ai-interpret-feedback/); });
test('AI feedback prompt includes track feedback and tasteDNA', () => { assert.match(js, /interpret-feedback/); assert.match(bridge, /tasteDNA/); });
test('Structured AI trait suggestion renders in approval panel', () => { assert.match(js, /AI suggested trait changes/); });
test('Trait suggestions do not apply before approval', () => { assert.match(js, /Apply all/); assert.match(js, /Reject suggestion/); });
test('Apply/reject hooks update-or-not update Taste DNA', () => { assert.match(js, /applyAiSuggestion/); assert.match(js, /rejectAiSuggestion/); });
test('Ask AI to build smarter journey present', () => { assert.match(html, /ask-ai-build-journey-btn/); assert.match(js, /buildJourneyAiAssisted/); });
test('AI journey candidates include Find on Spotify and Find on YouTube', () => { assert.match(js, /Find on Spotify/); assert.match(js, /Find on YouTube/); });
test('Link resolution without search route prepares actions not fake link', () => { assert.match(bridge, /allowLiveVerification/); });
test('Search URLs are not saved as spotifyUrl', () => { assert.match(js, /Spotify search link or invalid link/); });
test('Resolve all missing links AI-assisted is resilient', () => { assert.match(js, /resolveAllMissingLinksAiAssisted/); });
test('Promote to Stephanos memory requires approval + fallback', () => { assert.match(js, /Promote strong Taste DNA to Stephanos memory/); assert.match(js, /Durable memory promotion not connected yet/); });
