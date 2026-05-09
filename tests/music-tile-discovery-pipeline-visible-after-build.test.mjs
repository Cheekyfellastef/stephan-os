import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('Build Journey sets state.discoveryPipeline', () => {
  assert.match(source, /state\.discoveryPipeline\s*=\s*\{\s*\.\.\.pipeline/);
});

test('renderAll renders Discovery Pipeline Summary before AI Smarter Journey for normal Build Journey', () => {
  const discoveryRender = source.slice(source.indexOf('function renderDiscoveryResults()'), source.indexOf('function renderActiveJourneySummary()'));
  const pipelineIndex = discoveryRender.indexOf('Discovery Pipeline Summary');
  const aiIndex = discoveryRender.indexOf('<h3>AI Smarter Journey</h3>');
  assert.ok(pipelineIndex !== -1 && aiIndex !== -1, 'expected both headings in discovery render content');
  assert.ok(pipelineIndex < aiIndex, 'discovery pipeline should appear before AI Smarter Journey heading in discovery render content');
});

test('Search Leads section renders when pipeline has search leads', () => {
  assert.match(source, /<h3>Search Leads<\/h3>/);
});

test('Fallback Taste DNA section renders when pipeline has fallback candidates', () => {
  assert.match(source, /<h3>Fallback Taste DNA Matches<\/h3>/);
});

test('AI Smarter Journey remains separate', () => {
  assert.match(source, /No AI smarter journey yet\. Click "Ask AI to build smarter journey" to generate one\./);
});

test('Build Journey status points to Discovery Pipeline', () => {
  assert.match(source, /Built \$\{state\.candidates\.length\} candidates for \$\{meta\.canonicalArtist \|\| term\} — see Discovery Pipeline\./);
});

test('Pipeline summary shows counts', () => {
  assert.match(source, /sections counts: candidates \$\{\(state\.candidates \|\| \[\]\)\.length\}, search leads \$\{\(p\.searchLeads \|\| \[\]\)\.length\}, verified \$\{\(p\.verifiedCandidates \|\| \[\]\)\.length\}, fallback \$\{\(p\.fallbackCandidates \|\| \[\]\)\.length\}/);
});

test('Search Leads render visible action buttons', () => {
  assert.match(source, /Search Spotify<\/a><a class="media-btn youtube"/);
});

test('Verified Candidates empty state renders if none verified', () => {
  assert.match(source, /No verified candidates yet\./);
});

test('Legacy/local results are labelled secondary', () => {
  assert.match(source, /Discovery Results \(Legacy \/ local results — secondary\)/);
});
