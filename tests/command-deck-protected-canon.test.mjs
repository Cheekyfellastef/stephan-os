import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const aiConsolePath = new URL('../stephanos-ui/src/components/AIConsole.jsx', import.meta.url);
const stylesPath = new URL('../stephanos-ui/src/styles.css', import.meta.url);

const missionConsoleTilePath = new URL('../stephanos-ui/src/components/MissionConsoleTile.jsx', import.meta.url);
const appPath = new URL('../stephanos-ui/src/App.jsx', import.meta.url);

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
  assert.match(source, /standardAnswerFitTarget/);
  assert.match(source, /standardTenItemAnswerFitVerdict/);
  assert.match(source, /answerViewportTooSmallReason/);
  assert.match(source, /outerRevealRequested/);
  assert.match(source, /outerRevealSkipped/);
  assert.match(source, /outerRevealSkipReason/);
  assert.match(source, /pageJumpPrevented/);
  assert.match(source, /innerHistoryScrollCompleted/);
});

test('protected canon: answer history scrolls while composer is fixed in flow and non-shrinking', async () => {
  const styles = await read(stylesPath);
  assert.match(styles, /\.mission-console-pane__body\.mission-console__history[\s\S]*overflow-y:\s*auto;/m);
  assert.match(styles, /\.mission-console-pane__body\.mission-console__history[\s\S]*flex:\s*1\s+1\s+auto;/m);
  assert.match(styles, /\.mission-console-pane__body\.mission-console__history[\s\S]*min-height:\s*clamp\(20rem,\s*46vh,\s*34rem\);/m);
  assert.match(styles, /\.mission-console-pane__body\.mission-console__history[\s\S]*max-height:\s*clamp\(28rem,\s*66vh,\s*50rem\);/m);
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


test('protected canon: no silent none scroll reason after final assistant answer render path', async () => {
  const source = await read(aiConsolePath);
  assert.match(source, /requestReason: 'already-visible-confirmed'/);
  assert.match(source, /requestReason: 'missing-target-diagnostic-failure'/);
  assert.match(source, /requestReason: 'missing-container-diagnostic-failure'/);
  assert.match(source, /requestReason: 'reveal-skipped-by-policy'/);
  assert.doesNotMatch(source, /same-answer-signature-already-scrolled'\s*\}\)/);
});


test('protected canon: mission brain top-3 stays inside existing operator relief surface with no parallel command deck framework', async () => {
  const source = await read(missionConsoleTilePath);
  assert.match(source, /title="Operator Relief v2 · Mission Brain"/);
  assert.match(source, /Top 3 Problems \/ Next Moves/);
  assert.match(source, /<div data-testid="mission-console-inner-command-deck">/);
  assert.match(source, /<MissionCommandDeck/);
  assert.match(source, /<AIConsole/);
  assert.doesNotMatch(source, /mission-console-duplicate-pane/i);
  assert.doesNotMatch(source, /parallel-pane-framework/i);

  const aiConsoleMatches = source.match(/<AIConsole/g) || [];
  const commandDeckMatches = source.match(/<MissionCommandDeck/g) || [];
  assert.equal(aiConsoleMatches.length, 1);
  assert.equal(commandDeckMatches.length, 1);

  const top3Index = source.indexOf('Top 3 Problems / Next Moves');
  const operatorReliefIndex = source.indexOf('mission-console-section--operator-relief');
  assert.ok(top3Index > operatorReliefIndex);
});


test('protected canon: render sites pass canonical and non-canonical AIConsole identities', async () => {
  const appSource = await read(appPath);
  const missionSource = await read(missionConsoleTilePath);
  assert.match(appSource, /<AIConsole[\s\S]*surfaceOwnerKey="commandDeck-pane"[\s\S]*panelId="commandDeck"/m);
  assert.match(appSource, /submissionSource: 'stephanos-command-deck'/);
  assert.match(missionSource, /<AIConsole[\s\S]*surfaceOwnerKey="mission-console-section"[\s\S]*panelId="aiCoreMissionConsolePanel"/m);
  assert.match(missionSource, /submissionSource: 'stephanos-mission-console'/);
});
