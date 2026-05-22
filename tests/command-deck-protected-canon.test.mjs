import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const aiConsolePath = new URL('../stephanos-ui/src/components/AIConsole.jsx', import.meta.url);
const stylesPath = new URL('../stephanos-ui/src/styles.css', import.meta.url);

async function read(fileUrl) {
  return fs.readFile(fileUrl, 'utf8');
}

test('protected canon: command deck composer/input/execute selectors are present for DOM proof', async () => {
  const source = await read(aiConsolePath);
  assert.match(source, /data-testid="command-deck-root"/);
  assert.match(source, /data-testid="command-deck-body"/);
  assert.match(source, /data-testid="command-deck-answer-history"/);
  assert.match(source, /data-testid="command-deck-composer"/);
  assert.match(source, /data-testid="command-deck-input"/);
  assert.match(source, /data-testid="command-deck-execute"/);
});

test('protected canon: layout diagnostics include visibility and non-zero-height verdict fields', async () => {
  const source = await read(aiConsolePath);
  assert.match(source, /resolveVisibleCommandDeckRoot/);
  assert.match(source, /commandDeckComposerBottomWithinView/);
  assert.match(source, /commandDeckInputVisible/);
  assert.match(source, /commandDeckExecuteButtonVisible/);
  assert.match(source, /commandDeckLayoutVerdict/);
  assert.match(source, /commandDeckLayoutBlocker/);
  assert.match(source, /viewPaneHeight/);
  assert.match(source, /latestAssistantAnswerDomFound/);
  assert.match(source, /answerViewportFitsLatestAnswer/);
  assert.match(source, /answerViewportFitVerdict/);
  assert.match(source, /answerViewportTooSmallReason/);
});

test('protected canon: answer history scrolls while composer is fixed in flow and non-shrinking', async () => {
  const styles = await read(stylesPath);
  assert.match(styles, /\.mission-console-pane__body\.mission-console__history[\s\S]*overflow-y:\s*auto;/m);
  assert.match(styles, /\.mission-console-pane__body\.mission-console__history[\s\S]*flex:\s*1\s+1\s+auto;/m);
  assert.match(styles, /\.mission-console-pane__body\.mission-console__history[\s\S]*min-height:\s*clamp\(15\.5rem,\s*40vh,\s*30rem\);/m);
  assert.match(styles, /\.mission-console-pane__body\.mission-console__history[\s\S]*max-height:\s*clamp\(21\.75rem,\s*62vh,\s*42rem\);/m);
  assert.match(styles, /\.mission-console-input,[\s\S]*\.mission-console__composer[\s\S]*flex-shrink:\s*0;/m);
});

test('protected canon: composer sits after answer history inside command deck and before lower status/tools surfaces', async () => {
  const source = await read(aiConsolePath);
  const historyIndex = source.lastIndexOf('data-testid="command-deck-answer-history"');
  const composerIndex = source.lastIndexOf('data-testid="command-deck-composer"');
  const executeIndex = source.lastIndexOf('data-testid="command-deck-execute"');
  assert.ok(historyIndex >= 0);
  assert.ok(composerIndex > historyIndex);
  assert.ok(executeIndex > composerIndex);
});

test('protected canon: dev-mode inline failure marker exists if composer contract breaks', async () => {
  const source = await read(aiConsolePath);
  assert.match(source, /Command Deck composer missing — protected canon failure\./);
  assert.match(source, /setComposerContractFailure\(/);
});
