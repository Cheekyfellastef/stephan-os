import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('Build Immersion Session immediately shows contacting status and loading lifecycle hooks', () => {
  assert.match(js, /Contacting Stephanos AI for immersion session\.\.\./);
  assert.match(js, /buildImmersionSessionBtn\) ui\.buildImmersionSessionBtn\.disabled=true/);
  assert.match(js, /finally \{\s*if \(ui\.buildImmersionSessionBtn\)/);
});

test('Structured AI response path renders built status and presence success event', () => {
  assert.match(js, /normalizeImmersionSession/);
  assert.match(js, /Immersion session built\./);
  assert.match(js, /music\.ai_immersion_session_built/);
});

test('Text fallback path renders panel and emits text fallback event', () => {
  assert.match(js, /renderImmersionTextFallback/);
  assert.match(js, /AI returned a text session plan\./);
  assert.match(js, /music\.ai_immersion_session_text_fallback/);
});

test('Timeout and failure paths render rule fallback session and failure events', () => {
  assert.match(js, /IMMERSION_REQUEST_TIMEOUT_MS\s*=\s*25000/);
  assert.match(js, /AI request timed out\. Rule-based immersion session created\./);
  assert.match(js, /music\.ai_immersion_session_failed/);
  assert.match(js, /music\.immersion_session_rule_fallback/);
});

test('Rule-based fallback includes required phases and candidate hints', () => {
  assert.match(js, /Doorway \/ Warm-up/);
  assert.match(js, /Lift \/ Portal/);
  assert.match(js, /Club Engine/);
  assert.match(js, /Afterglow/);
  assert.match(js, /Anyma/);
  assert.match(js, /Welcome To The Opera/);
  assert.match(js, /Say Yes To Heaven remix/);
});
