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


test('merge-decision pack includes merge canon and non-direct next action', () => {
  const pack = buildChatContextPack({ operatorMessage: 'do I merge this PR?' });
  const canonText = pack.relevantCanon.map((entry) => entry.text).join(' | ');
  assert.equal(pack.recommendedResponseMode, 'merge-decision');
  assert.match(canonText, /do not merge when checks\/build\/verify fail/);
  assert.match(canonText, /prefer amendment to existing PR when PR is still open/);
  assert.match(canonText, /do not treat terminal-only UI checks as complete/);
  assert.match(pack.recommendedNextAction, /merge|proof|PR/i);
});
