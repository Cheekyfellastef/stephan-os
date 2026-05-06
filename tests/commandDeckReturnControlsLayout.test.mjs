import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

const buttonPath = path.join(root, 'shared/runtime/commandDeckReturnButton.mjs');
const controlsPath = path.join(root, 'shared/runtime/commandDeckReturnControls.mjs');

test('command deck return button uses canonical full-width command bar styling', async () => {
  const source = await fs.readFile(buttonPath, 'utf8');
  [
    'const BUTTON_CLASS = \'command-deck-return-button\';',
    'width: 100%;',
    'display: inline-flex;',
    'justify-content: center;',
    ':focus-visible',
  ].forEach((token) => {
    assert.equal(source.includes(token), true, `missing return button canonical style token: ${token}`);
  });
});

test('command deck return control container spans canonical workspace lane width', async () => {
  const source = await fs.readFile(controlsPath, 'utf8');
  [
    "const CONTAINER_CLASS = 'command-deck-return-controls';",
    'width: min(1180px, calc(100% - 24px));',
    'justify-content: stretch;',
    'createCommandDeckReturnButton({ documentRef, windowRef })',
  ].forEach((token) => {
    assert.equal(source.includes(token), true, `missing return control container token: ${token}`);
  });
});
