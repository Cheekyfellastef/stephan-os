import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../apps/music-tile/index.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('AI Smarter Journey section renders with clear heading and subtitle', () => {
  assert.match(html, /AI Smarter Journey/);
  assert.match(html, /AI-guided candidates, search hints, and reasoning/);
});

test('Empty AI Smarter Journey state and separate render events exist', () => {
  assert.match(js, /No AI smarter journey yet\. Click "Ask AI to build smarter journey" to generate one\./);
  assert.match(js, /music\.ai_smarter_journey_started/);
  assert.match(js, /music\.ai_smarter_journey_rendered/);
  assert.match(js, /music\.ai_smarter_journey_text_fallback/);
});
