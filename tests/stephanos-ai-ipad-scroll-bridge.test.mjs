import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const css = read('apps/stephanos-ai/workspace.css');
const html = read('apps/stephanos-ai/index.html');
const js = read('apps/stephanos-ai/workspace.js');

test('tablet and phone can vertically scroll the workspace even when welcome content overflows', () => {
  assert.match(css, /@media\(max-width:1120px\)\s*\{[\s\S]*?html,body\{height:auto;min-height:100%;overflow-x:hidden;overflow-y:auto\}/);
  assert.match(css, /\.conversation-stage\{min-height:calc\(100vh - 28px\);min-height:calc\(100dvh - 28px\);overflow:visible\}/);
  assert.match(css, /\.messages\{[^}]*-webkit-overflow-scrolling:touch;touch-action:pan-y\}/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(html, /viewport-fit=cover/);
});

test('workspace initialisation does not focus the iPad software keyboard', () => {
  assert.match(js, /selectTarget\(selected\);/);
  assert.match(js, /function selectTarget\(item, \{ focus = false \} = \{\}\)/);
  assert.match(js, /focus && window\.matchMedia\?\.\('\(pointer: fine\)'\)\?\.matches/);
});

test('backend route is independently probed from the loaded browser, not painted green by default', () => {
  assert.match(html, /id="bridgeStatus"[^>]*>Backend · unproven/);
  assert.match(html, /id="frontendOrigin"/);
  assert.match(html, /id="backendRoute"/);
  assert.match(js, /requestStephanosBackend\(\{[\s\S]*?path: '\/api\/health'/);
  assert.match(js, /bridgeStatus\.dataset\.state = 'reachable'/);
  assert.match(js, /bridgeStatus\.dataset\.state = 'unavailable'/);
  assert.doesNotMatch(html, /<span class="truth-pill">live route<\/span>/);
});

test('honest boundary: backend reachability does not assert durable conversation or cross-device UI parity', () => {
  assert.match(html, /Shared continuity<\/dt><dd>not yet verified durable/);
  assert.match(js, /Backend health is not proof of identical UI assets/);
});
