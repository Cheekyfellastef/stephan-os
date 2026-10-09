import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const css = read('apps/stephanos-ai/workspace.css');
const html = read('apps/stephanos-ai/index.html');
const js = read('apps/stephanos-ai/workspace.js');
const client = read('shared/ai/stephanosClient.mjs');
const aiRoute = read('stephanos-server/routes/ai.js');
const continuity = read('stephanos-server/services/sharedIntelligenceContinuityService.js');

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

test('landing page resumes the canonical durable thread instead of reusing a browser-only history map', () => {
  assert.match(aiRoute, /router\.get\('\/shared-thread'/);
  assert.match(aiRoute, /readSharedIntelligenceConversationForWorkspaceV1/);
  assert.match(continuity, /buildStephanosSharedConversationThread\(loaded\.records/);
  assert.match(js, /path: '\/api\/ai\/shared-thread'/);
  assert.match(js, /canonicalHistory\.splice\(0, canonicalHistory\.length/);
  assert.doesNotMatch(js, /const histories = new Map\(/);
  assert.match(html, /id="memoryStatus"/);
  assert.match(html, /id="reloadThread"/);
});

test('failed or interrupted sends retain one unconfirmed device draft without silent retransmission', () => {
  assert.match(js, /const PENDING_KEY = 'stephanos\.ai\.pending-turn\.v1'/);
  assert.match(js, /writePendingDraft\(draft\)/);
  assert.match(js, /pendingDraft\?\.turnId/);
  assert.match(js, /turn\.turnId === pendingDraft\.turnId/);
  assert.match(js, /crypto\.subtle\.digest\('SHA-256', bytes\)/);
  assert.match(js, /window\.confirm\(/);
  assert.match(html, /id="releaseDraft"/);
  assert.match(client, /headers: \/\^\[a-z0-9\]/i);
});

test('long conversations window the UI and keep operator context on canonical backend', () => {
  assert.match(js, /historyFor\(selected\.id\)\.slice\(-64\)/);
  assert.match(js, /messages\.scrollHeight - messages\.scrollTop - messages\.clientHeight/);
  assert.match(continuity, /threadContextBlock\(projection\.thread, knowledgeTwin\)/);
});
