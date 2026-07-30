import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../apps/music-tile/index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../apps/music-tile/style.css', import.meta.url), 'utf8');

test('daily briefing leads with one dominant journey action and the three-question contract', () => {
  assert.match(html, /data-experience="daily-briefing"/);
  assert.match(html, /id="surprise-me-btn" class="journey-button"/);
  assert.match(html, /id="briefing-listen-now"/);
  assert.match(html, /id="briefing-why"/);
  assert.match(html, /id="briefing-novelty"/);
  assert.match(html, /LISTEN NOW/);
  assert.match(html, /WHY IT FITS/);
  assert.match(html, /WHAT’S NEW/);
});

test('setup, diagnostics, Taste DNA editing and legacy controls remain available behind Advanced Studio', () => {
  assert.match(html, /<details class="advanced-studio" id="advanced-studio">/);
  assert.doesNotMatch(html, /<details class="advanced-studio" id="advanced-studio" open/);
  [
    'artist-input',
    'build-journey-btn',
    'start-journey-btn',
    'taste-dna-editor',
    'ai-status-card',
    'assisted-setup-panel',
    'discovery-results-list',
  ].forEach((id) => assert.match(html, new RegExp(`id="${id}"`)));
});

test('Surprise Me reuses stored truth and never labels an unverified candidate as playable', () => {
  assert.match(js, /async function startSurpriseJourney\(\)/);
  assert.match(js, /const seedArtist = getJourneySeedArtist\(\)/);
  assert.match(js, /const buildOutcome = await buildJourney\(\)/);
  assert.match(js, /if \(!buildOutcome\?\.ok\) return/);
  assert.match(js, /isVerifiedCandidateTrack\(track\) && spotify\.valid && spotify\.type === 'track'/);
  assert.match(js, /AI lead · unverified/);
  assert.match(js, /Local candidate · verify/);
  assert.match(js, /wider listening history is unavailable/);
  assert.match(js, /Evidence unavailable/);
});

test('listening tools are progressively disclosed without removing their existing controls', () => {
  assert.match(js, /function enhanceListeningDeckCards\(\)/);
  assert.match(js, /function renderListeningDeck\(\)[\s\S]*enhanceListeningDeckCards\(\); \}/);
  assert.match(js, /details\.className = 'track-tools'/);
  assert.match(js, /Tune, verify & teach Stephanos/);
  assert.match(js, /data-action="apply-feedback"/);
  assert.match(js, /data-action="save-spotify-link"/);
  assert.match(js, /data-action="ai-why-failed"/);
});

test('live compass derives relative strength from stored Taste DNA instead of static decoration', () => {
  assert.match(html, /id="taste-compass-meter"/);
  assert.doesNotMatch(html, /--strength:\s*(?:88|72|61)%/);
  assert.match(js, /const strongestWeight = Number\(positiveSignalEntries\[0\]/);
  assert.match(js, /Math\.round\(\(weight \/ strongestWeight\) \* 100\)/);
  assert.match(js, /stored weight \$\{weight\.toFixed\(2\)\}/);
});

test('journey build returns an explicit outcome so persistence failures cannot become false success', () => {
  assert.match(js, /return Object\.freeze\(\{ ok: !resolverFailed, message: finalStatus/);
  assert.match(js, /return Object\.freeze\(\{ ok: false, message, candidateCount:/);
  assert.match(js, /Journey not ready:/);
});

test('artist-prefixed seed titles are de-duplicated in the daily experience', () => {
  assert.match(js, /function getDisplayTrackTitle\(track = \{\}\)/);
  assert.match(js, /rawTitle\.toLowerCase\(\)\.startsWith\(artistPrefix\.toLowerCase\(\)\)/);
  assert.match(js, /const title = getDisplayTrackTitle\(track\)/);
  assert.match(js, /music-card-title"\>\$\{escapeHtml\(getDisplayTrackTitle\(track\)\)\}/);
});

test('cinematic layout has iPad, phone and reduced-motion safeguards', () => {
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(max-width: 580px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.daily-briefing \{/);
  assert.match(css, /\.signal-orbit \{/);
  assert.match(css, /\.discovery-spotlight/);
});
