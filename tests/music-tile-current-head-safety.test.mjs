import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

function functionSlice(startMarker, endMarker) {
  const start = main.indexOf(startMarker);
  const end = main.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${startMarker} must be present and bounded`);
  return main.slice(start, end);
}

test('durable Forget completion cannot replace a newer conversation answer', () => {
  const forgetting = functionSlice(
    'async function forgetConversationTeaching',
    '\n\nfunction getJourneySeedArtist',
  );
  assert.match(forgetting, /const confirmedConversationState = musicConversationState/);
  assert.match(forgetting, /const isConfirmedConversationCurrent = \(\) => musicConversationState === confirmedConversationState/);
  assert.match(forgetting, /const confirmedConversationIsCurrent = isConfirmedConversationCurrent\(\)/);
  assert.match(forgetting, /if \(confirmedConversationIsCurrent\) \{[\s\S]*musicConversationState\.answer = `Forgotten:/);
  assert.match(forgetting, /if \(isConfirmedConversationCurrent\(\)\) \{[\s\S]*musicConversationState\.mode = 'forget blocked'/);
  assert.match(forgetting, /if \(confirmedConversationIsCurrent\) renderMusicConversation\(\{ scrollToFinalAnswer: true \}\)/);
});

test('blocked Reset restores every control invalidated by its generation bump', () => {
  const reset = functionSlice(
    'function restoreInvalidatedMusicOperationControls',
    '\nfunction renderAll',
  );
  assert.match(reset, /nativeSearchButton\) intelligenceUi\.nativeSearchButton\.disabled = false/);
  assert.match(reset, /buildImmersionSessionBtn\) ui\.buildImmersionSessionBtn\.disabled = false/);
  assert.match(reset, /surpriseBtn\.classList\.remove\('is-loading'\)/);
  assert.match(reset, /setMusicConversationBusy\(false, conversationStatus\)/);
  assert.match(reset, /if \(!revocation\.ok\) \{[\s\S]*restoreInvalidatedMusicOperationControls\(\{ conversationStatus: 'Reset blocked · controls restored\.' \}\)/);
  assert.match(reset, /musicConversationState = createIdleMusicConversationState\(\)[\s\S]*restoreInvalidatedMusicOperationControls\(\)/);
});
