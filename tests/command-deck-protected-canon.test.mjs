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
});

test('protected canon: answer history scrolls while composer is fixed in flow and non-shrinking', async () => {
  const styles = await read(stylesPath);
  assert.match(styles, /\.mission-console-pane__body\.mission-console__history[\s\S]*overflow-y:\s*auto;/m);
  assert.match(styles, /\.mission-console-input,[\s\S]*\.mission-console__composer[\s\S]*flex-shrink:\s*0;/m);
  assert.match(styles, /\.mission-console \.panel-body[\s\S]*height:\s*min\(72vh,\s*760px\);/m);
});
