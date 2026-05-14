import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChatContextPack } from './chatContextOrchestrator.js';

test('buildChatContextPack returns compact structured context', () => {
  const pack = buildChatContextPack({ operatorMessage: 'this pane is broken', uiRealityStatus: { severity: 'FAIL' }, routeTruth: { routeKind: 'cloud', routeUsableState: 'yes', executedProvider: 'groq' } });
  assert.equal(pack.version, 'v1');
  assert.equal(pack.recommendedResponseMode, 'diagnosis');
  assert.ok(Array.isArray(pack.relevantCanon));
  assert.ok(pack.warnings.some((w) => w.includes('UI Reality FAIL')));
});

test('intent mapping: merge decision and codex prompt', () => {
  assert.equal(buildChatContextPack({ operatorMessage: 'do I merge this' }).recommendedResponseMode, 'merge-decision');
  assert.equal(buildChatContextPack({ operatorMessage: 'give me a Codex prompt' }).recommendedResponseMode, 'codex-prompt');
});

test('UI tasks include source/dist canon', () => {
  const pack = buildChatContextPack({ operatorMessage: 'this UI pane is broken' });
  const canonText = pack.relevantCanon.map((entry) => entry.text).join(' | ');
  assert.match(canonText, /dist is never source of truth/);
});
