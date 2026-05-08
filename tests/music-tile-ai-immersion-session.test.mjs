import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../apps/music-tile/index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('Immersion Session builder controls exist', () => { assert.match(html, /build-immersion-session-btn/); assert.match(html, /immersion-duration/); });
test('Build immersion session calls AI and emits event', () => { assert.match(js, /buildImmersionSessionWithAi/); assert.match(js, /build-immersion-session/); assert.match(js, /music\.ai_immersion_session_built/); });
test('More\/less like this quick actions exist', () => { assert.match(js, /More like this/); assert.match(js, /Less like this/); assert.match(js, /Same energy, darker/); });
test('Why did this fail action exists', () => { assert.match(js, /Ask AI why this failed/); assert.match(js, /why-this-failed/); });
