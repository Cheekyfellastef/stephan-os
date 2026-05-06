import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(root, '../../..');
const stylesPath = path.resolve(root, '../styles.css');
const appPath = path.resolve(root, '../App.jsx');
const launcherIndexPath = path.resolve(repoRoot, 'index.html');
const workspacePath = path.resolve(repoRoot, 'system/workspace.js');

test('root launcher/workspace containment chain declares bounded width contract', async () => {
  const [css, app, indexHtml, workspaceJs] = await Promise.all([
    fs.readFile(stylesPath, 'utf8'),
    fs.readFile(appPath, 'utf8'),
    fs.readFile(launcherIndexPath, 'utf8'),
    fs.readFile(workspacePath, 'utf8'),
  ]);

  [
    'html,',
    'overflow-x: clip;',
    '#workspace-content.stephanos-root-workspace-canvas',
    '.app-shell-root {',
    '.workspace-shell {',
    '.workspace-stage,',
    '.workspace-canvas,',
    '.workspace-content {',
    'className="workspace-shell mission-console-surface-stage mission-console-workspace"',
    'iframe.style.width = "100%"',
  ].forEach((token) => {
    assert.equal((css + app + indexHtml + workspaceJs).includes(token), true, `missing containment token: ${token}`);
  });
});

test('workspace surfaces avoid unsafe nested 100vw sizing', async () => {
  const [css, app] = await Promise.all([fs.readFile(stylesPath, 'utf8'), fs.readFile(appPath, 'utf8')]);
  const unsafeTokens = ['100vw', 'width: 100vw'];
  unsafeTokens.forEach((token) => {
    assert.equal((css + app).includes(token), false, `unsafe viewport-width token present: ${token}`);
  });
});
